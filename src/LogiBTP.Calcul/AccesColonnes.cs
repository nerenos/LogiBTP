using System.Reflection;
using System.Text.Json;
using LogiBTP.Domaine;

namespace LogiBTP.Calcul;

/// <summary>Accès aux colonnes d'une entité par leur nom en base (ent_numero, lig_qte_vendue…).</summary>
public static class AccesColonnes
{
    private static readonly IReadOnlyDictionary<string, PropertyInfo> ColsDocument = Construire(typeof(Document));
    private static readonly IReadOnlyDictionary<string, PropertyInfo> ColsLigne = Construire(typeof(DocumentLigne));

    public static IEnumerable<string> ColonnesDocument => ColsDocument.Keys;
    public static IEnumerable<string> ColonnesLigne => ColsLigne.Keys;

    public static readonly HashSet<string> PrixCalcules =
    [
        "lig_pr", "lig_pv", "lig_pv_affiche", "lig_pv_remise", "lig_coef_fa", "lig_montant_pa", "lig_montant_pr",
        "lig_montant_ht", "lig_montant_tva", "lig_base_calcul",
        "ent_coef_fa", "ent_total_ht", "ent_total_tva", "ent_total_ttc", "ent_net_a_payer",
    ];

    public static readonly HashSet<string> QuantitesCalculees = ["lig_qte_base", "lig_qte_vendue", "lig_qte_totale"];

    private static Dictionary<string, PropertyInfo> Construire(Type t) =>
        t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .ToDictionary(p => JsonNamingPolicy.SnakeCaseLower.ConvertName(p.Name), StringComparer.Ordinal);

    public static bool Existe(object entite, string colonne) => Table(entite).ContainsKey(colonne);

    public static object? Lire(object entite, string colonne) =>
        Table(entite).TryGetValue(colonne, out var p) ? p.GetValue(entite) : null;

    private static IReadOnlyDictionary<string, PropertyInfo> Table(object entite) => entite switch
    {
        Document => ColsDocument,
        DocumentLigne => ColsLigne,
        _ => throw new ArgumentException("Entité non gérée", nameof(entite)),
    };
}
