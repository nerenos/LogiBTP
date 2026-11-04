using System.Security.Cryptography;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LogiBTP.Mail.Web;

/// <summary>
/// Réception des courriels (lot 3) : relève IMAP des dossiers de chaque compte (suivi par UID, rien n'est supprimé sur le
/// serveur), courriel enregistré une fois par compte et rangé par l'application (GED de la boîte), avis de non-remise
/// rapprochés des envois (destinataire en erreur, alerte), liste « À rapprocher », rattachement manuel à un élément
/// (action IMAP de l'option du compte), courriels ignorés, purge des courriels non rapprochés anciens.
/// </summary>
public sealed class ServiceReceptionMail(MailDbContext db, ServiceComptesMail comptes, ITransportMail transport, SpecialisationMail specialisation,
    NettoyageHtmlMail nettoyage, ILogger<ServiceReceptionMail> journal, TimeProvider horloge)
{
    public const string Fond = "mail_fond";
    private const int MaxParDossier = 200;

    private DateTimeOffset Maintenant => horloge.GetUtcNow();

    // --- Relève ---

    /// <summary>Comptes de réception actifs dont la relève est due (intervalle de leurs options) : relevés tour à tour.</summary>
    public async Task<int> ReleverDusAsync(CancellationToken ct)
    {
        var total = 0;
        foreach (var c in await db.Comptes.Where(c => c.McoActif && c.McoReception).ToListAsync(ct))
        {
            var o = ServiceComptesMail.OptionsDe(c);
            if (c.McoReleveLe is { } r && Maintenant - r < TimeSpan.FromMinutes(o.IntervalleMinutes)) continue;
            total += await ReleverAsync(c, ct);
        }
        return total;
    }

    /// <summary>« Relever maintenant » d'un compte (personne qui voit la boîte) : nombre de nouveaux courriels.</summary>
    public async Task<int> ReleverMaintenantAsync(Utilisateur u, long compte, CancellationToken ct)
    {
        var c = await comptes.Compte(compte, ct);
        if (!await PeutVoirAsync(u, c, ct)) throw ExceptionMetier.AccesRefuse("LIRE");
        if (!c.McoReception) throw ExceptionMetier.Invalide("MAIL_RECEPTION", "Ce compte ne reçoit pas de courriels");
        return await ReleverAsync(c, ct);
    }

    private async Task<int> ReleverAsync(CompteEntite c, CancellationToken ct)
    {
        var cfg = comptes.Connexion(c);
        c.McoReleveLe = Maintenant;
        if (cfg.Imap is not { } imap)
        {
            c.McoReleveErreur = "Serveur de réception (IMAP) non configuré";
            await db.SaveChangesAsync(ct);
            return 0;
        }
        var o = ServiceComptesMail.OptionsDe(c);
        var etats = await db.Dossiers.Where(d => d.MdoMcoId == c.McoId).ToListAsync(ct);
        var dossiers = ServiceComptesMail.DossiersDe(c).Select(d =>
        {
            var e = etats.FirstOrDefault(x => x.MdoNom == d.Nom);
            return new DossierARelever(d.Nom, d.Role, e?.MdoUidvalidity is long v ? (uint)v : null, (uint)(e?.MdoDernierUid ?? 0));
        }).ToList();
        List<ResultatReleve> resultats;
        try
        {
            resultats = await transport.ReleverAsync(imap, await comptes.AuthAsync(c, imap, ct), dossiers,
                Maintenant.AddDays(-await comptes.ParametreAsync("premiere_releve_jours", 30, ct)),
                await comptes.ParametreAsync("taille_reception_mo", 25, ct) * 1024L * 1024, o.MarquerLus, MaxParDossier, ct);
        }
        catch (Exception e) when (e is ErreurEnvoi or ExceptionMetier)
        {
            c.McoReleveErreur = e.Message.Length > 500 ? e.Message[..500] : e.Message;
            await db.SaveChangesAsync(ct);
            journal.LogWarning("Mail : relève du compte {Code} impossible : {Erreur}", c.McoCode, e.Message);
            return 0;
        }
        var nouveaux = 0;
        foreach (var r in resultats)
        {
            foreach (var courriel in r.Courriels)
            {
                try
                {
                    if (await TraiterAsync(c, courriel, o, ct)) nouveaux++;
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    journal.LogWarning(e, "Mail : courriel {Uid} du dossier {Dossier} non traité", courriel.Uid, courriel.Dossier);
                    db.ChangeTracker.Clear();
                }
            }
            var etat = await db.Dossiers.FirstOrDefaultAsync(d => d.MdoMcoId == c.McoId && d.MdoNom == r.Dossier, ct);
            if (etat is null) db.Dossiers.Add(etat = new DossierEntite { MdoMcoId = c.McoId, MdoNom = r.Dossier });
            etat.MdoUidvalidity = r.UidValidity;
            etat.MdoDernierUid = r.DernierUid;
            etat.MdoReleveLe = Maintenant;
            etat.MdoReleves += r.Courriels.Count;
            etat.MdoErreur = r.Erreur;
            await db.SaveChangesAsync(ct);
        }
        var compte = await db.Comptes.FirstAsync(x => x.McoId == c.McoId, ct);
        compte.McoReleveLe = Maintenant;
        compte.McoReleveErreur = resultats.FirstOrDefault(r => r.Erreur is not null) is { } er ? $"{er.Dossier} : {er.Erreur}" : null;
        await db.SaveChangesAsync(ct);
        return nouveaux;
    }

    /// <summary>
    /// Courriel relevé : enregistré une fois par compte (empreinte du .eml), rangé par l'application ; avis de non-remise
    /// rapproché de l'envoi d'origine ; sinon à rapprocher (la reconnaissance automatique décide d'abord, lot 4).
    /// </summary>
    private async Task<bool> TraiterAsync(CompteEntite c, CourrielReleve r, OptionsCompte o, CancellationToken ct)
    {
        var empreinte = Convert.ToHexStringLower(SHA256.HashData(r.Eml));
        if (await db.Messages.AnyAsync(m => m.MmeMcoId == c.McoId && m.MmeSens == "R" && m.MmeEmpreinte == empreinte, ct)) return false;
        var lu = LectureMail.Lire(r.Eml);
        var corps = nettoyage.Nettoyer(lu.CorpsHtml);
        var alias = await db.Alias.AsNoTracking().Where(a => a.MalMcoId == c.McoId && a.MalPrincipal).FirstOrDefaultAsync(ct);
        var m = new MessageEntite
        {
            MmeMcoId = c.McoId, MmeMalId = alias?.MalId, MmeExpediteur = alias?.MalNom, MmeSens = "R", MmeEtat = "RECU", MmeMessageId = lu.MessageId,
            MmeInReplyTo = lu.InReplyTo, MmeReferences = lu.References.Count == 0 ? null : string.Join(' ', lu.References),
            MmeObjet = lu.Objet.Length > 500 ? lu.Objet[..500] : lu.Objet, MmeDe = lu.De is null ? null : Formater(lu.De), MmeCorpsHtml = corps,
            MmeExtrait = Extrait(lu.Texte), MmeDate = lu.Date ?? Maintenant, MmeEmpreinte = empreinte, MmeUid = r.Uid, MmeDossier = r.Dossier,
            MmeAuto = lu.Automatique, MmeCreePar = Fond, MmeCreeLe = Maintenant, MmeAttente = r.Tronque ? "courriel trop gros : en-têtes seuls" : null,
        };
        db.Messages.Add(m);
        await db.SaveChangesAsync(ct);
        db.Destinataires.AddRange(new[] { lu.De }.Where(x => x is not null).Select(x => Dest(m, "DE", x!))
            .Concat(lu.A.Select(x => Dest(m, "A", x))).Concat(lu.Cc.Select(x => Dest(m, "CC", x))));
        await db.SaveChangesAsync(ct);
        var depot = await specialisation.RecevoirAsync(new CourrielRecu(m.MmeId, c.McoId, m.MmeObjet, lu.De, lu.Date, r.Eml, lu.Texte, lu.Pieces,
            lu.A.Select(x => x.Adresse).ToList(), lu.Cc.Select(x => x.Adresse).ToList()), ct);
        m.MmeDgeId = depot.DgeId;
        db.Pieces.AddRange(depot.Pieces.Select(p => new PieceEntite { MpiMmeId = m.MmeId, MpiReference = p.Reference, MpiNom = p.Nom, MpiType = p.Type, MpiTaille = p.Taille }));
        if (lu.EstAvisDeNonRemise)
        {
            m.MmeEtat = "IGNORE";
            await db.SaveChangesAsync(ct);
            await NonRemisAsync(m, lu, ct);
            return true;
        }
        m.MmeEtat = "A_RAPPROCHER";
        await db.SaveChangesAsync(ct);
        // Dossier « à traiter » ou drapeau « à suivre » (option du compte) : toujours à rapprocher par une personne.
        if (r.Role != "A_TRAITER" && !(o.DrapeauASuivre && r.Drapeau)) await ReconnaitreAsync(m, lu, depot, ct);
        return true;
    }

    /// <summary>
    /// Reconnaissance automatique (lot 4) d'un courriel d'un dossier de réception : fil (réponse à un envoi ou à un
    /// courriel déjà rapproché), candidats et tiers fournis par l'application, règles et seuils ; rattachement
    /// automatique (et alerte au service), propositions gardées, ou courriel ignoré par une règle.
    /// </summary>
    private async Task ReconnaitreAsync(MessageEntite m, CourrielLu lu, DepotRecu depot, CancellationToken ct)
    {
        var ids = new[] { lu.InReplyTo }.Concat(lu.References).Where(x => !string.IsNullOrEmpty(x)).Distinct().ToList();
        var fil = ids.Count == 0 ? []
            : await (from l in db.Liens.AsNoTracking() join x in db.Messages.AsNoTracking() on l.MliMmeId equals x.MmeId
                     where ids.Contains(x.MmeMessageId) && x.MmeId != m.MmeId && l.MliRetireLe == null
                     select new { l.MliTypeElement, l.MliIdElement }).Distinct().ToListAsync(ct);
        var pieces = lu.Pieces.Select(p => p.Nom).ToList();
        var c = await specialisation.CandidatsAsync(new AnalyseCourriel(m.MmeId, lu.Objet, lu.Texte, pieces, depot.TextePieces, lu.De?.Adresse), ct);
        var regles = await ReglesAsync(m.MmeMcoId, ct);
        var r = ReconnaissanceMail.Reconnaitre(new EntreeReconnaissance(lu.Objet, lu.Texte, pieces, depot.TextePieces, lu.De?.Adresse ?? "",
            fil.Select(f => new ElementCible(f.MliTypeElement, f.MliIdElement)).ToList(), c.Candidats, c.ExpediteurTiers, c.Tiers, lu.Automatique),
            regles, await comptes.ParametreAsync("seuil_haut", 80, ct), await comptes.ParametreAsync("seuil_bas", 40, ct));
        m.MmeNature = r.Nature;
        db.Propositions.AddRange(r.Propositions.Select(p => new PropositionEntite
        {
            MprMmeId = m.MmeId, MprTypeElement = p.Type, MprIdElement = p.Id, MprScore = p.Score, MprIndices = p.Indices.ToList(),
        }));
        if (r.Decision == "PROPOSE") m.MmeEtat = "PROPOSE";
        await db.SaveChangesAsync(ct);
        if (r.Decision == "IGNORE")
        {
            m.MmeEtat = "IGNORE";
            m.MmeErreur = $"Ignoré par la règle {r.Regle}";
            await db.SaveChangesAsync(ct);
            if (m.MmeDgeId is long dge) await specialisation.PurgerAsync([dge], ct);
            return;
        }
        if (r.Decision != "RATTACHE") return;
        foreach (var p in r.Retenus)
        {
            if (await specialisation.DecrireElementAsync(p.Type, p.Id, ct) is not { } element) continue;
            var parFil = r.Propositions.First(x => x.Type == p.Type && x.Id == p.Id).Indices.Contains("FIL");
            await RattacherAsync(m, element, parFil ? "FIL" : "REGLE", p.Score, r.Regle, Fond, ct);
            if (!r.Alerte) continue;
            try
            {
                var pj = await db.Pieces.AsNoTracking().Where(x => x.MpiMmeId == m.MmeId).Select(x => x.MpiReference).ToListAsync(ct);
                await specialisation.AlerterAsync(new MessageRattache(m.MmeId, m.MmeMcoId, m.MmeDgeId, m.MmeObjet, m.MmeDe, m.MmeDate, m.MmeCorpsHtml ?? "", pj,
                    parFil ? "FIL" : "REGLE", Fond), element, r.Nature, r.Service, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning(e, "Mail : alerte du courriel {Id} non publiée", m.MmeId);
            }
        }
    }

    /// <summary>Règles actives du compte (et de tous les comptes).</summary>
    private async Task<List<RegleReconnaissance>> ReglesAsync(long compte, CancellationToken ct) =>
        (await db.Regles.AsNoTracking().Where(x => x.MrgActif && (x.MrgMcoId == null || x.MrgMcoId == compte)).ToListAsync(ct))
        .Select(x => new RegleReconnaissance(x.MrgCode, x.MrgNature, x.MrgMots, x.MrgDans, x.MrgExpediteur, x.MrgService, x.MrgAction, x.MrgOrdre)).ToList();

    /// <summary>Propositions de la reconnaissance d'un courriel (décrites par l'application).</summary>
    public async Task<List<PropositionDto>> PropositionsAsync(long id, CancellationToken ct)
    {
        var res = new List<PropositionDto>();
        foreach (var p in await db.Propositions.AsNoTracking().Where(x => x.MprMmeId == id).OrderByDescending(x => x.MprScore).ToListAsync(ct))
        {
            var e = await specialisation.DecrireElementAsync(p.MprTypeElement, p.MprIdElement, ct);
            res.Add(new PropositionDto(p.MprTypeElement, p.MprIdElement, e?.Libelle, e?.Url, p.MprScore, p.MprIndices));
        }
        return res;
    }

    // --- Règles (administrateur) ---

    public async Task<List<RegleDto>> ReglesListeAsync(CancellationToken ct) =>
        await db.Regles.AsNoTracking().OrderBy(x => x.MrgOrdre).ThenBy(x => x.MrgCode)
            .Select(x => new RegleDto(x.MrgId, x.MrgCode, x.MrgLibelle, x.MrgNature, x.MrgMots, x.MrgDans, x.MrgExpediteur, x.MrgService, x.MrgMcoId, x.MrgAction,
                x.MrgOrdre, x.MrgActif)).ToListAsync(ct);

    /// <summary>Règles réécrites en entier (codes uniques, nature, action et zones connues ; mots ou expéditeur obligatoires).</summary>
    public async Task<List<RegleDto>> EnregistrerReglesAsync(Utilisateur u, List<RegleDto> l, CancellationToken ct)
    {
        u.ExigerParametres();
        foreach (var x in l)
        {
            if (string.IsNullOrWhiteSpace(x.Code) || x.Code.Length > 30 || string.IsNullOrWhiteSpace(x.Libelle)) throw ExceptionMetier.Invalide("MAIL_REGLE", "Code et libellé obligatoires");
            if (!ReconnaissanceMail.Actions.Contains(x.Action)) throw ExceptionMetier.Invalide("MAIL_REGLE", $"{x.Code} : action inconnue");
            if (!ReconnaissanceMail.Natures.Contains(x.Nature)) throw ExceptionMetier.Invalide("MAIL_REGLE", $"{x.Code} : nature inconnue");
            if (x.Dans.Any(z => !ReconnaissanceMail.Zones.Contains(z))) throw ExceptionMetier.Invalide("MAIL_REGLE", $"{x.Code} : zone inconnue");
            if (x.Mots.All(string.IsNullOrWhiteSpace) && string.IsNullOrWhiteSpace(x.Expediteur)) throw ExceptionMetier.Invalide("MAIL_REGLE", $"{x.Code} : mots ou expéditeur obligatoires");
        }
        if (l.GroupBy(x => x.Code.Trim().ToUpperInvariant()).Any(g => g.Count() > 1)) throw ExceptionMetier.Invalide("MAIL_REGLE", "Codes en double");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Regles.ExecuteDeleteAsync(ct);
        db.Regles.AddRange(l.Select(x => new RegleEntite
        {
            MrgCode = x.Code.Trim().ToUpperInvariant(), MrgLibelle = x.Libelle.Trim(), MrgNature = x.Nature,
            MrgMots = x.Mots.Where(m => !string.IsNullOrWhiteSpace(m)).Select(m => m.Trim()).ToList(), MrgDans = x.Dans,
            MrgExpediteur = string.IsNullOrWhiteSpace(x.Expediteur) ? null : x.Expediteur.Trim(), MrgService = string.IsNullOrWhiteSpace(x.Service) ? null : x.Service.Trim(),
            MrgMcoId = x.Compte, MrgAction = x.Action, MrgOrdre = x.Ordre, MrgActif = x.Actif,
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await ReglesListeAsync(ct);
    }

    /// <summary>
    /// Avis de non-remise : envoi d'origine retrouvé par son Message-ID, destinataires marqués non remis, alerte à traiter
    /// pour l'auteur (envoi manuel) ou les administrateurs (envoi automatique), qui propose de signaler l'adresse dans
    /// l'annuaire ; l'avis est rattaché à l'élément de l'envoi.
    /// </summary>
    private async Task NonRemisAsync(MessageEntite avis, CourrielLu lu, CancellationToken ct)
    {
        var ids = new[] { lu.OriginalMessageId, lu.InReplyTo }.Concat(lu.References).Where(x => !string.IsNullOrEmpty(x)).Distinct().ToList();
        var origine = await db.Messages.Where(x => x.MmeSens == "E" && ids.Contains(x.MmeMessageId)).OrderByDescending(x => x.MmeId).FirstOrDefaultAsync(ct);
        var adresses = lu.NonRemises.Select(x => Adresses.Normaliser(x.Adresse)).ToList();
        if (origine is null)
        {
            await SignalerAsync(await specialisation.AdministrateursAsync(ct), new SignalMail("NON_REMIS", $"Courriel non remis : {string.Join(", ", adresses)}",
                "Avis de non-remise sans envoi d'origine retrouvé (envoyé hors de l'application ?).", NiveauNotification.Attention, $"/mail/message/{avis.MmeId}", $"mail:non-remis:{avis.MmeId}"), ct);
            return;
        }
        foreach (var d in await db.Destinataires.Where(x => x.MdeMmeId == origine.MmeId && adresses.Contains(x.MdeAdresse.ToLower())).ToListAsync(ct))
        {
            var n = lu.NonRemises.First(x => Adresses.Normaliser(x.Adresse) == Adresses.Normaliser(d.MdeAdresse));
            var motif = string.Join(" : ", new[] { n.Statut, n.Diagnostic }.Where(x => !string.IsNullOrEmpty(x)));
            d.MdeNonRemis = (motif.Length == 0 ? "non remis" : motif) is var t && t.Length > 500 ? t[..500] : t;
        }
        if (origine.MmeTypeElement is not null && origine.MmeIdElement is not null)
        {
            db.Liens.Add(new LienEntite { MliMmeId = avis.MmeId, MliTypeElement = origine.MmeTypeElement, MliIdElement = origine.MmeIdElement, MliOrigine = "FIL", MliPar = Fond, MliLe = Maintenant });
        }
        await db.SaveChangesAsync(ct);
        var destinataires = origine.MmeCreePar == Fond ? await specialisation.AdministrateursAsync(ct) : [origine.MmeCreePar];
        await SignalerAsync(destinataires, new SignalMail("NON_REMIS", $"Courriel non remis : {origine.MmeObjet}",
            $"Adresse(s) en échec : {string.Join(", ", lu.NonRemises.Select(x => $"{x.Adresse}{(x.Statut is null ? "" : $" ({x.Statut})")}"))}. "
            + "Corriger l'adresse et renvoyer ; l'adresse peut être signalée non remise dans l'annuaire depuis le courriel.",
            NiveauNotification.Attention, $"/mail/message/{origine.MmeId}", $"mail:non-remis:{origine.MmeId}:{string.Join(',', adresses)}", origine.MmeTypeElement, origine.MmeIdElement), ct);
    }

    // --- Consultation et rattachement ---

    /// <summary>Boîte visible : administrateur, ou membre d'un des services du compte.</summary>
    public async Task<bool> PeutVoirAsync(Utilisateur u, CompteEntite c, CancellationToken ct) =>
        u.EstAdmin || (c.McoServices.Count > 0 && (await specialisation.ServicesAsync(u.Code, ct)).Any(s => c.McoServices.Contains(s, StringComparer.OrdinalIgnoreCase)));

    private async Task<List<long>> ComptesVisiblesAsync(Utilisateur u, CancellationToken ct)
    {
        var res = new List<long>();
        foreach (var c in await db.Comptes.AsNoTracking().Where(c => c.McoReception).ToListAsync(ct))
        {
            if (await PeutVoirAsync(u, c, ct)) res.Add(c.McoId);
        }
        return res;
    }

    /// <summary>Courriels reçus des boîtes visibles : à rapprocher (avec les propositions), reçus (tous), ignorés.</summary>
    public async Task<List<MessageDto>> RecusAsync(Utilisateur u, string? vue, long? compte, int page, int taille, CancellationToken ct, long? seul = null)
    {
        var visibles = seul is null ? await ComptesVisiblesAsync(u, ct) : [];
        var q = db.Messages.AsNoTracking().Where(m => m.MmeSens == "R" && (seul == null ? visibles.Contains(m.MmeMcoId) : m.MmeId == seul));
        if (compte is not null) q = q.Where(m => m.MmeMcoId == compte);
        q = vue switch
        {
            "a-rapprocher" => q.Where(m => m.MmeEtat == "A_RAPPROCHER" || m.MmeEtat == "PROPOSE"),
            "ignores" => q.Where(m => m.MmeEtat == "IGNORE"),
            "rapproches" => q.Where(m => m.MmeEtat == "RAPPROCHE"),
            _ => q,
        };
        taille = Math.Clamp(taille, 1, 200);
        var l = await q.OrderByDescending(m => m.MmeDate).ThenByDescending(m => m.MmeId).Skip((Math.Max(page, 1) - 1) * taille).Take(taille).ToListAsync(ct);
        var ids = l.Select(m => m.MmeId).ToList();
        var pieces = (await db.Pieces.AsNoTracking().Where(p => ids.Contains(p.MpiMmeId)).Select(p => p.MpiMmeId).ToListAsync(ct)).ToLookup(x => x);
        return l.Select(m => new MessageDto(m.MmeId, "R", m.MmeEtat, m.MmePriorite, m.MmeDe, m.MmeObjet, m.MmeExpediteur is null ? [] : [m.MmeExpediteur], 1,
            pieces[m.MmeId].Count(), m.MmeTypeElement, m.MmeIdElement, null, m.MmeDate ?? m.MmeCreeLe, m.MmeCreePar, null, null, m.MmeAttente, m.MmeErreur, 0,
            m.MmeDgeId, m.MmeNature)).ToList();
    }

    /// <summary>Liens d'un courriel (actifs), décrits par l'application.</summary>
    public async Task<List<LienDto>> LiensAsync(long id, CancellationToken ct)
    {
        var res = new List<LienDto>();
        foreach (var l in await db.Liens.AsNoTracking().Where(l => l.MliMmeId == id && l.MliRetireLe == null).OrderBy(l => l.MliLe).ToListAsync(ct))
        {
            var e = await specialisation.DecrireElementAsync(l.MliTypeElement, l.MliIdElement, ct);
            res.Add(new LienDto(l.MliTypeElement, l.MliIdElement, e?.Libelle, e?.Url, l.MliOrigine, l.MliScore, l.MliPar, l.MliLe));
        }
        return res;
    }

    private async Task<MessageEntite> RecuVisibleAsync(Utilisateur u, long id, CancellationToken ct)
    {
        var m = await db.Messages.FirstOrDefaultAsync(x => x.MmeId == id && x.MmeSens == "R", ct) ?? throw ExceptionMetier.Introuvable("Courriel reçu");
        if (!await PeutVoirAsync(u, await comptes.Compte(m.MmeMcoId, ct), ct)) throw ExceptionMetier.AccesRefuse("LIRE");
        return m;
    }

    public IReadOnlyList<TypeRattachement> TypesRattachement => specialisation.TypesRattachement;

    /// <summary>
    /// Rattachement manuel à un élément (désigné par son identifiant ou par un code saisi) : lien MANUEL, courriel rangé
    /// avec l'élément et suivi par l'application, état RAPPROCHE ; action sur le serveur selon l'option du compte.
    /// </summary>
    public async Task<List<LienDto>> RattacherAsync(Utilisateur u, long id, DemandeRattachement d, CancellationToken ct)
    {
        var m = await RecuVisibleAsync(u, id, ct);
        var element = !string.IsNullOrWhiteSpace(d.Id) ? await specialisation.DecrireElementAsync(d.Type, d.Id, ct)
            : !string.IsNullOrWhiteSpace(d.Code) ? await specialisation.ResoudreElementAsync(d.Type, d.Code.Trim(), u, ct) : null;
        if (element is null) throw ExceptionMetier.Invalide("MAIL_ELEMENT", "Élément introuvable");
        await RattacherAsync(m, element, "MANUEL", null, null, u.Code, ct);
        return await LiensAsync(id, ct);
    }

    /// <summary>Rattachement (manuel ou automatique) : lien, courriel rangé et suivi par l'application, action IMAP de l'option du compte.</summary>
    public async Task RattacherAsync(MessageEntite m, ElementTrouve element, string origine, int? score, string? regle, string par, CancellationToken ct)
    {
        var lien = await db.Liens.FirstOrDefaultAsync(l => l.MliMmeId == m.MmeId && l.MliTypeElement == element.Type && l.MliIdElement == element.Id, ct);
        if (lien is { MliRetireLe: null }) return;
        if (lien is null) db.Liens.Add(lien = new LienEntite { MliMmeId = m.MmeId, MliTypeElement = element.Type, MliIdElement = element.Id });
        (lien.MliOrigine, lien.MliScore, lien.MliRegle, lien.MliPar, lien.MliLe, lien.MliRetireLe, lien.MliRetirePar) = (origine, score, regle, par, Maintenant, null, null);
        m.MmeEtat = "RAPPROCHE";
        m.MmeTypeElement ??= element.Type;
        m.MmeIdElement ??= element.Id;
        await db.SaveChangesAsync(ct);
        var pieces = await db.Pieces.AsNoTracking().Where(p => p.MpiMmeId == m.MmeId).Select(p => p.MpiReference).ToListAsync(ct);
        try
        {
            await specialisation.RattacherAsync(new MessageRattache(m.MmeId, m.MmeMcoId, m.MmeDgeId, m.MmeObjet, m.MmeDe, m.MmeDate, m.MmeCorpsHtml ?? "", pieces, origine, par), element, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning(e, "Mail : suites du rattachement du courriel {Id} incomplètes", m.MmeId);
        }
        await ActionServeurAsync(m, ct);
    }

    /// <summary>Action sur le serveur après un rattachement (option du compte) ; une erreur est journalisée.</summary>
    private async Task ActionServeurAsync(MessageEntite m, CancellationToken ct)
    {
        var c = await comptes.Compte(m.MmeMcoId, ct);
        var o = ServiceComptesMail.OptionsDe(c);
        if (o.ApresRattachement == "RIEN" || m.MmeUid is not long uid || m.MmeDossier is null || comptes.Connexion(c).Imap is not { } imap) return;
        try
        {
            await transport.ApresRattachementAsync(imap, await comptes.AuthAsync(c, imap, ct), m.MmeDossier, (uint)uid, o.ApresRattachement, o.DossierTraites, ct);
        }
        catch (Exception e) when (e is ErreurEnvoi or ExceptionMetier)
        {
            journal.LogWarning("Mail : action {Action} sur le serveur impossible pour le courriel {Id} : {Erreur}", o.ApresRattachement, m.MmeId, e.Message);
        }
    }

    /// <summary>Lien retiré (tracé) ; plus aucun lien : de nouveau à rapprocher.</summary>
    public async Task<List<LienDto>> DetacherAsync(Utilisateur u, long id, string type, string idElement, CancellationToken ct)
    {
        var m = await RecuVisibleAsync(u, id, ct);
        var lien = await db.Liens.FirstOrDefaultAsync(l => l.MliMmeId == id && l.MliTypeElement == type && l.MliIdElement == idElement && l.MliRetireLe == null, ct)
            ?? throw ExceptionMetier.Introuvable("Lien");
        (lien.MliRetireLe, lien.MliRetirePar) = (Maintenant, u.Code);
        await db.SaveChangesAsync(ct);
        if (!await db.Liens.AnyAsync(l => l.MliMmeId == id && l.MliRetireLe == null, ct))
        {
            m.MmeEtat = "A_RAPPROCHER";
            (m.MmeTypeElement, m.MmeIdElement) = (null, null);
            await db.SaveChangesAsync(ct);
        }
        return await LiensAsync(id, ct);
    }

    /// <summary>Courriel ignoré (motif) : retiré de la liste ; son document de la GED est retiré (courriel privé, publicité…).</summary>
    public async Task IgnorerAsync(Utilisateur u, long id, string? motif, CancellationToken ct)
    {
        var m = await RecuVisibleAsync(u, id, ct);
        m.MmeEtat = "IGNORE";
        m.MmeErreur = string.IsNullOrWhiteSpace(motif) ? $"Ignoré par {u.Code}" : $"Ignoré par {u.Code} : {(motif.Length > 400 ? motif[..400] : motif)}";
        await db.SaveChangesAsync(ct);
        if (m.MmeDgeId is long dge) await specialisation.PurgerAsync([dge], ct);
    }

    /// <summary>Adresse en échec d'un envoi signalée dans l'annuaire (auteur ou administrateur).</summary>
    public async Task<int> MarquerAdresseAsync(Utilisateur u, long id, string adresse, CancellationToken ct)
    {
        var m = await db.Messages.FirstOrDefaultAsync(x => x.MmeId == id && x.MmeSens == "E", ct) ?? throw ExceptionMetier.Introuvable("Courriel");
        if (!u.EstAdmin && m.MmeCreePar != u.Code) throw ExceptionMetier.AccesRefuse(ActionsDroits.Modifier);
        var d = await db.Destinataires.AsNoTracking().FirstOrDefaultAsync(x => x.MdeMmeId == id && x.MdeAdresse.ToLower() == adresse.ToLower() && x.MdeNonRemis != null, ct)
            ?? throw ExceptionMetier.Invalide("MAIL_ADRESSE", "Cette adresse n'est pas signalée non remise pour ce courriel");
        return await specialisation.MarquerAdresseAsync(d.MdeAdresse, d.MdeNonRemis!, u, ct);
    }

    /// <summary>Purge : courriels reçus non rapprochés ou ignorés plus anciens que la durée de conservation.</summary>
    public async Task<int> PurgerAsync(CancellationToken ct)
    {
        var limite = Maintenant.AddDays(-await comptes.ParametreAsync("conservation_non_rapproches_jours", 90, ct));
        var anciens = await db.Messages.Where(m => m.MmeSens == "R" && (m.MmeEtat == "A_RAPPROCHER" || m.MmeEtat == "PROPOSE" || m.MmeEtat == "IGNORE")
            && m.MmeCreeLe < limite).ToListAsync(ct);
        if (anciens.Count == 0) return 0;
        await specialisation.PurgerAsync(anciens.Where(m => m.MmeDgeId is not null).Select(m => m.MmeDgeId!.Value).ToList(), ct);
        db.Messages.RemoveRange(anciens);
        await db.SaveChangesAsync(ct);
        return anciens.Count;
    }

    // --- Outils ---

    private async Task SignalerAsync(IReadOnlyList<string> destinataires, SignalMail s, CancellationToken ct)
    {
        try
        {
            await specialisation.SignalerAsync(s, destinataires, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning(e, "Mail : signal {Cle} non publié", s.Cle);
        }
    }

    private static DestinataireEntite Dest(MessageEntite m, string role, AdresseLue a) =>
        new() { MdeMmeId = m.MmeId, MdeRole = role, MdeAdresse = a.Adresse.Length > 300 ? a.Adresse[..300] : a.Adresse, MdeNom = a.Nom is { Length: > 200 } n ? n[..200] : a.Nom };

    private static string Formater(AdresseLue a) => (a.Nom is null ? a.Adresse : $"{a.Nom} <{a.Adresse}>") is var t && t.Length > 300 ? t[..300] : t;

    private static string? Extrait(string texte)
    {
        var t = texte.ReplaceLineEndings(" ");
        return t.Length > 300 ? t[..300] : t;
    }
}
