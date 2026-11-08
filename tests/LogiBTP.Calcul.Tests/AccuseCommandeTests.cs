using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Mail.Web;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Rapprochement d'un accusé de réception reçu par courriel et d'une commande (plan ar-courriel, lot 3).</summary>
public class AccuseCommandeTests
{
    private static ElementTrouve Cmd(long id) => new("document", id.ToString(), $"Commande {id}", $"/document/{id}");

    [Fact]
    public void Numero_trouve_donne_le_rattachement()
    {
        var r = AccuseCommandeBtp.Resoudre([Cmd(7)]);
        Assert.Equal("7", r!.Rattache!.Id);
        Assert.Empty(r.Candidats);
    }

    [Fact]
    public void Numero_introuvable_ne_donne_rien()
    {
        Assert.Null(AccuseCommandeBtp.Resoudre([]));
    }

    [Fact]
    public void Deux_candidates_sont_proposees_sans_rattachement()
    {
        var r = AccuseCommandeBtp.Resoudre([Cmd(7), Cmd(8)]);
        Assert.Null(r!.Rattache);
        Assert.Equal(["7", "8"], r.Candidats.Select(c => c.Id));
    }

    [Fact]
    public void Les_numeros_sont_compares_sans_separateur_ni_casse()
    {
        Assert.Equal(["CF202600042", "CF42"], AccuseCommandeBtp.Comparables(["cf2026-00042", "CF/42", "CF 42", "-"]));
    }

    /// <summary>Base de développement (LOGIBTP_TEST_PG) : commande valable trouvée par son numéro ; annulée ou remplacée ignorée. Transaction annulée.</summary>
    [Fact]
    public void Seules_les_commandes_valables_non_annulees_sont_trouvees()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        using var c = new NpgsqlConnection(connexion);
        c.Open();
        using var tx = c.BeginTransaction();
        object? Scalaire(string sql) { using var k = new NpgsqlCommand(sql, c, tx); return k.ExecuteScalar(); }
        var type = Scalaire($"SELECT tyd_id FROM type_document WHERE tyd_code = '{TypesDocument.ACommande}'");
        var statut = Scalaire("SELECT min(std_id) FROM statut_document WHERE std_code NOT IN ('ANNULE', 'REMPLACE')");
        var annule = Scalaire("SELECT std_id FROM statut_document WHERE std_code = 'ANNULE' LIMIT 1");
        var remplace = Scalaire("SELECT std_id FROM statut_document WHERE std_code = 'REMPLACE' LIMIT 1");
        if (type is null or DBNull || statut is null or DBNull || annule is null or DBNull || remplace is null or DBNull) return;
        long Creer(string numero, object std)
        {
            using var k = new NpgsqlCommand("INSERT INTO document (ent_tyd_id, ent_std_id, ent_numero, ent_date, ent_cree_par, ent_verrouille, ent_is_reference) VALUES (@t, @s, @n, CURRENT_DATE, 'test', TRUE, TRUE) RETURNING ent_id", c, tx);
            k.Parameters.AddWithValue("t", type); k.Parameters.AddWithValue("s", std); k.Parameters.AddWithValue("n", numero);
            return (long)k.ExecuteScalar()!;
        }
        var valable = Creer("CFZZ2026-00001", statut);
        Creer("CFZZ2026-00002", annule);
        Creer("CFZZ2026-00003", remplace);
        using var q = new NpgsqlCommand(AccuseCommandeBtp.SqlCommandes, c, tx);
        q.Parameters.AddWithValue("types", TypesDocument.Arc);
        q.Parameters.AddWithValue("numeros", AccuseCommandeBtp.Comparables(["CFZZ2026-00001", "CFZZ2026/00002", "CFZZ2026-00003"]));
        using var lecteur = q.ExecuteReader();
        Assert.True(lecteur.Read());
        Assert.Equal(valable, lecteur.GetInt64(0));
        Assert.False(lecteur.Read());
        lecteur.Close();
        tx.Rollback();
    }
}
