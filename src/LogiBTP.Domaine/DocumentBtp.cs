using System.Text.Json;
using LogiBTP.Documents;

namespace LogiBTP.Domaine;

/// <summary>Entête d'un document BTP : spécialise l'entête générique du module Document (db/100_btp.sql).</summary>
public class DocumentBtp : Document
{
    /// <summary>D déboursé, V somme des PV, B bordereau (PV fixe d'ouvrage sans ventilation, db/166).</summary>
    public string EntModeCalculOuvrage { get; set; } = "V";
    /// <summary>Coefficient de frais annexes moyen des lignes vendues (information).</summary>
    public decimal EntCoefFa { get; set; } = 1;
    /// <summary>Lignes hors vente qui reçoivent des frais annexes : V aucune, OA options et variantes, OAM et pour mémoire (db/167).</summary>
    public string? EntFaLignes { get; set; } = "V";
    /// <summary>Options reçoivent les frais : C au coefficient moyen des lignes vendues, B dans la base de répartition.</summary>
    public string? EntFaMode { get; set; } = "C";
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
    /// <summary>Coordonnées figées du client (ou du fournisseur) : instantané de l'annuaire pour les éditions (db/177).</summary>
    public JsonDocument? EntContactClient { get; set; }
    /// <summary>Coordonnées figées du payeur (ventes).</summary>
    public JsonDocument? EntContactPayeur { get; set; }
}
