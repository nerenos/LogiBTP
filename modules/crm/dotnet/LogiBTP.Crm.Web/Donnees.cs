using Ganss.Xss;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Crm.Web;

/// <summary>Type de note (appel, courriel, visite…), global ou propre à un service.</summary>
public class CrmTypeNote
{
    public int TnoId { get; set; }
    public string TnoCode { get; set; } = "";
    public string TnoLibelle { get; set; } = "";
    public int? TnoSrvId { get; set; }
    public string? TnoIcone { get; set; }
    public string? TnoModeleHtml { get; set; }
    public int TnoOrdre { get; set; }
    public bool TnoActif { get; set; } = true;
}

/// <summary>Note : action, message ou tâche.</summary>
public class CrmNote
{
    public long NotId { get; set; }
    public string NotNature { get; set; } = "ACTION";
    public string NotEtat { get; set; } = "A_FAIRE";
    public int? NotTnoId { get; set; }
    public int? NotSrvId { get; set; }
    public string NotObjet { get; set; } = "";
    public string? NotMessageHtml { get; set; }
    public long? NotResponsableId { get; set; }
    public DateTimeOffset? NotEcheance { get; set; }
    public long? NotParentId { get; set; }
    public bool NotPrive { get; set; }
    public bool NotRgpd { get; set; }
    public bool NotDansFil { get; set; }
    public DateTimeOffset? NotArchiveeLe { get; set; }
    public string NotCreePar { get; set; } = "";
    public DateTimeOffset NotCreeLe { get; set; }
    public string? NotMajPar { get; set; }
    public DateTimeOffset NotMajLe { get; set; }
}

/// <summary>Élément de l'application rattaché à une note (le principal donne le titre).</summary>
public class CrmNoteLien
{
    public long NliNotId { get; set; }
    public string NliTypeElement { get; set; } = "";
    public string NliIdElement { get; set; } = "";
    public bool NliPrincipal { get; set; }
}

/// <summary>Destinataire d'une note (individu) et sa lecture.</summary>
public class CrmNoteDestinataire
{
    public long NdeNotId { get; set; }
    public long NdeIndId { get; set; }
    public DateTimeOffset? NdeLuLe { get; set; }
}

/// <summary>Historique d'une note (tenu par trigger).</summary>
public class CrmNoteHistorique
{
    public long NhiId { get; set; }
    public long NhiNotId { get; set; }
    public string NhiQuoi { get; set; } = "";
    public string? NhiAvant { get; set; }
    public string? NhiApres { get; set; }
    public string? NhiPar { get; set; }
    public DateTimeOffset NhiLe { get; set; }
}

/// <summary>Droit du module par profil : SUPERVISER (notes privées), RGPD (notes de données personnelles).</summary>
public class CrmDroit
{
    public string CdrProfil { get; set; } = "";
    public string CdrAction { get; set; } = "";
}

/// <summary>Consultation journalisée d'une note privée (levée du masquage) ou RGPD.</summary>
public class CrmConsultation
{
    public long CcoId { get; set; }
    public long CcoNotId { get; set; }
    public string CcoMotif { get; set; } = "";
    public string CcoPar { get; set; } = "";
    public DateTimeOffset CcoLe { get; set; }
}

/// <summary>Contexte EF Core du module (modules/crm/db) ; snake_case par la convention de l'application.</summary>
public class CrmDbContext(DbContextOptions<CrmDbContext> options) : DbContext(options)
{
    public DbSet<CrmTypeNote> TypesNote => Set<CrmTypeNote>();
    public DbSet<CrmNote> Notes => Set<CrmNote>();
    public DbSet<CrmNoteLien> Liens => Set<CrmNoteLien>();
    public DbSet<CrmNoteDestinataire> Destinataires => Set<CrmNoteDestinataire>();
    public DbSet<CrmNoteHistorique> Historique => Set<CrmNoteHistorique>();
    public DbSet<CrmDroit> Droits => Set<CrmDroit>();
    public DbSet<CrmConsultation> Consultations => Set<CrmConsultation>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<CrmTypeNote>().ToTable("crm_type_note").HasKey(x => x.TnoId);
        // Historique tenu par trigger : EF n'utilise pas RETURNING sur une table à trigger.
        b.Entity<CrmNote>().ToTable("crm_note", t => t.HasTrigger("tr_crm_note_historique")).HasKey(x => x.NotId);
        b.Entity<CrmNoteLien>().ToTable("crm_note_lien").HasKey(x => new { x.NliNotId, x.NliTypeElement, x.NliIdElement });
        b.Entity<CrmNoteDestinataire>().ToTable("crm_note_destinataire").HasKey(x => new { x.NdeNotId, x.NdeIndId });
        b.Entity<CrmNoteHistorique>().ToTable("crm_note_historique").HasKey(x => x.NhiId);
        b.Entity<CrmDroit>().ToTable("crm_droit").HasKey(x => new { x.CdrProfil, x.CdrAction });
        b.Entity<CrmConsultation>().ToTable("crm_consultation").HasKey(x => x.CcoId);
    }
}

/// <summary>
/// Nettoyage du message HTML d'une note : même liste blanche que la mise en forme des libellés (htmlSur du socle,
/// NettoyageHtml du module Document), sans dépendre de ce module.
/// </summary>
public sealed class NettoyageHtmlCrm
{
    private readonly HtmlSanitizer _sanitizer;

    public NettoyageHtmlCrm()
    {
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
        _sanitizer.RemovingTag += (_, e) =>
        {
            if (e.Tag.TagName is "SCRIPT" or "STYLE" or "IFRAME" or "OBJECT" or "EMBED" or "NOSCRIPT" or "TEMPLATE") e.Tag.TextContent = "";
        };
    }

    public string? Nettoyer(string? html) => string.IsNullOrWhiteSpace(html) ? null : _sanitizer.Sanitize(html);
}
