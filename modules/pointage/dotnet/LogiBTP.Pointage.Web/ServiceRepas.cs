using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Pointage.Web;

public class RepasEntite
{
    public long PrpId { get; set; }
    public int PrpSalId { get; set; }
    public DateOnly PrpDate { get; set; }
    public long? PrpRestaurantId { get; set; }
    public string PrpRestaurantLibelle { get; set; } = "";
    public int? PrpChaId { get; set; }
    public string? PrpCommentaire { get; set; }
    public string? PrpAppareil { get; set; }
    public string PrpPar { get; set; } = "";
    public DateTimeOffset PrpLe { get; set; }
}

/// <summary>Restaurant proposé (application : tiers de relation RESTAURANT) ; distance au chantier en km si connue.</summary>
public sealed record RestaurantPointage(long Id, string Nom, string? Ville, decimal? DistanceKm, bool Provisoire = false);

/// <summary>
/// Repas d'un jour : restaurant connu, ou nouveau restaurant « non trouvé » (nom, ville : créé par l'application) ;
/// ni l'un ni l'autre = pas de repas (retiré).
/// </summary>
public sealed record RepasSaisi(DateOnly Date, long? RestaurantId, string? Nouveau = null, string? Ville = null, int? ChaId = null, string? Commentaire = null);

public sealed record RepasDto(DateOnly Date, long? RestaurantId, string Restaurant, int? ChaId, string? Commentaire, string Par, DateTimeOffset Le);

/// <summary>
/// Repas au restaurant (lot 10 des demandes du 25/10/2026, A29) : un par salarié et par jour, saisi au bureau (droit de
/// saisie du salarié) ou à la borne ; jour validé refusé (409 POI_VALIDE) ; restaurants proposés par l'application,
/// triés par distance au chantier du jour. Lus par la règle de paie REPAS (ServicePaie).
/// </summary>
public sealed class ServiceRepas(PointageDbContext db, SpecialisationPointage specialisation, ServicePointage pointage)
{
    public async Task<List<RepasDto>> RepasAsync(int salarie, DateOnly du, DateOnly au, Utilisateur u, CancellationToken ct)
    {
        await pointage.SalarieAsync(salarie, u, ct);
        return await LireAsync(salarie, du, au, ct);
    }

    internal Task<List<RepasDto>> LireAsync(int salarie, DateOnly du, DateOnly au, CancellationToken ct) =>
        db.Repas.AsNoTracking().Where(r => r.PrpSalId == salarie && r.PrpDate >= du && r.PrpDate <= au).OrderBy(r => r.PrpDate)
            .Select(r => new RepasDto(r.PrpDate, r.PrpRestaurantId, r.PrpRestaurantLibelle, r.PrpChaId, r.PrpCommentaire, r.PrpPar, r.PrpLe)).ToListAsync(ct);

    /// <summary>Restaurants proposés pour un chantier (les plus proches d'abord), filtrés par une recherche.</summary>
    public Task<List<RestaurantPointage>> RestaurantsAsync(int? chantier, string? recherche, CancellationToken ct) =>
        specialisation.RestaurantsAsync(db, chantier, recherche, ct);

    public async Task<List<RepasDto>> EnregistrerAsync(int salarie, RepasSaisi s, Utilisateur u, CancellationToken ct) =>
        await EnregistrerAsync(await pointage.SalarieAsync(salarie, u, ct), s, u, null, ct);

    internal async Task<List<RepasDto>> EnregistrerAsync(SalariePointage salarie, RepasSaisi s, Utilisateur auteur, string? appareil, CancellationToken ct)
    {
        var lundi = ReglesPointage.LundiDe(s.Date);
        var p0 = await pointage.ParametresAsync(ct);
        var etat = (await pointage.EtatsAsync([salarie.Id], lundi, p0.Validation, ct))[salarie.Id][s.Date.DayNumber - lundi.DayNumber];
        if (ReglesValidation.EstBloque(etat))
            throw ExceptionMetier.Conflit(ErreursPointage.PoiValide, "Jour déjà validé : envoyer une demande de correction au service RH", new { dates = new[] { s.Date } });
        var existant = await db.Repas.FirstOrDefaultAsync(r => r.PrpSalId == salarie.Id && r.PrpDate == s.Date, ct);
        RestaurantPointage? restaurant = null;
        if (!string.IsNullOrWhiteSpace(s.Nouveau))
            restaurant = await specialisation.CreerRestaurantAsync(db, s.Nouveau.Trim(), string.IsNullOrWhiteSpace(s.Ville) ? null : s.Ville.Trim(), auteur, ct);
        else if (s.RestaurantId is long id)
            restaurant = (await specialisation.RestaurantsAsync(db, null, null, ct, [id])).FirstOrDefault() ?? throw ExceptionMetier.Introuvable($"Restaurant {id}");
        if (restaurant is null)
        {
            if (existant is not null) db.Repas.Remove(existant);
        }
        else
        {
            if (existant is null) db.Repas.Add(existant = new RepasEntite { PrpSalId = salarie.Id, PrpDate = s.Date });
            existant.PrpRestaurantId = restaurant.Id;
            existant.PrpRestaurantLibelle = restaurant.Nom.Length > 150 ? restaurant.Nom[..150] : restaurant.Nom;
            existant.PrpChaId = s.ChaId;
            existant.PrpCommentaire = string.IsNullOrWhiteSpace(s.Commentaire) ? null : s.Commentaire.Trim();
            existant.PrpAppareil = appareil;
            existant.PrpPar = auteur.Code;
            existant.PrpLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        return await LireAsync(salarie.Id, lundi, lundi.AddDays(6), ct);
    }
}
