using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;

namespace LogiBTP.Socle;

/// <summary>
/// Accès aux colonnes d'une entité par leur nom en base (ent_numero, lig_qte_vendue…), pour tout type :
/// les colonnes d'une classe spécialisée (DocumentLigneBtp) incluent celles de sa classe mère.
/// </summary>
public static class AccesColonnes
{
    private static readonly ConcurrentDictionary<Type, IReadOnlyDictionary<string, PropertyInfo>> Cache = new();

    private static IReadOnlyDictionary<string, PropertyInfo> Table(Type t) => Cache.GetOrAdd(t, type =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.GetIndexParameters().Length == 0)
            .ToDictionary(p => JsonNamingPolicy.SnakeCaseLower.ConvertName(p.Name), StringComparer.Ordinal));

    public static IEnumerable<string> Colonnes(Type t) => Table(t).Keys;

    public static bool Existe(object entite, string colonne) => Table(entite.GetType()).ContainsKey(colonne);

    public static object? Lire(object entite, string colonne) =>
        Table(entite.GetType()).TryGetValue(colonne, out var p) ? p.GetValue(entite) : null;
}
