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
