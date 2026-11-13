using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Mcp;
using LogiBTP.Mcp.Web;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Filtre des lignes d'un ordre d'exécution (plans/mcp.md lot 9, Q8) : service porteur de la nature (sous-services compris,
/// ouvrage par ses composantes), repli sur la famille de bibliothèque, chapitre, étiquette, reste ; outils déclarés.
/// </summary>
public class McpExecutionBtpTests
{
    // Services : 6 ATELIER > 10 FAB_BOIS, 11 FAB_METAL ; 7 CHANTIER > 12 POSE. Familles : 10 SO > 11 PEI ; 1 GO.
    private static readonly Dictionary<int, int?> Services = new() { [6] = null, [10] = 6, [11] = 6, [7] = null, [12] = 7 };
    private static readonly Dictionary<int, int?> Familles = new() { [10] = null, [11] = 10, [1] = null };

    private static LigneFiltrable L(long id, long? parent, short tyl, bool prix = false, decimal reste = 1, string? libelle = null, int? srv = null, int? fam = null,
        string? etiquette = null, string? numero = null) => new(id, parent, tyl, prix, reste, libelle, numero, etiquette, srv, fam);

    private static readonly List<LigneFiltrable> Lignes =
    [
        L(1, null, TL.Titre, libelle: "Métallerie", numero: "1"),
        L(2, 1, TL.Element, prix: true, reste: 5, libelle: "Garde-corps", srv: 11),
        L(3, 1, TL.Ouvrage, prix: true, libelle: "Porte bois"),
        L(4, 3, TL.Element, libelle: "MO bois", srv: 10),
        L(5, null, TL.Titre, libelle: "Pose", numero: "2", etiquette: "ROUGE"),
        L(6, 5, TL.Element, prix: true, libelle: "Pose", srv: 12),
        L(7, 5, TL.Element, prix: true, libelle: "Peinture", fam: 11),
        L(8, 1, TL.Element, prix: true, reste: 0, libelle: "Soldée", srv: 11),
    ];

    private static Dictionary<long, (bool Retenue, string Motif)> Classer(FiltreOrdre f, int[] services, int[] familles) =>
        FiltreLignesOrdre.Classer(Lignes, f, services.ToHashSet(), familles.ToHashSet(), Services, Familles).ToDictionary(c => c.LigId, c => (c.Retenue, c.Motif));

    [Fact]
    public void Service_porteur_sous_services_et_composantes()
    {
        var metal = Classer(new FiltreOrdre("FAB_METAL", null, null, null), [11], []);
        Assert.Equal((true, MotifsLigneOrdre.Service), metal[2]);
        Assert.Equal((false, MotifsLigneOrdre.AutreService), metal[3]);
        Assert.Equal((false, MotifsLigneOrdre.AutreService), metal[6]);
        Assert.Equal((false, MotifsLigneOrdre.SansService), metal[7]);
        Assert.Equal((false, MotifsLigneOrdre.SansReste), metal[8]);
        Assert.Equal(5, metal.Count);
        // Atelier : ses sous-services, ouvrage par le service de sa composante.
        var atelier = Classer(new FiltreOrdre("ATELIER", null, null, null), [6], []);
        Assert.True(atelier[2].Retenue && atelier[3].Retenue);
        Assert.False(atelier[6].Retenue);
    }

    [Fact]
    public void Repli_sur_la_famille_et_famille_seule()
    {
        var repli = Classer(new FiltreOrdre("ATELIER", "SO", null, null), [6], [10]);
        Assert.Equal((true, MotifsLigneOrdre.Famille), repli[7]);
        Assert.Equal((true, MotifsLigneOrdre.Service), repli[2]);
        var famille = Classer(new FiltreOrdre(null, "SO", null, null), [], [10]);
        Assert.Equal((true, MotifsLigneOrdre.Famille), famille[7]);
        Assert.Equal((false, MotifsLigneOrdre.AutreFamille), famille[2]);
    }

    [Fact]
    public void Chapitre_et_etiquette_combines()
    {
        var pose = Classer(new FiltreOrdre(null, null, "pose", "rouge"), [], []);
        Assert.Equal((true, MotifsLigneOrdre.Chapitre), pose[6]);
        Assert.Equal((false, MotifsLigneOrdre.HorsChapitre), pose[2]);
        var metal = Classer(new FiltreOrdre("FAB_METAL", null, "1", null), [11], []);
        Assert.True(metal[2].Retenue);
        Assert.Equal((false, MotifsLigneOrdre.HorsChapitre), metal[6]);
        var etiquette = Classer(new FiltreOrdre(null, null, null, "BLEU"), [], []);
        Assert.Equal((false, MotifsLigneOrdre.AutreEtiquette), etiquette[6]);
        Assert.True(new FiltreOrdre(" ", null, "", null).Vide);
    }

    [Fact]
    public void Outils_du_lot_9_declares_brouillon_ou_lecture_sans_nouvelle_ecriture()
    {
        var s = new SpecialisationMcpBtp();
        var ordre = s.Outil("preparer_ordre_execution")!;
        Assert.Equal(ClasseOutil.Brouillon, ordre.Classe);
        Assert.Equal(McpExecutionBtp.NoeudOrdre, ordre.Noeud);
        Assert.Equal(ClasseOutil.Brouillon, s.Outil("preparer_demandes_appro")!.Classe);
        var ventilation = s.Outil("proposer_ventilation")!;
        Assert.Equal(ClasseOutil.Lecture, ventilation.Classe);
        Assert.Equal("GET", ventilation.Methode);
        // Lot 10 : outil composé (dépôt de la proposition sur demande), sans autre route que la sienne (lecture).
        Assert.NotNull(ventilation.Execution);
        Assert.Empty(ventilation.Routes);
        foreach (var nom in new[] { "preparer_ordre_execution", "preparer_demandes_appro", "proposer_ventilation" })
            Assert.NotEqual($"mcp_btp.outils.{nom}", s.Texte($"mcp_btp.outils.{nom}"));
        // Écritures : seulement les routes de la liste blanche du lot 7 (transformation, PUT, verrou).
        Assert.Equal(
            ["DELETE /api/documents/{id}/verrou", "POST /api/documents/avec-contenu", "POST /api/documents/{id}/copie", "POST /api/documents/{id}/transformer",
             "POST /api/documents/{id}/verrou", "PUT /api/documents/{id}"],
            PlafondMcp.RoutesEcriture(s).Select(r => $"{r.Methode} {r.Gabarit}").Order(StringComparer.Ordinal));
        var routes = new SpecialisationDroitsBtp().Routes;
        foreach (var r in new[] { McpExecutionBtp.RouteSelection, McpExecutionBtp.RouteUnitesStock, McpExecutionBtp.RouteVentilation })
            Assert.NotNull(LogiBTP.Droits.Web.RoutesDroits.Trouver(routes, r));
    }
}
