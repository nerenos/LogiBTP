namespace LogiBTP.Reglements;

// Codes du module Règlements, répliqués dans modules/reglement/js/src/codes.js (parité vérifiée par CodesTests).

/// <summary>Modes de règlement posés par le module (hors liste paramétrable des modes de règlement).</summary>
public static class ModeReglementSysteme
{
    public const string Imputation = "IMPUTATION";
}

/// <summary>Origine d'un pointage d'échéance : règlement, caution, imputation d'un avoir sur une autre pièce.</summary>
public static class SourcePointage
{
    public const string Reglement = "REGLEMENT";
    public const string Caution = "CAUTION";
    public const string Imputation = "IMPUTATION";
}
