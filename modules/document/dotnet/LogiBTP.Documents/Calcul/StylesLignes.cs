using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LogiBTP.Documents;

/// <summary>
/// Style d'une ligne : chaque propriété vaut null tant qu'aucun niveau ne la fixe. Couleurs : #rrggbb (minuscules) ou
/// variable du thème (--nom).
/// </summary>
public sealed record StyleLigne(string? Couleur = null, string? Fond = null, bool? Gras = null, bool? Italique = null,
    bool? Souligne = null, bool? Barre = null, string? Taille = null)
{
    public bool EstVide => this == new StyleLigne();

    /// <summary>Ce style complété par celui d'un niveau plus précis : chaque propriété fixée par « sur » l'emporte.</summary>
    public StyleLigne Surcharger(StyleLigne sur) => new(sur.Couleur ?? Couleur, sur.Fond ?? Fond, sur.Gras ?? Gras,
        sur.Italique ?? Italique, sur.Souligne ?? Souligne, sur.Barre ?? Barre, sur.Taille ?? Taille);

    /// <summary>Forme JSON des seules propriétés fixées (celle du JSON partagé avec styles-lignes.js).</summary>
    public JsonObject VersJson()
    {
        var o = new JsonObject();
        if (Couleur is not null) o["couleur"] = Couleur;
        if (Fond is not null) o["fond"] = Fond;
        if (Gras is not null) o["gras"] = Gras;
        if (Italique is not null) o["italique"] = Italique;
        if (Souligne is not null) o["souligne"] = Souligne;
        if (Barre is not null) o["barre"] = Barre;
        if (Taille is not null) o["taille"] = Taille;
        return o;
    }
}

/// <summary>Style paramétré d'une classe à un niveau : global (famille et type nuls), famille ou type (code) de document.</summary>
public sealed record StyleParametre(string Classe, string? Famille, string? Type, JsonElement Valeur);

/// <summary>Contexte de résolution : famille et type du document, styles paramétrés, styles de classe propres au document (ent_styles_lignes).</summary>
public sealed record ContexteStyles(string? Famille, string? Type, IReadOnlyList<StyleParametre> Styles, JsonElement? Document = null);

/// <summary>
/// Styles des lignes (styles-lignes.js côté client, jeu modules/document/tests/styles/01_styles_lignes.json) : classe
/// d'une ligne selon son type et sa position, puis style résolu propriété par propriété : défaut du programme (aucun)
/// &lt; global &lt; famille &lt; type &lt; document &lt; style propre de la ligne (lig_style).
/// </summary>
public static class StylesLignes
{
    public static readonly string[] Proprietes = ["couleur", "fond", "gras", "italique", "souligne", "barre", "taille"];
    private static readonly HashSet<string> Couleurs = ["couleur", "fond"];
    private static readonly HashSet<string> Booleens = ["gras", "italique", "souligne", "barre"];
    private static readonly Regex FormeCouleur = new("^(#[0-9a-fA-F]{6}|--[a-z0-9-]+)$", RegexOptions.Compiled);

    private static bool ValeurValide(string propriete, JsonElement v) =>
        Couleurs.Contains(propriete) ? v.ValueKind == JsonValueKind.String && FormeCouleur.IsMatch(v.GetString()!)
        : Booleens.Contains(propriete) ? v.ValueKind is JsonValueKind.True or JsonValueKind.False
        : v.ValueKind == JsonValueKind.String && TaillesStyleLigne.Toutes.Contains(v.GetString());

    /// <summary>Style nettoyé : propriétés connues à valeur valide seulement (null et valeurs invalides ignorés).</summary>
    public static StyleLigne Normaliser(JsonElement? style)
    {
        if (style is not { ValueKind: JsonValueKind.Object } s) return new StyleLigne();
        string? Texte(string p) => s.TryGetProperty(p, out var v) && ValeurValide(p, v)
            ? (Couleurs.Contains(p) && v.GetString()!.StartsWith('#') ? v.GetString()!.ToLowerInvariant() : v.GetString()) : null;
        bool? Booleen(string p) => s.TryGetProperty(p, out var v) && ValeurValide(p, v) ? v.GetBoolean() : null;
        return new StyleLigne(Texte("couleur"), Texte("fond"), Booleen("gras"), Booleen("italique"), Booleen("souligne"), Booleen("barre"), Texte("taille"));
    }

    /// <summary>Fautes d'un style saisi : propriété inconnue ou valeur invalide (null admis = pas de valeur).</summary>
    public static List<string> Erreurs(JsonElement? style)
    {
        if (style is null or { ValueKind: JsonValueKind.Null }) return [];
        if (style is not { ValueKind: JsonValueKind.Object } s) return ["STYLE_FORME"];
        var fautes = new List<string>();
        foreach (var p in s.EnumerateObject())
        {
            if (!Proprietes.Contains(p.Name)) fautes.Add($"STYLE_PROPRIETE:{p.Name}");
            else if (p.Value.ValueKind != JsonValueKind.Null && !ValeurValide(p.Name, p.Value)) fautes.Add($"STYLE_VALEUR:{p.Name}");
        }
        return fautes;
    }

    /// <summary>Fautes des styles par classe d'un document : { CLASSE: style }.</summary>
    public static List<string> ErreursDocument(JsonElement? styles)
    {
        if (styles is null or { ValueKind: JsonValueKind.Null }) return [];
        if (styles is not { ValueKind: JsonValueKind.Object } s) return ["STYLE_FORME"];
        return s.EnumerateObject()
            .SelectMany(c => ClassesStyleLigne.Toutes.Contains(c.Name) ? Erreurs(c.Value) : [$"STYLE_CLASSE:{c.Name}"]).ToList();
    }

    /// <summary>Classe de chaque ligne (null : type sans style de classe).</summary>
    public static Dictionary<long, string?> Classes<TLigne>(IReadOnlyCollection<TLigne> lignes) where TLigne : DocumentLigne
    {
        var parId = lignes.ToDictionary(l => l.LigId);
        List<DocumentLigne> Ancetres(DocumentLigne l)
        {
            var res = new List<DocumentLigne>();
            var p = l.LigParentId is long id && parId.TryGetValue(id, out var x) ? x : null;
            while (p is not null && res.Count <= lignes.Count)
            {
                res.Add(p);
                p = p.LigParentId is long pid && parId.TryGetValue(pid, out var y) ? y : null;
            }
            return res;
        }
        var classes = new Dictionary<long, string?>();
        foreach (var l in lignes)
        {
            classes[l.LigId] = l.LigTylId switch
            {
                TL.Titre => ClassesStyleLigne.Tranches[Math.Min(1 + Ancetres(l).Count(a => a.LigTylId == TL.Titre), 5) - 1],
                TL.Section => ClassesStyleLigne.Section,
                TL.Ouvrage => Ancetres(l).Any(a => a.LigTylId == TL.Ouvrage) ? ClassesStyleLigne.SousOuvrage : ClassesStyleLigne.Ouvrage,
                TL.Element => Ancetres(l).Any(a => a.LigTylId == TL.Ouvrage) ? ClassesStyleLigne.Composante : ClassesStyleLigne.Element,
                TL.Texte => ClassesStyleLigne.Texte,
                TL.SousTotal => ClassesStyleLigne.SousTotal,
                _ => null,
            };
        }
        return classes;
    }

    /// <summary>Style paramétré d'une classe pour un document : défaut (aucun), global, famille, type, document.</summary>
    public static StyleLigne DeClasse(string classe, ContexteStyles c)
    {
        var lignes = c.Styles.Where(s => s.Classe == classe).ToList();
        StyleLigne Niveau(Func<StyleParametre, bool> f) => Normaliser(lignes.FirstOrDefault(f)?.Valeur);
        var r = Niveau(s => s.Famille is null && s.Type is null);
        if (c.Famille is not null) r = r.Surcharger(Niveau(s => s.Type is null && s.Famille == c.Famille));
        if (c.Type is not null) r = r.Surcharger(Niveau(s => s.Famille is null && s.Type == c.Type));
        if (c.Document is { ValueKind: JsonValueKind.Object } d && d.TryGetProperty(classe, out var propre)) r = r.Surcharger(Normaliser(propre));
        return r;
    }

    /// <summary>Style résolu d'une ligne : style de sa classe, puis style propre de la ligne. Vide : rendu actuel.</summary>
    public static StyleLigne Ligne(DocumentLigne ligne, string? classe, ContexteStyles c) =>
        (classe is null ? new StyleLigne() : DeClasse(classe, c)).Surcharger(Normaliser(ligne.LigStyle?.RootElement));

    /// <summary>Styles résolus des lignes ayant un style.</summary>
    public static Dictionary<long, StyleLigne> Resolus<TLigne>(IReadOnlyCollection<TLigne> lignes, ContexteStyles c) where TLigne : DocumentLigne
    {
        var classes = Classes(lignes);
        var res = new Dictionary<long, StyleLigne>();
        foreach (var l in lignes)
        {
            var s = Ligne(l, classes[l.LigId], c);
            if (!s.EstVide) res[l.LigId] = s;
        }
        return res;
    }
}
