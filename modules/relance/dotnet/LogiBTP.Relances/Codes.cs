namespace LogiBTP.Relances;

// Codes du module Relances, répliqués dans modules/relance/js/src/codes.js (parité vérifiée par CodesTests).

/// <summary>Nature d'une pièce relancée : devis envoyé ou facture à reste échu.</summary>
public static class NatureRelance
{
    public const string Devis = "DEVIS";
    public const string Facture = "FACTURE";
}

/// <summary>Mode d'une relance : courriel, lettre simple, lettre recommandée, tâche d'appel du CRM (devis seulement).</summary>
public static class ModeRelance
{
    public const string Courriel = "COURRIEL";
    public const string Courrier = "COURRIER";
    public const string Recommande = "RECOMMANDE";
    public const string Tache = "TACHE";

    public static readonly string[] Tous = [Courriel, Courrier, Recommande, Tache];
}

/// <summary>État d'une relance du journal.</summary>
public static class EtatRelance
{
    public const string Proposee = "PROPOSEE";
    public const string Envoyee = "ENVOYEE";
    public const string AttenteNumero = "ATTENTE_NUMERO";
    public const string Annulee = "ANNULEE";
}

/// <summary>État d'un lot de relances : préparé (rien d'envoyé), envoyé (clos), partiel (une partie envoyée).</summary>
public static class EtatLotRelance
{
    public const string Prepare = "PREPARE";
    public const string Envoye = "ENVOYE";
    public const string Partiel = "PARTIEL";
}

/// <summary>Motif d'une suspension de relance (pièce ou tiers).</summary>
public static class MotifSuspension
{
    public const string Litige = "LITIGE";
    public const string Promesse = "PROMESSE";
    public const string Echelonnement = "ECHELONNEMENT";
    public const string Autre = "AUTRE";

    public static readonly string[] Tous = [Litige, Promesse, Echelonnement, Autre];
}

/// <summary>Erreurs de contrôle d'une règle de relance et du service (journal, lots, suspensions).</summary>
public static class ErreurRelance
{
    public const string RegleSansNiveau = "RELANCE_REGLE_SANS_NIVEAU";
    public const string RegleTropDeNiveaux = "RELANCE_REGLE_TROP_DE_NIVEAUX";
    public const string NiveauRang = "RELANCE_NIVEAU_RANG";
    public const string NiveauDelai = "RELANCE_NIVEAU_DELAI";
    public const string NiveauMode = "RELANCE_NIVEAU_MODE";
    public const string RegleIntervalle = "RELANCE_REGLE_INTERVALLE";
    public const string Nature = "RELANCE_NATURE";
    public const string SuspensionCible = "RELANCE_SUSPENSION_CIBLE";
    public const string SuspensionMotif = "RELANCE_SUSPENSION_MOTIF";
    public const string SuspensionDate = "RELANCE_SUSPENSION_DATE";
    public const string LotClos = "RELANCE_LOT_CLOS";
    public const string GroupeInconnu = "RELANCE_GROUPE_INCONNU";
    public const string Mode = "RELANCE_MODE";
    public const string HorsPortee = "RELANCE_HORS_PORTEE";
    public const string PasEnAttenteNumero = "RELANCE_PAS_EN_ATTENTE_NUMERO";
    public const string NumeroVide = "RELANCE_NUMERO_VIDE";
    public const string RienANoter = "RELANCE_RIEN_A_NOTER";
}
