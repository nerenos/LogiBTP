using System.Globalization;
using System.Text.Json;

namespace LogiBTP.Domaine;

/// <summary>Position géocodée : latitude, longitude (degrés décimaux), score de confiance du géocodage (0 à 1).</summary>
public sealed record PositionGeo(decimal Latitude, decimal Longitude, decimal Score);

/// <summary>
/// Géographie des adresses (lot 10 des demandes du 25/10/2026, A29 : restaurants proches du chantier) : texte d'adresse
/// envoyé au géocodage, lecture d'une réponse GeoJSON de l'API Adresse (ou de la Géoplateforme, même format), distance
/// à vol d'oiseau entre deux positions (formule de haversine, km arrondis au dixième).
/// </summary>
public static class Geographie
{
    private const double RayonTerreKm = 6371.0088;

    /// <summary>Parties non vides d'une adresse jointes par une virgule ; null si aucune (rien à géocoder).</summary>
    public static string? TexteAdresse(params string?[] parties)
    {
        var t = string.Join(", ", parties.Select(p => p?.Trim()).Where(p => !string.IsNullOrEmpty(p)));
        return t.Length == 0 ? null : t;
    }

    /// <summary>Première réponse d'un GeoJSON (features[0] : coordinates [lon, lat], properties.score) ; null si vide ou sous le score minimal.</summary>
    public static PositionGeo? LireReponse(string json, decimal scoreMin)
    {
        using var d = JsonDocument.Parse(json);
        if (!d.RootElement.TryGetProperty("features", out var f) || f.ValueKind != JsonValueKind.Array || f.GetArrayLength() == 0) return null;
        var premier = f[0];
        if (!premier.TryGetProperty("geometry", out var g) || !g.TryGetProperty("coordinates", out var c) || c.GetArrayLength() < 2) return null;
        var score = premier.TryGetProperty("properties", out var p) && p.TryGetProperty("score", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetDecimal() : 0m;
        if (score < scoreMin) return null;
        return new PositionGeo(Math.Round(c[1].GetDecimal(), 6), Math.Round(c[0].GetDecimal(), 6), Math.Round(score, 3));
    }

    /// <summary>Distance à vol d'oiseau en km, arrondie au dixième (demi vers l'infini).</summary>
    public static decimal DistanceKm(decimal lat1, decimal lon1, decimal lat2, decimal lon2)
    {
        static double Rad(decimal d) => (double)d * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var a = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Pow(Math.Sin(dLon / 2), 2);
        var km = 2 * RayonTerreKm * Math.Asin(Math.Min(1, Math.Sqrt(a)));
        return Math.Round((decimal)km, 1, MidpointRounding.AwayFromZero);
    }

    /// <summary>Paramètre de requête d'une adresse (encodé).</summary>
    public static string Requete(string texte, int limite = 1) =>
        $"q={Uri.EscapeDataString(texte)}&limit={limite.ToString(CultureInfo.InvariantCulture)}";
}
