using LogiBTP.Domaine;

namespace LogiBTP.Calcul;

/// <summary>
/// Magasins de variables de calcul (portees.js côté client).
/// $$ document ; $ titre parent puis titres englobants ; @@ ouvrage parent puis ouvrages englobants ;
/// @ ligne courante. Valeurs arrondies à 6 décimales.
/// </summary>
public sealed class Portees(Func<DocumentLigne, DocumentLigne?> parent)
{
    private readonly Dictionary<string, decimal> _doc = new(StringComparer.Ordinal);
    private readonly Dictionary<long, Dictionary<string, decimal>> _titres = [];
    private readonly Dictionary<long, Dictionary<string, decimal>> _ouvrages = [];
    private readonly Dictionary<long, Dictionary<string, decimal>> _lignes = [];

    private static Dictionary<string, decimal>? Magasin(Dictionary<long, Dictionary<string, decimal>> genre, long id, bool creer)
    {
        if (genre.TryGetValue(id, out var mag)) return mag;
        if (!creer) return null;
        mag = new Dictionary<string, decimal>(StringComparer.Ordinal);
        genre[id] = mag;
        return mag;
    }

    private List<Dictionary<string, decimal>?> Chaine(string portee, DocumentLigne? ligne, bool creer)
    {
        if (portee == "$$") return [_doc];
        if (portee == "@")
        {
            if (ligne is null) throw new ErreurCalcul("PORTEE", "Variable @ hors d'une ligne");
            return [Magasin(_lignes, ligne.LigId, creer)];
        }
        var type = portee == "$" ? TL.Titre : TL.Ouvrage;
        var genre = portee == "$" ? _titres : _ouvrages;
        var chaine = new List<Dictionary<string, decimal>?>();
        for (var x = ligne; x is not null; x = parent(x))
        {
            if (x.LigTylId == type) chaine.Add(Magasin(genre, x.LigId, creer && chaine.Count == 0));
        }
        if (chaine.Count == 0)
        {
            throw new ErreurCalcul("PORTEE", portee == "$"
                ? "Aucun titre parent pour une variable $"
                : "Aucun ouvrage parent pour une variable @@");
        }
        return chaine;
    }

    public decimal Lire(string portee, string nom, DocumentLigne? ligne)
    {
        foreach (var mag in Chaine(portee, ligne, false))
        {
            if (mag is not null && mag.TryGetValue(nom, out var v)) return v;
        }
        throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{portee}{nom}}}}} non définie à ce point du document");
    }

    public decimal Affecter(string portee, string nom, string operation, decimal valeur, DocumentLigne? ligne)
    {
        var v = ArrondiCalcul.Arr6(valeur);
        if (operation == "+=")
        {
            var mag = Chaine(portee, ligne, false).FirstOrDefault(m => m is not null && m.ContainsKey(nom))
                ?? throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{portee}{nom}}}}} non définie : incrémentation impossible");
            var r = ArrondiCalcul.Arr6(mag[nom] + v);
            mag[nom] = r;
            return r;
        }
        if (operation != "=") throw new ErreurCalcul("OPERATION_INVALIDE", $"Opération inconnue « {operation} »");
        Chaine(portee, ligne, true)[0]![nom] = v;
        return v;
    }
}
