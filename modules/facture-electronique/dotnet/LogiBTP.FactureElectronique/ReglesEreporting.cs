using System.Globalization;
using System.Text.RegularExpressions;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.Socle;

namespace LogiBTP.FactureElectronique;

/// <summary>
/// Règles de l'e-reporting (flux 10, plans/facturation-electronique.md, lot 19 ; décision Q20 : LogiBTP collecte, extrait et
/// transmet à la plateforme agréée les données brutes de vente et d'encaissement, en un envoi ou en plusieurs envois par
/// période, au choix de la société). C# seul (aucun écran ne les rejoue) ; jeu <c>tests/cas/06_ereporting.json</c>.
/// <list type="bullet">
/// <item>Période (<see cref="Periodicite"/>, <see cref="Periode"/>) selon le régime de TVA de la société : réel normal
/// mensuel : transactions par décade, paiements par mois ; réel normal trimestriel et simplifié : par mois ; franchise en
/// base : par bimestre (spécifications externes DGFiP de la facturation électronique, calendrier de l'e-reporting : à
/// confirmer avec la version en vigueur, risque R7).</item>
/// <item>Agrégation B2C (<see cref="Agreger"/>, <see cref="AgregerPaiements"/>) : par jour, devise, catégorie TT-81 et
/// option sur les débits, puis par taux ; sommes arrondies par l'arrondi unique du socle (2 décimales).</item>
/// <item>Extraction d'une facture B2B internationale (<see cref="TransactionDe"/>) : termes BT → TT.</item>
/// <item>Découpage en envois (<see cref="Decouper"/>) : un envoi par sous-flux (10.1 à 10.4 : un type de flux XP Z12-013
/// chacun, et un seul rapport par transmission, G6.29) ; <see cref="DecoupageEreporting.Unique"/> : un envoi par sous-flux
/// et par période, <see cref="DecoupageEreporting.Plusieurs"/> : un envoi par sous-flux et par jour. Correction d'une période
/// déjà envoyée : rang de correction n ≥ 1 → transmissions rectificatives (RE) de la même période, identifiants suffixés
/// « -REn » (G8.05 : identifiant unique par période et par déclarant).</item>
/// <item>Contrôle avant envoi (<see cref="Controler"/>) : règles de gestion de l'annexe 7 v1.8 reprises du schematron
/// Flux10 du paquet FNFE (le serveur ne joue pas le XSLT, Q6), plus <see cref="RegleEreporting.Periode"/>.</item>
/// </list>
/// </summary>
public static partial class ReglesEreporting
{
    private const string Euro = "EUR";
    private const int LongueurTransmission = 50;
    private const int LongueurNumero = 35;
    private const int ChiffresMax = 19;
    private const int AnneeMin = 2000;
    private const int AnneeMax = 2099;
    private const int MatriculePlateforme = 4;
    private const string VatexNonTva = "VATEX-FR-CNWVAT";
    private const decimal Tolerance = 0.01m;

    /// <summary>Types de facture admis (G1.01) : tous les types du modèle sauf l'avoir de remise globale (262).</summary>
    public static readonly IReadOnlyList<string> TypesAdmis =
    [
        TypeFacture.AvoirAutofacture, TypeFacture.Facture, TypeFacture.Avoir, TypeFacture.Rectificative, TypeFacture.Acompte,
        TypeFacture.Autofacture, TypeFacture.Affacturee, TypeFacture.AvoirAffacture, TypeFacture.RectificativeAutofacturee,
        TypeFacture.RectificativeAffacturee, TypeFacture.RectificativeAutofactureeAffacturee, TypeFacture.AcompteAutofacture,
        TypeFacture.AutofactureAffacturee, TypeFacture.AvoirAutofactureAffacture, TypeFacture.AvoirAcompte,
    ];

    /// <summary>Cadres admis (G1.02).</summary>
    public static readonly IReadOnlyList<string> CadresAdmis =
    [
        CadreFacturation.B1, CadreFacturation.S1, CadreFacturation.M1, CadreFacturation.B2, CadreFacturation.S2, CadreFacturation.M2,
        CadreFacturation.B4, CadreFacturation.S4, CadreFacturation.M4, CadreFacturation.S5, CadreFacturation.S6, CadreFacturation.B7,
        CadreFacturation.S7,
    ];

    /// <summary>Types d'identifiant d'une entreprise (G2.19).</summary>
    public static readonly IReadOnlyList<string> SchemasEntreprise =
        [SchemaIdentifiant.Siren, SchemaIdentifiant.UeHorsFrance, SchemaIdentifiant.HorsUe, SchemaIdentifiant.Ridet, SchemaIdentifiant.Tahiti];

    private static readonly string[] CadresDefinitifs = [CadreFacturation.B4, CadreFacturation.S4, CadreFacturation.M4];
    private static readonly string[] TypesAvoirNonTva = [TypeFacture.AvoirAutofacture, TypeFacture.Avoir, TypeFacture.AvoirAffacture];
    private static readonly string[] CategoriesTva =
        [CategorieTva.Normale, CategorieTva.Exoneree, CategorieTva.Autoliquidation, CategorieTva.Intracommunautaire, CategorieTva.Exportation,
         CategorieTva.HorsChamp, CategorieTva.TauxZero];

    [GeneratedRegex("^[a-zA-Z0-9 \\-+_/]+$")] private static partial Regex FormatIdentifiant();
    [GeneratedRegex("^[0-9]{9}$")] private static partial Regex FormatNeufChiffres();
    [GeneratedRegex("^[0-9]{9,10}$")] private static partial Regex FormatRidet();
    [GeneratedRegex("^[A-Z]{2}$")] private static partial Regex FormatPays();
    [GeneratedRegex("^[A-Z]{3}$")] private static partial Regex FormatDevise();

    private static ExceptionLectureFacture Invalide(string terme, string message) => new(ErreurFe.DonneeInvalide, message, [terme]);

    private static bool EstPaiement(string sousFlux) => sousFlux switch
    {
        SousFluxEreporting.TransactionsUnitaires or SousFluxEreporting.TransactionsAgregees => false,
        SousFluxEreporting.PaiementsUnitaires or SousFluxEreporting.PaiementsAgreges => true,
        _ => throw Invalide("TB-1", $"Sous-flux d'e-reporting inconnu : {sousFlux}"),
    };

    // ---- Période ----

    /// <summary>Périodicité d'un sous-flux selon le régime de TVA de la société (<see cref="RegimeEreporting"/>).</summary>
    public static string Periodicite(string regime, string sousFlux)
    {
        var paiements = EstPaiement(sousFlux);
        return regime switch
        {
            RegimeEreporting.ReelNormalMensuel => paiements ? PeriodiciteEreporting.Mois : PeriodiciteEreporting.Decade,
            RegimeEreporting.ReelNormalTrimestriel or RegimeEreporting.Simplifie => PeriodiciteEreporting.Mois,
            RegimeEreporting.Franchise => PeriodiciteEreporting.Bimestre,
            _ => throw Invalide("TG-7", $"Régime d'e-reporting inconnu : {regime}"),
        };
    }

    /// <summary>Période d'un sous-flux contenant un jour.</summary>
    public static PeriodeEreporting Periode(DateOnly jour, string regime, string sousFlux)
    {
        var fin = DateTime.DaysInMonth(jour.Year, jour.Month);
        return Periodicite(regime, sousFlux) switch
        {
            PeriodiciteEreporting.Decade => jour.Day switch
            {
                <= 10 => new(new(jour.Year, jour.Month, 1), new(jour.Year, jour.Month, 10)),
                <= 20 => new(new(jour.Year, jour.Month, 11), new(jour.Year, jour.Month, 20)),
                _ => new(new(jour.Year, jour.Month, 21), new(jour.Year, jour.Month, fin)),
            },
            PeriodiciteEreporting.Mois => new(new(jour.Year, jour.Month, 1), new(jour.Year, jour.Month, fin)),
            _ => Bimestre(jour),
        };

        static PeriodeEreporting Bimestre(DateOnly jour)
        {
            var debut = new DateOnly(jour.Year, (jour.Month - 1) / 2 * 2 + 1, 1);
            return new(debut, debut.AddMonths(2).AddDays(-1));
        }
    }

    // ---- Agrégation ----

    private static decimal Arrondi(decimal v) => ArrondiCalcul.Arrondir(v, 2);

    /// <summary>Ventes B2C → transactions agrégées (10.3) : par jour, devise, catégorie et option sur les débits, puis par taux.</summary>
    public static IReadOnlyList<TransactionsAgregees> Agreger(IEnumerable<VenteB2C> ventes) =>
        [.. ventes
            .GroupBy(v => (v.Date, v.Devise, v.Categorie, Exigibilite: v.CodeExigibiliteTva ?? ""))
            .OrderBy(g => g.Key.Date).ThenBy(g => RangCategorie(g.Key.Categorie)).ThenBy(g => g.Key.Categorie, StringComparer.Ordinal)
            .ThenBy(g => g.Key.Devise, StringComparer.Ordinal).ThenBy(g => g.Key.Exigibilite, StringComparer.Ordinal)
            .Select(g =>
            {
                var ventilation = g.SelectMany(v => v.Ventilation).GroupBy(t => t.Taux).OrderBy(t => t.Key)
                    .Select(t => new VentilationAgregee(t.Key, Arrondi(t.Sum(x => x.Base)), Arrondi(t.Sum(x => x.Tva)))).ToList();
                return new TransactionsAgregees
                {
                    Date = g.Key.Date, Devise = g.Key.Devise, Categorie = g.Key.Categorie,
                    CodeExigibiliteTva = g.Key.Exigibilite.Length == 0 ? null : g.Key.Exigibilite,
                    TotalHt = Arrondi(ventilation.Sum(t => t.Base)), TotalTva = Arrondi(ventilation.Sum(t => t.Tva)),
                    Nombre = g.Count(), Ventilation = ventilation,
                };
            })];

    private static int RangCategorie(string c)
    {
        var i = Array.IndexOf(CategorieTransactions.Toutes, c);
        return i < 0 ? int.MaxValue : i;
    }

    /// <summary>Encaissements B2C → paiements agrégés (10.4) : par jour, puis par taux et devise.</summary>
    public static IReadOnlyList<PaiementsAgreges> AgregerPaiements(IEnumerable<EncaissementEreporting> encaissements) =>
        [.. encaissements.GroupBy(e => e.Date).OrderBy(g => g.Key)
            .Select(g => new PaiementsAgreges(g.Key, Montants(g.SelectMany(e => e.Montants))))];

    /// <summary>Encaissements de factures → paiements unitaires (10.2) : par facture et jour de paiement, puis par taux.</summary>
    public static IReadOnlyList<PaiementUnitaire> PaiementsUnitaires(IEnumerable<EncaissementEreporting> encaissements) =>
        [.. encaissements
            .Select(e => e.Facture is { Length: > 0 } && e.DateFacture is not null ? e : throw Invalide("TT-91", "Encaissement unitaire sans facture (numéro et date)"))
            .GroupBy(e => (e.Date, Numero: e.Facture!, DateFacture: e.DateFacture!.Value))
            .OrderBy(g => g.Key.Date).ThenBy(g => g.Key.Numero, StringComparer.Ordinal)
            .Select(g => new PaiementUnitaire(g.Key.Numero, g.Key.DateFacture, g.Key.Date, Montants(g.SelectMany(e => e.Montants))))];

    private static List<EncaisseParTaux> Montants(IEnumerable<EncaisseParTaux> montants) =>
        [.. montants.GroupBy(m => (m.Taux, Devise: m.Devise ?? "")).OrderBy(m => m.Key.Taux).ThenBy(m => m.Key.Devise, StringComparer.Ordinal)
            .Select(m => new EncaisseParTaux(m.Key.Taux, Arrondi(m.Sum(x => x.Montant)), m.Key.Devise.Length == 0 ? null : m.Key.Devise))];

    // ---- Extraction d'une facture (10.1) ----

    /// <summary>Facture du modèle sémantique → transaction unitaire (BT → TT, annexe A, colonne « ID BT Flux 2 »).</summary>
    public static TransactionUnitaire TransactionDe(Facture f)
    {
        var deviseTva = f.DeviseTva ?? f.Devise;
        var totalTva = f.DeviseTva is { } dt && dt != f.Devise ? f.Totaux.TotalTvaComptable ?? 0m : f.Totaux.TotalTva ?? 0m;
        return new TransactionUnitaire
        {
            Numero = f.Numero, Date = f.DateEmission, Type = f.TypeFacture, Devise = f.Devise, Echeance = f.DateEcheance,
            CodeExigibiliteTva = f.CodeExigibiliteTva, Notes = f.Notes, Cadre = f.CadreFacturation,
            FacturesAnterieures = [.. f.FacturesAnterieures.Select(a => new FactureAnterieure(a.Numero, a.Date))],
            Vendeur = Entreprise(f.Vendeur), Acheteur = Entreprise(f.Acheteur), TvaRepresentantFiscal = f.RepresentantFiscal?.NumeroTva,
            Livraisons = f.Livraison is { } l && (l.Date is not null || l.Adresse is not null) ? [new LivraisonEreporting(l.Date, l.Adresse)] : [],
            Periode = f.Periode,
            RemisesCharges = [.. f.RemisesCharges.Select(r => new RemiseChargeEreporting(r.Charge, r.Montant, r.CategorieTva, r.TauxTva))],
            TotalHt = f.Totaux.TotalHt, TotalTva = totalTva, DeviseTva = deviseTva, Ventilation = f.DetailsTva,
            Lignes = [.. f.Lignes.Select(Ligne)],
        };

        static LigneEreporting Ligne(LigneFacture l) => new()
        {
            Notes = l.Note is { Length: > 0 } n ? [new NoteFacture(null, n)] : [],
            Quantite = l.Quantite, Unite = l.Unite is { Length: > 0 } u ? u : null,
            FactureAnterieure = l.FactureAnterieure, Periode = l.Periode,
            RemisesCharges = [.. l.RemisesCharges.Select(r => new RemiseChargeEreporting(r.Charge, r.Montant))],
            PrixNet = l.PrixNet, Rabais = l.Rabais, PrixBrut = l.PrixBrut, Nom = l.Nom,
        };
    }

    /// <summary>Partie → entreprise : SIREN (0002), à défaut le premier identifiant d'un type G2.19 ; TVA ; pays.</summary>
    public static EntrepriseEreporting Entreprise(Partie p)
    {
        var identifiant = p.Siren is { Length: > 0 } siren
            ? new Identifiant(siren, SchemaIdentifiant.Siren)
            : p.Identifiants.FirstOrDefault(i => i.Schema is { } s && SchemasEntreprise.Contains(s));
        return new EntrepriseEreporting(identifiant, p.NumeroTva, p.Adresse?.CodePays);
    }

    // ---- Découpage en envois ----

    /// <summary>
    /// Données d'une période → envois, dans l'ordre 10.1, 10.2, 10.3, 10.4 (sous-flux vides omis), puis par jour en
    /// découpage PLUSIEURS. Rang de correction <see cref="ContexteEnvoi.Correction"/> : 0 → IN, n ≥ 1 → RE.
    /// </summary>
    public static IReadOnlyList<EnvoiEreporting> Decouper(DonneesEreporting d, string decoupage, ContexteEnvoi c)
    {
        if (decoupage is not (DecoupageEreporting.Unique or DecoupageEreporting.Plusieurs))
            throw Invalide("TB-1", $"Découpage de l'e-reporting inconnu : {decoupage}");
        if (c.Correction < 0) throw Invalide("TT-4", "Rang de correction négatif");
        var parJour = decoupage == DecoupageEreporting.Plusieurs;
        var envois = new List<EnvoiEreporting>();

        void Ajouter<T>(string sousFlux, IReadOnlyList<T> elements, Func<T, DateOnly> jour, PeriodeEreporting? periode,
            Func<PeriodeEreporting, IReadOnlyList<T>, TransmissionEreporting, TransmissionEreporting> remplir)
        {
            if (elements.Count == 0) return;
            if (periode is null) throw Invalide(EstPaiement(sousFlux) ? "TG-33" : "TG-7", $"Période absente pour le sous-flux {sousFlux}");
            var groupes = parJour
                ? elements.GroupBy(jour).OrderBy(g => g.Key).Select(g => ((DateOnly?)g.Key, (IReadOnlyList<T>)[.. g])).ToList()
                : [(null, elements)];
            var rang = 0;
            foreach (var (j, contenu) in groupes)
            {
                rang++;
                var t = new TransmissionEreporting
                {
                    Id = Identifiant(c, periode, sousFlux, rang), Horodatage = c.Horodatage,
                    Type = c.Correction == 0 ? TypeTransmission.Initiale : TypeTransmission.Rectificative,
                    Emetteur = c.Emetteur, Declarant = c.Declarant,
                };
                envois.Add(new EnvoiEreporting(sousFlux, TypeFluxDe(sousFlux, c.Declarant.Role), j, remplir(periode, contenu, t)));
            }
        }

        Ajouter(SousFluxEreporting.TransactionsUnitaires, d.Factures, f => f.Date, d.PeriodeTransactions,
            (p, e, t) => t with { Transactions = new RapportTransactions { Periode = p, Factures = e } });
        Ajouter(SousFluxEreporting.PaiementsUnitaires, PaiementsUnitaires(d.EncaissementsFactures), p => p.DatePaiement, d.PeriodePaiements,
            (p, e, t) => t with { Paiements = new RapportPaiements { Periode = p, Factures = e } });
        Ajouter(SousFluxEreporting.TransactionsAgregees, Agreger(d.Ventes), a => a.Date, d.PeriodeTransactions,
            (p, e, t) => t with { Transactions = new RapportTransactions { Periode = p, Agregats = e } });
        Ajouter(SousFluxEreporting.PaiementsAgreges, AgregerPaiements(d.EncaissementsB2C), a => a.Date, d.PeriodePaiements,
            (p, e, t) => t with { Paiements = new RapportPaiements { Periode = p, Agregats = e } });
        return envois;
    }

    /// <summary>Type de flux XP Z12-013 d'un sous-flux ; transactions unitaires d'un déclarant acheteur : acquisitions.</summary>
    public static string TypeFluxDe(string sousFlux, string roleDeclarant) => sousFlux switch
    {
        SousFluxEreporting.TransactionsUnitaires => roleDeclarant == RoleCdar.Acheteur ? TypeFlux.TransactionsFournisseur : TypeFlux.TransactionsUnitaires,
        SousFluxEreporting.PaiementsUnitaires => TypeFlux.PaiementsUnitaires,
        SousFluxEreporting.TransactionsAgregees => TypeFlux.TransactionsAgregees,
        SousFluxEreporting.PaiementsAgreges => TypeFlux.PaiementsAgreges,
        _ => throw Invalide("TB-1", $"Sous-flux d'e-reporting inconnu : {sousFlux}"),
    };

    /// <summary>TT-1 : « préfixe-AAAAMMJJ(début)-sous-flux-rang[-REn] » (préfixe par défaut : identifiant du déclarant).</summary>
    public static string Identifiant(ContexteEnvoi c, PeriodeEreporting periode, string sousFlux, int rang)
    {
        var prefixe = string.IsNullOrWhiteSpace(c.Prefixe) ? c.Declarant.Identifiant : c.Prefixe.Trim();
        var id = string.Create(CultureInfo.InvariantCulture,
            $"{prefixe}-{periode.Debut:yyyyMMdd}-{sousFlux.Replace(".", "")}-{rang:D3}{(c.Correction > 0 ? $"-RE{c.Correction}" : "")}");
        return IdentifiantValide(id, LongueurTransmission) ? id : throw Invalide("TT-1", $"Identifiant de transmission non conforme : {id}");
    }

    // ---- Contrôle avant envoi ----

    /// <summary>Identifiant G1.05 / G1.104 : longueur, caractères admis, pas d'espace en tête, en fin ni en double.</summary>
    public static bool IdentifiantValide(string? v, int longueur) =>
        v is { Length: > 0 } && v.Length <= longueur && v.Trim() == v && !v.Contains("  ", StringComparison.Ordinal) && FormatIdentifiant().IsMatch(v);

    private static bool AnneeValide(DateOnly d) => d.Year is >= AnneeMin and <= AnneeMax;
    private static bool Montant2(decimal v) => ReglesCompletude.Decimales(v) <= 2 && ReglesCompletude.Chiffres(v) <= ChiffresMax;
    private static bool Montant6Positif(decimal v) => v >= 0 && ReglesCompletude.Decimales(v) <= 6 && ReglesCompletude.Chiffres(v) <= ChiffresMax;
    private static bool TauxAdmis(decimal t) => ReglesCompletude.TauxTvaAdmis.Contains(t);

    /// <summary>Écarts d'une transmission, dans l'ordre des contrôles (vide = transmissible).</summary>
    public static IReadOnlyList<EcartEreporting> Controler(TransmissionEreporting t)
    {
        var ecarts = new List<EcartEreporting>();
        void E(string regle, string donnee, int rang = 0) => ecarts.Add(new EcartEreporting(regle, donnee, rang));
        void Date(DateOnly? d, string terme, int rang) { if (d is { } x && !AnneeValide(x)) E(RegleEreporting.G109, terme, rang); }
        void Montant(decimal? v, string terme, int rang) { if (v is { } x && !Montant2(x)) E(RegleEreporting.G114, terme, rang); }
        void Periode(Periode? p, string terme, int rang)
        {
            if (p is null) return;
            if (p.Debut is { } debut && p.Fin is { } fin && fin <= debut) E(RegleEreporting.G625, terme, rang);
        }

        // En-tête (TB-1)
        if (!IdentifiantValide(t.Id, LongueurTransmission)) E(RegleEreporting.G1104, "TT-1");
        if (t.Horodatage.Year is < AnneeMin or > AnneeMax) E(RegleEreporting.G109, "TT-3");
        if (t.Type is not (TypeTransmission.Initiale or TypeTransmission.Rectificative)) E(RegleEreporting.G801, "TT-4");
        if ((t.Transactions is null) == (t.Paiements is null)) E(RegleEreporting.G629, "TB-1");
        if (t.Emetteur.Schema != SchemaIdentifiant.Plateforme || t.Emetteur.Identifiant.Length != MatriculePlateforme) E(RegleEreporting.G622, "TT-8");
        if (t.Emetteur.Role != RoleCdar.Plateforme) E(RegleEreporting.G751, "TT-10");
        if (t.Declarant.Schema != SchemaIdentifiant.Siren || !FormatNeufChiffres().IsMatch(t.Declarant.Identifiant)) E(RegleEreporting.G626, "TT-13");
        if (t.Declarant.Role is not (RoleCdar.Acheteur or RoleCdar.Vendeur)) E(RegleEreporting.G752, "TT-15");

        if (t.Transactions is { } tr)
        {
            ControlerPeriode(tr.Periode, "TT-17", "TT-18");
            var rang = 0;
            foreach (var f in tr.Factures) ControlerFacture(f, tr.Periode, ++rang);
            rang = 0;
            foreach (var a in tr.Agregats) ControlerAgregat(a, tr.Periode, ++rang);
        }
        if (t.Paiements is { } pa)
        {
            ControlerPeriode(pa.Periode, "TT-89", "TT-90");
            var rang = 0;
            foreach (var p in pa.Factures)
            {
                rang++;
                if (!IdentifiantValide(p.Numero, LongueurNumero)) E(RegleEreporting.G105, "TT-91", rang);
                Date(p.DateFacture, "TT-102", rang);
                Date(p.DatePaiement, "TT-92", rang);
                if (!pa.Periode.Contient(p.DatePaiement)) E(RegleEreporting.Periode, "TT-92", rang);
                ControlerEncaisse(p.Montants, "TT-93", "TT-94", "TT-95", rang);
            }
            rang = 0;
            foreach (var p in pa.Agregats)
            {
                rang++;
                Date(p.Date, "TT-96", rang);
                if (!pa.Periode.Contient(p.Date)) E(RegleEreporting.Periode, "TT-96", rang);
                ControlerEncaisse(p.Montants, "TT-97", "TT-98", "TT-99", rang);
            }
        }
        return ecarts;

        void ControlerPeriode(PeriodeEreporting p, string debut, string fin)
        {
            Date(p.Debut, debut, 0);
            Date(p.Fin, fin, 0);
            if (p.Fin <= p.Debut) E(RegleEreporting.G625, fin);
        }

        void ControlerEncaisse(IReadOnlyList<EncaisseParTaux> montants, string taux, string devise, string montant, int rang)
        {
            if (montants.Count == 0) E(RegleEreporting.G116, montant, rang);
            foreach (var m in montants)
            {
                if (!TauxAdmis(m.Taux)) E(RegleEreporting.G124, taux, rang);
                if (m.Devise is { } d && !FormatDevise().IsMatch(d)) E(RegleEreporting.G110, devise, rang);
                else if (m.Devise is { } e && e != Euro) E(RegleEreporting.G627, devise, rang);
                if (!Montant6Positif(m.Montant)) E(RegleEreporting.G116, montant, rang);
            }
        }

        void ControlerEntreprise(EntrepriseEreporting? e, string terme, string termeTva, string termePays, int rang)
        {
            if (e?.Identifiant is not { } id) return;
            var format = id.Schema switch
            {
                SchemaIdentifiant.Siren or SchemaIdentifiant.Tahiti => FormatNeufChiffres().IsMatch(id.Valeur),
                SchemaIdentifiant.UeHorsFrance or SchemaIdentifiant.HorsUe => id.Valeur.Length is > 0 and <= 18,
                SchemaIdentifiant.Ridet => FormatRidet().IsMatch(id.Valeur),
                _ => false,
            };
            if (!format) E(RegleEreporting.G219, terme, rang);
            if (id.Schema is SchemaIdentifiant.Siren or SchemaIdentifiant.UeHorsFrance && string.IsNullOrEmpty(e.NumeroTva)) E(RegleEreporting.G233, termeTva, rang);
            if (e.CodePays is { } pays && !FormatPays().IsMatch(pays)) E(RegleEreporting.G201, termePays, rang);
        }

        void ControlerFacture(TransactionUnitaire f, PeriodeEreporting periode, int rang)
        {
            if (!TypesAdmis.Contains(f.Type)) E(RegleEreporting.G101, "TT-21", rang);
            if (!CadresAdmis.Contains(f.Cadre)) E(RegleEreporting.G102, "TT-28", rang);
            if (CadresDefinitifs.Contains(f.Cadre) && ReglesCompletude.TypesAcompte.Contains(f.Type)) E(RegleEreporting.G160, "TT-28", rang);
            if (!IdentifiantValide(f.Numero, LongueurNumero)) E(RegleEreporting.G105, "TT-19", rang);
            Date(f.Date, "TT-20", rang);
            if (!periode.Contient(f.Date)) E(RegleEreporting.Periode, "TT-20", rang);
            if (!FormatDevise().IsMatch(f.Devise)) E(RegleEreporting.G110, "TT-22", rang);
            Date(f.Echeance, "TT-201", rang);
            if (f.Ventilation.Any(v => v.CodeExoneration == VatexNonTva) && !TypesAvoirNonTva.Contains(f.Type)) E(RegleEreporting.G621, "TT-59", rang);
            if (ReglesCompletude.TypesRectificatifs.Contains(f.Type) && (f.FacturesAnterieures.Count != 1 || f.FacturesAnterieures[0].Date is null))
                E(RegleEreporting.G132, "TG-11", rang);
            if (ReglesCompletude.TypesAvoir.Contains(f.Type)
                && !f.FacturesAnterieures.Any(a => a.Date is not null)
                && !(f.Lignes.Count > 0 && f.Lignes.All(l => l.FactureAnterieure is { Date: not null })))
                E(RegleEreporting.G132, "TG-11", rang);
            foreach (var a in f.FacturesAnterieures)
            {
                if (!IdentifiantValide(a.Numero, LongueurNumero)) E(RegleEreporting.G105, "TT-30", rang);
                Date(a.Date, "TT-31", rang);
            }
            if (f.Acheteur?.Identifiant is null) E(RegleEreporting.G628, "TT-36", rang);
            if (f.Vendeur.Identifiant is null) E(RegleEreporting.G219, "TT-33", rang);
            ControlerEntreprise(f.Vendeur, "TT-33", "TT-34", "TT-35", rang);
            ControlerEntreprise(f.Acheteur, "TT-36", "TT-38", "TT-39", rang);
            if (f.Ventilation.Any(v => v.Categorie == CategorieTva.Exoneree) && string.IsNullOrEmpty(f.Vendeur.NumeroTva) && string.IsNullOrEmpty(f.TvaRepresentantFiscal))
                E(RegleEreporting.G1102, "TT-34", rang);
            foreach (var l in f.Livraisons)
            {
                Date(l.Date, "TT-41", rang);
                if (l.Adresse is { } ad && !FormatPays().IsMatch(ad.CodePays)) E(RegleEreporting.G201, "TT-44", rang);
            }
            if (f.Periode is { } pf) { Date(pf.Debut, "TT-42", rang); Date(pf.Fin, "TT-43", rang); }
            Periode(f.Periode, "TT-43", rang);
            foreach (var r in f.RemisesCharges)
            {
                if (r.CategorieTva is { } c && !CategoriesTva.Contains(c)) E(RegleEreporting.G231, r.Charge ? "TT-49" : "TT-46", rang);
                if (r.TauxTva is { } tx && !TauxAdmis(tx)) E(RegleEreporting.G124, r.Charge ? "TT-50" : "TT-47", rang);
                Montant(r.Montant, r.Charge ? "TT-48" : "TT-45", rang);
            }
            Montant(f.TotalHt, "TT-51", rang);
            if (f.DeviseTva != Euro) E(RegleEreporting.G623, "TT-202", rang);
            Montant(f.TotalTva, "TT-52", rang);
            if (f.Ventilation.Count == 0) E(RegleEreporting.G153, "TG-23", rang);
            foreach (var v in f.Ventilation)
            {
                Montant(v.Base, "TT-54", rang);
                Montant(v.Montant, "TT-55", rang);
                if (!CategoriesTva.Contains(v.Categorie)) E(RegleEreporting.G231, "TT-56", rang);
                if (!TauxAdmis(v.Taux ?? 0m)) E(RegleEreporting.G124, "TT-57", rang);
                if (v.Categorie == CategorieTva.Exoneree && (string.IsNullOrEmpty(v.MotifExoneration) || string.IsNullOrEmpty(v.CodeExoneration)))
                    E(RegleEreporting.G140, "TT-58", rang);
            }
            if (f.Devise == Euro && f.Ventilation.Count > 0)
            {
                var tolerance = Tolerance * f.Ventilation.Count;
                if (f.TotalHt is { } ht && Math.Abs(ht - f.Ventilation.Sum(v => v.Base)) > tolerance) E(RegleEreporting.G153, "TT-51", rang);
                if (Math.Abs(f.TotalTva - f.Ventilation.Sum(v => v.Montant)) > tolerance) E(RegleEreporting.G153, "TT-52", rang);
            }
            foreach (var l in f.Lignes)
            {
                if (l.FactureAnterieure is { } fa)
                {
                    if (!IdentifiantValide(fa.Numero, LongueurNumero)) E(RegleEreporting.G105, "TT-300", rang);
                    Date(fa.Date, "TT-301", rang);
                }
                if (l.Periode is { } pl) { Date(pl.Debut, "TT-65", rang); Date(pl.Fin, "TT-66", rang); }
                Periode(l.Periode, "TT-66", rang);
                foreach (var r in l.RemisesCharges) Montant(r.Montant, r.Charge ? "TT-68" : "TT-67", rang);
                foreach (var (prix, terme) in new[] { (l.PrixNet, "TT-69"), (l.Rabais, "TT-70"), (l.PrixBrut, "TT-71") })
                    if (prix is { } x && !Montant6Positif(x)) E(RegleEreporting.G116, terme, rang);
            }
        }

        void ControlerAgregat(TransactionsAgregees a, PeriodeEreporting periode, int rang)
        {
            Date(a.Date, "TT-77", rang);
            if (!periode.Contient(a.Date)) E(RegleEreporting.Periode, "TT-77", rang);
            if (!FormatDevise().IsMatch(a.Devise)) E(RegleEreporting.G110, "TT-78", rang);
            if (!CategorieTransactions.Toutes.Contains(a.Categorie)) E(RegleEreporting.G168, "TT-81", rang);
            Montant(a.TotalHt, "TT-82", rang);
            Montant(a.TotalTva, "TT-83", rang);
            if (a.Ventilation.Count == 0) E(RegleEreporting.G153, "TG-32", rang);
            foreach (var v in a.Ventilation)
            {
                if (!TauxAdmis(v.Taux)) E(RegleEreporting.G124, "TT-86", rang);
                Montant(v.Base, "TT-87", rang);
                Montant(v.Tva, "TT-88", rang);
            }
            if (a.Devise == Euro && a.Ventilation.Count > 0)
            {
                var tolerance = Tolerance * a.Ventilation.Count;
                if (Math.Abs(a.TotalHt - a.Ventilation.Sum(v => v.Base)) > tolerance) E(RegleEreporting.G153, "TT-82", rang);
                if (Math.Abs(a.TotalTva - a.Ventilation.Sum(v => v.Tva)) > tolerance) E(RegleEreporting.G153, "TT-83", rang);
            }
        }
    }
}
