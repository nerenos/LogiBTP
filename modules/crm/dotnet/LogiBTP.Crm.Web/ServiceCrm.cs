using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Crm.Web;

/// <summary>Type de note lu ou saisi.</summary>
public sealed record TypeNoteDto(int? Id, string Code, string Libelle, int? SrvId, string? Icone, string? ModeleHtml, int Ordre, bool Actif);

/// <summary>Contexte de l'utilisateur : individu, services, droits, référentiels de saisie.</summary>
public sealed record ContexteCrm(string Utilisateur, long? IndividuId, string? Individu, List<ServiceEntreprise> Services, bool Superviser, bool Rgpd,
    bool Admin, IReadOnlyList<TypeElementCrm> TypesElements, List<ServiceEntreprise> TousServices, List<TypeNoteDto> Types);

/// <summary>Élément rattaché saisi.</summary>
public sealed record LienSaisi(string TypeElement, string IdElement, bool Principal = false);

/// <summary>Note saisie (création ou modification ; maj_le : contrôle des modifications concurrentes).</summary>
public sealed record NoteSaisie(string Nature, string Etat, int? TnoId, int? SrvId, string Objet, string? MessageHtml, long? ResponsableId,
    DateTimeOffset? Echeance, long? ParentId, bool Prive, bool Rgpd, bool DansFil, List<LienSaisi>? Liens, List<long>? Destinataires,
    DateTimeOffset? MajLe = null);

/// <summary>Filtre des listes : vue (mes, a_prendre, creees, recues, toutes), élément, nature, état (ouvertes ou code), service, recherche, page.</summary>
public sealed record FiltreNotes(string? Vue = null, string? TypeElement = null, string? IdElement = null, string? Nature = null, string? Etat = null,
    int? Srv = null, string? Recherche = null, int Page = 1, int Taille = 50);

/// <summary>Note d'une liste (masquee : PRIVEE ou RGPD quand le contenu n'est pas lisible).</summary>
public sealed record NoteListe(long Id, string Nature, string Etat, int? TnoId, string? Type, string? Icone, int? SrvId, string? Service, string Objet,
    long? ResponsableId, string? Responsable, DateTimeOffset? Echeance, bool Prive, bool Rgpd, bool DansFil, string? Masquee, string CreePar,
    DateTimeOffset CreeLe, DateTimeOffset MajLe, ElementDecrit? Element, int NbLiens, int NbReponses, bool APrendre, bool NonLue, long? ParentId,
    string? MessageHtml);

/// <summary>Page d'une liste de notes.</summary>
public sealed record PageNotes(List<NoteListe> Notes, int Total, int Page, int Taille);

/// <summary>Destinataire lu : individu, nom, lecture.</summary>
public sealed record DestinataireDto(long IndId, string Individu, DateTimeOffset? LuLe);

/// <summary>Ligne d'historique lisible.</summary>
public sealed record HistoriqueDto(string Quoi, string? Avant, string? Apres, string? Par, DateTimeOffset Le);

/// <summary>Consultation d'une note protégée (visible de l'auteur).</summary>
public sealed record ConsultationDto(string Motif, string Par, DateTimeOffset Le);

/// <summary>Droits de l'utilisateur sur une note.</summary>
public sealed record DroitsNote(bool Modifier, bool Supprimer, bool Prendre, bool Rendre, bool Reveler);

/// <summary>Note détaillée : liens décrits, destinataires, historique, réponses, consultations (auteur), droits.</summary>
public sealed record NoteDetail(NoteListe Note, List<ElementDecrit> Liens, string? Principal, List<DestinataireDto> Destinataires,
    List<HistoriqueDto> Historique, List<NoteListe> Reponses, List<ConsultationDto> Consultations, DroitsNote Droits, List<RappelDto> Rappels);

/// <summary>
/// Services du module CRM : contexte de l'utilisateur, types de notes, notes (listes par vue, détail, création,
/// modification, suppression, prise en charge par un membre du service, rendu au service, lecture), masquage des notes
/// privées et RGPD, levée du masquage journalisée (C14, C21, C24, C28).
/// </summary>
public partial class ServiceCrm(CrmDbContext db, SpecialisationCrm specialisation, NettoyageHtmlCrm nettoyage, IDroits? droitsProfil = null)
{
    private sealed record Courant(Utilisateur U, long? Ind, HashSet<int> Services, bool Superviser, bool Rgpd);

    private async Task<Courant> CourantAsync(Utilisateur u, CancellationToken ct)
    {
        var ind = await specialisation.IndividuAsync(db, u.Code, ct);
        var services = ind is long i ? (await specialisation.ServicesIndividuAsync(db, i, ct)).Select(s => s.Id).ToHashSet() : [];
        // Module Droits branché : actions SUPERVISER et RGPD du nœud crm ; sinon crm_droit.
        var droits = droitsProfil is null
            ? await db.Droits.AsNoTracking().Where(d => d.CdrProfil == u.Profil).Select(d => d.CdrAction).ToListAsync(ct)
            : [await droitsProfil.AutoriseAsync(u, "crm", "SUPERVISER", ct) ? "SUPERVISER" : "", await droitsProfil.AutoriseAsync(u, "crm", "RGPD", ct) ? "RGPD" : ""];
        return new Courant(u, ind, services, droits.Contains("SUPERVISER"), droits.Contains("RGPD"));
    }

    public async Task<ContexteCrm> Contexte(Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var nom = c.Ind is long i ? (await specialisation.IndividusAsync(db, [i], ct)).GetValueOrDefault(i) : null;
        var services = c.Ind is long j ? await specialisation.ServicesIndividuAsync(db, j, ct) : [];
        return new ContexteCrm(u.Code, c.Ind, nom, services, c.Superviser, c.Rgpd, u.EstAdmin, [.. specialisation.TypesElements, .. TypesPropres],
            await specialisation.ServicesAsync(db, ct), await TypesNotes(ct));
    }

    /// <summary>Éléments de l'application décrits (libellé, page, icône).</summary>
    public Task<List<ElementDecrit>> Decrire(List<ElementCrm> elements, CancellationToken ct) => DecrireAsync(elements.Take(200).ToList(), ct);

    /// <summary>
    /// Éléments décrits : ceux du module (notes, demandes) par lui-même, les autres par la spécialisation ; un élément
    /// par couple (type, id) demandé.
    /// </summary>
    private async Task<List<ElementDecrit>> DecrireAsync(IReadOnlyCollection<ElementCrm> elements, CancellationToken ct)
    {
        var uniques = elements.Distinct().ToList();
        var res = await specialisation.DecrireAsync(db, uniques.Where(e => !e.Type.StartsWith("crm_")).ToList(), ct);
        long Id(ElementCrm e) => long.TryParse(e.Id, out var x) ? x : -1;
        var demandes = uniques.Where(e => e.Type == "crm_demande").Select(Id).ToList();
        if (demandes.Count > 0)
        {
            var d = await db.Demandes.AsNoTracking().Where(x => demandes.Contains(x.DemId)).ToDictionaryAsync(x => x.DemId, ct);
            res.AddRange(uniques.Where(e => e.Type == "crm_demande").Select(e => d.TryGetValue(Id(e), out var x)
                ? new ElementDecrit(e.Type, e.Id, $"{x.DemNumero} – {x.DemObjet}", $"/crm/demande/{x.DemId}", "📨")
                : new ElementDecrit(e.Type, e.Id, $"Demande {e.Id} (introuvable)", null, "📨")));
        }
        var notes = uniques.Where(e => e.Type == "crm_note").Select(Id).ToList();
        if (notes.Count > 0)
        {
            var n = await db.Notes.AsNoTracking().Where(x => notes.Contains(x.NotId)).ToDictionaryAsync(x => x.NotId, ct);
            res.AddRange(uniques.Where(e => e.Type == "crm_note").Select(e => n.TryGetValue(Id(e), out var x)
                ? new ElementDecrit(e.Type, e.Id, x.NotPrive || x.NotRgpd ? "Note protégée" : x.NotObjet, $"/crm/note/{x.NotId}", "📝")
                : new ElementDecrit(e.Type, e.Id, $"Note {e.Id} (introuvable)", null, "📝")));
        }
        var plans = uniques.Where(e => e.Type == "crm_plan").Select(Id).ToList();
        if (plans.Count > 0)
        {
            var p = await db.Plans.AsNoTracking().Where(x => plans.Contains(x.PlaId)).ToDictionaryAsync(x => x.PlaId, ct);
            res.AddRange(uniques.Where(e => e.Type == "crm_plan").Select(e => p.TryGetValue(Id(e), out var x)
                ? new ElementDecrit(e.Type, e.Id, $"{x.PlaRepere} – {x.PlaNom}", $"/crm/plan/{x.PlaId}", "📐")
                : new ElementDecrit(e.Type, e.Id, $"Plan {e.Id} (introuvable)", null, "📐")));
        }
        var diffusions = uniques.Where(e => e.Type == "crm_diffusion").Select(Id).ToList();
        if (diffusions.Count > 0)
        {
            var f = await db.Diffusions.AsNoTracking().Where(x => diffusions.Contains(x.DifId)).ToDictionaryAsync(x => x.DifId, ct);
            res.AddRange(uniques.Where(e => e.Type == "crm_diffusion").Select(e => f.TryGetValue(Id(e), out var x)
                ? new ElementDecrit(e.Type, e.Id, $"{x.DifNumero} – {x.DifObjet}", $"/crm/diffusion/{x.DifId}", "📤")
                : new ElementDecrit(e.Type, e.Id, $"Bordereau {e.Id} (introuvable)", null, "📤")));
        }
        var autres = uniques.Where(e => e.Type.StartsWith("crm_") && e.Type is not ("crm_demande" or "crm_note" or "crm_plan" or "crm_diffusion"));
        res.AddRange(autres.Select(e => new ElementDecrit(e.Type, e.Id, $"{e.Type} {e.Id}", null, null)));
        return res;
    }

    // ------------------------------------------------------------------ types de notes

    public async Task<List<TypeNoteDto>> TypesNotes(CancellationToken ct) =>
        await db.TypesNote.AsNoTracking().OrderBy(t => t.TnoOrdre).ThenBy(t => t.TnoLibelle)
            .Select(t => new TypeNoteDto(t.TnoId, t.TnoCode, t.TnoLibelle, t.TnoSrvId, t.TnoIcone, t.TnoModeleHtml, t.TnoOrdre, t.TnoActif)).ToListAsync(ct);

    /// <summary>Liste complète des types (administrateur) ; un type retiré utilisé par des notes est désactivé.</summary>
    public async Task<List<TypeNoteDto>> EnregistrerTypesNotes(List<TypeNoteDto> types, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        if (types.Any(t => string.IsNullOrWhiteSpace(t.Code) || string.IsNullOrWhiteSpace(t.Libelle))) throw ExceptionMetier.Invalide("TYPE_NOTE", "Code et libellé obligatoires");
        var codes = types.Select(t => t.Code.Trim().ToUpperInvariant()).ToList();
        if (codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("TYPE_NOTE", "Codes en double");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var existants = await db.TypesNote.ToListAsync(ct);
        var gardes = types.Where(t => t.Id is not null).Select(t => t.Id!.Value).ToHashSet();
        foreach (var x in existants.Where(x => !gardes.Contains(x.TnoId)))
        {
            if (await db.Notes.AnyAsync(n => n.NotTnoId == x.TnoId, ct)) x.TnoActif = false;
            else db.TypesNote.Remove(x);
        }
        foreach (var t in types)
        {
            var e = t.Id is int id ? existants.FirstOrDefault(x => x.TnoId == id) ?? throw ExceptionMetier.Introuvable($"Type de note {id}") : db.TypesNote.Add(new CrmTypeNote()).Entity;
            e.TnoCode = t.Code.Trim().ToUpperInvariant();
            e.TnoLibelle = t.Libelle.Trim();
            e.TnoSrvId = t.SrvId;
            e.TnoIcone = string.IsNullOrWhiteSpace(t.Icone) ? null : t.Icone.Trim();
            e.TnoModeleHtml = nettoyage.Nettoyer(t.ModeleHtml);
            e.TnoOrdre = t.Ordre;
            e.TnoActif = t.Actif;
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await TypesNotes(ct);
    }

    // ------------------------------------------------------------------ lecture

    /// <summary>Contenu illisible pour l'utilisateur : PRIVEE (ni auteur, ni responsable, ni destinataire), RGPD (pas l'auteur).</summary>
    private static string? Masque(CrmNote n, Courant c, bool destinataire)
    {
        var auteur = n.NotCreePar == c.U.Code;
        if (n.NotPrive && !auteur && !(c.Ind is long i && (n.NotResponsableId == i || destinataire))) return "PRIVEE";
        if (n.NotRgpd && !auteur) return "RGPD";
        return null;
    }

    private static bool Close(CrmNote n) => LogiBTP.Crm.ReglesNote.EtatsClos.Contains(n.NotEtat);

    public async Task<PageNotes> Notes(FiltreNotes f, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var q = db.Notes.AsNoTracking().Where(n => n.NotParentId == null && n.NotArchiveeLe == null);
        var clos = LogiBTP.Crm.ReglesNote.EtatsClos;
        var ind = c.Ind ?? -1;
        var services = c.Services.ToList();
        q = (f.Vue ?? "toutes") switch
        {
            "mes" => q.Where(n => n.NotResponsableId == ind && !clos.Contains(n.NotEtat)),
            "a_prendre" => q.Where(n => n.NotResponsableId == null && n.NotSrvId != null && services.Contains(n.NotSrvId.Value) && !clos.Contains(n.NotEtat)),
            "creees" => q.Where(n => n.NotCreePar == u.Code),
            "recues" => q.Where(n => db.Destinataires.Any(d => d.NdeNotId == n.NotId && d.NdeIndId == ind)),
            _ => q,
        };
        if (!string.IsNullOrEmpty(f.TypeElement) && !string.IsNullOrEmpty(f.IdElement))
        {
            q = q.Where(n => db.Liens.Any(l => l.NliNotId == n.NotId && l.NliTypeElement == f.TypeElement && l.NliIdElement == f.IdElement));
        }
        if (!string.IsNullOrEmpty(f.Nature)) q = q.Where(n => n.NotNature == f.Nature);
        if (f.Etat == "ouvertes") q = q.Where(n => !clos.Contains(n.NotEtat));
        else if (!string.IsNullOrEmpty(f.Etat)) q = q.Where(n => n.NotEtat == f.Etat);
        if (f.Srv is int srv) q = q.Where(n => n.NotSrvId == srv);
        if (!string.IsNullOrWhiteSpace(f.Recherche))
        {
            var motif = $"%{f.Recherche.Trim()}%";
            // Le contenu des notes protégées n'est pas cherché (ni objet ni message).
            q = q.Where(n => !n.NotRgpd && !n.NotPrive && (EF.Functions.ILike(n.NotObjet, motif) || EF.Functions.ILike(n.NotMessageHtml ?? "", motif)));
        }
        var taille = Math.Clamp(f.Taille, 1, 200);
        var page = Math.Max(1, f.Page);
        var total = await q.CountAsync(ct);
        var notes = await q.OrderBy(n => n.NotEcheance == null).ThenBy(n => n.NotEcheance).ThenByDescending(n => n.NotCreeLe)
            .Skip((page - 1) * taille).Take(taille).ToListAsync(ct);
        return new PageNotes(await EnListe(notes, c, false, ct), total, page, taille);
    }

    /// <summary>Notes mises en forme de liste : types, services, responsables, élément principal, réponses, masquage.</summary>
    private async Task<List<NoteListe>> EnListe(List<CrmNote> notes, Courant c, bool avecMessage, CancellationToken ct)
    {
        if (notes.Count == 0) return [];
        var ids = notes.Select(n => n.NotId).ToList();
        var types = await db.TypesNote.AsNoTracking().ToDictionaryAsync(t => t.TnoId, ct);
        var services = (await specialisation.ServicesAsync(db, ct)).ToDictionary(s => s.Id);
        var noms = await specialisation.IndividusAsync(db, notes.Where(n => n.NotResponsableId != null).Select(n => n.NotResponsableId!.Value).ToList(), ct);
        var liens = await db.Liens.AsNoTracking().Where(l => ids.Contains(l.NliNotId)).ToListAsync(ct);
        var principaux = liens.GroupBy(l => l.NliNotId).ToDictionary(g => g.Key, g => g.OrderByDescending(l => l.NliPrincipal).First());
        var decrits = (await DecrireAsync(principaux.Values.Select(l => new ElementCrm(l.NliTypeElement, l.NliIdElement)).Distinct().ToList(), ct))
            .ToDictionary(e => (e.Type, e.Id));
        var reponses = await db.Notes.AsNoTracking().Where(n => n.NotParentId != null && ids.Contains(n.NotParentId.Value))
            .GroupBy(n => n.NotParentId!.Value).Select(g => new { g.Key, Nb = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Nb, ct);
        var ind = c.Ind ?? -1;
        var mesDestinations = await db.Destinataires.AsNoTracking().Where(d => d.NdeIndId == ind && ids.Contains(d.NdeNotId)).ToDictionaryAsync(d => d.NdeNotId, ct);
        return notes.Select(n =>
        {
            var masque = Masque(n, c, mesDestinations.ContainsKey(n.NotId));
            types.TryGetValue(n.NotTnoId ?? -1, out var t);
            ElementDecrit? element = principaux.TryGetValue(n.NotId, out var l) ? decrits.GetValueOrDefault((l.NliTypeElement, l.NliIdElement)) : null;
            return new NoteListe(n.NotId, n.NotNature, n.NotEtat, n.NotTnoId, t?.TnoLibelle, t?.TnoIcone, n.NotSrvId,
                n.NotSrvId is int s && services.TryGetValue(s, out var srv) ? srv.Libelle : null,
                masque is null ? n.NotObjet : masque == "PRIVEE" ? "Note privée" : "Données personnelles",
                n.NotResponsableId, n.NotResponsableId is long r ? noms.GetValueOrDefault(r) : null, n.NotEcheance, n.NotPrive, n.NotRgpd, n.NotDansFil,
                masque, n.NotCreePar, n.NotCreeLe, n.NotMajLe, element, liens.Count(x => x.NliNotId == n.NotId), reponses.GetValueOrDefault(n.NotId),
                n.NotResponsableId is null && n.NotSrvId is int ss && c.Services.Contains(ss) && !Close(n),
                mesDestinations.TryGetValue(n.NotId, out var d) && d.NdeLuLe is null, n.NotParentId,
                avecMessage && masque is null ? n.NotMessageHtml : null);
        }).ToList();
    }

    /// <summary>
    /// Note détaillée. reveler : lève le masquage d'une note privée (droit SUPERVISER) ou RGPD (droit RGPD), consultation
    /// journalisée ; sans le droit, la note reste masquée.
    /// </summary>
    public async Task<NoteDetail> Note(long id, bool reveler, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var n = await db.Notes.AsNoTracking().FirstOrDefaultAsync(x => x.NotId == id, ct) ?? throw ExceptionMetier.Introuvable($"Note {id}");
        var destinataires = await db.Destinataires.AsNoTracking().Where(d => d.NdeNotId == id).ToListAsync(ct);
        var estDestinataire = c.Ind is long i && destinataires.Any(d => d.NdeIndId == i);
        var masque = Masque(n, c, estDestinataire);
        var peutReveler = masque switch { "PRIVEE" => c.Superviser && (!n.NotRgpd || c.Rgpd), "RGPD" => c.Rgpd, _ => false };
        if (masque is not null && reveler)
        {
            if (!peutReveler) throw ExceptionMetier.AccesRefuse(masque == "PRIVEE" ? "SUPERVISER" : "RGPD");
            db.Consultations.Add(new CrmConsultation { CcoNotId = id, CcoMotif = masque, CcoPar = u.Code, CcoLe = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync(ct);
            masque = null;
        }
        var liste = (await EnListe([n], c, true, ct))[0];
        if (masque is null && liste.Masquee is not null) liste = liste with { Masquee = null, Objet = n.NotObjet, MessageHtml = n.NotMessageHtml };

        var liens = await db.Liens.AsNoTracking().Where(l => l.NliNotId == id).OrderByDescending(l => l.NliPrincipal).ToListAsync(ct);
        var parElement = (await DecrireAsync(liens.Select(l => new ElementCrm(l.NliTypeElement, l.NliIdElement)).ToList(), ct)).ToDictionary(e => (e.Type, e.Id));
        var decrits = liens.Select(l => parElement[(l.NliTypeElement, l.NliIdElement)]).ToList();
        var historique = await db.Historique.AsNoTracking().Where(h => h.NhiNotId == id).OrderBy(h => h.NhiLe).ThenBy(h => h.NhiId).ToListAsync(ct);
        var individus = destinataires.Select(d => d.NdeIndId)
            .Concat(historique.Where(h => h.NhiQuoi == "RESPONSABLE").SelectMany(h => new[] { h.NhiAvant, h.NhiApres }).Where(x => long.TryParse(x, out _)).Select(long.Parse))
            .ToList();
        var noms = await specialisation.IndividusAsync(db, individus, ct);
        var services = (await specialisation.ServicesAsync(db, ct)).ToDictionary(s => s.Id.ToString(), s => s.Libelle);
        string? Lisible(string quoi, string? v) => v is null ? null : quoi switch
        {
            "RESPONSABLE" => long.TryParse(v, out var x) ? noms.GetValueOrDefault(x, $"#{x}") : v,
            "SERVICE" => services.GetValueOrDefault(v, v),
            _ => v,
        };
        var reponses = await db.Notes.AsNoTracking().Where(x => x.NotParentId == id).OrderBy(x => x.NotCreeLe).ToListAsync(ct);
        var consultations = n.NotCreePar == u.Code || u.EstAdmin
            ? await db.Consultations.AsNoTracking().Where(x => x.CcoNotId == id).OrderByDescending(x => x.CcoLe).Select(x => new ConsultationDto(x.CcoMotif, x.CcoPar, x.CcoLe)).ToListAsync(ct)
            : [];
        var droits = Droits(n, c, estDestinataire, masque, peutReveler, await AutresTracesAsync(n, ct));
        return new NoteDetail(liste, masque is null ? decrits : [], liens.FirstOrDefault(l => l.NliPrincipal)?.NliTypeElement,
            masque is null ? destinataires.Select(d => new DestinataireDto(d.NdeIndId, noms.GetValueOrDefault(d.NdeIndId, $"#{d.NdeIndId}"), d.NdeLuLe)).ToList() : [],
            historique.Select(h => new HistoriqueDto(h.NhiQuoi, Lisible(h.NhiQuoi, h.NhiAvant), Lisible(h.NhiQuoi, h.NhiApres), h.NhiPar, h.NhiLe)).ToList(),
            masque is null ? await EnListe(reponses, c, true, ct) : [], consultations, droits, masque is null ? await RappelsNote(id, ct) : []);
    }

    /// <summary>Quelqu'un d'autre que l'auteur a lu ou modifié la note, ou y a répondu.</summary>
    private async Task<bool> AutresTracesAsync(CrmNote n, CancellationToken ct) =>
        await db.Destinataires.AnyAsync(d => d.NdeNotId == n.NotId && d.NdeLuLe != null, ct)
        || await db.Historique.AnyAsync(h => h.NhiNotId == n.NotId && h.NhiPar != null && h.NhiPar != n.NotCreePar, ct)
        || await db.Notes.AnyAsync(x => x.NotParentId == n.NotId, ct);

    private static DroitsNote Droits(CrmNote n, Courant c, bool destinataire, string? masque, bool peutReveler, bool autresTraces)
    {
        var auteur = n.NotCreePar == c.U.Code;
        var responsable = c.Ind is long i && n.NotResponsableId == i;
        var aPrendre = n.NotResponsableId is null && n.NotSrvId is int s && c.Services.Contains(s);
        var modifier = masque is null && (c.U.EstAdmin || auteur || responsable || destinataire || aPrendre);
        return new DroitsNote(modifier, masque is null && (c.U.EstAdmin || (auteur && !autresTraces)),
            masque is null && aPrendre && !Close(n) && c.Ind is not null, masque is null && responsable && n.NotSrvId is not null && !Close(n), masque is not null && peutReveler);
    }

    // ------------------------------------------------------------------ écriture

    public async Task<NoteDetail> Enregistrer(long? id, NoteSaisie s, Utilisateur u, CancellationToken ct)
    {
        var destinataires = (s.Destinataires ?? []).Distinct().ToList();
        var erreurs = LogiBTP.Crm.ReglesNote.Controler(new LogiBTP.Crm.NoteAControler(s.Nature, s.Etat, s.Objet, s.ResponsableId, s.SrvId, s.Echeance,
            destinataires, s.ParentId, s.Prive, s.Rgpd, s.DansFil));
        if (erreurs.Count > 0)
        {
            throw ExceptionMetier.Invalide("NOTE", string.Join(" ; ", erreurs.Select(e => LogiBTP.Crm.ReglesNote.Messages.GetValueOrDefault(e, e))), erreurs);
        }
        var liens = (s.Liens ?? []).Where(l => !string.IsNullOrWhiteSpace(l.TypeElement) && !string.IsNullOrWhiteSpace(l.IdElement))
            .GroupBy(l => (l.TypeElement, l.IdElement)).Select(g => g.First()).ToList();
        if (liens.Count > 0 && !liens.Any(l => l.Principal)) liens[0] = liens[0] with { Principal = true };
        if (liens.Count(l => l.Principal) > 1) throw ExceptionMetier.Invalide("NOTE_LIEN", "Un seul élément principal");

        var c = await CourantAsync(u, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        CrmNote n;
        if (id is long x)
        {
            n = await db.Notes.FirstOrDefaultAsync(z => z.NotId == x, ct) ?? throw ExceptionMetier.Introuvable($"Note {x}");
            var estDestinataire = c.Ind is long i && await db.Destinataires.AnyAsync(d => d.NdeNotId == x && d.NdeIndId == i, ct);
            if (!Droits(n, c, estDestinataire, Masque(n, c, estDestinataire), false, false).Modifier) throw ExceptionMetier.AccesRefuse("MODIFIER");
            if (s.MajLe is DateTimeOffset maj && Math.Abs((maj - n.NotMajLe).TotalMilliseconds) >= 1)
            {
                throw ExceptionMetier.Conflit("NOTE_MODIFIEE", $"Note modifiée entre-temps par {n.NotMajPar ?? n.NotCreePar} : rechargez-la");
            }
        }
        else
        {
            if (s.ParentId is long p && !await db.Notes.AnyAsync(z => z.NotId == p, ct)) throw ExceptionMetier.Introuvable($"Note {p}");
            n = db.Notes.Add(new CrmNote { NotCreePar = u.Code, NotCreeLe = DateTimeOffset.UtcNow }).Entity;
            n.NotParentId = s.ParentId;
        }
        n.NotNature = s.Nature;
        n.NotEtat = s.Etat;
        n.NotTnoId = s.TnoId;
        n.NotSrvId = s.SrvId;
        n.NotObjet = s.Objet.Trim();
        n.NotMessageHtml = nettoyage.Nettoyer(s.MessageHtml);
        n.NotResponsableId = s.ResponsableId;
        n.NotEcheance = s.Echeance;
        n.NotPrive = s.Prive;
        n.NotRgpd = s.Rgpd;
        n.NotDansFil = s.DansFil;
        n.NotMajPar = u.Code;
        n.NotMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        await db.Liens.Where(l => l.NliNotId == n.NotId).ExecuteDeleteAsync(ct);
        db.Liens.AddRange(liens.Select(l => new CrmNoteLien { NliNotId = n.NotId, NliTypeElement = l.TypeElement, NliIdElement = l.IdElement, NliPrincipal = l.Principal }));
        // Destinataires : ceux qui restent gardent leur lecture.
        var anciens = await db.Destinataires.Where(d => d.NdeNotId == n.NotId).ToListAsync(ct);
        db.Destinataires.RemoveRange(anciens.Where(d => !destinataires.Contains(d.NdeIndId)));
        db.Destinataires.AddRange(destinataires.Where(d => anciens.All(a => a.NdeIndId != d)).Select(d => new CrmNoteDestinataire { NdeNotId = n.NotId, NdeIndId = d }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await Note(n.NotId, false, u, ct);
    }

    /// <summary>Suppression : l'auteur tant que personne d'autre ne l'a lue, modifiée ni n'y a répondu ; sinon l'administrateur (C15).</summary>
    public async Task Supprimer(long id, Utilisateur u, CancellationToken ct)
    {
        var n = await db.Notes.AsNoTracking().FirstOrDefaultAsync(x => x.NotId == id, ct) ?? throw ExceptionMetier.Introuvable($"Note {id}");
        if (!u.EstAdmin)
        {
            if (n.NotCreePar != u.Code) throw ExceptionMetier.AccesRefuse("SUPPRIMER");
            if (await AutresTracesAsync(n, ct)) throw ExceptionMetier.Conflit("NOTE_UTILISEE", "Note déjà lue, modifiée ou suivie d'une réponse : annulez-la plutôt");
        }
        await db.Notes.Where(x => x.NotId == id).ExecuteDeleteAsync(ct);
    }

    /// <summary>Prise en charge d'une note en attente dans un service de l'utilisateur : il en devient responsable (C3, C18).</summary>
    public async Task<NoteDetail> Prendre(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        if (c.Ind is not long ind) throw ExceptionMetier.Conflit("INDIVIDU_INCONNU", "Votre identifiant de connexion n'est relié à aucun individu de l'annuaire");
        var n = await db.Notes.FirstOrDefaultAsync(x => x.NotId == id, ct) ?? throw ExceptionMetier.Introuvable($"Note {id}");
        if (n.NotResponsableId is not null) throw ExceptionMetier.Conflit("NOTE_PRISE", "Note déjà prise en charge");
        if (n.NotSrvId is not int s || !(c.Services.Contains(s) || u.EstAdmin)) throw ExceptionMetier.AccesRefuse("PRENDRE");
        n.NotResponsableId = ind;
        if (n.NotEtat == "A_FAIRE") n.NotEtat = "EN_COURS";
        n.NotMajPar = u.Code;
        n.NotMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await Note(id, false, u, ct);
    }

    /// <summary>Rendu au service : la note redevient à prendre par ses membres (tracé).</summary>
    public async Task<NoteDetail> Rendre(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var n = await db.Notes.FirstOrDefaultAsync(x => x.NotId == id, ct) ?? throw ExceptionMetier.Introuvable($"Note {id}");
        if (n.NotSrvId is null) throw ExceptionMetier.Invalide("NOTE_SERVICE", "Note sans service : choisissez un autre responsable");
        if (!(u.EstAdmin || (c.Ind is long i && n.NotResponsableId == i))) throw ExceptionMetier.AccesRefuse("RENDRE");
        n.NotResponsableId = null;
        n.NotMajPar = u.Code;
        n.NotMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await Note(id, false, u, ct);
    }

    /// <summary>Lecture par un destinataire.</summary>
    public async Task Lue(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        if (c.Ind is not long ind) return;
        await db.Destinataires.Where(d => d.NdeNotId == id && d.NdeIndId == ind && d.NdeLuLe == null)
            .ExecuteUpdateAsync(x => x.SetProperty(d => d.NdeLuLe, DateTimeOffset.UtcNow), ct);
    }
}
