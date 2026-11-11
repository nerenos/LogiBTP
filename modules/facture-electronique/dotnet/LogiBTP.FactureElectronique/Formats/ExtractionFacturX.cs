using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>
/// Factur-X : extraction du XML CII embarqué d'un PDF/A-3 (arbre <c>/Names /EmbeddedFiles</c>, lu par PdfPig) puis lecture
/// par <see cref="LectureCii"/> avec le XSD Factur-X du profil. Fichier attendu : <c>factur-x.xml</c> ; noms ZUGFeRD
/// acceptés à défaut. Erreurs : PDF_ILLISIBLE, XML_ABSENT, puis celles de la lecture CII.
/// </summary>
public static class ExtractionFacturX
{
    /// <summary>Nom du fichier embarqué d'un Factur-X (spécification Factur-X 1.0).</summary>
    public const string NomFichier = "factur-x.xml";

    /// <summary>Noms acceptés à défaut (ZUGFeRD 2.x et 1.x), par ordre de préférence.</summary>
    private static readonly string[] NomsAcceptes = [NomFichier, "zugferd-invoice.xml", "ZUGFeRD-invoice.xml", "xrechnung.xml"];

    /// <summary>Octets du XML embarqué (factur-x.xml), sans lecture ni validation.</summary>
    public static byte[] Extraire(byte[] pdf)
    {
        IReadOnlyList<EmbeddedFile>? fichiers;
        try
        {
            using var document = PdfDocument.Open(pdf);
            if (!document.Advanced.TryGetEmbeddedFiles(out fichiers)) fichiers = [];
            foreach (var nom in NomsAcceptes)
            {
                var fichier = fichiers.FirstOrDefault(f => NomDe(f).Equals(nom, StringComparison.OrdinalIgnoreCase));
                if (fichier is not null) return fichier.Bytes.ToArray();
            }
        }
        catch (Exception e) when (e is not ExceptionLectureFacture)
        {
            throw new ExceptionLectureFacture(ErreurFe.PdfIllisible, $"PDF illisible : {e.Message}");
        }
        throw new ExceptionLectureFacture(ErreurFe.XmlAbsent, $"Aucun fichier {NomFichier} embarqué dans le PDF",
            fichiers.Select(NomDe).ToList());
    }

    /// <summary>Lit la facture d'un PDF Factur-X (extraction, XSD Factur-X du profil, termes).</summary>
    public static Facture Lire(byte[] pdf, bool validerXsd = true) => LectureCii.Lire(Extraire(pdf), facturX: true, validerXsd);

    /// <summary>Nom d'un fichier embarqué : clé de l'arbre des noms, à défaut nom de la spécification de fichier.</summary>
    private static string NomDe(EmbeddedFile f) => Path.GetFileName(f.Name ?? f.FileSpecification ?? "");
}
