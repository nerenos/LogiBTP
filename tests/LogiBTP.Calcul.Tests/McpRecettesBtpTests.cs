using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Api.Btp;
using LogiBTP.Mcp;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Recettes fournies par le cœur (plans/mcp.md, lot 13 ; db/310_mcp_recettes.sql) : valides pour ReglesRecettes avec le
/// catalogue de SpecialisationMcpBtp, un paramètre d'élément (marché, chantier ou pièce) pour le bouton « Demander à
/// l'agent », recettes de rapport limitées aux outils de lecture.
/// </summary>
public partial class McpRecettesBtpTests
{
    [GeneratedRegex("'((?:[^']|'')*)'")]
    private static partial Regex Litteral();

    /// <summary>Recettes du script : huit littéraux par ligne (code, libellé, description, prompt, paramètres, outils, sortie, auteur).</summary>
    public static List<RecetteSaisie> Fournies()
    {
        var sql = File.ReadAllText(CasPartages.Chemin("db", "310_mcp_recettes.sql"));
        var valeurs = sql[sql.IndexOf("VALUES", StringComparison.Ordinal)..sql.LastIndexOf("ON CONFLICT", StringComparison.Ordinal)];
        var l = Litteral().Matches(valeurs).Select(m => m.Groups[1].Value.Replace("''", "'")).ToList();
        Assert.Equal(0, l.Count % 8);
        return Enumerable.Range(0, l.Count / 8).Select(i => l.Skip(i * 8).Take(8).ToList()).Select(x => new RecetteSaisie(x[0], x[1], x[3],
            JsonSerializer.Deserialize<List<ParametreRecette>>(x[4], JsonCalculOptions)!, JsonSerializer.Deserialize<List<string>>(x[5])!, x[6], Description: x[2])).ToList();
    }

    private static readonly JsonSerializerOptions JsonCalculOptions = LogiBTP.Socle.JsonCalcul.Options;

    [Fact]
    public void Recettes_fournies_valides_pour_le_catalogue()
    {
        var specialisation = new SpecialisationMcpBtp();
        var catalogue = specialisation.Outils.Select(o => o.Nom).ToList();
        var recettes = Fournies();
        Assert.Equal(["devis_depuis_modele", "devis_depuis_devis", "oe_metallerie_appro", "controle_devis", "synthese_chantier"], recettes.Select(r => r.Code));
        foreach (var r in recettes)
        {
            Assert.True(ReglesRecettes.ControlerRecette(r, catalogue).Count == 0, $"{r.Code} : {string.Join(",", ReglesRecettes.ControlerRecette(r, catalogue))}");
            Assert.Contains(r.Parametres!, p => p.Type is TypeParametreRecette.Marche or TypeParametreRecette.Chantier or TypeParametreRecette.Document);
            if (r.Sortie == SortieRecette.Rapport)
                Assert.All(r.Outils!, o => Assert.Equal(ClasseOutil.Lecture, specialisation.Outil(o)!.Classe));
        }
        // Marché : OE métallerie ; chantier : synthèse et devis depuis un modèle ; pièce : contrôle et devis depuis un devis.
        Assert.Equal(["oe_metallerie_appro"], recettes.Where(r => r.Parametres!.Any(p => p.Type == TypeParametreRecette.Marche)).Select(r => r.Code));
        Assert.Equal(["devis_depuis_devis", "controle_devis"], recettes.Where(r => r.Parametres!.Any(p => p.Type == TypeParametreRecette.Document)).Select(r => r.Code));
    }

    [Fact]
    public void Types_des_arguments_decrits_par_le_dictionnaire()
    {
        var s = new SpecialisationMcpBtp();
        foreach (var t in new[] { TypeParametreRecette.Marche, TypeParametreRecette.Chantier, TypeParametreRecette.Document, TypeParametreRecette.Periode, TypeParametreRecette.Texte })
            Assert.NotEqual($"mcp.recettes.types.{t}", s.Texte($"mcp.recettes.types.{t}"));
    }
}
