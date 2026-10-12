using System.Globalization;
using System.Text.Json;
using LogiBTP.Bibliotheque;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Calcul;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Composition d'un ouvrage de bibliothèque (colonne ele_composition) : lignes au format des documents et métrés.</summary>
public sealed class CompositionOuvrage
{
    public string Mode { get; set; } = "V";
    public List<DocumentLigneBtp> Lignes { get; set; } = [];
    public List<Metre> Metres { get; set; } = [];
    public List<MetreLigne> MetreLignes { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
}

/// <summary>
/// Éléments de bibliothèque côté cœur : prix d'un article (module Bibliothèque, tarifs et scénario de PA) ou d'un ouvrage
/// (moteur de devis BTP sur sa composition), libellé brut, unicité du code. Répliques de bibliotheque.js
/// (calculerOuvrage) et de FournisseurBibliothequeMemoire.apresEcriture.
/// </summary>
public static class ElementsBibliotheque
{
    private const int TypeOuvrage = 2; // type_ligne OUVRAGE (db/110)

    private static readonly JsonDocument FormatNumerotation =
        JsonDocument.Parse("""{"separateur":".","niveaux":[{"style":"1"},{"style":"1"},{"style":"1"}]}""");

    public static decimal? Decimal(object? v) => v switch
    {
        null => null,
        decimal d => d,
        string s when decimal.TryParse(s.Replace(',', '.').Replace(" ", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) => d,
        IConvertible c and not string => Convert.ToDecimal(c, CultureInfo.InvariantCulture),
        _ => null,
    };

    private static string? Texte(object? v) => v switch { null => null, string s => s, JsonElement j => j.GetRawText(), _ => Convert.ToString(v, CultureInfo.InvariantCulture) };

    private static JsonElement Json(object? v, string defaut)
    {
        var t = Texte(v);
        try { return JsonDocument.Parse(string.IsNullOrWhiteSpace(t) ? defaut : t).RootElement.Clone(); }
        catch (JsonException) { return JsonDocument.Parse(defaut).RootElement.Clone(); }
    }

    /// <summary>Recalcul d'un ouvrage enregistré (coefficients d'une période modifiés) : prix de sa composition.</summary>
    public static void RecalculerOuvrage(Element e)
    {
        var (pa, pr, pv, pvNet) = CalculerOuvrage(e.EleComposition?.RootElement.GetRawText(), e.EleCoefFg, e.EleCoefBenef, e.EleCoefRemise);
        e.ElePa = pa; e.ElePr = pr; e.ElePv = pv; e.ElePvNet = pvNet;
    }

    /// <summary>Prix d'un ouvrage par unité : racine à quantité 1, coefficients de l'élément (mode déboursé).</summary>
    public static (decimal? Pa, decimal? Pr, decimal? Pv, decimal? PvNet) CalculerOuvrage(string? compositionJson, decimal coefFg, decimal coefBenef, decimal coefRemise)
    {
        if (string.IsNullOrWhiteSpace(compositionJson)) return (null, null, null, null);
        var c = JsonSerializer.Deserialize<CompositionOuvrage>(compositionJson, JsonCalcul.Options) ?? new CompositionOuvrage();
        var racine = c.Lignes.FirstOrDefault(l => l.LigParentId is null && l.LigTylId == TypeOuvrage);
        if (racine is null) return (null, null, null, null);
        racine.LigQte = 1;
        racine.LigCoefFg = coefFg;
        racine.LigCoefBenef = coefBenef;
        var r = MoteurDevisBtp.Calculer(new EntreeCalcul
        {
            Document = new DocumentBtp { EntModeCalculOuvrage = c.Mode, EntPrecisionMontant = 2, EntNumFormat = FormatNumerotation },
            Lignes = c.Lignes, Metres = c.Metres, MetreLignes = c.MetreLignes, Variables = c.Variables,
        });
        var x = r.Lignes.First(l => l.LigId == racine.LigId);
        var pv = ArrondiCalcul.Arr6(x.LigPv ?? 0);
        return (ArrondiCalcul.Arr6(x.LigMontantPa ?? 0), ArrondiCalcul.Arr6(x.LigPr ?? 0), pv, ArrondiCalcul.Arr6(pv * coefRemise));
    }

    private static string? S(decimal? d) => d?.ToString(CultureInfo.InvariantCulture);

    /// <summary>Données des formules d'unités : champs supplémentaires puis données techniques de la fiche.</summary>
    private static Dictionary<string, decimal?> Donnees(IReadOnlyDictionary<string, object?> v, IReadOnlyDictionary<string, object?> proprietes)
    {
        var r = proprietes.ToDictionary(kv => kv.Key, kv => Decimal(kv.Value));
        foreach (var code in ServiceBibliotheque.CodesTechniques) if (Decimal(v.GetValueOrDefault(code)) is { } d) r[code] = d;
        return r;
    }

    /// <summary>
    /// Avant écriture d'un élément : contrôles (code unique dans la bibliothèque, ouvrage composé), libellé brut, auteur,
    /// prix recalculés (écrits dans aEcrire ; l'historique est alimenté par le trigger de la table).
    /// </summary>
    public static async Task AvantEcriture(IServiceProvider services, string? id, Dictionary<string, string?> aEcrire,
        IReadOnlyDictionary<string, object?> v, IReadOnlyDictionary<string, object?> proprietes, Utilisateur u, CancellationToken ct)
    {
        var db = services.GetRequiredService<BibliothequeDbContext>();
        var bib = (int?)Decimal(v.GetValueOrDefault("bib_id"));
        var code = Texte(v.GetValueOrDefault("code"))?.Trim();
        long? eleId = id is null ? null : long.Parse(id, CultureInfo.InvariantCulture);
        if (bib is not null && code is not null
            && await db.Elements.AnyAsync(e => e.EleBibId == bib && e.EleCode == code && (eleId == null || e.EleId != eleId), ct))
            throw ExceptionMetier.Invalide("CODE_EXISTANT", $"Le code {code} existe déjà dans cette bibliothèque");

        aEcrire["libelle"] = Libelles.TexteBrut(Texte(v.GetValueOrDefault("libelle_html")));
        aEcrire["maj_par"] = u.Code;
        // Coefficients effectifs : imposés, sinon ceux de la nature ou globaux en vigueur, sinon par défaut.
        bool Vrai(string code) => v.GetValueOrDefault(code) is true or "true";
        var pvFixe = Vrai("pv_fixe");
        var c = await services.GetRequiredService<ServiceBibliotheque>().Coefficients((int?)Decimal(v.GetValueOrDefault("nat_id")),
            Decimal(v.GetValueOrDefault("coef_fg")), Vrai("coef_fg_impose"), Decimal(v.GetValueOrDefault("coef_benef")), Vrai("coef_benef_impose") || pvFixe, ct);
        var coefFg = c.CoefFg;
        var coefBenef = c.CoefBenef;
        aEcrire["coef_fg"] = S(coefFg);
        aEcrire["coef_benef"] = S(coefBenef);
        var coefRemise = Decimal(v.GetValueOrDefault("coef_remise")) ?? 1;

        if (Texte(v.GetValueOrDefault("type")) == "OUVRAGE")
        {
            var (pa, pr, pv, pvNet) = CalculerOuvrage(Texte(v.GetValueOrDefault("composition")), coefFg, coefBenef, coefRemise);
            aEcrire["pa"] = S(pa); aEcrire["pr"] = S(pr); aEcrire["pv"] = S(pv); aEcrire["pv_net"] = S(pvNet);
            return;
        }
        var tarifs = eleId is { } e2 ? await services.GetRequiredService<ServiceBibliotheque>().TarifsCalcul(e2, ct) : [];
        var r = CalculElement.Calculer(new EntreeElement
        {
            UniteStock = Texte(v.GetValueOrDefault("unite_stock")) ?? "",
            Unites = ServiceBibliotheque.Unites(Json(v.GetValueOrDefault("unites"), "[]")),
            Donnees = Donnees(v, proprietes),
            Scenario = Texte(v.GetValueOrDefault("scenario_pa")), PaFixe = Decimal(v.GetValueOrDefault("pa_fixe")),
            DernierPa = Decimal(v.GetValueOrDefault("dernier_pa")), Pmp = Decimal(v.GetValueOrDefault("pmp")), Tarifs = tarifs,
            CoefFg = coefFg, CoefBenef = coefBenef, Pv = Decimal(v.GetValueOrDefault("pv")),
            PvFixe = pvFixe, CoefRemise = coefRemise,
        });
        aEcrire["pa"] = S(r.Pa); aEcrire["pr"] = S(r.Pr); aEcrire["pv"] = S(r.Pv); aEcrire["pv_net"] = S(r.PvNet);
        aEcrire["coef_benef"] = S(r.CoefBenef);
    }
}
