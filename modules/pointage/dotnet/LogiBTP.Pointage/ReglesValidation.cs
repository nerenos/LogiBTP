namespace LogiBTP.Pointage;

/// <summary>Validation d'une période (niveau CHEF ou RH, dates « AAAA-MM-JJ » incluses).</summary>
public sealed record ValidationPeriode(string Niveau, string Du, string Au, bool Annule = false);

/// <summary>Pointage retenu pour les exceptions de la synthèse.</summary>
public sealed record PointageSynthese(string Date, int Minutes, bool NonConformite = false);

/// <summary>
/// Validation des pointages, répliquée avec validation.js (jeu modules/pointage/tests/cas/02_validation.json) : état d'un
/// jour, contrôle des actions, exceptions d'une semaine.
/// </summary>
public static class ReglesValidation
{
    public const string NonValide = "NON_VALIDE";
    public const string ValideChef = "VALIDE_CHEF";
    public const string Valide = "VALIDE";

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["VAL_CHEF_SIMPLE"] = "Validation simple : seul le service RH valide",
        ["VAL_DEJA"] = "Déjà validé",
        ["VAL_RH_FAIT"] = "Déjà validé par le service RH",
        ["DEV_MOTIF"] = "Motif obligatoire pour dévalider",
        ["DEV_RIEN"] = "Rien à dévalider",
        ["DEV_RH_FAIT"] = "Validé par le service RH : seul le RH peut dévalider",
        ["EXC_CORRECTION"] = "Demande de correction en attente",
        ["EXC_SANS_POINTAGE"] = "Jour travaillé sans pointage",
        ["EXC_NON_CONFORMITE"] = "Non-conformité signalée",
        ["EXC_HEURES_SUP"] = "Heures supplémentaires",
        ["EXC_CONTROLE"] = "Contrôle à vérifier (amplitude, chantier clos…)",
        ["EXC_MODIFIE"] = "Corrigé par rapport à la saisie",
    };

    private static bool Couvre(ValidationPeriode v, string date) =>
        !v.Annule && string.CompareOrdinal(v.Du, date) <= 0 && string.CompareOrdinal(date, v.Au) <= 0;

    public static string Etat(string mode, string date, IEnumerable<ValidationPeriode> validations)
    {
        var c = validations.Where(v => Couvre(v, date)).ToList();
        if (c.Any(v => v.Niveau == "RH")) return Valide;
        if (mode == "DOUBLE" && c.Any(v => v.Niveau == "CHEF")) return ValideChef;
        return NonValide;
    }

    public static bool EstBloque(string etat) => etat != NonValide;

    public static List<string> ControlerAction(string action, string role, string mode, IReadOnlyCollection<string> etats, string? motif)
    {
        var r = new List<string>();
        if (action == "VALIDER")
        {
            if (role == "CHEF" && mode == "SIMPLE") r.Add("VAL_CHEF_SIMPLE");
            else if (role == "CHEF" && etats.Any(e => e == Valide)) r.Add("VAL_RH_FAIT");
            else if (etats.Count > 0 && etats.All(e => e == (role == "CHEF" ? ValideChef : Valide))) r.Add("VAL_DEJA");
        }
        else
        {
            if (string.IsNullOrWhiteSpace(motif)) r.Add("DEV_MOTIF");
            if (etats.All(e => e == NonValide)) r.Add("DEV_RIEN");
            else if (role == "CHEF" && etats.Any(e => e == Valide)) r.Add("DEV_RH_FAIT");
        }
        return r;
    }

    public static List<string> Exceptions(IReadOnlyCollection<string> joursTravailles, IReadOnlyCollection<PointageSynthese> pointages, int seuilSemaine,
        int avertissements = 0, int corrections = 0, bool modifie = false)
    {
        var r = new List<string>();
        if (corrections > 0) r.Add("EXC_CORRECTION");
        if (joursTravailles.Any(d => !pointages.Any(p => p.Date == d && p.Minutes > 0))) r.Add("EXC_SANS_POINTAGE");
        if (pointages.Any(p => p.NonConformite)) r.Add("EXC_NON_CONFORMITE");
        if (seuilSemaine > 0 && pointages.Sum(p => p.Minutes > 0 ? p.Minutes : 0) > seuilSemaine) r.Add("EXC_HEURES_SUP");
        if (avertissements > 0) r.Add("EXC_CONTROLE");
        if (modifie) r.Add("EXC_MODIFIE");
        return r;
    }
}
