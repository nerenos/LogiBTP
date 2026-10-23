using System.Diagnostics;
using System.Security.Cryptography;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LogiBTP.Mail.Web;

/// <summary>
/// Envoi des courriels : rédaction proposée depuis un élément, estimation, mise en file (tout envoi passe par la file,
/// soumise aux limitations du compte), traitement de la file en tâche de fond (créneau, transport, journal, reprises,
/// classement des erreurs, suspension d'un compte bloqué, signaux), consultation des messages, du journal et des compteurs.
/// </summary>
public sealed class ServiceEnvoiMail(MailDbContext db, ServiceComptesMail comptes, ITransportMail transport, SpecialisationMail specialisation,
    NettoyageHtmlMail nettoyage, ILogger<ServiceEnvoiMail> journal, TimeProvider horloge)
{
    private static readonly string[] Priorites = [ReglesEnvoi.Haute, ReglesEnvoi.Normale, ReglesEnvoi.Basse];
    private static readonly string[] EtatsAttente = ["A_ENVOYER", "EN_COURS", "SUSPENDU"];

    private DateTimeOffset Maintenant => horloge.GetUtcNow();

    // --- Rédaction ---

    /// <summary>Courriel proposé depuis un élément (ou vierge) ; aucun compte d'envoi : 409 MAIL_NON_CONFIGURE.</summary>
    public async Task<Brouillon> PreparerAsync(Utilisateur u, string? type, string? id, string? usage, CancellationToken ct)
    {
        var expediteurs = (await comptes.AliasAsync(ct)).Where(a => a.Actif && a.Envoi && a.CompteActif).ToList();
        if (expediteurs.Count == 0) throw NonConfigure();
        var element = !string.IsNullOrEmpty(type) && !string.IsNullOrEmpty(id) ? await specialisation.DecrireAsync(type, id, u, ct) : null;
        var usageEffectif = usage ?? element?.Usage ?? "GENERAL";
        var alias = await AliasDeUsageAsync(usageEffectif, element?.TypeModele, ct) ?? expediteurs.FirstOrDefault(a => a.Principal)?.Id ?? expediteurs[0].Id;
        var variables = new Dictionary<string, string?>(element?.Variables ?? [], StringComparer.OrdinalIgnoreCase) { ["utilisateur"] = u.Code };
        var typeModele = element?.TypeModele ?? "";
        var modele = await db.Modeles.AsNoTracking().Where(m => m.MmoActif && m.MmoUsage == usageEffectif && (m.MmoType == "" || m.MmoType == typeModele))
            .OrderByDescending(m => m.MmoType != "").ThenByDescending(m => m.MmoDefaut).FirstOrDefaultAsync(ct);
        var objet = modele is null ? element?.Libelle ?? "" : Adresses.Remplir(modele.MmoObjet, variables, false);
        var corps = modele is null ? "" : Adresses.Remplir(modele.MmoCorpsHtml, variables, true);
        return new Brouillon(expediteurs, expediteurs.Any(e => e.Id == alias) ? alias : expediteurs[0].Id, element, element?.Destinataires ?? [], objet, corps,
            element?.Pieces ?? [], await comptes.ParametreAsync("taille_max_mo", 20, ct) * 1024L * 1024, await comptes.ParametreAsync("seuil_envoi_groupe", 50, ct));
    }

    /// <summary>Alias d'un usage : portée du type d'élément, sinon défaut de l'usage, sinon défaut de GENERAL.</summary>
    public async Task<long?> AliasDeUsageAsync(string usage, string? typeElement, CancellationToken ct)
    {
        var portees = new[] { $"type:{typeElement}", "" };
        var l = await db.Usages.AsNoTracking().Where(x => (x.MusUsage == usage || x.MusUsage == "GENERAL") && portees.Contains(x.MusPortee)).ToListAsync(ct);
        return l.OrderByDescending(x => x.MusUsage == usage).ThenByDescending(x => x.MusPortee != "").FirstOrDefault()?.MusMalId;
    }

    // --- Estimation et mise en file ---

    public async Task<EstimationDto> EstimerAsync(Utilisateur u, DemandeEstimation d, CancellationToken ct)
    {
        var (_, c) = await AliasCompteAsync(d.AliasId, ct);
        var nouveaux = Enumerable.Range(0, Math.Max(1, d.Messages)).Select(_ => new MessageAEnvoyer(Math.Max(1, d.DestinatairesParMessage), 0, [], d.Priorite)).ToList();
        return await EstimerAsync(c, nouveaux, ct);
    }

    private async Task<EstimationDto> EstimerAsync(CompteEntite c, List<MessageAEnvoyer> nouveaux, CancellationToken ct)
    {
        var limites = Limites.Completer(c.McoHebergeur, ServiceComptesMail.LimitesSaisies(c));
        var reserve = await comptes.ParametreAsync("reserve_prioritaire_pct", 20, ct);
        var passes = await PassesAsync(c.McoId, ct);
        var file = await FileAsync(c.McoId, ct);
        var simule = ReglesEnvoi.Simuler(limites, passes, [.. file, .. nouveaux], Maintenant, reserve);
        var siens = simule.Skip(file.Count).ToList();
        var total = nouveaux.Sum(m => m.Destinataires);
        var seuil = await comptes.ParametreAsync("seuil_envoi_groupe", 50, ct);
        var tauxApres = limites.DestinatairesParJour <= 0 ? 0
            : (int)((passes.Where(p => p.Le > Maintenant.AddDays(-1)).Sum(p => p.Destinataires) + total) * 100L / limites.DestinatairesParJour);
        var depart = siens[0].Quand;
        var fin = siens[^1].Quand;
        string? avertissement = null;
        if (total > seuil || tauxApres >= await comptes.ParametreAsync("seuil_quota_pct", 80, ct))
        {
            avertissement = $"Envoi de {nouveaux.Count} courriel(s) à {total} destinataire(s) : départ {Heure(depart)}, fin estimée {Heure(fin)}"
                + $" ({Duree(fin - depart)}) ; quota journalier du compte utilisé à {Math.Min(tauxApres, 999)} % après cet envoi.";
        }
        return new EstimationDto(depart <= Maintenant, depart, fin, siens.FirstOrDefault(x => x.Cause is not null)?.Cause, file.Count,
            ReglesEnvoi.TauxQuotaJour(limites, passes, Maintenant), total > seuil, avertissement);
    }

    /// <summary>
    /// Met un courriel en file : contrôles (expéditeur, adresses, objet, pièces, taille), découpage au-delà du nombre de
    /// destinataires par message du compte (A et CC sur le premier, CCI répartis), confirmation exigée au-delà du seuil
    /// d'envoi groupé (409 MAIL_CONFIRMATION avec l'estimation), créneau de chaque message, lien à l'élément.
    /// </summary>
    public async Task<ResultatEnvoi> EnvoyerAsync(Utilisateur u, DemandeEnvoi d, CancellationToken ct)
    {
        var (alias, c) = await AliasCompteAsync(d.AliasId, ct);
        var a = Nettoyer(d.A);
        var cc = Nettoyer(d.Cc);
        var cci = Nettoyer(d.Cci);
        var refusees = a.Concat(cc).Concat(cci).Where(x => !Adresses.Valide(x.Adresse)).Select(x => x.Adresse).ToList();
        if (refusees.Count > 0) throw ExceptionMetier.Invalide("MAIL_ADRESSE", $"Adresse(s) invalide(s) : {string.Join(", ", refusees)}", refusees);
        if (a.Count + cc.Count + cci.Count == 0) throw ExceptionMetier.Invalide("MAIL_DESTINATAIRE", "Au moins un destinataire");
        if (string.IsNullOrWhiteSpace(d.Objet)) throw ExceptionMetier.Invalide("MAIL_OBJET", "Objet obligatoire");
        if (!Priorites.Contains(d.Priorite)) throw ExceptionMetier.Invalide("MAIL_PRIORITE", "Priorité inconnue");
        var refs = (d.Pieces ?? []).Distinct().ToList();
        var pieces = refs.Count == 0 ? [] : await specialisation.PiecesAsync(refs, u, ct);
        if (pieces.Count != refs.Count) throw ExceptionMetier.Invalide("MAIL_PIECE", "Pièce jointe introuvable ou non lisible");
        var max = await comptes.ParametreAsync("taille_max_mo", 20, ct) * 1024L * 1024;
        if (pieces.Sum(p => p.Taille) * 4 / 3 > max) throw ExceptionMetier.Invalide("MAIL_TAILLE", $"Pièces jointes trop lourdes : {max / 1024 / 1024} Mo au plus par courriel");
        if (d.CopieMoi && await specialisation.CourrielUtilisateurAsync(u.Code, ct) is { } moi && Adresses.Valide(moi)
            && a.Concat(cc).Concat(cci).All(x => Adresses.Normaliser(x.Adresse) != Adresses.Normaliser(moi)))
        {
            cci.Add(new DestinataireSaisi(moi));
        }
        var corpsHtml = nettoyage.Nettoyer(d.CorpsHtml);
        var limites = Limites.Completer(c.McoHebergeur, ServiceComptesMail.LimitesSaisies(c));
        var envois = Decouper(a, cc, cci, limites.DestinatairesParMessage);
        var connus = await ConnusAsync(c.McoId, ct);
        var priorite = envois.Count > 1 ? ReglesEnvoi.Basse : d.Priorite;
        var aEnvoyer = envois.Select(e => Message(e.A.Concat(e.Cc).Concat(e.Cci).ToList(), connus, priorite)).ToList();
        var total = aEnvoyer.Sum(m => m.Destinataires);
        var estimation = await EstimerAsync(c, aEnvoyer, ct);
        if (estimation.ConfirmationRequise && !d.ConfirmationMassive)
        {
            throw ExceptionMetier.Conflit("MAIL_CONFIRMATION", estimation.Avertissement ?? $"Envoi à {total} destinataires : confirmer", estimation);
        }
        var identite = comptes.Identite(c);
        LotEntite? lot = null;
        if (envois.Count > 1 || estimation.ConfirmationRequise)
        {
            lot = new LotEntite
            {
                MloOrigine = d.Usage ?? "MANUEL", MloLibelle = d.Objet.Trim(), MloAuteur = u.Code, MloMessages = envois.Count, MloDestinataires = total,
                MloFinEstimee = estimation.Fin, MloAvertissement = estimation.ConfirmationRequise ? estimation.Avertissement : null,
                MloAcceptePar = estimation.ConfirmationRequise ? u.Code : null, MloAccepteLe = estimation.ConfirmationRequise ? Maintenant : null, MloCreeLe = Maintenant,
            };
            db.Lots.Add(lot);
            await db.SaveChangesAsync(ct);
        }
        var creneaux = ReglesEnvoi.Simuler(limites, await PassesAsync(c.McoId, ct), [.. await FileAsync(c.McoId, ct), .. aEnvoyer], Maintenant,
            await comptes.ParametreAsync("reserve_prioritaire_pct", 20, ct)).TakeLast(aEnvoyer.Count).ToList();
        var ids = new List<long>();
        for (var i = 0; i < envois.Count; i++)
        {
            var m = new MessageEntite
            {
                MmeMcoId = c.McoId, MmeMalId = alias.MalId, MmeExpediteur = alias.MalNom, MmeSens = "E", MmeEtat = "A_ENVOYER", MmePriorite = priorite,
                MmeMloId = lot?.MloId, MmeUsage = d.Usage, MmeTypeElement = Vide(d.TypeElement), MmeIdElement = Vide(d.IdElement),
                MmeMessageId = ConstructionMail.NouveauMessageId(identite.Adresse), MmeInReplyTo = Vide(d.InReplyTo), MmeObjet = d.Objet.Trim(),
                MmeCorpsHtml = corpsHtml, MmeExtrait = Extrait(corpsHtml), MmeProchainEssai = creneaux[i].Quand,
                MmeAttente = creneaux[i].Quand > Maintenant ? creneaux[i].Cause ?? "file d'attente" : null, MmeCopieMoi = d.CopieMoi, MmeCreePar = u.Code,
                MmeCreeLe = Maintenant,
            };
            db.Messages.Add(m);
            await db.SaveChangesAsync(ct);
            ids.Add(m.MmeId);
            db.Destinataires.AddRange(envois[i].A.Select(x => Destinataire(m, "A", x)).Concat(envois[i].Cc.Select(x => Destinataire(m, "CC", x)))
                .Concat(envois[i].Cci.Select(x => Destinataire(m, "CCI", x))));
            db.Pieces.AddRange(pieces.Select(p => new PieceEntite { MpiMmeId = m.MmeId, MpiReference = p.Reference, MpiNom = p.Nom, MpiType = p.Type, MpiTaille = p.Taille }));
            if (m.MmeTypeElement is not null && m.MmeIdElement is not null)
            {
                db.Liens.Add(new LienEntite { MliMmeId = m.MmeId, MliTypeElement = m.MmeTypeElement, MliIdElement = m.MmeIdElement, MliOrigine = "ENVOI", MliPar = u.Code, MliLe = Maintenant });
            }
        }
        await db.SaveChangesAsync(ct);
        await VolumeUtilisateurAsync(u, ct);
        var depart = creneaux[0].Quand;
        return new ResultatEnvoi(ids, "A_ENVOYER", estimation.Position, depart, creneaux[^1].Quand, creneaux.FirstOrDefault(x => x.Cause is not null)?.Cause,
            depart > Maintenant.AddSeconds(30), lot?.MloId);
    }

    private static List<DestinataireSaisi> Nettoyer(List<DestinataireSaisi>? l) =>
        (l ?? []).Where(x => !string.IsNullOrWhiteSpace(x.Adresse)).Select(x => x with { Adresse = x.Adresse.Trim(), Nom = Vide(x.Nom) })
            .DistinctBy(x => Adresses.Normaliser(x.Adresse)).ToList();

    /// <summary>Découpage au-delà du nombre de destinataires par message : A et CC sur le premier courriel, CCI répartis.</summary>
    public static List<(List<DestinataireSaisi> A, List<DestinataireSaisi> Cc, List<DestinataireSaisi> Cci)> Decouper(
        List<DestinataireSaisi> a, List<DestinataireSaisi> cc, List<DestinataireSaisi> cci, int max)
    {
        if (a.Count + cc.Count + cci.Count <= max) return [(a, cc, cci)];
        if (a.Count + cc.Count > max) throw ExceptionMetier.Invalide("MAIL_TROP_DESTINATAIRES", $"{max} destinataires au plus en A et CC : mettre les autres en CCI");
        var premier = cci.Take(max - a.Count - cc.Count).ToList();
        var res = new List<(List<DestinataireSaisi>, List<DestinataireSaisi>, List<DestinataireSaisi>)> { (a, cc, premier) };
        res.AddRange(ReglesEnvoi.Decouper(cci.Skip(premier.Count).ToList(), max).Select(p => (new List<DestinataireSaisi>(), new List<DestinataireSaisi>(), p)));
        return res;
    }

    private static MessageAEnvoyer Message(List<DestinataireSaisi> d, HashSet<string> connus, string priorite) =>
        new(d.Count, d.Count(x => !connus.Contains(Adresses.Normaliser(x.Adresse))), d.Select(x => Adresses.Domaine(x.Adresse)).Distinct().ToList(), priorite);

    private static DestinataireEntite Destinataire(MessageEntite m, string role, DestinataireSaisi x) =>
        new() { MdeMmeId = m.MmeId, MdeRole = role, MdeAdresse = x.Adresse, MdeNom = x.Nom, MdePerId = x.PerId, MdeIndId = x.IndId };

    /// <summary>Volume inhabituel d'un utilisateur (courriels créés dans l'heure au-delà du seuil) : signal aux administrateurs.</summary>
    private async Task VolumeUtilisateurAsync(Utilisateur u, CancellationToken ct)
    {
        var seuil = await comptes.ParametreAsync("seuil_utilisateur_heure", 100, ct);
        var heure = Maintenant.AddHours(-1);
        var n = await db.Messages.CountAsync(m => m.MmeCreePar == u.Code && m.MmeSens == "E" && m.MmeCreeLe > heure, ct);
        if (seuil <= 0 || n <= seuil) return;
        await SignalerAdministrateursAsync(new SignalMail("VOLUME", $"Envois inhabituels : {n} courriels en une heure par {u.Code}",
            "Vérifier qu'il s'agit d'un usage normal de la messagerie de l'application.", "ATTENTION", "/mail?vue=envois", $"mail:volume:{u.Code}:{Maintenant:yyyyMMddHH}"), ct);
    }

    // --- Traitement de la file (tâche de fond) ---

    /// <summary>
    /// Un passage sur la base courante : pour chaque compte ayant des messages dus, au plus <paramref name="parCompte"/>
    /// messages par priorité puis ancienneté ; un message hors des limitations reçoit son créneau et attend.
    /// </summary>
    public async Task<int> TraiterFileAsync(int parCompte, CancellationToken ct)
    {
        var maintenant = Maintenant;
        var ids = await db.Messages.AsNoTracking().Where(m => m.MmeEtat == "A_ENVOYER" && (m.MmeProchainEssai == null || m.MmeProchainEssai <= maintenant))
            .Select(m => m.MmeMcoId).Distinct().ToListAsync(ct);
        var envoyes = 0;
        foreach (var compteId in ids)
        {
            var c = await db.Comptes.FirstAsync(x => x.McoId == compteId, ct);
            if (!c.McoActif || !c.McoEnvoi) continue;
            var limites = Limites.Completer(c.McoHebergeur, ServiceComptesMail.LimitesSaisies(c));
            var reserve = await comptes.ParametreAsync("reserve_prioritaire_pct", 20, ct);
            var passes = await PassesAsync(c.McoId, ct);
            var connus = await ConnusAsync(c.McoId, ct);
            var file = await db.Messages.Where(m => m.MmeMcoId == compteId && m.MmeEtat == "A_ENVOYER" && (m.MmeProchainEssai == null || m.MmeProchainEssai <= maintenant))
                .OrderBy(m => m.MmePriorite == ReglesEnvoi.Haute ? 0 : m.MmePriorite == ReglesEnvoi.Normale ? 1 : 2).ThenBy(m => m.MmeCreeLe).Take(parCompte).ToListAsync(ct);
            foreach (var m in file)
            {
                if (c.McoEtat == "SUSPENDU" && (m.MmePriorite == ReglesEnvoi.Basse || m.MmeMloId is not null))
                {
                    m.MmeEtat = "SUSPENDU";
                    m.MmeAttente = "envois groupés du compte suspendus";
                    await db.SaveChangesAsync(ct);
                    continue;
                }
                var dest = await db.Destinataires.AsNoTracking().Where(x => x.MdeMmeId == m.MmeId && x.MdeRole != "DE").ToListAsync(ct);
                var amv = Message(dest.Select(x => new DestinataireSaisi(x.MdeAdresse)).ToList(), connus, m.MmePriorite);
                var creneau = ReglesEnvoi.Calculer(limites, passes, amv, Maintenant, reserve);
                if (!creneau.Immediat(Maintenant))
                {
                    m.MmeProchainEssai = creneau.Quand;
                    m.MmeAttente = creneau.Cause;
                    await db.SaveChangesAsync(ct);
                    continue;
                }
                if (await EnvoyerUnAsync(c, m, dest, amv, limites, passes, ct))
                {
                    envoyes++;
                    passes.Add(new EnvoiPasse(Maintenant, amv.Destinataires, amv.Nouveaux, amv.Domaines));
                    foreach (var x in dest) connus.Add(Adresses.Normaliser(x.MdeAdresse));
                }
                if (c.McoEtat is "ERREUR" && m.MmeEtat == "A_ENVOYER") break;
            }
        }
        return envoyes;
    }

    /// <summary>Envoi d'un message ; renvoie vrai s'il est parti. Les erreurs sont classées (<see cref="ReglesEnvoi.Classer"/>).</summary>
    private async Task<bool> EnvoyerUnAsync(CompteEntite c, MessageEntite m, List<DestinataireEntite> dest, MessageAEnvoyer amv, Limites limites,
        List<EnvoiPasse> passes, CancellationToken ct)
    {
        var attendait = m.MmeAttente is not null;
        m.MmeEtat = "EN_COURS";
        await db.SaveChangesAsync(ct);
        var chrono = Stopwatch.StartNew();
        var adresses = dest.Select(x => Adresses.Normaliser(x.MdeAdresse)).Distinct().ToList();
        try
        {
            var identite = comptes.Identite(c);
            var repondreA = c.McoRepondreAMcoId is long r && await db.Comptes.AsNoTracking().FirstOrDefaultAsync(x => x.McoId == r, ct) is { } cr ? comptes.Identite(cr) : null;
            var pieces = new List<PieceContenu>();
            foreach (var p in await db.Pieces.AsNoTracking().Where(x => x.MpiMmeId == m.MmeId).ToListAsync(ct))
            {
                pieces.Add(await specialisation.LirePieceAsync(p.MpiReference, ct) ?? throw new ErreurEnvoi(550, $"Pièce jointe introuvable : {p.MpiNom}"));
            }
            var corps = (m.MmeCorpsHtml ?? "") + (string.IsNullOrWhiteSpace(c.McoSignatureHtml) ? "" : $"<div class=\"signature\">{c.McoSignatureHtml}</div>");
            var mime = ConstructionMail.Construire(new CourrielAConstruire(identite, repondreA,
                dest.Where(x => x.MdeRole == "A").Select(x => new DestinataireSaisi(x.MdeAdresse, x.MdeNom)).ToList(),
                dest.Where(x => x.MdeRole == "CC").Select(x => new DestinataireSaisi(x.MdeAdresse, x.MdeNom)).ToList(),
                dest.Where(x => x.MdeRole == "CCI").Select(x => new DestinataireSaisi(x.MdeAdresse, x.MdeNom)).ToList(),
                m.MmeObjet, corps, pieces, m.MmeMessageId!, m.MmeInReplyTo, m.MmeReferences, Maintenant));
            var cfg = comptes.Connexion(c);
            var smtp = cfg.Smtp ?? throw new ErreurEnvoi(null, "Serveur d'envoi non configuré");
            await transport.EnvoyerAsync(smtp, await comptes.AuthAsync(c, smtp, ct), mime, ct);
            var eml = ConstructionMail.Octets(mime);
            m.MmeEtat = "ENVOYE";
            m.MmeEnvoyeLe = Maintenant;
            m.MmeDate = Maintenant;
            m.MmeAttente = null;
            m.MmeErreur = null;
            m.MmeEmpreinte = Convert.ToHexStringLower(SHA256.HashData(eml));
            if (c.McoEtat is "A_VERIFIER" or "ERREUR") (c.McoEtat, c.McoDerniereErreur) = ("OK", null);
            Journaliser(c, m, amv, adresses, "OK", null, null, eml.Length, chrono);
            await CompterLotAsync(m, true, ct);
            await db.SaveChangesAsync(ct);
            if (c.McoCopieEnvoyes && cfg.Imap is { } imap)
            {
                try
                {
                    await transport.CopierEnvoyesAsync(imap, await comptes.AuthAsync(c, imap, ct), mime, ct);
                }
                catch (Exception e) when (e is ErreurEnvoi or ExceptionMetier)
                {
                    journal.LogWarning(e, "Mail : copie dans « Envoyés » impossible pour le message {Id}", m.MmeId);
                }
            }
            await ApresEnvoiAsync(m, dest, eml, ct);
            if (attendait)
            {
                await SignalerAsync(m.MmeCreePar, new SignalMail("PARTI", $"Courriel parti : {m.MmeObjet}", "Le courriel qui attendait dans la file est envoyé.", "INFO",
                    $"/mail/message/{m.MmeId}", $"mail:parti:{m.MmeId}", m.MmeTypeElement, m.MmeIdElement), ct);
            }
            await QuotaAsync(c, limites, passes, amv.Destinataires, ct);
            return true;
        }
        catch (ExceptionMetier e) when (e.Code == IFournisseurJeton.AReconnecter)
        {
            Reporter(m, Maintenant.AddMinutes(15), "connexion OAuth 2.0 à reconnecter");
            (c.McoEtat, c.McoDerniereErreur) = ("ERREUR", e.Message);
            Journaliser(c, m, amv, adresses, "REPORT", null, e.Message, 0, chrono);
            await db.SaveChangesAsync(ct);
            return false;
        }
        catch (ErreurEnvoi e)
        {
            await EchecAsync(c, m, amv, adresses, e, chrono, ct);
            return false;
        }
    }

    private async Task EchecAsync(CompteEntite c, MessageEntite m, MessageAEnvoyer amv, List<string> adresses, ErreurEnvoi e, Stopwatch chrono, CancellationToken ct)
    {
        var genre = ReglesEnvoi.Classer(e.Code, e.Message);
        var texte = e.Message.Length > 1000 ? e.Message[..1000] : e.Message;
        switch (genre)
        {
            case GenreErreur.Temporaire:
                m.MmeTentatives++;
                if (ReglesEnvoi.ProchainEssai(m.MmeTentatives, Maintenant) is { } prochain)
                {
                    Reporter(m, prochain, $"nouvel essai après une erreur du serveur ({m.MmeTentatives}/{ReglesEnvoi.Reprises.Length})");
                    m.MmeErreur = texte;
                    Journaliser(c, m, amv, adresses, "REPORT", e.Code, texte, 0, chrono);
                    break;
                }
                await DefinitiveAsync(m, texte, ct);
                Journaliser(c, m, amv, adresses, "ECHEC", e.Code, texte, 0, chrono);
                break;
            case GenreErreur.Authentification:
                Reporter(m, Maintenant.AddMinutes(15), "authentification refusée par le serveur");
                (c.McoEtat, c.McoDerniereErreur) = ("ERREUR", texte.Length > 500 ? texte[..500] : texte);
                Journaliser(c, m, amv, adresses, "ECHEC", e.Code, texte, 0, chrono);
                await SignalerAdministrateursAsync(new SignalMail("COMPTE", "Messagerie : authentification refusée",
                    $"Le serveur refuse l'identifiant du compte {c.McoCode} : vérifier le mot de passe ou reconnecter la connexion OAuth. Les courriels attendent.",
                    "URGENT", "/parametres/mail", $"mail:auth:{c.McoId}:{Maintenant:yyyyMMdd}"), ct);
                break;
            case GenreErreur.Blocage:
                Reporter(m, Maintenant.AddHours(1), "hébergeur : limite ou blocage, envois groupés suspendus");
                (c.McoEtat, c.McoSuspenduLe, c.McoDerniereErreur) = ("SUSPENDU", Maintenant, texte.Length > 500 ? texte[..500] : texte);
                Journaliser(c, m, amv, adresses, "ECHEC", e.Code, texte, 0, chrono);
                await SignalerAdministrateursAsync(new SignalMail("BLOCAGE", "Messagerie : envois groupés suspendus",
                    $"L'hébergeur du compte {c.McoCode} refuse les envois (limite ou suspicion de spam) : {texte}. Examiner puis « Reprendre » dans le suivi des envois.",
                    "URGENT", "/mail?vue=envois", $"mail:blocage:{c.McoId}:{Maintenant:yyyyMMddHH}"), ct);
                break;
            default:
                await DefinitiveAsync(m, texte, ct);
                Journaliser(c, m, amv, adresses, "ECHEC", e.Code, texte, 0, chrono);
                break;
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task DefinitiveAsync(MessageEntite m, string texte, CancellationToken ct)
    {
        m.MmeEtat = "ERREUR";
        m.MmeErreur = texte;
        m.MmeAttente = null;
        await CompterLotAsync(m, false, ct);
        await SignalerAsync(m.MmeCreePar, new SignalMail("ERREUR", $"Courriel non envoyé : {m.MmeObjet}", texte, "ATTENTION", $"/mail/message/{m.MmeId}",
            $"mail:erreur:{m.MmeId}", m.MmeTypeElement, m.MmeIdElement), ct);
    }

    private static void Reporter(MessageEntite m, DateTimeOffset quand, string cause)
    {
        m.MmeEtat = "A_ENVOYER";
        m.MmeProchainEssai = quand;
        m.MmeAttente = cause;
    }

    private void Journaliser(CompteEntite c, MessageEntite m, MessageAEnvoyer amv, List<string> adresses, string resultat, int? code, string? reponse, long taille, Stopwatch chrono) =>
        db.Journal.Add(new JournalEntite
        {
            MjoMmeId = m.MmeId, MjoMloId = m.MmeMloId, MjoMcoId = c.McoId, MjoAlias = m.MmeExpediteur, MjoUtilisateur = m.MmeCreePar, MjoOrigine = m.MmeUsage ?? "MANUEL",
            MjoDestinataires = amv.Destinataires, MjoNouveaux = amv.Nouveaux, MjoDomaines = amv.Domaines.ToList(), MjoAdresses = resultat == "OK" ? adresses : [],
            MjoTaille = taille, MjoResultat = resultat, MjoCode = code?.ToString(), MjoReponse = reponse is { Length: > 1000 } ? reponse[..1000] : reponse,
            MjoDureeMs = (int)chrono.ElapsedMilliseconds, MjoLe = Maintenant,
        });

    private async Task CompterLotAsync(MessageEntite m, bool envoye, CancellationToken ct)
    {
        if (m.MmeMloId is not long id || await db.Lots.FirstOrDefaultAsync(l => l.MloId == id, ct) is not { } lot) return;
        if (envoye) lot.MloEnvoyes++;
        else lot.MloErreurs++;
        if (lot.MloEnvoyes + lot.MloErreurs == lot.MloMessages)
        {
            await SignalerAsync(lot.MloAuteur, new SignalMail("LOT", $"Envoi groupé terminé : {lot.MloLibelle}",
                $"{lot.MloEnvoyes} courriel(s) envoyé(s), {lot.MloErreurs} en erreur.", lot.MloErreurs > 0 ? "ATTENTION" : "INFO", $"/mail?vue=envoyes&lot={lot.MloId}",
                $"mail:lot:{lot.MloId}"), ct);
        }
    }

    private async Task ApresEnvoiAsync(MessageEntite m, List<DestinataireEntite> dest, byte[] eml, CancellationToken ct)
    {
        try
        {
            var refs = await db.Pieces.AsNoTracking().Where(p => p.MpiMmeId == m.MmeId).Select(p => p.MpiReference).ToListAsync(ct);
            m.MmeDgeId = await specialisation.ApresEnvoiAsync(new CourrielEnvoye(m.MmeId, m.MmeTypeElement, m.MmeIdElement, m.MmeUsage, m.MmeObjet, m.MmeExpediteur ?? "",
                dest.Where(x => x.MdeRole == "A").Select(x => x.MdeAdresse).ToList(), dest.Where(x => x.MdeRole == "CC").Select(x => x.MdeAdresse).ToList(),
                dest.Where(x => x.MdeRole == "CCI").Select(x => x.MdeAdresse).ToList(), m.MmeCorpsHtml ?? "", m.MmeEnvoyeLe ?? Maintenant, eml, refs, m.MmeCreePar,
                m.MmeMessageId ?? ""), ct);
            await db.SaveChangesAsync(ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning(e, "Mail : suites de l'envoi du message {Id} incomplètes (GED, statut, suivi)", m.MmeId);
        }
    }

    /// <summary>Quota journalier franchissant le seuil d'avertissement : signal aux administrateurs (une fois par jour et par compte).</summary>
    private async Task QuotaAsync(CompteEntite c, Limites l, List<EnvoiPasse> passes, int envoyes, CancellationToken ct)
    {
        var seuil = await comptes.ParametreAsync("seuil_quota_pct", 80, ct);
        var avant = ReglesEnvoi.TauxQuotaJour(l, passes, Maintenant);
        var apres = ReglesEnvoi.TauxQuotaJour(l, [.. passes, new EnvoiPasse(Maintenant, envoyes, 0, [])], Maintenant);
        if (avant >= seuil || apres < seuil) return;
        var alias = await db.Alias.AsNoTracking().Where(a => a.MalMcoId == c.McoId && a.MalPrincipal).Select(a => a.MalNom).FirstOrDefaultAsync(ct) ?? c.McoCode;
        await SignalerAdministrateursAsync(new SignalMail("QUOTA", $"Messagerie « {alias} » : {apres} % du quota journalier",
            $"Au-delà du quota ({l.DestinatairesParJour} destinataires par jour), les envois attendront le lendemain ; les envois prioritaires gardent une réserve.",
            "ATTENTION", "/mail?vue=envois", $"mail:quota:{c.McoId}:{Maintenant:yyyyMMdd}"), ct);
    }

    private async Task SignalerAsync(string utilisateur, SignalMail s, CancellationToken ct)
    {
        try
        {
            await specialisation.SignalerAsync(s, [utilisateur], ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning(e, "Mail : signal {Cle} non publié", s.Cle);
        }
    }

    private async Task SignalerAdministrateursAsync(SignalMail s, CancellationToken ct)
    {
        try
        {
            await specialisation.SignalerAsync(s, await specialisation.AdministrateursAsync(ct), ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning(e, "Mail : signal {Cle} non publié", s.Cle);
        }
    }

    // --- Consultation ---

    public async Task<List<MessageDto>> MessagesAsync(Utilisateur u, string? vue, string? type, string? id, long? lot, int page, int taille, CancellationToken ct)
    {
        var q = db.Messages.AsNoTracking().Where(m => m.MmeSens == "E");
        if (!string.IsNullOrEmpty(type) && !string.IsNullOrEmpty(id))
        {
            q = q.Where(m => db.Liens.Any(l => l.MliMmeId == m.MmeId && l.MliTypeElement == type && l.MliIdElement == id && l.MliRetireLe == null));
        }
        else if (!u.EstAdmin)
        {
            q = q.Where(m => m.MmeCreePar == u.Code);
        }
        if (lot is not null) q = q.Where(m => m.MmeMloId == lot);
        q = vue switch
        {
            "envoyes" => q.Where(m => m.MmeEtat == "ENVOYE"),
            "attente" => q.Where(m => EtatsAttente.Contains(m.MmeEtat)),
            "erreurs" => q.Where(m => m.MmeEtat == "ERREUR"),
            _ => q,
        };
        taille = Math.Clamp(taille, 1, 200);
        var l = await q.OrderByDescending(m => m.MmeCreeLe).ThenByDescending(m => m.MmeId).Skip((Math.Max(page, 1) - 1) * taille).Take(taille).ToListAsync(ct);
        return await DtosAsync(l, ct);
    }

    private async Task<List<MessageDto>> DtosAsync(List<MessageEntite> l, CancellationToken ct)
    {
        var ids = l.Select(m => m.MmeId).ToList();
        var dest = (await db.Destinataires.AsNoTracking().Where(d => ids.Contains(d.MdeMmeId) && d.MdeRole != "DE").ToListAsync(ct)).ToLookup(d => d.MdeMmeId);
        var pieces = (await db.Pieces.AsNoTracking().Where(p => ids.Contains(p.MpiMmeId)).Select(p => p.MpiMmeId).ToListAsync(ct)).ToLookup(x => x);
        return l.Select(m => new MessageDto(m.MmeId, m.MmeSens, m.MmeEtat, m.MmePriorite, m.MmeExpediteur, m.MmeObjet,
            dest[m.MmeId].Where(d => d.MdeRole == "A").Select(d => d.MdeNom ?? d.MdeAdresse).Take(3).ToList(), dest[m.MmeId].Count(), pieces[m.MmeId].Count(),
            m.MmeTypeElement, m.MmeIdElement, m.MmeMloId, m.MmeCreeLe, m.MmeCreePar, m.MmeEnvoyeLe, m.MmeProchainEssai, m.MmeAttente, m.MmeErreur, m.MmeTentatives,
            m.MmeDgeId)).ToList();
    }

    public async Task<DetailMessageDto> MessageAsync(Utilisateur u, long id, CancellationToken ct)
    {
        var m = await Lisible(u, id, ct);
        var dto = (await DtosAsync([m], ct))[0];
        var dest = await db.Destinataires.AsNoTracking().Where(d => d.MdeMmeId == id).OrderBy(d => d.MdeId)
            .Select(d => new DestinataireDto(d.MdeRole, d.MdeAdresse, d.MdeNom, d.MdeNonRemis)).ToListAsync(ct);
        var pieces = await db.Pieces.AsNoTracking().Where(p => p.MpiMmeId == id).Select(p => new PieceDto(p.MpiReference, p.MpiNom, p.MpiType, p.MpiTaille)).ToListAsync(ct);
        var lignes = await db.Journal.AsNoTracking().Where(j => j.MjoMmeId == id).OrderBy(j => j.MjoLe).ToListAsync(ct);
        return new DetailMessageDto(dto, m.MmeCorpsHtml, dest, pieces, lignes.Select(Ligne).ToList());
    }

    private async Task<MessageEntite> Lisible(Utilisateur u, long id, CancellationToken ct)
    {
        var m = await db.Messages.FirstOrDefaultAsync(x => x.MmeId == id, ct) ?? throw ExceptionMetier.Introuvable("Courriel");
        if (!u.EstAdmin && m.MmeCreePar != u.Code && !await db.Liens.AnyAsync(l => l.MliMmeId == id && l.MliRetireLe == null, ct))
            throw ExceptionMetier.AccesRefuse("LIRE");
        return m;
    }

    /// <summary>Annulation d'un courriel pas encore parti (auteur ou administrateur).</summary>
    public async Task<DetailMessageDto> AnnulerAsync(Utilisateur u, long id, CancellationToken ct)
    {
        var m = await Lisible(u, id, ct);
        if (!u.EstAdmin && m.MmeCreePar != u.Code) throw ExceptionMetier.AccesRefuse("ANNULER");
        if (m.MmeEtat is not ("A_ENVOYER" or "SUSPENDU")) throw ExceptionMetier.Invalide("MAIL_ETAT", "Seul un courriel en attente s'annule");
        m.MmeEtat = "ANNULE";
        m.MmeAttente = null;
        await CompterLotAsync(m, false, ct);
        await db.SaveChangesAsync(ct);
        return await MessageAsync(u, id, ct);
    }

    /// <summary>Nouvel essai d'un courriel en erreur (auteur ou administrateur).</summary>
    public async Task<DetailMessageDto> RelancerAsync(Utilisateur u, long id, CancellationToken ct)
    {
        var m = await Lisible(u, id, ct);
        if (!u.EstAdmin && m.MmeCreePar != u.Code) throw ExceptionMetier.AccesRefuse("RELANCER");
        if (m.MmeEtat != "ERREUR") throw ExceptionMetier.Invalide("MAIL_ETAT", "Seul un courriel en erreur se relance");
        (m.MmeEtat, m.MmeTentatives, m.MmeProchainEssai, m.MmeErreur, m.MmeAttente) = ("A_ENVOYER", 0, Maintenant, null, null);
        if (m.MmeMloId is long l && await db.Lots.FirstOrDefaultAsync(x => x.MloId == l, ct) is { } lot) lot.MloErreurs = Math.Max(0, lot.MloErreurs - 1);
        await db.SaveChangesAsync(ct);
        return await MessageAsync(u, id, ct);
    }

    public async Task<List<LigneJournalDto>> JournalAsync(Utilisateur u, long? compte, DateTimeOffset? du, DateTimeOffset? au, string? resultat, int page, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var q = db.Journal.AsNoTracking();
        if (compte is not null) q = q.Where(j => j.MjoMcoId == compte);
        if (du is not null) q = q.Where(j => j.MjoLe >= du);
        if (au is not null) q = q.Where(j => j.MjoLe < au);
        if (!string.IsNullOrEmpty(resultat)) q = q.Where(j => j.MjoResultat == resultat);
        return (await q.OrderByDescending(j => j.MjoLe).Skip((Math.Max(page, 1) - 1) * 100).Take(100).ToListAsync(ct)).Select(Ligne).ToList();
    }

    private static LigneJournalDto Ligne(JournalEntite j) => new(j.MjoId, j.MjoMmeId, j.MjoMloId, j.MjoMcoId, j.MjoAlias, j.MjoUtilisateur, j.MjoOrigine,
        j.MjoDestinataires, j.MjoNouveaux, j.MjoDomaines, j.MjoResultat, j.MjoCode, j.MjoReponse, j.MjoDureeMs, j.MjoLe);

    /// <summary>Compteurs de chaque compte face à ses limitations (administrateur).</summary>
    public async Task<List<CompteurCompte>> CompteursAsync(Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var res = new List<CompteurCompte>();
        var alias = await db.Alias.AsNoTracking().Where(a => a.MalPrincipal).ToDictionaryAsync(a => a.MalMcoId, a => a.MalNom, ct);
        foreach (var c in await db.Comptes.AsNoTracking().Where(c => c.McoEnvoi).OrderBy(c => c.McoCode).ToListAsync(ct))
        {
            var l = Limites.Completer(c.McoHebergeur, ServiceComptesMail.LimitesSaisies(c));
            var passes = await PassesAsync(c.McoId, ct);
            var jour = Maintenant.AddDays(-1);
            res.Add(new CompteurCompte(c.McoId, alias.GetValueOrDefault(c.McoId, c.McoCode), c.McoEtat, l,
                passes.Where(p => p.Le > Maintenant.AddHours(-1)).Sum(p => p.Destinataires), passes.Sum(p => p.Destinataires), ReglesEnvoi.TauxQuotaJour(l, passes, Maintenant),
                await db.Messages.CountAsync(m => m.MmeMcoId == c.McoId && m.MmeEtat == "A_ENVOYER", ct),
                await db.Messages.CountAsync(m => m.MmeMcoId == c.McoId && m.MmeEtat == "SUSPENDU", ct),
                await db.Journal.CountAsync(j => j.MjoMcoId == c.McoId && j.MjoResultat == "ECHEC" && j.MjoLe > jour, ct),
                await db.Messages.Where(m => m.MmeMcoId == c.McoId && m.MmeEtat == "A_ENVOYER").MinAsync(m => m.MmeProchainEssai, ct)));
        }
        return res;
    }

    public async Task<List<LotDto>> LotsAsync(Utilisateur u, CancellationToken ct)
    {
        var q = db.Lots.AsNoTracking();
        if (!u.EstAdmin) q = q.Where(l => l.MloAuteur == u.Code);
        return await q.OrderByDescending(l => l.MloCreeLe).Take(100).Select(l => new LotDto(l.MloId, l.MloOrigine, l.MloLibelle, l.MloAuteur, l.MloMessages,
            l.MloDestinataires, l.MloEnvoyes, l.MloErreurs, l.MloFinEstimee, l.MloAvertissement, l.MloCreeLe)).ToListAsync(ct);
    }

    /// <summary>Reprise d'un compte suspendu (administrateur) : courriels suspendus remis en file.</summary>
    public async Task<List<CompteurCompte>> ReprendreAsync(Utilisateur u, long compte, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var c = await comptes.Compte(compte, ct);
        (c.McoEtat, c.McoSuspenduLe) = ("OK", null);
        await db.Messages.Where(m => m.MmeMcoId == compte && m.MmeEtat == "SUSPENDU")
            .ExecuteUpdateAsync(x => x.SetProperty(m => m.MmeEtat, "A_ENVOYER").SetProperty(m => m.MmeProchainEssai, Maintenant).SetProperty(m => m.MmeAttente, (string?)null), ct);
        await db.SaveChangesAsync(ct);
        return await CompteursAsync(u, ct);
    }

    // --- Outils ---

    private async Task<(AliasEntite, CompteEntite)> AliasCompteAsync(long aliasId, CancellationToken ct)
    {
        var a = await db.Alias.AsNoTracking().FirstOrDefaultAsync(x => x.MalId == aliasId, ct) ?? throw ExceptionMetier.Invalide("MAIL_EXPEDITEUR", "Expéditeur inconnu");
        var c = await db.Comptes.AsNoTracking().FirstAsync(x => x.McoId == a.MalMcoId, ct);
        if (!a.MalActif || !c.McoActif || !c.McoEnvoi) throw ExceptionMetier.Invalide("MAIL_EXPEDITEUR", $"« {a.MalNom} » n'envoie pas de courriels");
        return (a, c);
    }

    /// <summary>Envois réussis du compte sur les dernières 24 heures (compteurs des limitations).</summary>
    private async Task<List<EnvoiPasse>> PassesAsync(long compte, CancellationToken ct)
    {
        var depuis = Maintenant.AddDays(-1);
        return (await db.Journal.AsNoTracking().Where(j => j.MjoMcoId == compte && j.MjoResultat == "OK" && j.MjoLe > depuis)
            .Select(j => new { j.MjoLe, j.MjoDestinataires, j.MjoNouveaux, j.MjoDomaines }).ToListAsync(ct))
            .Select(j => new EnvoiPasse(j.MjoLe, j.MjoDestinataires, j.MjoNouveaux, j.MjoDomaines)).ToList();
    }

    /// <summary>Messages en file du compte, dans l'ordre de traitement (estimation de la position).</summary>
    private async Task<List<MessageAEnvoyer>> FileAsync(long compte, CancellationToken ct) =>
        (await db.Messages.AsNoTracking().Where(m => m.MmeMcoId == compte && m.MmeEtat == "A_ENVOYER")
            .OrderBy(m => m.MmePriorite == ReglesEnvoi.Haute ? 0 : m.MmePriorite == ReglesEnvoi.Normale ? 1 : 2).ThenBy(m => m.MmeCreeLe)
            .Select(m => new { m.MmePriorite, N = db.Destinataires.Count(d => d.MdeMmeId == m.MmeId) }).ToListAsync(ct))
        .Select(x => new MessageAEnvoyer(Math.Max(1, x.N), 0, [], x.MmePriorite)).ToList();

    /// <summary>Adresses déjà écrites par le compte (un an) : les autres sont de nouveaux destinataires.</summary>
    private async Task<HashSet<string>> ConnusAsync(long compte, CancellationToken ct)
    {
        var depuis = Maintenant.AddYears(-1);
        var l = await db.Journal.AsNoTracking().Where(j => j.MjoMcoId == compte && j.MjoResultat == "OK" && j.MjoLe > depuis).Select(j => j.MjoAdresses).ToListAsync(ct);
        return l.SelectMany(x => x).ToHashSet();
    }

    public static ExceptionMetier NonConfigure() =>
        ExceptionMetier.Conflit("MAIL_NON_CONFIGURE", "Aucun compte d'envoi configuré : un administrateur le paramètre dans Paramètres › Messagerie");

    private static string Heure(DateTimeOffset d) => d.ToLocalTime().ToString("dd/MM HH:mm");

    private static string Duree(TimeSpan t) => t.TotalMinutes < 1 ? "moins d'une minute" : t.TotalHours < 1 ? $"{(int)t.TotalMinutes} min" : $"{(int)t.TotalHours} h {t.Minutes:00}";

    private static string? Extrait(string? html)
    {
        var t = ConstructionMail.Texte(html ?? "").ReplaceLineEndings(" ");
        return t.Length > 300 ? t[..300] : t;
    }

    private static string? Vide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
