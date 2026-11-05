using System.Globalization;
using System.Text.Json;
using LogiBTP.Bibliotheque;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using LogiBTP.Stock;
using LogiBTP.Stock.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Stock (ANALYSE-MODULE-STOCK.md § 3.2, S1, S2, S8, S12) : lieux = chantiers dépôts ou qui tiennent un stock,
/// articles = éléments de la bibliothèque gérés en stock (unité de stock, précision de l'unité, PA de repli), pièces =
/// documents ; après une revalorisation, PMP et dernier prix d'achat recopiés dans l'élément ; gestion du stock par un
/// administrateur ou un membre d'un service de nature LOGISTIQUE.
/// </summary>
public sealed partial class SpecialisationStockBtp(IHttpContextAccessor http) : SpecialisationStock
{
    private sealed record LieuSql(long Id, string Code, string Libelle, bool Depot);
    private sealed record ArticleSql(long Id, string Code, string? Libelle, string Unite, int Precision, decimal? Pa, int? Delai = null);
    private sealed record PieceSql(long Id, string? Numero, string Type, string? Tiers);

    public override Task<List<LieuStock>> LieuxAsync(StockDbContext db, CancellationToken ct) =>
        db.Database.SqlQuery<LieuSql>($"""
            SELECT c.cha_id::bigint AS id, c.cha_code AS code, c.cha_libelle AS libelle, c.cha_depot AS depot FROM chantier c
            WHERE c.cha_depot OR c.cha_stock_tenu OR EXISTS (SELECT 1 FROM stk_mouvement m WHERE m.mvt_lieu_id = c.cha_id)
            ORDER BY c.cha_depot DESC, c.cha_code
            """).Select(x => new LieuStock(x.Id, x.Code, x.Libelle, x.Depot)).ToListAsync(ct);

    public override async Task<Dictionary<long, ArticleStock>> ArticlesAsync(StockDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        var t = ids.ToArray();
        var l = await db.Database.SqlQuery<ArticleSql>($"""
            SELECT e.ele_id AS id, e.ele_code AS code, e.ele_libelle AS libelle, e.ele_unt_stock AS unite,
                   coalesce(u.unt_precision_qte, 2)::int AS precision, e.ele_pa AS pa,
                   coalesce(f.tfo_delai, e.ele_delai_livraison, p.per_fou_delai_livraison) AS delai
            FROM element e LEFT JOIN unite u ON u.unt_code = e.ele_unt_stock
            LEFT JOIN tarif_fournisseur f ON f.tfo_ele_id = e.ele_id AND f.tfo_principal
            LEFT JOIN personne p ON p.per_id = f.tfo_tiers_id
            WHERE e.ele_id = ANY({t})
            """).ToListAsync(ct);
        // Délai de l'article (lot 8) : tarif principal, sinon délai global de l'élément, sinon délai du fournisseur principal ; celui du dépôt prime (module).
        return l.ToDictionary(x => x.Id, x => new ArticleStock(x.Id, x.Code, x.Libelle ?? "", x.Unite, x.Precision, x.Pa, x.Delai));
    }

    private sealed record TiersSql(long Id, string Nom);

    public override async Task<Dictionary<long, string>> NomsTiersAsync(StockDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        var t = ids.ToArray();
        return (await db.Database.SqlQuery<TiersSql>($"SELECT per_id AS id, per_raison_sociale AS nom FROM personne WHERE per_id = ANY({t})").ToListAsync(ct))
            .ToDictionary(x => x.Id, x => x.Nom);
    }

    public override Task<List<ArticleStock>> ArticlesGeresAsync(StockDbContext db, CancellationToken ct) =>
        db.Database.SqlQuery<ArticleSql>($"""
            SELECT e.ele_id AS id, e.ele_code AS code, e.ele_libelle AS libelle, e.ele_unt_stock AS unite,
                   coalesce(u.unt_precision_qte, 2)::int AS precision, e.ele_pa AS pa, NULL::int AS delai
            FROM element e LEFT JOIN unite u ON u.unt_code = e.ele_unt_stock
            WHERE e.ele_gestion = 'STOCK' AND e.ele_type = 'ARTICLE' AND e.ele_actif ORDER BY e.ele_code
            """).Select(x => new ArticleStock(x.Id, x.Code, x.Libelle ?? "", x.Unite, x.Precision, x.Pa)).ToListAsync(ct);

    private sealed record FamilleSql(long Id, string Chemin);

    public override Task<List<FamilleStock>> FamillesAsync(StockDbContext db, CancellationToken ct) =>
        db.Database.SqlQuery<FamilleSql>($"SELECT fam_id::bigint AS id, chemin FROM v_famille_element ORDER BY chemin")
            .Select(x => new FamilleStock(x.Id, x.Chemin)).ToListAsync(ct);

    public override Task<List<long>> ArticlesDeFamillesAsync(StockDbContext db, IReadOnlyCollection<long> familles, CancellationToken ct)
    {
        var t = familles.ToArray();
        return db.Database.SqlQuery<long>($"""
            WITH RECURSIVE f AS (SELECT fam_id FROM famille_element WHERE fam_id = ANY({t})
                                 UNION SELECT x.fam_id FROM famille_element x JOIN f ON x.fam_parent_id = f.fam_id)
            SELECT e.ele_id AS "Value" FROM element e JOIN f ON f.fam_id = e.ele_fam_id
            WHERE e.ele_gestion = 'STOCK' AND e.ele_type = 'ARTICLE' AND e.ele_actif
            """).ToListAsync(ct);
    }

    public override async Task<Dictionary<long, PieceStock>> PiecesAsync(StockDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        var t = ids.ToArray();
        var l = await db.Database.SqlQuery<PieceSql>($"""
            SELECT d.ent_id AS id, d.ent_numero AS numero, t.tyd_libelle AS type, p.per_raison_sociale AS tiers
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
            WHERE d.ent_id = ANY({t})
            """).ToListAsync(ct);
        return l.ToDictionary(x => x.Id, x => new PieceStock(x.Id, x.Numero ?? "(brouillon)", x.Type, x.Tiers));
    }

    public override async Task ApresValorisationAsync(StockDbContext db, long ele, Valorisation v, CancellationToken ct) =>
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE element SET ele_pmp = {v.Pmp}, ele_dernier_pa = {v.DernierPa}, ele_maj_par = 'stock'
            WHERE ele_id = {ele} AND (ele_pmp IS DISTINCT FROM {v.Pmp} OR ele_dernier_pa IS DISTINCT FROM {v.DernierPa})
            """, ct);

    public override async Task<bool> PeutGererAsync(StockDbContext db, Utilisateur u, CancellationToken ct) =>
        u.EstAdmin || await MagasinierAsync(db.Database, u.Code, ct);

    /// <summary>Magasinier : membre d'un service de nature LOGISTIQUE (ou son responsable).</summary>
    public static async Task<bool> MagasinierAsync(Microsoft.EntityFrameworkCore.Infrastructure.DatabaseFacade db, string utilisateur, CancellationToken ct) =>
        await db.SqlQuery<bool>($"""
            SELECT EXISTS (SELECT 1 FROM individu i JOIN service_membre m ON m.sme_ind_id = i.ind_id JOIN service s ON s.srv_id = m.sme_srv_id
                           WHERE i.ind_utilisateur = {utilisateur} AND s.srv_nature = 'LOGISTIQUE') AS "Value"
            """).FirstAsync(ct);
}

/// <summary>
/// Mouvements de stock des pièces (ANALYSE-MODULE-STOCK.md § 4, S2, S9 à S12, S22, S31), écrits à la validation dans la
/// transaction de la pièce : articles gérés en stock (lignes vendues), quantité convertie dans l'unité de stock et
/// arrondie à la précision de cette unité, date-heure de la pièce (à la minute). Lieu : dépôt ou chantier qui tient un
/// stock, sinon rien (entrée consommée sur le chantier).
/// - réception fournisseur, facture fournisseur (lignes non issues d'une réception) : entrée valorisée sur la destination
///   (sinon le chantier de la pièce) ; réception : prix provisoire jusqu'à sa facture, qui reporte son prix ;
/// - retour fournisseur : sortie de la destination (sinon le chantier) ;
/// - bon de livraison, facture client sans livraison : sortie de l'origine ; retour client : entrée sur l'origine ;
/// - entrée, sortie, transfert de stock : sortie de l'origine et / ou entrée sur la destination (entrée valorisée au PA
///   de la ligne s'il y en a un et sans origine).
/// </summary>
public static class MouvementsStockBtp
{
    private static readonly string[] Codes = [TypesDocument.AReception, TypesDocument.AFacture, TypesDocument.ARetour, TypesDocument.VReception, TypesDocument.VFacture, TypesDocument.VRetour, TypesDocument.SEntree, TypesDocument.SSortie, TypesDocument.STransfert];

    private sealed record EnteteSql(DateTimeOffset? DateMouvement, DateOnly Date, int? Origine, int? Destination, int? Chantier, long? Tiers);
    private sealed record LieuSql(int Id, bool Tenu);
    private sealed record LigneSql(long LigId, long EleId, decimal Qte, string? Unite, decimal? MontantHt, decimal? MontantPa, string UniteStock, string Unites,
        string Proprietes, int Precision, decimal? Poids, decimal? Surface, decimal? SurfacePeinture, decimal? Volume, decimal? Hauteur,
        decimal? Largeur, decimal? Epaisseur, decimal? Longueur, long? Source, string? Lots = null, string Suivi = SuiviArticle.Aucun,
        bool Perissable = false, int? Duree = null, string UniteDuree = LogiBTP.Stock.UniteDuree.Mois);

    public static bool Concerne(TypeDocument type) => Codes.Contains(type.TydCode);

    /// <summary>Date-heure du mouvement ramenée à la minute (UTC) ; à défaut, l'instant présent.</summary>
    public static DateTimeOffset Minute(DateTimeOffset? d)
    {
        var x = (d ?? DateTimeOffset.UtcNow).ToUniversalTime();
        return new DateTimeOffset(x.Year, x.Month, x.Day, x.Hour, x.Minute, 0, TimeSpan.Zero);
    }

    public static async Task EcrireAsync(DbContext db, long entId, TypeDocument type, CancellationToken ct)
    {
        if (!Concerne(type) || !await db.Database.SqlQuery<bool>($"SELECT f_module_actif('stock') AS \"Value\"").FirstAsync(ct)) return;
        var e = await db.Database.SqlQuery<EnteteSql>($"""
            SELECT ent_date_mouvement AS date_mouvement, ent_date AS date, ent_stk_origine_id AS origine, ent_stk_destination_id AS destination,
                   ent_chantier_id AS chantier, ent_tiers_id AS tiers FROM document WHERE ent_id = {entId}
            """).FirstAsync(ct);
        var code = type.TydCode;
        var achat = code is TypesDocument.AReception or TypesDocument.AFacture or TypesDocument.ARetour;
        int? entree = code switch
        {
            TypesDocument.AReception or TypesDocument.AFacture => e.Destination ?? e.Chantier,
            TypesDocument.VRetour => e.Origine,
            TypesDocument.SEntree or TypesDocument.STransfert => e.Destination,
            _ => null,
        };
        int? sortie = code switch
        {
            TypesDocument.ARetour => e.Destination ?? e.Chantier,
            TypesDocument.VReception or TypesDocument.VFacture or TypesDocument.SSortie or TypesDocument.STransfert => e.Origine,
            _ => null,
        };
        var ids = new[] { entree, sortie }.Where(x => x is not null).Select(x => x!.Value).ToArray();
        var tenus = (await db.Database.SqlQuery<LieuSql>($"SELECT cha_id AS id, (cha_depot OR cha_stock_tenu) AS tenu FROM chantier WHERE cha_id = ANY({ids})").ToListAsync(ct))
            .Where(x => x.Tenu).Select(x => x.Id).ToHashSet();
        if (entree is { } en && !tenus.Contains(en)) entree = null;
        if (sortie is { } so && !tenus.Contains(so)) sortie = null;
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM stk_mouvement WHERE mvt_ent_id = {entId}", ct);
        var lignes = await db.Database.SqlQuery<LigneSql>($"""
            SELECT l.lig_id, e.ele_id, coalesce(l.lig_qte_totale, l.lig_qte, 0) AS qte, l.lig_unt_code AS unite, l.lig_montant_ht AS montant_ht, l.lig_montant_pa AS montant_pa,
                   e.ele_unt_stock AS unite_stock, e.ele_unites::text AS unites, e.ele_proprietes::text AS proprietes,
                   coalesce(u.unt_precision_qte, 2)::int AS precision,
                   e.ele_poids AS poids, e.ele_surface AS surface, e.ele_surface_peinture AS surface_peinture, e.ele_volume AS volume,
                   e.ele_hauteur AS hauteur, e.ele_largeur AS largeur, e.ele_epaisseur AS epaisseur, e.ele_longueur AS longueur,
                   (SELECT k.lil_source_lig_id FROM document_ligne_lien k JOIN document_ligne ls ON ls.lig_id = k.lil_source_lig_id
                      JOIN document ds ON ds.ent_id = ls.lig_ent_id JOIN type_document ts ON ts.tyd_id = ds.ent_tyd_id
                    WHERE k.lil_cible_lig_id = l.lig_id AND ts.tyd_mouvemente_stock ORDER BY k.lil_id LIMIT 1) AS source,
                   (l.lig_proprietes -> 'lots')::text AS lots, coalesce(sv.sas_suivi, 'AUCUN') AS suivi, coalesce(sv.sas_perissable, FALSE) AS perissable,
                   sv.sas_duree AS duree, coalesce(sv.sas_unite, 'M') AS unite_duree
            FROM document_ligne l
            JOIN element e ON e.ele_id = l.lig_art_id
            LEFT JOIN unite u ON u.unt_code = e.ele_unt_stock
            LEFT JOIN stk_article_suivi sv ON sv.sas_ele_id = e.ele_id
            WHERE l.lig_ent_id = {entId} AND e.ele_gestion = 'STOCK' AND e.ele_type = 'ARTICLE' AND l.lig_type_prix = 'V'
            ORDER BY l.lig_ordre, l.lig_id
            """).ToListAsync(ct);
        var date = Minute(e.DateMouvement);
        foreach (var l in lignes)
        {
            var q = Convertir(l);
            if (q == 0) continue;
            // Prix unitaire en unité de stock : montant HT net de la pièce d'achat, déboursé (PA) d'une pièce de stock.
            decimal? prix = (achat ? l.MontantHt : l.MontantPa) is { } mt && mt != 0 ? ArrondiCalcul.Arr6(Math.Abs(mt / q)) : null;
            // Facture issue d'une livraison ou d'une réception : pas de nouveau mouvement ; facture fournisseur : son prix
            // remplace celui de la réception (S31).
            if (code is TypesDocument.AFacture or TypesDocument.VFacture && l.Source is { } source)
            {
                if (code == TypesDocument.AFacture && prix is not null)
                    await db.Database.ExecuteSqlInterpolatedAsync($"""
                        UPDATE stk_mouvement SET mvt_prix = {prix}, mvt_provisoire = FALSE, mvt_prix_ent_id = {entId}
                        WHERE mvt_lig_id = {source} AND mvt_quantite > 0
                        """, ct);
                continue;
            }
            // Lots (S24) : une part par lot saisi sur la ligne, le reste sans lot ; une répartition en erreur (refusée à la
            // validation) est ignorée. Les lots d'une entrée d'achat sont ceux du fournisseur de la pièce.
            var parts = new List<(long? Lot, decimal Quantite)>();
            var rep = ReglesTracabilite.Repartir(q, LireLots(l.Lots), l.Suivi);
            if (rep.Erreurs.Count == 0)
                foreach (var part in rep.Parts)
                    parts.Add((await LotAsync(db, l, part.Numero, entree is not null && achat ? e.Tiers : null, entree is not null, e.Date, ct), part.Quantite));
            var reste = Math.Abs(q) - parts.Sum(x => x.Quantite);
            if (reste != 0 || parts.Count == 0) parts.Add((null, reste));
            var signe = q < 0 ? -1 : 1;
            if (entree is { } lieuE)
            {
                var valorise = achat || (code == TypesDocument.SEntree || code == TypesDocument.STransfert && sortie is null && e.Origine is null);
                var p = valorise ? prix : null;
                foreach (var (lot, qp) in parts)
                    await Inserer(db, l, lieuE, date, signe * qp, p, code == TypesDocument.AReception && p is not null, entId, e.Tiers, lot, ct);
            }
            if (sortie is { } lieuS)
                foreach (var (lot, qp) in parts) await Inserer(db, l, lieuS, date, -signe * qp, null, false, entId, e.Tiers, lot, ct);
        }
    }

    /// <summary>Lot saisi sur une ligne (`lig_proprietes.lots`) : numéro, quantité en unité de stock, fabrication, date limite, coulée, norme.</summary>
    private sealed record LotLigne(string? Numero, JsonElement? Quantite, string? Fabrication, string? Limite, string? Coulee, string? Norme);

    private static List<LotLigne> LotsDe(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "null") return [];
        try { return JsonSerializer.Deserialize<List<LotLigne>>(json, JsonCalcul.Options) ?? []; }
        catch (JsonException) { return []; }
    }

    private static decimal? Quantite(JsonElement? q) => q switch
    {
        { ValueKind: JsonValueKind.Number } n => n.GetDecimal(),
        { ValueKind: JsonValueKind.String } s when decimal.TryParse(s.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
        _ => null,
    };

    private static List<LotReparti> LireLots(string? json) => LotsDe(json).Select(x => new LotReparti(x.Numero, Quantite(x.Quantite))).ToList();

    /// <summary>
    /// Lot d'un article : celui du même numéro (et du même fournisseur pour une entrée d'achat), sinon créé — à l'entrée avec
    /// la fabrication, la coulée, la norme et la date limite saisies (sinon proposée pour un article périssable, S24.7) ;
    /// pour une sortie, un lot inconnu est créé sans fournisseur.
    /// </summary>
    private static async Task<long> LotAsync(DbContext db, LigneSql l, string numero, long? tiers, bool entree, DateOnly reception, CancellationToken ct)
    {
        if (!entree)
        {
            var existant = await db.Database.SqlQuery<long?>($"""
                SELECT lot_id AS "Value" FROM stk_lot WHERE lot_ele_id = {l.EleId} AND upper(lot_numero) = upper({numero}) ORDER BY lot_id DESC LIMIT 1
                """).FirstOrDefaultAsync(ct);
            if (existant is long id) return id;
        }
        var saisi = LotsDe(l.Lots).FirstOrDefault(x => string.Equals(ReglesTracabilite.Numero(x.Numero), numero, StringComparison.OrdinalIgnoreCase));
        static DateOnly? Date(string? s) => DateOnly.TryParse(s, CultureInfo.InvariantCulture, out var d) ? d : null;
        var fabrication = entree ? Date(saisi?.Fabrication) : null;
        var limite = entree ? Date(saisi?.Limite) ?? ReglesTracabilite.DateLimite(new PeremptionArticle(l.Perissable, l.Duree, l.UniteDuree), fabrication, reception) : null;
        string? Texte(string? s) => entree && !string.IsNullOrWhiteSpace(s) ? s.Trim()[..Math.Min(60, s.Trim().Length)] : null;
        // Auteur : celui qui a modifié la pièce en dernier (sa validation), sinon son créateur.
        var auteur = await db.Database.SqlQuery<string>($"""
            SELECT coalesce(d.ent_modifie_par, d.ent_cree_par, 'logibtp') AS "Value" FROM document_ligne x JOIN document d ON d.ent_id = x.lig_ent_id WHERE x.lig_id = {l.LigId}
            """).FirstAsync(ct);
        return (await db.Database.SqlQuery<long>($"""
            INSERT INTO stk_lot (lot_ele_id, lot_numero, lot_tiers_id, lot_fabrication, lot_limite, lot_coulee, lot_norme, lot_cree_par)
            VALUES ({l.EleId}, {numero}, {tiers}, {fabrication}, {limite}, {Texte(saisi?.Coulee)}, {Texte(saisi?.Norme)}, {auteur})
            ON CONFLICT (lot_ele_id, coalesce(lot_tiers_id, 0), upper(lot_numero)) DO UPDATE
              SET lot_fabrication = coalesce(stk_lot.lot_fabrication, excluded.lot_fabrication), lot_limite = coalesce(stk_lot.lot_limite, excluded.lot_limite),
                  lot_coulee = coalesce(stk_lot.lot_coulee, excluded.lot_coulee), lot_norme = coalesce(stk_lot.lot_norme, excluded.lot_norme)
            RETURNING lot_id AS "Value"
            """).ToListAsync(ct))[0];
    }

    /// <summary>
    /// Lots des lignes à la validation (S24.2 : facultatifs) : une répartition en erreur est refusée (numéro vide, quantité,
    /// doublon, dépassement, numéro de série de plus d'une unité) ; une partie sans lot n'est jamais refusée.
    /// </summary>
    public static async Task ControlerLotsAsync(DbContext db, IReadOnlyList<DocumentLigneBtp> lignes, TypeDocument type, List<MessageCalcul> erreurs, CancellationToken ct)
    {
        if (!Concerne(type)) return;
        var avecLots = lignes.Where(l => l.LigArtId is not null && l.LigProprietes?.RootElement.ValueKind == JsonValueKind.Object
            && l.LigProprietes.RootElement.TryGetProperty("lots", out var x) && x.ValueKind == JsonValueKind.Array && x.GetArrayLength() > 0).ToList();
        if (avecLots.Count == 0) return;
        var ids = avecLots.Select(l => l.LigArtId!.Value).Distinct().ToArray();
        var suivis = (await db.Database.SqlQuery<SuiviSql>($"""
            SELECT e.ele_id AS ele, coalesce(s.sas_suivi, 'AUCUN') AS suivi, e.ele_unt_stock AS unite
            FROM element e LEFT JOIN stk_article_suivi s ON s.sas_ele_id = e.ele_id WHERE e.ele_id = ANY({ids})
            """).ToListAsync(ct)).ToDictionary(x => x.Ele);
        foreach (var l in avecLots)
        {
            // Les lots sont en unité de stock : le dépassement se contrôle ici quand la ligne est dans cette unité, sinon à
            // l'écriture des mouvements (quantité convertie ; répartition alors ignorée).
            var a = suivis.GetValueOrDefault(l.LigArtId!.Value);
            var memeUnite = a is not null && (string.IsNullOrEmpty(l.LigUntCode) || l.LigUntCode == a.Unite);
            var r = ReglesTracabilite.Repartir(memeUnite ? l.LigQteTotale ?? l.LigQte ?? 0 : decimal.MaxValue,
                LireLots(l.LigProprietes!.RootElement.GetProperty("lots").GetRawText()), a?.Suivi ?? SuiviArticle.Aucun);
            foreach (var e in r.Erreurs.Select(e => e.Code).Distinct())
                erreurs.Add(new MessageCalcul(l.LigId, "STK_LOTS", $"Lots : {ReglesTracabilite.Messages.GetValueOrDefault(e, e)}"));
        }
    }

    private sealed record SuiviSql(long Ele, string Suivi, string? Unite);

    private static Task<int> Inserer(DbContext db, LigneSql l, int lieu, DateTimeOffset date, decimal q, decimal? prix, bool provisoire, long entId, long? tiers, long? lot,
        CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO stk_mouvement (mvt_ele_id, mvt_lieu_id, mvt_date, mvt_quantite, mvt_prix, mvt_prix_initial, mvt_provisoire, mvt_origine, mvt_ent_id, mvt_lig_id, mvt_tiers_id,
                                       mvt_lot_id, mvt_emp_id)
            VALUES ({l.EleId}, {lieu}, {date}, {q}, {prix}, {prix}, {provisoire}, 'DOCUMENT', {entId}, {l.LigId}, {tiers}, {lot},
                    (SELECT a.sae_emp_id FROM stk_article_emplacement a JOIN stk_emplacement x ON x.emp_id = a.sae_emp_id
                     WHERE a.sae_ele_id = {l.EleId} AND x.emp_lieu_id = {lieu} ORDER BY a.sae_ordre LIMIT 1))
            """, ct);

    /// <summary>Quantité de la ligne dans l'unité de stock (conversions de l'article), arrondie à la précision de l'unité (S22).</summary>
    private static decimal Convertir(LigneSql l) =>
        ArrondiCalcul.Arrondir(l.Qte * Ratio(l.Unite, new UnitesArticle(l.UniteStock, l.Unites, l.Proprietes, l.Poids, l.Surface, l.SurfacePeinture, l.Volume,
            l.Hauteur, l.Largeur, l.Epaisseur, l.Longueur)), l.Precision);

    /// <summary>Unités d'un article : unité de stock, conversions par formule, données des formules.</summary>
    public sealed record UnitesArticle(string UniteStock, string Unites, string Proprietes, decimal? Poids, decimal? Surface, decimal? SurfacePeinture,
        decimal? Volume, decimal? Hauteur, decimal? Largeur, decimal? Epaisseur, decimal? Longueur);

    /// <summary>Quantité en unité de stock pour 1 unité donnée (1 si l'unité est vide, celle du stock ou sans correspondance).</summary>
    public static decimal Ratio(string? unite, UnitesArticle a) => RatioOuNull(unite, a) ?? 1;

    /// <summary>Quantité en unité de stock pour 1 unité donnée ; null sans correspondance (unité, donnée technique, formule).</summary>
    public static decimal? RatioOuNull(string? unite, UnitesArticle a)
    {
        var techniques = new Dictionary<string, decimal?>
        {
            ["poids"] = a.Poids, ["surface"] = a.Surface, ["surface_peinture"] = a.SurfacePeinture, ["volume"] = a.Volume, ["hauteur"] = a.Hauteur,
            ["largeur"] = a.Largeur, ["epaisseur"] = a.Epaisseur, ["longueur"] = a.Longueur,
        };
        using var unites = JsonDocument.Parse(a.Unites);
        using var proprietes = JsonDocument.Parse(a.Proprietes);
        var entree = new EntreeElement
        {
            UniteStock = a.UniteStock, Unites = ServiceBibliotheque.Unites(unites.RootElement),
            Donnees = ServiceBibliotheque.Donnees(proprietes.RootElement, techniques),
        };
        try { return CalculElement.Ratio(string.IsNullOrEmpty(unite) ? a.UniteStock : unite, entree); }
        catch (ErreurCalcul) { return null; }
    }

    /// <summary>Contrôle à la validation : date du mouvement à venir refusée (S10), lieux d'un transfert différents.</summary>
    public static void Controler(DocumentBtp d, TypeDocument type, List<MessageCalcul> erreurs)
    {
        if (!Concerne(type)) return;
        if (d.EntDateMouvement is { } dm && dm > DateTimeOffset.UtcNow.AddMinutes(1))
            erreurs.Add(new MessageCalcul(null, "STK_DATE_FUTURE", "Date du mouvement de stock à venir"));
        if (type.TydCode == TypesDocument.STransfert && d.EntStkOrigineId is null && d.EntStkDestinationId is null)
            erreurs.Add(new MessageCalcul(null, "STK_LIEUX", "Transfert : origine ou destination obligatoire"));
        if (type.TydCode == TypesDocument.STransfert && d.EntStkOrigineId is not null && d.EntStkOrigineId == d.EntStkDestinationId)
            erreurs.Add(new MessageCalcul(null, "STK_LIEUX", "Transfert : origine et destination identiques"));
        if (type.TydCode == TypesDocument.SEntree && d.EntStkDestinationId is null)
            erreurs.Add(new MessageCalcul(null, "STK_LIEUX", "Entrée de stock : destination obligatoire"));
        if (type.TydCode == TypesDocument.SSortie && d.EntStkOrigineId is null)
            erreurs.Add(new MessageCalcul(null, "STK_LIEUX", "Sortie de stock : origine obligatoire"));
    }
}
