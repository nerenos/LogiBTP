namespace LogiBTP.Mail;

// Codes du module Mail, répliqués dans modules/mail/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Codes d'erreur testés par l'interface.</summary>
public static class ErreursMail
{
    public const string MailConfirmation = "MAIL_CONFIRMATION";
}

/// <summary>Type d'une reconnaissance spécialisée d'un courriel.</summary>
public static class TypeReconnaissance
{
    public const string AccuseReception = "ACCUSE_RECEPTION";
}

/// <summary>Précision de la livraison annoncée par un accusé de réception.</summary>
public static class PrecisionLivraison
{
    public const string Jour = "JOUR";
    public const string Semaine = "SEMAINE";
}
