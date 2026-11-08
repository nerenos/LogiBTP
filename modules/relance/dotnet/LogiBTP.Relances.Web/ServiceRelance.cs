using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Relances.Web;

/// <summary>Pièce d'une relance due : niveau propre, jours de retard, montant relancé, échéances échues et futures.</summary>
public sealed record PieceDueDto(long Id, long? GroupeId, string? Numero, int Niveau, int Repetition, int Jours, decimal Montant, DateOnly Depart,
    IReadOnlyList<long> Echues, IReadOnlyList<EcheanceFuture> Futures);

/// <summary>Relance due groupée (tiers, chargé, nature, mode) : niveau le plus élevé et ses modèles, pièces.</summary>
public sealed record GroupeDuDto(long TiersId, string? Tiers, long? ChargeId, string? Charge, string Nature, string Mode, int Niveau,
    long? ModeleCourriel, long? ModeleEdition, int Jours, decimal Montant, List<PieceDueDto> Pieces);

/// <summary>Relance du journal.</summary>
public sealed record RelanceDto(long Id, long? LotId, int Groupe, long PieceId, long? GroupeId, string Nature, long TiersId, long? ChargeId,
    int Niveau, int Repetition, string Mode, string Etat, DateOnly Date, string Auteur, decimal Montant, int Jours, long? CourrielId, long? GedId,
    string? Recommande, string? Commentaire);

/// <summary>Groupe d'un lot : pièces envoyées ensemble.</summary>
public sealed record GroupeLotDto(int Groupe, long TiersId, long? ChargeId, string Nature, string Mode, int Niveau, List<RelanceDto> Relances);

/// <summary>Lot de relances : date du calcul, auteur, nombre de pièces, état, groupes.</summary>
public sealed record LotDto(long Id, DateOnly Date, string Auteur, int Nombre, string Etat, List<GroupeLotDto> Groupes);

/// <summary>Lot sans ses groupes (liste).</summary>
public sealed record LotResumeDto(long Id, DateOnly Date, string Auteur, int Nombre, string Etat);

/// <summary>Groupe validé : mode choisi (null : celui du groupe), commentaire, relances retenues (null : toutes celles proposées).</summary>
public sealed record GroupeValide(int Groupe, string? Mode = null, string? Commentaire = null, IReadOnlyList<long>? Relances = null);

/// <summary>Validation d'un lot : groupes envoyés (les autres restent proposés).</summary>
public sealed record ValidationLot(List<GroupeValide> Groupes);

/// <summary>Envoi d'un groupe en échec : il reste proposé.</summary>
public sealed record EchecEnvoi(int Groupe, string Code, string Message);

/// <summary>Résultat d'une validation : lot relu, échecs.</summary>
public sealed record ResultatValidation(LotDto Lot, List<EchecEnvoi> Echecs);

/// <summary>Préparation d'un lot : date du calcul (défaut : aujourd'hui).</summary>
public sealed record DemandePreparation(DateOnly? Date = null);

/// <summary>Annulation de relances proposées d'un lot (null : toutes).</summary>
public sealed record DemandeAnnulation(IReadOnlyList<long>? Relances = null);

/// <summary>Numéro d'un recommandé.</summary>
public sealed record NumeroRecommande(string? Numero);

/// <summary>Relance faite hors du module, notée au journal au niveau atteint (Q22 b) : pièce, mode, date (défaut : aujourd'hui).</summary>
public sealed record RelanceNotee(long PieceId, string Mode, DateOnly? Date = null, string? Commentaire = null);

/// <summary>Suspension saisie : pièce ou tiers, jusqu'au (compris), motif, commentaire.</summary>
public sealed record SuspensionSaisie(long? PieceId, long? TiersId, DateOnly JusquAu, string Motif, string? Commentaire = null);

/// <summary>Suspension lue.</summary>
public sealed record SuspensionDto(long Id, long? PieceId, long? TiersId, DateOnly JusquAu, string Motif, string? Commentaire, string CreePar);

/// <summary>
/// Services du module Relances : règle par nature, relances dues (ReglesRelance sur les pièces de la spécialisation,
/// journal, suspensions, surcharges, portée), préparation d'un lot, validation (envoi par la spécialisation, groupe par
/// groupe), annulation, numéro de recommandé, relance notée, journal, suspensions.
/// </summary>
public class ServiceRelance(RelanceDbContext db, SpecialisationRelance specialisation, TimeProvider? horloge = null)
{
    private static readonly string[] Natures = [NatureRelance.Devis, NatureRelance.Facture];
    private static readonly string[] Faites = [EtatRelance.Envoyee, EtatRelance.AttenteNumero];

    private DateOnly Aujourdhui => DateOnly.FromDateTime((horloge ?? TimeProvider.System).GetLocalNow().DateTime);

    // ----- Règles -----

    /// <summary>Règle de chaque nature (ligne de relance_regle, sinon règle par défaut).</summary>
    public async Task<Dictionary<string, RegleRelance>> Regles(CancellationToken ct)
    {
        var lignes = await db.Regles.AsNoTracking().ToDictionaryAsync(r => r.RrgNature, ct);
        return Natures.ToDictionary(n => n, n => lignes.TryGetValue(n, out var l)
            ? new RegleRelance(JsonSerializer.Deserialize<List<NiveauRelance>>(l.RrgNiveaux, JsonCalcul.Options) ?? [], l.RrgRepeter, l.RrgIntervalle)
            : ReglesRelance.RegleParDefaut(n));
    }

    /// <summary>Enregistre la règle d'une nature (paramétrage : administrateur), contrôlée par ReglesRelance.Controler.</summary>
    public async Task<RegleRelance> EnregistrerRegle(string nature, RegleRelance regle, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        ControlerNature(nature);
        var erreurs = ReglesRelance.Controler(regle, nature);
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], "Règle de relance invalide", erreurs);
        var ligne = await db.Regles.FirstOrDefaultAsync(r => r.RrgNature == nature, ct);
        if (ligne is null) db.Regles.Add(ligne = new RegleEntite { RrgNature = nature });
        ligne.RrgNiveaux = JsonSerializer.Serialize(regle.Niveaux, JsonCalcul.Options);
        ligne.RrgRepeter = regle.Repeter;
        ligne.RrgIntervalle = regle.Repeter ? regle.Intervalle : null;
        ligne.RrgModifieLe = DateTimeOffset.UtcNow;
        ligne.RrgModifiePar = u.Code;
        await db.SaveChangesAsync(ct);
        return regle with { Intervalle = ligne.RrgIntervalle };
    }

    // ----- Relances dues -----

    private sealed record Calcul(List<RelanceDue> Dues, Dictionary<long, PieceEnAttente> Pieces, Dictionary<string, RegleRelance> Regles,
        Dictionary<long, SurchargeTiers> Surcharges, PorteeRelance Portee);

    /// <summary>
    /// Relances dues à une date : pièces de la spécialisation dans la portée, sans relance déjà proposée dans un lot ;
    /// dernière relance faite du journal (groupe d'indices), suspension la plus lointaine de la pièce ou de son tiers,
    /// surcharge du tiers (règle propre, « ne pas relancer », mode préféré).
    /// </summary>
    private async Task<Calcul> CalculerAsync(DateOnly date, Utilisateur u, FiltrePieces filtre, CancellationToken ct)
    {
        var portee = await specialisation.PorteeAsync(db, u, ct);
        var pieces = (await specialisation.PiecesEnAttenteAsync(db, filtre, ct)).Where(p => portee.Couvre(p.ChargeId)).ToList();
        var ids = pieces.Select(p => p.Id).ToList();
        var groupes = pieces.Where(p => p.GroupeId is not null).Select(p => p.GroupeId!.Value).Distinct().ToList();
        var tiers = pieces.Select(p => p.TiersId).Distinct().ToList();
        var regles = await Regles(ct);
        var surcharges = tiers.Count == 0 ? new Dictionary<long, SurchargeTiers>() : await specialisation.RegleDuTiersAsync(db, tiers, ct);

        var suspensions = await db.Suspensions.AsNoTracking()
            .Where(s => s.RsuJusquAu >= date && ((s.RsuEntId != null && ids.Contains(s.RsuEntId.Value)) || (s.RsuTiersId != null && tiers.Contains(s.RsuTiersId.Value))))
            .ToListAsync(ct);
        var journal = await db.Relances.AsNoTracking()
            .Where(r => ids.Contains(r.RelEntId) || (r.RelEntGroupeId != null && groupes.Contains(r.RelEntGroupeId.Value)))
            .Where(r => r.RelEtat != EtatRelance.Annulee)
            .ToListAsync(ct);
        var proposees = journal.Where(r => r.RelEtat == EtatRelance.Proposee).Select(r => r.RelEntId).ToHashSet();

        DateOnly? Suspendue(PieceEnAttente p) => suspensions
            .Where(s => s.RsuEntId == p.Id || s.RsuTiersId == p.TiersId).Select(s => (DateOnly?)s.RsuJusquAu).Max();
        RelanceFaite? Derniere(PieceEnAttente p) => journal
            .Where(r => Faites.Contains(r.RelEtat) && (r.RelEntId == p.Id || (p.GroupeId is not null && r.RelEntGroupeId == p.GroupeId)))
            .OrderByDescending(r => r.RelDate).ThenByDescending(r => r.RelId)
            .Select(r => new RelanceFaite(r.RelNiveau, r.RelDate)).FirstOrDefault();

        var aCalculer = pieces.Where(p => !proposees.Contains(p.Id)).Select(p =>
        {
            var s = surcharges.GetValueOrDefault(p.TiersId);
            return new PieceRelance(p.Id, p.Nature, p.TiersId, p.ChargeId, p.Depart, p.Montant, p.Echeances, Derniere(p),
                p.Arretee || s is { NePasRelancer: true }, Suspendue(p), s?.Regle);
        });
        var dues = ReglesRelance.Dues(regles, aCalculer, date, specialisation.Seuil).Select(d =>
        {
            var prefere = surcharges.GetValueOrDefault(d.Tiers)?.ModePrefere;
            // Un niveau en RECOMMANDE (mise en demeure, Q13) n'est jamais remplacé par le mode préféré du tiers.
            return d.Mode != ModeRelance.Recommande && prefere is not null && ModeAdmis(prefere, d.Nature) ? d with { Mode = prefere } : d;
        }).ToList();
        return new Calcul(dues, pieces.ToDictionary(p => p.Id), regles, surcharges, portee);
    }

    /// <summary>Relances dues à une date (défaut : aujourd'hui), regroupées par tiers, chargé, nature et mode.</summary>
    public async Task<List<GroupeDuDto>> Dues(DateOnly? date, Utilisateur u, CancellationToken ct)
    {
        var jour = date ?? Aujourdhui;
        var c = await CalculerAsync(jour, u, new FiltrePieces(), ct);
        var dues = c.Dues.ToDictionary(d => d.Id);
        return ReglesRelance.Regrouper(c.Dues).Select(g =>
        {
            var premiere = c.Pieces[g.Pieces[0].Id];
            return new GroupeDuDto(g.Tiers, premiere.Tiers, g.Charge, premiere.Charge, g.Nature, g.Mode, g.Niveau, g.ModeleCourriel, g.ModeleEdition,
                g.Jours, g.Montant, g.Pieces.Select(p =>
                {
                    var d = dues[p.Id];
                    var piece = c.Pieces[p.Id];
                    return new PieceDueDto(p.Id, piece.GroupeId, piece.Numero, p.Niveau, p.Repetition, p.Jours, p.Montant, d.Depart, d.Echues, d.Futures);
                }).ToList());
        }).ToList();
    }

    // ----- Lots -----

    /// <summary>Prépare un lot des relances dues (état PREPARE, relances PROPOSEE) ; null s'il n'y a rien à relancer.</summary>
    public async Task<LotDto?> Preparer(DemandePreparation demande, Utilisateur u, CancellationToken ct)
    {
        var date = demande.Date ?? Aujourdhui;
        var c = await CalculerAsync(date, u, new FiltrePieces(), ct);
        if (c.Dues.Count == 0) return null;
        var lot = new LotRelance { RloDate = date, RloCreeLe = DateTimeOffset.UtcNow, RloAuteur = u.Code, RloNombre = c.Dues.Count, RloEtat = EtatLotRelance.Prepare };
        db.Lots.Add(lot);
        var dues = c.Dues.ToDictionary(d => d.Id);
        var numero = 0;
        foreach (var g in ReglesRelance.Regrouper(c.Dues))
        {
            numero++;
            foreach (var p in g.Pieces)
            {
                var d = dues[p.Id];
                db.Relances.Add(new Relance
                {
                    Lot = lot, RelGroupe = numero, RelEntId = d.Id, RelEntGroupeId = c.Pieces[d.Id].GroupeId, RelNature = d.Nature, RelTiersId = d.Tiers,
                    RelChargeId = d.Charge, RelNiveau = d.Niveau, RelRepetition = d.Repetition, RelMode = d.Mode, RelEtat = EtatRelance.Proposee,
                    RelDate = date, RelAuteur = u.Code, RelMontant = d.Montant, RelJours = d.Jours, RelCreeLe = DateTimeOffset.UtcNow,
                });
            }
        }
        await db.SaveChangesAsync(ct);
        return await Lot(lot.RloId, ct);
    }

    /// <summary>Lots, du plus récent au plus ancien, filtrés par état.</summary>
    public Task<List<LotResumeDto>> Lots(string? etat, CancellationToken ct) =>
        db.Lots.AsNoTracking().Where(l => etat == null || l.RloEtat == etat).OrderByDescending(l => l.RloId)
            .Select(l => new LotResumeDto(l.RloId, l.RloDate, l.RloAuteur, l.RloNombre, l.RloEtat)).ToListAsync(ct);

    /// <summary>Lot avec ses groupes et leurs relances.</summary>
    public async Task<LotDto> Lot(long id, CancellationToken ct)
    {
        var lot = await db.Lots.AsNoTracking().FirstOrDefaultAsync(l => l.RloId == id, ct) ?? throw ExceptionMetier.Introuvable($"Lot de relances {id}");
        var relances = await db.Relances.AsNoTracking().Where(r => r.RelRloId == id).OrderBy(r => r.RelGroupe).ThenBy(r => r.RelId).ToListAsync(ct);
        var groupes = relances.GroupBy(r => r.RelGroupe).Select(g =>
        {
            var l = g.ToList();
            return new GroupeLotDto(g.Key, l[0].RelTiersId, l[0].RelChargeId, l[0].RelNature, l[0].RelMode, l.Max(r => r.RelNiveau), l.Select(Dto).ToList());
        }).ToList();
        return new LotDto(lot.RloId, lot.RloDate, lot.RloAuteur, lot.RloNombre, lot.RloEtat, groupes);
    }

    /// <summary>
    /// Valide des groupes d'un lot : chaque groupe est envoyé par la spécialisation (mode choisi, commentaire, relances
    /// retenues) puis inscrit au journal (ENVOYEE ou ATTENTE_NUMERO) ; un envoi en échec laisse son groupe proposé ; les
    /// relances non retenues restent proposées (lot PARTIEL).
    /// </summary>
    public async Task<ResultatValidation> Valider(long lotId, ValidationLot validation, Utilisateur u, CancellationToken ct)
    {
        var lot = await db.Lots.FirstOrDefaultAsync(l => l.RloId == lotId, ct) ?? throw ExceptionMetier.Introuvable($"Lot de relances {lotId}");
        if (lot.RloEtat == EtatLotRelance.Envoye) throw ExceptionMetier.Conflit(ErreurRelance.LotClos, "Lot de relances clos");
        var relances = await db.Relances.Where(r => r.RelRloId == lotId).ToListAsync(ct);
        var portee = await specialisation.PorteeAsync(db, u, ct);
        var regles = await Regles(ct);
        var date = Aujourdhui;
        var echecs = new List<EchecEnvoi>();
        var faites = new List<Relance>();

        // Contrôles avant tout envoi : groupe connu, dans la portée, mode admis.
        var choix = validation.Groupes.Select(v =>
        {
            var groupe = relances.Where(r => r.RelGroupe == v.Groupe).ToList();
            if (groupe.Count == 0) throw ExceptionMetier.Invalide(ErreurRelance.GroupeInconnu, $"Groupe {v.Groupe} absent du lot {lotId}");
            if (groupe.Any(r => !portee.Couvre(r.RelChargeId))) throw ExceptionMetier.AccesRefuse(ErreurRelance.HorsPortee);
            var mode = v.Mode ?? groupe[0].RelMode;
            if (!ModeAdmis(mode, groupe[0].RelNature)) throw ExceptionMetier.Invalide(ErreurRelance.Mode, $"Mode {mode} non admis");
            var retenues = groupe.Where(r => r.RelEtat == EtatRelance.Proposee && (v.Relances is null || v.Relances.Contains(r.RelId))).ToList();
            return (v, mode, retenues);
        }).ToList();

        var surcharges = await specialisation.RegleDuTiersAsync(db, relances.Select(r => r.RelTiersId).Distinct().ToList(), ct);
        foreach (var (v, mode, retenues) in choix)
        {
            if (retenues.Count == 0) continue;
            var premiere = retenues[0];
            var niveau = retenues.Max(r => r.RelNiveau);
            var regle = surcharges.GetValueOrDefault(premiere.RelTiersId)?.Regle ?? regles[premiere.RelNature];
            var modele = regle.Niveaux.FirstOrDefault(n => n.Rang == niveau);
            var envoi = new EnvoiRelance(lotId, v.Groupe, premiere.RelTiersId, premiere.RelChargeId, premiere.RelNature, mode, niveau,
                modele?.ModeleCourriel, modele?.ModeleEdition,
                retenues.Select(r => new PieceEnvoi(r.RelId, r.RelEntId, r.RelNiveau, r.RelJours, r.RelMontant)).ToList(), v.Commentaire, u, date);
            ResultatEnvoi resultat;
            try
            {
                resultat = await specialisation.EnvoyerAsync(db, envoi, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                echecs.Add(new EchecEnvoi(v.Groupe, e is ExceptionMetier m ? m.Code : "ERREUR", e.Message));
                continue;
            }
            foreach (var r in retenues)
            {
                r.RelEtat = resultat.Etat;
                r.RelMode = resultat.Mode ?? mode;
                r.RelDate = date;
                r.RelAuteur = u.Code;
                r.RelCommentaire = v.Commentaire;
                r.RelCourrielId = resultat.CourrielId;
                r.RelGedId = resultat.GedId;
            }
            await db.SaveChangesAsync(ct);
            faites.AddRange(retenues);
        }
        lot.RloEtat = EtatLot(relances);
        await db.SaveChangesAsync(ct);
        if (faites.Count > 0) await specialisation.ApresEnvoiAsync(db, faites.Select(Dto).ToList(), ct);
        return new ResultatValidation(await Lot(lotId, ct), echecs);
    }

    /// <summary>Annule des relances proposées d'un lot (toutes si la liste est absente) ; le lot est clos s'il n'en reste plus.</summary>
    public async Task<LotDto> Annuler(long lotId, DemandeAnnulation demande, Utilisateur u, CancellationToken ct)
    {
        var lot = await db.Lots.FirstOrDefaultAsync(l => l.RloId == lotId, ct) ?? throw ExceptionMetier.Introuvable($"Lot de relances {lotId}");
        var relances = await db.Relances.Where(r => r.RelRloId == lotId).ToListAsync(ct);
        var portee = await specialisation.PorteeAsync(db, u, ct);
        foreach (var r in relances.Where(r => r.RelEtat == EtatRelance.Proposee && (demande.Relances is null || demande.Relances.Contains(r.RelId))))
        {
            if (!portee.Couvre(r.RelChargeId)) throw ExceptionMetier.AccesRefuse(ErreurRelance.HorsPortee);
            r.RelEtat = EtatRelance.Annulee;
            r.RelAuteur = u.Code;
        }
        lot.RloEtat = EtatLot(relances);
        await db.SaveChangesAsync(ct);
        return await Lot(lotId, ct);
    }

    /// <summary>État d'un lot : PREPARE (rien de fait), PARTIEL (une partie faite, le reste proposé), ENVOYE (plus rien de proposé).</summary>
    private static string EtatLot(IReadOnlyCollection<Relance> relances) =>
        !relances.Any(r => r.RelEtat == EtatRelance.Proposee) ? EtatLotRelance.Envoye
        : relances.Any(r => Faites.Contains(r.RelEtat)) ? EtatLotRelance.Partiel
        : EtatLotRelance.Prepare;

    /// <summary>Numéro d'un recommandé : toutes les relances de la même lettre (lot et groupe) passent à ENVOYEE.</summary>
    public async Task<List<RelanceDto>> SaisirNumero(long relanceId, NumeroRecommande saisie, Utilisateur u, CancellationToken ct)
    {
        var numero = saisie.Numero?.Trim();
        if (string.IsNullOrEmpty(numero)) throw ExceptionMetier.Invalide(ErreurRelance.NumeroVide, "Numéro du recommandé obligatoire");
        var r = await db.Relances.FirstOrDefaultAsync(x => x.RelId == relanceId, ct) ?? throw ExceptionMetier.Introuvable($"Relance {relanceId}");
        if (r.RelEtat != EtatRelance.AttenteNumero) throw ExceptionMetier.Conflit(ErreurRelance.PasEnAttenteNumero, "Relance non en attente de numéro");
        if (!(await specialisation.PorteeAsync(db, u, ct)).Couvre(r.RelChargeId)) throw ExceptionMetier.AccesRefuse(ErreurRelance.HorsPortee);
        List<Relance> lettre = r.RelRloId is null ? [r]
            : await db.Relances.Where(x => x.RelRloId == r.RelRloId && x.RelGroupe == r.RelGroupe && x.RelEtat == EtatRelance.AttenteNumero).ToListAsync(ct);
        foreach (var x in lettre)
        {
            x.RelEtat = EtatRelance.Envoyee;
            x.RelRecommande = numero;
        }
        await db.SaveChangesAsync(ct);
        return lettre.Select(Dto).ToList();
    }

    /// <summary>Relance faite hors du module (appel, courriel personnel) notée au journal au niveau atteint de la pièce.</summary>
    public async Task<RelanceDto> Noter(RelanceNotee note, Utilisateur u, CancellationToken ct)
    {
        var date = note.Date ?? Aujourdhui;
        var c = await CalculerAsync(date, u, new FiltrePieces(Pieces: [note.PieceId]), ct);
        var d = c.Dues.FirstOrDefault(x => x.Id == note.PieceId)
            ?? throw ExceptionMetier.Invalide(ErreurRelance.RienANoter, $"Aucune relance due pour la pièce {note.PieceId}");
        if (!ModeAdmis(note.Mode, d.Nature)) throw ExceptionMetier.Invalide(ErreurRelance.Mode, $"Mode {note.Mode} non admis");
        var r = new Relance
        {
            RelEntId = d.Id, RelEntGroupeId = c.Pieces[d.Id].GroupeId, RelNature = d.Nature, RelTiersId = d.Tiers, RelChargeId = d.Charge,
            RelNiveau = d.Niveau, RelRepetition = d.Repetition, RelMode = note.Mode, RelEtat = EtatRelance.Envoyee, RelDate = date,
            RelAuteur = u.Code, RelMontant = d.Montant, RelJours = d.Jours, RelCommentaire = note.Commentaire, RelCreeLe = DateTimeOffset.UtcNow,
        };
        db.Relances.Add(r);
        await db.SaveChangesAsync(ct);
        var dto = Dto(r);
        await specialisation.ApresEnvoiAsync(db, [dto], ct);
        return dto;
    }

    /// <summary>Journal d'une pièce (et des autres indices de son groupe) ou d'un tiers, du plus récent au plus ancien.</summary>
    public async Task<List<RelanceDto>> Journal(long? piece, long? groupe, long? tiers, CancellationToken ct)
    {
        var q = db.Relances.AsNoTracking();
        if (piece is not null || groupe is not null) q = q.Where(r => r.RelEntId == piece || (groupe != null && r.RelEntGroupeId == groupe));
        if (tiers is long t) q = q.Where(r => r.RelTiersId == t);
        var lignes = await q.OrderByDescending(r => r.RelDate).ThenByDescending(r => r.RelId).ToListAsync(ct);
        return lignes.Select(Dto).ToList();
    }

    // ----- Suspensions -----

    /// <summary>Suspensions d'une pièce ou d'un tiers ; actives : jusqu'au aujourd'hui ou après.</summary>
    public Task<List<SuspensionDto>> Suspensions(long? piece, long? tiers, bool actives, CancellationToken ct)
    {
        var jour = Aujourdhui;
        return db.Suspensions.AsNoTracking()
            .Where(s => (piece == null || s.RsuEntId == piece) && (tiers == null || s.RsuTiersId == tiers) && (!actives || s.RsuJusquAu >= jour))
            .OrderBy(s => s.RsuJusquAu).ThenBy(s => s.RsuId)
            .Select(s => new SuspensionDto(s.RsuId, s.RsuEntId, s.RsuTiersId, s.RsuJusquAu, s.RsuMotif, s.RsuCommentaire, s.RsuCreePar)).ToListAsync(ct);
    }

    /// <summary>Crée ou modifie une suspension : pièce ou tiers (un seul), motif connu, jusqu'au aujourd'hui ou après.</summary>
    public async Task<SuspensionDto> EnregistrerSuspension(long? id, SuspensionSaisie s, Utilisateur u, CancellationToken ct)
    {
        if ((s.PieceId is null) == (s.TiersId is null)) throw ExceptionMetier.Invalide(ErreurRelance.SuspensionCible, "Suspendre une pièce ou un tiers");
        if (!MotifSuspension.Tous.Contains(s.Motif)) throw ExceptionMetier.Invalide(ErreurRelance.SuspensionMotif, $"Motif {s.Motif} inconnu");
        if (s.JusquAu < Aujourdhui) throw ExceptionMetier.Invalide(ErreurRelance.SuspensionDate, "Suspension échue");
        var e = id is long x
            ? await db.Suspensions.FirstOrDefaultAsync(r => r.RsuId == x, ct) ?? throw ExceptionMetier.Introuvable($"Suspension {x}")
            : db.Suspensions.Add(new SuspensionRelance { RsuCreeLe = DateTimeOffset.UtcNow, RsuCreePar = u.Code }).Entity;
        e.RsuEntId = s.PieceId;
        e.RsuTiersId = s.TiersId;
        e.RsuJusquAu = s.JusquAu;
        e.RsuMotif = s.Motif;
        e.RsuCommentaire = s.Commentaire;
        await db.SaveChangesAsync(ct);
        return new SuspensionDto(e.RsuId, e.RsuEntId, e.RsuTiersId, e.RsuJusquAu, e.RsuMotif, e.RsuCommentaire, e.RsuCreePar);
    }

    public async Task SupprimerSuspension(long id, CancellationToken ct)
    {
        if (await db.Suspensions.Where(s => s.RsuId == id).ExecuteDeleteAsync(ct) == 0) throw ExceptionMetier.Introuvable($"Suspension {id}");
    }

    // ----- Outils -----

    private static void ControlerNature(string nature)
    {
        if (!Natures.Contains(nature)) throw ExceptionMetier.Invalide(ErreurRelance.Nature, $"Nature de relance {nature} inconnue");
    }

    /// <summary>Mode connu, TACHE pour les devis seulement.</summary>
    private static bool ModeAdmis(string mode, string nature) => ModeRelance.Tous.Contains(mode) && (mode != ModeRelance.Tache || nature == NatureRelance.Devis);

    private static RelanceDto Dto(Relance r) => new(r.RelId, r.RelRloId, r.RelGroupe, r.RelEntId, r.RelEntGroupeId, r.RelNature, r.RelTiersId,
        r.RelChargeId, r.RelNiveau, r.RelRepetition, r.RelMode, r.RelEtat, r.RelDate, r.RelAuteur, r.RelMontant, r.RelJours, r.RelCourrielId,
        r.RelGedId, r.RelRecommande, r.RelCommentaire);
}
