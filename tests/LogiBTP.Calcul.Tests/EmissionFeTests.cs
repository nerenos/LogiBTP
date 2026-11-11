using System.Text.Json.Nodes;
using LogiBTP.Domaine;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Jeu partagé avec client/src/calcul/emission-fe.js (client/test/emission-fe.test.js), lot 21 de la facturation électronique.</summary>
public class EmissionFeTests
{
    private static readonly JsonObject J = CasPartages.Lire(CasPartages.Chemin("tests", "emission-fe", "01_emission.json"));

    private static string? Texte(JsonNode? n) => n is null ? null : n.GetValue<string>();

    private static MentionsEmissionFe Mentions(JsonNode m) =>
        new(Texte(m["indemnite"]), Texte(m["penalites"]), Texte(m["escompte"]), m["tva_debits"]?.GetValue<bool>() ?? false);

    private static DocumentLigneBtp Ligne(JsonNode l) => new()
    {
        LigId = l["lig_id"]!.GetValue<long>(),
        LigParentId = l["lig_parent_id"]?.GetValue<long>(),
        LigTylId = l["lig_tyl_id"]!.GetValue<short>(),
        LigTypePrix = Texte(l["lig_type_prix"]) ?? "V",
        LigNatId = l["lig_nat_id"]?.GetValue<int>(),
        LigIsEcartArrondi = l["lig_is_ecart_arrondi"]?.GetValue<bool>() ?? false,
    };

    private static EntreeEmissionFe Entree(JsonNode e) => new()
    {
        TypeFacture = Texte(e["type_facture"]),
        TypeOrigine = Texte(e["type_origine"]),
        EntFeNature = Texte(e["ent_fe_nature"]),
        Lignes = e["lignes"]!.AsArray().Select(l => Ligne(l!)).ToList(),
        NaturesFe = J["natures_fe"]!.AsObject().ToDictionary(x => int.Parse(x.Key), x => x.Value!.GetValue<string>()),
        Role = Texte(e["role"]),
        DeduitAcompte = e["deduit_acompte"]?.GetValue<bool>() ?? false,
        DejaPayee = e["deja_payee"]?.GetValue<bool>() ?? false,
        Mentions = Mentions(e["mentions"] ?? J["mentions"]!),
    };

    public static TheoryData<string> Noms()
    {
        var d = new TheoryData<string>();
        foreach (var c in J["cas"]!.AsArray()) d.Add(c!["nom"]!.GetValue<string>());
        return d;
    }

    [Theory]
    [MemberData(nameof(Noms))]
    public void Cas_identiques_au_js(string nom)
    {
        var c = J["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var r = EmissionFeBtp.Parametres(Entree(c["entree"]!));
        var a = c["attendu"];
        if (a is null) { Assert.Null(r); return; }
        Assert.NotNull(r);
        Assert.Equal(Texte(a["type_facture"]), r.TypeFacture);
        Assert.Equal(Texte(a["nature"]), r.Nature);
        Assert.Equal(Texte(a["situation"]), r.Situation);
        Assert.Equal(Texte(a["cadre"]), r.Cadre);
        Assert.Equal(Texte(a["code_exigibilite_tva"]), r.CodeExigibiliteTva);
        Assert.Equal(a["notes"]!.AsArray().Select(n => (Texte(n!["code_sujet"]), Texte(n["texte"]))).ToList(),
            r.Notes.Select(n => (n.CodeSujet, (string?)n.Texte)).ToList());
    }

    [Fact]
    public void Chaque_type_de_vente_emis_a_son_cas()
    {
        var types = J["cas"]!.AsArray().Where(c => c!["attendu"] is not null).Select(c => c!["type_document"]!.GetValue<string>()).Distinct().Order(StringComparer.Ordinal).ToList();
        Assert.Equal(["V_AVOIR", "V_FACTURE", "V_FACTURE_ACOMPTE", "V_FACTURE_AVT"], types);
    }
}
