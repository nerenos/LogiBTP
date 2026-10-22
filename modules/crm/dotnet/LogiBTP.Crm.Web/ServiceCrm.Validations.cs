using LogiBTP.Crm;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Crm.Web;

/// <summary>Statut de visa lu ou saisi.</summary>
public sealed record StatutVisaDto(string Code, string Libelle, string Effet, int Ordre, bool Actif);

/// <summary>Plan saisi.</summary>
public sealed record PlanSaisi(string Repere, string? RepereCctp, string Nom, string? Lot, string? Finition, string? MessageHtml, string? TypeElement, string? IdElement,
    DateTimeOffset? MajLe = null);

/// <summary>Visa lu : tiers, contact, attendu, statut reçu, observation, plan annoté, bordereau d'origine.</summary>
public sealed record VisaDto(long Id, long IndiceId, long TiersId, ElementDecrit? Tiers, long? IndId, ElementDecrit? Contact, DateOnly? AttenduLe, string? Statut,
    string? StatutLibelle, string? Effet, DateOnly? RecuLe, string? Observation, long? DgeRetourId, long? DiffusionId, string? DiffusionNumero);

/// <summary>Indice lu avec ses visas.</summary>
public sealed record IndiceDto(long Id, string Indice, DateOnly? Date, string? Motif, long? DgeId, long? RgeId, string CreePar, DateTimeOffset CreeLe, List<VisaDto> Visas);

/// <summary>Plan lu : saisie, élément, état calculé (ReglesValidation), nombre d'indices.</summary>
public sealed record PlanDto(long Id, string Repere, string? RepereCctp, string Nom, string? Lot, string? Finition, string? MessageHtml, string? TypeElement,
    string? IdElement, ElementDecrit? Element, EtatPlan Etat, string CreePar, DateTimeOffset MajLe, int NbIndices);

/// <summary>Plan détaillé : indices et visas.</summary>
public sealed record PlanDetail(PlanDto Plan, List<IndiceDto> Indices);

/// <summary>
/// Indice saisi (indice vide : suivant du dernier, ou indice vide — le premier — si le plan n'en a pas) ; répertoire de
/// la GED de l'indice (ses fichiers), créé par l'écran.
/// </summary>
public sealed record IndiceSaisi(string? Indice, DateOnly? Date, string? Motif, long? DgeId, long? RgeId = null);

/// <summary>Visa attendu d'un tiers.</summary>
public sealed record VisaAttendu(long TiersId, long? IndId, DateOnly? AttenduLe);

/// <summary>Visa reçu (statut nul : redevient attendu).</summary>
public sealed record VisaSaisi(string? Statut, DateOnly? RecuLe, string? Observation, long? DgeRetourId);

/// <summary>Pièce d'un bordereau saisie : indice de plan ou document de la GED.</summary>
public sealed record PieceSaisie(long? PinId, long? DgeId, string? Libelle);

/// <summary>Destinataire d'un bordereau saisi.</summary>
public sealed record DestinataireSaisi(long TiersId, long? IndId, string Mode, int Exemplaires, bool AttendVisa);

/// <summary>Bordereau saisi.</summary>
public sealed record DiffusionSaisie(DateOnly Date, string Objet, string? TypeElement, string? IdElement, int DelaiVisaJours, List<PieceSaisie> Pieces,
    List<DestinataireSaisi> Destinataires);

/// <summary>Pièce lue d'un bordereau.</summary>
public sealed record PieceDto(long Id, long? PinId, long? PlanId, long? DgeId, string Libelle);

/// <summary>Destinataire lu : tiers, contact, mode, exemplaires, visa attendu, tâche de retour, visas reçus et attendus.</summary>
public sealed record DestinataireDto2(long Id, long TiersId, ElementDecrit? Tiers, long? IndId, ElementDecrit? Contact, string Mode, int Exemplaires, bool AttendVisa,
    long? NoteId, int VisasRecus, int VisasAttendus);

/// <summary>Bordereau lu.</summary>
public sealed record DiffusionDto(long Id, string Numero, DateOnly Date, string Objet, string? TypeElement, string? IdElement, ElementDecrit? Element, int DelaiVisaJours,
    string CreePar, DateTimeOffset CreeLe, List<PieceDto> Pieces, List<DestinataireDto2> Destinataires);

/// <summary>Suivi des validations et bordereaux de diffusion (lot 4).</summary>
public partial class ServiceCrm
{
    public static readonly string[] ModesDiffusion = ["COURRIEL", "PAPIER", "PLATEFORME", "MAIN_PROPRE"];

    private static DateOnly Aujourdhui() => DateOnly.FromDateTime(DateTime.Now);

    // ------------------------------------------------------------------ statuts de visa

    public Task<List<StatutVisaDto>> StatutsVisa(CancellationToken ct) =>
        db.StatutsVisa.AsNoTracking().OrderBy(s => s.StvOrdre).Select(s => new StatutVisaDto(s.StvCode, s.StvLibelle, s.StvEffet, s.StvOrdre, s.StvActif)).ToListAsync(ct);

    /// <summary>Liste complète (administrateur) ; un statut retiré déjà utilisé est désactivé.</summary>
    public async Task<List<StatutVisaDto>> EnregistrerStatutsVisa(List<StatutVisaDto> statuts, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        if (statuts.Any(s => string.IsNullOrWhiteSpace(s.Code) || string.IsNullOrWhiteSpace(s.Libelle) || !ReglesValidation.Effets.Contains(s.Effet)))
        {
            throw ExceptionMetier.Invalide("STATUT_VISA", "Code, libellé et effet (ACCEPTE, REFUSE, NEUTRE) obligatoires");
        }
        var codes = statuts.Select(s => s.Code.Trim().ToUpperInvariant()).ToList();
        if (codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("STATUT_VISA", "Codes en double");
        var existants = await db.StatutsVisa.ToListAsync(ct);
        foreach (var x in existants.Where(x => !codes.Contains(x.StvCode)))
        {
            if (await db.Visas.AnyAsync(v => v.VisStvCode == x.StvCode, ct)) x.StvActif = false;
            else db.StatutsVisa.Remove(x);
        }
        foreach (var s in statuts)
        {
            var code = s.Code.Trim().ToUpperInvariant();
            var e = existants.FirstOrDefault(x => x.StvCode == code) ?? db.StatutsVisa.Add(new CrmStatutVisa { StvCode = code }).Entity;
            e.StvLibelle = s.Libelle.Trim();
            e.StvEffet = s.Effet;
            e.StvOrdre = s.Ordre;
            e.StvActif = s.Actif;
        }
        await db.SaveChangesAsync(ct);
        return await StatutsVisa(ct);
    }

    // ------------------------------------------------------------------ plans

    public async Task<List<PlanDto>> Plans(string? typeElement, string? idElement, string? recherche, CancellationToken ct)
    {
        var q = db.Plans.AsNoTracking();
        if (!string.IsNullOrEmpty(typeElement) && !string.IsNullOrEmpty(idElement)) q = q.Where(p => p.PlaTypeElement == typeElement && p.PlaIdElement == idElement);
        if (!string.IsNullOrWhiteSpace(recherche))
        {
            var m = $"%{recherche.Trim()}%";
            q = q.Where(p => EF.Functions.ILike(p.PlaRepere, m) || EF.Functions.ILike(p.PlaNom, m) || EF.Functions.ILike(p.PlaLot ?? "", m));
        }
        var plans = await q.OrderBy(p => p.PlaLot).ThenBy(p => p.PlaRepere).Take(500).ToListAsync(ct);
        return await EnPlans(plans, ct);
    }

    private async Task<Dictionary<string, string>> EffetsAsync(CancellationToken ct) =>
        await db.StatutsVisa.AsNoTracking().ToDictionaryAsync(s => s.StvCode, s => s.StvEffet, ct);

    private async Task<List<PlanDto>> EnPlans(List<CrmPlan> plans, CancellationToken ct)
    {
        if (plans.Count == 0) return [];
        var ids = plans.Select(p => p.PlaId).ToList();
        var indices = await db.Indices.AsNoTracking().Where(i => ids.Contains(i.PinPlaId)).OrderBy(i => i.PinCreeLe).ThenBy(i => i.PinId).ToListAsync(ct);
        var idsIndices = indices.Select(i => i.PinId).ToList();
        var visas = await db.Visas.AsNoTracking().Where(v => idsIndices.Contains(v.VisPinId)).ToListAsync(ct);
        var effets = await EffetsAsync(ct);
        var elements = (await DecrireAsync(plans.Where(p => p.PlaTypeElement != null && p.PlaIdElement != null)
            .Select(p => new ElementCrm(p.PlaTypeElement!, p.PlaIdElement!)).ToList(), ct)).ToDictionary(e => (e.Type, e.Id));
        var aujourdhui = Aujourdhui();
        return plans.Select(p =>
        {
            var siens = indices.Where(i => i.PinPlaId == p.PlaId).Select(i => new IndiceAEvaluer(i.PinIndice, i.PinDate,
                visas.Where(v => v.VisPinId == i.PinId).Select(v => new VisaAEvaluer(v.VisStvCode, v.VisAttenduLe)).ToList())).ToList();
            return new PlanDto(p.PlaId, p.PlaRepere, p.PlaRepereCctp, p.PlaNom, p.PlaLot, p.PlaFinition, p.PlaMessageHtml, p.PlaTypeElement, p.PlaIdElement,
                p.PlaTypeElement is string t && p.PlaIdElement is string id ? elements.GetValueOrDefault((t, id)) : null,
                ReglesValidation.Etat(siens, effets, aujourdhui), p.PlaCreePar, p.PlaMajLe, siens.Count);
        }).ToList();
    }

    public async Task<PlanDetail> Plan(long id, CancellationToken ct)
    {
        var p = await db.Plans.AsNoTracking().FirstOrDefaultAsync(x => x.PlaId == id, ct) ?? throw ExceptionMetier.Introuvable($"Plan {id}");
        var indices = await db.Indices.AsNoTracking().Where(i => i.PinPlaId == id).OrderBy(i => i.PinCreeLe).ThenBy(i => i.PinId).ToListAsync(ct);
        var idsIndices = indices.Select(i => i.PinId).ToList();
        var visas = await db.Visas.AsNoTracking().Where(v => idsIndices.Contains(v.VisPinId)).OrderBy(v => v.VisId).ToListAsync(ct);
        var liste = indices.Select(i => new IndiceDto(i.PinId, i.PinIndice, i.PinDate, i.PinMotif, i.PinDgeId, i.PinRgeId, i.PinCreePar, i.PinCreeLe, [])).ToList();
        return new PlanDetail((await EnPlans([p], ct))[0], await AvecVisas(liste, visas, ct));
    }

    private async Task<List<IndiceDto>> AvecVisas(List<IndiceDto> indices, List<CrmVisa> visas, CancellationToken ct)
    {
        var statuts = await db.StatutsVisa.AsNoTracking().ToDictionaryAsync(s => s.StvCode, ct);
        var elements = (await DecrireAsync(visas.Select(v => new ElementCrm("personne", v.VisTiersId.ToString()))
            .Concat(visas.Where(v => v.VisIndId != null).Select(v => new ElementCrm("individu", v.VisIndId!.Value.ToString()))).ToList(), ct)).ToDictionary(e => (e.Type, e.Id));
        var dfd = visas.Where(v => v.VisDfdId != null).Select(v => v.VisDfdId!.Value).Distinct().ToList();
        var numeros = await (from d in db.DestinatairesDiffusion.AsNoTracking() join f in db.Diffusions.AsNoTracking() on d.DfdDifId equals f.DifId
                             where dfd.Contains(d.DfdId) select new { d.DfdId, f.DifId, f.DifNumero }).ToDictionaryAsync(x => x.DfdId, ct);
        return indices.Select(i => i with
        {
            Visas = visas.Where(v => v.VisPinId == i.Id).Select(v =>
            {
                statuts.TryGetValue(v.VisStvCode ?? "", out var s);
                var origine = v.VisDfdId is long x && numeros.TryGetValue(x, out var n) ? n : null;
                return new VisaDto(v.VisId, v.VisPinId, v.VisTiersId, elements.GetValueOrDefault(("personne", v.VisTiersId.ToString())), v.VisIndId,
                    v.VisIndId is long ind ? elements.GetValueOrDefault(("individu", ind.ToString())) : null, v.VisAttenduLe, v.VisStvCode, s?.StvLibelle, s?.StvEffet,
                    v.VisRecuLe, v.VisObservation, v.VisDgeRetourId, origine?.DifId, origine?.DifNumero);
            }).ToList(),
        }).ToList();
    }

    public async Task<PlanDetail> EnregistrerPlan(long? id, PlanSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(s.Repere) || string.IsNullOrWhiteSpace(s.Nom)) throw ExceptionMetier.Invalide("PLAN", "Repère et nom du plan obligatoires");
        CrmPlan p;
        if (id is long x)
        {
            p = await db.Plans.FirstOrDefaultAsync(z => z.PlaId == x, ct) ?? throw ExceptionMetier.Introuvable($"Plan {x}");
            if (s.MajLe is DateTimeOffset maj && Math.Abs((maj - p.PlaMajLe).TotalMilliseconds) >= 1)
            {
                throw ExceptionMetier.Conflit("PLAN_MODIFIE", $"Plan modifié entre-temps par {p.PlaMajPar ?? p.PlaCreePar} : rechargez-le");
            }
        }
        else p = db.Plans.Add(new CrmPlan { PlaCreePar = u.Code, PlaCreeLe = DateTimeOffset.UtcNow }).Entity;
        p.PlaRepere = s.Repere.Trim();
        p.PlaRepereCctp = string.IsNullOrWhiteSpace(s.RepereCctp) ? null : s.RepereCctp.Trim();
        p.PlaNom = s.Nom.Trim();
        p.PlaLot = string.IsNullOrWhiteSpace(s.Lot) ? null : s.Lot.Trim();
        p.PlaFinition = string.IsNullOrWhiteSpace(s.Finition) ? null : s.Finition.Trim();
        p.PlaMessageHtml = nettoyage.Nettoyer(s.MessageHtml);
        p.PlaTypeElement = string.IsNullOrWhiteSpace(s.TypeElement) ? null : s.TypeElement;
        p.PlaIdElement = string.IsNullOrWhiteSpace(s.IdElement) ? null : s.IdElement;
        p.PlaMajPar = u.Code;
        p.PlaMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await Plan(p.PlaId, ct);
    }

    /// <summary>Suppression : sans visa reçu ni diffusion, sinon l'administrateur.</summary>
    public async Task SupprimerPlan(long id, Utilisateur u, CancellationToken ct)
    {
        var indices = await db.Indices.Where(i => i.PinPlaId == id).Select(i => i.PinId).ToListAsync(ct);
        var utilise = await db.Visas.AnyAsync(v => indices.Contains(v.VisPinId) && v.VisStvCode != null, ct)
            || await db.PiecesDiffusion.AnyAsync(d => d.DfpPinId != null && indices.Contains(d.DfpPinId.Value), ct);
        if (utilise && !u.EstAdmin) throw ExceptionMetier.Conflit("PLAN_UTILISE", "Plan diffusé ou visé : suppression réservée à l'administrateur");
        if (await db.Plans.Where(p => p.PlaId == id).ExecuteDeleteAsync(ct) == 0) throw ExceptionMetier.Introuvable($"Plan {id}");
    }

    public async Task<PlanDetail> AjouterIndice(long plan, IndiceSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (!await db.Plans.AnyAsync(p => p.PlaId == plan, ct)) throw ExceptionMetier.Introuvable($"Plan {plan}");
        var dernier = await db.Indices.Where(i => i.PinPlaId == plan).OrderByDescending(i => i.PinCreeLe).ThenByDescending(i => i.PinId).Select(i => i.PinIndice).FirstOrDefaultAsync(ct);
        var indice = string.IsNullOrWhiteSpace(s.Indice) ? (dernier is null ? "" : ReglesValidation.IndiceSuivant(dernier)) : s.Indice.Trim().ToUpperInvariant();
        if (indice.Length > 5) throw ExceptionMetier.Invalide("INDICE", "Indice de 5 caractères au plus");
        if (await db.Indices.AnyAsync(i => i.PinPlaId == plan && i.PinIndice == indice, ct)) throw ExceptionMetier.Conflit("INDICE_EXISTANT", $"L'indice {indice} existe déjà");
        db.Indices.Add(new CrmPlanIndice { PinPlaId = plan, PinIndice = indice, PinDate = s.Date, PinMotif = s.Motif, PinDgeId = s.DgeId, PinRgeId = s.RgeId, PinCreePar = u.Code, PinCreeLe = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(ct);
        var pl = await db.Plans.AsNoTracking().FirstAsync(p => p.PlaId == plan, ct);
        await PublierAsync("INDICE", pl.PlaTypeElement, pl.PlaIdElement, $"Plan {pl.PlaRepere} – {pl.PlaNom} : {(indice == "" ? "premier indice" : $"indice {indice}")}{(string.IsNullOrWhiteSpace(s.Motif) ? "" : $" ({s.Motif})")}",
            $"/crm/plan/{plan}", u.Code, ct);
        return await Plan(plan, ct);
    }

    public async Task<PlanDetail> ModifierIndice(long id, IndiceSaisi s, CancellationToken ct)
    {
        var i = await db.Indices.FirstOrDefaultAsync(x => x.PinId == id, ct) ?? throw ExceptionMetier.Introuvable($"Indice {id}");
        i.PinDate = s.Date;
        i.PinMotif = s.Motif;
        i.PinDgeId = s.DgeId;
        i.PinRgeId = s.RgeId ?? i.PinRgeId;
        await db.SaveChangesAsync(ct);
        return await Plan(i.PinPlaId, ct);
    }

    public async Task<PlanDetail> SupprimerIndice(long id, Utilisateur u, CancellationToken ct)
    {
        var i = await db.Indices.FirstOrDefaultAsync(x => x.PinId == id, ct) ?? throw ExceptionMetier.Introuvable($"Indice {id}");
        var utilise = await db.Visas.AnyAsync(v => v.VisPinId == id && v.VisStvCode != null, ct) || await db.PiecesDiffusion.AnyAsync(d => d.DfpPinId == id, ct);
        if (utilise && !u.EstAdmin) throw ExceptionMetier.Conflit("INDICE_UTILISE", "Indice diffusé ou visé : suppression réservée à l'administrateur");
        db.Indices.Remove(i);
        await db.SaveChangesAsync(ct);
        return await Plan(i.PinPlaId, ct);
    }

    // ------------------------------------------------------------------ visas

    public async Task<PlanDetail> AjouterVisa(long indice, VisaAttendu s, Utilisateur u, CancellationToken ct)
    {
        var i = await db.Indices.AsNoTracking().FirstOrDefaultAsync(x => x.PinId == indice, ct) ?? throw ExceptionMetier.Introuvable($"Indice {indice}");
        if (await db.Visas.AnyAsync(v => v.VisPinId == indice && v.VisTiersId == s.TiersId, ct)) throw ExceptionMetier.Conflit("VISA_EXISTANT", "Ce tiers a déjà un visa sur cet indice");
        db.Visas.Add(new CrmVisa { VisPinId = indice, VisTiersId = s.TiersId, VisIndId = s.IndId, VisAttenduLe = s.AttenduLe, VisMajPar = u.Code, VisMajLe = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(ct);
        return await Plan(i.PinPlaId, ct);
    }

    /// <summary>Visa reçu (ou remis en attente) ; la tâche de retour du bordereau est terminée quand tous ses visas sont reçus.</summary>
    public async Task<PlanDetail> SaisirVisa(long id, VisaSaisi s, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Visas.FirstOrDefaultAsync(x => x.VisId == id, ct) ?? throw ExceptionMetier.Introuvable($"Visa {id}");
        if (s.Statut is not null && !await db.StatutsVisa.AnyAsync(x => x.StvCode == s.Statut, ct)) throw ExceptionMetier.Invalide("STATUT_VISA", $"Statut de visa inconnu : {s.Statut}");
        v.VisStvCode = s.Statut;
        v.VisRecuLe = s.Statut is null ? null : s.RecuLe ?? Aujourdhui();
        v.VisObservation = string.IsNullOrWhiteSpace(s.Observation) ? null : s.Observation.Trim();
        v.VisDgeRetourId = s.DgeRetourId;
        v.VisMajPar = u.Code;
        v.VisMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        if (v.VisDfdId is long dfd) await MajTacheRetour(dfd, u, ct);
        var ind = await db.Indices.AsNoTracking().FirstAsync(i => i.PinId == v.VisPinId, ct);
        if (s.Statut is not null)
        {
            var pl = await db.Plans.AsNoTracking().FirstAsync(p => p.PlaId == ind.PinPlaId, ct);
            var statut = await db.StatutsVisa.AsNoTracking().Where(x => x.StvCode == s.Statut).Select(x => x.StvLibelle).FirstAsync(ct);
            var tiers = (await DecrireAsync([new ElementCrm("personne", v.VisTiersId.ToString())], ct)).FirstOrDefault()?.Libelle ?? $"tiers {v.VisTiersId}";
            await PublierAsync("VISA", pl.PlaTypeElement, pl.PlaIdElement, $"Visa « {statut} » de {tiers} : plan {pl.PlaRepere} indice {ind.PinIndice}", $"/crm/plan/{pl.PlaId}", u.Code, ct);
        }
        return await Plan(ind.PinPlaId, ct);
    }

    public async Task<PlanDetail> SupprimerVisa(long id, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Visas.FirstOrDefaultAsync(x => x.VisId == id, ct) ?? throw ExceptionMetier.Introuvable($"Visa {id}");
        if (v.VisStvCode is not null && !u.EstAdmin) throw ExceptionMetier.Conflit("VISA_RECU", "Visa reçu : remettez-le en attente ou demandez à l'administrateur");
        var plan = await db.Indices.Where(i => i.PinId == v.VisPinId).Select(i => i.PinPlaId).FirstAsync(ct);
        db.Visas.Remove(v);
        await db.SaveChangesAsync(ct);
        if (v.VisDfdId is long dfd) await MajTacheRetour(dfd, u, ct);
        return await Plan(plan, ct);
    }

    /// <summary>Tâche de retour d'un destinataire : terminée quand tous ses visas sont reçus, rouverte sinon.</summary>
    private async Task MajTacheRetour(long dfd, Utilisateur u, CancellationToken ct)
    {
        var d = await db.DestinatairesDiffusion.AsNoTracking().FirstOrDefaultAsync(x => x.DfdId == dfd, ct);
        if (d?.DfdNotId is not long note) return;
        var complet = !await db.Visas.AnyAsync(v => v.VisDfdId == dfd && v.VisStvCode == null, ct);
        var n = await db.Notes.FirstOrDefaultAsync(x => x.NotId == note, ct);
        if (n is null || n.NotEtat is "ANNULEE" or "MEMO") return;
        var etat = complet ? "TERMINE" : n.NotEtat == "TERMINE" ? "EN_COURS" : n.NotEtat;
        if (etat == n.NotEtat) return;
        n.NotEtat = etat;
        n.NotMajPar = u.Code;
        n.NotMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ bordereaux de diffusion

    public async Task<List<DiffusionDto>> Diffusions(string? typeElement, string? idElement, CancellationToken ct)
    {
        var q = db.Diffusions.AsNoTracking();
        if (!string.IsNullOrEmpty(typeElement) && !string.IsNullOrEmpty(idElement)) q = q.Where(d => d.DifTypeElement == typeElement && d.DifIdElement == idElement);
        var liste = await q.OrderByDescending(d => d.DifDate).ThenByDescending(d => d.DifId).Take(300).ToListAsync(ct);
        return await EnDiffusions(liste, ct);
    }

    public async Task<DiffusionDto> Diffusion(long id, CancellationToken ct)
    {
        var d = await db.Diffusions.AsNoTracking().FirstOrDefaultAsync(x => x.DifId == id, ct) ?? throw ExceptionMetier.Introuvable($"Bordereau {id}");
        return (await EnDiffusions([d], ct))[0];
    }

    private async Task<List<DiffusionDto>> EnDiffusions(List<CrmDiffusion> liste, CancellationToken ct)
    {
        if (liste.Count == 0) return [];
        var ids = liste.Select(d => d.DifId).ToList();
        var pieces = await db.PiecesDiffusion.AsNoTracking().Where(p => ids.Contains(p.DfpDifId)).OrderBy(p => p.DfpId).ToListAsync(ct);
        var pins = pieces.Where(p => p.DfpPinId != null).Select(p => p.DfpPinId!.Value).ToList();
        var planDe = await db.Indices.AsNoTracking().Where(i => pins.Contains(i.PinId)).ToDictionaryAsync(i => i.PinId, i => i.PinPlaId, ct);
        var dests = await db.DestinatairesDiffusion.AsNoTracking().Where(x => ids.Contains(x.DfdDifId)).OrderBy(x => x.DfdId).ToListAsync(ct);
        var idsDests = dests.Select(x => x.DfdId).ToList();
        var visas = await db.Visas.AsNoTracking().Where(v => v.VisDfdId != null && idsDests.Contains(v.VisDfdId.Value)).ToListAsync(ct);
        var elements = (await DecrireAsync(dests.Select(x => new ElementCrm("personne", x.DfdTiersId.ToString()))
            .Concat(dests.Where(x => x.DfdIndId != null).Select(x => new ElementCrm("individu", x.DfdIndId!.Value.ToString())))
            .Concat(liste.Where(d => d.DifTypeElement != null && d.DifIdElement != null).Select(d => new ElementCrm(d.DifTypeElement!, d.DifIdElement!))).ToList(), ct))
            .ToDictionary(e => (e.Type, e.Id));
        return liste.Select(d => new DiffusionDto(d.DifId, d.DifNumero, d.DifDate, d.DifObjet, d.DifTypeElement, d.DifIdElement,
            d.DifTypeElement is string t && d.DifIdElement is string i ? elements.GetValueOrDefault((t, i)) : null, d.DifDelaiVisaJours, d.DifCreePar, d.DifCreeLe,
            pieces.Where(p => p.DfpDifId == d.DifId).Select(p => new PieceDto(p.DfpId, p.DfpPinId, p.DfpPinId is long pin ? planDe.GetValueOrDefault(pin) : null, p.DfpDgeId, p.DfpLibelle)).ToList(),
            dests.Where(x => x.DfdDifId == d.DifId).Select(x => new DestinataireDto2(x.DfdId, x.DfdTiersId, elements.GetValueOrDefault(("personne", x.DfdTiersId.ToString())),
                x.DfdIndId, x.DfdIndId is long ind ? elements.GetValueOrDefault(("individu", ind.ToString())) : null, x.DfdMode, x.DfdExemplaires, x.DfdAttendVisa, x.DfdNotId,
                visas.Count(v => v.VisDfdId == x.DfdId && v.VisStvCode != null), visas.Count(v => v.VisDfdId == x.DfdId))).ToList())).ToList();
    }

    /// <summary>
    /// Bordereau créé : pièces (indices de plans, documents de la GED), destinataires ; un indice sans date de diffusion
    /// prend celle du bordereau ; chaque destinataire qui doit viser reçoit un visa attendu par indice (date + délai)
    /// et une tâche de retour pour l'utilisateur (s'il est relié à un individu ; service : son service principal),
    /// terminée quand ses visas sont reçus.
    /// </summary>
    public async Task<DiffusionDto> CreerDiffusion(DiffusionSaisie s, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(s.Objet)) throw ExceptionMetier.Invalide("DIFFUSION", "Objet du bordereau obligatoire");
        if (s.Pieces.Count == 0) throw ExceptionMetier.Invalide("DIFFUSION", "Au moins une pièce à diffuser");
        if (s.Destinataires.Count == 0) throw ExceptionMetier.Invalide("DIFFUSION", "Au moins un destinataire");
        if (s.Destinataires.Any(d => !ModesDiffusion.Contains(d.Mode) || d.Exemplaires < 0)) throw ExceptionMetier.Invalide("DIFFUSION", "Mode de diffusion ou nombre d'exemplaires invalide");
        if (s.Destinataires.Select(d => d.TiersId).Distinct().Count() != s.Destinataires.Count) throw ExceptionMetier.Invalide("DIFFUSION", "Destinataire en double");
        var c = await CourantAsync(u, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var prefixe = $"BD-{s.Date.Year}-";
        var numeros = await db.Diffusions.Where(d => d.DifNumero.StartsWith(prefixe)).Select(d => d.DifNumero).ToListAsync(ct);
        var rang = numeros.Select(n => int.TryParse(n[prefixe.Length..], out var r) ? r : 0).DefaultIfEmpty(0).Max() + 1;
        var dif = db.Diffusions.Add(new CrmDiffusion
        {
            DifNumero = $"{prefixe}{rang:0000}", DifDate = s.Date, DifObjet = s.Objet.Trim(), DifTypeElement = s.TypeElement, DifIdElement = s.IdElement,
            DifDelaiVisaJours = Math.Max(0, s.DelaiVisaJours), DifCreePar = u.Code, DifCreeLe = DateTimeOffset.UtcNow,
        }).Entity;
        await db.SaveChangesAsync(ct);

        var pinIds = s.Pieces.Where(p => p.PinId != null).Select(p => p.PinId!.Value).Distinct().ToList();
        var indices = await db.Indices.Where(i => pinIds.Contains(i.PinId)).ToListAsync(ct);
        if (indices.Count != pinIds.Count) throw ExceptionMetier.Introuvable("Indice de plan");
        var plans = await db.Plans.AsNoTracking().Where(p => indices.Select(i => i.PinPlaId).Contains(p.PlaId)).ToDictionaryAsync(p => p.PlaId, ct);
        foreach (var i in indices.Where(i => i.PinDate is null)) i.PinDate = s.Date;
        foreach (var p in s.Pieces)
        {
            var libelle = p.PinId is long pin && indices.FirstOrDefault(i => i.PinId == pin) is { } i && plans.TryGetValue(i.PinPlaId, out var pl)
                ? $"{pl.PlaRepere} – {pl.PlaNom} – indice {i.PinIndice}" : string.IsNullOrWhiteSpace(p.Libelle) ? $"Document {p.DgeId}" : p.Libelle.Trim();
            db.PiecesDiffusion.Add(new CrmDiffusionPiece { DfpDifId = dif.DifId, DfpPinId = p.PinId, DfpDgeId = p.DgeId, DfpLibelle = libelle[..Math.Min(libelle.Length, 250)] });
        }
        var attendu = s.Date.AddDays(dif.DifDelaiVisaJours);
        var noms = (await DecrireAsync(s.Destinataires.Select(d => new ElementCrm("personne", d.TiersId.ToString())).ToList(), ct)).ToDictionary(e => e.Id, e => e.Libelle);
        // Responsable des tâches de retour : l'utilisateur, sinon son service principal.
        int? srv = c.Ind is long moi ? (await specialisation.ServicesIndividuAsync(db, moi, ct)).FirstOrDefault()?.Id : null;
        foreach (var d in s.Destinataires)
        {
            var dest = db.DestinatairesDiffusion.Add(new CrmDiffusionDestinataire
            {
                DfdDifId = dif.DifId, DfdTiersId = d.TiersId, DfdIndId = d.IndId, DfdMode = d.Mode, DfdExemplaires = d.Exemplaires, DfdAttendVisa = d.AttendVisa && indices.Count > 0,
            }).Entity;
            await db.SaveChangesAsync(ct);
            if (!dest.DfdAttendVisa) continue;
            foreach (var i in indices)
            {
                var v = await db.Visas.FirstOrDefaultAsync(x => x.VisPinId == i.PinId && x.VisTiersId == d.TiersId, ct);
                if (v is null) db.Visas.Add(new CrmVisa { VisPinId = i.PinId, VisTiersId = d.TiersId, VisIndId = d.IndId, VisAttenduLe = attendu, VisDfdId = dest.DfdId, VisMajPar = u.Code, VisMajLe = DateTimeOffset.UtcNow });
                else if (v.VisStvCode is null) { v.VisAttenduLe = attendu; v.VisDfdId = dest.DfdId; v.VisIndId ??= d.IndId; }
            }
            if (c.Ind is not null)
            {
                var objet = $"Retour de visa : {noms.GetValueOrDefault(d.TiersId.ToString(), $"tiers {d.TiersId}")} – {dif.DifNumero}";
                var tache = db.Notes.Add(new CrmNote
                {
                    NotNature = "TACHE", NotEtat = "A_FAIRE", NotObjet = objet[..Math.Min(200, objet.Length)], NotResponsableId = c.Ind, NotSrvId = srv, NotEcheance = new DateTimeOffset(attendu.ToDateTime(new TimeOnly(9, 0)), TimeSpan.Zero),
                    NotCreePar = u.Code, NotCreeLe = DateTimeOffset.UtcNow, NotMajPar = u.Code, NotMajLe = DateTimeOffset.UtcNow,
                }).Entity;
                await db.SaveChangesAsync(ct);
                db.Liens.Add(new CrmNoteLien { NliNotId = tache.NotId, NliTypeElement = "crm_diffusion", NliIdElement = dif.DifId.ToString(), NliPrincipal = true });
                db.Liens.Add(new CrmNoteLien { NliNotId = tache.NotId, NliTypeElement = "personne", NliIdElement = d.TiersId.ToString() });
                if (s.TypeElement is string te && s.IdElement is string ie && te != "personne") db.Liens.Add(new CrmNoteLien { NliNotId = tache.NotId, NliTypeElement = te, NliIdElement = ie });
                dest.DfdNotId = tache.NotId;
            }
            await db.SaveChangesAsync(ct);
        }
        await PublierAsync("DIFFUSION", s.TypeElement, s.IdElement, $"Bordereau {dif.DifNumero} : {dif.DifObjet} ({s.Pieces.Count} pièce(s), {s.Destinataires.Count} destinataire(s))",
            $"/crm/diffusion/{dif.DifId}", u.Code, ct);
        await tx.CommitAsync(ct);
        return await Diffusion(dif.DifId, ct);
    }
}
