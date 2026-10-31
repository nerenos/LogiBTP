using LogiBTP.Socle;
using LogiBTP.Reglements;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Reglements.Web;

/// <summary>Échéance avec son pointé et son reste (ResteAPayer).</summary>
public sealed record EcheanceDto(long Id, long PieceId, string? Piece, string Type, long TiersId, string? Tiers, string Sens,
    DateOnly? Date, decimal Montant, string Nature, long? ObjetId, decimal Pointe, decimal Reste, bool Reglee);

/// <summary>Pointage saisi : échéance et montant (du signe de l'échéance).</summary>
public sealed record PointageSaisi(long EcheanceId, decimal Montant);

/// <summary>Règlement saisi avec ses pointages.</summary>
public sealed record ReglementSaisi(long TiersId, string Sens, DateOnly Date, string Mode, decimal Montant, string? Reference, string? Commentaire,
    List<PointageSaisi> Pointages);

/// <summary>Caution saisie avec ses pointages (échéances de retenue).</summary>
public sealed record CautionSaisie(long TiersId, string? Objet, long? ObjetId, string Organisme, decimal Montant, DateOnly Date, DateOnly? DateFin,
    string? Reference, DateOnly? Mainlevee, List<PointageSaisi> Pointages);

/// <summary>Règlement lu : non pointé (trop-perçu) et pointages.</summary>
public sealed record ReglementDto(long Id, long TiersId, string Sens, DateOnly Date, string Mode, decimal Montant, string? Reference, string? Commentaire,
    decimal NonPointe, List<PointageSaisi> Pointages);

/// <summary>Caution lue : non pointé et pointages.</summary>
public sealed record CautionDto(long Id, long TiersId, string? Objet, long? ObjetId, string Organisme, decimal Montant, DateOnly Date, DateOnly? DateFin,
    string? Reference, DateOnly? Mainlevee, decimal NonPointe, List<PointageSaisi> Pointages);

/// <summary>
/// Imputation sur une échéance à régler (décision du 31/10/2026) : d'un avoir (échéance négative du même tiers et du même
/// sens) ou du trop-perçu d'un règlement ; date (défaut : aujourd'hui), commentaire.
/// </summary>
public sealed record ImputationSaisie(long EcheanceId, decimal Montant, long? AvoirEcheanceId, long? ReglementId, DateOnly? Date, string? Commentaire);

/// <summary>Pièce en contrepartie d'une imputation (l'avoir imputé, ou la facture sur laquelle l'avoir est imputé).</summary>
public sealed record ContrepartieDto(long EcheanceId, long PieceId, string? Piece, string Type, decimal Montant);

/// <summary>
/// Pointage d'une échéance d'une pièce, avec son origine (SourcePointage) : règlement (date, mode, référence), caution
/// (organisme) ou imputation (pièces en contrepartie) ; montant du signe de l'échéance.
/// </summary>
public sealed record PointagePieceDto(long Id, long EcheanceId, decimal Montant, string Source, long SourceId, DateOnly Date, string? Mode, string? Reference,
    string? Commentaire, List<ContrepartieDto> Contreparties);

/// <summary>État d'une pièce : montant, pointé, reste, statut.</summary>
public sealed record EtatPieceDto(long PieceId, decimal Montant, decimal Pointe, decimal Reste, string Statut);

/// <summary>
/// Services du module Règlements : échéances avec leur reste, état des pièces, règlements et cautions avec leurs
/// pointages (contrôles : même tiers et même sens, signe de l'échéance, échéance non dépassée, source non dépassée).
/// </summary>
public class ServiceReglement(ReglementDbContext db, SpecialisationReglement specialisation)
{
    public async Task<List<EcheanceDto>> Echeances(FiltreEcheances filtre, bool ouvertes, CancellationToken ct)
    {
        var sources = await specialisation.EcheancesAsync(db, filtre, ct);
        var ids = sources.Select(e => e.Id).ToList();
        var pointes = await db.Pointages.AsNoTracking().Where(p => ids.Contains(p.PoiEcheanceId))
            .GroupBy(p => p.PoiEcheanceId).Select(g => new { Id = g.Key, Total = g.Sum(p => p.PoiMontant) }).ToDictionaryAsync(x => x.Id, x => x.Total, ct);
        return sources.Select(e =>
        {
            var pointe = pointes.GetValueOrDefault(e.Id);
            var etat = ResteAPayer.Echeance(e.Montant, pointe, specialisation.Seuil);
            return new EcheanceDto(e.Id, e.PieceId, e.Piece, e.Type, e.TiersId, e.Tiers, e.Sens, e.Date, e.Montant, e.Nature, e.ObjetId, pointe, etat.Reste, etat.Reglee);
        }).Where(e => !ouvertes || !e.Reglee).ToList();
    }

    public async Task<List<EtatPieceDto>> EtatPieces(List<long> pieces, CancellationToken ct) =>
        (await Echeances(new FiltreEcheances(Pieces: pieces), false, ct)).GroupBy(e => e.PieceId)
        .Select(g =>
        {
            var p = ResteAPayer.Piece(g.Select(e => (e.Montant, e.Pointe)), specialisation.Seuil);
            return new EtatPieceDto(g.Key, p.Montant, p.Pointe, p.Reste, p.Statut);
        }).ToList();

    public Task<List<TiersReglement>> Tiers(CancellationToken ct) => specialisation.TiersAsync(db, ct);

    // ------------------------------------------------------------------ règlements

    public async Task<List<ReglementDto>> Reglements(long? tiers, string? sens, CancellationToken ct)
    {
        var liste = await db.Reglements.AsNoTracking().Where(r => (tiers == null || r.RegTiersId == tiers) && (sens == null || r.RegSens == sens))
            .OrderByDescending(r => r.RegDate).ThenByDescending(r => r.RegId).Take(500).ToListAsync(ct);
        var ids = liste.Select(r => r.RegId).ToList();
        var pointages = await db.Pointages.AsNoTracking().Where(p => p.PoiRegId != null && ids.Contains(p.PoiRegId.Value)).ToListAsync(ct);
        return liste.Select(r =>
        {
            var p = pointages.Where(x => x.PoiRegId == r.RegId).Select(x => new PointageSaisi(x.PoiEcheanceId, x.PoiMontant)).ToList();
            return new ReglementDto(r.RegId, r.RegTiersId, r.RegSens, r.RegDate, r.RegMode, r.RegMontant, r.RegReference, r.RegCommentaire,
                ResteAPayer.NonPointe(r.RegMontant, p.Select(x => x.Montant)), p);
        }).ToList();
    }

    public async Task<ReglementDto> EnregistrerReglement(long? id, ReglementSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (s.Sens is not ("E" or "D")) throw ExceptionMetier.Invalide("REGLEMENT", "Sens E (encaissement) ou D (décaissement)");
        // Une imputation d'avoir est un règlement de montant nul (l'avoir et la facture pointés se compensent).
        if ((s.Montant == 0 && s.Mode != ModeReglementSysteme.Imputation) || string.IsNullOrWhiteSpace(s.Mode))
        {
            throw ExceptionMetier.Invalide("REGLEMENT", "Montant non nul et mode de règlement obligatoires");
        }
        await ControlerPointages(s.TiersId, s.Sens, s.Montant, s.Pointages, id, null, null, ct);
        var touchees = await EcheancesPointees(id, null, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var r = id is long x ? await db.Reglements.FirstOrDefaultAsync(r => r.RegId == x, ct) ?? throw ExceptionMetier.Introuvable($"Règlement {x}")
            : db.Reglements.Add(new Reglement { RegCreeLe = DateTimeOffset.UtcNow, RegCreePar = u.Code }).Entity;
        r.RegTiersId = s.TiersId;
        r.RegSens = s.Sens;
        r.RegDate = s.Date;
        r.RegMode = s.Mode;
        r.RegMontant = s.Montant;
        r.RegReference = s.Reference;
        r.RegCommentaire = s.Commentaire;
        await db.SaveChangesAsync(ct);
        await db.Pointages.Where(p => p.PoiRegId == r.RegId).ExecuteDeleteAsync(ct);
        db.Pointages.AddRange(s.Pointages.Where(p => p.Montant != 0).Select(p => new Pointage { PoiRegId = r.RegId, PoiEcheanceId = p.EcheanceId, PoiMontant = p.Montant }));
        await db.SaveChangesAsync(ct);
        await specialisation.ApresPointageAsync(db, [.. touchees, .. s.Pointages.Select(p => p.EcheanceId)], ct);
        await tx.CommitAsync(ct);
        return (await Reglements(r.RegTiersId, null, ct)).First(x => x.Id == r.RegId);
    }

    public async Task SupprimerReglement(long id, CancellationToken ct)
    {
        var touchees = await EcheancesPointees(id, null, ct);
        if (await db.Reglements.Where(r => r.RegId == id).ExecuteDeleteAsync(ct) == 0) throw ExceptionMetier.Introuvable($"Règlement {id}");
        await specialisation.ApresPointageAsync(db, touchees, ct);
    }

    // ------------------------------------------------------------------ imputations

    /// <summary>
    /// Imputation d'un avoir ou du trop-perçu d'un règlement sur une échéance à régler (facture suivante) : avoir →
    /// règlement IMPUTATION de montant nul pointant l'avoir (négatif) et l'échéance ; règlement → pointage ajouté à ce
    /// règlement. Plafond : <see cref="ResteAPayer.MaximumImputation"/> ; mêmes contrôles qu'un pointage.
    /// </summary>
    public async Task<ReglementDto> Imputer(ImputationSaisie s, Utilisateur u, CancellationToken ct)
    {
        if ((s.AvoirEcheanceId is null) == (s.ReglementId is null)) throw ExceptionMetier.Invalide("IMPUTATION", "Imputer un avoir ou un règlement");
        if (s.Montant <= 0) throw ExceptionMetier.Invalide("IMPUTATION", "Montant positif");
        var ids = new List<long> { s.EcheanceId };
        if (s.AvoirEcheanceId is long a) ids.Add(a);
        var echeances = (await Echeances(new FiltreEcheances(Ids: ids), false, ct)).ToDictionary(e => e.Id);
        if (!echeances.TryGetValue(s.EcheanceId, out var cible)) throw ExceptionMetier.Introuvable($"Échéance {s.EcheanceId}");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        Reglement r;
        List<PointageSaisi> pointages;
        decimal disponible;
        if (s.AvoirEcheanceId is long avoirId)
        {
            if (!echeances.TryGetValue(avoirId, out var avoir)) throw ExceptionMetier.Introuvable($"Échéance {avoirId}");
            if (avoir.Montant >= 0) throw ExceptionMetier.Invalide("IMPUTATION", "Seul un avoir (montant négatif) s'impute");
            disponible = avoir.Reste;
            pointages = [new PointageSaisi(avoirId, -s.Montant), new PointageSaisi(s.EcheanceId, s.Montant)];
            ControlerImputation(s.Montant, disponible, cible);
            await ControlerPointages(cible.TiersId, cible.Sens, 0, pointages, null, null, null, ct);
            r = db.Reglements.Add(new Reglement
            {
                RegTiersId = cible.TiersId, RegSens = cible.Sens, RegDate = s.Date ?? DateOnly.FromDateTime(DateTime.Today), RegMode = ModeReglementSysteme.Imputation,
                RegMontant = 0, RegReference = avoir.Piece, RegCommentaire = s.Commentaire, RegCreeLe = DateTimeOffset.UtcNow, RegCreePar = u.Code,
            }).Entity;
            await db.SaveChangesAsync(ct);
        }
        else
        {
            r = await db.Reglements.FirstOrDefaultAsync(x => x.RegId == s.ReglementId, ct) ?? throw ExceptionMetier.Introuvable($"Règlement {s.ReglementId}");
            var existants = await db.Pointages.AsNoTracking().Where(p => p.PoiRegId == r.RegId).Select(p => new PointageSaisi(p.PoiEcheanceId, p.PoiMontant)).ToListAsync(ct);
            disponible = ResteAPayer.NonPointe(r.RegMontant, existants.Select(p => p.Montant));
            ControlerImputation(s.Montant, disponible, cible);
            pointages = [.. existants.Where(p => p.EcheanceId != s.EcheanceId),
                new PointageSaisi(s.EcheanceId, existants.Where(p => p.EcheanceId == s.EcheanceId).Sum(p => p.Montant) + s.Montant)];
            await ControlerPointages(r.RegTiersId, r.RegSens, r.RegMontant, pointages, r.RegId, null, null, ct);
        }
        await db.Pointages.Where(p => p.PoiRegId == r.RegId).ExecuteDeleteAsync(ct);
        db.Pointages.AddRange(pointages.Where(p => p.Montant != 0).Select(p => new Pointage { PoiRegId = r.RegId, PoiEcheanceId = p.EcheanceId, PoiMontant = p.Montant }));
        await db.SaveChangesAsync(ct);
        await specialisation.ApresPointageAsync(db, pointages.Select(p => p.EcheanceId).ToList(), ct);
        await tx.CommitAsync(ct);
        return (await Reglements(r.RegTiersId, null, ct)).First(x => x.Id == r.RegId);
    }

    private static void ControlerImputation(decimal montant, decimal disponible, EcheanceDto cible)
    {
        var max = ResteAPayer.MaximumImputation(disponible, cible.Reste);
        if (max == 0) throw ExceptionMetier.Invalide("IMPUTATION", "Rien à imputer : échéance réglée ou disponible épuisé");
        if (montant > max) throw ExceptionMetier.Invalide("IMPUTATION", $"Imputation de {max:0.00} au plus");
    }

    /// <summary>
    /// Pointages des échéances d'une pièce avec leur origine (onglet Règlements de la page document, éditions) :
    /// règlements, cautions, imputations (pièces en contrepartie : les autres échéances pointées par l'imputation).
    /// </summary>
    public async Task<List<PointagePieceDto>> PointagesPiece(long piece, CancellationToken ct)
    {
        var ids = (await specialisation.EcheancesAsync(db, new FiltreEcheances(Pieces: [piece]), ct)).Select(e => e.Id).ToList();
        var pointages = await db.Pointages.AsNoTracking().Where(p => ids.Contains(p.PoiEcheanceId)).OrderBy(p => p.PoiId).ToListAsync(ct);
        var regIds = pointages.Where(p => p.PoiRegId != null).Select(p => p.PoiRegId!.Value).Distinct().ToList();
        var cauIds = pointages.Where(p => p.PoiCauId != null).Select(p => p.PoiCauId!.Value).Distinct().ToList();
        var reglements = await db.Reglements.AsNoTracking().Where(r => regIds.Contains(r.RegId)).ToDictionaryAsync(r => r.RegId, ct);
        var cautions = await db.Cautions.AsNoTracking().Where(c => cauIds.Contains(c.CauId)).ToDictionaryAsync(c => c.CauId, ct);
        var imputations = reglements.Values.Where(r => r.RegMode == ModeReglementSysteme.Imputation).Select(r => r.RegId).ToList();
        var autres = await db.Pointages.AsNoTracking().Where(p => p.PoiRegId != null && imputations.Contains(p.PoiRegId.Value) && !ids.Contains(p.PoiEcheanceId)).ToListAsync(ct);
        var sources = autres.Count == 0 ? []
            : (await specialisation.EcheancesAsync(db, new FiltreEcheances(Ids: autres.Select(p => p.PoiEcheanceId).Distinct().ToList()), ct)).ToDictionary(e => e.Id);
        return pointages.Select(p =>
        {
            if (p.PoiCauId is long c)
            {
                var x = cautions[c];
                return new PointagePieceDto(p.PoiId, p.PoiEcheanceId, p.PoiMontant, SourcePointage.Caution, c, x.CauDate, null, x.CauReference, x.CauOrganisme, []);
            }
            var r = reglements[p.PoiRegId!.Value];
            var imputation = r.RegMode == ModeReglementSysteme.Imputation;
            var contreparties = !imputation ? [] : autres.Where(o => o.PoiRegId == r.RegId && sources.ContainsKey(o.PoiEcheanceId))
                .Select(o => { var e = sources[o.PoiEcheanceId]; return new ContrepartieDto(e.Id, e.PieceId, e.Piece, e.Type, o.PoiMontant); }).ToList();
            return new PointagePieceDto(p.PoiId, p.PoiEcheanceId, p.PoiMontant, imputation ? SourcePointage.Imputation : SourcePointage.Reglement, r.RegId,
                r.RegDate, r.RegMode, r.RegReference, r.RegCommentaire, contreparties);
        }).ToList();
    }

    /// <summary>Échéances pointées par un règlement ou une caution (avant modification).</summary>
    private async Task<List<long>> EcheancesPointees(long? regId, long? cauId, CancellationToken ct) =>
        regId is null && cauId is null ? []
        : await db.Pointages.AsNoTracking().Where(p => (regId != null && p.PoiRegId == regId) || (cauId != null && p.PoiCauId == cauId))
            .Select(p => p.PoiEcheanceId).Distinct().ToListAsync(ct);

    // ------------------------------------------------------------------ cautions

    public async Task<List<CautionDto>> Cautions(long? tiers, string? objet, long? objetId, CancellationToken ct)
    {
        var liste = await db.Cautions.AsNoTracking()
            .Where(c => (tiers == null || c.CauTiersId == tiers) && (objet == null || c.CauObjet == objet) && (objetId == null || c.CauObjetId == objetId))
            .OrderByDescending(c => c.CauDate).ToListAsync(ct);
        var ids = liste.Select(c => c.CauId).ToList();
        var pointages = await db.Pointages.AsNoTracking().Where(p => p.PoiCauId != null && ids.Contains(p.PoiCauId.Value)).ToListAsync(ct);
        return liste.Select(c =>
        {
            var p = pointages.Where(x => x.PoiCauId == c.CauId).Select(x => new PointageSaisi(x.PoiEcheanceId, x.PoiMontant)).ToList();
            return new CautionDto(c.CauId, c.CauTiersId, c.CauObjet, c.CauObjetId, c.CauOrganisme, c.CauMontant, c.CauDate, c.CauDateFin, c.CauReference,
                c.CauMainlevee, ResteAPayer.NonPointe(c.CauMontant, p.Select(x => x.Montant)), p);
        }).ToList();
    }

    /// <summary>Caution : pointe des échéances de retenue de garantie (la retenue est « libérée par caution »).</summary>
    public async Task<CautionDto> EnregistrerCaution(long? id, CautionSaisie s, CancellationToken ct)
    {
        if (s.Montant <= 0 || string.IsNullOrWhiteSpace(s.Organisme)) throw ExceptionMetier.Invalide("CAUTION", "Organisme et montant positif obligatoires");
        await ControlerPointages(s.TiersId, null, s.Montant, s.Pointages, null, id, "RETENUE", ct);
        var touchees = await EcheancesPointees(null, id, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var c = id is long x ? await db.Cautions.FirstOrDefaultAsync(c => c.CauId == x, ct) ?? throw ExceptionMetier.Introuvable($"Caution {x}")
            : db.Cautions.Add(new Caution()).Entity;
        c.CauTiersId = s.TiersId;
        c.CauObjet = s.Objet;
        c.CauObjetId = s.ObjetId;
        c.CauOrganisme = s.Organisme.Trim();
        c.CauMontant = s.Montant;
        c.CauDate = s.Date;
        c.CauDateFin = s.DateFin;
        c.CauReference = s.Reference;
        c.CauMainlevee = s.Mainlevee;
        await db.SaveChangesAsync(ct);
        await db.Pointages.Where(p => p.PoiCauId == c.CauId).ExecuteDeleteAsync(ct);
        db.Pointages.AddRange(s.Pointages.Where(p => p.Montant != 0).Select(p => new Pointage { PoiCauId = c.CauId, PoiEcheanceId = p.EcheanceId, PoiMontant = p.Montant }));
        await db.SaveChangesAsync(ct);
        await specialisation.ApresPointageAsync(db, [.. touchees, .. s.Pointages.Select(p => p.EcheanceId)], ct);
        await tx.CommitAsync(ct);
        return (await Cautions(c.CauTiersId, null, null, ct)).First(x => x.Id == c.CauId);
    }

    public async Task SupprimerCaution(long id, CancellationToken ct)
    {
        var touchees = await EcheancesPointees(null, id, ct);
        if (await db.Cautions.Where(c => c.CauId == id).ExecuteDeleteAsync(ct) == 0) throw ExceptionMetier.Introuvable($"Caution {id}");
        await specialisation.ApresPointageAsync(db, touchees, ct);
    }

    /// <summary>
    /// Pointages d'une source (règlement ou caution) : échéances connues, du tiers (et du sens), montant du signe de
    /// l'échéance, échéance non dépassée (pointages des autres sources compris), source non dépassée.
    /// </summary>
    private async Task ControlerPointages(long tiers, string? sens, decimal disponible, List<PointageSaisi> pointages, long? regId, long? cauId, string? nature, CancellationToken ct)
    {
        if (pointages.Count == 0) return;
        if (pointages.GroupBy(p => p.EcheanceId).Any(g => g.Count() > 1)) throw ExceptionMetier.Invalide("POINTAGE", "Une échéance n'est pointée qu'une fois par règlement");
        var ids = pointages.Select(p => p.EcheanceId).ToList();
        var echeances = (await specialisation.EcheancesAsync(db, new FiltreEcheances(Ids: ids), ct)).ToDictionary(e => e.Id);
        var autres = await db.Pointages.AsNoTracking()
            .Where(p => ids.Contains(p.PoiEcheanceId) && (regId == null || p.PoiRegId != regId) && (cauId == null || p.PoiCauId != cauId))
            .GroupBy(p => p.PoiEcheanceId).Select(g => new { Id = g.Key, Total = g.Sum(p => p.PoiMontant) }).ToDictionaryAsync(x => x.Id, x => x.Total, ct);
        var erreurs = new List<string>();
        foreach (var p in pointages.Where(p => p.Montant != 0))
        {
            if (!echeances.TryGetValue(p.EcheanceId, out var e)) { erreurs.Add($"Échéance {p.EcheanceId} introuvable"); continue; }
            if (e.TiersId != tiers || (sens is not null && e.Sens != sens)) erreurs.Add($"{e.Piece} : échéance d'un autre tiers ou de l'autre sens");
            if (nature is not null && e.Nature != nature) erreurs.Add($"{e.Piece} : une caution ne pointe que des retenues de garantie");
            if (Math.Sign(p.Montant) != Math.Sign(e.Montant)) erreurs.Add($"{e.Piece} : pointage du signe de l'échéance");
            if (Math.Abs(autres.GetValueOrDefault(e.Id) + p.Montant) > Math.Abs(e.Montant)) erreurs.Add($"{e.Piece} : pointé au-delà du montant de l'échéance");
        }
        var nonPointe = ResteAPayer.NonPointe(disponible, pointages.Select(p => p.Montant));
        if (nonPointe * Math.Sign(disponible) < 0) erreurs.Add("Les pointages dépassent le montant du règlement");
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("POINTAGE", string.Join(" ; ", erreurs.Distinct()));
    }
}
