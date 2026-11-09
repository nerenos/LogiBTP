using System.Text.Json;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Ged.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Bibliothèque simplifiée du terrain (plan terrain-suites, lot 17 ; TS17 b, TS15 a) : articles actifs de la
/// bibliothèque cherchés par code, libellé, mots-clés ou code-barres ; fiche réduite (photo, notices techniques de la
/// GED, unités, conditionnements) ; articles du chantier (lignes des commandes valables de ses marchés), gardés hors
/// ligne pour choisir les articles d'une demande d'approvisionnement. Aucun prix (ni achat, ni revient, ni vente) n'est
/// renvoyé. Pièces de la GED jamais confidentielles ni à accès restreint. Routes <c>/api/terrain/bibliotheque</c>
/// (nœud <c>terrain/demande</c>, Consulter).
/// </summary>
public static partial class TerrainBtp
{
    /// <summary>Résultats d'une recherche au plus.</summary>
    public const int ArticlesRechercheMax = 30;
    /// <summary>Articles d'un chantier au plus (gardés hors ligne).</summary>
    public const int ArticlesChantierMax = 500;
    /// <summary>Catégorie GED des notices techniques d'un élément (db/115).</summary>
    public const string CategorieNotice = "notice_technique";

    /// <summary>Pièce g de la GED visible sur le terrain (ni confidentielle, ni à accès restreint, ni supprimée).</summary>
    private const string SqlPieceElementVisible = """
        NOT g.dge_supprime AND NOT g.dge_archive AND g.dge_confidentialite IN ('PUBLIC', 'INTERNE')
          AND cardinality(g.dge_acces_profils) = 0 AND cardinality(g.dge_acces_utilisateurs) = 0
        """;

    /// <summary>
    /// Fiche réduite (JSON) de l'élément e de la bibliothèque b : sans aucune colonne de prix (tests). Photo :
    /// <c>ele_image_ged</c> si visible ; notices : pièces de l'élément de la catégorie <see cref="CategorieNotice"/>.
    /// </summary>
    public const string SqlFicheArticle = $$"""
        json_build_object(
          'id', e.ele_id, 'code', e.ele_code, 'libelle', coalesce(e.ele_libelle, e.ele_code), 'bibliotheque', b.bib_code,
          'unite', e.ele_unt_stock, 'unite_achat', e.ele_unt_achat, 'conditionnements', e.ele_unites,
          'photo', (SELECT g.dge_id FROM document_ged g WHERE g.dge_id = e.ele_image_ged AND {{SqlPieceElementVisible}}),
          'notices', (SELECT coalesce(json_agg(json_build_object('id', g.dge_id, 'titre', g.dge_titre, 'nom_fichier', v.vge_nom_fichier,
                        'type_mime', v.vge_type_mime, 'taille', v.vge_taille) ORDER BY g.dge_titre), '[]')
                      FROM document_ged g
                      CROSS JOIN LATERAL (SELECT w.vge_nom_fichier, w.vge_type_mime, w.vge_taille FROM version_ged w WHERE w.vge_document = g.dge_id ORDER BY w.vge_numero DESC LIMIT 1) v
                      WHERE g.dge_type_element = 'element' AND g.dge_id_element = e.ele_id::text AND g.dge_categorie = '{{CategorieNotice}}' AND {{SqlPieceElementVisible}})
        )::text AS "Value"
        """;

    /// <summary>Articles proposés au terrain : articles actifs (ni ouvrages, ni ensembles).</summary>
    private const string SqlArticleTerrain = "e.ele_actif AND e.ele_type = 'ARTICLE'";

    /// <summary>
    /// Articles du chantier @c : éléments portés par les lignes (composantes comprises) des commandes valables, non
    /// annulées, de ses marchés (<c>marche_document</c>, <c>v_document_valable</c>).
    /// </summary>
    public static readonly string SqlArticlesChantier = $$"""
        SELECT {{SqlFicheArticle}}
        FROM element e JOIN bibliotheque b ON b.bib_id = e.ele_bib_id
        WHERE {{SqlArticleTerrain}} AND e.ele_id IN (
          SELECT l.lig_art_id FROM marche m
          JOIN marche_document md ON md.mdo_mar_id = m.mar_id
          JOIN v_document_valable vd ON vd.ent_id = md.mdo_ent_id AND NOT vd.annule
          JOIN document_ligne l ON l.lig_ent_id = md.mdo_ent_id
          WHERE m.mar_cha_id = @c AND l.lig_art_id IS NOT NULL)
        ORDER BY e.ele_code, e.ele_id
        LIMIT {{ArticlesChantierMax}}
        """;

    /// <summary>Mots d'une recherche (au plus cinq), en motifs ILIKE échappés.</summary>
    public static List<string> MotsRecherche(string? recherche) =>
        [.. (recherche ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(5)
            .Select(m => "%" + m.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%")];

    /// <summary>Recherche : chaque mot dans le code, le libellé, les mots-clés ou le code-barres (sans accent ni casse).</summary>
    public static string SqlRechercheArticles(int mots) => $$"""
        SELECT {{SqlFicheArticle}}
        FROM element e JOIN bibliotheque b ON b.bib_id = e.ele_bib_id
        WHERE {{SqlArticleTerrain}}
          {{string.Concat(Enumerable.Range(0, mots).Select(i =>
              $"AND unaccent(concat_ws(' ', e.ele_code, e.ele_libelle, e.ele_mots_cles, e.ele_code_barre)) ILIKE unaccent(@m{i})\n"))}}
        ORDER BY b.bib_defaut DESC, e.ele_code, e.ele_id
        LIMIT {{ArticlesRechercheMax}}
        """;

    /// <summary>Article de la bibliothèque retenu pour une ligne de demande E_DAP (terrain-suites lot 18).</summary>
    public sealed record ArticleDemande(long Ele, string Code, string Libelle, string LibelleHtml, decimal Quantite, string Unite, int? NatId);

    private sealed record ElementDemande(long Id, string Code, string? Libelle, string LibelleHtml, string UntStock, string? UntAchat, string? UntVente, string Unites, int? NatId);

    /// <summary>
    /// Unité d'une ligne de demande : celle demandée si l'article la connaît (stock, achat, vente ou une de ses
    /// conversions), sinon refus ; rien de demandé : unité d'achat, sinon de stock.
    /// </summary>
    public static string UniteDemande(string? demandee, string stock, string? achat, string? vente, IEnumerable<string> conversions)
    {
        var u = demandee?.Trim();
        if (string.IsNullOrEmpty(u)) return string.IsNullOrEmpty(achat) ? stock : achat;
        if (u == stock || u == achat || u == vente || conversions.Contains(u)) return u;
        throw ExceptionMetier.Invalide("TERRAIN_DEMANDE_UNITE", $"Unité {u} inconnue de l'article");
    }

    /// <summary>Articles demandés : articles actifs proposés au terrain, quantité positive (défaut 1), unité de l'article.</summary>
    private static async Task<List<ArticleDemande>> ArticlesDemandeAsync(LogiBtpContext db, List<LigneDemandeTerrain> lignes, CancellationToken ct)
    {
        if (lignes.Count == 0) return [];
        var ids = lignes.Select(l => l.Ele).Distinct().ToArray();
        var elements = (await db.Database.SqlQueryRaw<ElementDemande>($"""
            SELECT e.ele_id AS id, e.ele_code AS code, e.ele_libelle AS libelle, e.ele_libelle_html AS libelle_html, e.ele_unt_stock AS unt_stock,
                   e.ele_unt_achat AS unt_achat, e.ele_unt_vente AS unt_vente, e.ele_unites::text AS unites, e.ele_nat_id AS nat_id
            FROM element e WHERE e.ele_id = ANY(@ids) AND {SqlArticleTerrain}
            """, new NpgsqlParameter("ids", ids)).ToListAsync(ct)).ToDictionary(e => e.Id);
        var res = new List<ArticleDemande>();
        foreach (var l in lignes)
        {
            if (!elements.TryGetValue(l.Ele, out var e)) throw ExceptionMetier.Introuvable($"Article {l.Ele}");
            var quantite = l.Quantite ?? 1;
            if (quantite <= 0) throw ExceptionMetier.Invalide("TERRAIN_DEMANDE_QUANTITE", "Quantité positive");
            using var conversions = JsonDocument.Parse(e.Unites);
            var unites = conversions.RootElement.ValueKind == JsonValueKind.Array
                ? conversions.RootElement.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Object && x.TryGetProperty("unite", out var v) && v.ValueKind == JsonValueKind.String)
                    .Select(x => x.GetProperty("unite").GetString()!).ToList()
                : [];
            res.Add(new ArticleDemande(e.Id, e.Code, string.IsNullOrWhiteSpace(e.Libelle) ? e.Code : e.Libelle, e.LibelleHtml, quantite,
                UniteDemande(l.Unite, e.UntStock, e.UntAchat, e.UntVente, unites), e.NatId));
        }
        return res;
    }

    /// <summary>Ligne d'article d'une demande E_DAP : élément, code, libellé, quantité et unité ; prix laissé au bureau.</summary>
    public static DocumentLigneBtp LigneArticleDemande(long ent, int ordre, ArticleDemande a, int? tva) => new()
    {
        LigId = -ordre, LigEntId = ent, LigOrdre = ordre, LigTylId = TL.Element, LigArtId = a.Ele, LigCode = a.Code, LigLibelleHtml = a.LibelleHtml,
        LigQte = a.Quantite, LigUntCode = a.Unite, LigPa = 0, LigNatId = a.NatId, LigTvaId = tva, LigTypePrix = "V",
    };

    private static RouteGroupBuilder MapBibliothequeTerrain(this RouteGroupBuilder g)
    {
        var b = g.MapGroup("/bibliotheque");

        // Recherche d'articles (deux caractères au moins).
        b.MapGet("/articles", async (string? recherche, LogiBtpContext db, CancellationToken ct) =>
        {
            var mots = MotsRecherche(recherche);
            if (string.Concat(mots).Replace("%", "").Length < 2) return new List<JsonElement>();
            var lignes = await db.Database.SqlQueryRaw<string>(SqlRechercheArticles(mots.Count),
                [.. mots.Select((m, i) => new NpgsqlParameter($"m{i}", m))]).ToListAsync(ct);
            return lignes.Select(l => JsonDocument.Parse(l).RootElement).ToList();
        });

        // Fiche réduite d'un article.
        b.MapGet("/articles/{id:long}", async (long id, LogiBtpContext db, CancellationToken ct) =>
        {
            var l = await db.Database.SqlQueryRaw<string>($"""
                SELECT {SqlFicheArticle} FROM element e JOIN bibliotheque b ON b.bib_id = e.ele_bib_id WHERE e.ele_id = @id AND {SqlArticleTerrain}
                """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Article {id}");
            return JsonDocument.Parse(l).RootElement;
        });

        // Articles d'un chantier de son planning (lignes de ses marchés), gardés hors ligne par l'appareil.
        b.MapGet("/chantiers/{cha:int}", async (int cha, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var s = await ComptesBtp.SalarieAsync(db, Utilisateur.Depuis(http).Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            await ExigerChantierPlanningAsync(db, s, cha, ct);
            var lignes = await db.Database.SqlQueryRaw<string>(SqlArticlesChantier, new NpgsqlParameter("c", cha)).ToListAsync(ct);
            return lignes.Select(l => JsonDocument.Parse(l).RootElement).ToList();
        });

        // Photo ou notice technique d'un article proposé au terrain.
        b.MapGet("/pieces/{id:long}", async (long id, bool? telecharger, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var version = await db.Database.SqlQueryRaw<long?>($$"""
                SELECT (SELECT w.vge_id FROM version_ged w WHERE w.vge_document = g.dge_id ORDER BY w.vge_numero DESC LIMIT 1) AS "Value"
                FROM document_ged g
                WHERE g.dge_id = @piece AND {{SqlPieceElementVisible}}
                  AND EXISTS (SELECT 1 FROM element e WHERE {{SqlArticleTerrain}}
                              AND (e.ele_image_ged = g.dge_id
                                OR (g.dge_type_element = 'element' AND g.dge_id_element = e.ele_id::text AND g.dge_categorie = '{{CategorieNotice}}')))
                """, new NpgsqlParameter("piece", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Pièce {id}");
            return await ged.Contenu(version, telecharger == true, http, Utilisateur.Depuis(http), ct);
        });
        return g;
    }
}
