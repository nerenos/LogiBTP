using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LogiBTP.Mail.Web;

/// <summary>
/// Paramétrage du module (administrateur) : comptes (identité et connexion chiffrées, jamais renvoyées), alias (nom des
/// comptes dans l'application), usages, modèles, paramètres, test de connexion ; authentification d'un compte (mot de
/// passe ou jeton OAuth 2.0 par le contrat du socle) ; utilisations d'une connexion OAuth.
/// </summary>
public sealed class ServiceComptesMail(MailDbContext db, Chiffrement chiffrement, ITransportMail transport, SpecialisationMail specialisation,
    NettoyageHtmlMail nettoyage, ILogger<ServiceComptesMail> journal, TimeProvider horloge, IFournisseurJeton? jetons = null) : IUtilisationsConnexion
{
    public static readonly string[] Hebergeurs = ["GMAIL", "OVH", "AUTRE"];
    public static readonly string[] Securites = ["SSL", "STARTTLS"];

    private DateTimeOffset Maintenant => horloge.GetUtcNow();

    // --- Comptes ---

    public async Task<List<CompteDto>> ComptesAsync(Utilisateur u, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        var alias = await db.Alias.AsNoTracking().ToListAsync(ct);
        return (await db.Comptes.AsNoTracking().OrderBy(c => c.McoCode).ToListAsync(ct)).Select(c => Dto(c, alias)).ToList();
    }

    private CompteDto Dto(CompteEntite c, List<AliasEntite> alias)
    {
        var siens = alias.Where(a => a.MalMcoId == c.McoId).OrderByDescending(a => a.MalPrincipal).ThenBy(a => a.MalNom).ToList();
        var cfg = Connexion(c);
        var saisies = LimitesSaisies(c);
        return new CompteDto(c.McoId, c.McoCode, siens.FirstOrDefault()?.MalNom ?? c.McoCode, siens.Skip(1).Select(a => a.MalNom).ToList(), c.McoEnvoi,
            c.McoReception, c.McoAuthentification, c.McoOcoId, c.McoHebergeur, Limites.Completer(c.McoHebergeur, saisies), saisies ?? new Limites(0, 0, 0, 0, 0, 0),
            c.McoCopieEnvoyes, c.McoServices, c.McoActif, c.McoEtat, c.McoDerniereErreur, c.McoVerifieLe, c.McoRepondreAMcoId, c.McoSignatureHtml,
            Public(cfg.Smtp), Public(cfg.Imap));
    }

    private static ServeurPublic? Public(ServeurMail? s) => s is null ? null
        : new ServeurPublic(s.Hote, s.Port, s.Securite, !string.IsNullOrEmpty(s.Identifiant), !string.IsNullOrEmpty(s.MotDePasse));

    public async Task<CompteDto> CreerAsync(Utilisateur u, SaisieCompte s, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        if (string.IsNullOrWhiteSpace(s.Adresse)) throw ExceptionMetier.Invalide("MAIL_ADRESSE", "Adresse du compte obligatoire");
        var c = new CompteEntite { McoCreePar = u.Code, McoCreeLe = Maintenant };
        await AppliquerAsync(c, s, ct);
        db.Comptes.Add(c);
        await db.SaveChangesAsync(ct);
        await AliasPrincipalAsync(c, s.AliasPrincipal ?? s.Code, ct);
        journal.LogInformation("Mail : compte {Code} créé par {Utilisateur}", c.McoCode, u.Code);
        return Dto(c, await db.Alias.AsNoTracking().ToListAsync(ct));
    }

    public async Task<CompteDto> ModifierAsync(Utilisateur u, long id, SaisieCompte s, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        var c = await Compte(id, ct);
        await AppliquerAsync(c, s, ct);
        c.McoMajPar = u.Code;
        c.McoMajLe = Maintenant;
        await db.SaveChangesAsync(ct);
        if (!string.IsNullOrWhiteSpace(s.AliasPrincipal)) await AliasPrincipalAsync(c, s.AliasPrincipal, ct);
        journal.LogInformation("Mail : compte {Code} modifié par {Utilisateur}", c.McoCode, u.Code);
        return Dto(c, await db.Alias.AsNoTracking().ToListAsync(ct));
    }

    private async Task AppliquerAsync(CompteEntite c, SaisieCompte s, CancellationToken ct)
    {
        var code = (s.Code ?? "").Trim().ToUpperInvariant();
        if (code.Length is 0 or > 30) throw ExceptionMetier.Invalide("MAIL_CODE", "Code obligatoire (30 caractères au plus)");
        if (await db.Comptes.AnyAsync(x => x.McoCode == code && x.McoId != c.McoId, ct)) throw ExceptionMetier.Conflit("MAIL_CODE_PRIS", $"Code {code} déjà utilisé");
        if (!Hebergeurs.Contains(s.Hebergeur)) throw ExceptionMetier.Invalide("MAIL_HEBERGEUR", "Hébergeur inconnu");
        if (s.Authentification is not ("MOT_DE_PASSE" or "OAUTH2")) throw ExceptionMetier.Invalide("MAIL_AUTHENTIFICATION", "Authentification : mot de passe ou OAuth 2.0");
        if (s.Authentification == "OAUTH2" && s.OcoId is null) throw ExceptionMetier.Invalide("MAIL_OAUTH", "Choisir la connexion OAuth 2.0 du compte");
        if (!string.IsNullOrWhiteSpace(s.Adresse))
        {
            if (!Adresses.Valide(s.Adresse)) throw ExceptionMetier.Invalide("MAIL_ADRESSE", "Adresse du compte invalide");
            var empreinte = chiffrement.Empreinte(s.Adresse)!;
            if (await db.Comptes.AnyAsync(x => x.McoAdresseEmpreinte == empreinte && x.McoId != c.McoId, ct))
                throw ExceptionMetier.Conflit("MAIL_ADRESSE_PRISE", "Cette adresse a déjà un compte");
            c.McoIdentite = chiffrement.Chiffrer(JsonSerializer.Serialize(new IdentiteCompte(s.Adresse.Trim(), Vide(s.NomAffiche)), JsonCalcul.Options))!;
            c.McoAdresseEmpreinte = empreinte;
        }
        else if (!string.IsNullOrWhiteSpace(s.NomAffiche) && c.McoIdentite.Length > 0)
        {
            c.McoIdentite = chiffrement.Chiffrer(JsonSerializer.Serialize(Identite(c) with { NomAffiche = s.NomAffiche.Trim() }, JsonCalcul.Options))!;
        }
        var ancienne = c.McoConnexion.Length > 0 ? Connexion(c) : new ConfigConnexion(null, null);
        var oauth = s.Authentification == "OAUTH2";
        var cfg = new ConfigConnexion(Fusionner(ancienne.Smtp, s.Smtp, oauth), Fusionner(ancienne.Imap, s.Imap, oauth));
        if (s.Envoi && cfg.Smtp is null) throw ExceptionMetier.Invalide("MAIL_SMTP", "Serveur d'envoi (SMTP) obligatoire pour un compte d'envoi");
        if (s.Reception && cfg.Imap is null) throw ExceptionMetier.Invalide("MAIL_IMAP", "Serveur de réception (IMAP) obligatoire pour un compte de réception");
        var change = c.McoConnexion.Length == 0 || JsonSerializer.Serialize(ancienne, JsonCalcul.Options) != JsonSerializer.Serialize(cfg, JsonCalcul.Options)
            || c.McoAuthentification != s.Authentification || c.McoOcoId != s.OcoId;
        c.McoConnexion = chiffrement.Chiffrer(JsonSerializer.Serialize(cfg, JsonCalcul.Options))!;
        if (change) c.McoEtat = "A_VERIFIER";
        c.McoCode = code;
        c.McoEnvoi = s.Envoi;
        c.McoReception = s.Reception;
        c.McoAuthentification = s.Authentification;
        c.McoOcoId = oauth ? s.OcoId : null;
        c.McoRepondreAMcoId = s.RepondreAId == c.McoId ? null : s.RepondreAId;
        c.McoSignatureHtml = Vide(nettoyage.Nettoyer(s.SignatureHtml));
        c.McoHebergeur = s.Hebergeur;
        c.McoLimites = JsonSerializer.Serialize(s.Limites ?? new Limites(0, 0, 0, 0, 0, 0), JsonCalcul.Options);
        c.McoCopieEnvoyes = s.CopieEnvoyes;
        c.McoServices = (s.Services ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).Distinct().ToList();
        c.McoActif = s.Actif;
    }

    /// <summary>
    /// Serveur saisi fusionné avec l'ancien (absent : inchangé ; hôte vide : retiré ; identifiant ou mot de passe vides :
    /// inchangés) ; OAuth 2.0 : mot de passe effacé.
    /// </summary>
    private static ServeurMail? Fusionner(ServeurMail? ancien, ServeurMail? saisi, bool oauth)
    {
        if (saisi is null) return ancien is null ? null : ancien with { MotDePasse = oauth ? null : ancien.MotDePasse };
        if (string.IsNullOrWhiteSpace(saisi.Hote)) return null;
        if (!Securites.Contains(saisi.Securite)) throw ExceptionMetier.Invalide("MAIL_SECURITE", "Connexion chiffrée obligatoire : SSL ou STARTTLS");
        if (saisi.Port is <= 0 or > 65535) throw ExceptionMetier.Invalide("MAIL_PORT", "Port invalide");
        return new ServeurMail(saisi.Hote.Trim(), saisi.Port, saisi.Securite, Vide(saisi.Identifiant) ?? ancien?.Identifiant,
            oauth ? null : Vide(saisi.MotDePasse) ?? ancien?.MotDePasse);
    }

    private async Task AliasPrincipalAsync(CompteEntite c, string nom, CancellationToken ct)
    {
        nom = nom.Trim();
        var existant = await db.Alias.FirstOrDefaultAsync(a => a.MalNom == nom, ct);
        if (existant is not null && existant.MalMcoId != c.McoId) throw ExceptionMetier.Conflit("MAIL_ALIAS_PRIS", $"Le nom « {nom} » désigne déjà un autre compte");
        await db.Alias.Where(a => a.MalMcoId == c.McoId && a.MalPrincipal).ExecuteUpdateAsync(x => x.SetProperty(a => a.MalPrincipal, false), ct);
        if (existant is null) db.Alias.Add(new AliasEntite { MalNom = nom, MalMcoId = c.McoId, MalPrincipal = true });
        else existant.MalPrincipal = true;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Adresse du compte en clair (administrateur, journalisé) : jamais dans les listes.</summary>
    public async Task<IdentiteCompte> AdresseAsync(Utilisateur u, long id, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        var c = await Compte(id, ct);
        journal.LogInformation("Mail : adresse du compte {Code} affichée par {Utilisateur}", c.McoCode, u.Code);
        return Identite(c);
    }

    /// <summary>Suppression : refusée pour un compte qui a des messages (le désactiver).</summary>
    public async Task SupprimerAsync(Utilisateur u, long id, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        var c = await Compte(id, ct);
        if (await db.Messages.AnyAsync(m => m.MmeMcoId == id, ct)) throw ExceptionMetier.Conflit("MAIL_COMPTE_UTILISE", "Compte avec des courriels : le désactiver plutôt");
        db.Comptes.Remove(c);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Test de connexion (SMTP, puis IMAP si le compte reçoit) : état OK ou ERREUR avec la réponse du serveur.</summary>
    public async Task<CompteDto> TesterAsync(Utilisateur u, long id, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        var c = await Compte(id, ct);
        var cfg = Connexion(c);
        try
        {
            var smtp = c.McoEnvoi ? cfg.Smtp : null;
            var imap = c.McoReception || c.McoCopieEnvoyes ? cfg.Imap : null;
            await transport.TesterAsync(smtp, smtp is null ? null : await AuthAsync(c, smtp, ct), imap, imap is null ? null : await AuthAsync(c, imap, ct), ct);
            c.McoEtat = c.McoEtat == "SUSPENDU" ? "SUSPENDU" : "OK";
            c.McoDerniereErreur = null;
        }
        catch (Exception e) when (e is ErreurEnvoi or ExceptionMetier)
        {
            c.McoEtat = "ERREUR";
            c.McoDerniereErreur = e.Message.Length > 500 ? e.Message[..500] : e.Message;
        }
        c.McoVerifieLe = Maintenant;
        await db.SaveChangesAsync(ct);
        return Dto(c, await db.Alias.AsNoTracking().ToListAsync(ct));
    }

    /// <summary>Authentification à un serveur du compte : mot de passe, ou jeton OAuth 2.0 (compte connecté de la connexion).</summary>
    public async Task<AuthMail> AuthAsync(CompteEntite c, ServeurMail s, CancellationToken ct)
    {
        if (c.McoAuthentification != "OAUTH2") return new AuthMail(s.Identifiant ?? Identite(c).Adresse, s.MotDePasse, null);
        if (jetons is null || c.McoOcoId is null) throw ExceptionMetier.Conflit(IFournisseurJeton.AReconnecter, "Connexion OAuth 2.0 indisponible");
        var j = await jetons.JetonAsync(c.McoOcoId.Value, ct);
        return new AuthMail(string.IsNullOrEmpty(j.Compte) ? s.Identifiant ?? Identite(c).Adresse : j.Compte, null, j.Jeton);
    }

    // --- Alias, usages, modèles ---

    /// <summary>Alias de tous les comptes (choix de l'expéditeur, tout utilisateur) : jamais l'adresse.</summary>
    public async Task<List<AliasDto>> AliasAsync(CancellationToken ct) =>
        await (from a in db.Alias.AsNoTracking() join c in db.Comptes.AsNoTracking() on a.MalMcoId equals c.McoId
               orderby a.MalNom
               select new AliasDto(a.MalId, a.MalNom, c.McoId, a.MalPrincipal, a.MalActif, c.McoEnvoi, c.McoActif)).ToListAsync(ct);

    /// <summary>Alias d'un compte : liste complète (un principal), les absents sont supprimés s'ils ne servent à aucun usage.</summary>
    public async Task<List<AliasDto>> EnregistrerAliasAsync(Utilisateur u, long compte, List<AliasDto> liste, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        await Compte(compte, ct);
        var noms = liste.Select(a => (a.Nom ?? "").Trim()).ToList();
        if (noms.Any(n => n.Length is 0 or > 80) || noms.Distinct(StringComparer.OrdinalIgnoreCase).Count() != noms.Count)
            throw ExceptionMetier.Invalide("MAIL_ALIAS", "Noms obligatoires, distincts, 80 caractères au plus");
        if (liste.Count(a => a.Principal) != 1) throw ExceptionMetier.Invalide("MAIL_ALIAS_PRINCIPAL", "Un alias principal par compte");
        var autres = await db.Alias.AsNoTracking().Where(a => a.MalMcoId != compte && noms.Contains(a.MalNom)).Select(a => a.MalNom).ToListAsync(ct);
        if (autres.Count > 0) throw ExceptionMetier.Conflit("MAIL_ALIAS_PRIS", $"Nom déjà utilisé par un autre compte : {string.Join(", ", autres)}");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var existants = await db.Alias.Where(a => a.MalMcoId == compte).ToListAsync(ct);
        foreach (var a in existants) a.MalPrincipal = false;
        await db.SaveChangesAsync(ct);
        foreach (var saisi in liste)
        {
            var a = existants.FirstOrDefault(x => x.MalId == saisi.Id && saisi.Id > 0);
            if (a is null) db.Alias.Add(a = new AliasEntite { MalMcoId = compte });
            a.MalNom = saisi.Nom.Trim();
            a.MalPrincipal = saisi.Principal;
            a.MalActif = saisi.Actif;
        }
        var retires = existants.Where(x => liste.All(s => s.Id != x.MalId)).ToList();
        foreach (var r in retires)
        {
            if (await db.Usages.AnyAsync(x => x.MusMalId == r.MalId, ct)) throw ExceptionMetier.Conflit("MAIL_ALIAS_UTILISE", $"« {r.MalNom} » sert à un usage : le désactiver");
            db.Alias.Remove(r);
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await AliasAsync(ct);
    }

    public IReadOnlyList<UsageConnu> UsagesConnus => specialisation.Usages;

    public async Task<List<UsageDto>> UsagesAsync(CancellationToken ct) =>
        await db.Usages.AsNoTracking().OrderBy(x => x.MusUsage).ThenBy(x => x.MusPortee).Select(x => new UsageDto(x.MusUsage, x.MusPortee, x.MusMalId)).ToListAsync(ct);

    public async Task<List<UsageDto>> EnregistrerUsagesAsync(Utilisateur u, List<UsageDto> liste, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        if (liste.GroupBy(x => (x.Usage, x.Portee ?? "")).Any(g => g.Count() > 1)) throw ExceptionMetier.Invalide("MAIL_USAGE", "Un seul alias par usage et portée");
        var alias = await db.Alias.AsNoTracking().Select(a => a.MalId).ToListAsync(ct);
        if (liste.Any(x => !alias.Contains(x.AliasId))) throw ExceptionMetier.Invalide("MAIL_USAGE", "Alias inconnu");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Usages.ExecuteDeleteAsync(ct);
        db.Usages.AddRange(liste.Select(x => new UsageEntite { MusUsage = x.Usage, MusPortee = (x.Portee ?? "").Trim(), MusMalId = x.AliasId }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await UsagesAsync(ct);
    }

    public async Task<List<ModeleDto>> ModelesAsync(CancellationToken ct) =>
        await db.Modeles.AsNoTracking().OrderBy(m => m.MmoUsage).ThenBy(m => m.MmoType).ThenBy(m => m.MmoLibelle)
            .Select(m => new ModeleDto(m.MmoId, m.MmoCode, m.MmoLibelle, m.MmoUsage, m.MmoType, m.MmoObjet, m.MmoCorpsHtml, m.MmoDefaut, m.MmoActif)).ToListAsync(ct);

    public async Task<List<ModeleDto>> EnregistrerModeleAsync(Utilisateur u, ModeleDto s, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        var code = (s.Code ?? "").Trim().ToUpperInvariant();
        if (code.Length is 0 or > 30 || string.IsNullOrWhiteSpace(s.Libelle) || string.IsNullOrWhiteSpace(s.Objet) || string.IsNullOrWhiteSpace(s.Usage))
            throw ExceptionMetier.Invalide("MAIL_MODELE", "Code, libellé, usage et objet obligatoires");
        var m = s.Id > 0 ? await db.Modeles.FirstOrDefaultAsync(x => x.MmoId == s.Id, ct) ?? throw ExceptionMetier.Introuvable("Modèle") : new ModeleEntite();
        if (await db.Modeles.AnyAsync(x => x.MmoCode == code && x.MmoId != m.MmoId, ct)) throw ExceptionMetier.Conflit("MAIL_MODELE_CODE", $"Code {code} déjà utilisé");
        if (m.MmoId == 0) db.Modeles.Add(m);
        (m.MmoCode, m.MmoLibelle, m.MmoUsage, m.MmoType, m.MmoObjet, m.MmoCorpsHtml, m.MmoDefaut, m.MmoActif) =
            (code, s.Libelle.Trim(), s.Usage, (s.Type ?? "").Trim(), s.Objet.Trim(), nettoyage.Nettoyer(s.CorpsHtml), s.Defaut, s.Actif);
        if (m.MmoDefaut)
        {
            await db.Modeles.Where(x => x.MmoUsage == m.MmoUsage && x.MmoType == m.MmoType && x.MmoId != m.MmoId)
                .ExecuteUpdateAsync(x => x.SetProperty(y => y.MmoDefaut, false), ct);
        }
        await db.SaveChangesAsync(ct);
        return await ModelesAsync(ct);
    }

    public async Task<List<ModeleDto>> SupprimerModeleAsync(Utilisateur u, long id, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        await db.Modeles.Where(x => x.MmoId == id).ExecuteDeleteAsync(ct);
        return await ModelesAsync(ct);
    }

    // --- Paramètres ---

    public async Task<Dictionary<string, int>> ParametresAsync(CancellationToken ct) =>
        (await db.Parametres.AsNoTracking().ToListAsync(ct)).ToDictionary(p => p.MpaCle, p => int.TryParse(p.MpaValeur, out var n) ? n : 0);

    public async Task<Dictionary<string, int>> EnregistrerParametresAsync(Utilisateur u, Dictionary<string, int> p, CancellationToken ct)
    {
        Exiger(u.EstAdmin);
        foreach (var (cle, valeur) in p)
        {
            var e = await db.Parametres.FirstOrDefaultAsync(x => x.MpaCle == cle, ct) ?? throw ExceptionMetier.Invalide("MAIL_PARAMETRE", $"Paramètre inconnu : {cle}");
            if (valeur < 0) throw ExceptionMetier.Invalide("MAIL_PARAMETRE", $"{cle} : valeur positive attendue");
            e.MpaValeur = valeur.ToString();
        }
        await db.SaveChangesAsync(ct);
        return await ParametresAsync(ct);
    }

    public async Task<int> ParametreAsync(string cle, int defaut, CancellationToken ct)
    {
        var v = await db.Parametres.AsNoTracking().Where(x => x.MpaCle == cle).Select(x => x.MpaValeur).FirstOrDefaultAsync(ct);
        return int.TryParse(v, out var n) ? n : defaut;
    }

    // --- Utilisations d'une connexion OAuth ---

    public async Task<IReadOnlyList<string>> UtilisationsAsync(long connexion, CancellationToken ct) =>
        await (from c in db.Comptes.AsNoTracking() join a in db.Alias.AsNoTracking() on c.McoId equals a.MalMcoId
               where c.McoOcoId == connexion && a.MalPrincipal select $"Mail : {a.MalNom}").ToListAsync(ct);

    // --- Outils ---

    public async Task<CompteEntite> Compte(long id, CancellationToken ct) =>
        await db.Comptes.FirstOrDefaultAsync(c => c.McoId == id, ct) ?? throw ExceptionMetier.Introuvable("Compte de messagerie");

    public IdentiteCompte Identite(CompteEntite c) => JsonSerializer.Deserialize<IdentiteCompte>(chiffrement.Dechiffrer(c.McoIdentite)!, JsonCalcul.Options)!;

    public ConfigConnexion Connexion(CompteEntite c) =>
        c.McoConnexion.Length == 0 ? new ConfigConnexion(null, null) : JsonSerializer.Deserialize<ConfigConnexion>(chiffrement.Dechiffrer(c.McoConnexion)!, JsonCalcul.Options)!;

    public static Limites? LimitesSaisies(CompteEntite c)
    {
        try
        {
            return JsonSerializer.Deserialize<Limites>(c.McoLimites, JsonCalcul.Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Vide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static void Exiger(bool droit)
    {
        if (!droit) throw ExceptionMetier.AccesRefuse("PARAMETRER");
    }
}
