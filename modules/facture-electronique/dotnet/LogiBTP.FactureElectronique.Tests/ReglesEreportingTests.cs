using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Règles de l'e-reporting (lot 19) : jeu tests/cas/06_ereporting.json (période, agrégation, paiements, découpage).</summary>
public class ReglesEreportingTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "facture-electronique", "tests", "cas", "06_ereporting.json"));

    internal static readonly PartieTransmission Plateforme = new("0001", SchemaIdentifiant.Plateforme, "PLATEFORME SIMULEE", RoleCdar.Plateforme);

    private static DateOnly Jour(JsonNode? n) => DateOnly.ParseExact(n!.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static DateOnly? JourOu(JsonNode? n) => n is null ? null : Jour(n);
    private static decimal Dec(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);
    private static string? Texte(JsonNode? n) => n?.GetValue<string>();

    private static VenteB2C Vente(JsonNode v) => new(Jour(v["date"]), v["categorie"]!.GetValue<string>(),
        [.. v["ventilation"]!.AsArray().Select(t => new VentilationAgregee(Dec(t!["taux"]), Dec(t["base"]), Dec(t["tva"])))],
        CodeExigibiliteTva: Texte(v["exigibilite"]));

    private static List<EncaisseParTaux> Montants(JsonNode n) =>
        [.. n.AsArray().Select(m => new EncaisseParTaux(Dec(m!["taux"]), Dec(m["montant"])))];

    private static EncaissementEreporting Encaissement(JsonNode e) =>
        new(Jour(e["date"]), Montants(e["montants"]!), Texte(e["facture"]), JourOu(e["date_facture"]));

    private static void Egaux(IReadOnlyList<EncaisseParTaux> attendu, IReadOnlyList<EncaisseParTaux> obtenu, string nom)
    {
        Assert.True(attendu.Count == obtenu.Count, nom);
        foreach (var (a, o) in attendu.Zip(obtenu))
            Assert.True(a.Taux == o.Taux && a.Montant == o.Montant && o.Devise == "EUR", $"{nom} : {a} ≠ {o}");
    }

    [Fact]
    public void Periodes_comme_le_jeu()
    {
        foreach (var c in Jeu["periodes"]!.AsArray())
        {
            var (regime, sousFlux, jour) = (c!["regime"]!.GetValue<string>(), c["sous_flux"]!.GetValue<string>(), Jour(c["jour"]));
            var nom = $"{regime} {sousFlux} {jour}";
            Assert.True(c["periodicite"]!.GetValue<string>() == ReglesEreporting.Periodicite(regime, sousFlux), nom);
            Assert.True(new PeriodeEreporting(Jour(c["debut"]), Jour(c["fin"])) == ReglesEreporting.Periode(jour, regime, sousFlux), nom);
        }
        foreach (var c in Jeu["periodes_refusees"]!.AsArray())
        {
            var e = Assert.Throws<Formats.ExceptionLectureFacture>(() => ReglesEreporting.Periodicite(c!["regime"]!.GetValue<string>(), c["sous_flux"]!.GetValue<string>()));
            Assert.Equal(ErreurFe.DonneeInvalide, e.Code);
        }
    }

    [Fact]
    public void Agregation_B2C_comme_le_jeu()
    {
        foreach (var c in Jeu["agregation"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var obtenu = ReglesEreporting.Agreger(c["ventes"]!.AsArray().Select(v => Vente(v!)));
            var attendu = c["attendu"]!.AsArray();
            Assert.True(attendu.Count == obtenu.Count, nom);
            foreach (var (a, o) in attendu.Zip(obtenu))
            {
                Assert.True(Jour(a!["date"]) == o.Date && a["categorie"]!.GetValue<string>() == o.Categorie && a["devise"]!.GetValue<string>() == o.Devise
                    && Texte(a["exigibilite"]) == o.CodeExigibiliteTva, nom);
                Assert.True(Dec(a["total_ht"]) == o.TotalHt && Dec(a["total_tva"]) == o.TotalTva && a["nombre"]!.GetValue<int>() == o.Nombre, $"{nom} : totaux");
                var ventilation = a["ventilation"]!.AsArray().Select(t => new VentilationAgregee(Dec(t!["taux"]), Dec(t["base"]), Dec(t["tva"]))).ToList();
                Assert.True(ventilation.SequenceEqual(o.Ventilation), $"{nom} : ventilation");
            }
        }
    }

    [Fact]
    public void Paiements_comme_le_jeu()
    {
        foreach (var c in Jeu["paiements"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var encaissements = c["encaissements"]!.AsArray().Select(e => Encaissement(e!)).ToList();
            if (c["agreges"] is JsonArray agreges)
            {
                var obtenu = ReglesEreporting.AgregerPaiements(encaissements);
                Assert.True(agreges.Count == obtenu.Count, nom);
                foreach (var (a, o) in agreges.Zip(obtenu))
                {
                    Assert.True(Jour(a!["date"]) == o.Date, nom);
                    Egaux(Montants(a["montants"]!), o.Montants, nom);
                }
            }
            if (c["unitaires"] is JsonArray unitaires)
            {
                var obtenu = ReglesEreporting.PaiementsUnitaires(encaissements);
                Assert.True(unitaires.Count == obtenu.Count, nom);
                foreach (var (a, o) in unitaires.Zip(obtenu))
                {
                    Assert.True(a!["facture"]!.GetValue<string>() == o.Numero && Jour(a["date_facture"]) == o.DateFacture && Jour(a["date"]) == o.DatePaiement, nom);
                    Egaux(Montants(a["montants"]!), o.Montants, nom);
                }
            }
        }
    }

    [Fact]
    public void Encaissement_unitaire_sans_facture_refuse()
    {
        var e = Assert.Throws<Formats.ExceptionLectureFacture>(() =>
            ReglesEreporting.PaiementsUnitaires([new EncaissementEreporting(new(2026, 9, 1), [new EncaisseParTaux(20m, 10m)])]));
        Assert.Equal(["TT-91"], e.Details);
    }

    /// <summary>Transaction unitaire minimale d'un acheteur allemand (B2B intracommunautaire).</summary>
    internal static TransactionUnitaire Internationale(string numero, DateOnly date) => new()
    {
        Numero = numero, Date = date, Type = TypeFacture.Facture, Cadre = CadreFacturation.S1,
        Vendeur = new EntrepriseEreporting(new Identifiant("100000009", SchemaIdentifiant.Siren), "FR88100000009", "FR"),
        Acheteur = new EntrepriseEreporting(new Identifiant("DE123456789", SchemaIdentifiant.UeHorsFrance), "DE123456789", "DE"),
        TotalHt = 100m, TotalTva = 0m,
        Ventilation = [new DetailTva { Base = 100m, Montant = 0m, Categorie = CategorieTva.Autoliquidation, Taux = 0m, MotifExoneration = "Autoliquidation", CodeExoneration = "VATEX-EU-AE" }],
    };

    [Fact]
    public void Decoupage_comme_le_jeu()
    {
        var d = Jeu["decoupage"]!;
        var donnees = new DonneesEreporting
        {
            PeriodeTransactions = new(Jour(d["periode_transactions"]!["debut"]), Jour(d["periode_transactions"]!["fin"])),
            PeriodePaiements = new(Jour(d["periode_paiements"]!["debut"]), Jour(d["periode_paiements"]!["fin"])),
            Factures = [.. d["factures"]!.AsArray().Select(f => Internationale(f!["numero"]!.GetValue<string>(), Jour(f["date"])))],
            Ventes = [.. d["ventes"]!.AsArray().Select(v => Vente(v!))],
            EncaissementsFactures = [.. d["encaissements_factures"]!.AsArray().Select(e => Encaissement(e!))],
            EncaissementsB2C = [.. d["encaissements_b2c"]!.AsArray().Select(e => Encaissement(e!))],
        };
        foreach (var c in d["cas"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var declarant = new PartieTransmission("100000009", SchemaIdentifiant.Siren, "CLIENT SA", c["role"]!.GetValue<string>());
            var contexte = new ContexteEnvoi(Plateforme, declarant, new DateTime(2026, 10, 1, 8, 0, 0), Texte(c["prefixe"]), c["correction"]!.GetValue<int>());
            var envois = ReglesEreporting.Decouper(donnees, c["decoupage"]!.GetValue<string>(), contexte);
            var attendu = c["attendu"]!.AsArray();
            Assert.True(attendu.Count == envois.Count, nom);
            foreach (var (a, e) in attendu.Zip(envois))
            {
                var t = e.Transmission;
                var elements = (t.Transactions?.Factures.Count ?? 0) + (t.Transactions?.Agregats.Count ?? 0) + (t.Paiements?.Factures.Count ?? 0) + (t.Paiements?.Agregats.Count ?? 0);
                Assert.True(a!["sous_flux"]!.GetValue<string>() == e.SousFlux && a["type_flux"]!.GetValue<string>() == e.TypeFlux && JourOu(a["jour"]) == e.Jour, $"{nom} : {e.SousFlux}");
                Assert.True(a["id"]!.GetValue<string>() == t.Id && a["type"]!.GetValue<string>() == t.Type && a["elements"]!.GetValue<int>() == elements, $"{nom} : {t.Id}");
                Assert.True((t.Transactions is null) != (t.Paiements is null), $"{nom} : un seul rapport (G6.29)");
                Assert.Empty(ReglesEreporting.Controler(t));
            }
        }
    }

    [Fact]
    public void Decoupage_inconnu_ou_periode_absente_refuses()
    {
        var c = new ContexteEnvoi(Plateforme, new("100000009", SchemaIdentifiant.Siren, "CLIENT SA", RoleCdar.Vendeur), new DateTime(2026, 10, 1));
        var vente = new VenteB2C(new(2026, 9, 2), CategorieTransactions.Services, [new VentilationAgregee(10m, 100m, 10m)]);
        Assert.Equal(ErreurFe.DonneeInvalide, Assert.Throws<Formats.ExceptionLectureFacture>(() => ReglesEreporting.Decouper(new DonneesEreporting(), "MENSUEL", c)).Code);
        var e = Assert.Throws<Formats.ExceptionLectureFacture>(() => ReglesEreporting.Decouper(new DonneesEreporting { Ventes = [vente] }, DecoupageEreporting.Unique, c));
        Assert.Equal(["TG-7"], e.Details);
        Assert.Empty(ReglesEreporting.Decouper(new DonneesEreporting(), DecoupageEreporting.Plusieurs, c));
        var long_ = c with { Prefixe = new string('A', 40) };
        Assert.Equal(["TT-1"], Assert.Throws<Formats.ExceptionLectureFacture>(() =>
            ReglesEreporting.Decouper(new DonneesEreporting { Ventes = [vente], PeriodeTransactions = new(new(2026, 9, 1), new(2026, 9, 10)) }, DecoupageEreporting.Unique, long_)).Details);
    }
}
