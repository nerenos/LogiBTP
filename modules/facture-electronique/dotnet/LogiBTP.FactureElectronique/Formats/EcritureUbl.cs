using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>
/// Écriture d'une facture OASIS UBL 2.1 (plans/facturation-electronique.md, lot 17) depuis le modèle sémantique
/// <see cref="Facture"/> : Invoice, ou CreditNote pour les types d'avoir (<see cref="ReglesCompletude.TypesAvoir"/>), profils
/// EN16931 et EXTENDED-CTC-FR. Chemins de l'annexe A XP Z12-012 V1.4, ordre des éléments des XSD UBL 2.1 ; tout ce que
/// <see cref="LectureUbl"/> lit est écrit (écrit → lu → même modèle), avec les conversions inverses de la lecture : BT-8
/// de l'UNTDID 2475 vers l'UNTDID 2005, code sujet BT-21 en préfixe « #CODE# » de la note, sous-type et ligne parente dans un
/// BillingReference de ligne qui porte un DocumentStatusCode. Mêmes règles de nombres que <see cref="EcritureCii"/>.
/// Limites propres à l'UBL : le bénéficiaire (BT-59) et le représentant fiscal (BT-62) ne portent qu'un nom (PartyName), le nom
/// commercial n'est pas écrit ; le payeur (EXTENDED-CTC-FR) et l'échéance d'un avoir se rangent dans un moyen de paiement
/// (DONNEE_INVALIDE s'il n'y en a pas). Le XML écrit est validé par le XSD UBL.
/// </summary>
public static class EcritureUbl
{
    private static readonly XNamespace Cac = LectureUbl.Cac;
    private static readonly XNamespace Cbc = LectureUbl.Cbc;

    private const string VersionUbl = "2.1";
    /// <summary>BT-18 : schéma (UNTDID 1153) de l'identifiant de l'objet facturé.</summary>
    private const string SchemaObjetFacture = "IT";
    /// <summary>Espaces de noms déclarés par les exemples UBL.</summary>
    private static readonly XNamespace Xsi = "http://www.w3.org/2001/XMLSchema-instance";

    /// <summary>BT-8 : UNTDID 2475 (modèle) → UNTDID 2005 (UBL), inverse de la lecture ; un code non prévu est gardé tel quel.</summary>
    private static readonly Dictionary<string, string> ExigibiliteTva = new()
    {
        [CodeExigibiliteTva.DateFacture] = CodeExigibiliteTvaUbl.DateFacture,
        [CodeExigibiliteTva.DateLivraison] = CodeExigibiliteTvaUbl.DateLivraison,
        [CodeExigibiliteTva.DatePaiement] = CodeExigibiliteTvaUbl.DatePaiement,
    };

    /// <summary>Le type BT-3 est celui d'un avoir : la facture s'écrit en CreditNote.</summary>
    public static bool EstAvoir(string? typeFacture) => typeFacture is not null && ReglesCompletude.TypesAvoir.Contains(typeFacture);

    /// <summary>Facture → XML UBL 2.1 (UTF-8 sans BOM, indenté), validé par le XSD UBL Invoice ou CreditNote.</summary>
    public static byte[] Ecrire(Facture f)
    {
        var document = Document(f);
        var jeu = EstAvoir(f.TypeFacture) ? JeuXsd.UblCreditNote : JeuXsd.UblInvoice;
        var erreurs = ValidationXsd.Valider(document, jeu);
        if (erreurs.Count > 0)
            throw new ExceptionLectureFacture(ErreurFe.XsdInvalide, $"Facture écrite non conforme au XSD {jeu} ({erreurs.Count} erreur(s))", erreurs);
        var reglages = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true, IndentChars = "  ", NewLineChars = "\n" };
        using var flux = new MemoryStream();
        using (var ecrivain = XmlWriter.Create(flux, reglages)) document.Save(ecrivain);
        return flux.ToArray();
    }

    /// <summary>Document XML de la facture (sans validation).</summary>
    public static XDocument Document(Facture f)
    {
        var specification = EcritureCii.Specification(f.Profil);
        var etendu = f.Profil == ProfilFacture.ExtendedCtcFr;
        if (!etendu && EcritureCii.Extensions(f) is { Count: > 0 } extensions)
            throw new ExceptionLectureFacture(ErreurFe.DonneeHorsProfil, $"Données EXTENDED-CTC-FR dans une facture EN16931 : {string.Join(", ", extensions)}", extensions);
        var avoir = EstAvoir(f.TypeFacture);
        if (f.MoyensPaiement.Count == 0)
        {
            if (f.Payeur is not null) throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, "Payeur (EXT-FR-FE-BG-02) sans moyen de paiement : l'UBL le range dans PaymentMeans");
            if (avoir && f.DateEcheance is not null) throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, "Échéance (BT-9) d'un avoir sans moyen de paiement : l'UBL la range dans PaymentMeans");
        }

        var espace = avoir ? LectureUbl.EspaceAvoir : LectureUbl.EspaceFacture;
        var refs = f.References;
        var exigibilite = f.CodeExigibiliteTva is null ? null : ExigibiliteTva.GetValueOrDefault(f.CodeExigibiliteTva, f.CodeExigibiliteTva);
        var references = new List<XElement?>
        {
            refs.Objet is null ? null : Cac_("AdditionalDocumentReference",
                B("ID", new XAttribute("schemeID", SchemaObjetFacture), refs.Objet), B("DocumentTypeCode", TypeDocumentReference.ObjetFacture)),
            avoir && refs.Projet is not null ? Cac_("AdditionalDocumentReference", B("ID", refs.Projet), B("DocumentTypeCode", TypeDocumentReference.ProjetAvoirUbl)) : null,
        };
        references.AddRange(f.PiecesJointes.Select(PieceJointe));

        var racine = new XElement(espace + (avoir ? "CreditNote" : "Invoice"),
            new XAttribute(XNamespace.Xmlns + "cac", Cac.NamespaceName),
            new XAttribute(XNamespace.Xmlns + "cbc", Cbc.NamespaceName),
            B("UBLVersionID", VersionUbl),
            B("CustomizationID", specification),
            B("ProfileID", f.CadreFacturation),
            B("ID", f.Numero),
            B("IssueDate", Date(f.DateEmission)),
            avoir ? null : Opt("DueDate", f.DateEcheance),
            B(avoir ? "CreditNoteTypeCode" : "InvoiceTypeCode", f.TypeFacture),
            f.Notes.Select(n => B("Note", n.CodeSujet is null ? n.Texte : $"#{n.CodeSujet}#{n.Texte}")),
            Opt("TaxPointDate", f.DateExigibiliteTva),
            B("DocumentCurrencyCode", f.Devise),
            Opt("TaxCurrencyCode", f.DeviseTva),
            Opt("AccountingCost", refs.Comptable),
            Opt("BuyerReference", refs.Acheteur),
            f.Periode is null && exigibilite is null ? null : Cac_("InvoicePeriod",
                Opt("StartDate", f.Periode?.Debut), Opt("EndDate", f.Periode?.Fin), Opt("DescriptionCode", exigibilite)),
            refs.Commande is null && refs.CommandeVendeur is null ? null : Cac_("OrderReference", B("ID", refs.Commande ?? ""), Opt("SalesOrderID", refs.CommandeVendeur)),
            f.FacturesAnterieures.Select(a => Cac_("BillingReference", Cac_("InvoiceDocumentReference",
                B("ID", a.Numero), Opt("IssueDate", a.Date), Opt("DocumentTypeCode", a.Type)))),
            Reference("DespatchDocumentReference", refs.Expedition),
            Reference("ReceiptDocumentReference", refs.Reception),
            Reference("OriginatorDocumentReference", refs.AppelOffres),
            Reference("ContractDocumentReference", refs.Contrat),
            references,
            avoir || refs.Projet is null ? null : Cac_("ProjectReference", B("ID", refs.Projet)),
            Cac_("AccountingSupplierParty", Partie("Party", f.Vendeur, f.AgentVendeur)),
            Cac_("AccountingCustomerParty", Partie("Party", f.Acheteur, f.AgentAcheteur)),
            Partie("PayeeParty", f.Beneficiaire, nomSeul: true),
            Partie("TaxRepresentativeParty", f.RepresentantFiscal, nomSeul: true),
            Livraison(f),
            f.MoyensPaiement.Select((m, i) => MoyenPaiement(m, avoir && i == 0 ? f.DateEcheance : null, i == 0 ? f.Payeur : null)),
            f.ConditionsPaiement is null ? null : Cac_("PaymentTerms", B("Note", f.ConditionsPaiement)),
            f.RemisesCharges.Select(r => RemiseCharge(r, f.Devise, document: true)),
            Taxes(f),
            Totaux(f),
            f.Lignes.Select(l => Ligne(l, f, avoir)));
        return new XDocument(new XDeclaration("1.0", "UTF-8", null), racine);
    }

    // ---------------------------------------------------------------- lignes

    private static XElement Ligne(LigneFacture l, Facture f, bool avoir)
    {
        var facultative = l.SousType is SousTypeLigne.Groupe or SousTypeLigne.Information;
        var unite = string.IsNullOrEmpty(l.Unite) ? null : l.Unite;
        if (l.LigneParente is not null && l.SousType is null)
            throw new ExceptionLectureFacture(ErreurFe.DonneeInvalide, $"Ligne {l.Identifiant} : ligne parente (EXT-FR-FE-162) sans sous-type (EXT-FR-FE-163)");
        // EXTENDED-CTC-FR : le BillingReference qui porte le DocumentStatusCode donne le sous-type et la ligne parente.
        XElement? sousLigne = l.SousType is null ? null : Cac_("BillingReference",
            Cac_("InvoiceDocumentReference", B("ID", f.Numero), B("DocumentStatusCode", l.SousType)),
            l.LigneParente is null ? null : Cac_("BillingReferenceLine", B("ID", l.LigneParente)));
        XElement? anterieure = l.FactureAnterieure is not { } a ? null : Cac_("BillingReference",
            Cac_("InvoiceDocumentReference", B("ID", a.Numero), Opt("IssueDate", a.Date), Opt("DocumentTypeCode", a.Type)),
            a.Ligne is null ? null : Cac_("BillingReferenceLine", B("ID", a.Ligne)));
        XElement? prix = !facultative || l.PrixNet != 0m || l.QuantiteBase is not null || l.PrixBrut is not null
            ? Cac_("Price",
                B("PriceAmount", Devise(f.Devise), EcritureCii.Nombre(l.PrixNet)),
                l.QuantiteBase is { } qb ? Quantite("BaseQuantity", qb, unite) : null,
                l.PrixBrut is { } pb ? Cac_("AllowanceCharge",
                    B("ChargeIndicator", "false"),
                    B("Amount", Devise(f.Devise), EcritureCii.Nombre(l.Rabais ?? 0m)),
                    B("BaseAmount", Devise(f.Devise), EcritureCii.Nombre(pb))) : null)
            : null;
        return Cac_(avoir ? "CreditNoteLine" : "InvoiceLine",
            B("ID", l.Identifiant),
            Opt("Note", l.Note),
            unite is null && facultative ? null : Quantite(avoir ? "CreditedQuantity" : "InvoicedQuantity", l.Quantite, unite),
            B("LineExtensionAmount", Devise(f.Devise), EcritureCii.Montant(l.MontantNet)),
            Opt("AccountingCost", l.ReferenceComptable),
            l.Periode is null ? null : Cac_("InvoicePeriod", Opt("StartDate", l.Periode.Debut), Opt("EndDate", l.Periode.Fin)),
            l.LigneCommande is null ? null : Cac_("OrderLineReference", B("LineID", l.LigneCommande)),
            sousLigne,
            anterieure,
            l.RemisesCharges.Select(r => RemiseCharge(r, f.Devise, document: false)),
            Cac_("Item",
                Opt("Description", l.Description),
                B("Name", l.Nom),
                l.ReferenceAcheteur is null ? null : Cac_("BuyersItemIdentification", B("ID", l.ReferenceAcheteur)),
                l.ReferenceVendeur is null ? null : Cac_("SellersItemIdentification", B("ID", l.ReferenceVendeur)),
                l.CategorieTva is null && l.TauxTva is null ? null : Cac_("ClassifiedTaxCategory",
                    Opt("ID", l.CategorieTva), l.TauxTva is { } t ? B("Percent", EcritureCii.Nombre(t)) : null, Regime())),
            prix);
    }

    // ---------------------------------------------------------------- totaux et TVA

    private static XElement? Taxes(Facture f)
    {
        if (f.Totaux.TotalTva is null && f.DetailsTva.Count == 0) return null;
        var somme = f.Totaux.TotalTva ?? f.DetailsTva.Sum(d => d.Montant);
        return Cac_("TaxTotal",
            B("TaxAmount", Devise(f.Devise), EcritureCii.Montant(somme)),
            f.DetailsTva.Select(d => Cac_("TaxSubtotal",
                B("TaxableAmount", Devise(f.Devise), EcritureCii.Montant(d.Base)),
                B("TaxAmount", Devise(f.Devise), EcritureCii.Montant(d.Montant)),
                Cac_("TaxCategory",
                    B("ID", d.Categorie),
                    d.Taux is { } taux ? B("Percent", EcritureCii.Nombre(taux)) : null,
                    Opt("TaxExemptionReasonCode", d.CodeExoneration),
                    Opt("TaxExemptionReason", d.MotifExoneration),
                    Regime()))));
    }

    private static IEnumerable<XElement> Totaux(Facture f)
    {
        var t = f.Totaux;
        if (f.DeviseTva is not null && f.DeviseTva != f.Devise && t.TotalTvaComptable is { } comptable)
            yield return Cac_("TaxTotal", B("TaxAmount", Devise(f.DeviseTva), EcritureCii.Montant(comptable)));
        var d = Devise(f.Devise);
        yield return Cac_("LegalMonetaryTotal",
            B("LineExtensionAmount", d, EcritureCii.Montant(t.TotalLignes)),
            B("TaxExclusiveAmount", d, EcritureCii.Montant(t.TotalHt)),
            B("TaxInclusiveAmount", d, EcritureCii.Montant(t.TotalTtc)),
            t.TotalRemises is { } tr ? B("AllowanceTotalAmount", d, EcritureCii.Montant(tr)) : null,
            t.TotalCharges is { } tc ? B("ChargeTotalAmount", d, EcritureCii.Montant(tc)) : null,
            t.DejaPaye is { } dp ? B("PrepaidAmount", d, EcritureCii.Montant(dp)) : null,
            t.Arrondi is { } ar ? B("PayableRoundingAmount", d, EcritureCii.Montant(ar)) : null,
            B("PayableAmount", d, EcritureCii.Montant(t.NetAPayer)));
    }

    private static XElement RemiseCharge(RemiseCharge r, string devise, bool document) => Cac_("AllowanceCharge",
        B("ChargeIndicator", r.Charge ? "true" : "false"),
        Opt("AllowanceChargeReasonCode", r.CodeMotif),
        Opt("AllowanceChargeReason", r.Motif),
        r.Pourcentage is { } p ? B("MultiplierFactorNumeric", EcritureCii.Nombre(p)) : null,
        B("Amount", Devise(devise), EcritureCii.Montant(r.Montant)),
        r.Assiette is { } a ? B("BaseAmount", Devise(devise), EcritureCii.Montant(a)) : null,
        document && (r.CategorieTva is not null || r.TauxTva is not null)
            ? Cac_("TaxCategory", Opt("ID", r.CategorieTva), r.TauxTva is { } t ? B("Percent", EcritureCii.Nombre(t)) : null, Regime())
            : null);

    // ---------------------------------------------------------------- paiement, livraison, références

    private static XElement MoyenPaiement(MoyenPaiement m, DateOnly? echeance, Partie? payeur)
    {
        XElement? compte = m.Iban is null && m.Titulaire is null && m.Bic is null ? null
            : Cac_("PayeeFinancialAccount",
                Opt("ID", m.Iban),
                Opt("Name", m.Titulaire),
                m.Bic is null ? null : Cac_("FinancialInstitutionBranch", B("ID", m.Bic)));
        return Cac_("PaymentMeans",
            B("PaymentMeansCode", m.Code),
            Opt("PaymentDueDate", echeance),
            Opt("PaymentID", m.Reference),
            compte,
            payeur is null ? null : Cac_("PaymentMandate", Partie("PayerParty", payeur)));
    }

    private static XElement? Livraison(Facture f)
    {
        var l = f.Livraison;
        if (l is null) return null;
        XElement? lieu = l.Lieu is null && l.Adresse is null ? null
            : Cac_("DeliveryLocation", l.Lieu is null ? null : Identifiant("ID", l.Lieu), Adresse("Address", l.Adresse));
        XElement? partie = l.Nom is null ? null : Cac_("DeliveryParty", Cac_("PartyName", B("Name", l.Nom)));
        if (lieu is null && partie is null && l.Date is null) return null;
        return Cac_("Delivery", Opt("ActualDeliveryDate", l.Date), lieu, partie);
    }

    private static XElement? Reference(string nom, string? identifiant) => identifiant is null ? null : Cac_(nom, B("ID", identifiant));

    private static XElement PieceJointe(PieceJointe p)
    {
        XElement? binaire = p.Contenu is null ? null : B("EmbeddedDocumentBinaryObject",
            p.TypeMime is null ? null : new XAttribute("mimeCode", p.TypeMime),
            p.NomFichier is null ? null : new XAttribute("filename", p.NomFichier),
            Convert.ToBase64String(p.Contenu));
        XElement? lien = p.Lien is null ? null : Cac_("ExternalReference", B("URI", p.Lien));
        return Cac_("AdditionalDocumentReference",
            B("ID", p.Reference),
            Opt("DocumentDescription", p.Description),
            binaire is null && lien is null ? null : Cac_("Attachment", binaire, lien));
    }

    // ---------------------------------------------------------------- parties

    /// <summary>
    /// Partie UBL. Raison sociale en RegistrationName et nom commercial en PartyName ; avec <paramref name="nomSeul"/>
    /// (bénéficiaire, représentant fiscal) la raison sociale s'écrit en PartyName seul.
    /// </summary>
    private static XElement? Partie(string nom, Partie? p, Partie? agent = null, bool nomSeul = false)
    {
        if (p is null) return null;
        var fiscalTva = p.NumeroTva is null ? null : Cac_("PartyTaxScheme", B("CompanyID", p.NumeroTva), Cac_("TaxScheme", B("ID", SchemaIdentifiant.TvaUbl)));
        var fiscalAutre = p.IdentifiantFiscal is null ? null : Cac_("PartyTaxScheme", B("CompanyID", p.IdentifiantFiscal), Cac_("TaxScheme", B("ID", SchemaIdentifiant.Fiscal)));
        XElement? legal = nomSeul && p.Siren is null ? null : Cac_("PartyLegalEntity",
            nomSeul ? null : B("RegistrationName", p.RaisonSociale),
            p.Siren is null ? null : B("CompanyID", new XAttribute("schemeID", SchemaIdentifiant.Siren), p.Siren));
        var nomPartie = nomSeul ? p.RaisonSociale : p.NomCommercial;
        return Cac_(nom,
            p.AdresseElectronique is null ? null : Identifiant("EndpointID", p.AdresseElectronique),
            p.Identifiants.Select(i => Cac_("PartyIdentification", Identifiant("ID", i))),
            nomPartie is null ? null : Cac_("PartyName", B("Name", nomPartie)),
            Adresse("PostalAddress", p.Adresse),
            fiscalTva,
            fiscalAutre,
            legal,
            p.Contact is null ? null : Cac_("Contact", Opt("Name", p.Contact.Nom), Opt("Telephone", p.Contact.Telephone), Opt("ElectronicMail", p.Contact.Courriel)),
            Partie("AgentParty", agent));
    }

    private static XElement Identifiant(string nom, Identifiant i) =>
        i.Schema is null ? B(nom, i.Valeur) : B(nom, new XAttribute("schemeID", i.Schema), i.Valeur);

    private static XElement? Adresse(string nom, AdressePostale? a) => a is null ? null : Cac_(nom,
        Opt("StreetName", a.Ligne1),
        Opt("AdditionalStreetName", a.Ligne2),
        Opt("CityName", a.Localite),
        Opt("PostalZone", a.CodePostal),
        Opt("CountrySubentity", a.Subdivision),
        a.Ligne3 is null ? null : Cac_("AddressLine", B("Line", a.Ligne3)),
        string.IsNullOrEmpty(a.CodePays) ? null : Cac_("Country", B("IdentificationCode", a.CodePays)));

    // ---------------------------------------------------------------- outils

    /// <summary>Régime de taxe (TaxScheme/ID) : la TVA.</summary>
    private static XElement Regime() => Cac_("TaxScheme", B("ID", SchemaIdentifiant.TvaUbl));

    private static XElement Cac_(string nom, params object?[] contenu) => new(Cac + nom, contenu);

    private static XElement B(string nom, params object?[] contenu) => new(Cbc + nom, contenu);

    private static XElement? Opt(string nom, string? valeur) => valeur is null ? null : B(nom, valeur);

    private static XElement? Opt(string nom, DateOnly? date) => date is { } d ? B(nom, Date(d)) : null;

    private static XAttribute Devise(string devise) => new("currencyID", devise);

    private static XElement Quantite(string nom, decimal valeur, string? unite) =>
        unite is null ? B(nom, EcritureCii.Nombre(valeur)) : B(nom, new XAttribute("unitCode", unite), EcritureCii.Nombre(valeur));

    private static string Date(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
