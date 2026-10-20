using LogiBTP.Crm;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Crm.Web;

/// <summary>Demande saisie (maj_le : contrôle des modifications concurrentes).</summary>
public sealed record DemandeSaisie(string Objet, string? DescriptionHtml, string Etat, string? Motif, long? TiersId, long? IndId, int? SrvId, long? ResponsableId,
    DateOnly? Echeance, decimal? MontantEstime, string? Origine, DateTimeOffset? MajLe = null);

/// <summary>Demande lue : saisie, libellés (tiers, contact, service, responsable), projet créé, à prendre, nombre de notes.</summary>
public sealed record DemandeDto(long Id, string Numero, string Objet, string? DescriptionHtml, string Etat, string? Motif, long? TiersId, ElementDecrit? Tiers,
    long? IndId, ElementDecrit? Contact, int? SrvId, string? Service, long? ResponsableId, string? Responsable, DateOnly? Echeance, decimal? MontantEstime,
    string? Origine, ElementDecrit? Cible, string CreePar, DateTimeOffset CreeLe, DateTimeOffset MajLe, bool APrendre, int NbNotes);

/// <summary>Page d'une liste de demandes.</summary>
public sealed record PageDemandes(List<DemandeDto> Demandes, int Total, int Page, int Taille);

/// <summary>Demande détaillée : historique et droits.</summary>
public sealed record DemandeDetail(DemandeDto Demande, List<HistoriqueDto> Historique, DroitsNote Droits);

/// <summary>Demandes (lot 3) : pré-dossiers de veille, prise en charge par un service, transformation en projet, sans suite.</summary>
public partial class ServiceCrm
{
    /// <summary>Types d'élément propres au module, rattachables à une note.</summary>
    public static readonly TypeElementCrm[] TypesPropres = [new("crm_demande", "Demande", "📨"), new("crm_plan", "Plan", "📐")];

    public async Task<PageDemandes> Demandes(string? vue, string? etat, string? recherche, long? tiers, int page, int taille, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var ind = c.Ind ?? -1;
        var services = c.Services.ToList();
        var clos = ReglesDemande.EtatsClos;
        var q = db.Demandes.AsNoTracking();
        q = (vue ?? "toutes") switch
        {
            "mes" => q.Where(d => d.DemResponsableId == ind && !clos.Contains(d.DemEtat)),
            "a_prendre" => q.Where(d => d.DemResponsableId == null && d.DemSrvId != null && services.Contains(d.DemSrvId.Value) && !clos.Contains(d.DemEtat)),
            "creees" => q.Where(d => d.DemCreePar == u.Code),
            _ => q,
        };
        if (etat == "ouvertes") q = q.Where(d => !clos.Contains(d.DemEtat));
        else if (!string.IsNullOrEmpty(etat)) q = q.Where(d => d.DemEtat == etat);
        if (tiers is long t) q = q.Where(d => d.DemTiersId == t);
        if (!string.IsNullOrWhiteSpace(recherche))
        {
            var motif = $"%{recherche.Trim()}%";
            q = q.Where(d => EF.Functions.ILike(d.DemObjet, motif) || EF.Functions.ILike(d.DemNumero, motif) || EF.Functions.ILike(d.DemOrigine ?? "", motif));
        }
        taille = Math.Clamp(taille, 1, 200);
        page = Math.Max(1, page);
        var total = await q.CountAsync(ct);
        var liste = await q.OrderBy(d => d.DemEcheance == null).ThenBy(d => d.DemEcheance).ThenByDescending(d => d.DemCreeLe).Skip((page - 1) * taille).Take(taille).ToListAsync(ct);
        return new PageDemandes(await EnDemandes(liste, c, ct), total, page, taille);
    }

    private async Task<List<DemandeDto>> EnDemandes(List<CrmDemande> liste, Courant c, CancellationToken ct)
    {
        if (liste.Count == 0) return [];
        var elements = liste.SelectMany(d => new[]
        {
            d.DemTiersId is long t ? new ElementCrm("personne", t.ToString()) : null,
            d.DemIndId is long i ? new ElementCrm("individu", i.ToString()) : null,
            d.DemCibleType is string ty && d.DemCibleId is string id ? new ElementCrm(ty, id) : null,
        }).Where(e => e is not null).Select(e => e!).ToList();
        var decrits = (await DecrireAsync(elements, ct)).ToDictionary(e => (e.Type, e.Id));
        var services = (await specialisation.ServicesAsync(db, ct)).ToDictionary(s => s.Id);
        var noms = await specialisation.IndividusAsync(db, liste.Where(d => d.DemResponsableId != null).Select(d => d.DemResponsableId!.Value).ToList(), ct);
        var ids = liste.Select(d => d.DemId.ToString()).ToList();
        var notes = await db.Liens.AsNoTracking().Where(l => l.NliTypeElement == "crm_demande" && ids.Contains(l.NliIdElement))
            .GroupBy(l => l.NliIdElement).Select(g => new { g.Key, Nb = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Nb, ct);
        ElementDecrit? E(string type, object? id) => id is null ? null : decrits.GetValueOrDefault((type, id.ToString()!));
        return liste.Select(d => new DemandeDto(d.DemId, d.DemNumero, d.DemObjet, d.DemDescriptionHtml, d.DemEtat, d.DemMotif, d.DemTiersId, E("personne", d.DemTiersId),
            d.DemIndId, E("individu", d.DemIndId), d.DemSrvId, d.DemSrvId is int s && services.TryGetValue(s, out var srv) ? srv.Libelle : null,
            d.DemResponsableId, d.DemResponsableId is long r ? noms.GetValueOrDefault(r) : null, d.DemEcheance, d.DemMontantEstime, d.DemOrigine,
            d.DemCibleType is string ty ? E(ty, d.DemCibleId) : null, d.DemCreePar, d.DemCreeLe, d.DemMajLe,
            d.DemResponsableId is null && d.DemSrvId is int ss && c.Services.Contains(ss) && !ReglesDemande.EtatsClos.Contains(d.DemEtat),
            notes.GetValueOrDefault(d.DemId.ToString()))).ToList();
    }

    private static DroitsNote DroitsDemande(CrmDemande d, Courant c)
    {
        var responsable = c.Ind is long i && d.DemResponsableId == i;
        var aPrendre = d.DemResponsableId is null && d.DemSrvId is int s && c.Services.Contains(s) && !ReglesDemande.EtatsClos.Contains(d.DemEtat);
        // Les demandes ne sont pas confidentielles : tout utilisateur les complète, hors demandes closes (administrateur).
        var modifier = !ReglesDemande.EtatsClos.Contains(d.DemEtat) || c.U.EstAdmin;
        return new DroitsNote(modifier, c.U.EstAdmin || d.DemCreePar == c.U.Code, aPrendre && c.Ind is not null,
            responsable && d.DemSrvId is not null && !ReglesDemande.EtatsClos.Contains(d.DemEtat), false);
    }

    public async Task<DemandeDetail> Demande(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var d = await db.Demandes.AsNoTracking().FirstOrDefaultAsync(x => x.DemId == id, ct) ?? throw ExceptionMetier.Introuvable($"Demande {id}");
        var historique = await db.HistoriqueDemandes.AsNoTracking().Where(h => h.DhiDemId == id).OrderBy(h => h.DhiLe).ThenBy(h => h.DhiId).ToListAsync(ct);
        var individus = historique.Where(h => h.DhiQuoi == "RESPONSABLE").SelectMany(h => new[] { h.DhiAvant, h.DhiApres })
            .Where(x => long.TryParse(x, out _)).Select(long.Parse).ToList();
        var noms = await specialisation.IndividusAsync(db, individus, ct);
        var services = (await specialisation.ServicesAsync(db, ct)).ToDictionary(s => s.Id.ToString(), s => s.Libelle);
        string? Lisible(string quoi, string? v) => v is null ? null : quoi switch
        {
            "RESPONSABLE" => long.TryParse(v, out var x) ? noms.GetValueOrDefault(x, $"#{x}") : v,
            "SERVICE" => services.GetValueOrDefault(v, v),
            _ => v,
        };
        return new DemandeDetail((await EnDemandes([d], c, ct))[0],
            historique.Select(h => new HistoriqueDto(h.DhiQuoi, Lisible(h.DhiQuoi, h.DhiAvant), Lisible(h.DhiQuoi, h.DhiApres), h.DhiPar, h.DhiLe)).ToList(),
            DroitsDemande(d, c));
    }

    private static void ControlerDemande(DemandeSaisie s, string? cibleType, string? cibleId)
    {
        var erreurs = ReglesDemande.Controler(new DemandeAControler(s.Objet, s.Etat, s.Motif, cibleType, cibleId, s.MontantEstime));
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("DEMANDE", string.Join(" ; ", erreurs.Select(e => ReglesDemande.Messages.GetValueOrDefault(e, e))), erreurs);
    }

    public async Task<DemandeDetail> EnregistrerDemande(long? id, DemandeSaisie s, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        CrmDemande d;
        if (id is long x)
        {
            d = await db.Demandes.FirstOrDefaultAsync(z => z.DemId == x, ct) ?? throw ExceptionMetier.Introuvable($"Demande {x}");
            if (!DroitsDemande(d, c).Modifier) throw ExceptionMetier.AccesRefuse("MODIFIER");
            if (s.MajLe is DateTimeOffset maj && Math.Abs((maj - d.DemMajLe).TotalMilliseconds) >= 1)
            {
                throw ExceptionMetier.Conflit("DEMANDE_MODIFIEE", $"Demande modifiée entre-temps par {d.DemMajPar ?? d.DemCreePar} : rechargez-la");
            }
            // Transformée : seul « Créer le projet » y conduit ; le projet reste désigné tant que l'état ne change pas.
            if (s.Etat == "TRANSFORMEE" && d.DemEtat != "TRANSFORMEE") throw ExceptionMetier.Invalide("DEMANDE_CIBLE", "Utilisez « Créer le projet » pour transformer la demande");
            if (s.Etat != "TRANSFORMEE") { d.DemCibleType = null; d.DemCibleId = null; }
        }
        else
        {
            if (s.Etat == "TRANSFORMEE") throw ExceptionMetier.Invalide("DEMANDE_CIBLE", "Une demande se crée avant son projet");
            var annee = DateTime.UtcNow.Year;
            var prefixe = $"DEM-{annee}-";
            var derniers = await db.Demandes.Where(z => z.DemNumero.StartsWith(prefixe)).Select(z => z.DemNumero).ToListAsync(ct);
            var rang = derniers.Select(n => int.TryParse(n[prefixe.Length..], out var r) ? r : 0).DefaultIfEmpty(0).Max() + 1;
            d = db.Demandes.Add(new CrmDemande { DemNumero = $"{prefixe}{rang:0000}", DemCreePar = u.Code, DemCreeLe = DateTimeOffset.UtcNow }).Entity;
        }
        ControlerDemande(s, d.DemCibleType, d.DemCibleId);
        d.DemObjet = s.Objet.Trim();
        d.DemDescriptionHtml = nettoyage.Nettoyer(s.DescriptionHtml);
        d.DemEtat = s.Etat;
        d.DemMotif = s.Etat == "SANS_SUITE" ? s.Motif : null;
        d.DemTiersId = s.TiersId;
        d.DemIndId = s.IndId;
        d.DemSrvId = s.SrvId;
        d.DemResponsableId = s.ResponsableId;
        d.DemEcheance = s.Echeance;
        d.DemMontantEstime = s.MontantEstime;
        d.DemOrigine = string.IsNullOrWhiteSpace(s.Origine) ? null : s.Origine.Trim();
        d.DemMajPar = u.Code;
        d.DemMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await Demande(d.DemId, u, ct);
    }

    public async Task<DemandeDetail> PrendreDemande(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        if (c.Ind is not long ind) throw ExceptionMetier.Conflit("INDIVIDU_INCONNU", "Votre identifiant de connexion n'est relié à aucun individu de l'annuaire");
        var d = await db.Demandes.FirstOrDefaultAsync(x => x.DemId == id, ct) ?? throw ExceptionMetier.Introuvable($"Demande {id}");
        if (d.DemResponsableId is not null) throw ExceptionMetier.Conflit("DEMANDE_PRISE", "Demande déjà prise en charge");
        if (d.DemSrvId is not int s || !(c.Services.Contains(s) || u.EstAdmin)) throw ExceptionMetier.AccesRefuse("PRENDRE");
        d.DemResponsableId = ind;
        if (d.DemEtat is "VEILLE" or "A_ETUDIER") d.DemEtat = "EN_COURS";
        d.DemMajPar = u.Code;
        d.DemMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await Demande(id, u, ct);
    }

    public async Task<DemandeDetail> RendreDemande(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var d = await db.Demandes.FirstOrDefaultAsync(x => x.DemId == id, ct) ?? throw ExceptionMetier.Introuvable($"Demande {id}");
        if (d.DemSrvId is null) throw ExceptionMetier.Invalide("DEMANDE_SERVICE", "Demande sans service : choisissez un autre responsable");
        if (!(u.EstAdmin || (c.Ind is long i && d.DemResponsableId == i))) throw ExceptionMetier.AccesRefuse("RENDRE");
        d.DemResponsableId = null;
        d.DemMajPar = u.Code;
        d.DemMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await Demande(id, u, ct);
    }

    /// <summary>
    /// Transformation en projet : projet créé par l'application (objet, tiers, montant, responsable, description), demande
    /// TRANSFORMEE ; les notes de la demande sont aussi rattachées au projet (suivi continu).
    /// </summary>
    public async Task<DemandeDetail> CreerProjet(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var d = await db.Demandes.FirstOrDefaultAsync(x => x.DemId == id, ct) ?? throw ExceptionMetier.Introuvable($"Demande {id}");
        if (ReglesDemande.EtatsClos.Contains(d.DemEtat)) throw ExceptionMetier.Conflit("DEMANDE_CLOSE", "Demande déjà transformée ou sans suite");
        if (!DroitsDemande(d, c).Modifier) throw ExceptionMetier.AccesRefuse("MODIFIER");
        var responsable = d.DemResponsableId is long r ? (await specialisation.IndividusAsync(db, [r], ct)).GetValueOrDefault(r) : null;
        var projet = await specialisation.CreerProjetAsync(db, d, responsable, ct)
            ?? throw ExceptionMetier.Conflit("PROJET_IMPOSSIBLE", "L'application ne crée pas de projet depuis une demande");
        d.DemEtat = "TRANSFORMEE";
        d.DemCibleType = projet.Type;
        d.DemCibleId = projet.Id;
        d.DemMotif = null;
        d.DemMajPar = u.Code;
        d.DemMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        var idDemande = id.ToString();
        var notes = await db.Liens.Where(l => l.NliTypeElement == "crm_demande" && l.NliIdElement == idDemande).Select(l => l.NliNotId).ToListAsync(ct);
        var dejaLiees = await db.Liens.Where(l => notes.Contains(l.NliNotId) && l.NliTypeElement == projet.Type && l.NliIdElement == projet.Id).Select(l => l.NliNotId).ToListAsync(ct);
        db.Liens.AddRange(notes.Except(dejaLiees).Select(n => new CrmNoteLien { NliNotId = n, NliTypeElement = projet.Type, NliIdElement = projet.Id }));
        await db.SaveChangesAsync(ct);
        await PublierAsync("DEMANDE_TRANSFORMEE", projet.Type, projet.Id, $"Projet créé depuis la demande {d.DemNumero} : {d.DemObjet}", $"/crm/demande/{d.DemId}", u.Code, ct);
        await tx.CommitAsync(ct);
        return await Demande(id, u, ct);
    }

    /// <summary>Suppression : l'auteur tant que la demande n'a ni note ni projet, sinon l'administrateur.</summary>
    public async Task SupprimerDemande(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await db.Demandes.AsNoTracking().FirstOrDefaultAsync(x => x.DemId == id, ct) ?? throw ExceptionMetier.Introuvable($"Demande {id}");
        var idDemande = id.ToString();
        if (!u.EstAdmin)
        {
            if (d.DemCreePar != u.Code) throw ExceptionMetier.AccesRefuse("SUPPRIMER");
            if (d.DemCibleId is not null || await db.Liens.AnyAsync(l => l.NliTypeElement == "crm_demande" && l.NliIdElement == idDemande, ct))
            {
                throw ExceptionMetier.Conflit("DEMANDE_UTILISEE", "Demande suivie par des notes ou transformée : passez-la sans suite");
            }
        }
        await db.Liens.Where(l => l.NliTypeElement == "crm_demande" && l.NliIdElement == idDemande).ExecuteDeleteAsync(ct);
        await db.Demandes.Where(x => x.DemId == id).ExecuteDeleteAsync(ct);
    }

    /// <summary>Recherche d'éléments à rattacher (demandes du module, sinon la spécialisation : documents…).</summary>
    public async Task<List<ElementDecrit>> Rechercher(string type, string texte, CancellationToken ct)
    {
        if (type == "crm_plan")
        {
            var m = $"%{(texte ?? "").Trim()}%";
            var p = await db.Plans.AsNoTracking().Where(x => EF.Functions.ILike(x.PlaRepere, m) || EF.Functions.ILike(x.PlaNom, m)).OrderBy(x => x.PlaRepere).Take(15).ToListAsync(ct);
            return p.Select(x => new ElementDecrit("crm_plan", x.PlaId.ToString(), $"{x.PlaRepere} – {x.PlaNom}", $"/crm/plan/{x.PlaId}", "📐")).ToList();
        }
        if (type != "crm_demande") return await specialisation.RechercherAsync(db, type, texte ?? "", ct);
        var motif = $"%{(texte ?? "").Trim()}%";
        var d = await db.Demandes.AsNoTracking().Where(x => EF.Functions.ILike(x.DemObjet, motif) || EF.Functions.ILike(x.DemNumero, motif))
            .OrderByDescending(x => x.DemCreeLe).Take(15).ToListAsync(ct);
        return d.Select(x => new ElementDecrit("crm_demande", x.DemId.ToString(), $"{x.DemNumero} – {x.DemObjet}", $"/crm/demande/{x.DemId}", "📨")).ToList();
    }
}
