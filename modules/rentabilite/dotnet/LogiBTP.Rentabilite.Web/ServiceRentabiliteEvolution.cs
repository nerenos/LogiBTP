using LogiBTP.Socle.Web;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Point de l'évolution d'un chantier : une photo (faits connus à son calcul, datés jusqu'à sa date) ou aujourd'hui (faits ouverts).</summary>
public sealed record PointEvolution(DateOnly Date, string? Type, string? Libelle, long? PhotoId, IReadOnlyList<AgregatFaits> Agregats);

/// <summary>Évolution d'un chantier pour les graphiques (§ 10.3) : points datés du plus ancien au plus récent ; coûts seulement avec le droit.</summary>
public sealed record EvolutionChantier(ChantierRentabilite Chantier, bool VoirCouts, IReadOnlyList<PointEvolution> Points);

/// <summary>Graphiques (ANALYSE-MODULE-ANALYSE.md § 10.3, lot 8) : agrégats de chaque photo, puis d'aujourd'hui.</summary>
public partial class ServiceRentabilite
{
    /// <summary>
    /// Agrégats d'un chantier à chaque photo (mensuelle ou à la demande ; deux photos du même jour : la plus récente),
    /// tels qu'ils étaient connus alors, puis aujourd'hui : le client en tire budget, facturé, dépensé, coût et marge à
    /// terminaison. Jamais recalculé : une pièce saisie en retard ne change pas une photo passée.
    /// </summary>
    public async Task<EvolutionChantier> EvolutionAsync(IServiceProvider services, Utilisateur u, int chantier, CancellationToken ct)
    {
        var (c, p) = await AccesAsync(services, u, chantier, ct);
        var photos = (await PhotosAsync(chantier, ct)).GroupBy(x => x.Date).Select(g => g.First()).OrderBy(x => x.Date).ToList();
        var points = new List<PointEvolution>();
        foreach (var ph in photos.Where(x => x.Date < Aujourdhui))
            points.Add(new(ph.Date, ph.Type, ph.Libelle, ph.Id, await AgregatsAsync(chantier, null, ph.Date, ph.CalculId, ct)));
        points.Add(new(Aujourdhui, null, null, null, await AgregatsAsync(chantier, null, null, null, ct)));
        if (!p.VoirCouts) points = points.Select(x => x with { Agregats = x.Agregats.Select(SansCouts).ToList() }).ToList();
        return new EvolutionChantier(c, p.VoirCouts, points);
    }
}
