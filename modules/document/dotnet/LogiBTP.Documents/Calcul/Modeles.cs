using System.Text.Json;
using LogiBTP.Socle;

namespace LogiBTP.Documents;

/// <summary>Entrée du moteur de document : tout ce qui est nécessaire au calcul, sans accès à la base.</summary>
public class EntreeDocument<TDoc, TLigne>
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    public TDoc Document { get; set; } = new();
    public List<TLigne> Lignes { get; set; } = [];
    public List<TauxTva> TauxTva { get; set; } = [];
    /// <summary>Entités liées accessibles par {{table.colonne}} : article, tiers…</summary>
    public Dictionary<string, EntiteLiee> Entites { get; set; } = [];
    public OptionsCalcul Options { get; set; } = new();
}

/// <summary>Résultat du moteur de document ; une spécialisation y ajoute ses données (métrés…).</summary>
public class ResultatDocument<TDoc, TLigne>
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    public string VersionMoteur { get; set; } = "";
    public TDoc Document { get; set; } = new();
    public List<TLigne> Lignes { get; set; } = [];
    public List<DocumentTva> Tva { get; set; } = [];
    public List<MessageCalcul> Erreurs { get; set; } = [];
    public List<MessageCalcul> Avertissements { get; set; } = [];
}

public sealed class EntiteLiee
{
    /// <summary>Préfixe des colonnes, par exemple « art » pour article (art_id, art_poids).</summary>
    public string Prefixe { get; set; } = "";
    public List<JsonElement> Enregistrements { get; set; } = [];
}

public sealed class OptionsCalcul
{
    /// <summary>Libellés figés à la validation : la passe des libellés n'est pas exécutée.</summary>
    public bool LibellesFiges { get; set; }
}
