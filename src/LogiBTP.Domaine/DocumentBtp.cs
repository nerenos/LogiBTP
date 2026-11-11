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

    // Facture de sous-traitance (module Sous-traitance, db/213) : saisie à l'avancement ou facture reçue du sous-traitant,
    // montants de sa facture saisis (contrôlés à la validation contre le total ventilé).
    public string? EntStSaisie { get; set; }
    public decimal? EntStRecuHt { get; set; }
    public decimal? EntStRecuTva { get; set; }
    public decimal? EntStRecuTtc { get; set; }

    // Stock (module Stock, db/216) : date-heure du mouvement (validation par défaut), lieux d'origine et de destination.
    public DateTimeOffset? EntDateMouvement { get; set; }
    public int? EntStkOrigineId { get; set; }
    public int? EntStkDestinationId { get; set; }
    // Révision des prix (db/250) : mois des travaux d'une facture d'avancement (vide : mois de la date de la pièce).
    public DateOnly? EntMoisRevision { get; set; }
    // Facturation électronique (db/299) : nature de la pièce imposée (B, S, M ; NaturesFe), vide : calculée sur les lignes vendues.
    public string? EntFeNature { get; set; }
    // Approvisionnement (db/218) : date de besoin d'une réservation, date de livraison prévue d'une commande fournisseur.
    public DateOnly? EntDateBesoin { get; set; }
    public DateOnly? EntDateLivraison { get; set; }
    // Accusé de réception d'une commande (db/238) : modifié par PUT /api/structure/documents/{id}/arc (même validée),
    // jamais par l'enregistrement du document ; livraison confirmée = date par défaut des lignes à la place de EntDateLivraison.
    public string? EntArcNumero { get; set; }
    public DateOnly? EntArcDate { get; set; }
    public DateOnly? EntArcLivraison { get; set; }

    // Exécution (module Exécution, db/197) : état propre de l'ordre, motif de blocage, service porteur, responsable,
    // dates prévues ; modifiés par la route de l'exécution, jamais par l'enregistrement du document.
    public string? EntExeEtat { get; set; }
    public int? EntExeMotifId { get; set; }
    public string? EntExeCommentaire { get; set; }
    public int? EntSrvId { get; set; }
    public long? EntResponsableId { get; set; }
    public DateOnly? EntDebutPrevu { get; set; }
    public DateOnly? EntFinPrevue { get; set; }
}
