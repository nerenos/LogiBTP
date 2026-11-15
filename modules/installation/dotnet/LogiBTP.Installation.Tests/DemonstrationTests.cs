using LogiBTP.Installation;
using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Installation.Tests;

/// <summary>
/// Données de démonstration séparées (plan versionnement-schema, lot 2) : indicateur « demo » du manifeste, scripts extraits,
/// empreintes acceptées ; intégration (LOGIBTP_TEST_PG_ADMIN) : base sans démonstration, mise à jour, ancien journal accepté.
/// </summary>
// Collection commune : les essais sur une vraie base ne se jouent pas en parallèle (la charge fait varier des données tirées au hasard
// par des scripts de démonstration d'avant le lot, ce que compare ScriptsBaseTests).
[Collection("PostgreSQL")]
public class DemonstrationTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");

    // ---------------------------------------------------------------- manifeste

    [Fact]
    public void Indicateur_demo_seul_ou_combine_et_extrait_de()
    {
        var m = ManifesteScripts.Analyser(["db/a.sql", "db/b.sql demo", "db/c.sql demo rejouable", "db/d.sql demo extrait-de=db/e.sql", "db/e.sql"]);
        Assert.Equal(
            [new ScriptManifeste("db/a.sql", false), new ScriptManifeste("db/b.sql", false, false, true), new ScriptManifeste("db/c.sql", true, false, true),
             new ScriptManifeste("db/d.sql", false, false, true, "db/e.sql"), new ScriptManifeste("db/e.sql", false)], m.Scripts);
        Assert.Equal(["db/a.sql", "db/e.sql"], m.Retenus(false).Select(s => s.Chemin));
        Assert.Equal(5, m.Retenus(true).Count);
    }

    [Theory]
    [InlineData("db/a.sql extrait-de=db/inconnu.sql")]
    [InlineData("db/a.sql extrait-de=")]
    [InlineData("db/a.sql extrait-de=db/b.sql extrait-de=db/c.sql")]
    [InlineData("db/a.sql demo-x")]
    public void Indicateur_invalide_refuse(string ligne) =>
        Assert.Throws<FormatException>(() => ManifesteScripts.Analyser([ligne, "db/b.sql", "db/c.sql"]));

    [Fact]
    public void Scripts_de_demonstration_du_depot_marques_et_references_hors_demonstration_extraits()
    {
        var m = ManifesteScripts.Lire(CasPartages.RacineDepot());
        var demo = m.Scripts.Where(s => s.Demo).Select(s => s.Chemin).ToHashSet();
        foreach (var chemin in new[]
        {
            "db/116_bibliotheque_demo.sql", "db/120b_listes_demo.sql", "db/141_annuaire_demo.sql", "db/142_annuaire_salaries.sql", "db/161_structure_demo.sql",
            "db/163_intervenants_demo.sql", "db/196b_calendriers_demo.sql", "db/210b_sous_traitants_demo.sql", "db/235b_materiel_plans_demo.sql",
        })
            Assert.Contains(chemin, demo);
        // Les référentiels dont dépendent les scripts suivants restent hors démonstration.
        foreach (var chemin in new[] { "db/115b_natures_reference.sql", "db/140b_annuaire_reference.sql", "db/120_listes.sql", "db/211_sous_traitance_marches.sql" })
            Assert.DoesNotContain(chemin, demo);
        // Un script extrait d'un autre le suit ou le précède de près dans le manifeste, jamais à l'autre bout.
        foreach (var s in m.Scripts.Where(s => s.ExtraitDe is not null))
            Assert.True(Math.Abs(m.Scripts.ToList().FindIndex(x => x.Chemin == s.Chemin) - m.Scripts.ToList().FindIndex(x => x.Chemin == s.ExtraitDe)) <= 2, s.Chemin);
    }

    // ---------------------------------------------------------------- empreintes acceptées

    private static readonly string Sha = new('a', 64);

    [Fact]
    public void Empreintes_acceptees_lues_et_testees()
    {
        var e = EmpreintesAcceptees.Analyser(["# commentaire", "", $"db/a.sql {Sha}  # réduit : partie extraite", $"db/b.sql {new string('b', 64)}\t# autre"]);
        Assert.Equal(2, e.Lignes.Count);
        Assert.Equal("réduit : partie extraite", e.Lignes[0].Raison);
        Assert.True(e.Accepte("db/a.sql", Sha));
        Assert.False(e.Accepte("db/a.sql", new string('c', 64)));
        Assert.False(e.Accepte("db/b.sql", Sha));
        Assert.False(EmpreintesAcceptees.Aucune.Accepte("db/a.sql", Sha));
    }

    [Theory]
    [InlineData("db/a.sql")]
    [InlineData("db/a.sql abc  # trop court")]
    [InlineData("db/a.sql AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  # majuscules")]
    [InlineData("db/a.sql aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("a.txt aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  # chemin")]
    public void Empreinte_acceptee_invalide_refusee(string ligne) => Assert.Throws<FormatException>(() => EmpreintesAcceptees.Analyser([ligne]));

    [Fact]
    public void Empreintes_acceptees_du_depot_portent_sur_des_scripts_du_manifeste_et_ne_sont_pas_la_version_actuelle()
    {
        var racine = CasPartages.RacineDepot();
        var m = ManifesteScripts.Lire(racine);
        var e = EmpreintesAcceptees.Lire(racine);
        Assert.NotEmpty(e.Lignes);
        foreach (var l in e.Lignes)
        {
            Assert.Contains(m.Scripts, s => s.Chemin == l.Chemin);
            Assert.NotEqual(BaseDonnees.Empreinte(File.ReadAllText(Path.Combine(racine, l.Chemin))), l.Empreinte); // une ancienne version, pas l'actuelle
        }
        // Toute extraction d'un script déjà publié est accompagnée de l'ancienne empreinte de celui-ci.
        foreach (var source in m.Scripts.Where(s => s.ExtraitDe is not null).Select(s => s.ExtraitDe!).Distinct())
            Assert.Contains(e.Lignes, l => l.Chemin == source);
    }

    [Fact]
    public void Empreinte_normalise_les_fins_de_ligne() =>
        Assert.Equal(BaseDonnees.Empreinte("a\nb\n"), BaseDonnees.Empreinte("a\r\nb\r\n"));

    // ---------------------------------------------------------------- intégration

    private static async Task<long> CompterAsync(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    [Fact]
    public async Task Base_sans_demonstration_sans_tiers_chantier_ni_salarie_fictif_et_avec_ses_referentiels()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var m = ManifesteScripts.Lire(racine);
        await using var a = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        var bilan = await new BaseDonnees(TextWriter.Null).AppliquerAsync(a.Connexion, racine, m.Retenus(false), acceptees: EmpreintesAcceptees.Lire(racine));
        Assert.Equal(m.Retenus(false).Where(s => !s.Rejouable).Select(s => s.Chemin).Distinct().Count(), bilan.Appliques);
        Assert.Empty(bilan.Modifies);
        Assert.Empty(bilan.AcceptesOuVide);
        Assert.False(await BaseDonnees.ADeLaDemoAsync(a.Connexion, m.Scripts));
        var journal = (await BaseDonnees.ScriptsAppliquesAsync(a.Connexion)).Select(s => s.Chemin).ToHashSet();
        Assert.DoesNotContain(m.Scripts.Where(s => s.Demo), s => journal.Contains(s.Chemin));

        foreach (var table in new[] { "personne", "individu", "rattachement", "coordonnee", "salarie", "materiel", "equipe", "projet", "marche", "intervenant",
                                      "bibliotheque", "element", "tarif_fournisseur", "habilitation", "materiel_plan", "demo_sous_traitant" })
            if (table != "demo_sous_traitant") Assert.Equal(0L, await CompterAsync(a.Connexion, $"SELECT count(*) FROM {table}"));
        Assert.Equal(0L, await CompterAsync(a.Connexion, "SELECT count(*) FROM chantier WHERE cha_code NOT LIKE 'INT-%'"));
        Assert.Equal(0L, await CompterAsync(a.Connexion, "SELECT count(*) FROM affaire WHERE aff_nature <> 'G'"));
        Assert.Equal(0L, await CompterAsync(a.Connexion, "SELECT count(*) FROM jour_ferme WHERE jfe_maj_par = 'demo'"));
        Assert.Equal(0L, await CompterAsync(a.Connexion, "SELECT (to_regclass('demo_sous_traitant') IS NOT NULL)::int"));
        // Référentiels conservés.
        Assert.True(await CompterAsync(a.Connexion, "SELECT count(*) FROM niveau_personne") > 0);
        Assert.True(await CompterAsync(a.Connexion, "SELECT count(*) FROM casquette") > 0);
        Assert.True(await CompterAsync(a.Connexion, "SELECT count(*) FROM nature_element") > 0);
        Assert.True(await CompterAsync(a.Connexion, "SELECT count(*) FROM regroupement_nature") > 0);

        // Une seconde application, sans démonstration, ne change rien et n'ajoute aucun script de démonstration.
        var bilan2 = await new BaseDonnees(TextWriter.Null).AppliquerAsync(a.Connexion, racine, m.Retenus(false));
        Assert.Equal(0, bilan2.Appliques);
        Assert.Empty(bilan2.Modifies);
    }

    [Fact]
    public async Task Base_avec_demonstration_est_repérée_au_journal_et_garde_ses_donnees()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var m = ManifesteScripts.Lire(racine);
        await using var a = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await new BaseDonnees(TextWriter.Null).AppliquerAsync(a.Connexion, racine, m.Retenus(true));
        Assert.True(await BaseDonnees.ADeLaDemoAsync(a.Connexion, m.Scripts));
        Assert.Equal(80L, await CompterAsync(a.Connexion, "SELECT count(*) FROM salarie"));
        Assert.True(await CompterAsync(a.Connexion, "SELECT count(*) FROM chantier WHERE cha_code NOT LIKE 'INT-%'") > 0);
        Assert.True(await CompterAsync(a.Connexion, "SELECT count(*) FROM personne WHERE per_casquettes ? 'SOUS_TRAITANT'") > 0); // 210b : reprise des sous-traitants
    }

    [Fact]
    public async Task Base_installee_avant_la_scission_est_acceptee_sans_dupliquer_les_donnees_extraites()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var m = ManifesteScripts.Lire(racine);
        var acceptees = EmpreintesAcceptees.Lire(racine);
        await using var a = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        var moteur = new BaseDonnees(TextWriter.Null);
        await moteur.AppliquerAsync(a.Connexion, racine, m.Retenus(true));
        var salaries = await CompterAsync(a.Connexion, "SELECT count(*) FROM salarie");
        var personnes = await CompterAsync(a.Connexion, "SELECT count(*) FROM personne");

        // Journal d'avant le lot : anciennes empreintes des scripts réduits, scripts extraits absents.
        var extraits = m.Scripts.Where(s => s.ExtraitDe is not null).Select(s => s.Chemin).ToList();
        await using (var cnx = new NpgsqlConnection(a.Connexion))
        {
            await cnx.OpenAsync();
            foreach (var l in acceptees.Lignes)
            {
                await using var cmd = new NpgsqlCommand("UPDATE installation_script SET isc_empreinte = @e WHERE isc_chemin = @c", cnx);
                cmd.Parameters.AddWithValue("e", l.Empreinte);
                cmd.Parameters.AddWithValue("c", l.Chemin);
                Assert.Equal(1, await cmd.ExecuteNonQueryAsync());
            }
            await using var del = new NpgsqlCommand("DELETE FROM installation_script WHERE isc_chemin = ANY(@c)", cnx);
            del.Parameters.AddWithValue("c", extraits.ToArray());
            Assert.Equal(extraits.Count, await del.ExecuteNonQueryAsync());
        }

        // Sans les empreintes acceptées : les six scripts sont des erreurs (empreinte modifiée), avant toute application.
        var sans = await Assert.ThrowsAsync<EmpreinteModifieeException>(() => moteur.AppliquerAsync(a.Connexion, racine, m.Retenus(true).Where(s => !extraits.Contains(s.Chemin))));
        Assert.Equal(acceptees.Lignes.Count, sans.Scripts.Count);

        var bilan = await moteur.AppliquerAsync(a.Connexion, racine, m.Retenus(true), acceptees: acceptees);
        Assert.Equal(acceptees.Lignes.Select(l => l.Chemin).Order(), bilan.AcceptesOuVide.Order());
        Assert.Equal(0, bilan.Appliques); // les scripts extraits sont inscrits, pas exécutés
        Assert.Empty(bilan.Modifies);
        Assert.Equal(salaries, await CompterAsync(a.Connexion, "SELECT count(*) FROM salarie"));
        Assert.Equal(personnes, await CompterAsync(a.Connexion, "SELECT count(*) FROM personne"));
        var journal = (await BaseDonnees.ScriptsAppliquesAsync(a.Connexion)).ToDictionary(s => s.Chemin, s => s.Empreinte);
        foreach (var s in m.Scripts.Where(s => !s.Rejouable))
            Assert.Equal(BaseDonnees.Empreinte(File.ReadAllText(Path.Combine(racine, s.Chemin))), journal[s.Chemin]);

        // Une application suivante ne signale plus rien.
        var encore = await moteur.AppliquerAsync(a.Connexion, racine, m.Retenus(true), acceptees: acceptees);
        Assert.Empty(encore.AcceptesOuVide);
        Assert.Empty(encore.Modifies);
        Assert.Equal(0, encore.Appliques);
    }
}
