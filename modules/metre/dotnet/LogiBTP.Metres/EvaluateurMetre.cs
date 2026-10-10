using LogiBTP.Socle;

namespace LogiBTP.Metres;

/// <summary>
/// Évaluation d'un métré (evaluateur-metre.js côté client). Classe mère du module Métré.
/// Le niveau de sous-détail le plus bas est calculé en premier, dans l'ordre des lignes, puis on remonte
/// niveau par niveau jusqu'au résultat. Dans un niveau, chaque ligne s'applique au cumul précédent,
/// sans priorité mathématique.
/// </summary>
/// <param name="resolveur">Valeur d'une référence {{...}} d'une formule.</param>
/// <param name="affecter">Affectation d'une valeur à une variable : (portée, nom, valeur).</param>
public class EvaluateurMetre(Func<string, decimal> resolveur, Action<string, string, decimal> affecter)
{
    private const long Racine = long.MinValue;

    protected Func<string, decimal> Resolveur { get; } = resolveur;

    /// <summary>Applique l'opérateur d'une ligne au cumul. La première ligne d'un niveau initialise le cumul.</summary>
    protected virtual decimal Appliquer(decimal? cumul, string? operateur, decimal v)
    {
        if (cumul is null) return operateur == "-" ? -v : v;
        return (operateur ?? "+") switch
        {
            "+" => cumul.Value + v,
            "-" => cumul.Value - v,
            "*" => cumul.Value * v,
            "/" => v == 0 ? throw new ErreurCalcul("DIVISION_ZERO", "Division par zéro") : cumul.Value / v,
            _ => throw new ErreurCalcul("OPERATION_INVALIDE", $"Opérateur inconnu « {operateur} »"),
        };
    }

    protected virtual decimal ValeurFormule(MetreLigne ligne) => Expression.Evaluer(ligne.MliFormule, Resolveur);

    protected virtual decimal Arrondir(decimal v) => ArrondiCalcul.Arr6(v);

    protected void Affecter(string? cible, decimal v)
    {
        if (string.IsNullOrEmpty(cible)) return;
        var c = References.AnalyserCible(cible);
        affecter(c.Portee, c.Nom, v);
    }

    /// <summary>Évalue le métré ; renseigne MliValeur et MtrResultat, renvoie le résultat.</summary>
    public decimal Evaluer(Metre metre, IEnumerable<MetreLigne> lignesMetre)
    {
        var lignes = lignesMetre.Where(x => x.MliMtrId == metre.MtrId).ToList();
        foreach (var x in lignes) x.MliValeur = null;
        metre.MtrResultat = null;

        var enfants = new Dictionary<long, List<MetreLigne>>();
        foreach (var x in lignes)
        {
            var p = x.MliParentId ?? Racine;
            if (!enfants.TryGetValue(p, out var liste)) enfants[p] = liste = [];
            liste.Add(x);
        }
        foreach (var liste in enfants.Values)
        {
            liste.Sort((a, b) => a.MliOrdre != b.MliOrdre ? a.MliOrdre.CompareTo(b.MliOrdre) : a.MliId.CompareTo(b.MliId));
        }

        var groupes = new List<(long ParentId, List<MetreLigne> Liste, int Profondeur)>();
        void Parcourir(long parentId, int profondeur)
        {
            var liste = enfants.TryGetValue(parentId, out var l) ? l : [];
            if (parentId == Racine || liste.Count > 0) groupes.Add((parentId, liste, profondeur));
            foreach (var x in liste) Parcourir(x.MliId, profondeur + 1);
        }
        Parcourir(Racine, 1);

        var resultatsEnfants = new Dictionary<long, decimal>();

        decimal EvaluerNiveau(List<MetreLigne> liste)
        {
            decimal? cumul = null;
            for (var i = 0; i < liste.Count; i++)
            {
                var x = liste[i];
                try
                {
                    if (x.MliType == "S")
                    {
                        decimal v;
                        if (x.MliStDepuisId is null) v = cumul ?? 0;
                        else
                        {
                            var j = liste.FindIndex(y => y.MliId == x.MliStDepuisId);
                            if (j < 0 || j >= i || liste[j].MliType != "S")
                            {
                                throw new ErreurCalcul("METRE_SOUS_TOTAL", "Le sous-total pointé doit être un sous-total précédent du même niveau");
                            }
                            decimal? c = null;
                            for (var k = j + 1; k < i; k++)
                            {
                                if (liste[k].MliType == "S") continue;
                                c = Appliquer(c, liste[k].MliOperateur, liste[k].MliValeur ?? 0);
                            }
                            v = c ?? 0;
                        }
                        v = Arrondir(v);
                        x.MliValeur = v;
                        Affecter(x.MliVariable, v);
                        continue;
                    }
                    var val = x.MliType == "D" ? resultatsEnfants.GetValueOrDefault(x.MliId) : ValeurFormule(x);
                    val = Arrondir(val);
                    x.MliValeur = val;
                    cumul = Appliquer(cumul, x.MliOperateur, val);
                    Affecter(x.MliVariable, val);
                }
                catch (ErreurCalcul e)
                {
                    throw new ErreurCalcul(e.Code, $"Métré, ligne {x.MliOrdre} : {e.Message}");
                }
            }
            return cumul ?? 0;
        }

        var profondeurMax = groupes.Max(g => g.Profondeur);
        decimal resultat = 0;
        for (var p = profondeurMax; p >= 1; p--)
        {
            foreach (var g in groupes.Where(g => g.Profondeur == p))
            {
                var r = Arrondir(EvaluerNiveau(g.Liste));
                if (g.ParentId == Racine) resultat = r;
                else resultatsEnfants[g.ParentId] = r;
            }
        }

        metre.MtrResultat = resultat;
        Affecter(metre.MtrVariable, resultat);
        return resultat;
    }
}
