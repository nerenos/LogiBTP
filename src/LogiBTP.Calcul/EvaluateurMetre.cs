using LogiBTP.Domaine;

namespace LogiBTP.Calcul;

/// <summary>
/// Évaluation d'un métré (metre.js côté client). Le niveau de sous-détail le plus bas est calculé
/// en premier, dans l'ordre des lignes, puis on remonte niveau par niveau jusqu'au résultat.
/// Dans un niveau, chaque ligne s'applique au cumul précédent, sans priorité mathématique.
/// </summary>
internal static class EvaluateurMetre
{
    private const long Racine = long.MinValue;

    private static decimal Appliquer(decimal? cumul, string? operateur, decimal v)
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

    public static decimal Evaluer(MoteurCalcul moteur, Metre metre, DocumentLigne ligne)
    {
        var lignes = moteur.MetreLignes.Where(x => x.MliMtrId == metre.MtrId).ToList();
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

        var resoudre = moteur.Resolveur(ligne, PhaseCalcul.Calcul);
        var resultatsEnfants = new Dictionary<long, decimal>();

        void Affecter(MetreLigne x, decimal v)
        {
            if (string.IsNullOrEmpty(x.MliVariable)) return;
            var c = References.AnalyserCible(x.MliVariable);
            moteur.Portees.Affecter(c.Portee, c.Nom, "=", v, ligne);
        }

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
                        v = ArrondiCalcul.Arr6(v);
                        x.MliValeur = v;
                        Affecter(x, v);
                        continue;
                    }
                    var val = x.MliType == "D"
                        ? resultatsEnfants.GetValueOrDefault(x.MliId)
                        : Expression.Evaluer(x.MliFormule, resoudre);
                    val = ArrondiCalcul.Arr6(val);
                    x.MliValeur = val;
                    cumul = Appliquer(cumul, x.MliOperateur, val);
                    Affecter(x, val);
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
                var r = ArrondiCalcul.Arr6(EvaluerNiveau(g.Liste));
                if (g.ParentId == Racine) resultat = r;
                else resultatsEnfants[g.ParentId] = r;
            }
        }

        metre.MtrResultat = resultat;
        if (!string.IsNullOrEmpty(metre.MtrVariable))
        {
            var c = References.AnalyserCible(metre.MtrVariable);
            moteur.Portees.Affecter(c.Portee, c.Nom, "=", resultat, ligne);
        }
        return resultat;
    }
}
