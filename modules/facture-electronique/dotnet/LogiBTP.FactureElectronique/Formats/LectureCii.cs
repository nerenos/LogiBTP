using System.Globalization;
using System.Xml.Linq;
using static LogiBTP.FactureElectronique.Formats.OutilsLecture;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>
/// Lecture d'une facture UN/CEFACT CII D22B (CII seul ou XML d'un Factur-X) vers le modèle sémantique <see cref="Facture"/>.
/// Profils BASIC WL, BASIC, EN16931, EXTENDED (Factur-X) et EXTENDED-CTC-FR ; chemins de l'annexe A XP Z12-012 V1.4
/// (onglets « CII D22B &amp; FX EN16931 FR » et « CII D22B &amp; FX EXT-CTC-FR »). Étapes : syntaxe XML (sans DTD ni
/// entité externe), élément racine, profil (BT-24), XSD du profil, puis termes. Montants, quantités et prix en décimal
/// exact. Toute erreur lève <see cref="ExceptionLectureFacture"/> (code <see cref="ErreurFe"/>).
/// </summary>
public static class LectureCii
{
    /// <summary>Espace de noms de l'élément racine CrossIndustryInvoice.</summary>
    public static readonly XNamespace Rsm = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100";
    /// <summary>Espace de noms des agrégats réutilisables.</summary>
    public static readonly XNamespace Ram = "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100";
    /// <summary>Espace de noms des types non qualifiés.</summary>
    public static readonly XNamespace Udt = "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100";
    /// <summary>Espace de noms des types qualifiés.</summary>
    public static readonly XNamespace Qdt = "urn:un:unece:uncefact:data:standard:QualifiedDataType:100";

    /// <summary>Format de date UNTDID 2379 « AAAAMMJJ », seul format des dates de facture (BR-FR, EN16931).</summary>
    private const string FormatDate102 = "102";

    /// <summary>Lit une facture CII (octets du XML) ; <paramref name="facturX"/> : XML extrait d'un Factur-X (XSD Factur-X du profil).</summary>
    public static Facture Lire(byte[] xml, bool facturX = false, bool validerXsd = true) =>
        Lire(Charger(xml), facturX, validerXsd);

    /// <summary>Lit une facture CII déjà chargée.</summary>
    public static Facture Lire(XDocument document, bool facturX = false, bool validerXsd = true)
    {
        var racine = document.Root;
        if (racine is null || racine.Name != Rsm + "CrossIndustryInvoice")
            throw new ExceptionLectureFacture(ErreurFe.SyntaxeInconnue, $"Élément racine non CII : {racine?.Name}");

        var contexte = racine.Element(Rsm + "ExchangedDocumentContext");
        var specification = Texte(contexte, "GuidelineSpecifiedDocumentContextParameter", "ID");
        var (profil, jeu) = Profil(specification, facturX);

        if (validerXsd)
        {
            var erreurs = ValidationXsd.Valider(document, jeu);
            if (erreurs.Count > 0)
                throw new ExceptionLectureFacture(ErreurFe.XsdInvalide, $"Facture non conforme au schéma {jeu} ({erreurs.Count} erreur(s))", erreurs);
        }

        return Termes(racine, contexte, specification!, profil);
    }

    /// <summary>Charge le XML sans DTD ni résolution externe (XML_ILLISIBLE si mal formé), lignes conservées pour les messages XSD.</summary>
    public static XDocument Charger(byte[] xml) => OutilsLecture.Charger(xml);

    /// <summary>Profil (<see cref="ProfilFacture"/>) et jeu XSD d'un identifiant de spécification BT-24 (PROFIL_INCONNU sinon).</summary>
    public static (string Profil, JeuXsd Jeu) Profil(string? specification, bool facturX) => specification switch
    {
        SpecificationFacture.BasicWl => (ProfilFacture.Basic, facturX ? JeuXsd.FacturXBasicWl : JeuXsd.CiiD22B),
        SpecificationFacture.Basic => (ProfilFacture.Basic, facturX ? JeuXsd.FacturXEn16931 : JeuXsd.CiiD22B),
        SpecificationFacture.En16931 => (ProfilFacture.En16931, facturX ? JeuXsd.FacturXEn16931 : JeuXsd.CiiD22B),
        SpecificationFacture.Extended or SpecificationFacture.ExtendedZugferd or SpecificationFacture.ExtendedCtcFr =>
            (ProfilFacture.ExtendedCtcFr, facturX ? JeuXsd.FacturXExtended : JeuXsd.CiiD22B),
        _ => throw new ExceptionLectureFacture(ErreurFe.ProfilInconnu, $"Profil (BT-24) non reconnu : {specification ?? "absent"}"),
    };

    // ---------------------------------------------------------------- termes

    private static Facture Termes(XElement racine, XElement? contexte, string specification, string profil)
    {
        var document = racine.Element(Rsm + "ExchangedDocument");
        var transaction = racine.Element(Rsm + "SupplyChainTradeTransaction");
        var accord = transaction?.Element(Ram + "ApplicableHeaderTradeAgreement");
        var livraison = transaction?.Element(Ram + "ApplicableHeaderTradeDelivery");
        var reglement = transaction?.Element(Ram + "ApplicableHeaderTradeSettlement");
        var devise = Texte(reglement, "InvoiceCurrencyCode") ?? "EUR";
        var deviseTva = Texte(reglement, "TaxCurrencyCode");
        var taxes = Enfants(reglement, "ApplicableTradeTax").ToList();
        var termes = Enfants(reglement, "SpecifiedTradePaymentTerms").ToList();
        var references = Enfants(accord, "AdditionalReferencedDocument").ToList();

        return new Facture
        {
            Numero = Exiger(Texte(document, "ID"), "BT-1"),
            DateEmission = ExigerValeur(Date(document?.Element(Ram + "IssueDateTime"), "BT-2"), "BT-2"),
            TypeFacture = Exiger(Texte(document, "TypeCode"), "BT-3"),
            Devise = devise,
            DeviseTva = deviseTva,
            DateExigibiliteTva = taxes.Select(t => Date(t.Element(Ram + "TaxPointDate"), "BT-7")).FirstOrDefault(d => d is not null),
            CodeExigibiliteTva = taxes.Select(t => Texte(t, "DueDateTypeCode")).FirstOrDefault(c => c is not null),
            DateEcheance = termes.Select(t => Date(t.Element(Ram + "DueDateDateTime"), "BT-9")).FirstOrDefault(d => d is not null),
            CadreFacturation = Exiger(Texte(contexte, "BusinessProcessSpecifiedDocumentContextParameter", "ID"), "BT-23"),
            Profil = profil,
            Specification = specification,
            References = new ReferencesFacture
            {
                Acheteur = Texte(accord, "BuyerReference"),
                Projet = Texte(accord, "SpecifiedProcuringProject", "ID"),
                Contrat = Texte(accord, "ContractReferencedDocument", "IssuerAssignedID"),
                Commande = Texte(accord, "BuyerOrderReferencedDocument", "IssuerAssignedID"),
                CommandeVendeur = Texte(accord, "SellerOrderReferencedDocument", "IssuerAssignedID"),
                Reception = Texte(livraison, "ReceivingAdviceReferencedDocument", "IssuerAssignedID"),
                Expedition = Texte(livraison, "DespatchAdviceReferencedDocument", "IssuerAssignedID"),
                AppelOffres = ReferenceDeType(references, TypeDocumentReference.AppelOffres),
                Objet = ReferenceDeType(references, TypeDocumentReference.ObjetFacture),
                Comptable = Texte(reglement, "ReceivableSpecifiedTradeAccountingAccount", "ID"),
            },
            ConditionsPaiement = Joindre(termes.Select(t => Texte(t, "Description"))),
            Notes = Enfants(document, "IncludedNote").Select(Note).ToList(),
            FacturesAnterieures = Enfants(reglement, "InvoiceReferencedDocument").Select(e => new FactureAnterieure(
                Exiger(Texte(e, "IssuerAssignedID"), "BT-25"), Date(e.Element(Ram + "FormattedIssueDateTime"), "BT-26"), Texte(e, "TypeCode"))).ToList(),
            Vendeur = Exiger(Partie(accord?.Element(Ram + "SellerTradeParty"), "BT-27"), "BG-4"),
            Acheteur = Exiger(Partie(accord?.Element(Ram + "BuyerTradeParty"), "BT-44"), "BG-7"),
            Beneficiaire = Partie(reglement?.Element(Ram + "PayeeTradeParty"), "BT-59"),
            RepresentantFiscal = Partie(accord?.Element(Ram + "SellerTaxRepresentativeTradeParty"), "BT-62"),
            Payeur = Partie(reglement?.Element(Ram + "PayerTradeParty"), "EXT-FR-FE-43"),
            AgentAcheteur = Partie(accord?.Element(Ram + "BuyerAgentTradeParty"), "EXT-FR-FE-03"),
            AgentVendeur = Partie(accord?.Element(Ram + "SalesAgentTradeParty"), "EXT-FR-FE-66"),
            Livraison = Livraison(livraison),
            Periode = Periode(reglement?.Element(Ram + "BillingSpecifiedPeriod"), "BT-73"),
            MoyensPaiement = Enfants(reglement, "SpecifiedTradeSettlementPaymentMeans").Select(m => MoyenPaiement(m, Texte(reglement, "PaymentReference"))).ToList(),
            RemisesCharges = Enfants(reglement, "SpecifiedTradeAllowanceCharge").Select(e => RemiseCharge(e, document: true)).ToList(),
            Totaux = Totaux(reglement?.Element(Ram + "SpecifiedTradeSettlementHeaderMonetarySummation"), devise, deviseTva),
            DetailsTva = taxes.Select(DetailTva).ToList(),
            PiecesJointes = references.Where(r => Texte(r, "TypeCode") == TypeDocumentReference.Justificatif).Select(PieceJointe).ToList(),
            Lignes = Enfants(transaction, "IncludedSupplyChainTradeLineItem").Select(Ligne).ToList(),
        };
    }

    private static NoteFacture Note(XElement note) =>
        new(Texte(note, "SubjectCode"), Joindre(Enfants(note, "Content").Select(c => c.Value.Trim()), "\n") ?? "");

    private static string? ReferenceDeType(IEnumerable<XElement> references, string type) =>
        references.Where(r => Texte(r, "TypeCode") == type).Select(r => Texte(r, "IssuerAssignedID")).FirstOrDefault();

    private static Partie? Partie(XElement? e, string termeNom)
    {
        if (e is null) return null;
        var organisation = e.Element(Ram + "SpecifiedLegalOrganization");
        var legal = organisation?.Element(Ram + "ID");
        var schemaLegal = legal?.Attribute("schemeID")?.Value;
        var identifiants = Enfants(e, "ID").Concat(Enfants(e, "GlobalID")).Select(Identifiant).ToList();
        string? siren = null;
        if (legal is not null && (schemaLegal is null || schemaLegal == SchemaIdentifiant.Siren)) siren = legal.Value.Trim();
        else if (legal is not null) identifiants.Add(Identifiant(legal));
        var fiscaux = Enfants(e, "SpecifiedTaxRegistration").Select(t => t.Element(Ram + "ID")).OfType<XElement>().ToList();
        var uri = e.Element(Ram + "URIUniversalCommunication")?.Element(Ram + "URIID");
        return new Partie
        {
            RaisonSociale = Exiger(Texte(e, "Name"), termeNom),
            NomCommercial = Texte(organisation, "TradingBusinessName"),
            Identifiants = identifiants,
            Siren = siren,
            NumeroTva = fiscaux.FirstOrDefault(f => f.Attribute("schemeID")?.Value == SchemaIdentifiant.Tva)?.Value.Trim(),
            IdentifiantFiscal = fiscaux.FirstOrDefault(f => f.Attribute("schemeID")?.Value == SchemaIdentifiant.Fiscal)?.Value.Trim(),
            AdresseElectronique = uri is null ? null : Identifiant(uri),
            Adresse = Adresse(e.Element(Ram + "PostalTradeAddress")),
            Contact = Contact(e.Element(Ram + "DefinedTradeContact")),
        };
    }

    private static Identifiant Identifiant(XElement e) => new(e.Value.Trim(), e.Attribute("schemeID")?.Value);

    private static AdressePostale? Adresse(XElement? e) => e is null ? null : new AdressePostale(
        Texte(e, "LineOne"), Texte(e, "LineTwo"), Texte(e, "LineThree"), Texte(e, "CityName"), Texte(e, "PostcodeCode"),
        Texte(e, "CountrySubDivisionName"), Texte(e, "CountryID") ?? "");

    // BT-41 / BT-56 : PersonName seul ; DepartmentName (BT-41-0, sans terme EN16931 ni équivalent UBL) n'est pas lu.
    private static Contact? Contact(XElement? e) => e is null ? null : new Contact(
        Texte(e, "PersonName"),
        Texte(e, "TelephoneUniversalCommunication", "CompleteNumber"),
        Texte(e, "EmailURIUniversalCommunication", "URIID"));

    private static Livraison? Livraison(XElement? e)
    {
        var lieu = e?.Element(Ram + "ShipToTradeParty");
        var date = Date(e?.Element(Ram + "ActualDeliverySupplyChainEvent")?.Element(Ram + "OccurrenceDateTime"), "BT-72");
        if (lieu is null && date is null) return null;
        var identifiant = lieu?.Element(Ram + "ID") ?? lieu?.Element(Ram + "GlobalID");
        return new Livraison(Texte(lieu, "Name"), identifiant is null ? null : Identifiant(identifiant), date, Adresse(lieu?.Element(Ram + "PostalTradeAddress")));
    }

    private static Periode? Periode(XElement? e, string terme) => e is null ? null : new Periode(
        Date(e.Element(Ram + "StartDateTime"), terme), Date(e.Element(Ram + "EndDateTime"), terme));

    private static MoyenPaiement MoyenPaiement(XElement e, string? reference)
    {
        var compte = e.Element(Ram + "PayeePartyCreditorFinancialAccount");
        return new MoyenPaiement(
            Exiger(Texte(e, "TypeCode"), "BT-81"), reference,
            Texte(compte, "IBANID") ?? Texte(compte, "ProprietaryID"),
            Texte(e, "PayeeSpecifiedCreditorFinancialInstitution", "BICID"),
            Texte(compte, "AccountName"));
    }

    private static RemiseCharge RemiseCharge(XElement e, bool document)
    {
        var indicateur = e.Element(Ram + "ChargeIndicator")?.Element(Udt + "Indicator")?.Value.Trim();
        var taxe = document ? e.Element(Ram + "CategoryTradeTax") : null;
        return new RemiseCharge
        {
            Charge = OutilsLecture.Indicateur(indicateur),
            Montant = ExigerValeur(Montant(e, "ActualAmount"), document ? "BT-92" : "BT-136"),
            Assiette = Montant(e, "BasisAmount"),
            Pourcentage = Montant(e, "CalculationPercent"),
            CategorieTva = Texte(taxe, "CategoryCode"),
            TauxTva = Montant(taxe, "RateApplicablePercent"),
            Motif = Texte(e, "Reason"),
            CodeMotif = Texte(e, "ReasonCode"),
        };
    }

    private static Totaux Totaux(XElement? e, string devise, string? deviseTva)
    {
        var tva = Enfants(e, "TaxTotalAmount").ToList();
        decimal? TvaEn(Func<string?, bool> filtre) => tva.Where(t => filtre(t.Attribute("currencyID")?.Value)).Select(t => Decimal(t, "BT-110")).FirstOrDefault();
        var comptable = deviseTva is not null && deviseTva != devise;
        return new Totaux
        {
            TotalLignes = ExigerValeur(Montant(e, "LineTotalAmount"), "BT-106"),
            TotalRemises = Montant(e, "AllowanceTotalAmount"),
            TotalCharges = Montant(e, "ChargeTotalAmount"),
            TotalHt = ExigerValeur(Montant(e, "TaxBasisTotalAmount"), "BT-109"),
            TotalTva = TvaEn(c => c is null || c == devise),
            TotalTvaComptable = comptable ? TvaEn(c => c == deviseTva) : null,
            TotalTtc = ExigerValeur(Montant(e, "GrandTotalAmount"), "BT-112"),
            DejaPaye = Montant(e, "TotalPrepaidAmount"),
            Arrondi = Montant(e, "RoundingAmount"),
            NetAPayer = ExigerValeur(Montant(e, "DuePayableAmount"), "BT-115"),
        };
    }

    private static DetailTva DetailTva(XElement e) => new()
    {
        Base = ExigerValeur(Montant(e, "BasisAmount"), "BT-116"),
        Montant = ExigerValeur(Montant(e, "CalculatedAmount"), "BT-117"),
        Categorie = Exiger(Texte(e, "CategoryCode"), "BT-118"),
        Taux = Montant(e, "RateApplicablePercent"),
        MotifExoneration = Texte(e, "ExemptionReason"),
        CodeExoneration = Texte(e, "ExemptionReasonCode"),
    };

    private static PieceJointe PieceJointe(XElement e)
    {
        var binaire = e.Element(Ram + "AttachmentBinaryObject");
        byte[]? contenu = null;
        if (binaire is not null)
        {
            try { contenu = Convert.FromBase64String(binaire.Value.Trim()); }
            catch (FormatException) { throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, "Pièce jointe (BT-125) : base 64 illisible"); }
        }
        return new PieceJointe(
            Exiger(Texte(e, "IssuerAssignedID"), "BT-122"), Texte(e, "Name"), Texte(e, "URIID"), contenu,
            binaire?.Attribute("mimeCode")?.Value, binaire?.Attribute("filename")?.Value);
    }

    private static LigneFacture Ligne(XElement e)
    {
        var document = e.Element(Ram + "AssociatedDocumentLineDocument");
        var produit = e.Element(Ram + "SpecifiedTradeProduct");
        var accord = e.Element(Ram + "SpecifiedLineTradeAgreement");
        var brut = accord?.Element(Ram + "GrossPriceProductTradePrice");
        var net = accord?.Element(Ram + "NetPriceProductTradePrice");
        var quantite = e.Element(Ram + "SpecifiedLineTradeDelivery")?.Element(Ram + "BilledQuantity");
        var reglement = e.Element(Ram + "SpecifiedLineTradeSettlement");
        var taxe = reglement?.Element(Ram + "ApplicableTradeTax");
        var anterieure = reglement?.Element(Ram + "InvoiceReferencedDocument");
        var sousType = Texte(document, "LineStatusReasonCode");
        // Une ligne de groupe ou d'information (EXTENDED-CTC-FR, EXT-FR-FE-163) peut n'avoir ni quantité, ni prix, ni TVA :
        // quantité et prix lus à 0, unité vide.
        var prixFacultatif = sousType is SousTypeLigne.Groupe or SousTypeLigne.Information;
        return new LigneFacture
        {
            Identifiant = Exiger(Texte(document, "LineID"), "BT-126"),
            LigneParente = Texte(document, "ParentLineID"),
            SousType = sousType,
            Note = Joindre(Enfants(document, "IncludedNote").Select(n => Texte(n, "Content")), "\n"),
            Quantite = quantite is not null ? Decimal(quantite, "BT-129") : prixFacultatif ? 0m : throw Absent("BT-129"),
            Unite = quantite?.Attribute("unitCode")?.Value ?? (prixFacultatif ? "" : throw Absent("BT-130")),
            MontantNet = ExigerValeur(Montant(reglement?.Element(Ram + "SpecifiedTradeSettlementLineMonetarySummation"), "LineTotalAmount"), "BT-131"),
            LigneCommande = Texte(accord, "BuyerOrderReferencedDocument", "LineID"),
            ReferenceComptable = Texte(reglement, "ReceivableSpecifiedTradeAccountingAccount", "ID"),
            FactureAnterieure = anterieure is null ? null : new FactureAnterieureLigne(
                Exiger(Texte(anterieure, "IssuerAssignedID"), "EXT-FR-FE-136"), Texte(anterieure, "TypeCode"),
                Date(anterieure.Element(Ram + "FormattedIssueDateTime"), "EXT-FR-FE-138"), Texte(anterieure, "LineID")),
            Periode = Periode(reglement?.Element(Ram + "BillingSpecifiedPeriod"), "BT-134"),
            RemisesCharges = Enfants(reglement, "SpecifiedTradeAllowanceCharge").Select(r => RemiseCharge(r, document: false)).ToList(),
            PrixNet = Montant(net, "ChargeAmount") ?? (prixFacultatif ? 0m : throw Absent("BT-146")),
            Rabais = Montant(brut?.Element(Ram + "AppliedTradeAllowanceCharge"), "ActualAmount"),
            PrixBrut = Montant(brut, "ChargeAmount"),
            QuantiteBase = Montant(net, "BasisQuantity"),
            CategorieTva = Texte(taxe, "CategoryCode"),
            TauxTva = Montant(taxe, "RateApplicablePercent"),
            Nom = Exiger(Texte(produit, "Name"), "BT-153"),
            Description = Texte(produit, "Description"),
            ReferenceVendeur = Texte(produit, "SellerAssignedID"),
            ReferenceAcheteur = Texte(produit, "BuyerAssignedID"),
        };
    }

    // ---------------------------------------------------------------- outils

    private static IEnumerable<XElement> Enfants(XElement? e, string nom) => e?.Elements(Ram + nom) ?? [];

    /// <summary>Texte (rogné, null si vide) du chemin d'éléments ram: sous <paramref name="e"/>.</summary>
    private static string? Texte(XElement? e, params string[] chemin)
    {
        foreach (var nom in chemin) e = e?.Element(Ram + nom);
        var valeur = e?.Value.Trim();
        return string.IsNullOrEmpty(valeur) ? null : valeur;
    }

    private static decimal? Montant(XElement? e, string nom)
    {
        var x = e?.Element(Ram + nom);
        return x is null ? null : Decimal(x, nom);
    }

    /// <summary>Date d'un conteneur (enfant udt:DateTimeString, qdt:DateTimeString ou udt:DateString, format 102).</summary>
    private static DateOnly? Date(XElement? conteneur, string terme)
    {
        var e = conteneur?.Elements().FirstOrDefault();
        if (e is null) return null;
        var format = e.Attribute("format")?.Value ?? FormatDate102;
        if (format == FormatDate102 && DateOnly.TryParseExact(e.Value.Trim(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
            return d;
        throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, $"Date illisible ({terme}) : {e.Value} (format {format})");
    }
}
