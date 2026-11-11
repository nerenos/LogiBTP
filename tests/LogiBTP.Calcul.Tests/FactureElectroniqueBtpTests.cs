using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Droits;
using LogiBTP.Droits.Web;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using LogiBTP.Socle.Testing;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Branchement du module Facturation électronique (plans/facturation-electronique.md, lot 11) : toutes les routes
/// /api/facture-electronique rattachées au nœud « facture_electronique » (ou au paramétrage) et refusées sans droit
/// (même décision que l'intergiciel UseDroits : 403), actions sur un flux réservées à Modifier ; spécialisation et
/// fabrique des connecteurs par portée (jeton OAuth de la requête) ; signaux de notification.
/// </summary>
public class FactureElectroniqueBtpTests
{
    private static readonly SpecialisationDroitsBtp Droits = new();

    /// <summary>Routes du module telles que l'API les publie (gabarit, méthode).</summary>
    private static List<(string Gabarit, string Methode)> RoutesDuModule()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddSingleton(new SocieteCourante(null, "Essai", "Host=localhost;Database=essai"));
        builder.Services.AddModuleFactureElectronique<SpecialisationFactureElectroniqueBtp>((_, o) => o.UseNpgsql("Host=localhost"), new ConfigurationBuilder().Build());
        var app = builder.Build();
        app.MapGroup("/api").MapGroup("").ExigeModule(ModulesFacultatifs.FactureElectronique, "Facturation électronique").MapModuleFactureElectronique()
            .MapReceptionHorsPlateforme().MapAnnuaireFe();
        return [.. ((IEndpointRouteBuilder)app).DataSources.SelectMany(d => d.Endpoints).OfType<RouteEndpoint>()
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["GET"]).Select(m => (e.RoutePattern.RawText!, m)))];
    }

    /// <summary>Décision de UseDroits pour une route (vrai : permise ; faux : 403).</summary>
    private static bool Permis(DroitsProfil droits, string gabarit, string methode, Utilisateur u)
    {
        var r = RoutesDroits.Trouver(Droits.Routes, gabarit);
        if (r is null) return false;
        var ecriture = !HttpMethods.IsGet(methode) && !HttpMethods.IsHead(methode);
        return r.Mode switch
        {
            ModeRoute.Parametrage => u.EstAdmin || (ecriture
                ? ReglesDroits.Autorise(droits, "parametres", ActionsDroits.Modifier)
                : ReglesDroits.Autorise(droits, "parametres", ActionsDroits.Consulter)),
            ModeRoute.Module => ReglesDroits.AccesSousArbre(droits, r.Noeud!, ecriture),
            ModeRoute.Action => ReglesDroits.Autorise(droits, r.Noeud!, r.Action!),
            _ => true,
        };
    }

    private static DroitsProfil Avec(params string[] actions) => new(false, new Dictionary<string, IReadOnlyDictionary<string, string>>
    {
        [SpecialisationFactureElectroniqueBtp.Noeud] = actions.ToDictionary(a => a, _ => "TOUT"),
    });

    private static readonly Utilisateur Saisie = new("dupont", "SAISIE");

    [Fact]
    public void Toutes_les_routes_sont_declarees_et_refusees_sans_droit()
    {
        var routes = RoutesDuModule();
        Assert.True(routes.Count >= 12, $"{routes.Count} routes");
        foreach (var (g, m) in routes)
        {
            Assert.True(g.StartsWith("/api/facture-electronique/", StringComparison.Ordinal), g);
            var r = RoutesDroits.Trouver(Droits.Routes, g);
            Assert.NotNull(r);
            Assert.True(r.Mode == ModeRoute.Parametrage || r.Noeud == SpecialisationFactureElectroniqueBtp.Noeud, $"{g} → {r.Noeud}");
            Assert.False(Permis(DroitsProfil.Aucun, g, m, Saisie), $"{m} {g} permise sans droit");
            Assert.True(Permis(DroitsProfil.Tous, g, m, Saisie), $"{m} {g} refusée au profil total");
        }
    }

    [Fact]
    public void Consulter_lit_les_flux_et_Modifier_agit_sur_un_flux()
    {
        var routes = RoutesDuModule();
        var lecture = Avec(ActionsDroits.Consulter);
        var modification = Avec(ActionsDroits.Consulter, ActionsDroits.Modifier);
        foreach (var (g, m) in routes.Where(x => !x.Gabarit.Contains("/parametres", StringComparison.Ordinal) && !x.Gabarit.EndsWith("/annuaire/option", StringComparison.Ordinal)))
        {
            Assert.Equal(HttpMethods.IsGet(m), Permis(lecture, g, m, Saisie));
            Assert.True(Permis(modification, g, m, Saisie), $"{m} {g}");
        }
        // Paramètres de la plateforme : nœud « parametres », pas le nœud du module.
        Assert.False(Permis(modification, "/api/facture-electronique/parametres", "PUT", Saisie));
        Assert.True(Permis(modification, "/api/facture-electronique/parametres", "PUT", new Utilisateur("admin", Profils.Admin)));
        Assert.Contains(routes, x => x.Gabarit == "/api/facture-electronique/chronologie");
        // Annuaire (lot 20) : vérification d'une fiche = Modifier du nœud ; option de nuit = paramétrage.
        Assert.Contains(routes, x => x.Gabarit == "/api/facture-electronique/annuaire/personnes/{id:long}/verification");
        Assert.False(Permis(modification, "/api/facture-electronique/annuaire/option", "PUT", Saisie));
        Assert.True(Permis(modification, "/api/facture-electronique/annuaire/option", "PUT", new Utilisateur("admin", Profils.Admin)));
        // Facture d'une pièce jointe d'un courriel (lot 14, route du cœur) : Modifier.
        Assert.Contains(routes, x => x.Gabarit == "/api/facture-electronique/courriels/{id:long}/facture");
    }

    [Fact]
    public void Specialisation_et_fabrique_par_portee()
    {
        var services = new ServiceCollection();
        services.AddModuleFactureElectronique<SpecialisationFactureElectroniqueBtp>((_, o) => o.UseNpgsql("Host=localhost"));
        Assert.Equal(ServiceLifetime.Scoped, services.Single(s => s.ServiceType == typeof(SpecialisationFactureElectronique)).Lifetime);
        Assert.Equal(ServiceLifetime.Scoped, services.Single(s => s.ServiceType == typeof(FabriqueConnecteurs)).Lifetime);
        Assert.Equal(typeof(SpecialisationFactureElectroniqueBtp), services.Single(s => s.ServiceType == typeof(SpecialisationFactureElectronique)).ImplementationType);
    }

    private static FluxFe Flux(string? type = TypesElementFe.Document, string? id = "42") => new() { FflId = 7, FflTypeElement = type, FflIdElement = id, FflNumero = "FA-1" };

    [Fact]
    public void Signaux_des_etapes_et_des_statuts()
    {
        var f = Flux();
        Assert.Equal(SignauxFe.Recue, SpecialisationFactureElectroniqueBtp.SignalDe(new(EvenementFe.Reception, f, EtatFlux.Recu)));
        Assert.Equal(SignauxFe.Rejet, SpecialisationFactureElectroniqueBtp.SignalDe(new(EvenementFe.Accuse, f, EtatFlux.Erreur, "REJET")));
        Assert.Null(SpecialisationFactureElectroniqueBtp.SignalDe(new(EvenementFe.Accuse, f, EtatFlux.Acquitte)));
        Assert.Equal(SignauxFe.ErreurFile, SpecialisationFactureElectroniqueBtp.SignalDe(new(EvenementFe.Erreur, f, EtatFlux.Erreur)));
        Assert.Null(SpecialisationFactureElectroniqueBtp.SignalDe(new(EvenementFe.Depot, f, EtatFlux.Envoye)));
        Assert.Equal(SignauxFe.Rejet, SpecialisationFactureElectroniqueBtp.SignalDuStatut(StatutCdv.Rejetee));
        Assert.Equal(SignauxFe.Refus, SpecialisationFactureElectroniqueBtp.SignalDuStatut(StatutCdv.Refusee));
        Assert.Equal(SignauxFe.Litige, SpecialisationFactureElectroniqueBtp.SignalDuStatut(StatutCdv.EnLitige));
        Assert.Null(SpecialisationFactureElectroniqueBtp.SignalDuStatut(StatutCdv.Approuvee));
        Assert.Equal(NiveauNotification.Urgent, SpecialisationFactureElectroniqueBtp.NiveauParDefaut(SignauxFe.Refus));
        Assert.Equal(NiveauNotification.Info, SpecialisationFactureElectroniqueBtp.NiveauParDefaut(SignauxFe.Recue));
        // Un type de notification par signal (préférences), tous du module « facture_electronique ».
        var codes = typeof(SignauxFe).GetFields().Select(x => (string)x.GetValue(null)!).Order().ToList();
        Assert.Equal(codes, SpecialisationFactureElectroniqueBtp.Types.Select(t => t.Type).Order().ToList());
        Assert.All(SpecialisationFactureElectroniqueBtp.Types, t => Assert.Equal(SpecialisationFactureElectroniqueBtp.ModuleNotification, t.Module));
    }

    [Fact]
    public void Adresse_de_la_piece_sinon_du_flux()
    {
        Assert.Equal(42, SpecialisationFactureElectroniqueBtp.PieceDu(Flux()));
        Assert.Null(SpecialisationFactureElectroniqueBtp.PieceDu(Flux(id: "x")));
        Assert.Null(SpecialisationFactureElectroniqueBtp.PieceDu(Flux(type: "AUTRE")));
        Assert.Equal("/document/42", SpecialisationFactureElectroniqueBtp.Url(Flux()));
        Assert.Equal("/facture-electronique?flux=7", SpecialisationFactureElectroniqueBtp.Url(Flux(type: null, id: null)));
        Assert.Equal("/facture-electronique", SpecialisationFactureElectroniqueBtp.Url(null));
        var (titre, texte) = SpecialisationFactureElectroniqueBtp.Libelle(SignauxFe.Refus, "FA-1", StatutCdv.Refusee, "REF");
        Assert.Contains("FA-1", titre);
        Assert.Equal("210 : REF", texte);
    }

    [Fact]
    public void Noeud_au_catalogue_et_module_facultatif()
    {
        Assert.Equal("facture_electronique", ModulesFacultatifs.FactureElectronique);
        var script = File.ReadAllText(CasPartages.Chemin("db", "295_facture_electronique.sql"));
        Assert.Contains("'facture_electronique'", script);
        // Signaux insérés par 295, puis PAIEMENT_DIRECT par 297 (lot 15, contrainte des codes élargie).
        var signaux = script + File.ReadAllText(CasPartages.Chemin("db", "297_facture_electronique_sous_traitance.sql"));
        foreach (var s in typeof(SignauxFe).GetFields().Select(x => (string)x.GetValue(null)!)) Assert.Contains($"('{s}'", signaux);
        Assert.Contains("db/297_facture_electronique_sous_traitance.sql rejouable", File.ReadAllText(CasPartages.Chemin("db", "installation", "scripts.txt")));
        Assert.Contains("db/295_facture_electronique.sql rejouable", File.ReadAllText(CasPartages.Chemin("db", "installation", "scripts.txt")));
    }
}
