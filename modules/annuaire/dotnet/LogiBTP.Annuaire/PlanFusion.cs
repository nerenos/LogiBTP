using System.Globalization;
using System.Text.RegularExpressions;

namespace LogiBTP.Annuaire;

/// <summary>Plan de fusion : colonnes à écrire sur la cible (celles qui changent), relations, champs supplémentaires, conflits.</summary>
public sealed record ResultatFusion(IReadOnlyDictionary<string, object?> Valeurs, IReadOnlyList<string> Casquettes,
    IReadOnlyDictionary<string, object?> Proprietes, IReadOnlyList<string> Conflits);

/// <summary>
/// Fusion d'une personne (tiers provisoire) dans une autre : valeurs retenues champ par champ. Réplique de fusion.js
/// (jeu tests/cas/04_fusion.json). Pour chaque colonne : la valeur choisie (« source » ou « cible »), sinon celle de
/// la cible, ou celle de la source quand la cible est vide (null, texte vide ; un booléen n'est jamais vide). Conflit :
/// les deux renseignées et différentes (comparaison sur le texte, nombres sans zéros inutiles). Relations : union dans
/// l'ordre de la cible ; champs supplémentaires : même règle par clé (choix « +clé »).
/// </summary>
public static partial class PlanFusion
{
    /// <summary>Colonnes jamais fusionnées : identité de la fiche, hiérarchie, statut provisoire, dates techniques.</summary>
    public static readonly IReadOnlySet<string> ColonnesNonFusionnees = new HashSet<string>(StringComparer.Ordinal)
    {
        "per_id", "per_code", "per_parent_id", "per_casquettes", "per_proprietes", "per_societe_base", "per_cree_le", "per_modifie_le",
        "per_provisoire", "per_provisoire_par", "per_provisoire_le", "per_valide_par", "per_valide_le",
    };

    [GeneratedRegex(@"^-?\d+(\.\d+)?$")]
    private static partial Regex Nombre();

    /// <summary>Texte de comparaison d'une valeur : nombres sans zéros inutiles, booléens en true / false, dates ISO.</summary>
    public static string Texte(object? v)
    {
        var t = v switch
        {
            null => "",
            bool b => b ? "true" : "false",
            DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => v.ToString() ?? "",
        };
        t = t.Trim();
        return Nombre().IsMatch(t) && t.Contains('.') ? t.TrimEnd('0').TrimEnd('.') : t;
    }

    private static bool Vide(object? v) => v is not bool && Texte(v).Length == 0;

    private static object? Choisir(string cle, object? s, object? k, IReadOnlyDictionary<string, string> choix, List<string> conflits)
    {
        if (!Vide(s) && !Vide(k) && Texte(s) != Texte(k)) conflits.Add(cle);
        return choix.GetValueOrDefault(cle) switch
        {
            "source" => s,
            "cible" => k,
            _ => Vide(k) ? s : k,
        };
    }

    public static ResultatFusion Calculer(IReadOnlyDictionary<string, object?> source, IReadOnlyDictionary<string, object?> cible,
        IReadOnlyList<string> casquettesSource, IReadOnlyList<string> casquettesCible,
        IReadOnlyDictionary<string, object?> proprietesSource, IReadOnlyDictionary<string, object?> proprietesCible,
        IReadOnlyDictionary<string, string>? choix = null)
    {
        choix ??= new Dictionary<string, string>();
        var conflits = new List<string>();
        var valeurs = new Dictionary<string, object?>(StringComparer.Ordinal);
        var colonnes = cible.Keys.Concat(source.Keys).Distinct()
            .Where(c => c.StartsWith("per_", StringComparison.Ordinal) && !ColonnesNonFusionnees.Contains(c)).Order(StringComparer.Ordinal);
        foreach (var c in colonnes)
        {
            var k = cible.GetValueOrDefault(c);
            var v = Choisir(c, source.GetValueOrDefault(c), k, choix, conflits);
            if (Texte(v) != Texte(k) || (v is bool b && !Equals(b, k))) valeurs[c] = v;
        }
        var proprietes = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var cle in proprietesCible.Keys.Concat(proprietesSource.Keys).Distinct().Order(StringComparer.Ordinal))
        {
            var v = Choisir("+" + cle, proprietesSource.GetValueOrDefault(cle), proprietesCible.GetValueOrDefault(cle), choix, conflits);
            if (v is not null) proprietes[cle] = v;
        }
        var casquettes = casquettesCible.ToList();
        foreach (var c in casquettesSource) if (!casquettes.Contains(c)) casquettes.Add(c);
        return new(valeurs, casquettes, proprietes, conflits);
    }

    /// <summary>Mots sans portée pour repérer un doublon de nom (formes juridiques, articles), en minuscules.</summary>
    public static readonly IReadOnlySet<string> MotsIgnoresDoublon = new HashSet<string>(StringComparer.Ordinal)
    {
        "sa", "sas", "sasu", "sarl", "eurl", "sci", "snc", "scop", "selarl", "gie", "ei", "eirl", "scp",
        "societe", "société", "ets", "etablissements", "établissements", "entreprise", "groupe",
        "et", "de", "des", "du", "la", "le", "les", "l", "d", "the", "and",
    };

    /// <summary>
    /// Mots d'un nom comparés pour repérer un doublon (réplique de motsDoublon) : séparés par tout ce qui n'est ni lettre
    /// ni chiffre, en minuscules, sans formes juridiques ni articles, d'au moins deux caractères.
    /// </summary>
    public static IReadOnlyList<string> MotsDoublon(string? nom)
    {
        var mots = new List<string>();
        var courant = new System.Text.StringBuilder();
        void Fin()
        {
            var m = courant.ToString();
            courant.Clear();
            if (m.Length >= 2 && !MotsIgnoresDoublon.Contains(m)) mots.Add(m);
        }
        foreach (var c in (nom ?? "").ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c)) courant.Append(c); else Fin();
        }
        Fin();
        return mots;
    }
}
