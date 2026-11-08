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
    public const string AcomptePaye = "ACOMPTE_PAYE";
    public const string AcompteUtilise = "ACOMPTE_UTILISE";
    public const string Production = "PRODUCTION";
    // Saisies prévisionnelles (lot 6, § 10.1) : jamais mélangées au réel.
    public const string PrevuBudget = "PREVU_BUDGET";
    public const string PrevuExecution = "PREVU_EXECUTION";
    public const string PrevuEngage = "PREVU_ENGAGE";
    public const string PrevuDebourse = "PREVU_DEBOURSE";
    public const string PrevuFacture = "PREVU_FACTURE";
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
    public const string Acompte = "ACOMPTE";
    // Refacturation interne du matériel (lot 6) : produit crédité au chantier de suivi, sans pièce ni écriture comptable.
    public const string ProduitInterne = "PRODUIT_INTERNE";
}

/// <summary>Source d'un fait.</summary>
public static class SourceFait
{
    public const string Document = "DOCUMENT";
    public const string Pointage = "POINTAGE";
    public const string Tache = "TACHE";
    public const string Mouvement = "MOUVEMENT";
    public const string Reglement = "REGLEMENT";
    public const string PointageMateriel = "POINTAGE_MATERIEL";
    public const string Prevision = "PREVISION";
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

/// <summary>Borne d'une période saisie (Periodes.Lire).</summary>
public static class BornePeriode
{
    public const string Debut = "DEBUT";
    public const string Fin = "FIN";
}

/// <summary>Raccourcis de période.</summary>
public static class RaccourciPeriode
{
    public const string Mois = "MOIS";
    public const string MoisPrecedent = "MOIS_PRECEDENT";
    public const string Exercice = "EXERCICE";
    public const string Origine = "ORIGINE";
}

/// <summary>Erreurs de saisie d'une période.</summary>
public static class ErreurPeriode
{
    public const string Date = "PERIODE_DATE";
    public const string Ordre = "PERIODE_ORDRE";
}

/// <summary>Type d'une photo (copie figée des faits d'un chantier à une date).</summary>
public static class TypePhoto
{
    public const string Mois = "MOIS";
    public const string Manuel = "MANUEL";
}

/// <summary>Niveaux d'origine de la Liste.</summary>
public static class NiveauListe
{
    public const string Charge = "CHARGE";
    public const string Affaire = "AFFAIRE";
}

/// <summary>État d'une saisie prévisionnelle : ouverte, échue (échéance passée sans solde), soldée.</summary>
public static class EtatPrevision
{
    public const string Ouverte = "OUVERTE";
    public const string Echue = "ECHUE";
    public const string Soldee = "SOLDEE";
}

/// <summary>Action du journal d'une saisie prévisionnelle.</summary>
public static class ActionPrevision
{
    public const string Creation = "CREATION";
    public const string Modification = "MODIFICATION";
    public const string Solde = "SOLDE";
    public const string Reouverture = "REOUVERTURE";
    public const string Suppression = "SUPPRESSION";
}

/// <summary>Erreurs de saisie d'une prévision.</summary>
public static class ErreurPrevision
{
    public const string Indicateur = "PREVISION_INDICATEUR";
    public const string Composante = "PREVISION_COMPOSANTE";
    public const string Libelle = "PREVISION_LIBELLE";
    public const string Montant = "PREVISION_MONTANT";
    public const string Soldee = "PREVISION_SOLDEE";
    public const string Version = "PREVISION_VERSION";
}

/// <summary>Mode de saisie d'un mois du prévisionnel de facturation (lot 7) : montant HT ou % du budget PV.</summary>
public static class ModeFacturation
{
    public const string Montant = "MONTANT";
    public const string Pourcent = "POURCENT";
}

/// <summary>Erreurs d'une prévision de facturation.</summary>
public static class ErreurFacturation
{
    public const string Mois = "FACTURATION_MOIS";
    public const string Doublon = "FACTURATION_DOUBLON";
    public const string Mode = "FACTURATION_MODE";
    public const string Valeur = "FACTURATION_VALEUR";
    public const string Budget = "FACTURATION_BUDGET";
    public const string Version = "FACTURATION_VERSION";
}
