using System.Text.Json;

namespace LogiBTP.Documents;

// Entités de paramétrage. Les noms de propriétés suivent les colonnes du DDL
// (EntId ↔ ent_id) grâce à la convention snake_case d'EF Core et de System.Text.Json.

public class TypeDocument
{
    public int TydId { get; set; }
    public string TydCode { get; set; } = "";
    public string TydLibelle { get; set; } = "";
    /// <summary>V vente, A achat, S stock.</summary>
    public string TydFamille { get; set; } = "V";
    /// <summary>1 vente, 2 achat, 3 stock.</summary>
    public short TydSens { get; set; }
    public string? TydPrefixeNumero { get; set; }
    public bool TydNumerotationContinue { get; set; }
    public bool TydMouvementeStock { get; set; }
    /// <summary>Handler spécifique (IDocumentHandler) ; null = standard.</summary>
    public string? TydHandler { get; set; }
    /// <summary>Durée de validité proposée à la création (offres) ; null : sans validité.</summary>
    public short? TydValiditeJours { get; set; }
    /// <summary>Modèles des textes d'introduction et de conclusion, recopiés dans un nouveau document.</summary>
    public string? TydTexteIntroHtml { get; set; }
    public string? TydTexteFinHtml { get; set; }
    /// <summary>Avancement : S situation (cumul), F facture d'avancement (période), R reprise d'avancement ; null sinon.</summary>
    public string? TydAvancement { get; set; }
    /// <summary>Type de l'avoir que devient une facture d'avancement à période négative.</summary>
    public int? TydAvoirTydId { get; set; }
    public bool TydActif { get; set; } = true;
}

public class ProprieteDefinition
{
    public int PrdId { get; set; }
    public int PrdTydId { get; set; }
    /// <summary>E entête, L ligne.</summary>
    public string PrdNiveau { get; set; } = "E";
    public string PrdCode { get; set; } = "";
    public string PrdLibelle { get; set; } = "";
    /// <summary>texte, entier, decimal, date, booleen, liste.</summary>
    public string PrdTypeDonnee { get; set; } = "texte";
    public bool PrdObligatoire { get; set; }
    public JsonDocument? PrdValeurDefaut { get; set; }
    public JsonDocument? PrdOptions { get; set; }
    public string? PrdGroupe { get; set; }
    public int PrdOrdre { get; set; }
}

public class StatutDocument
{
    public int StdId { get; set; }
    public int StdTydId { get; set; }
    public string StdCode { get; set; } = "";
    public string StdLibelle { get; set; } = "";
    public bool StdModifiable { get; set; } = true;
    /// <summary>Statut terminal : document archivable (facturé, soldé, annulé).</summary>
    public bool StdTerminal { get; set; }
    public int StdOrdre { get; set; }
}

public class TypeLigne
{
    public short TylId { get; set; }
    public string TylCode { get; set; } = "";
    public string TylLibelle { get; set; } = "";
    public bool TylEstChiffree { get; set; }
    public bool TylEstNumerotee { get; set; }
    public bool TylAccepteEnfants { get; set; }
    public bool TylEstPied { get; set; }
}

public class TauxTva
{
    public int TtvId { get; set; }
    public string TtvCode { get; set; } = "";
    public string TtvLibelle { get; set; } = "";
    public decimal TtvTaux { get; set; }
    /// <summary>N normale, A autoliquidation, I intracommunautaire, E exonérée ou export.</summary>
    public string TtvCategorie { get; set; } = "N";
    public string? TtvMention { get; set; }
    public bool TtvActif { get; set; } = true;
}

/// <summary>Unité du référentiel ; lig_unt_code reste une saisie libre.</summary>
public class Unite
{
    public string UntCode { get; set; } = "";
    public string UntLibelle { get; set; } = "";
    public short UntPrecisionQte { get; set; } = 2;
    public int UntOrdre { get; set; }
    public bool UntActif { get; set; } = true;
}

public class TransformationAutorisee
{
    public int TraSourceTydId { get; set; }
    public int TraCibleTydId { get; set; }
    /// <summary>RECEPTION, FACTURATION, RETOUR…</summary>
    public string TraEtape { get; set; } = "";
    public string[]? TraVautEtapes { get; set; }
    /// <summary>Type du document intermédiaire, créé et validé automatiquement (devis → commande → facture).</summary>
    public int? TraIntermediaireTydId { get; set; }
}

public class DroitDocument
{
    public string DrtProfil { get; set; } = "";
    public int DrtTydId { get; set; }
    /// <summary>CREER, MODIFIER, VALIDER, TRANSFORMER, SUPPRIMER.</summary>
    public string DrtAction { get; set; } = "";
}

public class CompteurNumero
{
    public int CnuTydId { get; set; }
    public int CnuExercice { get; set; }
    public int CnuDernierNumero { get; set; }
}
