using System.Text;
using System.Xml.Linq;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>Facture lue et syntaxe détectée (<see cref="Syntaxe"/> : CII, UBL ou Factur-X).</summary>
public sealed record FactureLue(string Syntaxe, Facture Facture);

/// <summary>
/// Point d'entrée de la lecture d'une facture reçue, quelle que soit sa syntaxe : PDF Factur-X (en-tête « %PDF- » dans le
/// premier kilo-octet, comme le permet la norme PDF), sinon XML (sans DTD ni résolution externe) reconnu à son élément
/// racine : <c>rsm:CrossIndustryInvoice</c> → <see cref="LectureCii"/>, <c>Invoice</c> ou <c>CreditNote</c> UBL 2.1 →
/// <see cref="LectureUbl"/>. Toute autre racine : SYNTAXE_INCONNUE.
/// </summary>
public static class Lecture
{
    /// <summary>Zone où chercher l'en-tête PDF.</summary>
    private const int ZoneEntetePdf = 1024;
    private static readonly byte[] EntetePdf = Encoding.ASCII.GetBytes("%PDF-");

    /// <summary>Syntaxe d'un contenu reçu (<see cref="Syntaxe"/> : Factur-X, CII, UBL ou CDAR) ; XML_ILLISIBLE ou SYNTAXE_INCONNUE sinon.</summary>
    public static string Detecter(byte[] contenu) => EstPdf(contenu) ? Syntaxe.FacturX : Detecter(OutilsLecture.Charger(contenu));

    /// <summary>Lit une facture reçue (PDF Factur-X, XML CII ou UBL) et rend la syntaxe détectée.</summary>
    public static FactureLue Lire(byte[] contenu, bool validerXsd = true)
    {
        if (EstPdf(contenu)) return new FactureLue(Syntaxe.FacturX, ExtractionFacturX.Lire(contenu, validerXsd));
        var document = OutilsLecture.Charger(contenu);
        var syntaxe = Detecter(document);
        if (syntaxe == Syntaxe.Cdar)
            throw new ExceptionLectureFacture(ErreurFe.SyntaxeInconnue, "Message de cycle de vie CDAR, pas une facture : lire par Cdar.Lire");
        return new FactureLue(syntaxe, syntaxe == Syntaxe.Cii ? LectureCii.Lire(document, validerXsd: validerXsd) : LectureUbl.Lire(document, validerXsd));
    }

    private static string Detecter(XDocument document)
    {
        var nom = document.Root?.Name;
        if (nom == LectureCii.Rsm + "CrossIndustryInvoice") return Syntaxe.Cii;
        if (nom == LectureUbl.EspaceFacture + "Invoice" || nom == LectureUbl.EspaceAvoir + "CreditNote") return Syntaxe.Ubl;
        if (nom == Cdar.Rsm + "CrossDomainAcknowledgementAndResponse") return Syntaxe.Cdar;
        throw new ExceptionLectureFacture(ErreurFe.SyntaxeInconnue, $"Syntaxe de facture non reconnue (élément racine {nom})");
    }

    private static bool EstPdf(byte[] contenu) =>
        contenu.AsSpan(0, Math.Min(contenu.Length, ZoneEntetePdf)).IndexOf(EntetePdf) >= 0;
}
