namespace LogiBTP.Crm;

// Codes du module CRM, répliqués dans modules/crm/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Natures d'une note.</summary>
public static class NatureNote
{
    public const string Action = "ACTION";
    public const string Message = "MESSAGE";
    public const string Tache = "TACHE";
}

/// <summary>États d'une note.</summary>
public static class EtatNote
{
    public const string AFaire = "A_FAIRE";
    public const string EnCours = "EN_COURS";
    public const string Termine = "TERMINE";
    public const string Memo = "MEMO";
    public const string Annulee = "ANNULEE";
}
