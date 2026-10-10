using System.Text.Json;

namespace LogiBTP.Domaine;

/// <summary>
/// Ligne de document (table document_ligne). La hiérarchie repose sur LigParentId et LigOrdre ;
/// LigChemin (ltree) en est dérivé. Les propriétés doivent rester alignées avec
/// COLONNES_LIGNE du moteur JS (client/src/calcul/types.js).
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
    public int? LigNatId { get; set; }
    public int? LigPtvId { get; set; }
    public string? LigCptCode { get; set; }
    public long? LigFichierId { get; set; }

    // Quantités
    public decimal? LigQte { get; set; }
    /// <summary>R relative (par unité du parent), A absolue pour le parent direct.</summary>
    public string? LigQteType { get; set; }
    public long? LigMtrId { get; set; }
    /// <summary>S saisie, M métré.</summary>
    public string LigQteSource { get; set; } = "S";
    public decimal? LigQteBase { get; set; }
    public decimal LigCoefPerte { get; set; } = 1;
    public decimal? LigQteVendue { get; set; }
    public decimal? LigQteTotale { get; set; }
    public string? LigUntCode { get; set; }
    public short LigPrecisionQte { get; set; } = 2;

    // Prix
    public decimal? LigPa { get; set; }
    public decimal LigCoefFg { get; set; } = 1;
    public decimal? LigPr { get; set; }
    public decimal LigCoefBenef { get; set; } = 1;
    public decimal? LigPv { get; set; }
    public decimal LigCoefFa { get; set; } = 1;
    public decimal? LigPvAffiche { get; set; }
    /// <summary>Multiplicateur : 0,90 = remise de 10 %.</summary>
    public decimal LigCoefRemise { get; set; } = 1;
    public decimal? LigPvRemise { get; set; }
    public short LigPrecisionPv { get; set; } = 2;
    public bool LigPvFixe { get; set; }
    public bool LigPvAfficheFixe { get; set; }
    /// <summary>V vendu, O option, M pour mémoire, A variante.</summary>
    public string LigTypePrix { get; set; } = "V";
    public long? LigVarianteDeId { get; set; }
    public bool LigIsEcartArrondi { get; set; }
    public long? LigStDepuisId { get; set; }

    // Montants
    public decimal? LigMontantPa { get; set; }
    public decimal? LigMontantPr { get; set; }
    public decimal? LigMontantHt { get; set; }

    // Lignes de pied
    /// <summary>P pourcentage, M montant.</summary>
    public string? LigPiedMode { get; set; }
    /// <summary>CUMUL, TOTAL_HT, TOTAL_TTC.</summary>
    public string? LigPiedBase { get; set; }
    public short? LigPiedSens { get; set; }
    public decimal? LigPiedValeur { get; set; }
    public bool LigPiedIsFa { get; set; }
    public decimal? LigBaseCalcul { get; set; }
    public decimal? LigMontantTva { get; set; }

    // TVA
    public int? LigTvaId { get; set; }
    public decimal? LigTauxTva { get; set; }

    // Divers
    public string? LigCommentaire { get; set; }
    public bool LigIsNonEditee { get; set; }
    public long? LigOrigineId { get; set; }
    public JsonDocument? LigProprietes { get; set; }
}
