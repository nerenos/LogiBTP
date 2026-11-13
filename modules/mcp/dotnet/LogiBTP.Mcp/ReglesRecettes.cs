using System.Text.RegularExpressions;

namespace LogiBTP.Mcp;

/// <summary>Paramètre typé d'une recette : nom de la marque « {nom} » du prompt, type, libellé, requis.</summary>
public sealed record ParametreRecette(string? Nom, string? Type, string? Libelle = null, bool Requis = false);

/// <summary>Recette saisie ou lue : code, libellé, prompt paramétré, paramètres, outils permis, sortie attendue, active.</summary>
public sealed record RecetteSaisie(string? Code, string? Libelle, string? Prompt, IReadOnlyList<ParametreRecette>? Parametres,
    IReadOnlyList<string>? Outils, string? Sortie, bool Active = true, string? Description = null);

/// <summary>Prompt rempli : texte, paramètres requis sans valeur.</summary>
public sealed record PromptRempli(string Texte, IReadOnlyList<string> Manquants);

/// <summary>
/// Règles des recettes (plans/mcp.md, lot 13 ; ANALYSE-MODULE-MCP.md § 10.2), répliquées dans modules/mcp/js/src/recettes.js
/// (jeu partagé tests/cas/03_recettes.json) : marques du prompt, contrôle d'une recette, recette permise à une délégation,
/// prompt rempli.
/// </summary>
public static partial class ReglesRecettes
{
    public const int LibelleMax = 200;
    public const int PromptMax = 4000;
    public const int ValeurMax = 500;

    [GeneratedRegex("^[a-z][a-z0-9_]{1,59}$")]
    private static partial Regex Code();

    [GeneratedRegex("^[a-z][a-z0-9_]{0,39}$")]
    private static partial Regex Nom();

    [GeneratedRegex(@"\{([a-z][a-z0-9_]*)\}")]
    private static partial Regex Marque();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Blancs();

    private static readonly string[] Types =
        [TypeParametreRecette.Marche, TypeParametreRecette.Chantier, TypeParametreRecette.Document, TypeParametreRecette.Periode, TypeParametreRecette.Texte];

    private static readonly string[] Sorties = [SortieRecette.Brouillon, SortieRecette.Proposition, SortieRecette.Rapport];

    /// <summary>Noms des marques « {nom} » du prompt, uniques, dans l'ordre d'apparition.</summary>
    public static IReadOnlyList<string> ParametresPrompt(string? prompt) =>
        Marque().Matches(prompt ?? "").Select(m => m.Groups[1].Value).Distinct().ToList();

    /// <summary>
    /// Contrôle d'une recette saisie : codes d'erreur dans l'ordre (vide : valide) — code, textes, paramètres, outils
    /// (<paramref name="outilsConnus"/> : catalogue, null : non contrôlés), sortie.
    /// </summary>
    public static IReadOnlyList<string> ControlerRecette(RecetteSaisie? r, IReadOnlyCollection<string>? outilsConnus = null)
    {
        var erreurs = new List<string>();
        if (!Code().IsMatch(r?.Code ?? "")) erreurs.Add(ErreurMcp.McpRecetteCode);
        var libelle = (r?.Libelle ?? "").Trim();
        var prompt = (r?.Prompt ?? "").Trim();
        if (libelle.Length == 0 || libelle.Length > LibelleMax || prompt.Length == 0 || prompt.Length > PromptMax) erreurs.Add(ErreurMcp.McpRecetteTexte);
        var parametres = r?.Parametres ?? [];
        var noms = parametres.Select(p => p?.Nom ?? "").ToList();
        var marques = ParametresPrompt(prompt);
        if (parametres.Any(p => !Nom().IsMatch(p?.Nom ?? "") || !Types.Contains(p?.Type) || (p?.Libelle?.Length ?? 0) > 100)
            || noms.Distinct().Count() != noms.Count
            || marques.Any(m => !noms.Contains(m)) || noms.Any(n => !marques.Contains(n)))
            erreurs.Add(ErreurMcp.McpRecetteParametre);
        var outils = (r?.Outils ?? []).Select(o => o ?? "").ToList();
        if (outils.Count == 0 || outils.Distinct().Count() != outils.Count || (outilsConnus is not null && outils.Any(o => !outilsConnus.Contains(o))))
            erreurs.Add(ErreurMcp.McpRecetteOutil);
        if (!Sorties.Contains(r?.Sortie)) erreurs.Add(ErreurMcp.McpRecetteSortie);
        return erreurs;
    }

    /// <summary>Recette proposée à une délégation : active et tous ses outils parmi ceux que la délégation permet.</summary>
    public static bool RecettePermise(bool active, IReadOnlyCollection<string> outils, IReadOnlyCollection<string> outilsPermis) =>
        active && outils.Count > 0 && outils.All(outilsPermis.Contains);

    /// <summary>Valeur d'un paramètre remplie dans le prompt : rognée, sur une ligne hors TEXTE, bornée à <see cref="ValeurMax"/>.</summary>
    public static string ValeurParametre(string? type, string? valeur)
    {
        var v = (valeur ?? "").Trim();
        if (type != TypeParametreRecette.Texte) v = Blancs().Replace(v, " ");
        return v.Length > ValeurMax ? v[..ValeurMax] : v;
    }

    /// <summary>
    /// Prompt rempli : marques des paramètres déclarés remplacées par leur valeur (absente : vide), marques non déclarées
    /// laissées ; paramètres requis sans valeur (ordre de déclaration).
    /// </summary>
    public static PromptRempli RemplirPrompt(string? prompt, IReadOnlyList<ParametreRecette>? parametres, IReadOnlyDictionary<string, string?>? valeurs)
    {
        var liste = parametres ?? [];
        var remplies = new Dictionary<string, string>();
        foreach (var p in liste)
            if (p.Nom is { } nom && !remplies.ContainsKey(nom)) remplies[nom] = ValeurParametre(p.Type, valeurs?.GetValueOrDefault(nom));
        var manquants = liste.Where(p => p.Requis && p.Nom is { } n && remplies[n].Length == 0).Select(p => p.Nom!).ToList();
        var texte = Marque().Replace((prompt ?? "").Trim(), m => remplies.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);
        return new PromptRempli(texte, manquants);
    }
}
