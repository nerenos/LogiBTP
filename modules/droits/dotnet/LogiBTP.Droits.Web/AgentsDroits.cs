using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;

namespace LogiBTP.Droits.Web;

/// <summary>
/// Plafond d'un agent IA appliqué aux droits (lot 3 du plan MCP) : lu par le contrat <see cref="IPlafondAgent"/> du
/// socle, sans dépendre du module MCP. Droits de l'agent = droits du profil du délégant ∩ plafond de la délégation
/// (actions du modèle ou de la liste SUR_MESURE, portée la plus étroite), moins les interdits (du plafond et absolus)
/// et les actions retirées par les garde-fous RGPD et VALIDATION. Plafond absent (délégation inconnue, contrat non
/// branché) : tout refusé. Règles côté serveur seulement (le client n'agit jamais en agent).
/// </summary>
public static class AgentsDroits
{
    /// <summary>Actions jamais délégables (mêmes que ReglesDelegation.ActionsInterdites du module MCP).</summary>
    public static readonly IReadOnlyList<string> ActionsInterdites =
        [ActionsDroits.Forcer, ActionsDroits.Usurper, ActionsDroits.Parametrer, ActionsDroits.Deverrouiller];

    /// <summary>Nœuds interdits à un agent, quelle que soit l'action (préfixes ; mêmes que ReglesDelegation.NoeudsInterdits).</summary>
    public static readonly IReadOnlyList<string> NoeudsInterdits = ["administration", "connexions", "mail"];

    /// <summary>Nœud en lecture seule pour un agent (paramétrage).</summary>
    public const string NoeudParametres = "parametres";

    private static readonly IReadOnlyList<string> Preparation = [ActionsDroits.Consulter, ActionsDroits.Creer, ActionsDroits.Modifier];
    private static readonly IReadOnlyList<string> RetireesValidation = [ActionsDroits.Valider, ActionsDroits.Supprimer];
    private static readonly IReadOnlyList<string> Portees = ReglesDroits.Portees;

    /// <summary>Codes d'action connus (un interdit qui en est un vise l'action ; sinon un préfixe de nœud).</summary>
    private static readonly HashSet<string> CodesActions = typeof(ActionsDroits).GetFields()
        .Where(f => f.IsLiteral && f.FieldType == typeof(string)).Select(f => (string)f.GetRawConstantValue()!).ToHashSet();

    private static bool Sous(string noeud, string prefixe) => noeud == prefixe || noeud.StartsWith(prefixe + "/", StringComparison.Ordinal);

    private static int Rang(string? p) => p is null ? -1 : Portees.ToList().IndexOf(p);

    private static IReadOnlyList<string>? LigneDe(IReadOnlyDictionary<string, IReadOnlyList<string>>? lignes, string noeud)
    {
        if (lignes is null) return null;
        foreach (var n in ReglesDroits.Ancetres(noeud)) if (lignes.TryGetValue(n, out var l)) return l;
        return null;
    }

    /// <summary>Interdit à l'agent : action jamais délégable, nœud interdit, paramétrage hors consultation, interdit du plafond.</summary>
    public static bool EstInterdit(PlafondAgent plafond, string noeud, string action)
    {
        var brute = (action ?? "").Trim().ToUpperInvariant();
        var a = ReglesDroits.NormaliserAction(brute);
        if (ActionsInterdites.Contains(brute) || ActionsInterdites.Contains(a)) return true;
        if (NoeudsInterdits.Any(p => Sous(noeud, p))) return true;
        if (a != ActionsDroits.Consulter && Sous(noeud, NoeudParametres)) return true;
        foreach (var i in plafond.Interdits ?? [])
        {
            if (CodesActions.Contains(i) ? brute == i || a == ReglesDroits.NormaliserAction(i) : Sous(noeud, i)) return true;
        }
        if ((plafond.GardesFous ?? []).Contains(GardeFou.Rgpd) && a == ActionsDroits.Rgpd) return true;
        if ((plafond.GardesFous ?? []).Contains(GardeFou.Validation) && RetireesValidation.Contains(a)) return true;
        return false;
    }

    /// <summary>Action permise par le plafond seul (modèle et liste des actions par nœud, avec héritage).</summary>
    private static bool PermiseParPlafond(PlafondAgent plafond, bool total, string noeud, string a)
    {
        var ligne = LigneDe(plafond.Actions, noeud)?.Select(ReglesDroits.NormaliserAction).ToList();
        if (ligne is not null && !ligne.Contains(a)) return false;
        return plafond.Modele switch
        {
            ModelePlafond.Lecture => a == ActionsDroits.Consulter,
            ModelePlafond.Preparation => Preparation.Contains(a),
            // Comme moi : jamais pour un profil total (un administrateur ne délègue pas tout).
            ModelePlafond.CommeMoi => !total,
            // Sur mesure : la liste fait foi ; profil total borné à la préparation.
            ModelePlafond.SurMesure => ligne is not null && (!total || Preparation.Contains(a)),
            _ => false,
        };
    }

    /// <summary>
    /// Portée accordée à l'agent pour l'action sur le nœud (null : refusée) : portée du profil bornée par la portée maximale
    /// du plafond (null ou vide : TOUT ; inconnue : SOI). Plafond absent : null.
    /// </summary>
    public static string? Portee(DroitsProfil profil, PlafondAgent? plafond, string noeud, string action)
    {
        if (plafond is null || EstInterdit(plafond, noeud, action)) return null;
        var a = ReglesDroits.NormaliserAction(action);
        if (!PermiseParPlafond(plafond, profil.Total, noeud, a)) return null;
        var portee = ReglesDroits.PorteeAccordee(profil, noeud, action);
        if (portee is null) return null;
        var max = string.IsNullOrEmpty(plafond.PorteeMax) ? PorteesDroits.Tout : Rang(plafond.PorteeMax) >= 0 ? plafond.PorteeMax : PorteesDroits.Soi;
        return Rang(portee) <= Rang(max) ? portee : max;
    }

    public static bool Autorise(DroitsProfil profil, PlafondAgent? plafond, string noeud, string action, string porteeMin = PorteesDroits.Soi) =>
        Portee(profil, plafond, noeud, action) is { } p && Rang(p) >= Rang(porteeMin);

    /// <summary>Accès de l'agent au sous-arbre du nœud (même règle que ReglesDroits.AccesSousArbre, sur les droits de l'agent).</summary>
    public static bool AccesSousArbre(DroitsProfil profil, PlafondAgent? plafond, string noeud, bool ecriture = false)
    {
        if (plafond is null) return false;
        var prefixe = noeud + "/";
        var noeuds = new[] { noeud }.Concat(profil.Lignes.Keys).Concat(plafond.Actions?.Keys ?? Enumerable.Empty<string>())
            .Where(n => n == noeud || n.StartsWith(prefixe, StringComparison.Ordinal)).Distinct();
        foreach (var n in noeuds)
        {
            var actions = CodesActions.Concat(ReglesDroits.Effectives(profil, n).Actions.Keys).Distinct();
            if (actions.Any(a => (!ecriture || ReglesDroits.NormaliserAction(a) != ActionsDroits.Consulter) && Portee(profil, plafond, n, a) is not null)) return true;
        }
        return false;
    }

    /// <summary>Route d'écriture de la liste blanche du plafond : même méthode et gabarit égal ou sous le gabarit déclaré.</summary>
    public static bool RoutePermise(PlafondAgent? plafond, string methode, string gabarit)
    {
        if (plafond is null) return false;
        var g = RoutesDroits.Normaliser(gabarit);
        return (plafond.RoutesEcriture ?? []).Any(r =>
        {
            var p = RoutesDroits.Normaliser(r.Gabarit);
            return string.Equals(r.Methode, methode, StringComparison.OrdinalIgnoreCase)
                && (g == p || g.StartsWith(p + "/", StringComparison.Ordinal));
        });
    }

    /// <summary>
    /// Contrôle d'une route pour un agent (après rattachement à la table des routes) : code de refus, ou null si permise.
    /// Profil seul refusé : ACCES_REFUSE ; plafond : AGENT_INTERDIT. Plafond absent : tout refusé. Écritures : seulement
    /// en mode Action (droit précis, contrôlé sur les droits de l'agent) ou par la liste blanche du plafond (mode Module,
    /// Session, Publique), jamais en mode Parametrage ; lectures : droits de l'agent (Session, Publique : libres).
    /// </summary>
    public static string? ControlerRoute(RouteDroits r, string noeud, string methode, string gabarit, DroitsProfil profil, PlafondAgent? plafond)
    {
        if (plafond is null) return ErreursAgent.AgentInterdit;
        var ecriture = !HttpMethods.IsGet(methode) && !HttpMethods.IsHead(methode);
        switch (r.Mode)
        {
            case ModeRoute.Parametrage:
                if (ecriture) return ErreursAgent.AgentInterdit;
                if (!ReglesDroits.Autorise(profil, NoeudParametres, ActionsDroits.Consulter)) return "ACCES_REFUSE";
                return Autorise(profil, plafond, NoeudParametres, ActionsDroits.Consulter) ? null : ErreursAgent.AgentInterdit;
            case ModeRoute.Action:
                if (!ReglesDroits.Autorise(profil, noeud, r.Action!)) return "ACCES_REFUSE";
                return Autorise(profil, plafond, noeud, r.Action!) ? null : ErreursAgent.AgentInterdit;
            case ModeRoute.Module:
                if (!ReglesDroits.AccesSousArbre(profil, noeud, ecriture)) return "ACCES_REFUSE";
                if (ecriture && !RoutePermise(plafond, methode, gabarit)) return ErreursAgent.AgentInterdit;
                return AccesSousArbre(profil, plafond, noeud, ecriture) ? null : ErreursAgent.AgentInterdit;
            default:
                return ecriture && !RoutePermise(plafond, methode, gabarit) ? ErreursAgent.AgentInterdit : null;
        }
    }
}
