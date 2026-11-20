using LogiBTP.Ged;
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
        g.MapGet("", async (HttpContext http, UniteEcriture unite, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            return Results.Ok(await unite.LireAsync(async (c, tx, t) => new
            {
                base_vide = await BaseCibleReprise.EstVideAsync(c, tx, t),
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
        g.MapPost("/executer", async (DemandeRepriseEcran d, HttpContext http, UniteEcriture unite, StockageGed stockage, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            u.ExigerAdmin();
            if (string.IsNullOrWhiteSpace(d.Connexion))
                throw ExceptionMetier.Invalide("VALIDATION", "Connexion à la base source attendue",
                    new[] { new { champ = "connexion", code = "OBLIGATOIRE", message = "Connexion à la base source attendue" } });
            try
            {
                var r = await RepriseBase.ExecuterAsync(new DemandeReprise
                {
                    Source = Source(d.Source), ConnexionSource = d.Connexion, Simulation = d.Simulation, Auteur = u.Code,
                    Societes = (d.Societes ?? []).Select(s => s.Trim()).Where(s => s.Length > 0).ToList(),
                    Correspondances = string.IsNullOrWhiteSpace(d.Correspondances) ? null : d.Correspondances,
                    StockageGed = stockage.Racine, DecimalesQte = d.DecimalesQte, DecimalesPrix = d.DecimalesPrix, VolumeMde = d.VolumeMde,
                }, unite, ct);
                return Results.Ok(new { reprise_id = r.RepriseId, rapport = r.Rapport });
            }
            catch (RepriseRefuseeException e)
            {
                throw e.Code == ErreurReprise.BaseNonVide ? ExceptionMetier.Conflit(e.Code, e.Message) : ExceptionMetier.Invalide(e.Code, e.Message);
            }
            catch (ArgumentException e)
            {
                throw ExceptionMetier.Invalide(ErreurReprise.SourceIncompatible, Masquage.Texte(e.Message) ?? e.GetType().Name);
            }
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
