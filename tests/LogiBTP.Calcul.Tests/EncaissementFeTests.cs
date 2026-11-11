using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Domaine;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Jeu partagé avec client/src/calcul/encaissement-fe.js (client/test/encaissement-fe.test.js), lot 26 de la facturation électronique.</summary>
public class EncaissementFeTests
{
    private static readonly JsonObject J = CasPartages.Lire(CasPartages.Chemin("tests", "emission-fe", "03_encaissement.json"));

    private static string? Texte(JsonNode? n) => n?.GetValue<string>();
    private static decimal Dec(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);
    private static List<MontantTauxFe> Montants(JsonNode? n) =>
        n is null ? [] : n.AsArray().Select(x => new MontantTauxFe(Dec(x!["taux"]), Dec(x["montant"]))).ToList();

    private static EntreeEncaissementFe Entree(JsonNode e) => new()
    {
        Ventilation = Montants(e["ventilation"]),
        ServicesHt = e["services_ht"] is { } s ? Dec(s) : 1,
        TotalHt = e["total_ht"] is { } t ? Dec(t) : 1,
        Declare = Montants(e["declare"]),
        Cumul = Dec(e["cumul"]),
        Ecarts = e["ecarts"]!.AsArray().Select(x => new EcartEncaissementFe(Texte(x!["cle"])!, Dec(x["montant"]))).ToList(),
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
        var r = EncaissementFeBtp.Proposer(Entree(c["entree"]!));
        var a = c["attendu"]!.AsArray();
        Assert.Equal(a.Count, r.Count);
        for (var i = 0; i < a.Count; i++)
        {
            Assert.Equal(Texte(a[i]!["cle"]), r[i].Cle);
            Assert.Equal(Dec(a[i]!["montant"]), r[i].Montant);
            Assert.Equal(a[i]!["annulation"]!.GetValue<bool>(), r[i].Annulation);
            Assert.Equal(Montants(a[i]!["encaissements"]), r[i].Encaissements.ToList());
        }
    }

    [Fact]
    public void Concernee_cadre_de_services_ou_mixte_sans_tva_sur_les_debits()
    {
        foreach (var c in J["concerne"]!.AsArray())
            Assert.Equal(c!["attendu"]!.GetValue<bool>(), EncaissementFeBtp.Concerne(Texte(c["cadre"]), Texte(c["code_exigibilite"])));
    }

    [Fact]
    public void Part_des_services_des_lignes_vendues()
    {
        var natures = J["natures_fe"]!.AsObject().ToDictionary(x => int.Parse(x.Key, CultureInfo.InvariantCulture), x => x.Value!.GetValue<string>());
        foreach (var c in J["part_services"]!.AsArray())
        {
            var lignes = c!["lignes"]!.AsArray().Select(l => new DocumentLigneBtp
            {
                LigId = l!["lig_id"]!.GetValue<long>(),
                LigParentId = l["lig_parent_id"]?.GetValue<long>(),
                LigTylId = l["lig_tyl_id"]!.GetValue<short>(),
                LigTypePrix = Texte(l["lig_type_prix"]) ?? "V",
                LigNatId = l["lig_nat_id"]?.GetValue<int>(),
                LigMontantHt = Dec(l["lig_montant_ht"]),
            }).ToList();
            var (services, total) = EncaissementFeBtp.PartServices(lignes, natures);
            Assert.Equal((Dec(c["attendu"]!["services"]), Dec(c["attendu"]!["total"])), (services, total));
        }
    }

    [Fact]
    public void Versements_d_une_situation_la_somme_par_taux_egale_le_TTC()
    {
        var c = J["cas"]![0]!;
        var e = Entree(c["entree"]!);
        var totaux = EncaissementFeBtp.Proposer(e).SelectMany(p => p.Encaissements).GroupBy(x => x.Taux).ToDictionary(g => g.Key, g => g.Sum(x => x.Montant));
        foreach (var v in e.Ventilation) Assert.Equal(v.Montant, totaux[v.Taux]);
    }
}
