namespace LogiBTP.Socle;

// Codes communs aux modules, répliqués dans socle/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Niveau d'une notification ou d'une alerte (du moins au plus pressant).</summary>
public static class NiveauNotification
{
    public const string Info = "INFO";
    public const string Attention = "ATTENTION";
    public const string Urgent = "URGENT";

    public static readonly string[] Tous = [Info, Attention, Urgent];
}

/// <summary>Profils connus du code (les autres profils sont du paramétrage) : ADMIN = profil total, BORNE = saisies d'une borne.</summary>
public static class Profils
{
    public const string Admin = "ADMIN";
    public const string Borne = "BORNE";
}

/// <summary>
/// Actions des droits (contrat <c>IDroits</c>) : les sept actions du modèle en cascade, les actions propres à un nœud
/// (RGPD, SUPERVISER, USURPER) et les noms employés par les modules, ramenés au modèle par le module Droits.
/// </summary>
public static class ActionsDroits
{
    public const string Consulter = "CONSULTER";
    public const string Modifier = "MODIFIER";
    public const string Valider = "VALIDER";
    public const string Creer = "CREER";
    public const string Supprimer = "SUPPRIMER";
    public const string Deverrouiller = "DEVERROUILLER";
    public const string Forcer = "FORCER";
    public const string Rgpd = "RGPD";
    public const string Superviser = "SUPERVISER";
    public const string Usurper = "USURPER";
    public const string Parametrer = "PARAMETRER";
    public const string Voir = "VOIR";
    public const string Transformer = "TRANSFORMER";
    public const string Approuver = "APPROUVER";
    public const string Devalider = "DEVALIDER";
    public const string Debloquer = "DEBLOQUER";
    public const string Confidentiel = "CONFIDENTIEL";
    /// <summary>Modifier le code d'une fiche déjà créée (module Fiche).</summary>
    public const string ModifierCode = "MODIFIER_CODE";

    /// <summary>Actions du modèle, en cascade (l'interface coche les précédentes).</summary>
    public static readonly IReadOnlyList<string> Cascade = [Consulter, Modifier, Valider, Creer, Supprimer, Deverrouiller, Forcer];
}

/// <summary>Portées d'une action accordée par le module Droits (de la plus étroite à la plus large).</summary>
public static class PorteesDroits
{
    public const string Soi = "SOI";
    public const string Equipe = "EQUIPE";
    public const string Service = "SERVICE";
    public const string Tout = "TOUT";
}

/// <summary>Niveaux de confidentialité (GED, modèles d'édition), du plus ouvert au plus strict.</summary>
public static class NiveauConfidentialite
{
    public const string Public = "PUBLIC";
    public const string Interne = "INTERNE";
    public const string Confidentiel = "CONFIDENTIEL";
    public const string Secret = "SECRET";

    public static readonly string[] Tous = [Public, Interne, Confidentiel, Secret];
}

/// <summary>
/// Erreurs communes de l'enregistrement des données (socle <c>LogiBTP.Socle.Donnees</c>) : refus de la base traduits
/// (<c>ErreursBase</c>) et refus de saisie (422 VALIDATION, détails = erreurs par champ).
/// </summary>
public static class ErreursEnregistrement
{
    /// <summary>Saisie refusée par les contrôles du serveur : détails = liste d'erreurs par champ (champ, code, message).</summary>
    public const string Validation = "VALIDATION";
    /// <summary>Unicité (23505), 409.</summary>
    public const string Doublon = "DOUBLON";
    /// <summary>Clé étrangère (23503) : élément utilisé ailleurs, ou lié introuvable, 409.</summary>
    public const string Utilise = "UTILISE";
    /// <summary>Valeur refusée par la base (NOT NULL, CHECK, conversion, trigger), 422.</summary>
    public const string Valeur = "VALEUR";
    /// <summary>Code d'une erreur par champ : valeur obligatoire.</summary>
    public const string Obligatoire = "OBLIGATOIRE";
    /// <summary>Élément d'un traitement en lot en erreur technique (journalisée).</summary>
    public const string Erreur = "ERREUR";
}
