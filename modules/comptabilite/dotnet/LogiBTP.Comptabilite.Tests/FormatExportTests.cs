using System.Text;
using Xunit;

namespace LogiBTP.Comptabilite.Tests;

public class FormatExportTests
{
    private static readonly LigneEcriture[] Lignes =
    [
        new("VT", new DateOnly(2026, 10, 31), "FA2026-00001", "Réf; client", "411100", "C000001", "Électricité Rhône-Alpes – facture de travaux du lot 2",
            1234.5m, 0, new DateOnly(2026, 11, 30), "CH-01"),
        new("VT", new DateOnly(2026, 10, 31), "FA2026-00001", null, "704000", null, "Électricité Rhône-Alpes", 0, 1234.5m, null, "CH-01"),
    ];

    [Fact]
    public void Sage100_sens_et_montant_libelle_tronque_ansi()
    {
        var m = FormatExport.Sage100;
        Assert.Null(FormatExport.Controler(m));
        var texte = FormatExport.Texte(Lignes, m);
        var lignes = texte.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("VT;311026;FA2026-00001;411100;C000001;\"Réf; client\";Électricité Rhône-Alpes – facture d;301126;D;1234,50;CH-01", lignes[0]);
        Assert.Equal("VT;311026;FA2026-00001;704000;;;Électricité Rhône-Alpes;;C;1234,50;CH-01", lignes[1]);
        var octets = FormatExport.Fichier(Lignes, m);
        Assert.Equal(texte, FormatExport.Encodage(m).GetString(octets));
        Assert.Equal(0xC9, octets[Encoding.ASCII.GetByteCount("VT;311026;FA2026-00001;411100;C000001;\"Réf; client\";")]);
    }

    [Fact]
    public void Generique_entete_debit_credit()
    {
        var texte = FormatExport.Texte(Lignes, FormatExport.Generique);
        Assert.StartsWith("Journal;Date;Pièce;Référence;Compte général;Compte tiers;Libellé;Échéance;Débit;Crédit;Section analytique\r\n", texte);
        Assert.Contains(";31/10/2026;", texte);
        Assert.Contains(";1234,50;;CH-01", texte);
    }

    [Fact]
    public void Modele_invalide()
    {
        Assert.NotNull(FormatExport.Controler(FormatExport.Sage100 with { Decimale = ";" }));
        Assert.NotNull(FormatExport.Controler(FormatExport.Sage100 with { Colonnes = ["INCONNUE"] }));
        Assert.NotNull(FormatExport.Controler(FormatExport.Sage100 with { Encodage = "pas-un-encodage" }));
    }
}
