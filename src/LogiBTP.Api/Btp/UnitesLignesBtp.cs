using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Garde-fou des unités (lot 0 du module Rentabilité, V32 et R11 de ANALYSE-MODULE-ANALYSE.md) :
/// - une ligne transformée dont l'unité diffère de celle de sa ligne d'origine n'est validée que si son article donne la
///   conversion entre les deux unités (sinon UNITE_TRANSFORMEE : l'utilisateur ajoute la conversion dans la fiche
///   article) ; les quantités des liens de transformation sont alors converties dans l'unité d'origine, pour que le reste
///   à solder et les quantités comparées restent justes ;
/// - un article géré en stock n'est validé dans une pièce qui mouvemente le stock que si son unité se convertit dans
///   l'unité de stock (STK_UNITE ; auparavant la quantité était prise telle quelle, ratio 1).
/// </summary>
public static class UnitesLignesBtp
{
    private sealed record SourceSql(long LigId, string? UniteSource);
    private sealed record LienSql(long LilId, long? EleId, string? Unite, string? UniteSource);
    private sealed record ArticleSql(long EleId, string Code, string Gestion, string Type, string UniteStock, string Unites, string Proprietes,
        decimal? Poids, decimal? Surface, decimal? SurfacePeinture, decimal? Volume, decimal? Hauteur, decimal? Largeur, decimal? Epaisseur, decimal? Longueur);

    private static MouvementsStockBtp.UnitesArticle Conversions(ArticleSql a) =>
        new(a.UniteStock, a.Unites, a.Proprietes, a.Poids, a.Surface, a.SurfacePeinture, a.Volume, a.Hauteur, a.Largeur, a.Epaisseur, a.Longueur);

    private static async Task<Dictionary<long, ArticleSql>> ArticlesAsync(DbContext db, long[] ids, CancellationToken ct) =>
        ids.Length == 0 ? [] : (await db.Database.SqlQuery<ArticleSql>($"""
            SELECT e.ele_id, e.ele_code AS code, e.ele_gestion AS gestion, e.ele_type AS type, e.ele_unt_stock AS unite_stock,
                   e.ele_unites::text AS unites, e.ele_proprietes::text AS proprietes,
                   e.ele_poids AS poids, e.ele_surface AS surface, e.ele_surface_peinture AS surface_peinture, e.ele_volume AS volume,
                   e.ele_hauteur AS hauteur, e.ele_largeur AS largeur, e.ele_epaisseur AS epaisseur, e.ele_longueur AS longueur
            FROM element e WHERE e.ele_id = ANY({ids})
            """).ToListAsync(ct)).ToDictionary(a => a.EleId);

    private static bool Meme(string? a, string? b) =>
        string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b) || string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Quantité dans l'unité <paramref name="vers"/> pour 1 unité <paramref name="de"/> (conversions de l'article), null sans conversion.</summary>
    private static decimal? Facteur(string de, string vers, MouvementsStockBtp.UnitesArticle a) =>
        MouvementsStockBtp.RatioOuNull(de, a) is { } r1 && MouvementsStockBtp.RatioOuNull(vers, a) is { } r2 && r2 != 0 ? r1 / r2 : null;

    /// <summary>Contrôle à la validation : unités des lignes transformées et des articles gérés en stock.</summary>
    public static async Task ControlerAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> erreurs, CancellationToken ct)
    {
        var lignes = document.Lignes.Where(l => !string.IsNullOrWhiteSpace(l.LigUntCode)).ToList();
        if (lignes.Count == 0) return;
        var ids = lignes.Where(l => l.LigId > 0).Select(l => l.LigId).ToArray();
        var sources = ids.Length == 0 ? [] : (await db.Database.SqlQuery<SourceSql>($"""
            SELECT DISTINCT ON (k.lil_cible_lig_id) k.lil_cible_lig_id AS lig_id, s.lig_unt_code AS unite_source
            FROM document_ligne_lien k JOIN document_ligne s ON s.lig_id = k.lil_source_lig_id
            WHERE k.lil_cible_lig_id = ANY({ids}) ORDER BY k.lil_cible_lig_id, k.lil_id
            """).ToListAsync(ct)).ToDictionary(s => s.LigId, s => s.UniteSource);
        var stock = MouvementsStockBtp.Concerne(type) && await db.Database.SqlQuery<bool>($"SELECT f_module_actif('stock') AS \"Value\"").FirstAsync(ct);
        var articles = await ArticlesAsync(db, lignes.Where(l => l.LigArtId is not null).Select(l => l.LigArtId!.Value).Distinct().ToArray(), ct);
        foreach (var l in lignes)
        {
            var article = l.LigArtId is long e ? articles.GetValueOrDefault(e) : null;
            if (sources.TryGetValue(l.LigId, out var origine) && !Meme(l.LigUntCode, origine))
            {
                if (article is null)
                    erreurs.Add(new MessageCalcul(l.LigId, "UNITE_TRANSFORMEE",
                        $"Unité {l.LigUntCode} différente de l'unité d'origine {origine} : reprendre {origine} (ligne sans article, aucune conversion)"));
                else if (Facteur(l.LigUntCode!, origine!, Conversions(article)) is null)
                    erreurs.Add(new MessageCalcul(l.LigId, "UNITE_TRANSFORMEE",
                        $"Unité {l.LigUntCode} différente de l'unité d'origine {origine} : ajouter la conversion dans la fiche de l'article {article.Code}"));
            }
            if (stock && article is { Gestion: "STOCK", Type: "ARTICLE" } && l.LigTypePrix == "V"
                && MouvementsStockBtp.RatioOuNull(l.LigUntCode, Conversions(article)) is null)
                erreurs.Add(new MessageCalcul(l.LigId, "STK_UNITE",
                    $"Unité {l.LigUntCode} sans conversion vers l'unité de stock {article.UniteStock} : ajouter la conversion dans la fiche de l'article {article.Code}"));
        }
    }

    /// <summary>
    /// Quantités des liens de transformation d'un document enregistré converties dans l'unité de la ligne d'origine quand
    /// l'unité de la ligne a changé (après DocumentService.RecalculerLiens, qui les écrit dans l'unité de la ligne).
    /// </summary>
    public static async Task ConvertirLiensAsync(DbContext db, long entId, CancellationToken ct)
    {
        var liens = (await db.Database.SqlQuery<LienSql>($"""
            SELECT x.lil_id, l.lig_art_id AS ele_id, l.lig_unt_code AS unite, s.lig_unt_code AS unite_source
            FROM document_ligne_lien x
            JOIN document_ligne l ON l.lig_id = x.lil_cible_lig_id
            JOIN document_ligne s ON s.lig_id = x.lil_source_lig_id
            WHERE l.lig_ent_id = {entId} AND x.lil_avancement_pct IS NULL
              AND upper(trim(coalesce(l.lig_unt_code, ''))) <> upper(trim(coalesce(s.lig_unt_code, '')))
              AND nullif(trim(l.lig_unt_code), '') IS NOT NULL AND nullif(trim(s.lig_unt_code), '') IS NOT NULL
            """).ToListAsync(ct)).Where(x => x.EleId is not null).ToList();
        if (liens.Count == 0) return;
        var articles = await ArticlesAsync(db, liens.Select(x => x.EleId!.Value).Distinct().ToArray(), ct);
        foreach (var x in liens)
        {
            if (!articles.TryGetValue(x.EleId!.Value, out var a) || Facteur(x.Unite!, x.UniteSource!, Conversions(a)) is not { } f) continue;
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_ligne_lien SET lil_qte = round(lil_qte * {f}, 6) WHERE lil_id = {x.LilId}", ct);
        }
    }
}
