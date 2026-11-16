namespace LogiBTP.Import;

// Codes du module Import, répliqués dans modules/import/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Logiciel d'origine d'une reprise de base.</summary>
public static class SourceReprise
{
    public const string Mde = "MDE";
    public const string Optim = "OPTIM";
}

/// <summary>Erreurs de validation d'un fichier de correspondances.</summary>
public static class ErreurCorrespondance
{
    public const string FormatInvalide = "REPRISE_FORMAT_INVALIDE";
    public const string SourceInconnue = "REPRISE_SOURCE_INCONNUE";
    public const string SourceDifferente = "REPRISE_SOURCE_DIFFERENTE";
    public const string TableManquante = "REPRISE_TABLE_MANQUANTE";
    public const string TableInconnue = "REPRISE_TABLE_INCONNUE";
    public const string ListeCiblesInconnue = "REPRISE_LISTE_CIBLES_INCONNUE";
    public const string SourceVide = "REPRISE_SOURCE_VIDE";
    public const string ValeurEnDouble = "REPRISE_VALEUR_EN_DOUBLE";
    public const string SansCible = "REPRISE_SANS_CIBLE";
    public const string CibleEtIgnorer = "REPRISE_CIBLE_ET_IGNORER";
    public const string MotifManquant = "REPRISE_MOTIF_MANQUANT";
    public const string CibleInconnue = "REPRISE_CIBLE_INCONNUE";
}

/// <summary>État des suites d'une pièce source (contrôle des liens de transformation recréés).</summary>
public static class EtatSuite
{
    public const string EnCours = "EN_COURS";
    public const string Partielle = "PARTIELLE";
    public const string Totale = "TOTALE";
    public const string Soldee = "SOLDEE";
}

/// <summary>Part sous-traitée d'une ligne de vente source.</summary>
public static class PartSousTraitance
{
    public const string Aucune = "AUCUNE";
    public const string HorsFourniture = "HORS_FOURNITURE";
    public const string Totale = "TOTALE";
}

/// <summary>Mode d'avancement d'une situation source.</summary>
public static class ModeAvancement
{
    public const string Detaille = "DETAILLE";
    public const string GlobalCumul = "GLOBAL_CUMUL";
    public const string GlobalSituation = "GLOBAL_SITUATION";
}

/// <summary>État d'une exécution de reprise (import_reprise.irp_etat).</summary>
public static class EtatReprise
{
    public const string EnCours = "EN_COURS";
    public const string Terminee = "TERMINEE";
    public const string Echec = "ECHEC";
}

/// <summary>Refus du moteur de reprise.</summary>
public static class ErreurReprise
{
    public const string BaseNonVide = "REPRISE_BASE_NON_VIDE";
    public const string DomaineEnDouble = "REPRISE_DOMAINE_EN_DOUBLE";
    public const string DependanceInconnue = "REPRISE_DEPENDANCE_INCONNUE";
    public const string Cycle = "REPRISE_CYCLE";
    public const string CorrespondancesInvalides = "REPRISE_CORRESPONDANCES_INVALIDES";
    public const string SourceIncompatible = "REPRISE_SOURCE_INCOMPATIBLE";
}

/// <summary>Niveau d'une anomalie du rapport de reprise.</summary>
public static class NiveauAnomalie
{
    public const string Information = "INFORMATION";
    public const string Avertissement = "AVERTISSEMENT";
    public const string Bloquant = "BLOQUANT";
}

/// <summary>Refus d'un enregistrement des fusions de doublons (import_fusion).</summary>
public static class ErreurFusion
{
    public const string GroupeVide = "REPRISE_FUSION_VIDE";
    public const string CleEnDouble = "REPRISE_FUSION_CLE_EN_DOUBLE";
    public const string ConserveeFusionnee = "REPRISE_FUSION_CONSERVEE_FUSIONNEE";
}

/// <summary>Codes des anomalies signalées par les domaines de la reprise (rapport) ↔ CODE_ANOMALIE.</summary>
public static class CodeAnomalie
{
    public const string DeviseEtrangere = "REPRISE_DEVISE_ETRANGERE";
    public const string Decimales = "REPRISE_DECIMALES";
    public const string CodeRenomme = "REPRISE_CODE_RENOMME";
    public const string SocieteManquante = "REPRISE_SOCIETE_MANQUANTE";
    public const string SocieteInconnue = "REPRISE_SOCIETE_INCONNUE";
    public const string SirenDifferents = "REPRISE_SIREN_DIFFERENTS";
    public const string SansEquivalent = "REPRISE_SANS_EQUIVALENT";
    public const string ValeurInconnue = "REPRISE_VALEUR_INCONNUE";
}
