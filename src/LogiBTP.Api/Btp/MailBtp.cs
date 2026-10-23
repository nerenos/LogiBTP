using System.Globalization;
using System.Net;
using System.Text.Json;
using LogiBTP.Crm.Web;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Ged.Web;
using LogiBTP.Mail.Web;
using LogiBTP.Notifications.Web;
using LogiBTP.Socle.Web;
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
    public static readonly Utilisateur Fond = new("mail_fond", "ADMIN");

    /// <summary>Types publiés (préférences de notification).</summary>
    public static readonly TypeNotification[] Types =
    [
        new("mail", "ERREUR", "Courriels non envoyés"), new("mail", "PARTI", "Courriels partis après une attente"), new("mail", "LOT", "Envois groupés terminés"),
        new("mail", "BLOCAGE", "Messagerie : envois suspendus par l'hébergeur"), new("mail", "QUOTA", "Messagerie : quota journalier"),
        new("mail", "COMPTE", "Messagerie : compte en erreur"), new("mail", "VOLUME", "Messagerie : envois inhabituels"),
    ];

    private sealed record DocumentMail(long EntId, string? EntNumero, DateOnly EntDate, string? EntObjet, DateOnly? EntDateValidite, decimal EntTotalHt,
        decimal EntTotalTtc, decimal EntNetAPayer, long? EntGroupeId, string TydCode, string TydLibelle, string TydFamille, string? Intervenants,
        string? ContactClient, string? Redacteur);

    private sealed record PieceGed(long Id, string Titre, string NomFichier, long Taille);

    public override async Task<ElementMail?> DecrireAsync(string type, string id, Utilisateur u, CancellationToken ct)
    {
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
            if (Texte(contact, "email") is { } email) destinataires.Add(new DestinatairePropose(email, nom ?? tiers, d.TydFamille == "A" ? "Fournisseur" : "Client", true));
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
        return new ElementMail("document", id, libelle, $"/document/{d.EntId}", d.TydFamille == "A" ? "DOCUMENT_ACHAT" : "DOCUMENT_VENTE", d.TydCode, variables,
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
                Titre = c.Objet, Categorie = "mail", Nature = "mail", TypeElement = typeGed, IdElement = idGed, Auteur = c.Auteur,
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
        if (c.TypeElement is not null && c.IdElement is not null && await modules.EstActifAsync("crm", ct))
        {
            await Tenter("note du suivi", async () =>
            {
                var lien = c.TypeElement == "document" && idGed is not null ? new LienSaisi("document", idGed, true) : new LienSaisi(c.TypeElement, c.IdElement, true);
                var html = $"<p>À : {WebUtility.HtmlEncode(string.Join(", ", c.A.Concat(c.Cc)))}</p>{c.CorpsHtml}";
                await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie("ACTION", "MEMO", null, null,
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
}
