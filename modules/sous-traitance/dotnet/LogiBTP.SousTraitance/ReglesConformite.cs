namespace LogiBTP.SousTraitance;

/// <summary>
/// Pièce exigée : portée TIERS (sous-traitant) ou MARCHE, catégorie GED, obligatoire, durée de validité en mois, délai de
/// rappel, actions bloquées (COMMANDE, FACTURE, PAIEMENT), conditions (marché public, garantie, montant minimal).
/// </summary>
public sealed record Exigence(string Code, string Libelle, string Portee, string? Categorie, bool Obligatoire, int? DureeMois, int RappelJours,
    IReadOnlyList<string> Bloquant, bool? CondPublic = null, string? CondGarantie = null, decimal? CondMontantMin = null, int Ordre = 0, bool Actif = true);

/// <summary>Pièce fournie (document de la GED) : catégorie, portée, document, date de dépôt, fin de validité saisie.</summary>
public sealed record PieceFournie(string Categorie, string? Portee, long? DgeId, DateOnly? DeposeLe, DateOnly? ValideAu);

/// <summary>Pièce ajoutée ou dispensée sur un marché ou un sous-traitant, avec son motif.</summary>
public sealed record Ajustement(string Code, string Mode, string? Motif);

/// <summary>Contexte du marché : public, garantie de paiement, montant HT.</summary>
public sealed record ContexteMarche(bool Public = false, string? Garantie = null, decimal MontantHt = 0);

public sealed record EtatPieceExigee(string Code, string Libelle, string Portee, bool Obligatoire, string Etat, DateOnly? Fin, long? DgeId, string? Motif,
    IReadOnlyList<string> Bloquant);

public sealed record Conformite(List<EtatPieceExigee> Pieces, bool Conforme, List<string> AEcheance, Dictionary<string, List<string>> Bloquants);

/// <summary>
/// Conformité des pièces, répliquée dans conformite.js (jeu modules/sous-traitance/tests/cas/01_conformite.json).
/// </summary>
public static class ReglesConformite
{
    public static readonly string[] Etats = ["FOURNIE", "A_ECHEANCE", "EXPIREE", "MANQUANTE", "ABSENTE", "DISPENSEE"];
    public static readonly string[] Actions = ["COMMANDE", "FACTURE", "PAIEMENT"];

    /// <summary>Date + n mois, jour ramené au dernier du mois s'il n'existe pas (comme `ajouterMois` du socle JS).</summary>
    public static DateOnly AjouterMois(DateOnly d, int n) => d.AddMonths(n);

    public static bool Applicable(Exigence e, ContexteMarche c) =>
        (e.CondPublic is not bool p || c.Public == p)
        && (string.IsNullOrEmpty(e.CondGarantie) || c.Garantie == e.CondGarantie)
        && (e.CondMontantMin is not decimal m || c.MontantHt >= m);

    public static DateOnly? FinValidite(Exigence e, PieceFournie? p)
    {
        if (p is null) return null;
        if (p.ValideAu is { } v) return v;
        return e.DureeMois is int n && n > 0 && p.DeposeLe is { } d ? AjouterMois(d, n) : null;
    }

    public static string Etat(Exigence e, PieceFournie? p, bool dispensee, bool obligatoire, DateOnly aujourdhui)
    {
        if (dispensee) return "DISPENSEE";
        if (p is null) return obligatoire ? "MANQUANTE" : "ABSENTE";
        var fin = FinValidite(e, p);
        if (fin is { } f && f < aujourdhui) return "EXPIREE";
        if (fin is { } g && e.RappelJours > 0 && g <= aujourdhui.AddDays(e.RappelJours)) return "A_ECHEANCE";
        return "FOURNIE";
    }

    /// <summary>Conformité d'un marché (portées TIERS et MARCHE) ou d'un sous-traitant seul (TIERS).</summary>
    public static Conformite Calculer(IReadOnlyList<Exigence> exigences, IReadOnlyList<PieceFournie> pieces, IReadOnlyList<Ajustement> ajustements,
        ContexteMarche contexte, DateOnly aujourdhui, IReadOnlyCollection<string>? portees = null)
    {
        portees ??= ["TIERS", "MARCHE"];
        var aj = ajustements.GroupBy(a => a.Code).ToDictionary(g => g.Key, g => g.Last());
        var liste = exigences
            .Where(e => portees.Contains(e.Portee) && e.Actif)
            .Where(e => aj.TryGetValue(e.Code, out var a) && a.Mode is "AJOUTEE" or "DISPENSEE" || Applicable(e, contexte))
            .OrderBy(e => e.Ordre).ThenBy(e => e.Code, StringComparer.Ordinal).ToList();
        var res = new List<EtatPieceExigee>();
        foreach (var e in liste)
        {
            var categorie = string.IsNullOrEmpty(e.Categorie) ? e.Code : e.Categorie;
            var piece = pieces.Where(p => p.Categorie == categorie && (string.IsNullOrEmpty(p.Portee) || p.Portee == e.Portee))
                .OrderByDescending(p => FinValidite(e, p) ?? DateOnly.MaxValue).ThenByDescending(p => p.DeposeLe ?? DateOnly.MinValue).FirstOrDefault();
            aj.TryGetValue(e.Code, out var a);
            var obligatoire = e.Obligatoire || a?.Mode == "AJOUTEE";
            res.Add(new EtatPieceExigee(e.Code, e.Libelle, e.Portee, obligatoire, Etat(e, piece, a?.Mode == "DISPENSEE", obligatoire, aujourdhui),
                FinValidite(e, piece), piece?.DgeId, a?.Motif, e.Bloquant));
        }
        static bool EnDefaut(EtatPieceExigee p) => p.Etat is "MANQUANTE" or "EXPIREE";
        return new Conformite(res, !res.Any(p => p.Obligatoire && EnDefaut(p)), res.Where(p => p.Etat == "A_ECHEANCE").Select(p => p.Code).ToList(),
            Actions.ToDictionary(x => x, x => res.Where(p => EnDefaut(p) && p.Bloquant.Contains(x)).Select(p => p.Code).ToList()));
    }
}
