using LogiBTP.Api.Btp;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Photos de départ et de retour d'une affectation de matériel (db/279, plan materiel-suites, lot 1).</summary>
public class PhotosAffectationTests
{
    [Fact]
    public void Photo_du_materiel_acceptee_photo_d_un_autre_materiel_refusee()
    {
        Assert.Empty(PhotosAffectation.Refusees([10L, 11L], [10L, 11L, 12L]));
        Assert.Equal([11L], PhotosAffectation.Refusees([10L, 11L], [10L]));
    }

    [Fact]
    public void Saisie_sans_photo_par_defaut()
    {
        var s = new AffectationMaterielSaisie("SALARIE", "1", null, null, null);
        Assert.Null(s.GedDepart);
        Assert.Null(s.GedRetour);
    }

    /// <summary>Base de développement (LOGIBTP_TEST_PG, script 279 appliqué) : photos enregistrées, suppression logique ou physique → vide. Transaction annulée.</summary>
    [Fact]
    public void Suppression_du_document_ged_remet_l_identifiant_a_vide()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        using var c = new NpgsqlConnection(connexion);
        c.Open();
        using var tx = c.BeginTransaction();
        object? Scalaire(string sql) { using var k = new NpgsqlCommand(sql, c, tx); return k.ExecuteScalar(); }
        void Exec(string sql) { using var k = new NpgsqlCommand(sql, c, tx); k.ExecuteNonQuery(); }
        var mat = Scalaire("SELECT min(mat_id) FROM materiel");
        if (mat is null or DBNull) return;
        var d1 = (long)Scalaire($"INSERT INTO document_ged (dge_titre, dge_cree_par, dge_type_element, dge_id_element) VALUES ('photo départ', 'test', 'materiel', '{mat}') RETURNING dge_id")!;
        var d2 = (long)Scalaire($"INSERT INTO document_ged (dge_titre, dge_cree_par, dge_type_element, dge_id_element) VALUES ('photo retour', 'test', 'materiel', '{mat}') RETURNING dge_id")!;
        Exec($"INSERT INTO materiel_affectation (maf_mat_id, maf_type, maf_ressource, maf_du, maf_ged_depart, maf_ged_retour) VALUES ({mat}, 'SALARIE', '999999', '2000-01-01', {d1}, {d2})");
        Assert.Equal(d1, (long)Scalaire("SELECT maf_ged_depart FROM materiel_affectation WHERE maf_ressource = '999999'")!);
        Exec($"UPDATE document_ged SET dge_supprime = TRUE WHERE dge_id = {d1}");
        Assert.IsType<DBNull>(Scalaire("SELECT coalesce(maf_ged_depart::text, NULL) FROM materiel_affectation WHERE maf_ressource = '999999'") ?? DBNull.Value);
        Assert.Equal(d2, (long)Scalaire("SELECT maf_ged_retour FROM materiel_affectation WHERE maf_ressource = '999999'")!);
        Exec($"DELETE FROM document_ged WHERE dge_id = {d2}");
        Assert.IsType<DBNull>(Scalaire("SELECT maf_ged_retour FROM materiel_affectation WHERE maf_ressource = '999999'"));
        tx.Rollback();
    }
}
