using LogiBTP.Api.Btp;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Intervention SAV créée hors ligne, création idempotente par l'identifiant de l'appareil (plan terrain-suites, lot 23 ; TS23 a).</summary>
public class CreationSavHorsLigneTests
{
    [Fact]
    public void Identifiant_de_l_appareil_retenu_une_fois_et_propre_a_la_personne()
    {
        Assert.Contains("ON CONFLICT (isa_appareil) DO NOTHING", TerrainBtp.SqlRetenirAppareil);
        Assert.Contains("isa_cree_par = @u", TerrainBtp.SqlInterventionAppareil);
        Assert.Contains("isa_appareil = @a", TerrainBtp.SqlInterventionAppareil);
    }

    [Fact]
    public void Creation_hors_ligne_lue_dans_le_corps()
    {
        var c = System.Text.Json.JsonSerializer.Deserialize<InterventionSavCreee>("""{"cha_id":4,"objet":"Fuite","appareil":"0b6f2c1e-6a8d-4f3e-9a51-2f6a0c1d9e77"}""",
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = true })!;
        Assert.Equal(Guid.Parse("0b6f2c1e-6a8d-4f3e-9a51-2f6a0c1d9e77"), c.Appareil);
        Assert.Null(System.Text.Json.JsonSerializer.Deserialize<InterventionSavCreee>("""{"cha_id":4,"objet":"Fuite"}""",
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower })!.Appareil);
    }

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG, db/294 appliqué) : renvoi en double sans doublon — le second envoi retrouve
    /// l'ordre du premier, l'identifiant n'est retenu qu'une fois. Transaction annulée.
    /// </summary>
    [Fact]
    public void Renvoi_en_double_sans_doublon_sur_base()
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
        if (Scalaire("SELECT to_regclass('intervention_sav_appareil') IS NOT NULL") is not true) return;
        var ordres = new List<long>();
        using (var k = new NpgsqlCommand("SELECT ent_id FROM document ORDER BY ent_id LIMIT 2", c, tx))
        using (var r = k.ExecuteReader()) while (r.Read()) ordres.Add(r.GetInt64(0));
        if (ordres.Count < 2) return;
        var appareil = Guid.NewGuid();
        NpgsqlParameter[] P(long e) => [new("a", appareil), new("e", e), new("u", "test-lot-23")];
        Scalaire(TerrainBtp.SqlRetenirAppareil, P(ordres[0]));
        Scalaire(TerrainBtp.SqlRetenirAppareil, P(ordres[1]));
        Assert.Equal(1L, Scalaire("SELECT count(*) FROM intervention_sav_appareil WHERE isa_appareil = @a", new NpgsqlParameter("a", appareil)));
        Assert.Equal(ordres[0], Scalaire(TerrainBtp.SqlInterventionAppareil, new NpgsqlParameter("a", appareil), new NpgsqlParameter("u", "test-lot-23")));
        Assert.Null(Scalaire(TerrainBtp.SqlInterventionAppareil, new NpgsqlParameter("a", appareil), new NpgsqlParameter("u", "autre")));
        tx.Rollback();
    }
}
