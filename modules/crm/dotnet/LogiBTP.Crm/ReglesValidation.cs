namespace LogiBTP.Crm;

/// <summary>Visa attendu ou reçu d'un indice : statut (null : attendu), date attendue.</summary>
public sealed record VisaAEvaluer(string? Statut, DateOnly? AttenduLe);

/// <summary>Indice d'un plan : lettre, date de diffusion (null : à diffuser), visas.</summary>
public sealed record IndiceAEvaluer(string Indice, DateOnly? Date, IReadOnlyList<VisaAEvaluer> Visas);

/// <summary>État d'un plan : statut du dernier indice, dernier indice, indice en vigueur, visas manquants et en retard, bloquant.</summary>
public sealed record EtatPlan(string Statut, string? Indice, string? EnVigueur, int Manquants, int Retards, bool Bloquant);

/// <summary>
/// Suivi des validations (validations.js côté client, jeu modules/crm/tests/cas/04_validations.json) : statut du
/// dernier indice (à diffuser, sans visa, en attente, refusé, bon pour exécution), indice en vigueur (dernier indice
/// validé), indice suivant (A → B, Z → AA).
/// </summary>
public static class ReglesValidation
{
    public static readonly string[] Effets = ["ACCEPTE", "REFUSE", "NEUTRE"];

    private static (string Statut, int Manquants, int Retards) EtatIndice(IndiceAEvaluer i, IReadOnlyDictionary<string, string> effets, DateOnly aujourdhui)
    {
        var recus = i.Visas.Where(v => v.Statut is not null).ToList();
        var manquants = i.Visas.Count - recus.Count;
        var retards = i.Visas.Count(v => v.Statut is null && v.AttenduLe is DateOnly a && a < aujourdhui);
        var refus = recus.Count(v => effets.GetValueOrDefault(v.Statut!) == "REFUSE");
        var acceptes = recus.Count(v => effets.GetValueOrDefault(v.Statut!) == "ACCEPTE");
        var statut = i.Date is null ? "A_DIFFUSER" : i.Visas.Count == 0 ? "SANS_VISA" : refus > 0 ? "REFUSE" : manquants > 0 ? "EN_ATTENTE" : acceptes > 0 ? "VALIDE" : "SANS_VISA";
        return (statut, manquants, retards);
    }

    /// <summary>État d'un plan ; indices dans l'ordre de création, effets par code de statut de visa.</summary>
    public static EtatPlan Etat(IReadOnlyList<IndiceAEvaluer> indices, IReadOnlyDictionary<string, string> effets, DateOnly aujourdhui)
    {
        if (indices.Count == 0) return new EtatPlan("SANS_INDICE", null, null, 0, 0, true);
        var etats = indices.Select(i => (I: i, E: EtatIndice(i, effets, aujourdhui))).ToList();
        var dernier = etats[^1];
        var enVigueur = etats.LastOrDefault(x => x.E.Statut == "VALIDE").I?.Indice;
        return new EtatPlan(dernier.E.Statut, dernier.I.Indice, enVigueur, dernier.E.Manquants, dernier.E.Retards, dernier.E.Statut != "VALIDE");
    }

    /// <summary>Indice suivant : A → B, Z → AA, AZ → BA ; vide ou non alphabétique → A.</summary>
    public static string IndiceSuivant(string? indice)
    {
        var s = (indice ?? "").Trim().ToUpperInvariant();
        if (s.Length == 0 || !s.All(c => c is >= 'A' and <= 'Z')) return "A";
        var lettres = s.ToCharArray();
        var i = lettres.Length - 1;
        while (i >= 0 && lettres[i] == 'Z') { lettres[i] = 'A'; i--; }
        if (i < 0) return "A" + new string(lettres);
        lettres[i]++;
        return new string(lettres);
    }
}
