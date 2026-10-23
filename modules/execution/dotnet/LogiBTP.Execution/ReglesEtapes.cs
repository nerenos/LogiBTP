namespace LogiBTP.Execution;

/// <summary>
/// Étape d'un ordre (état personnalisé de son type) : nature TACHE | JALON | ATTENTE, durée et unité H | OUV | CAL, amonts
/// (null : l'étape précédente), date obligatoire, contrôle du N+1 (bloquant ou non), dates de validation, de contrôle et
/// date prévisionnelle imposée.
/// </summary>
public sealed record EtapeOrdre(string Code, string Nature = "TACHE", decimal Duree = 0, string Unite = "OUV", IReadOnlyList<string>? Amonts = null,
    bool DateObligatoire = false, bool Controle = false, bool ControleBloquant = false, DateOnly? ValideLe = null, DateOnly? ControleLe = null,
    DateOnly? PrevuImpose = null, int? Ordre = null);

/// <summary>Calendrier des dates prévisionnelles : minutes de la semaine type (lundi = 0) et minutes de jours précis.</summary>
public sealed record CalendrierEtapes(IReadOnlyList<int>? Semaine = null, IReadOnlyDictionary<DateOnly, int>? Jours = null);

/// <summary>Résultat d'une demande de validation : étapes validées ensemble, erreurs, avertissements.</summary>
public sealed record ValidationEtapes(List<string> Codes, List<string> Erreurs, List<string> Avertissements);

/// <summary>Dates prévisionnelles d'une étape : début possible et jour où l'état doit être atteint.</summary>
public sealed record DatesEtape(string Code, DateOnly Debut, DateOnly Prevu);

/// <summary>
/// Étapes d'un ordre, répliquées dans etapes.js (jeu modules/execution/tests/cas/02_etapes.json) : validation,
/// annulation, étape en cours, état d'exécution déduit, dates prévisionnelles par enchaînement, contrôle des états d'un type.
/// </summary>
public static class ReglesEtapes
{
    public static readonly string[] Natures = ["TACHE", "JALON", "ATTENTE"];
    public static readonly string[] Unites = ["H", "OUV", "CAL"];
    private static readonly int[] SemaineDefaut = [420, 420, 420, 420, 420, 0, 0];

    private static List<EtapeOrdre> Trier(IReadOnlyList<EtapeOrdre> etapes) =>
        etapes.Select((e, i) => (e, i)).OrderBy(x => x.e.Ordre ?? x.i).ThenBy(x => x.i).Select(x => x.e).ToList();

    /// <summary>Prédécesseurs : les amonts de l'étape, sinon l'étape précédente.</summary>
    public static List<string> Predecesseurs(IReadOnlyList<EtapeOrdre> etapes, string code)
    {
        var liste = Trier(etapes);
        var i = liste.FindIndex(e => e.Code == code);
        if (i < 0) return [];
        if (liste[i].Amonts is { } a) return a.Where(x => liste.Any(e => e.Code == x)).ToList();
        return i > 0 ? [liste[i - 1].Code] : [];
    }

    /// <summary>Validation d'une étape : elle et ses prédécesseurs masqués non validés, de proche en proche.</summary>
    public static ValidationEtapes AValider(IReadOnlyList<EtapeOrdre> etapes, string code)
    {
        var parCode = etapes.ToDictionary(e => e.Code);
        if (!parCode.TryGetValue(code, out var e)) return new([], ["ETP_INCONNUE"], []);
        if (e.ValideLe is not null) return new([], ["ETP_DEJA_VALIDEE"], []);
        var codes = new List<string> { code };
        var attente = new List<string>();
        var vus = new HashSet<string> { code };
        for (var k = 0; k < codes.Count; k++)
        {
            foreach (var p in Predecesseurs(etapes, codes[k]))
            {
                if (!vus.Add(p)) continue;
                var x = parCode[p];
                if (x.ValideLe is not null) continue;
                if (x.DateObligatoire) attente.Add(p);
                else codes.Add(p);
            }
        }
        var erreurs = new List<string>();
        var avertissements = new List<string>();
        if (attente.Count > 0) erreurs.Add("ETP_ORDRE");
        var controles = new List<string>();
        foreach (var c in codes)
        {
            foreach (var p in Predecesseurs(etapes, c))
            {
                if (!codes.Contains(p) && !controles.Contains(p)) controles.Add(p);
            }
        }
        foreach (var p in controles)
        {
            var x = parCode[p];
            if (x.ValideLe is null || !x.Controle || x.ControleLe is not null) continue;
            if (x.ControleBloquant) { if (!erreurs.Contains("ETP_CONTROLE")) erreurs.Add("ETP_CONTROLE"); }
            else if (!avertissements.Contains("ETP_CONTROLE_ATTENTE")) avertissements.Add("ETP_CONTROLE_ATTENTE");
        }
        var ordre = Trier(etapes).Select(x => x.Code).ToList();
        return new(erreurs.Count > 0 ? [] : codes.OrderBy(ordre.IndexOf).ToList(), erreurs, avertissements);
    }

    /// <summary>Annulation d'une validation : refusée si l'étape n'est pas validée ou si une suivante l'est.</summary>
    public static List<string> ControlerAnnulation(IReadOnlyList<EtapeOrdre> etapes, string code)
    {
        var e = etapes.FirstOrDefault(x => x.Code == code);
        if (e is null) return ["ETP_INCONNUE"];
        if (e.ValideLe is null) return ["ETP_NON_VALIDEE"];
        return etapes.Any(x => x.ValideLe is not null && Predecesseurs(etapes, x.Code).Contains(code)) ? ["ETP_SUIVANT_VALIDE"] : [];
    }

    /// <summary>Étape en cours : la première non validée dont les prédécesseurs sont validés ; null si tout est validé.</summary>
    public static string? EnCours(IReadOnlyList<EtapeOrdre> etapes)
    {
        var liste = Trier(etapes);
        var parCode = liste.ToDictionary(e => e.Code);
        var libre = liste.FirstOrDefault(e => e.ValideLe is null && Predecesseurs(liste, e.Code).All(p => parCode[p].ValideLe is not null));
        return (libre ?? liste.FirstOrDefault(e => e.ValideLe is null))?.Code;
    }

    /// <summary>État d'exécution déduit des étapes (bloqué reste bloqué ; sans étape : l'état actuel).</summary>
    public static string EtatExecution(IReadOnlyList<EtapeOrdre> etapes, string? actuel)
    {
        if (actuel == "BLOQUE") return "BLOQUE";
        if (etapes.Count == 0) return actuel ?? "A_FAIRE";
        if (etapes.All(e => e.ValideLe is not null)) return "TERMINE";
        if (!etapes.Any(e => e.ValideLe is not null)) return "A_FAIRE";
        var code = EnCours(etapes);
        return etapes.FirstOrDefault(e => e.Code == code)?.Nature == "ATTENTE" ? "EN_ATTENTE" : "EN_COURS";
    }

    private static int Minutes(CalendrierEtapes? c, int n)
    {
        var d = DateOnly.FromDayNumber(n);
        if (c?.Jours is { } j && j.TryGetValue(d, out var m)) return m;
        var semaine = c?.Semaine ?? SemaineDefaut;
        var i = ((int)d.DayOfWeek + 6) % 7;
        return i < semaine.Count ? semaine[i] : 0;
    }

    private static int Fin(EtapeOrdre e, int pos, CalendrierEtapes? c)
    {
        var duree = Math.Max(0, e.Duree);
        if (e.Nature == "JALON" || duree == 0) return pos;
        if (e.Unite == "CAL") return pos + (int)Math.Ceiling(duree);
        var n = pos;
        if (e.Unite == "H")
        {
            var reste = (int)Math.Round(duree * 60, MidpointRounding.AwayFromZero);
            for (var garde = 0; reste > 0 && garde < 3660; garde++, n++) reste -= Minutes(c, n);
            return n;
        }
        var jours = (int)Math.Ceiling(duree);
        for (var garde = 0; jours > 0 && garde < 3660; garde++, n++) if (Minutes(c, n) > 0) jours--;
        return n;
    }

    /// <summary>Dates prévisionnelles par enchaînement (validée : date de validation ; imposée : gardée).</summary>
    public static List<DatesEtape> Dates(IReadOnlyList<EtapeOrdre> etapes, DateOnly debut, CalendrierEtapes? calendrier)
    {
        var liste = Trier(etapes);
        var fins = new Dictionary<string, int>();
        var depart = debut.DayNumber;
        var res = new List<DatesEtape>();
        foreach (var e in liste)
        {
            var preds = Predecesseurs(liste, e.Code);
            var pos = preds.Count > 0 ? preds.Max(p => fins.TryGetValue(p, out var f) ? f : depart) : depart;
            int fin, prevu;
            if (e.ValideLe is { } v) { prevu = v.DayNumber; fin = prevu + 1; }
            else if (e.PrevuImpose is { } i) { prevu = i.DayNumber; fin = prevu + 1; }
            else { fin = Fin(e, pos, calendrier); prevu = fin > pos ? fin - 1 : pos; }
            fins[e.Code] = fin;
            res.Add(new DatesEtape(e.Code, DateOnly.FromDayNumber(pos), DateOnly.FromDayNumber(prevu)));
        }
        return res;
    }

    /// <summary>Contrôle des états d'un type d'ordre (codes, doublons, amonts, boucles, natures, durées), triés.</summary>
    public static List<string> Controler(IReadOnlyList<EtapeOrdre> etapes)
    {
        var erreurs = new SortedSet<string>(StringComparer.Ordinal);
        var codes = etapes.Select(e => e.Code).ToList();
        foreach (var e in etapes)
        {
            if (string.IsNullOrWhiteSpace(e.Code)) erreurs.Add("ETP_CODE");
            if (!string.IsNullOrEmpty(e.Nature) && !Natures.Contains(e.Nature)) erreurs.Add("ETP_NATURE");
            if (e.Duree < 0 || (!string.IsNullOrEmpty(e.Unite) && !Unites.Contains(e.Unite))) erreurs.Add("ETP_DUREE");
            if ((e.Amonts ?? []).Any(a => !codes.Contains(a))) erreurs.Add("ETP_AMONT");
        }
        if (codes.Distinct().Count() != codes.Count) erreurs.Add("ETP_DOUBLON");
        var amonts = new Dictionary<string, IReadOnlyList<string>>();
        foreach (var e in etapes) amonts.TryAdd(e.Code, e.Amonts ?? []);
        var etat = new Dictionary<string, int>();
        bool Visiter(string c)
        {
            if (etat.TryGetValue(c, out var s)) return s == 1;
            etat[c] = 1;
            var boucle = amonts.TryGetValue(c, out var a) && a.Any(x => amonts.ContainsKey(x) && Visiter(x));
            etat[c] = 2;
            return boucle;
        }
        if (codes.Any(Visiter)) erreurs.Add("ETP_BOUCLE");
        return [.. erreurs];
    }
}
