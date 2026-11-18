using LogiBTP.Import.Reprise;
using LogiBTP.Import.Reprise.Lecteurs;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>
/// Lecteurs de source (plan reprise-mde-optim, lot 2). Les tests d'intégration lisent les bases fictives de
/// tests/reprise (monter.sh) : LOGIBTP_TEST_MSSQL et LOGIBTP_TEST_MARIADB, ignorés sans ces variables.
/// </summary>
public class LecteursTests
{
    private static readonly string? Mssql = Environment.GetEnvironmentVariable("LOGIBTP_TEST_MSSQL");
    private static readonly string? MariaDb = Environment.GetEnvironmentVariable("LOGIBTP_TEST_MARIADB");

    [Theory]
    [InlineData("SELECT CODE FROM PMECLIENT WHERE CODE = @code")]
    [InlineData("  select * from bib_tiers")]
    [InlineData("WITH t AS (SELECT 1 AS x) SELECT x FROM t")]
    [InlineData("SELECT REPLACE(NOM, 'a', 'b') AS nom, DateUpdate, PRS_Lock FROM T")]
    public void Lecture_admise(string requete) => LecteurAdo.VerifierLecture(requete);

    [Theory]
    [InlineData("")]
    [InlineData("UPDATE PMECLIENT SET NOTE = ''")]
    [InlineData("DELETE FROM bib_tiers")]
    [InlineData("SELECT 1; DROP TABLE bib_tiers")]
    [InlineData("SELECT * INTO copie FROM PMECLIENT")]
    [InlineData("WITH t AS (SELECT 1 AS x) DELETE FROM PMECLIENT")]
    [InlineData("SELECT * FROM bib_tiers FOR UPDATE")]
    [InlineData("SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1')")]
    [InlineData("SELECT 1 INTO OUTFILE '/tmp/x'")]
    [InlineData("EXEC sp_who")]
    [InlineData("SELECT 1 /* */ ; SELECT 2")]
    public void Ecriture_refusee(string requete) =>
        Assert.Throws<LectureRefuseeException>(() => LecteurAdo.VerifierLecture(requete));

    public static TheoryData<string> Sources => new() { SourceReprise.Mde, SourceReprise.Optim };

    private static LecteurAdo? Lecteur(string source) => source switch
    {
        SourceReprise.Mde when Mssql is not null => new LecteurSqlServer(Mssql),
        SourceReprise.Optim when MariaDb is not null => new LecteurMariaDb(MariaDb),
        _ => null,
    };

    [Theory]
    [MemberData(nameof(Sources))]
    public async Task Tables_et_comptages(string source)
    {
        await using var l = Lecteur(source);
        if (l is null) return;
        Assert.Equal(source, l.Source);
        var tables = await l.TablesAsync(default);
        Assert.True(tables.Count > 150, $"{tables.Count} tables");
        var (table, attendu) = source == SourceReprise.Mde ? ("PMECLIENT", 3L) : ("ref_societe", 3L);
        Assert.Equal(attendu, await l.CompterAsync(table.ToLowerInvariant(), default)); // casse indifférente
        await Assert.ThrowsAsync<LectureRefuseeException>(() => l.CompterAsync("absente; DROP TABLE x", default));
    }

    [Fact]
    public async Task Lecture_MDE_en_flux_avec_parametres_et_lectures_imbriquees()
    {
        await using var l = Lecteur(SourceReprise.Mde);
        if (l is null) return;
        var codes = new List<string>();
        await foreach (var c in l.LireAsync("SELECT CODE, SIRET FROM PMECLIENT WHERE CODECATEGORIE = @cat ORDER BY CODE",
                           new Dictionary<string, object?> { ["cat"] = "F" }, default))
        {
            codes.Add(c.Texte("code")!);
            // Lecture imbriquée : chaque lecture a sa connexion.
            var n = 0;
            await foreach (var _ in l.LireAsync("SELECT CODE FROM COMM_TIERS WHERE CODEGESTION = @c", new Dictionary<string, object?> { ["@c"] = c.Texte("code") }, default)) n++;
            Assert.True(n >= 1, c.Texte("code"));
        }
        Assert.Equal(["C001", "C002", "C003"], codes);
        // Base en French_CI_AS (monter.sh) : varchar décodé par la page de code de la collation.
        await foreach (var n in l.LireAsync("SELECT NOTE FROM PMECLIENT WHERE CODE = 'C001'", null, default))
            Assert.Equal("Client fidèle", n.Texte("note"));
        await foreach (var u in l.LireAsync("SELECT UNITE, NBDEC FROM PMEUNITEMESURE WHERE UNITE = 'KG'", null, default))
            Assert.Equal(3, u.Entier("nbdec"));
    }

    [Fact]
    public async Task Lecture_OPTIM_vide_et_zero_rendus_absents()
    {
        await using var l = Lecteur(SourceReprise.Optim);
        if (l is null) return;
        var lignes = new List<LigneSource>();
        await foreach (var s in l.LireAsync("SELECT SCT_ID, SCT_SCT_ID, SCT_RaisonSociale FROM ref_societe WHERE SCT_ID IN (@a, @b) ORDER BY SCT_ID",
                           new Dictionary<string, object?> { ["a"] = 1, ["b"] = 2 }, default))
            lignes.Add(s);
        Assert.Equal([1L, 2L], lignes.Select(x => x.Entier("sct_id")!.Value));
        Assert.All(lignes, x => Assert.NotNull(x.Texte("SCT_RaisonSociale")));
    }

    [Theory]
    [MemberData(nameof(Sources))]
    public async Task Une_ecriture_ne_passe_jamais(string source)
    {
        await using var l = Lecteur(source);
        if (l is null) return;
        var table = source == SourceReprise.Mde ? "PMECLIENT" : "ref_societe";
        await Assert.ThrowsAsync<LectureRefuseeException>(async () =>
        {
            await foreach (var _ in l.LireAsync($"DELETE FROM {table}", null, default)) { }
        });
        Assert.Equal(3L, await l.CompterAsync(table, default));
    }
}
