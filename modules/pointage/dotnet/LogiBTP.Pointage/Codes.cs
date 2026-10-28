namespace LogiBTP.Pointage;

// Codes du module Pointage, répliqués dans modules/pointage/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>États d'une demande de congé.</summary>
public static class EtatConge
{
    public const string Demande = "DEMANDE";
    public const string Valide = "VALIDE";
    public const string Refuse = "REFUSE";
    public const string Annule = "ANNULE";
}

/// <summary>Codes d'erreur testés par l'interface.</summary>
public static class ErreursPointage
{
    public const string PoiValide = "POI_VALIDE";
    public const string BorneJeton = "BORNE_JETON";
}
