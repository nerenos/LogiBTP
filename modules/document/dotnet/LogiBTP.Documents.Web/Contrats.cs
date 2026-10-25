using System.Text.Json;
using LogiBTP.Socle;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Document complet : entête, lignes et ventilation de TVA. Classe mère : une spécialisation y ajoute ses
/// compléments (métrés, variables…). Sert aussi de corps de requête à l'enregistrement en un seul appel.
/// </summary>
public class DocumentComplet<TDoc, TLigne>
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    public TDoc Document { get; set; } = new();
    public List<TLigne> Lignes { get; set; } = [];
    public List<DocumentTva> Tva { get; set; } = [];
    /// <summary>Échéancier enregistré à la validation (modifié par PUT /documents/{id}/echeances).</summary>
    public List<DocumentEcheance> Echeances { get; set; } = [];
    /// <summary>Condition et mode de règlement du tiers (spécialisation), proposés quand le document n'en a pas.</summary>
    public ReglementTiers? ReglementTiers { get; set; }
    /// <summary>Version du moteur client, transmise à l'enregistrement.</summary>
    public string? VersionMoteurClient { get; set; }
}

/// <summary>Correspondances ID temporaire (négatif) → ID définitif : lignes et compléments d'une spécialisation.</summary>
public sealed class Correspondances
{
    public Dictionary<long, long> Lignes { get; } = [];
    /// <summary>Par table complémentaire : « metres », « variables »…</summary>
    public Dictionary<string, Dictionary<long, long>> Complements { get; } = new(StringComparer.Ordinal);

    public Dictionary<long, long> Complement(string nom)
    {
        if (!Complements.TryGetValue(nom, out var d)) Complements[nom] = d = [];
        return d;
    }
}

public sealed class ReponseEnregistrement<TComplet>
{
    public TComplet? Document { get; set; }
    /// <summary>Écarts client / serveur, à arbitrer par l'utilisateur.</summary>
    public List<EcartCalcul> Ecarts { get; set; } = [];
    /// <summary>ID temporaires (négatifs) côté client → ID définitifs.</summary>
    public Dictionary<long, long> CorrespondanceLignes { get; set; } = [];
    /// <summary>Correspondances des compléments, par table (« metres », « variables »…).</summary>
    public Dictionary<string, Dictionary<long, long>> Correspondances { get; set; } = [];
    public List<MessageCalcul> Erreurs { get; set; } = [];
    public List<MessageCalcul> Avertissements { get; set; } = [];
    public string VersionMoteurServeur { get; set; } = "";
}

public sealed class CreationDocument
{
    public int EntTydId { get; set; }
    public DateOnly? EntDate { get; set; }
    public string? EntObjet { get; set; }
    public string? EntNotreReference { get; set; }
    public string? EntReferenceExterne { get; set; }
    /// <summary>Durée de validité ; à défaut, celle du type de document.</summary>
    public short? EntValiditeJours { get; set; }
    public long? EntTiersId { get; set; }
    public JsonDocument? EntAdresseFacturation { get; set; }
    public JsonDocument? EntAdresseLivraison { get; set; }
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
    /// <summary>Choix des options et variantes (toutes obligatoires) et des lignes de base des variantes (gardées par défaut).</summary>
    public List<ChoixOption> Choix { get; set; } = [];
}

/// <summary>Document créé depuis plusieurs documents sources (une section par source).</summary>
public sealed class DemandeTransformationMultiple
{
    public int CibleTydId { get; set; }
    public List<long> Sources { get; set; } = [];
}

/// <summary>Documents sources ajoutés à un document brouillon.</summary>
public sealed class DemandeSources
{
    public List<long> Sources { get; set; } = [];
}

/// <summary>Document validé qui peut alimenter un document d'un type donné (lignes encore ouvertes).</summary>
public sealed record DocumentEnAttente(long EntId, string TypeCode, string TypeLibelle, string? Numero, DateOnly Date, string? Objet,
    long? TiersId, decimal TotalHt, int LignesOuvertes);

/// <summary>Option ou variante retenue (passe en prix vendu) ou non (non reprise) ; ligne de base d'une variante gardée ou non.</summary>
public sealed class ChoixOption
{
    public long LigId { get; set; }
    public bool Retenue { get; set; }
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

/// <summary>Seuils de solde automatique d'une famille : % de la quantité du parent et quantité.</summary>
public sealed class SeuilSolde
{
    public decimal Pct { get; set; }
    public decimal Qte { get; set; }
}

/// <summary>Seuils de solde automatique (parametre_document « seuils_solde »), achats et ventes.</summary>
public sealed class SeuilsSolde
{
    public SeuilSolde Achat { get; set; } = new();
    public SeuilSolde Vente { get; set; } = new();
}

/// <summary>
/// Reste à solder d'une ligne d'un document issu d'une transformation : quantité du parent, quantités des autres
/// documents à la même étape (dont brouillons), quantité déjà soldée par d'autres lignes.
/// </summary>
/// <summary>
/// Reste d'une ligne transformée : quantité et montant HT du parent, quantité et montant HT des autres documents à la
/// même étape (brouillons compris, part des brouillons à part), quantité soldée ailleurs.
/// </summary>
public sealed record ResteLigne(long LigId, long SourceLigId, string Etape, decimal QteParent, decimal Autres, decimal AutresBrouillons, decimal Solde,
    decimal MontantParent, decimal AutresMontant);

/// <summary>Restes à solder d'un document et seuils de sa famille (colonnes Qté parent, Reste, Soldé de la grille).</summary>
public sealed record RestesDocument(decimal SeuilPct, decimal SeuilQte, List<ResteLigne> Lignes);

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
    /// <summary>Étiquettes de lignes globales (le document peut en ajouter : ent_etiquettes).</summary>
    public List<EtiquetteDto> Etiquettes { get; set; } = [];
    public List<CouleurTypePrixDto> CouleursTypePrix { get; set; } = [];
    public List<ModeleDto> Modeles { get; set; } = [];
    /// <summary>Conditions de paiement actives et condition par défaut de la famille du type (ventes ou achats).</summary>
    public List<ConditionPaiementDto> ConditionsPaiement { get; set; } = [];
    /// <summary>Modes de règlement actifs (mode_reglement).</summary>
    public List<ModeReglementDto> ModesReglement { get; set; } = [];
    public string? ConditionDefaut { get; set; }
    /// <summary>Règles résolues pour le type (type, famille, global, défaut) : code → valeur.</summary>
    public Dictionary<string, System.Text.Json.Nodes.JsonNode?> Regles { get; set; } = [];
}

/// <summary>Rejet d'un document envoyé : motif.</summary>
public sealed record DemandeRejet(string Motif);

/// <summary>Modèles des textes d'introduction et de conclusion d'un type de document (HTML à variables).</summary>
public sealed record TextesType(string? IntroHtml, string? FinHtml);

/// <summary>Changement du numéro d'un document : numéro au format du type, motif (obligatoire en numérotation continue).</summary>
public sealed record DemandeNumero(string Numero, string? Motif);

/// <summary>Réponse au changement de numéro : document relu, numéro retenu, avertissement si le numéro demandé était pris.</summary>
public sealed class ReponseNumero<TComplet>
{
    public TComplet Document { get; set; } = default!;
    public string Numero { get; set; } = "";
    public string? Avertissement { get; set; }
}

/// <summary>Condition et mode de règlement d'un tiers.</summary>
public sealed record ReglementTiers(string? Condition, string? Mode);

/// <summary>Condition de paiement : lignes de l'échéancier (règle Echeances).</summary>
public sealed record ConditionPaiementDto(string Code, string Libelle, List<LigneCondition> Lignes, short Ordre, bool Actif);

/// <summary>Conditions de paiement par défaut : ventes et achats.</summary>
public sealed class ConditionsDefaut
{
    public string? Vente { get; set; }
    public string? Achat { get; set; }
}

/// <summary>Échéance saisie (modification manuelle de l'échéancier d'une pièce validée).</summary>
public sealed record EcheanceSaisie(DateOnly? Date, decimal Montant, string? Mode, string Nature);
