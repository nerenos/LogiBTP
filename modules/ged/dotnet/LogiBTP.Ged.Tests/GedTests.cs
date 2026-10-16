using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Ged.Tests;

public class ChaineCoffreTests
{
    private static JsonArray Entrees() => CasPartages.Lire(CasPartages.Chemin("modules", "ged", "tests", "cas", "01_coffre.json"))["entrees"]!.AsArray();

    private static EntreeCoffre Entree(JsonNode n) => new(
        n["empreinte_precedente"]!.GetValue<string>(), n["empreinte_document"]!.GetValue<string>(),
        DateTimeOffset.Parse(n["horodatage"]!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal),
        n["document"]!.GetValue<long>(), n["version"]!.GetValue<long>(), n["utilisateur"]!.GetValue<string>(), n["motif"]?.GetValue<string>(),
        n["empreinte_entree"]!.GetValue<string>());

    /// <summary>Jeu partagé avec coffre.js : empreinte du contenu, texte et empreinte de chaque entrée, chaînage.</summary>
    [Fact]
    public void Calcul_identique_au_js()
    {
        EntreeCoffre? precedente = null;
        foreach (var n in Entrees())
        {
            Assert.Equal(n!["empreinte_document"]!.GetValue<string>(), ChaineCoffre.Sha256(n["contenu"]!.GetValue<string>()));
            var e = Entree(n);
            Assert.Equal(n["texte"]!.GetValue<string>(), ChaineCoffre.Texte(e));
            var chainee = ChaineCoffre.Chainer(precedente, e.EmpreinteDocument, e.Horodatage, e.Document, e.Version, e.Utilisateur, e.Motif);
            Assert.Equal(e, chainee);
            precedente = chainee;
        }
    }

    [Fact]
    public void Verification_detecte_alteration_et_rupture()
    {
        var entrees = Entrees().Select(n => Entree(n!)).ToList();
        Assert.Equal(new ResultatChaine(true, 3, null), ChaineCoffre.Verifier(entrees));

        var modifiee = entrees.ToList();
        modifiee[1] = modifiee[1] with { Utilisateur = "pirate" };
        Assert.Equal(new RuptureChaine(1, "Entrée modifiée"), ChaineCoffre.Verifier(modifiee).Rupture);

        var retiree = entrees.Where((_, i) => i != 1).ToList();
        Assert.Equal(new RuptureChaine(1, "Chaînage rompu"), ChaineCoffre.Verifier(retiree).Rupture);
    }

    [Fact]
    public void Horodatage_a_la_milliseconde()
    {
        var d = new DateTimeOffset(2026, 10, 11, 11, 56, 33, TimeSpan.FromHours(2)).AddTicks(5_169_999);
        Assert.Equal("2026-10-11T09:56:33.516Z", ChaineCoffre.Horodatage(ChaineCoffre.Tronquer(d)));
    }
}

public class RegleVersionsTests
{
    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Lire()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    private static JsonArray Lire() => CasPartages.Lire(CasPartages.Chemin("modules", "ged", "tests", "cas", "02_versions.json"))["cas"]!.AsArray();

    /// <summary>Jeu partagé avec versions.js : mêmes numéros purgés.</summary>
    [Theory]
    [MemberData(nameof(Cas))]
    public void Editions_a_purger_identiques_au_js(string nom)
    {
        var cas = Lire().First(c => c!["nom"]!.GetValue<string>() == nom)!;
        var versions = cas["versions"]!.AsArray().Select(v => new VersionResume(v!["numero"]!.GetValue<int>(), v["genre"]!.GetValue<string>()));
        var attendu = cas["attendu"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
        Assert.Equal(attendu, RegleVersions.EditionsAPurger(versions, cas["conservees"]!.GetValue<int>(), cas["coffre"]?.GetValue<bool>() == true));
    }
}

public sealed class StockageGedTests : IDisposable
{
    private readonly string racine = Path.Combine(Path.GetTempPath(), "logibtp-ged-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (!Directory.Exists(racine)) return;
        foreach (var f in Directory.GetFiles(racine, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
        Directory.Delete(racine, true);
    }

    [Fact]
    public async Task Contenu_range_par_empreinte_et_partage()
    {
        var s = new StockageGed(racine);
        var octets = Encoding.UTF8.GetBytes("%PDF-1.4 devis signé");
        var a = await s.Enregistrer(new MemoryStream(octets));
        var b = await s.Enregistrer(new MemoryStream(octets));
        Assert.Equal("f112a07356ccc7b241ed1a248ea24cb676a0a6a5b7621e10c952b8984aa24cf6", a.Empreinte);
        Assert.Equal(a, b);
        Assert.Equal(Path.Combine("f1", "12", a.Empreinte), a.Chemin);
        Assert.Equal(octets.Length, a.Taille);
        Assert.Equal(a.Empreinte, await s.Recalculer(a.Chemin));
        Assert.Empty(Directory.GetFiles(Path.Combine(racine, "tmp")));

        s.Supprimer(a.Chemin);
        Assert.False(s.Existe(a.Chemin));
        Assert.Null(await s.Recalculer(a.Chemin));
    }

    [Fact]
    public void Chemin_hors_du_stockage_refuse() =>
        Assert.Throws<ArgumentException>(() => new StockageGed(racine).Existe(Path.Combine("..", "autre", "fichier")));
}

/// <summary>
/// Normalisation de la recherche (jeu 03_normalisation.json partagé avec normaliserRecherche en JS) : NormalisationGed et,
/// si LOGIBTP_TEST_PG désigne une base où le schéma GED est chargé, la fonction SQL f_ged_normaliser (colonne dge_recherche).
/// </summary>
public class NormalisationGedTests
{
    private static IEnumerable<(string Texte, string Attendu)> Cas() =>
        CasPartages.Lire(CasPartages.Chemin("modules", "ged", "tests", "cas", "03_normalisation.json"))["cas"]!.AsArray()
            .Select(c => (c!["texte"]!.GetValue<string>(), c["attendu"]!.GetValue<string>()));

    [Fact]
    public void Normalisation_identique_au_js()
    {
        foreach (var (texte, attendu) in Cas()) Assert.Equal(attendu, NormalisationGed.Normaliser(texte));
    }

    [Fact]
    public async Task Normalisation_identique_en_sql()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (connexion is null) return;
        await using var cnx = new Npgsql.NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        foreach (var (texte, attendu) in Cas())
        {
            await using var cmd = new Npgsql.NpgsqlCommand("SELECT f_ged_normaliser(@t)", cnx);
            cmd.Parameters.AddWithValue("t", texte);
            Assert.Equal(attendu, (string?)await cmd.ExecuteScalarAsync());
        }
    }
}
