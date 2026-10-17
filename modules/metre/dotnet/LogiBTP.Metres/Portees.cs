using LogiBTP.Socle;

namespace LogiBTP.Metres;

/// <summary>
/// Magasins de variables de calcul, indépendants de la structure du document hôte (portees.js côté client).
/// $$ document ; @ ligne courante ; autres portées ($, @@…) : contextes fournis par l'hôte, du plus proche
/// au plus lointain (dans LogiBTP : $ = titres englobants, @@ = ouvrages englobants).
/// L'écriture vise le contexte le plus proche, la lecture remonte la chaîne. Valeurs typées : decimal (arrondi à
/// 6 décimales), string ou bool (variables d'un script) ; Lire exige un décimal (formules), LireValeur non.
/// Classe mère : un module peut la spécialiser (nouvelles portées, règles de visibilité).
/// </summary>
public class Portees(Func<string, long?, IReadOnlyList<long>> chaine, Func<string, string>? messagePortee = null)
{
    private readonly Dictionary<string, Dictionary<string, object>> _magasins = new(StringComparer.Ordinal);

    protected Dictionary<string, object>? Magasin(string cle, bool creer)
    {
        if (_magasins.TryGetValue(cle, out var m)) return m;
        if (!creer) return null;
        m = new Dictionary<string, object>(StringComparer.Ordinal);
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

    /// <summary>Valeur typée d'une variable : decimal, string ou bool.</summary>
    public object LireValeur(string portee, string nom, long? ligneId)
    {
        foreach (var cle in Cles(portee, ligneId))
        {
            if (Magasin(cle, false) is { } m && m.TryGetValue(nom, out var v)) return v;
        }
        throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{portee}{nom}}}}} non définie à ce point du document");
    }

    /// <summary>Valeur numérique d'une variable (formules, quantités) : une chaîne ou un booléen est une erreur TYPE.</summary>
    public decimal Lire(string portee, string nom, long? ligneId) =>
        LireValeur(portee, nom, ligneId) as decimal? ?? throw new ErreurCalcul("TYPE", $"Variable {{{{{portee}{nom}}}}} : numérique attendu");

    /// <summary>Affectation (=) d'une chaîne ou d'un booléen (variable d'un script) au contexte le plus proche.</summary>
    public object AffecterValeur(string portee, string nom, object valeur, long? ligneId)
    {
        if (valeur is decimal d) return Affecter(portee, nom, "=", d, ligneId);
        if (valeur is not (string or bool)) throw new ErreurCalcul("TYPE", $"Variable {{{{{portee}{nom}}}}} : valeur non utilisable");
        Magasin(Cles(portee, ligneId)[0], true)![nom] = valeur;
        return valeur;
    }

    public decimal Affecter(string portee, string nom, string operation, decimal valeur, long? ligneId)
    {
        var v = ArrondiCalcul.Arr6(valeur);
        var cles = Cles(portee, ligneId);
        if (operation == "+=")
        {
            var mag = cles.Select(c => Magasin(c, false)).FirstOrDefault(m => m is not null && m.ContainsKey(nom))
                ?? throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{portee}{nom}}}}} non définie : incrémentation impossible");
            if (mag[nom] is not decimal ancienne) throw new ErreurCalcul("TYPE", $"Variable {{{{{portee}{nom}}}}} : numérique attendu");
            var r = ArrondiCalcul.Arr6(ancienne + v);
            mag[nom] = r;
            return r;
        }
        if (operation != "=") throw new ErreurCalcul("OPERATION_INVALIDE", $"Opération inconnue « {operation} »");
        Magasin(cles[0], true)![nom] = v;
        return v;
    }
}
