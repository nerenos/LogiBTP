using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Pointage.Web;

public class AppareilEntite
{
    public int PapId { get; set; }
    public string PapLibelle { get; set; } = "";
    public string PapJetonHache { get; set; } = "";
    /// <summary>Services, fonctions (postes) et types de main-d'œuvre proposés par la borne ; nul ou vide : tous.</summary>
    public int[]? PapServices { get; set; }
    public string[]? PapFonctions { get; set; }
    public int[]? PapTypesMo { get; set; }
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

/// <summary>Borne saisie ; services, fonctions et types de MO nuls à la modification : inchangés (vides : tous).</summary>
public sealed record AppareilSaisi(string Libelle, int? Service = null, bool PinExige = true, bool Actif = true,
    List<int>? Services = null, List<string>? Fonctions = null, List<int>? TypesMo = null);
public sealed record PinSaisi(string? Pin);
public sealed record Identification(int Salarie, string? Pin);
/// <summary>Pointage saisi à la borne (jeton de saisie de l'identification).</summary>
public sealed record PointageBorne(string Jeton, DateOnly Date, int ChaId, long? EntId, int TypeMo, string? SousType, int Minutes, string? Motif, string? Commentaire,
    List<int>? Membres = null);
/// <summary>Journée d'un salarié à la borne : date choisie (jours passés de la fenêtre de rattrapage).</summary>
public sealed record JourneeBorne(string Jeton, DateOnly Date);
/// <summary>Repas du jour saisi à la borne (lot 10, A29) par le salarié identifié.</summary>
public sealed record RepasBorne(string Jeton, RepasSaisi Repas, List<int>? Membres = null);
/// <summary>Résultat d'un repas d'équipe : salariés enregistrés, refusés (par salarié), repas du salarié identifié.</summary>
public sealed record RepasEquipeResultat(List<int> Enregistres, List<RefusRepas> Refus, List<RepasDto> Repas);
/// <summary>Ligne de la journée saisie à la borne (identifiant absent : nouvelle).</summary>
public sealed record LigneBorne(long? Id, int ChaId, long? EntId, int TypeMo, string? SousType, int Minutes, string? Motif, string? Commentaire);
/// <summary>Journée complète saisie à la borne : remplace les pointages saisis du jour (les autres jours sont inchangés).</summary>
public sealed record JourneeSaisie(string Jeton, DateOnly Date, List<LigneBorne> Pointages);
public sealed record GroupeSaisi(int ChaId, long? EntId, int TypeMo, string? SousType, int Minutes, string? Motif);

/// <summary>
/// Jetons de saisie de la borne (un par identification, cinq minutes glissantes : prolongés à chaque appel) : mémoire
/// du processus.
/// </summary>
public sealed class JetonsBorne
{
    private static readonly TimeSpan Duree = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, (int Appareil, int Salarie, DateTimeOffset Fin)> jetons = new();

    public string Creer(int appareil, int salarie)
    {
        foreach (var k in jetons.Where(x => x.Value.Fin < DateTimeOffset.UtcNow).Select(x => x.Key).ToList()) jetons.TryRemove(k, out _);
        var j = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        jetons[j] = (appareil, salarie, DateTimeOffset.UtcNow.Add(Duree));
        return j;
    }

    public int? Salarie(string jeton, int appareil)
    {
        if (!jetons.TryGetValue(jeton, out var v) || v.Appareil != appareil || v.Fin < DateTimeOffset.UtcNow) return null;
        jetons[jeton] = v with { Fin = DateTimeOffset.UtcNow.Add(Duree) };
        return v.Salarie;
    }

    public void Retirer(string jeton) => jetons.TryRemove(jeton, out _);

    private readonly ConcurrentDictionary<string, (int Appareil, DateTimeOffset Fin)> tests = new();

    /// <summary>Jeton d'essai d'une borne (administrateur, huit heures) : remplace le jeton de l'appareil dans une fenêtre de test.</summary>
    public string CreerTest(int appareil)
    {
        foreach (var k in tests.Where(x => x.Value.Fin < DateTimeOffset.UtcNow).Select(x => x.Key).ToList()) tests.TryRemove(k, out _);
        var j = "test-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        tests[j] = (appareil, DateTimeOffset.UtcNow.AddHours(8));
        return j;
    }

    public int? AppareilTest(string jeton) => tests.TryGetValue(jeton, out var v) && v.Fin >= DateTimeOffset.UtcNow ? v.Appareil : null;
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
    /// <summary>Rattrapage d'un oubli : jours passés saisissables à la borne (jamais un jour futur).</summary>
    public const int JoursRattrapage = 7;

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
            .Select(a => new
            {
                id = a.PapId, libelle = a.PapLibelle, services = a.PapServices ?? Array.Empty<int>(), fonctions = a.PapFonctions ?? Array.Empty<string>(),
                types_mo = a.PapTypesMo ?? Array.Empty<int>(), pin_exige = a.PapPinExige, actif = a.PapActif, cree_par = a.PapCreePar, cree_le = a.PapCreeLe, vu_le = a.PapVuLe,
            })
            .ToListAsync(ct);
    }

    /// <summary>Enregistre une borne : jeton aléatoire renvoyé une seule fois (seule son empreinte est gardée).</summary>
    public async Task<object> CreerAppareilAsync(AppareilSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("BORNES");
        if (string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("BORNE_LIBELLE", "Libellé obligatoire");
        var jeton = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var a = new AppareilEntite { PapLibelle = s.Libelle.Trim(), PapPinExige = s.PinExige, PapJetonHache = Sha256(jeton), PapCreePar = u.Code };
        Parametrer(a, s);
        db.Appareils.Add(a);
        await db.SaveChangesAsync(ct);
        return new { id = a.PapId, jeton };
    }

    /// <summary>
    /// Essai d'une borne par un administrateur (fenêtre séparée) : jeton d'essai sans toucher au jeton de l'appareil ;
    /// la borne d'essai demande le PIN sans l'exiger et contrôle les pointages sans les enregistrer.
    /// </summary>
    public async Task<object> TesterAppareilAsync(int id, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("BORNES");
        if (!await db.Appareils.AnyAsync(x => x.PapId == id, ct)) throw ExceptionMetier.Introuvable($"Borne {id}");
        return new { jeton = jetons.CreerTest(id) };
    }

    public async Task ModifierAppareilAsync(int id, AppareilSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("BORNES");
        var a = await db.Appareils.FirstOrDefaultAsync(x => x.PapId == id, ct) ?? throw ExceptionMetier.Introuvable($"Borne {id}");
        if (string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("BORNE_LIBELLE", "Libellé obligatoire");
        a.PapLibelle = s.Libelle.Trim();
        a.PapPinExige = s.PinExige;
        a.PapActif = s.Actif;
        Parametrer(a, s);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Filtres de la borne : listes nulles = inchangées, vides = tous (service unique ancien : repris).</summary>
    private static void Parametrer(AppareilEntite a, AppareilSaisi s)
    {
        var services = s.Services ?? (s.Service is int srv ? [srv] : null);
        if (services is not null) a.PapServices = services.Count > 0 ? [.. services.Distinct()] : null;
        if (s.Fonctions is not null)
        {
            var f = s.Fonctions.Select(x => x.Trim()).Where(x => x.Length > 0).Distinct().ToArray();
            a.PapFonctions = f.Length > 0 ? f : null;
        }
        if (s.TypesMo is not null) a.PapTypesMo = s.TypesMo.Count > 0 ? [.. s.TypesMo.Distinct()] : null;
    }

    /// <summary>Salariés proposés par la borne : ses services (et sous-services) et ses fonctions.</summary>
    private Task<List<SalariePointage>> SalariesBorneAsync(AppareilEntite a, CancellationToken ct) =>
        specialisation.SalariesAsync(db, new FiltreSalaries(null, null, Taille: 1000, Services: a.PapServices, Fonctions: a.PapFonctions), ct);

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
        if (jetons.AppareilTest(jeton) is int essai)
        {
            http.Items[CleTest] = true;
            return await db.Appareils.FirstOrDefaultAsync(x => x.PapId == essai, ct)
                ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "BORNE_INCONNUE", "Borne supprimée");
        }
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

    private const string CleTest = "borne-test";
    private static bool EnTest(HttpContext http) => http.Items.ContainsKey(CleTest);

    private static Utilisateur Auteur(AppareilEntite a) => new($"borne:{a.PapId}", Profils.Borne, null);

    /// <summary>Ouverture de la borne : appareil, paramètres, référentiels, salariés du service (PIN posé ou non).</summary>
    public async Task<object> OuvrirAsync(HttpContext http, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        var salaries = await SalariesBorneAsync(a, ct);
        var ids = salaries.Select(s => s.Id).ToList();
        var pins = await db.Pins.AsNoTracking().Where(p => ids.Contains(p.PpnSalId)).Select(p => p.PpnSalId).ToListAsync(ct);
        // Types de main-d'œuvre de la borne (vide : tous) ; équipes des services de la borne (sans service : toutes).
        var types = (await specialisation.TypesMoAsync(db, ct)).Where(t => a.PapTypesMo is not { Length: > 0 } || a.PapTypesMo.Contains(t.Id)).ToList();
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        var equipes = new List<EquipePointage>();
        if (a.PapServices is { Length: > 0 })
            foreach (var srv in a.PapServices) equipes.AddRange(await specialisation.EquipesAsync(db, srv, aujourdhui, ct));
        else equipes = await specialisation.EquipesAsync(db, null, aujourdhui, ct);
        equipes = equipes.DistinctBy(e => e.Id).ToList();
        return new
        {
            appareil = new { a.PapId, libelle = a.PapLibelle, pin_exige = a.PapPinExige, actif = a.PapActif, test = EnTest(http) },
            referentiels = new
            {
                parametres = await pointage.ParametresAsync(ct), types_mo = types,
                sous_types = (await pointage.SousTypesAsync(ct)).Where(x => x.Actif).ToList(), services = await specialisation.ServicesAsync(db, ct),
            },
            motifs = await specialisation.MotifsAsync(db, "NON_CONFORMITE", ct),
            equipes,
            salaries = salaries.Select(s => new { s.Id, s.Nom, s.Prenom, s.Matricule, pin = pins.Contains(s.Id) }),
        };
    }

    /// <summary>Identification d'un salarié (PIN si exigé ou posé) : jeton de saisie, journée et chantiers proposés.</summary>
    public async Task<object> IdentifierAsync(HttpContext http, Identification i, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        if (!(await SalariesBorneAsync(a, ct)).Any(s => s.Id == i.Salarie))
            throw ExceptionMetier.Invalide("BORNE_SALARIE", "Ce salarié ne pointe pas sur cette borne");
        var pin = await db.Pins.FirstOrDefaultAsync(p => p.PpnSalId == i.Salarie, ct);
        // Essai : PIN passé (vide) accepté ; un PIN saisi est vérifié sans compter les essais.
        if (EnTest(http))
        {
            if (!string.IsNullOrEmpty(i.Pin) && (pin is null || !VerifierPin(i.Pin, pin.PpnHache))) throw ExceptionMetier.Invalide("BORNE_PIN", "PIN incorrect");
        }
        else if (pin is not null || a.PapPinExige)
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
        return await JourneeAsync(a, i.Salarie, jetons.Creer(a.PapId, i.Salarie), DateOnly.FromDateTime(DateTime.Today), ct);
    }

    private static void ControlerDate(DateOnly date)
    {
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        if (date > aujourdhui || date < aujourdhui.AddDays(-JoursRattrapage))
            throw ExceptionMetier.Invalide("BORNE_DATE", $"Date hors de la saisie de la borne (aujourd'hui et les {JoursRattrapage} jours précédents)");
    }

    /// <summary>
    /// Salarié identifié sur la borne (jeton d'appareil de l'en-tête et jeton de saisie) : pour les écrans que
    /// l'application ajoute à la borne (étapes des ordres) ; essai : la borne d'essai ne doit rien enregistrer.
    /// </summary>
    public async Task<(int Salarie, int Appareil, bool Test)> SalarieIdentifieAsync(HttpContext http, string jeton, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        return (Identifie(a, jeton), a.PapId, EnTest(http));
    }

    private int Identifie(AppareilEntite a, string jeton) =>
        jetons.Salarie(jeton, a.PapId) ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, ErreursPointage.BorneJeton, "Identification expirée : recommencer");

    /// <summary>
    /// Journée d'un salarié à une date : pointages saisis du jour (commentaire, motif), jour validé (consultation seule),
    /// totaux du jour et de la semaine, chantiers proposés (planning du jour, récents, ceux du jour) et leurs ordres.
    /// </summary>
    private async Task<object> JourneeAsync(AppareilEntite a, int salarie, string jeton, DateOnly jour, CancellationToken ct)
    {
        var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).FirstOrDefault() ?? throw ExceptionMetier.Introuvable($"Salarié {salarie}");
        var lundi = ReglesPointage.LundiDe(jour);
        var semaine = await db.Pointages.AsNoTracking().Where(p => p.PoiSalId == salarie && p.PoiCouche == Couches.Saisie && p.PoiDate >= lundi && p.PoiDate <= lundi.AddDays(6))
            .OrderBy(p => p.PoiId).ToListAsync(ct);
        var pointages = semaine.Where(p => p.PoiDate == jour).ToList();
        var recents = await db.Pointages.AsNoTracking().Where(p => p.PoiSalId == salarie && p.PoiDate >= jour.AddDays(-21))
            .GroupBy(p => p.PoiChaId).OrderByDescending(g => g.Max(p => p.PoiDate)).Select(g => g.Key).Take(6).ToListAsync(ct);
        var proposes = await specialisation.ChantiersDuJourAsync(db, salarie, jour, ct);
        var ids = recents.Concat(proposes).Concat(pointages.Select(p => p.PoiChaId)).Distinct().ToList();
        var chantiers = await specialisation.ChantiersAsync(db, null, ids, ct);
        var p0 = await pointage.ParametresAsync(ct);
        var etat = (await pointage.EtatsAsync([salarie], lundi, p0.Validation, ct))[salarie][jour.DayNumber - lundi.DayNumber];
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        return new
        {
            jeton, salarie = s, date = jour, aujourdhui, premier_jour = aujourdhui.AddDays(-JoursRattrapage), etat, bloque = ReglesValidation.EstBloque(etat),
            total_jour = pointages.Sum(p => p.PoiMinutes), total_semaine = semaine.Sum(p => p.PoiMinutes),
            pointages = pointages.Select(p => new
            {
                id = p.PoiId, cha_id = p.PoiChaId, ent_id = p.PoiEntId, type_mo = p.PoiTypeMo, sous_type = p.PoiSousType, minutes = p.PoiMinutes, motif = p.PoiMotif,
                commentaire = p.PoiCommentaire, groupe = p.PoiGroupe,
            }),
            chantiers = chantiers.OrderBy(c => proposes.Contains(c.Id) ? 0 : recents.Contains(c.Id) ? 1 : 2), proposes,
            ordres = await specialisation.OrdresAsync(db, ids, ct),
            // Repas au restaurant du jour (lot 10, A29).
            repas = (await services.GetRequiredService<ServiceRepas>().LireAsync(salarie, jour, jour, ct)).FirstOrDefault(),
        };
    }

    /// <summary>Journée du salarié identifié à une autre date (oubli de saisie : jours passés de la fenêtre de rattrapage).</summary>
    public async Task<object> JourneeAsync(HttpContext http, JourneeBorne j, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        var salarie = Identifie(a, j.Jeton);
        ControlerDate(j.Date);
        return await JourneeAsync(a, salarie, j.Jeton, j.Date, ct);
    }

    /// <summary>
    /// Enregistre la journée du salarié identifié : les pointages saisis du jour sont remplacés par la liste (ajouts,
    /// modifications, retraits ; les autres jours de la semaine sont inchangés) ; mêmes contrôles et blocages que la
    /// saisie au bureau (jour validé refusé) ; types de MO de la borne pour les lignes nouvelles ou modifiées ; un motif
    /// de non-conformité nouveau avertit l'application. Essai : contrôlé puis annulé.
    /// </summary>
    public async Task<object> EnregistrerJourneeAsync(HttpContext http, JourneeSaisie j, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        var salarie = Identifie(a, j.Jeton);
        ControlerDate(j.Date);
        var lundi = ReglesPointage.LundiDe(j.Date);
        var semaine = await db.Pointages.AsNoTracking().Where(x => x.PoiSalId == salarie && x.PoiCouche == Couches.Saisie && x.PoiDate >= lundi && x.PoiDate <= lundi.AddDays(6)).ToListAsync(ct);
        var avant = semaine.Where(x => x.PoiDate == j.Date).ToDictionary(x => x.PoiId);
        if (j.Pointages.Any(l => l.Id is long id && !avant.ContainsKey(id))) throw ExceptionMetier.Conflit("POI_MODIFIE", "Pointage introuvable dans la journée : recommencer");
        bool Modifiee(LigneBorne l) => l.Id is not long id || avant[id] is var e && (e.PoiChaId != l.ChaId || e.PoiEntId != l.EntId || e.PoiTypeMo != l.TypeMo
            || e.PoiSousType != l.SousType || e.PoiMinutes != l.Minutes);
        if (a.PapTypesMo is { Length: > 0 } && j.Pointages.Any(l => Modifiee(l) && !a.PapTypesMo.Contains(l.TypeMo)))
            throw ExceptionMetier.Invalide("BORNE_TYPE_MO", "Type de main-d'œuvre non proposé par cette borne");
        // Heures de début et de fin d'une ligne inchangée conservées (saisie au bureau).
        var saisie = semaine.Where(x => x.PoiDate != j.Date)
            .Select(x => new PointageSaisi(x.PoiId, x.PoiDate, x.PoiChaId, x.PoiEntId, x.PoiTypeMo, x.PoiSousType, x.PoiMinutes, x.PoiDebut, x.PoiFin, x.PoiMotif, x.PoiCommentaire))
            .Concat(j.Pointages.Select(l => new PointageSaisi(l.Id, j.Date, l.ChaId, l.EntId, l.TypeMo, l.SousType, l.Minutes,
                Modifiee(l) ? null : avant[l.Id!.Value].PoiDebut, Modifiee(l) ? null : avant[l.Id!.Value].PoiFin, l.Motif, l.Commentaire))).ToList();
        var auteur = Auteur(a);
        var essai = EnTest(http);
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await pointage.EnregistrerSemaineAsync(salarie, lundi, new SemaineSaisie(saisie), auteur, ct, controleAcces: false);
            var connus = avant.Keys.ToHashSet();
            foreach (var n in await db.Pointages.Where(x => x.PoiSalId == salarie && x.PoiCouche == Couches.Saisie && x.PoiDate == j.Date && !connus.Contains(x.PoiId)).ToListAsync(ct))
                n.PoiAppareil = a.PapLibelle;
            await db.SaveChangesAsync(ct);
            if (essai) await tx.RollbackAsync(ct);
            else await tx.CommitAsync(ct);
        }
        if (essai) db.ChangeTracker.Clear();
        else
        {
            var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).First();
            foreach (var l in j.Pointages.Where(l => !string.IsNullOrWhiteSpace(l.Motif) && (l.Id is not long id || avant[id].PoiMotif != l.Motif.Trim())))
                await specialisation.ApresNonConformiteAsync(db, services, auteur, s, l.ChaId, l.EntId, l.Motif!.Trim(), ct);
        }
        return await JourneeAsync(a, salarie, j.Jeton, j.Date, ct);
    }

    /// <summary>
    /// Choix du chantier, bouton « Tous » (lot 10, A30) : tous les chantiers pointables (code, libellé, ville, client) et
    /// les ordres en cours de ces chantiers, pour le salarié identifié ; le filtre se fait dans le navigateur.
    /// </summary>
    public async Task<object> TousChantiersAsync(HttpContext http, string jeton, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        Identifie(a, jeton);
        var chantiers = await specialisation.TousChantiersAsync(db, ct);
        return new { chantiers, ordres = await specialisation.OrdresAsync(db, chantiers.Select(c => c.Id).ToList(), ct) };
    }

    /// <summary>Restaurants proposés à la borne (lot 10, A29) : les plus proches du chantier d'abord.</summary>
    public async Task<List<RestaurantPointage>> RestaurantsAsync(HttpContext http, string jeton, int? chantier, string? recherche, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        Identifie(a, jeton);
        return await specialisation.RestaurantsAsync(db, chantier, recherche, ct);
    }

    /// <summary>Repas du jour du salarié identifié (date de la fenêtre de rattrapage) ; essai : contrôlé, rien d'écrit.</summary>
    public async Task<object> RepasAsync(HttpContext http, RepasBorne r, CancellationToken ct)
    {
        var a = await AppareilAsync(http, ct);
        var salarie = Identifie(a, r.Jeton);
        ControlerDate(r.Repas.Date);
        if (r.Membres is { Count: > 0 }) return await RepasEquipeAsync(http, a, salarie, r, ct);
        var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).First();
        var repas = services.GetRequiredService<ServiceRepas>();
        if (!EnTest(http)) return await repas.EnregistrerAsync(s, r.Repas, Auteur(a), a.PapLibelle, ct);
        // Essai : un restaurant « non trouvé » serait créé par l'application hors de cette transaction : rien n'est fait.
        if (!string.IsNullOrWhiteSpace(r.Repas.Nouveau)) return await repas.LireAsync(s.Id, r.Repas.Date, r.Repas.Date, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var res = await repas.EnregistrerAsync(s, r.Repas, Auteur(a), a.PapLibelle, ct);
        await tx.RollbackAsync(ct);
        db.ChangeTracker.Clear();
        return res;
    }

    /// <summary>
    /// Repas déclaré par le chef pour plusieurs salariés (équipe de la borne) : chacun contrôlé seul (hors équipe, déjà
    /// déclaré ce jour, jour validé : refus pour lui seul), les autres enregistrés. Essai : contrôlé, rien d'écrit.
    /// </summary>
    private async Task<RepasEquipeResultat> RepasEquipeAsync(HttpContext http, AppareilEntite a, int chef, RepasBorne r, CancellationToken ct)
    {
        var saisi = r.Repas;
        if (saisi.RestaurantId is null && string.IsNullOrWhiteSpace(saisi.Nouveau))
            throw ExceptionMetier.Invalide("REPAS_RESTAURANT", "Restaurant à préciser pour un repas d'équipe");
        var membres = r.Membres!.Distinct().ToList();
        var equipe = (await SalariesBorneAsync(a, ct)).Select(x => x.Id).Append(chef).ToHashSet();
        var deja = (await db.Repas.AsNoTracking().Where(x => x.PrpDate == saisi.Date && membres.Contains(x.PrpSalId)).Select(x => x.PrpSalId).ToListAsync(ct)).ToHashSet();
        var rep = ReglesRepas.Repartir(membres, equipe, deja);
        var service = services.GetRequiredService<ServiceRepas>();
        var auteur = Auteur(a);
        var enregistres = new List<int>();
        var refus = new List<RefusRepas>(rep.Refus);
        var tx = EnTest(http) ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            // Un restaurant « non trouvé » est créé une seule fois pour toute l'équipe (pas en essai : hors transaction).
            if (!string.IsNullOrWhiteSpace(saisi.Nouveau) && rep.Acceptes.Count > 0 && tx is null)
            {
                var nouveau = await specialisation.CreerRestaurantAsync(db, saisi.Nouveau.Trim(), string.IsNullOrWhiteSpace(saisi.Ville) ? null : saisi.Ville.Trim(), auteur, ct);
                saisi = saisi with { RestaurantId = nouveau.Id, Nouveau = null, Ville = null };
            }
            else if (tx is not null && !string.IsNullOrWhiteSpace(saisi.Nouveau)) saisi = saisi with { RestaurantId = null, Nouveau = null, Ville = null };
            foreach (var m in rep.Acceptes)
            {
                if (saisi.RestaurantId is null) { enregistres.Add(m); continue; }
                var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [m]), ct)).FirstOrDefault();
                if (s is null) { refus.Add(new RefusRepas(m, ErreursPointage.RepasHorsEquipe)); continue; }
                try { await service.EnregistrerAsync(s, saisi, auteur, a.PapLibelle, ct); enregistres.Add(m); }
                catch (ExceptionMetier e) { db.ChangeTracker.Clear(); refus.Add(new RefusRepas(m, e.Code)); }
            }
        }
        finally
        {
            if (tx is not null) { await tx.RollbackAsync(ct); await tx.DisposeAsync(); db.ChangeTracker.Clear(); }
        }
        return new RepasEquipeResultat(enregistres, refus, await service.LireAsync(chef, saisi.Date, saisi.Date, ct));
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
        var salarie = Identifie(a, p.Jeton);
        ControlerDate(p.Date);
        if (a.PapTypesMo is { Length: > 0 } && !a.PapTypesMo.Contains(p.TypeMo))
            throw ExceptionMetier.Invalide("BORNE_TYPE_MO", "Type de main-d'œuvre non proposé par cette borne");
        var membres = (p.Membres is { Count: > 0 } ? p.Membres : [salarie]).Distinct().ToList();
        var groupe = membres.Count > 1 ? Guid.NewGuid() : (Guid?)null;
        var auteur = Auteur(a);
        if (EnTest(http))
        {
            // Essai : mêmes contrôles et blocages, puis annulation (rien n'est enregistré, pas de tâche de non-conformité).
            await using (var tx = await db.Database.BeginTransactionAsync(ct))
            {
                foreach (var m in membres) await AjouterAsync(m, p.Date, new PointageSaisi(null, p.Date, p.ChaId, p.EntId, p.TypeMo, p.SousType, p.Minutes, null, null, p.Motif, p.Commentaire), groupe, a, auteur, ct);
                await tx.RollbackAsync(ct);
            }
            db.ChangeTracker.Clear();
            return await JourneeAsync(a, salarie, p.Jeton, p.Date, ct);
        }
        foreach (var m in membres) await AjouterAsync(m, p.Date, new PointageSaisi(null, p.Date, p.ChaId, p.EntId, p.TypeMo, p.SousType, p.Minutes, null, null, p.Motif, p.Commentaire), groupe, a, auteur, ct);
        if (!string.IsNullOrWhiteSpace(p.Motif))
        {
            var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).First();
            await specialisation.ApresNonConformiteAsync(db, services, auteur, s, p.ChaId, p.EntId, p.Motif.Trim(), ct);
        }
        return await JourneeAsync(a, salarie, p.Jeton, p.Date, ct);
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
