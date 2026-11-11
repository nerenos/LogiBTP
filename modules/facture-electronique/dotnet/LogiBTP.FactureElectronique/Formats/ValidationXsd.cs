using System.Collections.Concurrent;
using System.Reflection;
using System.Xml;
using System.Xml.Linq;
using System.Xml.Schema;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>Jeu de schémas XSD d'une facture, d'un CDAR ou d'un flux 10 (artefacts/xsd, paquet FNFE 1.4.0.04 : voir artefacts/VERSION ; UBL 2.1 OASIS du même paquet).</summary>
public enum JeuXsd
{
    /// <summary>UN/CEFACT CrossIndustryInvoice D22B uncoupled (CII seul, EN16931 et EXTENDED-CTC-FR).</summary>
    CiiD22B,
    /// <summary>Factur-X 1.09.2 BASIC WL.</summary>
    FacturXBasicWl,
    /// <summary>Factur-X 1.09.2 EN16931 (sert aussi au profil BASIC, sous-ensemble).</summary>
    FacturXEn16931,
    /// <summary>Factur-X 1.09.2 EXTENDED.</summary>
    FacturXExtended,
    /// <summary>OASIS UBL 2.1 Invoice (EN16931 et EXTENDED-CTC-FR).</summary>
    UblInvoice,
    /// <summary>OASIS UBL 2.1 CreditNote (EN16931 et EXTENDED-CTC-FR).</summary>
    UblCreditNote,
    /// <summary>UN/CEFACT CrossDomainAcknowledgementAndResponse D22B uncoupled (CDAR, cycle de vie).</summary>
    CdarD22B,
    /// <summary>E-reporting, flux 10 du paquet FNFE (ereporting.xsd : Report, TransactionsReport, PaymentsReport).</summary>
    Flux10,
}

/// <summary>
/// Validation XSD d'une facture (<see cref="XmlSchemaSet"/>). Les schémas sont embarqués dans l'assemblage (ressources
/// <c>xsd/&lt;dossier&gt;/&lt;fichier&gt;</c>) et résolus entre eux par leur nom ; chaque jeu est compilé une fois
/// (indépendant de la société).
/// </summary>
public static class ValidationXsd
{
    private const string Prefixe = "xsd/";
    private const string Schema = "res";

    private static readonly ConcurrentDictionary<JeuXsd, Lazy<XmlSchemaSet>> Jeux = new();

    private static (string Dossier, string Racine) Racine(JeuXsd jeu) => jeu switch
    {
        JeuXsd.CiiD22B => ("cii-d22b", "CrossIndustryInvoice_100pD22B.xsd"),
        JeuXsd.FacturXBasicWl => ("factur-x/basicwl", "Factur-X_BASICWL.xsd"),
        JeuXsd.FacturXEn16931 => ("factur-x/en16931", "Factur-X_EN16931.xsd"),
        JeuXsd.FacturXExtended => ("factur-x/extended", "Factur-X_EXTENDED.xsd"),
        JeuXsd.UblInvoice => ("ubl-2.1/maindoc", "UBL-Invoice-2.1.xsd"),
        JeuXsd.UblCreditNote => ("ubl-2.1/maindoc", "UBL-CreditNote-2.1.xsd"),
        JeuXsd.CdarD22B => ("cdar-d22b", "CrossDomainAcknowledgementAndResponse_100pD22B.xsd"),
        JeuXsd.Flux10 => ("flux10", "ereporting.xsd"),
        _ => throw new ArgumentOutOfRangeException(nameof(jeu)),
    };

    /// <summary>Messages d'erreur XSD (vide = conforme), avec ligne et colonne quand elles sont connues.</summary>
    public static IReadOnlyList<string> Valider(XDocument document, JeuXsd jeu)
    {
        var schemas = Jeux.GetOrAdd(jeu, j => new Lazy<XmlSchemaSet>(() => Compiler(j))).Value;
        var erreurs = new List<string>();
        document.Validate(schemas, (_, e) =>
        {
            if (e.Severity != XmlSeverityType.Error) return;
            var position = e.Exception is { LineNumber: > 0 } x ? $" (ligne {x.LineNumber}, colonne {x.LinePosition})" : "";
            erreurs.Add(e.Message + position);
        });
        return erreurs;
    }

    private static XmlSchemaSet Compiler(JeuXsd jeu)
    {
        var (dossier, racine) = Racine(jeu);
        var resolveur = new ResolveurRessources();
        var jeuSchemas = new XmlSchemaSet { XmlResolver = resolveur };
        var uri = new Uri($"{Schema}://xsd/{dossier}/{racine}");
        using var flux = (Stream)resolveur.GetEntity(uri, null, typeof(Stream))!;
        // Schémas embarqués (de confiance) : le XSD xmldsig d'UBL porte une DTD interne (entités sans référence externe),
        // d'où DtdProcessing.Parse ; toute référence externe reste refusée par le résolveur. Le XML lu, lui, n'a jamais de DTD.
        var reglages = new XmlReaderSettings { DtdProcessing = DtdProcessing.Parse, XmlResolver = resolveur, MaxCharactersFromEntities = 1_000_000 };
        using var lecteur = XmlReader.Create(flux, reglages, uri.AbsoluteUri);
        jeuSchemas.Add(null, lecteur);
        jeuSchemas.Compile();
        return jeuSchemas;
    }

    /// <summary>Résout les <c>schemaLocation</c> relatifs vers les ressources embarquées (aucun accès réseau ni disque).</summary>
    private sealed class ResolveurRessources : XmlResolver
    {
        private static readonly Assembly Assemblage = typeof(ValidationXsd).Assembly;

        public override object? GetEntity(Uri absoluteUri, string? role, Type? ofObjectToReturn)
        {
            if (absoluteUri.Scheme != Schema) throw new XmlException($"Ressource XSD hors du module refusée : {absoluteUri}");
            var nom = Prefixe + absoluteUri.AbsolutePath.TrimStart('/');
            return Assemblage.GetManifestResourceStream(nom) ?? throw new XmlException($"Schéma XSD introuvable : {nom}");
        }

        public override Uri ResolveUri(Uri? baseUri, string? relativeUri) =>
            baseUri is null ? new Uri(relativeUri!) : new Uri(baseUri, relativeUri);
    }
}
