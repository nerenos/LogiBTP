using System.Text.Json;
using System.Text.Json.Serialization;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Execution.Web;

public class EtatCatalogueEntite
{
    public string EtcCode { get; set; } = "";
    public string EtcLibelle { get; set; } = "";
    public string? EtcCouleur { get; set; }
    public string EtcNature { get; set; } = "TACHE";
    public decimal EtcDuree { get; set; }
    public string EtcUnite { get; set; } = "OUV";
    public int? EtcSrvId { get; set; }
    public int EtcOrdre { get; set; }
    public bool EtcActif { get; set; } = true;
    public string? EtcMajPar { get; set; }
    public DateTimeOffset EtcMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class EtatTypeEntite
{
    public string EttTypeOrdre { get; set; } = "";
    public string EttEtcCode { get; set; } = "";
    public int EttOrdre { get; set; }
    public bool EttDateObligatoire { get; set; }
    public bool EttControle { get; set; }
    public bool EttControleBloquant { get; set; } = true;
    public string? EttStatutDocument { get; set; }
    public string[]? EttAmonts { get; set; }
    public decimal? EttDuree { get; set; }
}

public class EtapeOrdreEntite
{
    public long OreId { get; set; }
    public long OreOrdreId { get; set; }
    public string OreCode { get; set; } = "";
    public string OreLibelle { get; set; } = "";
    public string? OreCouleur { get; set; }
    public string OreNature { get; set; } = "TACHE";
    public decimal OreDuree { get; set; }
    public string OreUnite { get; set; } = "OUV";
    public int? OreSrvId { get; set; }
    public string[]? OreAmonts { get; set; }
    public int OreOrdre { get; set; }
    public bool OreDateObligatoire { get; set; }
    public bool OreControle { get; set; }
    public bool OreControleBloquant { get; set; } = true;
    public string? OreStatutDocument { get; set; }
    public DateOnly? OreDebutLe { get; set; }
    public DateOnly? OrePrevuLe { get; set; }
    public bool OrePrevuImpose { get; set; }
    public DateOnly? OreValideLe { get; set; }
    public string? OreValidePar { get; set; }
    public DateOnly? OreControleLe { get; set; }
    public string? OreControlePar { get; set; }
    public string? OreCommentaire { get; set; }
    /// <summary>Ressource principale de l'étape (JSON { type, id, libelle }) ; null : celle de l'ordre (E32).</summary>
    public string? OreRessource { get; set; }
    public long? OreTacId { get; set; }
    public DateTimeOffset OreMajLe { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Ordre vu par les étapes : type, élément (chantier), service, début prévu, état d'exécution, clos, ressource principale (JSON).</summary>
public sealed record OrdreEtapes(long Id, string TypeOrdre, string? IdElement, int? SrvId, DateOnly? Debut, string? Etat, bool Clos, string? Ressource = null);

/// <summary>
/// Suites d'une modification des étapes transmises à l'application : état déduit, statuts atteints, dates de l'ordre,
/// historique ; tâches du planning à déplacer (fin voulue) ou à terminer ; étapes validées à contrôler par le N+1.
/// </summary>
public sealed record SuitesEtapes(string? Etat, List<string> Statuts, DateOnly? Debut, DateOnly? Fin, string Detail)
{
    public List<(long TacId, DateOnly Fin)> Deplacements { get; init; } = [];
    public List<long> Terminees { get; init; } = [];
    public List<string> AControler { get; init; } = [];
}

/// <summary>Tâche du planning liée à une étape : dernier jour et ressource principale (première affectation, JSON).</summary>
public sealed record TacheEtape(long TacId, DateOnly Fin, string? Ressource);

public sealed record EtatCatalogueDto(string Code, string Libelle, string? Couleur, string Nature, decimal Duree, string Unite, int? SrvId, int Ordre, bool Actif);
public sealed record EtatTypeDto(string Code, int Ordre, bool DateObligatoire, bool Controle, bool ControleBloquant, string? StatutDocument,
    List<string>? Amonts, decimal? Duree, string? Libelle = null, string? Nature = null, string? Unite = null, decimal? DureeCatalogue = null);

/// <summary>Action sur une étape d'un ordre.</summary>
public sealed record ActionEtape(string Action, DateOnly? Date = null, JsonElement? Ressource = null, string? Commentaire = null, decimal? Duree = null);

/// <summary>États d'une étape de parcours (JSON de <c>pae_etats</c> / <c>pee_etats</c>).</summary>
public static class EtatsEtape
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public static List<EtatEtapeDto> Lire(string? json) =>
        string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<EtatEtapeDto>>(json, Options) ?? [];

    public static string Ecrire(List<EtatEtapeDto>? etats) =>
        JsonSerializer.Serialize((etats ?? []).Where(e => !string.IsNullOrWhiteSpace(e.Code)).Select(e => e with { Code = e.Code.Trim().ToUpperInvariant() }), Options);
}

/// <summary>
/// Étapes des ordres (ANALYSE-MODULE-EXECUTION.md § 13) : catalogue des états (global), états d'un type d'ordre,
/// étapes d'un ordre copiées de son étape de parcours ou de son type (à la première lecture), actions (valider,
/// annuler, contrôler, prévoir, ressource, durée), dates prévisionnelles par enchaînement (<see cref="ReglesEtapes"/>).
/// </summary>
public sealed class ServiceEtapes(ExecutionDbContext db, SpecialisationExecution specialisation)
{
    private static void Admin(Utilisateur u)
    {
        u.ExigerAdmin();
    }

    private static readonly Dictionary<string, string> Messages = new()
    {
        ["ETP_INCONNUE"] = "Étape inconnue", ["ETP_DEJA_VALIDEE"] = "Étape déjà validée", ["ETP_ORDRE"] = "Étapes précédentes à valider d'abord",
        ["ETP_CONTROLE"] = "Contrôle du N+1 attendu sur une étape précédente", ["ETP_CONTROLE_ATTENTE"] = "Contrôle du N+1 pas encore fait sur une étape précédente",
        ["ETP_NON_VALIDEE"] = "Étape non validée", ["ETP_SUIVANT_VALIDE"] = "Une étape suivante est déjà validée",
        ["ETP_SANS_CONTROLE"] = "Cette étape n'a pas de contrôle du N+1", ["ETP_CODE"] = "Code d'état obligatoire", ["ETP_DOUBLON"] = "Même état deux fois",
        ["ETP_AMONT"] = "Étape amont inconnue", ["ETP_BOUCLE"] = "Les étapes amont forment une boucle", ["ETP_NATURE"] = "Nature inconnue",
        ["ETP_DUREE"] = "Durée négative ou unité inconnue",
    };

    private static ExceptionMetier Erreur(List<string> codes) =>
        ExceptionMetier.Invalide(codes[0], string.Join(" · ", codes.Select(c => Messages.GetValueOrDefault(c, c))), codes);

    // ---------------------------------------------------------------- Catalogue et états des types

    public async Task<List<EtatCatalogueDto>> CatalogueAsync(CancellationToken ct) =>
        (await db.EtatsCatalogue.AsNoTracking().OrderBy(e => e.EtcOrdre).ThenBy(e => e.EtcCode).ToListAsync(ct))
        .Select(e => new EtatCatalogueDto(e.EtcCode, e.EtcLibelle, e.EtcCouleur, e.EtcNature, e.EtcDuree, e.EtcUnite, e.EtcSrvId, e.EtcOrdre, e.EtcActif)).ToList();

    /// <summary>Catalogue des états (administrateur), liste complète : un état retiré est supprimé, ou désactivé s'il sert à un type.</summary>
    public async Task<List<EtatCatalogueDto>> EnregistrerCatalogueAsync(List<EtatCatalogueDto> l, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var erreurs = ReglesEtapes.Controler(l.Select(e => new EtapeOrdre(e.Code?.Trim().ToUpperInvariant() ?? "", e.Nature, e.Duree, e.Unite)).ToList());
        if (l.Any(e => string.IsNullOrWhiteSpace(e.Libelle))) erreurs.Add("ETP_CODE");
        if (erreurs.Count > 0) throw Erreur(erreurs);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var existants = await db.EtatsCatalogue.ToListAsync(ct);
        var codes = l.Select(e => e.Code.Trim().ToUpperInvariant()).ToList();
        var utilises = await db.EtatsTypes.Select(t => t.EttEtcCode).Distinct().ToListAsync(ct);
        foreach (var x in existants.Where(x => !codes.Contains(x.EtcCode)))
        {
            if (utilises.Contains(x.EtcCode)) x.EtcActif = false;
            else db.EtatsCatalogue.Remove(x);
        }
        foreach (var (e, i) in l.Select((e, i) => (e, i)))
        {
            var code = e.Code.Trim().ToUpperInvariant();
            var x = existants.FirstOrDefault(y => y.EtcCode == code);
            if (x is null) db.EtatsCatalogue.Add(x = new EtatCatalogueEntite { EtcCode = code });
            x.EtcLibelle = e.Libelle.Trim();
            x.EtcCouleur = e.Couleur;
            x.EtcNature = e.Nature;
            x.EtcDuree = e.Duree;
            x.EtcUnite = e.Unite;
            x.EtcSrvId = e.SrvId;
            x.EtcOrdre = e.Ordre == 0 ? i + 1 : e.Ordre;
            x.EtcActif = e.Actif;
            x.EtcMajPar = u.Code;
            x.EtcMajLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await CatalogueAsync(ct);
    }

    public async Task<List<EtatTypeDto>> EtatsTypeAsync(string type, CancellationToken ct)
    {
        var cat = await db.EtatsCatalogue.AsNoTracking().ToDictionaryAsync(e => e.EtcCode, ct);
        return (await db.EtatsTypes.AsNoTracking().Where(t => t.EttTypeOrdre == type).OrderBy(t => t.EttOrdre).ToListAsync(ct))
            .Select(t => new EtatTypeDto(t.EttEtcCode, t.EttOrdre, t.EttDateObligatoire, t.EttControle, t.EttControleBloquant, t.EttStatutDocument,
                t.EttAmonts?.ToList(), t.EttDuree, cat.GetValueOrDefault(t.EttEtcCode)?.EtcLibelle, cat.GetValueOrDefault(t.EttEtcCode)?.EtcNature,
                cat.GetValueOrDefault(t.EttEtcCode)?.EtcUnite, cat.GetValueOrDefault(t.EttEtcCode)?.EtcDuree)).ToList();
    }

    /// <summary>États d'un type d'ordre (administrateur) : états du catalogue, contrôle des amonts et des boucles.</summary>
    public async Task<List<EtatTypeDto>> EnregistrerEtatsTypeAsync(string type, List<EtatTypeDto> l, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var cat = await db.EtatsCatalogue.AsNoTracking().ToDictionaryAsync(e => e.EtcCode, ct);
        var erreurs = ReglesEtapes.Controler(l.Select(e => new EtapeOrdre(e.Code, "TACHE", e.Duree ?? 0, "OUV", e.Amonts)).ToList());
        if (l.Any(e => !cat.ContainsKey(e.Code))) erreurs.Add("ETP_INCONNUE");
        if (l.Any(e => e.StatutDocument is not (null or "ENVOYE" or "VALIDE"))) erreurs.Add("ETP_NATURE");
        if (erreurs.Count > 0) throw Erreur(erreurs);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.EtatsTypes.Where(t => t.EttTypeOrdre == type).ExecuteDeleteAsync(ct);
        db.EtatsTypes.AddRange(l.Select((e, i) => new EtatTypeEntite
        {
            EttTypeOrdre = type, EttEtcCode = e.Code, EttOrdre = i + 1, EttDateObligatoire = e.DateObligatoire, EttControle = e.Controle,
            EttControleBloquant = e.ControleBloquant, EttStatutDocument = e.StatutDocument, EttAmonts = e.Amonts?.ToArray(), EttDuree = e.Duree,
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await EtatsTypeAsync(type, ct);
    }

    /// <summary>
    /// « Appliquer aux ordres en cours » (E41) : les ordres non terminés du type reprennent les états du type pour leurs
    /// étapes non validées (ajout, retrait, ordre, durée) ; les étapes validées restent.
    /// </summary>
    public async Task<object> AppliquerTypeAsync(string type, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var ordres = await specialisation.OrdresEnCoursAsync(db, type, ct);
        foreach (var id in ordres)
        {
            if (await specialisation.OrdreAsync(db, id, ct) is not { } o) continue;
            var modele = await DefinitionAsync(o, ct);
            var etapes = await db.EtapesOrdres.Where(e => e.OreOrdreId == id).ToListAsync(ct);
            db.EtapesOrdres.RemoveRange(etapes.Where(e => e.OreValideLe is null && !modele.Any(m => m.OreCode == e.OreCode)));
            foreach (var m in modele)
            {
                var x = etapes.FirstOrDefault(e => e.OreCode == m.OreCode);
                if (x is null) { db.EtapesOrdres.Add(m); continue; }
                x.OreOrdre = m.OreOrdre;
                if (x.OreValideLe is not null) continue;
                (x.OreLibelle, x.OreCouleur, x.OreNature, x.OreDuree, x.OreUnite, x.OreSrvId, x.OreAmonts) =
                    (m.OreLibelle, m.OreCouleur, m.OreNature, m.OreDuree, m.OreUnite, m.OreSrvId, m.OreAmonts);
                (x.OreDateObligatoire, x.OreControle, x.OreControleBloquant, x.OreStatutDocument) = (m.OreDateObligatoire, m.OreControle, m.OreControleBloquant, m.OreStatutDocument);
            }
            await db.SaveChangesAsync(ct);
            await RecalculerAsync(o, ct);
        }
        return new { ordres = ordres.Count };
    }

    // ---------------------------------------------------------------- Étapes d'un ordre

    /// <summary>
    /// États d'un nouvel ordre : ceux de son étape de parcours sur l'élément (même type d'ordre, même service de
    /// préférence) s'ils sont précisés, sinon ceux de son type (E27, E42).
    /// </summary>
    private async Task<List<EtapeOrdreEntite>> DefinitionAsync(OrdreEtapes o, CancellationToken ct)
    {
        var cat = await db.EtatsCatalogue.AsNoTracking().ToDictionaryAsync(e => e.EtcCode, ct);
        var types = await db.EtatsTypes.AsNoTracking().Where(t => t.EttTypeOrdre == o.TypeOrdre).OrderBy(t => t.EttOrdre).ToListAsync(ct);
        List<EtatEtapeDto> retenus = [];
        if (o.IdElement is string el)
        {
            var parcours = await db.Parcours.AsNoTracking().FirstOrDefaultAsync(p => p.ParTypeElement == specialisation.TypeElement && p.ParIdElement == el, ct);
            if (parcours is not null)
            {
                var etapes = await db.EtapesElements.AsNoTracking().Where(e => e.PeeParId == parcours.ParId && e.PeeTypeOrdre == o.TypeOrdre).OrderBy(e => e.PeeOrdre).ToListAsync(ct);
                var etape = etapes.FirstOrDefault(e => e.PeeSrvId == o.SrvId) ?? etapes.FirstOrDefault();
                if (etape is not null) retenus = EtatsEtape.Lire(etape.PeeEtats);
            }
        }
        var definition = retenus.Count > 0
            ? retenus.Where(r => cat.ContainsKey(r.Code)).Select(r =>
                {
                    var t = types.FirstOrDefault(x => x.EttEtcCode == r.Code);
                    return (Code: r.Code, Duree: r.Duree ?? t?.EttDuree, Type: t);
                }).ToList()
            : types.Where(t => cat.ContainsKey(t.EttEtcCode)).Select(t => (Code: t.EttEtcCode, Duree: t.EttDuree, Type: (EtatTypeEntite?)t)).ToList();
        var codes = definition.Select(d => d.Code).ToList();
        return definition.Select((d, i) =>
        {
            var c = cat[d.Code];
            var t = d.Type;
            return new EtapeOrdreEntite
            {
                OreOrdreId = o.Id, OreCode = d.Code, OreLibelle = c.EtcLibelle, OreCouleur = c.EtcCouleur, OreNature = c.EtcNature,
                OreDuree = d.Duree ?? c.EtcDuree, OreUnite = c.EtcUnite, OreSrvId = c.EtcSrvId ?? o.SrvId,
                // Amonts gardés s'ils restent dans la liste retenue ; sinon l'état précédent.
                OreAmonts = t?.EttAmonts is { } a && a.All(codes.Contains) ? a : null,
                OreOrdre = i + 1, OreDateObligatoire = t?.EttDateObligatoire ?? true, OreControle = t?.EttControle ?? false,
                OreControleBloquant = t?.EttControleBloquant ?? true, OreStatutDocument = t?.EttStatutDocument,
            };
        }).ToList();
    }

    private static EtapeOrdre Regle(EtapeOrdreEntite e) => new(e.OreCode, e.OreNature, e.OreDuree, e.OreUnite, e.OreAmonts, e.OreDateObligatoire, e.OreControle,
        e.OreControleBloquant, e.OreValideLe, e.OreControleLe, e.OrePrevuImpose ? e.OrePrevuLe : null, e.OreOrdre);

    private async Task<OrdreEtapes> OrdreAsync(long id, CancellationToken ct) =>
        await specialisation.OrdreAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable($"Ordre {id}");

    /// <summary>Étapes de l'ordre, créées à la première lecture (ordres antérieurs aux étapes compris, E40).</summary>
    private async Task<List<EtapeOrdreEntite>> EtapesAsync(OrdreEtapes o, CancellationToken ct)
    {
        var etapes = await db.EtapesOrdres.Where(e => e.OreOrdreId == o.Id).OrderBy(e => e.OreOrdre).ToListAsync(ct);
        if (etapes.Count > 0) return o.Clos ? etapes : await SynchroniserPlanningAsync(o, etapes, ct);
        if (o.Clos) return etapes;
        etapes = await DefinitionAsync(o, ct);
        if (etapes.Count == 0) return etapes;
        db.EtapesOrdres.AddRange(etapes);
        await db.SaveChangesAsync(ct);
        await RecalculerAsync(o, ct);
        return etapes;
    }

    /// <summary>
    /// Planning → étapes (§ 13.5, E48) : une tâche liée déplacée impose son dernier jour à l'étape non validée ; sa
    /// ressource (première affectation) devient celle de l'étape, sauf si c'est celle de l'ordre ; tâche supprimée : lien
    /// retiré. Dates recalculées s'il y a eu un changement.
    /// </summary>
    private async Task<List<EtapeOrdreEntite>> SynchroniserPlanningAsync(OrdreEtapes o, List<EtapeOrdreEntite> etapes, CancellationToken ct)
    {
        var liees = etapes.Where(e => e.OreTacId is not null).ToList();
        if (liees.Count == 0) return etapes;
        var taches = (await specialisation.TachesAsync(db, liees.Select(e => e.OreTacId!.Value).ToList(), ct)).ToDictionary(t => t.TacId);
        static string? Cle(string? json)
        {
            if (json is null) return null;
            var r = JsonDocument.Parse(json).RootElement;
            return $"{(r.TryGetProperty("type", out var t) ? t.ToString() : "")}:{(r.TryGetProperty("id", out var i) ? i.ToString() : "")}";
        }
        var change = false;
        foreach (var e in liees)
        {
            if (!taches.TryGetValue(e.OreTacId!.Value, out var t)) { e.OreTacId = null; change = true; continue; }
            if (e.OreValideLe is not null) continue;
            if (e.OrePrevuLe != t.Fin) { (e.OrePrevuLe, e.OrePrevuImpose) = (t.Fin, true); change = true; }
            var cle = Cle(t.Ressource);
            if (cle is not null && cle != Cle(e.OreRessource) && !(e.OreRessource is null && cle == Cle(o.Ressource))) { e.OreRessource = t.Ressource; change = true; }
        }
        if (!change) return etapes;
        await db.SaveChangesAsync(ct);
        return await RecalculerAsync(o, ct);
    }

    /// <summary>Lien d'une étape à sa tâche du planning (planning théorique par états, posé par l'application).</summary>
    public async Task LierTacheAsync(long ordre, string code, long? tache, CancellationToken ct) =>
        await db.EtapesOrdres.Where(e => e.OreOrdreId == ordre && e.OreCode == code).ExecuteUpdateAsync(x => x.SetProperty(e => e.OreTacId, tache), ct);

    /// <summary>Étapes d'un ordre avec leurs dates (planning théorique par états, application).</summary>
    public async Task<List<EtapeOrdreEntite>> EtapesOrdreAsync(long id, CancellationToken ct) => await EtapesAsync(await OrdreAsync(id, ct), ct);

    /// <summary>Copie des étapes d'un ordre (création ou validation par l'application) ; sans effet si elles existent.</summary>
    public async Task InitialiserAsync(long id, CancellationToken ct)
    {
        if (await specialisation.OrdreAsync(db, id, ct) is { } o) await EtapesAsync(o, ct);
    }

    /// <summary>Dates prévisionnelles recalculées (les étapes validées gardent leur dernière date prévue, les imposées la leur).</summary>
    private async Task<List<EtapeOrdreEntite>> RecalculerAsync(OrdreEtapes o, CancellationToken ct)
    {
        var etapes = await db.EtapesOrdres.Where(e => e.OreOrdreId == o.Id).OrderBy(e => e.OreOrdre).ToListAsync(ct);
        if (etapes.Count == 0) return etapes;
        var debut = o.Debut ?? DateOnly.FromDateTime(DateTime.Today);
        var calendrier = await specialisation.CalendrierAsync(db, o.SrvId, debut, debut.AddDays(400), ct);
        var dates = ReglesEtapes.Dates(etapes.Select(Regle).ToList(), debut, calendrier);
        foreach (var e in etapes)
        {
            var d = dates.First(x => x.Code == e.OreCode);
            e.OreDebutLe = d.Debut;
            if (e.OreValideLe is null && !e.OrePrevuImpose) e.OrePrevuLe = d.Prevu;
            e.OreMajLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        return etapes;
    }

    private static object Dto(EtapeOrdreEntite e) => new
    {
        code = e.OreCode, libelle = e.OreLibelle, couleur = e.OreCouleur, nature = e.OreNature, duree = e.OreDuree, unite = e.OreUnite, srv_id = e.OreSrvId,
        amonts = e.OreAmonts, ordre = e.OreOrdre, date_obligatoire = e.OreDateObligatoire, controle = e.OreControle, controle_bloquant = e.OreControleBloquant,
        statut_document = e.OreStatutDocument, debut_le = e.OreDebutLe, prevu_le = e.OrePrevuLe, prevu_impose = e.OrePrevuImpose, valide_le = e.OreValideLe,
        valide_par = e.OreValidePar, controle_le = e.OreControleLe, controle_par = e.OreControlePar, commentaire = e.OreCommentaire,
        ressource = e.OreRessource is null ? (JsonElement?)null : JsonDocument.Parse(e.OreRessource).RootElement.Clone(), tac_id = e.OreTacId,
        en_retard = e.OreValideLe is null && e.OrePrevuLe < DateOnly.FromDateTime(DateTime.Today),
    };

    private async Task<object> ReponseAsync(OrdreEtapes o, List<EtapeOrdreEntite> etapes, List<string> avertissements, Utilisateur u, CancellationToken ct)
    {
        var regles = etapes.Select(Regle).ToList();
        return new
        {
            etapes = etapes.OrderBy(e => e.OreOrdre).Select(Dto), en_cours = ReglesEtapes.EnCours(regles),
            etat = regles.Any(r => r.ValideLe is not null) ? ReglesEtapes.EtatExecution(regles, o.Etat) : o.Etat,
            peut_valider = await specialisation.PeutValiderAsync(db, o, null, u, ct), peut_controler = await specialisation.PeutControlerAsync(db, o, u, ct),
            avertissements = avertissements.Select(c => Messages.GetValueOrDefault(c, c)),
        };
    }

    /// <summary>Étapes d'un ordre pour l'écran de l'atelier (sans droits : l'application filtre les ordres).</summary>
    public async Task<object?> AtelierAsync(long id, CancellationToken ct)
    {
        if (await specialisation.OrdreAsync(db, id, ct) is not { Clos: false } o) return null;
        var etapes = await EtapesAsync(o, ct);
        return new { etapes = etapes.OrderBy(e => e.OreOrdre).Select(Dto), en_cours = ReglesEtapes.EnCours(etapes.Select(Regle).ToList()) };
    }

    public async Task<object> LireAsync(long id, Utilisateur u, CancellationToken ct)
    {
        var o = await OrdreAsync(id, ct);
        return await ReponseAsync(o, await EtapesAsync(o, ct), [], u, ct);
    }

    /// <summary>« ⟳ Recalculer » : les dates imposées rendent la main au calcul (E37).</summary>
    public async Task<object> RecalculerToutAsync(long id, Utilisateur u, CancellationToken ct)
    {
        var o = await OrdreAsync(id, ct);
        if (!await specialisation.PeutValiderAsync(db, o, null, u, ct)) throw ExceptionMetier.AccesRefuse("ETAPES");
        await db.EtapesOrdres.Where(e => e.OreOrdreId == id && e.OreValideLe == null).ExecuteUpdateAsync(x => x.SetProperty(e => e.OrePrevuImpose, false), ct);
        var etapes = await RecalculerAsync(o, ct);
        var av = await Suites(o, etapes, [], "dates prévisionnelles recalculées", false, u, ct);
        return await ReponseAsync(o, etapes, av, u, ct);
    }

    /// <summary>
    /// Action sur une étape : VALIDER (avec les étapes masquées précédentes, E28), ANNULER (motif), CONTROLER /
    /// DECONTROLER (N+1), PREVOIR (date imposée ; vide : calculée), RESSOURCE (vide : celle de l'ordre), DUREE.
    /// </summary>
    /// <param name="droitVerifie">Droit déjà vérifié par l'application (borne : salarié identifié, E51).</param>
    public async Task<object> ActionAsync(long id, string code, ActionEtape s, Utilisateur u, CancellationToken ct, bool droitVerifie = false)
    {
        var o = await OrdreAsync(id, ct);
        if (o.Clos) throw ExceptionMetier.Conflit("EXE_CLOS", "Ordre annulé ou remplacé : étapes non modifiables");
        var etapes = await EtapesAsync(o, ct);
        var e = etapes.FirstOrDefault(x => x.OreCode == code) ?? throw ExceptionMetier.Introuvable($"Étape {code}");
        var regles = etapes.Select(Regle).ToList();
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        var avertissements = new List<string>();
        var statuts = new List<string>();
        var terminees = new List<long>();
        var aControler = new List<string>();
        DateOnly? deplacer = null;
        string detail;
        var deduire = false;
        switch (s.Action)
        {
            case "VALIDER":
            {
                if (!droitVerifie && !await specialisation.PeutValiderAsync(db, o, e, u, ct)) throw ExceptionMetier.AccesRefuse("VALIDER_ETAPE");
                var r = ReglesEtapes.AValider(regles, code);
                if (r.Erreurs.Count > 0) throw Erreur(r.Erreurs);
                avertissements.AddRange(r.Avertissements);
                foreach (var x in etapes.Where(x => r.Codes.Contains(x.OreCode)))
                {
                    x.OreValideLe = s.Date ?? aujourdhui;
                    x.OreValidePar = u.Code;
                    if (x.OreCode == code && !string.IsNullOrWhiteSpace(s.Commentaire)) x.OreCommentaire = s.Commentaire.Trim();
                    if (x.OreStatutDocument is string st) statuts.Add(st);
                    if (x.OreTacId is long tac) terminees.Add(tac);
                    if (x.OreControle && x.OreControleLe is null) aControler.Add(x.OreLibelle);
                }
                detail = $"étape validée : {string.Join(", ", etapes.Where(x => r.Codes.Contains(x.OreCode)).Select(x => x.OreLibelle))}";
                deduire = true;
                break;
            }
            case "ANNULER":
            {
                if (!await specialisation.PeutValiderAsync(db, o, e, u, ct)) throw ExceptionMetier.AccesRefuse("VALIDER_ETAPE");
                var r = ReglesEtapes.ControlerAnnulation(regles, code);
                if (r.Count > 0) throw Erreur(r);
                if (string.IsNullOrWhiteSpace(s.Commentaire)) throw ExceptionMetier.Invalide("ETP_MOTIF", "Motif obligatoire pour annuler la validation d'une étape");
                (e.OreValideLe, e.OreValidePar, e.OreControleLe, e.OreControlePar) = (null, null, null, null);
                detail = $"validation annulée : {e.OreLibelle} ({s.Commentaire.Trim()})";
                deduire = true;
                break;
            }
            case "CONTROLER" or "DECONTROLER":
            {
                if (!await specialisation.PeutControlerAsync(db, o, u, ct)) throw ExceptionMetier.AccesRefuse("CONTROLER_ETAPE");
                if (!e.OreControle) throw Erreur(["ETP_SANS_CONTROLE"]);
                if (e.OreValideLe is null) throw Erreur(["ETP_NON_VALIDEE"]);
                var oui = s.Action == "CONTROLER";
                e.OreControleLe = oui ? s.Date ?? aujourdhui : null;
                e.OreControlePar = oui ? u.Code : null;
                if (oui && !string.IsNullOrWhiteSpace(s.Commentaire)) e.OreCommentaire = s.Commentaire.Trim();
                detail = $"{(oui ? "contrôle du N+1" : "contrôle retiré")} : {e.OreLibelle}";
                break;
            }
            case "PREVOIR":
                if (!await specialisation.PeutValiderAsync(db, o, e, u, ct)) throw ExceptionMetier.AccesRefuse("ETAPES");
                (e.OrePrevuLe, e.OrePrevuImpose) = s.Date is { } d ? (d, true) : (e.OrePrevuLe, false);
                deplacer = s.Date;
                detail = s.Date is { } dd ? $"date imposée : {e.OreLibelle} au {dd:dd/MM/yyyy}" : $"date recalculée : {e.OreLibelle}";
                break;
            case "RESSOURCE":
                if (!await specialisation.PeutValiderAsync(db, o, e, u, ct)) throw ExceptionMetier.AccesRefuse("ETAPES");
                e.OreRessource = s.Ressource is { ValueKind: JsonValueKind.Object } r2 ? r2.GetRawText() : null;
                detail = $"ressource : {e.OreLibelle}";
                break;
            case "DUREE":
                if (!await specialisation.PeutValiderAsync(db, o, e, u, ct)) throw ExceptionMetier.AccesRefuse("ETAPES");
                if (s.Duree is not { } du || du < 0) throw Erreur(["ETP_DUREE"]);
                e.OreDuree = du;
                detail = $"durée : {e.OreLibelle} {du}";
                break;
            default:
                throw ExceptionMetier.Invalide("ETP_ACTION", $"Action inconnue : {s.Action}");
        }
        e.OreMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        etapes = await RecalculerAsync(o, ct);
        // Étapes → planning : la tâche liée suit la date prévue modifiée (date imposée, recalcul, durée).
        var cible = etapes.First(x => x.OreCode == code);
        var deplacements = cible.OreTacId is long t && cible.OreValideLe is null && (s.Action is "PREVOIR" or "DUREE") && (deplacer ?? cible.OrePrevuLe) is DateOnly f
            ? new List<(long, DateOnly)> { (t, f) } : [];
        avertissements.AddRange(await Suites(o, etapes, statuts, detail, deduire, u, ct, deplacements, terminees, aControler));
        return await ReponseAsync(await OrdreAsync(id, ct), etapes, avertissements, u, ct);
    }

    /// <summary>Suites transmises à l'application : état déduit (après une validation ou une annulation), statuts, dates.</summary>
    private async Task<List<string>> Suites(OrdreEtapes o, List<EtapeOrdreEntite> etapes, List<string> statuts, string detail, bool deduire, Utilisateur u, CancellationToken ct,
        List<(long, DateOnly)>? deplacements = null, List<long>? terminees = null, List<string>? aControler = null)
    {
        var regles = etapes.Select(Regle).ToList();
        var etat = deduire ? ReglesEtapes.EtatExecution(regles, o.Etat) : null;
        var debut = etapes.Select(e => e.OreDebutLe).Where(d => d is not null).Min();
        var fin = etapes.Select(e => e.OreValideLe ?? e.OrePrevuLe).Where(d => d is not null).Max();
        return await specialisation.ApresEtapesAsync(db, o, new SuitesEtapes(etat, statuts.Distinct().ToList(), debut, fin, detail)
        {
            Deplacements = deplacements ?? [], Terminees = terminees ?? [], AControler = aControler ?? [],
        }, u, ct);
    }
}
