using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/facture-electronique/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "facture-electronique", "js", "src", "codes.js");

    [Theory]
    [InlineData("TYPE_FACTURE", typeof(TypeFacture))]
    [InlineData("CADRE_FACTURATION", typeof(CadreFacturation))]
    [InlineData("CATEGORIE_TVA", typeof(CategorieTva))]
    [InlineData("TRAITEMENT", typeof(Traitement))]
    [InlineData("CODE_NOTE", typeof(CodeNote))]
    [InlineData("SOUS_TYPE_LIGNE", typeof(SousTypeLigne))]
    [InlineData("STATUT_CDV", typeof(StatutCdv))]
    [InlineData("EMETTEUR_STATUT", typeof(EmetteurStatut))]
    [InlineData("SENS_FACTURE", typeof(SensFacture))]
    [InlineData("MOTIF_STATUT", typeof(MotifStatut))]
    [InlineData("ACTION_CDV", typeof(ActionCdv))]
    [InlineData("SYNTAXE", typeof(Syntaxe))]
    [InlineData("PROFIL_FACTURE", typeof(ProfilFacture))]
    [InlineData("SPECIFICATION_FACTURE", typeof(SpecificationFacture))]
    [InlineData("TYPE_DOCUMENT_REFERENCE", typeof(TypeDocumentReference))]
    [InlineData("SCHEMA_IDENTIFIANT", typeof(SchemaIdentifiant))]
    [InlineData("MATRICULE_PLATEFORME", typeof(MatriculePlateforme))]
    [InlineData("ROLE_CDAR", typeof(RoleCdar))]
    [InlineData("TYPE_ACCUSE_CDAR", typeof(TypeAccuseCdar))]
    [InlineData("PROCESSUS_CDV", typeof(ProcessusCdv))]
    [InlineData("PROFIL_CDV", typeof(ProfilCdv))]
    [InlineData("CARACTERISTIQUE_CDV", typeof(CaracteristiqueCdv))]
    [InlineData("CODE_EXIGIBILITE_TVA", typeof(CodeExigibiliteTva))]
    [InlineData("CODE_EXIGIBILITE_TVA_UBL", typeof(CodeExigibiliteTvaUbl))]
    [InlineData("TYPE_FLUX", typeof(TypeFlux))]
    [InlineData("SENS_FLUX", typeof(SensFlux))]
    [InlineData("REGLE_TRAITEMENT", typeof(RegleTraitement))]
    [InlineData("ETAT_ACCUSE", typeof(EtatAccuse))]
    [InlineData("ETAPE_CONTROLE", typeof(EtapeControle))]
    [InlineData("NIVEAU_CONTROLE", typeof(NiveauControle))]
    [InlineData("NIVEAU_ACCUSE", typeof(NiveauAccuse))]
    [InlineData("MOTIF_ACCUSE", typeof(MotifAccuse))]
    [InlineData("ETAT_FLUX", typeof(EtatFlux))]
    [InlineData("EVENEMENT_FE", typeof(EvenementFe))]
    [InlineData("ERREUR_FE", typeof(ErreurFe))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));

    [Fact]
    public void Listes_de_statuts_identiques_au_js()
    {
        Assert.Equal(Constantes.ListeJs(Fichier, "STATUTS_TERMINAUX"), StatutCdv.Terminaux);
        Assert.Equal(Constantes.ListeJs(Fichier, "STATUTS_MOTIF_OBLIGATOIRE"), StatutCdv.MotifObligatoire);
        Assert.Equal(Constantes.ListeJs(Fichier, "STATUTS_OBLIGATOIRES_PPF"), StatutCdv.ObligatoiresPpf);
    }

    [Fact]
    public void Listes_completes_dans_l_ordre_du_js()
    {
        Assert.Equal(Constantes.Js(Fichier, "STATUT_CDV").Values, StatutCdv.Tous);
        Assert.Equal(Constantes.Js(Fichier, "MOTIF_STATUT").Values, MotifStatut.Tous);
        Assert.Equal(Constantes.Js(Fichier, "ACTION_CDV").Values, ActionCdv.Tous);
    }
}
