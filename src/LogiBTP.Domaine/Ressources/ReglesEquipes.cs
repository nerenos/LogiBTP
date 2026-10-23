namespace LogiBTP.Domaine.Ressources;

/// <summary>Membre d'une équipe dans une période : type (SALARIE, INTERIM, MATERIEL, SOUS_TRAITANT, EQUIPE), identifiant, chef.</summary>
public sealed record MembreEquipe(string Type, string Id, bool Chef);

/// <summary>Période d'une équipe : début, fin (nulle : ouverte), membres.</summary>
public sealed record PeriodeEquipe(DateOnly? Du, DateOnly? Au, List<MembreEquipe> Membres);

/// <summary>Ligne de composition (une par membre et par période continue, table equipe_composition).</summary>
public sealed record LigneComposition(string Type, string Id, DateOnly Du, DateOnly? Au, bool Chef);

/// <summary>Erreur d'une équipe saisie : code, période en cause (indice dans la saisie, nul pour l'équipe).</summary>
public sealed record ErreurEquipe(string Code, int? Periode);

/// <summary>
/// Compositions des équipes, répliquées dans client/src/app/ressources/equipes.js (jeu tests/ressources/03_equipes.json) :
/// lignes ↔ périodes, contrôle d'une saisie. Comparaisons ordinales, identifiants numériques comparés en nombres.
/// </summary>
public static class ReglesEquipes
{
    public static readonly string[] TypesMembre = ["SALARIE", "INTERIM", "MATERIEL", "SOUS_TRAITANT", "EQUIPE"];
    public static readonly string[] TypesChef = ["SALARIE", "INTERIM"];

    private static int CompId(string a, string b) =>
        long.TryParse(a, out var x) && long.TryParse(b, out var y) && a.All(char.IsAsciiDigit) && b.All(char.IsAsciiDigit) ? x.CompareTo(y) : string.CompareOrdinal(a, b);

    private static List<MembreEquipe> Trier(IEnumerable<MembreEquipe> l) =>
        [.. l.Order(Comparer<MembreEquipe>.Create((a, b) =>
        {
            var c = b.Chef.CompareTo(a.Chef);
            if (c == 0) c = string.CompareOrdinal(a.Type, b.Type);
            return c != 0 ? c : CompId(a.Id, b.Id);
        }))];

    /// <summary>Une période par intervalle entre deux changements (entrée, sortie, chef) ; intervalles sans membre omis.</summary>
    public static List<PeriodeEquipe> Periodes(IReadOnlyCollection<LigneComposition> lignes)
    {
        var bornes = lignes.SelectMany(l => l.Au is DateOnly au ? new[] { l.Du, au.AddDays(1) } : [l.Du]).Distinct().Order().ToList();
        var r = new List<PeriodeEquipe>();
        for (var i = 0; i < bornes.Count; i++)
        {
            var du = bornes[i];
            DateOnly? au = i + 1 < bornes.Count ? bornes[i + 1].AddDays(-1) : null;
            var membres = lignes.Where(l => l.Du <= du && (l.Au is null || l.Au >= du)).Select(l => new MembreEquipe(l.Type, l.Id, l.Chef)).ToList();
            if (membres.Count > 0) r.Add(new PeriodeEquipe(du, au, Trier(membres)));
        }
        return r;
    }

    /// <summary>Un membre présent dans des périodes contiguës avec le même rôle fait une seule ligne ; tri par type, identifiant, début.</summary>
    public static List<LigneComposition> Lignes(IEnumerable<PeriodeEquipe> periodes)
    {
        var ouvertes = new Dictionary<string, int>();
        var r = new List<LigneComposition>();
        foreach (var p in periodes.Where(p => p.Du is not null).OrderBy(p => p.Du))
        {
            foreach (var m in p.Membres)
            {
                var k = $"{m.Type}:{m.Id}|{(m.Chef ? 1 : 0)}";
                if (ouvertes.TryGetValue(k, out var i) && r[i].Au is DateOnly au && au.AddDays(1) == p.Du) r[i] = r[i] with { Au = p.Au };
                else
                {
                    ouvertes[k] = r.Count;
                    r.Add(new LigneComposition(m.Type, m.Id, p.Du!.Value, p.Au, m.Chef));
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
        for (var i = 0; i < periodes.Count; i++)
        {
            var p = periodes[i];
            if (p.Du is null || (p.Au is DateOnly au && au < p.Du)) r.Add(new("EQU_PERIODE", i));
            var cles = p.Membres.Select(m => $"{m.Type}:{m.Id}").ToList();
            if (p.Membres.Any(m => !TypesMembre.Contains(m.Type))) r.Add(new("EQU_TYPE", i));
            if (cles.Distinct().Count() != cles.Count) r.Add(new("EQU_DOUBLON", i));
            if (id is int e && p.Membres.Any(m => m.Type == "EQUIPE" && m.Id == e.ToString(System.Globalization.CultureInfo.InvariantCulture))) r.Add(new("EQU_SOI", i));
            if (p.Membres.Any(m => m.Chef && !TypesChef.Contains(m.Type))) r.Add(new("EQU_CHEF_TYPE", i));
            if (p.Membres.Count(m => m.Chef) > 1) r.Add(new("EQU_CHEFS", i));
        }
        var triees = periodes.Select((p, i) => (p, i)).Where(x => x.p.Du is not null).OrderBy(x => x.p.Du).ToList();
        for (var k = 1; k < triees.Count; k++)
        {
            var prec = triees[k - 1].p;
            if (prec.Au is null || prec.Au >= triees[k].p.Du) r.Add(new("EQU_CHEVAUCHEMENT", triees[k].i));
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
