using System.Text;
using System.Text.Json.Nodes;
using LogiBTP.Personnalisation.Web;
using Xunit;

namespace LogiBTP.Personnalisation.Tests;

/// <summary>Fichiers du programme surchargés par ceux de l'installation (fusion, thème ajouté, images remplacées).</summary>
public sealed class FichiersPersonnalisationTests : IDisposable
{
    private readonly string _racine = Path.Combine(Path.GetTempPath(), $"perso-{Guid.NewGuid():N}");
    private string Programme => Path.Combine(_racine, "programme");
    private string Installation => Path.Combine(_racine, "installation");

    public FichiersPersonnalisationTests()
    {
        Ecrire(Programme, "fr.json", """{ "_meta": { "langue": "fr-FR", "version": "build" }, "commun": { "enregistrer": "Enregistrer", "annuler": "Annuler" } }""");
        Ecrire(Programme, "images/icones.json", """{ "parametres": "⚙", "chantier": "👷" }""");
        Ecrire(Programme, "theme.css", ":root { --accent: #1d5fbf; }");
        Ecrire(Programme, "images/logo.svg", "<svg>programme</svg>");
        Ecrire(Programme, "images/borne.svg", "<svg>borne</svg>");
        Ecrire(_racine, "secret.txt", "secret");
    }

    public void Dispose() => Directory.Delete(_racine, true);

    private static void Ecrire(string dossier, string relatif, string contenu)
    {
        var f = Path.Combine(dossier, relatif);
        Directory.CreateDirectory(Path.GetDirectoryName(f)!);
        File.WriteAllText(f, contenu);
    }

    private static string Texte(FichierPersonnalisation? f) => Encoding.UTF8.GetString(f!.Contenu);

    [Fact]
    public void Sans_installation_les_fichiers_du_programme()
    {
        var p = new FichiersPersonnalisation(Programme, Installation);
        Assert.Contains("\"version\": \"build\"", Texte(p.Lire("fr.json")));
        Assert.Equal("application/json; charset=utf-8", p.Lire("fr.json")!.Type);
        Assert.Equal("<svg>programme</svg>", Texte(p.Lire("images/logo.svg")));
        Assert.Equal("image/svg+xml", p.Lire("/images/logo.svg")!.Type);
        Assert.Null(p.Lire("images/absent.png"));
    }

    [Fact]
    public void Installation_fusionnee_ajoutee_ou_remplacante()
    {
        Ecrire(Installation, "fr.json", """{ "commun": { "enregistrer": "Valider" }, "pointage": { "titre": "Heures" } }""");
        Ecrire(Installation, "images/icones.json", """{ "chantier": "chantier.svg" }""");
        Ecrire(Installation, "theme.css", ":root { --accent: #c00; }");
        Ecrire(Installation, "images/logo.svg", "<svg>installation</svg>");
        var p = new FichiersPersonnalisation(Programme, Installation);

        var fr = JsonNode.Parse(Texte(p.Lire("fr.json")))!;
        Assert.Equal("Valider", fr["commun"]!["enregistrer"]!.GetValue<string>());
        Assert.Equal("Annuler", fr["commun"]!["annuler"]!.GetValue<string>());
        Assert.Equal("Heures", fr["pointage"]!["titre"]!.GetValue<string>());
        var version = fr["_meta"]!["version"]!.GetValue<string>();
        Assert.NotEqual("build", version);
        Assert.Equal(16, version.Length);
        Assert.Equal(version, JsonNode.Parse(Texte(new FichiersPersonnalisation(Programme, Installation).Lire("fr.json")))!["_meta"]!["version"]!.GetValue<string>());

        var icones = JsonNode.Parse(Texte(p.Lire("images/icones.json")))!;
        Assert.Equal("⚙", icones["parametres"]!.GetValue<string>());
        Assert.Equal("chantier.svg", icones["chantier"]!.GetValue<string>());

        var theme = Texte(p.Lire("theme.css"));
        Assert.True(theme.IndexOf("#1d5fbf", StringComparison.Ordinal) < theme.IndexOf("#c00", StringComparison.Ordinal));
        Assert.Equal("<svg>installation</svg>", Texte(p.Lire("images/logo.svg")));
        Assert.Equal("<svg>borne</svg>", Texte(p.Lire("images/borne.svg")));
    }

    [Fact]
    public void Fichier_modifie_relu_et_empreinte_changee()
    {
        Ecrire(Installation, "theme.css", ":root { --accent: #c00; }");
        var p = new FichiersPersonnalisation(Programme, Installation);
        var avant = p.Lire("theme.css")!.Empreinte;
        File.WriteAllText(Path.Combine(Installation, "theme.css"), ":root { --accent: #0c0; --fond: #fff; }");
        File.SetLastWriteTimeUtc(Path.Combine(Installation, "theme.css"), DateTime.UtcNow.AddMinutes(1));
        Assert.NotEqual(avant, p.Lire("theme.css")!.Empreinte);
        Assert.Contains("#0c0", Texte(p.Lire("theme.css")));
    }

    [Fact]
    public void Aucun_fichier_hors_des_dossiers()
    {
        var p = new FichiersPersonnalisation(Programme, Installation);
        Assert.Null(p.Lire("../secret.txt"));
        Assert.Null(p.Lire("images/../../secret.txt"));
        Assert.Null(p.Lire(Path.Combine(_racine, "secret.txt")));
        Assert.Null(FichiersPersonnalisation.Chemin(null, "fr.json"));
    }
}
