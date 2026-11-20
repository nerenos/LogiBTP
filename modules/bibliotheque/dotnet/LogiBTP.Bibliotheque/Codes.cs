namespace LogiBTP.Bibliotheque;

// Codes du module Bibliothèque, répliqués dans modules/bibliotheque/js/src/codes.js (parité vérifiée par BibliothequeTests.cs).

/// <summary>Type de gestion d'un élément (ele_gestion).</summary>
public static class GestionElement
{
    public const string Stock = "STOCK";
    public const string Achat = "ACHAT";
    public const string SousTraitance = "SOUS_TRAITANCE";
    public const string NonGere = "NON_GERE";
}

/// <summary>Scénario de prix d'achat d'un élément (ele_scenario_pa).</summary>
public static class ScenarioPa
{
    public const string Fixe = "FIXE";
    public const string FournisseurPrincipal = "FOURNISSEUR_PRINCIPAL";
    public const string DernierPa = "DERNIER_PA";
    public const string MeilleurMin = "MEILLEUR_MIN";
    public const string MeilleurMax = "MEILLEUR_MAX";
    public const string Pmp = "PMP";
}

/// <summary>Action d'une mise à jour de la bibliothèque depuis un nouveau PA (<see cref="PaReference.Planifier"/>).</summary>
public static class ActionMajPa
{
    public const string PaFixe = "PA_FIXE";
    public const string Tarif = "TARIF";
    public const string NouveauTarif = "NOUVEAU_TARIF";
    public const string Aucune = "AUCUNE";
}

/// <summary>Motif d'une mise à jour impossible (action AUCUNE) ou refusée.</summary>
public static class MotifMajPa
{
    public const string ScenarioCalcule = "SCENARIO_CALCULE";
    public const string TarifPrincipalAbsent = "TARIF_PRINCIPAL_ABSENT";
    public const string UniteTarif = "UNITE_TARIF";
    public const string PaInvalide = "PA_INVALIDE";
    public const string ElementCompose = "ELEMENT_COMPOSE";
    public const string ElementIntrouvable = "ELEMENT_INTROUVABLE";
    public const string FicheEnModification = "FICHE_EN_MODIFICATION";
    public const string EmpreinteChangee = "EMPREINTE_CHANGEE";
    public const string FournisseurObligatoire = "FOURNISSEUR_OBLIGATOIRE";
}

/// <summary>Origine du PA de référence d'un élément (<see cref="PaReference.Calculer"/>).</summary>
public static class SourcePaReference
{
    public const string TarifFournisseur = "TARIF_FOURNISSEUR";
    public const string PaEffectif = "PA_EFFECTIF";
}

/// <summary>Genre d'un poste de pied (ele_pied_genre, recopié dans lig_proprietes.genre_poste).</summary>
public static class GenrePoste
{
    public const string Remise = "REMISE";
    public const string Prorata = "PRORATA";
    public const string Acompte = "ACOMPTE";
    public const string PaiementDirect = "PAIEMENT_DIRECT";
    public const string Retenue = "RETENUE";
    public const string Autre = "AUTRE";
}

/// <summary>Type d'un élément (ele_type).</summary>
public static class TypeElement
{
    public const string Article = "ARTICLE";
    public const string Ouvrage = "OUVRAGE";
    public const string Ensemble = "ENSEMBLE";
    public const string PostePied = "POSTE_PIED";
    public const string Texte = "TEXTE";

    /// <summary>Élément vendu (article, ouvrage) : sa nature est obligatoire. Réplique de elementVendu (codes.js).</summary>
    public static bool EstVendu(string? type) => type is Article or Ouvrage;
}
