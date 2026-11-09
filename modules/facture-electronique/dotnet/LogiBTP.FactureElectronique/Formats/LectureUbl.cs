using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using static LogiBTP.FactureElectronique.Formats.OutilsLecture;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>
/// Lecture d'une facture OASIS UBL 2.1 (Invoice ou CreditNote) vers le modèle sémantique <see cref="Facture"/>, profils
/// EN16931 et EXTENDED-CTC-FR ; chemins de l'annexe A XP Z12-012 V1.4 (onglets « Flux 2 UBL EN16931 FR » et « Flux 2 UBL
/// EXT-CTC-FR »). Mêmes étapes que <see cref="LectureCii"/> (XML sûr, racine, profil BT-24, XSD UBL, termes) et même
/// modèle : une facture lue en CII et en UBL donne le même <see cref="Facture"/>. Conversions vers les conventions du
/// modèle (celles du CII) : BT-8 de l'UNTDID 2005 vers l'UNTDID 2475, code sujet BT-21 extrait du préfixe « #CODE# » de
/// la note, sous-type et ligne parente (EXT-FR-FE-162/163) lus dans le BillingReference de ligne qui porte un
/// DocumentStatusCode, les autres BillingReference de ligne donnant la facture antérieure (EXT-FR-FE-BG-06).
/// </summary>
public static partial class LectureUbl
{
    /// <summary>Espace de noms de l'élément racine Invoice.</summary>
    public static readonly XNamespace EspaceFacture = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
    /// <summary>Espace de noms de l'élément racine CreditNote.</summary>
    public static readonly XNamespace EspaceAvoir = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
    /// <summary>Espace de noms des composants agrégés.</summary>
    public static readonly XNamespace Cac = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
    /// <summary>Espace de noms des composants de base.</summary>
    public static readonly XNamespace Cbc = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

    /// <summary>BT-8 : UNTDID 2005 (UBL) → UNTDID 2475 (modèle) ; un code non prévu est gardé tel quel.</summary>
    private static readonly Dictionary<string, string> ExigibiliteTva = new()
    {
        [CodeExigibiliteTvaUbl.DateFacture] = CodeExigibiliteTva.DateFacture,
        [CodeExigibiliteTvaUbl.DateLivraison] = CodeExigibiliteTva.DateLivraison,
        [CodeExigibiliteTvaUbl.DatePaiement] = CodeExigibiliteTva.DatePaiement,
    };

    /// <summary>Note UBL « #CODE#texte » (BT-21 entre dièses en tête, BR-FR-05).</summary>
    [GeneratedRegex(@"^#([A-Za-z0-9]{1,3})#(.*)$", RegexOptions.Singleline)]
    private static partial Regex RegexNote();

    /// <summary>Lit une facture ou un avoir UBL (octets du XML).</summary>
    public static Facture Lire(byte[] xml, bool validerXsd = true) => Lire(OutilsLecture.Charger(xml), validerXsd);

    /// <summary>Lit une facture ou un avoir UBL déjà chargé.</summary>
    public static Facture Lire(XDocument document, bool validerXsd = true)
    {
        var racine = document.Root;
        var avoir = racine?.Name == EspaceAvoir + "CreditNote";
        if (racine is null || (!avoir && racine.Name != EspaceFacture + "Invoice"))
            throw new ExceptionLectureFacture(ErreurFe.SyntaxeInconnue, $"Élément racine non UBL Invoice ou CreditNote : {racine?.Name}");

        var specification = Texte(racine, "CustomizationID");
        var profil = Profil(specification);
        if (validerXsd)
        {
            var jeu = avoir ? JeuXsd.UblCreditNote : JeuXsd.UblInvoice;
            var erreurs = ValidationXsd.Valider(document, jeu);
            if (erreurs.Count > 0)
                throw new ExceptionLectureFacture(ErreurFe.XsdInvalide, $"Facture non conforme au schéma {jeu} ({erreurs.Count} erreur(s))", erreurs);
        }
        return Termes(racine, avoir, specification!, profil);
    }

    /// <summary>
    /// Profil (<see cref="ProfilFacture"/>) d'un identifiant de spécification BT-24 en UBL : EN16931, ses CIUS
    /// (« urn:cen.eu:en16931:2017#compliant#… ») et EXTENDED-CTC-FR ; PROFIL_INCONNU sinon (pas de profil Factur-X en UBL).
    /// </summary>
    public static string Profil(string? specification)
    {
        if (specification == SpecificationFacture.ExtendedCtcFr) return ProfilFacture.ExtendedCtcFr;
        if (specification == SpecificationFacture.En16931
            || (specification?.StartsWith(SpecificationFacture.En16931 + "#compliant#", StringComparison.Ordinal) == true
                && specification != SpecificationFacture.Basic))
            return ProfilFacture.En16931;
        throw new ExceptionLectureFacture(ErreurFe.ProfilInconnu, $"Profil (BT-24) non reconnu en UBL : {specification ?? "absent"}");
    }

    // ---------------------------------------------------------------- termes

    private static Facture Termes(XElement racine, bool avoir, string specification, string profil)
    {
        var devise = Texte(racine, "DocumentCurrencyCode") ?? "EUR";
        var deviseTva = Texte(racine, "TaxCurrencyCode");
        var vendeur = racine.Element(Cac + "AccountingSupplierParty")?.Element(Cac + "Party");
        var acheteur = racine.Element(Cac + "AccountingCustomerParty")?.Element(Cac + "Party");
        var moyens = Enfants(racine, "PaymentMeans").ToList();
        var references = Enfants(racine, "AdditionalDocumentReference").ToList();
        var periode = racine.Element(Cac + "InvoicePeriod");
        var taxes = Enfants(racine, "TaxTotal").ToList();
        var codeExigibilite = Texte(periode, "DescriptionCode");
        var typeLigne = avoir ? "CreditNoteLine" : "InvoiceLine";

        return new Facture
        {
            Numero = Exiger(Texte(racine, "ID"), "BT-1"),
            DateEmission = ExigerValeur(Date(racine.Element(Cbc + "IssueDate"), "BT-2"), "BT-2"),
            TypeFacture = Exiger(Texte(racine, avoir ? "CreditNoteTypeCode" : "InvoiceTypeCode"), "BT-3"),
            Devise = devise,
            DeviseTva = deviseTva,
            DateExigibiliteTva = Date(racine.Element(Cbc + "TaxPointDate"), "BT-7"),
            CodeExigibiliteTva = codeExigibilite is null ? null : ExigibiliteTva.GetValueOrDefault(codeExigibilite, codeExigibilite),
            // BT-9 : DueDate de l'Invoice ; PaymentDueDate du premier moyen de paiement qui la porte dans un CreditNote.
            DateEcheance = avoir
                ? moyens.Select(m => Date(m.Element(Cbc + "PaymentDueDate"), "BT-9")).FirstOrDefault(d => d is not null)
                : Date(racine.Element(Cbc + "DueDate"), "BT-9"),
            CadreFacturation = Exiger(Texte(racine, "ProfileID"), "BT-23"),
            Profil = profil,
            Specification = specification,
            References = new ReferencesFacture
            {
                Acheteur = Texte(racine, "BuyerReference"),
                Projet = avoir ? ReferenceDeType(references, TypeDocumentReference.ProjetAvoirUbl) : Texte(racine.Element(Cac + "ProjectReference"), "ID"),
                Contrat = Texte(racine.Element(Cac + "ContractDocumentReference"), "ID"),
                Commande = Texte(racine.Element(Cac + "OrderReference"), "ID"),
                CommandeVendeur = Texte(racine.Element(Cac + "OrderReference"), "SalesOrderID"),
                Reception = Texte(racine.Element(Cac + "ReceiptDocumentReference"), "ID"),
                Expedition = Texte(racine.Element(Cac + "DespatchDocumentReference"), "ID"),
                AppelOffres = Texte(racine.Element(Cac + "OriginatorDocumentReference"), "ID"),
                Objet = ReferenceDeType(references, TypeDocumentReference.ObjetFacture),
                Comptable = Texte(racine, "AccountingCost"),
            },
            ConditionsPaiement = Joindre(Enfants(racine, "PaymentTerms").SelectMany(t => t.Elements(Cbc + "Note")).Select(n => Rogner(n.Value))),
            Notes = racine.Elements(Cbc + "Note").Select(Note).ToList(),
            FacturesAnterieures = Enfants(racine, "BillingReference").Select(b => b.Element(Cac + "InvoiceDocumentReference")).OfType<XElement>()
                .Select(e => new FactureAnterieure(Exiger(Texte(e, "ID"), "BT-25"), Date(e.Element(Cbc + "IssueDate"), "BT-26"), Texte(e, "DocumentTypeCode")))
                .ToList(),
            Vendeur = Exiger(Partie(vendeur, "BT-27"), "BG-4"),
            Acheteur = Exiger(Partie(acheteur, "BT-44"), "BG-7"),
            Beneficiaire = Partie(racine.Element(Cac + "PayeeParty"), "BT-59"),
            RepresentantFiscal = Partie(racine.Element(Cac + "TaxRepresentativeParty"), "BT-62"),
            Payeur = moyens.Select(m => m.Element(Cac + "PaymentMandate")?.Element(Cac + "PayerParty")).OfType<XElement>()
                .Select(p => Partie(p, "EXT-FR-FE-43")).FirstOrDefault(),
            AgentAcheteur = Partie(acheteur?.Element(Cac + "AgentParty"), "EXT-FR-FE-03"),
            AgentVendeur = Partie(vendeur?.Element(Cac + "AgentParty"), "EXT-FR-FE-66"),
            Livraison = Livraison(racine.Element(Cac + "Delivery")),
            Periode = Periode(periode, "BT-73"),
            MoyensPaiement = moyens.Select(MoyenPaiement).ToList(),
            RemisesCharges = Enfants(racine, "AllowanceCharge").Select(e => RemiseCharge(e, document: true)).ToList(),
            Totaux = Totaux(racine.Element(Cac + "LegalMonetaryTotal"), taxes, devise, deviseTva),
            DetailsTva = TaxeEnDevise(taxes, devise)?.Elements(Cac + "TaxSubtotal").Select(DetailTva).ToList() ?? [],
            PiecesJointes = references.Where(r => Texte(r, "DocumentTypeCode") is null or TypeDocumentReference.Justificatif).Select(PieceJointe).ToList(),
            Lignes = Enfants(racine, typeLigne).Select(l => Ligne(l, avoir)).ToList(),
        };
    }

    private static NoteFacture Note(XElement note)
    {
        var texte = note.Value.Trim();
        var m = RegexNote().Match(texte);
        return m.Success ? new NoteFacture(m.Groups[1].Value, m.Groups[2].Value.Trim()) : new NoteFacture(null, texte);
    }

    private static string? ReferenceDeType(IEnumerable<XElement> references, string type) =>
        references.Where(r => Texte(r, "DocumentTypeCode") == type).Select(r => Texte(r, "ID")).FirstOrDefault();

    /// <summary>
    /// Partie UBL : raison sociale = PartyLegalEntity/RegistrationName, à défaut PartyName/Name (bénéficiaire BT-59,
    /// représentant fiscal BT-62) ; nom commercial = PartyName/Name quand la raison sociale est donnée à part.
    /// </summary>
    private static Partie? Partie(XElement? e, string termeNom)
    {
        if (e is null) return null;
        var legal = e.Element(Cac + "PartyLegalEntity");
        var raisonSociale = Texte(legal, "RegistrationName");
        var nom = Texte(e.Element(Cac + "PartyName"), "Name");
        var identifiants = Enfants(e, "PartyIdentification").Select(p => p.Element(Cbc + "ID")).OfType<XElement>()
            .Where(i => i.Attribute("schemeID")?.Value != SchemaIdentifiant.CreancierSepa).Select(Identifiant).ToList();
        var immatriculation = legal?.Element(Cbc + "CompanyID");
        var schemaLegal = immatriculation?.Attribute("schemeID")?.Value;
        string? siren = null;
        if (immatriculation is not null && (schemaLegal is null || schemaLegal == SchemaIdentifiant.Siren)) siren = immatriculation.Value.Trim();
        else if (immatriculation is not null) identifiants.Add(Identifiant(immatriculation));
        var fiscaux = Enfants(e, "PartyTaxScheme").ToList();
        string? Fiscal(bool tva) => fiscaux.Where(f => (Texte(f.Element(Cac + "TaxScheme"), "ID") == SchemaIdentifiant.TvaUbl) == tva)
            .Select(f => Texte(f, "CompanyID")).FirstOrDefault(v => v is not null);
        var adresse = e.Element(Cbc + "EndpointID");
        return new Partie
        {
            RaisonSociale = Exiger(raisonSociale ?? nom, termeNom),
            NomCommercial = raisonSociale is null ? null : nom,
            Identifiants = identifiants,
            Siren = siren,
            NumeroTva = Fiscal(tva: true),
            IdentifiantFiscal = Fiscal(tva: false),
            AdresseElectronique = adresse is null ? null : Identifiant(adresse),
            Adresse = Adresse(e.Element(Cac + "PostalAddress")),
            Contact = Contact(e.Element(Cac + "Contact")),
        };
    }

    private static Identifiant Identifiant(XElement e) => new(e.Value.Trim(), e.Attribute("schemeID")?.Value);

    private static AdressePostale? Adresse(XElement? e) => e is null ? null : new AdressePostale(
        Texte(e, "StreetName"), Texte(e, "AdditionalStreetName"), Texte(e.Element(Cac + "AddressLine"), "Line"), Texte(e, "CityName"),
        Texte(e, "PostalZone"), Texte(e, "CountrySubentity"), Texte(e.Element(Cac + "Country"), "IdentificationCode") ?? "");

    private static Contact? Contact(XElement? e) => e is null ? null : new Contact(Texte(e, "Name"), Texte(e, "Telephone"), Texte(e, "ElectronicMail"));

    private static Livraison? Livraison(XElement? e)
    {
        var lieu = e?.Element(Cac + "DeliveryLocation");
        var partie = e?.Element(Cac + "DeliveryParty");
        var date = Date(e?.Element(Cbc + "ActualDeliveryDate"), "BT-72");
        if (lieu is null && partie is null && date is null) return null;
        var identifiant = lieu?.Element(Cbc + "ID");
        return new Livraison(Texte(partie?.Element(Cac + "PartyName"), "Name"), identifiant is null ? null : Identifiant(identifiant), date,
            Adresse(lieu?.Element(Cac + "Address")));
    }

    /// <summary>Période (BG-14, BG-26) : null sans date de début ni de fin (InvoicePeriod qui ne porte que le BT-8).</summary>
    private static Periode? Periode(XElement? e, string terme)
    {
        var debut = Date(e?.Element(Cbc + "StartDate"), terme);
        var fin = Date(e?.Element(Cbc + "EndDate"), terme);
        return debut is null && fin is null ? null : new Periode(debut, fin);
    }

    private static MoyenPaiement MoyenPaiement(XElement e)
    {
        var compte = e.Element(Cac + "PayeeFinancialAccount");
        return new MoyenPaiement(
            Exiger(Texte(e, "PaymentMeansCode"), "BT-81"), Texte(e, "PaymentID"), Texte(compte, "ID"),
            Texte(compte?.Element(Cac + "FinancialInstitutionBranch"), "ID"), Texte(compte, "Name"));
    }

    private static RemiseCharge RemiseCharge(XElement e, bool document)
    {
        var taxe = document ? e.Element(Cac + "TaxCategory") : null;
        return new RemiseCharge
        {
            Charge = Indicateur(Texte(e, "ChargeIndicator")),
            Montant = ExigerValeur(Montant(e, "Amount"), document ? "BT-92" : "BT-136"),
            Assiette = Montant(e, "BaseAmount"),
            Pourcentage = Montant(e, "MultiplierFactorNumeric"),
            CategorieTva = Texte(taxe, "ID"),
            TauxTva = Montant(taxe, "Percent"),
            Motif = Texte(e, "AllowanceChargeReason"),
            CodeMotif = Texte(e, "AllowanceChargeReasonCode"),
        };
    }

    /// <summary>TaxTotal dont le TaxAmount est dans la devise donnée (BT-110 dans la devise de facture, BT-111 dans celle de la TVA).</summary>
    private static XElement? TaxeEnDevise(IEnumerable<XElement> taxes, string devise) =>
        taxes.FirstOrDefault(t => t.Element(Cbc + "TaxAmount")?.Attribute("currencyID")?.Value is { } c ? c == devise : true);

    private static Totaux Totaux(XElement? e, List<XElement> taxes, string devise, string? deviseTva)
    {
        decimal? TvaEn(string d) => TaxeEnDevise(taxes, d)?.Element(Cbc + "TaxAmount") is { } x ? OutilsLecture.Decimal(x, "BT-110") : null;
        var comptable = deviseTva is not null && deviseTva != devise;
        return new Totaux
        {
            TotalLignes = ExigerValeur(Montant(e, "LineExtensionAmount"), "BT-106"),
            TotalRemises = Montant(e, "AllowanceTotalAmount"),
            TotalCharges = Montant(e, "ChargeTotalAmount"),
            TotalHt = ExigerValeur(Montant(e, "TaxExclusiveAmount"), "BT-109"),
            TotalTva = TvaEn(devise),
            TotalTvaComptable = comptable ? TvaEn(deviseTva!) : null,
            TotalTtc = ExigerValeur(Montant(e, "TaxInclusiveAmount"), "BT-112"),
            DejaPaye = Montant(e, "PrepaidAmount"),
            Arrondi = Montant(e, "PayableRoundingAmount"),
            NetAPayer = ExigerValeur(Montant(e, "PayableAmount"), "BT-115"),
        };
    }

    private static DetailTva DetailTva(XElement e)
    {
        var categorie = e.Element(Cac + "TaxCategory");
        return new DetailTva
        {
            Base = ExigerValeur(Montant(e, "TaxableAmount"), "BT-116"),
            Montant = ExigerValeur(Montant(e, "TaxAmount"), "BT-117"),
            Categorie = Exiger(Texte(categorie, "ID"), "BT-118"),
            Taux = Montant(categorie, "Percent"),
            MotifExoneration = Texte(categorie, "TaxExemptionReason"),
            CodeExoneration = Texte(categorie, "TaxExemptionReasonCode"),
        };
    }

    private static PieceJointe PieceJointe(XElement e)
    {
        var piece = e.Element(Cac + "Attachment");
        var binaire = piece?.Element(Cbc + "EmbeddedDocumentBinaryObject");
        byte[]? contenu = null;
        if (binaire is not null)
        {
            try { contenu = Convert.FromBase64String(binaire.Value.Trim()); }
            catch (FormatException) { throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, "Pièce jointe (BT-125) : base 64 illisible"); }
        }
        return new PieceJointe(
            Exiger(Texte(e, "ID"), "BT-122"), Texte(e, "DocumentDescription"), Texte(piece?.Element(Cac + "ExternalReference"), "URI"), contenu,
            binaire?.Attribute("mimeCode")?.Value, binaire?.Attribute("filename")?.Value);
    }

    private static LigneFacture Ligne(XElement e, bool avoir)
    {
        var article = e.Element(Cac + "Item");
        var prix = e.Element(Cac + "Price");
        var rabais = prix?.Element(Cac + "AllowanceCharge");
        var quantite = e.Element(Cbc + (avoir ? "CreditedQuantity" : "InvoicedQuantity"));
        var taxe = article?.Element(Cac + "ClassifiedTaxCategory");
        // EXTENDED-CTC-FR : le BillingReference qui porte un DocumentStatusCode donne le sous-type (EXT-FR-FE-163) et la
        // ligne parente (EXT-FR-FE-162) ; un autre BillingReference de ligne est une facture antérieure (EXT-FR-FE-BG-06).
        var references = Enfants(e, "BillingReference").ToList();
        var sousLigne = references.FirstOrDefault(r => Texte(r.Element(Cac + "InvoiceDocumentReference"), "DocumentStatusCode") is not null);
        var anterieure = references.FirstOrDefault(r => r != sousLigne);
        var documentAnterieur = anterieure?.Element(Cac + "InvoiceDocumentReference");
        var sousType = Texte(sousLigne?.Element(Cac + "InvoiceDocumentReference"), "DocumentStatusCode");
        // Une ligne de groupe ou d'information peut n'avoir ni quantité, ni prix, ni TVA : quantité et prix lus à 0, unité vide.
        var prixFacultatif = sousType is SousTypeLigne.Groupe or SousTypeLigne.Information;
        return new LigneFacture
        {
            Identifiant = Exiger(Texte(e, "ID"), "BT-126"),
            LigneParente = Texte(sousLigne?.Element(Cac + "BillingReferenceLine"), "ID"),
            SousType = sousType,
            Note = Joindre(e.Elements(Cbc + "Note").Select(n => Rogner(n.Value)), "\n"),
            Quantite = quantite is not null ? OutilsLecture.Decimal(quantite, "BT-129") : prixFacultatif ? 0m : throw Absent("BT-129"),
            Unite = quantite?.Attribute("unitCode")?.Value ?? (prixFacultatif ? "" : throw Absent("BT-130")),
            MontantNet = ExigerValeur(Montant(e, "LineExtensionAmount"), "BT-131"),
            LigneCommande = Texte(e.Element(Cac + "OrderLineReference"), "LineID"),
            ReferenceComptable = Texte(e, "AccountingCost"),
            FactureAnterieure = documentAnterieur is null ? null : new FactureAnterieureLigne(
                Exiger(Texte(documentAnterieur, "ID"), "EXT-FR-FE-136"), Texte(documentAnterieur, "DocumentTypeCode"),
                Date(documentAnterieur.Element(Cbc + "IssueDate"), "EXT-FR-FE-138"), Texte(anterieure!.Element(Cac + "BillingReferenceLine"), "ID")),
            Periode = Periode(e.Element(Cac + "InvoicePeriod"), "BT-134"),
            RemisesCharges = Enfants(e, "AllowanceCharge").Select(r => RemiseCharge(r, document: false)).ToList(),
            PrixNet = Montant(prix, "PriceAmount") ?? (prixFacultatif ? 0m : throw Absent("BT-146")),
            // BT-147 : l'AllowanceCharge du prix porte aussi le prix brut (BT-148) ; un montant nul n'est pas un rabais.
            Rabais = Montant(rabais, "Amount") is { } r && r != 0 ? r : null,
            PrixBrut = Montant(rabais, "BaseAmount"),
            QuantiteBase = Montant(prix, "BaseQuantity"),
            CategorieTva = Texte(taxe, "ID"),
            TauxTva = Montant(taxe, "Percent"),
            Nom = Exiger(Texte(article, "Name"), "BT-153"),
            Description = Texte(article, "Description"),
            ReferenceVendeur = Texte(article?.Element(Cac + "SellersItemIdentification"), "ID"),
            ReferenceAcheteur = Texte(article?.Element(Cac + "BuyersItemIdentification"), "ID"),
        };
    }

    // ---------------------------------------------------------------- outils

    private static IEnumerable<XElement> Enfants(XElement? e, string nom) => e?.Elements(Cac + nom) ?? [];

    private static string? Rogner(string valeur)
    {
        var v = valeur.Trim();
        return v.Length == 0 ? null : v;
    }

    /// <summary>Texte (rogné, null si vide) de l'élément cbc: <paramref name="nom"/> sous <paramref name="e"/>.</summary>
    private static string? Texte(XElement? e, string nom) => e?.Element(Cbc + nom) is { } x ? Rogner(x.Value) : null;

    private static decimal? Montant(XElement? e, string nom) => e?.Element(Cbc + nom) is { } x ? OutilsLecture.Decimal(x, nom) : null;

    /// <summary>Date UBL (xsd:date « AAAA-MM-JJ »).</summary>
    private static DateOnly? Date(XElement? e, string terme)
    {
        if (e is null) return null;
        if (DateOnly.TryParseExact(e.Value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, $"Date illisible ({terme}) : {e.Value}");
    }
}
