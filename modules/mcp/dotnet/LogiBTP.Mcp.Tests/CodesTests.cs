using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mcp.Tests;

/// <summary>Codes et constantes du module : Codes.cs, ReglesDelegation.cs ↔ modules/mcp/js/src/{codes,delegation}.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "mcp", "js", "src", "codes.js");
    private static readonly string Regles = CasPartages.Chemin("modules", "mcp", "js", "src", "delegation.js");

    [Theory]
    [InlineData("CLASSE_OUTIL", typeof(ClasseOutil))]
    [InlineData("ERREUR_MCP", typeof(ErreurMcp))]
    [InlineData("STATUT_APPEL_AGENT", typeof(StatutAppelAgent))]
    [InlineData("ETAT_PROPOSITION", typeof(EtatProposition))]
    [InlineData("DECISION_PROPOSITION", typeof(DecisionProposition))]
    [InlineData("TYPE_PARAMETRE_RECETTE", typeof(TypeParametreRecette))]
    [InlineData("SORTIE_RECETTE", typeof(SortieRecette))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));

    [Theory]
    [InlineData("ECHEANCE_DEFAUT", ReglesDelegation.EcheanceDefaut)]
    [InlineData("ECHEANCE_MAX", ReglesDelegation.EcheanceMax)]
    [InlineData("QUOTA_APPEL", ReglesDelegation.QuotaAppel)]
    [InlineData("QUOTA_JOUR", ReglesDelegation.QuotaJour)]
    [InlineData("ALERTE_QUOTA", ReglesDelegation.AlerteQuota)]
    public void Constantes_identiques_au_js(string nom, int valeur) =>
        Assert.Contains($"export const {nom} = {valeur};", File.ReadAllText(Regles));

    [Fact]
    public void Noeuds_interdits_identiques_au_js()
    {
        Assert.Equal(Constantes.ListeJs(Regles, "NOEUDS_INTERDITS"), ReglesDelegation.NoeudsInterdits);
        Assert.Equal(Constantes.ListeJs(Regles, "NOEUDS_LECTURE_SEULE"), ReglesDelegation.NoeudsLectureSeule);
    }

    [Fact]
    public void Actions_interdites_identiques_au_js()
    {
        // Liste JS faite de références ACTION_DROIT.X (codes du socle) : comparée par les clés.
        var source = File.ReadAllText(Regles);
        var bloc = System.Text.RegularExpressions.Regex.Match(source, @"export const ACTIONS_INTERDITES = Object\.freeze\(\[(.*?)\]\);",
            System.Text.RegularExpressions.RegexOptions.Singleline).Groups[1].Value;
        var js = System.Text.RegularExpressions.Regex.Matches(bloc, @"ACTION_DROIT\.([A-Z_]+)").Select(m => m.Groups[1].Value).ToList();
        Assert.Equal(js, ReglesDelegation.ActionsInterdites);
    }
}
