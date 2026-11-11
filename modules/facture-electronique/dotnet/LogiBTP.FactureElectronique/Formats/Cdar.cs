using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace LogiBTP.FactureElectronique.Formats;

/// <summary>
/// Message de cycle de vie CDAR D22B (flux 6) : écriture d'un statut (<see cref="Ecrire(StatutAEcrire)"/>, contrôlé par
/// <see cref="ReglesCycleVie"/> puis par le XSD) et lecture (<see cref="Lire"/> → <see cref="MessageCdar"/>,
/// <see cref="StatutsLus"/> → statuts du cycle de vie). Chemins de l'onglet « CDV FE - CDAR » de l'annexe A XP Z12-012
/// V1.4 ; données obligatoires des règles BR-FR-CDV du schematron FNFE 1.4.0.04 (contrôlé par l'outil Node, lot 4).
/// </summary>
public static class Cdar
{
    public static readonly XNamespace Rsm = "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100";
    private static readonly XNamespace Ram = LectureCii.Ram, Udt = LectureCii.Udt, Qdt = LectureCii.Qdt;

    /// <summary>Formats UNTDID 2379 : date-heure AAAAMMJJHHMMSS (204) et date AAAAMMJJ (102).</summary>
    private const string FormatDateHeure = "204", FormatDate = "102";
    private const string MotifDateHeure = "yyyyMMddHHmmss", MotifDate = "yyyyMMdd";
    private const int LongueurIdentifiant = 50;

    /// <summary>Statuts de la phase de transmission (MDT-77 = 305), posés par une plateforme ; les autres : 23.</summary>
    private static readonly string[] PhaseTransmission =
    [
        StatutCdv.Deposee, StatutCdv.Emise, StatutCdv.Recue, StatutCdv.MiseADisposition, StatutCdv.Rejetee,
        StatutCdv.ErreurRoutage, StatutCdv.Irrecevable,
    ];

    /// <summary>
    /// Code UNTDID 1373 (MDT-88, informatif) de chaque statut : onglet « Acteurs CDV ». Erreur de routage et Irrecevable
    /// (5) n'en ont pas : posés par la PA-R en phase de transmission (305), où 5 n'est pas admis (BR-FR-CDV-CL-05).
    /// </summary>
    private static readonly Dictionary<string, string> CodesUntdid = new()
    {
        [StatutCdv.Deposee] = "10",
        [StatutCdv.Emise] = "51",
        [StatutCdv.Recue] = "43",
        [StatutCdv.MiseADisposition] = "48",
        [StatutCdv.PriseEnCharge] = "45",
        [StatutCdv.Approuvee] = "1",
        [StatutCdv.ApprouveePartiellement] = "49",
        [StatutCdv.EnLitige] = "46",
        [StatutCdv.Suspendue] = "39",
        [StatutCdv.Completee] = "37",
        [StatutCdv.Refusee] = "50",
        [StatutCdv.PaiementTransmis] = "47",
        [StatutCdv.Encaissee] = "47",
        [StatutCdv.Rejetee] = "8",
        [StatutCdv.Visee] = "5",
        [StatutCdv.Annulee] = "5",
        [StatutCdv.DemandePaiementDirect] = "5",
        [StatutCdv.Affacturee] = "5",
        [StatutCdv.AffactureeConfidentiel] = "5",
        [StatutCdv.ChangementCompteAPayer] = "5",
        [StatutCdv.NonAffacturee] = "5",
    };

    /// <summary>Destinataire PPF (matricule 0000, rôle DFH).</summary>
    public static PartieCdar Ppf { get; } = new(RoleCdar.Ppf, MatriculePlateforme.Ppf, SchemaIdentifiant.Plateforme, "PPF");

    // ---------------------------------------------------------------- écriture

    /// <summary>Rôle UNCL 3035 par défaut d'un émetteur de statut : plateforme WK, vendeur SE, acheteur BY, agent AB.</summary>
    public static string? RoleDe(string? emetteur) => emetteur switch
    {
        EmetteurStatut.PaE or EmetteurStatut.PaR => RoleCdar.Plateforme,
        EmetteurStatut.Vendeur => RoleCdar.Vendeur,
        EmetteurStatut.Acheteur => RoleCdar.Acheteur,
        EmetteurStatut.Agent => RoleCdar.RepresentantAcheteur,
        _ => null,
    };

    /// <summary>
    /// Message CDAR d'un statut : contrôle du cycle de vie (<see cref="ReglesCycleVie.Controler"/> ; la première erreur
    /// est le code, toutes sont dans les détails), puis des données obligatoires (DONNEE_INVALIDE, terme en détail).
    /// </summary>
    public static MessageCdar Construire(StatutAEcrire s)
    {
        var erreurs = ReglesCycleVie.Controler(new StatutPropose(s.Sens, s.Historique, s.Statut, s.Emetteur, s.Motif, s.Action, s.B2g));
        if (erreurs.Count > 0) throw new ExceptionCdar(erreurs[0], $"Statut {s.Statut} refusé : {string.Join(", ", erreurs)}", erreurs);

        var irrecevable = s.Statut == StatutCdv.Irrecevable;
        var f = s.Facture;
        Exiger(!string.IsNullOrWhiteSpace(f.Numero), "MDT-87", "numéro de la facture");
        Exiger(irrecevable || f.Date is not null, "MDT-100", "date de la facture (BR-FR-CDV-11)");
        Exiger(irrecevable || !string.IsNullOrWhiteSpace(f.SirenVendeur), "MDT-129", "SIREN du vendeur (BR-FR-CDV-13)");
        Exiger(s.Statut != StatutCdv.Encaissee || s.Encaissements.Count > 0, "MDT-215", "montant encaissé et taux de TVA (BR-FR-CDV-14)");

        var transmission = PhaseTransmission.Contains(s.Statut);
        var auteur = s.Auteur with { Role = s.Auteur.Role ?? RoleDe(s.Emetteur) };
        // Phase de traitement : l'émetteur est une partie (pas une plateforme) identifiée (BR-FR-CDV-07, CL-03).
        Exiger(transmission || auteur.Role != RoleCdar.Plateforme, "MDT-40", "rôle de l'émetteur du statut (BR-FR-CDV-CL-03)");
        Exiger(transmission || !string.IsNullOrWhiteSpace(auteur.Identifiant), "MDT-38", "identifiant de l'émetteur du statut (BR-FR-CDV-07)");

        var destinataires = s.Destinataires.ToList();
        if (ReglesCycleVie.ObligatoirePpf(s.Statut) && !destinataires.Any(d => d.Role == RoleCdar.Ppf)) destinataires.Add(Ppf);
        Exiger(destinataires.Count > 0, "MDG-23", "destinataire");
        foreach (var d in destinataires)
        {
            Exiger(!string.IsNullOrWhiteSpace(d.Role), "MDT-59", "rôle du destinataire");
            Exiger(d.Role is RoleCdar.Plateforme or RoleCdar.Ppf || !string.IsNullOrWhiteSpace(d.AdresseElectronique),
                "MDT-73", $"adresse électronique du destinataire {d.Role} (BR-FR-CDV-08)");
        }
        var pourPpf = destinataires.All(d => d.Role == RoleCdar.Ppf);
        // Le schematron reconnaît un message pour le PPF à un seul identifiant de destinataire, celui du PPF : un autre
        // destinataire non identifié ferait lire le message comme tel (BR-FR-CDV-02, CL-01).
        Exiger(pourPpf || destinataires.Count(d => d.Identifiant is not null) != 1 || !destinataires.Any(d => d.Role == RoleCdar.Ppf),
            "MDT-57", "identifiant des destinataires autres que le PPF");

        var caracteristiques = s.Encaissements
            .Select(e => new CaracteristiqueCdar(CaracteristiqueCdv.MontantEncaisse, Modifiee: false, Montant: e.Montant, Devise: e.Devise, Pourcentage: e.TauxTva))
            .Concat(s.Caracteristiques).ToList();
        List<DetailStatutCdar> details = s.Motif is not null || s.Action is not null || s.Notes.Count > 0 || caracteristiques.Count > 0
            ? [new DetailStatutCdar(s.Motif, s.LibelleMotif, s.Action, s.LibelleAction, s.Notes, caracteristiques)]
            : [];

        var identifiant = s.Identifiant ?? IdentifiantParDefaut(f.Numero, s.Statut, s.DateStatut);
        Exiger(identifiant.Length <= LongueurIdentifiant, "MDT-4", $"identifiant du message de {LongueurIdentifiant} caractères au plus");
        var profil = pourPpf ? ProfilCdv.Ppf : ProfilCdv.Facture;
        var statut = new StatutFactureCdar(
            f.Numero, CodesUntdid.GetValueOrDefault(s.Statut), f.TypeFacture,
            f.DateReception, s.PieceJointe is null ? [] : [s.PieceJointe], pourPpf ? profil : null, f.Date, s.Statut, s.LibelleStatut,
            f.SirenVendeur, string.IsNullOrWhiteSpace(f.SirenVendeur) ? null : SchemaIdentifiant.Siren, details);
        return new MessageCdar(
            pourPpf ? null : s.Processus, profil, identifiant, s.Nom ?? identifiant, s.DateCreation,
            s.Expediteur ?? new PartieCdar(RoleCdar.Plateforme), auteur, destinataires,
            [new AccuseCdar(false, transmission ? TypeAccuseCdar.Acquittement : TypeAccuseCdar.Information, s.DateStatut, [statut])]);
    }

    /// <summary>CDAR d'un statut (UTF-8 sans BOM), contrôlé (<see cref="Construire"/>) puis validé par le XSD (XSD_INVALIDE).</summary>
    public static byte[] Ecrire(StatutAEcrire statut) => Ecrire(Construire(statut));

    /// <summary>CDAR d'un message (UTF-8 sans BOM, indenté), validé par le XSD CDAR D22B (XSD_INVALIDE sinon).</summary>
    public static byte[] Ecrire(MessageCdar m)
    {
        var document = Document(m);
        var erreursXsd = ValidationXsd.Valider(document, JeuXsd.CdarD22B);
        if (erreursXsd.Count > 0) throw new ExceptionCdar(ErreurFe.XsdInvalide, "CDAR écrit non conforme au XSD CDAR D22B", erreursXsd);
        var reglages = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true, IndentChars = "  ", NewLineChars = "\n" };
        using var flux = new MemoryStream();
        using (var ecrivain = XmlWriter.Create(flux, reglages)) document.Save(ecrivain);
        return flux.ToArray();
    }

    private static void Exiger(bool condition, string terme, string libelle)
    {
        if (!condition) throw new ExceptionCdar(ErreurFe.DonneeInvalide, $"CDAR : {libelle} ({terme})", [terme]);
    }

    /// <summary>numéro_statut_AAAAMMJJHHMMSS (exemples FNFE), le numéro raccourci si besoin pour tenir en 50 caractères.</summary>
    private static string IdentifiantParDefaut(string numero, string statut, DateTime date)
    {
        var suffixe = $"_{statut}_{date.ToString(MotifDateHeure, CultureInfo.InvariantCulture)}";
        return numero[..Math.Min(numero.Length, LongueurIdentifiant - suffixe.Length)] + suffixe;
    }

    private static XDocument Document(MessageCdar m)
    {
        var contexte = new XElement(Rsm + "ExchangedDocumentContext",
            m.Processus is null ? null : new XElement(Ram + "BusinessProcessSpecifiedDocumentContextParameter", new XElement(Ram + "ID", m.Processus)),
            m.Profil is null ? null : new XElement(Ram + "GuidelineSpecifiedDocumentContextParameter", new XElement(Ram + "ID", m.Profil)));
        var echange = new XElement(Rsm + "ExchangedDocument",
            new XElement(Ram + "ID", m.Identifiant),
            Texte("Name", m.Nom),
            new XElement(Ram + "IssueDateTime", DateHeure(Udt, m.DateCreation)),
            Partie("SenderTradeParty", m.Expediteur),
            Partie("IssuerTradeParty", m.Emetteur),
            m.Destinataires.Select(d => Partie("RecipientTradeParty", d)));
        var racine = new XElement(Rsm + "CrossDomainAcknowledgementAndResponse",
            new XAttribute(XNamespace.Xmlns + "rsm", Rsm.NamespaceName), new XAttribute(XNamespace.Xmlns + "ram", Ram.NamespaceName),
            new XAttribute(XNamespace.Xmlns + "udt", Udt.NamespaceName), new XAttribute(XNamespace.Xmlns + "qdt", Qdt.NamespaceName),
            contexte, echange, m.Accuses.Select(Accuse));
        return new XDocument(new XDeclaration("1.0", "UTF-8", null), racine);
    }

    private static XElement Accuse(AccuseCdar a) => new(Rsm + "AcknowledgementDocument",
        new XElement(Ram + "MultipleReferencesIndicator", new XElement(Udt + "Indicator", a.Multiple ? "true" : "false")),
        Texte("TypeCode", a.TypeAccuse),
        a.DateStatut is { } d ? new XElement(Ram + "IssueDateTime", DateHeure(Udt, d)) : null,
        a.Statuts.Select(Reference));

    private static XElement Reference(StatutFactureCdar s) => new(Ram + "ReferenceReferencedDocument",
        new XElement(Ram + "IssuerAssignedID", s.Numero),
        Texte("StatusCode", s.CodeUntdid),
        Texte("TypeCode", s.TypeFacture),
        s.DateReception is { } r ? new XElement(Ram + "ReceiptDateTime", DateHeure(Udt, r)) : null,
        s.PiecesJointes.Select(p => new XElement(Ram + "AttachmentBinaryObject", new XAttribute("mimeCode", p.TypeMime),
            new XAttribute("filename", p.NomFichier), Convert.ToBase64String(p.Contenu))),
        Texte("ReferenceTypeCode", s.TypeReference),
        s.DateFacture is { } f ? new XElement(Ram + "FormattedIssueDateTime",
            new XElement(Qdt + "DateTimeString", new XAttribute("format", FormatDate), f.ToString(MotifDate, CultureInfo.InvariantCulture))) : null,
        new XElement(Ram + "ProcessConditionCode", s.Statut),
        Texte("ProcessCondition", s.LibelleStatut),
        s.IdentifiantVendeur is null ? null : new XElement(Ram + "IssuerTradeParty", Identifiant("GlobalID", s.IdentifiantVendeur, s.SchemaVendeur)),
        s.Details.Select((d, i) => Detail(d, i + 1)));

    private static XElement Detail(DetailStatutCdar d, int sequence) => new(Ram + "SpecifiedDocumentStatus",
        Texte("ReasonCode", d.Motif),
        Texte("Reason", d.LibelleMotif),
        Texte("RequestedActionCode", d.Action),
        Texte("RequestedAction", d.LibelleAction),
        new XElement(Ram + "SequenceNumeric", sequence),
        d.Notes.Select(n => new XElement(Ram + "IncludedNote", Texte("Content", n.Contenu), Texte("SubjectCode", n.Sujet))),
        d.Caracteristiques.Select(Caracteristique));

    private static XElement Caracteristique(CaracteristiqueCdar c) => new(Ram + "SpecifiedDocumentCharacteristic",
        Texte("ID", c.Identifiant),
        Texte("TypeCode", c.Type),
        c.Modifiee is { } m ? new XElement(Ram + "ValueChangedIndicator", new XElement(Udt + "IndicatorString", m ? "true" : "false")) : null,
        Texte("Name", c.Nom),
        Texte("Location", c.Emplacement),
        Texte("Value", c.Valeur),
        c.Montant is { } montant ? new XElement(Ram + "ValueAmount", c.Devise is null ? null : new XAttribute("currencyID", c.Devise), Nombre(montant)) : null,
        c.Date is { } d ? new XElement(Ram + "ValueDateTime",
            new XElement(Udt + "DateTimeString", new XAttribute("format", FormatDate), d.ToString(MotifDate, CultureInfo.InvariantCulture))) : null,
        c.Pourcentage is { } p ? new XElement(Ram + "ValuePercent", Nombre(p)) : null);

    private static XElement? Partie(string nom, PartieCdar? p) => p is null ? null : new XElement(Ram + nom,
        p.Identifiant is null ? null : Identifiant("GlobalID", p.Identifiant, p.SchemaIdentifiant),
        Texte("Name", p.RaisonSociale),
        Texte("RoleCode", p.Role),
        p.AdresseElectronique is null ? null
            : new XElement(Ram + "URIUniversalCommunication", Identifiant("URIID", p.AdresseElectronique, p.SchemaAdresse)));

    private static XElement Identifiant(string nom, string valeur, string? schema) =>
        new(Ram + nom, schema is null ? null : new XAttribute("schemeID", schema), valeur);

    private static XElement? Texte(string nom, string? valeur) => valeur is null ? null : new XElement(Ram + nom, valeur);

    private static XElement DateHeure(XNamespace ns, DateTime d) =>
        new(ns + "DateTimeString", new XAttribute("format", FormatDateHeure), d.ToString(MotifDateHeure, CultureInfo.InvariantCulture));

    /// <summary>Décimal tel quel (point décimal, échelle conservée : 12000 reste 12000, 20.00 reste 20.00).</summary>
    private static string Nombre(decimal d) => d.ToString(CultureInfo.InvariantCulture);

    // ---------------------------------------------------------------- lecture

    /// <summary>
    /// Lit un CDAR (XML sans DTD ni résolution externe) : XML_ILLISIBLE, SYNTAXE_INCONNUE (autre racine), XSD_INVALIDE
    /// (messages en détails), DONNEE_INVALIDE (MDT-4, MDT-8, MDT-87 ou MDT-105 absent, date ou nombre illisible).
    /// </summary>
    public static MessageCdar Lire(byte[] xml, bool validerXsd = true)
    {
        XDocument document;
        try
        {
            document = OutilsLecture.Charger(xml);
        }
        catch (ExceptionLectureFacture e)
        {
            throw new ExceptionCdar(e.Code, e.Message, e.Details);
        }
        return Lire(document, validerXsd);
    }

    /// <inheritdoc cref="Lire(byte[], bool)"/>
    public static MessageCdar Lire(XDocument document, bool validerXsd = true)
    {
        var racine = document.Root;
        if (racine?.Name != Rsm + "CrossDomainAcknowledgementAndResponse")
            throw new ExceptionCdar(ErreurFe.SyntaxeInconnue, $"Message CDAR attendu (élément racine {racine?.Name})");
        if (validerXsd)
        {
            var erreurs = ValidationXsd.Valider(document, JeuXsd.CdarD22B);
            if (erreurs.Count > 0) throw new ExceptionCdar(ErreurFe.XsdInvalide, "CDAR non conforme au XSD CDAR D22B", erreurs);
        }
        var contexte = racine.Element(Rsm + "ExchangedDocumentContext");
        var echange = racine.Element(Rsm + "ExchangedDocument")!;
        return new MessageCdar(
            Valeur(contexte?.Element(Ram + "BusinessProcessSpecifiedDocumentContextParameter")?.Element(Ram + "ID")),
            Valeur(contexte?.Element(Ram + "GuidelineSpecifiedDocumentContextParameter")?.Element(Ram + "ID")),
            ExigerTexte(Valeur(echange.Element(Ram + "ID")), "MDT-4"),
            Valeur(echange.Element(Ram + "Name")),
            ExigerDate(LireDateHeure(echange.Element(Ram + "IssueDateTime"), "MDT-8"), "MDT-8"),
            LirePartie(echange.Element(Ram + "SenderTradeParty")),
            LirePartie(echange.Element(Ram + "IssuerTradeParty")),
            echange.Elements(Ram + "RecipientTradeParty").Select(p => LirePartie(p)!).ToList(),
            racine.Elements(Rsm + "AcknowledgementDocument").Select(LireAccuse).ToList());
    }

    private static AccuseCdar LireAccuse(XElement a) => new(
        Valeur(a.Element(Ram + "MultipleReferencesIndicator")?.Element(Udt + "Indicator")) == "true",
        Valeur(a.Element(Ram + "TypeCode")),
        LireDateHeure(a.Element(Ram + "IssueDateTime"), "MDT-78"),
        a.Elements(Ram + "ReferenceReferencedDocument").Select(LireReference).ToList());

    private static StatutFactureCdar LireReference(XElement r)
    {
        var vendeur = r.Element(Ram + "IssuerTradeParty")?.Elements(Ram + "GlobalID").ToList() ?? [];
        // MDT-129 peut être répété : le SIREN (0002) d'abord (BR-FR-CDV-13), sinon le premier.
        var idVendeur = vendeur.FirstOrDefault(g => (string?)g.Attribute("schemeID") == SchemaIdentifiant.Siren) ?? vendeur.FirstOrDefault();
        return new StatutFactureCdar(
            ExigerTexte(Valeur(r.Element(Ram + "IssuerAssignedID")), "MDT-87"),
            Valeur(r.Element(Ram + "StatusCode")),
            Valeur(r.Element(Ram + "TypeCode")),
            LireDateHeure(r.Element(Ram + "ReceiptDateTime"), "MDT-95"),
            r.Elements(Ram + "AttachmentBinaryObject").Select(LirePieceJointe).ToList(),
            Valeur(r.Element(Ram + "ReferenceTypeCode")),
            LireDate(r.Element(Ram + "FormattedIssueDateTime"), "MDT-100"),
            ExigerTexte(Valeur(r.Element(Ram + "ProcessConditionCode")), "MDT-105"),
            Valeur(r.Element(Ram + "ProcessCondition")),
            Valeur(idVendeur),
            (string?)idVendeur?.Attribute("schemeID"),
            r.Elements(Ram + "SpecifiedDocumentStatus").Select(LireDetail).ToList());
    }

    private static PieceJointeCdar LirePieceJointe(XElement p)
    {
        try
        {
            return new PieceJointeCdar((string?)p.Attribute("filename") ?? "", (string?)p.Attribute("mimeCode") ?? "", Convert.FromBase64String(p.Value.Trim()));
        }
        catch (FormatException)
        {
            throw new ExceptionCdar(ErreurFe.DonneeInvalide, "Pièce jointe illisible (MDT-96, base 64 attendue)", ["MDT-96"]);
        }
    }

    private static DetailStatutCdar LireDetail(XElement d) => new(
        Valeur(d.Element(Ram + "ReasonCode")),
        Valeur(d.Element(Ram + "Reason")),
        Valeur(d.Element(Ram + "RequestedActionCode")),
        Valeur(d.Element(Ram + "RequestedAction")),
        d.Elements(Ram + "IncludedNote").Select(n => new NoteCdar(Valeur(n.Element(Ram + "Content")), Valeur(n.Element(Ram + "SubjectCode")))).ToList(),
        d.Elements(Ram + "SpecifiedDocumentCharacteristic").Select(LireCaracteristique).ToList());

    private static CaracteristiqueCdar LireCaracteristique(XElement c)
    {
        var montant = c.Element(Ram + "ValueAmount");
        var modifiee = Valeur(c.Element(Ram + "ValueChangedIndicator")?.Element(Udt + "IndicatorString"))
            ?? Valeur(c.Element(Ram + "ValueChangedIndicator")?.Element(Udt + "Indicator"));
        return new CaracteristiqueCdar(
            Valeur(c.Element(Ram + "TypeCode")),
            Valeur(c.Element(Ram + "ID")),
            modifiee is null ? null : modifiee == "true",
            Valeur(c.Element(Ram + "Name")),
            Valeur(c.Element(Ram + "Location")),
            Valeur(c.Element(Ram + "Value")),
            montant is null ? null : OutilsLecture.Decimal(montant, "MDT-215"),
            (string?)montant?.Attribute("currencyID"),
            LireDate(c.Element(Ram + "ValueDateTime"), "MDT-219"),
            c.Element(Ram + "ValuePercent") is { } p ? OutilsLecture.Decimal(p, "MDT-224") : null);
    }

    private static PartieCdar? LirePartie(XElement? p)
    {
        if (p is null) return null;
        var id = p.Element(Ram + "GlobalID");
        var adresse = p.Element(Ram + "URIUniversalCommunication")?.Element(Ram + "URIID");
        return new PartieCdar(Valeur(p.Element(Ram + "RoleCode")), Valeur(id), (string?)id?.Attribute("schemeID"),
            Valeur(p.Element(Ram + "Name")), Valeur(adresse), (string?)adresse?.Attribute("schemeID"));
    }

    private static string? Valeur(XElement? e) => e is null ? null : e.Value.Trim();

    private static string ExigerTexte(string? valeur, string terme) =>
        string.IsNullOrEmpty(valeur) ? throw new ExceptionCdar(ErreurFe.DonneeInvalide, $"Terme obligatoire absent : {terme}", [terme]) : valeur;

    private static DateTime ExigerDate(DateTime? valeur, string terme) =>
        valeur ?? throw new ExceptionCdar(ErreurFe.DonneeInvalide, $"Terme obligatoire absent : {terme}", [terme]);

    /// <summary>Date-heure d'un conteneur (udt:DateTimeString, format 204, à défaut 102).</summary>
    private static DateTime? LireDateHeure(XElement? conteneur, string terme)
    {
        var e = conteneur?.Elements().FirstOrDefault();
        if (e is null) return null;
        var format = (string?)e.Attribute("format") ?? FormatDateHeure;
        var motif = format == FormatDate ? MotifDate : format == FormatDateHeure ? MotifDateHeure : null;
        if (motif is not null && DateTime.TryParseExact(e.Value.Trim(), motif, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        throw new ExceptionCdar(ErreurFe.DonneeInvalide, $"Date illisible ({terme}) : {e.Value} (format {format})", [terme]);
    }

    /// <summary>Date d'un conteneur (qdt:DateTimeString ou udt:DateTimeString, format 102).</summary>
    private static DateOnly? LireDate(XElement? conteneur, string terme)
    {
        var e = conteneur?.Elements().FirstOrDefault();
        if (e is null) return null;
        var format = (string?)e.Attribute("format") ?? FormatDate;
        if (format == FormatDate && DateOnly.TryParseExact(e.Value.Trim(), MotifDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        throw new ExceptionCdar(ErreurFe.DonneeInvalide, $"Date illisible ({terme}) : {e.Value} (format {format})", [terme]);
    }

    // ---------------------------------------------------------------- statuts lus

    /// <summary>
    /// Émetteur du statut (<see cref="EmetteurStatut"/>) d'après le rôle de l'émetteur du message : plateforme → la PA
    /// qui pose ce statut (Rejetée : PA-R si un acheteur est destinataire, PA-E sinon) ; vendeur, facturant, bénéficiaire →
    /// vendeur ; acheteur, facturé, payeur → acheteur ; représentant de l'acheteur ou agent du vendeur → la partie
    /// représentée si elle peut poser ce statut, l'agent sinon ; null si inconnu.
    /// </summary>
    public static string? EmetteurDuRole(string? role, string statut, IReadOnlyList<PartieCdar> destinataires)
    {
        var admis = ReglesCycleVie.EmetteursStatut(statut);
        switch (role)
        {
            case RoleCdar.Plateforme:
                var pa = admis.Where(e => e is EmetteurStatut.PaE or EmetteurStatut.PaR).ToList();
                if (pa.Count <= 1) return pa.FirstOrDefault();
                return destinataires.Any(d => d.Role == RoleCdar.Acheteur) ? EmetteurStatut.PaR : EmetteurStatut.PaE;
            case RoleCdar.Vendeur or RoleCdar.Facturant or RoleCdar.Beneficiaire:
                return EmetteurStatut.Vendeur;
            case RoleCdar.Acheteur or RoleCdar.Facture or RoleCdar.Payeur:
                return EmetteurStatut.Acheteur;
            case RoleCdar.RepresentantAcheteur:
                return admis.Contains(EmetteurStatut.Acheteur) ? EmetteurStatut.Acheteur : EmetteurStatut.Agent;
            case RoleCdar.AgentVendeur:
                return admis.Contains(EmetteurStatut.Vendeur) ? EmetteurStatut.Vendeur : EmetteurStatut.Agent;
            default:
                return null;
        }
    }

    /// <summary>
    /// Statuts d'un message lu, ramenés au cycle de vie d'une facture du sens donné (<see cref="SensFacture"/>) et
    /// contrôlés par <see cref="ReglesCycleVie.Controler"/> (historique : statuts déjà connus de la facture). B2G : indiqué,
    /// ou déduit de l'expéditeur Chorus Pro (matricule 9999).
    /// </summary>
    public static List<StatutLu> StatutsLus(MessageCdar m, string sens, IReadOnlyList<string>? historique = null, bool b2g = false)
    {
        var chorus = m.Expediteur is { SchemaIdentifiant: SchemaIdentifiant.Plateforme, Identifiant: MatriculePlateforme.ChorusPro };
        var resultat = new List<StatutLu>();
        foreach (var accuse in m.Accuses)
        foreach (var s in accuse.Statuts)
        {
            var emetteur = EmetteurDuRole(m.Emetteur?.Role, s.Statut, m.Destinataires);
            var motif = s.Details.Select(d => d.Motif).FirstOrDefault(x => x is not null);
            var action = s.Details.Select(d => d.Action).FirstOrDefault(x => x is not null);
            var encaissements = s.Details.SelectMany(d => d.Caracteristiques)
                .Where(c => c is { Type: CaracteristiqueCdv.MontantEncaisse, Montant: not null, Pourcentage: not null })
                .Select(c => new MontantEncaisse(c.Montant!.Value, c.Pourcentage!.Value, c.Devise)).ToList();
            var erreurs = ReglesCycleVie.Controler(new StatutPropose(sens, historique, s.Statut, emetteur, motif, action, b2g || chorus));
            resultat.Add(new StatutLu(s.Numero, s.Statut, emetteur, motif, action, accuse.DateStatut, encaissements, erreurs));
        }
        return resultat;
    }
}
