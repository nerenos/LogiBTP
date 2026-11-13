using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Donnees;

/// <summary>
/// Services d'une spécialisation singleton (crochets des fiches, du CRM…) : ceux de la requête en cours, pour que ses
/// écritures se fassent dans l'unité d'écriture de la requête (même connexion, même transaction) ; hors requête
/// (tâche de fond), une portée neuve.
/// </summary>
public sealed class AccesPortee(IServiceScopeFactory scopes, IHttpContextAccessor http)
{
    /// <summary>Portée à libérer après usage (<c>using var scope = portee.Ouvrir()</c>) : celle de la requête n'est jamais libérée ici.</summary>
    public Portee Ouvrir() => http.HttpContext?.RequestServices is { } sp ? new Portee(sp, null) : new Portee(null, scopes.CreateScope());

    public sealed class Portee : IDisposable
    {
        private readonly IServiceScope? propre;
        private readonly IServiceProvider? requete;

        internal Portee(IServiceProvider? requete, IServiceScope? propre)
        {
            this.requete = requete;
            this.propre = propre;
        }

        public IServiceProvider ServiceProvider => requete ?? propre!.ServiceProvider;

        public void Dispose() => propre?.Dispose();
    }
}
