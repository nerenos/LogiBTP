namespace LogiBTP.Documents;

/// <summary>Condition de paiement (condition_paiement) : lignes { pct, delai, base, jour, mode } en JSON.</summary>
public class ConditionPaiement
{
    public string CpaCode { get; set; } = "";
    public string CpaLibelle { get; set; } = "";
    public System.Text.Json.JsonDocument CpaLignes { get; set; } = System.Text.Json.JsonDocument.Parse("[]");
    public short CpaOrdre { get; set; }
    public bool CpaActif { get; set; } = true;
}

/// <summary>Échéance d'une pièce validée (document_echeance) ; RETENUE : retenue de garantie, datée à sa libération.</summary>
public class DocumentEcheance
{
    public long EchId { get; set; }
    public long EchEntId { get; set; }
    public short EchRang { get; set; }
    public DateOnly? EchDate { get; set; }
    public decimal EchMontant { get; set; }
    public string? EchMode { get; set; }
    public string EchNature { get; set; } = "NORMALE";
    /// <summary>Échéance modifiée à la main (dates, montants, modes) après le calcul.</summary>
    public bool EchManuel { get; set; }
}
