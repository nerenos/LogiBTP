using LogiBTP.Documents;

namespace LogiBTP.Domaine;

/// <summary>
/// Ligne d'un document BTP : spécialise la ligne générique du module Document (db/100_btp.sql).
/// Les propriétés doivent rester alignées avec client/src/calcul/colonnes-btp.js : un test le vérifie.
/// </summary>
public class DocumentLigneBtp : DocumentLigne
{
    public int? LigNatId { get; set; }
    public int? LigPtvId { get; set; }

    // Quantités : métré et perte
    public long? LigMtrId { get; set; }
    /// <summary>S saisie, M métré.</summary>
    public string LigQteSource { get; set; } = "S";
    public decimal? LigQteBase { get; set; }
    public decimal LigCoefPerte { get; set; } = 1;

    // Déboursé et coefficients (multiplicateurs, 1 par défaut)
    public decimal? LigPa { get; set; }
    public decimal LigCoefFg { get; set; } = 1;
    public decimal? LigPr { get; set; }
    public decimal LigCoefBenef { get; set; } = 1;
    public decimal LigCoefFa { get; set; } = 1;
    public decimal? LigPvAffiche { get; set; }
    /// <summary>PV fixe avant frais annexes et remise.</summary>
    public bool LigPvFixe { get; set; }
    /// <summary>PV fixe avec frais annexes.</summary>
    public bool LigPvAfficheFixe { get; set; }
    public bool LigIsEcartArrondi { get; set; }

    // Montants de déboursé et de revient
    public decimal? LigMontantPa { get; set; }
    public decimal? LigMontantPr { get; set; }

    // Lignes de pied
    /// <summary>Frais annexe ventilé dans les prix (entre dans le coefficient de frais annexes).</summary>
    public bool LigPiedIsFa { get; set; }
}
