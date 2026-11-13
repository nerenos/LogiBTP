using System.Collections.Concurrent;
using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Droits.Web;

public sealed record ProfilDto(Guid Id, string Code, string Libelle, string? Description, bool Systeme, bool Total, int Comptes);
public sealed record ProfilSaisi(string? Code, string? Libelle, string? Description, Guid? CopieDe);
public sealed record DroitsDto(ProfilDto Profil, Dictionary<string, Dictionary<string, string>> Lignes, Dictionary<string, Limite> Limites);
public sealed record DroitsSaisis(Dictionary<string, Dictionary<string, string>>? Lignes, Dictionary<string, Limite>? Limites = null);
public sealed record MesDroits(string Code, string Profil, bool Total, Dictionary<string, Dictionary<string, string>> Lignes);
public sealed record EntreeJournalDroits(DateTimeOffset Le, string Par, string Profil, string Evenement, string? Noeud, JsonElement? Avant, JsonElement? Apres);

/// <summary>
/// Profils et droits (ANALYSE-MODULE-DROITS.md) : droits d'un profil lus en cache court par base (vidé à chaque écriture),
/// profils système non supprimables, profil utilisé par des comptes non supprimable, lignes contrôlées par le catalogue,
/// chaque modification au journal. Gestion réservée au nœud administration/profils (routes).
/// </summary>
public sealed class ServiceDroits(DroitsDbContext db, SpecialisationDroits specialisation, SocieteCourante societe, IServiceProvider services) : IDroits
{
    private sealed record EtatProfil(DroitsProfil Droits, IReadOnlyDictionary<string, Limite> Limites);
    private static readonly ConcurrentDictionary<(string Base, string Profil), (DateTimeOffset Lu, EtatProfil Etat)> Cache = new();
    private static readonly TimeSpan DureeCache = TimeSpan.FromSeconds(60);

    /// <summary>Cache des droits vidé : relu au prochain appel (après toute écriture).</summary>
    public static void Oublier() => Cache.Clear();

    // ---------------------------------------------------------------- lecture des droits (IDroits)

    public async Task<DroitsProfil> DroitsAsync(string profil, CancellationToken ct) => (await EtatAsync(profil, ct)).Droits;

    private async Task<EtatProfil> EtatAsync(string profil, CancellationToken ct)
    {
        var cle = (societe.Connexion, profil);
        var maintenant = DateTimeOffset.UtcNow;
        if (Cache.TryGetValue(cle, out var c) && maintenant - c.Lu < DureeCache) return c.Etat;
        var p = await db.Profils.AsNoTracking().FirstOrDefaultAsync(x => x.ProCode == profil, ct);
        EtatProfil etat;
        if (p is null) etat = new(DroitsProfil.Aucun, new Dictionary<string, Limite>());
        else if (p.ProTotal) etat = new(DroitsProfil.Tous, new Dictionary<string, Limite>());
        else
        {
            var lignes = await db.Droits.AsNoTracking().Where(d => d.DprProId == p.ProId).ToListAsync(ct);
            var limites = await db.Limites.AsNoTracking().Where(l => l.LvaProId == p.ProId).ToListAsync(ct);
            etat = new(new DroitsProfil(false, lignes.ToDictionary(l => l.DprNoeud, l => (IReadOnlyDictionary<string, string>)Actions(l.DprActions))),
                limites.ToDictionary(l => l.LvaNoeud, l => new Limite(l.LvaPiece, l.LvaCumul, l.LvaJours)));
        }
        Cache[cle] = (maintenant, etat);
        return etat;
    }

    /// <summary>Limites de validation du nœud ou de son plus proche ancêtre (profil total : aucune) ; agent : celles du délégant.</summary>
    public async Task<LimiteValidation?> LimiteAsync(Utilisateur u, string noeud, CancellationToken ct) =>
        ReglesDroits.LimiteEffective((await EtatAsync(u.Profil, ct)).Limites, noeud) is { } l ? new LimiteValidation(l.Piece, l.Cumul, l.Jours) : null;

    /// <summary>Portée accordée ; pour un agent (<see cref="Utilisateur.Agent"/>) : profil ∩ plafond de la délégation (<see cref="AgentsDroits"/>).</summary>
    public async Task<string?> PorteeAsync(Utilisateur u, string noeud, string action, CancellationToken ct) =>
        u.Agent is { } agent
            ? AgentsDroits.Portee(await DroitsAsync(u.Profil, ct), await PlafondAsync(agent, ct), noeud, action)
            : ReglesDroits.PorteeAccordee(await DroitsAsync(u.Profil, ct), noeud, action);

    private readonly Dictionary<string, PlafondAgent?> plafonds = [];

    /// <summary>
    /// Plafond de la délégation de l'agent, lu une fois par requête par le contrat <see cref="IPlafondAgent"/> du socle
    /// (service facultatif : absent, délégation inconnue, révoquée ou expirée ⇒ null, tout refusé).
    /// </summary>
    public async Task<PlafondAgent?> PlafondAsync(AgentRequete agent, CancellationToken ct)
    {
        if (plafonds.TryGetValue(agent.Delegation, out var p)) return p;
        p = services.GetService(typeof(IPlafondAgent)) is IPlafondAgent contrat ? await contrat.PlafondAsync(agent.Delegation, ct) : null;
        plafonds[agent.Delegation] = p;
        return p;
    }

    public async Task<IReadOnlyList<ProfilDroits>> ProfilsAsync(CancellationToken ct) =>
        (await db.Profils.AsNoTracking().OrderBy(p => p.ProLibelle).ToListAsync(ct)).Select(p => new ProfilDroits(p.ProCode, p.ProLibelle, p.ProTotal)).ToList();

    public async Task<MesDroits> MoiAsync(Utilisateur u, CancellationToken ct)
    {
        var d = await DroitsAsync(u.Profil, ct);
        return new MesDroits(u.Code, u.Profil, d.Total, d.Lignes.ToDictionary(l => l.Key, l => l.Value.ToDictionary()));
    }

    private static Dictionary<string, string> Actions(JsonDocument? j) =>
        j?.RootElement.ValueKind == JsonValueKind.Object
            ? j.RootElement.EnumerateObject().Where(p => p.Value.ValueKind == JsonValueKind.String).ToDictionary(p => p.Name, p => p.Value.GetString()!)
            : [];

    private static JsonDocument Json(object o) => JsonSerializer.SerializeToDocument(o);

    // ---------------------------------------------------------------- catalogue et profils

    public Task<IReadOnlyList<NoeudCatalogue>> CatalogueAsync(CancellationToken ct) => specialisation.CatalogueAsync(services, ct);

    public async Task<List<ProfilDto>> ListeAsync(CancellationToken ct)
    {
        var comptes = await specialisation.ComptesParProfilAsync(services, ct);
        return (await db.Profils.AsNoTracking().OrderByDescending(p => p.ProTotal).ThenBy(p => p.ProLibelle).ToListAsync(ct))
            .Select(p => Dto(p, comptes)).ToList();
    }

    private static ProfilDto Dto(Profil p, IReadOnlyDictionary<string, int> comptes) =>
        new(p.ProId, p.ProCode, p.ProLibelle, p.ProDescription, p.ProSysteme, p.ProTotal, comptes.GetValueOrDefault(p.ProCode));

    private async Task<Profil> ProfilAsync(Guid id, CancellationToken ct) =>
        await db.Profils.FirstOrDefaultAsync(p => p.ProId == id, ct) ?? throw ExceptionMetier.Introuvable("Profil");

    private static ExceptionMetier Erreurs(List<string> codes) => ExceptionMetier.Invalide(codes[0],
        string.Join(" · ", codes.Select(c => ReglesDroits.Messages.GetValueOrDefault(c, c))));

    /// <summary>Nouveau profil (code unique, contrôlé) ; copie facultative des droits d'un autre profil (non total).</summary>
    public async Task<ProfilDto> CreerAsync(ProfilSaisi s, Utilisateur u, CancellationToken ct)
    {
        var code = (s.Code ?? "").Trim().ToUpperInvariant();
        var erreurs = ReglesDroits.ControlerProfil(code, s.Libelle);
        if (erreurs.Count > 0) throw Erreurs(erreurs);
        if (await db.Profils.AnyAsync(p => p.ProCode == code, ct)) throw ExceptionMetier.Conflit("PROFIL_EXISTANT", $"Le profil {code} existe déjà");
        var p = new Profil { ProCode = code, ProLibelle = s.Libelle!.Trim(), ProDescription = s.Description?.Trim(), ProCreePar = u.Code, ProMajPar = u.Code };
        db.Profils.Add(p);
        if (s.CopieDe is Guid source)
        {
            var modele = await ProfilAsync(source, ct);
            foreach (var l in await db.Droits.AsNoTracking().Where(d => d.DprProId == modele.ProId).ToListAsync(ct))
            {
                db.Droits.Add(new DroitProfil { DprProId = p.ProId, DprNoeud = l.DprNoeud, DprActions = Json(Actions(l.DprActions)) });
            }
        }
        db.Journal.Add(new JournalDroits { JdrPar = u.Code, JdrProfil = code, JdrEvenement = "CREATION", JdrApres = Json(new { libelle = p.ProLibelle, copie_de = s.CopieDe }) });
        await db.SaveChangesAsync(ct);
        Oublier();
        return Dto(p, await specialisation.ComptesParProfilAsync(services, ct));
    }

    /// <summary>Libellé et description (le code ne change pas : il est porté par les comptes).</summary>
    public async Task<ProfilDto> ModifierAsync(Guid id, ProfilSaisi s, Utilisateur u, CancellationToken ct)
    {
        var p = await ProfilAsync(id, ct);
        var erreurs = ReglesDroits.ControlerProfil(p.ProCode, s.Libelle);
        if (erreurs.Count > 0) throw Erreurs(erreurs);
        var avant = new { libelle = p.ProLibelle, description = p.ProDescription };
        p.ProLibelle = s.Libelle!.Trim();
        p.ProDescription = s.Description?.Trim();
        p.ProMajPar = u.Code;
        p.ProMajLe = DateTimeOffset.UtcNow;
        db.Journal.Add(new JournalDroits { JdrPar = u.Code, JdrProfil = p.ProCode, JdrEvenement = "MODIFICATION", JdrAvant = Json(avant), JdrApres = Json(new { libelle = p.ProLibelle, description = p.ProDescription }) });
        await db.SaveChangesAsync(ct);
        Oublier();
        return Dto(p, await specialisation.ComptesParProfilAsync(services, ct));
    }

    public async Task SupprimerAsync(Guid id, Utilisateur u, CancellationToken ct)
    {
        var p = await ProfilAsync(id, ct);
        if (p.ProSysteme) throw ExceptionMetier.Conflit("PROFIL_SYSTEME", $"Le profil {p.ProCode} est un profil système");
        var n = (await specialisation.ComptesParProfilAsync(services, ct)).GetValueOrDefault(p.ProCode);
        if (n > 0) throw ExceptionMetier.Conflit("PROFIL_UTILISE", $"Le profil {p.ProCode} est porté par {n} compte(s)");
        db.Profils.Remove(p);
        db.Journal.Add(new JournalDroits { JdrPar = u.Code, JdrProfil = p.ProCode, JdrEvenement = "SUPPRESSION", JdrAvant = Json(new { libelle = p.ProLibelle }) });
        await db.SaveChangesAsync(ct);
        Oublier();
    }

    // ---------------------------------------------------------------- droits d'un profil

    public async Task<DroitsDto> LignesAsync(Guid id, CancellationToken ct)
    {
        var p = await ProfilAsync(id, ct);
        var lignes = await db.Droits.AsNoTracking().Where(d => d.DprProId == id).ToListAsync(ct);
        var limites = await db.Limites.AsNoTracking().Where(l => l.LvaProId == id).ToListAsync(ct);
        return new DroitsDto(Dto(p, await specialisation.ComptesParProfilAsync(services, ct)), lignes.ToDictionary(l => l.DprNoeud, l => Actions(l.DprActions)),
            limites.ToDictionary(l => l.LvaNoeud, l => new Limite(l.LvaPiece, l.LvaCumul, l.LvaJours)));
    }

    /// <summary>
    /// Remplace les lignes du profil (non total) : contrôle par le catalogue (nœud connu, action permise, portée), puis
    /// journal des nœuds modifiés, ajoutés ou retirés (avant / après).
    /// </summary>
    public async Task<DroitsDto> RemplacerAsync(Guid id, DroitsSaisis s, Utilisateur u, CancellationToken ct)
    {
        var p = await ProfilAsync(id, ct);
        if (p.ProTotal) throw ExceptionMetier.Conflit("PROFIL_TOTAL", $"Le profil {p.ProCode} a tous les droits : rien à régler");
        var nouvelles = (s.Lignes ?? []).ToDictionary(l => l.Key, l => (IReadOnlyDictionary<string, string>)l.Value);
        var catalogue = (await CatalogueAsync(ct)).ToDictionary(n => n.Cle, n => n.Actions);
        var erreurs = ReglesDroits.ControlerLignes(nouvelles, catalogue);
        if (erreurs.Count > 0)
        {
            throw ExceptionMetier.Invalide(erreurs[0].Code, $"{ReglesDroits.Messages[erreurs[0].Code]} : {erreurs[0].Noeud} {erreurs[0].Action}".Trim(), erreurs);
        }
        var limites = s.Limites ?? [];
        foreach (var (noeud, l) in limites)
        {
            if (!catalogue.ContainsKey(noeud)) throw ExceptionMetier.Invalide("NOEUD_INVALIDE", $"{ReglesDroits.Messages["NOEUD_INVALIDE"]} : {noeud}");
            var e = ReglesDroits.ControlerLimite(l);
            if (e.Count > 0) throw ExceptionMetier.Invalide(e[0], $"{ReglesDroits.Messages[e[0]]} : {noeud}");
        }
        var limitesAvant = await db.Limites.Where(l => l.LvaProId == id).ToListAsync(ct);
        foreach (var noeud in limitesAvant.Select(l => l.LvaNoeud).Union(limites.Keys).Order(StringComparer.Ordinal))
        {
            var a = limitesAvant.FirstOrDefault(l => l.LvaNoeud == noeud) is { } x ? new Limite(x.LvaPiece, x.LvaCumul, x.LvaJours) : null;
            var n = limites.GetValueOrDefault(noeud);
            if (a == n) continue;
            db.Journal.Add(new JournalDroits
            {
                JdrPar = u.Code, JdrProfil = p.ProCode, JdrEvenement = "LIMITE", JdrNoeud = noeud,
                JdrAvant = a is null ? null : Json(a), JdrApres = n is null ? null : Json(n),
            });
        }
        db.Limites.RemoveRange(limitesAvant);
        var anciennes = await db.Droits.Where(d => d.DprProId == id).ToListAsync(ct);
        var avant = anciennes.ToDictionary(l => l.DprNoeud, l => Actions(l.DprActions));
        foreach (var noeud in avant.Keys.Union(nouvelles.Keys).Order(StringComparer.Ordinal))
        {
            var a = avant.GetValueOrDefault(noeud);
            var n = nouvelles.GetValueOrDefault(noeud);
            if (a is not null && n is not null && a.Count == n.Count && a.All(x => n.TryGetValue(x.Key, out var v) && v == x.Value)) continue;
            db.Journal.Add(new JournalDroits
            {
                JdrPar = u.Code, JdrProfil = p.ProCode, JdrEvenement = "DROITS", JdrNoeud = noeud,
                JdrAvant = a is null ? null : Json(a), JdrApres = n is null ? null : Json(n),
            });
        }
        db.Droits.RemoveRange(anciennes);
        await db.SaveChangesAsync(ct);
        foreach (var (noeud, actions) in nouvelles) db.Droits.Add(new DroitProfil { DprProId = id, DprNoeud = noeud, DprActions = Json(actions) });
        foreach (var (noeud, l) in limites) db.Limites.Add(new LimiteValidationProfil { LvaProId = id, LvaNoeud = noeud, LvaPiece = l.Piece, LvaCumul = l.Cumul, LvaJours = (short)l.Jours });
        p.ProMajPar = u.Code;
        p.ProMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        Oublier();
        return await LignesAsync(id, ct);
    }

    public async Task<List<EntreeJournalDroits>> JournalAsync(string? profil, CancellationToken ct) =>
        (await db.Journal.AsNoTracking().Where(j => profil == null || j.JdrProfil == profil).OrderByDescending(j => j.JdrId).Take(200).ToListAsync(ct))
        .Select(j => new EntreeJournalDroits(j.JdrLe, j.JdrPar, j.JdrProfil, j.JdrEvenement, j.JdrNoeud, j.JdrAvant?.RootElement.Clone(), j.JdrApres?.RootElement.Clone()))
        .ToList();
}
