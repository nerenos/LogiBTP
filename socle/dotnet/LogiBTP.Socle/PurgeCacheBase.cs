namespace LogiBTP.Socle;

/// <summary>
/// Cache singleton dépendant du schéma d'une base (une base par société) : purgé pour une base donnée quand sa version
/// change (mise à jour de l'installeur détectée par le contrôle des versions du module Installation). Chaque module qui garde
/// un tel cache l'enregistre sous cette interface ; clé de cache = chaîne de connexion de la société, suivie de « | ».
/// </summary>
public interface IPurgeCacheBase
{
    /// <summary>Retire du cache tout ce qui concerne la base désignée par cette chaîne de connexion.</summary>
    void Purger(string connexion);
}

public static class PurgeCache
{
    /// <summary>
    /// Retire d'un dictionnaire les clés « connexion|… » d'une base. La chaîne de connexion d'un contexte EF peut différer de
    /// celle de la société (mot de passe retiré, ordre des paramètres) : deux chaînes désignent la même base quand
    /// leur serveur, leur port et leur nom de base sont identiques.
    /// </summary>
    public static void Purger<T>(System.Collections.Concurrent.ConcurrentDictionary<string, T> cache, string connexion)
    {
        var cible = Identite(connexion);
        foreach (var cle in cache.Keys)
        {
            var barre = cle.IndexOf('|');
            if (barre < 0) continue;
            var debut = cle[..barre];
            if (debut == connexion || (cible is not null && Identite(debut) == cible)) cache.TryRemove(cle, out _);
        }
    }

    private static string? Identite(string connexion)
    {
        try
        {
            var c = new System.Data.Common.DbConnectionStringBuilder { ConnectionString = connexion };
            string V(string k) => c.TryGetValue(k, out var v) ? v?.ToString()?.Trim().ToLowerInvariant() ?? "" : "";
            var nom = V("database") + V("initial catalog");
            return nom.Length == 0 ? null : $"{V("host")}{V("server")}|{V("port")}|{nom}";
        }
        catch (ArgumentException) { return null; }
    }
}
