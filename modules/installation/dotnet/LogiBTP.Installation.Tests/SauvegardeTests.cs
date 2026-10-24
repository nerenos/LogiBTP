using Xunit;

namespace LogiBTP.Installation.Tests;

public class SauvegardeTests
{
    private static byte[] Aller(byte[] clair, string cle = "cle-des-donnees")
    {
        using var e = new MemoryStream(clair);
        using var s = new MemoryStream();
        ChiffrementSauvegarde.Chiffrer(e, s, cle);
        return s.ToArray();
    }

    private static byte[] Retour(byte[] chiffre, string cle = "cle-des-donnees")
    {
        using var e = new MemoryStream(chiffre);
        using var s = new MemoryStream();
        ChiffrementSauvegarde.Dechiffrer(e, s, cle);
        return s.ToArray();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    [InlineData(1 << 20)]
    [InlineData((1 << 20) * 2 + 7)]
    public void Aller_retour_toutes_tailles(int taille)
    {
        var clair = new byte[taille];
        Random.Shared.NextBytes(clair);
        var chiffre = Aller(clair);
        Assert.Equal(clair, Retour(chiffre));
        Assert.NotEqual(chiffre, Aller(clair));
    }

    [Fact]
    public void Autre_cle_alteration_et_troncature_refusees()
    {
        var clair = new byte[(1 << 20) + 100];
        Random.Shared.NextBytes(clair);
        var chiffre = Aller(clair);
        Assert.Throws<InvalidOperationException>(() => Retour(chiffre, "autre"));
        var altere = (byte[])chiffre.Clone();
        altere[100] ^= 1;
        Assert.Throws<InvalidOperationException>(() => Retour(altere));
        // Fichier coupé après le premier bloc complet : le dernier bloc n'est pas marqué comme tel.
        var premier = 20 + 16 + 8 + 4 + (1 << 20) + 16;
        Assert.Throws<InvalidOperationException>(() => Retour(chiffre[..premier]));
    }

    [Fact]
    public void Dossier_chiffre_puis_dechiffre()
    {
        var d = Path.Combine(Path.GetTempPath(), "logibtp-sauvegarde-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(d);
        try
        {
            File.WriteAllText(Path.Combine(d, "logibtp.dump"), "données");
            File.WriteAllText(Path.Combine(d, "ged.tar.gz"), "fichiers");
            Assert.Equal(2, ChiffrementSauvegarde.ChiffrerDossier(d, "k"));
            Assert.Equal(["ged.tar.gz.chiffre", "logibtp.dump.chiffre"], Directory.GetFiles(d).Select(Path.GetFileName).Order());
            Assert.Equal(0, ChiffrementSauvegarde.ChiffrerDossier(d, "k"));
            Assert.Equal(2, ChiffrementSauvegarde.DechiffrerDossier(d, "k"));
            Assert.Equal("données", File.ReadAllText(Path.Combine(d, "logibtp.dump")));
        }
        finally { Directory.Delete(d, true); }
    }
}

public class RotationCleTests
{
    [Fact]
    public void Json_rechiffre_a_toute_profondeur()
    {
        var ancienne = new LogiBTP.Socle.Chiffrement("ancienne");
        var nouvelle = new LogiBTP.Socle.Chiffrement("nouvelle", ["ancienne"]);
        var json = $$"""{"a":"{{ancienne.Chiffrer("x")}}","b":[1,"clair",{"c":"{{ancienne.Chiffrer("y")}}"}],"d":null}""";
        var (resultat, n) = RotationCle.RechiffrerJson(json, nouvelle, nouvelle);
        Assert.Equal(2, n);
        var o = System.Text.Json.Nodes.JsonNode.Parse(resultat)!;
        var seule = new LogiBTP.Socle.Chiffrement("nouvelle");
        Assert.Equal("x", seule.Dechiffrer(o["a"]!.GetValue<string>()));
        Assert.Equal("y", seule.Dechiffrer(o["b"]![2]!["c"]!.GetValue<string>()));
        Assert.Equal("clair", o["b"]![1]!.GetValue<string>());
        Assert.Equal(0, RotationCle.RechiffrerJson("""{"a":"clair","b":[1,2]}""", nouvelle, nouvelle).Nombre);
    }
}
