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
