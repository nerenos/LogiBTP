using System.Text.Json;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Pointage.Web;

public sealed record ActionSynthese(List<int> Salaries, DateOnly Lundi, DateOnly? Du, DateOnly? Au, string? Motif);
public sealed record CorrectionSaisie(int Salarie, DateOnly Lundi, List<PointageSaisi> Pointages, string? Motif);
public sealed record ReponseCorrection(string? Reponse);

/// <summary>
/// Synthèse MO (lot 2) : salariés d'un service avec leurs heures retenues, l'état de validation de chaque jour et les
/// exceptions (<see cref="ReglesValidation"/>) ; couche validée d'une semaine (copie modifiée par le chef ou le RH,
/// la saisie restant intacte), validation simple ou double, dévalidation tracée avec motif, demandes de correction.
/// </summary>
public sealed class ServiceSynthese(PointageDbContext db, SpecialisationPointage specialisation, ServicePointage pointage, ServiceConges conges, IServiceProvider services)
{
    private static readonly JsonSerializerOptions Json = JsonCalcul.Web;

    internal sealed record Roles(bool Rh, HashSet<int> Chef);

    private async Task<Roles> RolesAsync(Utilisateur u, IReadOnlyCollection<int> salaries, CancellationToken ct) =>
        new(u.EstAdmin || await specialisation.EstRhAsync(db, u, ct), await specialisation.ChefDeAsync(db, u, salaries, ct));

    private static string Empreinte(IEnumerable<PointageEntite> l) =>
        string.Join(";", l.Select(p => $"{p.PoiDate:yyyy-MM-dd}|{p.PoiChaId}|{p.PoiEntId}|{p.PoiTypeMo}|{p.PoiSousType}|{p.PoiMinutes}|{p.PoiMotif}").Order(StringComparer.Ordinal));

    private async Task<List<Controle>> ControlerAsync(IReadOnlyList<PointageEntite> pointages, ParametresDto p0, CancellationToken ct)
    {
        var chantiers = (await specialisation.ChantiersAsync(db, null, pointages.Select(p => p.PoiChaId).Distinct().ToList(), ct)).ToDictionary(c => c.Id);
        var nc = (await db.SousTypes.AsNoTracking().Where(s => s.PstNonConformite).Select(s => s.PstCode).ToListAsync(ct)).ToHashSet();
        return Controler(pointages, p0, chantiers, nc);
    }

    private static List<Controle> Controler(IReadOnlyList<PointageEntite> pointages, ParametresDto p0, IReadOnlyDictionary<int, ChantierPointage> chantiers, HashSet<string> nc) =>
        ReglesPointage.ControlerSemaine(new ParametresControle(p0.PasMinutes, p0.AmplitudeJour, p0.AmplitudeSemaine),
            pointages.Select((p, i) => new PointageControle(p.PoiId == 0 ? i.ToString() : p.PoiId.ToString(), p.PoiDate.ToString("yyyy-MM-dd"), p.PoiChaId,
                p.PoiTypeMo == 0 ? null : p.PoiTypeMo.ToString(), p.PoiMinutes, p.PoiDebut, p.PoiFin, p.PoiSousType is not null && nc.Contains(p.PoiSousType), p.PoiMotif,
                chantiers.TryGetValue(p.PoiChaId, out var c) && c.Clos)).ToList());

    /// <summary>Synthèse d'une semaine : une ligne par salarié visible (RH : tous ; chef : ceux de ses services).</summary>
    public async Task<object> SyntheseAsync(int? service, string? recherche, DateOnly lundi, Utilisateur u, CancellationToken ct)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        var p0 = await pointage.ParametresAsync(ct);
        var salaries = await specialisation.SalariesAsync(db, new FiltreSalaries(service, recherche), ct);
        var roles = await RolesAsync(u, salaries.Select(s => s.Id).ToList(), ct);
        if (!roles.Rh) salaries = salaries.Where(s => roles.Chef.Contains(s.Id)).ToList();
        var ids = salaries.Select(s => s.Id).ToList();
        var retenus = await pointage.Retenus(ids, lundi).ToListAsync(ct);
        var corrigees = await db.Semaines.AsNoTracking().Where(x => x.PsmLundi == lundi && ids.Contains(x.PsmSalId)).Select(x => x.PsmSalId).ToListAsync(ct);
        var saisiesCorrigees = await db.Pointages.AsNoTracking()
            .Where(p => corrigees.Contains(p.PoiSalId) && p.PoiCouche == Couches.Saisie && p.PoiDate >= lundi && p.PoiDate <= lundi.AddDays(6)).ToListAsync(ct);
        var etats = await pointage.EtatsAsync(ids, lundi, p0.Validation, ct);
        var corrections = await db.Corrections.AsNoTracking().Where(c => c.PcoLundi == lundi && c.PcoEtat == "EN_ATTENTE" && ids.Contains(c.PcoSalId)).ToListAsync(ct);
        var travailles = await specialisation.JoursTravaillesAsync(db, ids, lundi, ct);
        // Congés : un jour entièrement couvert par un congé validé n'est plus attendu (pas d'exception « sans pointage »).
        var absences = await conges.AbsencesAsync(ids, lundi, lundi.AddDays(6), ct);
        var nc = (await db.SousTypes.AsNoTracking().Where(s => s.PstNonConformite).Select(s => s.PstCode).ToListAsync(ct)).ToHashSet();
        var chantiersIds = retenus.Select(p => p.PoiChaId).Distinct().ToList();
        var chantiers = (await specialisation.ChantiersAsync(db, null, chantiersIds, ct)).ToDictionary(c => c.Id);
        var profilsZone = (await db.Regles.AsNoTracking().Where(r => r.PrgActif && r.PrgType == "ZONE").Select(r => r.PrgPpfId).ToListAsync(ct)).ToHashSet();
        var zones = (await db.Zones.AsNoTracking().Where(z => chantiersIds.Contains(z.PzcChaId)).Select(z => new { z.PzcChaId, z.PzcAgence }).ToListAsync(ct))
            .Select(z => (z.PzcChaId, z.PzcAgence)).ToHashSet();
        var lignes = new List<object>();
        foreach (var s in salaries)
        {
            var l = retenus.Where(p => p.PoiSalId == s.Id).ToList();
            var controles = Controler(l, p0, chantiers, nc);
            var corrigee = corrigees.Contains(s.Id);
            var abs = absences.Where(a => a.Salarie == s.Id).ToList();
            var absents = abs.Where(a => a.Etat == "VALIDE").GroupBy(a => a.Date).Where(g => g.Sum(a => a.Part) >= 1).Select(g => g.Key).ToHashSet();
            var exceptions = ReglesValidation.Exceptions(travailles.GetValueOrDefault(s.Id, []).Where(d => !absents.Contains(d)).Select(d => d.ToString("yyyy-MM-dd")).ToList(),
                l.Select(p => new PointageSynthese(p.PoiDate.ToString("yyyy-MM-dd"), p.PoiMinutes, p.PoiSousType is not null && nc.Contains(p.PoiSousType))).ToList(),
                p0.SeuilSemaine, controles.Count, corrections.Count(c => c.PcoSalId == s.Id),
                corrigee && Empreinte(l) != Empreinte(saisiesCorrigees.Where(p => p.PoiSalId == s.Id)),
                s.PpfId is int ppf && profilsZone.Contains(ppf) && s.Agence is not null
                    ? l.Select(p => p.PoiChaId).Distinct().Count(c => chantiers.TryGetValue(c, out var ch) && !ch.Interne && !zones.Contains((c, s.Agence))) : 0);
            lignes.Add(new
            {
                salarie = s, jours = Enumerable.Range(0, 7).Select(i => l.Where(p => p.PoiDate == lundi.AddDays(i)).Sum(p => p.PoiMinutes)).ToList(),
                etats = etats[s.Id], exceptions, corrigee, chef = roles.Chef.Contains(s.Id),
                absences = Enumerable.Range(0, 7).Select(i => abs.Where(a => a.Date == lundi.AddDays(i))
                    .Select(a => new { conge = a.Conge, etat = a.Etat, nature = a.Nature, part = a.Part }).ToList()).ToList(),
            });
        }
        return new
        {
            lundi, parametres = p0, rh = roles.Rh, lignes, natures = await conges.NaturesAsync(ct),
            corrections = corrections.Select(c => new { id = c.PcoId, salarie = c.PcoSalId, motif = c.PcoMotif, par = c.PcoPar, le = c.PcoLe }),
        };
    }

    internal async Task<(SalariePointage Salarie, Roles Roles)> AccesAsync(int salarie, Utilisateur u, CancellationToken ct)
    {
        var s = (await specialisation.SalariesAsync(db, new FiltreSalaries(null, null, [salarie]), ct)).FirstOrDefault() ?? throw ExceptionMetier.Introuvable($"Salarié {salarie}");
        var r = await RolesAsync(u, [salarie], ct);
        if (!r.Rh && !r.Chef.Contains(salarie)) throw ExceptionMetier.AccesRefuse("VALIDER_POINTAGES");
        return (s, r);
    }

    private static object Ligne(PointageEntite p) => new
    {
        id = p.PoiId, origine_id = p.PoiOrigineId, date = p.PoiDate, cha_id = p.PoiChaId, ent_id = p.PoiEntId, type_mo = p.PoiTypeMo, sous_type = p.PoiSousType,
        minutes = p.PoiMinutes, debut = p.PoiDebut, fin = p.PoiFin, motif = p.PoiMotif, commentaire = p.PoiCommentaire, saisi_par = p.PoiSaisiPar, saisi_le = p.PoiSaisiLe,
    };

    /// <summary>Détail d'une semaine : saisie, couche validée, états, validations (annulées comprises), corrections, journal.</summary>
    public async Task<object> DetailAsync(int salarie, DateOnly lundi, Utilisateur u, CancellationToken ct)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        var (s, roles) = await AccesAsync(salarie, u, ct);
        var dimanche = lundi.AddDays(6);
        var p0 = await pointage.ParametresAsync(ct);
        var tous = await db.Pointages.AsNoTracking().Where(p => p.PoiSalId == salarie && p.PoiDate >= lundi && p.PoiDate <= dimanche)
            .OrderBy(p => p.PoiDate).ThenBy(p => p.PoiDebut).ThenBy(p => p.PoiId).ToListAsync(ct);
        var corrigee = await db.Semaines.AsNoTracking().AnyAsync(x => x.PsmSalId == salarie && x.PsmLundi == lundi, ct);
        var retenus = tous.Where(p => p.PoiCouche == (corrigee ? Couches.Valide : Couches.Saisie)).ToList();
        var chantiersIds = tous.Select(p => p.PoiChaId).Distinct().ToList();
        return new
        {
            salarie = s, lundi, corrigee, rh = roles.Rh, chef = roles.Chef.Contains(salarie), parametres = p0,
            saisie = tous.Where(p => p.PoiCouche == Couches.Saisie).Select(Ligne),
            valide = corrigee ? tous.Where(p => p.PoiCouche == Couches.Valide).Select(Ligne).ToList() : null,
            etats = (await pointage.EtatsAsync([salarie], lundi, p0.Validation, ct))[salarie],
            controles = await ControlerAsync(retenus, p0, ct),
            validations = await db.Validations.AsNoTracking().Where(v => v.PvlSalId == salarie && v.PvlDu <= dimanche && v.PvlAu >= lundi).OrderBy(v => v.PvlLe)
                .Select(v => new { niveau = v.PvlNiveau, du = v.PvlDu, au = v.PvlAu, par = v.PvlPar, le = v.PvlLe, annule_par = v.PvlAnnulePar, annule_le = v.PvlAnnuleLe, annule_motif = v.PvlAnnuleMotif })
                .ToListAsync(ct),
            corrections = (await db.Corrections.AsNoTracking().Where(c => c.PcoSalId == salarie && c.PcoLundi == lundi).OrderByDescending(c => c.PcoLe).ToListAsync(ct))
                .Select(c => new { id = c.PcoId, etat = c.PcoEtat, motif = c.PcoMotif, par = c.PcoPar, le = c.PcoLe, reponse = c.PcoReponse, traite_par = c.PcoTraitePar,
                    pointages = JsonSerializer.Deserialize<JsonElement>(c.PcoPointages) }),
            journal = await db.Journal.AsNoTracking().Where(j => j.PjoSalId == salarie && j.PjoLundi == lundi).OrderByDescending(j => j.PjoLe)
                .Select(j => new { action = j.PjoAction, par = j.PjoPar, le = j.PjoLe, detail = j.PjoDetail }).ToListAsync(ct),
            chantiers = await specialisation.ChantiersAsync(db, null, chantiersIds, ct),
            ordres = await specialisation.OrdresAsync(db, chantiersIds, ct),
        };
    }

    internal void Journaliser(int salarie, DateOnly lundi, string action, object detail, Utilisateur u) =>
        db.Journal.Add(new JournalEntite { PjoSalId = salarie, PjoLundi = lundi, PjoAction = action, PjoDetail = JsonSerializer.Serialize(detail, Json), PjoPar = u.Code });

    /// <summary>Remplace la couche validée de la semaine (semaine marquée corrigée) ; contrôles bloquants refusés.</summary>
    private async Task EcrireCoucheValideeAsync(int salarie, DateOnly lundi, List<PointageSaisi> saisis, Utilisateur u, CancellationToken ct)
    {
        var dimanche = lundi.AddDays(6);
        if (saisis.Any(p => p.Date < lundi || p.Date > dimanche)) throw ExceptionMetier.Invalide("POI_SEMAINE_HORS", "Pointage hors de la semaine");
        if (saisis.Any(p => p.ChaId is null || p.TypeMo is null)) throw ExceptionMetier.Invalide("POI_CHANTIER", "Chantier et type de main-d'œuvre obligatoires");
        var origines = await db.Pointages.AsNoTracking().Where(p => p.PoiSalId == salarie && p.PoiCouche == Couches.Saisie && p.PoiDate >= lundi && p.PoiDate <= dimanche)
            .ToDictionaryAsync(p => p.PoiId, ct);
        // Ligne de l'ordre : celle posée, sinon celle du pointage d'origine resté sur le même ordre.
        long? Ligne(PointageSaisi p) => p.LigId ?? (p.OrigineId is long o && origines.TryGetValue(o, out var x) && x.PoiEntId == p.EntId ? x.PoiLigId : null);
        var nouveaux = saisis.Select(p => new PointageEntite
        {
            PoiCouche = Couches.Valide, PoiOrigineId = p.OrigineId is long o && origines.ContainsKey(o) ? o : null, PoiSalId = salarie, PoiDate = p.Date,
            PoiChaId = p.ChaId!.Value, PoiEntId = p.EntId, PoiLigId = Ligne(p), PoiTypeMo = p.TypeMo!.Value, PoiSousType = p.SousType, PoiMinutes = (short)p.Minutes,
            PoiDebut = (short?)p.Debut, PoiFin = (short?)p.Fin, PoiMotif = string.IsNullOrWhiteSpace(p.Motif) ? null : p.Motif.Trim(),
            PoiCommentaire = string.IsNullOrWhiteSpace(p.Commentaire) ? null : p.Commentaire, PoiSaisiPar = u.Code,
        }).ToList();
        var controles = await ControlerAsync(nouveaux, await pointage.ParametresAsync(ct), ct);
        if (ReglesPointage.Bloquant(controles))
            throw ExceptionMetier.Invalide(controles.First(c => c.Niveau == ReglesPointage.Erreur).Code,
                string.Join(" · ", controles.Where(c => c.Niveau == ReglesPointage.Erreur).Select(c => ReglesPointage.Messages[c.Code]).Distinct()), controles);
        await db.Pointages.Where(p => p.PoiSalId == salarie && p.PoiCouche == Couches.Valide && p.PoiDate >= lundi && p.PoiDate <= dimanche).ExecuteDeleteAsync(ct);
        db.Pointages.AddRange(nouveaux);
        var sem = await db.Semaines.FirstOrDefaultAsync(x => x.PsmSalId == salarie && x.PsmLundi == lundi, ct);
        if (sem is null) db.Semaines.Add(sem = new SemaineEntite { PsmSalId = salarie, PsmLundi = lundi });
        sem.PsmCorrigePar = u.Code;
        sem.PsmCorrigeLe = DateTimeOffset.UtcNow;
    }

    internal async Task ControlerModifiableAsync(int salarie, DateOnly lundi, Roles roles, CancellationToken ct)
    {
        var etats = (await pointage.EtatsAsync([salarie], lundi, (await pointage.ParametresAsync(ct)).Validation, ct))[salarie];
        if (etats.Contains(ReglesValidation.Valide)) throw ExceptionMetier.Conflit(ErreursPointage.PoiValide, "Semaine validée par le service RH : la dévalider d'abord");
        if (!roles.Rh && etats.Contains(ReglesValidation.ValideChef)) throw ExceptionMetier.Conflit(ErreursPointage.PoiValide, "Semaine validée : la dévalider d'abord");
    }

    /// <summary>Corrections du chef ou du RH : couche validée (créée à la première modification), journalisée.</summary>
    public async Task<object> EnregistrerAsync(int salarie, DateOnly lundi, SemaineSaisie s, Utilisateur u, CancellationToken ct)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        var (_, roles) = await AccesAsync(salarie, u, ct);
        await ControlerModifiableAsync(salarie, lundi, roles, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await EcrireCoucheValideeAsync(salarie, lundi, s.Pointages, u, ct);
        Journaliser(salarie, lundi, "MODIFIER", new { pointages = s.Pointages.Count, minutes = s.Pointages.Sum(p => p.Minutes) }, u);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await DetailAsync(salarie, lundi, u, ct);
    }

    /// <summary>Revient à la saisie : couche validée supprimée (semaine non validée).</summary>
    public async Task<object> RetablirAsync(int salarie, DateOnly lundi, Utilisateur u, CancellationToken ct)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        var (_, roles) = await AccesAsync(salarie, u, ct);
        await ControlerModifiableAsync(salarie, lundi, roles, ct);
        await db.Pointages.Where(p => p.PoiSalId == salarie && p.PoiCouche == Couches.Valide && p.PoiDate >= lundi && p.PoiDate <= lundi.AddDays(6)).ExecuteDeleteAsync(ct);
        await db.Semaines.Where(x => x.PsmSalId == salarie && x.PsmLundi == lundi).ExecuteDeleteAsync(ct);
        Journaliser(salarie, lundi, "RETABLIR", new { }, u);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(salarie, lundi, u, ct);
    }

    private (DateOnly Du, DateOnly Au) Periode(ActionSynthese a, ParametresDto p0)
    {
        var lundi = ReglesPointage.LundiDe(a.Lundi);
        if (p0.Blocage == "SEMAINE") return (lundi, lundi.AddDays(6));
        var du = a.Du ?? lundi;
        var au = a.Au ?? lundi.AddDays(6);
        if (du < lundi || au > lundi.AddDays(6) || au < du) throw ExceptionMetier.Invalide("POI_PERIODE", "Période hors de la semaine");
        return (du, au);
    }

    /// <summary>
    /// Valide les salariés donnés sur la période (la semaine si le blocage est à la semaine) : niveau RH pour le service
    /// RH, CHEF pour le chef de service ; résultat par salarié (codes de refus, vide si validé).
    /// </summary>
    public async Task<object> ValiderAsync(ActionSynthese a, Utilisateur u, CancellationToken ct) => await AgirAsync("VALIDER", a, u, ct);

    /// <summary>Dévalide (motif obligatoire) : le chef ses validations tant que le RH n'a pas validé, le RH toutes.</summary>
    public async Task<object> DevaliderAsync(ActionSynthese a, Utilisateur u, CancellationToken ct) => await AgirAsync("DEVALIDER", a, u, ct);

    private async Task<object> AgirAsync(string action, ActionSynthese a, Utilisateur u, CancellationToken ct)
    {
        var p0 = await pointage.ParametresAsync(ct);
        var lundi = ReglesPointage.LundiDe(a.Lundi);
        var (du, au) = Periode(a, p0);
        var roles = await RolesAsync(u, a.Salaries, ct);
        if (!roles.Rh && a.Salaries.Any(s => !roles.Chef.Contains(s))) throw ExceptionMetier.AccesRefuse("VALIDER_POINTAGES");
        var role = roles.Rh ? "RH" : "CHEF";
        var etats = await pointage.EtatsAsync(a.Salaries, lundi, p0.Validation, ct);
        var jours = Enumerable.Range(0, 7).Where(i => lundi.AddDays(i) >= du && lundi.AddDays(i) <= au).ToList();
        var resultats = new List<object>();
        foreach (var s in a.Salaries.Distinct())
        {
            var codes = ReglesValidation.ControlerAction(action, role, p0.Validation, jours.Select(i => etats[s][i]).ToList(), a.Motif);
            var apresExport = action == "DEVALIDER" && codes.Count == 0
                && await db.Exports.AnyAsync(e => e.PexDu <= au && e.PexAu >= du && e.PexSalaries.Contains(s), ct);
            resultats.Add(new { salarie = s, codes, apres_export = apresExport });
            if (codes.Count > 0) continue;
            if (action == "VALIDER")
            {
                db.Validations.Add(new ValidationEntite { PvlSalId = s, PvlDu = du, PvlAu = au, PvlNiveau = role, PvlPar = u.Code });
            }
            else
            {
                var annulees = await db.Validations.Where(v => v.PvlSalId == s && v.PvlAnnuleLe == null && v.PvlDu <= au && v.PvlAu >= du && (role == "RH" || v.PvlNiveau == "CHEF")).ToListAsync(ct);
                foreach (var v in annulees)
                {
                    v.PvlAnnulePar = u.Code;
                    v.PvlAnnuleLe = DateTimeOffset.UtcNow;
                    v.PvlAnnuleMotif = a.Motif!.Trim();
                }
            }
            Journaliser(s, lundi, action, new { niveau = role, du, au, motif = a.Motif, apres_export = apresExport }, u);
        }
        await db.SaveChangesAsync(ct);
        return new { role, resultats };
    }

    /// <summary>
    /// Demande de correction (M17) : la semaine envoyée par la saisie alors que des jours sont validés ; gardée telle
    /// quelle pour le service RH (tâche par l'application).
    /// </summary>
    public async Task<object> DemanderCorrectionAsync(CorrectionSaisie c, Utilisateur u, CancellationToken ct)
    {
        var lundi = ReglesPointage.LundiDe(c.Lundi);
        var s = await pointage.SalarieAsync(c.Salarie, u, ct);
        if (c.Pointages.Any(p => p.Date < lundi || p.Date > lundi.AddDays(6))) throw ExceptionMetier.Invalide("POI_SEMAINE_HORS", "Pointage hors de la semaine");
        var e = new CorrectionEntite { PcoSalId = c.Salarie, PcoLundi = lundi, PcoPointages = JsonSerializer.Serialize(c.Pointages, Json), PcoMotif = c.Motif?.Trim(), PcoPar = u.Code };
        db.Corrections.Add(e);
        Journaliser(c.Salarie, lundi, "CORRECTION", new { motif = c.Motif, pointages = c.Pointages.Count }, u);
        await db.SaveChangesAsync(ct);
        await specialisation.ApresCorrectionAsync(db, services, u, s, e, ct);
        return new { id = e.PcoId };
    }

    private async Task<CorrectionEntite> CorrectionAsync(long id, Utilisateur u, CancellationToken ct)
    {
        var c = await db.Corrections.FirstOrDefaultAsync(x => x.PcoId == id, ct) ?? throw ExceptionMetier.Introuvable($"Demande de correction {id}");
        if (!u.EstAdmin && !await specialisation.EstRhAsync(db, u, ct)) throw ExceptionMetier.AccesRefuse("VALIDER_POINTAGES");
        if (c.PcoEtat != "EN_ATTENTE") throw ExceptionMetier.Conflit("POI_CORRECTION_TRAITEE", "Demande déjà traitée");
        return c;
    }

    /// <summary>Applique une demande : la semaine demandée devient la couche validée (semaine non validée par le RH).</summary>
    public async Task<object> AppliquerCorrectionAsync(long id, ReponseCorrection r, Utilisateur u, CancellationToken ct)
    {
        var c = await CorrectionAsync(id, u, ct);
        await ControlerModifiableAsync(c.PcoSalId, c.PcoLundi, new Roles(true, []), ct);
        var pointages = JsonSerializer.Deserialize<List<PointageSaisi>>(c.PcoPointages, Json) ?? [];
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await EcrireCoucheValideeAsync(c.PcoSalId, c.PcoLundi, pointages.Select(p => p with { OrigineId = p.Id }).ToList(), u, ct);
        c.PcoEtat = "APPLIQUEE";
        c.PcoTraitePar = u.Code;
        c.PcoTraiteLe = DateTimeOffset.UtcNow;
        c.PcoReponse = r.Reponse?.Trim();
        Journaliser(c.PcoSalId, c.PcoLundi, "CORRECTION_APPLIQUEE", new { id, reponse = r.Reponse }, u);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await DetailAsync(c.PcoSalId, c.PcoLundi, u, ct);
    }

    public async Task<object> RejeterCorrectionAsync(long id, ReponseCorrection r, Utilisateur u, CancellationToken ct)
    {
        var c = await CorrectionAsync(id, u, ct);
        c.PcoEtat = "REJETEE";
        c.PcoTraitePar = u.Code;
        c.PcoTraiteLe = DateTimeOffset.UtcNow;
        c.PcoReponse = r.Reponse?.Trim();
        Journaliser(c.PcoSalId, c.PcoLundi, "CORRECTION_REJETEE", new { id, reponse = r.Reponse }, u);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(c.PcoSalId, c.PcoLundi, u, ct);
    }
}
