using System.Globalization;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Sav;
using LogiBTP.Sav.Web;
using LogiBTP.Socle;
using LogiBTP.Stock;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Équipements installés nés des numéros de série du stock (plans/stock.md, lot 4 ; ANALYSE-MODULE-STOCK.md § 11, S24.8) :
/// à la validation d'une pièce de stock (BL, facture sans BL, réception ou entrée livrée sur un chantier client, transfert
/// ou sortie vers lui), chaque numéro de série saisi sur une ligne d'un article suivi par numéro de série (`SERIE`) et
/// livré sur un chantier client crée un équipement installé (lieu = le chantier, client = son tiers, pose = date du
/// mouvement, garantie = durée de l'article) ; un numéro qui quitte un chantier client (retour client ou fournisseur,
/// transfert, sortie) retire l'équipement installé (Q6). Un numéro absent de la ligne (lots facultatifs, S24.2) ne crée
/// rien. Retirés par trigger (`db/273`) quand la pièce est dévalidée, annulée ou remplacée. Rejoué à chaque validation.
/// </summary>
public static class EquipementsSavBtp
{
    public sealed record InterventionEquipement(long Id, long EntId, string? Numero, string? Objet, DateOnly Le, string Constat, string Travaux, bool Terminee, bool Absent);

    /// <summary>
    /// Historique des interventions SAV d'un équipement (lot 6) : comptes rendus du terrain (`intervention_sav.isv_eqi_id`),
    /// sous le nœud de droits sav ; route du cœur ajoutée au groupe /api/sav du module.
    /// </summary>
    public static RouteGroupBuilder MapInterventionsEquipement(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/sav");
        g.MapGet("/equipements/{id:long}/interventions", async (long id, LogiBtpContext db, CancellationToken ct) =>
            await db.Database.SqlQueryRaw<InterventionEquipement>("""
                SELECT i.isv_id AS id, i.isv_ent_id AS ent_id, d.ent_numero AS numero, d.ent_objet AS objet, i.isv_le AS le, i.isv_constat AS constat,
                       i.isv_travaux AS travaux, i.isv_terminee AS terminee, i.isv_absent AS absent
                FROM intervention_sav i JOIN document d ON d.ent_id = i.isv_ent_id
                WHERE i.isv_eqi_id = @q ORDER BY i.isv_le DESC, i.isv_id DESC
                """, new NpgsqlParameter("q", id)).ToListAsync(ct));
        return g;
    }

    private sealed record EnteteSql(DateTimeOffset? DateMouvement, int? Origine, int? Destination, int? Chantier, long? Tiers, string Auteur);
    private sealed record LigneSql(long LigId, long EleId, string? Lots, int? GarantieMois, long? Source);
    private sealed record LieuSql(int Id, long? Tiers);

    /// <summary>Lieu où arrive la marchandise d'une pièce (null : rien n'arrive).</summary>
    private static int? Arrivee(string code, EnteteSql e) => code switch
    {
        TypesDocument.AReception or TypesDocument.AFacture => e.Destination ?? e.Chantier,
        TypesDocument.VReception or TypesDocument.VFacture => e.Chantier,
        TypesDocument.SEntree or TypesDocument.STransfert => e.Destination,
        _ => null,
    };

    /// <summary>Lieu que la marchandise quitte (null : rien ne part, ou lieu inconnu pour un retour client).</summary>
    private static int? Depart(string code, EnteteSql e) => code switch
    {
        TypesDocument.VRetour => e.Chantier,
        TypesDocument.ARetour => e.Destination ?? e.Chantier,
        TypesDocument.SSortie or TypesDocument.STransfert => e.Origine,
        _ => null,
    };

    /// <summary>Pièces dont les numéros de série font naître ou retirent un équipement.</summary>
    private static bool Concerne(TypeDocument type) => MouvementsStockBtp.Concerne(type);

    public static async Task EcrireAsync(DbContext db, long entId, TypeDocument type, CancellationToken ct)
    {
        if (!Concerne(type) || !await db.Database.SqlQuery<bool>($"SELECT f_module_actif('stock') AND f_module_actif('sav') AS \"Value\"").FirstAsync(ct)) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM equipement_installe WHERE eqi_ent_id = {entId} AND eqi_origine = 'MOUVEMENT'", ct);
        var e = await db.Database.SqlQuery<EnteteSql>($"""
            SELECT ent_date_mouvement AS date_mouvement, ent_stk_origine_id AS origine, ent_stk_destination_id AS destination, ent_chantier_id AS chantier,
                   ent_tiers_id AS tiers, coalesce(ent_modifie_par, ent_cree_par, 'logibtp') AS auteur FROM document WHERE ent_id = {entId}
            """).FirstAsync(ct);
        var code = type.TydCode;
        var arrivee = Arrivee(code, e);
        var depart = Depart(code, e);
        if (arrivee is null && depart is null && code != TypesDocument.VRetour) return;
        var lignes = await db.Database.SqlQuery<LigneSql>($"""
            SELECT l.lig_id, l.lig_art_id AS ele_id, (l.lig_proprietes -> 'lots')::text AS lots, sv.sas_garantie_mois AS garantie_mois,
                   (SELECT k.lil_source_lig_id FROM document_ligne_lien k JOIN document_ligne ls ON ls.lig_id = k.lil_source_lig_id
                      JOIN document ds ON ds.ent_id = ls.lig_ent_id JOIN type_document ts ON ts.tyd_id = ds.ent_tyd_id
                    WHERE k.lil_cible_lig_id = l.lig_id AND ts.tyd_mouvemente_stock ORDER BY k.lil_id LIMIT 1) AS source
            FROM document_ligne l
            JOIN element el ON el.ele_id = l.lig_art_id AND el.ele_gestion = 'STOCK' AND el.ele_type = 'ARTICLE'
            JOIN stk_article_suivi sv ON sv.sas_ele_id = el.ele_id AND sv.sas_suivi = 'SERIE'
            WHERE l.lig_ent_id = {entId} AND l.lig_type_prix = 'V' AND l.lig_proprietes -> 'lots' IS NOT NULL
            ORDER BY l.lig_ordre, l.lig_id
            """).ToListAsync(ct);
        if (lignes.Count == 0) return;
        // Chantier client : ni dépôt, ni chantier interne, ni dotation (sans tiers) ; sa fiche donne le client.
        var cible = arrivee is { } a
            ? await db.Database.SqlQuery<LieuSql>($"""
                SELECT cha_id AS id, cha_tiers_id AS tiers FROM chantier WHERE cha_id = {a} AND NOT cha_depot AND NOT cha_interne AND cha_tiers_id IS NOT NULL
                """).FirstOrDefaultAsync(ct)
            : null;
        var pose = DateOnly.FromDateTime(MouvementsStockBtp.Minute(e.DateMouvement).UtcDateTime);
        foreach (var l in lignes)
        {
            // Une pièce facturée d'après une livraison ou une réception ne remouvemente pas : ni création ni retrait.
            if (code is TypesDocument.AFacture or TypesDocument.VFacture && l.Source is not null) continue;
            var rep = ReglesTracabilite.Repartir(decimal.MaxValue, MouvementsStockBtp.LireLots(l.Lots), SuiviArticle.Serie);
            if (rep.Erreurs.Count > 0) continue;
            foreach (var part in rep.Parts.Where(p => p.Quantite == 1))
            {
                if (depart is not null || code == TypesDocument.VRetour)
                    await db.Database.ExecuteSqlInterpolatedAsync($"""
                        UPDATE equipement_installe SET eqi_etat = 'RETIRE', eqi_retire_le = {pose}, eqi_retire_ent_id = {entId}, eqi_maj_par = {e.Auteur}, eqi_maj_le = now()
                        WHERE eqi_ele_id = {l.EleId} AND upper(eqi_numero) = upper({part.Numero}) AND eqi_etat = 'INSTALLE'
                          AND ({depart}::int IS NULL OR eqi_lieu_id = {depart}::int)
                        """, ct);
                if (cible is null) continue;
                var tiers = cible.Tiers ?? (code is TypesDocument.VReception or TypesDocument.VFacture ? e.Tiers : null);
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO equipement_installe (eqi_numero, eqi_ele_id, eqi_lot_id, eqi_lieu_id, eqi_tiers_id, eqi_pose, eqi_garantie_mois, eqi_origine,
                                                     eqi_ent_id, eqi_lig_id, eqi_mvt_id, eqi_cree_par)
                    VALUES ({part.Numero}, {l.EleId},
                            (SELECT lot_id FROM stk_lot WHERE lot_ele_id = {l.EleId} AND upper(lot_numero) = upper({part.Numero}) ORDER BY lot_id DESC LIMIT 1),
                            {cible.Id}, {tiers}, {pose}, {l.GarantieMois}, 'MOUVEMENT', {entId}, {l.LigId},
                            (SELECT m.mvt_id FROM stk_mouvement m JOIN stk_lot x ON x.lot_id = m.mvt_lot_id
                             WHERE m.mvt_lig_id = {l.LigId} AND m.mvt_quantite > 0 AND upper(x.lot_numero) = upper({part.Numero}) ORDER BY m.mvt_id LIMIT 1),
                            {e.Auteur})
                    ON CONFLICT (eqi_ele_id, upper(eqi_numero)) WHERE eqi_etat = 'INSTALLE' DO NOTHING
                    """, ct);
            }
        }
    }
}

/// <summary>Spécialisation du cœur pour le module SAV : libellés des articles, lieux (chantiers), clients et pièces des équipements.</summary>
public sealed class SpecialisationSavBtp : SpecialisationSav
{
    private sealed record DescriptionSql(long Id, string? ArticleCode, string? ArticleLibelle, string? LieuCode, string? LieuLibelle, string? TiersNom, string? Piece);

    /// <summary>Article de la bibliothèque connu (SAV_ARTICLE sinon).</summary>
    public override async Task<List<string>> ControlerAsync(SavDbContext db, EquipementSaisi s, CancellationToken ct)
    {
        if (s.Article is not long a) return [];
        var existe = await db.Database.SqlQuery<bool>($"SELECT EXISTS (SELECT 1 FROM element WHERE ele_id = {a} AND ele_type = 'ARTICLE') AS \"Value\"").FirstAsync(ct);
        return existe ? [] : ["SAV_ARTICLE"];
    }

    public override async Task<IReadOnlyDictionary<long, DescriptionEquipement>> DecrireAsync(SavDbContext db, IReadOnlyCollection<EquipementEntite> equipements, CancellationToken ct)
    {
        var ids = equipements.Select(x => x.EqiId).ToArray();
        var lignes = await db.Database.SqlQuery<DescriptionSql>($"""
            SELECT q.eqi_id AS id, e.ele_code AS article_code, e.ele_libelle AS article_libelle, c.cha_code AS lieu_code, c.cha_libelle AS lieu_libelle,
                   p.per_raison_sociale AS tiers_nom, d.ent_numero AS piece
            FROM equipement_installe q
            LEFT JOIN element e ON e.ele_id = q.eqi_ele_id
            LEFT JOIN chantier c ON c.cha_id = q.eqi_lieu_id
            LEFT JOIN personne p ON p.per_id = q.eqi_tiers_id
            LEFT JOIN document d ON d.ent_id = q.eqi_ent_id
            WHERE q.eqi_id = ANY({ids})
            """).ToListAsync(ct);
        return lignes.ToDictionary(x => x.Id, x => new DescriptionEquipement(x.ArticleCode, x.ArticleLibelle, x.LieuCode, x.LieuLibelle, x.TiersNom, x.Piece));
    }
}
