using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Import.Reprise;

/// <summary>
/// Conversion d'un libellé RTF (RichEdit) en HTML simple : paragraphes, retours à la ligne, gras, italique, souligné,
/// caractères accentués (\'e9 en Windows-1252, \u339?). Polices, tailles et couleurs sont ignorées. Réplique de
/// <c>rtfEnHtml</c> (modules/import/js/src/rtf.js), jeu partagé <c>js/test/rtf-cas.json</c> (plan reprise-mde-optim, lot 8).
/// </summary>
public static partial class Rtf
{
    private static readonly HashSet<string> Ignores =
    [
        "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable",
        "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "datastore", "latentstyles",
    ];

    /// <summary>Octets 0x80 à 0x9F de Windows-1252 (les autres sont ceux de Latin-1) ; 0 : non défini.</summary>
    private static readonly char[] Cp1252 =
    [
        '€', '\0', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\0', 'Ž', '\0',
        '\0', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\0', 'ž', 'Ÿ',
    ];

    [GeneratedRegex(@"\G\\([a-zA-Z]+)(-?\d+)? ?")]
    private static partial Regex MotControle();

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex Balise();

    [GeneratedRegex("^(<br>)+|(<br>)+$")]
    private static partial Regex BrExtremes();

    public static bool EstRtf(string? texte) => texte is not null && texte.TrimStart().StartsWith(@"{\rtf", StringComparison.Ordinal);

    private static string Octet(int n) => n is >= 0x80 and <= 0x9F ? (Cp1252[n - 0x80] is var c && c != '\0' ? c.ToString() : "�") : ((char)n).ToString();

    private static string Echapper(string t) =>
        t.Replace("&", "&amp;", StringComparison.Ordinal).Replace("<", "&lt;", StringComparison.Ordinal)
         .Replace(">", "&gt;", StringComparison.Ordinal).Replace("\"", "&quot;", StringComparison.Ordinal);

    private sealed class Morceau
    {
        public StringBuilder T = new();
        public bool B, I, Ul, Br;
    }

    private struct Etat
    {
        public bool B, I, Ul, Ignorer;
        public int Uc;
    }

    /// <summary>HTML du RTF : un seul paragraphe donne un contenu en ligne, plusieurs donnent des &lt;p&gt; ; paragraphes vides de fin retirés.</summary>
    public static string EnHtml(string rtf)
    {
        var paragraphes = new List<List<Morceau>>();
        var courant = new List<Morceau>();
        var etat = new Etat { Uc = 1 };
        var pile = new Stack<Etat>();
        var aSauter = 0;
        void Ajouter(string t)
        {
            if (etat.Ignorer || t.Length == 0) return;
            var der = courant.Count > 0 ? courant[^1] : null;
            if (der is not null && der.B == etat.B && der.I == etat.I && der.Ul == etat.Ul && !der.Br) der.T.Append(t);
            else
            {
                var m = new Morceau { B = etat.B, I = etat.I, Ul = etat.Ul };
                m.T.Append(t);
                courant.Add(m);
            }
        }
        void FinParagraphe() { paragraphes.Add(courant); courant = []; }

        var i = 0;
        var n = rtf.Length;
        var premierMot = false;
        while (i < n)
        {
            var c = rtf[i];
            if (c == '{') { pile.Push(etat); premierMot = true; i++; continue; }
            if (c == '}') { if (pile.Count > 0) etat = pile.Pop(); premierMot = false; i++; continue; }
            if (c is '\r' or '\n') { i++; continue; }
            if (c != '\\')
            {
                if (aSauter > 0) { aSauter--; i++; continue; }
                var j = i;
                while (j < n && rtf[j] is not ('\\' or '{' or '}' or '\r' or '\n')) j++;
                Ajouter(rtf[i..j]);
                premierMot = false;
                i = j;
                continue;
            }
            var s = i + 1 < n ? rtf[i + 1] : '\0';
            if (s is '\\' or '{' or '}') { Ajouter(s.ToString()); i += 2; premierMot = false; continue; }
            if (s == '~') { Ajouter(" "); i += 2; continue; }
            if (s is '-' or '_') { i += 2; continue; }
            if (s == '*') { if (premierMot) etat.Ignorer = true; i += 2; continue; }
            if (s == '\'')
            {
                var hex = i + 4 <= n ? rtf.Substring(i + 2, 2) : "";
                if (aSauter > 0) aSauter--;
                else if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var code)) Ajouter(Octet(code));
                i += 4;
                premierMot = false;
                continue;
            }
            var m = MotControle().Match(rtf, i);
            if (!m.Success) { i++; continue; }
            i += m.Length;
            var mot = m.Groups[1].Value;
            int? param = m.Groups[2].Success ? int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) : null;
            if (premierMot && Ignores.Contains(mot)) etat.Ignorer = true;
            premierMot = false;
            switch (mot)
            {
                case "par": FinParagraphe(); break;
                case "line": if (!etat.Ignorer) courant.Add(new Morceau { Br = true }); break;
                case "tab": Ajouter(" "); break;
                case "b": etat.B = param != 0; break;
                case "i": etat.I = param != 0; break;
                case "ul": etat.Ul = param != 0; break;
                case "ulnone": etat.Ul = false; break;
                case "plain": etat.B = etat.I = etat.Ul = false; break;
                case "uc": etat.Uc = param ?? 1; break;
                case "u":
                    var p = param ?? 0;
                    Ajouter(((char)(p < 0 ? p + 65536 : p)).ToString());
                    aSauter = etat.Uc;
                    break;
                case "emdash": Ajouter("—"); break;
                case "endash": Ajouter("–"); break;
                case "bullet": Ajouter("•"); break;
                case "lquote": Ajouter("‘"); break;
                case "rquote": Ajouter("’"); break;
                case "ldblquote": Ajouter("“"); break;
                case "rdblquote": Ajouter("”"); break;
            }
        }
        if (courant.Count > 0) FinParagraphe();
        var html = paragraphes.Select(pa => BrExtremes().Replace(string.Concat(pa.Select(r =>
        {
            if (r.Br) return "<br>";
            var h = Echapper(r.T.ToString());
            if (r.Ul) h = $"<u>{h}</u>";
            if (r.I) h = $"<i>{h}</i>";
            if (r.B) h = $"<b>{h}</b>";
            return h;
        })), "")).ToList();
        while (html.Count > 0 && Balise().Replace(html[^1], "").Trim().Length == 0) html.RemoveAt(html.Count - 1);
        if (html.Count <= 1) return (html.Count == 0 ? "" : html[0]).Trim();
        return string.Concat(html.Select(x => $"<p>{x}</p>"));
    }

    /// <summary>HTML d'un libellé source : RTF converti, sinon texte échappé (retours à la ligne en &lt;br&gt;).</summary>
    public static string HtmlDe(string? texte)
    {
        if (string.IsNullOrWhiteSpace(texte)) return "";
        if (EstRtf(texte)) return EnHtml(texte);
        return Echapper(texte.Trim()).Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\n", "<br>", StringComparison.Ordinal);
    }

    /// <summary>Texte brut d'un HTML simple (balises retirées, entités de base décodées).</summary>
    public static string TexteDe(string html) =>
        Balise().Replace(html.Replace("</p><p>", "\n", StringComparison.Ordinal).Replace("<br>", "\n", StringComparison.Ordinal), "")
            .Replace("&lt;", "<", StringComparison.Ordinal).Replace("&gt;", ">", StringComparison.Ordinal)
            .Replace("&quot;", "\"", StringComparison.Ordinal).Replace("&amp;", "&", StringComparison.Ordinal);
}
