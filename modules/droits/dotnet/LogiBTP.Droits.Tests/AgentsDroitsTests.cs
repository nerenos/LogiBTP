using LogiBTP.Droits.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Droits.Tests;

/// <summary>Plafond d'un agent appliqué par le module Droits (lot 3 du plan MCP) : intersection, interdits, routes.</summary>
public class AgentsDroitsTests
{
    private static Dictionary<string, string> A(params string[] actions) => actions.ToDictionary(a => a, _ => PorteesDroits.Tout);

    /// <summary>Profil du délégant : tout sur les devis, lecture des salariés avec RGPD, paramétrage.</summary>
    private static readonly DroitsProfil Profil = new(false, new Dictionary<string, IReadOnlyDictionary<string, string>>
    {
        ["documents"] = A(ActionsDroits.Consulter, ActionsDroits.Creer, ActionsDroits.Modifier, ActionsDroits.Valider, ActionsDroits.Supprimer, ActionsDroits.Forcer),
        ["fiches/salarie"] = A(ActionsDroits.Consulter, ActionsDroits.Modifier, ActionsDroits.Rgpd),
        ["parametres"] = A(ActionsDroits.Consulter, ActionsDroits.Modifier),
        ["structure"] = A(ActionsDroits.Consulter, ActionsDroits.Modifier),
    });

    private static PlafondAgent Plafond(string modele = ModelePlafond.Preparation, string porteeMax = PorteesDroits.Tout,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? actions = null, IReadOnlyList<string>? gardesFous = null,
        IReadOnlyList<RouteAgent>? routes = null, IReadOnlyList<string>? interdits = null) =>
        new("D1", modele, actions ?? new Dictionary<string, IReadOnlyList<string>>(), porteeMax,
            gardesFous ?? [GardeFou.Rgpd, GardeFou.Validation], routes ?? [new("POST", "/api/documents")], interdits ?? []);

    private static readonly RouteDroits RouteDocuments = new("/api/documents", ModeRoute.Module, "documents");
    private static readonly RouteDroits RouteValider = new("/api/documents/{id}/valider", ModeRoute.Action, "documents", ActionsDroits.Valider);
    private static readonly RouteDroits RouteStructure = new("/api/structure", ModeRoute.Module, "structure");

    [Fact]
    public void Preparation_refuse_valider_et_forcer_accepte_la_saisie()
    {
        var p = Plafond(gardesFous: []);
        Assert.Equal(PorteesDroits.Tout, AgentsDroits.Portee(Profil, p, "documents/V/V_DEVIS", ActionsDroits.Modifier));
        Assert.True(AgentsDroits.Autorise(Profil, p, "documents/V/V_DEVIS", ActionsDroits.Creer));
        Assert.False(AgentsDroits.Autorise(Profil, p, "documents/V/V_DEVIS", ActionsDroits.Valider));
        Assert.False(AgentsDroits.Autorise(Profil, p, "documents/V/V_DEVIS", ActionsDroits.Approuver));
        Assert.False(AgentsDroits.Autorise(Profil, Plafond(ModelePlafond.CommeMoi), "documents", ActionsDroits.Forcer));
        Assert.True(AgentsDroits.Autorise(Profil, Plafond(ModelePlafond.CommeMoi, gardesFous: []), "documents", ActionsDroits.Valider));
    }

    [Fact]
    public void Portee_la_plus_etroite_et_profil_borne()
    {
        Assert.Equal(PorteesDroits.Soi, AgentsDroits.Portee(Profil, Plafond(porteeMax: PorteesDroits.Soi), "documents", ActionsDroits.Modifier));
        Assert.Equal(PorteesDroits.Soi, AgentsDroits.Portee(Profil, Plafond(porteeMax: "INCONNUE"), "documents", ActionsDroits.Modifier));
        // Le plafond ne donne jamais plus que le profil.
        Assert.Null(AgentsDroits.Portee(Profil, Plafond(ModelePlafond.CommeMoi), "fiches/client", ActionsDroits.Consulter));
    }

    [Fact]
    public void Plafond_absent_tout_refuse()
    {
        Assert.Null(AgentsDroits.Portee(Profil, null, "documents", ActionsDroits.Consulter));
        Assert.Equal(ErreursAgent.AgentInterdit, AgentsDroits.ControlerRoute(RouteDocuments, "documents", "GET", "/api/documents", Profil, null));
        Assert.Equal(ErreursAgent.AgentInterdit,
            AgentsDroits.ControlerRoute(new("/api/auth", ModeRoute.Session), "", "GET", "/api/auth/moi", Profil, null));
    }

    [Fact]
    public void Sur_mesure_liste_qui_fait_foi_et_profil_total_borne_a_la_preparation()
    {
        var p = Plafond(ModelePlafond.SurMesure, actions: new Dictionary<string, IReadOnlyList<string>>
        {
            ["documents/V"] = [ActionsDroits.Consulter, ActionsDroits.Modifier, ActionsDroits.Supprimer],
        }, gardesFous: []);
        Assert.True(AgentsDroits.Autorise(Profil, p, "documents/V/V_DEVIS", ActionsDroits.Modifier));
        Assert.True(AgentsDroits.Autorise(Profil, p, "documents/V/V_DEVIS", ActionsDroits.Supprimer));
        Assert.False(AgentsDroits.Autorise(Profil, p, "documents/A/A_COMMANDE", ActionsDroits.Consulter));
        Assert.False(AgentsDroits.Autorise(DroitsProfil.Tous, p, "documents/V/V_DEVIS", ActionsDroits.Supprimer));
        Assert.True(AgentsDroits.Autorise(DroitsProfil.Tous, p, "documents/V/V_DEVIS", ActionsDroits.Modifier));
        Assert.False(AgentsDroits.Autorise(DroitsProfil.Tous, Plafond(ModelePlafond.CommeMoi), "documents", ActionsDroits.Consulter));
    }

    [Fact]
    public void Garde_fou_rgpd_interdits_et_noeuds_absolus()
    {
        var comme = Plafond(ModelePlafond.CommeMoi);
        Assert.False(AgentsDroits.Autorise(Profil, comme, "fiches/salarie", ActionsDroits.Rgpd));
        Assert.False(AgentsDroits.Autorise(Profil, comme, "fiches/salarie", ActionsDroits.Confidentiel));
        Assert.True(AgentsDroits.Autorise(Profil, Plafond(ModelePlafond.CommeMoi, gardesFous: []), "fiches/salarie", ActionsDroits.Rgpd));
        Assert.False(AgentsDroits.Autorise(Profil, comme, "documents", ActionsDroits.Valider));
        Assert.False(AgentsDroits.Autorise(Profil, comme, "parametres", ActionsDroits.Modifier));
        Assert.True(AgentsDroits.Autorise(Profil, comme, "parametres", ActionsDroits.Consulter));
        Assert.False(AgentsDroits.Autorise(DroitsProfil.Tous, Plafond(), "administration/profils", ActionsDroits.Consulter));
        var interdits = Plafond(ModelePlafond.CommeMoi, gardesFous: [], interdits: ["fiches/salarie", ActionsDroits.Supprimer]);
        Assert.False(AgentsDroits.Autorise(Profil, interdits, "fiches/salarie", ActionsDroits.Consulter));
        Assert.False(AgentsDroits.Autorise(Profil, interdits, "documents", ActionsDroits.Supprimer));
        Assert.True(AgentsDroits.Autorise(Profil, interdits, "documents", ActionsDroits.Valider));
    }

    [Fact]
    public void Agent_preparation_refuse_sur_une_route_valider()
    {
        Assert.Equal(ErreursAgent.AgentInterdit,
            AgentsDroits.ControlerRoute(RouteValider, "documents", "POST", "/api/documents/{id:long}/valider", Profil, Plafond()));
        // Refus du profil lui-même : ACCES_REFUSE (pas un refus de plafond).
        Assert.Equal("ACCES_REFUSE", AgentsDroits.ControlerRoute(new("/api/x", ModeRoute.Action, "fiches/client", ActionsDroits.Modifier),
            "fiches/client", "POST", "/api/x", Profil, Plafond()));
    }

    [Fact]
    public void Ecriture_en_mode_module_refusee_hors_liste_blanche_acceptee_dedans()
    {
        var p = Plafond(routes: [new("POST", "/api/documents"), new("PUT", "/api/documents/{id}")]);
        Assert.Equal(ErreursAgent.AgentInterdit, AgentsDroits.ControlerRoute(RouteStructure, "structure", "PUT", "/api/structure/documents/{id:long}/arc", Profil, p));
        Assert.Null(AgentsDroits.ControlerRoute(RouteStructure, "structure", "GET", "/api/structure/documents", Profil, p));
        Assert.Null(AgentsDroits.ControlerRoute(RouteDocuments, "documents", "POST", "/api/documents", Profil, p));
        Assert.Null(AgentsDroits.ControlerRoute(RouteDocuments, "documents", "PUT", "/api/documents/{id:long}", Profil, p));
        Assert.Equal(ErreursAgent.AgentInterdit, AgentsDroits.ControlerRoute(RouteDocuments, "documents", "DELETE", "/api/documents/{id:long}", Profil, p));
        // Liste blanche, mais plafond de lecture : l'écriture reste refusée.
        Assert.Equal(ErreursAgent.AgentInterdit,
            AgentsDroits.ControlerRoute(RouteDocuments, "documents", "POST", "/api/documents", Profil, Plafond(ModelePlafond.Lecture)));
    }

    [Fact]
    public void Session_lectures_et_liste_blanche_parametrage_en_lecture()
    {
        var session = new RouteDroits("/api/preferences", ModeRoute.Session);
        Assert.Null(AgentsDroits.ControlerRoute(session, "", "GET", "/api/preferences", Profil, Plafond()));
        Assert.Equal(ErreursAgent.AgentInterdit, AgentsDroits.ControlerRoute(session, "", "PUT", "/api/preferences", Profil, Plafond()));
        Assert.Null(AgentsDroits.ControlerRoute(session, "", "PUT", "/api/preferences",
            Profil, Plafond(routes: [new("PUT", "/api/preferences")])));
        var parametrage = new RouteDroits("/api/calendriers", ModeRoute.Parametrage);
        Assert.Null(AgentsDroits.ControlerRoute(parametrage, "", "GET", "/api/calendriers", Profil, Plafond()));
        Assert.Equal(ErreursAgent.AgentInterdit, AgentsDroits.ControlerRoute(parametrage, "", "PUT", "/api/calendriers",
            Profil, Plafond(routes: [new("PUT", "/api/calendriers")])));
    }

    [Fact]
    public void Agent_jamais_administrateur_ni_parametreur()
    {
        var admin = new Utilisateur("jean", Profils.Admin) { PeutConsulterParametres = true, PeutModifierParametres = true };
        Assert.True(admin.EstAdmin);
        var agent = admin with { Agent = new AgentRequete("D1", "client") };
        Assert.False(agent.EstAdmin);
        Assert.False(agent.PeutConsulterParametres);
        Assert.False(agent.PeutModifierParametres);
        Assert.Equal(StatusCodesForbidden, Assert.Throws<ExceptionMetier>(agent.ExigerAdmin).Statut);
        Assert.Throws<ExceptionMetier>(agent.ExigerParametres);
    }

    private const int StatusCodesForbidden = 403;
}
