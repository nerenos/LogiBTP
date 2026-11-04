using LogiBTP.Domaine;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Géocodage des adresses (lot 10 des demandes du 25/10/2026, A29) par l'API Adresse (section Geocodage : Adresse,
/// défaut https://api-adresse.data.gouv.fr/search/ — la Géoplateforme répond au même format —, Actif, ScoreMin 0,4).
/// Une adresse de chantier ou de coordonnée est géocodée à l'enregistrement de la fiche (chantier, restaurant :
/// <c>SpecialisationFicheBtp.ApresEcritureAsync</c>), sinon quand on en a besoin, si son texte diffère de l'adresse déjà
/// géocodée (un échec n'est pas retenté pour la même adresse) ; l'API injoignable ne bloque rien.
/// </summary>
public sealed class Geocodage(HttpClient client, IConfiguration configuration, ILogger<Geocodage> journal)
{
    public const string AdresseParDefaut = "https://api-adresse.data.gouv.fr/search/";

    private bool Actif => configuration.GetValue("Geocodage:Actif", true);
    private decimal ScoreMin => configuration.GetValue("Geocodage:ScoreMin", 0.4m);
    private string Adresse => configuration["Geocodage:Adresse"] is { Length: > 0 } a ? a : AdresseParDefaut;

    /// <summary>Position d'une adresse ; null si le géocodage est inactif, sans réponse sûre ou en échec (journalisé).</summary>
    public async Task<PositionGeo?> GeocoderAsync(string texte, CancellationToken ct)
    {
        if (!Actif) return null;
        try
        {
            var sep = Adresse.Contains('?') ? "&" : "?";
            using var r = await client.GetAsync($"{Adresse}{sep}{Geographie.Requete(texte)}", ct);
            if (!r.IsSuccessStatusCode) { journal.LogWarning("Géocodage : réponse {Statut}", (int)r.StatusCode); return null; }
            return Geographie.LireReponse(await r.Content.ReadAsStringAsync(ct), ScoreMin);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            journal.LogWarning("Géocodage indisponible : {Message}", e.Message);
            return null;
        }
    }

    private sealed record ChantierGeo(string? Adresse, string? CodePostal, string? Ville, decimal? Latitude, decimal? Longitude, string? GeocodeAdresse);

    /// <summary>Position d'un chantier (géocodée si son adresse a changé) ; null sans adresse ou sans réponse.</summary>
    public async Task<(decimal Lat, decimal Lon)?> ChantierAsync(DbContext db, int chantier, CancellationToken ct)
    {
        var c = await db.Database.SqlQueryRaw<ChantierGeo>("""
            SELECT cha_adresse AS adresse, cha_code_postal AS code_postal, cha_ville AS ville, cha_latitude AS latitude, cha_longitude AS longitude,
                   cha_geocode_adresse AS geocode_adresse
            FROM chantier WHERE cha_id = @id
            """, new NpgsqlParameter("id", chantier)).FirstOrDefaultAsync(ct);
        if (c is null) return null;
        var texte = Geographie.TexteAdresse(c.Adresse, c.CodePostal, c.Ville);
        if (texte is not null && texte != c.GeocodeAdresse)
        {
            var p = await GeocoderAsync(texte, ct);
            if (p is null && !Actif) return null;
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE chantier SET cha_latitude = @lat, cha_longitude = @lon, cha_geocode_score = @score, cha_geocode_adresse = @t WHERE cha_id = @id
                """, [SqlBtp.P("lat", p?.Latitude, NpgsqlTypes.NpgsqlDbType.Numeric), SqlBtp.P("lon", p?.Longitude, NpgsqlTypes.NpgsqlDbType.Numeric), SqlBtp.P("score", p?.Score, NpgsqlTypes.NpgsqlDbType.Numeric), new NpgsqlParameter("t", texte), new NpgsqlParameter("id", chantier)], ct);
            return p is null ? null : (p.Latitude, p.Longitude);
        }
        return texte is not null && c.Latitude is { } lat && c.Longitude is { } lon ? (lat, lon) : null;
    }

    /// <summary>Coordonnée (adresse) à géocoder : identifiant et texte actuel de l'adresse.</summary>
    public sealed record AdresseAGeocoder(long CooId, string Texte);

    /// <summary>Géocode des adresses de coordonnées (au plus <paramref name="max"/>) ; renvoie les positions obtenues.</summary>
    public async Task<Dictionary<long, PositionGeo>> CoordonneesAsync(DbContext db, IEnumerable<AdresseAGeocoder> adresses, int max, CancellationToken ct)
    {
        var r = new Dictionary<long, PositionGeo>();
        if (!Actif) return r;
        foreach (var a in adresses.Take(max))
        {
            var p = await GeocoderAsync(a.Texte, ct);
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE coordonnee SET coo_latitude = @lat, coo_longitude = @lon, coo_geocode_score = @score, coo_geocode_adresse = @t WHERE coo_id = @id
                """, [SqlBtp.P("lat", p?.Latitude, NpgsqlTypes.NpgsqlDbType.Numeric), SqlBtp.P("lon", p?.Longitude, NpgsqlTypes.NpgsqlDbType.Numeric), SqlBtp.P("score", p?.Score, NpgsqlTypes.NpgsqlDbType.Numeric), new NpgsqlParameter("t", a.Texte), new NpgsqlParameter("id", a.CooId)], ct);
            if (p is not null) r[a.CooId] = p;
        }
        return r;
    }

    private sealed record AdressePersonne(long CooId, string? Ligne1, string? Ligne2, string? Ligne3, string? CodePostal, string? Ville, string? GeocodeAdresse);

    /// <summary>Adresses d'une personne de relation RESTAURANT dont le texte a changé depuis le dernier géocodage.</summary>
    public async Task RestaurantAsync(DbContext db, long personne, CancellationToken ct)
    {
        if (!Actif) return;
        var l = await db.Database.SqlQueryRaw<AdressePersonne>("""
            SELECT c.coo_id, c.coo_ligne1 AS ligne1, c.coo_ligne2 AS ligne2, c.coo_ligne3 AS ligne3, c.coo_code_postal AS code_postal,
                   c.coo_ville AS ville, c.coo_geocode_adresse AS geocode_adresse
            FROM personne p JOIN usage_coordonnee u ON u.uco_per_id = p.per_id JOIN coordonnee c ON c.coo_id = u.uco_coo_id
            WHERE p.per_id = @p AND p.per_casquettes ? 'RESTAURANT' AND c.coo_nature = 'ADRESSE'
            """, new NpgsqlParameter("p", personne)).ToListAsync(ct);
        var aFaire = l.Select(x => (x.CooId, t: Geographie.TexteAdresse(x.Ligne1, x.Ligne2, x.Ligne3, x.CodePostal, x.Ville), x.GeocodeAdresse))
            .Where(x => x.t is not null && x.t != x.GeocodeAdresse).Select(x => new AdresseAGeocoder(x.CooId, x.t!)).ToList();
        if (aFaire.Count > 0) await CoordonneesAsync(db, aFaire, 5, ct);
    }
}
