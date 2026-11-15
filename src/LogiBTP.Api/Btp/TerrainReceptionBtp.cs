using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using LogiBTP.Crm;
using LogiBTP.Crm.Web;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Editions.Web;
using LogiBTP.Execution.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Mail.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>Réception saisie sur le terrain ; <c>SigneeLe</c> : heure de l'appareil, envoyée seulement par une réception gardée hors ligne.</summary>
public sealed record ReceptionSaisie(string Etat, List<string>? Reserves, string? Motif, string Nom, string? Qualite, string? Signature, string? Courriel,
    DateTimeOffset? SigneeLe = null);
/// <summary>
/// Demande du terrain : <c>Articles</c> en texte libre (une ligne de texte chacun) ; <c>Lignes</c> (terrain-suites lot 18) :
/// articles de la bibliothèque simplifiée (élément, quantité, unité), écrits avant le texte libre.
/// </summary>
public sealed record DemandeTerrain(int ChaId, long? EntId, List<string>? Articles, string? Commentaire, List<LigneDemandeTerrain>? Lignes = null);
/// <summary>Article de la bibliothèque demandé : unité de stock, d'achat ou d'une conversion de l'article (défaut : achat, sinon stock).</summary>
public sealed record LigneDemandeTerrain(long Ele, decimal? Quantite, string? Unite);

/// <summary>
/// Application de terrain, lot 5 (ANALYSE-TERRAIN.md T14 à T16, T18) : réception d'un ordre de pose signée sur le
/// terrain et demande d'approvisionnement. Réception : signature simple (image tracée, nom et qualité du signataire,
/// horodatage du serveur) ; PV édité par le module Édition (modèle PV_RECEPTION, source annexe reception_pose, image
/// SIGNATURE_RECEPTION), rangé dans la GED de l'ordre avec son empreinte SHA-256 ; suites : étape RECEPTION validée
/// (droits de l'étape), réserves → tâche du CRM au service de l'ordre, refus → ordre bloqué (motif RECEPTION_REFUSEE),
/// courriel du PV au client par le serveur (module Mail, usage reception_pose). Une suite en échec n'annule pas la
/// réception : elle est rendue en avertissement. Ordre lisible : règle de l'atelier (E51) ou tâche de la personne.
/// </summary>
public static partial class TerrainBtp
{
    /// <summary>Étape de l'ordre de pose validée par la réception (catalogue des états, db/209).</summary>
    public const string EtapeReception = "RECEPTION";
    public const string ModelePv = "PV_RECEPTION";
    public const string UsageCourrielReception = "reception_pose";
    private static readonly string[] EtatsReception = ["SANS_RESERVE", "AVEC_RESERVES", "REFUSEE"];
    private const int SignatureMax = 512 * 1024;

    private sealed record OrdreReception(long Id, string? Numero, string? Objet, string Type, long Groupe, int? ChaId, string? Chantier, int? SrvId,
        string? Client, string? Contact, string? Courriel);
    private sealed record ReceptionLue(long Id, DateOnly Le, string Etat, string Reserves, string? Motif, string? Signataire, string? Qualite, long? DgeId,
        string? Courriel, string Par, DateTimeOffset CreeLe, DateTimeOffset? SigneeAppareilLe);
    private sealed record EtapeLue(string Code, string Libelle, DateOnly? ValideLe);
    private sealed record ExecutionLue(string? Commentaire, int? SrvId, long? ResponsableId, DateOnly? DebutPrevu, DateOnly? FinPrevue, string? Ressource);

    /// <summary>
    /// Compte de service des éditions : bon et PV sont édités et déposés par le serveur, la personne du terrain n'a ni le
    /// droit d'imprimer les modèles ni celui de déposer dans la GED (son droit sur l'ordre est contrôlé par la route).
    /// </summary>
    private static readonly Utilisateur ServeurEditions = new("editions_fond", Profils.Admin);

    private static async Task<OrdreReception> OrdreReceptionAsync(LogiBtpContext db, Utilisateur u, long ent, CancellationToken ct)
    {
        await ExigerOrdrePersonneAsync(db, u, ent, ct);
        var o = await LireOrdreAsync(db, ent, ct);
        if (o.Type != TypesDocument.EPo) throw ExceptionMetier.Invalide("TERRAIN_RECEPTION_TYPE", "La réception se signe sur un ordre de pose");
        return o;
    }

    /// <summary>Ordre lisible par la personne : règle de l'atelier (E51) ou tâche du planning sur l'ordre ou ses étapes.</summary>
    private static async Task ExigerOrdrePersonneAsync(LogiBtpContext db, Utilisateur u, long ent, CancellationToken ct)
    {
        var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
        var permis = await AtelierBtp.PeutAsync(db, s, ent, ct) || await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM pla_tache t JOIN pla_affectation a ON a.aff_tac_id = t.tac_id
                           LEFT JOIN exe_ordre_etape e ON t.tac_origine_type = 'etape' AND e.ore_id::text = t.tac_origine_id
                           WHERE a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text
                             AND (t.tac_origine_type = 'ordre' AND t.tac_origine_id = @e::text OR e.ore_ordre_id = @e)) AS "Value"
            """, new NpgsqlParameter("s", s), new NpgsqlParameter("e", ent)).FirstAsync(ct);
        if (!permis) throw ExceptionMetier.Introuvable($"Ordre {ent} de votre planning");
    }

    private static Task<OrdreReception> LireOrdreAsync(LogiBtpContext db, long ent, CancellationToken ct) =>
        db.Database.SqlQueryRaw<OrdreReception>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, d.ent_objet AS objet, t.tyd_code AS type, coalesce(d.ent_groupe_id, d.ent_id) AS groupe,
                   d.ent_chantier_id AS cha_id, c.cha_code || ' – ' || c.cha_libelle AS chantier, d.ent_srv_id AS srv_id,
                   coalesce(d.ent_contact_client ->> 'raison_sociale', p.per_raison_sociale) AS client,
                   d.ent_contact_client -> 'contact' ->> 'nom' AS contact, d.ent_contact_client ->> 'email' AS courriel
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id LEFT JOIN chantier c ON c.cha_id = d.ent_chantier_id
            LEFT JOIN personne p ON p.per_id = c.cha_tiers_id
            WHERE d.ent_id = @e
            """, new NpgsqlParameter("e", ent)).FirstAsync(ct);

    private static Task<List<ReceptionLue>> ReceptionsAsync(LogiBtpContext db, long ent, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ReceptionLue>("""
            SELECT r.rec_id AS id, r.rec_le AS le, r.rec_etat AS etat, r.rec_reserves::text AS reserves, r.rec_motif AS motif, s.sig_nom AS signataire,
                   s.sig_qualite AS qualite, r.rec_dge_id AS dge_id, r.rec_courriel AS courriel, r.rec_cree_par AS par, r.rec_cree_le AS cree_le,
                   r.rec_signee_appareil_le AS signee_appareil_le
            FROM reception_pose r LEFT JOIN signature s ON s.sig_id = r.rec_sig_id WHERE r.rec_ent_id = @e ORDER BY r.rec_id DESC
            """, new NpgsqlParameter("e", ent)).ToListAsync(ct);

    private static object Reception(ReceptionLue r) => new
    {
        id = r.Id, le = r.Le, etat = r.Etat, reserves = JsonDocument.Parse(r.Reserves).RootElement, motif = r.Motif, signataire = r.Signataire,
        qualite = r.Qualite, pv = r.DgeId is not null, courriel = r.Courriel, par = r.Par, cree_le = r.CreeLe,
        signee_appareil_le = r.SigneeAppareilLe,
    };

    /// <summary>
    /// Heure de signature sur l'appareil gardée avec la réception (terrain-suites lot 13, TS16 a) : seulement pour une
    /// réception envoyée après coup (hors ligne) ; une heure postérieure à celle du serveur (horloge de l'appareil en
    /// avance) est ramenée à celle du serveur.
    /// </summary>
    public static DateTimeOffset? HeureAppareil(DateTimeOffset? signeeLe, DateTimeOffset serveur) =>
        signeeLe is not { } h ? null : (h > serveur ? serveur : h).ToUniversalTime();

    private static async Task<object> ReceptionDetailAsync(LogiBtpContext db, OrdreReception o, CancellationToken ct) => new
    {
        ordre = new { id = o.Id, numero = o.Numero, objet = o.Objet, type = o.Type, chantier = o.Chantier },
        client = new { nom = o.Client, contact = o.Contact, courriel = o.Courriel },
        etape = await db.Database.SqlQueryRaw<EtapeLue>("""
            SELECT e.ore_code AS code, coalesce(c.etc_libelle, e.ore_code) AS libelle, e.ore_valide_le::date AS valide_le
            FROM exe_ordre_etape e LEFT JOIN exe_etat_catalogue c ON c.etc_code = e.ore_code WHERE e.ore_ordre_id = @e AND e.ore_code = @c
            """, new NpgsqlParameter("e", o.Id), new NpgsqlParameter("c", EtapeReception)).FirstOrDefaultAsync(ct),
        receptions = (await ReceptionsAsync(db, o.Id, ct)).Select(Reception),
        reserves = await ReservesAsync(db, o.Id, ct),
        levees = await LeveesAsync(db, o.Id, ct),
        pv_levee_attendu = await PvLeveeAttenduAsync(db, o.Id, ct),
    };

    /// <summary>
    /// PV signé d'un ordre édité par le module Édition (compte de service), rangé dans la GED de l'ordre (catégorie
    /// pv_reception) avec son empreinte SHA-256, gardée avec la signature (sig_empreinte, sig_dge_id). Renvoie la pièce.
    /// Réception de pose (PV_RECEPTION) et levée des réserves (PV_LEVEE_RESERVES, terrain-suites lot 16).
    /// </summary>
    private static async Task<long> EditerPvAsync(IServiceProvider services, LogiBtpContext db, OrdreReception o, string modele, string nomFichier, string titre,
        string resume, long sigId, Utilisateur u, CancellationToken ct)
    {
        var (pdf, _, _) = await services.GetRequiredService<ServiceEdition>().Pdf(services, new DemandeEdition("document", o.Id.ToString(CultureInfo.InvariantCulture), modele), false, ServeurEditions, ct);
        var empreinte = Convert.ToHexStringLower(SHA256.HashData(pdf.Octets));
        await using var flux = new MemoryStream(pdf.Octets);
        var fichier = new FormFile(flux, 0, pdf.Octets.Length, "fichier", nomFichier) { Headers = new HeaderDictionary(), ContentType = "application/pdf" };
        var d = await services.GetRequiredService<ServiceGed>().DeposerFichier(fichier, new MetaDepot
        {
            Titre = titre, Categorie = CategoriesGed.PvReception, TypeElement = o.Type, IdElement = o.Groupe.ToString(CultureInfo.InvariantCulture), Auteur = u.Code,
            Resume = $"{resume} ; empreinte SHA-256 {empreinte}",
        }, ServeurEditions, ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE signature SET sig_empreinte = @h, sig_dge_id = @d WHERE sig_id = @s",
            [new NpgsqlParameter("h", empreinte), new NpgsqlParameter("d", d.Id), new NpgsqlParameter("s", sigId)], ct);
        return d.Id;
    }

    /// <summary>Image PNG d'une data URL (signature tracée) ; refus si ce n'est pas un PNG ou s'il est trop lourd.</summary>
    private static byte[]? ImageSignature(string? dataUrl)
    {
        if (string.IsNullOrWhiteSpace(dataUrl)) return null;
        const string prefixe = "data:image/png;base64,";
        if (!dataUrl.StartsWith(prefixe, StringComparison.Ordinal)) throw ExceptionMetier.Invalide("TERRAIN_SIGNATURE", "Signature : image PNG attendue");
        byte[] octets;
        try { octets = Convert.FromBase64String(dataUrl[prefixe.Length..]); }
        catch (FormatException) { throw ExceptionMetier.Invalide("TERRAIN_SIGNATURE", "Signature illisible"); }
        if (octets.Length > SignatureMax || octets.Length < 8 || octets[0] != 0x89 || octets[1] != 0x50) throw ExceptionMetier.Invalide("TERRAIN_SIGNATURE", "Signature : image PNG attendue");
        return octets;
    }

    private static RouteGroupBuilder MapReceptionTerrain(this RouteGroupBuilder g)
    {
        g.MapGet("/receptions/{ent:long}", async (long ent, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            await ReceptionDetailAsync(db, await OrdreReceptionAsync(db, Utilisateur.Depuis(http), ent, ct), ct));

        g.MapPost("/receptions/{ent:long}", async (long ent, ReceptionSaisie r, HttpContext http, LogiBtpContext db, IServiceProvider services, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var o = await OrdreReceptionAsync(db, u, ent, ct);
            if (!EtatsReception.Contains(r.Etat)) throw ExceptionMetier.Invalide("TERRAIN_RECEPTION_ETAT", "Sans réserve, avec réserves ou refusée");
            if (string.IsNullOrWhiteSpace(r.Nom)) throw ExceptionMetier.Invalide("TERRAIN_SIGNATAIRE", "Nom du signataire obligatoire");
            var reserves = (r.Reserves ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
            if (r.Etat == "AVEC_RESERVES" && reserves.Count == 0) throw ExceptionMetier.Invalide("TERRAIN_RESERVES", "Au moins une réserve");
            if (r.Etat == "REFUSEE" && string.IsNullOrWhiteSpace(r.Motif)) throw ExceptionMetier.Invalide("TERRAIN_MOTIF", "Motif du refus obligatoire");
            var image = ImageSignature(r.Signature);
            if (image is null && r.Etat != "REFUSEE") throw ExceptionMetier.Invalide("TERRAIN_SIGNATURE", "Signature du client obligatoire");
            var courriel = string.IsNullOrWhiteSpace(r.Courriel) ? null : r.Courriel.Trim();

            // Signature et réception, puis PV édité (il lit la réception par sa source annexe) et rangé dans la GED de l'ordre.
            long sigId, recId;
            await using (var tx = await db.Unite().CommencerAsync(ct))
            {
                sigId = (await db.Database.SqlQueryRaw<long>("""
                    INSERT INTO signature (sig_type_element, sig_id_element, sig_nom, sig_qualite, sig_image, sig_par)
                    VALUES ('document', @e::text, @n, @q, @i, @u) RETURNING sig_id AS "Value"
                    """, new NpgsqlParameter("e", ent), new NpgsqlParameter("n", r.Nom.Trim()), SqlBtp.P("q", r.Qualite?.Trim()),
                    SqlBtp.P("i", image, NpgsqlTypes.NpgsqlDbType.Bytea), new NpgsqlParameter("u", u.Code)).ToListAsync(ct))[0];
                recId = (await db.Database.SqlQueryRaw<long>("""
                    INSERT INTO reception_pose (rec_ent_id, rec_etat, rec_reserves, rec_motif, rec_sig_id, rec_courriel, rec_cree_par, rec_signee_appareil_le)
                    VALUES (@e, @etat, @res::jsonb, @m, @s, @c, @u, @app) RETURNING rec_id AS "Value"
                    """, new NpgsqlParameter("e", ent), new NpgsqlParameter("etat", r.Etat), new NpgsqlParameter("res", JsonSerializer.Serialize(reserves)),
                    SqlBtp.P("m", r.Motif?.Trim()), new NpgsqlParameter("s", sigId), SqlBtp.P("c", courriel), new NpgsqlParameter("u", u.Code),
                    SqlBtp.P("app", HeureAppareil(r.SigneeLe, DateTimeOffset.UtcNow), NpgsqlTypes.NpgsqlDbType.TimestampTz)).ToListAsync(ct))[0];
                // Réserves suivies une par une (terrain-suites lot 14) ; la tâche du CRM reste créée plus bas comme alerte.
                await EcrireReservesAsync(db, recId, ent, ReservesSuivies(r.Etat, reserves), ct);
                await tx.CommitAsync(ct);
            }
            var avertissements = new List<string>();
            long? dge = null;
            try
            {
                // Point de sauvegarde : PV et son rattachement ensemble, la réception enregistrée reste acquise.
                dge = await db.Unite().ExecuterAsync(async c =>
                {
                    var d = await EditerPvAsync(services, db, o, ModelePv, $"PV-reception-{(o.Numero ?? ent.ToString(CultureInfo.InvariantCulture))}-{DateTime.Today:yyyyMMdd}.pdf",
                        $"PV de réception {o.Numero} du {DateTime.Today:dd/MM/yyyy}",
                        $"Réception {r.Etat switch { "SANS_RESERVE" => "sans réserve", "AVEC_RESERVES" => "avec réserves", _ => "refusée" }}, signée par {r.Nom.Trim()}", sigId, u, ct);
                    await db.Database.ExecuteSqlRawAsync("UPDATE reception_pose SET rec_dge_id = @d WHERE rec_id = @r",
                        [new NpgsqlParameter("d", d), new NpgsqlParameter("r", recId)], c);
                    return d;
                }, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                avertissements.Add($"PV non édité : {e.Message}");
            }

            // Suites : étape, réserves, blocage, courriel ; chacune à part.
            if (r.Etat != "REFUSEE")
                await SuiteAsync(avertissements, "Étape « Réception » à valider par le bureau", async () =>
                {
                    var etapes = services.GetRequiredService<ServiceEtapes>();
                    await etapes.InitialiserAsync(ent, ct);
                    if (await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM exe_ordre_etape WHERE ore_ordre_id = @e AND ore_code = @c AND ore_valide_le IS NULL) AS \"Value\"",
                        new NpgsqlParameter("e", ent), new NpgsqlParameter("c", EtapeReception)).FirstAsync(ct))
                        await etapes.ActionAsync(ent, EtapeReception, new ActionEtape("VALIDER"), u, ct);
                });
            if (r.Etat == "AVEC_RESERVES" && o.SrvId is int srv && await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.Crm, ct))
                await SuiteAsync(avertissements, "Tâche des réserves non créée", async () =>
                {
                    var liens = new List<LienSaisi> { new("document", o.Groupe.ToString(CultureInfo.InvariantCulture), true) };
                    if (o.ChaId is int c) liens.Add(new(TypesFiche.Chantier, c.ToString(CultureInfo.InvariantCulture)));
                    await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie(NatureNote.Tache, EtatNote.AFaire, null, srv,
                        LibelleTacheReserves(o.Numero, reserves), null, null, DateTimeOffset.UtcNow.AddDays(7), null, false, false, false, liens, null), u, ct);
                });
            if (r.Etat == "REFUSEE")
                await SuiteAsync(avertissements, "Ordre non bloqué", async () =>
                {
                    var motif = await db.Database.SqlQueryRaw<int?>("SELECT mot_id AS \"Value\" FROM motif WHERE mot_domaine = 'BLOCAGE' AND mot_code = 'RECEPTION_REFUSEE'").FirstOrDefaultAsync(ct);
                    var x = await db.Database.SqlQueryRaw<ExecutionLue>("""
                        SELECT ent_exe_commentaire AS commentaire, ent_srv_id AS srv_id, ent_responsable_id AS responsable_id, ent_debut_prevu AS debut_prevu,
                               ent_fin_prevue AS fin_prevue, ent_ressource::text AS ressource FROM document WHERE ent_id = @e
                        """, new NpgsqlParameter("e", ent)).FirstAsync(ct);
                    await ExecutionBtp.EnregistrerAsync(db, services, ent, new ExecutionSaisie("BLOQUE", motif, $"Réception refusée : {r.Motif!.Trim()}", x.SrvId, x.ResponsableId,
                        x.DebutPrevu, x.FinPrevue, x.Ressource is null ? null : JsonDocument.Parse(x.Ressource).RootElement), u, ct);
                });
            if (courriel is not null && dge is long piece)
                await SuiteAsync(avertissements, "Courriel du PV non envoyé", async () =>
                {
                    var etat = r.Etat switch { "SANS_RESERVE" => "sans réserve", "AVEC_RESERVES" => "avec réserves", _ => "refusée" };
                    await services.GetRequiredService<ServiceEnvoiMail>().EnvoyerAutomatiqueAsync(new EnvoiAutomatique(UsageCourrielReception,
                        [new LogiBTP.Mail.Web.DestinataireSaisi(courriel, o.Contact ?? o.Client)], $"Procès-verbal de réception – {o.Numero}",
                        $"<p>Bonjour,</p><p>Vous trouverez ci-joint le procès-verbal de réception des travaux ({System.Net.WebUtility.HtmlEncode(o.Objet ?? o.Numero ?? "")}), réception {etat}, signé ce jour.</p><p>Cordialement.</p>",
                        u.Code, TypeElement: o.Type, IdElement: o.Groupe.ToString(CultureInfo.InvariantCulture), Pieces: [$"ged:{piece}"]), ct);
                });
            return new { reception = (await ReceptionsAsync(db, ent, ct)).Select(Reception).First(), avertissements };
        });

        // PV signé d'une réception (contenu de la GED, mêmes droits que la réception).
        g.MapGet("/receptions/{ent:long}/pv/{rec:long}", async (long ent, long rec, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await OrdreReceptionAsync(db, u, ent, ct);
            var version = await db.Database.SqlQueryRaw<long?>("""
                SELECT (SELECT v.vge_id FROM version_ged v WHERE v.vge_document = r.rec_dge_id ORDER BY v.vge_numero DESC LIMIT 1) AS "Value"
                FROM reception_pose r WHERE r.rec_id = @r AND r.rec_ent_id = @e
                """, new NpgsqlParameter("r", rec), new NpgsqlParameter("e", ent)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("PV de réception");
            return await ged.Contenu(version, false, http, u, ct);
        });
        g.MapReservesReception();

        // Demande d'approvisionnement (T18) : ordre E_DAP brouillon sur un chantier de la personne, une ligne de texte par article.
        g.MapPost("/demandes", async (DemandeTerrain dm, HttpContext http, LogiBtpContext db,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            var articles = (dm.Articles ?? []).Select(a => a.Trim()).Where(a => a.Length > 0).ToList();
            var choisis = await ArticlesDemandeAsync(db, dm.Lignes ?? [], ct);
            if (articles.Count + choisis.Count == 0) throw ExceptionMetier.Invalide("TERRAIN_DEMANDE", "Au moins un article ou besoin");
            await ExigerChantierPlanningAsync(db, s, dm.ChaId, ct);
            var tyd = await TypesDocumentBtp.IdAsync(db, TypesDocument.EDap, ct);
            var noms = choisis.Select(a => a.Libelle).Concat(articles).ToList();
            var objet = $"Demande du terrain : {noms[0]}{(noms.Count > 1 ? $" (+{noms.Count - 1})" : "")}";
            var cree = await documents.Creer(new CreationDocument { EntTydId = tyd, EntObjet = objet.Length > 200 ? objet[..200] : objet }, u, ct);
            var c = await documents.Charger(cree.Document.EntId, ct);
            c.Document.EntChantierId = dm.ChaId;
            c.Document.EntAffaireId = await db.Database.SqlQueryRaw<int?>("SELECT cha_aff_id AS \"Value\" FROM chantier WHERE cha_id = @c", new NpgsqlParameter("c", dm.ChaId)).FirstAsync(ct);
            c.Document.EntAdresseLivraison ??= await AdressesDocument.Chantier(db, dm.ChaId, ct);
            var lignes = string.IsNullOrWhiteSpace(dm.Commentaire) ? articles : [.. articles, $"Note : {dm.Commentaire.Trim()}"];
            var i = 0;
            var tva = choisis.Count == 0 ? null : await db.TauxTva.Where(t => t.TtvCategorie == "N" && t.TtvActif).OrderByDescending(t => t.TtvDefaut).ThenByDescending(t => t.TtvTaux)
                .Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct);
            foreach (var a in choisis)
            {
                i++;
                foreach (var x in c.Lignes.Where(x => x.LigParentId is null && x.LigOrdre >= i)) x.LigOrdre++;
                c.Lignes.Add(LigneArticleDemande(c.Document.EntId, i, a, tva));
            }
            foreach (var a in lignes)
            {
                i++;
                foreach (var x in c.Lignes.Where(x => x.LigParentId is null && x.LigOrdre >= i)) x.LigOrdre++;
                c.Lignes.Add(new DocumentLigneBtp { LigId = -i, LigEntId = c.Document.EntId, LigOrdre = i, LigTylId = TL.Texte, LigLibelleHtml = System.Net.WebUtility.HtmlEncode(a), LigTypePrix = "V" });
            }
            if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
                c.Lignes.Add(new DocumentLigneBtp { LigId = -1000, LigEntId = c.Document.EntId, LigOrdre = i + 100, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
            await documents.Enregistrer(c.Document.EntId, c, u, ct);
            return new { ent_id = c.Document.EntId, numero = c.Document.EntNumero };
        }).ExigeDroit("terrain/demande", ActionsDroits.Creer);

        // Mes demandes : ordres E_DAP créés par la personne (90 derniers jours), statut, état d'exécution, articles et suites.
        g.MapGet("/demandes", async (HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var lignes = await db.Database.SqlQueryRaw<string>($$"""
                SELECT json_build_object(
                  'id', d.ent_id, 'numero', d.ent_numero, 'date', d.ent_date, 'cree_le', to_char(d.ent_cree_le, 'YYYY-MM-DD"T"HH24:MI'), 'objet', d.ent_objet,
                  'statut', s.std_code, 'statut_libelle', s.std_libelle, 'execution', d.ent_exe_etat,
                  'chantier', CASE WHEN c.cha_id IS NOT NULL THEN json_build_object('id', c.cha_id, 'code', c.cha_code, 'libelle', c.cha_libelle) END,
                  'articles', (SELECT coalesce(json_agg(CASE WHEN l.lig_tyl_id = {{TL.Element}}
                                 THEN json_build_object('code', l.lig_code, 'libelle', l.lig_libelle_html, 'quantite', trim_scale(l.lig_qte), 'unite', l.lig_unt_code)
                                 ELSE to_json(l.lig_libelle_html) END ORDER BY l.lig_ordre), '[]') FROM document_ligne l
                               WHERE l.lig_ent_id = d.ent_id AND l.lig_tyl_id IN ({{TL.Texte}}, {{TL.Element}}) AND l.lig_parent_id IS NULL),
                  'suites', (SELECT coalesce(json_agg(json_build_object('numero', x.ent_numero, 'type', tx.tyd_libelle, 'statut', sx.std_libelle) ORDER BY x.ent_id), '[]')
                             FROM document_lien k JOIN document x ON x.ent_id = k.lie_cible_ent_id JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id
                             JOIN statut_document sx ON sx.std_id = x.ent_std_id
                             WHERE k.lie_source_ent_id = d.ent_id AND k.lie_type = 'TRANSFORMATION')
                )::text AS "Value"
                FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
                LEFT JOIN chantier c ON c.cha_id = d.ent_chantier_id
                WHERE t.tyd_code = @type AND d.ent_cree_par = @u AND d.ent_is_reference AND d.ent_cree_le >= now() - interval '90 days'
                ORDER BY d.ent_cree_le DESC, d.ent_id DESC LIMIT 100
                """, new NpgsqlParameter("type", TypesDocument.EDap), new NpgsqlParameter("u", Utilisateur.Depuis(http).Code)).ToListAsync(ct);
            return lignes.Select(l => JsonDocument.Parse(l).RootElement).ToList();
        }).ExigeDroit("terrain/demande", ActionsDroits.Consulter);
        return g;
    }

    /// <summary>Libellé de la tâche du CRM des réserves (alerte du service de l'ordre, gardée avec les réserves suivies).</summary>
    public static string LibelleTacheReserves(string? numero, IEnumerable<string> reserves) =>
        $"Réserves à lever (réception de {numero}) : {string.Join(" ; ", reserves)}";

    private static async Task SuiteAsync(List<string> avertissements, string libelle, Func<Task> suite)
    {
        try { await suite(); }
        catch (Exception e) when (e is not OperationCanceledException) { avertissements.Add($"{libelle} : {e.Message}"); }
    }
}
