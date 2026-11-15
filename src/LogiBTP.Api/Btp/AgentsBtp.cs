using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Contrôles par identité du cœur face aux agents IA (plans/mcp.md, lot 6 ; audit des routes § 7.3) : magasinier,
/// responsable de service, chef d'équipe, délégué au contrôle… sont des qualités de la personne, pas des droits du
/// profil ; un agent qui porte son compte n'en hérite que si le plafond de sa délégation couvre l'action d'écriture
/// sur le nœud (droits de l'agent calculés par le module Droits : profil ∩ plafond, garde-fous, interdits). Sans
/// module Droits ni contexte : refus.
/// </summary>
public static class AgentsBtp
{
    /// <summary>Vrai pour un humain ; pour un agent, vrai seulement si ses droits couvrent l'action sur le nœud.</summary>
    public static async Task<bool> CouvertAsync(Utilisateur u, string noeud, string action, IServiceProvider? services, CancellationToken ct)
    {
        if (u.Agent is null) return true;
        return services?.GetService(typeof(IDroits)) is IDroits droits && await droits.AutoriseAsync(u, noeud, action, ct);
    }

    /// <summary>Services de la requête en cours (accès posé par Program.cs), pour les contrôles statiques.</summary>
    public static IServiceProvider? ServicesRequete => SpecialisationBtp.Http?.HttpContext?.RequestServices;
}
