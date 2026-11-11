using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Calcul;
using LogiBTP.Comptabilite;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Partie d'une pièce émise (société de la base ou tiers) : identifiants, adresse électronique, adresse postale, contact.</summary>
public sealed record PartieEmissionFe
{
    public required string RaisonSociale { get; init; }
    public string? NomCommercial { get; init; }
    public string? Siren { get; init; }
    public string? Siret { get; init; }
    public string? NumeroTva { get; init; }
    /// <summary>per_fe_adresse (vide : le SIREN, adresse de base de l'annuaire).</summary>
    public string? AdresseFe { get; init; }
    public string? CodeRoutage { get; init; }
    /// <summary>per_fe_type : B2B, B2C, B2G, INTERNATIONAL (vide : B2B).</summary>
    public string? TypeFe { get; init; }
    /// <summary>per_fe_code_service (référence de l'acheteur BT-10, B2G).</summary>
    public string? CodeService { get; init; }
    public string Pays { get; init; } = "FR";
    public AdressePostale? Adresse { get; init; }
    public Contact? Contact { get; init; }
}

/// <summary>Taux de TVA du référentiel avec sa catégorie EN 16931 et son code VATEX (categorie_tva, lot 10).</summary>
public sealed record TauxEmissionFe(int Id, decimal Taux, string Comportement, string? Categorie = null, string? Vatex = null, string? Mention = null);

/// <summary>Facture antérieure (BG-3) : facture d'origine d'un avoir, facture d'acompte déduite.</summary>
public sealed record AnterieureEmissionFe(string? Numero, DateOnly? Date);

/// <summary>Entrée de la construction d'une facture électronique depuis une pièce de vente (voir <see cref="EmissionFactureBtp.Construire"/>).</summary>
public sealed record EntreeFactureBtp
{
    public required DocumentBtp Document { get; init; }
    public IReadOnlyList<DocumentLigneBtp> Lignes { get; init; } = [];
    /// <summary>Ventilation de TVA calculée (document_tva).</summary>
    public IReadOnlyList<DocumentTva> Tva { get; init; } = [];
    public IReadOnlyDictionary<int, TauxEmissionFe> Taux { get; init; } = new Dictionary<int, TauxEmissionFe>();
    /// <summary>BT-3, cadre, BT-8 et notes légales (lot 21, <see cref="EmissionFeBtp.Parametres"/>).</summary>
    public required ParametresEmissionFe Parametres { get; init; }
    public PartieEmissionFe? Vendeur { get; init; }
    public PartieEmissionFe? Acheteur { get; init; }
    /// <summary>Adresse des travaux (ent_adresse_livraison : vide si identique au client) et son libellé.</summary>
    public AdressePostale? AdresseLivraison { get; init; }
    public string? NomLivraison { get; init; }
    /// <summary>BT-20 : libellé de la condition de paiement.</summary>
    public string? ConditionsPaiement { get; init; }
    /// <summary>BT-9 : première échéance normale de l'échéancier.</summary>
    public DateOnly? Echeance { get; init; }
    /// <summary>Mode de règlement (mode_reglement : VIREMENT, CHEQUE…) et coordonnées bancaires de la société.</summary>
    public string? ModeReglement { get; init; }
    public string? Iban { get; init; }
    public string? Bic { get; init; }
    /// <summary>Facture d'origine d'un avoir (lien TRANSFORMATION ou ANNULATION, pièce valable).</summary>
    public IReadOnlyList<AnterieureEmissionFe> Origines { get; init; } = [];
    /// <summary>Factures d'acompte déduites, par marqueur de poste « A&lt;mac_id&gt; » (null : acompte sans facture valable).</summary>
    public IReadOnlyDictionary<string, AnterieureEmissionFe?> Acomptes { get; init; } = new Dictionary<string, AnterieureEmissionFe?>();
    /// <summary>Codes du chantier (BT-11, BT-18), du marché (BT-12) et du projet d'origine (appel d'offres, BT-17).</summary>
    public string? Chantier { get; init; }
    public string? Marche { get; init; }
    public string? Projet { get; init; }
    /// <summary>Pièce d'avancement : début de la période (lendemain de la pièce d'avancement précédente ; null : premier du mois).</summary>
    public DateOnly? DebutPeriode { get; init; }
}

/// <summary>Facture construite et écarts propres à LogiBTP (<see cref="EcartsEmissionFe"/>, niveau <see cref="NiveauCompletude"/>).</summary>
public sealed record FactureConstruiteFe(Facture Facture, IReadOnlyList<EcartCompletude> Ecarts);

/// <summary>Contrôle d'une pièce : complétude du module (lot 16) et écarts de l'émission, niveau selon le tiers (Q5).</summary>
public sealed record ControleEmissionFe(bool Applicable, string? TypeFacture, string? Cadre, string? Profil, bool Bloquant,
    IReadOnlyList<EcartCompletude> Completude, IReadOnlyList<EcartCompletude> Emission);

/// <summary>
/// Document de vente → modèle de facture électronique EN 16931 (plans/facturation-electronique.md, lot 22, cas simples ;
/// analyse § 2.9 et § 6.2) : facture (380), facture d'acompte (386), avoir (381 avec la facture d'origine en BG-3, 503 pour
/// celui d'une facture d'acompte), facture définitive (cadre B4 / S4 / M4 : factures d'acompte en BG-3 et reprise de chaque
/// acompte déduit en ligne négative, quantité −1). Lignes = lignes de prix vendues (sans ancêtre ouvrage, hors type de prix
/// hors total) ; postes de pied HT (hors reprise d'acompte) et écarts : remise ou charge du document par catégorie et taux,
/// pour que chaque base (BT-116) soit celle de la ventilation calculée ; postes TTC : la facture porte le total (retenue :
/// lot 23), acompte de trésorerie déduit en montant déjà payé (BT-113). TVA par ctv_categorie_en16931 et ctv_vatex (à défaut
/// proposés par le comportement, ReglesTva) ; taux 0 hors catégories S et Z. Parties : SIREN, SIRET (0009), TVA, adresse
/// électronique (0225, à défaut le SIREN), code de routage (0224), adresse postale, contact. Paiement : condition (BT-20),
/// première échéance (BT-9, pas sur un avoir), moyen (UNTDID 4461) et IBAN de la société. Le serveur seul construit le
/// modèle : l'éditeur affiche le résultat du contrôle de la pièce enregistrée (aucune règle répliquée).
/// Situations et pied BTP (lot 23, Q10) : une pièce d'avancement est émise en montants de la période quelle que soit sa
/// présentation (C : cumul − précédent de chaque ligne et de chaque poste de pied saisi en avancement ; poste de pied HT sans
/// avancement au prorata période / cumul des lignes ; TVA recalculée sur la base de la période par l'arrondi unique), lignes
/// de période nulle omises, période BG-14 (lendemain de la pièce précédente, sinon premier du mois → date de la pièce) ;
/// postes de pied HT (prorata, frais, remises) en remises ou charges du document ; postes TTC autres que les acomptes
/// (retenue de garantie, paiement direct, prorata ou frais après TVA) hors facture : la facture porte le total, ils figurent
/// dans les conditions de paiement (BT-20) et la retenue en note ABU ; références BT-11 et BT-18 (chantier), BT-12
/// (marché), BT-17 (projet d'origine, appel d'offres).
/// Routes : GET /api/facture-electronique/documents/{id}/controle et …/{id}/xml?syntaxe=CII|UBL (EmissionFeDonneesBtp).
/// </summary>
public static partial class EmissionFactureBtp
{
    /// <summary>Moyen de paiement BT-81 par mode de règlement (019k) ; autre mode : non défini.</summary>
    public static readonly IReadOnlyDictionary<string, string> MoyensPaiement = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["VIREMENT"] = MoyenPaiementFe.Virement, ["PRELEVEMENT"] = MoyenPaiementFe.PrelevementSepa, ["CHEQUE"] = MoyenPaiementFe.Cheque,
        ["CB"] = MoyenPaiementFe.Carte, ["ESPECES"] = MoyenPaiementFe.Especes,
    };

    /// <summary>Unité LogiBTP → unité UN/ECE (inverse de ReceptionFactureBtp.UnitesUnece, première correspondance) ; défaut C62.</summary>
    public static readonly IReadOnlyDictionary<string, string> UnitesEmises = ReceptionFactureBtp.UnitesUnece
        .GroupBy(x => x.Value, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().Key, StringComparer.OrdinalIgnoreCase);

    public const string UniteDefaut = "C62";
    /// <summary>Codes de motif des remises (UNTDID 5189 : remise) et charges (UNTDID 7161 : convenu) d'ajustement du pied.</summary>
    public const string MotifRemise = "95";
    public const string MotifCharge = "ZZZ";

    private static readonly HashSet<string> CategoriesTaxees = [LogiBTP.FactureElectronique.CategorieTva.Normale, LogiBTP.FactureElectronique.CategorieTva.TauxZero];
    private static readonly HashSet<string> TypesBloquants = ["B2B", "B2G"];

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex Balises();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Blancs();

    private static decimal A2(decimal v) => ArrondiCalcul.Arrondir(v, 2);

    /// <summary>Texte d'un libellé de ligne (brut, sinon affiché ou saisi sans balises), blancs réduits.</summary>
    public static string? Texte(DocumentLigne l)
    {
        var s = !string.IsNullOrWhiteSpace(l.LigLibelleBrut) ? l.LigLibelleBrut
            : WebUtility.HtmlDecode(Balises().Replace(!string.IsNullOrWhiteSpace(l.LigLibelleAffiche) ? l.LigLibelleAffiche : l.LigLibelleHtml ?? "", " "));
        s = Blancs().Replace(s ?? "", " ").Trim();
        return s.Length == 0 ? null : s;
    }

    /// <summary>Le tiers reçoit sa facture par la plateforme (B2B, B2G : niveau bloquant de la complétude, Q5).</summary>
    public static bool Bloquant(PartieEmissionFe? acheteur) => acheteur is not null && TypesBloquants.Contains(acheteur.TypeFe ?? "B2B");

    /// <summary>Note BAR (BR-FR-20) du type du tiers.</summary>
    public static string TraitementDe(string? typeFe) => typeFe switch
    {
        "B2C" => Traitement.B2C,
        "INTERNATIONAL" => Traitement.B2BInt,
        _ => Traitement.B2B,
    };

    /// <summary>Catégorie EN 16931 d'un taux : celle de sa catégorie comptable, sinon proposée par son comportement.</summary>
    public static string? CategorieDe(TauxEmissionFe t) =>
        string.IsNullOrWhiteSpace(t.Categorie) ? ReglesTva.Proposer(t.Comportement)?.Categorie : t.Categorie;

    /// <summary>Taux écrit (BT-152, BT-119) : celui du référentiel pour S et Z, 0 sinon (autoliquidation, exonération…).</summary>
    public static decimal TauxDe(string categorie, decimal taux) => CategoriesTaxees.Contains(categorie) ? taux : 0m;

    /// <summary>Marqueur de poste de marché d'une ligne (lig_proprietes.poste_marche), ou null.</summary>
    public static string? PosteMarche(DocumentLigne l) =>
        l.LigProprietes is { } p && p.RootElement.ValueKind == JsonValueKind.Object && p.RootElement.TryGetProperty(PostesMarche.Marqueur, out var v)
            && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool EstAcompte(DocumentLigne l) => PosteMarche(l) is { } c && c.StartsWith('A');

    /// <summary>Ligne ou poste de pied saisi en avancement (lig_avt_mode).</summary>
    private static bool Avance(DocumentLigne l) => !string.IsNullOrEmpty(l.LigAvtMode);

    /// <summary>Lignes facturées : lignes de prix sans ancêtre ouvrage, hors pied, de type de prix vendu (hérité), montant calculé.</summary>
    public static List<DocumentLigneBtp> LignesFacturees(IReadOnlyList<DocumentLigneBtp> lignes)
    {
        var parId = new Dictionary<long, DocumentLigneBtp>();
        foreach (var l in lignes) parId.TryAdd(l.LigId, l);
        return lignes.Where(l =>
        {
            if (!TL.EstChiffree(l) || TL.EstPied(l) || l.LigMontantHt is null || (l.LigTypePrix ?? "V") != "V") return false;
            for (var x = l.LigParentId is long p && parId.TryGetValue(p, out var y) ? y : null; x is not null;
                 x = x.LigParentId is long q && parId.TryGetValue(q, out var z) ? z : null)
            {
                if (x.LigTylId == TL.Ouvrage || (x.LigTypePrix ?? "V") != "V") return false;
            }
            return true;
        }).OrderBy(l => l.LigChemin, StringComparer.Ordinal).ThenBy(l => l.LigOrdre).ToList();
    }

    private sealed class Groupe
    {
        public required string Categorie;
        public required decimal Taux;
        public string? Vatex;
        public string? Mention;
        public decimal Base;
        public decimal Tva;
        public decimal Lignes;
        /// <summary>Situation présentée en cumul : postes de pied HT de la période.</summary>
        public decimal Pied;
        public List<string> Postes = [];
    }

    private static Partie Partie(PartieEmissionFe p, bool routage)
    {
        var identifiants = new List<Identifiant>();
        if (!string.IsNullOrWhiteSpace(p.Siret)) identifiants.Add(new Identifiant(p.Siret.Trim(), SchemaIdentifiant.Siret));
        if (routage && !string.IsNullOrWhiteSpace(p.CodeRoutage)) identifiants.Add(new Identifiant(p.CodeRoutage.Trim(), SchemaIdentifiant.CodeRoutage));
        var adresse = !string.IsNullOrWhiteSpace(p.AdresseFe) ? p.AdresseFe.Trim() : string.IsNullOrWhiteSpace(p.Siren) ? null : p.Siren.Trim();
        return new Partie
        {
            RaisonSociale = p.RaisonSociale,
            NomCommercial = string.IsNullOrWhiteSpace(p.NomCommercial) ? null : p.NomCommercial,
            Identifiants = identifiants,
            Siren = string.IsNullOrWhiteSpace(p.Siren) ? null : p.Siren.Trim(),
            NumeroTva = string.IsNullOrWhiteSpace(p.NumeroTva) ? null : p.NumeroTva.Trim(),
            AdresseElectronique = adresse is null ? null : new Identifiant(adresse, SchemaIdentifiant.AdresseElectronique),
            Adresse = p.Adresse,
            Contact = p.Contact,
        };
    }

    /// <summary>Modèle de facture électronique d'une pièce de vente et écarts de l'émission (sans base).</summary>
    public static FactureConstruiteFe Construire(EntreeFactureBtp e)
    {
        var d = e.Document;
        var p = e.Parametres;
        var acheteurFe = e.Acheteur;
        var niveau = Bloquant(acheteurFe) ? NiveauCompletude.Bloquant : NiveauCompletude.Avertissement;
        var ecarts = new List<EcartCompletude>();
        void Ecart(string code, string donnee, string? ligne = null, string? n = null) => ecarts.Add(new EcartCompletude(code, n ?? niveau, donnee, ligne));

        var avoir = ReglesCompletude.TypesAvoir.Contains(p.TypeFacture);
        // Pièce d'avancement (lot 23, Q10) : émise en montants de la période ; présentée en cumul (C), la période est recalculée.
        var avancement = !string.IsNullOrEmpty(d.EntAvtPresentation);
        var cumul = d.EntAvtPresentation == "C";
        decimal MontantPeriode(DocumentLigne l) => cumul && Avance(l) ? (l.LigMontantHt ?? 0) - (l.LigAvtMontantPrecedent ?? 0) : l.LigMontantHt ?? 0;
        // Avoir saisi en négatif (avoir d'avancement) : montants inversés, l'avoir porte des montants positifs.
        var signe = avoir && d.EntTotalHt < 0 ? -1m : 1m;

        var numero = d.EntNumero;
        if (string.IsNullOrWhiteSpace(numero))
        {
            numero = $"PROV-{d.EntId.ToString(CultureInfo.InvariantCulture)}";
            Ecart(EcartsEmissionFe.NumeroProvisoire, "BT-1", null, NiveauCompletude.Avertissement);
        }

        // Taux de la ventilation et des lignes, regroupés par catégorie EN 16931 et taux écrit.
        var groupes = new Dictionary<(string, decimal), Groupe>();
        (string Categorie, decimal Taux)? Cle(int? ttv, decimal? tauxLigne)
        {
            if (ttv is not int id || !e.Taux.TryGetValue(id, out var t)) return null;
            var cat = CategorieDe(t) ?? LogiBTP.FactureElectronique.CategorieTva.Normale;
            var taux = TauxDe(cat, tauxLigne ?? t.Taux);
            if (!groupes.TryGetValue((cat, taux), out var g))
            {
                groupes[(cat, taux)] = g = new Groupe
                {
                    Categorie = cat, Taux = taux,
                    Vatex = cat == LogiBTP.FactureElectronique.CategorieTva.Normale ? null : t.Vatex ?? ReglesTva.Proposer(t.Comportement)?.Vatex,
                    Mention = cat == LogiBTP.FactureElectronique.CategorieTva.Normale ? null : t.Mention,
                };
            }
            return (cat, taux);
        }
        foreach (var t in e.Tva)
        {
            if (Cle(t.TvaTtvId, t.TvaTaux) is not { } k) continue;
            var g = groupes[k];
            g.Mention ??= g.Categorie == LogiBTP.FactureElectronique.CategorieTva.Normale ? null : t.TvaMention;
            // Cumul : base et TVA de la période calculées plus bas (lignes et postes de la période).
            if (cumul) continue;
            g.Base += signe * A2(t.TvaBaseHt);
            g.Tva += signe * A2(t.TvaMontantNet);
        }

        // Lignes vendues, en montants de la période (présentation C : cumul − précédent des lignes saisies en avancement) ;
        // pièce d'avancement : lignes de période nulle omises (sauf si toutes le sont).
        var vendues = LignesFacturees(e.Lignes);
        var cumulVendues = vendues.Sum(l => l.LigMontantHt!.Value);
        var periodeVendues = vendues.Sum(MontantPeriode);
        if (avancement && vendues.Any(l => A2(MontantPeriode(l)) != 0)) vendues = vendues.Where(l => A2(MontantPeriode(l)) != 0).ToList();
        var numeros = vendues.Select(l => l.LigNumerotation).ToList();
        var parNumero = numeros.All(n => !string.IsNullOrWhiteSpace(n)) && numeros.Distinct(StringComparer.Ordinal).Count() == numeros.Count;
        var lignes = new List<LigneFacture>();
        string Identifiant(DocumentLigneBtp? l) => l is not null && parNumero ? l.LigNumerotation! : (lignes.Count + 1).ToString(CultureInfo.InvariantCulture);
        LigneFacture Ligne(string id, string nom, decimal quantite, decimal montant, string? unite, (string Categorie, decimal Taux)? cle,
            string? reference = null, string? note = null)
        {
            montant = A2(montant);
            var q = ArrondiCalcul.Arrondir(quantite, 4);
            if (q == 0) q = 1;
            // Prix net positif (BR-FR-DEC-03) : le signe du montant passe dans la quantité.
            var prix = ArrondiCalcul.Arrondir(Math.Abs(montant / q), 6);
            q = montant < 0 ? -Math.Abs(q) : Math.Abs(q);
            if (cle is { } k) groupes[k].Lignes += montant;
            return new LigneFacture
            {
                Identifiant = id, Nom = nom, Quantite = q, Unite = unite ?? UniteDefaut, MontantNet = montant, PrixNet = prix,
                CategorieTva = cle?.Categorie, TauxTva = cle?.Taux, ReferenceVendeur = string.IsNullOrWhiteSpace(reference) ? null : reference, Note = note,
            };
        }
        foreach (var l in vendues)
        {
            var id = Identifiant(l);
            var cle = Cle(l.LigTvaId, l.LigTauxTva);
            if (cle is null) Ecart(EcartsEmissionFe.TvaAbsente, "BT-151", id);
            var unite = l.LigUntCode is { } u && UnitesEmises.TryGetValue(u.Trim(), out var x) ? x : UniteDefaut;
            var quantite = cumul && Avance(l) ? (l.LigAvtQteCumul ?? l.LigQteVendue ?? 0) - (l.LigAvtQtePrecedent ?? 0) : l.LigQteVendue ?? l.LigQte ?? 1;
            lignes.Add(Ligne(id, Texte(l) ?? l.LigCode ?? id, signe * quantite, signe * MontantPeriode(l), unite, cle, l.LigCode));
        }

        // Montant réparti par catégorie et taux au prorata des lignes (le dernier groupe reçoit le reste).
        List<((string, decimal) Cle, decimal Part)> Repartir(decimal montant)
        {
            var bases = groupes.Values.Where(g => g.Lignes != 0).OrderBy(g => g.Categorie, StringComparer.Ordinal).ThenBy(g => g.Taux).ToList();
            var total = bases.Sum(g => g.Lignes);
            var parts = new List<((string, decimal), decimal)>();
            var reste = montant;
            for (var i = 0; i < bases.Count; i++)
            {
                var part = i == bases.Count - 1 || total == 0 ? reste : A2(montant * bases[i].Lignes / total);
                reste -= part;
                parts.Add(((bases[i].Categorie, bases[i].Taux), part));
            }
            return parts;
        }

        // Reprises d'acompte (postes HT « A<mac_id> » des factures définitives) : ligne négative par taux, au prorata des lignes.
        var anterieures = new List<FactureAnterieure>();
        void Anterieure(AnterieureEmissionFe? a)
        {
            if (a?.Numero is not { Length: > 0 } n || anterieures.Any(x => x.Numero == n)) return;
            anterieures.Add(new FactureAnterieure(n, a.Date));
        }
        var piedHt = e.Lignes.Where(l => l.LigTylId == TL.PiedHt && (l.LigTypePrix ?? "V") == "V" && l.LigMontantHt is decimal m && m != 0).ToList();
        foreach (var r in piedHt.Where(EstAcompte))
        {
            e.Acomptes.TryGetValue(PosteMarche(r)!, out var acompte);
            if (acompte?.Numero is null) Ecart(EcartsEmissionFe.AcompteAbsent, "BG-3");
            Anterieure(acompte);
            // Cumul : reprise de la période (cumul − précédent).
            var montant = signe * (cumul ? r.LigMontantHt!.Value - (r.LigAvtMontantPrecedent ?? 0) : r.LigMontantHt!.Value);
            var parts = Cle(r.LigTvaId, null) is { } propre ? [(propre, montant)] : Repartir(montant);
            var nom = Texte(r) ?? PosteMarche(r)!;
            foreach (var (cle, part) in parts.Where(x => x.Part != 0))
            {
                lignes.Add(Ligne((lignes.Count + 1).ToString(CultureInfo.InvariantCulture), nom, -1, part, UniteDefaut, cle,
                    note: acompte?.Numero));
            }
        }
        if (parNumero && lignes.Select(l => l.Identifiant).Distinct(StringComparer.Ordinal).Count() != lignes.Count)
        {
            lignes = lignes.Select((l, i) => l with { Identifiant = (i + 1).ToString(CultureInfo.InvariantCulture) }).ToList();
        }
        foreach (var r in piedHt.Where(l => !EstAcompte(l)))
        {
            if (Texte(r) is not { } t) continue;
            var cles = Cle(r.LigTvaId, null) is { } k ? [k] : groupes.Keys.ToList();
            foreach (var c in cles) if (!groupes[c].Postes.Contains(t)) groupes[c].Postes.Add(t);
        }

        // Cumul : base de la période = lignes + postes de pied HT de la période (saisis en avancement : cumul − précédent ;
        // sinon au prorata période / cumul des lignes vendues) ; TVA recalculée sur la base (arrondi unique, BR-CO-17 exact).
        if (cumul)
        {
            var ratio = cumulVendues == 0 ? 0m : periodeVendues / cumulVendues;
            foreach (var r in piedHt.Where(l => !EstAcompte(l)))
            {
                var montant = signe * (Avance(r) ? MontantPeriode(r) : A2(r.LigMontantHt!.Value * ratio));
                foreach (var (c, part) in Cle(r.LigTvaId, null) is { } propre ? [(propre, montant)] : Repartir(montant)) groupes[c].Pied += part;
            }
            foreach (var g in groupes.Values)
            {
                g.Base = A2(g.Lignes + g.Pied);
                g.Tva = CategoriesTaxees.Contains(g.Categorie) ? A2(g.Base * g.Taux / 100m) : 0m;
            }
        }

        // Remise ou charge du document par catégorie et taux : base de la ventilation − lignes (postes de pied HT, écarts).
        var remisesCharges = new List<RemiseCharge>();
        foreach (var g in groupes.Values.OrderBy(g => g.Categorie, StringComparer.Ordinal).ThenBy(g => g.Taux))
        {
            var ecart = A2(g.Base - g.Lignes);
            if (ecart == 0) continue;
            remisesCharges.Add(new RemiseCharge
            {
                Charge = ecart > 0, Montant = Math.Abs(ecart), CategorieTva = g.Categorie, TauxTva = g.Taux,
                Motif = g.Postes.Count > 0 ? string.Join(" ; ", g.Postes) : null, CodeMotif = ecart > 0 ? MotifCharge : MotifRemise,
            });
        }
        var details = groupes.Values.Where(g => g.Base != 0 || g.Lignes != 0).OrderBy(g => g.Categorie, StringComparer.Ordinal).ThenBy(g => g.Taux)
            .Select(g => new DetailTva
            {
                Base = A2(g.Base), Montant = A2(g.Tva), Categorie = g.Categorie, Taux = g.Taux,
                CodeExoneration = g.Vatex, MotifExoneration = g.Categorie == LogiBTP.FactureElectronique.CategorieTva.Normale ? null : g.Mention,
            }).ToList();

        // Totaux : la facture porte le total TTC ; acompte de trésorerie déduit (poste TTC « A… ») = montant déjà payé.
        var totalLignes = A2(lignes.Sum(l => l.MontantNet));
        var remises = remisesCharges.Where(r => !r.Charge).ToList();
        var charges = remisesCharges.Where(r => r.Charge).ToList();
        decimal? totalRemises = remises.Count > 0 ? A2(remises.Sum(r => r.Montant)) : null;
        decimal? totalCharges = charges.Count > 0 ? A2(charges.Sum(r => r.Montant)) : null;
        var totalHt = A2(totalLignes - (totalRemises ?? 0) + (totalCharges ?? 0));
        var totalTva = A2(details.Sum(x => x.Montant));
        var totalTtc = totalHt + totalTva;
        var dejaPaye = A2(-signe * e.Lignes.Where(l => l.LigTylId == TL.PiedTtc && (l.LigTypePrix ?? "V") == "V" && EstAcompte(l)).Sum(l => l.LigMontantHt ?? 0));
        foreach (var r in e.Lignes.Where(l => l.LigTylId == TL.PiedTtc && EstAcompte(l))) Anterieure(e.Acomptes.GetValueOrDefault(PosteMarche(r)!));

        // Factures antérieures : facture d'origine d'un avoir.
        if (avoir)
        {
            foreach (var o in e.Origines) Anterieure(o);
            if (e.Origines.Count == 0) Ecart(EcartsEmissionFe.OrigineAbsente, "BG-3");
        }

        // Parties.
        if (e.Vendeur is null) Ecart(EcartsEmissionFe.SocieteAbsente, "BG-4");
        if (acheteurFe is null) Ecart(EcartsEmissionFe.TiersAbsent, "BG-7");
        var vendeur = e.Vendeur is { } v ? Partie(v, true) : new Partie { RaisonSociale = "" };
        var acheteur = acheteurFe is { } a0 ? Partie(a0, true) : new Partie { RaisonSociale = "" };
        if (e.Vendeur is not null && vendeur.Adresse is null) Ecart(EcartsEmissionFe.AdresseAbsente, "BG-5");
        if (acheteurFe is not null && acheteur.Adresse is null) Ecart(EcartsEmissionFe.AdresseAbsente, "BG-8");

        // Livraison : adresse des travaux ; intracommunautaire sans elle : adresse et date de l'acheteur (BR-IC-11 / 12).
        Livraison? livraison = e.AdresseLivraison is { } al ? new Livraison(e.NomLivraison, null, null, al) : null;
        if (groupes.Keys.Any(k => k.Item1 == LogiBTP.FactureElectronique.CategorieTva.Intracommunautaire))
        {
            livraison = (livraison ?? new Livraison(null, null, null, acheteur.Adresse)) with { Date = d.EntDate };
        }

        // Paiement : moyen (virement : IBAN exigé), conditions, échéance (pas sur un avoir).
        var moyens = new List<MoyenPaiement>();
        if (!string.IsNullOrWhiteSpace(e.ModeReglement))
        {
            var code = MoyensPaiement.TryGetValue(e.ModeReglement, out var c) ? c : MoyenPaiementFe.NonDefini;
            if (code == MoyenPaiementFe.Virement && string.IsNullOrWhiteSpace(e.Iban)) Ecart(EcartsEmissionFe.IbanAbsent, "BT-84");
            else if (!avoir || code == MoyenPaiementFe.Virement)
            {
                moyens.Add(code == MoyenPaiementFe.Virement
                    ? new MoyenPaiement(code, numero, e.Iban!.Replace(" ", "", StringComparison.Ordinal), string.IsNullOrWhiteSpace(e.Bic) ? null : e.Bic.Trim())
                    : new MoyenPaiement(code, numero));
            }
        }
        // Postes TTC autres que les acomptes (retenue de garantie, paiement direct, prorata ou frais après TVA) : hors facture, la
        // facture porte le total ; montant de la période (cumul : cumul − précédent, ou au prorata période / cumul du TTC) dans
        // les conditions de paiement (BT-20), retenue de garantie en note ABU (clause de réserve).
        var devise = string.IsNullOrWhiteSpace(d.EntDevise) ? "EUR" : d.EntDevise;
        var ratioTtc = d.EntTotalTtc == 0 ? 0m : totalTtc / (signe * d.EntTotalTtc);
        var horsFacture = new List<string>();
        var reserves = new List<string>();
        foreach (var r in e.Lignes.Where(l => l.LigTylId == TL.PiedTtc && (l.LigTypePrix ?? "V") == "V" && !EstAcompte(l) && l.LigMontantHt is decimal m && m != 0)
                     .OrderBy(l => l.LigOrdre))
        {
            var montant = A2(signe * (!cumul ? r.LigMontantHt!.Value : Avance(r) ? MontantPeriode(r) : r.LigMontantHt!.Value * ratioTtc));
            if (montant == 0) continue;
            var pct = r.LigPiedMode == "P" && r.LigPiedValeur is decimal v0 ? $" ({EcritureCii.Nombre(v0)} %)" : "";
            var texte = $"{Texte(r) ?? PosteMarche(r)}{pct} : {montant.ToString("0.00", CultureInfo.InvariantCulture)} {devise}";
            horsFacture.Add(texte);
            if (r.LigPiedRetenue || PosteMarche(r) == PostesMarche.CleRetenue) reserves.Add(texte);
        }
        var conditions = string.Join(" ; ", new[] { string.IsNullOrWhiteSpace(e.ConditionsPaiement) ? null : e.ConditionsPaiement.Trim() }
            .Concat(horsFacture).Where(x => x is not null));
        if (conditions.Length == 0) conditions = null;
        DateOnly? echeance = avoir ? null : e.Echeance;
        var net = totalTtc - dejaPaye;
        if (net > 0 && conditions is null && echeance is null) Ecart(EcartsEmissionFe.PaiementAbsent, "BT-20");

        var notes = new List<NoteFacture>(p.Notes) { new(CodeNote.Traitement, TraitementDe(acheteurFe?.TypeFe)) };
        if (reserves.Count > 0) notes.Add(new NoteFacture(CodeNote.Reserve, string.Join(" ; ", reserves)));

        // Période de facturation (BG-14, BR-FR-CO-17) d'une pièce d'avancement : lendemain de la précédente, sinon premier du mois.
        Periode? periode = null;
        if (avancement)
        {
            var debut = e.DebutPeriode ?? MoisFacturation.Debut(d.EntDate);
            periode = new Periode(debut > d.EntDate ? d.EntDate : debut, d.EntDate);
        }
        string? Code(string? x) => string.IsNullOrWhiteSpace(x) ? null : x.Trim();
        var facture = new Facture
        {
            Numero = numero,
            DateEmission = d.EntDate,
            TypeFacture = p.TypeFacture,
            Devise = devise,
            CodeExigibiliteTva = p.CodeExigibiliteTva,
            DateEcheance = echeance,
            CadreFacturation = p.Cadre,
            Profil = ProfilFacture.En16931,
            References = new ReferencesFacture
            {
                Acheteur = string.IsNullOrWhiteSpace(acheteurFe?.CodeService) ? null : acheteurFe.CodeService,
                Commande = string.IsNullOrWhiteSpace(d.EntReferenceExterne) ? null : d.EntReferenceExterne.Trim(),
                Projet = Code(e.Chantier), Contrat = Code(e.Marche), AppelOffres = Code(e.Projet), Objet = Code(e.Chantier),
            },
            Periode = periode,
            ConditionsPaiement = conditions,
            Notes = notes,
            FacturesAnterieures = anterieures,
            Vendeur = vendeur,
            Acheteur = acheteur,
            Livraison = livraison,
            MoyensPaiement = moyens,
            RemisesCharges = remisesCharges,
            Totaux = new Totaux
            {
                TotalLignes = totalLignes, TotalRemises = totalRemises, TotalCharges = totalCharges, TotalHt = totalHt, TotalTva = totalTva,
                TotalTtc = totalTtc, DejaPaye = dejaPaye != 0 ? dejaPaye : null, NetAPayer = net,
            },
            DetailsTva = details,
            Lignes = lignes,
        };
        return new FactureConstruiteFe(facture, ecarts);
    }

    /// <summary>Contrôle d'une facture construite : complétude du module (niveau selon le tiers) et écarts de l'émission.</summary>
    public static ControleEmissionFe Controler(EntreeFactureBtp e)
    {
        var c = Construire(e);
        var bloquant = Bloquant(e.Acheteur);
        return new ControleEmissionFe(true, c.Facture.TypeFacture, c.Facture.CadreFacturation, c.Facture.Profil, bloquant,
            ReglesCompletude.Controler(c.Facture, bloquant), c.Ecarts);
    }

    // ---------------------------------------------------------------- lecture en base

    private sealed record LignePersonneSql(long Id, string RaisonSociale, string? NomCommercial, string? Siren, string? Siret, string? Tva,
        string? AdresseFe, string? Routage, string? TypeFe, string? Service, string Pays, string? Iban, string? Bic, string? Mode, string? Delai);
    private sealed record LigneTauxSql(int Id, decimal Taux, string Comportement, string? Categorie, string? Vatex, string? Mention);
    private sealed record LigneAnterieureSql(string? Numero, DateOnly? Date, string? Cle);
    private sealed record LigneReferencesSql(string? Chantier, string? Marche, string? Projet, DateOnly? Precedente);

    /// <summary>
    /// Codes du chantier (de la pièce, sinon du marché), du marché et du projet (de la pièce, sinon du chantier) ; date de la
    /// dernière pièce d'avancement du marché facturée avant celle-ci (comme le pied d'avancement de l'édition : déductions figées,
    /// sinon factures et avoirs d'avancement valables non annulés et reprises, de numéro de situation inférieur, datés au plus tard
    /// le jour de la pièce).
    /// </summary>
    private const string SqlReferences = """
        SELECT c.cha_code AS chantier, m.mar_code AS marche, p.prj_code AS projet,
               (SELECT max(x.ent_date) FROM document x JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id
                WHERE d.ent_avt_presentation IS NOT NULL AND x.ent_id <> d.ent_id AND x.ent_date <= d.ent_date
                  AND (x.ent_id IN (SELECT k.ded_deduit_ent_id FROM document_deduction k WHERE k.ded_ent_id = d.ent_id)
                       OR (NOT EXISTS (SELECT 1 FROM document_deduction k WHERE k.ded_ent_id = d.ent_id)
                           AND x.ent_marche_id = d.ent_marche_id AND f_document_valable(x.ent_id, FALSE)
                           AND (x.ent_avt_presentation = 'P' OR tx.tyd_avancement = 'R')
                           AND (x.ent_rang_avancement IS NULL OR d.ent_rang_avancement IS NULL OR x.ent_rang_avancement < d.ent_rang_avancement)))) AS precedente
        FROM document d
        LEFT JOIN marche m ON m.mar_id = d.ent_marche_id
        LEFT JOIN chantier c ON c.cha_id = coalesce(d.ent_chantier_id, m.mar_cha_id)
        LEFT JOIN projet p ON p.prj_id = coalesce(d.ent_projet_id, c.cha_prj_id)
        WHERE d.ent_id = {0}
        """;

    private const string SqlPersonne = """
        SELECT per_id AS id, per_raison_sociale AS raison_sociale, per_nom_commercial AS nom_commercial, per_siren::text AS siren,
               per_siret::text AS siret, per_tva_intra AS tva, per_fe_adresse AS adresse_fe, per_fe_code_routage AS routage,
               per_fe_type AS type_fe, per_fe_code_service AS service, per_pays::text AS pays, per_iban AS iban, per_bic AS bic,
               coalesce(per_cli_mode_reglement, per_mode_reglement) AS mode, coalesce(per_cli_delai_paiement, per_delai_paiement) AS delai
        FROM personne
        """;

    private static AdressePostale? Adresse(JsonElement? a, string pays)
    {
        if (a is not { ValueKind: JsonValueKind.Object } x) return null;
        string? T(string n) => x.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString()) ? v.GetString()!.Trim() : null;
        if (T("ligne1") is null && T("ville") is null && T("code_postal") is null) return null;
        return new AdressePostale(T("ligne1"), T("ligne2"), T("ligne3"), T("ville"), T("code_postal"), null, (T("pays") ?? pays).ToUpperInvariant());
    }

    private static JsonElement? Champ(JsonDocument? j, string nom) =>
        j is not null && j.RootElement.ValueKind == JsonValueKind.Object && j.RootElement.TryGetProperty(nom, out var v) ? v : null;

    private static async Task<(PartieEmissionFe Partie, LignePersonneSql Ligne)?> PersonneAsync(LogiBtpContext db, string filtre, object? valeur,
        JsonDocument? instantane, CancellationToken ct)
    {
        var l = valeur is null
            ? await db.Database.SqlQueryRaw<LignePersonneSql>(SqlPersonne + " WHERE " + filtre).FirstOrDefaultAsync(ct)
            : await db.Database.SqlQueryRaw<LignePersonneSql>(SqlPersonne + " WHERE " + filtre, valeur).FirstOrDefaultAsync(ct);
        if (l is null) return null;
        var snap = instantane ?? await ContactsDocument.Instantane(db, l.Id, null, ct);
        var contact = Champ(snap, "contact") is { ValueKind: JsonValueKind.Object } c && c.TryGetProperty("nom", out var n) ? n.GetString() : null;
        string? Texte(string nom) => Champ(snap, nom) is { ValueKind: JsonValueKind.String } v ? v.GetString() : null;
        var partie = new PartieEmissionFe
        {
            RaisonSociale = l.RaisonSociale, NomCommercial = l.NomCommercial, Siren = l.Siren, Siret = l.Siret, NumeroTva = l.Tva,
            AdresseFe = l.AdresseFe, CodeRoutage = l.Routage, TypeFe = l.TypeFe, CodeService = l.Service, Pays = l.Pays,
            Adresse = Adresse(Champ(snap, "adresse"), l.Pays),
            Contact = contact is null && Texte("telephone") is null && Texte("email") is null ? null : new Contact(contact, Texte("telephone"), Texte("email")),
        };
        return (partie, l);
    }

    /// <summary>Entrée de la construction lue en base (null : pièce introuvable ou type jamais émis).</summary>
    public static async Task<EntreeFactureBtp?> EntreeAsync(LogiBtpContext db, long id, CancellationToken ct)
    {
        var parametres = await EmissionFeDonneesBtp.EntreeAsync(db, id, null, false, ct) is { } entree ? EmissionFeBtp.Parametres(entree) : null;
        if (parametres is null) return null;
        var d = await db.Documents.AsNoTracking().FirstAsync(x => x.EntId == id, ct);
        var lignes = await db.Lignes.AsNoTracking().Where(l => l.LigEntId == id).ToListAsync(ct);
        var tva = await db.DocumentsTva.AsNoTracking().Where(t => t.TvaEntId == id).ToListAsync(ct);
        var taux = (await db.Database.SqlQueryRaw<LigneTauxSql>("""
            SELECT t.ttv_id AS id, t.ttv_taux AS taux, t.ttv_categorie::text AS comportement, c.ctv_categorie_en16931 AS categorie,
                   c.ctv_vatex AS vatex, coalesce(t.ttv_mention, c.ctv_mention) AS mention
            FROM taux_tva t LEFT JOIN categorie_tva c ON c.ctv_code = t.ttv_ctv_code
            """).ToListAsync(ct)).ToDictionary(t => t.Id, t => new TauxEmissionFe(t.Id, t.Taux, t.Comportement, t.Categorie, t.Vatex, t.Mention));

        var societe = await PersonneAsync(db, "per_societe_base", null, null, ct);
        var client = ContactsDocument.Source(d, "CLIENT", FamillesDocument.Vente) is var (perId, _)
            ? await PersonneAsync(db, "per_id = {0}", perId, d.EntContactClient, ct) : null;

        var livraison = Champ(d.EntAdresseLivraison, "adresse");
        var nomLivraison = Champ(d.EntAdresseLivraison, "libelle") is { ValueKind: JsonValueKind.String } nl ? nl.GetString() : null;
        var cpa = d.EntCpaCode ?? client?.Ligne.Delai;
        var conditions = cpa is null ? null
            : await db.Database.SqlQueryRaw<string>("SELECT cpa_libelle AS \"Value\" FROM condition_paiement WHERE cpa_code = {0}", cpa).FirstOrDefaultAsync(ct);
        var echeance = await db.Database.SqlQueryRaw<DateOnly?>("""
            SELECT ech_date AS "Value" FROM document_echeance WHERE ech_ent_id = {0} AND ech_nature = 'NORMALE' AND ech_date IS NOT NULL
            ORDER BY ech_rang LIMIT 1
            """, id).FirstOrDefaultAsync(ct);

        // Facture d'origine d'un avoir : pièce valable (annulée comprise) d'un type émis.
        var origines = await db.Database.SqlQueryRaw<LigneAnterieureSql>("""
            SELECT s.ent_numero AS numero, s.ent_date AS date, NULL::text AS cle
            FROM document_lien l JOIN document s ON s.ent_id = l.lie_source_ent_id JOIN type_document t ON t.tyd_id = s.ent_tyd_id
            WHERE l.lie_cible_ent_id = {0} AND l.lie_type IN ('TRANSFORMATION', 'ANNULATION') AND t.tyd_fe_type_facture IS NOT NULL
              AND f_document_valable(s.ent_id, TRUE)
            ORDER BY s.ent_id
            """, id).ToListAsync(ct);
        // Factures d'acompte des postes « A<mac_id> » : pièce de l'acompte, valable et non annulée.
        var acomptes = await db.Database.SqlQueryRaw<LigneAnterieureSql>("""
            SELECT f.ent_numero AS numero, f.ent_date AS date, 'A' || a.mac_id AS cle
            FROM marche_acompte a LEFT JOIN document f ON f.ent_id = a.mac_piece_ent_id AND f_document_valable(f.ent_id, FALSE)
            WHERE ('A' || a.mac_id) IN (SELECT l.lig_proprietes->>'poste_marche' FROM document_ligne l WHERE l.lig_ent_id = {0})
            """, id).ToListAsync(ct);
        var references = await db.Database.SqlQueryRaw<LigneReferencesSql>(SqlReferences, id).FirstAsync(ct);

        return new EntreeFactureBtp
        {
            Document = d, Lignes = lignes, Tva = tva, Taux = taux, Parametres = parametres,
            Vendeur = societe?.Partie, Acheteur = client?.Partie,
            AdresseLivraison = Adresse(livraison, client?.Partie.Pays ?? "FR"), NomLivraison = nomLivraison,
            ConditionsPaiement = conditions, Echeance = echeance,
            ModeReglement = d.EntModeReglement ?? client?.Ligne.Mode, Iban = societe?.Ligne.Iban, Bic = societe?.Ligne.Bic,
            Origines = origines.Where(o => o.Numero is not null).Select(o => new AnterieureEmissionFe(o.Numero, o.Date)).ToList(),
            Acomptes = acomptes.ToDictionary(a => a.Cle!, a => a.Numero is null ? null : new AnterieureEmissionFe(a.Numero, a.Date)),
            Chantier = references.Chantier, Marche = references.Marche, Projet = references.Projet,
            DebutPeriode = references.Precedente?.AddDays(1),
        };
    }

    /// <summary>Contrôle d'une pièce (type jamais émis : non applicable) ; pièce introuvable : 404.</summary>
    public static async Task<ControleEmissionFe> ControleAsync(LogiBtpContext db, long id, CancellationToken ct)
    {
        if (!await db.Documents.AnyAsync(x => x.EntId == id, ct)) throw ExceptionMetier.Introuvable("Document");
        return await EntreeAsync(db, id, ct) is { } e ? Controler(e) : new ControleEmissionFe(false, null, null, null, false, [], []);
    }

    /// <summary>XML de la facture (CII D22B ou UBL 2.1) d'une pièce émise ; type jamais émis : 404.</summary>
    public static async Task<(byte[] Contenu, string Nom)> XmlAsync(LogiBtpContext db, long id, string? syntaxe, CancellationToken ct)
    {
        var e = await EntreeAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable("Document");
        var f = Construire(e).Facture;
        var ubl = string.Equals(syntaxe, Syntaxe.Ubl, StringComparison.OrdinalIgnoreCase);
        var contenu = ubl ? EcritureUbl.Ecrire(f) : EcritureCii.Ecrire(f);
        return (contenu, $"{f.Numero}_{(ubl ? Syntaxe.Ubl : Syntaxe.Cii)}.xml");
    }
}
