using System.Globalization;
using System.Net;
using System.Text.Json;
using LogiBTP.Crm.Web;
using LogiBTP.Crm;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Ged.Web;
using LogiBTP.Mail;
using LogiBTP.Mail.Web;
using LogiBTP.Notifications.Web;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using DestinataireSaisi = LogiBTP.Mail.Web.DestinataireSaisi;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Mail : envoi depuis un document (variables des modèles, destinataires = contact figé et
/// intervenants, pièces de la GED marquées « à envoyer »), pièces jointes lues dans la GED, suites d'un envoi (courriel
/// rangé en GED avec l'élément, pièces « envoyées » : étape ENVOI et marque retirée, document passé ENVOYE s'il est
/// approuvé, note du suivi si le CRM est actif), courriel d'un utilisateur, administrateurs, signaux → notifications.
/// </summary>
public sealed class SpecialisationMailBtp(LogiBtpContext db, IServiceProvider services, ServiceNotification notifications, ModulesSociete modules,
    ILogger<SpecialisationMailBtp> journal) : SpecialisationMail
{
    /// <summary>Utilisateur des traitements de fond (compte de service, db/206) : accès de la GED d'un administrateur.</summary>
    public static readonly Utilisateur Fond = new(ServiceReceptionMail.Fond, "ADMIN");

    /// <summary>Types publiés (préférences de notification).</summary>
    public static readonly TypeNotification[] Types =
    [
        new("mail", "ERREUR", "Courriels non envoyés"), new("mail", "PARTI", "Courriels partis après une attente"), new("mail", "LOT", "Envois groupés terminés"),
        new("mail", "BLOCAGE", "Messagerie : envois suspendus par l'hébergeur"), new("mail", "QUOTA", "Messagerie : quota journalier"),
        new("mail", "COMPTE", "Messagerie : compte en erreur"), new("mail", "VOLUME", "Messagerie : envois inhabituels"),
        new("mail", "NON_REMIS", "Courriels non remis (avis de non-remise)"), new("mail", "ALERTE", "Courriels reçus à traiter"),
    ];

    private sealed record DocumentMail(long EntId, string? EntNumero, DateOnly EntDate, string? EntObjet, DateOnly? EntDateValidite, decimal EntTotalHt,
        decimal EntTotalTtc, decimal EntNetAPayer, long? EntGroupeId, string TydCode, string TydLibelle, string TydFamille, string? Intervenants,
        string? ContactClient, string? Redacteur);

    private sealed record PieceGed(long Id, string Titre, string NomFichier, long Taille);

    private sealed record DiffusionMail(long DifId, string DifNumero, DateOnly DifDate, string DifObjet, int DifDelaiVisaJours);
    private sealed record DestinataireDiffusion(long DfdTiersId, long? DfdIndId, bool DfdAttendVisa);

    /// <summary>
    /// Bordereau de diffusion du CRM : destinataires « par courriel » du bordereau (courriel du contact, sinon du tiers),
    /// pièces = fichiers des indices de plans et autres pièces de la GED, toutes cochées.
    /// </summary>
    private async Task<ElementMail?> DecrireDiffusionAsync(string id, CancellationToken ct)
    {
        if (!long.TryParse(id, out var difId)) return null;
        var d = await db.Database.SqlQueryRaw<DiffusionMail>(
            "SELECT dif_id, dif_numero, dif_date, dif_objet, dif_delai_visa_jours FROM crm_diffusion WHERE dif_id = @id", new NpgsqlParameter("id", difId)).FirstOrDefaultAsync(ct);
        if (d is null) return null;
        var destinataires = new List<DestinatairePropose>();
        foreach (var x in await db.Database.SqlQueryRaw<DestinataireDiffusion>(
            "SELECT dfd_tiers_id, dfd_ind_id, dfd_attend_visa FROM crm_diffusion_destinataire WHERE dfd_dif_id = @id AND dfd_mode = 'COURRIEL' ORDER BY dfd_id",
            new NpgsqlParameter("id", difId)).ToListAsync(ct))
        {
            var inst = await ContactsDocument.Instantane(db, x.DfdTiersId, x.DfdIndId, ct);
            if (inst?.RootElement is not { } r || Texte(r, "email") is not { } email || destinataires.Any(p => p.Adresse.Equals(email, StringComparison.OrdinalIgnoreCase))) continue;
            var nom = r.TryGetProperty("contact", out var c) && c.ValueKind == JsonValueKind.Object ? Texte(c, "nom") : null;
            destinataires.Add(new DestinatairePropose(email, nom ?? Texte(r, "raison_sociale"), x.DfdAttendVisa ? "visa attendu" : "diffusion", true, x.DfdTiersId, x.DfdIndId));
        }
        var pieces = await db.Database.SqlQueryRaw<PieceGed>("""
            SELECT g.dge_id AS id, g.dge_titre AS titre, v.vge_nom_fichier AS nom_fichier, v.vge_taille AS taille
            FROM crm_diffusion_piece p LEFT JOIN crm_plan_indice i ON i.pin_id = p.dfp_pin_id
            JOIN document_ged g ON g.dge_id = coalesce(p.dfp_dge_id, i.pin_dge_id) AND NOT g.dge_supprime
            JOIN LATERAL (SELECT * FROM version_ged v WHERE v.vge_document = g.dge_id ORDER BY v.vge_numero DESC LIMIT 1) v ON TRUE
            WHERE p.dfp_dif_id = @id ORDER BY p.dfp_id
            """, new NpgsqlParameter("id", difId)).ToListAsync(ct);
        var libelle = $"Bordereau {d.DifNumero}";
        var variables = new Dictionary<string, string?>
        {
            ["numero"] = d.DifNumero, ["type"] = "Bordereau de diffusion", ["objet"] = d.DifObjet, ["date"] = d.DifDate.ToString("dd/MM/yyyy"),
            ["document"] = $"{libelle} – {d.DifObjet}", ["validite"] = d.DifDate.AddDays(d.DifDelaiVisaJours).ToString("dd/MM/yyyy"),
        };
        return new ElementMail("crm_diffusion", id, $"{libelle} – {d.DifObjet}", $"/crm/diffusion/{difId}", "CRM", "crm_diffusion", variables, destinataires,
            pieces.Select(p => new PieceProposee($"ged:{p.Id}", p.NomFichier, p.Taille, true)).ToList());
    }

    /// <summary>
    /// Demande de pièces à un sous-traitant (module Sous-traitance, lot 2) : élément « st_pieces », identifiant
    /// « marche:&lt;id&gt; » ou « personne:&lt;id&gt; » ; pièces manquantes, expirées ou à renouveler en variables ; destinataire :
    /// courriel du sous-traitant.
    /// </summary>
    private async Task<ElementMail?> DecrirePiecesAsync(string id, CancellationToken ct)
    {
        var p = id.Split(':', 2);
        if (p.Length != 2 || !long.TryParse(p[1], out var n)) return null;
        var st = services.GetRequiredService<LogiBTP.SousTraitance.Web.ServiceSousTraitance>();
        long? tiers;
        string libelle;
        LogiBTP.SousTraitance.Conformite c;
        if (p[0] == TypesFiche.Marche)
        {
            var m = await db.Database.SqlQueryRaw<MarchePieces>("SELECT mar_tiers_id AS tiers, mar_code || ' – ' || mar_libelle AS libelle FROM marche WHERE mar_id = @m",
                new NpgsqlParameter("m", (int)n)).FirstOrDefaultAsync(ct);
            if (m is null) return null;
            (tiers, libelle, c) = (m.Tiers, $"Marché {m.Libelle}", await st.ConformiteMarcheAsync((int)n, ct));
        }
        else
        {
            (tiers, libelle, c) = (n, "Pièces annexes", await st.ConformiteTiersAsync(n, ct));
        }
        var destinataires = new List<DestinatairePropose>();
        string? nom = null;
        if (tiers is long t && await ContactsDocument.Instantane(db, t, null, ct) is { } inst)
        {
            nom = Texte(inst.RootElement, "raison_sociale");
            if (Texte(inst.RootElement, "email") is { } email) destinataires.Add(new DestinatairePropose(email, nom, "sous-traitant", true, t));
        }
        string Liste(IEnumerable<string> l) => string.Join(", ", l) is { Length: > 0 } x ? x : "aucune";
        var variables = new Dictionary<string, string?>
        {
            ["tiers"] = nom, ["document"] = libelle, ["objet"] = libelle,
            ["pieces_manquantes"] = Liste(c.Pieces.Where(x => x.Etat is "MANQUANTE" or "EXPIREE" && x.Obligatoire).Select(x => x.Libelle)),
            ["pieces_a_renouveler"] = Liste(c.Pieces.Where(x => x.Etat == "A_ECHEANCE").Select(x => $"{x.Libelle} (jusqu'au {x.Fin:dd/MM/yyyy})")),
        };
        return new ElementMail("st_pieces", id, $"{libelle} : pièces à fournir", p[0] == TypesFiche.Marche ? $"/fiche/marche/{n}" : $"/fiche/personne/{n}", "DOCUMENT_ACHAT", "st_pieces",
            variables, destinataires, []);
    }

    private sealed record MarchePieces(long? Tiers, string Libelle);

    public override async Task<ElementMail?> DecrireAsync(string type, string id, Utilisateur u, CancellationToken ct)
    {
        if (type == "crm_diffusion") return await modules.EstActifAsync(ModulesFacultatifs.Crm, ct) ? await DecrireDiffusionAsync(id, ct) : null;
        if (type == "st_pieces") return await modules.EstActifAsync(ModulesFacultatifs.SousTraitance, ct) ? await DecrirePiecesAsync(id, ct) : null;
        if (type != "document" || !long.TryParse(id, out var entId)) return null;
        var d = await db.Database.SqlQueryRaw<DocumentMail>("""
            SELECT e.ent_id, e.ent_numero, e.ent_date, e.ent_objet, e.ent_date_validite, e.ent_total_ht, e.ent_total_ttc, e.ent_net_a_payer, e.ent_groupe_id,
                   t.tyd_code, t.tyd_libelle, t.tyd_famille, e.ent_intervenants::text AS intervenants, e.ent_contact_client::text AS contact_client,
                   nullif(trim(concat_ws(' ', r.ind_prenom, r.ind_nom)), '') AS redacteur
            FROM document e JOIN type_document t ON t.tyd_id = e.ent_tyd_id LEFT JOIN individu r ON r.ind_id = e.ent_redacteur_id
            WHERE e.ent_id = @id
            """, new NpgsqlParameter("id", entId)).FirstOrDefaultAsync(ct);
        if (d is null) return null;
        // Globalisation invariante (Directory.Build.props) : séparateurs français explicites.
        var fr = new NumberFormatInfo { NumberGroupSeparator = " ", NumberDecimalSeparator = "," };
        string Montant(decimal m) => m.ToString("#,##0.00", fr) + " €";
        var destinataires = new List<DestinatairePropose>();
        string? tiers = null;
        if (d.ContactClient is { } cc && JsonDocument.Parse(cc).RootElement is { ValueKind: JsonValueKind.Object } contact)
        {
            tiers = Texte(contact, "raison_sociale");
            var nom = contact.TryGetProperty("contact", out var ct2) && ct2.ValueKind == JsonValueKind.Object ? Texte(ct2, "nom") : null;
            if (Texte(contact, "email") is { } email) destinataires.Add(new DestinatairePropose(email, nom ?? tiers, FamillesDocument.EstAchat(d.TydFamille) ? "Fournisseur" : "Client", true));
        }
        foreach (var i in JsonDocument.Parse(d.Intervenants ?? "[]").RootElement.EnumerateArray())
        {
            if (!i.TryGetProperty("per_id", out var per) || per.ValueKind != JsonValueKind.Number) continue;
            long? ind = i.TryGetProperty("ind_id", out var x) && x.ValueKind == JsonValueKind.Number ? x.GetInt64() : null;
            var inst = await ContactsDocument.Instantane(db, per.GetInt64(), ind, ct);
            if (inst?.RootElement is not { } r || Texte(r, "email") is not { } email || destinataires.Any(p => p.Adresse.Equals(email, StringComparison.OrdinalIgnoreCase))) continue;
            var fonction = Texte(i, "fonction");
            tiers ??= Texte(i, "tiers");
            destinataires.Add(new DestinatairePropose(email, Texte(i, "contact") ?? Texte(i, "tiers"), fonction?.ToLowerInvariant(),
                destinataires.Count == 0 && fonction is "CLIENT" or "FOURNISSEUR", per.GetInt64(), ind));
        }
        var element = (d.EntGroupeId ?? d.EntId).ToString();
        var pieces = await db.Database.SqlQueryRaw<PieceGed>("""
            SELECT g.dge_id AS id, g.dge_titre AS titre, v.vge_nom_fichier AS nom_fichier, v.vge_taille AS taille
            FROM document_ged g JOIN LATERAL (SELECT * FROM version_ged v WHERE v.vge_document = g.dge_id ORDER BY v.vge_numero DESC LIMIT 1) v ON TRUE
            WHERE g.dge_type_element = @type AND g.dge_id_element = @id AND g.dge_a_envoyer AND NOT g.dge_supprime AND g.dge_parent_id IS NULL
            ORDER BY g.dge_id DESC
            """, new NpgsqlParameter("type", d.TydCode), new NpgsqlParameter("id", element)).ToListAsync(ct);
        var libelle = $"{d.TydLibelle} {d.EntNumero ?? $"(brouillon {d.EntId})"}";
        var variables = new Dictionary<string, string?>
        {
            ["numero"] = d.EntNumero, ["type"] = d.TydLibelle, ["objet"] = d.EntObjet, ["date"] = d.EntDate.ToString("dd/MM/yyyy"),
            ["validite"] = d.EntDateValidite?.ToString("dd/MM/yyyy"), ["montant_ht"] = Montant(d.EntTotalHt), ["montant_ttc"] = Montant(d.EntTotalTtc),
            ["net_a_payer"] = Montant(d.EntNetAPayer), ["tiers"] = tiers, ["contact"] = destinataires.FirstOrDefault()?.Nom, ["redacteur"] = d.Redacteur,
            ["document"] = libelle,
        };
        return new ElementMail("document", id, libelle, $"/document/{d.EntId}", FamillesDocument.EstAchat(d.TydFamille) ? "DOCUMENT_ACHAT" : "DOCUMENT_VENTE", d.TydCode, variables,
            destinataires, pieces.Select(p => new PieceProposee($"ged:{p.Id}", p.NomFichier, p.Taille, true)).ToList());
    }

    public override async Task<List<PieceInfo>> PiecesAsync(IReadOnlyList<string> references, Utilisateur u, CancellationToken ct)
    {
        var ged = services.GetRequiredService<ServiceGed>();
        var res = new List<PieceInfo>();
        foreach (var r in references)
        {
            if (!r.StartsWith("ged:") || !long.TryParse(r[4..], out var id)) continue;
            try
            {
                var d = await ged.Document(id, u, ct);
                if (d.Version is { } v && !d.Supprime) res.Add(new PieceInfo(r, v.NomFichier, v.TypeMime, v.Taille));
            }
            catch (ExceptionMetier)
            {
                // Pièce inaccessible à l'utilisateur : refusée par le contrôle du module.
            }
        }
        return res;
    }

    public override async Task<PieceContenu?> LirePieceAsync(string reference, CancellationToken ct)
    {
        if (!reference.StartsWith("ged:") || !long.TryParse(reference[4..], out var id)) return null;
        var c = await services.GetRequiredService<ServiceGed>().LireContenu(id, Fond, ct);
        return c is { } x ? new PieceContenu(x.NomFichier, x.TypeMime ?? "application/octet-stream", x.Octets) : null;
    }

    /// <summary>Suites d'un envoi, chacune indépendante (une suite en échec est journalisée sans empêcher les autres).</summary>
    public override async Task<long?> ApresEnvoiAsync(CourrielEnvoye c, CancellationToken ct)
    {
        var ged = services.GetRequiredService<ServiceGed>();
        var (typeGed, idGed, entId) = await ElementGedAsync(c.TypeElement, c.IdElement, ct);
        long? depot = null;
        await Tenter("courriel en GED", async () =>
        {
            await using var flux = new MemoryStream(c.Eml);
            var nom = string.Concat((c.Objet.Length == 0 ? "courriel" : c.Objet).Split(Path.GetInvalidFileNameChars()));
            var fichier = new FormFile(flux, 0, c.Eml.Length, "fichier", $"{(nom.Length > 80 ? nom[..80] : nom)}.eml")
            {
                Headers = new HeaderDictionary(), ContentType = "message/rfc822",
            };
            var mail = JsonSerializer.SerializeToElement(new
            {
                objet = c.Objet, de = c.Expediteur, a = string.Join(", ", c.A), cc = string.Join(", ", c.Cc), date = c.Le.ToString("O"),
                message = ConstructionMail.Texte(c.CorpsHtml), sens = "E",
            });
            var d = await ged.DeposerFichier(fichier, new MetaDepot
            {
                Titre = c.Objet, Categorie = CategoriesGed.Mail, Nature = "mail", TypeElement = typeGed, IdElement = idGed, Auteur = c.Auteur,
                DateDocument = c.Le.ToString("yyyy-MM-dd"), Mail = mail, Confidentialite = "INTERNE", MotsCles = ["courriel", "envoi"],
                Resume = $"Courriel envoyé par « {c.Expediteur} » à {c.A.Count + c.Cc.Count + c.Cci.Count} destinataire(s)",
            }, new Utilisateur(c.Auteur, "ADMIN"), ct);
            depot = d.Id;
        });
        foreach (var r in c.Pieces.Where(r => r.StartsWith("ged:")))
        {
            if (!long.TryParse(r[4..], out var id)) continue;
            await Tenter($"pièce {r} envoyée", async () =>
            {
                await ged.Modifier(id, new Dictionary<string, JsonElement> { ["a_envoyer"] = JsonSerializer.SerializeToElement(false) }, Fond, ct);
                try
                {
                    await ged.Etape(id, new DemandeEtape { Etape = "ENVOI", Commentaire = $"Envoyé par courriel : {c.Objet}" }, Fond, ct);
                }
                catch (ExceptionMetier e) when (e.Code == "COFFRE")
                {
                    // Pièce au coffre-fort : verrouillée, seule la marque « à envoyer » change.
                }
            });
        }
        if (entId is long ent)
        {
            await Tenter("document envoyé", async () =>
            {
                var etat = await db.Documents.AsNoTracking().Where(x => x.EntId == ent).Select(x => new { x.EntVerrouille, x.EntApprouveLe, x.EntEnvoyeLe }).FirstAsync(ct);
                if (etat.EntVerrouille && etat.EntApprouveLe is not null && etat.EntEnvoyeLe is null)
                    await services.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>().Envoyer(ent, new Utilisateur(c.Auteur, "ADMIN"), ct);
            });
        }
        if (c.TypeElement is not null && c.IdElement is not null && await modules.EstActifAsync(ModulesFacultatifs.Crm, ct))
        {
            await Tenter("note du suivi", async () =>
            {
                var lien = c.TypeElement == "document" && idGed is not null ? new LienSaisi("document", idGed, true) : new LienSaisi(c.TypeElement, c.IdElement, true);
                var html = $"<p>À : {WebUtility.HtmlEncode(string.Join(", ", c.A.Concat(c.Cc)))}</p>{c.CorpsHtml}";
                await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie(NatureNote.Action, EtatNote.Memo, null, null,
                    $"📧 Courriel envoyé : {(c.Objet.Length > 180 ? c.Objet[..180] : c.Objet)}", html, null, null, null, false, false, false, [lien], null),
                    new Utilisateur(c.Auteur, "ADMIN"), ct);
            });
        }
        return depot;
    }

    /// <summary>Élément GED d'un élément du Mail : un document y est désigné par le code de son type et son groupe d'indices.</summary>
    private async Task<(string? Type, string? Id, long? EntId)> ElementGedAsync(string? type, string? id, CancellationToken ct)
    {
        if (type != "document" || !long.TryParse(id, out var entId)) return (type, id, null);
        var d = await (from e in db.Documents.AsNoTracking() join t in db.TypesDocument.AsNoTracking() on e.EntTydId equals t.TydId
                       where e.EntId == entId select new { t.TydCode, e.EntGroupeId }).FirstOrDefaultAsync(ct);
        return d is null ? (null, null, null) : (d.TydCode, (d.EntGroupeId ?? entId).ToString(), entId);
    }

    private async Task Tenter(string quoi, Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning(e, "Mail : suite de l'envoi non faite ({Quoi})", quoi);
        }
    }

    public override async Task<string?> CourrielUtilisateurAsync(string utilisateur, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<string>("""
            SELECT c.coo_valeur AS "Value" FROM individu i JOIN usage_coordonnee u ON u.uco_ind_id = i.ind_id JOIN coordonnee c ON c.coo_id = u.uco_coo_id
            WHERE lower(i.ind_utilisateur) = lower(@u) AND c.coo_nature = 'EMAIL' ORDER BY u.uco_principal DESC, c.coo_id LIMIT 1
            """, new NpgsqlParameter("u", utilisateur)).FirstOrDefaultAsync(ct);

    public override async Task<IReadOnlyList<string>> AdministrateursAsync(CancellationToken ct) =>
        await db.Database.SqlQueryRaw<string>("SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = 'ADMIN'").ToListAsync(ct);

    public override Task SignalerAsync(SignalMail s, IReadOnlyList<string> destinataires, CancellationToken ct) =>
        notifications.PublierAsync(destinataires.Select(d => new NouvelleNotification(d, "mail", s.Genre, s.Titre, s.Texte, s.Niveau, s.Url, s.TypeElement,
            s.IdElement, s.Cle)), ct);

    private static string? Texte(JsonElement e, string nom) =>
        e.TryGetProperty(nom, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString()) ? v.GetString() : null;

    // --- Réception (lot 3) ---

    public override async Task<IReadOnlyList<string>> ServicesAsync(string utilisateur, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT s.srv_code AS "Value" FROM service s JOIN service_membre m ON m.sme_srv_id = s.srv_id
            JOIN individu i ON i.ind_id = m.sme_ind_id WHERE lower(i.ind_utilisateur) = lower(@u)
            """, new NpgsqlParameter("u", utilisateur)).ToListAsync(ct);

    /// <summary>
    /// Courriel reçu rangé dans la GED de sa boîte (élément `mail_compte`), confidentiel : visible des administrateurs et des
    /// membres des services du compte (accès nominatifs) ; pièces jointes en documents enfants.
    /// </summary>
    public override async Task<DepotRecu> RecevoirAsync(CourrielRecu c, CancellationToken ct)
    {
        var ged = services.GetRequiredService<ServiceGed>();
        var acces = (await db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT i.ind_utilisateur AS "Value" FROM mail_compte c JOIN service s ON s.srv_code = ANY(c.mco_services)
            JOIN service_membre m ON m.sme_srv_id = s.srv_id JOIN individu i ON i.ind_id = m.sme_ind_id
            WHERE c.mco_id = @id AND i.ind_utilisateur IS NOT NULL
            """, new NpgsqlParameter("id", c.Compte)).ToListAsync(ct)).ToArray();
        var mail = JsonSerializer.SerializeToElement(new
        {
            objet = c.Objet, de = c.De is null ? null : c.De.Nom is null ? c.De.Adresse : $"{c.De.Nom} <{c.De.Adresse}>", a = string.Join(", ", c.A),
            cc = string.Join(", ", c.Cc), date = c.Date?.ToString("O"), message = c.Texte, sens = "R",
        });
        var depot = await DeposerAsync(ged, c.Eml, NomFichier(c.Objet, ".eml"), "message/rfc822", new MetaDepot
        {
            Titre = c.Objet.Length == 0 ? "(sans objet)" : c.Objet, Categorie = CategoriesGed.Mail, Nature = "mail", TypeElement = "mail_compte", IdElement = c.Compte.ToString(),
            Auteur = Fond.Code, DateDocument = (c.Date ?? DateTimeOffset.UtcNow).ToString("yyyy-MM-dd"), Mail = mail, Confidentialite = "CONFIDENTIEL",
            AccesUtilisateurs = acces, MotsCles = ["courriel", "reception"],
        }, ct);
        var pieces = new List<PieceInfo>();
        foreach (var p in c.Pieces)
        {
            var enfant = await DeposerAsync(ged, p.Octets, p.Nom, p.Type, new MetaDepot
            {
                Titre = p.Nom, Categorie = CategoriesGed.Mail, TypeElement = "mail_compte", IdElement = c.Compte.ToString(), ParentId = depot, Auteur = Fond.Code,
                Confidentialite = "CONFIDENTIEL", AccesUtilisateurs = acces,
            }, ct);
            pieces.Add(new PieceInfo($"ged:{enfant}", p.Nom, p.Type, p.Octets.Length));
        }
        return new DepotRecu(depot, pieces, await TextePiecesAsync(ged, pieces, ct));
    }

    /// <summary>Texte des pièces jointes extrait par la GED (PDF, bureautique…) pour la reconnaissance ; une pièce illisible est ignorée.</summary>
    private async Task<string> TextePiecesAsync(ServiceGed ged, List<PieceInfo> pieces, CancellationToken ct)
    {
        var ids = pieces.Select(p => long.Parse(p.Reference[4..])).ToList();
        foreach (var id in ids) await Tenter($"texte de la pièce {id}", () => ged.Indexer(id, Fond, ct));
        var textes = await db.Database.SqlQueryRaw<string>("SELECT coalesce(dge_texte_contenu, '') AS \"Value\" FROM document_ged WHERE dge_id = ANY(@ids)",
            new NpgsqlParameter("ids", ids.ToArray())).ToListAsync(ct);
        var t = string.Join('\n', textes);
        return t.Length > 50_000 ? t[..50_000] : t;
    }

    /// <summary>Domaines de messageries publiques : un expéditeur n'y désigne pas un tiers par son domaine.</summary>
    private static readonly HashSet<string> DomainesPublics = new(StringComparer.OrdinalIgnoreCase)
    {
        "gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.fr", "live.com", "yahoo.fr", "yahoo.com", "orange.fr",
        "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr", "icloud.com", "me.com", "aol.com", "gmx.fr", "proton.me", "protonmail.com",
    };

    private sealed record DocumentCite(long EntId, string? EntNumero, string? EntReferenceExterne, long? EntTiersId);

    /// <summary>
    /// Candidats de la reconnaissance : documents dont le numéro ou la référence externe (4 caractères au moins) figure
    /// dans l'objet, le texte, le nom ou le texte des pièces (20 au plus) ; tiers de l'expéditeur par son adresse
    /// (coordonnée EMAIL du tiers, d'un rattachement ou d'un individu rattaché), sinon par le domaine (hors messageries
    /// publiques, 5 au plus).
    /// </summary>
    public override async Task<CandidatsReconnaissance> CandidatsAsync(AnalyseCourriel a, CancellationToken ct)
    {
        var texte = string.Join('\n', new[] { a.Objet, a.Texte, a.TextePieces }.Concat(a.Pieces)).ToLowerInvariant();
        if (texte.Length > 60_000) texte = texte[..60_000];
        var documents = await db.Database.SqlQueryRaw<DocumentCite>("""
            SELECT e.ent_id, e.ent_numero, e.ent_reference_externe, e.ent_tiers_id FROM document e
            WHERE (length(e.ent_numero) >= 4 AND position(lower(e.ent_numero) IN @t) > 0)
               OR (length(e.ent_reference_externe) >= 4 AND position(lower(e.ent_reference_externe) IN @t) > 0)
            ORDER BY e.ent_id DESC LIMIT 20
            """, new NpgsqlParameter("t", texte)).ToListAsync(ct);
        var candidats = documents.Select(d => new Candidat("document", d.EntId.ToString(), d.EntNumero,
            d.EntReferenceExterne is { Length: >= 4 } r ? [r] : [], d.EntTiersId)).ToList();
        if (string.IsNullOrWhiteSpace(a.De)) return new CandidatsReconnaissance(candidats, [], []);
        var tiers = await db.Database.SqlQueryRaw<long>("""
            SELECT DISTINCT coalesce(u.uco_per_id, r.rat_per_id, r2.rat_per_id) AS "Value"
            FROM coordonnee c JOIN usage_coordonnee u ON u.uco_coo_id = c.coo_id
            LEFT JOIN rattachement r ON r.rat_id = u.uco_rat_id LEFT JOIN rattachement r2 ON r2.rat_ind_id = u.uco_ind_id
            WHERE c.coo_nature = 'EMAIL' AND lower(trim(c.coo_valeur)) = lower(trim(@a)) AND coalesce(u.uco_per_id, r.rat_per_id, r2.rat_per_id) IS NOT NULL
            """, new NpgsqlParameter("a", a.De)).ToListAsync(ct);
        var domaine = Adresses.Domaine(a.De);
        if (tiers.Count == 0 && domaine.Length > 0 && !DomainesPublics.Contains(domaine))
        {
            tiers = await db.Database.SqlQueryRaw<long>("""
                SELECT DISTINCT coalesce(u.uco_per_id, r.rat_per_id) AS "Value"
                FROM coordonnee c JOIN usage_coordonnee u ON u.uco_coo_id = c.coo_id LEFT JOIN rattachement r ON r.rat_id = u.uco_rat_id
                WHERE c.coo_nature = 'EMAIL' AND lower(trim(c.coo_valeur)) LIKE '%@' || @d AND coalesce(u.uco_per_id, r.rat_per_id) IS NOT NULL
                LIMIT 5
                """, new NpgsqlParameter("d", domaine)).ToListAsync(ct);
        }
        return new CandidatsReconnaissance(candidats, tiers, tiers.Select(t => new ElementCible(TypesFiche.Personne, t.ToString())).ToList());
    }

    private sealed record ContexteAlerte(long? SrvId, long? RedacteurId, string? Redacteur, string TydFamille);

    /// <summary>
    /// Alerte d'un courriel rattaché automatiquement : tâche du CRM à prendre par le service (code de la règle, sinon
    /// service de l'ordre, sinon Vente / Achat selon la famille du document) avec le rédacteur pour responsable ; sans
    /// CRM : notification aux membres du service, sinon au rédacteur, sinon aux administrateurs.
    /// </summary>
    public override async Task AlerterAsync(MessageRattache m, ElementTrouve element, string? nature, string? service, CancellationToken ct)
    {
        ContexteAlerte? doc = null;
        if (element.Type == "document" && long.TryParse(element.Id, out var entId))
        {
            doc = await db.Database.SqlQueryRaw<ContexteAlerte>("""
                SELECT e.ent_srv_id::bigint AS srv_id, e.ent_redacteur_id AS redacteur_id, i.ind_utilisateur AS redacteur, t.tyd_famille
                FROM document e JOIN type_document t ON t.tyd_id = e.ent_tyd_id LEFT JOIN individu i ON i.ind_id = e.ent_redacteur_id WHERE e.ent_id = @id
                """, new NpgsqlParameter("id", entId)).FirstOrDefaultAsync(ct);
        }
        var code = service ?? (doc is null ? null : FamillesDocument.EstAchat(doc.TydFamille) ? "ACHAT" : doc.TydFamille == FamillesDocument.Vente ? "VENTE" : null);
        var srvId = code is null ? doc?.SrvId
            : await db.Database.SqlQueryRaw<long?>("SELECT srv_id::bigint AS \"Value\" FROM service WHERE srv_code = @c AND srv_actif", new NpgsqlParameter("c", code)).FirstOrDefaultAsync(ct)
              ?? doc?.SrvId;
        var (titre, conseil) = nature switch
        {
            "ARC" => ("ARC reçu", "Contrôler les prix, quantités et délais de l'accusé de réception."),
            "REPONSE_DEVIS" => ("Réponse au devis", "Lire la réponse ; si le devis est accepté, enregistrer la validation du tiers sur le document."),
            "FACTURE_FOURNISSEUR" => ("Facture fournisseur reçue", "Saisir et rapprocher la facture de la commande ou du bon de livraison."),
            "BL" => ("Avis de livraison reçu", "Préparer la réception de la livraison."),
            "RELANCE" => ("Relance reçue", "Traiter la relance."),
            _ => ("Courriel reçu", "Lire le courriel rattaché."),
        };
        var objet = $"{titre} : {element.Libelle}";
        var html = $"<p>{WebUtility.HtmlEncode(conseil)}</p><p>De : {WebUtility.HtmlEncode(m.De ?? "?")} — objet : {WebUtility.HtmlEncode(m.Objet)}</p>";
        if (await modules.EstActifAsync(ModulesFacultatifs.Crm, ct) && (srvId is not null || doc?.RedacteurId is not null))
        {
            var (typeGed, idGed, _) = await ElementGedAsync(element.Type, element.Id, ct);
            var lien = element.Type == "document" && idGed is not null ? new LienSaisi("document", idGed, true) : new LienSaisi(element.Type, element.Id, true);
            await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie(NatureNote.Tache, EtatNote.AFaire, null, srvId is long s ? (int)s : null,
                objet.Length > 200 ? objet[..200] : objet, html, srvId is null ? doc?.RedacteurId : null, DateTimeOffset.UtcNow.AddDays(2), null, false, false, false, [lien], null),
                Fond, ct);
            return;
        }
        var destinataires = srvId is long sid
            ? await db.Database.SqlQueryRaw<string>("""
                SELECT DISTINCT i.ind_utilisateur AS "Value" FROM service_membre m JOIN individu i ON i.ind_id = m.sme_ind_id
                WHERE m.sme_srv_id = @s AND i.ind_utilisateur IS NOT NULL
                """, new NpgsqlParameter("s", sid)).ToListAsync(ct)
            : [];
        if (destinataires.Count == 0 && doc?.Redacteur is { } red) destinataires = [red];
        if (destinataires.Count == 0) destinataires = [.. await AdministrateursAsync(ct)];
        await SignalerAsync(new SignalMail("ALERTE", objet, conseil, NiveauNotification.Attention, $"/mail/message/{m.Id}", $"mail:alerte:{m.Id}:{element.Type}:{element.Id}",
            element.Type, element.Id), destinataires, ct);
    }

    private static async Task<long> DeposerAsync(ServiceGed ged, byte[] octets, string nom, string type, MetaDepot meta, CancellationToken ct)
    {
        await using var flux = new MemoryStream(octets);
        var fichier = new FormFile(flux, 0, octets.Length, "fichier", nom) { Headers = new HeaderDictionary(), ContentType = type };
        return (await ged.DeposerFichier(fichier, meta, Fond, ct)).Id;
    }

    private static string NomFichier(string titre, string extension)
    {
        var nom = string.Concat((titre.Length == 0 ? "courriel" : titre).Split(Path.GetInvalidFileNameChars()));
        return $"{(nom.Length > 80 ? nom[..80] : nom)}{extension}";
    }

    public override IReadOnlyList<TypeRattachement> TypesRattachement { get; } =
    [
        new("document", "Document", "Numéro (DV2026-00012…)"), new(TypesFiche.Personne, "Tiers", "Code du tiers"), new(TypesFiche.Chantier, "Chantier", "Code du chantier"),
        new(TypesFiche.Marche, "Marché", "Code du marché"), new(TypesFiche.Affaire, "Affaire", "Code de l'affaire"), new(TypesFiche.Projet, "Projet", "Code du projet"),
    ];

    private sealed record Trouve(long Id, string Libelle);

    /// <summary>Élément désigné par son numéro (document) ou son code (tiers, structure), sans casse.</summary>
    public override async Task<ElementTrouve?> ResoudreElementAsync(string type, string code, Utilisateur u, CancellationToken ct)
    {
        var sql = type switch
        {
            "document" => "SELECT e.ent_id AS id, t.tyd_libelle || ' ' || e.ent_numero AS libelle FROM document e JOIN type_document t ON t.tyd_id = e.ent_tyd_id WHERE lower(e.ent_numero) = lower(@c) ORDER BY e.ent_id DESC",
            TypesFiche.Personne => "SELECT per_id AS id, coalesce(per_nom_commercial, per_raison_sociale, per_code) AS libelle FROM personne WHERE lower(per_code) = lower(@c)",
            TypesFiche.Chantier => "SELECT cha_id AS id, cha_code || ' ' || coalesce(cha_libelle, '') AS libelle FROM chantier WHERE lower(cha_code) = lower(@c)",
            TypesFiche.Marche => "SELECT mar_id AS id, mar_code || ' ' || coalesce(mar_libelle, '') AS libelle FROM marche WHERE lower(mar_code) = lower(@c)",
            TypesFiche.Affaire => "SELECT aff_id AS id, aff_code || ' ' || coalesce(aff_libelle, '') AS libelle FROM affaire WHERE lower(aff_code) = lower(@c)",
            TypesFiche.Projet => "SELECT prj_id AS id, prj_code || ' ' || coalesce(prj_libelle, '') AS libelle FROM projet WHERE lower(prj_code) = lower(@c)",
            _ => null,
        };
        if (sql is null) return null;
        var t = await db.Database.SqlQueryRaw<Trouve>(sql, new NpgsqlParameter("c", code)).FirstOrDefaultAsync(ct);
        return t is null ? null : new ElementTrouve(type, t.Id.ToString(), t.Libelle.Trim(), Page(type, t.Id));
    }

    public override async Task<ElementTrouve?> DecrireElementAsync(string type, string id, CancellationToken ct)
    {
        if (!long.TryParse(id, out var n)) return null;
        var sql = type switch
        {
            "document" => "SELECT e.ent_id AS id, t.tyd_libelle || ' ' || coalesce(e.ent_numero, '(brouillon)') AS libelle FROM document e JOIN type_document t ON t.tyd_id = e.ent_tyd_id WHERE e.ent_id = @n",
            TypesFiche.Personne => "SELECT per_id AS id, coalesce(per_nom_commercial, per_raison_sociale, per_code) AS libelle FROM personne WHERE per_id = @n",
            TypesFiche.Chantier => "SELECT cha_id AS id, cha_code || ' ' || coalesce(cha_libelle, '') AS libelle FROM chantier WHERE cha_id = @n",
            TypesFiche.Marche => "SELECT mar_id AS id, mar_code || ' ' || coalesce(mar_libelle, '') AS libelle FROM marche WHERE mar_id = @n",
            TypesFiche.Affaire => "SELECT aff_id AS id, aff_code || ' ' || coalesce(aff_libelle, '') AS libelle FROM affaire WHERE aff_id = @n",
            TypesFiche.Projet => "SELECT prj_id AS id, prj_code || ' ' || coalesce(prj_libelle, '') AS libelle FROM projet WHERE prj_id = @n",
            "crm_diffusion" => "SELECT dif_id AS id, 'Bordereau ' || dif_numero AS libelle FROM crm_diffusion WHERE dif_id = @n",
            _ => null,
        };
        if (sql is null) return new ElementTrouve(type, id, $"{type} {id}", null);
        var t = await db.Database.SqlQueryRaw<Trouve>(sql, new NpgsqlParameter("n", n)).FirstOrDefaultAsync(ct);
        return t is null ? null : new ElementTrouve(type, id, t.Libelle.Trim(), Page(type, n));
    }

    private static string? Page(string type, long id) => type switch
    {
        "document" => $"/document/{id}",
        "crm_diffusion" => $"/crm/diffusion/{id}",
        TypesFiche.Personne or TypesFiche.Chantier or TypesFiche.Marche or TypesFiche.Affaire or TypesFiche.Projet => $"/fiche/{type}/{id}",
        _ => null,
    };

    /// <summary>
    /// Courriel reçu rattaché : copie rangée dans la GED de l'élément (courriel et pièces ; contenus partagés par
    /// empreinte), note « courriel reçu » du suivi si le CRM est actif.
    /// </summary>
    public override async Task RattacherAsync(MessageRattache m, ElementTrouve element, CancellationToken ct)
    {
        var ged = services.GetRequiredService<ServiceGed>();
        var (typeGed, idGed, _) = await ElementGedAsync(element.Type, element.Id, ct);
        if (m.DgeId is long dge && typeGed is not null && idGed is not null && await ged.LireContenu(dge, Fond, ct) is { } eml)
        {
            await Tenter("courriel reçu rangé avec l'élément", async () =>
            {
                var source = await ged.Document(dge, Fond, ct);
                var copie = await DeposerAsync(ged, eml.Octets, eml.NomFichier, "message/rfc822", new MetaDepot
                {
                    Titre = source.Titre, Categorie = CategoriesGed.Mail, Nature = "mail", TypeElement = typeGed, IdElement = idGed, Auteur = m.Utilisateur,
                    DateDocument = source.DateDocument, Mail = source.Mail, Confidentialite = "INTERNE", MotsCles = ["courriel", "reception"],
                }, ct);
                foreach (var p in m.Pieces.Where(p => p.StartsWith("ged:")))
                {
                    if (!long.TryParse(p[4..], out var pid) || await ged.LireContenu(pid, Fond, ct) is not { } contenu) continue;
                    await DeposerAsync(ged, contenu.Octets, contenu.NomFichier, contenu.TypeMime ?? "application/octet-stream", new MetaDepot
                    {
                        Titre = contenu.NomFichier, Categorie = CategoriesGed.Mail, TypeElement = typeGed, IdElement = idGed, ParentId = copie, Auteur = m.Utilisateur, Confidentialite = "INTERNE",
                    }, ct);
                }
            });
        }
        if (await modules.EstActifAsync(ModulesFacultatifs.Crm, ct))
        {
            await Tenter("note du suivi", async () =>
            {
                var lien = element.Type == "document" && idGed is not null ? new LienSaisi("document", idGed, true) : new LienSaisi(element.Type, element.Id, true);
                var html = $"<p>De : {WebUtility.HtmlEncode(m.De ?? "?")}</p>{m.CorpsHtml}";
                await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie(NatureNote.Action, EtatNote.Memo, null, null,
                    $"📨 Courriel reçu : {(m.Objet.Length > 180 ? m.Objet[..180] : m.Objet)}", html, null, null, null, false, false, false, [lien], null),
                    new Utilisateur(m.Utilisateur, "ADMIN"), ct);
            });
        }
    }

    public override async Task PurgerAsync(IReadOnlyList<long> documents, CancellationToken ct)
    {
        var ged = services.GetRequiredService<ServiceGed>();
        foreach (var id in documents) await Tenter($"document GED {id} retiré", () => ged.Supprimer(id, Fond, ct));
    }

    /// <summary>Adresse signalée non remise sur les coordonnées EMAIL de l'annuaire qui la portent.</summary>
    public override Task<int> MarquerAdresseAsync(string adresse, string motif, Utilisateur u, CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync("""
            UPDATE coordonnee SET coo_non_remis_le = now(), coo_non_remis_motif = left(@m, 300), coo_modifie_le = now(), coo_modifie_par = @u
            WHERE coo_nature = 'EMAIL' AND lower(trim(coo_valeur)) = lower(trim(@a))
            """, [new NpgsqlParameter("m", motif), new NpgsqlParameter("u", u.Code), new NpgsqlParameter("a", adresse)], ct);

    /// <summary>
    /// Adresse de l'application d'une société pour les liens des courriels envoyés en fond (`Mail:AdresseApplication`,
    /// http://localhost:5173 par défaut) : le sous-domaine de la société précède l'hôte (demo.localhost…).
    /// </summary>
    public static string AdresseApplication(IConfiguration configuration, SocieteCourante societe)
    {
        var u = new UriBuilder(configuration["Mail:AdresseApplication"] ?? "http://localhost:5173");
        if (societe.Code is { } code) u.Host = $"{code}.{u.Host}";
        return u.Uri.GetLeftPart(UriPartial.Authority);
    }
}

/// <summary>
/// Canal courriel des notifications (préférence « par courriel ») : une notification = un courriel à l'adresse de
/// l'individu du compte, usage NOTIFICATION, lien vers la page ; au-delà de cinq à la fois, un lot (priorité basse). Le Mail
/// est résolu à l'usage : il publie lui-même des notifications (dépendance circulaire sinon).
/// </summary>
public sealed class CanalCourrielBtp(IServiceProvider services, SocieteCourante societe, IConfiguration configuration, ILogger<CanalCourrielBtp> journal)
    : ICanalNotification
{
    public string Code => "courriel";

    public Task<bool> DisponibleAsync(CancellationToken ct) => services.GetRequiredService<ServiceEnvoiMail>().DisponibleAsync(ct);

    public async Task EnvoyerAsync(IReadOnlyList<NouvelleNotification> notifications, CancellationToken ct)
    {
        var envoi = services.GetRequiredService<ServiceEnvoiMail>();
        var specialisation = services.GetRequiredService<SpecialisationMail>();
        var adresses = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var u in notifications.Select(n => n.Utilisateur).Distinct(StringComparer.OrdinalIgnoreCase))
            adresses[u] = await specialisation.CourrielUtilisateurAsync(u, ct);
        var envois = notifications.Where(n => adresses[n.Utilisateur] is not null).ToList();
        foreach (var n in notifications.Where(n => adresses[n.Utilisateur] is null).Select(n => n.Utilisateur).Distinct())
            journal.LogInformation("Notifications : pas de courriel pour {Utilisateur} (coordonnée EMAIL de son individu)", n);
        if (envois.Count == 0) return;
        long? lot = envois.Count > 5 ? await envoi.CreerLotAsync("NOTIFICATION", $"{envois.Count} notifications", SpecialisationMailBtp.Fond.Code, envois.Count, envois.Count, ct) : null;
        var racine = SpecialisationMailBtp.AdresseApplication(configuration, societe);
        foreach (var n in envois)
        {
            var lien = n.Url is null ? "" : $"<p><a href=\"{WebUtility.HtmlEncode(racine + n.Url)}\">Ouvrir dans LogiBTP</a></p>";
            var corps = $"<p><strong>{WebUtility.HtmlEncode(n.Titre)}</strong></p>{(n.Texte is null ? "" : $"<p>{WebUtility.HtmlEncode(n.Texte)}</p>")}{lien}"
                + "<p style=\"color:#667085\">Notification de LogiBTP : préférences dans Paramètres › Notifications.</p>";
            await envoi.EnvoyerAutomatiqueAsync(new EnvoiAutomatique("NOTIFICATION", [new DestinataireSaisi(adresses[n.Utilisateur]!)], $"[LogiBTP] {n.Titre}", corps,
                SpecialisationMailBtp.Fond.Code, n.Niveau == NiveauNotification.Urgent ? "HAUTE" : "NORMALE", n.TypeElement, n.IdElement, Lot: lot), ct);
        }
    }
}
