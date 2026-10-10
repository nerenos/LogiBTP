using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LogiBTP.Calcul;

/// <summary>Remplacement des variables des libellés et libellé brut (libelles.js côté client).</summary>
public static partial class Libelles
{
    [GeneratedRegex(@"\{\{(.*?)\}\}")] private static partial Regex ReVariables();
    [GeneratedRegex(@"<br\s*/?>", RegexOptions.IgnoreCase)] private static partial Regex ReBr();
    [GeneratedRegex(@"</(p|div|li|h[1-6]|tr|td)>", RegexOptions.IgnoreCase)] private static partial Regex ReFinBloc();
    [GeneratedRegex(@"<[^>]*>")] private static partial Regex ReBalise();
    [GeneratedRegex(@"\s+")] private static partial Regex ReEspaces();

    public static string EchapperHtml(string s) =>
        s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&#39;");

    public static string FormaterValeur(object? valeur) => valeur switch
    {
        null => "",
        decimal d => ArrondiCalcul.FormatNombre(d),
        bool b => b ? "Oui" : "Non",
        int or long or short => Convert.ToString(valeur, CultureInfo.InvariantCulture)!,
        string s => s,
        DateOnly d => d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture),
        DateTimeOffset d => d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture),
        JsonDocument j => j.RootElement.GetRawText(),
        JsonElement j => j.GetRawText(),
        _ => Convert.ToString(valeur, CultureInfo.InvariantCulture) ?? "",
    };

    public static (string? Texte, List<(string Reference, string Message)> Inconnues) Remplacer(string? html, Func<string, object?> resoudre)
    {
        var inconnues = new List<(string, string)>();
        if (html is null) return (null, inconnues);
        var texte = ReVariables().Replace(html, m =>
        {
            var reference = m.Groups[1].Value.Trim();
            try
            {
                return EchapperHtml(FormaterValeur(resoudre(reference)));
            }
            catch (ErreurCalcul e)
            {
                inconnues.Add((reference, e.Message));
                return m.Value;
            }
        });
        return (texte, inconnues);
    }

    public static string? TexteBrut(string? html)
    {
        if (html is null) return null;
        var s = ReBr().Replace(html, " ");
        s = ReFinBloc().Replace(s, " ");
        s = ReBalise().Replace(s, "");
        s = s.Replace("&nbsp;", " ").Replace("&lt;", "<").Replace("&gt;", ">")
            .Replace("&quot;", "\"").Replace("&#39;", "'").Replace("&amp;", "&");
        return ReEspaces().Replace(s, " ").Trim();
    }
}
