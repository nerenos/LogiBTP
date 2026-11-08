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

/// <summary>Erreurs de contrôle d'une règle de relance.</summary>
public static class ErreurRelance
{
    public const string RegleSansNiveau = "RELANCE_REGLE_SANS_NIVEAU";
    public const string RegleTropDeNiveaux = "RELANCE_REGLE_TROP_DE_NIVEAUX";
    public const string NiveauRang = "RELANCE_NIVEAU_RANG";
    public const string NiveauDelai = "RELANCE_NIVEAU_DELAI";
    public const string NiveauMode = "RELANCE_NIVEAU_MODE";
    public const string RegleIntervalle = "RELANCE_REGLE_INTERVALLE";
}
