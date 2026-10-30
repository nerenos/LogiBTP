using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using LogiBTP.Stock.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Stock, lot 3 (ANALYSE-MODULE-STOCK.md § 5.4, S13, S15, S25) : événements prévus d'un lieu (reste des
/// réservations validées au dépôt réservé, à leur date de besoin ; reste à recevoir des commandes fournisseur livrées au
/// lieu, à leur date de livraison : celle de la ligne, sinon la livraison confirmée par l'ARC, sinon la livraison prévue —
/// lot 9, A24a, A24e), en unité de stock ; fournisseur principal et conditionnement des articles
/// (tarif principal de la bibliothèque) ; commandes fournisseur en brouillon par fournisseur.
/// </summary>
public sealed partial class SpecialisationStockBtp
{
    private sealed record PrevisionSql(long EntId, string? Numero, string Code, string TypePiece, DateOnly DateBesoin, DateOnly DateLivraison, string? Tiers,
        string? Chantier, long EleId, decimal Qte, string? Unite, decimal Deja, string UniteStock, string Unites, string Proprietes, int Precision,
        decimal? Poids, decimal? Surface, decimal? SurfacePeinture, decimal? Volume, decimal? Hauteur, decimal? Largeur, decimal? Epaisseur, decimal? Longueur);

    private sealed record ApproSql(long Ele, long? FournisseurId, string? Fournisseur, string? UniteAchat, decimal? Prix, string UniteStock, string Unites,
        string Proprietes, decimal? Poids, decimal? Surface, decimal? SurfacePeinture, decimal? Volume, decimal? Hauteur, decimal? Largeur, decimal? Epaisseur,
        decimal? Longueur, string Code, string? LibelleHtml, int? NatId);

    /// <summary>
    /// Réservations (S_RESERVATION du dépôt réservé) : reste = quantité − déjà sortie (transformations SORTIE validées) ;
    /// commandes (A_COMMANDE livrées au lieu) : reste = quantité − reçue (le plus grand des quantités reçues et facturées).
    /// Pièces de référence validées, ni annulées, remplacées ou soldées ; lignes soldées écartées.
    /// </summary>
    public override async Task<List<PrevisionStock>> PrevisionsAsync(StockDbContext db, long lieu, CancellationToken ct)
    {
        var l = await db.Database.SqlQuery<PrevisionSql>($"""
            SELECT d.ent_id, d.ent_numero AS numero, t.tyd_code AS code, t.tyd_libelle AS type_piece,
                   coalesce(l.lig_date_livraison, d.ent_date_besoin, d.ent_date) AS date_besoin,
                   f_date_livraison_ligne(l.lig_date_livraison, d.ent_arc_livraison, d.ent_date_livraison, d.ent_date) AS date_livraison,
                   p.per_raison_sociale AS tiers, ch.cha_code AS chantier, e.ele_id, coalesce(l.lig_qte_totale, l.lig_qte, 0) AS qte, l.lig_unt_code AS unite,
                   CASE WHEN t.tyd_code = 'S_RESERVATION' THEN coalesce(x.sortie, 0) ELSE greatest(coalesce(x.reception, 0), coalesce(x.facturation, 0)) END AS deja,
                   e.ele_unt_stock AS unite_stock, e.ele_unites::text AS unites, e.ele_proprietes::text AS proprietes, coalesce(u.unt_precision_qte, 2)::int AS precision,
                   e.ele_poids AS poids, e.ele_surface AS surface, e.ele_surface_peinture AS surface_peinture, e.ele_volume AS volume,
                   e.ele_hauteur AS hauteur, e.ele_largeur AS largeur, e.ele_epaisseur AS epaisseur, e.ele_longueur AS longueur
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN statut_document s ON s.std_id = d.ent_std_id
            JOIN document_ligne l ON l.lig_ent_id = d.ent_id
            JOIN element e ON e.ele_id = l.lig_art_id
            LEFT JOIN unite u ON u.unt_code = e.ele_unt_stock
            LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
            LEFT JOIN chantier ch ON ch.cha_id = d.ent_chantier_id
            LEFT JOIN LATERAL (
                SELECT sum(k.lil_qte) FILTER (WHERE k.lil_etape = 'SORTIE') AS sortie, sum(k.lil_qte) FILTER (WHERE k.lil_etape = 'RECEPTION') AS reception,
                       sum(k.lil_qte) FILTER (WHERE k.lil_etape = 'FACTURATION') AS facturation
                FROM document_ligne_lien k JOIN document_ligne lc ON lc.lig_id = k.lil_cible_lig_id
                JOIN document dc ON dc.ent_id = lc.lig_ent_id JOIN statut_document sc ON sc.std_id = dc.ent_std_id
                WHERE k.lil_source_lig_id = l.lig_id AND dc.ent_verrouille AND sc.std_code NOT IN ('ANNULE', 'REMPLACE')) x ON TRUE
            WHERE f_module_actif('stock') AND d.ent_verrouille AND d.ent_is_reference AND s.std_code NOT IN ('ANNULE', 'REMPLACE', 'SOLDE')
              AND e.ele_gestion = 'STOCK' AND e.ele_type = 'ARTICLE' AND l.lig_type_prix = 'V' AND NOT l.lig_solde
              AND ((t.tyd_code = 'S_RESERVATION' AND d.ent_stk_origine_id = {lieu})
                OR (t.tyd_code = 'A_COMMANDE' AND coalesce(d.ent_stk_destination_id, d.ent_chantier_id) = {lieu}))
            ORDER BY 5, 6, d.ent_id, l.lig_ordre
            """).ToListAsync(ct);
        var r = new List<PrevisionStock>();
        foreach (var x in l)
        {
            var reste = x.Qte - x.Deja;
            if (reste <= 0) continue;
            var q = Socle.ArrondiCalcul.Arrondir(reste * MouvementsStockBtp.Ratio(x.Unite, new MouvementsStockBtp.UnitesArticle(x.UniteStock, x.Unites, x.Proprietes,
                x.Poids, x.Surface, x.SurfacePeinture, x.Volume, x.Hauteur, x.Largeur, x.Epaisseur, x.Longueur)), x.Precision);
            if (q <= 0) continue;
            var reservation = x.Code == TypesDocument.SReservation;
            r.Add(new PrevisionStock(x.EleId, reservation ? "SORTIE" : "ENTREE", reservation ? x.DateBesoin : x.DateLivraison, q, x.EntId, x.Numero, x.TypePiece, x.Tiers, x.Chantier));
        }
        return r;
    }

    private static async Task<List<ApproSql>> ApprosAsync(Microsoft.EntityFrameworkCore.Infrastructure.DatabaseFacade db, long[] ids, CancellationToken ct) =>
        await db.SqlQuery<ApproSql>($"""
            SELECT e.ele_id AS ele, t.tfo_tiers_id AS fournisseur_id, coalesce(p.per_raison_sociale, t.tfo_fournisseur) AS fournisseur,
                   coalesce(t.tfo_unt_code, e.ele_unt_achat, e.ele_unt_stock) AS unite_achat, t.tfo_prix AS prix,
                   e.ele_unt_stock AS unite_stock, e.ele_unites::text AS unites, e.ele_proprietes::text AS proprietes,
                   e.ele_poids AS poids, e.ele_surface AS surface, e.ele_surface_peinture AS surface_peinture, e.ele_volume AS volume,
                   e.ele_hauteur AS hauteur, e.ele_largeur AS largeur, e.ele_epaisseur AS epaisseur, e.ele_longueur AS longueur,
                   e.ele_code AS code, e.ele_libelle_html AS libelle_html, e.ele_nat_id AS nat_id
            FROM element e
            LEFT JOIN tarif_fournisseur t ON t.tfo_ele_id = e.ele_id AND t.tfo_principal
            LEFT JOIN personne p ON p.per_id = t.tfo_tiers_id
            WHERE e.ele_id = ANY({ids})
            """).ToListAsync(ct);

    private static decimal Conditionnement(ApproSql a) =>
        MouvementsStockBtp.Ratio(a.UniteAchat, new MouvementsStockBtp.UnitesArticle(a.UniteStock, a.Unites, a.Proprietes, a.Poids, a.Surface, a.SurfacePeinture,
            a.Volume, a.Hauteur, a.Largeur, a.Epaisseur, a.Longueur));

    public override async Task<Dictionary<long, ApproArticle>> ApprovisionnementsAsync(StockDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        return (await ApprosAsync(db.Database, ids.ToArray(), ct))
            .ToDictionary(a => a.Ele, a => new ApproArticle(a.Ele, a.FournisseurId, a.Fournisseur, a.UniteAchat, Conditionnement(a), a.Prix));
    }

    /// <summary>
    /// Une commande fournisseur en brouillon par fournisseur : livrée au lieu (destination et chantier rattaché), lignes
    /// d'articles en unité d'achat au prix du tarif principal, nature de l'article, TVA normale la plus haute.
    /// </summary>
    public override async Task<List<CommandeCreee>> CreerCommandesAsync(StockDbContext db, long lieu, List<LigneACommander> lignes, Utilisateur u, CancellationToken ct)
    {
        var sp = http.HttpContext?.RequestServices ?? throw new InvalidOperationException("Requête HTTP attendue");
        var documents = sp.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        var lb = sp.GetRequiredService<LogiBtpContext>();
        var appros = (await ApprosAsync(db.Database, lignes.Select(l => l.Ele).Distinct().ToArray(), ct)).ToDictionary(a => a.Ele);
        var tyd = await TypesDocumentBtp.IdAsync(lb, TypesDocument.ACommande, ct);
        var tva = await lb.TauxTva.Where(t => t.TtvCategorie == "N" && t.TtvActif).OrderByDescending(t => t.TtvDefaut).ThenByDescending(t => t.TtvTaux).Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct);
        var lieuCode = (await LieuxAsync(db, ct)).FirstOrDefault(x => x.Id == lieu)?.Code ?? lieu.ToString();
        var creees = new List<CommandeCreee>();
        foreach (var g in lignes.GroupBy(l => l.FournisseurId))
        {
            var cree = await documents.Creer(new CreationDocument { EntTydId = tyd, EntTiersId = g.Key, EntObjet = $"Réapprovisionnement {lieuCode}" }, u, ct);
            var c = await documents.Charger(cree.Document.EntId, ct);
            c.Document.EntStkDestinationId = (int)lieu;
            c.Document.EntChantierId = (int)lieu;
            var n = 0;
            foreach (var l in g.Where(l => appros.ContainsKey(l.Ele)))
            {
                var a = appros[l.Ele];
                n++;
                foreach (var x in c.Lignes.Where(x => x.LigParentId is null && x.LigOrdre >= n)) x.LigOrdre++;
                c.Lignes.Add(new DocumentLigneBtp
                {
                    LigId = -n, LigEntId = c.Document.EntId, LigOrdre = n, LigTylId = TL.Element, LigArtId = a.Ele, LigCode = a.Code,
                    LigLibelleHtml = a.LibelleHtml ?? a.Code, LigQte = l.UnitesAchat, LigUntCode = a.UniteAchat, LigPa = a.Prix ?? 0, LigNatId = a.NatId,
                    LigTvaId = tva, LigTypePrix = "V",
                });
            }
            if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
                c.Lignes.Add(new DocumentLigneBtp { LigId = -1000, LigEntId = c.Document.EntId, LigOrdre = n + 100, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
            var r = await documents.Enregistrer(c.Document.EntId, c, u, ct);
            creees.Add(new CommandeCreee(c.Document.EntId, (r.Document ?? c).Document.EntNumero, appros.Values.FirstOrDefault(a => a.FournisseurId == g.Key)?.Fournisseur, n));
        }
        return creees;
    }
}
