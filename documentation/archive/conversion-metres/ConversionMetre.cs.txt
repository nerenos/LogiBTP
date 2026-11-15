using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LogiBTP.Socle;

namespace LogiBTP.Metres;

/// <summary>Métré converti : script, variable affectée du résultat, définitions devenues variables de ligne.</summary>
public sealed record MetreConverti(string MtrScript, string? MtrVariable, List<VariableDefinition> VariablesLigne);

/// <summary>Ancienne ligne de métré (table metre_ligne supprimée) : lue seulement pour la conversion.</summary>
public sealed class LigneMetreAncienne
{
    public long MliId { get; set; }
    public long MliMtrId { get; set; }
    public long? MliParentId { get; set; }
    public int MliOrdre { get; set; }
    /// <summary>V valeur, D sous-détail, S sous-total.</summary>
    public string MliType { get; set; } = "V";
    public string? MliOperateur { get; set; }
    public string? MliFormule { get; set; }
    public long? MliStDepuisId { get; set; }
    public string? MliVariable { get; set; }
    public string? MliCommentaire { get; set; }
}

/// <summary>
/// Conversion des métrés saisis en lignes (valeurs V, sous-détails D, sous-totaux S, onglet Définition) en scripts
/// (réplique de conversion.js : même texte produit). Reproduit l'évaluation des lignes : niveau le plus bas d'abord,
/// dans l'ordre des lignes ; dans un niveau, chaque ligne s'applique au cumul sans priorité mathématique (d'où les
/// parenthèses) ; chaque valeur de ligne est arrondie à 6 décimales (variable locale numérique).
/// </summary>
public static partial class ConversionMetre
{
    /// <summary>Colonnes calculées après la quantité : une définition qui les lit reste une variable de ligne.</summary>
    private static readonly HashSet<string> ColonnesApresQuantite = ["lig_qte_vendue", "lig_qte_totale", "lig_qte_base"];

    [GeneratedRegex(@"\s+")] private static partial Regex ReEspaces();

    private static string Commentaire(string? texte)
    {
        var t = ReEspaces().Replace(texte ?? "", " ").Trim();
        return t.Length > 0 ? $" // {t}" : "";
    }

    /// <summary>Ligne convertie en 0 (formule vide, sous-total pointé invalide) : commentaire d'avertissement.</summary>
    private static string Avertissement(LigneMetreAncienne x)
    {
        var c = Commentaire(x.MliCommentaire);
        var quoi = x.MliType == "S" ? "sous-total pointé invalide" : "formule vide";
        return $" // ⚠ {quoi} dans le métré d'origine{(c.Length > 0 ? $" – {c[4..]}" : "")}";
    }

    private static bool LitDonneeApresQuantite(string? formule)
    {
        try
        {
            return Expression.References(formule).Any(r => References.Analyser(r) is ReferenceDonnee d && ColonnesApresQuantite.Contains(d.Colonne));
        }
        catch (ErreurCalcul)
        {
            return false;
        }
    }

    /// <summary>Enchaînement des valeurs d'un niveau, de gauche à droite sans priorité : ((a + b) * c).</summary>
    private static string Enchainer(IEnumerable<LigneMetreAncienne> lignes, IReadOnlyDictionary<long, string> nom)
    {
        string? texte = null;
        var additif = false;
        foreach (var x in lignes)
        {
            var op = x.MliOperateur ?? "+";
            if (texte is null)
            {
                texte = op == "-" ? $"-{nom[x.MliId]}" : nom[x.MliId];
                continue;
            }
            if (op is "*" or "/")
            {
                texte = $"{(additif ? $"({texte})" : texte)} {op} {nom[x.MliId]}";
                additif = false;
            }
            else
            {
                texte = $"{texte} {op} {nom[x.MliId]}";
                additif = true;
            }
        }
        return texte ?? "0";
    }

    private sealed record Groupe(long? ParentId, List<LigneMetreAncienne> Liste, int Profondeur);
    private sealed record Instruction(string Nom, string Expr, string Commentaire, string? Variable);

    /// <summary>
    /// Convertit un métré en lignes. <paramref name="definitions"/> : variables de l'onglet Définition du métré.
    /// Les définitions sont reprises dans le script, sauf à partir de la première qui lit une quantité calculée
    /// (lig_qte_vendue…) : celle-ci et les suivantes deviennent des variables de ligne (VarMtrId null).
    /// </summary>
    public static MetreConverti Convertir(Metre metre, IEnumerable<LigneMetreAncienne> lignesMetre, IEnumerable<VariableDefinition> definitions)
    {
        var lignes = lignesMetre.Where(x => x.MliMtrId == metre.MtrId).ToList();
        var enfants = new Dictionary<long, List<LigneMetreAncienne>>();
        var racines = new List<LigneMetreAncienne>();
        foreach (var x in lignes)
        {
            if (x.MliParentId is not long p) { racines.Add(x); continue; }
            if (!enfants.TryGetValue(p, out var l)) enfants[p] = l = [];
            l.Add(x);
        }
        static List<LigneMetreAncienne> Trier(List<LigneMetreAncienne> l) => l.OrderBy(x => x.MliOrdre).ThenBy(x => x.MliId).ToList();
        List<LigneMetreAncienne> EnfantsDe(long? p) => p is long id ? Trier(enfants.GetValueOrDefault(id) ?? []) : Trier(racines);

        // Noms : position dans l'arbre (L1, L2_1…) ; groupes en ordre préfixe avec leur profondeur.
        var nom = new Dictionary<long, string>();
        var groupes = new List<Groupe>();
        void Parcourir(long? parentId, string prefixe, int profondeur)
        {
            var liste = EnfantsDe(parentId);
            if (parentId is null || liste.Count > 0) groupes.Add(new Groupe(parentId, liste, profondeur));
            for (var k = 0; k < liste.Count; k++)
            {
                var n = $"{prefixe}{k + 1}";
                nom[liste[k].MliId] = n;
                Parcourir(liste[k].MliId, $"{n}_", profondeur + 1);
            }
        }
        Parcourir(null, "L", 1);

        var defs = definitions.OrderBy(d => d.VarOrdre).ThenBy(d => d.VarId).ToList();
        var kq = defs.FindIndex(d => LitDonneeApresQuantite(d.VarFormule));
        var enScript = kq < 0 ? defs : defs[..kq];
        var variablesLigne = (kq < 0 ? [] : defs[kq..]).Select(d =>
        {
            var c = JsonCalcul.Cloner(d);
            c.VarMtrId = null;
            c.VarLigId = metre.MtrLigId;
            return c;
        }).ToList();

        var instructions = new List<Instruction>();
        var resultatGroupe = new Dictionary<long, string>();
        var profondeurMax = groupes.Max(g => g.Profondeur);
        var racine = "0";
        for (var p = profondeurMax; p >= 1; p--)
        {
            foreach (var g in groupes.Where(g => g.Profondeur == p))
            {
                for (var i = 0; i < g.Liste.Count; i++)
                {
                    var x = g.Liste[i];
                    string? expr;
                    if (x.MliType == "S")
                    {
                        var depuis = 0;
                        if (x.MliStDepuisId is long sd)
                        {
                            var j = g.Liste.FindIndex(y => y.MliId == sd);
                            depuis = j < 0 || j >= i || g.Liste[j].MliType != "S" ? -1 : j + 1;
                        }
                        expr = depuis < 0 ? null : Enchainer(g.Liste[depuis..i].Where(y => y.MliType != "S"), nom);
                    }
                    else if (x.MliType == "D") expr = resultatGroupe.GetValueOrDefault(x.MliId) ?? "0";
                    else expr = string.IsNullOrWhiteSpace(x.MliFormule) ? null : x.MliFormule.Trim();
                    instructions.Add(new Instruction(
                        nom[x.MliId],
                        expr ?? "0",
                        expr is null ? Avertissement(x) : Commentaire(x.MliCommentaire),
                        string.IsNullOrWhiteSpace(x.MliVariable) ? null : x.MliVariable.Trim()));
                }
                var r = Enchainer(g.Liste.Where(y => y.MliType != "S"), nom);
                if (g.ParentId is long pid) resultatGroupe[pid] = r;
                else racine = r;
            }
        }

        var avecDefinitions = enScript.Count > 0;
        var affectations = avecDefinitions || instructions.Any(x => x.Variable is not null);
        var texte = new List<string> { "// Métré converti depuis la saisie en lignes (valeurs, sous-détails, sous-totaux)." };
        if (!affectations)
        {
            foreach (var x in instructions) texte.Add($"local {x.Nom} est un numérique = {x.Expr}{x.Commentaire}");
            texte.Add($"Renvoyer {racine}");
            return new MetreConverti(string.Join("\n", texte), metre.MtrVariable, variablesLigne);
        }
        foreach (var x in instructions) texte.Add($"local {x.Nom} est un numérique");
        if (avecDefinitions) texte.Add("local Resultat est un numérique");
        texte.Add("");
        foreach (var x in instructions)
        {
            texte.Add($"{x.Nom} = {x.Expr}{x.Commentaire}");
            if (x.Variable is not null) texte.Add($"{x.Variable} = {x.Nom}");
        }
        if (!avecDefinitions)
        {
            texte.Add($"Renvoyer {racine}");
            return new MetreConverti(string.Join("\n", texte), metre.MtrVariable, variablesLigne);
        }
        // Définitions : évaluées après le résultat (affecté d'abord à la variable du métré).
        texte.Add($"Resultat = {racine}");
        if (!string.IsNullOrEmpty(metre.MtrVariable)) texte.Add($"{metre.MtrVariable.Trim()} = Resultat");
        texte.Add("");
        texte.Add("// Variables définies par le métré");
        foreach (var d in enScript)
        {
            var f = string.IsNullOrWhiteSpace(d.VarFormule) ? "0" : d.VarFormule.Trim();
            texte.Add($"{d.VarPortee}{d.VarNom} {d.VarOperation ?? "="} {f}");
        }
        texte.Add("Renvoyer Resultat");
        return new MetreConverti(string.Join("\n", texte), null, variablesLigne);
    }

    /// <summary>
    /// Convertit les métrés en lignes d'un contenu (document, composition d'ouvrage) : métrés avec leur script,
    /// variables sans les définitions reprises dans les scripts. Les métrés déjà en script sont inchangés.
    /// </summary>
    public static (List<Metre> Metres, List<VariableDefinition> Variables) ConvertirContenu(
        IEnumerable<Metre> metres, IReadOnlyCollection<LigneMetreAncienne> lignes, IReadOnlyCollection<VariableDefinition> variables)
    {
        var liste = metres.ToList();
        var aConvertir = liste.Where(m => m.MtrScript is null).Select(m => m.MtrId).ToHashSet();
        var ajoutees = new List<VariableDefinition>();
        foreach (var m in liste.Where(m => aConvertir.Contains(m.MtrId)))
        {
            var c = Convertir(m, lignes, variables.Where(v => v.VarMtrId == m.MtrId));
            m.MtrScript = c.MtrScript;
            m.MtrVariable = c.MtrVariable;
            ajoutees.AddRange(c.VariablesLigne);
        }
        return (liste, [.. variables.Where(v => v.VarMtrId is not long id || !aConvertir.Contains(id)), .. ajoutees]);
    }

    /// <summary>
    /// Contenu JSON { …, metres, metre_lignes, variables } (composition d'ouvrage ou d'ensemble) : métrés en scripts,
    /// sans metre_lignes ; les autres propriétés sont conservées.
    /// </summary>
    public static string ConvertirComposition(string json)
    {
        var c = JsonNode.Parse(json)!.AsObject();
        var metres = c["metres"]?.Deserialize<List<Metre>>(JsonCalcul.Options) ?? [];
        var lignes = c["metre_lignes"]?.Deserialize<List<LigneMetreAncienne>>(JsonCalcul.Options) ?? [];
        var variables = c["variables"]?.Deserialize<List<VariableDefinition>>(JsonCalcul.Options) ?? [];
        var (m, v) = ConvertirContenu(metres, lignes, variables);
        c["metres"] = JsonSerializer.SerializeToNode(m, JsonCalcul.Options);
        c["variables"] = JsonSerializer.SerializeToNode(v, JsonCalcul.Options);
        c.Remove("metre_lignes");
        return c.ToJsonString();
    }
}
