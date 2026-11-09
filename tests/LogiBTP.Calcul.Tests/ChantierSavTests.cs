using LogiBTP.Api.Btp;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Chantier « Entretien et dépannage » par le chrono des chantiers (plan terrain-suites, lot 24 ; TS24 a).</summary>
public class ChantierSavTests
{
    [Fact]
    public void Nouveau_client_code_du_chrono()
    {
        Assert.Equal("CH-2026-014", TerrainBtp.CodeChantierSav("CH-2026-014", 42));
        // Sans chrono des chantiers : code d'avant.
        Assert.Equal("SAV-42", TerrainBtp.CodeChantierSav(null, 42));
        Assert.Equal("SAV-42", TerrainBtp.CodeChantierSav(" ", 42));
    }

    [Fact]
    public void Chantier_retrouve_par_l_affaire_SAV_et_le_client_pas_par_son_code()
    {
        Assert.Contains("a.aff_code = 'SAV'", TerrainBtp.SqlChantierSavClient);
        Assert.Contains("c.cha_tiers_id = @p", TerrainBtp.SqlChantierSavClient);
        Assert.DoesNotContain("cha_code", TerrainBtp.SqlChantierSavClient);
    }

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG) : un client ayant déjà un chantier <c>SAV-&lt;client&gt;</c> dans
    /// l'affaire SAV le retrouve (réutilisé) ; un client sans chantier SAV n'en trouve aucun. Transaction annulée.
    /// </summary>
    [Fact]
    public void Client_ayant_deja_un_chantier_SAV_le_reutilise_sur_base()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        using var c = new NpgsqlConnection(connexion);
        c.Open();
        using var tx = c.BeginTransaction();
        object? Scalaire(string sql, params NpgsqlParameter[] p)
        {
            using var k = new NpgsqlCommand(sql, c, tx);
            k.Parameters.AddRange(p);
            return k.ExecuteScalar();
        }
        if (Scalaire("SELECT aff_id FROM affaire WHERE aff_code = 'SAV'") is not int) return;
        var clients = new List<long>();
        using (var k = new NpgsqlCommand("""
            SELECT p.per_id FROM personne p WHERE NOT EXISTS (SELECT 1 FROM chantier c JOIN affaire a ON a.aff_id = c.cha_aff_id WHERE a.aff_code = 'SAV' AND c.cha_tiers_id = p.per_id)
            ORDER BY p.per_id LIMIT 2
            """, c, tx))
        using (var r = k.ExecuteReader()) while (r.Read()) clients.Add(r.GetInt64(0));
        if (clients.Count < 2) return;
        var cree = Scalaire("""
            INSERT INTO chantier (cha_code, cha_libelle, cha_aff_id, cha_statut, cha_tiers_id)
            VALUES (@code, 'Entretien et dépannage – test', (SELECT aff_id FROM affaire WHERE aff_code = 'SAV'), 'OUVERT', @p) RETURNING cha_id
            """, new NpgsqlParameter("code", $"SAV-{clients[0]}"), new NpgsqlParameter("p", clients[0]));
        Assert.Equal(cree, Scalaire(TerrainBtp.SqlChantierSavClient, new NpgsqlParameter("p", clients[0])));
        Assert.Null(Scalaire(TerrainBtp.SqlChantierSavClient, new NpgsqlParameter("p", clients[1])));
        tx.Rollback();
    }
}
