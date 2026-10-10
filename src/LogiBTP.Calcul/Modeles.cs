using System.Text.Json;
using System.Text.Json.Serialization;
using LogiBTP.Domaine;

namespace LogiBTP.Calcul;

/// <summary>Entrée du moteur : tout ce qui est nécessaire au calcul, sans accès à la base.</summary>
public sealed class EntreeCalcul
{
    public Document Document { get; set; } = new();
    public List<DocumentLigne> Lignes { get; set; } = [];
    public List<Metre> Metres { get; set; } = [];
    public List<MetreLigne> MetreLignes { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
    public List<TauxTva> TauxTva { get; set; } = [];
    /// <summary>Entités liées accessibles par {{table.colonne}} : article, tiers…</summary>
    public Dictionary<string, EntiteLiee> Entites { get; set; } = [];
    public OptionsCalcul Options { get; set; } = new();
}

public sealed class EntiteLiee
{
    /// <summary>Préfixe des colonnes, par exemple « art » pour article (art_id, art_poids).</summary>
    public string Prefixe { get; set; } = "";
    public List<JsonElement> Enregistrements { get; set; } = [];
}

public sealed class OptionsCalcul
{
    /// <summary>Libellés figés à la validation : la passe 8 n'est pas exécutée.</summary>
    public bool LibellesFiges { get; set; }
}

public sealed class ResultatCalcul
{
    public string VersionMoteur { get; set; } = "";
    public Document Document { get; set; } = new();
    public List<DocumentLigne> Lignes { get; set; } = [];
    public List<Metre> Metres { get; set; } = [];
    public List<MetreLigne> MetreLignes { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
    public List<DocumentTva> Tva { get; set; } = [];
    /// <summary>Lignes d'écart d'arrondi existantes qui n'ont pas été recréées.</summary>
    public List<long> LignesSupprimees { get; set; } = [];
    public List<MessageCalcul> Erreurs { get; set; } = [];
    public List<MessageCalcul> Avertissements { get; set; } = [];
}

/// <summary>Options JSON communes : noms de colonnes snake_case, décimaux acceptés en chaîne.</summary>
public static class JsonCalcul
{
    public static readonly JsonSerializerOptions Options = Creer();

    public static JsonSerializerOptions Creer()
    {
        var o = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DictionaryKeyPolicy = null,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
        };
        return o;
    }

    public static T Cloner<T>(T valeur) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.SerializeToUtf8Bytes(valeur, Options), Options)!;
}
