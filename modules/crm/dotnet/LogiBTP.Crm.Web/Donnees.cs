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

/// <summary>Paramètre du module (clé → valeur JSON).</summary>
public class CrmParametre
{
    public string CpaCle { get; set; } = "";
    public System.Text.Json.JsonDocument CpaValeur { get; set; } = System.Text.Json.JsonDocument.Parse("{}");
    public DateTimeOffset CpaMajLe { get; set; }
    public string? CpaMajPar { get; set; }
}

/// <summary>Rappel d'une note : DATE ou AVANT l'échéance, pour un individu (nul : pour son auteur).</summary>
public class CrmRappel
{
    public long RapId { get; set; }
    public long RapNotId { get; set; }
    public string RapType { get; set; } = "DATE";
    public DateTimeOffset? RapQuand { get; set; }
    public int? RapDelaiJours { get; set; }
    public long? RapIndId { get; set; }
    public string RapCreePar { get; set; } = "";
    public DateTimeOffset RapCreeLe { get; set; }
    public DateTimeOffset? RapTraiteLe { get; set; }
}

/// <summary>Demande : pré-dossier de veille, jusqu'au projet créé ou sans suite.</summary>
public class CrmDemande
{
    public long DemId { get; set; }
    public string DemNumero { get; set; } = "";
    public string DemObjet { get; set; } = "";
    public string? DemDescriptionHtml { get; set; }
    public string DemEtat { get; set; } = "VEILLE";
    public string? DemMotif { get; set; }
    public long? DemTiersId { get; set; }
    public long? DemIndId { get; set; }
    public int? DemSrvId { get; set; }
    public long? DemResponsableId { get; set; }
    public DateOnly? DemEcheance { get; set; }
    public decimal? DemMontantEstime { get; set; }
    public string? DemOrigine { get; set; }
    public string? DemCibleType { get; set; }
    public string? DemCibleId { get; set; }
    public string DemCreePar { get; set; } = "";
    public DateTimeOffset DemCreeLe { get; set; }
    public string? DemMajPar { get; set; }
    public DateTimeOffset DemMajLe { get; set; }
}

/// <summary>Historique d'une demande (tenu par trigger).</summary>
public class CrmDemandeHistorique
{
    public long DhiId { get; set; }
    public long DhiDemId { get; set; }
    public string DhiQuoi { get; set; } = "";
    public string? DhiAvant { get; set; }
    public string? DhiApres { get; set; }
    public string? DhiPar { get; set; }
    public DateTimeOffset DhiLe { get; set; }
}

/// <summary>Statut de visa : effet ACCEPTE, REFUSE ou NEUTRE.</summary>
public class CrmStatutVisa
{
    public string StvCode { get; set; } = "";
    public string StvLibelle { get; set; } = "";
    public string StvEffet { get; set; } = "NEUTRE";
    public int StvOrdre { get; set; }
    public bool StvActif { get; set; } = true;
}

/// <summary>Plan ou pièce technique soumise au visa des tiers.</summary>
public class CrmPlan
{
    public long PlaId { get; set; }
    public string PlaRepere { get; set; } = "";
    public string? PlaRepereCctp { get; set; }
    public string PlaNom { get; set; } = "";
    public string? PlaLot { get; set; }
    public string? PlaFinition { get; set; }
    public string? PlaMessageHtml { get; set; }
    public string? PlaTypeElement { get; set; }
    public string? PlaIdElement { get; set; }
    public string PlaCreePar { get; set; } = "";
    public DateTimeOffset PlaCreeLe { get; set; }
    public string? PlaMajPar { get; set; }
    public DateTimeOffset PlaMajLe { get; set; }
}

/// <summary>Indice d'un plan (A, B…), date de diffusion, motif, fichier GED.</summary>
public class CrmPlanIndice
{
    public long PinId { get; set; }
    public long PinPlaId { get; set; }
    public string PinIndice { get; set; } = "A";
    public DateOnly? PinDate { get; set; }
    public string? PinMotif { get; set; }
    public long? PinDgeId { get; set; }
    public string PinCreePar { get; set; } = "";
    public DateTimeOffset PinCreeLe { get; set; }
}

/// <summary>Visa d'un tiers sur un indice (attendu, puis reçu).</summary>
public class CrmVisa
{
    public long VisId { get; set; }
    public long VisPinId { get; set; }
    public long VisTiersId { get; set; }
    public long? VisIndId { get; set; }
    public DateOnly? VisAttenduLe { get; set; }
    public string? VisStvCode { get; set; }
    public DateOnly? VisRecuLe { get; set; }
    public string? VisObservation { get; set; }
    public long? VisDgeRetourId { get; set; }
    public long? VisDfdId { get; set; }
    public string? VisMajPar { get; set; }
    public DateTimeOffset VisMajLe { get; set; }
}

/// <summary>Bordereau de diffusion.</summary>
public class CrmDiffusion
{
    public long DifId { get; set; }
    public string DifNumero { get; set; } = "";
    public DateOnly DifDate { get; set; }
    public string DifObjet { get; set; } = "";
    public string? DifTypeElement { get; set; }
    public string? DifIdElement { get; set; }
    public int DifDelaiVisaJours { get; set; } = 15;
    public string DifCreePar { get; set; } = "";
    public DateTimeOffset DifCreeLe { get; set; }
}

/// <summary>Pièce d'un bordereau : indice de plan ou document de la GED.</summary>
public class CrmDiffusionPiece
{
    public long DfpId { get; set; }
    public long DfpDifId { get; set; }
    public long? DfpPinId { get; set; }
    public long? DfpDgeId { get; set; }
    public string DfpLibelle { get; set; } = "";
}

/// <summary>Destinataire d'un bordereau : tiers, contact, mode, exemplaires, visa attendu, tâche de retour.</summary>
public class CrmDiffusionDestinataire
{
    public long DfdId { get; set; }
    public long DfdDifId { get; set; }
    public long DfdTiersId { get; set; }
    public long? DfdIndId { get; set; }
    public string DfdMode { get; set; } = "COURRIEL";
    public int DfdExemplaires { get; set; } = 1;
    public bool DfdAttendVisa { get; set; }
    public long? DfdNotId { get; set; }
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
    public DbSet<CrmParametre> Parametres => Set<CrmParametre>();
    public DbSet<CrmRappel> Rappels => Set<CrmRappel>();
    public DbSet<CrmDemande> Demandes => Set<CrmDemande>();
    public DbSet<CrmDemandeHistorique> HistoriqueDemandes => Set<CrmDemandeHistorique>();
    public DbSet<CrmStatutVisa> StatutsVisa => Set<CrmStatutVisa>();
    public DbSet<CrmPlan> Plans => Set<CrmPlan>();
    public DbSet<CrmPlanIndice> Indices => Set<CrmPlanIndice>();
    public DbSet<CrmVisa> Visas => Set<CrmVisa>();
    public DbSet<CrmDiffusion> Diffusions => Set<CrmDiffusion>();
    public DbSet<CrmDiffusionPiece> PiecesDiffusion => Set<CrmDiffusionPiece>();
    public DbSet<CrmDiffusionDestinataire> DestinatairesDiffusion => Set<CrmDiffusionDestinataire>();

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
        b.Entity<CrmParametre>().ToTable("crm_parametre").HasKey(x => x.CpaCle);
        b.Entity<CrmRappel>().ToTable("crm_rappel").HasKey(x => x.RapId);
        b.Entity<CrmDemande>().ToTable("crm_demande", t => t.HasTrigger("tr_crm_demande_historique")).HasKey(x => x.DemId);
        b.Entity<CrmDemandeHistorique>().ToTable("crm_demande_historique").HasKey(x => x.DhiId);
        b.Entity<CrmStatutVisa>().ToTable("crm_statut_visa").HasKey(x => x.StvCode);
        b.Entity<CrmPlan>().ToTable("crm_plan").HasKey(x => x.PlaId);
        b.Entity<CrmPlanIndice>().ToTable("crm_plan_indice").HasKey(x => x.PinId);
        b.Entity<CrmVisa>().ToTable("crm_visa").HasKey(x => x.VisId);
        b.Entity<CrmDiffusion>().ToTable("crm_diffusion").HasKey(x => x.DifId);
        b.Entity<CrmDiffusionPiece>().ToTable("crm_diffusion_piece").HasKey(x => x.DfpId);
        b.Entity<CrmDiffusionDestinataire>().ToTable("crm_diffusion_destinataire").HasKey(x => x.DfdId);
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
