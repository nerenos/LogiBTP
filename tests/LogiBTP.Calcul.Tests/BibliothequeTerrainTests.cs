using System.Text.Json;
using LogiBTP.Api.Btp;
using LogiBTP.Droits.Web;
using LogiBTP.Socle;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Bibliothèque simplifiée du terrain, serveur (plan terrain-suites, lot 17 ; TS17 b, TS15 a).</summary>
public class BibliothequeTerrainTests
{
    private static readonly string[] ColonnesPrix =
        ["ele_pa", "ele_pmp", "ele_dernier_pa", "ele_pr", "ele_pv", "ele_coef", "ele_scenario", "tfo_", "tarif_fournisseur", "prix"];

    [Fact]
    public void Aucun_prix_dans_la_fiche_ni_dans_les_requetes()
    {
        foreach (var sql in new[] { TerrainBtp.SqlFicheArticle, TerrainBtp.SqlArticlesChantier, TerrainBtp.SqlRechercheArticles(3) })
            foreach (var c in ColonnesPrix) Assert.DoesNotContain(c, sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Recherche_mot_par_mot_echappee_et_bornee()
    {
        Assert.Equal(["%vis%", "%6\\_x%", "%50\\%%"], TerrainBtp.MotsRecherche("  vis 6_x  50% "));
        Assert.Empty(TerrainBtp.MotsRecherche(null));
        Assert.Equal(5, TerrainBtp.MotsRecherche("a b c d e f g").Count);
        var sql = TerrainBtp.SqlRechercheArticles(2);
        Assert.Contains("@m0", sql);
        Assert.Contains("@m1", sql);
        Assert.DoesNotContain("@m2", sql);
        Assert.Contains("e.ele_type = 'ARTICLE'", sql);
    }

    [Fact]
    public void Route_sous_le_droit_de_consulter_les_demandes()
    {
        var r = Assert.Single(new SpecialisationDroitsBtp().Routes, x => x.Prefixe == "/api/terrain/bibliotheque");
        Assert.Equal(ModeRoute.Action, r.Mode);
        Assert.Equal("terrain/demande", r.Noeud);
        Assert.Equal(ActionsDroits.Consulter, r.Action);
    }

    /// <summary>
    /// Base de développement (LOGIBTP_TEST_PG) : un article porté par une ligne d'une commande validée d'un marché est
    /// rendu dans les articles du chantier et trouvé par son code ; fiche sans prix. Transaction annulée.
    /// </summary>
    [Fact]
    public void Articles_du_chantier_et_recherche_sur_base()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        using var c = new NpgsqlConnection(connexion);
        c.Open();
        using var tx = c.BeginTransaction();
        int chantier;
        long article;
        string code;
        using (var k = new NpgsqlCommand("""
            SELECT m.mar_cha_id, e.ele_id, e.ele_code FROM marche m
            JOIN marche_document md ON md.mdo_mar_id = m.mar_id
            JOIN v_document_valable vd ON vd.ent_id = md.mdo_ent_id AND NOT vd.annule
            JOIN document_ligne l ON l.lig_ent_id = md.mdo_ent_id
            JOIN element e ON e.ele_id = l.lig_art_id AND e.ele_actif AND e.ele_type = 'ARTICLE'
            LIMIT 1
            """, c, tx))
        using (var r = k.ExecuteReader())
        {
            if (!r.Read()) return;
            chantier = r.GetInt32(0);
            article = r.GetInt64(1);
            code = r.GetString(2);
        }
        List<JsonElement> Lire(string sql, params NpgsqlParameter[] p)
        {
            using var k = new NpgsqlCommand(sql, c, tx);
            k.Parameters.AddRange(p);
            using var r = k.ExecuteReader();
            var res = new List<JsonElement>();
            while (r.Read()) res.Add(JsonDocument.Parse(r.GetString(0)).RootElement.Clone());
            return res;
        }
        var duChantier = Lire(TerrainBtp.SqlArticlesChantier, new NpgsqlParameter("c", chantier));
        var fiche = Assert.Single(duChantier, x => x.GetProperty("id").GetInt64() == article);
        foreach (var p in fiche.EnumerateObject()) Assert.DoesNotContain("prix", p.Name);
        Assert.Equal(JsonValueKind.Array, fiche.GetProperty("notices").ValueKind);
        var mots = TerrainBtp.MotsRecherche(code);
        var trouves = Lire(TerrainBtp.SqlRechercheArticles(mots.Count), [.. mots.Select((m, i) => new NpgsqlParameter($"m{i}", m))]);
        Assert.Contains(trouves, x => x.GetProperty("id").GetInt64() == article);
        tx.Rollback();
    }
}
