using System.Security.Cryptography;

namespace LogiBTP.Authentification;

/// <summary>
/// Règles des jetons délégués aux agents IA (plan MCP, lot 4), sans base : forme du secret, état d'un jeton, routes du
/// module Authentification ouvertes à un agent. Côté serveur seulement (pas de miroir JS : le client ne voit jamais ces jetons).
/// </summary>
public static class ReglesJetonsDelegues
{
    /// <summary>Préfixe du secret : distingue un jeton délégué d'un jeton d'accès JWT dans l'en-tête Bearer.</summary>
    public const string Prefixe = "lbtp_agent_";

    /// <summary>Échéance par défaut quand l'émetteur n'en donne pas (jours) ; jamais au-delà.</summary>
    public const int JoursMax = 90;

    /// <summary>Refus : jeton inconnu, révoqué, échu, compte inutilisable (désactivé, expiré, de service, sans mot de passe, mot de passe provisoire).</summary>
    public const string Inconnu = "INCONNU";
    public const string Revoque = "REVOQUE";
    public const string Echu = "ECHU";

    /// <summary>En-tête Bearer d'un jeton délégué (préfixe), sinon jeton d'accès JWT d'un identifiant d'API.</summary>
    public static bool EstJetonDelegue(string? bearer) => bearer is not null && bearer.StartsWith(Prefixe, StringComparison.Ordinal);

    /// <summary>Nouveau secret (préfixe + 32 octets aléatoires en base64 URL) et son empreinte SHA-256, seule conservée.</summary>
    public static (string Secret, string Empreinte) Nouveau()
    {
        var secret = Prefixe + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return (secret, HachageMotDePasse.Empreinte(secret));
    }

    /// <summary>Échéance retenue : celle demandée (refusée si passée), sinon <see cref="JoursMax"/> jours ; bornée à <see cref="JoursMax"/>.</summary>
    public static DateTimeOffset? Echeance(DateTime? demandee, DateTimeOffset maintenant)
    {
        var max = maintenant.AddDays(JoursMax);
        if (demandee is not { } d) return max;
        var e = new DateTimeOffset(d.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : d.ToUniversalTime());
        if (e <= maintenant) return null;
        return e < max ? e : max;
    }

    /// <summary>
    /// Motif de refus d'un jeton (null : utilisable) : révoqué, échu, ou compte hors d'état. Un compte verrouillé après des
    /// échecs de mot de passe garde ses jetons (le verrouillage protège la saisie du mot de passe, comme pour une session).
    /// </summary>
    public static string? Refus(DateTimeOffset? revoqueLe, DateTimeOffset expireLe, CompteAEvaluer compte, DateTimeOffset maintenant)
    {
        if (revoqueLe is not null) return Revoque;
        if (expireLe <= maintenant) return Echu;
        if (compte.Type != "PERSONNE") return "SERVICE";
        var etat = ReglesCompte.Etat(compte, maintenant).Etat;
        return etat is "ACTIF" or "VERROUILLE" ? null : etat;
    }

    /// <summary>Route du module Authentification ouverte à un agent : seulement GET /api/auth/session (jamais mot de passe, comptes, usurpation, jetons).</summary>
    public static bool RouteAuthPermise(string methode, string chemin)
    {
        var c = chemin.TrimEnd('/');
        if (!c.Equals("/api/auth", StringComparison.OrdinalIgnoreCase) && !c.StartsWith("/api/auth/", StringComparison.OrdinalIgnoreCase)) return true;
        return (methode.Equals("GET", StringComparison.OrdinalIgnoreCase) || methode.Equals("HEAD", StringComparison.OrdinalIgnoreCase))
            && c.Equals("/api/auth/session", StringComparison.OrdinalIgnoreCase);
    }
}
