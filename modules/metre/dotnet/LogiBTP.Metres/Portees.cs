using LogiBTP.Socle;

namespace LogiBTP.Metres;

/// <summary>
/// Magasins de variables de calcul, indépendants de la structure du document hôte (portees.js côté client).
/// $$ document ; @ ligne courante ; autres portées ($, @@…) : contextes fournis par l'hôte, du plus proche
/// au plus lointain (dans LogiBTP : $ = titres englobants, @@ = ouvrages englobants).
/// L'écriture vise le contexte le plus proche, la lecture remonte la chaîne. Valeurs arrondies à 6 décimales.
/// Classe mère : un module peut la spécialiser (nouvelles portées, règles de visibilité).
/// </summary>
public class Portees(Func<string, long?, IReadOnlyList<long>> chaine, Func<string, string>? messagePortee = null)
{
    private readonly Dictionary<string, Dictionary<string, decimal>> _magasins = new(StringComparer.Ordinal);

    protected Dictionary<string, decimal>? Magasin(string cle, bool creer)
    {
        if (_magasins.TryGetValue(cle, out var m)) return m;
        if (!creer) return null;
        m = new Dictionary<string, decimal>(StringComparer.Ordinal);
        _magasins[cle] = m;
        return m;
    }

    /// <summary>Clés des magasins à parcourir pour une portée, du plus proche au plus lointain.</summary>
    protected virtual IReadOnlyList<string> Cles(string portee, long? ligneId)
    {
        if (portee == "$$") return ["$$"];
        if (portee == "@")
        {
            if (ligneId is null) throw new ErreurCalcul("PORTEE", "Variable @ hors d'une ligne");
            return [$"@:{ligneId}"];
        }
        var contextes = chaine(portee, ligneId);
        if (contextes.Count == 0)
        {
            throw new ErreurCalcul("PORTEE", messagePortee?.Invoke(portee) ?? $"Aucun contexte pour une variable {portee}");
        }
        return contextes.Select(c => $"{portee}:{c}").ToList();
    }

    public decimal Lire(string portee, string nom, long? ligneId)
    {
        foreach (var cle in Cles(portee, ligneId))
        {
            if (Magasin(cle, false) is { } m && m.TryGetValue(nom, out var v)) return v;
        }
        throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{portee}{nom}}}}} non définie à ce point du document");
    }

    public decimal Affecter(string portee, string nom, string operation, decimal valeur, long? ligneId)
    {
        var v = ArrondiCalcul.Arr6(valeur);
        var cles = Cles(portee, ligneId);
        if (operation == "+=")
        {
            var mag = cles.Select(c => Magasin(c, false)).FirstOrDefault(m => m is not null && m.ContainsKey(nom))
                ?? throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{portee}{nom}}}}} non définie : incrémentation impossible");
            var r = ArrondiCalcul.Arr6(mag[nom] + v);
            mag[nom] = r;
            return r;
        }
        if (operation != "=") throw new ErreurCalcul("OPERATION_INVALIDE", $"Opération inconnue « {operation} »");
        Magasin(cles[0], true)![nom] = v;
        return v;
    }
}
