using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>
/// Écriture d'une transmission d'e-reporting (flux 10, plans/facturation-electronique.md, lot 19) depuis
/// <see cref="TransmissionEreporting"/> : racine <c>Report</c> du XSD <c>ereporting.xsd</c> du paquet FNFE 1.4.0.04
/// (types des espaces <c>report</c>, <c>transaction</c>, <c>payment</c>, éléments locaux sans espace de noms), ordre des
/// éléments du XSD, chemins de l'annexe A XP Z12-012 V1.4 (onglet « E-REPORTING - Flux 10 »). Dates AAAAMMJJ, horodatage
/// AAAAMMJJHHMMSS ; montants à 2 décimales au moins, taux et quantités sans zéro de fin (comme <see cref="EcritureCii"/>).
/// Le XML écrit est validé par le XSD (<see cref="ErreurFe.XsdInvalide"/>) ; les règles de gestion se contrôlent avant, par
/// <see cref="ReglesEreporting.Controler"/> (le schematron Flux10 est joué par l'outil Node, <c>npm run valider-facture</c>).
/// </summary>
public static class EcritureFlux10
{
    /// <summary>Qualifiant d'un numéro de TVA (TT-34-0, TT-38-0, G2.33) et schéma de celui du représentant fiscal (TT-40).</summary>
    private const string QualifiantTva = SchemaIdentifiant.TvaUbl;

    /// <summary>Transmission → XML (UTF-8 sans BOM, indenté), validé par le XSD du flux 10.</summary>
    public static byte[] Ecrire(TransmissionEreporting t)
    {
        var document = Document(t);
        var erreurs = ValidationXsd.Valider(document, JeuXsd.Flux10);
        if (erreurs.Count > 0)
            throw new ExceptionLectureFacture(ErreurFe.XsdInvalide, $"Flux 10 écrit non conforme au XSD ereporting ({erreurs.Count} erreur(s))", erreurs);
        var reglages = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true, IndentChars = "  ", NewLineChars = "\n" };
        using var flux = new MemoryStream();
        using (var ecrivain = XmlWriter.Create(flux, reglages)) document.Save(ecrivain);
        return flux.ToArray();
    }

    /// <summary>Document XML de la transmission (sans validation).</summary>
    public static XDocument Document(TransmissionEreporting t) => new(new XDeclaration("1.0", "UTF-8", null),
        new XElement("Report",
            new XElement("ReportDocument",
                E("Id", t.Id),
                O("Name", t.Nom),
                new XElement("IssueDateTime", E("DateTimeString", t.Horodatage.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture))),
                E("TypeCode", t.Type),
                Partie("Sender", t.Emetteur),
                Partie("Issuer", t.Declarant)),
            t.Transactions is { } tr ? Transactions(tr) : null,
            t.Paiements is { } pa ? Paiements(pa) : null));

    private static XElement Partie(string nom, PartieTransmission p) => new(nom,
        new XElement("Id", new XAttribute("schemeId", p.Schema), p.Identifiant),
        E("Name", p.Nom),
        E("RoleCode", p.Role),
        p.AdresseElectronique is { Length: > 0 } a ? new XElement("URIUniversalCommunication", E("URIID", a)) : null);

    private static XElement PeriodeRapport(PeriodeEreporting p) => new("ReportPeriod", E("StartDate", Date(p.Debut)), E("EndDate", Date(p.Fin)));

    // ---- TB-2 : transactions (10.1, 10.3) ----

    private static XElement Transactions(RapportTransactions r) => new("TransactionsReport",
        PeriodeRapport(r.Periode),
        r.Factures.Select(Facture),
        r.Agregats.Select(a => new XElement("Transactions",
            E("Date", Date(a.Date)),
            E("TransactionsCurrency", a.Devise),
            O("TaxDueDateTypeCode", a.CodeExigibiliteTva),
            E("CategoryCode", a.Categorie),
            E("TaxExclusiveAmount", Montant(a.TotalHt)),
            E("TaxTotal", Montant(a.TotalTva)),
            a.Nombre is { } n ? E("TransactionsCount", n.ToString(CultureInfo.InvariantCulture)) : null,
            a.Ventilation.Select(v => new XElement("TaxSubtotal",
                E("TaxPercent", Nombre(v.Taux)), E("TaxableAmount", Montant(v.Base)), E("TaxTotal", Montant(v.Tva)))))));

    private static XElement Facture(TransactionUnitaire f) => new("Invoice",
        E("ID", f.Numero),
        E("IssueDate", Date(f.Date)),
        E("TypeCode", f.Type),
        E("CurrencyCode", f.Devise),
        f.Echeance is { } ech ? E("DueDate", Date(ech)) : null,
        O("TaxDueDateTypeCode", f.CodeExigibiliteTva),
        f.Notes.Select(n => new XElement("IncludedNote", O("Subject", n.CodeSujet), O("Content", n.Texte))),
        new XElement("BusinessProcess", E("ID", f.Cadre), E("TypeID", ProfilEreporting.Transactions)),
        f.FacturesAnterieures.Select(a => new XElement("ReferencedDocument", E("ID", a.Numero), a.Date is { } d ? E("IssueDate", Date(d)) : null)),
        Entreprise("Seller", f.Vendeur),
        f.Acheteur is { } ach ? Entreprise("Buyer", ach) : null,
        f.TvaRepresentantFiscal is { Length: > 0 } rf
            ? new XElement("SellerTaxRepresentative", new XElement("TaxRegistrationId", new XAttribute("schemeId", QualifiantTva), rf))
            : null,
        f.Livraisons.Select(l => new XElement("Delivery",
            l.Date is { } d ? E("Date", Date(d)) : null,
            l.Adresse is { } a ? new XElement("Location",
                O("LineOne", a.Ligne1), O("LineTwo", a.Ligne2), O("LineThree", a.Ligne3), O("CityName", a.Localite),
                O("PostalZone", a.CodePostal), O("CountrySubentity", a.Subdivision), O("CountryId", a.CodePays)) : null)),
        PeriodeFacture("InvoicePeriod", f.Periode),
        f.RemisesCharges.Select(r => new XElement("AllowanceCharge", new XAttribute("ChargeIndicator", r.Charge ? "true" : "false"),
            r.Montant is { } m ? E("Amount", Montant(m)) : null,
            O("TaxCategoryCode", r.CategorieTva),
            r.TauxTva is { } tx ? E("TaxPercent", Nombre(tx)) : null)),
        new XElement("MonetaryTotal",
            f.TotalHt is { } ht ? E("TaxExclusiveAmount", Montant(ht)) : null,
            new XElement("TaxAmount", new XAttribute("CurrencyCode", f.DeviseTva), Montant(f.TotalTva))),
        f.Ventilation.Select(v => new XElement("TaxSubTotal",
            E("TaxableAmount", Montant(v.Base)),
            E("TaxAmount", Montant(v.Montant)),
            new XElement("TaxCategory",
                O("Code", v.Categorie),
                E("Percent", Nombre(v.Taux ?? 0m)),
                O("TaxExemptionReason", v.MotifExoneration),
                O("TaxExemptionReasonCode", v.CodeExoneration)))),
        f.Lignes.Select(Ligne));

    private static XElement Entreprise(string nom, EntrepriseEreporting e) => new(nom,
        e.Identifiant is { } id ? new XElement("CompanyId", new XAttribute("schemeId", id.Schema ?? ""), id.Valeur) : null,
        e.NumeroTva is { Length: > 0 } tva ? new XElement("TaxRegistrationId", new XAttribute("qualifyingId", QualifiantTva), tva) : null,
        e.CodePays is { Length: > 0 } pays ? new XElement("PostalAddress", E("CountryId", pays)) : null);

    private static XElement? PeriodeFacture(string nom, Periode? p) => p is null || (p.Debut is null && p.Fin is null)
        ? null
        : new XElement(nom, p.Debut is { } d ? E("StartDate", Date(d)) : null, p.Fin is { } f ? E("EndDate", Date(f)) : null);

    private static XElement Ligne(LigneEreporting l) => new("Line",
        l.Notes.Select(n => new XElement("Note", O("Code", n.CodeSujet), O("Comment", n.Texte))),
        l.Quantite is { } q ? new XElement("BilledQuantity", l.Unite is { Length: > 0 } u ? new XAttribute("UnitCode", u) : null, Nombre(q)) : null,
        l.FactureAnterieure is { } fa ? new XElement("ReferencedDocument", E("ID", fa.Numero), fa.Date is { } d ? E("IssueDate", Date(d)) : null) : null,
        PeriodeFacture("InvoicePeriod", l.Periode),
        l.RemisesCharges.Where(r => r.Montant is not null).Select(r => new XElement("AllowanceCharge",
            new XAttribute("ChargeIndicator", r.Charge ? "true" : "false"), E("Amount", Montant(r.Montant!.Value)))),
        l.PrixNet is not null || l.Rabais is not null || l.PrixBrut is not null
            ? new XElement("Price",
                l.PrixNet is { } pn ? E("PriceAmount", Nombre(pn)) : null,
                l.Rabais is { } ra ? E("AllowanceChargeAmount", Nombre(ra)) : null,
                l.PrixBrut is { } pb ? E("AllowanceChargeBaseAmount", Nombre(pb)) : null)
            : null,
        l.Nom is { Length: > 0 } nom ? new XElement("Product", E("Name", nom)) : null);

    // ---- TB-3 : paiements (10.2, 10.4) ----

    private static XElement Paiements(RapportPaiements r) => new("PaymentsReport",
        PeriodeRapport(r.Periode),
        r.Factures.Select(p => new XElement("Invoice",
            E("InvoiceID", p.Numero),
            E("IssueDate", Date(p.DateFacture)),
            Paiement(p.DatePaiement, p.Montants))),
        r.Agregats.Select(p => new XElement("Transactions", Paiement(p.Date, p.Montants))));

    private static XElement Paiement(DateOnly date, IReadOnlyList<EncaisseParTaux> montants) => new("Payment",
        E("Date", Date(date)),
        montants.Select(m => new XElement("SubTotals", E("TaxPercent", Nombre(m.Taux)), O("CurrencyCode", m.Devise), E("Amount", Montant(m.Montant)))));

    // ---- Outils ----

    private static XElement E(string nom, string valeur) => new(nom, valeur);

    private static XElement? O(string nom, string? valeur) => string.IsNullOrEmpty(valeur) ? null : new XElement(nom, valeur);

    private static string Date(DateOnly d) => d.ToString("yyyyMMdd", CultureInfo.InvariantCulture);

    private static string Montant(decimal v) => EcritureCii.Montant(v);

    private static string Nombre(decimal v) => EcritureCii.Nombre(v);
}
