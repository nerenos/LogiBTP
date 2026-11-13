using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Mcp;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;
using LogiBTP.Stock;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// File des propositions côté cœur (plans/mcp.md, lot 10) sans base : outils de proposition (lectures seules, hors liste
/// blanche), exécuteurs déclarés pour chaque action proposée, contenu d'une ventilation et son contrôle, routes déclarées
/// (droits, écritures), adresse de l'écran. Exécution en base : McpExecutionBtpBaseTests.
/// </summary>
public class McpPropositionsBtpTests
{
    private static readonly SpecialisationMcpBtp Specialisation = new();

    [Fact]
    public void Outils_de_proposition_en_lecture_seule_et_executeurs_declares()
    {
        var propositions = Specialisation.Outils.Where(o => o.Classe == ClasseOutil.Proposition).ToList();
        Assert.Equal(["proposer_validation", "proposer_envoi", "proposer_tiers"], propositions.Select(o => o.Nom));
        Assert.All(propositions, o =>
        {
            Assert.NotNull(o.Execution);
            Assert.All(o.ToutesRoutes, r => Assert.Equal("GET", r.Methode));
            Assert.NotEqual($"mcp_btp.outils.{o.Nom}", Specialisation.Texte($"mcp_btp.outils.{o.Nom}"));
        });
        Assert.True(Specialisation.Outil("proposer_envoi")!.Envoi);
        // Chaque action proposée par le cœur a son exécuteur ; aucune route de proposition dans la liste blanche.
        Assert.Equal([McpPropositionsBtp.ValiderPiece, McpPropositionsBtp.AppliquerVentilation, McpPropositionsBtp.EnvoyerDocument, McpPropositionsBtp.CreerTiersProvisoire],
            Specialisation.Executeurs.Select(e => e.Action));
        Assert.DoesNotContain(PlafondMcp.RoutesEcriture(Specialisation), r => r.Methode == "GET");
        Assert.Equal("/agents/propositions/12", Specialisation.AdresseProposition(12));
        Assert.Equal(AdressesApp.UrlProposition(12), Specialisation.AdresseProposition(12));
    }

    [Fact]
    public void Routes_de_la_file_declarees_droits_et_ecritures()
    {
        var droit = LogiBTP.Droits.Web.RoutesDroits.Trouver(new SpecialisationDroitsBtp().Routes, "/api/mcp/propositions/{id:long}/accepter");
        Assert.NotNull(droit);
        Assert.Equal(LogiBTP.Droits.Web.ModeRoute.Session, droit!.Mode);
        Assert.Contains(EcrituresBtp.Routes, r => r.Prefixe == "/api/mcp/propositions");
    }

    private static JsonObject Ventilation() => JsonNode.Parse("""
        {"ent_id":7,"ent_numero":"DAP-1","proche_mini":20,"besoins":[{"ele_id":3,"code":"T","libelle":"Tube","unite":"ml","lig_id":11,"quantite":60,"stock":50,"commande":0,"achat":10,
          "parts":[{"nature":"STOCK","depot_id":2,"depot":"D","commande_id":null,"commande":null,"fournisseur_id":null,"fournisseur":null,"quantite":50,"unites_achat":null},
                   {"nature":"ACHAT","depot_id":null,"fournisseur_id":9,"fournisseur":"F","quantite":10,"unites_achat":10}]}],
         "reappros":[{"depot_id":2,"depot":"D","fournisseurs":[{"fournisseur_id":9,"fournisseur":"F","lignes":[{"ele_id":3,"code":"T","libelle":"Tube","motif":"MINI_FRANCHI",
           "disponible":50,"mini":80,"maxi":150,"quantite":100,"unites_achat":100}]}]}],"sans_conversion":[],"ecriture":false}
        """)!.AsObject();

    [Fact]
    public void Contenu_de_ventilation_reduit_aux_identifiants_et_quantites_puis_controle()
    {
        var c = McpPropositionsBtp.ContenuVentilation(Ventilation());
        Assert.Equal(7, c["ent_id"]!.GetValue<long>());
        var part = c["besoins"]![0]!["parts"]![0]!.AsObject();
        Assert.Equal(["nature", "depot_id", "commande_id", "fournisseur_id", "quantite"], part.Select(kv => kv.Key));
        Assert.Null(c["besoins"]![0]!["libelle"]);
        Assert.Equal(100m, c["reappros"]![0]!["fournisseurs"]![0]!["lignes"]![0]!["unites_achat"]!.GetValue<decimal>());
        Assert.Empty(McpPropositionsBtp.ControlerVentilation(c));

        // Corrections refusées : nature inconnue, quantité négative, part STOCK sans dépôt, réappro sans article, pas un objet.
        var nature = c.DeepClone().AsObject();
        nature["besoins"]![0]!["parts"]![0]!["nature"] = "VOL";
        var negative = c.DeepClone().AsObject();
        negative["besoins"]![0]!["parts"]![1]!["quantite"] = -1;
        var depot = c.DeepClone().AsObject();
        depot["besoins"]![0]!["parts"]![0]!["depot_id"] = null;
        var article = c.DeepClone().AsObject();
        article["reappros"]![0]!["fournisseurs"]![0]!["lignes"]![0]!["ele_id"] = null;
        foreach (var faux in new JsonNode?[] { nature, negative, depot, article, new JsonArray(), null })
            Assert.Equal([ErreurMcp.McpContenuInvalide], McpPropositionsBtp.ControlerVentilation(faux));
        Assert.Contains(NaturePartAppro.Achat, c.ToJsonString());
    }
}
