using System.Text.Json;
using LogiBTP.Api.Btp;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>PV de réception : forme de signature et heure de l'appareil (plan terrain-suites, lot 13 ; TS13 a, TS16 a).</summary>
public class ReceptionAppareilTests
{
    private static readonly DateTimeOffset Serveur = new(2026, 11, 8, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Reception_en_ligne_une_seule_heure()
    {
        Assert.Null(TerrainBtp.HeureAppareil(null, Serveur));
    }

    [Fact]
    public void Reception_gardee_hors_ligne_garde_l_heure_de_l_appareil_en_utc()
    {
        var appareil = new DateTimeOffset(2026, 11, 8, 8, 30, 0, TimeSpan.FromHours(1));
        var h = TerrainBtp.HeureAppareil(appareil, Serveur);
        Assert.Equal(appareil, h);
        Assert.Equal(TimeSpan.Zero, h!.Value.Offset);
    }

    [Fact]
    public void Horloge_de_l_appareil_en_avance_ramenee_a_celle_du_serveur()
    {
        Assert.Equal(Serveur, TerrainBtp.HeureAppareil(Serveur.AddHours(2), Serveur));
    }

    private static string Racine()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "LogiBTP.slnx"))) d = d.Parent;
        return d!.FullName;
    }

    [Fact]
    public void Script_au_manifeste_et_pv_imprime_les_deux_heures()
    {
        Assert.Contains("db/289_reception_appareil.sql rejouable", File.ReadAllLines(Path.Combine(Racine(), "db/installation/scripts.txt")));
        var pv = File.ReadAllLines(Path.Combine(Racine(), "db/191_editions_modeles.sql")).First(l => l.StartsWith(" ('PV_RECEPTION'", StringComparison.Ordinal));
        Assert.Contains("signe_appareil_le", pv);
        Assert.Contains("recu_le", pv);
        Assert.Contains("Signature électronique simple", pv);
    }

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG) : script 289 rejoué deux fois ; source annexe du PV : réception gardée
    /// hors ligne avec les deux heures, réception en ligne avec l'heure du serveur seule. Transaction annulée.
    /// </summary>
    [Fact]
    public void Source_du_pv_rend_les_deux_heures()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        using var c = new NpgsqlConnection(connexion);
        c.Open();
        using var tx = c.BeginTransaction();
        object? Scalaire(string sql, params (string Nom, object Valeur)[] p)
        {
            using var k = new NpgsqlCommand(sql, c, tx);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            return k.ExecuteScalar();
        }
        var script = File.ReadAllText(Path.Combine(Racine(), "db/289_reception_appareil.sql"));
        Scalaire(script);
        Scalaire(script);
        var ordre = Scalaire("SELECT min(ent_id) FROM document");
        if (ordre is null or DBNull) return;
        JsonElement Reception(DateTimeOffset? appareil)
        {
            var sig = Scalaire("""
                INSERT INTO signature (sig_type_element, sig_id_element, sig_nom, sig_par, sig_le)
                VALUES ('document', @e::text, 'Client test', 'test', '2026-11-08 10:00:00+00') RETURNING sig_id
                """, ("e", ordre))!;
            using (var k = new NpgsqlCommand("""
                INSERT INTO reception_pose (rec_ent_id, rec_etat, rec_sig_id, rec_cree_par, rec_signee_appareil_le) VALUES (@e, 'SANS_RESERVE', @s, 'test', @a)
                """, c, tx))
            {
                k.Parameters.AddWithValue("e", ordre);
                k.Parameters.AddWithValue("s", sig);
                k.Parameters.Add(new NpgsqlParameter("a", NpgsqlTypes.NpgsqlDbType.TimestampTz) { Value = appareil is { } a ? a : DBNull.Value });
                k.ExecuteNonQuery();
            }
            return JsonDocument.Parse((string)Scalaire(SpecialisationEditionBtp.SqlSourceReception, ("id", ordre))!).RootElement;
        }
        var horsLigne = Reception(new DateTimeOffset(2026, 11, 8, 8, 30, 0, TimeSpan.Zero));
        Assert.Equal("08/11/2026 09:30", horsLigne.GetProperty("signe_appareil_le").GetString());
        Assert.Equal("08/11/2026 11:00", horsLigne.GetProperty("recu_le").GetString());
        var enLigne = Reception(null);
        Assert.Equal(JsonValueKind.Null, enLigne.GetProperty("signe_appareil_le").ValueKind);
        Assert.Equal("08/11/2026 11:00", enLigne.GetProperty("recu_le").GetString());
        tx.Rollback();
    }
}
