using System.Text;
using LogiBTP.Socle;

namespace LogiBTP.Import.Reprise;

/// <summary>Unité de la base cible, forme neutre : code, libellé, synonymes paramétrés.</summary>
public sealed record UniteCible(string Code, string Libelle, IReadOnlyList<string> Synonymes);

/// <summary>Taux de TVA de la base cible, forme neutre : identifiant, taux en %, catégorie (N, A, I, E).</summary>
public sealed record TauxCible(long Id, decimal Taux, string Categorie);

/// <summary>Option d'une liste de la base cible (mode de règlement, nature…) : code et libellé.</summary>
public sealed record OptionCible(string Code, string Libelle);

/// <summary>
/// Rapprochement des valeurs d'une base source avec les référentiels de la base cible (plan reprise-mde-optim, lot 4) :
/// réplique de <c>associerUnite</c>, <c>associerTaux</c> et <c>associerOption</c> (js/src/correspondances.js), jeu
/// partagé js/test/associations-cas.json.
/// </summary>
public static class Associations
{
    /// <summary>Catégorie de TVA normale (comportement du calcul).</summary>
    public const string CategorieNormale = "N";

    private static readonly (string Cible, string[] Synonymes)[] SynonymesUnite =
    [
        ("M2", ["M²", "MCARRE", "MQ"]), ("M3", ["M³", "MCUBE"]), ("ML", ["MLIN", "METRELINEAIRE"]), ("U", ["UNITE", "UN", "P", "PIECE"]),
        ("FT", ["FORFAIT", "FF", "FFT", "FORF"]), ("ENS", ["ENSEMBLE"]), ("H", ["HEURE", "HR"]), ("J", ["JOUR", "JR"]), ("T", ["TONNE", "TN"]),
        ("KG", ["KILO"]), ("L", ["LITRE", "LT"]), ("PCE", ["PC", "PCS"]), ("SEM", ["SEMAINE"]), ("MOIS", ["MS"]),
    ];

    /// <summary>Texte comparable : sans accents, majuscules, lettres et chiffres seulement.</summary>
    public static string Normaliser(string? texte)
    {
        var b = new StringBuilder();
        foreach (var c in SansAccent.Retirer(texte).ToUpperInvariant())
            if (c is >= 'A' and <= 'Z' or >= '0' and <= '9') b.Append(c);
        return b.ToString();
    }

    private static string CleUnite(string? s) => Normaliser((s ?? "").Replace('²', '2').Replace('³', '3'));

    /// <summary>Code de l'unité cible : code, libellé ou synonyme paramétré égal, puis synonymes du module ; null si inconnue.</summary>
    public static string? Unite(string? valeur, IReadOnlyList<UniteCible> unites)
    {
        var v = CleUnite(valeur);
        if (v.Length == 0) return null;
        var direct = unites.FirstOrDefault(u => Normaliser(u.Code) == v || Normaliser(u.Libelle) == v || u.Synonymes.Any(s => CleUnite(s) == v));
        if (direct is not null) return direct.Code;
        foreach (var (cible, synonymes) in SynonymesUnite)
            if (synonymes.Select(Normaliser).Contains(v))
                return unites.FirstOrDefault(u => Normaliser(u.Code) == cible)?.Code;
        return null;
    }

    /// <summary>
    /// Taux cible d'un pourcentage : taux égal, de la catégorie demandée si elle est fournie (sinon normale en priorité) ;
    /// null si aucun.
    /// </summary>
    public static long? Taux(decimal? pourcentage, IReadOnlyList<TauxCible> taux, string? categorie = null)
    {
        if (pourcentage is not { } p) return null;
        var egaux = taux.Where(t => Math.Abs(t.Taux - p) < 0.0001m).ToList();
        if (categorie is not null) return egaux.FirstOrDefault(t => t.Categorie == categorie)?.Id;
        return (egaux.FirstOrDefault(t => t.Categorie == CategorieNormale) ?? egaux.FirstOrDefault())?.Id;
    }

    /// <summary>Option d'une liste pour une valeur (code, libellé) : égalité du code ou du libellé, puis préfixe.</summary>
    public static string? Option(string? code, string? libelle, IReadOnlyList<OptionCible> options)
    {
        var vs = new[] { code, libelle }.Select(Normaliser).Where(v => v.Length > 0).ToList();
        if (vs.Count == 0) return null;
        foreach (var o in options)
            if (vs.Contains(Normaliser(o.Code)) || vs.Contains(Normaliser(o.Libelle))) return o.Code;
        foreach (var o in options)
        {
            string c = Normaliser(o.Code), l = Normaliser(o.Libelle);
            if (vs.Any(v => (c.Length > 0 && v.StartsWith(c, StringComparison.Ordinal)) || (l.Length > 0 && v.StartsWith(l, StringComparison.Ordinal))))
                return o.Code;
        }
        return null;
    }

    /// <summary>
    /// Code libre dans une liste de codes pris : le code souhaité (tronqué à <paramref name="longueur"/>) s'il est libre,
    /// sinon suffixé « _2 », « _3 »… (collision signalée par l'appelant, analyse § 5.4).
    /// </summary>
    public static string CodeLibre(string souhaite, int longueur, Func<string, bool> pris)
    {
        var base_ = souhaite.Length > longueur ? souhaite[..longueur] : souhaite;
        if (!pris(base_)) return base_;
        for (var i = 2; ; i++)
        {
            var suffixe = "_" + i;
            var c = (base_.Length + suffixe.Length > longueur ? base_[..(longueur - suffixe.Length)] : base_) + suffixe;
            if (!pris(c)) return c;
        }
    }
}
