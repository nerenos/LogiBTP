using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Editions;
using LogiBTP.Editions.Web;
using LogiBTP.Fiches;
using LogiBTP.Fiches.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes;
using LogiBTP.Listes.Web;
using Microsoft.AspNetCore.Http;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Édition par le cœur : sources « document » (pièces commerciales), « fiche » et « liste »
/// (lot 6) ; données agrégées côté serveur en un appel (§ 3.10) ; dernier modèle imprimé gardé sur le document (Q13).
/// </summary>
public sealed class SpecialisationEditionBtp : SpecialisationEdition
{
    public override IReadOnlyList<SourceEdition> Sources { get; } =
        [new("document", "Documents", "DOCUMENT"), new("fiche", "Fiches", "FICHE"), new("liste", "Listes", "LISTE")];

    public override async Task<ElementEdite?> ElementAsync(IServiceProvider services, string source, string id, Utilisateur u, CancellationToken ct)
    {
        if (source == "fiche") return await SourcesFicheListeEdition.ElementFiche(services, id, u, ct);
        if (source == "liste") return await SourcesFicheListeEdition.ElementListe(services, id, u, ct);
        if (source != "document" || !long.TryParse(id, out var entId)) return null;
        var db = services.GetRequiredService<LogiBtpContext>();
        var d = await (from e in db.Documents.AsNoTracking() join t in db.TypesDocument.AsNoTracking() on e.EntTydId equals t.TydId
                       where e.EntId == entId select new { t.TydCode, t.TydLibelle, e.EntNumero, e.EntIndice }).FirstOrDefaultAsync(ct);
        if (d is null) return null;
        var dernier = await SourceDocumentEdition.DernierModele(db, entId, ct);
        var libelle = $"{d.TydLibelle} {d.EntNumero ?? "brouillon"}" + (d.EntIndice is not null and not "A" ? $" indice {d.EntIndice}" : "");
        return new ElementEdite(d.TydCode, libelle, dernier?.Modele, dernier?.Presentation);
    }

    public override async Task<JsonObject?> DonneesAsync(IServiceProvider services, DemandeEdition demande, Utilisateur u, CancellationToken ct)
    {
        var donnees = demande.Source switch
        {
            "document" when long.TryParse(demande.Id, out var id) => await SourceDocumentEdition.Lire(services, id, ct),
            "fiche" => await SourcesFicheListeEdition.DonneesFiche(services, demande.Id, u, ct),
            "liste" => await SourcesFicheListeEdition.DonneesListe(services, demande.Id,
                demande.Parametres?.GetValueOrDefault("recherche") is { ValueKind: JsonValueKind.String } r ? r.GetString() : null, u, ct),
            _ => null,
        };
        // Fiches et listes : société (entête, pied) comme pour les documents.
        if (donnees is not null && demande.Source != "document") donnees["societe"] = await SourceDocumentEdition.Societe(services, ct);
        return donnees;
    }

    public override JsonArray Dictionnaire(string source) => source switch
    {
        "document" => SourceDocumentEdition.Dictionnaire(),
        "fiche" => SourcesFicheListeEdition.DictionnaireFiche(),
        "liste" => SourcesFicheListeEdition.DictionnaireListe(),
        _ => [],
    };

    /// <summary>
    /// Dépôt en GED d'un PDF produit par le serveur : document lié au type et au groupe d'indices de la pièce
    /// (comme l'onglet Pièces), catégorie « edition », confidentialité du modèle (Q18) ; l'édition précédente du même
    /// élément est reliée par une dérivation VERSION (§ 15.1 : une pièce dévalidée puis revalidée garde l'historique
    /// de ses éditions, le coffre-fort refusant toute nouvelle version) ; coffre-fort pour une pièce comptable.
    /// </summary>
    public override async Task<long?> DeposerAsync(IServiceProvider services, TacheEdition tache, PdfEdition pdf, PreparationEdition preparation,
        Utilisateur u, CancellationToken ct)
    {
        if (tache.EttSource != "document" || !long.TryParse(tache.EttIdElement, out var id)) return null;
        var db = services.GetRequiredService<LogiBtpContext>();
        var d = await (from e in db.Documents.AsNoTracking() join t in db.TypesDocument.AsNoTracking() on e.EntTydId equals t.TydId
                       where e.EntId == id select new { t.TydCode, e.EntGroupeId, e.EntDate, e.EntNumero }).FirstAsync(ct);
        var element = (d.EntGroupeId ?? id).ToString();
        var precedente = await DerniereEditionGed(services, d.TydCode, element, ct);
        var ged = services.GetRequiredService<ServiceGed>();
        await using var flux = new MemoryStream(pdf.Octets);
        var fichier = new FormFile(flux, 0, pdf.Octets.Length, "fichier", ServiceEdition.NomFichier(preparation.Element))
        {
            Headers = new HeaderDictionary(), ContentType = "application/pdf",
        };
        var modele = preparation.Modele["code"]?.GetValue<string>() ?? "";
        var depot = await ged.DeposerFichier(fichier, new MetaDepot
        {
            Titre = preparation.Element, Categorie = "edition", TypeElement = d.TydCode, IdElement = element, Auteur = u.Code,
            DateDocument = d.EntDate.ToString("yyyy-MM-dd"), Confidentialite = preparation.Modele["niveau_acces"]?.GetValue<string>() ?? "INTERNE",
            Resume = $"Édition « {preparation.Modele["libelle"]?.GetValue<string>()} » ({tache.EttMotif.ToLowerInvariant()}), {pdf.Pages} page(s)",
            MotsCles = ["edition", modele.ToLowerInvariant()],
        }, u, ct);
        if (precedente is not null)
            await ged.AjouterDerivation(precedente.DocumentId, new DemandeDerivation { CibleId = depot.Id, Type = "VERSION", Commentaire = "Nouvelle édition de la pièce" }, u, ct);
        if (tache.EttCoffre) await ged.MettreAuCoffre(depot.Id, new DemandeCoffre { Motif = $"Pièce {d.EntNumero} validée" }, u, ct);
        return depot.Id;
    }

    public override async Task<EditionRangee?> DerniereEditionAsync(IServiceProvider services, string source, string id, Utilisateur u, CancellationToken ct)
    {
        if (source != "document" || !long.TryParse(id, out var entId)) return null;
        var db = services.GetRequiredService<LogiBtpContext>();
        var d = await (from e in db.Documents.AsNoTracking() join t in db.TypesDocument.AsNoTracking() on e.EntTydId equals t.TydId
                       where e.EntId == entId select new { t.TydCode, e.EntGroupeId }).FirstOrDefaultAsync(ct);
        return d is null ? null : await DerniereEditionGed(services, d.TydCode, (d.EntGroupeId ?? entId).ToString(), ct);
    }

    /// <summary>
    /// Images des modèles (§ 3.13) : document GED de catégorie « ressource_edition » portant le code en mot-clé (le plus
    /// récent), PNG ou JPEG contrôlé par le moteur ; une image refusée (SVG…) est ignorée (alerte du moteur).
    /// </summary>
    public override async Task<Dictionary<string, RessourceEdition>> RessourcesAsync(IServiceProvider services, IReadOnlyCollection<string> codes,
        JsonObject donnees, Utilisateur u, CancellationToken ct)
    {
        var res = new Dictionary<string, RessourceEdition>();
        var gedDb = services.GetRequiredService<GedDbContext>();
        var candidats = await gedDb.Documents.AsNoTracking().Where(x => x.DgeCategorie == "ressource_edition" && !x.DgeSupprime)
            .OrderByDescending(x => x.DgeCreeLe).ThenByDescending(x => x.DgeId).ToListAsync(ct);
        var ged = services.GetRequiredService<ServiceGed>();
        var pool = services.GetRequiredService<PoolMoteursEdition>();
        foreach (var code in codes)
        {
            var doc = candidats.FirstOrDefault(x => x.DgeMotsCles.Any(m => string.Equals(m, code, StringComparison.OrdinalIgnoreCase))
                || string.Equals(x.DgeTitre, code, StringComparison.OrdinalIgnoreCase));
            if (doc is null) continue;
            var contenu = await ged.LireContenu(doc.DgeId, u, ct);
            if (contenu is null) continue;
            var octets = contenu.Value.Octets;
            var info = JsonNode.Parse(await pool.ExecuterAsync(m => m.LireImage(octets), ct))!;
            if (info["erreur"] is not null) continue;
            res[code] = new RessourceEdition(info["type"]!.GetValue<string>(), Convert.ToBase64String(octets), info["largeur"]!.GetValue<int>(),
                info["hauteur"]!.GetValue<int>(), info["dpi"]?.GetValue<int?>(), info["orientation"]?.GetValue<int?>());
        }
        return res;
    }

    /// <summary>Image importée avec un modèle : déposée en GED (catégorie ressource_edition, code en mot-clé, sans élément).</summary>
    public override async Task<bool> CreerRessourceAsync(IServiceProvider services, string code, RessourceEdition ressource, Utilisateur u, CancellationToken ct)
    {
        if (ressource.Type is not ("png" or "jpeg")) return false;
        var octets = Convert.FromBase64String(ressource.Base64);
        await using var flux = new MemoryStream(octets);
        var fichier = new FormFile(flux, 0, octets.Length, "fichier", $"{code.ToLowerInvariant()}.{(ressource.Type == "png" ? "png" : "jpg")}")
        {
            Headers = new HeaderDictionary(), ContentType = ressource.Type == "png" ? "image/png" : "image/jpeg",
        };
        await services.GetRequiredService<ServiceGed>().DeposerFichier(fichier, new MetaDepot
        {
            Titre = code, Categorie = "ressource_edition", MotsCles = [code], Resume = "Image des éditions importée avec un modèle", Auteur = u.Code,
        }, u, ct);
        return true;
    }

    /// <summary>
    /// Sources annexes des sous-rapports (§ 15.2), lues dans le même appel : marche_documents (commande de base et
    /// avenants du marché du document, avec le facturé cumulé de chacun, ce document compris, et le pourcentage facturé),
    /// avancements_precedents (situations et factures d'avancement validées du marché avant ce document : HT, TTC et,
    /// pour les factures, reste à payer d'après le pointage du module Règlements s'il est installé).
    /// </summary>
    public override async Task<JsonNode?> SourceAnnexeAsync(IServiceProvider services, string nom, JsonObject donnees, Utilisateur u, CancellationToken ct)
    {
        if (donnees["document"]?["id"] is not JsonValue v || !v.TryGetValue<long>(out var id)) return null;
        var db = services.GetRequiredService<LogiBtpContext>();
        var sql = nom switch
        {
            "marche_documents" => """
                WITH cmd AS (
                    SELECT md.mdo_rang, md.mdo_role, d.ent_id, d.ent_numero, d.ent_date, d.ent_objet, d.ent_total_ht
                    FROM document cur JOIN marche_document md ON md.mdo_mar_id = cur.ent_marche_id JOIN document d ON d.ent_id = md.mdo_ent_id
                    WHERE cur.ent_id = @id),
                facture AS (
                    SELECT c.lig_ent_id AS cmd_id, sum(l.lig_montant_ht) AS mt
                    FROM document_ligne l JOIN document_ligne c ON c.lig_id = l.lig_avt_source_lig_id
                    JOIN document f ON f.ent_id = l.lig_ent_id JOIN statut_document s ON s.std_id = f.ent_std_id
                    WHERE c.lig_ent_id IN (SELECT ent_id FROM cmd) AND f.ent_avt_presentation = 'P' AND s.std_code <> 'ANNULE'
                      AND (f.ent_verrouille OR f.ent_id = @id)
                    GROUP BY c.lig_ent_id)
                SELECT coalesce(json_agg(json_build_object('rang', c.mdo_rang, 'role', c.mdo_role, 'numero', c.ent_numero, 'date', c.ent_date,
                         'objet', c.ent_objet, 'montant_ht', c.ent_total_ht, 'facture_ht', coalesce(f.mt, 0),
                         'pct_facture', CASE WHEN c.ent_total_ht <> 0 THEN round(coalesce(f.mt, 0) * 100 / c.ent_total_ht, 2) END) ORDER BY c.mdo_rang), '[]')::text AS "Value"
                FROM cmd c LEFT JOIN facture f ON f.cmd_id = c.ent_id
                """,
            "avancements_precedents" => $"""
                SELECT coalesce(json_agg(json_build_object('numero', d.ent_numero, 'type', t.tyd_libelle, 'date', d.ent_date,
                         'rang', d.ent_rang_avancement, 'facture', d.ent_avt_presentation = 'P', 'montant_ht', d.ent_total_ht,
                         'montant_tva', d.ent_total_tva, 'montant_ttc', d.ent_total_ttc, 'net', d.ent_net_a_payer,
                         'reste', CASE WHEN d.ent_avt_presentation = 'P' THEN {(await ReglementsInstalles(db, ct) ? ResteAPayer : "NULL::numeric")} END)
                         ORDER BY d.ent_date, d.ent_id), '[]')::text AS "Value"
                FROM document cur JOIN document d ON d.ent_marche_id = cur.ent_marche_id AND d.ent_id <> cur.ent_id
                JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
                WHERE cur.ent_id = @id AND t.tyd_avancement IN ('S', 'F') AND d.ent_verrouille AND s.std_code NOT IN ('ANNULE', 'REMPLACE')
                  AND d.ent_is_reference AND (d.ent_date, d.ent_id) < (cur.ent_date, cur.ent_id)
                """,
            _ => null,
        };
        if (sql is null) return null;
        var json = await db.Database.SqlQueryRaw<string>(sql, new NpgsqlParameter("id", id)).FirstAsync(ct);
        return JsonNode.Parse(json);
    }

    /// <summary>Reste à payer d'une pièce d (alias) : net à payer moins les pointages de ses échéances (module Règlements).</summary>
    private const string ResteAPayer =
        "d.ent_net_a_payer - coalesce((SELECT sum(p.poi_montant) FROM document_echeance e JOIN pointage p ON p.poi_echeance_id = e.ech_id WHERE e.ech_ent_id = d.ent_id), 0)";

    /// <summary>Module Règlements installé dans la base courante (table pointage) : il est facultatif.</summary>
    private static async Task<bool> ReglementsInstalles(LogiBtpContext db, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<bool>("SELECT to_regclass('pointage') IS NOT NULL AS \"Value\"").FirstAsync(ct);

    /// <summary>Dernière édition rangée d'un élément de la GED (catégorie edition, non supprimée) et sa version courante.</summary>
    private static async Task<EditionRangee?> DerniereEditionGed(IServiceProvider services, string type, string element, CancellationToken ct)
    {
        var ged = services.GetRequiredService<GedDbContext>();
        var doc = await ged.Documents.AsNoTracking()
            .Where(x => x.DgeCategorie == "edition" && x.DgeTypeElement == type && x.DgeIdElement == element && !x.DgeSupprime)
            .OrderByDescending(x => x.DgeCreeLe).ThenByDescending(x => x.DgeId).FirstOrDefaultAsync(ct);
        if (doc is null) return null;
        var version = await ged.Versions.AsNoTracking().Where(v => v.VgeDocument == doc.DgeId).OrderByDescending(v => v.VgeNumero).FirstAsync(ct);
        return new EditionRangee(doc.DgeId, version.VgeId, doc.DgeCreeLe, doc.DgeTitre);
    }

    public override async Task ApresImpressionAsync(IServiceProvider services, DemandeEdition demande, string modele, string? presentation, Utilisateur u, CancellationToken ct)
    {
        if (demande.Source != "document" || !long.TryParse(demande.Id, out var id)) return;
        var db = services.GetRequiredService<LogiBtpContext>();
        var json = new JsonObject { ["modele"] = modele, ["presentation"] = presentation }.ToJsonString();
        await db.Database.ExecuteSqlRawAsync("UPDATE document SET ent_modele_edition = @m::jsonb WHERE ent_id = @id",
            [new NpgsqlParameter("m", json), new NpgsqlParameter("id", id)], ct);
    }
}

/// <summary>
/// Source d'édition « document » : pièce calculée par le moteur du serveur (structure du pied, TVA, libellés affichés
/// ou figés), lignes imprimées (sans les lignes « ne pas imprimer » ni les tranches de frais annexes, Q4 / § 15.3 :
/// une ligne non imprimée reste comptée dans les totaux), coordonnées figées du document, société et mentions.
/// </summary>
public static class SourceDocumentEdition
{
    private static readonly Dictionary<string, string> LibellesPied = new()
    {
        ["TOTAL_HT"] = "Total HT", ["HT_NET"] = "Total HT net", ["TOTAL_TTC"] = "Total TTC", ["SOUS_TOTAL"] = "Sous-total", ["NET"] = "Net à payer",
    };

    // Catégories juridiques INSEE les plus courantes (libellé imprimé de la forme juridique).
    private static readonly Dictionary<string, string> FormesJuridiques = new()
    {
        ["1000"] = "Entrepreneur individuel", ["5499"] = "SARL", ["5498"] = "EURL", ["5710"] = "SAS", ["5720"] = "SASU",
        ["5599"] = "SA", ["5505"] = "SA à directoire", ["5308"] = "SNC", ["6540"] = "SCI", ["9220"] = "Association",
    };

    private const string Complements = """
        SELECT json_build_object(
          'societe', (SELECT json_build_object('per_id', per_id, 'raison_sociale', per_raison_sociale, 'forme_juridique', per_forme_juridique,
                        'capital', per_capital, 'rcs', per_rcs, 'naf', per_naf, 'siret', per_siret, 'tva', per_tva_intra)
                      FROM personne WHERE per_societe_base),
          'redacteur', (SELECT json_build_object('nom', concat_ws(' ', ind_prenom, ind_nom), 'civilite', ind_civilite) FROM individu WHERE ind_id = @red),
          'projet', (SELECT json_build_object('code', prj_code, 'libelle', prj_libelle) FROM projet WHERE prj_id = @prj),
          'affaire', (SELECT json_build_object('code', aff_code, 'libelle', aff_libelle) FROM affaire WHERE aff_id = @aff),
          'chantier', (SELECT json_build_object('code', cha_code, 'libelle', cha_libelle) FROM chantier WHERE cha_id = @cha),
          'marche', (SELECT json_build_object('code', mar_code, 'libelle', mar_libelle, 'montant_ht', mar_montant_ht) FROM marche WHERE mar_id = @mar),
          'condition', (SELECT json_build_object('code', cpa_code, 'libelle', cpa_libelle) FROM condition_paiement WHERE cpa_code = @cpa),
          'echeances', (SELECT coalesce(json_agg(json_build_object('rang', ech_rang, 'date', ech_date, 'montant', ech_montant, 'mode', ech_mode,
                          'nature', ech_nature) ORDER BY ech_rang), '[]') FROM document_echeance WHERE ech_ent_id = @ent),
          'mentions', (SELECT pae_valeur FROM parametre_edition WHERE pae_cle = 'mentions'),
          'statut', (SELECT json_build_object('code', std_code, 'libelle', std_libelle) FROM statut_document WHERE std_id = @std),
          'type', (SELECT json_build_object('code', tyd_code, 'libelle', tyd_libelle, 'famille', tyd_famille, 'avancement', tyd_avancement)
                   FROM type_document WHERE tyd_id = @tyd)
        )::text AS "Value"
        """;

    /// <summary>Société de la base (identité, coordonnées, mentions) pour les sources fiche et liste.</summary>
    public static async Task<JsonObject> Societe(IServiceProvider services, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var json = await db.Database.SqlQueryRaw<string>("""
            SELECT coalesce((SELECT json_build_object('per_id', per_id, 'raison_sociale', per_raison_sociale, 'siret', per_siret, 'tva', per_tva_intra)::text
            FROM personne WHERE per_societe_base), '{{}}') AS "Value"
            """).FirstAsync(ct);
        var societe = JsonNode.Parse(json)!.AsObject();
        if (societe["per_id"] is JsonValue p && await ContactsDocument.Instantane(db, p.GetValue<long>(), null, ct) is { } inst)
        {
            var co = JsonNode.Parse(inst.RootElement.GetRawText());
            societe["adresse"] = co?["adresse"] is JsonObject a ? new JsonArray(new[] { "ligne1", "ligne2", "ligne3" }.Select(k => a[k]?.GetValue<string>()).Where(x => !string.IsNullOrWhiteSpace(x))
                .Append(string.Join(' ', new[] { a["code_postal"]?.GetValue<string>(), a["ville"]?.GetValue<string>() }.Where(x => !string.IsNullOrWhiteSpace(x)))).Where(x => x!.Length > 0).Select(x => (JsonNode?)x).ToArray()) : new JsonArray();
            societe["telephone"] = co?["telephone"]?.DeepClone();
            societe["courriel"] = co?["email"]?.DeepClone();
        }
        return societe;
    }

    public static async Task<(string? Modele, string? Presentation)?> DernierModele(LogiBtpContext db, long entId, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>("SELECT coalesce(ent_modele_edition::text, '') AS \"Value\" FROM document WHERE ent_id = @id",
            new NpgsqlParameter("id", entId)).FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(json)) return null;
        var o = JsonNode.Parse(json);
        return (o?["modele"]?.GetValue<string>(), o?["presentation"]?.GetValue<string>());
    }

    public static async Task<JsonObject?> Lire(IServiceProvider services, long id, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var service = services.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        if (!await db.Documents.AnyAsync(d => d.EntId == id, ct)) return null;
        var complet = await service.Charger(id, ct);
        var r = await service.Resultat(complet, ct);
        var d = r.Document;

        var p = new Func<string, object?, NpgsqlParameter>((n, v) => new NpgsqlParameter(n, v ?? DBNull.Value));
        var json = await db.Database.SqlQueryRaw<string>(Complements,
            new NpgsqlParameter("red", NpgsqlDbType.Bigint) { Value = (object?)d.EntRedacteurId ?? DBNull.Value },
            new NpgsqlParameter("prj", NpgsqlDbType.Integer) { Value = (object?)d.EntProjetId ?? DBNull.Value },
            new NpgsqlParameter("aff", NpgsqlDbType.Integer) { Value = (object?)d.EntAffaireId ?? DBNull.Value },
            new NpgsqlParameter("cha", NpgsqlDbType.Integer) { Value = (object?)d.EntChantierId ?? DBNull.Value },
            new NpgsqlParameter("mar", NpgsqlDbType.Integer) { Value = (object?)d.EntMarcheId ?? DBNull.Value },
            new NpgsqlParameter("cpa", NpgsqlDbType.Varchar) { Value = (object?)d.EntCpaCode ?? DBNull.Value },
            new NpgsqlParameter("ent", NpgsqlDbType.Bigint) { Value = id },
            new NpgsqlParameter("std", NpgsqlDbType.Integer) { Value = d.EntStdId },
            new NpgsqlParameter("tyd", NpgsqlDbType.Integer) { Value = d.EntTydId }).FirstAsync(ct);
        var c = JsonNode.Parse(json)!.AsObject();
        var type = c["type"]?.AsObject() ?? new JsonObject();
        var famille = type["famille"]?.GetValue<string>() ?? "V";

        // Société : identité, coordonnées (instantané de l'annuaire), mentions.
        var societe = c["societe"]?.DeepClone() as JsonObject ?? new JsonObject();
        if (societe["per_id"] is JsonValue perSociete)
        {
            var instantane = await ContactsDocument.Instantane(db, perSociete.GetValue<long>(), null, ct);
            if (instantane is not null)
            {
                var co = Coordonnees(JsonNode.Parse(instantane.RootElement.GetRawText()));
                societe["adresse"] = co?["adresse"]?.DeepClone();
                societe["telephone"] = co?["telephone"]?.DeepClone();
                societe["courriel"] = co?["courriel"]?.DeepClone();
            }
        }
        var forme = societe["forme_juridique"]?.GetValue<string>();
        if (forme is not null) societe["forme_juridique"] = FormesJuridiques.GetValueOrDefault(forme, forme);
        societe["capital"] = societe["capital"] is JsonValue cap && cap.TryGetValue<decimal>(out var capital)
            ? $"{Milliers(capital)} €" : null;
        societe["mentions"] = c["mentions"]?.DeepClone() ?? new JsonObject();

        // Coordonnées figées du document, sinon l'annuaire (comme l'entête, lot F).
        var client = d.EntContactClient is not null ? JsonNode.Parse(d.EntContactClient.RootElement.GetRawText()) : null;
        if (client is null && ContactsDocument.Source(d, "CLIENT", famille) is var (perId, indId))
        {
            var inst = await ContactsDocument.Instantane(db, perId, indId, ct);
            client = inst is null ? null : JsonNode.Parse(inst.RootElement.GetRawText());
        }
        var payeur = d.EntContactPayeur is not null ? JsonNode.Parse(d.EntContactPayeur.RootElement.GetRawText()) : null;
        var adresseTravaux = d.EntAdresseLivraison is not null ? JsonNode.Parse(d.EntAdresseLivraison.RootElement.GetRawText())?.AsObject() : null;
        if (adresseTravaux is not null) adresseTravaux["adresse"] = Lignes(adresseTravaux["adresse"]);

        var document = Objet(d);
        var lignes = r.Lignes.ToDictionary(l => l.LigId);
        var resultat = new JsonObject
        {
            ["societe"] = societe,
            ["document"] = new JsonObject
            {
                ["id"] = d.EntId, ["numero"] = d.EntNumero, ["date"] = d.EntDate.ToString("yyyy-MM-dd"), ["objet"] = d.EntObjet,
                ["notre_reference"] = d.EntNotreReference, ["reference_externe"] = d.EntReferenceExterne, ["date_externe"] = document["ent_date_externe"]?.DeepClone(),
                ["validite_jours"] = d.EntValiditeJours, ["date_validite"] = d.EntDateValidite?.ToString("yyyy-MM-dd"),
                ["type"] = type.DeepClone(), ["statut"] = c["statut"]?.DeepClone(), ["verrouille"] = d.EntVerrouille, ["indice"] = d.EntIndice,
                ["devise"] = d.EntDevise, ["nature_avoir"] = d.EntNatureAvoir, ["mode_reglement"] = d.EntModeReglement,
                ["condition"] = c["condition"]?.DeepClone(),
                ["avancement"] = d.EntAvtPresentation is null ? null : new JsonObject
                {
                    ["presentation"] = d.EntAvtPresentation, ["rang"] = d.EntRangAvancement,
                    ["pied"] = await PiedAvancement(db, d, c["marche"]?["montant_ht"]?.GetValue<decimal?>(), ct),
                },
                ["entete"] = document,
            },
            ["client"] = Coordonnees(client),
            ["payeur"] = Coordonnees(payeur),
            ["adresse_travaux"] = adresseTravaux,
            ["redacteur"] = c["redacteur"]?.DeepClone(),
            ["rattachement"] = new JsonObject { ["projet"] = c["projet"]?.DeepClone(), ["affaire"] = c["affaire"]?.DeepClone(), ["chantier"] = c["chantier"]?.DeepClone(), ["marche"] = c["marche"]?.DeepClone() },
            ["intervenants"] = d.EntIntervenants is null ? new JsonArray() : JsonNode.Parse(d.EntIntervenants.RootElement.GetRawText()),
            ["lignes"] = LignesImprimees(r, lignes),
            ["pied"] = Pied(r.Pied, r, lignes),
            ["tva"] = new JsonArray(r.Tva.Select(t => (JsonNode?)new JsonObject
            {
                ["code"] = t.TvaCode, ["taux"] = t.TvaTaux, ["base"] = t.TvaBaseHt, ["montant"] = t.TvaMontantNet, ["mention"] = t.TvaMention, ["categorie"] = t.TvaCategorie,
            }).ToArray()),
            ["totaux"] = new JsonObject { ["ht"] = d.EntTotalHt, ["tva"] = d.EntTotalTva, ["ttc"] = d.EntTotalTtc, ["net"] = d.EntNetAPayer },
            ["echeances"] = c["echeances"]?.DeepClone() ?? new JsonArray(),
            ["textes"] = new JsonObject { ["intro"] = document["ent_texte_intro"]?.DeepClone(), ["fin"] = document["ent_texte_fin"]?.DeepClone() },
        };
        // Ordre (module Exécution, E47) : étapes dans l'ordre (dates prévisionnelles, validation, contrôle, ressource).
        if (famille == "E")
        {
            resultat["etapes"] = JsonNode.Parse(await db.Database.SqlQueryRaw<string>("""
                SELECT coalesce(json_agg(json_build_object('code', e.ore_code, 'libelle', e.ore_libelle, 'nature', e.ore_nature,
                         'date_obligatoire', e.ore_date_obligatoire, 'prevu_le', e.ore_prevu_le, 'valide_le', e.ore_valide_le, 'valide_par', e.ore_valide_par,
                         'controle', e.ore_controle, 'controle_le', e.ore_controle_le, 'controle_par', e.ore_controle_par,
                         'ressource', coalesce(e.ore_ressource, d.ent_ressource) ->> 'libelle', 'commentaire', e.ore_commentaire) ORDER BY e.ore_ordre), '[]')::text AS "Value"
                FROM exe_ordre_etape e JOIN document d ON d.ent_id = e.ore_ordre_id WHERE e.ore_ordre_id = @id
                """, new NpgsqlParameter("id", d.EntId)).FirstAsync(ct));
        }
        return resultat;
    }

    /// <summary>
    /// Pièces d'avancement déjà facturées avant le document (comme le bloc de déduction de l'entête) : figées à la
    /// validation (document_deduction), sinon factures et avoirs d'avancement validés non annulés du marché et reprises
    /// d'avancement, de numéro de situation inférieur.
    /// </summary>
    private const string SqlPiedAvancement = """
        WITH cur AS (SELECT * FROM document WHERE ent_id = @id),
        prec AS (
            SELECT k.ded_deduit_ent_id AS ent_id FROM document_deduction k WHERE k.ded_ent_id = @id
            UNION
            SELECT x.ent_id FROM cur d JOIN document x ON x.ent_marche_id = d.ent_marche_id AND x.ent_id <> d.ent_id
            JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id JOIN statut_document s ON s.std_id = x.ent_std_id
            WHERE NOT EXISTS (SELECT 1 FROM document_deduction WHERE ded_ent_id = @id) AND x.ent_verrouille AND s.std_code <> 'ANNULE'
              AND (x.ent_avt_presentation = 'P' OR tx.tyd_avancement = 'R')
              AND (x.ent_rang_avancement IS NULL OR d.ent_rang_avancement IS NULL OR x.ent_rang_avancement < d.ent_rang_avancement))
        SELECT json_build_object('ht', coalesce(sum(x.ent_total_ht), 0), 'tva', coalesce(sum(x.ent_total_tva), 0),
                 'ttc', coalesce(sum(x.ent_total_ttc), 0), 'net', coalesce(sum(x.ent_net_a_payer), 0), 'nombre', count(*))::text AS "Value"
        FROM prec p JOIN document x ON x.ent_id = p.ent_id
        """;

    /// <summary>
    /// Pied d'avancement (factures et situations) : pour le total HT, la TVA, le total TTC et le net à payer, cumul
    /// précédent (pièces déjà facturées), période et cumul. Facture d'avancement (présentation P) : période = la pièce,
    /// cumul = précédent + période ; situation (C) : cumul = la pièce, période = cumul − précédent (reste à facturer).
    /// Pourcentage facturé : cumul HT / montant HT du marché.
    /// </summary>
    private static async Task<JsonObject?> PiedAvancement(LogiBtpContext db, DocumentBtp d, decimal? montantMarche, CancellationToken ct)
    {
        if (d.EntAvtPresentation is not ("P" or "C") || d.EntMarcheId is null) return null;
        var json = await db.Database.SqlQueryRaw<string>(SqlPiedAvancement, new NpgsqlParameter("id", d.EntId)).FirstAsync(ct);
        var prec = JsonNode.Parse(json)!.AsObject();
        decimal P(string k) => prec[k]?.GetValue<decimal>() ?? 0;
        var facture = d.EntAvtPresentation == "P";
        var lignes = new JsonArray();
        decimal cumulHt = 0;
        foreach (var (cle, libelle, piece) in new[] { ("ht", "Total HT", d.EntTotalHt), ("tva", "TVA", d.EntTotalTva), ("ttc", "Total TTC", d.EntTotalTtc), ("net", "Net à payer", d.EntNetAPayer) })
        {
            var precedent = P(cle);
            var periode = facture ? piece : piece - precedent;
            var cumul = facture ? precedent + piece : piece;
            if (cle == "ht") cumulHt = cumul;
            lignes.Add(new JsonObject { ["cle"] = cle, ["libelle"] = libelle, ["precedent"] = precedent, ["periode"] = periode, ["cumul"] = cumul });
        }
        return new JsonObject
        {
            ["lignes"] = lignes, ["nombre_precedents"] = prec["nombre"]?.DeepClone(), ["marche_ht"] = montantMarche,
            ["pct_facture"] = montantMarche is decimal m && m != 0 ? Math.Round(cumulHt * 100 / m, 2, MidpointRounding.AwayFromZero) : null,
        };
    }

    /// <summary>Montant avec séparateur de milliers (espace insécable fine) et décimales utiles (sans globalisation).</summary>
    private static string Milliers(decimal v)
    {
        var s = ArrondiCalcul.FormatNombre(v);
        var signe = s.StartsWith('-') ? "-" : "";
        var parties = s.TrimStart('-').Split(',', '.');
        var ent = parties[0];
        var groupes = new List<string>();
        for (var i = ent.Length; i > 0; i -= 3) groupes.Insert(0, ent[Math.Max(0, i - 3)..i]);
        return signe + string.Join(' ', groupes) + (parties.Length > 1 ? "," + parties[1] : "");
    }

    /// <summary>Entête sérialisé avec les noms du DDL (ent_*), pour les champs non repris ailleurs.</summary>
    private static JsonObject Objet(DocumentBtp d)
    {
        var o = JsonSerializer.SerializeToNode(d, JsonCalcul.Options)!.AsObject();
        foreach (var cle in new[] { "ent_intervenants", "ent_contact_client", "ent_contact_payeur", "ent_num_format" }) o.Remove(cle);
        return o;
    }

    /// <summary>Coordonnées d'un instantané (ContactsDocument) au format des éditions : nom, contact, lignes d'adresse.</summary>
    private static JsonObject? Coordonnees(JsonNode? i)
    {
        if (i is not JsonObject o) return null;
        return new JsonObject
        {
            ["nom"] = o["raison_sociale"]?.DeepClone(), ["code"] = o["code"]?.DeepClone(), ["contact"] = o["contact"]?["nom"]?.DeepClone(),
            ["adresse"] = Lignes(o["adresse"]), ["courriel"] = (o["email"] ?? o["courriel"])?.DeepClone(), ["telephone"] = o["telephone"]?.DeepClone(),
            ["siret"] = o["siret"]?.DeepClone(), ["tva"] = (o["tva_intra"] ?? o["tva"])?.DeepClone(),
        };
    }

    /// <summary>Adresse en lignes imprimables (vides retirées ; code postal et ville sur une ligne ; pays hors France).</summary>
    private static JsonArray Lignes(JsonNode? a)
    {
        var res = new JsonArray();
        if (a is JsonArray dejaLignes) { foreach (var x in dejaLignes) if (x is not null) res.Add(x.DeepClone()); return res; }
        if (a is JsonValue v && v.TryGetValue<string>(out var texte)) { foreach (var l in texte.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) res.Add(l); return res; }
        if (a is not JsonObject o) return res;
        string? S(string k) => o[k] is JsonValue x && x.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;
        foreach (var k in new[] { "ligne1", "ligne2", "ligne3" }) if (S(k) is { } l) res.Add(l);
        var ville = string.Join(' ', new[] { S("code_postal"), S("ville") }.Where(x => x is not null));
        if (ville.Length > 0) res.Add(ville);
        if (S("pays") is { } pays && pays is not "FR" and not "France") res.Add(pays);
        return res;
    }

    private static string TypeLigne(short tyl) => tyl switch
    {
        TL.Titre => "TITRE", TL.Ouvrage => "OUVRAGE", TL.Element => "ELEMENT", TL.Texte => "TEXTE", TL.SousTotal => "SOUS_TOTAL",
        TL.Image => "IMAGE", TL.SautPage => "SAUT_PAGE", TL.PiedHt => "PIED_HT", TL.PiedTtc => "PIED_TTC", TL.Tva => "TVA", TL.Section => "SECTION", _ => tyl.ToString(),
    };

    /// <summary>
    /// Lignes imprimées dans l'ordre d'affichage (arbre parcouru en profondeur) avec niveau, type, numéro et indicateurs
    /// (composante, option, pour mémoire, comptée dans le total) ; pied d'une section (lot 4) inséré à la fin de la section.
    /// </summary>
    private static JsonArray LignesImprimees(ResultatDocument<DocumentBtp, DocumentLigneBtp> r, Dictionary<long, DocumentLigneBtp> parId)
    {
        var enfants = r.Lignes.GroupBy(l => l.LigParentId ?? 0).ToDictionary(g => g.Key, g => g.OrderBy(l => l.LigOrdre).ToList());
        var piedsSections = r.PiedsSections.ToDictionary(p => p.LigId, p => p.Pied);
        var res = new JsonArray();
        void Visiter(long parent, int niveau, string typePrixHerite, bool composante)
        {
            foreach (var l in enfants.GetValueOrDefault(parent) ?? [])
            {
                if (TL.EstPied(l)) continue;
                var typePrix = l.LigTypePrix is { Length: > 0 } tp && tp != "V" ? tp : typePrixHerite;
                if (typePrix == "F") continue; // tranche de frais annexes : jamais imprimée, ni sa descendance
                var type = TypeLigne(l.LigTylId);
                if (!l.LigIsNonEditee)
                {
                    var o = new JsonObject
                    {
                        ["lig_id"] = l.LigId, ["type"] = type, ["niveau"] = niveau, ["numero"] = l.LigNumerotation, ["code"] = l.LigCode,
                        ["libelle_html"] = l.LigLibelleAffiche ?? l.LigLibelleHtml, ["libelle"] = l.LigLibelleBrut,
                        ["qte"] = l.LigQte, ["unite"] = l.LigUntCode, ["pu"] = l.LigPvRemise ?? l.LigPv, ["pu_brut"] = l.LigPv,
                        ["remise_pct"] = l.LigCoefRemise is decimal cr && cr != 1 ? (1 - cr) * 100 : null,
                        ["montant"] = l.LigMontantHt, ["taux_tva"] = l.LigTauxTva, ["type_prix"] = typePrix,
                        ["option"] = typePrix == "O", ["pour_memoire"] = typePrix == "M", ["variante"] = l.LigVarianteDeId is not null,
                        ["composante"] = composante, ["tranche"] = TL.EstTranche(l),
                        ["compte_total"] = !composante && TL.EstChiffree(l) && typePrix == "V",
                        ["avt_pct"] = l.LigAvtPct, ["avt_qte_cumul"] = l.LigAvtQteCumul, ["avt_montant_cumul"] = l.LigAvtMontantCumul,
                        ["avt_montant_precedent"] = l.LigAvtMontantPrecedent, ["avt_pct_precedent"] = l.LigAvtPctPrecedent,
                        ["avt_qte_marche"] = l.LigAvtQteMarche, ["avt_montant_marche"] = l.LigAvtMontantMarche,
                    };
                    res.Add(o);
                }
                Visiter(l.LigId, niveau + 1, typePrix, composante || l.LigTylId == TL.Ouvrage);
                if (piedsSections.TryGetValue(l.LigId, out var pied))
                    foreach (var e in Pied(pied, r, parId))
                    {
                        var o = e!.AsObject();
                        o["type"] = "PIED";
                        o["niveau"] = niveau + 1;
                        o["libelle_html"] = Html(o["libelle"]?.GetValue<string>());
                        res.Add(o.DeepClone());
                    }
            }
        }
        Visiter(0, 0, "V", false);
        return res;
    }

    private static string Html(string? texte) => System.Net.WebUtility.HtmlEncode(texte ?? "");

    /// <summary>
    /// Pied imprimable : totaux calculés non masqués, postes HT / TTC (libellé, base, taux, montant), TVA par taux,
    /// sous-totaux de pied saisis, lignes consolidées du pied global.
    /// </summary>
    private static JsonArray Pied(List<EntreePied> pied, ResultatDocument<DocumentBtp, DocumentLigneBtp> r, Dictionary<long, DocumentLigneBtp> lignes)
    {
        var res = new JsonArray();
        foreach (var e in pied)
        {
            switch (e.Genre)
            {
                case "total":
                    if (!e.Masque) res.Add(new JsonObject { ["genre"] = "total", ["cle"] = e.Cle, ["libelle"] = LibellesPied.GetValueOrDefault(e.Cle, e.Cle), ["montant"] = e.Montant });
                    break;
                case "ligne":
                    if (e.LigId is long id && lignes.TryGetValue(id, out var st) && !st.LigIsNonEditee)
                        res.Add(new JsonObject { ["genre"] = "sous_total", ["cle"] = e.Cle, ["libelle"] = st.LigLibelleBrut ?? "Sous-total", ["montant"] = st.LigMontantHt });
                    break;
                case "consolide":
                    res.Add(new JsonObject
                    {
                        ["genre"] = "poste", ["cle"] = e.Cle, ["libelle"] = e.Libelle, ["mode"] = e.Mode, ["taux"] = e.Mode == "M" ? null : e.Taux,
                        ["base"] = e.Mode == "M" ? null : e.Base, ["montant"] = e.Montant,
                    });
                    break;
                case "groupe" when e.Cle == "TVA":
                    foreach (var t in r.Tva)
                        res.Add(new JsonObject
                        {
                            ["genre"] = "tva", ["cle"] = "TVA", ["libelle"] = $"TVA {ArrondiCalcul.FormatNombre(t.TvaTaux).Replace('.', ',')} %", ["code"] = t.TvaCode,
                            ["taux"] = t.TvaTaux, ["base"] = t.TvaBaseHt, ["montant"] = t.TvaMontantNet, ["mention"] = t.TvaMention,
                        });
                    break;
                case "groupe":
                    foreach (var lid in e.Lignes ?? [])
                    {
                        if (!lignes.TryGetValue(lid, out var l) || l.LigIsNonEditee) continue;
                        res.Add(new JsonObject
                        {
                            ["genre"] = "poste", ["cle"] = e.Cle, ["libelle"] = l.LigLibelleBrut, ["mode"] = l.LigPiedMode,
                            ["taux"] = l.LigPiedMode is "P" or "C" ? l.LigPiedValeur : null, ["base"] = l.LigPiedMode is "P" or "C" ? l.LigBaseCalcul : null,
                            ["montant"] = l.LigMontantHt, ["sens"] = l.LigPiedSens,
                        });
                    }
                    break;
            }
        }
        return res;
    }

    /// <summary>
    /// Dictionnaire des données de la source « document » (éditeur du modèle, guide des éditions) : groupe, chemin,
    /// libellé, type. Champs d'une collection : chemin « collection[].champ », lus par « ligne.champ » (ou « element.champ »)
    /// dans un tableau, une bande ou un composant répété sur la collection.
    /// </summary>
    public static JsonArray Dictionnaire()
    {
        var d = new List<(string Groupe, string Chemin, string Libelle, string Type)>();
        void G(string groupe, params (string Chemin, string Libelle, string Type)[] champs) => d.AddRange(champs.Select(c => (groupe, c.Chemin, c.Libelle, c.Type)));
        G("Société",
            ("societe.raison_sociale", "Raison sociale", "texte"), ("societe.forme_juridique", "Forme juridique (libellé)", "texte"),
            ("societe.capital", "Capital (« 250 000 € »)", "texte"), ("societe.rcs", "RCS", "texte"), ("societe.siret", "SIRET", "texte"),
            ("societe.tva", "TVA intracommunautaire", "texte"), ("societe.naf", "Code NAF", "texte"), ("societe.adresse", "Adresse (lignes)", "liste"),
            ("societe.telephone", "Téléphone", "texte"), ("societe.courriel", "Courriel", "texte"));
        G("Mentions de la société (Paramètres › Éditions)",
            ("societe.mentions.decennale.assureur", "Assureur décennale", "texte"), ("societe.mentions.decennale.adresse", "Adresse de l'assureur", "texte"),
            ("societe.mentions.decennale.police", "N° de police décennale", "texte"), ("societe.mentions.decennale.couverture", "Couverture géographique", "texte"),
            ("societe.mentions.penalites", "Pénalités de retard", "texte"), ("societe.mentions.indemnite", "Indemnité forfaitaire de recouvrement", "texte"),
            ("societe.mentions.escompte", "Escompte", "texte"), ("societe.mentions.tva_debits", "Option TVA sur les débits", "booleen"),
            ("societe.mentions.mediateur.nom", "Médiateur de la consommation", "texte"), ("societe.mentions.mediateur.site", "Site du médiateur", "texte"),
            ("societe.mentions.retractation", "Droit de rétractation", "texte"), ("societe.mentions.accord", "Mention du bon pour accord", "texte"),
            ("societe.mentions.libre", "Mention libre", "texte"));
        G("Document",
            ("document.id", "Identifiant", "nombre"), ("document.numero", "Numéro", "texte"), ("document.date", "Date", "date"), ("document.objet", "Objet", "texte"),
            ("document.type.code", "Code du type (V_DEVIS…)", "texte"), ("document.type.libelle", "Type", "texte"), ("document.type.famille", "Famille (V ventes, A achats, S stock)", "texte"),
            ("document.type.avancement", "Avancement du type (S situation, F facture, R reprise)", "texte"),
            ("document.statut.code", "Code du statut (BROUILLON, VALIDE, ANNULE…)", "texte"), ("document.statut.libelle", "Statut", "texte"),
            ("document.verrouille", "Validé (verrouillé)", "booleen"), ("document.indice", "Indice", "texte"), ("document.devise", "Devise", "texte"),
            ("document.notre_reference", "Notre référence", "texte"), ("document.reference_externe", "Référence externe", "texte"), ("document.date_externe", "Date externe", "date"),
            ("document.validite_jours", "Validité (jours)", "nombre"), ("document.date_validite", "Fin de validité", "date"),
            ("document.condition.code", "Code de la condition de paiement", "texte"), ("document.condition.libelle", "Condition de paiement", "texte"),
            ("document.mode_reglement", "Mode de règlement", "texte"), ("document.nature_avoir", "Nature de l'avoir (ANNULATION, AVANCEMENT…)", "texte"),
            ("document.entete", "Entête complet (colonnes ent_* du document : document.entete.ent_…)", "objet"));
        G("Avancement (situations, factures d'avancement)",
            ("document.avancement", "Présent si le document est une pièce d'avancement (sinon vide)", "objet"),
            ("document.avancement.presentation", "Présentation (C cumul : situation, P période : facture)", "texte"),
            ("document.avancement.rang", "Numéro de situation", "nombre"),
            ("document.avancement.pied.marche_ht", "Montant HT du marché", "montant"), ("document.avancement.pied.pct_facture", "Pourcentage facturé (situation : réalisé) du marché", "nombre"),
            ("document.avancement.pied.nombre_precedents", "Nombre de pièces déjà facturées", "nombre"),
            ("document.avancement.pied.lignes", "Pied d'avancement : une ligne par total (HT, TVA, TTC, net)", "collection"),
            ("document.avancement.pied.lignes[].cle", "ht, tva, ttc ou net", "texte"), ("document.avancement.pied.lignes[].libelle", "Libellé du total", "texte"),
            ("document.avancement.pied.lignes[].precedent", "Cumul précédent", "montant"), ("document.avancement.pied.lignes[].periode", "Période", "montant"),
            ("document.avancement.pied.lignes[].cumul", "Cumul", "montant"));
        G("Client et payeur (coordonnées figées du document)",
            ("client.nom", "Client (raison sociale ou nom)", "texte"), ("client.code", "Code du client", "texte"), ("client.contact", "Contact", "texte"),
            ("client.adresse", "Adresse (lignes)", "liste"), ("client.courriel", "Courriel", "texte"), ("client.telephone", "Téléphone", "texte"),
            ("client.siret", "SIRET", "texte"), ("client.tva", "TVA intracommunautaire", "texte"),
            ("payeur.nom", "Payeur (vide s'il est le client)", "texte"), ("payeur.contact", "Contact du payeur", "texte"), ("payeur.adresse", "Adresse du payeur (lignes)", "liste"));
        G("Adresse des travaux ou de livraison",
            ("adresse_travaux.origine", "Origine (CHANTIER, DEPOT, COMPTOIR, LIBRE)", "texte"), ("adresse_travaux.libelle", "Libellé", "texte"),
            ("adresse_travaux.adresse", "Adresse (lignes)", "liste"), ("adresse_travaux.contact", "Contact sur place", "texte"),
            ("adresse_travaux.telephone", "Téléphone", "texte"), ("adresse_travaux.instructions", "Instructions", "texte"), ("adresse_travaux.mention", "Mention", "texte"));
        G("Rédacteur et rattachement",
            ("redacteur.nom", "Rédacteur (prénom nom)", "texte"), ("redacteur.civilite", "Civilité du rédacteur", "texte"),
            ("rattachement.projet.code", "Projet (code)", "texte"), ("rattachement.projet.libelle", "Projet", "texte"),
            ("rattachement.affaire.code", "Affaire (code)", "texte"), ("rattachement.affaire.libelle", "Affaire", "texte"),
            ("rattachement.chantier.code", "Chantier (code)", "texte"), ("rattachement.chantier.libelle", "Chantier", "texte"),
            ("rattachement.marche.code", "Marché (code)", "texte"), ("rattachement.marche.libelle", "Marché", "texte"), ("rattachement.marche.montant_ht", "Montant HT du marché", "montant"));
        G("Intervenants",
            ("intervenants", "Annuaire du document (première ligne : client ou fournisseur)", "collection"),
            ("intervenants[].fonction", "Fonction (CLIENT, PAYEUR, ARCHITECTE…)", "texte"), ("intervenants[].per_id", "Tiers (identifiant)", "nombre"),
            ("intervenants[].ind_id", "Contact (identifiant)", "nombre"), ("intervenants[].principal", "Principal", "booleen"),
            ("intervenants[].paiement_direct", "Paiement direct", "booleen"), ("intervenants[].commentaire", "Commentaire", "texte"));
        G("Lignes du document",
            ("lignes", "Lignes imprimées, dans l'ordre (sans les lignes « ne pas imprimer » ni les frais annexes)", "collection"),
            ("lignes[].type", "SECTION, TITRE, OUVRAGE, ELEMENT, TEXTE, SOUS_TOTAL, SAUT_PAGE, IMAGE, PIED (pied de section)", "texte"),
            ("lignes[].niveau", "Profondeur (0 = racine)", "nombre"), ("lignes[].numero", "Numérotation (1.2.3)", "texte"), ("lignes[].code", "Code", "texte"),
            ("lignes[].libelle_html", "Libellé affiché (HTML : html: true)", "html"), ("lignes[].libelle", "Libellé en texte brut", "texte"),
            ("lignes[].qte", "Quantité", "nombre"), ("lignes[].unite", "Unité", "texte"), ("lignes[].pu", "Prix unitaire HT remisé", "montant"),
            ("lignes[].pu_brut", "Prix unitaire HT avant remise", "montant"), ("lignes[].remise_pct", "Remise de la ligne (%)", "nombre"),
            ("lignes[].montant", "Montant HT (pièce d'avancement : période)", "montant"), ("lignes[].taux_tva", "Taux de TVA", "nombre"),
            ("lignes[].type_prix", "V vendu, O option, M pour mémoire, F frais annexes", "texte"), ("lignes[].option", "Option", "booleen"),
            ("lignes[].pour_memoire", "Pour mémoire", "booleen"), ("lignes[].variante", "Variante", "booleen"), ("lignes[].composante", "Composante d'un ouvrage", "booleen"),
            ("lignes[].tranche", "Tranche (section, titre)", "booleen"), ("lignes[].compte_total", "Comptée dans le total (pour les cumuls)", "booleen"),
            ("lignes[].avt_pct", "Avancement cumulé (%)", "nombre"), ("lignes[].avt_qte_cumul", "Quantité cumulée", "nombre"),
            ("lignes[].avt_montant_cumul", "Montant HT cumulé", "montant"), ("lignes[].avt_montant_precedent", "Montant HT précédent", "montant"),
            ("lignes[].avt_pct_precedent", "Avancement précédent (%)", "nombre"), ("lignes[].avt_qte_marche", "Quantité du marché", "nombre"),
            ("lignes[].avt_montant_marche", "Montant HT du marché", "montant"));
        G("Pied et totaux",
            ("pied", "Pied imprimable, dans l'ordre", "collection"), ("pied[].genre", "total, sous_total, poste, tva", "texte"),
            ("pied[].cle", "TOTAL_HT, HT_NET, TOTAL_TTC, NET, TVA…", "texte"), ("pied[].libelle", "Libellé", "texte"), ("pied[].mode", "Poste : P %, M montant, C coefficient", "texte"),
            ("pied[].taux", "Taux (poste en %, TVA)", "nombre"), ("pied[].base", "Base du calcul", "montant"), ("pied[].montant", "Montant", "montant"),
            ("pied[].mention", "Mention de TVA (autoliquidation…)", "texte"),
            ("tva", "TVA par taux", "collection"), ("tva[].code", "Code TVA", "texte"), ("tva[].taux", "Taux", "nombre"), ("tva[].base", "Base HT", "montant"),
            ("tva[].montant", "Montant de TVA", "montant"), ("tva[].mention", "Mention", "texte"),
            ("totaux.ht", "Total HT net", "montant"), ("totaux.tva", "Total TVA", "montant"), ("totaux.ttc", "Total TTC", "montant"), ("totaux.net", "Net à payer", "montant"),
            ("echeances", "Échéancier", "collection"), ("echeances[].rang", "Rang", "nombre"), ("echeances[].date", "Date (vide : à réception)", "date"),
            ("echeances[].montant", "Montant", "montant"), ("echeances[].mode", "Mode de règlement", "texte"), ("echeances[].nature", "Nature (RETENUE : retenue de garantie)", "texte"));
        G("Étapes d'un ordre (module Exécution)",
            ("etapes", "Étapes de l'ordre (dans l'ordre)", "collection"), ("etapes[].libelle", "État", "texte"), ("etapes[].code", "Code de l'état", "texte"),
            ("etapes[].nature", "Nature (TACHE, JALON, ATTENTE)", "texte"), ("etapes[].date_obligatoire", "Date obligatoire (colonne du tableau)", "booleen"),
            ("etapes[].prevu_le", "Date prévisionnelle", "date"), ("etapes[].valide_le", "Date de validation", "date"), ("etapes[].valide_par", "Validée par", "texte"),
            ("etapes[].controle", "Contrôle du N+1 attendu", "booleen"), ("etapes[].controle_le", "Date du contrôle", "date"), ("etapes[].controle_par", "Contrôlée par", "texte"),
            ("etapes[].ressource", "Ressource principale (étape, sinon ordre)", "texte"), ("etapes[].commentaire", "Commentaire", "texte"));
        G("Textes de l'édition",
            ("textes.intro", "Introduction (HTML, avant les lignes)", "html"), ("textes.fin", "Conclusion (HTML, après le pied)", "html"));
        G("Source annexe marche_documents (sources_annexes)",
            ("sources.marche_documents", "Commande de base et avenants du marché", "collection"), ("sources.marche_documents[].role", "BASE ou AVENANT", "texte"),
            ("sources.marche_documents[].rang", "Rang (0 base, 1, 2… avenants)", "nombre"), ("sources.marche_documents[].numero", "Numéro", "texte"),
            ("sources.marche_documents[].date", "Date", "date"), ("sources.marche_documents[].objet", "Objet", "texte"),
            ("sources.marche_documents[].montant_ht", "Montant HT net", "montant"), ("sources.marche_documents[].facture_ht", "Travaux facturés HT (ce document compris)", "montant"),
            ("sources.marche_documents[].pct_facture", "Pourcentage facturé", "nombre"));
        G("Source annexe avancements_precedents (sources_annexes)",
            ("sources.avancements_precedents", "Situations et factures d'avancement validées du marché avant ce document", "collection"),
            ("sources.avancements_precedents[].type", "Type", "texte"), ("sources.avancements_precedents[].numero", "Numéro", "texte"),
            ("sources.avancements_precedents[].date", "Date", "date"), ("sources.avancements_precedents[].rang", "Numéro de situation", "nombre"),
            ("sources.avancements_precedents[].facture", "Facture (vrai) ou situation", "booleen"), ("sources.avancements_precedents[].montant_ht", "Montant HT", "montant"),
            ("sources.avancements_precedents[].montant_tva", "TVA", "montant"), ("sources.avancements_precedents[].montant_ttc", "Montant TTC", "montant"),
            ("sources.avancements_precedents[].net", "Net à payer", "montant"), ("sources.avancements_precedents[].reste", "Reste à payer (module Règlements)", "montant"));
        return VersJson(d);
    }

    /// <summary>Entrées du dictionnaire au format JSON : { groupe, chemin, libelle, type }.</summary>
    public static JsonArray VersJson(IEnumerable<(string Groupe, string Chemin, string Libelle, string Type)> d) =>
        new(d.Select(c => (JsonNode?)new JsonObject { ["groupe"] = c.Groupe, ["chemin"] = c.Chemin, ["libelle"] = c.Libelle, ["type"] = c.Type }).ToArray());
}

/// <summary>
/// Sources d'édition « fiche » (identifiant « type/id ») et « liste » (identifiant de la vue) : données lues par les
/// services des modules Fiche et Liste avec leurs droits (champs confidentiels jamais lus, colonnes de la vue
/// seulement), valeurs mises en forme pour l'impression (listes de choix, booléens, dates).
/// </summary>
public static class SourcesFicheListeEdition
{
    public const int LignesMax = 5000;

    /// <summary>Dictionnaire de la source « fiche » (données de toute fiche, quel que soit son type).</summary>
    public static JsonArray DictionnaireFiche()
    {
        (string, string, string, string)[] d =
        [
            ("Fiche", "fiche.type", "Type de fiche (projet, chantier, personne…)", "texte"), ("Fiche", "fiche.id", "Identifiant", "texte"),
            ("Fiche", "fiche.libelle", "Libellé du type de fiche", "texte"), ("Fiche", "fiche.titre", "Titre de la fiche", "texte"),
            ("Fiche", "fiche.sous_titre", "Sous-titre", "texte"),
            ("Valeurs", "valeurs", "Valeurs mises en forme par code de champ (valeurs.<code> ; champs supplémentaires sans le +)", "objet"),
            ("Sections", "sections", "Onglets de la fiche (champs lisibles, confidentiels exclus)", "collection"),
            ("Sections", "sections[].titre", "Titre de l'onglet", "texte"), ("Sections", "sections[].groupes", "Groupes de l'onglet", "collection"),
            ("Sections", "sections[].groupes[].titre", "Titre du groupe", "texte"), ("Sections", "sections[].groupes[].champs", "Champs du groupe", "collection"),
            ("Sections", "sections[].groupes[].champs[].code", "Code du champ", "texte"), ("Sections", "sections[].groupes[].champs[].libelle", "Libellé du champ", "texte"),
            ("Sections", "sections[].groupes[].champs[].valeur", "Valeur mise en forme", "texte"), ("Sections", "sections[].groupes[].champs[].html", "Valeur HTML", "booleen"),
            ("Société", "societe.raison_sociale", "Raison sociale", "texte"), ("Société", "societe.siret", "SIRET", "texte"), ("Société", "societe.tva", "TVA", "texte"),
            ("Société", "societe.adresse", "Adresse (lignes)", "liste"), ("Société", "societe.telephone", "Téléphone", "texte"), ("Société", "societe.courriel", "Courriel", "texte"),
        ];
        return SourceDocumentEdition.VersJson(d);
    }

    /// <summary>Dictionnaire de la source « liste » (vue enregistrée, recherche en cours).</summary>
    public static JsonArray DictionnaireListe()
    {
        (string, string, string, string)[] d =
        [
            ("Liste", "liste.nom", "Nom de la vue", "texte"), ("Liste", "liste.theme", "Thème", "texte"), ("Liste", "liste.recherche", "Recherche en cours", "texte"),
            ("Liste", "liste.nombre", "Nombre de lignes imprimées", "nombre"), ("Liste", "liste.tronquee", "Vrai si limitée à 5 000 lignes", "booleen"),
            ("Colonnes", "colonnes", "Colonnes de la vue (pour colonnes_source d'un tableau)", "collection"), ("Colonnes", "colonnes[].cle", "Code de la colonne", "texte"),
            ("Colonnes", "colonnes[].titre", "Titre", "texte"), ("Colonnes", "colonnes[].largeur", "Largeur", "texte"),
            ("Colonnes", "colonnes[].alignement", "Alignement", "texte"), ("Colonnes", "colonnes[].format", "Format d'impression", "texte"),
            ("Lignes", "lignes", "Lignes de la vue (valeurs mises en forme, par code de colonne : ligne.<code>)", "collection"),
            ("Lignes", "lignes[]._texte", "Valeurs de la ligne dans l'ordre des colonnes", "liste"), ("Lignes", "lignes[]._titre", "Première valeur (étiquettes)", "texte"),
            ("Lignes", "lignes[]._suite", "Valeurs suivantes (étiquettes)", "liste"),
            ("Société", "societe.raison_sociale", "Raison sociale", "texte"), ("Société", "societe.adresse", "Adresse (lignes)", "liste"),
        ];
        return SourceDocumentEdition.VersJson(d);
    }

    public static async Task<ElementEdite?> ElementFiche(IServiceProvider services, string id, Utilisateur u, CancellationToken ct)
    {
        var (type, cle) = Decouper(id);
        if (type is null) return null;
        var fiches = services.GetRequiredService<ServiceFiche>();
        var def = await fiches.Definition(type, u, ct);
        var fiche = await fiches.Charger(type, cle!, false, u, ct);
        return new ElementEdite(type, $"{def.Libelle} {Titre(def.Titre, fiche, def) ?? cle}".Trim());
    }

    public static async Task<ElementEdite?> ElementListe(IServiceProvider services, string id, Utilisateur u, CancellationToken ct)
    {
        if (!long.TryParse(id, out var vue)) return null;
        var v = await services.GetRequiredService<ServiceListe>().Vue(vue, u, ct);
        return new ElementEdite(v.VliTheme, v.VliNom);
    }

    private static (string? Type, string? Id) Decouper(string id)
    {
        var i = id.IndexOf('/');
        return i <= 0 || i == id.Length - 1 ? (null, null) : (id[..i], id[(i + 1)..]);
    }

    /// <summary>Titre d'une fiche : modèle « [civilite] [prenom] [nom] » de la définition, valeurs mises en forme.</summary>
    private static string? Titre(string? modele, FicheDto fiche, DefinitionFicheDto def)
    {
        if (string.IsNullOrWhiteSpace(modele)) return null;
        var s = System.Text.RegularExpressions.Regex.Replace(modele, @"\[([a-z0-9_]+)\]", m =>
        {
            var champ = def.Champs.FirstOrDefault(c => c.Code == m.Groups[1].Value);
            return champ is null ? "" : Texte(champ, fiche.Valeurs.GetValueOrDefault(champ.Code)) ?? "";
        });
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ").Trim();
        return s.Length == 0 ? null : s;
    }

    /// <summary>Valeur lisible d'un champ de fiche (null : vide ou non imprimable : json, mot de passe).</summary>
    private static string? Texte(ChampFiche c, object? v)
    {
        if (v is null) return null;
        if (v is JsonElement e)
        {
            if (e.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
            if (e.ValueKind == JsonValueKind.True) return "Oui";
            if (e.ValueKind == JsonValueKind.False) return "Non";
            if (e.ValueKind == JsonValueKind.Array)
                return string.Join(", ", e.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? Option(c, x.GetString()) : null).Where(x => !string.IsNullOrEmpty(x)));
            if (e.ValueKind is JsonValueKind.Object) return null;
            v = e.ValueKind == JsonValueKind.String ? e.GetString() : e.GetRawText();
        }
        if (c.Type is "json" or "motdepasse" || c.Gere) return null;
        if (v is bool b) return b ? "Oui" : "Non";
        var s = Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (c.Type == "date" && s.Length >= 10 && s[4] == '-') return $"{s[8..10]}/{s[5..7]}/{s[..4]}";
        if (c.Type == "booleen") return s is "true" or "True" ? "Oui" : "Non";
        if (c.Type == "nombre") return s.Replace('.', ',');
        if (c.Type == "html") return s;
        return Option(c, s);
    }

    private static string? Option(ChampFiche c, string? v) => c.Options?.FirstOrDefault(o => o.Valeur == v)?.Libelle ?? v;

    /// <summary>Fiche : { fiche, sections: [{ titre, groupes: [{ titre, champs: [{ code, libelle, valeur, html }] }] }], valeurs }.</summary>
    public static async Task<JsonObject?> DonneesFiche(IServiceProvider services, string id, Utilisateur u, CancellationToken ct)
    {
        var (type, cle) = Decouper(id);
        if (type is null) return null;
        var fiches = services.GetRequiredService<ServiceFiche>();
        var def = await fiches.Definition(type, u, ct);
        var fiche = await fiches.Charger(type, cle!, false, u, ct);
        var champs = def.Champs.Where(c => c.Actif).ToDictionary(c => c.Code);
        foreach (var c in def.Supplementaires.Where(c => c.Actif)) champs.TryAdd("+" + c.Code, c);
        object? Valeur(string code) => code.StartsWith('+') ? fiche.Proprietes.GetValueOrDefault(code[1..]) : fiche.Valeurs.GetValueOrDefault(code);
        JsonObject? Champ(string code)
        {
            if (!champs.TryGetValue(code, out var c) || fiche.Masques.Contains(code)) return null;
            var t = Texte(c, Valeur(code));
            return t is null ? null : new JsonObject { ["code"] = code, ["libelle"] = c.Libelle, ["valeur"] = t, ["html"] = c.Type == "html" };
        }
        var sections = new JsonArray();
        var places = new HashSet<string>();
        foreach (var s in def.Sections)
        {
            var groupes = new JsonArray();
            var liste = s.Groupes ?? (s.Champs is null ? [] : [new GroupeChamps { Champs = s.Champs }]);
            foreach (var g in liste)
            {
                var cs = new JsonArray(g.Champs.Select(Champ).Where(x => x is not null).Select(x => (JsonNode?)x).ToArray());
                places.UnionWith(g.Champs);
                if (cs.Count > 0) groupes.Add(new JsonObject { ["titre"] = g.Titre, ["champs"] = cs });
            }
            if (groupes.Count > 0) sections.Add(new JsonObject { ["titre"] = s.Titre, ["groupes"] = groupes });
        }
        // Champs supplémentaires sans place dans les sections : groupe « Compléments ».
        var autres = new JsonArray(champs.Keys.Where(k => k.StartsWith('+') && !places.Contains(k)).Select(Champ).Where(x => x is not null).Select(x => (JsonNode?)x).ToArray());
        if (autres.Count > 0) sections.Add(new JsonObject { ["titre"] = "Compléments", ["groupes"] = new JsonArray(new JsonObject { ["titre"] = null, ["champs"] = autres }) });
        var valeurs = new JsonObject();
        foreach (var (code, c) in champs) if (!fiche.Masques.Contains(code) && Texte(c, Valeur(code)) is { } t) valeurs[code.TrimStart('+')] = t;
        return new JsonObject
        {
            ["fiche"] = new JsonObject { ["type"] = type, ["id"] = cle, ["libelle"] = def.Libelle, ["titre"] = Titre(def.Titre, fiche, def) ?? cle, ["sous_titre"] = Titre(def.SousTitre, fiche, def) },
            ["sections"] = sections, ["valeurs"] = valeurs,
        };
    }

    /// <summary>
    /// Liste : { liste: { nom, theme, recherche, tronquee }, colonnes: [{ cle, titre, largeur, alignement, format }], lignes }
    /// (au plus 5 000 lignes, lues par lots ; valeurs des colonnes à choix remplacées par leur libellé ; `_texte` :
    /// valeurs affichables dans l'ordre des colonnes, pour les étiquettes).
    /// </summary>
    public static async Task<JsonObject?> DonneesListe(IServiceProvider services, string id, string? recherche, Utilisateur u, CancellationToken ct)
    {
        if (!long.TryParse(id, out var vueId)) return null;
        var listes = services.GetRequiredService<ServiceListe>();
        var vue = await listes.Vue(vueId, u, ct);
        var colonnes = new JsonArray();
        var options = new Dictionary<string, Dictionary<string, string>>();
        var formats = new Dictionary<string, string?>();
        if (vue.Definition.TryGetProperty("colonnes", out var cols))
            foreach (var c in cols.EnumerateArray())
            {
                var code = c.GetProperty("code").GetString()!;
                var format = c.TryGetProperty("format", out var f) ? f.GetString() : null;
                if (format == "picto" && !(c.TryGetProperty("titre", out var tt) && tt.GetString() is { Length: > 0 })) continue; // pictogramme sans titre : non imprimé
                formats[code] = format;
                if (c.TryGetProperty("options", out var o) && o.ValueKind == JsonValueKind.Array)
                    options[code] = o.EnumerateArray().Where(x => x.TryGetProperty("valeur", out _))
                        .ToDictionary(x => x.GetProperty("valeur").ToString(), x => x.TryGetProperty("libelle", out var l) ? l.GetString() ?? "" : x.GetProperty("valeur").ToString());
                var largeur = "*";
                if (c.TryGetProperty("largeur", out var l2) && l2.ValueKind == JsonValueKind.Object)
                {
                    var mode = l2.TryGetProperty("mode", out var m) ? m.GetString() : null;
                    var val = l2.TryGetProperty("valeur", out var lv) && lv.ValueKind == JsonValueKind.Number ? lv.GetDouble() : 1;
                    largeur = mode == "fixe" ? $"{Math.Round(val * 0.26, 1).ToString(System.Globalization.CultureInfo.InvariantCulture)}mm" : $"{val.ToString(System.Globalization.CultureInfo.InvariantCulture)}*";
                }
                colonnes.Add(new JsonObject
                {
                    ["cle"] = code, ["titre"] = c.TryGetProperty("titre", out var t) ? t.GetString() : code, ["largeur"] = largeur,
                    ["alignement"] = c.TryGetProperty("alignement", out var a) ? a.GetString() : format == "nombre" ? "droite" : null,
                    ["format"] = format switch { "date" => "date", "nombre" => "nombre:2", _ => null },
                });
            }
        var lignes = new JsonArray();
        List<string?>? apres = null;
        var tronquee = false;
        while (true)
        {
            var lot = await listes.Lot(new DemandeListe { VueId = vueId, Recherche = recherche, Taille = 1000, Apres = apres }, u, ct);
            foreach (var l in lot.Lignes)
            {
                if (lignes.Count >= LignesMax) { tronquee = true; break; }
                var o = new JsonObject();
                var textes = new JsonArray();
                foreach (var col in colonnes)
                {
                    var code = col!["cle"]!.GetValue<string>();
                    var v = l.GetValueOrDefault(code);
                    var s = v switch
                    {
                        null => null,
                        bool b => b ? "Oui" : "Non",
                        DateTime d => d.ToString("yyyy-MM-dd"),
                        DateOnly d => d.ToString("yyyy-MM-dd"),
                        DateTimeOffset d => d.ToString("yyyy-MM-dd"),
                        string[] arr => string.Join(", ", arr.Select(x => options.GetValueOrDefault(code)?.GetValueOrDefault(x) ?? x)),
                        IFormattable f => f.ToString(null, System.Globalization.CultureInfo.InvariantCulture),
                        _ => v.ToString(),
                    };
                    if (s is not null && options.TryGetValue(code, out var opt) && opt.TryGetValue(s, out var lib)) s = lib;
                    if (s is not null && formats.GetValueOrDefault(code) == "coche") s = s is "true" or "True" or "Oui" ? "Oui" : "";
                    o[code] = s;
                    // Étiquettes : valeurs affichables, sans le code de l'élément (identifiant technique).
                    if (!string.IsNullOrWhiteSpace(s) && code != "code") textes.Add(formats.GetValueOrDefault(code) == "date" && s.Length >= 10 ? $"{s[8..10]}/{s[5..7]}/{s[..4]}" : s);
                }
                o["_texte"] = textes;
                o["_titre"] = textes.Count > 0 ? textes[0]!.DeepClone() : null;
                o["_suite"] = new JsonArray(textes.Skip(1).Select(x => x!.DeepClone()).ToArray());
                lignes.Add(o);
            }
            if (tronquee || lot.Suite is null) break;
            apres = lot.Suite;
        }
        return new JsonObject
        {
            ["liste"] = new JsonObject { ["nom"] = vue.VliNom, ["theme"] = vue.VliTheme, ["recherche"] = recherche, ["tronquee"] = tronquee, ["nombre"] = lignes.Count },
            ["colonnes"] = colonnes, ["lignes"] = lignes,
        };
    }
}

/// <summary>Paramètres des éditions du cœur : mentions de la société (§ 15.4).</summary>
public static class ParametresEditionBtp
{
    public static IEndpointRouteBuilder MapEditionsBtp(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/editions-btp");
        g.MapGet("/mentions", async (LogiBtpContext db, CancellationToken ct) =>
        {
            var json = await db.Database.SqlQueryRaw<string>("SELECT coalesce((SELECT pae_valeur::text FROM parametre_edition WHERE pae_cle = 'mentions'), '{{}}') AS \"Value\"").FirstAsync(ct);
            return Results.Content(json, "application/json");
        });
        g.MapPut("/mentions", async (JsonObject mentions, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO parametre_edition (pae_cle, pae_valeur, pae_modifie_le, pae_modifie_par) VALUES ('mentions', @v::jsonb, now(), @u)
                ON CONFLICT (pae_cle) DO UPDATE SET pae_valeur = excluded.pae_valeur, pae_modifie_le = now(), pae_modifie_par = excluded.pae_modifie_par
                """, [new NpgsqlParameter("v", mentions.ToJsonString()), new NpgsqlParameter("u", u.Code)], ct);
            return Results.Content(mentions.ToJsonString(), "application/json");
        });
        return api;
    }
}
