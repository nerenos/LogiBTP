namespace LogiBTP.Rentabilite;

/// <summary>Fait relu de la base avec son identifiant.</summary>
public sealed record FaitConnu(long Id, Fait Fait);

/// <summary>Différence entre les faits ouverts et un nouveau calcul.</summary>
/// <param name="Retraits">Identifiants des faits à clore.</param>
/// <param name="Ajouts">Faits à ouvrir.</param>
/// <param name="Modifies">Couples retrait / ajout de même identité (<see cref="Fait.Cle"/>) : un fait modifié.</param>
/// <param name="Inchanges">Faits gardés tels quels.</param>
public sealed record DifferenceFaits(IReadOnlyList<long> Retraits, IReadOnlyList<Fait> Ajouts, int Modifies, int Inchanges)
{
    public bool Vide => Retraits.Count == 0 && Ajouts.Count == 0;
}

/// <summary>
/// Comparaison de deux ensembles de faits (§ 10.4) : multiensembles comparés sur toutes les valeurs normalisées ; un fait
/// identique est gardé (jamais réécrit), un fait absent est clos, un fait nouveau est ouvert. Deux faits identiques
/// (même ligne ventilée deux fois à l'identique) se comptent un par un.
/// </summary>
public static class ComparaisonFaits
{
    public static DifferenceFaits Comparer(IEnumerable<FaitConnu> anciens, IEnumerable<Fait> nouveaux)
    {
        var restants = new Dictionary<Fait, Queue<long>>();
        foreach (var a in anciens)
        {
            var f = a.Fait.Normaliser();
            if (!restants.TryGetValue(f, out var q)) restants[f] = q = new Queue<long>();
            q.Enqueue(a.Id);
        }
        var ajouts = new List<Fait>();
        var inchanges = 0;
        foreach (var n in nouveaux.Select(x => x.Normaliser()))
        {
            if (restants.TryGetValue(n, out var q) && q.Count > 0) { q.Dequeue(); inchanges++; }
            else ajouts.Add(n);
        }
        var retraits = restants.SelectMany(x => x.Value.Select(id => (Id: id, x.Key.Cle))).ToList();
        // Fait modifié : une identité retirée et ajoutée autant de fois l'une que l'autre compte comme modifiée.
        var clesRetirees = retraits.GroupBy(r => r.Cle).ToDictionary(g => g.Key, g => g.Count());
        var modifies = ajouts.GroupBy(a => a.Cle).Sum(g => Math.Min(g.Count(), clesRetirees.GetValueOrDefault(g.Key)));
        return new DifferenceFaits(retraits.Select(r => r.Id).OrderBy(x => x).ToList(), ajouts, modifies, inchanges);
    }
}
