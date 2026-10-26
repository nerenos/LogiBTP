using System.Text.Json;

namespace LogiBTP.Documents;

/// <summary>
/// Ligne de document générique (table document_ligne du module Document). La hiérarchie repose sur
/// LigParentId et LigOrdre ; LigChemin (ltree) en est dérivé. Classe mère : le cœur ou un module la
/// spécialise en ajoutant ses colonnes (DocumentLigneBtp). Les propriétés doivent rester alignées avec
/// COLONNES_LIGNE du module JS (modules/document/js/src/types.js) : un test le vérifie.
/// </summary>
public class DocumentLigne
{
    public long LigId { get; set; }
    public long LigEntId { get; set; }
    public long? LigParentId { get; set; }
    public string? LigChemin { get; set; }
    public int LigOrdre { get; set; }
    public short LigTylId { get; set; }

    // Numérotation
    public string? LigNumerotation { get; set; }
    public string? LigNumDepart { get; set; }
    public bool LigNumManuelle { get; set; }

    // Identification et libellés
    public string? LigCode { get; set; }
    public string? LigLibelleHtml { get; set; }
    public string? LigLibelleAffiche { get; set; }
    public string? LigLibelleBrut { get; set; }
    public long? LigArtId { get; set; }
    public string? LigCptCode { get; set; }
    public long? LigFichierId { get; set; }

    // Quantités
    public decimal? LigQte { get; set; }
    /// <summary>R relative (par unité du parent), A absolue pour le parent direct.</summary>
    public string? LigQteType { get; set; }
    public decimal? LigQteVendue { get; set; }
    public decimal? LigQteTotale { get; set; }
    public string? LigUntCode { get; set; }
    public short LigPrecisionQte { get; set; } = 2;

    // Prix
    public decimal? LigPv { get; set; }
    /// <summary>Multiplicateur : 0,90 = remise de 10 %.</summary>
    public decimal LigCoefRemise { get; set; } = 1;
    public decimal? LigPvRemise { get; set; }
    public short LigPrecisionPv { get; set; } = 2;
    /// <summary>V vendu, O option, M pour mémoire, A variante.</summary>
    public string LigTypePrix { get; set; } = "V";
    public long? LigVarianteDeId { get; set; }
    public long? LigStDepuisId { get; set; }

    // Montants
    public decimal? LigMontantHt { get; set; }

    // Lignes de pied
    /// <summary>P pourcentage, M montant, C coefficient (base × (valeur − 1)).</summary>
    public string? LigPiedMode { get; set; }
    /// <summary>CUMUL, TOTAL_HT, HT_NET, TOTAL_TTC, LIGNE (sous-total de pied LigPiedBaseId).</summary>
    public string? LigPiedBase { get; set; }
    public long? LigPiedBaseId { get; set; }
    public short? LigPiedSens { get; set; }
    public decimal? LigPiedValeur { get; set; }
    public decimal? LigBaseCalcul { get; set; }
    public decimal? LigMontantTva { get; set; }

    // TVA
    public int? LigTvaId { get; set; }
    public decimal? LigTauxTva { get; set; }

    // Divers
    public string? LigCommentaire { get; set; }
    public bool LigIsNonEditee { get; set; }
    public long? LigOrigineId { get; set; }
    /// <summary>Ligne issue d'une transformation : solde la ligne du parent à la validation (reste clos).</summary>
    public bool LigSolde { get; set; }
    /// <summary>Poste de pied retenu (retenue de garantie) : échéance RETENUE séparée dans l'échéancier.</summary>
    public bool LigPiedRetenue { get; set; }
    /// <summary>Date de livraison propre à la ligne ; null = date par défaut de l'entête fournie par l'application (019l).</summary>
    public DateOnly? LigDateLivraison { get; set; }

    // Avancement (situations, factures d'avancement) : saisie P / Q / M, ligne du marché, précédent, cumul calculé.
    public string? LigAvtMode { get; set; }
    public decimal? LigAvtValeur { get; set; }
    public decimal? LigAvtQteMarche { get; set; }
    public decimal? LigAvtMontantMarche { get; set; }
    public decimal? LigAvtMontantPrecedent { get; set; }
    public decimal? LigAvtQtePrecedent { get; set; }
    public decimal? LigAvtPctPrecedent { get; set; }
    public decimal? LigAvtMontantCumul { get; set; }
    public decimal? LigAvtQteCumul { get; set; }
    public decimal? LigAvtPct { get; set; }
    /// <summary>Ligne de la commande (du marché) suivie par l'avancement : précédents des documents d'avancement.</summary>
    public long? LigAvtSourceLigId { get; set; }
    public JsonDocument? LigProprietes { get; set; }
    /// <summary>Étiquette de couleur de la ligne (à vérifier, prix confirmé…).</summary>
    public string? LigEtiquette { get; set; }
}
