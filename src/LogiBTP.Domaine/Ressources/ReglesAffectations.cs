namespace LogiBTP.Domaine.Ressources;

/// <summary>
/// Affectation d'un matériel : type (SALARIE, INTERIM, SOUS_TRAITANT, MATERIEL), identifiant, période, état du matériel au
/// retour, retour exigé (false : affectation terminée avant la règle, reprise de db/248).
/// </summary>
public sealed record AffectationMateriel(string Type, string? Id, DateOnly? Du, DateOnly? Au, string? Retour = null, bool RetourRequis = true);

/// <summary>Erreur d'une saisie d'affectations : code, affectation en cause (indice dans la saisie).</summary>
public sealed record ErreurAffectation(string Code, int Affectation);

/// <summary>
/// Affectations d'un matériel (lot 5b des demandes du 25/10/2026), répliquées dans
/// client/src/app/ressources/affectations.js (jeu tests/ressources/04_affectations.json) : affectation datée (fin
/// facultative = en cours) à un salarié, un intérimaire, un sous-traitant ou un autre matériel (porteur) ; une seule à
/// la fois (la seconde de deux périodes qui se chevauchent est signalée) ; matériel identifié : une affectation terminée
/// porte l'état du matériel au retour.
/// </summary>
public static class ReglesAffectations
{
    public static readonly string[] Types = [TypesRessource.Salarie, TypesRessource.Interim, TypesRessource.SousTraitant, TypesRessource.Materiel];

    private static bool DatesValables(AffectationMateriel a) => a.Du is { } du && (a.Au is not { } au || au >= du);

    public static List<ErreurAffectation> Controler(string materiel, IReadOnlyList<AffectationMateriel> affectations, bool identifie = false)
    {
        var r = new List<ErreurAffectation>();
        for (var i = 0; i < affectations.Count; i++)
        {
            var a = affectations[i];
            if (!Types.Contains(a.Type)) r.Add(new("AFF_TYPE", i));
            if (string.IsNullOrWhiteSpace(a.Id)) r.Add(new("AFF_CIBLE", i));
            if (!DatesValables(a)) r.Add(new("AFF_DATE", i));
            if (a.Type == TypesRessource.Materiel && a.Id == materiel) r.Add(new("AFF_SOI", i));
            // Chevauchement avec une affectation précédente (dates valables des deux côtés).
            var chevauche = DatesValables(a) && affectations.Take(i).Any(b => DatesValables(b)
                && a.Du!.Value <= (b.Au ?? DateOnly.MaxValue) && b.Du!.Value <= (a.Au ?? DateOnly.MaxValue));
            if (chevauche) r.Add(new("AFF_CHEVAUCHEMENT", i));
            if (identifie && a.Au is not null && string.IsNullOrWhiteSpace(a.Retour) && a.RetourRequis) r.Add(new("AFF_RETOUR", i));
        }
        return [.. r.OrderBy(e => e.Affectation).ThenBy(e => e.Code, StringComparer.Ordinal)];
    }

    /// <summary>Indice de l'affectation qui couvre la date, null sinon.</summary>
    public static int? A(IReadOnlyList<AffectationMateriel> affectations, DateOnly date)
    {
        for (var i = 0; i < affectations.Count; i++)
        {
            var a = affectations[i];
            if (a.Du is { } du && du <= date && (a.Au is not { } au || au >= date)) return i;
        }
        return null;
    }

    /// <summary>
    /// Vrai si affecter le matériel <paramref name="materiel"/> au porteur <paramref name="porteur"/> crée une boucle :
    /// le porteur est, directement ou par ses propres porteurs, porté par le matériel (porteurs : matériel → porteur).
    /// </summary>
    public static bool Boucle(IReadOnlyDictionary<string, string> porteurs, string materiel, string porteur)
    {
        var vus = new HashSet<string>();
        for (var p = porteur; p is not null && vus.Add(p); p = porteurs.GetValueOrDefault(p))
        {
            if (p == materiel) return true;
        }
        return false;
    }
}
