using LogiBTP.Comptabilite.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Comptabilité spécialisé par le cœur (db/223) : taux de TVA (`taux_tva` du module Document, catégorie et comptes
/// ajoutés par le cœur) ; tiers de l'annuaire par type de compte : CLIENT (relation dont la casquette ouvre le groupe
/// « client » ; collectif client professionnel ou particulier selon le niveau), FOURNISSEUR (groupe « fournisseur »),
/// SOUS_TRAITANT (groupe « sous_traitant » : compte propre `per_st_compte`, sinon celui du fournisseur, C4) ; usages
/// d'un compte (lignes, natures, tiers, taux).
/// </summary>
public sealed class SpecialisationComptabiliteBtp : SpecialisationComptabilite
{
    private sealed record TauxSql(int Id, string Code, string Libelle, decimal Taux, string? Categorie, string Comportement, string? Mention, bool Actif,
        string? CompteCollectee, string? CompteCollecteeEncaissement, string? CompteDeductible, string? CompteAutoliquidee);

    public override async Task<List<TauxTvaDto>> TauxAsync(ComptabiliteDbContext db, CancellationToken ct) =>
        (await db.Database.SqlQuery<TauxSql>($"""
            SELECT ttv_id AS id, ttv_code AS code, ttv_libelle AS libelle, ttv_taux AS taux, ttv_ctv_code AS categorie,
                   ttv_categorie::text AS comportement, ttv_mention AS mention, ttv_actif AS actif,
                   ttv_cpt_collectee AS compte_collectee, ttv_cpt_collectee_encaissement AS compte_collectee_encaissement,
                   ttv_cpt_deductible AS compte_deductible, ttv_cpt_autoliquidee AS compte_autoliquidee
            FROM taux_tva ORDER BY ttv_actif DESC, ttv_taux DESC, ttv_code
            """).ToListAsync(ct))
        .Select(t => new TauxTvaDto(t.Id, t.Code, t.Libelle, t.Taux, t.Categorie, t.Comportement, t.Mention, t.Actif,
            t.CompteCollectee, t.CompteCollecteeEncaissement, t.CompteDeductible, t.CompteAutoliquidee))
        .ToList();

    /// <summary>Le comportement (ttv_categorie, lu par les moteurs) suit la catégorie choisie.</summary>
    public override async Task EnregistrerTauxAsync(ComptabiliteDbContext db, List<TauxTvaDto> taux, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var t in taux)
        {
            var mention = string.IsNullOrWhiteSpace(t.Mention) ? null : t.Mention.Trim();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE taux_tva SET ttv_ctv_code = {t.Categorie}, ttv_categorie = {t.Comportement}, ttv_mention = {mention}, ttv_actif = {t.Actif},
                       ttv_cpt_collectee = {Vide(t.CompteCollectee)}, ttv_cpt_collectee_encaissement = {Vide(t.CompteCollecteeEncaissement)},
                       ttv_cpt_deductible = {Vide(t.CompteDeductible)}, ttv_cpt_autoliquidee = {Vide(t.CompteAutoliquidee)}
                WHERE ttv_id = {t.Id}
                """, ct);
        }
        await tx.CommitAsync(ct);
    }

    private static string? Vide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private sealed record TiersSql(long TiersId, string TypeCompte, string? CodeTiers, string RaisonSociale, bool Particulier, bool Actif,
        string? Compte, string? CompteSaisi, string CollectifType, string? CollectifSaisi, string? Siret, string? TvaIntra);

    // Personne qui a une casquette ouvrant un groupe de la fiche (client, fournisseur, sous_traitant), ou déjà un compte.
    public override async Task<List<TiersComptable>> TiersAsync(ComptabiliteDbContext db, CancellationToken ct) =>
        (await db.Database.SqlQuery<TiersSql>($"""
            WITH p AS (
                SELECT p.*, NOT coalesce(n.niv_morale, TRUE) AS particulier,
                       EXISTS (SELECT 1 FROM casquette c WHERE p.per_casquettes @> jsonb_build_array(c.cas_code) AND c.cas_groupes @> '["client"]'::jsonb) AS est_client,
                       EXISTS (SELECT 1 FROM casquette c WHERE p.per_casquettes @> jsonb_build_array(c.cas_code) AND c.cas_groupes @> '["fournisseur"]'::jsonb) AS est_fournisseur,
                       EXISTS (SELECT 1 FROM casquette c WHERE p.per_casquettes @> jsonb_build_array(c.cas_code) AND c.cas_groupes @> '["sous_traitant"]'::jsonb) AS est_st
                FROM personne p LEFT JOIN niveau_personne n ON n.niv_code = p.per_niv_code
                WHERE NOT p.per_societe_base)
            SELECT per_id AS tiers_id, 'CLIENT' AS type_compte, per_code AS code_tiers, per_raison_sociale AS raison_sociale, particulier AS particulier,
                   per_actif AS actif, per_cli_compte AS compte, per_cli_compte AS compte_saisi,
                   CASE WHEN particulier THEN 'CLIENT_PRIVE' ELSE 'CLIENT_PRO' END AS collectif_type, per_cli_collectif AS collectif_saisi,
                   per_siret AS siret, per_tva_intra AS tva_intra
            FROM p WHERE est_client OR per_cli_compte IS NOT NULL
            UNION ALL
            SELECT per_id, 'FOURNISSEUR', per_code, per_raison_sociale, particulier, per_actif, per_fou_compte, per_fou_compte,
                   'FOURNISSEUR', per_fou_collectif, per_siret, per_tva_intra
            FROM p WHERE est_fournisseur OR per_fou_compte IS NOT NULL
            UNION ALL
            SELECT per_id, 'SOUS_TRAITANT', per_code, per_raison_sociale, particulier, per_actif, coalesce(per_st_compte, per_fou_compte), per_st_compte,
                   'SOUS_TRAITANT', per_st_collectif, per_siret, per_tva_intra
            FROM p WHERE est_st OR per_st_compte IS NOT NULL
            """).ToListAsync(ct))
        .Select(t => new TiersComptable(t.TiersId, t.TypeCompte, t.CodeTiers, t.RaisonSociale, t.Particulier, t.Actif, t.Compte, t.CompteSaisi,
            t.CollectifType, t.CollectifSaisi, t.Siret, t.TvaIntra))
        .ToList();

    public override string? TypeHerite(string typeCompte) => typeCompte == "SOUS_TRAITANT" ? "FOURNISSEUR" : null;

    /// <summary>Un compte de sous-traitant égal à son compte fournisseur n'est pas gardé (il en hérite).</summary>
    public override async Task EnregistrerComptesTiersAsync(ComptabiliteDbContext db, List<CompteTiersSaisi> comptes, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var s in comptes)
        {
            var n = s.TypeCompte switch
            {
                "CLIENT" => await db.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE personne SET per_cli_compte = {s.Compte}, per_cli_collectif = {s.Collectif} WHERE per_id = {s.TiersId}", ct),
                "FOURNISSEUR" => await db.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE personne SET per_fou_compte = {s.Compte}, per_fou_collectif = {s.Collectif} WHERE per_id = {s.TiersId}", ct),
                "SOUS_TRAITANT" => await db.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE personne SET per_st_compte = NULLIF({s.Compte}, per_fou_compte), per_st_collectif = {s.Collectif} WHERE per_id = {s.TiersId}", ct),
                _ => throw ExceptionMetier.Invalide("CPT_TYPE_TIERS", $"Type de compte de tiers inconnu : {s.TypeCompte}"),
            };
            if (n == 0) throw ExceptionMetier.Introuvable($"Tiers {s.TiersId}");
        }
        await tx.CommitAsync(ct);
    }

    private sealed record UsageSql(string Quoi, int Nombre);

    public override async Task<List<string>> UtilisationsCompteAsync(ComptabiliteDbContext db, string code, CancellationToken ct) =>
        (await db.Database.SqlQuery<UsageSql>($"""
            SELECT x.quoi AS quoi, x.nombre AS nombre FROM (
                SELECT 'lignes de documents' AS quoi, (SELECT count(*)::int FROM document_ligne WHERE lig_cpt_code = {code}) AS nombre
                UNION ALL SELECT 'natures', (SELECT count(*)::int FROM nature_element WHERE nat_compte_vente = {code} OR nat_compte_achat = {code})
                UNION ALL SELECT 'tiers', (SELECT count(*)::int FROM personne WHERE {code} IN (per_cli_collectif, per_fou_collectif, per_st_collectif))
                UNION ALL SELECT 'taux de TVA', (SELECT count(*)::int FROM taux_tva
                          WHERE {code} IN (ttv_cpt_collectee, ttv_cpt_collectee_encaissement, ttv_cpt_deductible, ttv_cpt_autoliquidee))) x
            WHERE x.nombre > 0
            """).ToListAsync(ct))
        .Select(u => $"{u.Nombre} {u.Quoi}")
        .ToList();

    private sealed record NatureSql(string Code, string Libelle, bool Actif);

    public override async Task<List<NatureVentilation>> NaturesAsync(ComptabiliteDbContext db, CancellationToken ct) =>
        (await db.Database.SqlQuery<NatureSql>($"""
            SELECT nat_code AS code, nat_libelle AS libelle, nat_actif AS actif FROM nature_element ORDER BY nat_actif DESC, nat_code
            """).ToListAsync(ct))
        .Select(n => new NatureVentilation(n.Code, n.Libelle, n.Actif)).ToList();

    private sealed record TypeDocumentSql(string Code, string Libelle, string Famille, string? TypeComptable, string? TypeEffectif, bool PieceComptable);

    // Pièce comptable : règle PIECE_COMPTABLE du type, sinon de la famille (module Document, db/178).
    public override async Task<List<TypeDocumentComptable>> TypesDocumentsAsync(ComptabiliteDbContext db, CancellationToken ct) =>
        (await db.Database.SqlQuery<TypeDocumentSql>($"""
            SELECT t.tyd_code AS code, t.tyd_libelle AS libelle, t.tyd_famille::text AS famille, t.tyd_tco_code AS type_comptable,
                   f_type_comptable(t.tyd_tco_code, t.tyd_famille) AS type_effectif,
                   coalesce((SELECT r.rdo_valeur FROM regle_document r WHERE r.rdo_code = 'PIECE_COMPTABLE' AND r.rdo_tyd_id = t.tyd_id AND r.rdo_actif),
                            (SELECT r.rdo_valeur FROM regle_document r WHERE r.rdo_code = 'PIECE_COMPTABLE' AND r.rdo_famille = t.tyd_famille AND r.rdo_actif),
                            'false'::jsonb) = 'true'::jsonb AS piece_comptable
            FROM type_document t WHERE t.tyd_actif ORDER BY t.tyd_famille, t.tyd_code
            """).ToListAsync(ct))
        .Select(t => new TypeDocumentComptable(t.Code, t.Libelle, t.Famille, t.TypeComptable, t.TypeEffectif, t.PieceComptable)).ToList();

    public override async Task EnregistrerTypesDocumentsAsync(ComptabiliteDbContext db, List<TypeDocumentSaisi> types, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var t in types)
            if (await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE type_document SET tyd_tco_code = {t.TypeComptable} WHERE tyd_code = {t.Code}", ct) == 0)
                throw ExceptionMetier.Introuvable($"Type de document {t.Code}");
        await tx.CommitAsync(ct);
    }

    public override Task<int> TauxDeCategorieAsync(ComptabiliteDbContext db, string categorie, CancellationToken ct) =>
        db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM taux_tva WHERE ttv_ctv_code = {categorie}").FirstAsync(ct);
}
