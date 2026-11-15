using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Execution.Web;

public class ModeleEntite
{
    public int PamId { get; set; }
    public string PamCode { get; set; } = "";
    public string PamLibelle { get; set; } = "";
    public string? PamDescription { get; set; }
    public int PamOrdre { get; set; }
    public bool PamActif { get; set; } = true;
    public string? PamMajPar { get; set; }
    public DateTimeOffset PamMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class EtapeModeleEntite
{
    public int PaeId { get; set; }
    public int PaePamId { get; set; }
    public string PaeCode { get; set; } = "";
    public string? PaeLibelle { get; set; }
    public int? PaeSrvId { get; set; }
    public string? PaeTypeOrdre { get; set; }
    public string[] PaeAmonts { get; set; } = [];
    public int PaeOrdre { get; set; }
    /// <summary>États retenus par l'étape (JSON : [{ code, duree }]) ; vide : ceux du type d'ordre.</summary>
    public string PaeEtats { get; set; } = "[]";
}

public class ParcoursEntite
{
    public int ParId { get; set; }
    public string ParTypeElement { get; set; } = "";
    public string ParIdElement { get; set; } = "";
    public int? ParPamId { get; set; }
    public string? ParMajPar { get; set; }
    public DateTimeOffset ParMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class EtapeElementEntite
{
    public int PeeId { get; set; }
    public int PeeParId { get; set; }
    public string PeeCode { get; set; } = "";
    public string? PeeLibelle { get; set; }
    public int? PeeSrvId { get; set; }
    public string? PeeTypeOrdre { get; set; }
    public string[] PeeAmonts { get; set; } = [];
    public int PeeOrdre { get; set; }
    public string PeeEtats { get; set; } = "[]";
}

public class EtatManuelEntite
{
    public string EtmTypeElement { get; set; } = "";
    public string EtmIdElement { get; set; } = "";
    public int EtmSrvId { get; set; }
    public string EtmEtat { get; set; } = "";
    public string? EtmMotif { get; set; }
    public string EtmPar { get; set; } = "";
    public DateTimeOffset EtmLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ExecutionDbContext(DbContextOptions<ExecutionDbContext> options) : DbContext(options)
{
    public DbSet<ModeleEntite> Modeles => Set<ModeleEntite>();
    public DbSet<EtapeModeleEntite> EtapesModeles => Set<EtapeModeleEntite>();
    public DbSet<ParcoursEntite> Parcours => Set<ParcoursEntite>();
    public DbSet<EtapeElementEntite> EtapesElements => Set<EtapeElementEntite>();
    public DbSet<EtatManuelEntite> EtatsManuels => Set<EtatManuelEntite>();
    public DbSet<EtatCatalogueEntite> EtatsCatalogue => Set<EtatCatalogueEntite>();
    public DbSet<EtatTypeEntite> EtatsTypes => Set<EtatTypeEntite>();
    public DbSet<EtapeOrdreEntite> EtapesOrdres => Set<EtapeOrdreEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ModeleEntite>().ToTable("exe_parcours_modele").HasKey(x => x.PamId);
        b.Entity<EtapeModeleEntite>().ToTable("exe_parcours_etape").HasKey(x => x.PaeId);
        b.Entity<EtapeModeleEntite>().Property(x => x.PaeEtats).HasColumnType("jsonb");
        b.Entity<EtatCatalogueEntite>().ToTable("exe_etat_catalogue").HasKey(x => x.EtcCode);
        b.Entity<EtatTypeEntite>().ToTable("exe_etat_type").HasKey(x => new { x.EttTypeOrdre, x.EttEtcCode });
        b.Entity<EtapeOrdreEntite>().ToTable("exe_ordre_etape").HasKey(x => x.OreId);
        b.Entity<EtapeOrdreEntite>().Property(x => x.OreRessource).HasColumnType("jsonb");
        b.Entity<ParcoursEntite>().ToTable("exe_parcours").HasKey(x => x.ParId);
        b.Entity<EtapeElementEntite>().ToTable("exe_parcours_element_etape").HasKey(x => x.PeeId);
        b.Entity<EtapeElementEntite>().Property(x => x.PeeEtats).HasColumnType("jsonb");
        b.Entity<EtatManuelEntite>().ToTable("exe_etat_manuel").HasKey(x => new { x.EtmTypeElement, x.EtmIdElement, x.EtmSrvId });
    }
}

/// <summary>Étape d'un parcours (modèle ou élément) échangée avec le client.</summary>
public sealed record EtapeDto(string Code, string? Libelle, int? SrvId, string? TypeOrdre, List<string>? Amonts, int Ordre, List<EtatEtapeDto>? Etats = null);
/// <summary>État retenu par une étape de parcours, durée surchargée (E27, E33).</summary>
public sealed record EtatEtapeDto(string Code, decimal? Duree = null);
public sealed record ModeleDto(int? Id, string Code, string Libelle, string? Description, int Ordre, bool Actif, List<EtapeDto> Etapes);
public sealed record ParcoursSaisi(int? PamId, List<EtapeDto>? Etapes);
public sealed record EtatManuelSaisi(string? Etat, string? Motif);

/// <summary>Service de l'entreprise (fourni par l'application) : deux niveaux (parent).</summary>
public sealed record ServiceExe(int Id, string Code, string Libelle, int? ParentId, int Ordre, bool Actif);

/// <summary>Ordre d'un élément (document de la famille E, fourni par l'application).</summary>
public sealed record OrdreExe(string IdElement, long EntId, string? Numero, string? Objet, string TypeOrdre, string? TypeLibelle, int? SrvId,
    string Statut, string? StatutLibelle, string? Etat, string? Motif, DateOnly? FinPrevue, bool EnRetard, string? Url);

/// <summary>Élément de la synthèse (chantier…) et ses colonnes descriptives.</summary>
public sealed record ElementExe(string Type, string Id, string Code, string Libelle, string? Client, string? Responsable, DateOnly? FinPrevue,
    string? DernierMessage, string? Url);

public sealed record FiltreSynthese(string? Recherche, int? Service, string? Etat, int Page = 1, int Taille = 100);

/// <summary>
/// Spécialisation par l'application (méthode patron) : services de l'entreprise, éléments suivis (chantiers) et leurs
/// ordres (documents de la famille E).
/// </summary>
public abstract class SpecialisationExecution
{
    public virtual string TypeElement => "chantier";
    public abstract Task<List<ServiceExe>> ServicesAsync(ExecutionDbContext db, CancellationToken ct);
    public abstract Task<List<ElementExe>> ElementsAsync(ExecutionDbContext db, FiltreSynthese f, IReadOnlyCollection<string>? ids, CancellationToken ct);
    public abstract Task<List<OrdreExe>> OrdresAsync(ExecutionDbContext db, IReadOnlyCollection<string> ids, CancellationToken ct);
    /// <summary>Types d'ordres désactivés : leurs étapes de parcours sont ignorées (services sans objet, E39).</summary>
    public virtual Task<HashSet<string>> TypesInactifsAsync(ExecutionDbContext db, CancellationToken ct) => Task.FromResult(new HashSet<string>());

    // Étapes des ordres (§ 13) : l'application décrit l'ordre, fournit le calendrier, les droits et applique les suites.

    /// <summary>Ordre (null : inconnu) : type, élément, service, début prévu, état d'exécution, clos (annulé, remplacé).</summary>
    public virtual Task<OrdreEtapes?> OrdreAsync(ExecutionDbContext db, long id, CancellationToken ct) => Task.FromResult<OrdreEtapes?>(null);
    /// <summary>Ordres non terminés d'un type (« Appliquer aux ordres en cours », E41).</summary>
    public virtual Task<List<long>> OrdresEnCoursAsync(ExecutionDbContext db, string typeOrdre, CancellationToken ct) => Task.FromResult(new List<long>());
    /// <summary>Calendrier des dates prévisionnelles (null : 7 h du lundi au vendredi).</summary>
    public virtual Task<CalendrierEtapes?> CalendrierAsync(ExecutionDbContext db, int? srvId, DateOnly du, DateOnly au, CancellationToken ct) =>
        Task.FromResult<CalendrierEtapes?>(null);
    /// <summary>Tâches du planning liées aux étapes (absentes : supprimées) ; défaut : aucune.</summary>
    public virtual Task<List<TacheEtape>> TachesAsync(ExecutionDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct) => Task.FromResult(new List<TacheEtape>());
    /// <summary>Droit de valider une étape, d'en prévoir la date ou la ressource (E46) ; défaut : administrateur.</summary>
    public virtual Task<bool> PeutValiderAsync(ExecutionDbContext db, OrdreEtapes o, EtapeOrdreEntite? e, Utilisateur u, CancellationToken ct) => Task.FromResult(u.EstAdmin);
    /// <summary>Droit de cocher le contrôle du N+1 (E30) ; défaut : administrateur.</summary>
    public virtual Task<bool> PeutControlerAsync(ExecutionDbContext db, OrdreEtapes o, Utilisateur u, CancellationToken ct) => Task.FromResult(u.EstAdmin);
    /// <summary>
    /// Suites d'une modification des étapes : état d'exécution déduit (null : inchangé), statuts documentaires atteints,
    /// dates de l'ordre (première et dernière étape), historique ; rend des avertissements.
    /// </summary>
    public virtual Task<List<string>> ApresEtapesAsync(ExecutionDbContext db, OrdreEtapes o, SuitesEtapes suites, Utilisateur u, CancellationToken ct) =>
        Task.FromResult(new List<string>());
}

/// <summary>
/// Parcours (modèles, parcours d'un élément), états manuels, synthèse par élément (un état par service : règle
/// <see cref="ReglesEtats"/>) et vue détaillée (ordres non terminés regroupés par service).
/// </summary>
public sealed class ServiceExecution(ExecutionDbContext db, SpecialisationExecution specialisation)
{
    private static void Admin(Utilisateur u)
    {
        u.ExigerParametres();
    }

    private static void Controler(List<EtapeDto> etapes)
    {
        var e = ReglesEtats.ControlerParcours(etapes.Select(x => new EtapeParcours(x.Code, x.SrvId, x.Amonts)).ToList());
        if (e.Count > 0) throw ExceptionMetier.Invalide(e[0], string.Join(" · ", e.Select(c => ReglesEtats.Messages[c])), e);
    }

    public async Task<List<ModeleDto>> ModelesAsync(CancellationToken ct)
    {
        var modeles = await db.Modeles.AsNoTracking().OrderBy(m => m.PamOrdre).ThenBy(m => m.PamCode).ToListAsync(ct);
        var etapes = await db.EtapesModeles.AsNoTracking().OrderBy(e => e.PaeOrdre).ToListAsync(ct);
        return modeles.Select(m => new ModeleDto(m.PamId, m.PamCode, m.PamLibelle, m.PamDescription, m.PamOrdre, m.PamActif,
            etapes.Where(e => e.PaePamId == m.PamId).Select(e => new EtapeDto(e.PaeCode, e.PaeLibelle, e.PaeSrvId, e.PaeTypeOrdre, [.. e.PaeAmonts], e.PaeOrdre,
                EtatsEtape.Lire(e.PaeEtats))).ToList())).ToList();
    }

    /// <summary>Modèles de parcours (administrateur) : liste complète ; un modèle retiré est supprimé (les parcours copiés restent).</summary>
    public async Task<List<ModeleDto>> EnregistrerModelesAsync(List<ModeleDto> l, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        foreach (var m in l)
        {
            if (string.IsNullOrWhiteSpace(m.Code) || string.IsNullOrWhiteSpace(m.Libelle)) throw ExceptionMetier.Invalide("PAR_MODELE", "Code et libellé du modèle obligatoires");
            Controler(m.Etapes);
        }
        await using var tx = await db.Unite().CommencerAsync(ct);
        var gardes = l.Where(m => m.Id is not null).Select(m => m.Id!.Value).ToList();
        await db.Modeles.Where(m => !gardes.Contains(m.PamId)).ExecuteDeleteAsync(ct);
        foreach (var m in l)
        {
            var x = m.Id is int id ? await db.Modeles.FirstAsync(y => y.PamId == id, ct) : new ModeleEntite();
            x.PamCode = m.Code.Trim().ToUpperInvariant();
            x.PamLibelle = m.Libelle.Trim();
            x.PamDescription = m.Description;
            x.PamOrdre = m.Ordre;
            x.PamActif = m.Actif;
            x.PamMajPar = u.Code;
            x.PamMajLe = DateTimeOffset.UtcNow;
            if (m.Id is null) db.Modeles.Add(x);
            await db.SaveChangesAsync(ct);
            await db.EtapesModeles.Where(e => e.PaePamId == x.PamId).ExecuteDeleteAsync(ct);
            db.EtapesModeles.AddRange(m.Etapes.Select((e, i) => new EtapeModeleEntite
            {
                PaePamId = x.PamId, PaeCode = e.Code.Trim().ToUpperInvariant(), PaeLibelle = e.Libelle, PaeSrvId = e.SrvId, PaeTypeOrdre = e.TypeOrdre,
                PaeAmonts = (e.Amonts ?? []).Select(a => a.Trim().ToUpperInvariant()).ToArray(), PaeOrdre = e.Ordre == 0 ? i + 1 : e.Ordre,
                PaeEtats = EtatsEtape.Ecrire(e.Etats),
            }));
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        return await ModelesAsync(ct);
    }

    private async Task<(ParcoursEntite? Parcours, List<EtapeElementEntite> Etapes)> ParcoursAsync(string type, string id, CancellationToken ct)
    {
        var p = await db.Parcours.AsNoTracking().FirstOrDefaultAsync(x => x.ParTypeElement == type && x.ParIdElement == id, ct);
        return (p, p is null ? [] : await db.EtapesElements.AsNoTracking().Where(e => e.PeeParId == p.ParId).OrderBy(e => e.PeeOrdre).ToListAsync(ct));
    }

    private static List<EtapeDto> Dto(IEnumerable<EtapeElementEntite> l) => l.Select(e => new EtapeDto(e.PeeCode, e.PeeLibelle, e.PeeSrvId, e.PeeTypeOrdre, [.. e.PeeAmonts], e.PeeOrdre,
        EtatsEtape.Lire(e.PeeEtats))).ToList();

    /// <summary>Parcours d'un élément : depuis un modèle (copie de ses étapes) ou étapes saisies ; sans étape : parcours retiré.</summary>
    public async Task<object> EnregistrerParcoursAsync(string type, string id, ParcoursSaisi s, Utilisateur u, CancellationToken ct)
    {
        var etapes = s.Etapes;
        if (etapes is null && s.PamId is int pam)
        {
            etapes = (await ModelesAsync(ct)).FirstOrDefault(m => m.Id == pam)?.Etapes ?? throw ExceptionMetier.Introuvable($"Modèle de parcours {pam}");
        }
        etapes ??= [];
        Controler(etapes);
        await using var tx = await db.Unite().CommencerAsync(ct);
        var p = await db.Parcours.FirstOrDefaultAsync(x => x.ParTypeElement == type && x.ParIdElement == id, ct);
        if (etapes.Count == 0)
        {
            if (p is not null) db.Parcours.Remove(p);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return await DetailAsync(type, id, ct);
        }
        if (p is null) db.Parcours.Add(p = new ParcoursEntite { ParTypeElement = type, ParIdElement = id });
        p.ParPamId = s.PamId ?? p.ParPamId;
        p.ParMajPar = u.Code;
        p.ParMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await db.EtapesElements.Where(e => e.PeeParId == p.ParId).ExecuteDeleteAsync(ct);
        db.EtapesElements.AddRange(etapes.Select((e, i) => new EtapeElementEntite
        {
            PeeParId = p.ParId, PeeCode = e.Code.Trim().ToUpperInvariant(), PeeLibelle = e.Libelle, PeeSrvId = e.SrvId, PeeTypeOrdre = e.TypeOrdre,
            PeeAmonts = (e.Amonts ?? []).Select(a => a.Trim().ToUpperInvariant()).ToArray(), PeeOrdre = i + 1, PeeEtats = EtatsEtape.Ecrire(e.Etats),
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await DetailAsync(type, id, ct);
    }

    /// <summary>État imposé (ou retiré si vide) pour un service sur un élément ; motif conservé.</summary>
    public async Task<object> EnregistrerEtatManuelAsync(string type, string id, int srv, EtatManuelSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (s.Etat is not null && !ReglesEtats.EtatsService.Contains(s.Etat)) throw ExceptionMetier.Invalide("EXE_ETAT", $"État inconnu : {s.Etat}");
        var x = await db.EtatsManuels.FirstOrDefaultAsync(e => e.EtmTypeElement == type && e.EtmIdElement == id && e.EtmSrvId == srv, ct);
        if (s.Etat is null)
        {
            if (x is not null) db.EtatsManuels.Remove(x);
        }
        else
        {
            if (x is null) db.EtatsManuels.Add(x = new EtatManuelEntite { EtmTypeElement = type, EtmIdElement = id, EtmSrvId = srv });
            x.EtmEtat = s.Etat;
            x.EtmMotif = s.Motif;
            x.EtmPar = u.Code;
            x.EtmLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        return await DetailAsync(type, id, ct);
    }

    /// <summary>Ordres d'un élément avec leur service : celui de l'ordre, sinon celui de l'étape du parcours de même type d'ordre.</summary>
    private static List<OrdreExe> AvecService(List<OrdreExe> ordres, List<EtapeElementEntite> etapes) =>
        ordres.Select(o => o.SrvId is null && etapes.FirstOrDefault(e => e.PeeTypeOrdre == o.TypeOrdre)?.PeeSrvId is int s ? o with { SrvId = s } : o).ToList();

    /// <summary>
    /// Étapes retenues pour le calcul : sans celles d'un type d'ordre désactivé ; leurs étapes aval héritent de leurs
    /// amonts (la chaîne du parcours reste continue).
    /// </summary>
    private static List<EtapeElementEntite> Actives(List<EtapeElementEntite> etapes, HashSet<string> inactifs)
    {
        var retirees = etapes.Where(e => e.PeeTypeOrdre is string t && inactifs.Contains(t)).ToDictionary(e => e.PeeCode, e => e.PeeAmonts);
        if (retirees.Count == 0) return etapes;
        string[] Amonts(IEnumerable<string> codes, int profondeur) => profondeur > 50 ? [] : codes
            .SelectMany(c => retirees.TryGetValue(c, out var a) ? Amonts(a, profondeur + 1) : [c]).Distinct().ToArray();
        return etapes.Where(e => !retirees.ContainsKey(e.PeeCode))
            .Select(e => new EtapeElementEntite
            {
                PeeId = e.PeeId, PeeParId = e.PeeParId, PeeCode = e.PeeCode, PeeLibelle = e.PeeLibelle, PeeSrvId = e.PeeSrvId,
                PeeTypeOrdre = e.PeeTypeOrdre, PeeAmonts = Amonts(e.PeeAmonts, 0), PeeOrdre = e.PeeOrdre, PeeEtats = e.PeeEtats,
            }).ToList();
    }

    private static List<EtatService> Etats(List<EtapeElementEntite> etapes, List<OrdreExe> ordres, List<EtatManuelEntite> manuels) =>
        ReglesEtats.EtatsServices(etapes.Select(e => new EtapeParcours(e.PeeCode, e.PeeSrvId, e.PeeAmonts)).ToList(),
            ordres.Select(o => new OrdreEvalue(o.SrvId, o.Statut, o.Etat)).ToList(),
            manuels.Select(m => new EtatManuel(m.EtmSrvId, m.EtmEtat)).ToList());

    /// <summary>
    /// Synthèse : éléments suivis (ayant des ordres ou un parcours) avec un état par service, filtrés par recherche,
    /// service et état de ce service ; services présents (colonnes) dans l'ordre de l'entreprise.
    /// </summary>
    public async Task<object> SyntheseAsync(FiltreSynthese f, CancellationToken ct)
    {
        var type = specialisation.TypeElement;
        var avecParcours = await db.Parcours.AsNoTracking().Where(p => p.ParTypeElement == type).Select(p => p.ParIdElement).ToListAsync(ct);
        var elements = await specialisation.ElementsAsync(db, f, null, ct);
        var ids = elements.Select(e => e.Id).ToList();
        var ordres = await specialisation.OrdresAsync(db, ids, ct);
        var parcours = await db.Parcours.AsNoTracking().Where(p => p.ParTypeElement == type && ids.Contains(p.ParIdElement)).ToListAsync(ct);
        var parIds = parcours.Select(p => p.ParId).ToList();
        var inactifs = await specialisation.TypesInactifsAsync(db, ct);
        var etapes = await db.EtapesElements.AsNoTracking().Where(e => parIds.Contains(e.PeeParId)).ToListAsync(ct);
        var manuels = await db.EtatsManuels.AsNoTracking().Where(m => m.EtmTypeElement == type && ids.Contains(m.EtmIdElement)).ToListAsync(ct);
        var lignes = new List<object>();
        var presents = new HashSet<int>();
        foreach (var e in elements)
        {
            var p = parcours.FirstOrDefault(x => x.ParIdElement == e.Id);
            var et = p is null ? [] : Actives(etapes.Where(x => x.PeeParId == p.ParId).OrderBy(x => x.PeeOrdre).ToList(), inactifs);
            var os = AvecService(ordres.Where(o => o.IdElement == e.Id).ToList(), et);
            if (os.Count == 0 && p is null) continue;
            var etats = Etats(et, os, manuels.Where(m => m.EtmIdElement == e.Id).ToList());
            if (f.Service is int s && f.Etat is not null && etats.FirstOrDefault(x => x.SrvId == s)?.Etat != f.Etat) continue;
            if (f.Service is int s2 && f.Etat is null && !etats.Any(x => x.SrvId == s2 && x.Etat != "SANS_OBJET")) continue;
            if (f.Service is null && f.Etat is not null && !etats.Any(x => x.Etat == f.Etat)) continue;
            foreach (var x in etats.Where(x => x.Etat != "SANS_OBJET")) presents.Add(x.SrvId);
            lignes.Add(new
            {
                element = e, parcours = p?.ParPamId, etats,
                nb_ordres = os.Count(o => o.Statut is not ("ANNULE" or "REMPLACE")),
                bloques = os.Count(o => o.Etat == "BLOQUE" && o.Statut is not ("ANNULE" or "REMPLACE")),
                en_retard = os.Count(o => o.EnRetard),
            });
        }
        var services = (await specialisation.ServicesAsync(db, ct)).Where(s => presents.Contains(s.Id)).ToList();
        return new { services, lignes, avec_parcours = avecParcours.Count };
    }

    /// <summary>Vue détaillée d'un élément : parcours, états par service, ordres (les non terminés d'abord) regroupés par service.</summary>
    public async Task<object> DetailAsync(string type, string id, CancellationToken ct)
    {
        var element = (await specialisation.ElementsAsync(db, new FiltreSynthese(null, null, null), [id], ct)).FirstOrDefault();
        var (p, etapes) = await ParcoursAsync(type, id, ct);
        var ordres = AvecService(await specialisation.OrdresAsync(db, [id], ct), etapes);
        var manuels = await db.EtatsManuels.AsNoTracking().Where(m => m.EtmTypeElement == type && m.EtmIdElement == id).ToListAsync(ct);
        var etats = Etats(Actives(etapes, await specialisation.TypesInactifsAsync(db, ct)), ordres, manuels);
        return new
        {
            element, modele = p?.ParPamId, etapes = Dto(etapes), etats,
            manuels = manuels.Select(m => new { srv_id = m.EtmSrvId, etat = m.EtmEtat, motif = m.EtmMotif, par = m.EtmPar, le = m.EtmLe }),
            ordres = ordres.OrderBy(o => ReglesEtats.EtatOrdre(new OrdreEvalue(o.SrvId, o.Statut, o.Etat)) == "TERMINE").ThenBy(o => o.FinPrevue).ToList(),
            services = await specialisation.ServicesAsync(db, ct),
        };
    }
}
