using System.Text.Json.Nodes;
using LogiBTP.Editions.Web;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Editions.Tests;

/// <summary>Règles du service sans base : dépendances d'un modèle, accès aux modèles (Q18), nom de fichier.</summary>
public class ServiceEditionTests
{
    [Fact]
    public void Dependances_blocs_sous_rapports_ressources_sources_annexes()
    {
        var m = JsonNode.Parse("""
            { "sources_annexes": ["marche_documents"], "bandes": [ { "contenu": { "type": "pile", "enfants": [
              { "type": "bloc", "bloc": "PIED" }, { "type": "bloc", "bloc": "PIED" }, { "type": "sous_rapport", "rapport": "SR" },
              { "type": "image", "ressource": "LOGO" }, { "type": "image", "ressource": "={{x}}" } ] } } ] }
            """);
        var d = Dependances.Lire(m);
        Assert.Equal(["PIED"], d.Blocs);
        Assert.Equal(["SR"], d.Rapports);
        Assert.Equal(["LOGO"], d.Ressources);
        Assert.Equal(["marche_documents"], d.SourcesAnnexes);
    }

    [Theory]
    [InlineData("PUBLIC", "", "USER", true)]
    [InlineData("INTERNE", "COMPTA", "USER", false)]
    [InlineData("INTERNE", "COMPTA", "COMPTA", true)]
    [InlineData("CONFIDENTIEL", "", "USER", false)]
    [InlineData("CONFIDENTIEL", "", "ADMIN", true)]
    [InlineData("SECRET", "", "ADMIN", false)]
    [InlineData("SECRET", "DIRECTION", "DIRECTION", true)]
    public void Acces_aux_modeles_comme_la_ged(string niveau, string profils, string profil, bool attendu)
    {
        var liste = profils.Split(',', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(attendu, AccesEdition.Autorise(niveau, liste, new Utilisateur("u", profil)));
    }

    [Theory]
    [InlineData("Devis client DV2026-00001", "Devis-client-DV2026-00001.pdf")]
    [InlineData("Facture n° 12 / indice B", "Facture-n-12-indice-B.pdf")]
    [InlineData("  ", "edition.pdf")]
    public void Nom_de_fichier_sur(string libelle, string attendu) => Assert.Equal(attendu, ServiceEdition.NomFichier(libelle));
}
