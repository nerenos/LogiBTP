using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LogiBTP.Fiches;

/// <summary>
/// Validation des champs d'une fiche : même sémantique que modules/fiche/js/src/validation.js (jeu partagé
/// modules/fiche/tests/cas/01_validation.json). Une valeur est un texte, un nombre, un booléen, une date ou un JsonElement.
/// </summary>
public static partial class ValidationFiche
{
    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["OBLIGATOIRE"] = "Saisie obligatoire",
        ["LONGUEUR"] = "Texte trop long",
        ["NOMBRE"] = "Nombre attendu",
        ["DATE"] = "Date invalide",
        ["LISTE"] = "Valeur non prévue dans la liste",
        ["BOOLEEN"] = "Oui ou non attendu",
        ["FORMAT"] = "Format incorrect",
    };

    [GeneratedRegex(@"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")]
    private static partial Regex Email();

    [GeneratedRegex(@"^0[1-9]\d{8}$")]
    private static partial Regex TelephoneFr();

    [GeneratedRegex(@"^\+\d{8,15}$")]
    private static partial Regex TelephoneInter();

    [GeneratedRegex(@"[\s.\-()]")]
    private static partial Regex SeparateursTelephone();

    [GeneratedRegex(@"^\d{5}$")]
    private static partial Regex CodePostal();

    [GeneratedRegex(@"^9+([.,]9+)?$")]
    private static partial Regex Masque();

    [GeneratedRegex(@"^[+-]?(\d+(\.\d*)?|\.\d+)$")]
    private static partial Regex NombreTexte();

    [GeneratedRegex(@"^(\d{4})-(\d{2})-(\d{2})")]
    private static partial Regex DateIso();

    /// <summary>Valeur JSON ou de base de données ramenée à texte, décimal, booléen ou null.</summary>
    public static object? Normaliser(object? v) => v switch
    {
        null or DBNull => null,
        JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
        JsonElement { ValueKind: JsonValueKind.String } j => j.GetString(),
        JsonElement { ValueKind: JsonValueKind.True } => true,
        JsonElement { ValueKind: JsonValueKind.False } => false,
        JsonElement { ValueKind: JsonValueKind.Number } j => j.GetDecimal(),
        JsonElement j => j.GetRawText(),
        DateTime d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTimeOffset d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        int or long or short or double or float => Convert.ToDecimal(v, CultureInfo.InvariantCulture),
        _ => v,
    };

    private static bool Vide(object? v) => v is null || (v is string s && s.Trim().Length == 0);

    /// <summary>Nombre d'une saisie (virgule acceptée), ou null si invalide.</summary>
    public static decimal? Nombre(object? v)
    {
        if (v is decimal d) return d;
        var s = Regex.Replace(Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim() ?? "", @"[\s  ]", "").Replace(',', '.');
        return NombreTexte().IsMatch(s) && decimal.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : null;
    }

    private static bool DateValide(object v)
    {
        var m = DateIso().Match(Convert.ToString(v, CultureInfo.InvariantCulture) ?? "");
        return m.Success && DateOnly.TryParseExact(m.Value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    }

    private static bool RespecteMasque(object valeur, string masque)
    {
        var parties = masque.Split('.', ',');
        var (ent, dec) = (parties[0].Length, parties.Length > 1 ? parties[1].Length : 0);
        var s = (valeur is decimal d ? d.ToString(CultureInfo.InvariantCulture) : Convert.ToString(valeur, CultureInfo.InvariantCulture)!.Trim().Replace(',', '.')).TrimStart('+', '-');
        var p = s.Split('.');
        var entiers = p[0].TrimStart('0');
        if (entiers.Length == 0 && p[0].Length > 0) entiers = "0";
        return entiers.Length <= ent && (p.Length < 2 ? 0 : p[1].Length) <= dec;
    }

    private static bool RespecteFormat(string texte, string format)
    {
        var t = texte.Trim();
        switch (format)
        {
            case "email": return Email().IsMatch(t);
            case "telephone":
                var n = SeparateursTelephone().Replace(t, "");
                return TelephoneFr().IsMatch(n) || TelephoneInter().IsMatch(n);
            case "code_postal": return CodePostal().IsMatch(t);
            default:
                if (!format.StartsWith("regex:", StringComparison.Ordinal)) return true;
                try
                {
                    return Regex.IsMatch(t, format[6..], RegexOptions.None, TimeSpan.FromMilliseconds(200));
                }
                catch (ArgumentException)
                {
                    return true;
                }
                catch (RegexMatchTimeoutException)
                {
                    return false;
                }
        }
    }

    /// <summary>Code d'erreur d'un champ pour une valeur, ou null si la valeur est acceptée.</summary>
    public static string? Valider(ChampFiche champ, object? valeurBrute)
    {
        var valeur = Normaliser(valeurBrute);
        if (Vide(valeur)) return champ.Obligatoire || champ.ObligatoireParametre ? "OBLIGATOIRE" : null;
        switch (champ.Type)
        {
            case "nombre":
                if (Nombre(valeur) is null) return "NOMBRE";
                return champ.Format is { } f && Masque().IsMatch(f) && !RespecteMasque(valeur!, f) ? "FORMAT" : null;
            case "date":
                return DateValide(valeur!) ? null : "DATE";
            case "booleen":
                return valeur is bool || valeur is "true" or "false" ? null : "BOOLEEN";
            case "liste":
                var texte = Convert.ToString(valeur, CultureInfo.InvariantCulture);
                return (champ.Options ?? []).Any(o => o.Valeur == texte) ? null : "LISTE";
            default:
                var s = Convert.ToString(valeur, CultureInfo.InvariantCulture) ?? "";
                if (champ.Longueur is int l && s.EnumerateRunes().Count() > l) return "LONGUEUR";
                return champ.Format is { } fmt && !RespecteFormat(s, fmt) ? "FORMAT" : null;
        }
    }

    /// <summary>Erreurs d'une fiche complète (champs du programme et supplémentaires).</summary>
    public static List<ErreurChamp> ValiderFiche(TypeFicheResolu type, IReadOnlyDictionary<string, object?> valeurs, IReadOnlyDictionary<string, object?> proprietes)
    {
        var erreurs = new List<ErreurChamp>();
        foreach (var c in type.Definition.Champs.Where(c => !c.LectureSeule))
        {
            if (Valider(c, valeurs.GetValueOrDefault(c.Code)) is { } code) erreurs.Add(new ErreurChamp(c.Code, code, Messages[code]));
        }
        foreach (var c in type.Supplementaires)
        {
            if (Valider(c, proprietes.GetValueOrDefault(c.Code)) is { } code) erreurs.Add(new ErreurChamp(c.Code, code, Messages[code], true));
        }
        return erreurs;
    }
}
