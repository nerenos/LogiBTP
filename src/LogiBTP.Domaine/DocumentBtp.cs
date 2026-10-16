using System.Text.Json;
using LogiBTP.Documents;

namespace LogiBTP.Domaine;

/// <summary>Entête d'un document BTP : spécialise l'entête générique du module Document (db/100_btp.sql).</summary>
public class DocumentBtp : Document
{
    /// <summary>D déboursé, V somme des PV, B bordereau (PV fixe d'ouvrage sans ventilation, db/166).</summary>
    public string EntModeCalculOuvrage { get; set; } = "V";
    /// <summary>Coefficient de frais annexes calculé.</summary>
    public decimal EntCoefFa { get; set; } = 1;
    /// <summary>Bibliothèque des codes appelés sans préfixe (null : bibliothèque par défaut).</summary>
    public int? EntBibId { get; set; }
    /// <summary>Structure des affaires (db/160_structure.sql) : projet, affaire, chantier, marché.</summary>
    public int? EntProjetId { get; set; }
    public int? EntAffaireId { get; set; }
    public int? EntChantierId { get; set; }
    public int? EntMarcheId { get; set; }
    /// <summary>Annuaire du document (db/162_intervenants.sql) : instantané des intervenants (client, payeur, sous-traitants…).</summary>
    public JsonDocument? EntIntervenants { get; set; }
    /// <summary>Rédacteur du document : individu de l'annuaire.</summary>
    public long? EntRedacteurId { get; set; }
}
