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
    [InlineData("GARANTIE_MARCHE", typeof(GarantiesMarche))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));

    [Fact]
    public void Listes_identiques_au_js()
    {
        Assert.Equal(Constantes.ListeJs(Fichier, "TYPES_ARC"), TypesDocument.Arc);
        Assert.Equal(Constantes.ListeJs(Fichier, "TYPES_SOUS_TRAITABLES"), TypesDocument.SousTraitables);
    }
}
