using LogiBTP.Api.Btp;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Pointage du terrain à la ligne d'ordre (plan terrain-suites, lot 7 ; TS5 a, TS6 a).</summary>
public class PointageLigneTerrainTests
{
    [Fact]
    public void Tache_d_origine_ligne_pointee_sur_son_document_porte_la_ligne()
    {
        Assert.Equal(42L, TerrainBtp.LigneDuPointage(42, 7, 7));
    }

    [Fact]
    public void Tache_d_origine_ordre_inchangee()
    {
        Assert.Null(TerrainBtp.LigneDuPointage(null, 7, 7));
        Assert.Null(TerrainBtp.LigneDuPointage(null, null, null));
    }

    [Fact]
    public void Pointage_deplace_sur_un_autre_ordre_ou_au_chantier_sans_ligne()
    {
        Assert.Null(TerrainBtp.LigneDuPointage(42, 7, 8));
        Assert.Null(TerrainBtp.LigneDuPointage(42, 7, null));
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
        Assert.Contains("db/288_pointage_ligne_terrain.sql", File.ReadAllLines(Path.Combine(Racine(), "db/installation/scripts.txt")));
    }

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG) : reprise du script 288, rejouée deux fois ; pointage d'une journée
    /// validée et pointage d'une tâche d'origine ordre inchangés. Transaction annulée.
    /// </summary>
    [Fact]
    public void Reprise_renseigne_la_ligne_et_saute_les_journees_validees()
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
        var salarie = Scalaire("SELECT min(sal_id) FROM salarie");
        var nature = Scalaire("SELECT min(nat_id) FROM nature_element WHERE nat_rgn_code = 'MO'");
        var ligne = Scalaire("""
            SELECT min(l.lig_id) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id
            WHERE coalesce(l.lig_cha_id, d.ent_chantier_id) IS NOT NULL
            """);
        if (salarie is null or DBNull || nature is null or DBNull || ligne is null or DBNull) return;
        var document = Scalaire("SELECT lig_ent_id FROM document_ligne WHERE lig_id = @l", ("l", ligne))!;
        var chantier = Scalaire("SELECT coalesce(l.lig_cha_id, d.ent_chantier_id) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE l.lig_id = @l", ("l", ligne))!;
        long Tache(string origine, string id) => (long)Scalaire("""
            INSERT INTO pla_tache (tac_debut, tac_fin, tac_type_element, tac_id_element, tac_origine_type, tac_origine_id, tac_libelle, tac_cree_par)
            VALUES ('2099-01-05', '2099-01-10', 'chantier', @c::text, @o, @i, 'test lot 7', 'test') RETURNING tac_id
            """, ("c", chantier), ("o", origine), ("i", id))!;
        long Pointage(long tache, DateOnly jour) => (long)Scalaire("""
            INSERT INTO poi_pointage (poi_sal_id, poi_date, poi_cha_id, poi_type_mo, poi_minutes, poi_tac_id, poi_saisi_par)
            VALUES (@s, @d, @c, @n, 60, @t, 'test') RETURNING poi_id
            """, ("s", salarie), ("d", jour), ("c", chantier), ("n", nature), ("t", tache))!;
        var tacheLigne = Tache("ligne", ligne.ToString()!);
        var tacheOrdre = Tache("ordre", document.ToString()!);
        var valide = Pointage(tacheLigne, new DateOnly(2099, 1, 5));
        var libre = Pointage(tacheLigne, new DateOnly(2099, 1, 6));
        var ordre = Pointage(tacheOrdre, new DateOnly(2099, 1, 6));
        Scalaire("INSERT INTO poi_validation (pvl_sal_id, pvl_du, pvl_au, pvl_niveau, pvl_par) VALUES (@s, '2099-01-05', '2099-01-05', 'CHEF', 'test')", ("s", salarie));

        var script = File.ReadAllText(Path.Combine(Racine(), "db/288_pointage_ligne_terrain.sql"));
        Scalaire(script);
        Scalaire(script);

        Assert.Equal(ligne, Scalaire("SELECT poi_lig_id FROM poi_pointage WHERE poi_id = @p", ("p", libre)));
        Assert.Equal(document, Scalaire("SELECT poi_ent_id FROM poi_pointage WHERE poi_id = @p", ("p", libre)));
        Assert.Equal(DBNull.Value, Scalaire("SELECT poi_lig_id FROM poi_pointage WHERE poi_id = @p", ("p", valide)));
        Assert.Equal(DBNull.Value, Scalaire("SELECT poi_lig_id FROM poi_pointage WHERE poi_id = @p", ("p", ordre)));
        Assert.Equal(ligne, Scalaire("SELECT lig_id FROM v_pointages_retenus WHERE poi_id = @p", ("p", libre)));
        tx.Rollback();
    }
}
