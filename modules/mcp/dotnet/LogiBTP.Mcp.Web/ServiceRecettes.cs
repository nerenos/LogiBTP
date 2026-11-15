using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;

namespace LogiBTP.Mcp.Web;

/// <summary>Recette décrite (écran de gestion, bouton « Demander à l'agent »).</summary>
public sealed record RecetteDecrite(string Code, string Libelle, string? Description, string Prompt, IReadOnlyList<ParametreRecette> Parametres,
    IReadOnlyList<string> Outils, string Sortie, bool Active, bool Fournie, int Ordre, DateTimeOffset ModifieLe, string ModifiePar);

/// <summary>Outil du catalogue proposé à l'écran de gestion des recettes : nom, description, classe déclarée.</summary>
public sealed record OutilDecrit(string Nom, string Description, string Classe);

/// <summary>
/// Recettes lues par un humain : actives (toutes pour l'administrateur avec <c>toutes</c>), délégation active de l'utilisateur
/// (bouton « Demander à l'agent »), catalogue des outils (administrateur seulement, pour la saisie).
/// </summary>
public sealed record RecettesLues(IReadOnlyList<RecetteDecrite> Recettes, bool Delegation, IReadOnlyList<OutilDecrit>? Outils);

/// <summary>
/// Recettes (lot 13, ANALYSE-MODULE-MCP.md § 10.2) : gestion par l'administrateur seul (jamais un agent : AGENT_INTERDIT,
/// ni une usurpation), lecture des recettes actives par tout humain ; exposition comme prompts MCP à un agent, limitée aux
/// recettes actives dont tous les outils sont permis à sa délégation (<see cref="ServiceMcp.OutilsAsync"/>).
/// </summary>
public sealed class ServiceRecettes(McpDbContext db, SpecialisationMcp specialisation, ServiceMcp mcp)
{
    private static List<T> Lire<T>(string? json) => string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<T>>(json, JsonCalcul.Options) ?? [];

    private static string Ecrire<T>(T valeur) => JsonSerializer.Serialize(valeur, JsonCalcul.Options);

    private static RecetteDecrite Decrire(RecetteMcp r) => new(r.MreCode, r.MreLibelle, r.MreDescription, r.MrePrompt, Lire<ParametreRecette>(r.MreParametres),
        Lire<string>(r.MreOutils), r.MreSortie, r.MreActive, r.MreFournie, r.MreOrdre, r.MreModifieLe, r.MreModifiePar);

    private async Task<List<RecetteDecrite>> ToutesAsync(bool actives, CancellationToken ct) =>
        (await db.Recettes.AsNoTracking().Where(r => !actives || r.MreActive).OrderBy(r => r.MreOrdre).ThenBy(r => r.MreLibelle).ToListAsync(ct))
            .Select(Decrire).ToList();

    /// <summary>Recettes lues par un humain (administrateur avec <paramref name="toutes"/> : inactives et catalogue des outils compris).</summary>
    public async Task<RecettesLues> ListerAsync(Utilisateur u, bool toutes, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        if (toutes) u.ExigerAdmin();
        var aujourdhui = LecturesMcp.Aujourdhui;
        var delegation = await db.Delegations.AsNoTracking().AnyAsync(d => d.MdeCompte == u.Code && d.MdeRevoqueeLe == null && d.MdeEcheance > aujourdhui, ct);
        var outils = toutes ? specialisation.Outils.Select(o => new OutilDecrit(o.Nom, specialisation.Texte(o.Description), o.Classe)).ToList() : null;
        return new RecettesLues(await ToutesAsync(!toutes, ct), delegation, outils);
    }

    /// <summary>Crée ou remplace une recette (administrateur) : contrôle par <see cref="ReglesRecettes.ControlerRecette"/> avec le catalogue.</summary>
    public async Task<RecetteDecrite> EnregistrerAsync(string code, RecetteSaisie saisie, Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        u.ExigerAdmin();
        var s = saisie with { Code = code };
        if (ReglesRecettes.ControlerRecette(s, specialisation.Outils.Select(o => o.Nom).ToList()) is { Count: > 0 } erreurs)
            throw ExceptionMetier.Invalide(erreurs[0], "Recette invalide : " + string.Join(", ", erreurs));
        var r = await db.Recettes.FirstOrDefaultAsync(x => x.MreCode == code, ct);
        if (r is null) db.Recettes.Add(r = new RecetteMcp { MreCode = code });
        r.MreLibelle = s.Libelle!.Trim();
        r.MreDescription = string.IsNullOrWhiteSpace(s.Description) ? null : s.Description.Trim()[..Math.Min(s.Description.Trim().Length, 500)];
        r.MrePrompt = s.Prompt!.Trim();
        r.MreParametres = Ecrire(s.Parametres ?? []);
        r.MreOutils = Ecrire(s.Outils ?? []);
        r.MreSortie = s.Sortie!;
        r.MreActive = s.Active;
        r.MreModifieLe = DateTimeOffset.UtcNow;
        r.MreModifiePar = u.Code;
        await db.SaveChangesAsync(ct);
        return Decrire(r);
    }

    /// <summary>Supprime une recette de l'entreprise (administrateur) ; une recette fournie se désactive seulement.</summary>
    public async Task SupprimerAsync(string code, Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        u.ExigerAdmin();
        var r = await db.Recettes.FirstOrDefaultAsync(x => x.MreCode == code, ct) ?? throw ExceptionMetier.Introuvable("Recette");
        if (r.MreFournie) throw ExceptionMetier.Invalide(ErreurMcp.McpRecetteFournie, "Une recette fournie se désactive, elle ne se supprime pas");
        db.Recettes.Remove(r);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Recettes actives dont tous les outils sont exposés à la délégation de l'agent.</summary>
    private async Task<List<RecetteDecrite>> PermisesAsync(ContexteAgent ctx, CancellationToken ct)
    {
        var permis = (await mcp.OutilsAsync(ctx, ct)).Select(t => t.Name).ToHashSet();
        return (await ToutesAsync(true, ct)).Where(r => ReglesRecettes.RecettePermise(r.Active, r.Outils, permis)).ToList();
    }

    /// <summary>Description d'un argument : libellé saisi et type (texte du dictionnaire « mcp.recettes.types.TYPE »).</summary>
    private string DescriptionArgument(ParametreRecette p)
    {
        var type = specialisation.Texte($"mcp.recettes.types.{p.Type}");
        return string.IsNullOrWhiteSpace(p.Libelle) ? type : $"{p.Libelle} ({type})";
    }

    /// <summary>Prompts MCP de l'agent (liste du client) : recettes permises, arguments typés.</summary>
    public async Task<IList<Prompt>> PromptsAsync(ContexteAgent ctx, CancellationToken ct) =>
        (await PermisesAsync(ctx, ct)).Select(r => new Prompt
        {
            Name = r.Code, Title = r.Libelle, Description = r.Description ?? r.Libelle,
            Arguments = r.Parametres.Select(p => new PromptArgument { Name = p.Nom!, Title = p.Libelle, Description = DescriptionArgument(p), Required = p.Requis }).ToList(),
        }).ToList();

    /// <summary>
    /// Prompt rempli d'une recette permise (obtention par le client avec ses arguments) ; recette inconnue, inactive ou non
    /// permise, ou argument requis manquant : erreur du protocole (paramètres invalides).
    /// </summary>
    public async Task<GetPromptResult> PromptAsync(ContexteAgent ctx, string nom, IReadOnlyDictionary<string, JsonElement>? arguments, CancellationToken ct)
    {
        var r = (await PermisesAsync(ctx, ct)).FirstOrDefault(x => x.Code == nom)
            ?? throw new McpProtocolException($"{ErreurMcp.McpRecetteInconnue} : {nom}", McpErrorCode.InvalidParams);
        var valeurs = (arguments ?? new Dictionary<string, JsonElement>()).ToDictionary(kv => kv.Key,
            kv => kv.Value.ValueKind == JsonValueKind.String ? kv.Value.GetString() : kv.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : kv.Value.GetRawText());
        var rempli = ReglesRecettes.RemplirPrompt(r.Prompt, r.Parametres, valeurs);
        if (rempli.Manquants.Count > 0)
            throw new McpProtocolException($"{ErreurMcp.McpParametreInvalide} : {string.Join(", ", rempli.Manquants)}", McpErrorCode.InvalidParams);
        return new GetPromptResult
        {
            Description = r.Description ?? r.Libelle,
            Messages = [new PromptMessage { Role = Role.User, Content = new TextContentBlock { Text = rempli.Texte } }],
        };
    }
}
