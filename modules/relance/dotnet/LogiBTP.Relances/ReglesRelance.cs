namespace LogiBTP.Relances;

/// <summary>Niveau d'une règle : rang (1 à 5), délai en jours depuis le départ, mode proposé, modèles de courriel et d'édition.</summary>
public sealed record NiveauRelance(int Rang, int Delai, string Mode, long? ModeleCourriel = null, long? ModeleEdition = null);

/// <summary>Règle d'une nature (ou d'un tiers) : niveaux, dernier niveau répété tous les <c>Intervalle</c> jours.</summary>
public sealed record RegleRelance(IReadOnlyList<NiveauRelance> Niveaux, bool Repeter = false, int? Intervalle = null);

/// <summary>Niveau atteint : rang, répétition du dernier niveau, date où il est atteint, jours depuis le départ.</summary>
public sealed record NiveauAtteint(int Rang, int Repetition, DateOnly Palier, int Jours);

/// <summary>Échéance d'une facture : date (retenue de garantie : date de libération ; null : jamais échue), reste.</summary>
public sealed record EcheanceRelance(long Id, DateOnly? Date, decimal Reste, bool Retenue = false);

/// <summary>Dernière relance faite (non annulée) d'une pièce : niveau et date.</summary>
public sealed record RelanceFaite(int Niveau, DateOnly Date);

/// <summary>
/// Pièce en attente : nature, tiers, chargé, départ et montant (devis), échéances (facture), dernière relance faite,
/// arrêt, suspension jusqu'au (comprise), règle propre (surcharge du tiers).
/// </summary>
public sealed record PieceRelance(
    long Id,
    string Nature,
    long Tiers,
    long? Charge = null,
    DateOnly? Depart = null,
    decimal Montant = 0,
    IReadOnlyList<EcheanceRelance>? Echeances = null,
    RelanceFaite? Derniere = null,
    bool Arretee = false,
    DateOnly? SuspendueJusquAu = null,
    RegleRelance? Regle = null);

/// <summary>Échéance future d'une facture relancée, listée pour information.</summary>
public sealed record EcheanceFuture(long Id, DateOnly? Date, decimal Reste, bool Retenue);

/// <summary>Relance due d'une pièce : niveau atteint, mode et modèles du niveau, départ, montant relancé, échéances.</summary>
public sealed record RelanceDue(
    long Id,
    string Nature,
    long Tiers,
    long? Charge,
    int Niveau,
    int Repetition,
    string Mode,
    long? ModeleCourriel,
    long? ModeleEdition,
    DateOnly Depart,
    DateOnly Palier,
    int Jours,
    decimal Montant,
    IReadOnlyList<long> Echues,
    IReadOnlyList<EcheanceFuture> Futures);

/// <summary>Pièce d'un groupe : elle garde son propre niveau.</summary>
public sealed record PieceGroupe(long Id, int Niveau, int Repetition, int Jours, decimal Montant);

/// <summary>Relance groupée par tiers, chargé, nature et mode : modèles du niveau le plus élevé.</summary>
public sealed record GroupeRelance(
    long Tiers,
    long? Charge,
    string Nature,
    string Mode,
    int Niveau,
    long? ModeleCourriel,
    long? ModeleEdition,
    int Jours,
    decimal Montant,
    IReadOnlyList<PieceGroupe> Pieces);

/// <summary>
/// Règle des niveaux et calcul des relances dues (regles.js côté client, jeu modules/relance/tests/cas/01_niveaux.json) :
/// départ (date d'envoi d'un devis, échéance échue la plus ancienne non soldée d'une facture), niveau atteint (seul
/// proposé, s'il dépasse la dernière relance faite ; répétition du dernier niveau), arrêt et suspension, montant échu,
/// échéances futures, regroupement par tiers, chargé, nature et mode.
/// </summary>
public static class ReglesRelance
{
    /// <summary>Nombre maximal de niveaux d'une règle.</summary>
    public const int NiveauxMax = 5;

    /// <summary>Règle par défaut d'une nature (Q4) : 15, 30, 60 jours ; dernier niveau d'une facture en recommandé (Q13).</summary>
    public static RegleRelance RegleParDefaut(string nature)
    {
        var dernier = nature == NatureRelance.Facture ? ModeRelance.Recommande : ModeRelance.Courriel;
        return new RegleRelance([
            new NiveauRelance(1, 15, ModeRelance.Courriel),
            new NiveauRelance(2, 30, ModeRelance.Courriel),
            new NiveauRelance(3, 60, dernier)]);
    }

    /// <summary>Erreurs d'une règle (codes <see cref="ErreurRelance"/>, sans doublon, dans l'ordre des contrôles).</summary>
    public static List<string> Controler(RegleRelance? regle, string nature)
    {
        var erreurs = new List<string>();
        void Ajouter(string code) { if (!erreurs.Contains(code)) erreurs.Add(code); }
        var niveaux = regle?.Niveaux ?? [];
        if (niveaux.Count == 0) Ajouter(ErreurRelance.RegleSansNiveau);
        if (niveaux.Count > NiveauxMax) Ajouter(ErreurRelance.RegleTropDeNiveaux);
        var modes = ModeRelance.Tous.Where(m => m != ModeRelance.Tache || nature == NatureRelance.Devis).ToList();
        for (var i = 0; i < niveaux.Count; i++)
        {
            var n = niveaux[i];
            if (n.Rang != i + 1) Ajouter(ErreurRelance.NiveauRang);
            if (n.Delai < 1 || (i > 0 && n.Delai <= niveaux[i - 1].Delai)) Ajouter(ErreurRelance.NiveauDelai);
            if (!modes.Contains(n.Mode)) Ajouter(ErreurRelance.NiveauMode);
        }
        if (regle is { Repeter: true } && regle.Intervalle is not >= 1) Ajouter(ErreurRelance.RegleIntervalle);
        return erreurs;
    }

    /// <summary>Niveau atteint à une date depuis un départ, ou null avant le premier niveau.</summary>
    public static NiveauAtteint? Niveau(RegleRelance regle, DateOnly depart, DateOnly date)
    {
        var niveaux = regle.Niveaux.OrderBy(n => n.Rang).ToList();
        var jours = date.DayNumber - depart.DayNumber;
        var atteint = niveaux.LastOrDefault(n => n.Delai <= jours);
        if (atteint is null) return null;
        var repetition = 0;
        if (regle.Repeter && regle.Intervalle is >= 1 && atteint == niveaux[^1])
            repetition = (jours - atteint.Delai) / regle.Intervalle.Value;
        return new NiveauAtteint(atteint.Rang, repetition, depart.AddDays(atteint.Delai + repetition * (regle.Intervalle ?? 0)), jours);
    }

    private static int ParDate(EcheanceRelance a, EcheanceRelance b) =>
        (a.Date ?? DateOnly.MaxValue).CompareTo(b.Date ?? DateOnly.MaxValue) is var c and not 0 ? c : a.Id.CompareTo(b.Id);

    /// <summary>Relance due d'une pièce à une date, ou null.</summary>
    public static RelanceDue? Due(RegleRelance? regle, PieceRelance piece, DateOnly date, decimal seuil = 0)
    {
        if (regle is null || piece.Arretee) return null;
        if (piece.SuspendueJusquAu is { } s && date <= s) return null;
        DateOnly? depart;
        decimal montant;
        List<long> echues = [];
        List<EcheanceFuture> futures = [];
        if (piece.Nature == NatureRelance.Facture)
        {
            var ouvertes = (piece.Echeances ?? []).Where(e => e.Reste > seuil).ToList();
            bool Echue(EcheanceRelance e) => e.Date is { } d && d < date;
            var liste = ouvertes.Where(Echue).ToList();
            liste.Sort(ParDate);
            depart = liste.Count > 0 ? liste[0].Date : null;
            montant = liste.Sum(e => e.Reste);
            echues = liste.Select(e => e.Id).ToList();
            var aVenir = ouvertes.Where(e => !Echue(e)).ToList();
            aVenir.Sort(ParDate);
            futures = aVenir.Select(e => new EcheanceFuture(e.Id, e.Date, e.Reste, e.Retenue)).ToList();
        }
        else
        {
            depart = piece.Depart;
            montant = piece.Montant;
        }
        if (depart is not { } dep) return null;
        var n = Niveau(regle, dep, date);
        if (n is null) return null;
        if (piece.Derniere is { } d2 && (d2.Niveau > n.Rang || (d2.Niveau == n.Rang && (n.Repetition == 0 || d2.Date >= n.Palier)))) return null;
        var niveau = regle.Niveaux.First(x => x.Rang == n.Rang);
        return new RelanceDue(piece.Id, piece.Nature, piece.Tiers, piece.Charge, n.Rang, n.Repetition, niveau.Mode,
            niveau.ModeleCourriel, niveau.ModeleEdition, dep, n.Palier, n.Jours, montant, echues, futures);
    }

    /// <summary>Relances dues des pièces à une date (règle propre de la pièce, sinon règle de sa nature).</summary>
    public static List<RelanceDue> Dues(IReadOnlyDictionary<string, RegleRelance> regles, IEnumerable<PieceRelance> pieces, DateOnly date, decimal seuil = 0) =>
        pieces.Select(p => Due(p.Regle ?? regles.GetValueOrDefault(p.Nature), p, date, seuil)).OfType<RelanceDue>().ToList();

    /// <summary>
    /// Regroupement par tiers, chargé, nature et mode (ordre de première apparition) : niveau le plus élevé et ses modèles
    /// (première pièce à ce niveau), jours le plus grand, montant total ; chaque pièce garde son niveau.
    /// </summary>
    public static List<GroupeRelance> Regrouper(IEnumerable<RelanceDue> dues)
    {
        var ordre = new List<(long, long?, string, string)>();
        var groupes = new Dictionary<(long, long?, string, string), (GroupeRelance G, List<PieceGroupe> P)>();
        foreach (var r in dues)
        {
            var cle = (r.Tiers, r.Charge, r.Nature, r.Mode);
            if (!groupes.TryGetValue(cle, out var g))
            {
                g = (new GroupeRelance(r.Tiers, r.Charge, r.Nature, r.Mode, 0, null, null, 0, 0, []), []);
                ordre.Add(cle);
            }
            var groupe = g.G;
            if (r.Niveau > groupe.Niveau) groupe = groupe with { Niveau = r.Niveau, ModeleCourriel = r.ModeleCourriel, ModeleEdition = r.ModeleEdition };
            groupe = groupe with { Jours = Math.Max(groupe.Jours, r.Jours), Montant = groupe.Montant + r.Montant };
            g.P.Add(new PieceGroupe(r.Id, r.Niveau, r.Repetition, r.Jours, r.Montant));
            groupes[cle] = (groupe, g.P);
        }
        return ordre.Select(c => groupes[c].G with { Pieces = groupes[c].P }).ToList();
    }
}
