using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LogiBTP.Calcul;

public sealed record FormatNumerotation(string Separateur, IReadOnlyList<string> Styles);

/// <summary>Numérotation des lignes Titre, Ouvrage et Élément (numerotation.js côté client).</summary>
public static partial class Numerotation
{
    private static readonly FormatNumerotation Defaut = new(".", ["1"]);

    [GeneratedRegex("^[0-9]+$")] private static partial Regex ReChiffres();
    [GeneratedRegex("^[A-Za-z]+$")] private static partial Regex ReLettres();

    public static FormatNumerotation LireFormat(JsonDocument? f)
    {
        if (f is null || f.RootElement.ValueKind != JsonValueKind.Object) return Defaut;
        var r = f.RootElement;
        var sep = r.TryGetProperty("separateur", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString()! : ".";
        var styles = new List<string>();
        if (r.TryGetProperty("niveaux", out var n) && n.ValueKind == JsonValueKind.Array)
        {
            foreach (var niv in n.EnumerateArray())
            {
                styles.Add(niv.TryGetProperty("style", out var st) && st.ValueKind == JsonValueKind.String ? st.GetString()! : "1");
            }
        }
        return new FormatNumerotation(sep, styles.Count > 0 ? styles : Defaut.Styles);
    }

    public static string FormaterRang(int n, string style)
    {
        if (n <= 0 || style == "1") return n.ToString();
        var sb = new StringBuilder();
        while (n > 0)
        {
            var r = (n - 1) % 26;
            sb.Insert(0, (char)('A' + r));
            n = (n - 1) / 26;
        }
        return style == "a" ? sb.ToString().ToLowerInvariant() : sb.ToString();
    }

    public static int? LireDepart(string? texte)
    {
        var t = (texte ?? "").Trim();
        if (ReChiffres().IsMatch(t)) return int.Parse(t);
        if (ReLettres().IsMatch(t))
        {
            var n = 0;
            foreach (var c in t.ToUpperInvariant()) n = n * 26 + (c - 'A' + 1);
            return n;
        }
        return null;
    }

    internal static void Numeroter(MoteurCalcul m)
    {
        var format = LireFormat(m.Document.EntNumFormat);
        void Parcourir(long? parentId, string prefixe, int niveau)
        {
            var rang = 0;
            foreach (var l in m.EnfantsDe(parentId))
            {
                if (TL.EstPied(l) || !TL.EstNumerotee(l))
                {
                    l.LigNumerotation = null;
                    Parcourir(l.LigId, prefixe, niveau);
                    continue;
                }
                var depart = string.IsNullOrEmpty(l.LigNumDepart) ? null : LireDepart(l.LigNumDepart);
                if (!string.IsNullOrEmpty(l.LigNumDepart) && depart is null)
                {
                    m.Avertir(l.LigId, "NUM_DEPART", $"Valeur de départ de numérotation invalide « {l.LigNumDepart} »");
                }
                rang = depart ?? rang + 1;
                var style = format.Styles[Math.Min(niveau, format.Styles.Count - 1)];
                var auto = FormaterRang(rang, style);
                var calcule = prefixe.Length > 0 ? $"{prefixe}{format.Separateur}{auto}" : auto;
                if (!l.LigNumManuelle) l.LigNumerotation = calcule;
                Parcourir(l.LigId, l.LigNumerotation ?? calcule, niveau + 1);
            }
        }
        Parcourir(null, "", 0);
    }
}
