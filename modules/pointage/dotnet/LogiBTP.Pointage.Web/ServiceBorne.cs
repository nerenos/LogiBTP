using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Pointage.Web;

public class AppareilEntite
{
    public int PapId { get; set; }
    public string PapLibelle { get; set; } = "";
    public string PapJetonHache { get; set; } = "";
    public int? PapService { get; set; }
    public bool PapPinExige { get; set; } = true;
    public bool PapActif { get; set; } = true;
    public string PapCreePar { get; set; } = "";
    public DateTimeOffset PapCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? PapVuLe { get; set; }
}

public class PinEntite
{
    public int PpnSalId { get; set; }
    public string PpnHache { get; set; } = "";
    public short PpnEssais { get; set; }
    public DateTimeOffset? PpnBloqueJusqu { get; set; }
    public string PpnMajPar { get; set; } = "";
    public DateTimeOffset PpnMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public sealed record AppareilSaisi(string Libelle, int? Service, bool PinExige = true, bool Actif = true);
public sealed record PinSaisi(string? Pin);
public sealed record Identification(int Salarie, string? Pin);
/// <summary>Pointage saisi à la borne (jeton de saisie de l'identification).</summary>
public sealed record PointageBorne(string Jeton, DateOnly Date, int ChaId, long? EntId, int TypeMo, string? SousType, int Minutes, string? Motif, string? Commentaire,
    List<int>? Membres = null);
public sealed record GroupeSaisi(int ChaId, long? EntId, int TypeMo, string? SousType, int Minutes, string? Motif);

/// <summary>Jetons de saisie de la borne (2 minutes, un par identification) : mémoire du processus.</summary>
public sealed class JetonsBorne
{
    private readonly ConcurrentDictionary<string, (int Appareil, int Salarie, DateTimeOffset Fin)> jetons = new();

    public string Creer(int appareil, int salarie)
    {
        foreach (var k in jetons.Where(x => x.Value.Fin < DateTimeOffset.UtcNow).Select(x => x.Key).ToList()) jetons.TryRemove(k, out _);
        var j = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        jetons[j] = (appareil, salarie, DateTimeOffset.UtcNow.AddMinutes(2));
        return j;
    }

    public int? Salarie(string jeton, int appareil) =>
        jetons.TryGetValue(jeton, out var v) && v.Appareil == appareil && v.Fin >= DateTimeOffset.UtcNow ? v.Salarie : null;

    public void Retirer(string jeton) => jetons.TryRemove(jeton, out _);
}

/// <summary>
/// Borne d'atelier (lot 4, M8) : appareils enregistrés par un administrateur (jeton remis une fois, en-tête
/// X-Borne-Jeton, aucune session utilisateur), PIN des salariés (PBKDF2, cinq essais puis blocage de quinze minutes),
/// identification → jeton de saisie de deux minutes, pointage individuel ou par équipe (même groupe), ordres reconnus par
/// leur numéro (QR code), groupes d'équipe modifiables ensemble tant que les pointages sont identiques (M6).
/// </summary>
public sealed class ServiceBorne(PointageDbContext db, SpecialisationPointage specialisation, ServicePointage pointage, JetonsBorne jetons, IServiceProvider services)
{
    private const int Essais = 5;

    private static string Sha256(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));

    private static string HacherPin(string pin)
    {
        var sel = RandomNumberGenerator.GetBytes(16);
        var e = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pin), sel, 60_000, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256$60000${Convert.ToBase64String(sel)}${Convert.ToBase64String(e)}";
    }

    private static bool VerifierPin(string pin, string hache)
    {
        var p = hache.Split('$');
        if (p.Length != 4 || !int.TryParse(p[1], out var it)) return false;
        var attendu = Convert.FromBase64String(p[3]);
        return CryptographicOperations.FixedTimeEquals(Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pin), Convert.FromBase64String(p[2]), it, HashAlgorithmName.SHA256, attendu.Length), attendu);
    }

    private async Task Rh(Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin && !await specialisation.EstRhAsync(db, u, ct)) throw ExceptionMetier.AccesRefuse("BORNES");
    }

    // --- Administration (session utilisateur) ---

    public async Task<object> AppareilsAsync(Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        return await db.Appareils.AsNoTracking().OrderBy(a => a.PapLibelle)
            .Select(a => new { id = a.PapId, libelle = a.PapLibelle, service = a.PapService, pin_exige = a.PapPinExige, actif = a.PapActif, cree_par = a.PapCreePar, cree_le = a.PapCreeLe, vu_le = a.PapVuLe })
            .ToListAsync(ct);
    }

    /// <summary>Enregistre une borne : jeton aléatoire renvoyé une seule fois (seule son empreinte est gardée).</summary>
    public async Task<object> CreerAppareilAsync(AppareilSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("BORNES");
        if (string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("BORNE_LIBELLE", "Libellé obligatoire");
        var jeton = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var a = new AppareilEntite { PapLibelle = s.Libelle.Trim(), PapService = s.Service, PapPinExige = s.PinExige, PapJetonHache = Sha256(jeton), PapCreePar = u.Code };
        db.Appareils.Add(a);
        await db.SaveChangesAsync(ct);
        return new { id = a.PapId, jeton };
    }

    public async Task ModifierAppareilAsync(int id, AppareilSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("BORNES");
        var a = await db.Appareils.FirstOrDefaultAsync(x => x.PapId == id, ct) ?? throw ExceptionMetier.Introuvable($"Borne {id}");
        a.PapLibelle = s.Libelle.Trim();
        a.PapService = s.Service;
        a.PapPinExige = s.PinExige;
        a.PapActif = s.Actif;
        await db.SaveChangesAsync(ct);
    }

    public async Task<object> PinsAsync(int? service, Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        var salaries = await specialisation.SalariesAsync(db, new FiltreSalaries(service, null), ct);
        var ids = salaries.Select(s => s.Id).ToList();
        var pins = await db.Pins.AsNoTracking().Where(p => ids.Contains(p.PpnSalId)).ToDictionaryAsync(p => p.PpnSalId, ct);
        return salaries.Select(s => new
        {
            salarie = s, pin = pins.ContainsKey(s.Id), bloque = pins.TryGetValue(s.Id, out var p) && p.PpnBloqueJusqu > DateTimeOffset.UtcNow,
        });
    }

    /// <summary>Pose (4 à 8 chiffres) ou retire le PIN d'un salarié ; débloque.</summary>
    public async Task EnregistrerPinAsync(int salarie, PinSaisi s, Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        var p = await db.Pins.FirstOrDefaultAsync(x => x.PpnSalId == salarie, ct);
        if (string.IsNullOrEmpty(s.Pin))
        {
            if (p is not null) db.Pins.Remove(p);
        }
        else
        {
            if (s.Pin.Length is < 4 or > 8 || !s.Pin.All(char.IsAsciiDigit)) throw ExceptionMetier.Invalide("BORNE_PIN", "PIN de 4 à 8 chiffres");
            if (p is null) db.Pins.Add(p = new PinEntite { PpnSalId = salarie });
            p.PpnHache = HacherPin(s.Pin);
            p.PpnEssais = 0;
            p.PpnBloqueJusqu = null;
            p.PpnMajPar = u.Code;
            p.PpnMajLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
    }

    // --- Borne (sans session : jeton d'appareil) ---

    private async Task<AppareilEntite> AppareilAsync(HttpContext http, CancellationToken ct)
    {
        var jeton = http.Request.Headers["X-Borne-Jeton"].ToString();
        if (string.IsNullOrEmpty(jeton)) throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "BORNE_INCONNUE", "Borne non enregistrée");
        var h = Sha256(jeton);
        var a = await db.Appareils.FirstOrDefaultAsync(x => x.PapJetonHache == h && x.PapActif, ct)
            ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "BORNE_INCONNUE", "Borne non enregistrée ou désactivée");
        if (a.PapVuLe is null || a.PapVuLe < DateTimeOffset.UtcNow.AddMinutes(-5))
        {
            a.PapVuLe = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        return a;
    }

    private static Utilisateur Auteur(AppareilEntite a) => new($"borne:{a.PapId}", "BORNE", null);

    /// <summary>Ouverture de la borne : appareil, paramètres, référentiels, salariés du service (PIN posé ou non).</summary>
    public async Task<object> OuvrirAsync(HttpContext http, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        var salaries = await specialisation.SalariesAsync(db, new FiltreSalaries(a.PapService, null), ct);
        var ids = salaries.Select(s => s.Id).ToList();
        var pins = await db.Pins.AsNoTracking().Where(p => ids.Contains(p.PpnSalId)).Select(p => p.PpnSalId).ToListAsync(ct);
        return new
        {
            appareil = new { a.PapId, libelle = a.PapLibelle, pin_exige = a.PapPinExige },
            referentiels = await pointage.ReferentielsAsync(ct),
            motifs = await specialisation.MotifsAsync(db, "NON_CONFORMITE", ct),
            equipes = await specialisation.EquipesAsync(db, a.PapService, DateOnly.FromDateTime(DateTime.Today), ct),
            salaries = salaries.Select(s => new { s.Id, s.Nom, s.Prenom, s.Matricule, pin = pins.Contains(s.Id) }),
        };
    }

    /// <summary>Identification d'un salarié (PIN si exigé ou posé) : jeton de saisie, journée et chantiers proposés.</summary>
    public async Task<object> IdentifierAsync(HttpContext http, Identification i, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        var pin = await db.Pins.FirstOrDefaultAsync(p => p.PpnSalId == i.Salarie, ct);
        if (pin is not null || a.PapPinExige)
        {
            if (pin is null) throw ExceptionMetier.Invalide("BORNE_SANS_PIN", "Aucun PIN : le demander au service RH");
            if (pin.PpnBloqueJusqu > DateTimeOffset.UtcNow) throw ExceptionMetier.Conflit("BORNE_BLOQUE", "Trop d'essais : réessayer dans quelques minutes");
            if (string.IsNullOrEmpty(i.Pin) || !VerifierPin(i.Pin, pin.PpnHache))
            {
                pin.PpnEssais++;
                if (pin.PpnEssais >= Essais)
                {
                    pin.PpnEssais = 0;
                    pin.PpnBloqueJusqu = DateTimeOffset.UtcNow.AddMinutes(15);
                }
                await db.SaveChangesAsync(ct);
                throw ExceptionMetier.Invalide("BORNE_PIN", "PIN incorrect");
            }
            pin.PpnEssais = 0;
            await db.SaveChangesAsync(ct);
        }
        return await JourneeAsync(a, i.Salarie, jetons.Creer(a.PapId, i.Salarie), ct);
    }

    private async Task<object> JourneeAsync(AppareilEntite a, int salarie, string jeton, CancellationToken ct)
    {
        var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).FirstOrDefault() ?? throw ExceptionMetier.Introuvable($"Salarié {salarie}");
        var jour = DateOnly.FromDateTime(DateTime.Today);
        var pointages = await db.Pointages.AsNoTracking().Where(p => p.PoiSalId == salarie && p.PoiCouche == Couches.Saisie && p.PoiDate == jour).OrderBy(p => p.PoiId).ToListAsync(ct);
        var recents = await db.Pointages.AsNoTracking().Where(p => p.PoiSalId == salarie && p.PoiDate >= jour.AddDays(-21))
            .GroupBy(p => p.PoiChaId).OrderByDescending(g => g.Max(p => p.PoiDate)).Select(g => g.Key).Take(6).ToListAsync(ct);
        var proposes = await specialisation.ChantiersDuJourAsync(db, salarie, jour, ct);
        var ids = recents.Concat(proposes).Concat(pointages.Select(p => p.PoiChaId)).Distinct().ToList();
        var chantiers = await specialisation.ChantiersAsync(db, null, ids, ct);
        return new
        {
            jeton, salarie = s, date = jour,
            pointages = pointages.Select(p => new { id = p.PoiId, cha_id = p.PoiChaId, ent_id = p.PoiEntId, type_mo = p.PoiTypeMo, sous_type = p.PoiSousType, minutes = p.PoiMinutes, motif = p.PoiMotif, groupe = p.PoiGroupe }),
            chantiers = chantiers.OrderBy(c => proposes.Contains(c.Id) ? 0 : recents.Contains(c.Id) ? 1 : 2), proposes,
            ordres = await specialisation.OrdresAsync(db, ids, ct),
        };
    }

    /// <summary>Ordre reconnu par son numéro (QR code ou saisie) : identifiant, chantier.</summary>
    public async Task<object> OrdreAsync(HttpContext http, string numero, CancellationToken ct)
    {
        await AppareilAsync(http, ct);
        return await specialisation.OrdreParNumeroAsync(db, numero.Trim(), ct) ?? throw ExceptionMetier.Introuvable($"Ordre {numero}");
    }

    /// <summary>
    /// Pointage de la borne : ajouté à la journée du salarié identifié (contrôles de la semaine, jour non validé) ; avec
    /// des membres : un pointage par membre, même groupe (saisie d'équipe par le chef). Le jeton de saisie est consommé.
    /// </summary>
    public async Task<object> PointerAsync(HttpContext http, PointageBorne p, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        var salarie = jetons.Salarie(p.Jeton, a.PapId) ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "BORNE_JETON", "Identification expirée : recommencer");
        var membres = (p.Membres is { Count: > 0 } ? p.Membres : [salarie]).Distinct().ToList();
        var groupe = membres.Count > 1 ? Guid.NewGuid() : (Guid?)null;
        var auteur = Auteur(a);
        foreach (var m in membres) await AjouterAsync(m, p.Date, new PointageSaisi(null, p.Date, p.ChaId, p.EntId, p.TypeMo, p.SousType, p.Minutes, null, null, p.Motif, p.Commentaire), groupe, a, auteur, ct);
        jetons.Retirer(p.Jeton);
        if (!string.IsNullOrWhiteSpace(p.Motif))
        {
            var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).First();
            await specialisation.ApresNonConformiteAsync(db, services, auteur, s, p.ChaId, p.EntId, p.Motif.Trim(), ct);
        }
        return await JourneeAsync(a, salarie, jetons.Creer(a.PapId, salarie), ct);
    }

    /// <summary>Ajoute un pointage à la semaine saisie d'un salarié (mêmes contrôles et blocages que la saisie au bureau).</summary>
    private async Task AjouterAsync(int salarie, DateOnly date, PointageSaisi nouveau, Guid? groupe, AppareilEntite a, Utilisateur auteur, CancellationToken ct)
    {
        var lundi = ReglesPointage.LundiDe(date);
        var existants = await db.Pointages.AsNoTracking().Where(x => x.PoiSalId == salarie && x.PoiCouche == Couches.Saisie && x.PoiDate >= lundi && x.PoiDate <= lundi.AddDays(6)).ToListAsync(ct);
        var saisie = existants.Select(x => new PointageSaisi(x.PoiId, x.PoiDate, x.PoiChaId, x.PoiEntId, x.PoiTypeMo, x.PoiSousType, x.PoiMinutes, x.PoiDebut, x.PoiFin, x.PoiMotif, x.PoiCommentaire))
            .Append(nouveau).ToList();
        await pointage.EnregistrerSemaineAsync(salarie, lundi, new SemaineSaisie(saisie), auteur, ct, controleAcces: false);
        var cree = await db.Pointages.Where(x => x.PoiSalId == salarie && x.PoiCouche == Couches.Saisie && x.PoiDate == date).OrderByDescending(x => x.PoiId).FirstAsync(ct);
        cree.PoiGroupe = groupe;
        cree.PoiAppareil = a.PapLibelle;
        await db.SaveChangesAsync(ct);
    }

    private static string Signature(PointageEntite p) => $"{p.PoiDate}|{p.PoiChaId}|{p.PoiEntId}|{p.PoiTypeMo}|{p.PoiSousType}|{p.PoiMinutes}|{p.PoiMotif}";

    /// <summary>
    /// Groupe d'une saisie d'équipe : pointages des membres, signature de référence (la plus fréquente), membres sortis
    /// du groupe (pointage modifié à part) ; « équipe d'origine » si tous sont identiques.
    /// </summary>
    public async Task<object> GroupeAsync(Guid groupe, Utilisateur u, CancellationToken ct)
    {
        var l = await db.Pointages.AsNoTracking().Where(p => p.PoiGroupe == groupe && p.PoiCouche == Couches.Saisie).OrderBy(p => p.PoiSalId).ToListAsync(ct);
        if (l.Count == 0) throw ExceptionMetier.Introuvable($"Groupe {groupe}");
        var reference = l.GroupBy(Signature).OrderByDescending(g => g.Count()).First().Key;
        var salaries = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, l.Select(p => p.PoiSalId).Distinct().ToList()), ct)).ToDictionary(s => s.Id);
        return new
        {
            groupe, origine = l.All(p => Signature(p) == reference),
            pointages = l.Select(p => new
            {
                id = p.PoiId, salarie = salaries.GetValueOrDefault(p.PoiSalId), date = p.PoiDate, cha_id = p.PoiChaId, ent_id = p.PoiEntId, type_mo = p.PoiTypeMo,
                sous_type = p.PoiSousType, minutes = p.PoiMinutes, motif = p.PoiMotif, identique = Signature(p) == reference,
            }),
        };
    }

    /// <summary>Modifie ensemble les pointages du groupe encore identiques à la référence ; les autres restent à part.</summary>
    public async Task<object> ModifierGroupeAsync(Guid groupe, GroupeSaisi s, Utilisateur u, CancellationToken ct)
    {
        var l = await db.Pointages.AsNoTracking().Where(p => p.PoiGroupe == groupe && p.PoiCouche == Couches.Saisie).ToListAsync(ct);
        if (l.Count == 0) throw ExceptionMetier.Introuvable($"Groupe {groupe}");
        var reference = l.GroupBy(Signature).OrderByDescending(g => g.Count()).First().Key;
        foreach (var p in l.Where(p => Signature(p) == reference))
        {
            var lundi = ReglesPointage.LundiDe(p.PoiDate);
            var semaine = await db.Pointages.AsNoTracking().Where(x => x.PoiSalId == p.PoiSalId && x.PoiCouche == Couches.Saisie && x.PoiDate >= lundi && x.PoiDate <= lundi.AddDays(6)).ToListAsync(ct);
            var saisie = semaine.Select(x => x.PoiId == p.PoiId
                ? new PointageSaisi(x.PoiId, x.PoiDate, s.ChaId, s.EntId, s.TypeMo, s.SousType, s.Minutes, null, null, s.Motif, x.PoiCommentaire)
                : new PointageSaisi(x.PoiId, x.PoiDate, x.PoiChaId, x.PoiEntId, x.PoiTypeMo, x.PoiSousType, x.PoiMinutes, x.PoiDebut, x.PoiFin, x.PoiMotif, x.PoiCommentaire)).ToList();
            await pointage.EnregistrerSemaineAsync(p.PoiSalId, lundi, new SemaineSaisie(saisie), u, ct);
        }
        return await GroupeAsync(groupe, u, ct);
    }
}
