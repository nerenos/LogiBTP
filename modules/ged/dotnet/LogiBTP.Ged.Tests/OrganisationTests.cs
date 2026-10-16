using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using LogiBTP.Ged.Web;
using LogiBTP.Socle.Testing;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Ged.Tests;

/// <summary>Rétention (jeu 04_retention.json partagé avec retention.js).</summary>
public class RegleRetentionTests
{
    private static JsonNode Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "ged", "tests", "cas", "04_retention.json"));

    private static string? Texte(JsonNode? n) => n?.GetValue<string>();
    private static int? Entier(JsonNode? n) => n?.GetValue<int>();
    private static DateOnly? Date(JsonNode? n) => Texte(n) is { } t ? DateOnly.ParseExact(t, "yyyy-MM-dd", CultureInfo.InvariantCulture) : null;

    private static List<RegleRetentionGed> Regles() => Jeu()["regles"]!.AsArray().Select(r => new RegleRetentionGed(r!["id"]!.GetValue<int>(), r["libelle"]!.GetValue<string>(),
        Texte(r["categorie"]), Texte(r["type_element"]), Entier(r["duree_active_mois"]), Entier(r["duree_conservation_mois"]), r["action_fin"]!.GetValue<string>(),
        r["priorite"]!.GetValue<int>(), r["actif"]!.GetValue<bool>())).ToList();

    [Fact]
    public void Echeances_identiques_au_js()
    {
        foreach (var c in Jeu()["cas"]!.AsArray())
        {
            var regles = Regles();
            if (c!["regles"] is JsonArray ids) regles = regles.Where(r => ids.Any(i => i!.GetValue<int>() == r.Id)).ToList();
            var d = c["document"]!;
            var creeLe = Texte(d["cree_le"]) is { } t ? DateTimeOffset.Parse(t, CultureInfo.InvariantCulture) : DateTimeOffset.UnixEpoch;
            var e = RegleRetention.Echeances(new DocumentRetention(Texte(d["categorie"]), Texte(d["type_element"]), Date(d["date_document"]), creeLe), regles, Date(c["aujourdhui"])!.Value);
            var a = c["attendu"]!;
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(Entier(a["regle"]) == e.Regle, nom);
            Assert.Equal(Texte(a["base"]), RegleRetention.Iso(e.Base));
            Assert.Equal(Texte(a["archiver_le"]) ?? "", RegleRetention.Iso(e.ArchiverLe));
            Assert.Equal(Texte(a["fin_le"]) ?? "", RegleRetention.Iso(e.FinLe));
            Assert.Equal(Texte(a["action_fin"]), e.ActionFin);
            Assert.Equal(Texte(a["statut"]), e.Statut);
        }
    }

    [Fact]
    public void Ajout_de_mois_ramene_en_fin_de_mois()
    {
        foreach (var c in Jeu()["ajouter_mois"]!.AsArray())
            Assert.Equal(Texte(c!["attendu"]), RegleRetention.Iso(RegleRetention.AjouterMois(Date(c["date"])!.Value, c["mois"]!.GetValue<int>())));
    }
}

/// <summary>Classification automatique (jeu 05_classification.json partagé avec classification.js).</summary>
public class ClassificationGedTests
{
    private static JsonNode Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "ged", "tests", "cas", "05_classification.json"));

    private static string? Texte(JsonNode? n) => n?.GetValue<string>();
    private static string[] Liste(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToArray() ?? [];

    [Fact]
    public void Classement_identique_au_js()
    {
        var regles = Jeu()["regles"]!.AsArray().Select(r => new RegleClassificationGed(r!["id"]!.GetValue<int>(), r["libelle"]!.GetValue<string>(), r["priorite"]!.GetValue<int>(),
            Liste(r["extensions"]), Liste(r["types_mime"]), Liste(r["mots"]), Texte(r["expediteur"]), Texte(r["type_element"]), Texte(r["categorie"]),
            Texte(r["confidentialite"]), Liste(r["mots_cles"]), r["actif"]!.GetValue<bool>())).ToList();
        foreach (var c in Jeu()["cas"]!.AsArray())
        {
            var d = c!["document"]!;
            var r = ClassificationGed.Classer(new DocumentAClasser(Texte(d["nom_fichier"]), Texte(d["type_mime"]), Texte(d["titre"]), Texte(d["texte"]),
                Texte(d["expediteur"]), Texte(d["type_element"])), regles);
            var a = c["attendu"]!;
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(Texte(a["categorie"]) == r.Categorie, nom);
            Assert.True(Texte(a["confidentialite"]) == r.Confidentialite, nom);
            Assert.Equal(Liste(a["mots_cles"]), r.MotsCles);
            Assert.Equal(a["regles"]!.AsArray().Select(x => x!.GetValue<int>()), r.Regles);
        }
    }
}

/// <summary>Accès (jeu 06_acces.json partagé avec acces.js) : filtre des requêtes (compilé) et règle sur valeurs.</summary>
public class AccesGedTests
{
    [Fact]
    public void Acces_identiques_au_js()
    {
        var jeu = CasPartages.Lire(CasPartages.Chemin("modules", "ged", "tests", "cas", "06_acces.json"));
        var utilisateurs = jeu["utilisateurs"]!.AsObject().ToDictionary(x => x.Key, x => new Utilisateur(x.Value!["code"]!.GetValue<string>(), x.Value["profil"]!.GetValue<string>()));
        foreach (var c in jeu["cas"]!.AsArray())
        {
            var d = c!["document"]!;
            var doc = new DocumentGed
            {
                DgeCreePar = d["cree_par"]!.GetValue<string>(), DgeConfidentialite = d["confidentialite"]!.GetValue<string>(),
                DgeAccesProfils = d["acces_profils"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray(),
                DgeAccesUtilisateurs = d["acces_utilisateurs"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray(),
            };
            foreach (var (cle, attendu) in c["attendu"]!.AsObject())
            {
                var u = utilisateurs[cle];
                var nom = $"{c["nom"]} / {cle}";
                Assert.True(attendu!.GetValue<bool>() == AccesGed.Filtre(u).Compile()(doc), nom);
                Assert.True(attendu.GetValue<bool>() == AccesGed.Autorise(doc.DgeCreePar, doc.DgeConfidentialite, doc.DgeAccesProfils, doc.DgeAccesUtilisateurs, u), nom);
            }
        }
    }
}

/// <summary>Extraction du texte pour l'indexation : PDF, textes, HTML, bureautique, formats sans texte.</summary>
public class ExtractionTexteTests
{
    /// <summary>PDF minimal d'une page (comme pdfSimple du client).</summary>
    private static byte[] Pdf(string texte)
    {
        var flux = $"BT /F1 18 Tf 60 780 Td ({texte}) Tj ET";
        string[] objets =
        [
            "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            $"<< /Length {flux.Length} >>\nstream\n{flux}\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ];
        var pdf = new StringBuilder("%PDF-1.4\n");
        var positions = new List<int>();
        for (var i = 0; i < objets.Length; i++) { positions.Add(pdf.Length); pdf.Append(CultureInfo.InvariantCulture, $"{i + 1} 0 obj\n{objets[i]}\nendobj\n"); }
        var xref = pdf.Length;
        pdf.Append(CultureInfo.InvariantCulture, $"xref\n0 {objets.Length + 1}\n0000000000 65535 f \n");
        foreach (var p in positions) pdf.Append(CultureInfo.InvariantCulture, $"{p:D10} 00000 n \n");
        pdf.Append(CultureInfo.InvariantCulture, $"trailer\n<< /Size {objets.Length + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(pdf.ToString());
    }

    [Fact]
    public void Pdf_texte_extrait()
    {
        var (texte, etat) = ExtractionTexte.Extraire(new MemoryStream(Pdf("Facture beton C25/30")), "scan.pdf", "application/pdf");
        Assert.Equal(ExtractionTexte.Fait, etat);
        Assert.Contains("Facture beton", texte);
    }

    [Fact]
    public void Texte_html_et_formats_sans_texte()
    {
        Assert.Equal(("Bonjour Hélène", ExtractionTexte.Fait), ExtractionTexte.Extraire(new MemoryStream(Encoding.UTF8.GetBytes("Bonjour   Hélène")), "a.txt", null));
        Assert.Equal(("Devis & plan", ExtractionTexte.Fait),
            ExtractionTexte.Extraire(new MemoryStream(Encoding.UTF8.GetBytes("<p>Devis &amp; <b>plan</b></p><script>x()</script>")), "a.html", "text/html"));
        Assert.Equal((null, ExtractionTexte.SansTexte), ExtractionTexte.Extraire(new MemoryStream([0x89, 0x50, 0x4e, 0x47]), "photo.png", "image/png"));
        Assert.Equal((null, ExtractionTexte.Echec), ExtractionTexte.Extraire(new MemoryStream(Encoding.ASCII.GetBytes("%PDF-1.4 corrompu")), "x.pdf", "application/pdf"));
    }

    [Fact]
    public void Docx_texte_des_paragraphes()
    {
        var m = new MemoryStream();
        using (var zip = new ZipArchive(m, ZipArchiveMode.Create, true))
        {
            using var e = new StreamWriter(zip.CreateEntry("word/document.xml").Open());
            e.Write("<w:document><w:body><w:p><w:r><w:t>Contrat de sous-traitance</w:t></w:r></w:p><w:p><w:r><w:t>Lot 2</w:t></w:r></w:p></w:body></w:document>");
        }
        m.Position = 0;
        var (texte, etat) = ExtractionTexte.Extraire(m, "contrat.docx", null);
        Assert.Equal(ExtractionTexte.Fait, etat);
        Assert.Contains("Contrat de sous-traitance", texte);
        Assert.Contains("Lot 2", texte);
    }
}
