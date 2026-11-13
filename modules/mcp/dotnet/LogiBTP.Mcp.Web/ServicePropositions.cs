using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Mcp.Web;

/// <summary>Proposition décrite (état affiché : ECHUE au-delà de l'échéance) ; <c>Adresse</c> : écran de la proposition dans l'application.</summary>
public sealed record PropositionDecrite(long Id, string Delegation, string Compte, string Client, string Outil, string Action, string Noeud, string Droit,
    string Libelle, string? CibleType, string? CibleId, JsonElement Contenu, JsonElement Avertissements, DateOnly Echeance, string Etat,
    DateTimeOffset CreeLe, DateTimeOffset? CorrigeLe, string? CorrigePar, DateTimeOffset? TraiteeLe, string? TraiteePar, string? Motif,
    JsonElement? Resultat, string? Adresse);

/// <summary>Contenu corrigé par l'humain avant acceptation.</summary>
public sealed record CorrectionProposition(JsonElement Contenu);

/// <summary>Refus motivé d'une proposition.</summary>
public sealed record RefusProposition(string? Motif);

/// <summary>
/// File des propositions d'agents (lot 10, ANALYSE-MODULE-MCP.md § 10.1) : lister (les miennes : déposées par mes
/// délégations ; à valider : en attente que je peux accepter ; toutes : administrateur), lire, corriger le contenu, refuser
/// avec motif, accepter. L'acceptation exécute l'exécuteur déclaré par la spécialisation **sous l'identité de l'humain**
/// (utilisateur de la requête : sa session, ses droits, ses limites de montant ; jamais le jeton de l'agent), dans une
/// transaction de l'unité d'écriture ; chaque décision va au journal des agents (proposition, humain). Un agent ne décide
/// jamais d'une proposition (AGENT_INTERDIT), ni un administrateur pendant une usurpation.
/// </summary>
public sealed class ServicePropositions(McpDbContext db, SpecialisationMcp specialisation, IServiceProvider services)
{
    /// <summary>Vues de la liste.</summary>
    public const string VueMiennes = "miennes";
    public const string VueAValider = "a_valider";
    public const string VueToutes = "toutes";

    private const int LimiteDefaut = 200;

    private IDroits? Droits => services.GetService(typeof(IDroits)) as IDroits;

    private PropositionDecrite Decrire(PropositionMcp p)
    {
        static JsonElement J(string? s, string defaut) => JsonDocument.Parse(string.IsNullOrWhiteSpace(s) ? defaut : s).RootElement.Clone();
        return new PropositionDecrite(p.MprId, p.MprDelegation, p.MprCompte, p.MprClient, p.MprOutil, p.MprAction, p.MprNoeud, p.MprDroit, p.MprLibelle,
            p.MprCibleType, p.MprCibleId, J(p.MprContenu, "{}"), J(p.MprAvertissements, "[]"), p.MprEcheance,
            ReglesPropositions.EtatProposition(p.MprEtat, p.MprEcheance, LecturesMcp.Aujourdhui) ?? p.MprEtat, p.MprCreeLe, p.MprCorrigeLe, p.MprCorrigePar,
            p.MprTraiteeLe, p.MprTraiteePar, p.MprMotif, p.MprResultat is null ? null : J(p.MprResultat, "null"), specialisation.AdresseProposition(p.MprId));
    }

    /// <summary>L'humain peut décider de la proposition : droit exigé sur son nœud (module Droits), sinon délégant ou administrateur.</summary>
    private async Task<bool> PeutDeciderAsync(Utilisateur u, PropositionMcp p, CancellationToken ct) =>
        Droits is { } droits ? await droits.AutoriseAsync(u, p.MprNoeud, p.MprDroit, ct) : p.MprCompte == u.Code || u.EstAdmin;

    /// <summary>Visible : délégant, administrateur, ou humain qui a le droit exigé.</summary>
    private async Task<bool> VisibleAsync(Utilisateur u, PropositionMcp p, CancellationToken ct) =>
        p.MprCompte == u.Code || u.EstAdmin || await PeutDeciderAsync(u, p, ct);

    private async Task<PropositionMcp> ChargerAsync(long id, Utilisateur u, CancellationToken ct)
    {
        var p = await db.Propositions.AsNoTracking().FirstOrDefaultAsync(x => x.MprId == id, ct);
        if (p is null || !await VisibleAsync(u, p, ct)) throw ExceptionMetier.Introuvable("Proposition");
        return p;
    }

    /// <summary>
    /// Propositions : les miennes (déposées par mes délégations), à valider (en attente, non échues, que j'ai le droit
    /// d'accepter, quel que soit le délégant), toutes (administrateur) ; filtre d'état facultatif ; les plus récentes d'abord.
    /// </summary>
    public async Task<IReadOnlyList<PropositionDecrite>> ListerAsync(Utilisateur u, string? vue, string? etat, int? limite, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        var q = db.Propositions.AsNoTracking();
        var aujourdhui = LecturesMcp.Aujourdhui;
        var n = Math.Clamp(limite ?? LimiteDefaut, 1, 1000);
        switch (vue ?? VueMiennes)
        {
            case VueMiennes:
                q = q.Where(p => p.MprCompte == u.Code);
                break;
            case VueToutes:
                u.ExigerAdmin();
                break;
            case VueAValider:
                var attente = await q.Where(p => p.MprEtat == EtatProposition.EnAttente && p.MprEcheance > aujourdhui)
                    .OrderByDescending(p => p.MprId).ToListAsync(ct);
                var permis = new Dictionary<(string, string), bool>();
                var retenues = new List<PropositionMcp>();
                foreach (var p in attente)
                {
                    if (!permis.TryGetValue((p.MprNoeud, p.MprDroit), out var ok)) permis[(p.MprNoeud, p.MprDroit)] = ok = await PeutDeciderAsync(u, p, ct);
                    if (ok || (Droits is null && p.MprCompte == u.Code)) retenues.Add(p);
                    if (retenues.Count >= n) break;
                }
                return retenues.Select(Decrire).ToList();
            default:
                throw ExceptionMetier.Invalide(ErreurMcp.McpParametreInvalide, "Vue inconnue : miennes, a_valider ou toutes");
        }
        var lignes = await q.OrderByDescending(p => p.MprId).Take(n * 2).ToListAsync(ct);
        return lignes.Select(Decrire).Where(d => etat is null || d.Etat == etat).Take(n).ToList();
    }

    /// <summary>Une proposition (délégant, administrateur ou humain qui a le droit exigé ; sinon introuvable).</summary>
    public async Task<PropositionDecrite> LireAsync(long id, Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        return Decrire(await ChargerAsync(id, u, ct));
    }

    /// <summary>Contrôle commun d'une décision (règle répliquée) et du droit de l'humain ; 403, 409 ou 422 selon le premier code.</summary>
    private async Task ControlerAsync(PropositionMcp p, Utilisateur u, string decision, string? motif, CancellationToken ct)
    {
        var erreurs = ReglesPropositions.ControlerDecision(new PropositionAControler(p.MprEtat, p.MprEcheance),
            new DecisionSaisie(decision, motif, u.Agent is not null, u.Usurpateur is not null), LecturesMcp.Aujourdhui);
        if (erreurs.Count > 0)
        {
            var code = erreurs[0];
            throw code switch
            {
                ErreursAgent.AgentInterdit => ExceptionMetier.AgentInterdit("décision sur une proposition"),
                ErreurMcp.McpUsurpation => new ExceptionMetier(StatusCodes.Status403Forbidden, code, "Décision interdite pendant une usurpation"),
                ErreurMcp.McpPropositionClose or ErreurMcp.McpPropositionEchue => ExceptionMetier.Conflit(code, "Proposition déjà traitée ou échue", erreurs),
                _ => ExceptionMetier.Invalide(code, "Décision refusée", erreurs),
            };
        }
        if (!await PeutDeciderAsync(u, p, ct)) throw ExceptionMetier.AccesRefuse(p.MprDroit);
    }

    /// <summary>Ligne du journal des agents pour une décision de l'humain sur une proposition.</summary>
    private JournalAgent Journal(PropositionMcp p, Utilisateur u, string decision) => new()
    {
        AjoDate = DateTimeOffset.UtcNow, AjoDelegation = p.MprDelegation, AjoCompte = p.MprCompte, AjoClient = p.MprClient,
        AjoOutil = p.MprAction.Length > 100 ? p.MprAction[..100] : p.MprAction, AjoClasse = ClasseOutil.Proposition,
        AjoParametres = new JsonObject { ["decision"] = decision, ["outil"] = p.MprOutil }.ToJsonString(),
        AjoProposition = p.MprId, AjoHumain = u.Code, AjoStatut = StatutAppelAgent.Succes,
    };

    private async Task JournaliserAsync(JournalAgent j, Stopwatch chrono)
    {
        j.AjoDureeMs = (int)Math.Min(int.MaxValue, chrono.ElapsedMilliseconds);
        db.Journal.Add(j);
        await db.SaveChangesAsync(CancellationToken.None);
    }

    /// <summary>Corrige le contenu (contrôlé par l'exécuteur) avant acceptation ; même droit que l'acceptation.</summary>
    public async Task<PropositionDecrite> CorrigerAsync(long id, CorrectionProposition c, Utilisateur u, CancellationToken ct)
    {
        var chrono = Stopwatch.StartNew();
        ServiceDelegations.ExigerHumain(u);
        var p = await ChargerAsync(id, u, ct);
        await ControlerAsync(p, u, DecisionProposition.Corriger, null, ct);
        var contenu = JsonNode.Parse(c.Contenu.GetRawText());
        var executeur = specialisation.Executeur(p.MprAction) ?? throw ExceptionMetier.Invalide(ErreurMcp.McpExecuteurInconnu, $"Action sans exécuteur : {p.MprAction}");
        var erreurs = contenu is not JsonObject ? [ErreurMcp.McpContenuInvalide] : executeur.Controler?.Invoke(contenu) ?? [];
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(ErreurMcp.McpContenuInvalide, "Contenu corrigé invalide", erreurs);
        var maintenant = DateTimeOffset.UtcNow;
        var texte = contenu!.ToJsonString();
        var n = await db.Propositions.Where(x => x.MprId == id && x.MprEtat == EtatProposition.EnAttente)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.MprContenu, texte).SetProperty(y => y.MprCorrigeLe, maintenant).SetProperty(y => y.MprCorrigePar, u.Code), ct);
        if (n == 0) throw ExceptionMetier.Conflit(ErreurMcp.McpPropositionClose, "Proposition déjà traitée");
        await JournaliserAsync(Journal(p, u, DecisionProposition.Corriger), chrono);
        return Decrire(await db.Propositions.AsNoTracking().FirstAsync(x => x.MprId == id, ct));
    }

    /// <summary>Refus motivé (motif obligatoire) ; rien n'est exécuté.</summary>
    public async Task<PropositionDecrite> RefuserAsync(long id, RefusProposition r, Utilisateur u, CancellationToken ct)
    {
        var chrono = Stopwatch.StartNew();
        ServiceDelegations.ExigerHumain(u);
        var p = await ChargerAsync(id, u, ct);
        await ControlerAsync(p, u, DecisionProposition.Refuser, r.Motif, ct);
        var maintenant = DateTimeOffset.UtcNow;
        var motif = r.Motif!.Trim();
        var n = await db.Propositions.Where(x => x.MprId == id && x.MprEtat == EtatProposition.EnAttente)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.MprEtat, EtatProposition.Refusee).SetProperty(y => y.MprTraiteeLe, maintenant)
                .SetProperty(y => y.MprTraiteePar, u.Code).SetProperty(y => y.MprMotif, motif), ct);
        if (n == 0) throw ExceptionMetier.Conflit(ErreurMcp.McpPropositionClose, "Proposition déjà traitée");
        await JournaliserAsync(Journal(p, u, DecisionProposition.Refuser), chrono);
        return Decrire(await db.Propositions.AsNoTracking().FirstAsync(x => x.MprId == id, ct));
    }

    /// <summary>
    /// Accepte : l'exécuteur déclaré agit sous l'identité de l'humain de la requête (ses droits et limites, contrôlés par
    /// les services des routes existantes), dans une transaction avec le passage à ACCEPTEE (tout ou rien) ; l'échec laisse
    /// la proposition en attente et est journalisé (refus ou erreur) avant d'être rendu à l'humain.
    /// </summary>
    public async Task<PropositionDecrite> AccepterAsync(long id, HttpContext http, CancellationToken ct)
    {
        var chrono = Stopwatch.StartNew();
        var u = Utilisateur.Depuis(http);
        ServiceDelegations.ExigerHumain(u);
        var p = await ChargerAsync(id, u, ct);
        var journal = Journal(p, u, DecisionProposition.Accepter);
        try
        {
            // Refus (droit, état, échéance) journalisés comme les échecs de l'exécution.
            await ControlerAsync(p, u, DecisionProposition.Accepter, null, ct);
            var executeur = specialisation.Executeur(p.MprAction) ?? throw ExceptionMetier.Invalide(ErreurMcp.McpExecuteurInconnu, $"Action sans exécuteur : {p.MprAction}");
            var resultat = await db.Unite().ExecuterAsync(async jeton =>
            {
                var maintenant = DateTimeOffset.UtcNow;
                // Passage à ACCEPTEE d'abord (une seule acceptation, même en concurrence), annulé avec la transaction si l'exécution échoue.
                var n = await db.Propositions.Where(x => x.MprId == id && x.MprEtat == EtatProposition.EnAttente)
                    .ExecuteUpdateAsync(x => x.SetProperty(y => y.MprEtat, EtatProposition.Acceptee).SetProperty(y => y.MprTraiteeLe, maintenant)
                        .SetProperty(y => y.MprTraiteePar, u.Code), jeton);
                if (n == 0) throw ExceptionMetier.Conflit(ErreurMcp.McpPropositionClose, "Proposition déjà traitée");
                var contenu = JsonNode.Parse(p.MprContenu) as JsonObject ?? [];
                var r = await executeur.Executer(new ExecutionProposition(p, contenu, u, http), jeton);
                var texte = r.ToJsonString();
                await db.Propositions.Where(x => x.MprId == id).ExecuteUpdateAsync(x => x.SetProperty(y => y.MprResultat, texte), jeton);
                return r;
            }, ct);
            var ids = resultat["identifiants"] is JsonArray a ? a.DeepClone() : new JsonArray();
            journal.AjoEcrits = new JsonObject
            {
                ["type"] = executeur.TypeElement, ["identifiants"] = ids, ["nombre"] = ids.AsArray().Count, ["action"] = p.MprAction,
            }.ToJsonString();
        }
        catch (ExceptionMetier ex)
        {
            journal.AjoStatut = ex.Statut is 401 or 403 ? StatutAppelAgent.Refus : StatutAppelAgent.Erreur;
            journal.AjoErreur = ex.Code;
            await JournaliserAsync(journal, chrono);
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            journal.AjoStatut = StatutAppelAgent.Erreur;
            journal.AjoErreur = ex.GetType().Name;
            await JournaliserAsync(journal, chrono);
            throw;
        }
        await JournaliserAsync(journal, chrono);
        return Decrire(await db.Propositions.AsNoTracking().FirstAsync(x => x.MprId == id, ct));
    }
}
