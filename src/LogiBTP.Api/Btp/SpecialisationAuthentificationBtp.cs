using System.Net;
using LogiBTP.Authentification.Web;
using LogiBTP.Domaine;
using LogiBTP.Mail.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Authentification par le cœur (ANALYSE-MODULE-AUTHENTIFICATION.md, A3 à A5) : un compte se
/// lie à l'individu d'un salarié (CDI, CDD) ou d'un intérimaire actif ; un intérimaire a une fin de validité
/// obligatoire (fin de mission) et ne peut pas être administrateur ; le pseudo du compte est recopié dans
/// <c>individu.ind_utilisateur</c> (identifiant lu par les autres modules : CRM…).
/// </summary>
public class SpecialisationAuthentificationBtp : SpecialisationAuthentification
{
    /// <summary>Profil d'un nouveau compte : saisie mobile (pointage de ses heures), pour limiter les droits (A5 révisée).</summary>
    public override string ProfilParDefaut => "MOBILE";

    /// <summary>Type de notification publié directement : usurpation du compte (préférences de notification).</summary>
    public static readonly LogiBTP.Notifications.Web.TypeNotification[] Types =
    [
        new("authentification", "USURPATION", "Un administrateur agit pour mon compte"),
        new("authentification", "EXCLUSION_IP", "Adresse exclue après trop d'échecs de connexion"),
    ];

    /// <summary>Usurpation commencée : notification au compte usurpé (administrateur, motif).</summary>
    public override async Task ApresUsurpationAsync(IServiceProvider services, Compte cible, string administrateur, string motif, CancellationToken ct) =>
        await services.GetRequiredService<LogiBTP.Notifications.Web.ServiceNotification>().PublierAsync(
            [new(cible.CptCode, "authentification", "USURPATION", $"{administrateur} agit pour votre compte", motif, NiveauNotification.Attention)], ct);

    private const string SqlPersonnes = """
        SELECT i.ind_id::text AS id, concat_ws(' ', i.ind_prenom, i.ind_nom) AS libelle, i.ind_actif AS individu_actif,
               s.sal_statut AS statut, s.sal_actif AS salarie_actif, s.sal_code AS matricule, s.sal_id AS sal_id
        FROM individu i
        LEFT JOIN LATERAL (SELECT sal_id, sal_statut, sal_actif, sal_code FROM salarie WHERE sal_ind_id = i.ind_id
                           ORDER BY sal_actif DESC, sal_id DESC LIMIT 1) s ON TRUE
        """;

    private sealed record LignePersonne(string Id, string Libelle, bool IndividuActif, string? Statut, bool? SalarieActif, string? Matricule, int? SalId);

    private static PersonneCompte Decrire(LignePersonne l, DateOnly? finMission = null)
    {
        var interim = l.Statut == "INTERIM";
        string? motif = !l.IndividuActif ? "individu inactif"
            : l.SalId is null ? "aucun salarié ni intérimaire lié à cet individu"
            : l.SalarieActif != true ? (interim ? "intérimaire inactif" : "salarié inactif (sorti)") : null;
        // Contrat facultatif : un salarié sans contrat saisi reste un salarié.
        var statut = l.Statut switch { "INTERIM" => "Intérimaire", "CDD" => "Salarié (CDD)", "CDI" => "Salarié (CDI)", _ => l.SalId is null ? null : "Salarié" };
        return new PersonneCompte(TypesFiche.Individu, l.Id, l.Libelle, motif is null, interim, interim ? [LogiBTP.Socle.Profils.Admin] : [],
            statut is null ? null : l.Matricule is null ? statut : $"{statut} · {l.Matricule}", finMission, motif);
    }

    public override async Task<PersonneCompte?> PersonneAsync(AuthDbContext db, string type, string id, CancellationToken ct)
    {
        if (type != TypesFiche.Individu || !long.TryParse(id, out var ind)) return null;
        var l = await db.Database.SqlQueryRaw<LignePersonne>(SqlPersonnes + " WHERE i.ind_id = @id", new NpgsqlParameter("id", ind)).FirstOrDefaultAsync(ct);
        if (l is null) return null;
        // Intérimaire : fin de la mission en cours proposée comme fin de validité du compte (référentiel des ressources).
        var fin = l is { Statut: "INTERIM", SalId: int sal } ? await Ressources.FinMissionEnCoursAsync(db, sal, ct) : null;
        return Decrire(l, fin);
    }

    public override async Task<List<PersonneCompte>> RechercherPersonnesAsync(AuthDbContext db, string texte, CancellationToken ct)
    {
        var lignes = await db.Database.SqlQueryRaw<LignePersonne>(SqlPersonnes + """
             WHERE s.sal_id IS NOT NULL AND s.sal_actif AND i.ind_actif
               AND (concat_ws(' ', i.ind_prenom, i.ind_nom) ILIKE @t OR concat_ws(' ', i.ind_nom, i.ind_prenom) ILIKE @t OR s.sal_code ILIKE @t OR s.sal_matricule_paie ILIKE @t)
             ORDER BY lower(i.ind_nom), lower(i.ind_prenom) LIMIT 30
            """, new NpgsqlParameter("t", $"%{texte.Trim()}%")).ToListAsync(ct);
        return lignes.Select(l => Decrire(l)).ToList();
    }

    /// <summary>Pseudo libre : aucun autre individu ne le porte comme identifiant de connexion.</summary>
    public override async Task<bool> PseudoLibreAsync(AuthDbContext db, string code, string? type, string? id, CancellationToken ct)
    {
        var ind = type == TypesFiche.Individu ? id : null;
        return !await db.Database.SqlQueryRaw<int>("SELECT 1 AS \"Value\" FROM individu WHERE lower(ind_utilisateur) = @code AND ind_id::text IS DISTINCT FROM @ind",
            new NpgsqlParameter("code", code), new NpgsqlParameter("ind", NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)ind ?? DBNull.Value }).AnyAsync(ct);
    }

    /// <summary>Le pseudo du compte devient l'identifiant de connexion de l'individu (ancien identifiant retiré).</summary>
    public override async Task ApresEcritureAsync(AuthDbContext db, Compte compte, string? ancienCode, CancellationToken ct)
    {
        if (compte.CptTypeElement != TypesFiche.Individu || !long.TryParse(compte.CptIdElement, out var ind)) return;
        await db.Database.ExecuteSqlRawAsync("UPDATE individu SET ind_utilisateur = NULL WHERE ind_id <> @id AND lower(ind_utilisateur) = lower(@code)",
            [new NpgsqlParameter("id", ind), new NpgsqlParameter("code", compte.CptCode)], ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE individu SET ind_utilisateur = @code WHERE ind_id = @id",
            [new NpgsqlParameter("id", ind), new NpgsqlParameter("code", compte.CptCode)], ct);
    }

    /// <summary>Mot de passe oublié par courriel : proposé dès qu'un compte d'envoi du module Mail est actif.</summary>
    public override Task<bool> ReinitialisationParCourrielAsync(IServiceProvider services, CancellationToken ct) =>
        services.GetRequiredService<ServiceEnvoiMail>().DisponibleAsync(ct);

    /// <summary>Lien envoyé à la coordonnée EMAIL de l'individu lié au compte (usage AUTHENTIFICATION, priorité haute).</summary>
    /// <summary>Code du double facteur envoyé à la coordonnée EMAIL de l'individu du compte (module Mail, envoi automatique prioritaire).</summary>
    public override async Task<string?> EnvoyerCodeAsync(IServiceProvider services, Compte compte, string code, DateTimeOffset expireLe, CancellationToken ct)
    {
        if (compte.CptTypeElement != TypesFiche.Individu || !long.TryParse(compte.CptIdElement, out var ind)) return null;
        var db = services.GetRequiredService<LogiBtpContext>();
        var adresse = await db.Database.SqlQueryRaw<string>("""
            SELECT c.coo_valeur AS "Value" FROM usage_coordonnee u JOIN coordonnee c ON c.coo_id = u.uco_coo_id
            WHERE u.uco_ind_id = @ind AND c.coo_nature = 'EMAIL' ORDER BY u.uco_principal DESC, c.coo_id LIMIT 1
            """, new NpgsqlParameter("ind", ind)).FirstOrDefaultAsync(ct);
        if (adresse is null) return null;
        var envoi = services.GetRequiredService<ServiceEnvoiMail>();
        if (!await envoi.DisponibleAsync(ct)) return null;
        var corps = $"""
            <p>Bonjour,</p><p>Code de connexion pour l'identifiant <strong>{WebUtility.HtmlEncode(compte.CptCode)}</strong> :</p>
            <p style="font-size:1.6em;letter-spacing:.2em"><strong>{code}</strong></p>
            <p>Valable jusqu'à {expireLe.ToLocalTime():HH:mm}. Si vous n'êtes pas à l'origine de cette connexion, changez votre mot de passe et prévenez un administrateur.</p>
            """;
        await envoi.EnvoyerAutomatiqueAsync(new EnvoiAutomatique("AUTHENTIFICATION", [new DestinataireSaisi(adresse, compte.CptLibelle)], "LogiBTP : code de connexion",
            corps, SpecialisationMailBtp.Fond.Code, "HAUTE"), ct);
        var arobase = adresse.IndexOf('@');
        return arobase > 1 ? $"{adresse[0]}***{adresse[arobase..]}" : "***";
    }

    /// <summary>Adresse exclue après trop d'échecs : notification aux comptes administrateurs.</summary>
    public override async Task ApresExclusionAsync(IServiceProvider services, string prefixe, DateTimeOffset fin, int echecs, CancellationToken ct)
    {
        var admins = await DestinatairesBtp.AdministrateursAsync(services.GetRequiredService<LogiBtpContext>(), ct);
        await services.GetRequiredService<LogiBTP.Notifications.Web.ServiceNotification>().PublierAsync(admins.Select(a =>
            new LogiBTP.Notifications.Web.NouvelleNotification(a, "authentification", "EXCLUSION_IP", $"Adresse {prefixe} exclue ({echecs} échecs de connexion)",
                $"Jusqu'à {fin.ToLocalTime():dd/MM HH:mm} ; levée possible dans les comptes utilisateurs", NiveauNotification.Attention, "/parametres/comptes?onglet=exclusions",
                Cle: $"exclusion-ip:{prefixe}:{fin:yyyyMMddHHmm}")), ct);
    }

    public override async Task<bool> EnvoyerReinitialisationAsync(IServiceProvider services, Compte compte, string lien, DateTimeOffset expireLe, CancellationToken ct)
    {
        if (compte.CptTypeElement != TypesFiche.Individu || !long.TryParse(compte.CptIdElement, out var ind)) return false;
        var db = services.GetRequiredService<LogiBtpContext>();
        var adresse = await db.Database.SqlQueryRaw<string>("""
            SELECT c.coo_valeur AS "Value" FROM usage_coordonnee u JOIN coordonnee c ON c.coo_id = u.uco_coo_id
            WHERE u.uco_ind_id = @ind AND c.coo_nature = 'EMAIL' ORDER BY u.uco_principal DESC, c.coo_id LIMIT 1
            """, new NpgsqlParameter("ind", ind)).FirstOrDefaultAsync(ct);
        if (adresse is null) return false;
        var envoi = services.GetRequiredService<ServiceEnvoiMail>();
        if (!await envoi.DisponibleAsync(ct)) return false;
        var corps = $"""
            <p>Bonjour,</p><p>Une demande de nouveau mot de passe a été faite pour l'identifiant <strong>{WebUtility.HtmlEncode(compte.CptCode)}</strong>.</p>
            <p><a href="{WebUtility.HtmlEncode(lien)}">Choisir un nouveau mot de passe</a> (lien valable jusqu'à {expireLe.ToLocalTime():HH:mm}, utilisable une fois).</p>
            <p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce courriel : votre mot de passe actuel reste valable.</p>
            """;
        await envoi.EnvoyerAutomatiqueAsync(new EnvoiAutomatique("AUTHENTIFICATION", [new DestinataireSaisi(adresse, compte.CptLibelle)], "LogiBTP : nouveau mot de passe",
            corps, SpecialisationMailBtp.Fond.Code, "HAUTE"), ct);
        return true;
    }
}
