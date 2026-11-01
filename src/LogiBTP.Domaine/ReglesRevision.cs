using System.Globalization;
using LogiBTP.Socle;

namespace LogiBTP.Domaine;

/// <summary>Terme d'une formule de révision : index (BT01…) et poids.</summary>
public sealed record TermeRevision(string Index, decimal Poids);

/// <summary>
/// Formule de révision (CONCEPTION-REVISION-PRIX.md, Q2) : Cn = partie fixe + Σ poids × In / I0 ; coefficient arrondi à
/// <c>Precision</c> décimales, au plus proche (PROCHE) ou à la valeur supérieure (SUPERIEUR).
/// </summary>
public sealed record FormuleRevision(decimal PartieFixe, IReadOnlyList<TermeRevision> Termes, int Precision = 3, string Arrondi = ArrondiRevision.Proche);

/// <summary>Valeur mensuelle d'un index : mois (premier jour), valeur, provisoire, base de la série (raccordement).</summary>
public sealed record ValeurIndex(DateOnly Mois, decimal Valeur, bool Provisoire = false, string? Base = null);

/// <summary>Série d'un index : valeurs et coefficients de raccordement d'une ancienne base vers la base courante.</summary>
public sealed record SerieIndex(IReadOnlyList<ValeurIndex> Valeurs, IReadOnlyDictionary<string, decimal>? Raccordements = null);

/// <summary>Coefficient calculé : null s'il manque un index (manquants : « BT01 I0 », « BT01 In ») ; provisoire si un index l'est.</summary>
public sealed record CoefficientRevision(decimal? Coef, bool Provisoire, IReadOnlyList<string> Manquants, DateOnly? MoisIndex = null);

/// <summary>Paramètres de révision d'un marché (Q1, Q2, Q11).</summary>
public sealed record ParametresRevision(string TypePrix, DateOnly? MoisZero, FormuleRevision Formule, int Decalage = 0, DateOnly? DebutTravaux = null,
    bool ActualisationBaisse = false);

/// <summary>Période révisée (Q9) : base HT de la période, coefficient connu à ce jour, révision déjà facturée.</summary>
public sealed record PeriodeRevision(string Id, decimal Base, decimal? Coef, decimal Deja);

/// <summary>Révision due d'une période et reste à facturer (positif ou négatif : régularisation).</summary>
public sealed record RevisionPeriode(string Id, decimal Revision, decimal AFacturer);

/// <summary>Types de prix d'un marché.</summary>
public static class TypesPrix
{
    public const string Ferme = "FERME";
    public const string Actualisable = "ACTUALISABLE";
    public const string Revisable = "REVISABLE";

    public static readonly string[] Tous = [Ferme, Actualisable, Revisable];
}

/// <summary>Arrondi du coefficient de révision.</summary>
public static class ArrondiRevision
{
    public const string Proche = "PROCHE";
    public const string Superieur = "SUPERIEUR";
}

/// <summary>Erreurs d'une formule de révision.</summary>
public static class ErreursRevision
{
    public const string SansTerme = "REV_SANS_TERME";
    public const string Poids = "REV_POIDS";
    public const string PartieFixe = "REV_PARTIE_FIXE";
    public const string Somme = "REV_SOMME";
    public const string IndexDouble = "REV_INDEX_DOUBLE";
    public const string Precision = "REV_PRECISION";
    public const string Arrondi = "REV_ARRONDI";
}

/// <summary>
/// Révision et actualisation des prix des marchés par index (CONCEPTION-REVISION-PRIX.md, décisions du 31/10/2026),
/// répliquées dans client/src/app/structure/revision.js (jeu tests/revision/01_revision.json) : contrôle d'une formule,
/// mois de l'index d'une pièce, coefficient (I0 au mois zéro exact ; In au mois de l'index, sinon dernier connu avant,
/// alors provisoire ; valeurs d'une ancienne base raccordées ; rapports arrondis à 10 décimales), révision cumulée des
/// périodes et régularisation.
/// </summary>
public static class ReglesRevision
{
    private const int PrecisionRapport = 10;

    /// <summary>Erreurs d'une formule, dans l'ordre fixe des codes ; vide si elle est correcte.</summary>
    public static List<string> ControlerFormule(FormuleRevision f)
    {
        var e = new HashSet<string>();
        if (f.Termes.Count == 0) e.Add(ErreursRevision.SansTerme);
        if (f.Termes.Any(t => t.Poids <= 0)) e.Add(ErreursRevision.Poids);
        if (f.PartieFixe < 0 || f.PartieFixe >= 1) e.Add(ErreursRevision.PartieFixe);
        if (f.Termes.Count > 0 && f.PartieFixe + f.Termes.Sum(t => t.Poids) != 1) e.Add(ErreursRevision.Somme);
        if (f.Termes.GroupBy(t => t.Index.Trim().ToUpperInvariant()).Any(g => g.Count() > 1)) e.Add(ErreursRevision.IndexDouble);
        if (f.Precision is < 0 or > 6) e.Add(ErreursRevision.Precision);
        if (f.Arrondi is not (ArrondiRevision.Proche or ArrondiRevision.Superieur)) e.Add(ErreursRevision.Arrondi);
        string[] ordre = [ErreursRevision.SansTerme, ErreursRevision.Poids, ErreursRevision.PartieFixe, ErreursRevision.Somme, ErreursRevision.IndexDouble,
            ErreursRevision.Precision, ErreursRevision.Arrondi];
        return [.. ordre.Where(e.Contains)];
    }

    /// <summary>Premier jour du mois.</summary>
    public static DateOnly Mois(DateOnly d) => new(d.Year, d.Month, 1);

    /// <summary>
    /// Mois de l'index d'une pièce : révisable = mois de la pièce − décalage ; actualisable = début des travaux − 3 mois,
    /// seulement si le début est plus de trois mois après le mois zéro (sinon null : pas d'actualisation) ; ferme : null.
    /// </summary>
    public static DateOnly? MoisIndex(ParametresRevision p, DateOnly moisPiece)
    {
        if (p.TypePrix == TypesPrix.Revisable) return Mois(moisPiece).AddMonths(-p.Decalage);
        if (p.TypePrix != TypesPrix.Actualisable || p.MoisZero is not DateOnly zero || p.DebutTravaux is not DateOnly debut) return null;
        var m = Mois(debut).AddMonths(-3);
        return m > Mois(zero) ? m : null;
    }

    /// <summary>Valeur d'une série dans la base courante (raccordement d'une ancienne base).</summary>
    private static decimal Valeur(SerieIndex s, ValeurIndex v) =>
        v.Base is string b && s.Raccordements is { } r && r.TryGetValue(b, out var c) ? v.Valeur * c : v.Valeur;

    /// <summary>Coefficient d'une formule entre le mois zéro et le mois de l'index.</summary>
    public static CoefficientRevision Coefficient(FormuleRevision f, IReadOnlyDictionary<string, SerieIndex> series, DateOnly moisZero, DateOnly moisIndex)
    {
        var zero = Mois(moisZero);
        var n = Mois(moisIndex);
        var manquants = new List<string>();
        var provisoire = false;
        var coef = f.PartieFixe;
        foreach (var t in f.Termes)
        {
            var s = series.GetValueOrDefault(t.Index);
            var v0 = s?.Valeurs.FirstOrDefault(v => v.Mois == zero);
            var vn = s?.Valeurs.Where(v => v.Mois <= n).OrderByDescending(v => v.Mois).FirstOrDefault();
            if (v0 is null || Valeur(s!, v0) == 0) manquants.Add($"{t.Index} I0");
            if (vn is null) manquants.Add($"{t.Index} In");
            if (v0 is null || vn is null || Valeur(s!, v0) == 0) continue;
            provisoire |= v0.Provisoire || vn.Provisoire || vn.Mois != n;
            coef += t.Poids * ArrondiCalcul.Arrondir(Valeur(s!, vn) / Valeur(s!, v0), PrecisionRapport);
        }
        if (manquants.Count > 0) return new CoefficientRevision(null, provisoire, manquants, n);
        return new CoefficientRevision(Arrondir(coef, f.Precision, f.Arrondi), provisoire, manquants, n);
    }

    private static decimal Arrondir(decimal v, int precision, string mode)
    {
        if (mode != ArrondiRevision.Superieur) return ArrondiCalcul.Arrondir(v, precision);
        var facteur = (decimal)Math.Pow(10, precision);
        return Math.Ceiling(v * facteur) / facteur;
    }

    /// <summary>
    /// Coefficient d'une pièce du marché (mois de la pièce) : ferme ou mois zéro inconnu → null sans manquant (pas de
    /// révision) ; actualisable sans actualisation (début dans les trois mois) → 1 ; actualisation à la baisse écartée
    /// (coefficient &lt; 1 ramené à 1) sauf l'option.
    /// </summary>
    public static CoefficientRevision CoefficientPiece(ParametresRevision p, IReadOnlyDictionary<string, SerieIndex> series, DateOnly moisPiece)
    {
        if (p.TypePrix == TypesPrix.Ferme || p.MoisZero is not DateOnly zero) return new CoefficientRevision(null, false, []);
        if (MoisIndex(p, moisPiece) is not DateOnly mois)
        {
            return p.TypePrix == TypesPrix.Actualisable && p.DebutTravaux is not null ? new CoefficientRevision(1, false, []) : new CoefficientRevision(null, false, []);
        }
        var c = Coefficient(p.Formule, series, zero, mois);
        if (p.TypePrix == TypesPrix.Actualisable && !p.ActualisationBaisse && c.Coef is decimal x && x < 1) return c with { Coef = 1 };
        return c;
    }

    /// <summary>
    /// Révision cumulée (Q9) : révision due de chaque période = base × (coefficient − 1) arrondie au montant ; à facturer
    /// = due − déjà facturée ; une période sans coefficient garde le déjà facturé (rien à facturer).
    /// </summary>
    public static List<RevisionPeriode> Regulariser(IReadOnlyList<PeriodeRevision> periodes, int precision = 2) =>
        [.. periodes.Select(p =>
        {
            var due = p.Coef is decimal c ? ArrondiCalcul.Arrondir(p.Base * (c - 1), precision) : p.Deja;
            return new RevisionPeriode(p.Id, due, due - p.Deja);
        })];

    /// <summary>Mois « AAAA-MM » (jeux de cas, CSV).</summary>
    public static DateOnly LireMois(string s) => DateOnly.ParseExact(s.Length == 7 ? s + "-01" : s[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);
}
