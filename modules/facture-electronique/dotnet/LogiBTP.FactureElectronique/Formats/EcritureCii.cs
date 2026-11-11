using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>
/// Écriture d'une facture UN/CEFACT CII D22B (plans/facturation-electronique.md, lot 16) depuis le modèle sémantique
/// <see cref="Facture"/> : profils EN16931 (BT-24 <see cref="SpecificationFacture.En16931"/>) et EXTENDED-CTC-FR (payeur,
/// agents, sous-lignes, factures antérieures typées et à la ligne). Chemins de l'annexe A XP Z12-012 V1.4, ordre des éléments
/// du XSD D22B ; tout ce que <see cref="LectureCii"/> lit est écrit (écrit → lu → même modèle). Nombres sans arrondi :
/// montants à 2 décimales au moins (« 100.00 »), quantités, prix et taux sans zéro de fin. Le XML écrit est validé par le XSD
/// (<see cref="ErreurFe.XsdInvalide"/>) ; la complétude (<see cref="ReglesCompletude"/>) se contrôle avant, par l'appelant.
/// </summary>
public static class EcritureCii
{
    private static readonly XNamespace Rsm = LectureCii.Rsm;
    private static readonly XNamespace Ram = LectureCii.Ram;
    private static readonly XNamespace Udt = LectureCii.Udt;
    private static readonly XNamespace Qdt = LectureCii.Qdt;

    /// <summary>Type de taxe (UNTDID 5153) : TVA.</summary>
    private const string TypeTaxe = "VAT";
    /// <summary>Format de date UNTDID 2379 « AAAAMMJJ ».</summary>
    private const string FormatDate102 = "102";
    /// <summary>BT-11 : nom du projet imposé par la correspondance CII d'EN16931 (ProcuringProject/Name obligatoire au XSD).</summary>
    public const string NomProjet = "Project reference";

    /// <summary>Facture → XML CII D22B (UTF-8 sans BOM, indenté), validé par le XSD D22B.</summary>
    public static byte[] Ecrire(Facture f)
    {
        var document = Document(f);
        var erreurs = ValidationXsd.Valider(document, JeuXsd.CiiD22B);
        if (erreurs.Count > 0)
            throw new ExceptionLectureFacture(ErreurFe.XsdInvalide, $"Facture écrite non conforme au XSD CII D22B ({erreurs.Count} erreur(s))", erreurs);
        var reglages = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true, IndentChars = "  ", NewLineChars = "\n" };
        using var flux = new MemoryStream();
        using (var ecrivain = XmlWriter.Create(flux, reglages)) document.Save(ecrivain);
        return flux.ToArray();
    }

    /// <summary>Identifiant de spécification (BT-24) écrit pour un profil ; PROFIL_NON_ECRIT hors EN16931 et EXTENDED-CTC-FR.</summary>
    public static string Specification(string? profil) => profil switch
    {
        ProfilFacture.En16931 => SpecificationFacture.En16931,
        ProfilFacture.ExtendedCtcFr => SpecificationFacture.ExtendedCtcFr,
        _ => throw new ExceptionLectureFacture(ErreurFe.ProfilNonEcrit, $"Profil non écrit : {profil ?? "absent"} (EN16931 ou EXTENDED-CTC-FR)"),
    };

    /// <summary>Termes EXTENDED-CTC-FR présents dans une facture (refusés au profil EN16931 : DONNEE_HORS_PROFIL).</summary>
    public static IReadOnlyList<string> Extensions(Facture f)
    {
        var termes = new List<string>();
        if (f.AgentAcheteur is not null) termes.Add("EXT-FR-FE-BG-01");
        if (f.Payeur is not null) termes.Add("EXT-FR-FE-BG-02");
        if (f.AgentVendeur is not null) termes.Add("EXT-FR-FE-BG-03");
        if (f.FacturesAnterieures.Any(a => a.Type is not null)) termes.Add("EXT-FR-FE-02");
        if (f.Lignes.Any(l => l.LigneParente is not null)) termes.Add("EXT-FR-FE-162");
        if (f.Lignes.Any(l => l.SousType is not null)) termes.Add("EXT-FR-FE-163");
        if (f.Lignes.Any(l => l.FactureAnterieure is not null)) termes.Add("EXT-FR-FE-BG-06");
        return termes;
    }

    /// <summary>Document XML de la facture (sans validation).</summary>
    public static XDocument Document(Facture f)
    {
        var specification = Specification(f.Profil);
        var etendu = f.Profil == ProfilFacture.ExtendedCtcFr;
        if (!etendu && Extensions(f) is { Count: > 0 } extensions)
            throw new ExceptionLectureFacture(ErreurFe.DonneeHorsProfil, $"Données EXTENDED-CTC-FR dans une facture EN16931 : {string.Join(", ", extensions)}", extensions);

        var racine = new XElement(Rsm + "CrossIndustryInvoice",
            new XAttribute(XNamespace.Xmlns + "rsm", Rsm.NamespaceName),
            new XAttribute(XNamespace.Xmlns + "ram", Ram.NamespaceName),
            new XAttribute(XNamespace.Xmlns + "udt", Udt.NamespaceName),
            new XAttribute(XNamespace.Xmlns + "qdt", Qdt.NamespaceName),
            new XElement(Rsm + "ExchangedDocumentContext",
                R("BusinessProcessSpecifiedDocumentContextParameter", R("ID", f.CadreFacturation)),
                R("GuidelineSpecifiedDocumentContextParameter", R("ID", specification))),
            new XElement(Rsm + "ExchangedDocument",
                R("ID", f.Numero),
                R("TypeCode", f.TypeFacture),
                R("IssueDateTime", DateUdt(f.DateEmission)),
                f.Notes.Select(n => R("IncludedNote", R("Content", n.Texte), Opt("SubjectCode", n.CodeSujet)))),
            new XElement(Rsm + "SupplyChainTradeTransaction",
                f.Lignes.Select(l => Ligne(l, etendu)),
                Accord(f),
                Livraison(f),
                Reglement(f, etendu)));
        return new XDocument(new XDeclaration("1.0", "UTF-8", null), racine);
    }

    // ---------------------------------------------------------------- lignes

    private static XElement Ligne(LigneFacture l, bool etendu)
    {
        var facultative = l.SousType is SousTypeLigne.Groupe or SousTypeLigne.Information;
        var unite = string.IsNullOrEmpty(l.Unite) ? null : l.Unite;
        XElement? brut = l.PrixBrut is { } pb
            ? R("GrossPriceProductTradePrice", R("ChargeAmount", Nombre(pb)),
                l.Rabais is { } rabais ? R("AppliedTradeAllowanceCharge", R("ChargeIndicator", new XElement(Udt + "Indicator", "false")), R("ActualAmount", Nombre(rabais))) : null)
            : null;
        XElement? net = !facultative || l.PrixNet != 0m || l.QuantiteBase is not null
            ? R("NetPriceProductTradePrice", R("ChargeAmount", Nombre(l.PrixNet)), l.QuantiteBase is { } qb ? Quantite("BasisQuantity", qb, unite) : null)
            : null;
        XElement? commande = l.LigneCommande is null ? null : R("BuyerOrderReferencedDocument", R("LineID", l.LigneCommande));
        XElement? accord = commande is null && brut is null && net is null ? null : R("SpecifiedLineTradeAgreement", commande, brut, net);
        XElement? taxe = l.CategorieTva is null && l.TauxTva is null ? null
            : R("ApplicableTradeTax", R("TypeCode", TypeTaxe), Opt("CategoryCode", l.CategorieTva), l.TauxTva is { } t ? R("RateApplicablePercent", Nombre(t)) : null);
        XElement? anterieure = l.FactureAnterieure is not { } a ? null
            : R("InvoiceReferencedDocument", R("IssuerAssignedID", a.Numero), Opt("LineID", a.Ligne), Opt("TypeCode", a.Type),
                a.Date is { } d ? R("FormattedIssueDateTime", DateQdt(d)) : null);
        return R("IncludedSupplyChainTradeLineItem",
            R("AssociatedDocumentLineDocument",
                R("LineID", l.Identifiant),
                etendu ? Opt("ParentLineID", l.LigneParente) : null,
                etendu ? Opt("LineStatusReasonCode", l.SousType) : null,
                l.Note is null ? null : R("IncludedNote", R("Content", l.Note))),
            R("SpecifiedTradeProduct",
                Opt("SellerAssignedID", l.ReferenceVendeur),
                Opt("BuyerAssignedID", l.ReferenceAcheteur),
                R("Name", l.Nom),
                Opt("Description", l.Description)),
            accord,
            R("SpecifiedLineTradeDelivery", unite is null && facultative ? null : Quantite("BilledQuantity", l.Quantite, unite)),
            R("SpecifiedLineTradeSettlement",
                taxe,
                Periode(l.Periode),
                l.RemisesCharges.Select(r => RemiseCharge(r, document: false)),
                R("SpecifiedTradeSettlementLineMonetarySummation", R("LineTotalAmount", Montant(l.MontantNet))),
                etendu ? anterieure : null,
                l.ReferenceComptable is null ? null : R("ReceivableSpecifiedTradeAccountingAccount", R("ID", l.ReferenceComptable))));
    }

    // ---------------------------------------------------------------- entête

    private static XElement Accord(Facture f)
    {
        var refs = f.References;
        return R("ApplicableHeaderTradeAgreement",
            Opt("BuyerReference", refs.Acheteur),
            Partie("SellerTradeParty", f.Vendeur),
            Partie("BuyerTradeParty", f.Acheteur),
            Partie("SalesAgentTradeParty", f.AgentVendeur),
            Partie("SellerTaxRepresentativeTradeParty", f.RepresentantFiscal),
            Reference("SellerOrderReferencedDocument", refs.CommandeVendeur),
            Reference("BuyerOrderReferencedDocument", refs.Commande),
            Reference("ContractReferencedDocument", refs.Contrat),
            refs.AppelOffres is null ? null : R("AdditionalReferencedDocument", R("IssuerAssignedID", refs.AppelOffres), R("TypeCode", TypeDocumentReference.AppelOffres)),
            refs.Objet is null ? null : R("AdditionalReferencedDocument", R("IssuerAssignedID", refs.Objet), R("TypeCode", TypeDocumentReference.ObjetFacture)),
            f.PiecesJointes.Select(PieceJointe),
            Partie("BuyerAgentTradeParty", f.AgentAcheteur),
            refs.Projet is null ? null : R("SpecifiedProcuringProject", R("ID", refs.Projet), R("Name", NomProjet)));
    }

    private static XElement Livraison(Facture f)
    {
        var l = f.Livraison;
        XElement? lieu = l is null || (l.Nom is null && l.Lieu is null && l.Adresse is null) ? null
            : R("ShipToTradeParty", Identifiant(l.Lieu), Opt("Name", l.Nom), Adresse(l.Adresse));
        return R("ApplicableHeaderTradeDelivery",
            lieu,
            l?.Date is { } d ? R("ActualDeliverySupplyChainEvent", R("OccurrenceDateTime", DateUdt(d))) : null,
            Reference("DespatchAdviceReferencedDocument", f.References.Expedition),
            Reference("ReceivingAdviceReferencedDocument", f.References.Reception));
    }

    private static XElement Reglement(Facture f, bool etendu)
    {
        var t = f.Totaux;
        var comptable = f.DeviseTva is not null && f.DeviseTva != f.Devise;
        var conditions = f.ConditionsPaiement is null && f.DateEcheance is null ? null
            : R("SpecifiedTradePaymentTerms", Opt("Description", f.ConditionsPaiement), f.DateEcheance is { } e ? R("DueDateDateTime", DateUdt(e)) : null);
        return R("ApplicableHeaderTradeSettlement",
            Opt("PaymentReference", f.MoyensPaiement.Select(m => m.Reference).FirstOrDefault(r => r is not null)),
            Opt("TaxCurrencyCode", f.DeviseTva),
            R("InvoiceCurrencyCode", f.Devise),
            Partie("PayeeTradeParty", f.Beneficiaire),
            Partie("PayerTradeParty", f.Payeur),
            f.MoyensPaiement.Select(MoyenPaiement),
            f.DetailsTva.Select(d => R("ApplicableTradeTax",
                R("CalculatedAmount", Montant(d.Montant)),
                R("TypeCode", TypeTaxe),
                Opt("ExemptionReason", d.MotifExoneration),
                R("BasisAmount", Montant(d.Base)),
                R("CategoryCode", d.Categorie),
                Opt("ExemptionReasonCode", d.CodeExoneration),
                f.DateExigibiliteTva is { } dt ? R("TaxPointDate", new XElement(Udt + "DateString", new XAttribute("format", FormatDate102), Date(dt))) : null,
                Opt("DueDateTypeCode", f.CodeExigibiliteTva),
                d.Taux is { } taux ? R("RateApplicablePercent", Nombre(taux)) : null)),
            Periode(f.Periode),
            f.RemisesCharges.Select(r => RemiseCharge(r, document: true)),
            conditions,
            R("SpecifiedTradeSettlementHeaderMonetarySummation",
                R("LineTotalAmount", Montant(t.TotalLignes)),
                t.TotalCharges is { } tc ? R("ChargeTotalAmount", Montant(tc)) : null,
                t.TotalRemises is { } tr ? R("AllowanceTotalAmount", Montant(tr)) : null,
                R("TaxBasisTotalAmount", Montant(t.TotalHt)),
                t.TotalTva is { } tva ? R("TaxTotalAmount", new XAttribute("currencyID", f.Devise), Montant(tva)) : null,
                comptable && t.TotalTvaComptable is { } tvc ? R("TaxTotalAmount", new XAttribute("currencyID", f.DeviseTva!), Montant(tvc)) : null,
                t.Arrondi is { } ar ? R("RoundingAmount", Montant(ar)) : null,
                R("GrandTotalAmount", Montant(t.TotalTtc)),
                t.DejaPaye is { } dp ? R("TotalPrepaidAmount", Montant(dp)) : null,
                R("DuePayableAmount", Montant(t.NetAPayer))),
            f.FacturesAnterieures.Select(a => R("InvoiceReferencedDocument",
                R("IssuerAssignedID", a.Numero),
                etendu ? Opt("TypeCode", a.Type) : null,
                a.Date is { } d ? R("FormattedIssueDateTime", DateQdt(d)) : null)),
            f.References.Comptable is null ? null : R("ReceivableSpecifiedTradeAccountingAccount", R("ID", f.References.Comptable)));
    }

    private static XElement MoyenPaiement(MoyenPaiement m)
    {
        XElement? compte = m.Iban is null && m.Titulaire is null ? null
            : R("PayeePartyCreditorFinancialAccount", Opt("IBANID", m.Iban), Opt("AccountName", m.Titulaire));
        return R("SpecifiedTradeSettlementPaymentMeans",
            R("TypeCode", m.Code),
            compte,
            m.Bic is null ? null : R("PayeeSpecifiedCreditorFinancialInstitution", R("BICID", m.Bic)));
    }

    private static XElement RemiseCharge(RemiseCharge r, bool document) => R("SpecifiedTradeAllowanceCharge",
        R("ChargeIndicator", new XElement(Udt + "Indicator", r.Charge ? "true" : "false")),
        r.Pourcentage is { } p ? R("CalculationPercent", Nombre(p)) : null,
        r.Assiette is { } a ? R("BasisAmount", Montant(a)) : null,
        R("ActualAmount", Montant(r.Montant)),
        Opt("ReasonCode", r.CodeMotif),
        Opt("Reason", r.Motif),
        document && (r.CategorieTva is not null || r.TauxTva is not null)
            ? R("CategoryTradeTax", R("TypeCode", TypeTaxe), Opt("CategoryCode", r.CategorieTva), r.TauxTva is { } t ? R("RateApplicablePercent", Nombre(t)) : null)
            : null);

    private static XElement PieceJointe(PieceJointe p) => R("AdditionalReferencedDocument",
        R("IssuerAssignedID", p.Reference),
        Opt("URIID", p.Lien),
        R("TypeCode", TypeDocumentReference.Justificatif),
        Opt("Name", p.Description),
        p.Contenu is null ? null : R("AttachmentBinaryObject",
            new XAttribute("mimeCode", p.TypeMime ?? ""), new XAttribute("filename", p.NomFichier ?? ""), Convert.ToBase64String(p.Contenu)));

    // ---------------------------------------------------------------- parties

    private static XElement? Partie(string nom, Partie? p)
    {
        if (p is null) return null;
        XElement? organisation = p.Siren is null && p.NomCommercial is null ? null
            : R("SpecifiedLegalOrganization",
                p.Siren is null ? null : R("ID", new XAttribute("schemeID", SchemaIdentifiant.Siren), p.Siren),
                Opt("TradingBusinessName", p.NomCommercial));
        return R(nom,
            p.Identifiants.Where(i => i.Schema is null).Select(i => R("ID", i.Valeur)),
            p.Identifiants.Where(i => i.Schema is not null).Select(i => R("GlobalID", new XAttribute("schemeID", i.Schema!), i.Valeur)),
            R("Name", p.RaisonSociale),
            organisation,
            Contact(p.Contact),
            Adresse(p.Adresse),
            p.AdresseElectronique is not { } ae ? null
                : R("URIUniversalCommunication", ae.Schema is null ? R("URIID", ae.Valeur) : R("URIID", new XAttribute("schemeID", ae.Schema), ae.Valeur)),
            p.NumeroTva is null ? null : R("SpecifiedTaxRegistration", R("ID", new XAttribute("schemeID", SchemaIdentifiant.Tva), p.NumeroTva)),
            p.IdentifiantFiscal is null ? null : R("SpecifiedTaxRegistration", R("ID", new XAttribute("schemeID", SchemaIdentifiant.Fiscal), p.IdentifiantFiscal)));
    }

    private static XElement? Identifiant(Identifiant? i) => i is null ? null
        : i.Schema is null ? R("ID", i.Valeur) : R("GlobalID", new XAttribute("schemeID", i.Schema), i.Valeur);

    private static XElement? Adresse(AdressePostale? a) => a is null ? null : R("PostalTradeAddress",
        Opt("PostcodeCode", a.CodePostal),
        Opt("LineOne", a.Ligne1),
        Opt("LineTwo", a.Ligne2),
        Opt("LineThree", a.Ligne3),
        Opt("CityName", a.Localite),
        Opt("CountryID", string.IsNullOrEmpty(a.CodePays) ? null : a.CodePays),
        Opt("CountrySubDivisionName", a.Subdivision));

    private static XElement? Contact(Contact? c) => c is null ? null : R("DefinedTradeContact",
        Opt("PersonName", c.Nom),
        c.Telephone is null ? null : R("TelephoneUniversalCommunication", R("CompleteNumber", c.Telephone)),
        c.Courriel is null ? null : R("EmailURIUniversalCommunication", R("URIID", c.Courriel)));

    // ---------------------------------------------------------------- outils

    private static XElement R(string nom, params object?[] contenu) => new(Ram + nom, contenu);

    private static XElement? Opt(string nom, string? valeur) => valeur is null ? null : R(nom, valeur);

    private static XElement? Reference(string nom, string? identifiant) => identifiant is null ? null : R(nom, R("IssuerAssignedID", identifiant));

    private static XElement? Periode(Periode? p) => p is null ? null : R("BillingSpecifiedPeriod",
        p.Debut is { } d ? R("StartDateTime", DateUdt(d)) : null,
        p.Fin is { } fin ? R("EndDateTime", DateUdt(fin)) : null);

    private static XElement Quantite(string nom, decimal valeur, string? unite) =>
        unite is null ? R(nom, Nombre(valeur)) : R(nom, new XAttribute("unitCode", unite), Nombre(valeur));

    private static string Date(DateOnly d) => d.ToString("yyyyMMdd", CultureInfo.InvariantCulture);

    private static XElement DateUdt(DateOnly d) => new(Udt + "DateTimeString", new XAttribute("format", FormatDate102), Date(d));

    private static XElement DateQdt(DateOnly d) => new(Qdt + "DateTimeString", new XAttribute("format", FormatDate102), Date(d));

    /// <summary>Nombre sans zéro de fin (quantités, prix, taux, pourcentages) : « 20 », « 5.5 », « 0.107 ».</summary>
    public static string Nombre(decimal v) => v.ToString("0.############################", CultureInfo.InvariantCulture);

    /// <summary>Montant à 2 décimales au moins, sans arrondi (« 100.00 » ; plus de décimales écrites telles quelles, BR-FR-DEC-01 les signale).</summary>
    public static string Montant(decimal v) => ReglesCompletude.Decimales(v) <= 2 ? v.ToString("0.00", CultureInfo.InvariantCulture) : Nombre(v);
}
