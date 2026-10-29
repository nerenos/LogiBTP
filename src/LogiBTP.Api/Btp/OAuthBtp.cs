using LogiBTP.Notifications.Web;
using LogiBTP.Socle;
using LogiBTP.OAuth.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module OAuth : services d'un utilisateur (individu du compte → membres des services, db/193),
/// destinataires d'une connexion (comptes ADMIN, comptes des profils et membres des services désignés par ses droits),
/// signaux publiés dans le centre de notifications (module « oauth » : échec du renouvellement, échéance proche).
/// </summary>
public sealed class SpecialisationOAuthBtp(LogiBtpContext db, ServiceNotification notifications) : SpecialisationOAuth
{
    /// <summary>Types publiés directement (préférences de notification).</summary>
    public static readonly TypeNotification[] Types =
    [
        new("oauth", "ECHEC", "Connexions externes à reconnecter"),
        new("oauth", "RAPPEL", "Échéances des connexions externes"),
    ];

    public override async Task<IReadOnlyList<string>> ServicesAsync(string utilisateur, CancellationToken ct) =>
        await DestinatairesBtp.ServicesAsync(db, utilisateur, ct);

    public override async Task<IReadOnlyList<string>> DestinatairesAsync(IReadOnlyList<string> droits, CancellationToken ct)
    {
        string[] profils = [Profils.Admin, .. droits.Where(d => !d.StartsWith("service:", StringComparison.OrdinalIgnoreCase))];
        var services = droits.Where(d => d.StartsWith("service:", StringComparison.OrdinalIgnoreCase)).Select(d => d["service:".Length..]).ToArray();
        return await db.Database.SqlQueryRaw<string>($"""
            SELECT DISTINCT c.cpt_code AS "Value" FROM compte c WHERE c.cpt_type = 'PERSONNE' AND c.cpt_actif AND c.cpt_profil = ANY(@profils)
            UNION
            {DestinatairesBtp.SqlMembresServices}
            """, new NpgsqlParameter("profils", profils), new NpgsqlParameter("services", services)).ToListAsync(ct);
    }

    public override async Task SignalerAsync(SignalOAuth s, IReadOnlyList<string> destinataires, CancellationToken ct) =>
        await notifications.PublierAsync(destinataires.Select(d => new NouvelleNotification(d, "oauth", s.Genre, s.Titre, s.Texte, s.Niveau, s.Url,
            "oauth_connexion", s.Connexion.ToString(), s.Cle)), ct);
}
