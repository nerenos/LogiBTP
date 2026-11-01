using System.Text.Json;

namespace LogiBTP.Listes;

/// <summary>
/// Définition d'une vue de liste (vue_liste.vli_definition). Le serveur n'en lit que ce qui sert aux requêtes :
/// source, colonnes lues (non calculées), colonnes de recherche, segments, tri. La mise en forme reste au client.
/// </summary>
public sealed class DefinitionVue
{
    public SourceVue Source { get; set; } = new();
    public List<ColonneVue> Colonnes { get; set; } = [];
    public List<SegmentVue> Segments { get; set; } = [];
    public List<TriColonne> Tri { get; set; } = [];
    /// <summary>Filtres fixes de la vue, appliqués par la base en ET (ex. salariés actifs).</summary>
    public List<FiltreVue> Filtres { get; set; } = [];
    /// <summary>Montre les lignes en sommeil (colonne usage = S) d'une source qui porte l'état d'utilisation ; masquées sinon.</summary>
    public bool Sommeil { get; set; }
    /// <summary>Thème de la vue : ses types d'élément restreignent les lignes (aucun type = tous).</summary>
    public string? Theme { get; set; }
    public int TailleLot { get; set; } = 100;
}

/// <summary>Filtre fixe d'une vue : colonne de la source, opérateur, valeur(s) saisie(s) dans le concepteur.</summary>
public sealed class FiltreVue
{
    public string Colonne { get; set; } = "";
    public string Op { get; set; } = "=";
    public string? Valeur { get; set; }
    public string? Valeur2 { get; set; }
    public List<string>? Valeurs { get; set; }
}

public sealed class SourceVue
{
    /// <summary>« vue » : source déclarée dans source_liste ; « requete » : SELECT saisi par un ADMIN.</summary>
    public string Mode { get; set; } = "vue";
    /// <summary>Code de la source déclarée (source_liste.sli_code).</summary>
    public string? Vue { get; set; }
    public string? Requete { get; set; }
    public string? ColonneId { get; set; }
    public string? ColonneType { get; set; }
    public string? TypeElement { get; set; }
}

public sealed class ColonneVue
{
    public string Code { get; set; } = "";
    /// <summary>Colonne calculée sur le poste : jamais lue dans la source.</summary>
    public bool Calcul { get; set; }
    /// <summary>Incluse dans la barre de recherche (par défaut : toute colonne lue).</summary>
    public bool? Recherche { get; set; }
    /// <summary>Saisissable dans la liste (si la source et la colonne de la base sont modifiables).</summary>
    public bool Modifiable { get; set; }
}

public sealed class SegmentVue
{
    public string Colonne { get; set; } = "";
    public string? Titre { get; set; }
}

public sealed class TriColonne
{
    public string Colonne { get; set; } = "";
    public string Sens { get; set; } = "asc";
}

/// <summary>Demande de données d'une liste (lot, segments, contrôle, lignes ciblées).</summary>
public sealed class DemandeListe
{
    public long? VueId { get; set; }
    /// <summary>Définition non enregistrée (concepteur) ; sinon celle de la vue enregistrée.</summary>
    public JsonElement? Definition { get; set; }
    public string? Recherche { get; set; }
    /// <summary>Valeurs retenues par colonne de segment (texte brut, null = vide).</summary>
    public Dictionary<string, List<string?>> Segments { get; set; } = [];
    public List<TriColonne> Tri { get; set; } = [];
    /// <summary>Curseur : valeurs de tri (texte) de la dernière ligne reçue puis son ID.</summary>
    public List<string?>? Apres { get; set; }
    /// <summary>Contrôle : lignes jusqu'à ce curseur inclus (null = toutes).</summary>
    public List<string?>? Jusqua { get; set; }
    public int Taille { get; set; } = 100;
    public List<string>? Ids { get; set; }
    public string? Colonne { get; set; }
    /// <summary>Filtres ajoutés à ceux de la vue (carte d'indicateur choisie), même sémantique, en ET.</summary>
    public List<FiltreVue> Filtres { get; set; } = [];
    /// <summary>Agrégats demandés (totaux des colonnes, indicateurs) sur toute la sélection.</summary>
    public List<AgregatListe> Agregats { get; set; } = [];
}

/// <summary>
/// Agrégat d'une liste (totaux L3, indicateurs L4) : somme, moyenne, min, max d'une colonne numérique, compte des
/// lignes, ou ratio compte(filtres) ÷ compte(dénominateur) ; filtres propres en plus de la sélection. Même sémantique
/// que agreger (requete.js), jeu 04_agregats.json.
/// </summary>
public sealed class AgregatListe
{
    public string Code { get; set; } = "";
    public string Calcul { get; set; } = "somme";
    public string? Colonne { get; set; }
    public List<FiltreVue> Filtres { get; set; } = [];
    public List<FiltreVue> Denominateur { get; set; } = [];
}

/// <summary>Type d'élément couvert par un thème.</summary>
public sealed class TypeElementTheme
{
    public string Code { get; set; } = "";
    public string? Libelle { get; set; }
}

/// <summary>Colonne d'une source : nom, type PostgreSQL (data_type), modifiable dans la base (is_updatable).</summary>
public sealed record ColonneSource(string Code, string Type, bool Modifiable = false);

/// <summary>
/// Source prête à interroger : SELECT encadré, colonnes connues, identifiant et type d'élément. Table : relation
/// à mettre à jour (vue déclarée modifiable), null pour une source en lecture seule ou une requête manuelle.
/// </summary>
public sealed record SourceResolue(string Sql, IReadOnlyList<ColonneSource> Colonnes, string ColonneId, string? ColonneType, string? TypeElement,
    string? Table = null, string? Code = null);

/// <summary>Saisie dans la liste : nouvelles valeurs d'une ligne, avec l'empreinte connue du client.</summary>
public sealed class DemandeModification
{
    public long? VueId { get; set; }
    public JsonElement? Definition { get; set; }
    public string Id { get; set; } = "";
    /// <summary>Empreinte de la ligne lue par le client (_h) : refus si la ligne a changé depuis.</summary>
    public string? H { get; set; }
    public Dictionary<string, JsonElement> Valeurs { get; set; } = [];

    /// <summary>Valeur JSON en texte (convertie au type de la colonne par CAST), null pour JSON null.</summary>
    public static string? Texte(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.String => v.GetString(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => v.GetRawText(),
    };
}

/// <summary>Erreur de définition ou de requête : traduite en réponse 422 par la couche web.</summary>
public sealed class ErreurListe(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
