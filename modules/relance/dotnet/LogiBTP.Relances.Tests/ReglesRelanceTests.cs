using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Relances.Tests;

/// <summary>Jeu partagé avec regles.js : règle par défaut, contrôles, niveau atteint, relances dues, regroupement.</summary>
public class ReglesRelanceTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "relance", "tests", "cas", "01_niveaux.json"));

    // Lecture du jeu.
    private static decimal Dec(JsonNode? n) => n is null ? 0 : decimal.Parse(n.GetValue<string>(), CultureInfo.InvariantCulture);
    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>(), CultureInfo.InvariantCulture);
    private static long? Long(JsonNode? n) => n?.GetValue<long>();

    private static RegleRelance Regle(JsonNode n)
    {
        var o = n is JsonValue v ? Jeu["regles"]![v.GetValue<string>()]! : n;
        return new RegleRelance(
            o["niveaux"]!.AsArray().Select(x => new NiveauRelance(x!["rang"]!.GetValue<int>(), x["delai"]!.GetValue<int>(), x["mode"]!.GetValue<string>(),
                Long(x["modele_courriel"]), Long(x["modele_edition"]))).ToList(),
            o["repeter"]!.GetValue<bool>(), o["intervalle"]?.GetValue<int>());
    }

    private static PieceRelance Piece(JsonNode p) => new(
        p["id"]!.GetValue<long>(), p["nature"]!.GetValue<string>(), p["tiers"]!.GetValue<long>(), Long(p["charge"]), Date(p["depart"]), Dec(p["montant"]),
        p["echeances"]?.AsArray().Select(e => new EcheanceRelance(e!["id"]!.GetValue<long>(), Date(e["date"]), Dec(e["reste"]), e["retenue"]?.GetValue<bool>() ?? false)).ToList(),
        p["derniere"] is JsonNode d ? new RelanceFaite(d["niveau"]!.GetValue<int>(), Date(d["date"])!.Value) : null,
        p["arretee"]?.GetValue<bool>() ?? false, Date(p["suspendue_jusqu_au"]), p["regle"] is JsonNode r ? Regle(r) : null);

    // Écriture des résultats au format du JS (montants sans zéros non significatifs).
    private static string Texte(decimal d) => (d / 1.0000000000000000000000000000m).ToString(CultureInfo.InvariantCulture);
    private static string? Texte(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static JsonObject Json(RegleRelance r) => new()
    {
        ["niveaux"] = new JsonArray(r.Niveaux.Select(n => (JsonNode)new JsonObject
        {
            ["rang"] = n.Rang, ["delai"] = n.Delai, ["mode"] = n.Mode, ["modele_courriel"] = n.ModeleCourriel, ["modele_edition"] = n.ModeleEdition,
        }).ToArray()),
        ["repeter"] = r.Repeter,
        ["intervalle"] = r.Intervalle,
    };

    private static JsonObject? Json(NiveauAtteint? n) => n is null ? null : new()
    {
        ["rang"] = n.Rang, ["repetition"] = n.Repetition, ["palier"] = Texte(n.Palier), ["jours"] = n.Jours,
    };

    private static JsonObject? Json(RelanceDue? r) => r is null ? null : new()
    {
        ["id"] = r.Id, ["nature"] = r.Nature, ["tiers"] = r.Tiers, ["charge"] = r.Charge, ["niveau"] = r.Niveau, ["repetition"] = r.Repetition,
        ["mode"] = r.Mode, ["modele_courriel"] = r.ModeleCourriel, ["modele_edition"] = r.ModeleEdition, ["depart"] = Texte(r.Depart),
        ["palier"] = Texte(r.Palier), ["jours"] = r.Jours, ["montant"] = Texte(r.Montant),
        ["echues"] = new JsonArray(r.Echues.Select(e => (JsonNode)e).ToArray()),
        ["futures"] = new JsonArray(r.Futures.Select(f => (JsonNode)new JsonObject
        {
            ["id"] = f.Id, ["date"] = Texte(f.Date), ["reste"] = Texte(f.Reste), ["retenue"] = f.Retenue,
        }).ToArray()),
    };

    private static JsonObject Json(GroupeRelance g) => new()
    {
        ["tiers"] = g.Tiers, ["charge"] = g.Charge, ["nature"] = g.Nature, ["mode"] = g.Mode, ["niveau"] = g.Niveau,
        ["modele_courriel"] = g.ModeleCourriel, ["modele_edition"] = g.ModeleEdition, ["jours"] = g.Jours, ["montant"] = Texte(g.Montant),
        ["pieces"] = new JsonArray(g.Pieces.Select(p => (JsonNode)new JsonObject
        {
            ["id"] = p.Id, ["niveau"] = p.Niveau, ["repetition"] = p.Repetition, ["jours"] = p.Jours, ["montant"] = Texte(p.Montant),
        }).ToArray()),
    };

    private static void Egal(JsonNode? attendu, JsonNode? obtenu, string nom) =>
        Assert.True(JsonNode.DeepEquals(attendu, obtenu), $"{nom} : attendu {attendu?.ToJsonString() ?? "null"}, obtenu {obtenu?.ToJsonString() ?? "null"}");

    private static IEnumerable<JsonNode> Cas(string section) => Jeu[section]!.AsArray().Select(c => c!);

    [Fact]
    public void Regles_par_defaut_identiques_au_js()
    {
        foreach (var c in Cas("defauts"))
            Egal(c["attendu"], Json(ReglesRelance.RegleParDefaut(c["nature"]!.GetValue<string>())), c["nature"]!.GetValue<string>());
    }

    [Fact]
    public void Controles_identiques_au_js()
    {
        foreach (var c in Cas("controles"))
        {
            var attendu = c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
            Assert.True(attendu.SequenceEqual(ReglesRelance.Controler(Regle(c["regle"]!), c["nature"]!.GetValue<string>())), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Niveaux_atteints_identiques_au_js()
    {
        foreach (var c in Cas("niveaux"))
            Egal(c["attendu"], Json(ReglesRelance.Niveau(Regle(c["regle"]!), Date(c["depart"])!.Value, Date(c["date"])!.Value)), c["nom"]!.GetValue<string>());
    }

    [Fact]
    public void Relances_dues_identiques_au_js()
    {
        foreach (var c in Cas("dues"))
        {
            var seuil = c["seuil"] is JsonNode s ? Dec(s) : 0;
            Egal(c["attendu"], Json(ReglesRelance.Due(Regle(c["regle"]!), Piece(c["piece"]!), Date(c["date"])!.Value, seuil)), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Regroupements_identiques_au_js()
    {
        foreach (var c in Cas("groupes"))
        {
            var regles = c["regles"]!.AsObject().ToDictionary(kv => kv.Key, kv => Regle(kv.Value!));
            var groupes = ReglesRelance.Regrouper(ReglesRelance.Dues(regles, c["pieces"]!.AsArray().Select(p => Piece(p!)), Date(c["date"])!.Value));
            Egal(c["attendu"], new JsonArray(groupes.Select(g => (JsonNode)Json(g)).ToArray()), c["nom"]!.GetValue<string>());
        }
    }
}
