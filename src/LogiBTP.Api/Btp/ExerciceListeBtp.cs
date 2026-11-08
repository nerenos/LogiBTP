using System.Globalization;
using System.Text.Json;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Début de l'exercice comptable fourni aux listes (période « exercice en cours » des filtres de date) : paramètre
/// <c>debut_exercice</c> du module Comptabilité (JSON : date AAAA-MM-JJ dont seuls le mois et le jour comptent) ;
/// absent ou invalide : aucun début, la liste prend l'année civile.
/// </summary>
public static class ExerciceListeBtp
{
    /// <summary>Clé du paramètre dans <c>parametre_comptabilite</c>.</summary>
    public const string CleParametre = "debut_exercice";

    public static DateOnly? Debut(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<string>(json) is { } t && DateOnly.TryParseExact(t, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
        }
        catch (JsonException) { return null; }
    }
}
