using LogiBTP.Socle;

namespace LogiBTP.Metres;

/// <summary>Définitions de variables réparties par porteur (variables.js côté client).</summary>
public sealed record RepartitionVariables(
    List<VariableDefinition> Document,
    Dictionary<long, List<VariableDefinition>> ParLigne,
    Dictionary<long, List<VariableDefinition>> ParMetre);

public static class Variables
{
    /// <summary>
    /// Évalue une définition (affectation <c>=</c> ou incrémentation <c>+=</c>) et renseigne VarValeur.
    /// </summary>
    public static decimal Evaluer(VariableDefinition definition, Func<string, decimal> resolveur, Portees portees, long? ligneId)
    {
        var valeur = Expression.Evaluer(definition.VarFormule, resolveur);
        definition.VarValeur = portees.Affecter(definition.VarPortee, definition.VarNom, definition.VarOperation, valeur, ligneId);
        return definition.VarValeur.Value;
    }

    /// <summary>Variables du document (dans l'ordre d'évaluation), de ligne et de métré (onglet Définition).</summary>
    public static RepartitionVariables Repartir(IEnumerable<VariableDefinition> variables)
    {
        var res = new RepartitionVariables([], [], []);
        foreach (var v in variables.OrderBy(v => v.VarOrdre).ThenBy(v => v.VarId))
        {
            if (v.VarMtrId is long m)
            {
                if (!res.ParMetre.TryGetValue(m, out var l)) res.ParMetre[m] = l = [];
                l.Add(v);
            }
            else if (v.VarLigId is long li)
            {
                if (!res.ParLigne.TryGetValue(li, out var l)) res.ParLigne[li] = l = [];
                l.Add(v);
            }
            else res.Document.Add(v);
        }
        return res;
    }
}
