using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;

namespace LogiBTP.Ged.Web;

/// <summary>
/// Extraction du texte d'un contenu pour l'indexation plein texte (dge_texte_contenu) et la classification : PDF (PdfPig),
/// textes (txt, csv, md, json, xml, log), HTML, mails .eml, bureautique Office Open XML et OpenDocument. Images et autres
/// formats : pas de texte (SANS_TEXTE). Texte limité à <see cref="TailleMax"/> caractères, espaces resserrés.
/// </summary>
public static partial class ExtractionTexte
{
    public const string AFaire = "A_FAIRE";
    public const string Fait = "FAIT";
    public const string SansTexte = "SANS_TEXTE";
    public const string Echec = "ECHEC";

    public const int TailleMax = 1_000_000;

    private static readonly string[] Textes = ["txt", "csv", "md", "json", "xml", "log"];

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex RegexBalise();

    [GeneratedRegex(@"<(script|style)[^>]*>.*?</\1>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex RegexScript();

    [GeneratedRegex(@"[ \t\r\f\v]+")]
    private static partial Regex RegexEspaces();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex RegexLignes();

    /// <summary>Texte extrait (ou null) et état d'indexation.</summary>
    public static (string? Texte, string Etat) Extraire(Stream flux, string nomFichier, string? typeMime)
    {
        var ext = ClassificationGed.Extension(nomFichier);
        try
        {
            var texte = ext switch
            {
                "pdf" => Pdf(flux),
                "html" or "htm" => Html(Lire(flux)),
                "eml" => Lire(flux),
                "docx" => Zip(flux, n => n == "word/document.xml"),
                "xlsx" => Zip(flux, n => n == "xl/sharedStrings.xml"),
                "pptx" => Zip(flux, n => n.StartsWith("ppt/slides/slide", StringComparison.Ordinal) && n.EndsWith(".xml", StringComparison.Ordinal)),
                "odt" or "ods" or "odp" => Zip(flux, n => n == "content.xml"),
                _ when Textes.Contains(ext) || (typeMime ?? "").StartsWith("text/", StringComparison.Ordinal) => Lire(flux),
                _ => null,
            };
            texte = Nettoyer(texte);
            return string.IsNullOrWhiteSpace(texte) ? (null, SansTexte) : (texte, Fait);
        }
        catch (Exception)
        {
            return (null, Echec);
        }
    }

    private static string Lire(Stream flux)
    {
        using var lecteur = new StreamReader(flux, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
        var tampon = new char[TailleMax];
        var n = lecteur.ReadBlock(tampon, 0, tampon.Length);
        return new string(tampon, 0, n);
    }

    private static string Pdf(Stream flux)
    {
        using var copie = new MemoryStream();
        flux.CopyTo(copie);
        using var pdf = PdfDocument.Open(copie.ToArray());
        var b = new StringBuilder();
        foreach (var page in pdf.GetPages())
        {
            b.AppendLine(page.Text);
            if (b.Length > TailleMax) break;
        }
        return b.ToString();
    }

    private static string Html(string html) => WebUtility.HtmlDecode(RegexBalise().Replace(RegexScript().Replace(html, " "), " "));

    /// <summary>Texte des parties XML d'une archive bureautique (balises retirées, paragraphes en fins de ligne).</summary>
    private static string Zip(Stream flux, Func<string, bool> parties)
    {
        using var zip = new ZipArchive(flux, ZipArchiveMode.Read, leaveOpen: true);
        var b = new StringBuilder();
        foreach (var entree in zip.Entries.Where(e => parties(e.FullName)).OrderBy(e => e.FullName, StringComparer.Ordinal))
        {
            using var lecteur = new StreamReader(entree.Open(), Encoding.UTF8);
            var xml = lecteur.ReadToEnd().Replace("</w:p>", "\n").Replace("</text:p>", "\n").Replace("</a:p>", "\n").Replace("</si>", "\n");
            b.AppendLine(WebUtility.HtmlDecode(RegexBalise().Replace(xml, " ")));
            if (b.Length > TailleMax) break;
        }
        return b.ToString();
    }

    private static string? Nettoyer(string? texte)
    {
        if (texte is null) return null;
        var t = RegexLignes().Replace(RegexEspaces().Replace(texte.Replace("\0", ""), " "), "\n\n").Trim();
        return t.Length > TailleMax ? t[..TailleMax] : t;
    }
}
