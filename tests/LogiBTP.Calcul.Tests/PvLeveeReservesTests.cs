using System.Text.Json;
using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Editions;
using LogiBTP.Editions.Web;
using LogiBTP.Ged;
using LogiBTP.Ged.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>PV de levée des réserves signé (plan terrain-suites, lot 16 ; TS14 a).</summary>
public class PvLeveeReservesTests
{
    [Fact]
    public void Pv_attendu_a_la_derniere_levee_seulement()
    {
        Assert.False(TerrainBtp.PvLeveeAttendu(1, 1));
        Assert.True(TerrainBtp.PvLeveeAttendu(0, 2));
        Assert.False(TerrainBtp.PvLeveeAttendu(0, 0));
    }

    private static string Racine()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "LogiBTP.slnx"))) d = d.Parent;
        return d!.FullName;
    }

    [Fact]
    public void Script_au_manifeste_et_modele_fourni()
    {
        Assert.Contains("db/291_reception_levee.sql rejouable", File.ReadAllLines(Path.Combine(Racine(), "db/installation/scripts.txt")));
        var sql = File.ReadAllText(Path.Combine(Racine(), "db/191_editions_modeles.sql"));
        Assert.Contains($" ('{TerrainBtp.ModelePvLevee}', 'Procès-verbal de levée des réserves'", sql);
        Assert.Contains($" ('{TerrainBtp.ModelePvLevee}', 'RESSOURCE', '{SpecialisationEditionBtp.CodeSignatureLevee}')", sql);
    }

    private const string Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG) : scripts 290, 291 (deux fois) et 191 rejoués ; réception de deux réserves,
    /// PV refusé tant qu'une réserve est ouverte, puis produit à la dernière levée : PV rangé dans la GED de l'ordre,
    /// empreinte enregistrée avec la signature, réserves couvertes, source annexe du PV. Transaction annulée.
    /// </summary>
    [Fact]
    public async Task Pv_produit_a_la_derniere_levee_avec_son_empreinte()
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
        foreach (var script in new[] { "db/290_reception_reserves.sql", "db/291_reception_levee.sql", "db/291_reception_levee.sql", "db/191_editions_modeles.sql" })
            await Scalaire(await File.ReadAllTextAsync(Path.Combine(Racine(), script)));
        var ordre = await Scalaire("SELECT min(d.ent_id) FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE t.tyd_code = 'E_PO'");
        var compte = new List<(int Salarie, string Compte)>();
        await using (var k = new NpgsqlCommand("""
            SELECT s.sal_id, i.ind_utilisateur FROM salarie s JOIN individu i ON i.ind_id = s.sal_ind_id
            WHERE s.sal_actif AND i.ind_utilisateur IS NOT NULL ORDER BY s.sal_id LIMIT 1
            """, c, tx))
        await using (var l = await k.ExecuteReaderAsync())
            while (await l.ReadAsync()) compte.Add((l.GetInt32(0), l.GetString(1)));
        if (ordre is null or DBNull || compte.Count == 0) return;
        var ent = (long)ordre;
        var tache = (long)(await Scalaire("""
            INSERT INTO pla_tache (tac_debut, tac_fin, tac_type_element, tac_id_element, tac_origine_type, tac_origine_id, tac_libelle, tac_cree_par)
            VALUES ('2099-01-05', '2099-01-10', 'document', @e::text, 'ordre', @e::text, 'test lot 16', 'test') RETURNING tac_id
            """, ("e", ent)))!;
        await Scalaire("INSERT INTO pla_affectation (aff_tac_id, aff_res_type, aff_res_id) VALUES (@t, 'SALARIE', @s::text)", ("t", tache), ("s", compte[0].Salarie));
        // Réserves antérieures de l'ordre (base de développement) levées et couvertes : seules celles du test comptent.
        await Scalaire("UPDATE reception_reserve SET rre_etat = 'LEVEE', rre_levee_le = now(), rre_levee_par = 'test' WHERE rre_ent_id = @e AND rre_etat = 'OUVERTE'", ("e", ent));
        var ancien = (long)(await Scalaire("INSERT INTO reception_levee (rlv_ent_id, rlv_cree_par) VALUES (@e, 'test') RETURNING rlv_id", ("e", ent)))!;
        await Scalaire("UPDATE reception_reserve SET rre_rlv_id = @l WHERE rre_ent_id = @e AND rre_rlv_id IS NULL", ("l", ancien), ("e", ent));
        var rec = (long)(await Scalaire("""
            INSERT INTO reception_pose (rec_ent_id, rec_etat, rec_reserves, rec_cree_par) VALUES (@e, 'AVEC_RESERVES', '["Joint", "Plinthe"]', 'test') RETURNING rec_id
            """, ("e", ent)))!;

        DbContextOptions<T> Options<T>() where T : DbContext => new DbContextOptionsBuilder<T>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new LogiBtpContext(Options<LogiBtpContext>());
        await db.Database.UseTransactionAsync(tx);
        await using var editionDb = new EditionDbContext(Options<EditionDbContext>());
        await editionDb.Database.UseTransactionAsync(tx);
        await using var gedDb = new GedDbContext(Options<GedDbContext>());
        await gedDb.Database.UseTransactionAsync(tx);
        using var pool = new PoolMoteursEdition(1);
        var specialisationEdition = new SpecialisationEditionBtp();
        var sc = new ServiceCollection();
        sc.AddSingleton(db).AddSingleton(editionDb).AddSingleton(gedDb).AddSingleton(pool).AddSingleton<SpecialisationEdition>(specialisationEdition)
            .AddSingleton(new ServiceEdition(editionDb, specialisationEdition, pool))
            .AddSingleton(new ServiceGed(gedDb, new SpecialisationGed(), new StockageGed(Path.Combine(Path.GetTempPath(), "logibtp-levee-" + Guid.NewGuid().ToString("N")))));
        await using var services = sc.BuildServiceProvider();

        await TerrainBtp.EcrireReservesAsync(db, rec, ent, TerrainBtp.ReservesSuivies("AVEC_RESERVES", ["Joint", "Plinthe"]), default);
        var ids = new List<long>();
        await using (var k = new NpgsqlCommand("SELECT rre_id FROM reception_reserve WHERE rre_rec_id = @r ORDER BY rre_ordre", c, tx))
        {
            k.Parameters.AddWithValue("r", rec);
            await using var l = await k.ExecuteReaderAsync();
            while (await l.ReadAsync()) ids.Add(l.GetInt64(0));
        }
        var personne = new Utilisateur(compte[0].Compte, "MOBILE");
        var saisie = new PvLeveeSaisie("Client test", "Client", Png, null, new DateTimeOffset(2026, 11, 8, 8, 30, 0, TimeSpan.Zero));

        await TerrainBtp.LeverReserveAsync(db, personne, ent, ids[0], new LeveeReserve("Joint refait"), null, default);
        var refus = await Assert.ThrowsAsync<ExceptionMetier>(() => TerrainBtp.SignerPvLeveeAsync(services, db, personne, ent, saisie, default));
        Assert.Equal("TERRAIN_RESERVES_OUVERTES", refus.Code);

        var (_, _, ouvertes) = await TerrainBtp.LeverReserveAsync(db, personne, ent, ids[1], new LeveeReserve(null), null, default);
        Assert.Equal(0, ouvertes);
        var (_, avertissements) = await TerrainBtp.SignerPvLeveeAsync(services, db, personne, ent, saisie, default);
        Assert.Empty(avertissements);
        var rlv = (long)(await Scalaire("SELECT max(rlv_id) FROM reception_levee WHERE rlv_ent_id = @e", ("e", ent)))!;
        Assert.NotEqual(DBNull.Value, await Scalaire("SELECT rlv_dge_id FROM reception_levee WHERE rlv_id = @l", ("l", rlv)));
        var empreinte = (string)(await Scalaire("SELECT s.sig_empreinte FROM reception_levee l JOIN signature s ON s.sig_id = l.rlv_sig_id WHERE l.rlv_id = @l", ("l", rlv)))!;
        Assert.Equal(64, empreinte.Length);
        Assert.Equal(2L, await Scalaire("SELECT count(*) FROM reception_reserve WHERE rre_rlv_id = @l", ("l", rlv)));

        var source = JsonDocument.Parse((string)(await Scalaire(SpecialisationEditionBtp.SqlSourceLevee, ("id", ent)))!).RootElement;
        Assert.Equal(2, source.GetProperty("reserves").GetArrayLength());
        Assert.Equal("08/11/2026 09:30", source.GetProperty("signe_appareil_le").GetString());
        await Assert.ThrowsAsync<ExceptionMetier>(() => TerrainBtp.SignerPvLeveeAsync(services, db, personne, ent, saisie, default));
        await tx.RollbackAsync();
    }
}
