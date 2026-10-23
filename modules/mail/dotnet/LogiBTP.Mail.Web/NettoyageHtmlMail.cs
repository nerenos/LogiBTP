using Ganss.Xss;

namespace LogiBTP.Mail.Web;

/// <summary>
/// Nettoyage du HTML des courriels (corps saisis, signatures, modèles) : liste blanche alignée sur <c>htmlSur</c> du socle
/// et le nettoyage du CRM, plus les liens (http, https, mailto) ; scripts, styles et cadres retirés avec leur contenu.
/// </summary>
public sealed class NettoyageHtmlMail
{
    private readonly HtmlSanitizer _sanitizer;

    public NettoyageHtmlMail()
    {
        _sanitizer = new HtmlSanitizer { KeepChildNodes = true };
        _sanitizer.AllowedTags.Clear();
        foreach (var t in new[] { "p", "div", "br", "b", "strong", "i", "em", "u", "s", "sub", "sup", "span", "ul", "ol", "li",
                     "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "a" })
        {
            _sanitizer.AllowedTags.Add(t);
        }
        _sanitizer.AllowedAttributes.Clear();
        foreach (var a in new[] { "style", "colspan", "rowspan", "href" }) _sanitizer.AllowedAttributes.Add(a);
        _sanitizer.AllowedCssProperties.Clear();
        foreach (var p in new[] { "color", "background-color", "font-weight", "font-style", "text-decoration", "text-align" })
        {
            _sanitizer.AllowedCssProperties.Add(p);
        }
        _sanitizer.AllowedSchemes.Clear();
        foreach (var s in new[] { "http", "https", "mailto" }) _sanitizer.AllowedSchemes.Add(s);
        _sanitizer.RemovingTag += (_, e) =>
        {
            if (e.Tag.TagName is "SCRIPT" or "STYLE" or "IFRAME" or "OBJECT" or "EMBED" or "NOSCRIPT" or "TEMPLATE") e.Tag.TextContent = "";
        };
    }

    public string Nettoyer(string? html) => string.IsNullOrWhiteSpace(html) ? "" : _sanitizer.Sanitize(html);
}
