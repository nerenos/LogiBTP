using System.Text.RegularExpressions;
using LogiBTP.Api.Reprise;
using LogiBTP.Import;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Correspondances par défaut de la reprise MDE / OptimBTP (plan reprise-mde-optim, lot 0) : chaque fichier est valide
/// contre les codes réels du dépôt (types de documents de la référence SQL, types de lignes, casquettes, liens…).
/// </summary>
public class RepriseCorrespondancesTests
{
    private static string Lire(params string[] chemin) => File.ReadAllText(CasPartages.Chemin(chemin));

    /// <summary>Scripts SQL du cœur et des modules.</summary>
    private static IEnumerable<string> Scripts() =>
        Directory.GetFiles(CasPartages.Chemin("db"), "*.sql")
            .Concat(Directory.GetDirectories(CasPartages.Chemin("modules"))
                .Select(m => Path.Combine(m, "db")).Where(Directory.Exists)
                .SelectMany(d => Directory.GetFiles(d, "*.sql")));

    /// <summary>Premières valeurs entre quotes des tuples des INSERT INTO &lt;table&gt; de tous les scripts SQL.</summary>
    private static HashSet<string> CodesInseres(string table)
    {
        var codes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var script in Scripts())
            foreach (Match bloc in Regex.Matches(File.ReadAllText(script), $@"INSERT INTO {table} \([^)]*\)\s*(?:VALUES|SELECT)(.*?);", RegexOptions.Singleline))
                foreach (Match m in Regex.Matches(bloc.Groups[1].Value, @"(?:^|\(|SELECT)\s*'([A-Z][A-Z0-9_]*)'", RegexOptions.Multiline))
                    codes.Add(m.Groups[1].Value);
        return codes;
    }

    private static Dictionary<string, IReadOnlyCollection<string>> Cibles() => new()
    {
        [CorrespondancesReprise.Listes.TypeDocument] = CodesInseres("type_document"),
        [CorrespondancesReprise.Listes.TypeFiche] = Constantes.Js(CasPartages.Chemin("client", "src", "app", "codes.js"), "TYPE_FICHE").Values.ToList(),
        [CorrespondancesReprise.Listes.TypeLigne] = Regex.Match(Lire("modules", "document", "js", "src", "types.js"),
                @"export const TL = Object\.freeze\(\{(.*?)\}\);", RegexOptions.Singleline).Groups[1].Value
            .Split(',').Select(p => p.Split(':')[0].Trim()).Where(c => c.Length > 0).ToList(),
        [CorrespondancesReprise.Listes.Casquette] = CodesInseres("casquette"),
        [CorrespondancesReprise.Listes.TypeLien] = CodesInseres("type_lien"),
        [CorrespondancesReprise.Listes.RegroupementNature] = CodesInseres("regroupement_nature"),
        [CorrespondancesReprise.Listes.TypeChamp] = LogiBTP.Fiches.ChampsSupplementaires.Types.ToList(),
        [CorrespondancesReprise.Listes.ModeReglement] = CodesInseres("mode_reglement"),
        // Civilités de la fiche individu (options du champ « civilite » du paramétrage des fiches, db/131).
        [CorrespondancesReprise.Listes.Civilite] = Regex.Matches(Regex.Match(Lire("db", "131_fiches_parametrage.sql"),
                @"""code"":""civilite"",[^\]]*""options"":\[(.*?)\]").Groups[1].Value, @"""valeur"":""([^""]+)""")
            .Select(m => m.Groups[1].Value).ToList(),
        [CorrespondancesReprise.Listes.NatureNote] = Constantes.Js(CasPartages.Chemin("modules", "crm", "js", "src", "codes.js"), "NATURE_NOTE").Values.ToList(),
    };

    [Fact]
    public void Les_listes_de_cibles_sont_lues()
    {
        var cibles = Cibles();
        Assert.Contains("A_DEVIS", cibles[CorrespondancesReprise.Listes.TypeDocument]);
        Assert.Contains("SOUS_TOTAL", cibles[CorrespondancesReprise.Listes.TypeLigne]);
        Assert.Contains("SOUS_TRAITANT", cibles[CorrespondancesReprise.Listes.Casquette]);
        Assert.Contains("FACTURER_A", cibles[CorrespondancesReprise.Listes.TypeLien]);
        Assert.Contains("VENTE", cibles[CorrespondancesReprise.Listes.RegroupementNature]);
        Assert.Contains("CHEQUE", cibles[CorrespondancesReprise.Listes.ModeReglement]);
        Assert.Equal(["M.", "Mme"], cibles[CorrespondancesReprise.Listes.Civilite]);
    }

    [Theory]
    [InlineData(SourceReprise.Mde)]
    [InlineData(SourceReprise.Optim)]
    public void Le_fichier_par_defaut_est_valide(string source)
    {
        var fichier = CorrespondancesReprise.ParDefaut(source);
        var erreurs = fichier.Valider(CorrespondancesReprise.TablesAttendues(source), Cibles(), source);
        Assert.True(erreurs.Count == 0, string.Join("\n", erreurs.Select(e => $"{e.Code} {e.Emplacement} {e.Valeur}")));
    }

    [Fact]
    public void Enumerations_MDE_du_paragraphe_10_3()
    {
        var mde = CorrespondancesReprise.ParDefaut(SourceReprise.Mde);
        Assert.Equal("A_DEVIS", mde.Tables["type_document"].Trouver("DF")!.Cible);
        Assert.Equal("V_FACTURE_AVT", mde.Tables["type_facture"].Trouver("T")!.Cible);
        Assert.Equal("TITRE", mde.Tables["type_ligne_vente"].Trouver("T")!.Cible);
        Assert.True(mde.Tables["type_ligne_vente"].Trouver("R")!.Ignorer);
        Assert.Equal("ARCHITECTE", mde.Tables["type_tiers"].Trouver("A")!.Cible);
        Assert.All(mde.Tables["type_arrondi"].Entrees, e => Assert.True(e.Ignorer));
    }

    [Fact]
    public void Types_OPTIM_par_type_de_parametre_et_code()
    {
        var optim = CorrespondancesReprise.ParDefaut(SourceReprise.Optim);
        Assert.Equal("TypeDocVte", optim.Tables["type_document_vente"].TypeParametre);
        Assert.Equal("A_DEVIS", optim.Tables["type_document_achat"].Trouver("DPRX")!.Cible);
        foreach (var exclu in new[] { "ATT", "INT", "TRA" })
            Assert.True(optim.Tables["type_document_vente"].Trouver(exclu)!.Ignorer);
        foreach (var exclu in new[] { "CI", "APPRO" })
            Assert.True(optim.Tables["type_document_achat"].Trouver(exclu)!.Ignorer);
    }
}
