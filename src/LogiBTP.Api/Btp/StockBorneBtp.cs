using LogiBTP.Domaine;
using LogiBTP.Documents.Web;
using LogiBTP.Pointage.Web;
using LogiBTP.Socle.Web;
using LogiBTP.Stock.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

public sealed record SaisieBorneStock(string Jeton, string? Mode, int? Chantier, bool Dotation, List<LigneMagasin>? Lignes, string? Commentaire);
public sealed record DepotBorne(int? Lieu);
public sealed record TraitementSaisie(bool Accepter, string? Motif);

/// <summary>
/// Module Stock, lot 5 (ANALYSE-MODULE-STOCK.md § 5.5, S17, S18 ; liaison Pointage → Stock) : sorties et retours de
/// l'atelier saisis à la borne par le salarié identifié (dépôt de la borne ; vers un chantier ou en dotation) : pièces
/// validées d'office (le stock bouge aussitôt) mais « à valider » ; traitement par le responsable du service du salarié
/// (ou de son service parent), un magasinier ou un administrateur : accepter, ou refuser (pièce annulée : ses mouvements
/// disparaissent) avec un motif. Borne d'essai : rien n'est écrit.
/// </summary>
public static class StockBorneBtp
{
    private sealed record LieuSql(int Id, string Code, string Libelle);
    private sealed record NetSql(long Ele, decimal Quantite);
    private sealed record AValiderSql(long EntId, string? Numero, string Type, string? Objet, DateTimeOffset? Date, int? Salarie, string? Nom, string? Origine, string? Destination, string Lignes);

    private static async Task<LieuSql?> DepotAsync(LogiBtpContext db, int appareil, CancellationToken ct) =>
        (await db.Database.SqlQuery<LieuSql>($"""
            SELECT c.cha_id AS id, c.cha_code AS code, c.cha_libelle AS libelle FROM poi_appareil a JOIN chantier c ON c.cha_id = a.pap_stk_lieu_id WHERE a.pap_id = {appareil}
            """).ToListAsync(ct)).FirstOrDefault();

    /// <summary>Peut traiter une saisie du salarié : administrateur, magasinier, responsable de son service principal ou du parent.</summary>
    private static async Task<bool> PeutTraiterAsync(LogiBtpContext db, Utilisateur u, int? salarie, CancellationToken ct)
    {
        if (u.EstAdmin || await SpecialisationStockBtp.MagasinierAsync(db.Database, u.Code, ct)) return true;
        if (salarie is null) return false;
        return await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS (SELECT 1 FROM salarie s JOIN service_membre m ON m.sme_ind_id = s.sal_ind_id AND m.sme_principal
                           JOIN service v ON v.srv_id = m.sme_srv_id LEFT JOIN service p ON p.srv_id = v.srv_parent_id
                           JOIN individu i ON i.ind_id IN (v.srv_responsable_id, p.srv_responsable_id)
                           WHERE s.sal_id = {salarie} AND i.ind_utilisateur = {u.Code}) AS "Value"
            """).FirstAsync(ct);
    }

    public static RouteGroupBuilder MapStockBorne(this RouteGroupBuilder api)
    {
        // Dépôt de stock d'une borne (paramétrage des bornes, administrateur).
        api.MapGet("/stock/bornes/{id:int}/depot", async (int id, LogiBtpContext db, CancellationToken ct) =>
            new DepotBorne((await DepotAsync(db, id, ct))?.Id));
        api.MapPut("/stock/bornes/{id:int}/depot", async (int id, DepotBorne d, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            if (!Utilisateur.Depuis(http).EstAdmin) throw ExceptionMetier.AccesRefuse("ADMIN");
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE poi_appareil SET pap_stk_lieu_id = {d.Lieu} WHERE pap_id = {id}", ct);
            return new DepotBorne(d.Lieu);
        });

        // Saisies de la borne à valider : celles que l'utilisateur peut traiter.
        api.MapGet("/stock/magasin/a-valider", async (HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var l = await db.Database.SqlQuery<AValiderSql>($"""
                SELECT d.ent_id, d.ent_numero AS numero, t.tyd_libelle AS type, d.ent_objet AS objet, d.ent_date_mouvement AS date, d.ent_stk_salarie_id AS salarie,
                       s.sal_nom || ' ' || s.sal_prenom AS nom, o.cha_code AS origine, x.cha_code AS destination,
                       coalesce((SELECT string_agg(l.lig_code || ' × ' || trim(to_char(l.lig_qte, 'FM999999990.###')), ', ' ORDER BY l.lig_ordre)
                                 FROM document_ligne l WHERE l.lig_ent_id = d.ent_id AND l.lig_art_id IS NOT NULL), '') AS lignes
                FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
                LEFT JOIN salarie s ON s.sal_id = d.ent_stk_salarie_id LEFT JOIN chantier o ON o.cha_id = d.ent_stk_origine_id LEFT JOIN chantier x ON x.cha_id = d.ent_stk_destination_id
                WHERE d.ent_stk_a_valider ORDER BY d.ent_date_mouvement, d.ent_id
                """).ToListAsync(ct);
            var r = new List<AValiderSql>();
            foreach (var x in l) if (await PeutTraiterAsync(db, u, x.Salarie, ct)) r.Add(x);
            return r;
        });
        api.MapPost("/stock/magasin/a-valider/{id:long}", async (long id, TraitementSaisie t, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var salarie = (await db.Database.SqlQuery<int?>($"SELECT ent_stk_salarie_id AS \"Value\" FROM document WHERE ent_id = {id} AND ent_stk_a_valider").ToListAsync(ct));
            if (salarie.Count == 0) throw ExceptionMetier.Introuvable("Saisie à valider");
            if (!await PeutTraiterAsync(db, u, salarie[0], ct)) throw ExceptionMetier.AccesRefuse("VALIDER_SAISIE_STOCK");
            if (!t.Accepter && string.IsNullOrWhiteSpace(t.Motif)) throw ExceptionMetier.Invalide("STK_MOTIF", "Motif obligatoire pour refuser une saisie");
            // Refus : la pièce passe au statut Annulé (le trigger retire ses mouvements : le stock se recalcule sans elle).
            if (!t.Accepter)
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE document d SET ent_std_id = s.std_id FROM statut_document s WHERE d.ent_id = {id} AND s.std_tyd_id = d.ent_tyd_id AND s.std_code = 'ANNULE'
                    """, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE document SET ent_stk_a_valider = FALSE, ent_stk_traite_par = {u.Code}, ent_stk_traite_le = now(), ent_stk_motif = {(t.Accepter ? null : t.Motif!.Trim())}
                WHERE ent_id = {id}
                """, ct);
            return Results.NoContent();
        });

        // Borne (publique : X-Borne-Jeton + jeton de saisie du salarié identifié).
        var b = api.MapGroup("/pointage/borne/stock");
        b.MapGet("", async (string jeton, HttpContext http, LogiBtpContext db, ServiceBorne borne, ServiceInventaire inventaire, CancellationToken ct) =>
        {
            var (s, appareil, _) = await borne.SalarieIdentifieAsync(http, jeton, ct);
            var depot = await DepotAsync(db, appareil, ct);
            var nets = await db.Database.SqlQuery<NetSql>($"""
                SELECT v.ele_id AS ele, v.quantite FROM v_stk_stock v JOIN salarie s ON s.sal_cha_dotation_id = v.lieu_id WHERE s.sal_id = {s} AND v.quantite <> 0
                """).ToListAsync(ct);
            return new { depot, articles = depot is null ? null : await inventaire.ArticlesAsync(ct), dotations = nets };
        });
        b.MapPost("", async (SaisieBorneStock x, HttpContext http, LogiBtpContext db, ServiceBorne borne,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var (s, appareil, test) = await borne.SalarieIdentifieAsync(http, x.Jeton, ct);
            var depot = await DepotAsync(db, appareil, ct) ?? throw ExceptionMetier.Invalide("STK_BORNE_DEPOT", "Aucun dépôt de stock pour cette borne (paramétrage des bornes)");
            if (x.Lignes is not { Count: > 0 } || x.Lignes.Any(l => l.Quantite <= 0)) throw ExceptionMetier.Invalide("STK_QUANTITE", "Au moins un article à quantité positive");
            if (!x.Dotation && x.Chantier is null) throw ExceptionMetier.Invalide("STK_BENEFICIAIRE", "Chantier ou dotation personnelle");
            if (test) return Results.Ok(new { essai = true, pieces = Array.Empty<PieceMagasin>() });
            // Pièce créée au nom du compte du salarié ; droits de création portés par la borne (appareil enregistré, PIN).
            var code = await db.Database.SqlQuery<string?>($"""
                SELECT coalesce(i.ind_utilisateur, 'salarie:' || s.sal_id) AS "Value" FROM salarie s LEFT JOIN individu i ON i.ind_id = s.sal_ind_id WHERE s.sal_id = {s}
                """).FirstAsync(ct);
            var auteur = new Utilisateur(code ?? $"borne:{appareil}", "ADMIN", null);
            var cible = x.Dotation ? await MagasinBtp.ChantierDotationAsync(db, s, ct) : x.Chantier!.Value;
            var com = string.IsNullOrWhiteSpace(x.Commentaire) ? "" : $" : {x.Commentaire.Trim()}";
            var pieces = new List<PieceMagasin>();
            if (x.Mode == "RETOUR")
            {
                var bons = x.Lignes.Where(l => !l.Rebut).ToList();
                var rebuts = x.Lignes.Where(l => l.Rebut).ToList();
                if (bons.Count > 0) pieces.Add(await MagasinBtp.PieceAsync(db, documents, "S_TRANSFERT", cible, depot.Id, cible, bons, $"Retour à la borne{com}", null, auteur, ct));
                if (rebuts.Count > 0) pieces.Add(await MagasinBtp.PieceAsync(db, documents, "S_SORTIE", cible, null, cible, rebuts, $"Rebut à la borne{com}", null, auteur, ct));
            }
            else pieces.Add(await MagasinBtp.PieceAsync(db, documents, "S_TRANSFERT", depot.Id, cible, cible, x.Lignes, $"{(x.Dotation ? "Dotation" : "Sortie")} à la borne{com}", null, auteur, ct));
            var ids = pieces.Select(p => p.EntId).ToArray();
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document SET ent_stk_a_valider = TRUE, ent_stk_salarie_id = {s} WHERE ent_id = ANY({ids})", ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE stk_mouvement SET mvt_origine = 'BORNE', mvt_ind_id = (SELECT sal_ind_id FROM salarie WHERE sal_id = {s}) WHERE mvt_ent_id = ANY({ids})
                """, ct);
            return Results.Ok(new { essai = false, pieces });
        });
        b.ExigeModule("stock", "Stock");
        return api;
    }
}
