using System.Text.Json;
using System.Text.Json.Serialization;

namespace LogiBTP.Socle;

/// <summary>Options JSON communes : noms de colonnes snake_case, décimaux acceptés en chaîne.</summary>
public static class JsonCalcul
{
    public static readonly JsonSerializerOptions Options = Creer();

    public static JsonSerializerOptions Creer() => new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DictionaryKeyPolicy = null,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    /// <summary>Copie profonde par sérialisation (le type concret est conservé).</summary>
    public static T Cloner<T>(T valeur) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.SerializeToUtf8Bytes(valeur, Options), Options)!;
}
