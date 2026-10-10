using System.Text.Json;
using LogiBTP.Calcul;
using LogiBTP.Domaine;

namespace LogiBTP.Api.Documents;

/// <summary>Document complet : entête, lignes, métrés, variables et ventilation de TVA.</summary>
public class DocumentComplet
{
    public Document Document { get; set; } = new();
    public List<DocumentLigne> Lignes { get; set; } = [];
    public List<Metre> Metres { get; set; } = [];
    public List<MetreLigne> MetreLignes { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
    public List<DocumentTva> Tva { get; set; } = [];
}

/// <summary>Enregistrement en un seul appel ; les lignes portent les valeurs calculées par le client.</summary>
public sealed class EnregistrementDocument : DocumentComplet
{
    public string? VersionMoteurClient { get; set; }
}

public sealed class ReponseEnregistrement
{
    public DocumentComplet Document { get; set; } = new();
    /// <summary>Écarts client / serveur, à arbitrer par l'utilisateur.</summary>
    public List<EcartCalcul> Ecarts { get; set; } = [];
    /// <summary>ID temporaires (négatifs) côté client → ID définitifs.</summary>
    public Dictionary<long, long> CorrespondanceLignes { get; set; } = [];
    public Dictionary<long, long> CorrespondanceMetres { get; set; } = [];
    public Dictionary<long, long> CorrespondanceMetreLignes { get; set; } = [];
    public Dictionary<long, long> CorrespondanceVariables { get; set; } = [];
    public List<MessageCalcul> Erreurs { get; set; } = [];
    public List<MessageCalcul> Avertissements { get; set; } = [];
    public string VersionMoteurServeur { get; set; } = MoteurCalcul.Version;
}

public sealed class CreationDocument
{
    public int EntTydId { get; set; }
    public DateOnly? EntDate { get; set; }
    public string? EntObjet { get; set; }
    public long EntTiersId { get; set; }
    public JsonDocument? EntAdresseFacturation { get; set; }
    public JsonDocument? EntAdresseLivraison { get; set; }
    public string? EntModeCalculOuvrage { get; set; }
    public JsonDocument? EntNumFormat { get; set; }
}

public sealed class DemandeVersion
{
    /// <summary>Version d'enregistrement connue du client (verrouillage optimiste).</summary>
    public int EntVersion { get; set; }
}

/// <summary>Arbitrage des écarts : S serveur validé, A anomalie. Le cas est capturé dans calcul_cas_test.</summary>
public sealed class ArbitrageEcarts
{
    public long? EntId { get; set; }
    public string CasDecision { get; set; } = "S";
    public string? CasCommentaire { get; set; }
    public string VersionClient { get; set; } = "";
    public JsonElement DocumentEntree { get; set; }
    public JsonElement ResultatClient { get; set; }
    public JsonElement ResultatServeur { get; set; }
    public List<EcartCalcul> Ecarts { get; set; } = [];
    public JsonElement? ResultatAttendu { get; set; }
}

public sealed class DemandeTransformation
{
    public int CibleTydId { get; set; }
    /// <summary>Lignes de prix à transformer ; vide = tout le reliquat.</summary>
    public List<LigneATransformer> Lignes { get; set; } = [];
}

public sealed class LigneATransformer
{
    public long LigId { get; set; }
    /// <summary>Quantité transformée ; null = reliquat de l'étape.</summary>
    public decimal? Qte { get; set; }
    /// <summary>Facture d'avancement : avancement cumulé en %.</summary>
    public decimal? AvancementPct { get; set; }
}

public sealed class DemandeSolde
{
    public string Etape { get; set; } = "";
    public decimal Qte { get; set; }
    public string? Motif { get; set; }
}

public sealed record SuiviEtape(string Etape, decimal Transforme, decimal Solde, decimal Reliquat);

public sealed record SuiviLigne(long LigId, string? Numerotation, string? Libelle, decimal Qte, List<SuiviEtape> Etapes);

public sealed record DocumentDuLot(long EntId, string? Numero, string Type, string Statut, bool StatutTerminal, bool ReliquatOuvert);

public sealed record LotArchivage(List<DocumentDuLot> Documents, bool Archivable, List<string> Bloquants);

public sealed class DefinitionType
{
    public TypeDocument Type { get; set; } = new();
    public List<ProprieteDefinition> Proprietes { get; set; } = [];
    public List<StatutDocument> Statuts { get; set; } = [];
    public List<TypeLigne> TypesLigne { get; set; } = [];
    public List<TauxTva> TauxTva { get; set; } = [];
    public List<Unite> Unites { get; set; } = [];
    public List<TransformationAutorisee> Transformations { get; set; } = [];
    public List<string> Droits { get; set; } = [];
}
