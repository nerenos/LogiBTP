namespace LogiBTP.Annuaire;

public sealed record NiveauGraphe(string Code, int Ordre, string? Icone);
public sealed record TypeLienGraphe(string Code, string Libelle);
public sealed record PersonneGraphe(long Id, long? ParentId, string Niveau, string RaisonSociale, List<string> Casquettes, bool Actif, string? Ville);
public sealed record IndividuGraphe(long Id, string Libelle, bool Actif);
public sealed record RattachementGraphe(long Id, long PerId, long IndId, string? Fonction, bool Principal, bool Actif);
public sealed record LienGraphe(long Id, long PerId, long CibleId, string TliCode);

/// <summary>Données du graphe : référentiels, personnes, individus, rattachements et liens.</summary>
public sealed record DonneesGraphe(List<NiveauGraphe> Niveaux, List<TypeLienGraphe> TypesLien, List<PersonneGraphe> Personnes, List<IndividuGraphe> Individus,
    List<RattachementGraphe> Rattachements, List<LienGraphe> Liens);

public sealed record OptionsGraphe(int Profondeur = 1, bool Contacts = true, bool Liens = true, int MaxContacts = 8);

public sealed record NoeudGraphe(string Cle, string Type, long Id, string Libelle, string? Niveau, int Ordre, string? Icone, List<string> Casquettes, bool Actif,
    string? SousTitre, int Distance, bool Depart, int? Reste);

public sealed record AreteGraphe(string Cle, string De, string Vers, string Type, string? Libelle, bool Actif);

public sealed record Graphe(List<NoeudGraphe> Noeuds, List<AreteGraphe> Aretes);

/// <summary>
/// Graphe relationnel de l'annuaire autour d'une fiche. Réplique de construireGraphe (modules/annuaire/js/src/graphe.js,
/// jeu partagé 03_graphe.json) : parcours en largeur par la hiérarchie, les liens typés et les rattachements, niveaux
/// supérieurs de la fiche de départ toujours présents, contacts au-delà du maximum résumés par un nœud G.
/// </summary>
public static class GrapheAnnuaire
{
    public const int ProfondeurMax = 5;
    public const int OrdreIndividu = 1000;

    public static Graphe Construire(DonneesGraphe d, string type, long id, OptionsGraphe o)
    {
        var prof = Math.Clamp(o.Profondeur, 1, ProfondeurMax);
        var personnes = d.Personnes.ToDictionary(p => p.Id);
        var individus = d.Individus.ToDictionary(i => i.Id);
        var niveaux = d.Niveaux.ToDictionary(n => n.Code);
        var types = d.TypesLien.ToDictionary(t => t.Code);
        var enfants = d.Personnes.Where(p => p.ParentId is not null).GroupBy(p => p.ParentId!.Value).ToDictionary(g => g.Key, g => g.Select(p => p.Id).OrderBy(x => x).ToList());
        var ratsPersonne = d.Rattachements.GroupBy(r => r.PerId).ToDictionary(g => g.Key,
            g => g.OrderByDescending(r => r.Actif).ThenByDescending(r => r.Principal).ThenBy(r => r.Id).ToList());
        var ratsIndividu = d.Rattachements.GroupBy(r => r.IndId).ToDictionary(g => g.Key, g => g.OrderBy(r => r.Id).ToList());
        var liens = o.Liens ? d.Liens : [];
        var liensPar = liens.SelectMany(l => new[] { (Cle: l.PerId, l), (Cle: l.CibleId, l) }).GroupBy(x => x.Cle)
            .ToDictionary(g => g.Key, g => g.Select(x => x.l).OrderBy(l => l.Id).ToList());

        var distances = new Dictionary<string, int>();
        var ordreInsertion = new List<string>();
        var resumes = new Dictionary<long, int>();
        void Ajouter(string k, int dist) { distances[k] = dist; ordreInsertion.Add(k); }

        List<string> Voisins(string k)
        {
            var n = long.Parse(k[1..]);
            var v = new List<string>();
            if (k[0] == 'P')
            {
                var p = personnes[n];
                if (p.ParentId is { } parent && personnes.ContainsKey(parent)) v.Add($"P{parent}");
                foreach (var e in enfants.GetValueOrDefault(n, [])) v.Add($"P{e}");
                foreach (var l in liensPar.GetValueOrDefault(n, [])) v.Add($"P{(l.PerId == n ? l.CibleId : l.PerId)}");
                if (o.Contacts)
                {
                    var rats = ratsPersonne.GetValueOrDefault(n, []).Where(r => individus.ContainsKey(r.IndId)).ToList();
                    foreach (var r in rats.Take(o.MaxContacts)) v.Add($"I{r.IndId}");
                    if (rats.Count > o.MaxContacts) resumes[n] = rats.Count - o.MaxContacts;
                }
            }
            else if (o.Contacts)
            {
                foreach (var r in ratsIndividu.GetValueOrDefault(n, [])) if (personnes.ContainsKey(r.PerId)) v.Add($"P{r.PerId}");
            }
            return v;
        }

        var k0 = (type == "personne" ? "P" : "I") + id;
        if (type == "personne" ? !personnes.ContainsKey(id) : !individus.ContainsKey(id)) return new([], []);
        Ajouter(k0, 0);
        var frontiere = new List<string> { k0 };
        for (var dist = 1; dist <= prof && frontiere.Count > 0; dist++)
        {
            var suivante = new List<string>();
            foreach (var k in frontiere)
                foreach (var v in Voisins(k))
                {
                    if (distances.ContainsKey(v)) continue;
                    Ajouter(v, dist);
                    suivante.Add(v);
                }
            frontiere = suivante;
        }
        foreach (var r in resumes.Keys.ToList()) if (!(distances.TryGetValue($"P{r}", out var dr) && dr < prof)) resumes.Remove(r);

        void Remonter(long pid)
        {
            var vus = new HashSet<long>();
            for (var p = personnes.GetValueOrDefault(pid); p is { ParentId: { } parent } && vus.Add(p.Id); p = personnes.GetValueOrDefault(parent))
            {
                if (!personnes.ContainsKey(parent)) break;
                var k = $"P{parent}";
                if (!distances.ContainsKey(k)) Ajouter(k, distances.GetValueOrDefault($"P{p.Id}") + 1);
            }
        }
        if (type == "personne") Remonter(id);
        else foreach (var r in ratsIndividu.GetValueOrDefault(id, [])) if (distances.ContainsKey($"P{r.PerId}")) Remonter(r.PerId);

        var noeuds = new List<NoeudGraphe>();
        foreach (var k in ordreInsertion)
        {
            var n = long.Parse(k[1..]);
            var dist = distances[k];
            if (k[0] == 'P')
            {
                var p = personnes[n];
                var niv = niveaux.GetValueOrDefault(p.Niveau);
                noeuds.Add(new(k, "personne", n, p.RaisonSociale, p.Niveau, niv?.Ordre ?? 0, niv?.Icone, [.. p.Casquettes], p.Actif, p.Ville, dist, k == k0, null));
            }
            else
            {
                var i = individus[n];
                noeuds.Add(new(k, "individu", n, i.Libelle, null, OrdreIndividu, "👤", [], i.Actif, null, dist, k == k0, null));
            }
        }
        foreach (var (pid, reste) in resumes)
            noeuds.Add(new($"G{pid}", "groupe", pid, $"+ {reste} contact{(reste > 1 ? "s" : "")}", null, OrdreIndividu, "👥", [], true, null, distances[$"P{pid}"] + 1, false, reste));

        var presents = noeuds.Select(x => x.Cle).ToHashSet();
        var aretes = new List<AreteGraphe>();
        foreach (var p in d.Personnes.Where(p => p.ParentId is not null))
            if (presents.Contains($"P{p.ParentId}") && presents.Contains($"P{p.Id}")) aretes.Add(new($"H{p.Id}", $"P{p.ParentId}", $"P{p.Id}", "hierarchie", null, p.Actif));
        foreach (var l in liens)
            if (presents.Contains($"P{l.PerId}") && presents.Contains($"P{l.CibleId}"))
                aretes.Add(new($"L{l.Id}", $"P{l.PerId}", $"P{l.CibleId}", "lien", types.GetValueOrDefault(l.TliCode)?.Libelle ?? l.TliCode, true));
        if (o.Contacts)
            foreach (var r in d.Rattachements)
                if (presents.Contains($"P{r.PerId}") && presents.Contains($"I{r.IndId}")) aretes.Add(new($"R{r.Id}", $"P{r.PerId}", $"I{r.IndId}", "rattachement", r.Fonction, r.Actif));
        foreach (var pid in resumes.Keys) aretes.Add(new($"G{pid}", $"P{pid}", $"G{pid}", "groupe", null, true));

        long Rang(string k) => (k[0] switch { 'P' => 0L, 'I' => 1L, _ => 2L }) * 1_000_000_000L + long.Parse(k[1..]);
        return new(noeuds.OrderBy(x => x.Ordre).ThenBy(x => Rang(x.Cle)).ToList(), aretes.OrderBy(x => x.Cle, StringComparer.Ordinal).ToList());
    }
}
