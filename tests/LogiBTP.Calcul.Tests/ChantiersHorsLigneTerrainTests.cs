using LogiBTP.Api.Btp;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Chantiers et ordres gardés hors ligne pour la saisie libre (plan terrain-suites, lot 9 ; TS10 b, TS11 b).</summary>
public class ChantiersHorsLigneTerrainTests
{
    [Fact]
    public void Perimetre_service_principal_sinon_planning()
    {
        Assert.Equal(TerrainBtp.PerimetreService, TerrainBtp.PerimetreHorsLigne(5));
        Assert.Equal(TerrainBtp.PerimetrePlanning, TerrainBtp.PerimetreHorsLigne(null));
    }

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG) : chantier ouvert portant un ordre en vigueur d'un service proposé aux
    /// membres de ce service, pas aux autres (hors leur planning) ; transaction annulée.
    /// </summary>
    [Fact]
    public void Perimetre_du_service_sur_base()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        using var c = new NpgsqlConnection(connexion);
        c.Open();
        using var tx = c.BeginTransaction();
        var ordre = new NpgsqlCommand($"""
            SELECT d.ent_chantier_id, d.ent_srv_id FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            JOIN chantier c ON c.cha_id = d.ent_chantier_id
            WHERE t.tyd_famille = 'E' AND d.ent_is_reference AND d.ent_srv_id IS NOT NULL AND c.cha_statut = 'OUVERT' AND NOT c.cha_interne
              AND s.std_code NOT IN ({SqlBtp.HorsVigueur}) AND coalesce(d.ent_exe_etat, '') <> 'TERMINE' LIMIT 1
            """, c, tx);
        int chantier, service;
        using (var r = ordre.ExecuteReader())
        {
            if (!r.Read()) return;
            chantier = r.GetInt32(0);
            service = r.GetInt32(1);
        }
        List<int> Chantiers(int? srv)
        {
            using var k = new NpgsqlCommand(TerrainBtp.SqlChantiersHorsLigne, c, tx);
            k.Parameters.AddWithValue("s", -1);
            k.Parameters.Add(new NpgsqlParameter("srv", NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)srv ?? DBNull.Value });
            using var r = k.ExecuteReader();
            var ids = new List<int>();
            while (r.Read()) ids.Add(r.GetInt32(0));
            return ids;
        }
        Assert.Contains(chantier, Chantiers(service));
        Assert.DoesNotContain(chantier, Chantiers(null));
        tx.Rollback();
    }
}
