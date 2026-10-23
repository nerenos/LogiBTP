namespace LogiBTP.Domaine.Ressources;

/// <summary>Membre d'une équipe dans une composition : type (SALARIE, INTERIM, MATERIEL, SOUS_TRAITANT, EQUIPE), identifiant, chef.</summary>
public sealed record MembreEquipe(string Type, string Id, bool Chef);

/// <summary>Composition saisie : début (la fin est la veille du début de la suivante), membres.</summary>
public sealed record PeriodeEquipe(DateOnly? Du, List<MembreEquipe> Membres);

/// <summary>Composition datée : début, fin déduite (nulle pour la dernière), membres.</summary>
public sealed record PeriodeDatee(DateOnly Du, DateOnly? Au, List<MembreEquipe> Membres);

/// <summary>Ligne de composition (une par membre et par suite continue de compositions, table equipe_composition).</summary>
public sealed record LigneComposition(string Type, string Id, DateOnly Du, DateOnly? Au, bool Chef);

/// <summary>Erreur d'une équipe saisie : code, composition en cause (indice dans la saisie, nul pour l'équipe).</summary>
public sealed record ErreurEquipe(string Code, int? Periode);

/// <summary>
/// Compositions des équipes, répliquées dans client/src/app/ressources/equipes.js (jeu tests/ressources/03_equipes.json) :
/// une composition est datée par son seul début et vaut jusqu'à la veille de la suivante ; lignes ↔ compositions,
/// contrôle d'une saisie. Comparaisons ordinales, identifiants numériques comparés en nombres.
/// </summary>
public static class ReglesEquipes
{
    public static readonly string[] TypesMembre = ["SALARIE", "INTERIM", "MATERIEL", "SOUS_TRAITANT", "EQUIPE"];
    public static readonly string[] TypesChef = ["SALARIE", "INTERIM"];

    private static int CompId(string a, string b) =>
        a.Length > 0 && b.Length > 0 && a.All(char.IsAsciiDigit) && b.All(char.IsAsciiDigit) && long.TryParse(a, out var x) && long.TryParse(b, out var y)
            ? x.CompareTo(y) : string.CompareOrdinal(a, b);

    private static List<MembreEquipe> Trier(IEnumerable<MembreEquipe> l) =>
        [.. l.Order(Comparer<MembreEquipe>.Create((a, b) =>
        {
            var c = b.Chef.CompareTo(a.Chef);
            if (c == 0) c = string.CompareOrdinal(a.Type, b.Type);
            return c != 0 ? c : CompId(a.Id, b.Id);
        }))];

    /// <summary>Compositions triées par début, chacune avec sa fin (veille du début de la suivante, la dernière : nulle).</summary>
    public static List<PeriodeDatee> Fins(IEnumerable<PeriodeEquipe> periodes)
    {
        var t = periodes.Where(p => p.Du is not null).OrderBy(p => p.Du).ToList();
        return t.Select((p, i) => new PeriodeDatee(p.Du!.Value, i + 1 < t.Count ? t[i + 1].Du!.Value.AddDays(-1) : null, p.Membres)).ToList();
    }

    /// <summary>Lignes et débuts des compositions → compositions datées (membres au début de chacune).</summary>
    public static List<PeriodeDatee> Periodes(IReadOnlyCollection<LigneComposition> lignes, IEnumerable<DateOnly> debuts)
    {
        var t = debuts.Distinct().Order().ToList();
        return t.Select((du, i) => new PeriodeDatee(du, i + 1 < t.Count ? t[i + 1].AddDays(-1) : null,
            Trier(lignes.Where(l => l.Du <= du && (l.Au is null || l.Au >= du)).Select(l => new MembreEquipe(l.Type, l.Id, l.Chef))))).ToList();
    }

    /// <summary>Un membre présent dans des compositions successives avec le même rôle fait une seule ligne ; tri par type, identifiant, début.</summary>
    public static List<LigneComposition> Lignes(IEnumerable<PeriodeEquipe> periodes)
    {
        var ouvertes = new Dictionary<string, int>();
        var r = new List<LigneComposition>();
        foreach (var p in Fins(periodes))
        {
            foreach (var m in p.Membres)
            {
                var k = $"{m.Type}:{m.Id}|{(m.Chef ? 1 : 0)}";
                if (ouvertes.TryGetValue(k, out var i) && r[i].Au is DateOnly au && au.AddDays(1) == p.Du) r[i] = r[i] with { Au = p.Au };
                else
                {
                    ouvertes[k] = r.Count;
                    r.Add(new LigneComposition(m.Type, m.Id, p.Du, p.Au, m.Chef));
                }
            }
        }
        return [.. r.Order(Comparer<LigneComposition>.Create((a, b) =>
        {
            var c = string.CompareOrdinal(a.Type, b.Type);
            if (c == 0) c = CompId(a.Id, b.Id);
            return c != 0 ? c : a.Du.CompareTo(b.Du);
        }))];
    }

    /// <summary>Contrôle d'une équipe saisie (id : identifiant de l'équipe, nul à la création), erreurs triées.</summary>
    public static List<ErreurEquipe> Controler(int? id, string? code, string? libelle, IReadOnlyList<PeriodeEquipe> periodes)
    {
        var r = new List<ErreurEquipe>();
        if (string.IsNullOrWhiteSpace(code)) r.Add(new("EQU_CODE", null));
        if (string.IsNullOrWhiteSpace(libelle)) r.Add(new("EQU_LIBELLE", null));
        var vus = new HashSet<DateOnly>();
        for (var i = 0; i < periodes.Count; i++)
        {
            var p = periodes[i];
            if (p.Du is not DateOnly du) r.Add(new("EQU_PERIODE", i));
            else if (!vus.Add(du)) r.Add(new("EQU_DATE_DOUBLE", i));
            var cles = p.Membres.Select(m => $"{m.Type}:{m.Id}").ToList();
            if (p.Membres.Any(m => !TypesMembre.Contains(m.Type))) r.Add(new("EQU_TYPE", i));
            if (cles.Distinct().Count() != cles.Count) r.Add(new("EQU_DOUBLON", i));
            if (id is int e && p.Membres.Any(m => m.Type == "EQUIPE" && m.Id == e.ToString(System.Globalization.CultureInfo.InvariantCulture))) r.Add(new("EQU_SOI", i));
            if (p.Membres.Any(m => m.Chef && !TypesChef.Contains(m.Type))) r.Add(new("EQU_CHEF_TYPE", i));
            if (p.Membres.Count(m => m.Chef) > 1) r.Add(new("EQU_CHEFS", i));
        }
        return [.. r.OrderBy(x => x.Periode ?? -1).ThenBy(x => x.Code, StringComparer.Ordinal)];
    }

    /// <summary>Vrai si l'équipe <paramref name="depart"/> contient, directement ou par ses sous-équipes, l'équipe <paramref name="cible"/>.</summary>
    public static bool Contient(IReadOnlyDictionary<int, HashSet<int>> sousEquipes, int depart, int cible)
    {
        var vues = new HashSet<int>();
        var pile = new Stack<int>([depart]);
        while (pile.Count > 0)
        {
            var e = pile.Pop();
            if (!vues.Add(e)) continue;
            foreach (var s in sousEquipes.GetValueOrDefault(e) ?? [])
            {
                if (s == cible) return true;
                pile.Push(s);
            }
        }
        return false;
    }
}
