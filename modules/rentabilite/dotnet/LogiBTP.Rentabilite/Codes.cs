namespace LogiBTP.Rentabilite;

// Codes du module Rentabilité, répliqués dans modules/rentabilite/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Indicateurs portés par les faits (flux datés : la somme jusqu'à T donne l'état ou le cumul à T).</summary>
public static class Indicateur
{
    public const string Budget = "BUDGET";
    public const string BudgetExecution = "BUDGET_EXECUTION";
    public const string Engage = "ENGAGE";
    public const string Debourse = "DEBOURSE";
    public const string Facture = "FACTURE";
}

/// <summary>Composante d'un fait (colonne de détail des indicateurs de coût).</summary>
public static class Composante
{
    public const string Vente = "VENTE";
    public const string Achat = "ACHAT";
    public const string SousTraitance = "SOUS_TRAITANCE";
    public const string Mo = "MO";
    public const string Materiel = "MATERIEL";
    public const string Stock = "STOCK";
    public const string Poste = "POSTE";
}

/// <summary>Source d'un fait.</summary>
public static class SourceFait
{
    public const string Document = "DOCUMENT";
    public const string Pointage = "POINTAGE";
    public const string Tache = "TACHE";
    public const string Mouvement = "MOUVEMENT";
}

/// <summary>État d'un calcul (rca_etat).</summary>
public static class EtatCalcul
{
    public const string EnCours = "EN_COURS";
    public const string Ok = "OK";
    public const string Erreur = "ERREUR";
}

/// <summary>Déclencheur d'un calcul (rca_declencheur).</summary>
public static class Declencheur
{
    public const string File = "FILE";
    public const string Nuit = "NUIT";
    public const string Manuel = "MANUEL";
}
