using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LogiBTP.Mail.Web;

/// <summary>Branchement du module Mail.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleMail<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options,
        IConfiguration section) where TSpecialisation : SpecialisationMail
    {
        services.Configure<OptionsMail>(section);
        services.AddDbContext<MailDbContext>(options);
        services.TryAddSingleton<ITransportMail, TransportMailKit>();
        services.TryAddSingleton<NettoyageHtmlMail>();
        services.AddScoped<SpecialisationMail, TSpecialisation>();
        services.AddScoped<ServiceComptesMail>();
        services.AddScoped<IUtilisationsConnexion>(sp => sp.GetRequiredService<ServiceComptesMail>());
        services.AddScoped<ServiceEnvoiMail>();
        services.AddScoped<ServiceReceptionMail>();
        services.AddSingleton<ReleveMail>();
        services.AddHostedService(sp => sp.GetRequiredService<ReleveMail>());
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<EnvoiMail>();
        services.AddHostedService(sp => sp.GetRequiredService<EnvoiMail>());
        return services;
    }

    public sealed record DemandeAlias(List<AliasDto> Alias);

    /// <summary>Routes HTTP du module, sous /mail.</summary>
    public static RouteGroupBuilder MapModuleMail(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/mail");
        // Paramétrage (administrateur, sauf la liste des alias et des usages connus).
        g.MapGet("/comptes", (HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.ComptesAsync(Utilisateur.Depuis(http), ct));
        g.MapPost("/comptes", (SaisieCompte c, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.CreerAsync(Utilisateur.Depuis(http), c, ct));
        g.MapPut("/comptes/{id:long}", (long id, SaisieCompte c, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.ModifierAsync(Utilisateur.Depuis(http), id, c, ct));
        g.MapDelete("/comptes/{id:long}", async (long id, HttpContext http, ServiceComptesMail s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(Utilisateur.Depuis(http), id, ct);
            return Results.NoContent();
        });
        g.MapPost("/comptes/{id:long}/tester", (long id, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.TesterAsync(Utilisateur.Depuis(http), id, ct));
        g.MapGet("/comptes/{id:long}/adresse", (long id, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.AdresseAsync(Utilisateur.Depuis(http), id, ct));
        g.MapPut("/comptes/{id:long}/alias", (long id, DemandeAlias d, HttpContext http, ServiceComptesMail s, CancellationToken ct) =>
            s.EnregistrerAliasAsync(Utilisateur.Depuis(http), id, d.Alias, ct));
        g.MapPost("/comptes/{id:long}/reprendre", (long id, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.ReprendreAsync(Utilisateur.Depuis(http), id, ct)).EnTransaction();
        g.MapGet("/alias", (ServiceComptesMail s, CancellationToken ct) => s.AliasAsync(ct));
        g.MapGet("/disponible", async (ServiceEnvoiMail s, CancellationToken ct) => Results.Ok(new { disponible = await s.DisponibleAsync(ct) }));
        g.MapGet("/usages", async (ServiceComptesMail s, CancellationToken ct) => Results.Ok(new { connus = s.UsagesConnus, usages = await s.UsagesAsync(ct) }));
        g.MapPut("/usages", (List<UsageDto> l, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.EnregistrerUsagesAsync(Utilisateur.Depuis(http), l, ct));
        g.MapGet("/modeles", (ServiceComptesMail s, CancellationToken ct) => s.ModelesAsync(ct));
        g.MapPost("/modeles", (ModeleDto m, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.EnregistrerModeleAsync(Utilisateur.Depuis(http), m, ct)).EnTransaction();
        g.MapDelete("/modeles/{id:long}", (long id, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.SupprimerModeleAsync(Utilisateur.Depuis(http), id, ct));
        g.MapGet("/parametres", (ServiceComptesMail s, CancellationToken ct) => s.ParametresAsync(ct));
        g.MapPut("/parametres", (Dictionary<string, int> p, HttpContext http, ServiceComptesMail s, CancellationToken ct) => s.EnregistrerParametresAsync(Utilisateur.Depuis(http), p, ct));
        // Envoi.
        g.MapGet("/preparer", (string? type, string? id, string? usage, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) =>
            s.PreparerAsync(Utilisateur.Depuis(http), type, id, usage, ct));
        g.MapPost("/estimer", (DemandeEstimation d, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.EstimerAsync(Utilisateur.Depuis(http), d, ct));
        g.MapPost("/envoyer", (DemandeEnvoi d, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.EnvoyerAsync(Utilisateur.Depuis(http), d, ct));
        // Consultation.
        g.MapGet("/messages", (string? vue, string? type, string? id, long? lot, int? page, int? taille, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) =>
            s.MessagesAsync(Utilisateur.Depuis(http), vue, type, id, lot, page ?? 1, taille ?? 50, ct));
        g.MapGet("/messages/{id:long}", (long id, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.MessageAsync(Utilisateur.Depuis(http), id, ct));
        g.MapPost("/messages/{id:long}/annuler", (long id, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.AnnulerAsync(Utilisateur.Depuis(http), id, ct));
        g.MapPost("/messages/{id:long}/relancer", (long id, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.RelancerAsync(Utilisateur.Depuis(http), id, ct));
        g.MapGet("/lots", (HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.LotsAsync(Utilisateur.Depuis(http), ct));
        g.MapGet("/journal", (long? compte, DateTimeOffset? du, DateTimeOffset? au, string? resultat, int? page, HttpContext http, ServiceEnvoiMail s, CancellationToken ct) =>
            s.JournalAsync(Utilisateur.Depuis(http), compte, du, au, resultat, page ?? 1, ct));
        g.MapGet("/compteurs", (HttpContext http, ServiceEnvoiMail s, CancellationToken ct) => s.CompteursAsync(Utilisateur.Depuis(http), ct));
        // Réception : boîtes visibles, relève immédiate, courriels reçus, rattachement, ignorer, adresse non remise.
        g.MapGet("/boites", async (HttpContext http, ServiceReceptionMail r, ServiceComptesMail s, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var alias = await s.AliasAsync(ct);
            var res = new List<object>();
            foreach (var c in await s.ComptesReceptionAsync(ct))
            {
                if (await r.PeutVoirAsync(u, c, ct))
                    res.Add(new { id = c.McoId, alias = alias.FirstOrDefault(a => a.CompteId == c.McoId && a.Principal)?.Nom ?? c.McoCode, releve_le = c.McoReleveLe, releve_erreur = c.McoReleveErreur });
            }
            return res;
        });
        g.MapPost("/comptes/{id:long}/relever", async (long id, HttpContext http, ServiceReceptionMail r, CancellationToken ct) =>
            Results.Ok(new { nouveaux = await r.ReleverMaintenantAsync(Utilisateur.Depuis(http), id, ct) }));
        g.MapGet("/recus", (string? vue, long? compte, int? page, int? taille, HttpContext http, ServiceReceptionMail r, CancellationToken ct) =>
            r.RecusAsync(Utilisateur.Depuis(http), vue, compte, page ?? 1, taille ?? 50, ct));
        g.MapGet("/rattachement/types", (ServiceReceptionMail r) => r.TypesRattachement);
        g.MapGet("/regles", (ServiceReceptionMail r, CancellationToken ct) => r.ReglesListeAsync(ct));
        g.MapPut("/regles", (List<RegleDto> l, HttpContext http, ServiceReceptionMail r, CancellationToken ct) => r.EnregistrerReglesAsync(Utilisateur.Depuis(http), l, ct));
        g.MapPost("/messages/{id:long}/rattacher", (long id, DemandeRattachement d, HttpContext http, ServiceReceptionMail r, CancellationToken ct) =>
            r.RattacherAsync(Utilisateur.Depuis(http), id, d, ct));
        g.MapPost("/messages/{id:long}/detacher", (long id, DemandeRattachement d, HttpContext http, ServiceReceptionMail r, CancellationToken ct) =>
            r.DetacherAsync(Utilisateur.Depuis(http), id, d.Type, d.Id ?? "", ct));
        g.MapPost("/messages/{id:long}/ignorer", async (long id, DemandeIgnorer d, HttpContext http, ServiceReceptionMail r, CancellationToken ct) =>
        {
            await r.IgnorerAsync(Utilisateur.Depuis(http), id, d.Motif, ct);
            return Results.NoContent();
        });
        g.MapPost("/messages/{id:long}/marquer-adresse", async (long id, DemandeAdresse d, HttpContext http, ServiceReceptionMail r, CancellationToken ct) =>
            Results.Ok(new { coordonnees = await r.MarquerAdresseAsync(Utilisateur.Depuis(http), id, d.Adresse, ct) }));
        // Passage immédiat de la file de la base courante (administrateur).
        g.MapPost("/traiter", async (HttpContext http, ServiceEnvoiMail s, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            return Results.Ok(new { envoyes = await s.TraiterFileAsync(50, ct) });
        });
        return g;
    }
}
