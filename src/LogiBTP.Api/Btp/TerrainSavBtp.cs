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

namespace LogiBTP.Api.Btp;

public sealed record ChantierSavSaisi(long Client, string? Adresse, string? CodePostal, string? Ville);
public sealed record InterventionSavCreee(int? ChaId, ChantierSavSaisi? Nouveau, string Objet);
public sealed record CompteRenduSav(string Constat, string Travaux, List<string>? Fournitures, bool Terminee, bool Absent, string? Nom, string? Qualite, string? Signature, string? Courriel);

/// <summary>
/// Application de terrain, lot 6 (ANALYSE-TERRAIN.md T20 ; Exécution E12, E13, E20, E22) : interventions SAV sous le
/// nœud execution/sav, refusé par défaut. Une intervention est un ordre E_SAV, toujours sur un chantier : celui du
/// client, ou un chantier « Entretien et dépannage » créé à la première intervention (affaire de gestion SAV). La
/// personne qui la crée en devient la ressource ; le serveur crée la pièce au profil système BORNE, le droit de la
/// personne venant de la route. Compte rendu : constat, travaux, fournitures, signature simple (client absent :
/// sans signature), bon édité (modèle BON_SAV) et rangé dans la GED de l'ordre avec son empreinte ; suites indépendantes
/// rendues en avertissements : étapes INTERVENTION et SIGNATURE, tâche du CRM au service de l'ordre (à facturer ou à
/// reprendre), courriel de confirmation au client par le serveur. La facture reste une transformation au bureau.
/// </summary>
public static partial class TerrainBtp
{
    public const string ModeleBonSav = "BON_SAV";
    public const string UsageCourrielSav = "SAV";
    private const string EtapeIntervention = "INTERVENTION";
    private const string EtapeSignature = "SIGNATURE";

    private sealed record OrdreSav(long EntId, string? Numero, string? Objet, DateOnly Date, string? Chantier, string? Client, string? Ville, DateOnly? Fait);
    private sealed record ChoixSav(long Id, string Libelle, string? Detail);
    private sealed record CompteRenduLu(long Id, DateOnly Le, string Constat, string Travaux, string Fournitures, bool Terminee, bool Absent, string? Signataire,
        string? Qualite, long? DgeId, string? Courriel, string Par, DateTimeOffset CreeLe);

    /// <summary>Interventions E_SAV ouvertes de la personne : ressource, service de l'ordre, ou tâche du planning sur l'ordre ou ses étapes.</summary>
    private const string SqlOrdresSav = """
        SELECT d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, d.ent_date AS date, c.cha_code || ' – ' || c.cha_libelle AS chantier,
               coalesce(d.ent_contact_client ->> 'raison_sociale', p.per_raison_sociale) AS client, c.cha_ville AS ville,
               (SELECT max(i.isv_le) FROM intervention_sav i WHERE i.isv_ent_id = d.ent_id) AS fait
        FROM v_ordres_ouverts o JOIN document d ON d.ent_id = o.ent_id JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        LEFT JOIN chantier c ON c.cha_id = d.ent_chantier_id LEFT JOIN personne p ON p.per_id = c.cha_tiers_id
        WHERE t.tyd_code = 'E_SAV' AND (d.ent_ressource ->> 'type' = 'SALARIE' AND d.ent_ressource ->> 'id' = @s::text
           OR d.ent_srv_id IS NOT NULL AND EXISTS (SELECT 1 FROM salarie sa JOIN service_membre sm ON sm.sme_ind_id = sa.sal_ind_id JOIN service sv ON sv.srv_id = d.ent_srv_id
                                                   WHERE sa.sal_id = @s AND sm.sme_srv_id IN (sv.srv_id, sv.srv_parent_id))
           OR EXISTS (SELECT 1 FROM pla_tache ta JOIN pla_affectation a ON a.aff_tac_id = ta.tac_id
                      LEFT JOIN exe_ordre_etape e ON ta.tac_origine_type = 'etape' AND e.ore_id::text = ta.tac_origine_id
                      WHERE a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text
                        AND (ta.tac_origine_type = 'ordre' AND ta.tac_origine_id = d.ent_id::text OR e.ore_ordre_id = d.ent_id)))
        ORDER BY d.ent_date DESC, d.ent_id DESC LIMIT 50
        """;

    /// <summary>Intervention lisible : ordre de la personne, ou compte rendu qu'elle a déjà rédigé (ordre terminé compris).</summary>
    private static async Task<OrdreReception> OrdreSavAsync(LogiBtpContext db, Utilisateur u, long ent, CancellationToken ct)
    {
        var redige = await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM intervention_sav WHERE isv_ent_id = @e AND isv_cree_par = @u) AS \"Value\"",
            new NpgsqlParameter("e", ent), new NpgsqlParameter("u", u.Code)).FirstAsync(ct);
        if (!redige) await ExigerOrdrePersonneAsync(db, u, ent, ct);
        var o = await LireOrdreAsync(db, ent, ct);
        if (o.Type != TypesDocument.ESav) throw ExceptionMetier.Invalide("TERRAIN_SAV_TYPE", "Cet ordre n'est pas une intervention SAV");
        return o;
    }

    private static Task<List<CompteRenduLu>> ComptesRendusAsync(LogiBtpContext db, long ent, CancellationToken ct) =>
        db.Database.SqlQueryRaw<CompteRenduLu>("""
            SELECT i.isv_id AS id, i.isv_le AS le, i.isv_constat AS constat, i.isv_travaux AS travaux, i.isv_fournitures::text AS fournitures, i.isv_terminee AS terminee,
                   i.isv_absent AS absent, s.sig_nom AS signataire, s.sig_qualite AS qualite, i.isv_dge_id AS dge_id, i.isv_courriel AS courriel,
                   i.isv_cree_par AS par, i.isv_cree_le AS cree_le
            FROM intervention_sav i LEFT JOIN signature s ON s.sig_id = i.isv_sig_id WHERE i.isv_ent_id = @e ORDER BY i.isv_id DESC
            """, new NpgsqlParameter("e", ent)).ToListAsync(ct);

    private static object CompteRendu(CompteRenduLu c) => new
    {
        id = c.Id, le = c.Le, constat = c.Constat, travaux = c.Travaux, fournitures = JsonDocument.Parse(c.Fournitures).RootElement, terminee = c.Terminee, absent = c.Absent,
        signataire = c.Signataire, qualite = c.Qualite, bon = c.DgeId is not null, courriel = c.Courriel, par = c.Par, cree_le = c.CreeLe,
    };

    /// <summary>Chantier « Entretien et dépannage » du client (E20), créé à sa première intervention, repris ensuite.</summary>
    private static async Task<int> ChantierSavAsync(LogiBtpContext db, ChantierSavSaisi n, CancellationToken ct)
    {
        var nom = await db.Database.SqlQueryRaw<string?>("SELECT per_raison_sociale AS \"Value\" FROM personne WHERE per_id = @p", new NpgsqlParameter("p", n.Client)).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Introuvable($"Client {n.Client}");
        var id = await ChantiersTechniques.CreerAsync(db, $"SAV-{n.Client}", "-S", $"Entretien et dépannage – {nom}", "SAV", "OUVERT", false, "Créé depuis une intervention SAV du terrain", ct);
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE chantier SET cha_tiers_id = coalesce(cha_tiers_id, @p), cha_adresse = coalesce(cha_adresse, @a), cha_code_postal = coalesce(cha_code_postal, @cp), cha_ville = coalesce(cha_ville, @v)
            WHERE cha_id = @c
            """, [new NpgsqlParameter("p", n.Client), SqlBtp.P("a", n.Adresse?.Trim()), SqlBtp.P("cp", n.CodePostal?.Trim()), SqlBtp.P("v", n.Ville?.Trim()), new NpgsqlParameter("c", id)], ct);
        return id;
    }

    private static RouteGroupBuilder MapSavTerrain(this RouteGroupBuilder g)
    {
        var sav = g.MapGroup("/sav");
        sav.ExigeModule(ModulesFacultatifs.Execution, "Exécution");

        // Interventions ouvertes de la personne.
        sav.MapGet("", async (HttpContext http, LogiBtpContext db, IDroits droits, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            return new
            {
                ordres = await db.Database.SqlQueryRaw<OrdreSav>(SqlOrdresSav, new NpgsqlParameter("s", s)).ToListAsync(ct),
                creer = await droits.AutoriseAsync(u, "execution/sav", ActionsDroits.Creer, ct),
            };
        });

        // Choix du chantier d'une nouvelle intervention : chantiers ouverts, clients de l'annuaire (sans le droit de l'annuaire).
        sav.MapGet("/choix", async (string? recherche, LogiBtpContext db, CancellationToken ct) =>
        {
            var motif = $"%{(recherche ?? "").Trim()}%";
            return new
            {
                chantiers = await db.Database.SqlQueryRaw<ChoixSav>("""
                    SELECT c.cha_id::bigint AS id, c.cha_code || ' ' || c.cha_libelle AS libelle, concat_ws(' · ', p.per_raison_sociale, c.cha_ville) AS detail
                    FROM chantier c LEFT JOIN personne p ON p.per_id = c.cha_tiers_id LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
                    WHERE c.cha_statut = 'OUVERT' AND NOT coalesce(c.cha_interne, FALSE) AND NOT coalesce(c.cha_depot, FALSE) AND (a.aff_nature IS DISTINCT FROM 'G' OR a.aff_code = 'SAV')
                      AND (c.cha_code ILIKE @m OR c.cha_libelle ILIKE @m OR p.per_raison_sociale ILIKE @m OR c.cha_ville ILIKE @m)
                    ORDER BY c.cha_code DESC LIMIT 30
                    """, new NpgsqlParameter("m", motif)).ToListAsync(ct),
                clients = await db.Database.SqlQueryRaw<ChoixSav>("""
                    SELECT p.per_id AS id, p.per_raison_sociale AS libelle, NULL::text AS detail FROM personne p
                    WHERE p.per_casquettes @> '["CLIENT"]'::jsonb AND p.per_raison_sociale ILIKE @m ORDER BY p.per_raison_sociale LIMIT 30
                    """, new NpgsqlParameter("m", motif)).ToListAsync(ct),
            };
        });

        // Nouvelle intervention (E13 : toujours sur un chantier) : ordre validé, la personne en est la ressource.
        sav.MapPost("", async (InterventionSavCreee c, HttpContext http, LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            var objet = (c.Objet ?? "").Trim();
            if (objet.Length == 0) throw ExceptionMetier.Invalide("TERRAIN_SAV_OBJET", "Objet de l'intervention obligatoire");
            var chantier = c.ChaId ?? (c.Nouveau is { } n ? await ChantierSavAsync(db, n, ct) : throw ExceptionMetier.Invalide("TERRAIN_CHANTIER", "Chantier obligatoire"));
            var systeme = new Utilisateur(u.Code, Profils.Borne);
            var cree = await documents.Creer(new CreationDocument { EntTydId = await TypesDocumentBtp.IdAsync(db, TypesDocument.ESav, ct), EntObjet = objet.Length > 200 ? objet[..200] : objet }, systeme, ct);
            var id = cree.Document.EntId;
            var d = await documents.Charger(id, ct);
            d.Document.EntChantierId = chantier;
            d.Document.EntAffaireId = await db.Database.SqlQueryRaw<int?>("SELECT cha_aff_id AS \"Value\" FROM chantier WHERE cha_id = @c", new NpgsqlParameter("c", chantier)).FirstAsync(ct);
            d.Document.EntAdresseLivraison ??= await AdressesDocument.Chantier(db, chantier, ct);
            var client = await db.Database.SqlQueryRaw<long?>("SELECT cha_tiers_id AS \"Value\" FROM chantier WHERE cha_id = @c", new NpgsqlParameter("c", chantier)).FirstAsync(ct);
            if (client is long per) d.Document.EntContactClient ??= await ContactsDocument.Instantane(db, per, null, ct);
            if (!d.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
                d.Lignes.Add(new DocumentLigneBtp { LigId = -1, LigEntId = id, LigOrdre = 1, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
            await documents.Enregistrer(id, d, systeme, ct);
            var version = await db.Database.SqlQueryRaw<int>("SELECT ent_version AS \"Value\" FROM document WHERE ent_id = @e", new NpgsqlParameter("e", id)).FirstAsync(ct);
            await documents.Valider(id, new DemandeVersion { EntVersion = version }, systeme, ct);
            await db.Database.ExecuteSqlRawAsync("UPDATE document SET ent_ressource = jsonb_build_object('type', 'SALARIE', 'id', @s::text) WHERE ent_id = @e",
                [new NpgsqlParameter("s", s), new NpgsqlParameter("e", id)], ct);
            return new { ent_id = id, numero = await db.Database.SqlQueryRaw<string?>("SELECT ent_numero AS \"Value\" FROM document WHERE ent_id = @e", new NpgsqlParameter("e", id)).FirstAsync(ct) };
        });

        sav.MapGet("/{ent:long}", async (long ent, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var o = await OrdreSavAsync(db, Utilisateur.Depuis(http), ent, ct);
            return new
            {
                ordre = new { id = o.Id, numero = o.Numero, objet = o.Objet, type = o.Type, chantier = o.Chantier },
                client = new { nom = o.Client, contact = o.Contact, courriel = o.Courriel },
                adresse = await db.Database.SqlQueryRaw<string?>("""
                    SELECT concat_ws(' ', a ->> 'ligne1', a ->> 'ligne2', a ->> 'code_postal', a ->> 'ville') AS "Value"
                    FROM (SELECT ent_adresse_livraison -> 'adresse' AS a FROM document WHERE ent_id = @e) x
                    """, new NpgsqlParameter("e", ent)).FirstOrDefaultAsync(ct),
                comptes_rendus = (await ComptesRendusAsync(db, ent, ct)).Select(CompteRendu),
            };
        });

        sav.MapPost("/{ent:long}", async (long ent, CompteRenduSav r, HttpContext http, LogiBtpContext db, IServiceProvider services, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var o = await OrdreSavAsync(db, u, ent, ct);
            if (string.IsNullOrWhiteSpace(r.Constat) || string.IsNullOrWhiteSpace(r.Travaux)) throw ExceptionMetier.Invalide("TERRAIN_SAV_TEXTE", "Constat et travaux obligatoires");
            var image = r.Absent ? null : ImageSignature(r.Signature);
            if (!r.Absent && (image is null || string.IsNullOrWhiteSpace(r.Nom))) throw ExceptionMetier.Invalide("TERRAIN_SIGNATURE", "Nom et signature du client obligatoires (sinon : client absent)");
            var fournitures = (r.Fournitures ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
            var courriel = string.IsNullOrWhiteSpace(r.Courriel) ? null : r.Courriel.Trim();

            long? sigId = null;
            long isvId;
            await using (var tx = await db.Database.BeginTransactionAsync(ct))
            {
                if (image is not null)
                    sigId = (await db.Database.SqlQueryRaw<long>("""
                        INSERT INTO signature (sig_type_element, sig_id_element, sig_nom, sig_qualite, sig_image, sig_par)
                        VALUES ('document', @e::text, @n, @q, @i, @u) RETURNING sig_id AS "Value"
                        """, new NpgsqlParameter("e", ent), new NpgsqlParameter("n", r.Nom!.Trim()), SqlBtp.P("q", r.Qualite?.Trim()),
                        new NpgsqlParameter("i", NpgsqlTypes.NpgsqlDbType.Bytea) { Value = image }, new NpgsqlParameter("u", u.Code)).ToListAsync(ct))[0];
                isvId = (await db.Database.SqlQueryRaw<long>("""
                    INSERT INTO intervention_sav (isv_ent_id, isv_constat, isv_travaux, isv_fournitures, isv_terminee, isv_absent, isv_sig_id, isv_courriel, isv_cree_par)
                    VALUES (@e, @c, @t, @f::jsonb, @fin, @abs, @s, @m, @u) RETURNING isv_id AS "Value"
                    """, new NpgsqlParameter("e", ent), new NpgsqlParameter("c", r.Constat.Trim()), new NpgsqlParameter("t", r.Travaux.Trim()),
                    new NpgsqlParameter("f", JsonSerializer.Serialize(fournitures)), new NpgsqlParameter("fin", r.Terminee), new NpgsqlParameter("abs", r.Absent),
                    SqlBtp.P("s", sigId, NpgsqlTypes.NpgsqlDbType.Bigint), SqlBtp.P("m", courriel), new NpgsqlParameter("u", u.Code)).ToListAsync(ct))[0];
                await tx.CommitAsync(ct);
            }

            var avertissements = new List<string>();
            long? dge = null;
            try
            {
                var (pdf, _, _) = await services.GetRequiredService<ServiceEdition>().Pdf(services, new DemandeEdition("document", ent.ToString(CultureInfo.InvariantCulture), ModeleBonSav), false, ServeurEditions, ct);
                var empreinte = Convert.ToHexStringLower(SHA256.HashData(pdf.Octets));
                await using var flux = new MemoryStream(pdf.Octets);
                var nom = $"Bon-SAV-{(o.Numero ?? ent.ToString(CultureInfo.InvariantCulture))}-{DateTime.Today:yyyyMMdd}.pdf";
                var fichier = new FormFile(flux, 0, pdf.Octets.Length, "fichier", nom) { Headers = new HeaderDictionary(), ContentType = "application/pdf" };
                var d = await services.GetRequiredService<ServiceGed>().DeposerFichier(fichier, new MetaDepot
                {
                    Titre = $"Bon d'intervention {o.Numero} du {DateTime.Today:dd/MM/yyyy}", Categorie = CategoriesGed.BonSav, TypeElement = o.Type,
                    IdElement = o.Groupe.ToString(CultureInfo.InvariantCulture), Auteur = u.Code,
                    Resume = (sigId is null ? "Client absent : bon non signé" : $"Signé par {r.Nom!.Trim()}") + $" ; empreinte SHA-256 {empreinte}",
                }, ServeurEditions, ct);
                dge = d.Id;
                if (sigId is long sig)
                    await db.Database.ExecuteSqlRawAsync("UPDATE signature SET sig_empreinte = @h, sig_dge_id = @d WHERE sig_id = @s",
                        [new NpgsqlParameter("h", empreinte), new NpgsqlParameter("d", d.Id), new NpgsqlParameter("s", sig)], ct);
                await db.Database.ExecuteSqlRawAsync("UPDATE intervention_sav SET isv_dge_id = @d WHERE isv_id = @i", [new NpgsqlParameter("d", d.Id), new NpgsqlParameter("i", isvId)], ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                avertissements.Add($"Bon non édité : {e.Message}");
            }

            // Étapes validées sous le droit SAV de la personne.
            async Task ValiderEtapeAsync(string code)
            {
                var etapes = services.GetRequiredService<ServiceEtapes>();
                await etapes.InitialiserAsync(ent, ct);
                if (await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM exe_ordre_etape WHERE ore_ordre_id = @e AND ore_code = @c AND ore_valide_le IS NULL) AS \"Value\"",
                    new NpgsqlParameter("e", ent), new NpgsqlParameter("c", code)).FirstAsync(ct))
                    await etapes.ActionAsync(ent, code, new ActionEtape("VALIDER"), u, ct, droitVerifie: true);
            }
            if (r.Terminee)
            {
                await SuiteAsync(avertissements, "Étape « Intervention » à valider par le bureau", () => ValiderEtapeAsync(EtapeIntervention));
                if (sigId is not null) await SuiteAsync(avertissements, "Étape « Signature » à valider par le bureau", () => ValiderEtapeAsync(EtapeSignature));
            }
            if (o.SrvId is int srv && await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.Crm, ct))
                await SuiteAsync(avertissements, "Tâche du bureau non créée", async () =>
                {
                    var liens = new List<LienSaisi> { new("document", o.Groupe.ToString(CultureInfo.InvariantCulture), true) };
                    if (o.ChaId is int c) liens.Add(new(TypesFiche.Chantier, c.ToString(CultureInfo.InvariantCulture)));
                    var texte = r.Terminee ? $"Intervention {o.Numero} terminée : à facturer" : $"Intervention {o.Numero} à reprendre : {r.Travaux.Trim()}";
                    await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie(NatureNote.Tache, EtatNote.AFaire, null, srv, texte, null, null, DateTimeOffset.UtcNow.AddDays(7), null, false, false, false, liens, null), u, ct);
                });
            if (courriel is not null && dge is long piece)
                await SuiteAsync(avertissements, "Courriel de confirmation non envoyé", async () =>
                    await services.GetRequiredService<ServiceEnvoiMail>().EnvoyerAutomatiqueAsync(new EnvoiAutomatique(UsageCourrielSav,
                        [new LogiBTP.Mail.Web.DestinataireSaisi(courriel, o.Contact ?? o.Client)], $"Confirmation d'intervention – {o.Numero}",
                        $"<p>Bonjour,</p><p>Vous trouverez ci-joint le bon de notre intervention ({System.Net.WebUtility.HtmlEncode(o.Objet ?? o.Numero ?? "")}).</p><p>Cordialement.</p>",
                        u.Code, TypeElement: o.Type, IdElement: o.Groupe.ToString(CultureInfo.InvariantCulture), Pieces: [$"ged:{piece}"]), ct));
            return new { compte_rendu = (await ComptesRendusAsync(db, ent, ct)).Select(CompteRendu).First(), avertissements };
        });

        // Bon signé (contenu de la GED, mêmes droits que l'intervention).
        sav.MapGet("/{ent:long}/bon/{isv:long}", async (long ent, long isv, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await OrdreSavAsync(db, u, ent, ct);
            var version = await db.Database.SqlQueryRaw<long?>("""
                SELECT (SELECT v.vge_id FROM version_ged v WHERE v.vge_document = i.isv_dge_id ORDER BY v.vge_numero DESC LIMIT 1) AS "Value"
                FROM intervention_sav i WHERE i.isv_id = @i AND i.isv_ent_id = @e
                """, new NpgsqlParameter("i", isv), new NpgsqlParameter("e", ent)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("Bon d'intervention");
            return await ged.Contenu(version, false, http, u, ct);
        });

        // Photos de l'intervention, dans la GED de l'ordre.
        sav.MapPost("/{ent:long}/photos", async (long ent, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var o = await OrdreSavAsync(db, u, ent, ct);
            var form = await http.Request.ReadFormAsync(ct);
            var fichiers = form.Files.GetFiles("fichiers");
            if (fichiers.Count == 0) throw ExceptionMetier.Invalide("FICHIER", "Aucune photo");
            if (fichiers.Any(f => !(f.ContentType ?? "").StartsWith("image/", StringComparison.OrdinalIgnoreCase))) throw ExceptionMetier.Invalide("TERRAIN_PHOTO", "Images seulement");
            var commentaire = form["commentaire"].ToString();
            var deposees = new List<long>();
            foreach (var f in fichiers)
                deposees.Add((await ged.DeposerFichier(f, new MetaDepot
                {
                    Titre = $"Photo · {o.Numero} · {DateTime.Now:dd/MM/yyyy HH:mm}", Categorie = CategoriesGed.Photo, TypeElement = o.Type,
                    IdElement = o.Groupe.ToString(CultureInfo.InvariantCulture), Auteur = u.Code, Resume = string.IsNullOrWhiteSpace(commentaire) ? null : commentaire.Trim(),
                }, ServeurEditions, ct)).Id);
            return new { deposees };
        }).DisableAntiforgery();
        return g;
    }
}
