using LogiBTP.Documents;

namespace LogiBTP.Domaine;

/// <summary>Entête d'un document BTP : spécialise l'entête générique du module Document (db/100_btp.sql).</summary>
public class DocumentBtp : Document
{
    /// <summary>D déboursé, V somme des PV.</summary>
    public string EntModeCalculOuvrage { get; set; } = "V";
    /// <summary>Coefficient de frais annexes calculé.</summary>
    public decimal EntCoefFa { get; set; } = 1;
}
