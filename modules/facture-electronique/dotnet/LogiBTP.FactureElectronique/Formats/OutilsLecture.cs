using System.Globalization;
using System.Xml;
using System.Xml.Linq;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>Outils communs aux lecteurs CII et UBL : chargement sûr du XML, nombres décimaux, termes obligatoires.</summary>
internal static class OutilsLecture
{
    /// <summary>Charge le XML sans DTD ni résolution externe (XML_ILLISIBLE si mal formé), lignes conservées pour les messages XSD.</summary>
    public static XDocument Charger(byte[] xml)
    {
        var reglages = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        try
        {
            using var flux = new MemoryStream(xml, writable: false);
            using var lecteur = XmlReader.Create(flux, reglages);
            return XDocument.Load(lecteur, LoadOptions.SetLineInfo);
        }
        catch (XmlException e)
        {
            throw new ExceptionLectureFacture(ErreurFe.XmlIllisible, $"XML mal formé : {e.Message}");
        }
    }

    /// <summary>Textes non vides joints par le séparateur (null s'il n'y en a aucun).</summary>
    public static string? Joindre(IEnumerable<string?> textes, string separateur = " ")
    {
        var liste = textes.Where(t => !string.IsNullOrEmpty(t)).ToList();
        return liste.Count == 0 ? null : string.Join(separateur, liste);
    }

    /// <summary>Nombre décimal exact (point décimal, signe en tête) ; DONNEE_INVALIDE sinon.</summary>
    public static decimal Decimal(XElement e, string terme) =>
        decimal.TryParse(e.Value.Trim(), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var d)
            ? d
            : throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, $"Nombre illisible ({terme}) : {e.Value}");

    /// <summary>Indicateur de charge (vrai) ou remise (faux) d'un ChargeIndicator ; DONNEE_INVALIDE sinon.</summary>
    public static bool Indicateur(string? valeur) => valeur?.ToLowerInvariant() switch
    {
        "true" => true,
        "false" => false,
        _ => throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, $"Indicateur de remise ou charge illisible : {valeur ?? "absent"}"),
    };

    /// <summary>Erreur d'un terme obligatoire absent.</summary>
    public static ExceptionLectureFacture Absent(string terme) =>
        new(ErreurFe.DonneeInvalide, $"Terme obligatoire absent : {terme}", [terme]);

    public static T Exiger<T>(T? valeur, string terme) where T : class => valeur ?? throw Absent(terme);

    public static T ExigerValeur<T>(T? valeur, string terme) where T : struct => valeur ?? throw Absent(terme);
}
