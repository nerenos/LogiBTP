using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Authentification.Web;

/// <summary>Compte tel que l'écran des comptes le montre (jamais l'empreinte du mot de passe).</summary>
public sealed record CompteDto(long Id, string Code, string Type, string? Libelle, string? TypeElement, string? IdElement, string Profil,
    bool Actif, DateOnly? ValideJusquAu, string Etat, bool Connexion, DateTimeOffset? VerrouilleJusquAu, DateTimeOffset? DerniereConnexion,
    bool MdpProvisoire, int SessionsOuvertes, string CreePar, DateTimeOffset CreeLe, string? MajPar, DateTimeOffset MajLe,
    Guid Uuid = default, string[]? Adresses = null, bool DoubleFacteur = false);

/// <summary>Création ou modification d'un compte de personne par un administrateur.</summary>
public sealed record CompteSaisi(string? Code, string? TypeElement, string? IdElement, string? Profil, DateOnly? ValideJusquAu, bool? Actif);

/// <summary>Compte créé ou réinitialisé : le mot de passe provisoire n'est rendu qu'une fois.</summary>
public sealed record CompteEtMotDePasse(CompteDto Compte, string MotDePasse);

/// <summary>Personne pouvant recevoir un compte, avec son compte éventuel.</summary>
public sealed record PersonneEtCompte(PersonneCompte Personne, CompteDto? Compte);

/// <summary>
/// Gestion des comptes par un administrateur (lot 1) : liste et état, création pour une personne autorisée (pseudo
/// unique, politique, profil permis, validité), modification (pseudo, profil, validité, activation : pris en compte au
/// prochain appel de l'utilisateur), réinitialisation (mot de passe provisoire affiché une fois), déverrouillage, journal.
/// </summary>
public sealed class ServiceComptes(AuthDbContext db, SpecialisationAuthentification specialisation, ServiceAuthentification auth, IServiceProvider services)
{
    private static void Admin(Utilisateur u)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("GERER_COMPTES");
    }

    private async Task<CompteDto> DtoAsync(Compte c, CancellationToken ct)
    {
        var sessions = await db.Sessions.CountAsync(s => s.SesCptId == c.CptId && s.SesFermeeLe == null && s.SesExpireLe > DateTimeOffset.UtcNow, ct);
        return Dto(c, sessions);
    }

    private static CompteDto Dto(Compte c, int sessions)
    {
        var e = ReglesCompte.Etat(c.AEvaluer(), DateTimeOffset.UtcNow);
        return new CompteDto(c.CptId, c.CptCode, c.CptType, c.CptLibelle, c.CptTypeElement, c.CptIdElement, c.CptProfil, c.CptActif, c.CptValideJusquAu,
            e.Etat, e.Connexion, c.CptVerrouilleJusquAu, c.CptDerniereConnexion, c.CptMdpProvisoire, sessions, c.CptCreePar, c.CptCreeLe, c.CptMajPar, c.CptMajLe,
            c.CptUuid, c.CptAdresses, c.CptDoubleFacteur);
    }

    /// <summary>Compte tel que l'écran le montre, sans contrôle de droit (appelant déjà contrôlé).</summary>
    public async Task<CompteDto> DetailCompteAsync(long id, CancellationToken ct) =>
        await DtoAsync(await db.Comptes.AsNoTracking().FirstAsync(x => x.CptId == id, ct), ct);

    public async Task<List<CompteDto>> ListeAsync(string? recherche, string? etat, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var q = db.Comptes.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(recherche))
        {
            var t = $"%{recherche.Trim()}%";
            q = q.Where(c => EF.Functions.ILike(c.CptCode, t) || (c.CptLibelle != null && EF.Functions.ILike(c.CptLibelle, t)));
        }
        var comptes = await q.OrderBy(c => c.CptType).ThenBy(c => c.CptCode).ToListAsync(ct);
        var ids = comptes.Select(c => c.CptId).ToArray();
        var sessions = await db.Sessions.Where(s => ids.Contains(s.SesCptId) && s.SesFermeeLe == null && s.SesExpireLe > DateTimeOffset.UtcNow)
            .GroupBy(s => s.SesCptId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var res = comptes.Select(c => Dto(c, sessions.GetValueOrDefault(c.CptId))).ToList();
        return string.IsNullOrEmpty(etat) ? res : res.Where(c => c.Etat == etat).ToList();
    }

    public async Task<object> DetailAsync(long id, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var c = await db.Comptes.AsNoTracking().FirstOrDefaultAsync(x => x.CptId == id, ct) ?? throw ExceptionMetier.Introuvable($"Compte {id}");
        var personne = c.CptTypeElement is null || c.CptIdElement is null ? null : await specialisation.PersonneAsync(db, c.CptTypeElement, c.CptIdElement, ct);
        var journal = await db.Journal.AsNoTracking().Where(j => j.JcoCode.ToLower() == c.CptCode.ToLower()).OrderByDescending(j => j.JcoLe).Take(50)
            .Select(j => new { evenement = j.JcoEvenement, detail = j.JcoDetail, le = j.JcoLe, adresse = j.JcoAdresse, navigateur = j.JcoNavigateur, par = j.JcoPar })
            .ToListAsync(ct);
        return new { compte = await DtoAsync(c, ct), personne, journal, sessions = await auth.SessionsAsync(c.CptId, null, ct), machines = await auth.MachinesAsync(c.CptId, ct) };
    }

    public async Task<PersonneEtCompte> PersonneAsync(string type, string id, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var p = await specialisation.PersonneAsync(db, type, id, ct) ?? throw ExceptionMetier.Introuvable($"{type} {id}");
        var c = await db.Comptes.AsNoTracking().FirstOrDefaultAsync(x => x.CptTypeElement == type && x.CptIdElement == id, ct);
        return new PersonneEtCompte(p, c is null ? null : await DtoAsync(c, ct));
    }

    public async Task<List<PersonneEtCompte>> PersonnesAsync(string? recherche, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        if (string.IsNullOrWhiteSpace(recherche) || recherche.Trim().Length < 2) return [];
        var personnes = await specialisation.RechercherPersonnesAsync(db, recherche, ct);
        var cles = personnes.Select(p => p.Type + ":" + p.Id).ToList();
        var comptes = await db.Comptes.AsNoTracking().Where(c => c.CptTypeElement != null && cles.Contains(c.CptTypeElement + ":" + c.CptIdElement)).ToListAsync(ct);
        return personnes.Select(p => new PersonneEtCompte(p, comptes.FirstOrDefault(c => c.CptTypeElement == p.Type && c.CptIdElement == p.Id) is { } c ? Dto(c, 0) : null)).ToList();
    }

    /// <summary>Pseudo valable pour le compte (règles, réservés, unicité dans la base et dans l'application).</summary>
    private async Task ControlerPseudoAsync(string code, long? compte, string? type, string? id, ParametresAuthentification p, CancellationToken ct)
    {
        var erreurs = ReglesCompte.ControlerPseudo(code, p.PseudosReserves);
        if (erreurs.Count > 0) throw ServiceAuthentification.ErreursRegles(erreurs);
        if (await db.Comptes.AnyAsync(c => c.CptCode.ToLower() == code && c.CptId != compte, ct) || !await specialisation.PseudoLibreAsync(db, code, type, id, ct))
        {
            throw ExceptionMetier.Conflit("PSEUDO_PRIS", $"Identifiant « {code} » déjà utilisé");
        }
    }

    private async Task ControlerCompteAsync(string profil, DateOnly? validite, PersonneCompte? personne, CancellationToken ct)
    {
        var erreurs = ReglesCompte.ControlerCompte(profil, validite, personne?.Regle, (await specialisation.ProfilsAsync(services, ct)).Select(x => x.Code).ToList(), DateOnly.FromDateTime(DateTime.UtcNow));
        if (erreurs.Count > 0)
        {
            if (erreurs.Contains("PERSONNE_NON_AUTORISEE") && personne?.Motif is { } motif)
            {
                throw ExceptionMetier.Invalide("PERSONNE_NON_AUTORISEE", $"{ReglesCompte.Messages["PERSONNE_NON_AUTORISEE"]} : {motif}");
            }
            throw ServiceAuthentification.ErreursRegles(erreurs);
        }
        await Task.CompletedTask;
    }

    public async Task<CompteEtMotDePasse> CreerAsync(CompteSaisi s, Utilisateur u, ServiceAuthentification.Origine origine, CancellationToken ct)
    {
        Admin(u);
        if (string.IsNullOrEmpty(s.TypeElement) || string.IsNullOrEmpty(s.IdElement)) throw ExceptionMetier.Invalide("PERSONNE_OBLIGATOIRE", "Personne liée obligatoire");
        var p = await auth.ParametresAsync(ct);
        var code = ReglesCompte.Normaliser(s.Code);
        await ControlerPseudoAsync(code, null, s.TypeElement, s.IdElement, p, ct);
        var personne = await specialisation.PersonneAsync(db, s.TypeElement, s.IdElement, ct) ?? throw ExceptionMetier.Introuvable($"{s.TypeElement} {s.IdElement}");
        if (await db.Comptes.AnyAsync(c => c.CptTypeElement == s.TypeElement && c.CptIdElement == s.IdElement, ct))
        {
            throw ExceptionMetier.Conflit("COMPTE_EXISTANT", $"{personne.Libelle} a déjà un compte");
        }
        var profil = s.Profil ?? specialisation.ProfilParDefaut;
        await ControlerCompteAsync(profil, s.ValideJusquAu, personne, ct);
        var mdp = HachageMotDePasse.Provisoire();
        await using var tx = await db.Unite().CommencerAsync(ct);
        var c = new Compte
        {
            CptCode = code, CptType = "PERSONNE", CptLibelle = personne.Libelle, CptTypeElement = s.TypeElement, CptIdElement = s.IdElement,
            CptHash = HachageMotDePasse.Hacher(mdp), CptMdpProvisoire = true, CptProfil = profil, CptActif = true, CptValideJusquAu = s.ValideJusquAu,
            CptCreePar = u.Code, CptMajPar = u.Code,
        };
        db.Comptes.Add(c);
        await db.SaveChangesAsync(ct);
        await specialisation.ApresEcritureAsync(db, c, null, ct);
        await auth.JournaliserAsync(c.CptCode, "COMPTE", $"création, profil {profil}", origine, u.Code, ct);
        await tx.CommitAsync(ct);
        return new CompteEtMotDePasse(await DtoAsync(c, ct), mdp);
    }

    /// <summary>
    /// Modification par un administrateur ; un administrateur ne retire ni son activation ni son profil ADMIN (pas de
    /// verrouillage de l'installation par erreur) ; désactivation : sessions fermées.
    /// </summary>
    public async Task<CompteDto> ModifierAsync(long id, CompteSaisi s, Utilisateur u, ServiceAuthentification.Origine origine, CancellationToken ct)
    {
        Admin(u);
        var c = await db.Comptes.FirstOrDefaultAsync(x => x.CptId == id, ct) ?? throw ExceptionMetier.Introuvable($"Compte {id}");
        if (c.CptType == "SERVICE") throw ExceptionMetier.Conflit("COMPTE_SERVICE", "Un compte de service ne se modifie pas ici");
        if (c.CptType == "API" && s.Profil is { } p && await specialisation.ProfilTotalAsync(services, p, ct))
        {
            throw ExceptionMetier.Invalide("PROFIL_INTERDIT", "Un identifiant d'API n'a jamais tous les droits");
        }
        var ancien = c.CptCode;
        var code = s.Code is null ? c.CptCode : ReglesCompte.Normaliser(s.Code);
        var profil = s.Profil ?? c.CptProfil;
        var actif = s.Actif ?? c.CptActif;
        var propre = string.Equals(c.CptCode, u.Code, StringComparison.OrdinalIgnoreCase);
        if (propre && (!actif || (c.CptProfil == Profils.Admin && profil != Profils.Admin)))
        {
            throw ExceptionMetier.Conflit("COMPTE_PROPRE", "Vous ne pouvez ni désactiver votre propre compte ni retirer son profil administrateur");
        }
        if (code != ReglesCompte.Normaliser(c.CptCode)) await ControlerPseudoAsync(code, c.CptId, c.CptTypeElement, c.CptIdElement, await auth.ParametresAsync(ct), ct);
        var personne = c.CptTypeElement is null || c.CptIdElement is null ? null : await specialisation.PersonneAsync(db, c.CptTypeElement, c.CptIdElement, ct);
        // Réactivation ou nouveau profil : la personne doit toujours y avoir droit ; une désactivation passe toujours.
        if (actif && c.CptType == "PERSONNE") await ControlerCompteAsync(profil, s.ValideJusquAu, personne, ct);
        var changements = new List<string>();
        if (code != c.CptCode) changements.Add($"identifiant {c.CptCode} → {code}");
        if (profil != c.CptProfil) changements.Add($"profil {c.CptProfil} → {profil}");
        if (actif != c.CptActif) changements.Add(actif ? "réactivé" : "désactivé");
        if (s.ValideJusquAu != c.CptValideJusquAu) changements.Add($"validité {(s.ValideJusquAu is { } v ? v.ToString("dd/MM/yyyy") : "sans fin")}");
        await using var tx = await db.Unite().CommencerAsync(ct);
        c.CptCode = code;
        c.CptProfil = profil;
        c.CptActif = actif;
        c.CptValideJusquAu = s.ValideJusquAu;
        if (personne is not null) c.CptLibelle = personne.Libelle;
        c.CptMajPar = u.Code;
        c.CptMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        if (!actif) await FermerSessionsAsync(c.CptId, ct); // jetons délégués aux agents révoqués aussi
        await specialisation.ApresEcritureAsync(db, c, ancien, ct);
        if (changements.Count > 0) await auth.JournaliserAsync(c.CptCode, "COMPTE", string.Join(", ", changements), origine, u.Code, ct);
        await tx.CommitAsync(ct);
        ServiceAuthentification.OublierSessions();
        return await DtoAsync(c, ct);
    }

    public async Task<CompteEtMotDePasse> ReinitialiserAsync(long id, Utilisateur u, ServiceAuthentification.Origine origine, CancellationToken ct)
    {
        Admin(u);
        var c = await db.Comptes.FirstOrDefaultAsync(x => x.CptId == id && x.CptType == "PERSONNE", ct) ?? throw ExceptionMetier.Introuvable($"Compte {id}");
        var mdp = HachageMotDePasse.Provisoire();
        c.CptHash = HachageMotDePasse.Hacher(mdp);
        c.CptMdpProvisoire = true;
        c.CptEchecs = 0;
        c.CptVerrouilleJusquAu = null;
        c.CptMajPar = u.Code;
        c.CptMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await FermerSessionsAsync(c.CptId, ct);
        await auth.JournaliserAsync(c.CptCode, "MDP_REINITIALISE", null, origine, u.Code, ct);
        ServiceAuthentification.OublierSessions();
        return new CompteEtMotDePasse(await DtoAsync(c, ct), mdp);
    }

    public async Task<CompteDto> DeverrouillerAsync(long id, Utilisateur u, ServiceAuthentification.Origine origine, CancellationToken ct)
    {
        Admin(u);
        var c = await db.Comptes.FirstOrDefaultAsync(x => x.CptId == id, ct) ?? throw ExceptionMetier.Introuvable($"Compte {id}");
        c.CptEchecs = 0;
        c.CptVerrouilleJusquAu = null;
        c.CptMajPar = u.Code;
        c.CptMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await auth.JournaliserAsync(c.CptCode, "DEVERROUILLAGE", null, origine, u.Code, ct);
        return await DtoAsync(c, ct);
    }

    /// <summary>Sessions du compte fermées et jetons délégués aux agents révoqués.</summary>
    private async Task FermerSessionsAsync(long compte, CancellationToken ct)
    {
        await db.Sessions.Where(x => x.SesCptId == compte && x.SesFermeeLe == null).ExecuteUpdateAsync(x => x.SetProperty(y => y.SesFermeeLe, DateTimeOffset.UtcNow), ct);
        await ServiceAuthentification.RevoquerJetonsAsync(db, compte, ct);
    }
}
