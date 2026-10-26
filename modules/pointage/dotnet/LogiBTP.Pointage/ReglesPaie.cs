namespace LogiBTP.Pointage;

public sealed record RubriquePaie(string Code, string Unite = "H", string Saisie = "C");
public sealed record TranchePaie(string Rubrique, int? JusquA = null);
public sealed record ParametresRegle(List<string>? SousTypes = null, List<string>? Exclure = null, string? Base = null, int Seuil = 0, int? Valeur = null,
    List<string>? ExcluSi = null, bool Deduire = false, List<TranchePaie>? Tranches = null, int? Max = null, int? MaxSemaine = null,
    Dictionary<string, int>? Valeurs = null);
public sealed record ReglePaie(string Type, string? Rubrique = null, ParametresRegle? Parametres = null);
public sealed record PointagePaie(int Minutes, string? SousType = null, int? Zone = null);
/// <summary>Jour d'une semaine : pointages retenus, saisies, repas pris au restaurant (règle REPAS, lot 10, A29).</summary>
public sealed record JourPaie(string Date, List<PointagePaie> Pointages, Dictionary<string, int>? Saisies = null, bool Repas = false);
public sealed record JourValeurs(string Date, Dictionary<string, int> Valeurs);
public sealed record VariablesSemaine(List<JourValeurs> Jours, Dictionary<string, int> Semaine, Dictionary<string, int> Totaux);

/// <summary>
/// Variables de paie d'une semaine, répliquées avec paie.js (jeu modules/pointage/tests/cas/03_paie.json) : règles
/// typées d'un profil appliquées dans l'ordre (CUMUL_HEURES, SEUIL_JOUR, TRANCHES_SEMAINE, ZONE, PLAFOND, REPAS : valeur de
/// l'agence du salarié, sinon « * », sinon 1, chaque jour de repas au restaurant), saisies S
/// avant les règles, SC après ; totaux (zones comptées par numéro « ZONE_3 », valeurs nulles retirées).
/// </summary>
public static class ReglesPaie
{
    public static readonly IReadOnlyDictionary<string, string> Types = new Dictionary<string, string>
    {
        ["CUMUL_HEURES"] = "Cumul des heures (par sous-type)",
        ["SEUIL_JOUR"] = "Seuil journalier (panier…)",
        ["TRANCHES_SEMAINE"] = "Heures supplémentaires par tranches",
        ["ZONE"] = "Zone de déplacement du jour",
        ["PLAFOND"] = "Plafond",
        ["REPAS"] = "Repas au restaurant (avantage en nature par agence)",
    };

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["PRF_RUBRIQUE"] = "Codes de rubriques vides ou en double",
        ["PRF_REGLE"] = "Règle inconnue ou visant une rubrique absente du profil",
    };

    private static void Ajouter(Dictionary<string, int> o, string cle, int v) => o[cle] = o.GetValueOrDefault(cle) + v;

    public static VariablesSemaine Calculer(IReadOnlyList<RubriquePaie> rubriques, IReadOnlyList<ReglePaie> regles, IReadOnlyList<JourPaie> jours, bool semaineComplete = true, string? agence = null)
    {
        var saisie = rubriques.ToDictionary(r => r.Code, r => r.Saisie);
        var parJour = jours.Select(j => new JourValeurs(j.Date, [])).ToList();
        var semaine = new Dictionary<string, int>();
        for (var i = 0; i < jours.Count; i++)
        {
            foreach (var (code, v) in jours[i].Saisies ?? [])
            {
                if (saisie.GetValueOrDefault(code) == "S" && v != 0) parJour[i].Valeurs[code] = v;
            }
        }
        int Valeur(int i, string? code) => code is null ? 0 : parJour[i].Valeurs.GetValueOrDefault(code);
        bool Exclu(int i, ParametresRegle p) => (p.ExcluSi ?? []).Any(c => Valeur(i, c) > 0);
        foreach (var r in regles)
        {
            var p = r.Parametres ?? new ParametresRegle();
            switch (r.Type)
            {
                case "CUMUL_HEURES":
                    for (var i = 0; i < jours.Count; i++)
                    {
                        var m = jours[i].Pointages.Where(x => ((p.SousTypes ?? []).Count == 0 || p.SousTypes!.Contains(x.SousType ?? ""))
                            && !(p.Exclure ?? []).Contains(x.SousType ?? "")).Sum(x => x.Minutes);
                        if (m != 0) Ajouter(parJour[i].Valeurs, r.Rubrique!, m);
                    }
                    break;
                case "SEUIL_JOUR":
                    for (var i = 0; i < jours.Count; i++)
                    {
                        if (Valeur(i, p.Base) >= p.Seuil && !Exclu(i, p)) parJour[i].Valeurs[r.Rubrique!] = p.Valeur ?? 1;
                    }
                    break;
                case "TRANCHES_SEMAINE":
                {
                    if (!semaineComplete) break;
                    var total = Enumerable.Range(0, jours.Count).Sum(i => Valeur(i, p.Base));
                    var reste = total - p.Seuil;
                    if (reste <= 0) break;
                    var depasse = reste;
                    foreach (var t in p.Tranches ?? [])
                    {
                        var q = t.JusquA is int max ? Math.Min(reste, max) : reste;
                        if (q > 0)
                        {
                            Ajouter(semaine, t.Rubrique, q);
                            reste -= q;
                        }
                    }
                    if (p.Deduire) Ajouter(semaine, p.Base!, -(depasse - reste));
                    break;
                }
                case "ZONE":
                    for (var i = 0; i < jours.Count; i++)
                    {
                        var z = jours[i].Pointages.Select(x => x.Zone ?? 0).Append(0).Max();
                        if (z > 0 && !Exclu(i, p)) parJour[i].Valeurs[r.Rubrique!] = z;
                    }
                    break;
                case "REPAS":
                {
                    var v = p.Valeurs is { } valeurs ? (valeurs.TryGetValue(agence ?? "", out var a) ? a : valeurs.TryGetValue("*", out var d) ? d : 1) : 1;
                    for (var i = 0; i < jours.Count; i++)
                    {
                        if (jours[i].Repas && v > 0 && !Exclu(i, p)) parJour[i].Valeurs[r.Rubrique!] = v;
                    }
                    break;
                }
                case "PLAFOND":
                    for (var i = 0; i < jours.Count; i++)
                    {
                        if (p.Max is int max && Valeur(i, r.Rubrique) > max) parJour[i].Valeurs[r.Rubrique!] = max;
                    }
                    if (p.MaxSemaine is int maxSemaine)
                    {
                        var t = Enumerable.Range(0, jours.Count).Sum(i => Valeur(i, r.Rubrique)) + semaine.GetValueOrDefault(r.Rubrique!);
                        if (t > maxSemaine) Ajouter(semaine, r.Rubrique!, maxSemaine - t);
                    }
                    break;
            }
        }
        for (var i = 0; i < jours.Count; i++)
        {
            foreach (var (code, v) in jours[i].Saisies ?? [])
            {
                if (saisie.GetValueOrDefault(code) != "SC") continue;
                if (v != 0) parJour[i].Valeurs[code] = v;
                else parJour[i].Valeurs.Remove(code);
            }
        }
        var unite = rubriques.ToDictionary(r => r.Code, r => r.Unite);
        var totaux = new Dictionary<string, int>();
        foreach (var j in parJour)
        {
            foreach (var (code, v) in j.Valeurs)
            {
                if (unite.GetValueOrDefault(code) == "ZONE") Ajouter(totaux, $"{code}_{v}", 1);
                else Ajouter(totaux, code, v);
            }
        }
        foreach (var (code, v) in semaine) Ajouter(totaux, code, v);
        foreach (var k in totaux.Where(x => x.Value == 0).Select(x => x.Key).ToList()) totaux.Remove(k);
        return new VariablesSemaine(parJour, semaine, totaux);
    }

    public static List<string> ControlerProfil(IReadOnlyList<RubriquePaie> rubriques, IReadOnlyList<ReglePaie> regles)
    {
        var r = new List<string>();
        var codes = rubriques.Select(x => x.Code).ToList();
        if (codes.Any(string.IsNullOrEmpty) || codes.Distinct().Count() != codes.Count) r.Add("PRF_RUBRIQUE");
        foreach (var g in regles)
        {
            var p = g.Parametres ?? new ParametresRegle();
            var cibles = g.Type switch
            {
                "TRANCHES_SEMAINE" => new List<string?> { p.Base }.Concat((p.Tranches ?? []).Select(t => (string?)t.Rubrique)).ToList(),
                "SEUIL_JOUR" => [g.Rubrique, p.Base],
                _ => [g.Rubrique],
            };
            if (!Types.ContainsKey(g.Type) || cibles.Any(c => c is null || !codes.Contains(c)))
            {
                r.Add("PRF_REGLE");
                break;
            }
        }
        return r;
    }

    /// <summary>Quantité exportée : heures en décimal (2 chiffres), nombres et zones tels quels.</summary>
    public static decimal QuantiteExport(string unite, int v) => unite == "H" ? Math.Round(v / 60m, 2, MidpointRounding.AwayFromZero) : v;
}
