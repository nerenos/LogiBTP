using System.Globalization;
using LogiBTP.Socle;

namespace LogiBTP.Bibliotheque;

/// <summary>Correspondance d'une unité : quantité en unité de stock pour 1 unité, par formule ({{donnée technique}}).</summary>
public sealed class UniteElement
{
    public string Unite { get; set; } = "";
    public string? Formule { get; set; }
}

public sealed class TarifCalcul
{
    public decimal Prix { get; set; }
    /// <summary>Prix public et remises en % (lot 8) : le prix net du tarif est le prix public remisé.</summary>
    public decimal? PrixPublic { get; set; }
    public decimal? Remise1 { get; set; }
    public decimal? Remise2 { get; set; }
    public string Unite { get; set; } = "";
    public bool Principal { get; set; }
    public string? Debut { get; set; }
    public string? Fin { get; set; }
}

/// <summary>Entrée du calcul (mêmes noms que calcul.js, en snake_case dans le jeu partagé).</summary>
public sealed class EntreeElement
{
    public string UniteStock { get; set; } = "";
    public List<UniteElement> Unites { get; set; } = [];
    public Dictionary<string, decimal?> Donnees { get; set; } = [];
    public string? Scenario { get; set; }
    public decimal? PaFixe { get; set; }
    public decimal? DernierPa { get; set; }
    public decimal? Pmp { get; set; }
    public List<TarifCalcul> Tarifs { get; set; } = [];
    public decimal? CoefFg { get; set; }
    public decimal? CoefBenef { get; set; }
    public decimal? Pv { get; set; }
    public bool PvFixe { get; set; }
    public decimal? CoefRemise { get; set; }
}

public sealed record PrixUnite(string Unite, decimal? Ratio, decimal? Pa, decimal? Pr, decimal? PvNet, string? Erreur = null);

public sealed record ResultatElement(decimal? Pa, decimal? Pr, decimal? Pv, decimal? CoefBenef, decimal? PvNet, List<PrixUnite> PrixUnites, List<string> Alertes);

/// <summary>
/// Prix et unités d'un élément : même calcul que calcul.js (jeu partagé modules/bibliotheque/tests/cas/01_calcul.json).
/// PA selon le scénario (tarifs convertis en unité de stock : prix / ratio), PR = PA × FG, PV = PR × bénéfice (ou PV fixe,
/// coefficient déduit), PV net = PV × remise ; 6 décimales, arrondi commercial.
/// </summary>
public static class CalculElement
{
    public static readonly string[] Scenarios = ["FIXE", "FOURNISSEUR_PRINCIPAL", "DERNIER_PA", "MEILLEUR_MIN", "MEILLEUR_MAX", "PMP"];
    public static readonly string[] Gestions = [GestionElement.Stock, GestionElement.Achat, GestionElement.SousTraitance, GestionElement.NonGere];

    private static decimal Arr6(decimal v) => ArrondiCalcul.Arr6(v);

    /// <summary>Quantité en unité de stock pour 1 unité ; ErreurCalcul UNITE, DONNEE ou RATIO.</summary>
    public static decimal Ratio(string? unite, EntreeElement e)
    {
        if (string.IsNullOrEmpty(unite) || unite == e.UniteStock) return 1m;
        var u = e.Unites.FirstOrDefault(x => x.Unite == unite)
            ?? throw new ErreurCalcul("UNITE", $"Unité {unite} sans correspondance avec l'unité de stock {e.UniteStock}");
        var r = Expression.Evaluer(u.Formule ?? "", reference =>
            e.Donnees.TryGetValue(reference, out var v) && v is { } d ? d : throw new ErreurCalcul("DONNEE", $"Donnée technique {reference} non renseignée"));
        if (r <= 0) throw new ErreurCalcul("RATIO", $"Correspondance {unite} nulle ou négative");
        return r;
    }

    /// <summary>Prix net d'un tarif : prix public × (1 − remise 1 %) × (1 − remise 2 %), arrondi à 6 décimales, sinon le prix saisi.</summary>
    public static decimal PrixNetTarif(TarifCalcul t) =>
        t.PrixPublic is { } p ? Arr6(p * (1 - (t.Remise1 ?? 0) / 100) * (1 - (t.Remise2 ?? 0) / 100)) : t.Prix;

    private static bool EnVigueur(TarifCalcul t, string date) =>
        (string.IsNullOrEmpty(t.Debut) || string.CompareOrdinal(t.Debut[..10], date) <= 0)
        && (string.IsNullOrEmpty(t.Fin) || string.CompareOrdinal(t.Fin[..10], date) >= 0);

    public static (decimal? Pa, List<string> Alertes) PrixAchat(EntreeElement e, string date)
    {
        var alertes = new List<string>();
        decimal? ParStock(TarifCalcul t)
        {
            try { return PrixNetTarif(t) / Ratio(t.Unite, e); }
            catch (ErreurCalcul x) { alertes.Add(x.Code); return null; }
        }
        var tarifs = e.Tarifs.Where(t => EnVigueur(t, date)).ToList();
        decimal? pa = (e.Scenario ?? "FIXE") switch
        {
            "FIXE" => e.PaFixe,
            "DERNIER_PA" => e.DernierPa,
            "PMP" => e.Pmp,
            "FOURNISSEUR_PRINCIPAL" => tarifs.FirstOrDefault(t => t.Principal) is { } p ? ParStock(p) : null,
            "MEILLEUR_MIN" => tarifs.Select(ParStock).Where(x => x is not null).Min(),
            "MEILLEUR_MAX" => tarifs.Select(ParStock).Where(x => x is not null).Max(),
            _ => throw new ErreurCalcul("SCENARIO", $"Scénario de prix d'achat inconnu : {e.Scenario}"),
        };
        if (pa is null) alertes.Add("PA_INDISPONIBLE");
        return (pa is null ? null : Arr6(pa.Value), alertes);
    }

    public static ResultatElement Calculer(EntreeElement e, string? date = null)
    {
        date ??= DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var (pa, alertes) = PrixAchat(e, date);
        var coefFg = e.CoefFg ?? 1m;
        var coefBenef = e.CoefBenef ?? 1m;
        decimal? pr = pa is { } a ? Arr6(a * coefFg) : null;
        decimal? pv;
        if (e.PvFixe)
        {
            pv = e.Pv is { } p ? Arr6(p) : null;
            if (pv is { } v && pr is { } r && r != 0) coefBenef = Arr6(v / r);
        }
        else pv = pr is { } r ? Arr6(r * coefBenef) : null;
        decimal? pvNet = pv is { } brut ? Arr6(brut * (e.CoefRemise ?? 1m)) : null;

        var prixUnites = new List<PrixUnite>();
        foreach (var unite in new[] { e.UniteStock }.Concat(e.Unites.Select(u => u.Unite)))
        {
            if (string.IsNullOrEmpty(unite) || prixUnites.Any(p => p.Unite == unite)) continue;
            try
            {
                var r = Ratio(unite, e);
                decimal? Fois(decimal? v) => v is { } d ? Arr6(d * r) : null;
                prixUnites.Add(new PrixUnite(unite, Arr6(r), Fois(pa), Fois(pr), Fois(pvNet)));
            }
            catch (ErreurCalcul x)
            {
                prixUnites.Add(new PrixUnite(unite, null, null, null, null, x.Code));
                if (!alertes.Contains(x.Code)) alertes.Add(x.Code);
            }
        }
        return new ResultatElement(pa, pr, pv, coefBenef, pvNet, prixUnites, alertes);
    }

    /// <summary>Quantité convertie d'une unité à l'autre en passant par l'unité de stock.</summary>
    public static decimal Convertir(decimal quantite, string de, string vers, EntreeElement e) => quantite * Ratio(de, e) / Ratio(vers, e);

    /// <summary>Code d'appel : le code seul dans la même bibliothèque, sinon « BIB:CODE ».</summary>
    public static string CodeAppel(string bibCode, string code, string? bibliothequeCourante) =>
        bibCode != bibliothequeCourante ? $"{bibCode}:{code}" : code;

    public static (string? Bibliotheque, string Code) AnalyserCodeAppel(string saisie, string? bibliothequeParDefaut)
    {
        var s = saisie.Trim();
        var i = s.IndexOf(':');
        return i > 0 ? (s[..i].ToUpperInvariant(), s[(i + 1)..].Trim()) : (bibliothequeParDefaut, s);
    }
}
