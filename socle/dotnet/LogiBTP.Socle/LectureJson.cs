using System.Text.Json;

namespace LogiBTP.Socle;

/// <summary>Lecture des propriétés d'un objet JSON reçu (saisies, instantanés JSONB, réponses d'API).</summary>
public static class LectureJson
{
    /// <summary>Texte de la propriété tel quel (null : pas un objet, propriété absente ou qui n'est pas un texte).</summary>
    public static string? Texte(JsonElement e, string nom) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nom, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Texte de la propriété sans les espaces de bord, null s'il est vide.</summary>
    public static string? TexteNonVide(JsonElement e, string nom) =>
        Texte(e, nom)?.Trim() is { Length: > 0 } s ? s : null;
}
