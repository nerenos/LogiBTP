using System.Text.RegularExpressions;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Résultat de « Vérifier dans l'annuaire » : valeurs de la fiche après la vérification et avertissement d'émission éventuel.</summary>
public sealed record VerificationAnnuaireFiche(
    bool Trouve, string? Adresse, string? Plateforme, string? CodeRoutage, string? Suffixe, DateTimeOffset VerifieLe, string? Avertissement);

/// <summary>Option de la vérification de nuit des tiers (désactivée par défaut) et état du dernier passage.</summary>
public sealed record OptionAnnuaireFe(bool Nuit, DateOnly? DernierPassage = null, int? DernierNombre = null);

/// <summary>
/// Annuaire des plateformes sur la fiche personne (plans/facturation-electronique.md, lot 20) : la ligne d'annuaire du
/// Directory Service (connecteur de la société, plateforme simulée en démonstration) renseigne per_fe_adresse,
/// per_fe_plateforme, per_fe_code_routage et per_fe_suffixe, avec la date de vérification ; absente de l'annuaire, la fiche
/// garde ses valeurs et per_fe_dans_annuaire passe à faux. Vérification de nuit des tiers actifs en option
/// (facture_electronique_annuaire_option, désactivée par défaut) par <see cref="PassageAnnuaireFe"/>, base par base.
/// Avertissement à l'émission : <see cref="Avertissement"/>.
/// </summary>
public static partial class AnnuaireFeBtp
{
    /// <summary>Tiers vérifiés au plus par passage de nuit et par base.</summary>
    public const int TiersParPassage = 500;

    /// <summary>Heure locale (incluse) à partir de laquelle le passage de nuit se fait, et heure (exclue) où il s'arrête.</summary>
    public const int HeureDebutNuit = 1, HeureFinNuit = 6;

    [GeneratedRegex(@"^\d{9}$")]
    private static partial Regex Siren();

    private sealed record LignePersonne(long Id, string? Siren, string? Siret, string? Pays, string? FeType, bool? DansAnnuaire, DateTimeOffset? VerifieLe);

    private const string SqlPersonne = """
        SELECT per_id AS "Id", per_siren AS "Siren", per_siret AS "Siret", per_pays AS "Pays", per_fe_type AS "FeType",
               per_fe_dans_annuaire AS "DansAnnuaire", per_fe_verifie_le AS "VerifieLe"
        FROM personne WHERE per_id = {0}
        """;

    /// <summary>Plateforme inscrite sur la fiche selon le type de plateforme de la ligne d'annuaire (DFH : PPF, sinon plateforme agréée).</summary>
    public static string PlateformeDe(string? typePlateforme) => typePlateforme == TypePlateformeAnnuaire.Ppf ? PlateformeAnnuaireFe.Ppf : PlateformeAnnuaireFe.Pa;

    /// <summary>SIREN utilisable pour l'annuaire : 9 chiffres (espaces ignorés), sinon celui du SIRET.</summary>
    public static string? SirenDe(string? siren, string? siret)
    {
        var s = (siren ?? "").Replace(" ", "");
        if (Siren().IsMatch(s)) return s;
        var t = (siret ?? "").Replace(" ", "");
        return t.Length == 14 && t.All(char.IsDigit) ? t[..9] : null;
    }

    /// <summary>
    /// Avertissement à l'émission d'une facture : tiers professionnel (B2B, B2G ou type non saisi, en France) absent de
    /// l'annuaire (vérifié, non trouvé) ou jamais vérifié ; aucun pour un particulier ou un tiers étranger (e-reporting).
    /// </summary>
    public static string? Avertissement(string? feType, string? pays, bool? dansAnnuaire)
    {
        if (feType is "B2C" or "INTERNATIONAL" || (!string.IsNullOrEmpty(pays) && !pays.Equals("FR", StringComparison.OrdinalIgnoreCase))) return null;
        return dansAnnuaire switch { null => AvertissementAnnuaireFe.NonVerifie, false => AvertissementAnnuaireFe.HorsAnnuaire, _ => null };
    }

    /// <summary>Avertissement d'émission d'un tiers lu en base (null : aucun).</summary>
    public static async Task<string?> AvertissementDuTiersAsync(DbContext db, long tiers, CancellationToken ct)
    {
        var p = await db.Database.SqlQueryRaw<LignePersonne>(SqlPersonne, tiers).FirstOrDefaultAsync(ct);
        return p is null ? null : Avertissement(p.FeType, p.Pays, p.DansAnnuaire);
    }

    /// <summary>Vérifie un tiers dans l'annuaire et met sa fiche à jour (SIREN absent : refus FE_ANNUAIRE_SIREN).</summary>
    public static async Task<VerificationAnnuaireFiche> VerifierAsync(DbContext db, ServiceFactureElectronique service, long tiers, CancellationToken ct)
    {
        var p = await db.Database.SqlQueryRaw<LignePersonne>(SqlPersonne, tiers).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("Personne");
        var siren = SirenDe(p.Siren, p.Siret) ?? throw ExceptionMetier.Invalide("FE_ANNUAIRE_SIREN", "SIREN (9 chiffres) obligatoire pour interroger l'annuaire");
        var r = await service.InterrogerAnnuaireAsync(siren, string.IsNullOrWhiteSpace(p.Siret) ? null : p.Siret.Replace(" ", ""), ct);
        var plateforme = r.Trouve ? PlateformeDe(r.TypePlateforme) : null;
        var maintenant = service.Maintenant;
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE personne SET per_fe_dans_annuaire = @trouve, per_fe_verifie_le = @le,
                per_fe_adresse = CASE WHEN @trouve THEN @adresse ELSE per_fe_adresse END,
                per_fe_plateforme = CASE WHEN @trouve THEN @plateforme ELSE per_fe_plateforme END,
                per_fe_code_routage = CASE WHEN @trouve THEN @routage ELSE per_fe_code_routage END,
                per_fe_suffixe = CASE WHEN @trouve THEN @suffixe ELSE per_fe_suffixe END
            WHERE per_id = @id
            """,
            new NpgsqlParameter("trouve", r.Trouve), new NpgsqlParameter("le", maintenant), new NpgsqlParameter("adresse", (object?)r.Adresse ?? DBNull.Value),
            new NpgsqlParameter("plateforme", (object?)plateforme ?? DBNull.Value), new NpgsqlParameter("routage", (object?)r.CodeRoutage ?? DBNull.Value),
            new NpgsqlParameter("suffixe", (object?)r.Suffixe ?? DBNull.Value), new NpgsqlParameter("id", tiers));
        return new(r.Trouve, r.Adresse, plateforme, r.CodeRoutage, r.Suffixe, maintenant, Avertissement(p.FeType, p.Pays, r.Trouve));
    }

    public static async Task<OptionAnnuaireFe> OptionAsync(DbContext db, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<LigneOption>("""
            SELECT fan_nuit AS "Nuit", fan_dernier_passage AS "DernierPassage", fan_dernier_nombre AS "DernierNombre" FROM facture_electronique_annuaire_option WHERE fan_id = 1
            """).FirstOrDefaultAsync(ct);
        return l is null ? new(false) : new(l.Nuit, l.DernierPassage, l.DernierNombre);
    }

    private sealed record LigneOption(bool Nuit, DateOnly? DernierPassage, int? DernierNombre);

    public static async Task<OptionAnnuaireFe> EnregistrerOptionAsync(DbContext db, bool nuit, CancellationToken ct)
    {
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO facture_electronique_annuaire_option (fan_id, fan_nuit) VALUES (1, @n)
            ON CONFLICT (fan_id) DO UPDATE SET fan_nuit = EXCLUDED.fan_nuit
            """, new NpgsqlParameter("n", nuit));
        return await OptionAsync(db, ct);
    }

    /// <summary>
    /// Passage de nuit d'une base : option active, module actif, plateforme active, pas déjà passé ce jour (sauf
    /// <paramref name="forcer"/>) ; tiers actifs en France avec un SIREN, jamais vérifiés d'abord puis les plus anciens.
    /// Une plateforme indisponible arrête le passage (reprise le lendemain). Rend le nombre de tiers vérifiés (null : rien à faire).
    /// </summary>
    public static async Task<int?> PasserAsync(IServiceProvider portee, DateOnly jour, bool forcer, CancellationToken ct)
    {
        var db = portee.GetRequiredService<LogiBtpContext>();
        if (!await portee.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.FactureElectronique, ct)) return null;
        var option = await OptionAsync(db, ct);
        if (!option.Nuit || (!forcer && option.DernierPassage == jour)) return null;
        var service = portee.GetRequiredService<ServiceFactureElectronique>();
        if (!(await service.ParametreAsync(ct)).FpaActif) return null;
        var ids = await db.Database.SqlQueryRaw<long>("""
            SELECT per_id AS "Value" FROM personne
            WHERE per_actif AND per_usage <> 'N' AND per_pays = 'FR' AND coalesce(per_fe_type, 'B2B') NOT IN ('B2C', 'INTERNATIONAL')
              AND (per_siren ~ '^[0-9]{9}$' OR per_siret ~ '^[0-9]{14}$')
            ORDER BY per_fe_verifie_le NULLS FIRST, per_id LIMIT {0}
            """, TiersParPassage).ToListAsync(ct);
        var n = 0;
        foreach (var id in ids)
        {
            try { await VerifierAsync(db, service, id, ct); n++; }
            catch (ExceptionConnecteur) { break; }
            catch (ExceptionMetier) { }
        }
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE facture_electronique_annuaire_option SET fan_dernier_passage = @j, fan_dernier_nombre = @n WHERE fan_id = 1
            """, new NpgsqlParameter("j", jour), new NpgsqlParameter("n", n));
        return n;
    }

    /// <summary>Routes du cœur sous le groupe du module (activation exigée) : vérification d'une fiche et option de nuit.</summary>
    public static RouteGroupBuilder MapAnnuaireFe(this RouteGroupBuilder api)
    {
        api.MapPost("/facture-electronique/annuaire/personnes/{id:long}/verification", (long id, HttpContext http, CancellationToken ct) =>
            VerifierAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), http.RequestServices.GetRequiredService<ServiceFactureElectronique>(), id, ct));
        api.MapGet("/facture-electronique/annuaire/option", (HttpContext http, CancellationToken ct) =>
            OptionAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), ct));
        api.MapPut("/facture-electronique/annuaire/option", async (OptionAnnuaireFe o, HttpContext http, CancellationToken ct) =>
        {
            http.RequestServices.GetRequiredService<SpecialisationFactureElectronique>().ExigerParametrage(Utilisateur.Depuis(http));
            return await EnregistrerOptionAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), o.Nuit, ct);
        });
        return api;
    }
}

/// <summary>
/// Tâche de fond : vérification de nuit des tiers dans l'annuaire des plateformes, base par base (option désactivée par
/// défaut), toutes les 30 minutes entre <see cref="AnnuaireFeBtp.HeureDebutNuit"/> h et <see cref="AnnuaireFeBtp.HeureFinNuit"/> h.
/// </summary>
public sealed class PassageAnnuaireFe(IServiceProvider services, Microsoft.Extensions.Options.IOptions<OptionsSocietes> societes, ILogger<PassageAnnuaireFe> journal, TimeProvider horloge)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var maintenant = horloge.GetLocalNow();
            if (maintenant.Hour >= AnnuaireFeBtp.HeureDebutNuit && maintenant.Hour < AnnuaireFeBtp.HeureFinNuit) await ExecuterAsync(DateOnly.FromDateTime(maintenant.DateTime), ct);
            try { await Task.Delay(TimeSpan.FromMinutes(30), ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    public async Task ExecuterAsync(DateOnly jour, CancellationToken ct)
    {
        foreach (var societe in societes.Value.Societes())
        {
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                var n = await AnnuaireFeBtp.PasserAsync(portee.ServiceProvider, jour, false, ct);
                if (n is not null) journal.LogInformation("Annuaire des plateformes ({Base}) : {Nombre} tiers vérifiés", societe.Code ?? "principale", n);
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedTable) { }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning("Annuaire des plateformes ({Base}) : passage non fait ({Erreur})", societe.Code ?? "principale", Masquage.Texte(e.Message));
            }
        }
    }
}
