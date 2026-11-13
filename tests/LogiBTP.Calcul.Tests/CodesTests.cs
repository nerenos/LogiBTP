using LogiBTP.Domaine;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Codes du cœur : src/LogiBTP.Domaine/Codes.cs ↔ client/src/app/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("client", "src", "app", "codes.js");

    [Theory]
    [InlineData("TYPE_FICHE", typeof(TypesFiche))]
    [InlineData("TYPE_DOCUMENT", typeof(TypesDocument))]
    [InlineData("TYPE_POSTE_MARCHE", typeof(TypesPosteMarche))]
    [InlineData("TYPE_RESSOURCE", typeof(TypesRessource))]
    [InlineData("TYPE_PRIX", typeof(TypesPrix))]
    [InlineData("ARRONDI_REVISION", typeof(ArrondiRevision))]
    [InlineData("MODULE_FACULTATIF", typeof(ModulesFacultatifs))]
    [InlineData("ROLE_RENTABILITE", typeof(RolesRentabilite))]
    [InlineData("ROLE_RELANCE", typeof(RolesRelance))]
    [InlineData("MODELE_EDITION", typeof(ModelesEdition))]
    [InlineData("AVERTISSEMENT_GESTION", typeof(AvertissementsGestion))]
    [InlineData("STATUT_DOCUMENT_BTP", typeof(StatutsDocumentBtp))]
    [InlineData("ERREUR_TERRAIN", typeof(ErreursTerrain))]
    [InlineData("ETAT_RESERVE", typeof(EtatsReserve))]
    [InlineData("TYPE_ELEMENT_FE", typeof(TypesElementFe))]
    [InlineData("SIGNAL_FE", typeof(SignauxFe))]
    [InlineData("AVERTISSEMENT_ANNUAIRE_FE", typeof(AvertissementAnnuaireFe))]
    [InlineData("PLATEFORME_ANNUAIRE_FE", typeof(PlateformeAnnuaireFe))]
    [InlineData("NATURE_FE", typeof(NaturesFe))]
    [InlineData("SITUATION_CADRE_FE", typeof(SituationsCadreFe))]
    [InlineData("ECART_EMISSION_FE", typeof(EcartsEmissionFe))]
    [InlineData("ETAT_EMISSION_FE", typeof(EtatsEmissionFe))]
    [InlineData("MOTIF_EMISSION_FE", typeof(MotifsEmissionFe))]
    [InlineData("PASTILLE_EMISSION_FE", typeof(PastillesEmissionFe))]
    [InlineData("ERREUR_EMISSION_FE", typeof(ErreursEmissionFe))]
    [InlineData("TRANSMISSION_AVOIR_INTERNE_FE", typeof(TransmissionsAvoirInterneFe))]
    [InlineData("ETAT_ENCAISSEMENT_FE", typeof(EtatsEncaissementFe))]
    [InlineData("NATURE_PERIODE_EREPORTING", typeof(NaturesPeriodeEreporting))]
    [InlineData("ETAT_PERIODE_EREPORTING", typeof(EtatsPeriodeEreporting))]
    [InlineData("CIBLE_EREPORTING", typeof(CiblesEreporting))]
    [InlineData("ERREUR_EREPORTING", typeof(ErreursEreporting))]
    [InlineData("ERREUR_MCP_BTP", typeof(ErreursMcpBtp))]
    [InlineData("MOTIF_LIGNE_ORDRE", typeof(MotifsLigneOrdre))]
    [InlineData("GARANTIE_MARCHE", typeof(GarantiesMarche))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));

    [Fact]
    public void Listes_identiques_au_js()
    {
        Assert.Equal(Constantes.ListeJs(Fichier, "TYPES_ARC"), TypesDocument.Arc);
        Assert.Equal(Constantes.ListeJs(Fichier, "TYPES_SOUS_TRAITABLES"), TypesDocument.SousTraitables);
    }
}
