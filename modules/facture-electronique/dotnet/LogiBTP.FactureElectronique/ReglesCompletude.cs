using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Socle;

namespace LogiBTP.FactureElectronique;

/// <summary>
/// Émission (plans/facturation-electronique.md, lot 16) : contrôle de complétude d'une facture avant son écriture. Règle
/// miroir : <c>js/src/completude.js</c> (jeu <c>tests/cas/05_completude.json</c>), qui reçoit le même modèle en JSON
/// (<see cref="Json"/>). Règles françaises du schematron BR-FR-Flux2 (FNFE 1.4.0.04), sommes EN16931 (BR-CO-10 à 17),
/// profil et cadre écrits par LogiBTP. Résultat dans l'ordre des contrôles ; niveau <see cref="NiveauCompletude.Bloquant"/>
/// (règle fatale du schematron, facture transmise à un tiers B2B / B2G, Q5) ou <see cref="NiveauCompletude.Avertissement"/>
/// (bloquant à faux, BR-CO-17). Toute modification : les deux langages et un cas du jeu.
/// </summary>
public static partial class ReglesCompletude
{
    /// <summary>Sérialisation du modèle partagée avec le navigateur (propriétés en camelCase).</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Cadres non émis par LogiBTP : multi-vendeurs (8) et facturation bidirectionnelle (9).</summary>
    public static readonly IReadOnlyList<string> CadresNonEmis =
        [CadreFacturation.B8, CadreFacturation.S8, CadreFacturation.M8, CadreFacturation.B9, CadreFacturation.S9, CadreFacturation.M9];
    /// <summary>Autofactures (BR-FR-21 / 22).</summary>
    public static readonly IReadOnlyList<string> TypesAutofacture =
        [TypeFacture.Autofacture, TypeFacture.AutofactureAffacturee, TypeFacture.AcompteAutofacture, TypeFacture.RectificativeAutofacturee,
         TypeFacture.RectificativeAutofactureeAffacturee, TypeFacture.AvoirAutofacture, TypeFacture.AvoirAutofactureAffacture];
    /// <summary>Factures rectificatives (BR-FR-CO-04).</summary>
    public static readonly IReadOnlyList<string> TypesRectificatifs =
        [TypeFacture.Rectificative, TypeFacture.RectificativeAutofacturee, TypeFacture.RectificativeAffacturee, TypeFacture.RectificativeAutofactureeAffacturee];
    /// <summary>Avoirs (BR-FR-CO-05).</summary>
    public static readonly IReadOnlyList<string> TypesAvoir =
        [TypeFacture.AvoirAutofacture, TypeFacture.Avoir, TypeFacture.AvoirAffacture, TypeFacture.AvoirAutofactureAffacture, TypeFacture.AvoirAcompte];
    /// <summary>Acomptes (BR-FR-CO-07 / 08).</summary>
    public static readonly IReadOnlyList<string> TypesAcompte = [TypeFacture.Acompte, TypeFacture.AcompteAutofacture, TypeFacture.AvoirAcompte];
    /// <summary>Taux de TVA admis (BR-FR-16), comparés en valeur.</summary>
    public static readonly IReadOnlyList<decimal> TauxTvaAdmis = [0m, 10m, 13m, 20m, 8.5m, 19.6m, 2.1m, 5.5m, 7m, 20.6m, 1.05m, 0.9m, 1.75m, 9.2m, 9.6m];

    private static readonly string[] CadresPayes = [CadreFacturation.B2, CadreFacturation.S2, CadreFacturation.M2];
    private static readonly string[] CadresDefinitifs = [CadreFacturation.B4, CadreFacturation.S4, CadreFacturation.M4];
    private static readonly string[] CadresBidirectionnels = [CadreFacturation.B9, CadreFacturation.S9, CadreFacturation.M9];
    private const int LongueurNumero = 35;
    private const int LongueurAdresse = 125;
    private const int LongueurRoutage = 100;
    private const int ChiffresMax = 19;
    private const int ChiffresTaux = 4;
    private const string DeviseFrance = "EUR";

    [GeneratedRegex("^[A-Za-z0-9+\\-_/]+$")] private static partial Regex FormatNumero();
    [GeneratedRegex("^[A-Za-z0-9+\\-_.]+$")] private static partial Regex FormatAdresse();
    [GeneratedRegex("^[0-9]{9}$")] private static partial Regex FormatSiren();
    [GeneratedRegex("^[0-9]{14}$")] private static partial Regex FormatSiret();

    private sealed record PartieControlee(Func<Facture, Partie?> Lire, string TermeSiret, string TermeSiren, string TermeAdresse, bool Routage);

    /// <summary>Parties contrôlées (BR-FR-09, 23 à 26, 32), dans l'ordre de completude.js.</summary>
    private static readonly PartieControlee[] Parties =
    [
        new(f => f.Vendeur, "BT-29", "BT-30", "BT-34", true),
        new(f => f.Acheteur, "BT-46", "BT-47", "BT-49", true),
        new(f => f.Beneficiaire, "BT-60", "BT-61", "EXT-FR-FE-29", false),
        new(f => f.AgentAcheteur, "EXT-FR-FE-06", "EXT-FR-FE-BG-01", "EXT-FR-FE-12", false),
        new(f => f.Payeur, "EXT-FR-FE-46", "EXT-FR-FE-BG-02", "EXT-FR-FE-52", false),
        new(f => f.AgentVendeur, "EXT-FR-FE-69", "EXT-FR-FE-BG-03", "EXT-FR-FE-75", false),
    ];

    private static List<string> Valeurs(Type type) =>
        [.. type.GetFields(BindingFlags.Public | BindingFlags.Static).Where(c => c.IsLiteral && c.FieldType == typeof(string)).Select(c => (string)c.GetRawConstantValue()!)];

    private static readonly List<string> Types = Valeurs(typeof(TypeFacture));
    private static readonly List<string> Cadres = Valeurs(typeof(CadreFacturation));
    private static readonly List<string> Categories = Valeurs(typeof(CategorieTva));
    private static readonly List<string> Traitements = Valeurs(typeof(Traitement));

    /// <summary>Nombre de décimales significatives (zéros de fin retirés).</summary>
    public static int Decimales(decimal v)
    {
        var s = Math.Abs(v).ToString(CultureInfo.InvariantCulture);
        var point = s.IndexOf('.');
        return point < 0 ? 0 : s[(point + 1)..].TrimEnd('0').Length;
    }

    /// <summary>Chiffres d'un nombre : partie entière et décimales significatives, sans signe.</summary>
    public static int Chiffres(decimal v) => Math.Truncate(Math.Abs(v)).ToString(CultureInfo.InvariantCulture).Length + Decimales(v);

    /// <summary>Vrai si un écart est bloquant.</summary>
    public static bool Bloquante(IEnumerable<EcartCompletude> ecarts) => ecarts.Any(e => e.Niveau == NiveauCompletude.Bloquant);

    /// <summary>
    /// Contrôle de complétude d'une facture. <paramref name="bloquant"/> : niveau des règles fatales du schematron
    /// (bloquant pour une facture transmise à un tiers B2B / B2G, avertissement sinon) ; BR-CO-17 reste un avertissement.
    /// </summary>
    public static IReadOnlyList<EcartCompletude> Controler(Facture f, bool bloquant = true)
    {
        var niveau = bloquant ? NiveauCompletude.Bloquant : NiveauCompletude.Avertissement;
        var ecarts = new List<EcartCompletude>();
        void Ecart(string regle, string donnee, string? ligne = null, string? n = null) => ecarts.Add(new(regle, n ?? niveau, donnee, ligne));

        var type = f.TypeFacture ?? "";
        var cadre = f.CadreFacturation ?? "";
        var notes = f.Notes ?? [];
        var anterieures = f.FacturesAnterieures ?? [];
        var lignes = f.Lignes ?? [];
        var remisesCharges = f.RemisesCharges ?? [];
        var details = f.DetailsTva ?? [];
        var totaux = f.Totaux;
        var barres = notes.Where(n => n.CodeSujet == CodeNote.Traitement).ToList();
        var traitement = barres.Count > 0 ? barres[0].Texte ?? "" : null;
        var b2b = traitement == Traitement.B2B;

        // LogiBTP : cadre émis, profil écrit, extensions EXT-FR-FE seulement en EXTENDED-CTC-FR.
        if (CadresNonEmis.Contains(cadre)) Ecart(RegleCompletude.Cadre, "BT-23");
        var profil = f.Profil ?? ProfilFacture.En16931;
        if (profil != ProfilFacture.En16931 && profil != ProfilFacture.ExtendedCtcFr) Ecart(RegleCompletude.Profil, "BT-24");
        if (profil != ProfilFacture.ExtendedCtcFr)
        {
            if (f.AgentAcheteur is not null) Ecart(RegleCompletude.Profil, "EXT-FR-FE-BG-01");
            if (f.Payeur is not null) Ecart(RegleCompletude.Profil, "EXT-FR-FE-BG-02");
            if (f.AgentVendeur is not null) Ecart(RegleCompletude.Profil, "EXT-FR-FE-BG-03");
            if (anterieures.Any(a => a.Type is not null)) Ecart(RegleCompletude.Profil, "EXT-FR-FE-02");
            foreach (var l in lignes)
            {
                if (l.LigneParente is not null) Ecart(RegleCompletude.Profil, "EXT-FR-FE-162", l.Identifiant);
                if (l.SousType is not null) Ecart(RegleCompletude.Profil, "EXT-FR-FE-163", l.Identifiant);
                if (l.FactureAnterieure is not null) Ecart(RegleCompletude.Profil, "EXT-FR-FE-BG-06", l.Identifiant);
            }
        }

        // BR-FR-01 / 02 : numéros.
        void Numero(string? valeur, string donnee, string? ligne = null)
        {
            var v = valeur ?? "";
            if (v.Length > LongueurNumero) Ecart(RegleCompletude.BrFr01, donnee, ligne);
            if (!FormatNumero().IsMatch(v)) Ecart(RegleCompletude.BrFr02, donnee, ligne);
        }
        Numero(f.Numero, "BT-1");
        foreach (var a in anterieures) Numero(a.Numero, "BT-25");
        foreach (var l in lignes) if (l.FactureAnterieure is not null) Numero(l.FactureAnterieure.Numero, "EXT-FR-FE-136", l.Identifiant);

        // BR-FR-03 : années entre 2000 et 2099.
        void Date(DateOnly? valeur, string donnee, string? ligne = null)
        {
            if (valeur is { } d && (d.Year < 2000 || d.Year > 2099)) Ecart(RegleCompletude.BrFr03, donnee, ligne);
        }
        Date(f.DateEmission, "BT-2");
        Date(f.DateExigibiliteTva, "BT-7");
        Date(f.DateEcheance, "BT-9");
        foreach (var a in anterieures) Date(a.Date, "BT-26");
        Date(f.Livraison?.Date, "BT-72");
        Date(f.Periode?.Debut, "BT-73");
        Date(f.Periode?.Fin, "BT-74");
        foreach (var l in lignes)
        {
            Date(l.FactureAnterieure?.Date, "EXT-FR-FE-138", l.Identifiant);
            Date(l.Periode?.Debut, "BT-134", l.Identifiant);
            Date(l.Periode?.Fin, "BT-135", l.Identifiant);
        }

        // BR-FR-04 : types admis.
        if (!Types.Contains(type)) Ecart(RegleCompletude.BrFr04, "BT-3");
        foreach (var a in anterieures) if (a.Type is not null && !Types.Contains(a.Type)) Ecart(RegleCompletude.BrFr04, "EXT-FR-FE-02");
        foreach (var l in lignes)
            if (l.FactureAnterieure?.Type is { } t && !Types.Contains(t)) Ecart(RegleCompletude.BrFr04, "EXT-FR-FE-137", l.Identifiant);

        // BR-FR-05 / 06, 20, 31 : notes.
        int Nombre(string code) => notes.Count(n => n.CodeSujet == code);
        foreach (var code in new[] { CodeNote.IndemniteRecouvrement, CodeNote.Penalites, CodeNote.Escompte })
            if (Nombre(code) == 0) Ecart(RegleCompletude.BrFr05, code);
        foreach (var code in new[] { CodeNote.IndemniteRecouvrement, CodeNote.Penalites, CodeNote.Escompte, CodeNote.MentionTaxe })
            if (Nombre(code) > 1) Ecart(RegleCompletude.BrFr06, code);
        foreach (var n in barres) if (!Traitements.Contains(n.Texte ?? "")) Ecart(RegleCompletude.BrFr20, "BT-22");
        if (barres.Count > 1) Ecart(RegleCompletude.BrFr31, "BT-21");

        // BR-FR-08 : cadre.
        if (!Cadres.Contains(cadre)) Ecart(RegleCompletude.BrFr08, "BT-23");

        // BR-FR-10 à 13, 21, 22 : SIREN et adresses électroniques du vendeur et de l'acheteur.
        var vendeur = f.Vendeur;
        var acheteur = f.Acheteur;
        if (!FormatSiren().IsMatch(vendeur?.Siren ?? "")) Ecart(RegleCompletude.BrFr10, "BT-30");
        if (b2b && !FormatSiren().IsMatch(acheteur?.Siren ?? "")) Ecart(RegleCompletude.BrFr11, "BT-47");
        if (string.IsNullOrEmpty(acheteur?.AdresseElectronique?.Valeur)) Ecart(RegleCompletude.BrFr12, "BT-49");
        if (string.IsNullOrEmpty(vendeur?.AdresseElectronique?.Valeur)) Ecart(RegleCompletude.BrFr13, "BT-34");
        static bool Routee(Partie? p) => (p?.AdresseElectronique?.Valeur ?? "").StartsWith(p?.Siren ?? "", StringComparison.Ordinal)
            && p?.AdresseElectronique?.Schema == SchemaIdentifiant.AdresseElectronique;
        var autofacture = TypesAutofacture.Contains(type);
        if (b2b && !autofacture && !Routee(acheteur)) Ecart(RegleCompletude.BrFr21, "BT-49");
        if (b2b && autofacture && !Routee(vendeur)) Ecart(RegleCompletude.BrFr22, "BT-34");

        // Parties : BR-FR-09, 32, 23 / 25, 24 / 26.
        foreach (var pc in Parties)
        {
            var p = pc.Lire(f);
            if (p is null) continue;
            var identifiants = p.Identifiants ?? [];
            var siret = identifiants.FirstOrDefault(i => i.Schema == SchemaIdentifiant.Siret);
            if (siret is not null && !(FormatSiret().IsMatch(siret.Valeur ?? "") && siret.Valeur![..9] == (p.Siren ?? ""))) Ecart(RegleCompletude.BrFr09, pc.TermeSiret);
            if (p.Siren is not null && !FormatSiren().IsMatch(p.Siren)) Ecart(RegleCompletude.BrFr32, pc.TermeSiren);
            foreach (var i in identifiants)
                if (i.Schema == SchemaIdentifiant.Siren && !FormatSiren().IsMatch(i.Valeur ?? "")) Ecart(RegleCompletude.BrFr32, pc.TermeSiret);
            if (p.AdresseElectronique is { } adresse)
            {
                if (adresse.Schema == SchemaIdentifiant.AdresseElectronique && !FormatAdresse().IsMatch(adresse.Valeur ?? "")) Ecart(RegleCompletude.BrFr23, pc.TermeAdresse);
                if ((adresse.Valeur ?? "").Length > LongueurAdresse) Ecart(RegleCompletude.BrFr25, pc.TermeAdresse);
            }
            if (pc.Routage)
            {
                foreach (var i in identifiants.Where(x => x.Schema == SchemaIdentifiant.CodeRoutage))
                {
                    if (!FormatAdresse().IsMatch(i.Valeur ?? "")) Ecart(RegleCompletude.BrFr24, pc.TermeSiret);
                    if ((i.Valeur ?? "").Length > LongueurRoutage) Ecart(RegleCompletude.BrFr26, pc.TermeSiret);
                }
            }
        }

        // BR-FR-15 / 16 : catégories et taux.
        static bool TauxAdmis(decimal t) => TauxTvaAdmis.Contains(t);
        foreach (var r in remisesCharges)
        {
            if (r.CategorieTva is not null && !Categories.Contains(r.CategorieTva)) Ecart(RegleCompletude.BrFr15, r.Charge ? "BT-102" : "BT-95");
            if (r.TauxTva is { } t && !TauxAdmis(t)) Ecart(RegleCompletude.BrFr16, r.Charge ? "BT-103" : "BT-96");
        }
        foreach (var d in details)
        {
            if (!Categories.Contains(d.Categorie ?? "")) Ecart(RegleCompletude.BrFr15, "BT-118");
            if (d.Taux is { } t && !TauxAdmis(t)) Ecart(RegleCompletude.BrFr16, "BT-119");
        }
        foreach (var l in lignes)
        {
            var facultative = l.SousType is SousTypeLigne.Groupe or SousTypeLigne.Information;
            if (l.CategorieTva is not null ? !Categories.Contains(l.CategorieTva) : !facultative) Ecart(RegleCompletude.BrFr15, "BT-151", l.Identifiant);
            if (l.TauxTva is { } t && !TauxAdmis(t)) Ecart(RegleCompletude.BrFr16, "BT-152", l.Identifiant);
        }

        // BR-FR-17 / 18 : pièces jointes.
        var piecesJointes = f.PiecesJointes ?? [];
        foreach (var p in piecesJointes)
            if (p.Description is not null && !TypePieceJointe.Tous.Contains(p.Description)) Ecart(RegleCompletude.BrFr17, "BT-123");
        if (piecesJointes.Count(p => p.Description == TypePieceJointe.Lisible) > 1) Ecart(RegleCompletude.BrFr18, "BT-123");

        // BR-FR-CO-03 à 12.
        if (type == TypeFacture.AvoirRemiseGlobale && !(!string.IsNullOrEmpty(f.References?.Contrat) && f.Periode?.Debut is not null && f.Periode?.Fin is not null))
            Ecart(RegleCompletude.BrFrCo03, "BT-3");
        if (TypesRectificatifs.Contains(type) && anterieures.Count != 1) Ecart(RegleCompletude.BrFrCo04, "BT-3");
        if (TypesAvoir.Contains(type))
        {
            var entete = anterieures.Any(a => !string.IsNullOrEmpty(a.Numero) && a.Date is not null);
            var detail = lignes.Where(l => l.SousType is null || l.SousType == SousTypeLigne.Detail)
                .All(l => l.FactureAnterieure is { } a && !string.IsNullOrEmpty(a.Numero) && a.Date is not null);
            if (!entete && !detail) Ecart(RegleCompletude.BrFrCo05, "BT-3");
        }
        if (f.DateEcheance is { } echeance && !TypesAcompte.Contains(type) && !CadresPayes.Contains(cadre) && echeance < f.DateEmission)
            Ecart(RegleCompletude.BrFrCo07, "BT-9");
        if (CadresDefinitifs.Contains(cadre) && TypesAcompte.Contains(type)) Ecart(RegleCompletude.BrFrCo08, "BT-23");
        if (CadresPayes.Contains(cadre))
        {
            if (totaux?.DejaPaye is not { } paye || paye != totaux.TotalTtc) Ecart(RegleCompletude.BrFrCo09, "BT-113");
            if ((totaux?.NetAPayer ?? 0m) != 0m) Ecart(RegleCompletude.BrFrCo09, "BT-115");
            if (f.DateEcheance is null) Ecart(RegleCompletude.BrFrCo09, "BT-9");
        }
        if ((string.IsNullOrEmpty(f.Devise) ? DeviseFrance : f.Devise) != DeviseFrance)
        {
            if (f.DeviseTva != DeviseFrance) Ecart(RegleCompletude.BrFrCo12, "BT-6");
            if (totaux?.TotalTvaComptable is null) Ecart(RegleCompletude.BrFrCo12, "BT-111");
        }

        // BR-FR-DEC-01 à 04.
        void Format(string regle, decimal? valeur, int max, string donnee, string? ligne = null, bool positif = false, int chiffresMax = ChiffresMax)
        {
            if (valeur is not { } v) return;
            if (Decimales(v) > max || Chiffres(v) > chiffresMax || (positif && v < 0)) Ecart(regle, donnee, ligne);
        }
        foreach (var r in remisesCharges)
        {
            Format(RegleCompletude.BrFrDec01, r.Montant, 2, r.Charge ? "BT-99" : "BT-92");
            Format(RegleCompletude.BrFrDec01, r.Assiette, 2, r.Charge ? "BT-100" : "BT-93");
        }
        if (totaux is not null)
        {
            foreach (var (valeur, terme) in new (decimal?, string)[]
            {
                (totaux.TotalLignes, "BT-106"), (totaux.TotalRemises, "BT-107"), (totaux.TotalCharges, "BT-108"), (totaux.TotalHt, "BT-109"),
                (totaux.TotalTva, "BT-110"), (totaux.TotalTvaComptable, "BT-111"), (totaux.TotalTtc, "BT-112"), (totaux.DejaPaye, "BT-113"),
                (totaux.Arrondi, "BT-114"), (totaux.NetAPayer, "BT-115"),
            }) Format(RegleCompletude.BrFrDec01, valeur, 2, terme);
        }
        foreach (var d in details)
        {
            Format(RegleCompletude.BrFrDec01, d.Base, 2, "BT-116");
            Format(RegleCompletude.BrFrDec01, d.Montant, 2, "BT-117");
        }
        foreach (var l in lignes)
        {
            Format(RegleCompletude.BrFrDec01, l.MontantNet, 2, "BT-131", l.Identifiant);
            foreach (var r in l.RemisesCharges ?? [])
            {
                Format(RegleCompletude.BrFrDec01, r.Montant, 2, r.Charge ? "BT-141" : "BT-136", l.Identifiant);
                Format(RegleCompletude.BrFrDec01, r.Assiette, 2, r.Charge ? "BT-142" : "BT-137", l.Identifiant);
            }
        }
        foreach (var l in lignes)
        {
            Format(RegleCompletude.BrFrDec02, l.Quantite, 4, "BT-129", l.Identifiant);
            Format(RegleCompletude.BrFrDec02, l.QuantiteBase, 4, "BT-149", l.Identifiant);
        }
        var prixPositifs = !CadresBidirectionnels.Contains(cadre);
        foreach (var l in lignes)
        {
            Format(RegleCompletude.BrFrDec03, l.PrixNet, 6, "BT-146", l.Identifiant, prixPositifs);
            Format(RegleCompletude.BrFrDec03, l.Rabais, 6, "BT-147", l.Identifiant, prixPositifs);
            Format(RegleCompletude.BrFrDec03, l.PrixBrut, 6, "BT-148", l.Identifiant, prixPositifs);
        }
        foreach (var r in remisesCharges) Format(RegleCompletude.BrFrDec04, r.TauxTva, 2, r.Charge ? "BT-103" : "BT-96", null, true, ChiffresTaux);
        foreach (var d in details) Format(RegleCompletude.BrFrDec04, d.Taux, 2, "BT-119", null, true, ChiffresTaux);
        foreach (var l in lignes) Format(RegleCompletude.BrFrDec04, l.TauxTva, 2, "BT-152", l.Identifiant, true, ChiffresTaux);

        // Sommes EN16931 (BR-CO-10 à 16) ; BR-CO-17 en avertissement.
        static decimal Somme(IEnumerable<decimal> valeurs) => ArrondiCalcul.Arrondir(valeurs.Sum(), 2);
        var t0 = totaux ?? new Totaux { TotalLignes = 0, TotalHt = 0, TotalTtc = 0, NetAPayer = 0 };
        var detailLignes = lignes.Where(l => l.SousType is null || l.SousType == SousTypeLigne.Detail);
        if (t0.TotalLignes != Somme(detailLignes.Select(l => l.MontantNet))) Ecart(RegleCompletude.BrCo10, "BT-106");
        var remises = remisesCharges.Where(r => !r.Charge).ToList();
        var charges = remisesCharges.Where(r => r.Charge).ToList();
        if ((remises.Count > 0 || t0.TotalRemises is not null) && !(t0.TotalRemises is { } tr && tr == Somme(remises.Select(r => r.Montant))))
            Ecart(RegleCompletude.BrCo11, "BT-107");
        if ((charges.Count > 0 || t0.TotalCharges is not null) && !(t0.TotalCharges is { } tc && tc == Somme(charges.Select(r => r.Montant))))
            Ecart(RegleCompletude.BrCo12, "BT-108");
        if (t0.TotalHt != ArrondiCalcul.Arrondir(t0.TotalLignes - (t0.TotalRemises ?? 0m) + (t0.TotalCharges ?? 0m), 2)) Ecart(RegleCompletude.BrCo13, "BT-109");
        if (t0.TotalTva is { } tva && tva != Somme(details.Select(d => d.Montant))) Ecart(RegleCompletude.BrCo14, "BT-110");
        if (t0.TotalTtc != t0.TotalHt + (t0.TotalTva ?? 0m)) Ecart(RegleCompletude.BrCo15, "BT-112");
        if (t0.NetAPayer != t0.TotalTtc - (t0.DejaPaye ?? 0m) + (t0.Arrondi ?? 0m)) Ecart(RegleCompletude.BrCo16, "BT-115");
        foreach (var d in details)
            if (d.Taux is { } taux && d.Montant != ArrondiCalcul.Arrondir(d.Base * taux / 100m, 2))
                Ecart(RegleCompletude.BrCo17, "BT-117", null, NiveauCompletude.Avertissement);
        return ecarts;
    }
}

/// <summary>Écart du contrôle de complétude : règle (<see cref="RegleCompletude"/>), niveau (<see cref="NiveauCompletude"/>), terme BT ou groupe en cause, ligne (BT-126) ou null.</summary>
public sealed record EcartCompletude(string Regle, string Niveau, string Donnee, string? Ligne);
