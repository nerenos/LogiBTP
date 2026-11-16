using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Crm;
using LogiBTP.Domaine;
using LogiBTP.Ged;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using Microsoft.AspNetCore.StaticFiles;

namespace LogiBTP.Api.Reprise;

/// <summary>Fichier de l'ancienne GED à déposer : contenu, nom, élément lié (type de fiche, identifiant) ou répertoire.</summary>
public sealed record FichierReprise(byte[] Contenu, string Titre, string NomFichier, DateOnly? Date, string? Resume, string? Notes,
    (string Type, string Id)? Element, long? RepertoireId, string Emplacement);

/// <summary>Note du CRM reprise (action d'affaire, message ou observation), rattachée à sa fiche.</summary>
public sealed record NoteReprise(string Nature, string Etat, string Objet, string? MessageHtml, DateTimeOffset? Echeance, string? CreePar,
    DateTimeOffset? CreeLe, (string Type, string Id) Element);

/// <summary>
/// GED et notes reprises (plan reprise-mde-optim, lot 16) : contenus rangés par empreinte SHA-256 sous le répertoire de
/// la société (dépôts identiques partagés : un seul fichier, un seul <c>contenu_ged</c>), un document et sa version 1 par
/// fichier et par fiche liée (indexation laissée à la tâche de nuit : <c>dge_index_etat</c> À faire) ; fichier sans fiche
/// rangé dans les répertoires « Reprise » de la GED globale ; notes du CRM rattachées par <c>crm_note_lien</c>. En
/// simulation, rien n'est écrit sur le disque (empreintes calculées en mémoire, lignes annulées avec la transaction).
/// </summary>
public sealed class GedReprise(ContexteReprise ctx, StockageGed? stockage)
{
    public const string Nature = "fichier";
    public const string Genre = "edition";
    public const string RepertoireRacine = "Reprise";
    private static readonly FileExtensionContentTypeProvider Types = new();

    private readonly HashSet<string> empreintes = new(StringComparer.Ordinal);
    private readonly Dictionary<(long? Parent, string Nom), long> repertoires = [];
    private string Auteur => AnnuaireReprise.Couper(ctx.Options.Auteur ?? "reprise", 50)!;

    /// <summary>Contenus distincts déposés (dédupliqués par empreinte).</summary>
    public int ContenusDistincts => empreintes.Count;

    /// <summary>Répertoire de la GED globale (sans élément) sous un parent, créé au premier besoin.</summary>
    public async Task<long> RepertoireAsync(string nom, long? parent, CancellationToken ct)
    {
        nom = AnnuaireReprise.Couper(nom.Trim(), 100) ?? RepertoireRacine;
        if (repertoires.TryGetValue((parent, nom.ToLowerInvariant()), out var id)) return id;
        id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite,
            "INSERT INTO repertoire_ged (rge_nom, rge_parent_id, rge_cree_par) VALUES ($1, $2, $3) RETURNING rge_id", ct, nom, parent, Auteur));
        repertoires[(parent, nom.ToLowerInvariant())] = id;
        return id;
    }

    public async Task<long> DeposerAsync(FichierReprise f, CancellationToken ct)
    {
        ContenuStocke c;
        if (stockage is null || ctx.Options.Simulation)
        {
            var empreinte = Convert.ToHexStringLower(SHA256.HashData(f.Contenu));
            c = new ContenuStocke(empreinte, f.Contenu.LongLength, StockageGed.CheminRelatif(empreinte));
        }
        else
        {
            await using var flux = new MemoryStream(f.Contenu, writable: false);
            c = await stockage.Enregistrer(flux, ct);
        }
        empreintes.Add(c.Empreinte);
        await SqlReprise.ExecuterAsync(ctx.Unite,
            "INSERT INTO contenu_ged (cge_empreinte, cge_taille, cge_chemin) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", ct, c.Empreinte, c.Taille, c.Chemin);
        var dge = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO document_ged (dge_titre, dge_nature, dge_type_element, dge_id_element, dge_auteur, dge_date_document, dge_resume,
                                      dge_notes, dge_cree_par, dge_repertoire_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, $9) RETURNING dge_id
            """, ct, AnnuaireReprise.Couper(f.Titre, 250), Nature, f.Element?.Type, f.Element?.Id, Auteur, f.Date ?? ctx.Options.DateReprise,
            f.Resume, f.Notes, f.RepertoireId));
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO version_ged (vge_document, vge_numero, vge_genre, vge_empreinte, vge_nom_fichier, vge_type_mime, vge_taille, vge_auteur, vge_commentaire)
            VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)
            """, ct, dge, Genre, c.Empreinte, AnnuaireReprise.Couper(f.NomFichier, 250), TypeMime(f.NomFichier), c.Taille, Auteur,
            $"Reprise {ctx.Options.Source} ({f.Emplacement})");
        return dge;
    }

    public static string TypeMime(string nom) => Types.TryGetContentType(nom, out var t) ? t : "application/octet-stream";

    /// <summary>Nom de fichier : celui de la source, sinon le titre suivi de l'extension connue.</summary>
    public static string NomFichier(string? nom, string titre, string? extension) =>
        nom is { Length: > 0 } ? Path.GetFileName(nom.Replace('\\', '/'))
        : extension is { Length: > 0 } e ? $"{titre}.{e.TrimStart('.')}" : titre;

    public async Task NoterAsync(NoteReprise n, CancellationToken ct)
    {
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO crm_note (not_nature, not_etat, not_objet, not_message_html, not_echeance, not_cree_par, not_cree_le, not_maj_le)
            VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, now()), coalesce($7, now())) RETURNING not_id
            """, ct, n.Nature, n.Etat, AnnuaireReprise.Couper(n.Objet, ReglesNote.LongueurObjet), n.MessageHtml, n.Echeance,
            AnnuaireReprise.Couper(n.CreePar, 50) ?? Auteur, n.CreeLe));
        await SqlReprise.ExecuterAsync(ctx.Unite,
            "INSERT INTO crm_note_lien (nli_not_id, nli_type_element, nli_id_element, nli_principal) VALUES ($1, $2, $3, TRUE)", ct, id, n.Element.Type, n.Element.Id);
    }

    /// <summary>Fiche d'un lien polymorphe : type de fiche par la table « entite » (ou « type_fiche »), identifiant par le registre.</summary>
    public (string Type, string Id)? Fiche(string tableCorrespondance, string? typeSource, string? tableRegistre, string? cle, string emplacement)
    {
        if (ctx.Correspondre(tableCorrespondance, typeSource, emplacement) is not { Ignorer: false, Cible: { } type }) return null;
        if (tableRegistre is null || cle is null) return null;
        return ctx.Registre.Trouver(tableRegistre, ctx.CleConservee(tableRegistre, cle)) is long id ? (type, id.ToString(CultureInfo.InvariantCulture)) : null;
    }

    public static DateTimeOffset? Instant(DateTime? d) => d is { } x ? new DateTimeOffset(DateTime.SpecifyKind(x, DateTimeKind.Utc)) : null;

    public static string? Html(params string?[] textes) =>
        textes.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => Rtf.HtmlDe(t)).ToList() is { Count: > 0 } l ? string.Join("", l) : null;

    public static string Echapper(string texte) => WebUtility.HtmlEncode(texte);
}

/// <summary>Domaine commun : refus signalé quand la reprise réelle n'a pas de répertoire de stockage.</summary>
public abstract class DomaineGed(string? stockage) : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Ged;
    public abstract IReadOnlyList<string> Dependances { get; }

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        if (stockage is null && !ctx.Options.Simulation)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.GedNonReprise, null,
                "Répertoire de stockage de la GED inconnu : documents non repris (notes reprises)");
            await NotesAsync(ctx, new GedReprise(ctx, null), ct);
            return;
        }
        var g = new GedReprise(ctx, stockage is null ? null : new StockageGed(stockage));
        await FichiersAsync(ctx, g, ct);
        await NotesAsync(ctx, g, ct);
        if (g.ContenusDistincts > 0)
            ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.GedNonReprise, null, $"{g.ContenusDistincts} contenu(s) distinct(s) rangé(s) par empreinte");
    }

    protected abstract Task FichiersAsync(ContexteReprise ctx, GedReprise g, CancellationToken ct);
    protected abstract Task NotesAsync(ContexteReprise ctx, GedReprise g, CancellationToken ct);
}

/// <summary>
/// GED et notes MDE (lot 16) : images de SYS_MDEIMAGES rattachées aux éléments (PMEELEMENT.IDIMAGE, image de la fiche
/// <c>ele_image_ged</c>) et photos des salariés (PMESALARIE.IDPHOTO, <c>ind_image_ged</c> de l'individu) ; actions
/// d'affaire PMEAFFACTION (libellé de PMEACTION) en notes ACTION, terminées sauf fin prévue sans date de fin.
/// Les notes des fiches sont déjà dans leur commentaire (lots 6 à 9).
/// </summary>
public sealed class GedMde(string? stockage) : DomaineGed(stockage)
{
    public override IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Ressources, DomainesReprise.Codes.Bibliotheque, DomainesReprise.Codes.Structure];

    public const string Images = "SYS_MDEIMAGES";
    public const string Actions = "PMEAFFACTION";

    private static string? Cle(LigneSource l, string colonne) =>
        l.Decimal(colonne) is { } d and not 0 ? d.ToString("0", CultureInfo.InvariantCulture) : null;

    protected override async Task FichiersAsync(ContexteReprise ctx, GedReprise g, CancellationToken ct)
    {
        // Images utilisées : élément → image, salarié → photo (une image peut servir à plusieurs fiches).
        var usages = new Dictionary<string, List<(string Table, string Code, string Type)>>(StringComparer.Ordinal);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT CODE, IDIMAGE FROM PMEELEMENT WHERE IDIMAGE IS NOT NULL", ct))
            if (Cle(l, "IDIMAGE") is { } i) (usages.TryGetValue(i, out var u) ? u : usages[i] = []).Add((BibliothequeMde.Element, l.Texte("CODE")!, TypesFiche.Element));
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT CODE, IDPHOTO FROM PMESALARIE WHERE IDPHOTO IS NOT NULL", ct))
            if (Cle(l, "IDPHOTO") is { } i) (usages.TryGetValue(i, out var u) ? u : usages[i] = []).Add((RessourcesMde.Salarie, l.Texte("CODE")!, TypesFiche.Salarie));
        var volume = ctx.Rapport.Volume(Images);
        await foreach (var l in ctx.Lecteur.LireAsync("SELECT CODE, FILENAME, DATA FROM SYS_MDEIMAGES", null, ct))
        {
            volume.Lues++;
            var cle = Cle(l, "CODE");
            if (cle is null || !usages.TryGetValue(cle, out var fiches)) { volume.Ecartees++; continue; }
            if (l.Brut("DATA") is not byte[] { Length: > 0 } data)
            {
                volume.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.GedNonReprise, $"{Images} {cle}", "Image sans contenu : non reprise");
                continue;
            }
            var nom = GedReprise.NomFichier(l.Texte("FILENAME"), $"image-{cle}", "png");
            foreach (var (table, code, type) in fiches)
            {
                if (ctx.Registre.Trouver(table, ctx.CleConservee(table, code)) is not long id) continue;
                var dge = await g.DeposerAsync(new FichierReprise(data, type == TypesFiche.Salarie ? "Photo" : "Image", nom, null, null, null,
                    (type, id.ToString(CultureInfo.InvariantCulture)), null, $"{Images} {cle}"), ct);
                if (type == TypesFiche.Element)
                    await SqlReprise.ExecuterAsync(ctx.Unite, "UPDATE element SET ele_image_ged = $1 WHERE ele_id = $2", ct, dge, id);
                else
                    await SqlReprise.ExecuterAsync(ctx.Unite,
                        "UPDATE individu SET ind_image_ged = $1 WHERE ind_id = (SELECT sal_ind_id FROM salarie WHERE sal_id = $2)", ct, dge, (int)id);
                volume.Ecrites++;
            }
        }
    }

    protected override async Task NotesAsync(ContexteReprise ctx, GedReprise g, CancellationToken ct)
    {
        var libelles = (await SqlReprise.SourceAsync(ctx, "SELECT CODE, LIBELLE FROM PMEACTION", ct))
            .Where(l => l.Texte("CODE") is not null).ToDictionary(l => l.Texte("CODE")!, l => l.Texte("LIBELLE"), StringComparer.OrdinalIgnoreCase);
        var volume = ctx.Rapport.Volume(Actions);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEAFFACTION ORDER BY DATEACTION, CLE", ct))
        {
            volume.Lues++;
            var emplacement = $"{Actions} {l.Texte("CLE")}";
            if (ctx.Registre.Trouver(StructureMde.Affaire, ctx.CleConservee(StructureMde.Affaire, l.Texte("CODEAFFAIRE") ?? "")) is not long aff)
            {
                volume.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.GedNonReprise, emplacement, "Action d'une affaire non reprise : non reprise");
                continue;
            }
            var type = l.Texte("CODEACTION") is { } c ? libelles.GetValueOrDefault(c) ?? c : null;
            var objet = l.Texte("OBJET") ?? type ?? "Action";
            var ouverte = l.Date("DATEFINPREVUE") is not null && l.Date("DATETERMINEE") is null;
            var entete = string.Join(" · ", new[] { type, l.Texte("DESTINATAIRE") is { } d ? $"→ {d}" : null }.OfType<string>());
            await g.NoterAsync(new NoteReprise(NatureNote.Action, ouverte ? EtatNote.AFaire : EtatNote.Termine, objet,
                GedReprise.Html(entete.Length > 0 ? entete : null, l.Texte("DESCRIPTIF"), l.Texte("NOTE")),
                GedReprise.Instant(l.Date("DATEFINPREVUE")), l.Texte("AUTEUR"), GedReprise.Instant(l.Date("DATEACTION")),
                (TypesFiche.Affaire, aff.ToString(CultureInfo.InvariantCulture))), ct);
            volume.Ecrites++;
        }
    }
}

/// <summary>
/// GED et notes OPTIM (lot 16) : ged_document (contenu base64 GDC_Base64, lu en flux) déposé sur chaque fiche de
/// ged_document_entite (type par la table « entite », clé par le registre) ; sans fiche : répertoires « Reprise › conteneur
/// (ged_conteneur) › sous-dossier » de la GED globale ; documents désactivés écartés, sans contenu signalés ;
/// msg_message_observation en notes (nature par « nature_message » sur le code du paramètre MSG_Type ; tâche faite :
/// terminée, sinon à faire ; message : mémo).
/// </summary>
public sealed class GedOptim(string? stockage) : DomaineGed(stockage)
{
    public override IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Ressources, DomainesReprise.Codes.Bibliotheque, DomainesReprise.Codes.Structure,
        DomainesReprise.Codes.Annuaire];

    public const string Documents = "ged_document";
    public const string Messages = "msg_message_observation";

    protected override async Task FichiersAsync(ContexteReprise ctx, GedReprise g, CancellationToken ct)
    {
        var conteneurs = (await SqlReprise.SourceAsync(ctx, "SELECT GCN_ID, GCN_Libelle, GCN_Code FROM ged_conteneur", ct))
            .ToDictionary(l => l.Texte("GCN_ID")!, l => l.Texte("GCN_Libelle") ?? l.Texte("GCN_Code") ?? l.Texte("GCN_ID")!);
        var liens = new Dictionary<string, List<(string Type, string Id)>>(StringComparer.Ordinal);
        foreach (var l in await SqlReprise.SourceAsync(ctx,
                     "SELECT GDE_ID, GDE_GDC_ID, GDE_TypeEntite, GDE_Entite_ID FROM ged_document_entite ORDER BY GDE_GDC_ID, GDE_Ordre, GDE_ID", ct))
        {
            var type = l.Texte("GDE_TypeEntite");
            var fiche = g.Fiche(TablesCorrespondance.Entite, type, type is null ? null : ValeursChampsOptim.TablesEntites.GetValueOrDefault(type),
                l.Texte("GDE_Entite_ID"), $"ged_document_entite {l.Texte("GDE_ID")}");
            if (fiche is { } f && l.Texte("GDE_GDC_ID") is { } doc && !(liens.TryGetValue(doc, out var x) ? x : liens[doc] = []).Contains(f)) liens[doc].Add(f);
        }
        var volume = ctx.Rapport.Volume(Documents);
        await foreach (var l in ctx.Lecteur.LireAsync("""
            SELECT GDC_ID, GDC_GCN_ID, GDC_NomDoc, GDC_Objet, GDC_NomFichier, GDC_SousDossier, GDC_TypeFichier, GDC_Date, GDC_Commentaire,
                   GDC_IsDesactive, GDC_Base64
            FROM ged_document ORDER BY GDC_ID
            """, null, ct))
        {
            volume.Lues++;
            var cle = l.Texte("GDC_ID")!;
            var emplacement = $"{Documents} {cle}";
            if (l.Booleen("GDC_IsDesactive") == true) { volume.Ecartees++; continue; }
            byte[]? contenu = null;
            try { contenu = l.Texte("GDC_Base64") is { } b ? Convert.FromBase64String(b) : null; }
            catch (FormatException) { }
            if (contenu is not { Length: > 0 })
            {
                volume.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.GedNonReprise, emplacement, "Document sans contenu base64 lisible : non repris");
                continue;
            }
            var titre = l.Texte("GDC_NomDoc") ?? l.Texte("GDC_NomFichier") ?? $"Document {cle}";
            var nom = GedReprise.NomFichier(l.Texte("GDC_NomFichier"), titre, l.Texte("GDC_TypeFichier"));
            var date = l.Date("GDC_Date") is { } d ? DateOnly.FromDateTime(d) : (DateOnly?)null;
            if (liens.TryGetValue(cle, out var fiches) && fiches.Count > 0)
                foreach (var f in fiches)
                    await g.DeposerAsync(new FichierReprise(contenu, titre, nom, date, l.Texte("GDC_Objet"), l.Texte("GDC_Commentaire"), f, null, emplacement), ct);
            else
            {
                var rep = await g.RepertoireAsync(GedReprise.RepertoireRacine, null, ct);
                if (l.Texte("GDC_GCN_ID") is { } gcn && conteneurs.TryGetValue(gcn, out var conteneur)) rep = await g.RepertoireAsync(conteneur, rep, ct);
                if (l.Texte("GDC_SousDossier") is { } sous)
                    foreach (var partie in sous.Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                        rep = await g.RepertoireAsync(partie, rep, ct);
                await g.DeposerAsync(new FichierReprise(contenu, titre, nom, date, l.Texte("GDC_Objet"), l.Texte("GDC_Commentaire"), null, rep, emplacement), ct);
            }
            volume.Ecrites++;
        }
    }

    protected override async Task NotesAsync(ContexteReprise ctx, GedReprise g, CancellationToken ct)
    {
        var table = ctx.Correspondances.Tables[TablesCorrespondance.NatureMessage];
        var codes = table.TypeParametre is null ? [] : (await SqlReprise.SourceAsync(ctx,
                "SELECT PRM_ID, PRM_Code FROM z_parametre WHERE PRM_TypeParam = @type", ct, new Dictionary<string, object?> { ["type"] = table.TypeParametre }))
            .ToDictionary(l => l.Texte("PRM_ID")!, l => l.Texte("PRM_Code"));
        var volume = ctx.Rapport.Volume(Messages);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM msg_message_observation WHERE MSG_IsDesactive = 0 ORDER BY MSG_ID", ct))
        {
            volume.Lues++;
            var emplacement = $"{Messages} {l.Texte("MSG_ID")}";
            var type = l.Texte("MSG_Entite_Type");
            var fiche = g.Fiche(TablesCorrespondance.Entite, type, type is null ? null : ValeursChampsOptim.TablesEntites.GetValueOrDefault(type),
                l.Texte("MSG_Entite_ID"), emplacement);
            var nature = ctx.Correspondre(TablesCorrespondance.NatureMessage, l.Texte("MSG_Type") is { } t ? codes.GetValueOrDefault(t) : null, emplacement);
            if (fiche is null || nature is not { Ignorer: false, Cible: { } n })
            {
                volume.Ecartees++;
                if (fiche is null)
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.GedNonReprise, emplacement, $"Message sans fiche reprise ({type}) : non repris");
                continue;
            }
            var etat = n == NatureNote.Message ? EtatNote.Memo : l.Booleen("MSG_IsFait") == true ? EtatNote.Termine : EtatNote.AFaire;
            var libelle = l.Texte("MSG_Libelle");
            var objet = l.Texte("MSG_Objet") ?? AnnuaireReprise.Couper(libelle, 80) ?? "Message";
            await g.NoterAsync(new NoteReprise(n, etat, objet, GedReprise.Html(libelle),
                GedReprise.Instant(l.Date("MSG_DateEcheance") ?? l.Date("MSG_DateFin")), null, GedReprise.Instant(l.Date("MSG_DateDebut")), fiche.Value), ct);
            volume.Ecrites++;
        }
    }
}
