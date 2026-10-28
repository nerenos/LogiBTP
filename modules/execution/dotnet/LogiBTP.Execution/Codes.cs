namespace LogiBTP.Execution;

// Codes du module Exécution, répliqués dans modules/execution/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>États d'exécution propres à un ordre (ent_exe_etat), du moins au plus avancé.</summary>
public static class EtatOrdre
{
    public const string AFaire = "A_FAIRE";
    public const string EnAttente = "EN_ATTENTE";
    public const string EnCours = "EN_COURS";
    public const string Bloque = "BLOQUE";
    public const string Termine = "TERMINE";
}

/// <summary>
/// Statuts documentaires lus par l'état d'un ordre : copie déclarée de StatutsDocument du module Document (le module n'en
/// dépend pas), vérifiée par client/test/codes.test.js.
/// </summary>
public static class StatutOrdre
{
    public const string Brouillon = "BROUILLON";
    public const string Solde = "SOLDE";
    public const string Annule = "ANNULE";
    public const string Remplace = "REMPLACE";
}
