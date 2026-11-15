namespace LogiBTP.Fiches;

// Codes du module Fiche, répliqués dans modules/fiche/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Codes d'erreur testés par l'interface.</summary>
public static class ErreursFiche
{
    public const string VerrouPerdu = "VERROU_PERDU";
    public const string FicheEnModification = "FICHE_EN_MODIFICATION";
    public const string FicheUtilisee = "FICHE_UTILISEE";
    /// <summary>Code déjà porté par une autre fiche (création : code suivant proposé).</summary>
    public const string CodePris = "CODE_PRIS";
}

/// <summary>Largeur d'un groupe de champs dans l'onglet ; absente = une colonne de la grille des groupes.</summary>
public static class LargeursGroupe
{
    /// <summary>Toute la largeur de l'onglet (notes…).</summary>
    public const string Plein = "plein";
}

/// <summary>Disposition des champs dans un groupe ; absente = grille.</summary>
public static class DispositionsGroupe
{
    /// <summary>Colonnes de même largeur (11rem au moins), le champ « plein » sur toute la ligne.</summary>
    public const string Grille = "grille";
    /// <summary>Champs à la suite, à la largeur de leur contenu, retour à la ligne si besoin.</summary>
    public const string Flex = "flex";
}

/// <summary>Types d'un champ supplémentaire en colonne x_ (registre fiche_champ_supplementaire, fonction fiche_champ_creer).</summary>
public static class TypesChampSupplementaire
{
    public const string Texte = "texte";
    public const string Nombre = "nombre";
    /// <summary>Montant : numeric(18,2).</summary>
    public const string Montant = "montant";
    public const string Date = "date";
    /// <summary>Case à cocher : boolean.</summary>
    public const string CaseACocher = "booleen";
    /// <summary>Liste de valeurs : text, valeurs du registre.</summary>
    public const string Liste = "liste";
}

/// <summary>Erreurs de l'administration des champs supplémentaires (code des ErreurChamp d'une réponse 422 VALIDATION).</summary>
public static class ErreursChampSupplementaire
{
    public const string NomInvalide = "CHAMP_NOM_INVALIDE";
    public const string TypeInvalide = "CHAMP_TYPE_INVALIDE";
    public const string LibelleObligatoire = "CHAMP_LIBELLE_OBLIGATOIRE";
    public const string TableFermee = "CHAMP_TABLE_FERMEE";
    public const string Existe = "CHAMP_EXISTE";
    public const string Inconnu = "CHAMP_INCONNU";
    public const string Valeurs = "CHAMP_VALEURS";
}
