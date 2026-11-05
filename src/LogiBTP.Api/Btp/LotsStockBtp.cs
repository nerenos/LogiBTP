using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Domaine;
using LogiBTP.Ged.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Lots et numéros de série, lot S24-c (`db/272`, module `093h` ; ANALYSE-MODULE-STOCK.md § 11, S24.5, S24.6) : fiche
/// d'un lot (article, suivi, stock par lieu, traçabilité de ses mouvements avec leur pièce, comptages, chantiers servis,
/// certificats), certificats matière rangés dans la GED du lot (catégorie <see cref="Categorie"/>) et copiés dans la GED
/// de chaque chantier où le lot sort (file `stk_lot_certificat_copie` : remplie à la validation d'une sortie et au dépôt
/// d'un certificat, traitée par <see cref="CopiesCertificatsLots"/> hors de la transaction de la pièce).
/// </summary>
public static class LotsStockBtp
{
    public const string TypeElement = "stk_lot";
    public const string Categorie = "certificat_matiere";
    private static readonly Utilisateur Service = new("archivage_ged", Profils.Admin);

    private const string SqlFiche = """
        SELECT json_build_object(
          'id', l.lot_id, 'numero', l.lot_numero, 'fabrication', l.lot_fabrication, 'limite', l.lot_limite, 'coulee', l.lot_coulee, 'norme', l.lot_norme,
          'commentaire', l.lot_commentaire, 'cree_par', l.lot_cree_par, 'cree_le', l.lot_cree_le, 'perime', l.lot_limite < current_date,
          'fournisseur', (SELECT json_build_object('id', p.per_id, 'nom', p.per_raison_sociale) FROM personne p WHERE p.per_id = l.lot_tiers_id),
          'article', (SELECT json_build_object('id', e.ele_id, 'code', e.ele_code, 'libelle', e.ele_libelle, 'unite', e.ele_unt_stock) FROM element e WHERE e.ele_id = l.lot_ele_id),
          'suivi', (SELECT json_build_object('suivi', s.sas_suivi, 'perissable', s.sas_perissable, 'certificat', s.sas_certificat) FROM stk_article_suivi s WHERE s.sas_ele_id = l.lot_ele_id),
          'stock', coalesce((SELECT json_agg(json_build_object('lieu_id', q.lieu_id, 'code', c.cha_code, 'libelle', c.cha_libelle, 'depot', c.cha_depot, 'quantite', q.quantite) ORDER BY c.cha_code)
                    FROM v_stk_stock_lot q JOIN chantier c ON c.cha_id = q.lieu_id WHERE q.lot_id = l.lot_id), '[]'),
          'chantiers', coalesce((SELECT json_agg(json_build_object('id', c.cha_id, 'code', c.cha_code, 'libelle', c.cha_libelle) ORDER BY c.cha_code)
                    FROM v_stk_lot_chantier v JOIN chantier c ON c.cha_id = v.cha_id WHERE v.lot_id = l.lot_id), '[]'),
          'mouvements', coalesce((SELECT json_agg(json_build_object('id', m.mvt_id, 'date', m.mvt_date, 'quantite', m.mvt_quantite, 'lieu', c.cha_code, 'lieu_libelle', c.cha_libelle,
                    'depot', c.cha_depot, 'ent_id', d.ent_id, 'piece', d.ent_numero, 'type_piece', t.tyd_libelle, 'tiers', p.per_raison_sociale, 'origine', m.mvt_origine,
                    'chantier', (SELECT x.cha_code FROM chantier x WHERE x.cha_id = coalesce(d.ent_stk_destination_id, d.ent_chantier_id) AND x.cha_id <> m.mvt_lieu_id))
                    ORDER BY m.mvt_date, m.mvt_id)
                    FROM stk_mouvement m JOIN chantier c ON c.cha_id = m.mvt_lieu_id LEFT JOIN document d ON d.ent_id = m.mvt_ent_id
                    LEFT JOIN type_document t ON t.tyd_id = d.ent_tyd_id LEFT JOIN personne p ON p.per_id = m.mvt_tiers_id
                    WHERE m.mvt_lot_id = l.lot_id), '[]'),
          'comptages', coalesce((SELECT json_agg(json_build_object('date', k.cpt_date, 'lieu', c.cha_code, 'quantite', x.cpl_quantite, 'commentaire', k.cpt_commentaire,
                    'inventaire', k.cpt_lin_id) ORDER BY k.cpt_date)
                    FROM stk_comptage_lot x JOIN stk_comptage k ON k.cpt_id = x.cpl_cpt_id JOIN chantier c ON c.cha_id = k.cpt_lieu_id WHERE x.cpl_lot_id = l.lot_id), '[]'),
          'certificats', coalesce((SELECT json_agg(json_build_object('id', g.dge_id, 'titre', g.dge_titre, 'le', g.dge_cree_le,
                    'version', (SELECT v.vge_id FROM version_ged v WHERE v.vge_document = g.dge_id ORDER BY v.vge_numero DESC LIMIT 1)) ORDER BY g.dge_cree_le DESC)
                    FROM document_ged g WHERE g.dge_type_element = 'stk_lot' AND g.dge_id_element = l.lot_id::text AND g.dge_categorie = 'certificat_matiere'
                      AND NOT g.dge_supprime), '[]'))::text AS "Value"
        FROM stk_lot l WHERE l.lot_id = @id
        """;

    /// <summary>
    /// Copies à faire des certificats d'un lot vers les chantiers qu'il a servis : après la validation d'une pièce (ses
    /// mouvements de lot) ou le dépôt d'un certificat (tous les chantiers déjà servis par le lot). Dans la transaction de
    /// l'appelant : la copie elle-même est faite par la tâche de fond.
    /// </summary>
    public static Task<int> PlanifierCopiesAsync(DbContext db, long? entId, long? lot, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO stk_lot_certificat_copie (slc_lot_id, slc_lieu_id, slc_dge_source)
            SELECT DISTINCT v.lot_id, v.cha_id, g.dge_id
            FROM v_stk_lot_chantier v
            JOIN document_ged g ON g.dge_type_element = 'stk_lot' AND g.dge_id_element = v.lot_id::text AND g.dge_categorie = 'certificat_matiere' AND NOT g.dge_supprime
            WHERE ({lot}::bigint IS NULL OR v.lot_id = {lot}::bigint)
              AND ({entId}::bigint IS NULL OR v.lot_id IN (SELECT m.mvt_lot_id FROM stk_mouvement m WHERE m.mvt_ent_id = {entId}::bigint))
            ON CONFLICT DO NOTHING
            """, ct);

    private sealed record LotLigneSql(long Ligne, string Numero, decimal Quantite, DateOnly? Limite, string? Coulee);

    /// <summary>
    /// Lots de chaque ligne d'une pièce pour les éditions (`lignes[].lots`, S24.12) : ceux des mouvements écrits à la
    /// validation (lots proposés compris ; un transfert compte une seule fois), sinon la répartition saisie dans
    /// `lig_proprietes.lots` (brouillon).
    /// </summary>
    public static async Task<Dictionary<long, JsonArray>> LotsLignesAsync(DbContext db, long entId, IEnumerable<(long Ligne, System.Text.Json.JsonDocument? Proprietes)> lignes, CancellationToken ct)
    {
        var r = new Dictionary<long, JsonArray>();
        if (!await db.Database.SqlQuery<bool>($"SELECT to_regclass('stk_lot') IS NOT NULL AS \"Value\"").FirstAsync(ct)) return r;
        var mvts = await db.Database.SqlQuery<LotLigneSql>($"""
            SELECT m.mvt_lig_id AS ligne, l.lot_numero AS numero, sum(abs(m.mvt_quantite)) / count(DISTINCT m.mvt_lieu_id) AS quantite, l.lot_limite AS limite, l.lot_coulee AS coulee
            FROM stk_mouvement m JOIN stk_lot l ON l.lot_id = m.mvt_lot_id
            WHERE m.mvt_ent_id = {entId} AND m.mvt_lig_id IS NOT NULL
            GROUP BY m.mvt_lig_id, l.lot_id ORDER BY l.lot_numero
            """).ToListAsync(ct);
        foreach (var g in mvts.GroupBy(x => x.Ligne))
            r[g.Key] = new JsonArray(g.Select(x => (JsonNode?)new JsonObject
            {
                ["numero"] = x.Numero, ["quantite"] = x.Quantite, ["limite"] = x.Limite?.ToString("yyyy-MM-dd"), ["coulee"] = x.Coulee,
            }).ToArray());
        foreach (var (ligne, proprietes) in lignes)
        {
            if (r.ContainsKey(ligne) || proprietes is null || proprietes.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object || !proprietes.RootElement.TryGetProperty("lots", out var lots) || lots.ValueKind != System.Text.Json.JsonValueKind.Array) continue;
            var a = new JsonArray();
            foreach (var x in lots.EnumerateArray())
            {
                string? S(string n) => x.TryGetProperty(n, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
                if (string.IsNullOrWhiteSpace(S("numero"))) continue;
                a.Add(new JsonObject
                {
                    ["numero"] = S("numero")!.Trim(), ["quantite"] = x.TryGetProperty("quantite", out var q) && q.TryGetDecimal(out var dq) ? dq : null,
                    ["limite"] = S("limite"), ["coulee"] = S("coulee"),
                });
            }
            if (a.Count > 0) r[ligne] = a;
        }
        return r;
    }

    /// <summary>Texte imprimé des lots d'une ligne (HTML échappé, virgule décimale ; l'API tourne sans cultures) : « Lots : A12 (4) ; B07 (6) ».</summary>
    public static string? TexteLots(JsonArray? lots)
    {
        if (lots is not { Count: > 0 }) return null;
        var morceaux = lots.Select(x => System.Net.WebUtility.HtmlEncode(x?["numero"]?.GetValue<string>() ?? "")
            + (x?["quantite"]?.GetValue<decimal?>() is decimal q ? $" ({q.ToString("0.###", CultureInfo.InvariantCulture).Replace('.', ',')})" : ""));
        return (lots.Count > 1 ? "Lots : " : "Lot : ") + string.Join(" ; ", morceaux);
    }

    private sealed record CopieSql(long Lot, long Lieu, long Source, string Numero, string? Article);

    /// <summary>Copies en attente (lot de 20) : contenu du certificat lu puis déposé dans la GED du chantier ; une copie en échec est retentée au passage suivant.</summary>
    public static async Task<int> CopierEnAttenteAsync(IServiceProvider services, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        if (!await db.Database.SqlQuery<bool>($"SELECT to_regclass('stk_lot_certificat_copie') IS NOT NULL AND f_module_actif('stock') AS \"Value\"").FirstAsync(ct)) return 0;
        var file = await db.Database.SqlQuery<CopieSql>($"""
            SELECT c.slc_lot_id AS lot, c.slc_lieu_id AS lieu, c.slc_dge_source AS source, l.lot_numero AS numero, e.ele_code AS article
            FROM stk_lot_certificat_copie c JOIN stk_lot l ON l.lot_id = c.slc_lot_id JOIN element e ON e.ele_id = l.lot_ele_id
            WHERE c.slc_dge_copie IS NULL ORDER BY c.slc_le LIMIT 20
            """).ToListAsync(ct);
        var ged = services.GetRequiredService<ServiceGed>();
        var n = 0;
        foreach (var c in file)
        {
            var contenu = await ged.LireContenu(c.Source, Service, ct);
            if (contenu is not { } x) continue;
            await using var flux = new MemoryStream(x.Octets);
            var fichier = new FormFile(flux, 0, x.Octets.Length, "fichier", x.NomFichier) { Headers = new HeaderDictionary(), ContentType = x.TypeMime ?? "application/octet-stream" };
            var d = await ged.DeposerFichier(fichier, new MetaDepot
            {
                Titre = $"Certificat matière {c.Article} – lot {c.Numero}", Categorie = Categorie, TypeElement = TypesFiche.Chantier,
                IdElement = c.Lieu.ToString(CultureInfo.InvariantCulture), Auteur = Service.Code,
                Resume = $"Copie du certificat du lot {c.Numero} sorti vers ce chantier (document {c.Source})",
            }, Service, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE stk_lot_certificat_copie SET slc_dge_copie = {d.Id} WHERE slc_lot_id = {c.Lot} AND slc_lieu_id = {c.Lieu} AND slc_dge_source = {c.Source}
                """, ct);
            n++;
        }
        return n;
    }

    public static IEndpointRouteBuilder MapLotsStock(this IEndpointRouteBuilder api)
    {
        api.MapGet("/stock/lots/{id:long}", async (long id, LogiBtpContext db, CancellationToken ct) =>
        {
            var json = await db.Database.SqlQueryRaw<string>(SqlFiche, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("Lot");
            return Results.Content(json, "application/json");
        });
        // Certificat matière déposé dans la GED du lot (catégorie posée d'office), puis copié vers les chantiers déjà servis.
        api.MapPost("/stock/lots/{id:long}/certificats", async (long id, HttpRequest requete, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var numero = await db.Database.SqlQuery<string?>($"SELECT lot_numero AS \"Value\" FROM stk_lot WHERE lot_id = {id}").FirstOrDefaultAsync(ct)
                ?? throw ExceptionMetier.Introuvable("Lot");
            var form = await requete.ReadFormAsync(ct);
            var fichier = form.Files.GetFile("fichier") ?? throw ExceptionMetier.Invalide("STK_CERTIFICAT", "Fichier du certificat attendu");
            var d = await ged.DeposerFichier(fichier, new MetaDepot
            {
                Titre = string.IsNullOrWhiteSpace(form["titre"]) ? $"Certificat matière – lot {numero}" : form["titre"].ToString().Trim(),
                Categorie = Categorie, TypeElement = TypeElement, IdElement = id.ToString(CultureInfo.InvariantCulture), Auteur = u.Code,
            }, u, ct);
            await PlanifierCopiesAsync(db, null, id, ct);
            return Results.Ok(new { id = d.Id });
        });
        return api;
    }
}

/// <summary>Tâche de fond : copies des certificats de lots vers la GED des chantiers servis, chaque minute, base par base.</summary>
public sealed class CopiesCertificatsLots(IServiceProvider services, Microsoft.Extensions.Options.IOptions<OptionsSocietes> societes, ILogger<CopiesCertificatsLots> journal)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            foreach (var societe in societes.Value.Societes())
            {
                try
                {
                    await using var portee = services.CreerPorteeSociete(societe);
                    var n = await LotsStockBtp.CopierEnAttenteAsync(portee.ServiceProvider, ct);
                    if (n > 0) journal.LogInformation("Certificats de lots ({Base}) : {Nombre} copie(s) vers les chantiers", societe.Code ?? "principale", n);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    journal.LogError(e, "Certificats de lots ({Base}) : copies en échec", societe.Code ?? "principale");
                }
            }
            try { await Task.Delay(TimeSpan.FromMinutes(1), ct); }
            catch (OperationCanceledException) { return; }
        }
    }
}
