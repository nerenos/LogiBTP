using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Réserves suivies d'une réception de pose, base et serveur (plan terrain-suites, lot 14 ; TS14 a).</summary>
public class ReservesReceptionTests
{
    [Fact]
    public void Reception_avec_deux_reserves_les_range_une_par_une()
    {
        var r = TerrainBtp.ReservesSuivies("AVEC_RESERVES", [" Joint à reprendre ", "", "Plinthe rayée"]);
        Assert.Equal([((short)1, "Joint à reprendre"), ((short)2, "Plinthe rayée")], r);
    }

    [Fact]
    public void Reception_sans_reserve_ou_refusee_sans_reserve_suivie()
    {
        Assert.Empty(TerrainBtp.ReservesSuivies("SANS_RESERVE", ["x"]));
        Assert.Empty(TerrainBtp.ReservesSuivies("REFUSEE", ["x"]));
    }

    [Fact]
    public void Tache_du_crm_toujours_libellee_avec_les_reserves()
    {
        var l = TerrainBtp.LibelleTacheReserves("OP-12", ["Joint à reprendre", "Plinthe rayée"]);
        Assert.Contains("OP-12", l);
        Assert.Contains("Joint à reprendre ; Plinthe rayée", l);
    }

    private static string Racine()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "LogiBTP.slnx"))) d = d.Parent;
        return d!.FullName;
    }

    [Fact]
    public void Script_au_manifeste()
    {
        Assert.Contains("db/290_reception_reserves.sql rejouable", File.ReadAllLines(Path.Combine(Racine(), "db/installation/scripts.txt")));
    }

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG) : script 290 rejoué deux fois ; réception d'un ordre de pose avec deux
    /// réserves ; levée par une personne affectée à l'ordre (tâche du planning), levée rejouée sans effet, levée refusée
    /// à une personne sans tâche sur l'ordre. Transaction annulée.
    /// </summary>
    [Fact]
    public async Task Levee_par_une_personne_affectee_et_refusee_hors_perimetre()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        async Task<object?> Scalaire(string sql, params (string Nom, object Valeur)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c, tx);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            return await k.ExecuteScalarAsync();
        }
        var script = await File.ReadAllTextAsync(Path.Combine(Racine(), "db/290_reception_reserves.sql"));
        await Scalaire(script);
        await Scalaire(script);
        var ordre = await Scalaire("SELECT min(d.ent_id) FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE t.tyd_code = 'E_PO'");
        var comptes = new List<(int Salarie, string Compte)>();
        await using (var k = new NpgsqlCommand("""
            SELECT s.sal_id, i.ind_utilisateur FROM salarie s JOIN individu i ON i.ind_id = s.sal_ind_id
            WHERE s.sal_actif AND i.ind_utilisateur IS NOT NULL ORDER BY s.sal_id LIMIT 2
            """, c, tx))
        await using (var l = await k.ExecuteReaderAsync())
            while (await l.ReadAsync()) comptes.Add((l.GetInt32(0), l.GetString(1)));
        if (ordre is null or DBNull || comptes.Count < 2) return;
        var ent = (long)ordre;
        var (affecte, compte) = comptes[0];
        var tache = (long)(await Scalaire("""
            INSERT INTO pla_tache (tac_debut, tac_fin, tac_type_element, tac_id_element, tac_origine_type, tac_origine_id, tac_libelle, tac_cree_par)
            VALUES ('2099-01-05', '2099-01-10', 'document', @e::text, 'ordre', @e::text, 'test lot 14', 'test') RETURNING tac_id
            """, ("e", ent)))!;
        await Scalaire("INSERT INTO pla_affectation (aff_tac_id, aff_res_type, aff_res_id) VALUES (@t, 'SALARIE', @s::text)", ("t", tache), ("s", affecte));
        await Scalaire("""
            DELETE FROM pla_affectation a USING pla_tache t WHERE t.tac_id = a.aff_tac_id AND a.aff_res_type = 'SALARIE' AND a.aff_res_id = @s::text
              AND t.tac_origine_type = 'ordre' AND t.tac_origine_id = @e::text
            """, ("s", comptes[1].Salarie), ("e", ent));
        var rec = (long)(await Scalaire("""
            INSERT INTO reception_pose (rec_ent_id, rec_etat, rec_reserves, rec_cree_par) VALUES (@e, 'AVEC_RESERVES', '["Joint", "Plinthe"]', 'test') RETURNING rec_id
            """, ("e", ent)))!;

        await using var db = new LogiBtpContext(new DbContextOptionsBuilder<LogiBtpContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options);
        await db.Database.UseTransactionAsync(tx);
        await TerrainBtp.EcrireReservesAsync(db, rec, ent, TerrainBtp.ReservesSuivies("AVEC_RESERVES", ["Joint", "Plinthe"]), default);
        var ids = new List<long>();
        await using (var k = new NpgsqlCommand("SELECT rre_id FROM reception_reserve WHERE rre_rec_id = @r ORDER BY rre_ordre", c, tx))
        {
            k.Parameters.AddWithValue("r", rec);
            await using var l = await k.ExecuteReaderAsync();
            while (await l.ReadAsync()) ids.Add(l.GetInt64(0));
        }
        Assert.Equal(2, ids.Count);

        var personne = new Utilisateur(compte, "MOBILE");
        var (_, levee, ouvertes) = await TerrainBtp.LeverReserveAsync(db, personne, ent, ids[0], new LeveeReserve("Joint refait"), null, default);
        Assert.True(levee);
        Assert.Equal(1, ouvertes);
        Assert.Equal(EtatsReserve.Levee, await Scalaire("SELECT rre_etat FROM reception_reserve WHERE rre_id = @r", ("r", ids[0])));
        Assert.Equal(compte, await Scalaire("SELECT rre_levee_par FROM reception_reserve WHERE rre_id = @r", ("r", ids[0])));
        var rejouee = await TerrainBtp.LeverReserveAsync(db, personne, ent, ids[0], new LeveeReserve("autre"), null, default);
        Assert.False(rejouee.Levee);
        Assert.Equal("Joint refait", await Scalaire("SELECT rre_levee_commentaire FROM reception_reserve WHERE rre_id = @r", ("r", ids[0])));

        await Assert.ThrowsAsync<ExceptionMetier>(() =>
            TerrainBtp.LeverReserveAsync(db, new Utilisateur(comptes[1].Compte, "MOBILE"), ent, ids[1], new LeveeReserve(null), null, default));
        Assert.Equal(EtatsReserve.Ouverte, await Scalaire("SELECT rre_etat FROM reception_reserve WHERE rre_id = @r", ("r", ids[1])));
        await tx.RollbackAsync();
    }
}
