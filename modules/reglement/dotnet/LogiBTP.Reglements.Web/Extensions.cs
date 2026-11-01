using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Reglements.Web;

/// <summary>Demande d'état de pièces (reste à payer).</summary>
public sealed record DemandeEtatPieces(List<long> Pieces);

/// <summary>Branchement du module Règlements dans une application ASP.NET Core (facultatif : l'application fonctionne sans).</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleReglement<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationReglement
    {
        services.AddDbContext<ReglementDbContext>(options);
        services.AddSingleton<SpecialisationReglement, TSpecialisation>();
        services.AddScoped<ServiceReglement>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /reglements.</summary>
    public static RouteGroupBuilder MapModuleReglement(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/reglements");
        g.MapGet("/tiers", (ServiceReglement s, CancellationToken ct) => s.Tiers(ct));
        g.MapGet("/echeances", (long? tiers, string? sens, long? piece, long? objet, bool? ouvertes, ServiceReglement s, CancellationToken ct) =>
            s.Echeances(new FiltreEcheances(tiers, sens, null, piece is long p ? [p] : null, objet), ouvertes ?? false, ct));
        g.MapGet("/pointages", (long piece, ServiceReglement s, CancellationToken ct) => s.PointagesPiece(piece, ct));
        g.MapPost("/imputations", (ImputationSaisie i, HttpContext http, ServiceReglement s, CancellationToken ct) => s.Imputer(i, Utilisateur.Depuis(http), ct));
        g.MapPost("/etat", (DemandeEtatPieces d, ServiceReglement s, CancellationToken ct) => s.EtatPieces(d.Pieces, ct));
        g.MapGet("", (long? tiers, string? sens, ServiceReglement s, CancellationToken ct) => s.Reglements(tiers, sens, ct));
        g.MapPost("", (ReglementSaisi r, HttpContext http, ServiceReglement s, CancellationToken ct) => s.EnregistrerReglement(null, r, Utilisateur.Depuis(http), ct));
        g.MapPut("/{id:long}", (long id, ReglementSaisi r, HttpContext http, ServiceReglement s, CancellationToken ct) => s.EnregistrerReglement(id, r, Utilisateur.Depuis(http), ct));
        g.MapDelete("/{id:long}", async (long id, ServiceReglement s, CancellationToken ct) => { await s.SupprimerReglement(id, ct); return Results.NoContent(); });
        g.MapGet("/cautions", (long? tiers, string? objet, long? objet_id, ServiceReglement s, CancellationToken ct) => s.Cautions(tiers, objet, objet_id, ct));
        g.MapPost("/cautions", (CautionSaisie c, ServiceReglement s, CancellationToken ct) => s.EnregistrerCaution(null, c, ct));
        g.MapPut("/cautions/{id:long}", (long id, CautionSaisie c, ServiceReglement s, CancellationToken ct) => s.EnregistrerCaution(id, c, ct));
        g.MapDelete("/cautions/{id:long}", async (long id, ServiceReglement s, CancellationToken ct) => { await s.SupprimerCaution(id, ct); return Results.NoContent(); });
        return api;
    }
}
