using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Reprise;

/// <summary>Demande de l'écran : la chaîne de la base source n'est ni conservée ni renvoyée.</summary>
public sealed record DemandeRepriseEcran(string Source, string Connexion, IReadOnlyList<string>? Societes, bool Simulation, string? Correspondances,
    short? DecimalesQte = null, short? DecimalesPrix = null, string? VolumeMde = null);

/// <summary>
/// Routes de l'écran « Reprise de données » (plan reprise-mde-optim, lot 3), page /parametres/reprise, réservées à
/// l'administrateur : état (base vide, historique, fusions), correspondances par défaut à télécharger, exécution
/// (simulation ou réelle) dans la base de la société courante, rapport (JSON ou Markdown), fusions de doublons.
/// </summary>
public static class RoutesReprise
{
    private const int Historique = 50;

    public static IEndpointRouteBuilder MapReprise(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/reprise");
        g.MapGet("", async (HttpContext http, UniteEcriture unite, TachesReprise taches, SocieteCourante societe, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            var tache = taches.Derniere(societe);
            return Results.Ok(await unite.LireAsync(async (c, tx, t) => new
            {
                // Dernière reprise lancée depuis l'écran (en cours : l'écran reprend son suivi après un rechargement).
                tache = tache?.Instantane(),
                // Reprise en cours : ses tables sont verrouillées jusqu'à sa fin, le contrôle n'est pas fait (null).
                base_vide = tache is { EnCours: true } ? null : await BaseCibleReprise.EstVideSansAttendreAsync(c, tx!, t),
                sources = new[] { SourceReprise.Mde, SourceReprise.Optim },
                // Décimales proposées avant l'import (quantités, prix des lignes de pièces) ; null : celles de la source.
                decimales = new[] { SourceReprise.Mde, SourceReprise.Optim }.ToDictionary(s => s, s =>
                {
                    var (qte, prix) = DemandeReprise.DecimalesParDefaut(s);
                    return new { qte, prix };
                }),
                executions = await ExecutionsReprise.ListerAsync(c, tx, Historique, t),
                fusions = new Dictionary<string, IReadOnlyList<GroupeFusion>>
                {
                    [SourceReprise.Mde] = await FusionsReprise.LireAsync(c, tx, SourceReprise.Mde, t),
                    [SourceReprise.Optim] = await FusionsReprise.LireAsync(c, tx, SourceReprise.Optim, t),
                },
            }, null, ct));
        });
        g.MapGet("/correspondances/{source}", (string source, HttpContext http) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            // Texte renvoyé dans un objet : le fichier garde ses commentaires (JSON à commentaires).
            var s = Source(source);
            return Results.Ok(new { nom = $"correspondances-{s.ToLowerInvariant()}.json", contenu = CorrespondancesReprise.TexteParDefaut(s) });
        });
        // Lancement en tâche de fond (202) : contrôles rapides ici (connexion saisie, base vide, aucune reprise en cours),
        // puis l'écran suit l'avancement par GET /reprise/tache jusqu'au rapport (plan reprise-mde-optim, grosse base).
        g.MapPost("/executer", async (DemandeRepriseEcran d, HttpContext http, UniteEcriture unite, TachesReprise taches, SocieteCourante societe, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            u.ExigerAdmin();
            if (string.IsNullOrWhiteSpace(d.Connexion))
                throw ExceptionMetier.Invalide("VALIDATION", "Connexion à la base source attendue",
                    new[] { new { champ = "connexion", code = "OBLIGATOIRE", message = "Connexion à la base source attendue" } });
            var source = Source(d.Source);
            // Une reprise en cours verrouille les tables contrôlées : refus immédiat, avant de lire la base.
            if (taches.Derniere(societe) is { EnCours: true })
                throw ExceptionMetier.Conflit(ErreurReprise.EnCours, "Une reprise est déjà en cours pour cette base");
            var vide = await unite.LireAsync((c, tx, t) => BaseCibleReprise.EstVideSansAttendreAsync(c, tx!, t), null, ct);
            if (vide is null)
                throw ExceptionMetier.Conflit(ErreurReprise.EnCours, "Une reprise est déjà en cours pour cette base (tables verrouillées)");
            if (vide == false)
                throw ExceptionMetier.Conflit(ErreurReprise.BaseNonVide, "La base cible contient déjà des données métier : la reprise se fait dans une base neuve");
            var tache = taches.Lancer(societe, new DemandeReprise
            {
                Source = source, ConnexionSource = d.Connexion, Simulation = d.Simulation, Auteur = u.Code,
                Societes = (d.Societes ?? []).Select(s => s.Trim()).Where(s => s.Length > 0).ToList(),
                Correspondances = string.IsNullOrWhiteSpace(d.Correspondances) ? null : d.Correspondances,
                DecimalesQte = d.DecimalesQte, DecimalesPrix = d.DecimalesPrix, VolumeMde = d.VolumeMde,
            });
            return Results.Accepted("/api/reprise/tache", tache.Instantane());
        });
        g.MapGet("/tache", (HttpContext http, TachesReprise taches, SocieteCourante societe) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            return Results.Ok(new { tache = taches.Derniere(societe)?.Instantane() });
        });
        g.MapPost("/tache/arreter", (HttpContext http, TachesReprise taches, SocieteCourante societe) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            if (!taches.Arreter(societe)) throw ExceptionMetier.Introuvable("Reprise en cours");
            return Results.Ok(new { tache = taches.Derniere(societe)?.Instantane() });
        });
        g.MapGet("/executions/{id:long}", async (long id, HttpContext http, UniteEcriture unite, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            var r = await unite.LireAsync((c, tx, t) => ExecutionsReprise.RapportAsync(c, tx, id, t), null, ct)
                ?? throw ExceptionMetier.Introuvable("Reprise");
            return Results.Ok(r);
        });
        g.MapGet("/executions/{id:long}/markdown", async (long id, HttpContext http, UniteEcriture unite, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            var r = await unite.LireAsync((c, tx, t) => ExecutionsReprise.RapportAsync(c, tx, id, t), null, ct)
                ?? throw ExceptionMetier.Introuvable("Reprise");
            return Results.Ok(new { nom = $"reprise-{id}.md", contenu = r.EnMarkdown() });
        });
        g.MapPut("/fusions/{source}", async (string source, List<GroupeFusion> groupes, HttpContext http, UniteEcriture unite, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            var erreurs = FusionsReprise.Controler(groupes);
            if (erreurs.Count > 0)
                throw ExceptionMetier.Invalide("VALIDATION", "Fusions de doublons refusées",
                    erreurs.Select(e => new { champ = $"{e.Rang}.cle", code = e.Code, message = e.Cle }).ToList());
            await FusionsReprise.RemplacerAsync(unite, Source(source), groupes, ct);
            return Results.NoContent();
        });
        return api;
    }

    private static string Source(string source) => source.ToUpperInvariant() switch
    {
        SourceReprise.Mde => SourceReprise.Mde,
        SourceReprise.Optim => SourceReprise.Optim,
        _ => throw ExceptionMetier.Invalide(ErreurReprise.SourceIncompatible, $"Source de reprise inconnue : {source}"),
    };
}
