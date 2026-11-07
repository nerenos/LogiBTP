using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using LogiBTP.Stock.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Pièce comptable des inventaires (`db/269`) : à la validation d'un lot, pièce <c>S_INVENTAIRE</c> validée des écarts
/// valorisés à la date du lot (valeur unitaire de la méthode de la société, hors comptages du lot) — une ligne par article
/// (quantité = écart, PA = valeur unitaire), plus une ligne de réévaluation pour « Appliquer au PMP » (quantité comptée,
/// PA = prix d'inventaire − valeur unitaire) ; article sans valeur : écarté (journalisé). La pièce, sans tiers ni TVA, est
/// exportée en opération diverse (<see cref="SpecialisationComptabiliteBtp"/> : type comptable STOCK). Annulation du lot :
/// pièce annulée tant qu'elle n'est pas transférée, sinon contre-passée par une seconde pièce de quantités opposées.
/// </summary>
public sealed partial class SpecialisationStockBtp
{
    private sealed record ArticleInventaireSql(long Id, string? Unite, int? NatId);

    private (DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> Documents, LogiBtpContext Db, ILogger Journal) ServicesPiece()
    {
        var sp = http.HttpContext?.RequestServices ?? throw new InvalidOperationException("Requête HTTP attendue");
        return (sp.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>(), sp.GetRequiredService<LogiBtpContext>(),
            sp.GetRequiredService<ILoggerFactory>().CreateLogger("Stock"));
    }

    public override async Task<long?> ApresValidationLotAsync(StockDbContext db, LotInventaireEntite lot, EcartsLot ecarts, Utilisateur u, CancellationToken ct)
    {
        var (documents, lb, journal) = ServicesPiece();
        var lignes = new List<(long Ele, string Libelle, decimal Quantite, decimal Prix)>();
        foreach (var a in ecarts.Articles)
        {
            if (a.ValeurUnitaire is not { } pu)
            {
                if (a.Ecart != 0) journal.LogWarning("Inventaire {Lot} : article {Code} sans valeur, écart non porté en comptabilité", lot.LinId, a.Code);
                continue;
            }
            if (a.Ecart != 0) lignes.Add((a.Ele, $"{a.Code} – {a.Libelle}", a.Ecart, pu));
            if (a.AppliquerPmp && a.Prix is { } prix && prix != pu && a.Compte != 0)
                lignes.Add((a.Ele, $"{a.Code} – réévaluation au prix d'inventaire", a.Compte, prix - pu));
        }
        if (lignes.Count == 0) return null;
        try
        {
            var date = DateOnly.FromDateTime(lot.LinDate.ToLocalTime().DateTime);
            return await PieceEcartsAsync(documents, lb, (int)lot.LinLieuId, date, $"Écarts d'inventaire « {lot.LinLibelle} »", lignes, u, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogError(e, "Inventaire {Lot} : pièce des écarts non créée", lot.LinId);
            return null;
        }
    }

    public override async Task<long?> ApresAnnulationLotAsync(StockDbContext db, LotInventaireEntite lot, Utilisateur u, CancellationToken ct)
    {
        if (lot.LinEntId is not { } piece) return null;
        var (documents, lb, journal) = ServicesPiece();
        try
        {
            var etat = await lb.Database.SqlQuery<string?>($"SELECT ent_etat_compta::text AS \"Value\" FROM document WHERE ent_id = {piece}").FirstOrDefaultAsync(ct);
            if (etat != "T")
            {
                // Pas encore en comptabilité : la pièce est annulée et sort de l'export.
                await lb.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE document d SET ent_std_id = s.std_id, ent_etat_compta = 'S' FROM statut_document s
                    WHERE d.ent_id = {piece} AND s.std_tyd_id = d.ent_tyd_id AND s.std_code = {StatutsDocument.Annule}
                    """, ct);
                return null;
            }
            var c = await documents.Charger(piece, ct);
            var lignes = c.Lignes.Where(l => l.LigTylId == TL.Element && l.LigArtId is not null && (l.LigQte ?? 0) != 0)
                .Select(l => (l.LigArtId!.Value, $"Contre-passation : {System.Net.WebUtility.HtmlDecode(l.LigLibelleHtml)}", -(l.LigQte ?? 0), l.LigPa ?? 0)).ToList();
            var date = DateOnly.FromDateTime(DateTime.Today);
            return await PieceEcartsAsync(documents, lb, (int)lot.LinLieuId, date, $"Annulation de l'inventaire « {lot.LinLibelle} » ({c.Document.EntNumero})", lignes, u, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogError(e, "Inventaire {Lot} : pièce des écarts {Piece} ni annulée ni contre-passée", lot.LinId, piece);
            return null;
        }
    }

    /// <summary>
    /// Pièce S_INVENTAIRE validée : lignes d'articles au taux de TVA nul (exonéré de préférence : la pièce n'a pas de TVA,
    /// l'export l'ignore), quantité en unité de stock, PV = PA (coefficients à 1).
    /// </summary>
    internal static async Task<long> PieceEcartsAsync(DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, LogiBtpContext lb, int? lieu,
        DateOnly date, string objet, List<(long Ele, string Libelle, decimal Quantite, decimal Prix)> lignes, Utilisateur u, CancellationToken ct)
    {
        var tyd = await TypesDocumentBtp.IdAsync(lb, TypesDocument.SInventaire, ct);
        var ids = lignes.Select(l => l.Ele).Distinct().ToArray();
        var articles = (await lb.Database.SqlQuery<ArticleInventaireSql>($"SELECT ele_id AS id, ele_unt_stock AS unite, ele_nat_id AS nat_id FROM element WHERE ele_id = ANY({ids})")
            .ToListAsync(ct)).ToDictionary(a => a.Id);
        var tva = await lb.TauxTva.Where(t => t.TtvActif && t.TtvTaux == 0).OrderByDescending(t => t.TtvCategorie == "E").ThenBy(t => t.TtvOrdre)
            .Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct);
        var cree = await documents.Creer(new CreationDocument { EntTydId = tyd, EntObjet = objet.Length > 200 ? objet[..200] : objet }, u, ct);
        var c = await documents.Charger(cree.Document.EntId, ct);
        c.Document.EntDate = date;
        // Sans lieu (clôture du stock de tous les lieux) : pièce sans dépôt ni chantier.
        c.Document.EntStkOrigineId = lieu;
        c.Document.EntChantierId = lieu;
        var n = 0;
        foreach (var l in lignes)
        {
            var a = articles.GetValueOrDefault(l.Ele);
            n++;
            foreach (var x in c.Lignes.Where(x => x.LigParentId is null && x.LigOrdre >= n)) x.LigOrdre++;
            c.Lignes.Add(new DocumentLigneBtp
            {
                LigId = -n, LigEntId = c.Document.EntId, LigOrdre = n, LigTylId = TL.Element, LigArtId = l.Ele, LigLibelleHtml = System.Net.WebUtility.HtmlEncode(l.Libelle),
                LigQte = l.Quantite, LigUntCode = a?.Unite, LigPa = Math.Round(l.Prix, 6, MidpointRounding.AwayFromZero), LigNatId = a?.NatId, LigTvaId = tva, LigTypePrix = "V",
            });
        }
        if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
            c.Lignes.Add(new DocumentLigneBtp { LigId = -100000, LigEntId = c.Document.EntId, LigOrdre = n + 100, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
        var r = await documents.Enregistrer(c.Document.EntId, c, u, ct);
        await documents.Valider(c.Document.EntId, new DemandeVersion { EntVersion = (r.Document ?? c).Document.EntVersion }, u, ct);
        // Écarts qui se compensent (total nul) : l'écriture garde ses lignes de stock, la pièce reste à transférer.
        await lb.Database.ExecuteSqlInterpolatedAsync($"UPDATE document SET ent_etat_compta = 'A' WHERE ent_id = {c.Document.EntId} AND ent_etat_compta = 'S'", ct);
        return c.Document.EntId;
    }
}
