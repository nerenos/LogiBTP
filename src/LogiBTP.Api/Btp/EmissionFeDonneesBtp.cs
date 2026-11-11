using LogiBTP.Calcul;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Paramètres d'émission lus par l'éditeur : BT-3 par type, nature par nature d'article, mentions (notes et TVA sur les débits).</summary>
public sealed record ReferentielEmissionFe(IReadOnlyDictionary<string, string> Types, IReadOnlyDictionary<int, string> Natures, MentionsEmissionFe Mentions);

/// <summary>
/// Données des paramètres d'émission BTP d'une pièce (plans/facturation-electronique.md, lot 21), lues en base puis
/// calculées par <see cref="EmissionFeBtp"/> (règle répliquée dans client/src/calcul/emission-fe.js) : BT-3 du type
/// (type_document.tyd_fe_type_facture, db/299) et de la facture d'origine d'un avoir (lien TRANSFORMATION ou ANNULATION),
/// natures des lignes (nature_element.nat_fe_nature), surcharge de l'entête (ent_fe_nature), déduction d'une facture
/// d'acompte (acompte_deduction d'un acompte en mode chiffre d'affaires), mentions de la société (db/190). Rôle sous-traitant
/// ou cotraitant et pièce déjà payée : fournis par l'appelant (lots 24 et 27).
/// Routes : GET /api/facture-electronique/emission/referentiel, GET /api/facture-electronique/documents/{id}/emission.
/// </summary>
public static class EmissionFeDonneesBtp
{
    private sealed record LigneTypeSql(string Code, string Type);
    private sealed record LigneNatureSql(int Id, string Nature);
    private sealed record LigneMentionsSql(string? Indemnite, string? Penalites, string? Escompte, bool TvaDebits);
    private sealed record LigneDocumentSql(string? TypeFacture, string? Nature);
    private sealed record LigneSql(long Id, long? Parent, short Type, string? TypePrix, int? Nature, bool Ecart);

    public static async Task<MentionsEmissionFe> MentionsAsync(DbContext db, CancellationToken ct)
    {
        var m = await db.Database.SqlQueryRaw<LigneMentionsSql>("""
            SELECT v->>'indemnite' AS "Indemnite", v->>'penalites' AS "Penalites", v->>'escompte' AS "Escompte",
                   coalesce((v->>'tva_debits')::boolean, FALSE) AS "TvaDebits"
            FROM (SELECT coalesce((SELECT pae_valeur FROM parametre_edition WHERE pae_cle = 'mentions'), '{}'::jsonb) AS v) x
            """).FirstAsync(ct);
        return new MentionsEmissionFe(m.Indemnite, m.Penalites, m.Escompte, m.TvaDebits);
    }

    public static async Task<Dictionary<int, string>> NaturesAsync(DbContext db, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LigneNatureSql>(
            "SELECT nat_id AS \"Id\", nat_fe_nature::text AS \"Nature\" FROM nature_element WHERE nat_fe_nature IS NOT NULL").ToListAsync(ct))
        .ToDictionary(x => x.Id, x => x.Nature);

    public static async Task<ReferentielEmissionFe> ReferentielAsync(DbContext db, CancellationToken ct)
    {
        var types = await db.Database.SqlQueryRaw<LigneTypeSql>(
            "SELECT tyd_code AS \"Code\", tyd_fe_type_facture AS \"Type\" FROM type_document WHERE tyd_fe_type_facture IS NOT NULL").ToListAsync(ct);
        return new ReferentielEmissionFe(types.ToDictionary(x => x.Code, x => x.Type), await NaturesAsync(db, ct), await MentionsAsync(db, ct));
    }

    /// <summary>Entrée de la règle pour une pièce (null : pièce introuvable).</summary>
    public static async Task<EntreeEmissionFe?> EntreeAsync(DbContext db, long id, string? role, bool dejaPayee, CancellationToken ct)
    {
        var d = await db.Database.SqlQueryRaw<LigneDocumentSql>("""
            SELECT t.tyd_fe_type_facture AS "TypeFacture", d.ent_fe_nature::text AS "Nature"
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = {0}
            """, id).FirstOrDefaultAsync(ct);
        if (d is null) return null;
        var origine = await db.Database.SqlQueryRaw<string>("""
            SELECT t.tyd_fe_type_facture AS "Value"
            FROM document_lien l JOIN document s ON s.ent_id = l.lie_source_ent_id JOIN type_document t ON t.tyd_id = s.ent_tyd_id
            WHERE l.lie_cible_ent_id = {0} AND l.lie_type IN ('TRANSFORMATION', 'ANNULATION') AND t.tyd_fe_type_facture IS NOT NULL
            ORDER BY s.ent_id LIMIT 1
            """, id).FirstOrDefaultAsync(ct);
        var lignes = await db.Database.SqlQueryRaw<LigneSql>("""
            SELECT lig_id AS "Id", lig_parent_id AS "Parent", lig_tyl_id AS "Type", lig_type_prix AS "TypePrix", lig_nat_id AS "Nature",
                   coalesce(lig_is_ecart_arrondi, FALSE) AS "Ecart"
            FROM document_ligne WHERE lig_ent_id = {0}
            """, id).ToListAsync(ct);
        var deduit = await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM acompte_deduction x JOIN marche_acompte a ON a.mac_id = x.acd_mac_id
                           WHERE x.acd_ent_id = {0} AND a.mac_mode = 'CA' AND x.acd_montant <> 0) AS "Value"
            """, id).FirstAsync(ct);
        return new EntreeEmissionFe
        {
            TypeFacture = d.TypeFacture,
            TypeOrigine = origine,
            EntFeNature = d.Nature,
            Lignes = lignes.Select(l => new DocumentLigneBtp
            {
                LigId = l.Id, LigParentId = l.Parent, LigTylId = l.Type, LigTypePrix = l.TypePrix ?? "V", LigNatId = l.Nature, LigIsEcartArrondi = l.Ecart,
            }).ToList(),
            NaturesFe = await NaturesAsync(db, ct),
            Role = role is SituationsCadreFe.SousTraitant or SituationsCadreFe.Cotraitant ? role : null,
            DeduitAcompte = deduit,
            DejaPayee = dejaPayee,
            Mentions = await MentionsAsync(db, ct),
        };
    }

    /// <summary>Paramètres d'émission d'une pièce (null : type jamais émis) ; pièce introuvable : 404.</summary>
    public static async Task<ParametresEmissionFe?> ParametresAsync(DbContext db, long id, string? role, bool dejaPayee, CancellationToken ct)
    {
        var e = await EntreeAsync(db, id, role, dejaPayee, ct) ?? throw ExceptionMetier.Introuvable("Document");
        return EmissionFeBtp.Parametres(e);
    }

    public static RouteGroupBuilder MapEmissionFe(this RouteGroupBuilder api)
    {
        api.MapGet("/facture-electronique/emission/referentiel", (HttpContext http, CancellationToken ct) =>
            ReferentielAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), ct));
        api.MapGet("/facture-electronique/documents/{id:long}/emission", async (long id, HttpContext http, CancellationToken ct) =>
            Results.Ok(await ParametresAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), id, null, false, ct)));
        return api;
    }
}
