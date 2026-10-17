using System.Text.Json;
using System.Text.Json.Nodes;

namespace LogiBTP.Documents;

/// <summary>Valeur d'une règle à un niveau : global (famille et type nuls), famille (V, A, S) ou type de document.</summary>
public class RegleDocument
{
    public int RdoId { get; set; }
    public string RdoCode { get; set; } = "";
    public string? RdoFamille { get; set; }
    public int? RdoTydId { get; set; }
    public JsonDocument RdoValeur { get; set; } = JsonDocument.Parse("null");
    public bool RdoActif { get; set; } = true;
}

/// <summary>
/// Règle du catalogue : code, libellé, description, genre de valeur (BOOLEEN, NOMBRE, CHOIX), valeur par défaut, choix
/// permis ; effet affiché (BLOQUANT, AVERTISSEMENT, PARAMETRE).
/// </summary>
public sealed record DefinitionRegle(string Code, string Libelle, string Description, string Genre, JsonNode? Defaut,
    List<string>? Choix = null, string Effet = "PARAMETRE");

/// <summary>
/// Catalogue des règles du module Document (CONCEPTION-REGLES-DOCUMENTS.md, § 6.2) ; la spécialisation y ajoute les
/// siennes (SpecialisationDocument.Regles). Valeur par défaut = celle du niveau global quand rien n'est paramétré.
/// </summary>
public static class CatalogueRegles
{
    public static readonly IReadOnlyList<DefinitionRegle> Module =
    [
        new("TIERS_OBLIGATOIRE", "Tiers obligatoire", "Tiers exigé à la validation (stock : notre société).", "BOOLEEN", true, null, "BLOQUANT"),
        new("STATUTS_AUTO", "Statuts automatiques", "Statut calculé d'après les documents aval : SOLDE, FACTURATION, FACTURE.", "BOOLEEN", false),
        new("PIECE_COMPTABLE", "Pièce comptable", "État comptable, échéancier (ventes, achats), suppression impossible.", "BOOLEEN", false),
        new("APPROBATION", "Approbation interne", "Validation interne (APPROUVE) avant l'envoi.", "BOOLEEN", false),
        new("VALIDATION_TIERS", "Validation du tiers", "Après l'envoi, le document attend la validation du tiers (VALIDE).", "BOOLEEN", true),
        new("INDICE", "Indices", "Création d'indices (versions) permise.", "BOOLEEN", true),
        new("LIGNES_AUTORISEES", "Lignes ajoutables", "Lignes ajoutables à la saisie : toutes, ou texte et pied seulement.", "CHOIX", "TOUTES", ["TOUTES", "TEXTE_PIED"]),
        new("VALIDITE_ALERTE", "Alerte de fin de validité", "Document arrivé à la fin de sa validité : alerte dans les listes, avertissement à la transformation.", "BOOLEEN", false, null, "AVERTISSEMENT"),
        new("DATE_PIECE", "Chronologie des pièces", "Date pas dans le futur, pas avant la dernière pièce du même type (ventes).", "BOOLEEN", false, null, "BLOQUANT"),
        new("MONTANT_NUL", "Total nul", "Validation d'un document à total nul : avertissement ou permis.", "CHOIX", "PERMIS", ["AVERTISSEMENT", "PERMIS"], "AVERTISSEMENT"),
        new("REFERENCE_EXTERNE_OBLIGATOIRE", "Référence externe obligatoire", "Référence externe exigée à la validation.", "BOOLEEN", false, null, "BLOQUANT"),
        new("REFERENCE_EXTERNE_UNIQUE", "Référence externe unique", "Avertissement si un autre document du même type et du même tiers a la même référence externe.", "BOOLEEN", false, null, "AVERTISSEMENT"),
        new("QUANTITE_DEPASSEE", "Quantité au-delà du parent", "Quantité transformée au-delà du reste du parent.", "CHOIX", "AVERTISSEMENT", ["PERMIS", "AVERTISSEMENT", "REFUS"], "AVERTISSEMENT"),
    ];
}
