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
    /// <summary>Coefficient de prorata : appliqué au prix affiché après les frais annexes, avant la remise.</summary>
    public decimal LigCoefProrata { get; set; } = 1;
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

    // Données techniques (db/165) : recopiées de l'élément de bibliothèque, dimensions en mètres
    public decimal? LigPoids { get; set; }
    public decimal? LigSurface { get; set; }
    public decimal? LigVolume { get; set; }
    public decimal? LigHauteur { get; set; }
    public decimal? LigLargeur { get; set; }
    public decimal? LigEpaisseur { get; set; }
    public decimal? LigLongueur { get; set; }

    /// <summary>Heures réalisées saisies sur une ligne d'ordre (sans le module Pointage, db/197).</summary>
    public decimal? LigHeuresRealisees { get; set; }

    /// <summary>Chantier de la ligne (documents d'achat, db/248) : repris de l'entête ou du document source, modifiable.</summary>
    public int? LigChaId { get; set; }
}
