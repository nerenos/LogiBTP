using Ganss.Xss;

namespace LogiBTP.Documents.Web;

/// <summary>Nettoyage du HTML saisi (liste blanche de balises) pour éviter toute faille XSS.</summary>
public sealed class NettoyageHtml
{
    private readonly HtmlSanitizer _sanitizer;

    public NettoyageHtml()
    {
        // KeepChildNodes : une balise non autorisée est retirée mais son texte est conservé.
        _sanitizer = new HtmlSanitizer { KeepChildNodes = true };
        _sanitizer.AllowedTags.Clear();
        foreach (var t in new[] { "p", "div", "br", "b", "strong", "i", "em", "u", "s", "sub", "sup", "span", "ul", "ol", "li",
                     "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td" })
        {
            _sanitizer.AllowedTags.Add(t);
        }
        _sanitizer.AllowedAttributes.Clear();
        _sanitizer.AllowedAttributes.Add("style");
        _sanitizer.AllowedAttributes.Add("colspan");
        _sanitizer.AllowedAttributes.Add("rowspan");
        _sanitizer.AllowedCssProperties.Clear();
        foreach (var p in new[] { "color", "background-color", "font-weight", "font-style", "text-decoration", "text-align" })
        {
            _sanitizer.AllowedCssProperties.Add(p);
        }
        _sanitizer.AllowedSchemes.Clear();
        // Contenu des balises dangereuses supprimé avec elles (sinon conservé comme texte par KeepChildNodes).
        _sanitizer.RemovingTag += (_, e) =>
        {
            if (e.Tag.TagName is "SCRIPT" or "STYLE" or "IFRAME" or "OBJECT" or "EMBED" or "NOSCRIPT" or "TEMPLATE") e.Tag.TextContent = "";
        };
    }

    public string? Nettoyer(string? html) => html is null ? null : _sanitizer.Sanitize(html);
}
