using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Pointage.Web;

public class ParametreEntite
{
    public short PpaId { get; set; } = 1;
    public string PpaOrdreNom { get; set; } = "NP";
    public short PpaPasMinutes { get; set; } = 15;
    public short PpaAmplitudeJour { get; set; } = 600;
    public short PpaAmplitudeSemaine { get; set; } = 2880;
    public string PpaValidation { get; set; } = "SIMPLE";
    public string PpaBlocage { get; set; } = "SEMAINE";
    public bool PpaInterimImputes { get; set; }
    public short PpaSeuilSemaine { get; set; } = 2100;
    public string? PpaMajPar { get; set; }
    public DateTimeOffset PpaMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class SousTypeEntite
{
    public string PstCode { get; set; } = "";
    public string PstLibelle { get; set; } = "";
    public bool PstProductif { get; set; } = true;
    public bool PstNonConformite { get; set; }
    public int PstOrdre { get; set; }
    public bool PstActif { get; set; } = true;
}

public class PointageEntite
{
    public long PoiId { get; set; }
    public string PoiCouche { get; set; } = Couches.Saisie;
    public long? PoiOrigineId { get; set; }
    public int PoiSalId { get; set; }
    public DateOnly PoiDate { get; set; }
    public int PoiChaId { get; set; }
    public long? PoiEntId { get; set; }
    public long? PoiLigId { get; set; }
    public int PoiTypeMo { get; set; }
    public string? PoiSousType { get; set; }
    public short? PoiDebut { get; set; }
    public short? PoiFin { get; set; }
    public short PoiMinutes { get; set; }
    public string? PoiMotif { get; set; }
    public string? PoiCommentaire { get; set; }
    public Guid? PoiGroupe { get; set; }
    public long? PoiTacId { get; set; }
    public string PoiSaisiPar { get; set; } = "";
    public DateTimeOffset PoiSaisiLe { get; set; } = DateTimeOffset.UtcNow;
    public string? PoiAppareil { get; set; }
    public int PoiVersion { get; set; } = 1;
    public decimal? PoiTaux { get; set; }
    public decimal? PoiCout { get; set; }
    public string? PoiValorisation { get; set; }
    public DateTimeOffset? PoiValoriseLe { get; set; }
}

public class SemaineEntite
{
    public int PsmSalId { get; set; }
    public DateOnly PsmLundi { get; set; }
    public string PsmCorrigePar { get; set; } = "";
    public DateTimeOffset PsmCorrigeLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ValidationEntite
{
    public long PvlId { get; set; }
    public int PvlSalId { get; set; }
    public DateOnly PvlDu { get; set; }
    public DateOnly PvlAu { get; set; }
    public string PvlNiveau { get; set; } = "RH";
    public string PvlPar { get; set; } = "";
    public DateTimeOffset PvlLe { get; set; } = DateTimeOffset.UtcNow;
    public string? PvlAnnulePar { get; set; }
    public DateTimeOffset? PvlAnnuleLe { get; set; }
    public string? PvlAnnuleMotif { get; set; }
}

public class CorrectionEntite
{
    public long PcoId { get; set; }
    public int PcoSalId { get; set; }
    public DateOnly PcoLundi { get; set; }
    public string PcoPointages { get; set; } = "[]";
    public string? PcoMotif { get; set; }
    public string PcoPar { get; set; } = "";
    public DateTimeOffset PcoLe { get; set; } = DateTimeOffset.UtcNow;
    public string PcoEtat { get; set; } = "EN_ATTENTE";
    public string? PcoTraitePar { get; set; }
    public DateTimeOffset? PcoTraiteLe { get; set; }
    public string? PcoReponse { get; set; }
}

public class JournalEntite
{
    public long PjoId { get; set; }
    public int PjoSalId { get; set; }
    public DateOnly PjoLundi { get; set; }
    public string PjoAction { get; set; } = "";
    public string PjoDetail { get; set; } = "{}";
    public string PjoPar { get; set; } = "";
    public DateTimeOffset PjoLe { get; set; } = DateTimeOffset.UtcNow;
}

public static class Couches
{
    public const string Saisie = "SAISIE";
    public const string Valide = "VALIDE";
}

public class PointageDbContext(DbContextOptions<PointageDbContext> options) : DbContext(options)
{
    public DbSet<ParametreEntite> Parametres => Set<ParametreEntite>();
    public DbSet<SousTypeEntite> SousTypes => Set<SousTypeEntite>();
    public DbSet<PointageEntite> Pointages => Set<PointageEntite>();
    public DbSet<SemaineEntite> Semaines => Set<SemaineEntite>();
    public DbSet<ValidationEntite> Validations => Set<ValidationEntite>();
    public DbSet<CorrectionEntite> Corrections => Set<CorrectionEntite>();
    public DbSet<JournalEntite> Journal => Set<JournalEntite>();
    public DbSet<ProfilEntite> Profils => Set<ProfilEntite>();
    public DbSet<RubriqueEntite> Rubriques => Set<RubriqueEntite>();
    public DbSet<RegleEntite> Regles => Set<RegleEntite>();
    public DbSet<ValeurEntite> Valeurs => Set<ValeurEntite>();
    public DbSet<ZoneEntite> Zones => Set<ZoneEntite>();
    public DbSet<ExportEntite> Exports => Set<ExportEntite>();
    public DbSet<AppareilEntite> Appareils => Set<AppareilEntite>();
    public DbSet<PinEntite> Pins => Set<PinEntite>();
    public DbSet<NatureAbsenceEntite> NaturesAbsence => Set<NatureAbsenceEntite>();
    public DbSet<CongeEntite> Conges => Set<CongeEntite>();
    public DbSet<RepasEntite> Repas => Set<RepasEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ParametreEntite>().ToTable("poi_parametre").HasKey(x => x.PpaId);
        b.Entity<SousTypeEntite>().ToTable("poi_sous_type").HasKey(x => x.PstCode);
        b.Entity<PointageEntite>().ToTable("poi_pointage").HasKey(x => x.PoiId);
        b.Entity<SemaineEntite>().ToTable("poi_semaine").HasKey(x => new { x.PsmSalId, x.PsmLundi });
        b.Entity<ValidationEntite>().ToTable("poi_validation").HasKey(x => x.PvlId);
        b.Entity<CorrectionEntite>().ToTable("poi_correction").HasKey(x => x.PcoId);
        b.Entity<CorrectionEntite>().Property(x => x.PcoPointages).HasColumnType("jsonb");
        b.Entity<JournalEntite>().ToTable("poi_journal").HasKey(x => x.PjoId);
        b.Entity<JournalEntite>().Property(x => x.PjoDetail).HasColumnType("jsonb");
        b.Entity<ProfilEntite>().ToTable("poi_profil_paie").HasKey(x => x.PpfId);
        b.Entity<RubriqueEntite>().ToTable("poi_rubrique").HasKey(x => x.RubId);
        b.Entity<RegleEntite>().ToTable("poi_regle").HasKey(x => x.PrgId);
        b.Entity<RegleEntite>().Property(x => x.PrgParametres).HasColumnType("jsonb");
        b.Entity<ValeurEntite>().ToTable("poi_valeur").HasKey(x => new { x.PvaSalId, x.PvaDate, x.PvaRubrique });
        b.Entity<ZoneEntite>().ToTable("poi_zone_chantier").HasKey(x => new { x.PzcChaId, x.PzcAgence });
        b.Entity<ExportEntite>().ToTable("poi_export").HasKey(x => x.PexId);
        b.Entity<AppareilEntite>().ToTable("poi_appareil").HasKey(x => x.PapId);
        b.Entity<PinEntite>().ToTable("poi_pin").HasKey(x => x.PpnSalId);
        b.Entity<NatureAbsenceEntite>().ToTable("poi_nature_absence").HasKey(x => x.PnaCode);
        b.Entity<CongeEntite>().ToTable("poi_conge").HasKey(x => x.PcoId);
        b.Entity<RepasEntite>().ToTable("poi_repas").HasKey(x => x.PrpId);
    }
}

public sealed record ParametresDto(string OrdreNom, int PasMinutes, int AmplitudeJour, int AmplitudeSemaine, string Validation, string Blocage, bool InterimImputes,
    int SeuilSemaine = 2100);
public sealed record SousTypeDto(string Code, string Libelle, bool Productif, bool NonConformite, int Ordre, bool Actif);

/// <summary>Salarié (ou intérimaire) pointable, fourni par l'application.</summary>
public sealed record SalariePointage(int Id, string Matricule, string Nom, string Prenom, int? SrvId, string? Service, bool Interimaire,
    int? PpfId = null, string? Agence = null, string? Code = null, string? MatriculePaie = null, string? Fonction = null);
/// <summary>Chantier (ou chantier interne) pointable ; ville et client : filtre du choix de la borne.</summary>
public sealed record ChantierPointage(int Id, string Code, string Libelle, bool Clos, bool Interne, string? Ville = null, string? Client = null);
/// <summary>Type de main-d'œuvre (nature du regroupement main-d'œuvre) et son service.</summary>
public sealed record TypeMoPointage(int Id, string Code, string Libelle, int? SrvId);
/// <summary>Ordre d'exécution d'un chantier sur lequel pointer (module Exécution actif).</summary>
/// <summary>Ordre proposé à la saisie : chantier, numéro, objet, type, service (type de MO proposé par la cascade).</summary>
public sealed record OrdrePointage(long Id, int ChaId, string? Numero, string? Objet, string? Type, int? SrvId);
public sealed record ServicePointageDto(int Id, string Code, string Libelle, int? ParentId);
public sealed record MotifPointage(string Code, string Libelle);
public sealed record EquipePointage(int Id, string Libelle, int[] Membres);
/// <summary>
/// Filtre des salariés : service (et ses sous-services), recherche, identifiants ; bornes : plusieurs services et
/// fonctions (poste du salarié) — vide ou nul : tous.
/// </summary>
public sealed record FiltreSalaries(int? Service, string? Recherche, IReadOnlyCollection<int>? Ids = null, int Taille = 200,
    IReadOnlyCollection<int>? Services = null, IReadOnlyCollection<string>? Fonctions = null);

/// <summary>Pointage saisi dans la grille d'une semaine (identifiant absent : nouveau).</summary>
public sealed record PointageSaisi(long? Id, DateOnly Date, int? ChaId, long? EntId, int? TypeMo, string? SousType, int Minutes,
    int? Debut, int? Fin, string? Motif, string? Commentaire, long? OrigineId = null);
public sealed record SemaineSaisie(List<PointageSaisi> Pointages);

/// <summary>
/// Spécialisation par l'application (méthode patron) : salariés, chantiers (internes compris), types de main-d'œuvre,
/// ordres, services et droit de saisie pour un salarié.
/// </summary>
public abstract class SpecialisationPointage
{
    public abstract Task<List<SalariePointage>> SalariesAsync(PointageDbContext db, FiltreSalaries f, CancellationToken ct);
    public abstract Task<List<ChantierPointage>> ChantiersAsync(PointageDbContext db, string? recherche, IReadOnlyCollection<int>? ids, CancellationToken ct);
    public abstract Task<List<TypeMoPointage>> TypesMoAsync(PointageDbContext db, CancellationToken ct);
    public abstract Task<List<ServicePointageDto>> ServicesAsync(PointageDbContext db, CancellationToken ct);
    public virtual Task<List<OrdrePointage>> OrdresAsync(PointageDbContext db, IReadOnlyCollection<int> chantiers, CancellationToken ct) => Task.FromResult(new List<OrdrePointage>());
    /// <summary>Vrai si l'utilisateur peut saisir ou consulter les pointages du salarié.</summary>
    public abstract Task<bool> PeutSaisirAsync(PointageDbContext db, Utilisateur u, int salarie, CancellationToken ct);
    /// <summary>Vrai si l'utilisateur est du service RH (valide au niveau RH, toute la société).</summary>
    public abstract Task<bool> EstRhAsync(PointageDbContext db, Utilisateur u, CancellationToken ct);
    /// <summary>Salariés (parmi ceux donnés) dont l'utilisateur est le chef de service.</summary>
    public abstract Task<HashSet<int>> ChefDeAsync(PointageDbContext db, Utilisateur u, IReadOnlyCollection<int> salaries, CancellationToken ct);
    /// <summary>Jours travaillés d'une semaine par salarié (par défaut : du lundi au vendredi).</summary>
    public virtual Task<Dictionary<int, List<DateOnly>>> JoursTravaillesAsync(PointageDbContext db, IReadOnlyCollection<int> salaries, DateOnly lundi, CancellationToken ct) =>
        Task.FromResult(salaries.ToDictionary(s => s, _ => Enumerable.Range(0, 5).Select(i => lundi.AddDays(i)).ToList()));
    /// <summary>
    /// Taux horaires des salariés pour la valorisation (lot 3) : taux et source (SALARIE, INTERIM…) ; un salarié absent
    /// n'est pas valorisé.
    /// </summary>
    public abstract Task<Dictionary<int, (decimal Taux, string Source)>> TauxAsync(PointageDbContext db, IReadOnlyCollection<int> salaries, DateOnly du, DateOnly au, CancellationToken ct);
    /// <summary>Motifs d'un domaine (non-conformités de la borne) : code, libellé.</summary>
    public abstract Task<List<MotifPointage>> MotifsAsync(PointageDbContext db, string domaine, CancellationToken ct);
    /// <summary>Équipes d'un service (toutes si null) et leurs membres (salariés) à une date : saisie d'équipe.</summary>
    public abstract Task<List<EquipePointage>> EquipesAsync(PointageDbContext db, int? service, DateOnly date, CancellationToken ct);
    /// <summary>Fonctions des salariés actifs (filtre des bornes ; défaut : aucune).</summary>
    public virtual Task<List<string>> FonctionsAsync(PointageDbContext db, CancellationToken ct) => Task.FromResult(new List<string>());
    /// <summary>Ordre désigné par son numéro (QR code de l'ordre).</summary>
    public virtual Task<OrdrePointage?> OrdreParNumeroAsync(PointageDbContext db, string numero, CancellationToken ct) => Task.FromResult<OrdrePointage?>(null);
    /// <summary>
    /// Restaurants proposés pour un repas (lot 10, A29) : les plus proches du chantier d'abord (distance si connue),
    /// filtrés par une recherche, ou ceux des identifiants donnés ; défaut : aucun.
    /// </summary>
    public virtual Task<List<RestaurantPointage>> RestaurantsAsync(PointageDbContext db, int? chantier, string? recherche, CancellationToken ct,
        IReadOnlyCollection<long>? ids = null) => Task.FromResult(new List<RestaurantPointage>());
    /// <summary>Restaurant « non trouvé » saisi par son nom (et sa ville) : créé par l'application (tiers provisoire).</summary>
    public virtual Task<RestaurantPointage> CreerRestaurantAsync(PointageDbContext db, string nom, string? ville, Utilisateur auteur, CancellationToken ct) =>
        throw ExceptionMetier.Invalide("POI_RESTAURANT", "Création de restaurant non prise en charge");
    /// <summary>Tous les chantiers pointables (ouverts et internes), sans limite de nombre : bouton « Tous » de la borne.</summary>
    public virtual Task<List<ChantierPointage>> TousChantiersAsync(PointageDbContext db, CancellationToken ct) => ChantiersAsync(db, null, null, ct);
    /// <summary>Chantiers proposés pour la journée d'un salarié (tâches du planning, par exemple).</summary>
    public virtual Task<List<int>> ChantiersDuJourAsync(PointageDbContext db, int salarie, DateOnly date, CancellationToken ct) => Task.FromResult(new List<int>());
    /// <summary>Après un pointage de non-conformité à la borne (note au service concerné, par exemple).</summary>
    public virtual Task ApresNonConformiteAsync(PointageDbContext db, IServiceProvider services, Utilisateur auteur, SalariePointage salarie, int chantier, long? ordre,
        string motif, CancellationToken ct) => Task.CompletedTask;
    /// <summary>Après une demande de correction (tâche au service RH, par exemple).</summary>
    public virtual Task ApresCorrectionAsync(PointageDbContext db, IServiceProvider services, Utilisateur u, SalariePointage salarie, CorrectionEntite c, CancellationToken ct) =>
        Task.CompletedTask;
    /// <summary>Salarié de l'utilisateur connecté (ses propres demandes de congés), s'il en a un.</summary>
    public virtual Task<int?> SalarieDeAsync(PointageDbContext db, Utilisateur u, CancellationToken ct) => Task.FromResult<int?>(null);
    /// <summary>
    /// Après une demande, une modification ou un traitement de congé (DEMANDER, MODIFIER, VALIDER, REFUSER, ANNULER) :
    /// absence dans le planning, tâche au service RH… ; le congé est suivi par le contexte (<c>PcoTacId</c>).
    /// </summary>
    public virtual Task ApresCongeAsync(PointageDbContext db, IServiceProvider services, Utilisateur u, SalariePointage salarie, CongeEntite c, string action,
        CancellationToken ct) => Task.CompletedTask;
}

/// <summary>
/// Paramètres, sous-types, saisie au bureau (semaine d'un salarié : contrôles <see cref="ReglesPointage"/>, couche
/// SAISIE) et totaux des salariés d'un service.
/// </summary>
public sealed class ServicePointage(PointageDbContext db, SpecialisationPointage specialisation)
{
    private static void Admin(Utilisateur u)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
    }

    public async Task<ParametresDto> ParametresAsync(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().FirstOrDefaultAsync(ct) ?? new ParametreEntite();
        return new(p.PpaOrdreNom, p.PpaPasMinutes, p.PpaAmplitudeJour, p.PpaAmplitudeSemaine, p.PpaValidation, p.PpaBlocage, p.PpaInterimImputes, p.PpaSeuilSemaine);
    }

    public async Task<ParametresDto> EnregistrerParametresAsync(ParametresDto s, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        if (s.OrdreNom is not ("NP" or "PN") || s.Validation is not ("SIMPLE" or "DOUBLE") || s.Blocage is not ("JOUR" or "SEMAINE")
            || s.PasMinutes is < 0 or > 60 || s.AmplitudeJour is < 0 or > 1440 || s.AmplitudeSemaine is < 0 or > 10080 || s.SeuilSemaine is < 0 or > 10080)
            throw ExceptionMetier.Invalide("POI_PARAMETRES", "Paramètres du pointage invalides");
        var p = await db.Parametres.FirstOrDefaultAsync(ct);
        if (p is null) db.Parametres.Add(p = new ParametreEntite());
        p.PpaOrdreNom = s.OrdreNom;
        p.PpaPasMinutes = (short)s.PasMinutes;
        p.PpaAmplitudeJour = (short)s.AmplitudeJour;
        p.PpaAmplitudeSemaine = (short)s.AmplitudeSemaine;
        p.PpaValidation = s.Validation;
        p.PpaBlocage = s.Blocage;
        p.PpaInterimImputes = s.InterimImputes;
        p.PpaSeuilSemaine = (short)s.SeuilSemaine;
        p.PpaMajPar = u.Code;
        p.PpaMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ParametresAsync(ct);
    }

    public async Task<List<SousTypeDto>> SousTypesAsync(CancellationToken ct) =>
        (await db.SousTypes.AsNoTracking().OrderBy(s => s.PstOrdre).ThenBy(s => s.PstCode).ToListAsync(ct))
        .Select(s => new SousTypeDto(s.PstCode, s.PstLibelle, s.PstProductif, s.PstNonConformite, s.PstOrdre, s.PstActif)).ToList();

    /// <summary>Remplace la liste ; un sous-type retiré et utilisé passe inactif, sinon il est supprimé.</summary>
    public async Task<List<SousTypeDto>> EnregistrerSousTypesAsync(List<SousTypeDto> l, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        if (l.Any(s => string.IsNullOrWhiteSpace(s.Code) || string.IsNullOrWhiteSpace(s.Libelle)))
            throw ExceptionMetier.Invalide("POI_SOUS_TYPE", "Code et libellé obligatoires");
        var codes = l.Select(s => s.Code.Trim().ToUpperInvariant()).ToList();
        if (codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("POI_SOUS_TYPE", "Codes en double");
        var existants = await db.SousTypes.ToListAsync(ct);
        foreach (var s in l)
        {
            var code = s.Code.Trim().ToUpperInvariant();
            var e = existants.FirstOrDefault(x => x.PstCode == code);
            if (e is null) db.SousTypes.Add(e = new SousTypeEntite { PstCode = code });
            e.PstLibelle = s.Libelle.Trim();
            e.PstProductif = s.Productif;
            e.PstNonConformite = s.NonConformite;
            e.PstOrdre = s.Ordre;
            e.PstActif = s.Actif;
        }
        foreach (var e in existants.Where(x => !codes.Contains(x.PstCode)))
        {
            if (await db.Pointages.AnyAsync(p => p.PoiSousType == e.PstCode, ct)) e.PstActif = false;
            else db.SousTypes.Remove(e);
        }
        await db.SaveChangesAsync(ct);
        return await SousTypesAsync(ct);
    }

    /// <summary>Référentiels de la saisie : paramètres, types de MO, sous-types actifs, services.</summary>
    public async Task<object> ReferentielsAsync(CancellationToken ct) => new
    {
        parametres = await ParametresAsync(ct),
        types_mo = await specialisation.TypesMoAsync(db, ct),
        sous_types = (await SousTypesAsync(ct)).Where(s => s.Actif).ToList(),
        services = await specialisation.ServicesAsync(db, ct),
        fonctions = await specialisation.FonctionsAsync(db, ct),
    };

    /// <summary>Ordres en cours d'un chantier (saisie en cascade : chantier choisi → ses ordres).</summary>
    public Task<List<OrdrePointage>> OrdresChantierAsync(int chantier, CancellationToken ct) => specialisation.OrdresAsync(db, [chantier], ct);
    public Task<List<ChantierPointage>> ChantiersAsync(string? recherche, CancellationToken ct) => specialisation.ChantiersAsync(db, recherche, null, ct);

    /// <summary>
    /// Salariés d'un service (ou d'une recherche) avec leurs minutes saisies par jour de la semaine (couche validée si
    /// elle existe, sinon saisie).
    /// </summary>
    public async Task<object> SalariesAsync(int? service, string? recherche, DateOnly lundi, CancellationToken ct)
    {
        var salaries = await specialisation.SalariesAsync(db, new FiltreSalaries(service, recherche), ct);
        var ids = salaries.Select(s => s.Id).ToList();
        var dimanche = lundi.AddDays(6);
        var retenus = await Retenus(ids, lundi).Select(p => new { p.PoiSalId, p.PoiDate, p.PoiMinutes }).ToListAsync(ct);
        return salaries.Select(s => new
        {
            salarie = s,
            jours = Enumerable.Range(0, 7).Select(i => retenus.Where(p => p.PoiSalId == s.Id && p.PoiDate == lundi.AddDays(i)).Sum(p => p.PoiMinutes)).ToList(),
        }).ToList();
    }

    /// <summary>Pointages retenus d'une semaine : couche validée des semaines corrigées, couche saisie des autres.</summary>
    internal IQueryable<PointageEntite> Retenus(IReadOnlyCollection<int> salaries, DateOnly lundi)
    {
        var dimanche = lundi.AddDays(6);
        var corrigees = db.Semaines.Where(x => x.PsmLundi == lundi).Select(x => x.PsmSalId);
        return db.Pointages.AsNoTracking().Where(p => salaries.Contains(p.PoiSalId) && p.PoiDate >= lundi && p.PoiDate <= dimanche
            && (corrigees.Contains(p.PoiSalId) ? p.PoiCouche == Couches.Valide : p.PoiCouche == Couches.Saisie));
    }

    /// <summary>États de validation des sept jours d'une semaine pour des salariés.</summary>
    internal async Task<Dictionary<int, List<string>>> EtatsAsync(IReadOnlyCollection<int> salaries, DateOnly lundi, string mode, CancellationToken ct)
    {
        var dimanche = lundi.AddDays(6);
        var v = await db.Validations.AsNoTracking().Where(x => salaries.Contains(x.PvlSalId) && x.PvlDu <= dimanche && x.PvlAu >= lundi && x.PvlAnnuleLe == null).ToListAsync(ct);
        return salaries.ToDictionary(s => s, s =>
        {
            var periodes = v.Where(x => x.PvlSalId == s).Select(x => new ValidationPeriode(x.PvlNiveau, x.PvlDu.ToString("yyyy-MM-dd"), x.PvlAu.ToString("yyyy-MM-dd"))).ToList();
            return Enumerable.Range(0, 7).Select(i => ReglesValidation.Etat(mode, lundi.AddDays(i).ToString("yyyy-MM-dd"), periodes)).ToList();
        });
    }

    internal async Task<SalariePointage> SalarieAsync(int salarie, Utilisateur u, CancellationToken ct)
    {
        var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).FirstOrDefault()
            ?? throw ExceptionMetier.Introuvable($"Salarié {salarie}");
        if (!u.EstAdmin && !await specialisation.PeutSaisirAsync(db, u, salarie, ct)) throw ExceptionMetier.AccesRefuse("POINTER");
        return s;
    }

    private static PointageControle Controle(PointageEntite p, IReadOnlyDictionary<int, ChantierPointage> chantiers, IReadOnlyDictionary<string, SousTypeEntite> st) =>
        new(p.PoiId.ToString(), p.PoiDate.ToString("yyyy-MM-dd"), p.PoiChaId, p.PoiTypeMo.ToString(), p.PoiMinutes, p.PoiDebut, p.PoiFin,
            p.PoiSousType is not null && st.TryGetValue(p.PoiSousType, out var s) && s.PstNonConformite, p.PoiMotif,
            chantiers.TryGetValue(p.PoiChaId, out var c) && c.Clos);

    /// <summary>Salarié et lundi de la semaine d'un pointage (ouverture depuis la liste).</summary>
    public async Task<object> PositionAsync(long id, CancellationToken ct)
    {
        var p = await db.Pointages.AsNoTracking().FirstOrDefaultAsync(x => x.PoiId == id, ct) ?? throw ExceptionMetier.Introuvable($"Pointage {id}");
        return new { salarie = p.PoiSalId, lundi = ReglesPointage.LundiDe(p.PoiDate) };
    }

    /// <summary>Semaine d'un salarié : pointages saisis, chantiers et ordres concernés, chantiers récents, contrôles.</summary>
    public async Task<object> SemaineAsync(int salarie, DateOnly lundi, Utilisateur u, CancellationToken ct)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        var s = await SalarieAsync(salarie, u, ct);
        var dimanche = lundi.AddDays(6);
        var pointages = await db.Pointages.AsNoTracking()
            .Where(p => p.PoiSalId == salarie && p.PoiCouche == Couches.Saisie && p.PoiDate >= lundi && p.PoiDate <= dimanche)
            .OrderBy(p => p.PoiDate).ThenBy(p => p.PoiDebut).ThenBy(p => p.PoiId).ToListAsync(ct);
        var recents = await db.Pointages.AsNoTracking()
            .Where(p => p.PoiSalId == salarie && p.PoiDate >= lundi.AddDays(-28) && p.PoiDate < lundi)
            .GroupBy(p => p.PoiChaId).OrderByDescending(g => g.Max(p => p.PoiDate)).Select(g => g.Key).Take(8).ToListAsync(ct);
        var idsChantiers = pointages.Select(p => p.PoiChaId).Concat(recents).Distinct().ToList();
        var chantiers = (await specialisation.ChantiersAsync(db, null, idsChantiers, ct)).ToDictionary(c => c.Id);
        var st = await db.SousTypes.AsNoTracking().ToDictionaryAsync(x => x.PstCode, ct);
        var p0 = await ParametresAsync(ct);
        var controles = ReglesPointage.ControlerSemaine(new ParametresControle(p0.PasMinutes, p0.AmplitudeJour, p0.AmplitudeSemaine),
            pointages.Select(p => Controle(p, chantiers, st)).ToList());
        var corrigee = await db.Semaines.AsNoTracking().AnyAsync(x => x.PsmSalId == salarie && x.PsmLundi == lundi, ct);
        var etats = (await EtatsAsync([salarie], lundi, p0.Validation, ct))[salarie];
        return new
        {
            salarie = s, lundi, pointages = pointages.Select(p => new
            {
                id = p.PoiId, date = p.PoiDate, cha_id = p.PoiChaId, ent_id = p.PoiEntId, type_mo = p.PoiTypeMo, sous_type = p.PoiSousType,
                minutes = p.PoiMinutes, debut = p.PoiDebut, fin = p.PoiFin, motif = p.PoiMotif, commentaire = p.PoiCommentaire,
                saisi_par = p.PoiSaisiPar, saisi_le = p.PoiSaisiLe, groupe = p.PoiGroupe, appareil = p.PoiAppareil,
            }),
            chantiers = chantiers.Values, recents,
            ordres = await specialisation.OrdresAsync(db, idsChantiers, ct),
            controles, corrigee, etats,
            corrections = await db.Corrections.AsNoTracking().Where(c => c.PcoSalId == salarie && c.PcoLundi == lundi).OrderByDescending(c => c.PcoLe)
                .Select(c => new { id = c.PcoId, etat = c.PcoEtat, motif = c.PcoMotif, le = c.PcoLe, reponse = c.PcoReponse }).ToListAsync(ct),
        };
    }

    /// <summary>
    /// Enregistre la semaine saisie d'un salarié (couche SAISIE) : pointages absents supprimés, modifiés, ajoutés ;
    /// erreurs des contrôles refusées (422 avec la liste), avertissements renvoyés.
    /// </summary>
    public async Task<object> EnregistrerSemaineAsync(int salarie, DateOnly lundi, SemaineSaisie s, Utilisateur u, CancellationToken ct, bool controleAcces = true)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        if (controleAcces) await SalarieAsync(salarie, u, ct);
        else if (!(await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).Any()) throw ExceptionMetier.Introuvable($"Salarié {salarie}");
        var dimanche = lundi.AddDays(6);
        if (s.Pointages.Any(p => p.Date < lundi || p.Date > dimanche)) throw ExceptionMetier.Invalide("POI_SEMAINE_HORS", "Pointage hors de la semaine");
        var chantiers = (await specialisation.ChantiersAsync(db, null, s.Pointages.Where(p => p.ChaId is not null).Select(p => p.ChaId!.Value).Distinct().ToList(), ct))
            .ToDictionary(c => c.Id);
        if (s.Pointages.Any(p => p.ChaId is int c && !chantiers.ContainsKey(c))) throw ExceptionMetier.Invalide("POI_CHANTIER", "Chantier inconnu");
        var st = await db.SousTypes.AsNoTracking().ToDictionaryAsync(x => x.PstCode, ct);
        if (s.Pointages.Any(p => p.SousType is not null && !st.ContainsKey(p.SousType))) throw ExceptionMetier.Invalide("POI_SOUS_TYPE", "Sous-type inconnu");
        var p0 = await ParametresAsync(ct);
        var controles = ReglesPointage.ControlerSemaine(new ParametresControle(p0.PasMinutes, p0.AmplitudeJour, p0.AmplitudeSemaine),
            s.Pointages.Select((p, i) => new PointageControle(i.ToString(), p.Date.ToString("yyyy-MM-dd"), p.ChaId, p.TypeMo?.ToString(), p.Minutes, p.Debut, p.Fin,
                p.SousType is not null && st[p.SousType].PstNonConformite, p.Motif, p.ChaId is int c && chantiers[c].Clos)).ToList());
        if (ReglesPointage.Bloquant(controles))
            throw ExceptionMetier.Invalide(controles.First(c => c.Niveau == ReglesPointage.Erreur).Code,
                string.Join(" · ", controles.Where(c => c.Niveau == ReglesPointage.Erreur).Select(c => ReglesPointage.Messages[c.Code]).Distinct()), controles);
        // Transaction propre, sauf dans celle de l'appelant (essai de la borne : annulée après les contrôles).
        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        var existants = await db.Pointages.Where(p => p.PoiSalId == salarie && p.PoiCouche == Couches.Saisie && p.PoiDate >= lundi && p.PoiDate <= dimanche).ToListAsync(ct);
        var etats = (await EtatsAsync([salarie], lundi, p0.Validation, ct))[salarie];
        string Empreinte(DateOnly d, IEnumerable<(long? Id, int Cha, long? Ent, int Type, string? St, int Min, string? Motif)> l) =>
            string.Join(";", l.OrderBy(x => x.Id).Select(x => $"{x.Id}|{x.Cha}|{x.Ent}|{x.Type}|{x.St}|{x.Min}|{x.Motif}"));
        var bloques = Enumerable.Range(0, 7).Where(i => ReglesValidation.EstBloque(etats[i])).Select(i => lundi.AddDays(i))
            .Where(d => Empreinte(d, existants.Where(e => e.PoiDate == d).Select(e => ((long?)e.PoiId, e.PoiChaId, e.PoiEntId, e.PoiTypeMo, e.PoiSousType, (int)e.PoiMinutes, e.PoiMotif)))
                     != Empreinte(d, s.Pointages.Where(p => p.Date == d).Select(p => (p.Id, p.ChaId ?? 0, p.EntId, p.TypeMo ?? 0, p.SousType, p.Minutes, string.IsNullOrWhiteSpace(p.Motif) ? null : p.Motif.Trim()))))
            .ToList();
        if (bloques.Count > 0)
            throw ExceptionMetier.Conflit(ErreursPointage.PoiValide, "Jours déjà validés : envoyer une demande de correction au service RH", new { dates = bloques });
        var gardes = s.Pointages.Where(p => p.Id is not null).Select(p => p.Id!.Value).ToHashSet();
        if (gardes.Any(id => existants.All(e => e.PoiId != id))) throw ExceptionMetier.Conflit("POI_MODIFIE", "Pointage introuvable dans la semaine : relire la semaine");
        db.Pointages.RemoveRange(existants.Where(e => !gardes.Contains(e.PoiId)));
        foreach (var p in s.Pointages)
        {
            var e = p.Id is long id ? existants.First(x => x.PoiId == id) : null;
            var nouveau = e is null;
            e ??= new PointageEntite { PoiSalId = salarie, PoiCouche = Couches.Saisie };
            var change = nouveau || e.PoiDate != p.Date || e.PoiChaId != p.ChaId || e.PoiEntId != p.EntId || e.PoiTypeMo != p.TypeMo || e.PoiSousType != p.SousType
                || e.PoiMinutes != p.Minutes || e.PoiDebut != p.Debut || e.PoiFin != p.Fin || e.PoiMotif != p.Motif || e.PoiCommentaire != p.Commentaire;
            if (!change) continue;
            e.PoiDate = p.Date;
            e.PoiChaId = p.ChaId!.Value;
            e.PoiEntId = p.EntId;
            e.PoiTypeMo = p.TypeMo!.Value;
            e.PoiSousType = p.SousType;
            e.PoiMinutes = (short)p.Minutes;
            e.PoiDebut = (short?)p.Debut;
            e.PoiFin = (short?)p.Fin;
            e.PoiMotif = string.IsNullOrWhiteSpace(p.Motif) ? null : p.Motif.Trim();
            e.PoiCommentaire = string.IsNullOrWhiteSpace(p.Commentaire) ? null : p.Commentaire;
            e.PoiSaisiPar = u.Code;
            e.PoiSaisiLe = DateTimeOffset.UtcNow;
            if (nouveau) db.Pointages.Add(e);
            else e.PoiVersion++;
        }
        await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return controleAcces ? await SemaineAsync(salarie, lundi, u, ct) : new { };
    }
}
