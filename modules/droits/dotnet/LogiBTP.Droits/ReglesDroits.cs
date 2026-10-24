using System.Text.RegularExpressions;

namespace LogiBTP.Droits;

/// <summary>Droits d'un profil : total (ADMIN : tout) ou lignes { nœud : { ACTION : PORTÉE } }.</summary>
public sealed record DroitsProfil(bool Total, IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Lignes)
{
    public static readonly DroitsProfil Aucun = new(false, new Dictionary<string, IReadOnlyDictionary<string, string>>());
    public static readonly DroitsProfil Tous = new(true, new Dictionary<string, IReadOnlyDictionary<string, string>>());
}

/// <summary>Actions effectives d'un nœud : nœud de la ligne retenue (null : aucune) et ses actions.</summary>
public sealed record ActionsEffectives(bool Total, string? Source, IReadOnlyDictionary<string, string> Actions);

public sealed record ErreurLigne(string Noeud, string Code, string? Action = null);

/// <summary>Limites de validation en HT : par pièce, cumul sur des jours glissants (−1 = sans limite).</summary>
public sealed record Limite(decimal Piece, decimal Cumul, int Jours);

/// <summary>
/// Règles des droits, mêmes que regles.js (jeu partagé modules/droits/tests/cas/01_droits.json) : nœud = chemin
/// « module/élément » ; un nœud sans ligne hérite de son plus proche ancêtre qui en a une ; actions en cascade pour la
/// saisie, indépendantes en base ; portées SOI &lt; SERVICE &lt; TOUT ; alias des noms d'actions des modules.
/// </summary>
public static partial class ReglesDroits
{
    public static readonly IReadOnlyList<string> Actions = ["CONSULTER", "MODIFIER", "VALIDER", "CREER", "SUPPRIMER", "DEVERROUILLER", "FORCER"];
    public static readonly IReadOnlyList<string> Portees = ["SOI", "SERVICE", "TOUT"];

    public static readonly IReadOnlyDictionary<string, string> Alias = new Dictionary<string, string>
    {
        ["VOIR"] = "CONSULTER", ["TRANSFORMER"] = "CONSULTER", ["APPROUVER"] = "VALIDER", ["DEVALIDER"] = "DEVERROUILLER",
        ["DEBLOQUER"] = "DEVERROUILLER", ["CONFIDENTIEL"] = "RGPD",
    };

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["PROFIL_CODE"] = "Code du profil : 2 à 30 caractères, une lettre puis lettres, chiffres ou _ (majuscules)",
        ["PROFIL_LIBELLE"] = "Libellé du profil obligatoire (100 caractères au plus)",
        ["NOEUD_INVALIDE"] = "Nœud de droits invalide",
        ["ACTION_INCONNUE"] = "Action inconnue pour ce nœud",
        ["PORTEE_INCONNUE"] = "Portée inconnue (SOI, SERVICE ou TOUT)",
        ["LIMITE_MONTANT"] = "Montant de validation : −1 (sans limite), 0 (sur demande) ou un montant positif",
        ["LIMITE_JOURS"] = "Période du cumul : de 1 à 366 jours",
    };

    private static int Rang(string? p) => p is null ? -1 : Portees.ToList().IndexOf(p);

    public static string NormaliserAction(string? action)
    {
        var a = (action ?? "").Trim().ToUpperInvariant();
        return Alias.GetValueOrDefault(a, a);
    }

    public static string? Parent(string noeud)
    {
        var i = noeud.LastIndexOf('/');
        return i < 0 ? null : noeud[..i];
    }

    public static IEnumerable<string> Ancetres(string noeud)
    {
        for (string? n = noeud; !string.IsNullOrEmpty(n); n = Parent(n)) yield return n;
    }

    public static ActionsEffectives Effectives(DroitsProfil droits, string noeud)
    {
        if (droits.Total) return new(true, null, new Dictionary<string, string>());
        foreach (var n in Ancetres(noeud))
        {
            if (droits.Lignes.TryGetValue(n, out var a)) return new(false, n, new Dictionary<string, string>(a));
        }
        return new(false, null, new Dictionary<string, string>());
    }

    public static string? PorteeAccordee(DroitsProfil droits, string noeud, string action)
    {
        var e = Effectives(droits, noeud);
        return e.Total ? "TOUT" : e.Actions.GetValueOrDefault(NormaliserAction(action));
    }

    public static bool Autorise(DroitsProfil droits, string noeud, string action, string porteeMin = "SOI")
    {
        var p = PorteeAccordee(droits, noeud, action);
        return p is not null && Rang(p) >= Rang(porteeMin);
    }

    public static bool AccesSousArbre(DroitsProfil droits, string noeud, bool ecriture = false)
    {
        if (droits.Total) return true;
        bool Utile(IReadOnlyDictionary<string, string> actions) => actions.Keys.Any(a => !ecriture || a != "CONSULTER");
        if (Utile(Effectives(droits, noeud).Actions)) return true;
        var prefixe = noeud + "/";
        return droits.Lignes.Any(l => l.Key.StartsWith(prefixe, StringComparison.Ordinal) && Utile(l.Value));
    }

    public static Dictionary<string, string> Cocher(IReadOnlyDictionary<string, string> actions, string action, string portee = "TOUT")
    {
        var res = new Dictionary<string, string>(actions);
        var i = Actions.ToList().IndexOf(action);
        if (i < 0)
        {
            res[action] = portee;
            return res;
        }
        for (var k = 0; k <= i; k++)
        {
            var a = Actions[k];
            if (k == i || !res.TryGetValue(a, out var p) || Rang(p) < Rang(portee)) res[a] = portee;
        }
        return res;
    }

    public static Dictionary<string, string> Decocher(IReadOnlyDictionary<string, string> actions, string action)
    {
        var res = new Dictionary<string, string>(actions);
        res.Remove(action);
        return res;
    }

    public static Dictionary<string, IReadOnlyDictionary<string, string>> Reappliquer(IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> lignes, string noeud)
    {
        var prefixe = noeud + "/";
        return lignes.Where(l => !l.Key.StartsWith(prefixe, StringComparison.Ordinal)).ToDictionary(l => l.Key, l => l.Value);
    }

    /// <summary>Limite du nœud ou de son plus proche ancêtre qui en a une (null : aucune).</summary>
    public static Limite? LimiteEffective(IReadOnlyDictionary<string, Limite> limites, string noeud)
    {
        foreach (var n in Ancetres(noeud)) if (limites.TryGetValue(n, out var l)) return l;
        return null;
    }

    /// <summary>Limite dépassée : PIECE (montant de la pièce), CUMUL (avec les pièces de la période), null sinon.</summary>
    public static string? Depassement(Limite limite, decimal montant, decimal cumulAnterieur) =>
        limite.Piece >= 0 && montant > limite.Piece ? "PIECE"
        : limite.Cumul >= 0 && cumulAnterieur + montant > limite.Cumul ? "CUMUL"
        : null;

    /// <summary>Contrôle d'une limite saisie : montants ≥ −1, jours de 1 à 366.</summary>
    public static List<string> ControlerLimite(Limite l)
    {
        var erreurs = new List<string>();
        if (l.Piece < -1 || l.Cumul < -1) erreurs.Add("LIMITE_MONTANT");
        if (l.Jours is < 1 or > 366) erreurs.Add("LIMITE_JOURS");
        return erreurs;
    }

    [GeneratedRegex("^[A-Z][A-Z0-9_]{1,29}$")]
    private static partial Regex CodeProfil();

    public static List<string> ControlerProfil(string? code, string? libelle)
    {
        var erreurs = new List<string>();
        if (!CodeProfil().IsMatch(code ?? "")) erreurs.Add("PROFIL_CODE");
        var l = (libelle ?? "").Trim();
        if (l.Length == 0 || l.Length > 100) erreurs.Add("PROFIL_LIBELLE");
        return erreurs;
    }

    public static List<ErreurLigne> ControlerLignes(IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> lignes, IReadOnlyDictionary<string, IReadOnlyList<string>> catalogue)
    {
        var erreurs = new List<ErreurLigne>();
        foreach (var noeud in lignes.Keys.Order(StringComparer.Ordinal))
        {
            if (!catalogue.TryGetValue(noeud, out var permises))
            {
                erreurs.Add(new(noeud, "NOEUD_INVALIDE"));
                continue;
            }
            foreach (var (action, portee) in lignes[noeud].OrderBy(a => a.Key, StringComparer.Ordinal))
            {
                if (!permises.Contains(action)) erreurs.Add(new(noeud, "ACTION_INCONNUE", action));
                else if (!Portees.Contains(portee)) erreurs.Add(new(noeud, "PORTEE_INCONNUE", action));
            }
        }
        return erreurs;
    }
}
