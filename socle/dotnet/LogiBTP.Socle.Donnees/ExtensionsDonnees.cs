using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Donnees;

public static class ExtensionsDonnees
{
    /// <summary>
    /// Connexion unique et unité d'écriture par portée (requête ou portée d'une tâche de fond), sur la base de la
    /// société courante. À appeler après <c>AddSocietes</c>.
    /// </summary>
    public static IServiceCollection AddUniteEcriture(this IServiceCollection services)
    {
        services.AddScoped(sp => new ConnexionRequete(sp.GetRequiredService<SocieteCourante>().Connexion));
        services.AddScoped<UniteEcriture>();
        services.AddHttpContextAccessor();
        services.AddSingleton<AccesPortee>();
        return services;
    }

    /// <summary>
    /// Branche un contexte EF sur la connexion de la portée et sur son unité d'écriture : ce qu'il enregistre pendant la
    /// transaction de l'unité s'y fait.
    /// </summary>
    public static DbContextOptionsBuilder ConfigurerBase(this DbContextOptionsBuilder o, IServiceProvider sp,
        Action<Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure.NpgsqlDbContextOptionsBuilder>? npgsql = null)
    {
        var unite = sp.GetRequiredService<UniteEcriture>();
        return o.UseNpgsql(unite.Connexion, npgsql).AddInterceptors(unite.Interception, unite.Interception.Debut);
    }

    /// <summary>Unité d'écriture du contexte (celle de la portée s'il est branché, sinon une unité propre à sa connexion).</summary>
    public static UniteEcriture Unite(this DbContext db) => UniteEcriture.De(db);

    /// <summary>
    /// Fin de requête : lance les effets externes des transactions validées ; une transaction restée ouverte est
    /// annulée à la libération de la portée. À placer après <c>UseErreursMetier</c>.
    /// </summary>
    public static IApplicationBuilder UseUniteEcriture(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        try
        {
            await next(http);
        }
        finally
        {
            // Effets des transactions validées, même si la requête échoue ensuite.
            if (http.RequestServices.GetService<UniteEcriture>() is { EnCours: false } u) await u.ExecuterValideesAsync(CancellationToken.None);
        }
    });
}
