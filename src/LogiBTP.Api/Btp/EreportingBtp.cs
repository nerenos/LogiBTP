using System.Globalization;
using System.Text.Json;
using LogiBTP.Calcul;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>Option de l'e-reporting : régime de TVA de la société (périodicité), matricule de la plateforme (schéma 0238) ; découpage lu des paramètres du module.</summary>
public sealed record OptionEreportingFe(string Regime, string? Matricule)
{
    /// <summary>Découpage choisi dans les paramètres du module (Q20, lecture seule ici).</summary>
    public string? Decoupage { get; init; }
}

/// <summary>Préparation d'une période : nature (transactions ou paiements) et un jour de la période.</summary>
public sealed record DemandePreparationEreporting(string Nature, DateOnly Jour);

/// <summary>Pièce de la période écartée de l'e-reporting (pièce illisible, sans données) : motif.</summary>
public sealed record PieceIgnoreeEreporting(long EntId, string? Numero, string Motif);

/// <summary>Résumé d'une préparation : pièces retenues, montants, pièces écartées.</summary>
public sealed record ResumeEreporting
{
    public int VentesB2C { get; init; }
    public int FacturesInternationales { get; init; }
    public int EncaissementsB2C { get; init; }
    public int EncaissementsInternationaux { get; init; }
    public decimal TotalHt { get; init; }
    public decimal TotalTva { get; init; }
    public decimal TotalEncaisse { get; init; }
    public IReadOnlyList<PieceIgnoreeEreporting> Ignorees { get; init; } = [];
}

/// <summary>Écart du contrôle d'une transmission préparée : sous-flux, jour (découpage PLUSIEURS), règle, terme, rang.</summary>
public sealed record EcartPeriodeEreporting(string SousFlux, DateOnly? Jour, string Regle, string Donnee, int Rang);

/// <summary>Envoi d'une période (transmission du flux 10) et son flux dans le module.</summary>
public sealed record EnvoiPeriodeEreportingDto(long Id, int Correction, int Essai, string SousFlux, string TypeFlux, DateOnly? Jour, string Identifiant,
    string Type, int Elements, long? FluxId, string? EtatFlux, string? Accuse);

/// <summary>Période d'e-reporting : état affiché, actions possibles, résumé, écarts, envois (de l'essai en cours dans la liste ; tous dans le détail).</summary>
public sealed record PeriodeEreportingDto(long Id, string Nature, DateOnly Debut, DateOnly Fin, string Regime, int Correction, int Essai, string Etat,
    ResumeEreporting Resume, IReadOnlyList<EcartPeriodeEreporting> Ecarts, DateTimeOffset PrepareLe, string PreparePar, DateTimeOffset? EnvoyeLe,
    string? EnvoyePar, bool Envoyable, bool Corrigeable, bool Relancable, IReadOnlyList<EnvoiPeriodeEreportingDto> Envois);

/// <summary>
/// E-reporting des ventes et des encaissements (plans/facturation-electronique.md, lot 28 ; Q20 : LogiBTP collecte, extrait et
/// transmet à la plateforme agréée les données brutes, en un envoi ou en plusieurs envois par période, au choix de la société) :
/// - collecte des pièces de vente valables (v_document_valable, annulées comprises : la pièce et son avoir sont déclarés) d'un
///   type émis, datées dans la période, d'un tiers particulier ou non assujetti (B2C → 10.3) ou international (→ 10.1) ;
///   facture construite comme à l'émission (<see cref="EmissionFactureBtp"/>) puis extraite : ventilation de TVA par jour,
///   catégorie TT-81 et option sur les débits (<see cref="VentesDe"/>), transaction unitaire (<see cref="TransactionDe"/>) ;
/// - encaissements : pointages des règlements reçus (hors imputation) datés dans la période, sur les factures de ces tiers de
///   services ou mixtes sans TVA sur les débits (<see cref="EncaissementFeBtp.Concerne"/>), répartis par taux au cumul des
///   pointages de la pièce (<see cref="EncaissementFeBtp.Proposer"/>) → 10.4 (B2C) ou 10.2 (international) ;
/// - période selon le régime de la société (<see cref="ReglesEreporting.Periode"/>), découpage du module (UNIQUE ou PLUSIEURS),
///   transmissions écrites (<see cref="EcritureFlux10"/>) et contrôlées (<see cref="ReglesEreporting.Controler"/>) à la
///   préparation, gardées telles qu'elles partiront (ereporting_envoi, db/304) ; envoi : mise en file du module (syntaxe FRR,
///   type de flux du sous-flux, élément EREPORTING = la période : chronologie) ; état lu des flux (acceptée : accusés Ok ;
///   rejetée : un flux en erreur) ; correction d'une période envoyée : rang n + 1 (transmissions RE) ; relance d'une période
///   rejetée : nouvel essai du même rang.
/// Routes sous /api/facture-electronique/ereporting (lecture : Consulter ; préparation, envoi, correction, relance : Modifier ;
/// option : paramétrage).
/// </summary>
public static class EreportingBtp
{
    private static readonly HashSet<string> Regimes =
        [RegimeEreporting.ReelNormalMensuel, RegimeEreporting.ReelNormalTrimestriel, RegimeEreporting.Simplifie, RegimeEreporting.Franchise];

    /// <summary>Catégories de TVA d'opérations non soumises à la TVA en France (TT-81 TNT1).</summary>
    private static readonly HashSet<string> CategoriesNonTaxables =
        [CategorieTva.HorsChamp, CategorieTva.Exportation, CategorieTva.Intracommunautaire, CategorieTva.Autoliquidation];

    /// <summary>Pays de l'Union européenne hors France (identifiant 0223, sinon 0227, G2.19).</summary>
    private static readonly HashSet<string> PaysUe =
        ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "GR", "EL", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];

    private const int LongueurIdentifiantEtranger = 18;

    // ---------------------------------------------------------------- règles sans base

    /// <summary>
    /// Vente retenue : particulier ou non-assujetti (B2C), sinon tiers international ou étranger (INTERNATIONAL) ; administration
    /// (B2G) et entreprise française : null (flux 2 ou hors e-reporting).
    /// </summary>
    public static string? Cible(string? feType, string? pays, bool? assujetti)
    {
        if (feType == EmissionFactureBtp.TypeFeB2g) return null;
        if (feType == CiblesEreporting.B2C || assujetti == false) return CiblesEreporting.B2C;
        if (feType == CiblesEreporting.International || (!string.IsNullOrWhiteSpace(pays) && !pays.Trim().Equals("FR", StringComparison.OrdinalIgnoreCase)))
            return CiblesEreporting.International;
        return null;
    }

    /// <summary>TT-81 d'une ventilation : catégorie non taxable en France → TNT1 ; facture de biens (cadre B*) → TLB1 ; sinon TPS1.</summary>
    public static string CategorieDe(string? cadre, string categorieTva) =>
        CategoriesNonTaxables.Contains(categorieTva) ? CategorieTransactions.NonTaxables
        : cadre is { Length: > 0 } && cadre[0] == 'B' ? CategorieTransactions.Biens
        : CategorieTransactions.Services;

    /// <summary>Signe d'une facture dans les cumuls : avoir → −1.</summary>
    public static decimal Signe(string typeFacture) => ReglesCompletude.TypesAvoir.Contains(typeFacture) ? -1m : 1m;

    /// <summary>
    /// Facture B2C → ventes à cumuler (10.3) : une par catégorie TT-81, ventilation par taux (base et TVA, négatives pour un
    /// avoir), option sur les débits (BT-8 = 5) reprise en TT-80.
    /// </summary>
    public static IReadOnlyList<VenteB2C> VentesDe(Facture f)
    {
        var signe = Signe(f.TypeFacture);
        var debits = f.CodeExigibiliteTva == CodeExigibiliteTva.DateFacture ? CodeExigibiliteTva.DateFacture : null;
        return [.. f.DetailsTva
            .GroupBy(t => CategorieDe(f.CadreFacturation, t.Categorie))
            .Select(g => new VenteB2C(f.DateEmission, g.Key,
                [.. g.GroupBy(t => t.Taux ?? 0m).OrderBy(t => t.Key)
                    .Select(t => new VentilationAgregee(t.Key, signe * t.Sum(x => x.Base), signe * t.Sum(x => x.Montant)))],
                f.Devise, debits))];
    }

    /// <summary>Identifiant d'une entreprise étrangère (G2.19) : identifiant national, à défaut le numéro de TVA ; 0223 dans l'UE, 0227 hors UE.</summary>
    public static Identifiant? IdentifiantEtranger(string? pays, string? identifiant, string? tva)
    {
        var v = (string.IsNullOrWhiteSpace(identifiant) ? tva : identifiant)?.Replace(" ", "", StringComparison.Ordinal).Trim();
        if (string.IsNullOrEmpty(v)) return null;
        if (v.Length > LongueurIdentifiantEtranger) v = v[..LongueurIdentifiantEtranger];
        var ue = pays is { } p && PaysUe.Contains(p.Trim().ToUpperInvariant());
        return new Identifiant(v, ue ? SchemaIdentifiant.UeHorsFrance : SchemaIdentifiant.HorsUe);
    }

    /// <summary>Facture internationale → transaction unitaire (10.1) ; acheteur sans SIREN : identifiant étranger de la fiche.</summary>
    public static TransactionUnitaire TransactionDe(Facture f, string? pays, string? identifiantEtranger, string? tva)
    {
        var t = ReglesEreporting.TransactionDe(f);
        if (t.Acheteur?.Identifiant is null && IdentifiantEtranger(pays ?? f.Acheteur.Adresse?.CodePays, identifiantEtranger, tva ?? f.Acheteur.NumeroTva) is { } id)
            t = t with { Acheteur = (t.Acheteur ?? new EntrepriseEreporting(null)) with { Identifiant = id, NumeroTva = t.Acheteur?.NumeroTva ?? tva } };
        return t;
    }

    /// <summary>
    /// État affiché d'une période : pas encore envoyée → PREPAREE ; un flux de l'essai en cours en erreur ou abandonné →
    /// REJETEE ; tous acquittés (accusé Ok) → ACCEPTEE ; sinon ENVOYEE.
    /// </summary>
    public static string Etat(bool envoyee, IReadOnlyCollection<string?> etatsFlux)
    {
        if (!envoyee) return EtatsPeriodeEreporting.Preparee;
        if (etatsFlux.Any(e => e is EtatFlux.Erreur or EtatFlux.Abandonne)) return EtatsPeriodeEreporting.Rejetee;
        return etatsFlux.Count > 0 && etatsFlux.All(e => e == EtatFlux.Acquitte) ? EtatsPeriodeEreporting.Acceptee : EtatsPeriodeEreporting.Envoyee;
    }

    /// <summary>Envoi possible : préparée, période terminée (fin avant aujourd'hui), sans écart, au moins une transmission.</summary>
    public static bool Envoyable(string etat, DateOnly fin, DateOnly aujourdhui, int ecarts, int envois) =>
        etat == EtatsPeriodeEreporting.Preparee && fin < aujourdhui && ecarts == 0 && envois > 0;

    /// <summary>Sous-flux de référence de la périodicité d'une nature (10.1 pour les transactions, 10.2 pour les paiements).</summary>
    public static string SousFluxDe(string nature) => nature switch
    {
        NaturesPeriodeEreporting.Transactions => SousFluxEreporting.TransactionsUnitaires,
        NaturesPeriodeEreporting.Paiements => SousFluxEreporting.PaiementsUnitaires,
        _ => throw ExceptionMetier.Invalide(ErreursEreporting.Parametres, $"Nature de période inconnue : {nature}"),
    };

    /// <summary>Identifiant de suivi du flux (unique pour la plateforme) : TT-1, suffixé « -E&lt;essai&gt; » à partir du deuxième essai.</summary>
    public static string IdSuivi(string identifiant, int essai) =>
        essai <= 1 ? identifiant : string.Create(CultureInfo.InvariantCulture, $"{identifiant}-E{essai}");

    // ---------------------------------------------------------------- option

    public static async Task<OptionEreportingFe> OptionAsync(DbContext db, ServiceFactureElectronique? fe, CancellationToken ct)
    {
        var o = (await db.Database.SqlQueryRaw<LigneOptionSql>(
            "SELECT ero_regime AS regime, ero_matricule AS matricule FROM facture_electronique_ereporting_option WHERE ero_id = 1").ToListAsync(ct)).FirstOrDefault();
        return new OptionEreportingFe(o?.Regime ?? RegimeEreporting.ReelNormalMensuel, o?.Matricule)
        {
            Decoupage = fe is null ? null : (await fe.ParametreAsync(ct)).FpaDecoupageEreporting,
        };
    }

    private sealed record LigneOptionSql(string Regime, string? Matricule);

    public static async Task<OptionEreportingFe> EnregistrerOptionAsync(DbContext db, ServiceFactureElectronique fe, OptionEreportingFe o, CancellationToken ct)
    {
        if (!Regimes.Contains(o.Regime)) throw ExceptionMetier.Invalide(ErreursEreporting.Parametres, $"Régime de TVA inconnu : {o.Regime}", new[] { "regime" });
        var matricule = string.IsNullOrWhiteSpace(o.Matricule) ? null : o.Matricule.Trim().ToUpperInvariant();
        if (matricule is not null && (matricule.Length != 4 || !matricule.All(char.IsAsciiLetterOrDigit)))
            throw ExceptionMetier.Invalide(ErreursEreporting.Parametres, "Matricule de la plateforme : 4 caractères (schéma 0238)", new[] { "matricule" });
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO facture_electronique_ereporting_option (ero_id, ero_regime, ero_matricule, ero_modifie_le) VALUES (1, @r, @m, now())
            ON CONFLICT (ero_id) DO UPDATE SET ero_regime = EXCLUDED.ero_regime, ero_matricule = EXCLUDED.ero_matricule, ero_modifie_le = now()
            """, [new NpgsqlParameter("r", o.Regime), SqlBtp.P("m", matricule, NpgsqlTypes.NpgsqlDbType.Varchar)], ct);
        return await OptionAsync(db, fe, ct);
    }

    // ---------------------------------------------------------------- collecte

    private sealed record LignePieceSql(long Id, string? Numero, string? FeType, string? Pays, bool? Assujetti, string? IdentifiantEtranger, string? Tva);

    private const string SqlPieces = """
        SELECT d.ent_id AS id, d.ent_numero AS numero, p.per_fe_type AS fe_type, p.per_pays::text AS pays, p.per_assujetti_tva AS assujetti,
               p.per_identifiant_etranger AS identifiant_etranger, p.per_tva_intra AS tva
        FROM document d
        JOIN v_document_valable v ON v.ent_id = d.ent_id
        JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
        WHERE t.tyd_famille::text = 'V' AND t.tyd_fe_type_facture IS NOT NULL AND d.ent_id = ANY(@ids)
        ORDER BY d.ent_date, d.ent_id
        """;

    private sealed record LignePointageSql(long Ent, long Reg, long Ech, DateOnly Date, decimal Montant);

    /// <summary>Pointages (règlements reçus hors imputation) des pièces qui ont un pointage dans la période, jusqu'à sa fin.</summary>
    private const string SqlPointages = """
        WITH pt AS (
            SELECT e.ech_ent_id AS ent, p.poi_reg_id AS reg, e.ech_id AS ech, r.reg_date AS date, p.poi_montant AS montant
            FROM pointage p JOIN reglement r ON r.reg_id = p.poi_reg_id JOIN document_echeance e ON e.ech_id = p.poi_echeance_id
            WHERE r.reg_sens = 'E' AND r.reg_mode <> @imputation AND r.reg_date <= @fin)
        SELECT pt.ent, pt.reg, pt.ech, pt.date, pt.montant FROM pt
        WHERE pt.ent IN (SELECT ent FROM pt WHERE date >= @debut)
        ORDER BY pt.ent, pt.date, pt.reg, pt.ech
        """;

    private sealed record PieceCollectee(LignePieceSql Piece, string Cible, Facture Facture);

    /// <summary>Pièces retenues parmi des identifiants : cible B2C ou internationale, facture construite comme à l'émission.</summary>
    private static async Task<List<PieceCollectee>> PiecesAsync(LogiBtpContext db, long[] ids, List<PieceIgnoreeEreporting> ignorees, CancellationToken ct)
    {
        var r = new List<PieceCollectee>();
        if (ids.Length == 0) return r;
        foreach (var p in await db.Database.SqlQueryRaw<LignePieceSql>(SqlPieces, new NpgsqlParameter("ids", ids)).ToListAsync(ct))
        {
            if (Cible(p.FeType, p.Pays, p.Assujetti) is not { } cible) continue;
            try
            {
                var entree = await EmissionFactureBtp.EntreeAsync(db, p.Id, ct);
                if (entree is null) continue;
                r.Add(new PieceCollectee(p, cible, EmissionFactureBtp.Construire(entree).Facture));
            }
            catch (Exception e) when (e is ExceptionMetier or ExceptionLectureFacture or InvalidOperationException)
            {
                ignorees.Add(new PieceIgnoreeEreporting(p.Id, p.Numero, Masquage.Texte(e.Message) ?? e.GetType().Name));
            }
        }
        return r;
    }

    /// <summary>Données de la période (<see cref="ReglesEreporting.Decouper"/>) et résumé.</summary>
    public static async Task<(DonneesEreporting Donnees, ResumeEreporting Resume)> CollecterAsync(LogiBtpContext db, string nature, PeriodeEreporting periode,
        CancellationToken ct)
    {
        var ignorees = new List<PieceIgnoreeEreporting>();
        if (nature == NaturesPeriodeEreporting.Transactions)
        {
            var ids = await db.Database.SqlQueryRaw<long>("""
                SELECT d.ent_id AS "Value" FROM document d JOIN v_document_valable v ON v.ent_id = d.ent_id
                WHERE d.ent_date BETWEEN @debut AND @fin
                """, new NpgsqlParameter("debut", periode.Debut), new NpgsqlParameter("fin", periode.Fin)).ToListAsync(ct);
            var pieces = await PiecesAsync(db, [.. ids], ignorees, ct);
            var ventes = pieces.Where(p => p.Cible == CiblesEreporting.B2C).SelectMany(p => VentesDe(p.Facture)).ToList();
            var factures = pieces.Where(p => p.Cible == CiblesEreporting.International)
                .Select(p => TransactionDe(p.Facture, p.Piece.Pays, p.Piece.IdentifiantEtranger, p.Piece.Tva)).ToList();
            var b2c = pieces.Where(p => p.Cible == CiblesEreporting.B2C).Select(p => p.Facture).ToList();
            var inter = pieces.Where(p => p.Cible == CiblesEreporting.International).Select(p => p.Facture).ToList();
            decimal Ht(Facture f) => Signe(f.TypeFacture) * f.DetailsTva.Sum(t => t.Base);
            decimal Tva(Facture f) => Signe(f.TypeFacture) * f.DetailsTva.Sum(t => t.Montant);
            return (new DonneesEreporting { PeriodeTransactions = periode, Ventes = ventes, Factures = factures }, new ResumeEreporting
            {
                VentesB2C = b2c.Count, FacturesInternationales = inter.Count,
                TotalHt = b2c.Concat(inter).Sum(Ht), TotalTva = b2c.Concat(inter).Sum(Tva), Ignorees = ignorees,
            });
        }

        if (!await db.Database.SqlQueryRaw<bool>("SELECT to_regclass('pointage') IS NOT NULL AS \"Value\"").FirstAsync(ct))
            return (new DonneesEreporting { PeriodePaiements = periode }, new ResumeEreporting());
        var pointages = await db.Database.SqlQueryRaw<LignePointageSql>(SqlPointages,
            new NpgsqlParameter("imputation", LogiBTP.Reglements.ModeReglementSysteme.Imputation),
            new NpgsqlParameter("debut", periode.Debut), new NpgsqlParameter("fin", periode.Fin)).ToListAsync(ct);
        var parPiece = pointages.GroupBy(x => x.Ent).ToDictionary(g => g.Key, g => g.ToList());
        var encB2c = new List<EncaissementEreporting>();
        var encInter = new List<EncaissementEreporting>();
        var natures = parPiece.Count > 0 ? await EmissionFeDonneesBtp.NaturesAsync(db, ct) : null;
        foreach (var c in await PiecesAsync(db, [.. parPiece.Keys], ignorees, ct))
        {
            var f = c.Facture;
            if (Signe(f.TypeFacture) < 0 || !EncaissementFeBtp.Concerne(f.CadreFacturation, f.CodeExigibiliteTva)) continue;
            var (servicesHt, totalHt) = (1m, 1m);
            if (f.CadreFacturation[0] == 'M')
            {
                var lignes = await db.Lignes.AsNoTracking().Where(l => l.LigEntId == c.Piece.Id).ToListAsync(ct);
                (servicesHt, totalHt) = EncaissementFeBtp.PartServices(lignes, natures!);
            }
            var lignesPt = parPiece[c.Piece.Id];
            var dates = lignesPt.ToDictionary(l => StatutEncaisseeBtp.Cle(l.Ent, l.Reg, l.Ech), l => l.Date);
            var propositions = EncaissementFeBtp.Proposer(new EntreeEncaissementFe
            {
                Ventilation = [.. f.DetailsTva.GroupBy(t => t.Taux ?? 0m).Select(t => new MontantTauxFe(t.Key, t.Sum(x => x.Base + x.Montant)))],
                ServicesHt = servicesHt, TotalHt = totalHt,
                Ecarts = [.. lignesPt.GroupBy(l => StatutEncaisseeBtp.Cle(l.Ent, l.Reg, l.Ech)).Select(g => new EcartEncaissementFe(g.Key, g.Sum(x => x.Montant)))],
            });
            foreach (var p in propositions)
            {
                var jour = dates[p.Cle];
                if (!periode.Contient(jour) || p.Encaissements.Count == 0) continue;
                var montants = p.Encaissements.Select(m => new EncaisseParTaux(m.Taux, m.Montant)).ToList();
                if (c.Cible == CiblesEreporting.B2C) encB2c.Add(new EncaissementEreporting(jour, montants));
                else encInter.Add(new EncaissementEreporting(jour, montants, f.Numero, f.DateEmission));
            }
        }
        return (new DonneesEreporting { PeriodePaiements = periode, EncaissementsB2C = encB2c, EncaissementsFactures = encInter }, new ResumeEreporting
        {
            EncaissementsB2C = encB2c.Count, EncaissementsInternationaux = encInter.Count,
            TotalEncaisse = encB2c.Concat(encInter).SelectMany(e => e.Montants).Sum(m => m.Montant), Ignorees = ignorees,
        });
    }

    // ---------------------------------------------------------------- préparation

    private sealed record LignePeriodeSql(long Id, string Nature, DateOnly Debut, DateOnly Fin, string Regime, int Correction, int Essai, string Resume,
        string Ecarts, DateTimeOffset PrepareLe, string PreparePar, DateTimeOffset? EnvoyeLe, string? EnvoyePar);

    private const string SqlPeriode = """
        SELECT erp_id AS id, erp_nature AS nature, erp_debut AS debut, erp_fin AS fin, erp_regime AS regime, erp_correction AS correction,
               erp_essai AS essai, erp_resume::text AS resume, erp_ecarts::text AS ecarts, erp_prepare_le AS prepare_le,
               erp_prepare_par AS prepare_par, erp_envoye_le AS envoye_le, erp_envoye_par AS envoye_par
        FROM ereporting_periode
        """;

    private sealed record LigneEnvoiSql(long Id, int Correction, int Essai, string SousFlux, string TypeFlux, DateOnly? Jour, string Identifiant, string Type,
        int Elements, long? FluxId, string? EtatFlux, string? Accuse);

    private const string SqlEnvois = """
        SELECT e.ere_id AS id, e.ere_correction AS correction, e.ere_essai AS essai, e.ere_sous_flux AS sous_flux, e.ere_type_flux AS type_flux,
               e.ere_jour AS jour, e.ere_identifiant AS identifiant, e.ere_type AS type, e.ere_elements AS elements, e.ere_flux_id AS flux_id,
               f.ffl_etat AS etat_flux, f.ffl_accuse AS accuse
        FROM ereporting_envoi e LEFT JOIN fe_flux f ON f.ffl_id = e.ere_flux_id
        WHERE e.ere_erp_id = @p
        ORDER BY e.ere_correction DESC, e.ere_essai DESC, e.ere_id
        """;

    private sealed record LigneDeclarantSql(string? Siren, string? Nom);

    /// <summary>Contexte des transmissions : plateforme (matricule de l'option, 0238, WK) et société (SIREN, SE).</summary>
    private static async Task<ContexteEnvoi> ContexteAsync(LogiBtpContext db, ServiceFactureElectronique fe, int correction, CancellationToken ct)
    {
        var option = await OptionAsync(db, null, ct);
        if (option.Matricule is null) throw ExceptionMetier.Invalide(ErreursEreporting.Parametres, "Matricule de la plateforme agréée absent (paramètres de l'e-reporting)");
        var s = (await db.Database.SqlQueryRaw<LigneDeclarantSql>(
            "SELECT per_siren AS siren, per_raison_sociale AS nom FROM personne WHERE per_societe_base ORDER BY per_id LIMIT 1").ToListAsync(ct)).FirstOrDefault();
        var siren = new string((s?.Siren ?? "").Where(char.IsAsciiDigit).ToArray());
        if (siren.Length != 9) throw ExceptionMetier.Invalide(ErreursEreporting.Parametres, "SIREN de la société de la base absent (fiche de la société)");
        var p = await fe.ParametreAsync(ct);
        return new ContexteEnvoi(
            new PartieTransmission(option.Matricule, SchemaIdentifiant.Plateforme, p.FpaConnecteur, RoleCdar.Plateforme),
            new PartieTransmission(siren, SchemaIdentifiant.Siren, s!.Nom ?? siren, RoleCdar.Vendeur),
            fe.Maintenant.UtcDateTime, null, correction);
    }

    /// <summary>Mode d'une préparation : première ou nouvelle préparation, correction d'une période envoyée, relance d'une période rejetée.</summary>
    private enum ModePreparation { Preparation, Correction, Relance }

    /// <summary>Prépare la période contenant un jour (créée si besoin) ; déjà envoyée : 409 (passer par la correction).</summary>
    public static async Task<PeriodeEreportingDto> PreparerAsync(IServiceProvider services, DemandePreparationEreporting d, Utilisateur u, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var option = await OptionAsync(db, null, ct);
        var periode = ReglesEreporting.Periode(d.Jour, option.Regime, SousFluxDe(d.Nature));
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO ereporting_periode (erp_nature, erp_debut, erp_fin, erp_regime, erp_prepare_par) VALUES (@n, @d, @f, @r, @u)
            ON CONFLICT (erp_nature, erp_debut) DO NOTHING
            """, [new NpgsqlParameter("n", d.Nature), new NpgsqlParameter("d", periode.Debut), new NpgsqlParameter("f", periode.Fin),
                  new NpgsqlParameter("r", option.Regime), new NpgsqlParameter("u", u.Code)], ct);
        var id = await db.Database.SqlQueryRaw<long>("SELECT erp_id AS \"Value\" FROM ereporting_periode WHERE erp_nature = @n AND erp_debut = @d",
            new NpgsqlParameter("n", d.Nature), new NpgsqlParameter("d", periode.Debut)).FirstAsync(ct);
        return await PreparerPeriodeAsync(services, id, ModePreparation.Preparation, u, ct);
    }

    public static Task<PeriodeEreportingDto> CorrigerAsync(IServiceProvider services, long id, Utilisateur u, CancellationToken ct) =>
        PreparerPeriodeAsync(services, id, ModePreparation.Correction, u, ct);

    public static Task<PeriodeEreportingDto> RelancerAsync(IServiceProvider services, long id, Utilisateur u, CancellationToken ct) =>
        PreparerPeriodeAsync(services, id, ModePreparation.Relance, u, ct);

    private static async Task<PeriodeEreportingDto> PreparerPeriodeAsync(IServiceProvider services, long id, ModePreparation mode, Utilisateur u, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var fe = services.GetRequiredService<ServiceFactureElectronique>();
        await using var tx = await db.Unite().CommencerAsync(ct);
        var p = (await db.Database.SqlQueryRaw<LignePeriodeSql>(SqlPeriode + " WHERE erp_id = @p FOR UPDATE", new NpgsqlParameter("p", id)).ToListAsync(ct)).FirstOrDefault()
            ?? throw ExceptionMetier.Introuvable("Période d'e-reporting");
        var etat = Etat(p.EnvoyeLe is not null, await EtatsFluxAsync(db, p, ct));
        var (correction, essai) = (mode, etat) switch
        {
            (ModePreparation.Preparation, EtatsPeriodeEreporting.Preparee) => (p.Correction, p.Essai),
            (ModePreparation.Preparation, _) => throw ExceptionMetier.Conflit(ErreursEreporting.DejaEnvoyee,
                "Période déjà envoyée : passer par la correction (transmission rectificative) ou la relance d'un rejet"),
            (ModePreparation.Correction, EtatsPeriodeEreporting.Envoyee or EtatsPeriodeEreporting.Acceptee) => (p.Correction + 1, 1),
            (ModePreparation.Relance, EtatsPeriodeEreporting.Rejetee) => (p.Correction, p.Essai + 1),
            _ => throw ExceptionMetier.Conflit(ErreursEreporting.Etat,
                mode == ModePreparation.Correction ? "Seule une période envoyée se corrige" : "Seule une période rejetée se relance"),
        };
        var periode = new PeriodeEreporting(p.Debut, p.Fin);
        var (donnees, resume) = await CollecterAsync(db, p.Nature, periode, ct);
        var contexte = await ContexteAsync(db, fe, correction, ct);
        var decoupage = (await fe.ParametreAsync(ct)).FpaDecoupageEreporting;
        var envois = ReglesEreporting.Decouper(donnees, decoupage, contexte);
        var ecarts = new List<EcartPeriodeEreporting>();
        var ecrits = new List<(EnvoiEreporting Envoi, byte[] Contenu, int Elements)>();
        foreach (var e in envois)
        {
            var controle = ReglesEreporting.Controler(e.Transmission);
            ecarts.AddRange(controle.Select(x => new EcartPeriodeEreporting(e.SousFlux, e.Jour, x.Regle, x.Donnee, x.Rang)));
            if (controle.Count > 0) continue;
            try
            {
                var t = e.Transmission;
                var elements = (t.Transactions?.Factures.Count ?? 0) + (t.Transactions?.Agregats.Count ?? 0) + (t.Paiements?.Factures.Count ?? 0) + (t.Paiements?.Agregats.Count ?? 0);
                ecrits.Add((e, EcritureFlux10.Ecrire(t), elements));
            }
            catch (ExceptionLectureFacture x)
            {
                ecarts.Add(new EcartPeriodeEreporting(e.SousFlux, e.Jour, x.Code, string.Join(" ; ", x.Details ?? []), 0));
            }
        }
        // Transmissions non envoyées de l'essai en cours remplacées ; celles des essais envoyés gardées (historique).
        await db.Database.ExecuteSqlRawAsync("DELETE FROM ereporting_envoi WHERE ere_erp_id = @p AND ere_flux_id IS NULL",
            [new NpgsqlParameter("p", id)], ct);
        if (ecarts.Count == 0)
        {
            foreach (var (e, contenu, elements) in ecrits)
            {
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO ereporting_envoi (ere_erp_id, ere_correction, ere_essai, ere_sous_flux, ere_type_flux, ere_jour, ere_identifiant, ere_type, ere_elements, ere_contenu)
                    VALUES (@p, @c, @e, @s, @t, @j, @i, @y, @n, @x)
                    """, [new NpgsqlParameter("p", id), new NpgsqlParameter("c", correction), new NpgsqlParameter("e", essai), new NpgsqlParameter("s", e.SousFlux),
                          new NpgsqlParameter("t", e.TypeFlux), SqlBtp.P("j", e.Jour, NpgsqlTypes.NpgsqlDbType.Date), new NpgsqlParameter("i", e.Transmission.Id),
                          new NpgsqlParameter("y", e.Transmission.Type), new NpgsqlParameter("n", elements), new NpgsqlParameter("x", contenu)], ct);
            }
        }
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE ereporting_periode SET erp_correction = @c, erp_essai = @e, erp_resume = @r::jsonb, erp_ecarts = @x::jsonb, erp_prepare_le = now(),
                   erp_prepare_par = @u, erp_envoye_le = NULL, erp_envoye_par = NULL
            WHERE erp_id = @p
            """, [new NpgsqlParameter("c", correction), new NpgsqlParameter("e", essai),
                  new NpgsqlParameter("r", JsonSerializer.Serialize(resume, JsonCalcul.Options)), new NpgsqlParameter("x", JsonSerializer.Serialize(ecarts, JsonCalcul.Options)),
                  new NpgsqlParameter("u", u.Code), new NpgsqlParameter("p", id)], ct);
        await tx.CommitAsync(ct);
        return await PeriodeAsync(services, id, true, ct);
    }

    private static async Task<List<string?>> EtatsFluxAsync(DbContext db, LignePeriodeSql p, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<string?>("""
            SELECT f.ffl_etat AS "Value" FROM ereporting_envoi e LEFT JOIN fe_flux f ON f.ffl_id = e.ere_flux_id
            WHERE e.ere_erp_id = @p AND e.ere_correction = @c AND e.ere_essai = @e AND e.ere_flux_id IS NOT NULL
            """, new NpgsqlParameter("p", p.Id), new NpgsqlParameter("c", p.Correction), new NpgsqlParameter("e", p.Essai)).ToListAsync(ct);

    // ---------------------------------------------------------------- envoi

    private sealed record LigneContenuSql(long Id, string SousFlux, string TypeFlux, string Identifiant, byte[] Contenu);

    /// <summary>
    /// Envoie la période préparée : transmissions de l'essai en cours mises en file du module (FRR, type de flux du sous-flux,
    /// élément EREPORTING), dans une transaction. Refus : déjà envoyée (409), période en cours, écarts, rien à transmettre, plateforme inactive (422).
    /// </summary>
    public static async Task<PeriodeEreportingDto> EnvoyerAsync(IServiceProvider services, long id, Utilisateur u, CancellationToken ct)
    {
        var fe = services.GetRequiredService<ServiceFactureElectronique>();
        if (!(await fe.ParametreAsync(ct)).FpaActif)
            throw ExceptionMetier.Invalide(ErreursEreporting.Parametres, "Plateforme de facturation électronique non activée (paramètres du module)");
        await using var tx = await fe.Db.Unite().CommencerAsync(ct);
        var p = (await fe.Db.Database.SqlQueryRaw<LignePeriodeSql>(SqlPeriode + " WHERE erp_id = @p FOR UPDATE", new NpgsqlParameter("p", id)).ToListAsync(ct)).FirstOrDefault()
            ?? throw ExceptionMetier.Introuvable("Période d'e-reporting");
        if (p.EnvoyeLe is not null) throw ExceptionMetier.Conflit(ErreursEreporting.DejaEnvoyee, "Période déjà envoyée : corriger ou relancer pour envoyer de nouveau");
        var aujourdhui = DateOnly.FromDateTime(fe.Maintenant.ToLocalTime().DateTime);
        if (p.Fin >= aujourdhui) throw ExceptionMetier.Invalide(ErreursEreporting.PeriodeEnCours, $"Période en cours : envoi possible à partir du {p.Fin.AddDays(1):dd/MM/yyyy}");
        var ecarts = JsonSerializer.Deserialize<List<EcartPeriodeEreporting>>(p.Ecarts, JsonCalcul.Options) ?? [];
        if (ecarts.Count > 0) throw ExceptionMetier.Invalide(ErreursEreporting.Ecarts, "Écarts du contrôle à corriger avant l'envoi", ecarts);
        var envois = await fe.Db.Database.SqlQueryRaw<LigneContenuSql>("""
            SELECT ere_id AS id, ere_sous_flux AS sous_flux, ere_type_flux AS type_flux, ere_identifiant AS identifiant, ere_contenu AS contenu
            FROM ereporting_envoi WHERE ere_erp_id = @p AND ere_correction = @c AND ere_essai = @e AND ere_flux_id IS NULL ORDER BY ere_id
            """, new NpgsqlParameter("p", id), new NpgsqlParameter("c", p.Correction), new NpgsqlParameter("e", p.Essai)).ToListAsync(ct);
        if (envois.Count == 0) throw ExceptionMetier.Invalide(ErreursEreporting.Vide, "Aucune donnée à transmettre sur la période");
        foreach (var e in envois)
        {
            var flux = await fe.MettreEnFileAsync(new FluxAEmettre(e.Contenu, $"{e.Identifiant}.xml")
            {
                Syntaxe = Syntaxe.Frr, Type = e.TypeFlux, IdSuivi = IdSuivi(e.Identifiant, p.Essai), Numero = e.Identifiant,
                TypeElement = TypesElementFe.PeriodeEreporting, IdElement = id.ToString(CultureInfo.InvariantCulture),
            }, u, ct);
            await fe.Db.Database.ExecuteSqlRawAsync("UPDATE ereporting_envoi SET ere_flux_id = @f WHERE ere_id = @e",
                [new NpgsqlParameter("f", flux.Id), new NpgsqlParameter("e", e.Id)], ct);
        }
        await fe.Db.Database.ExecuteSqlRawAsync("UPDATE ereporting_periode SET erp_envoye_le = now(), erp_envoye_par = @u WHERE erp_id = @p",
            [new NpgsqlParameter("u", u.Code), new NpgsqlParameter("p", id)], ct);
        await tx.CommitAsync(ct);
        return await PeriodeAsync(services, id, true, ct);
    }

    // ---------------------------------------------------------------- lecture

    private static PeriodeEreportingDto Dto(LignePeriodeSql p, List<LigneEnvoiSql> envois, DateOnly aujourdhui, bool tous)
    {
        var courants = envois.Where(e => e.Correction == p.Correction && e.Essai == p.Essai).ToList();
        var etat = Etat(p.EnvoyeLe is not null, [.. courants.Where(e => e.FluxId is not null).Select(e => e.EtatFlux)]);
        var ecarts = JsonSerializer.Deserialize<List<EcartPeriodeEreporting>>(p.Ecarts, JsonCalcul.Options) ?? [];
        var resume = JsonSerializer.Deserialize<ResumeEreporting>(p.Resume, JsonCalcul.Options) ?? new ResumeEreporting();
        return new PeriodeEreportingDto(p.Id, p.Nature, p.Debut, p.Fin, p.Regime, p.Correction, p.Essai, etat, resume, ecarts, p.PrepareLe, p.PreparePar,
            p.EnvoyeLe, p.EnvoyePar, Envoyable(etat, p.Fin, aujourdhui, ecarts.Count, courants.Count),
            etat is EtatsPeriodeEreporting.Envoyee or EtatsPeriodeEreporting.Acceptee, etat == EtatsPeriodeEreporting.Rejetee,
            [.. (tous ? envois : courants).Select(e => new EnvoiPeriodeEreportingDto(e.Id, e.Correction, e.Essai, e.SousFlux, e.TypeFlux, e.Jour, e.Identifiant,
                e.Type, e.Elements, e.FluxId, e.EtatFlux, e.Accuse))]);
    }

    private static DateOnly Aujourdhui(IServiceProvider services) =>
        DateOnly.FromDateTime(services.GetRequiredService<ServiceFactureElectronique>().Maintenant.ToLocalTime().DateTime);

    /// <summary>Périodes, de la plus récente à la plus ancienne (nature : filtre), avec les envois de l'essai en cours.</summary>
    public static async Task<List<PeriodeEreportingDto>> PeriodesAsync(IServiceProvider services, string? nature, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var periodes = await db.Database.SqlQueryRaw<LignePeriodeSql>(SqlPeriode + " WHERE (@n IS NULL OR erp_nature = @n) ORDER BY erp_debut DESC, erp_nature LIMIT 200",
            SqlBtp.P("n", nature, NpgsqlTypes.NpgsqlDbType.Varchar)).ToListAsync(ct);
        var aujourdhui = Aujourdhui(services);
        var r = new List<PeriodeEreportingDto>();
        foreach (var p in periodes)
            r.Add(Dto(p, await db.Database.SqlQueryRaw<LigneEnvoiSql>(SqlEnvois, new NpgsqlParameter("p", p.Id)).ToListAsync(ct), aujourdhui, false));
        return r;
    }

    /// <summary>Période et ses envois (tous : historique des corrections et des essais).</summary>
    public static async Task<PeriodeEreportingDto> PeriodeAsync(IServiceProvider services, long id, bool tous, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var p = (await db.Database.SqlQueryRaw<LignePeriodeSql>(SqlPeriode + " WHERE erp_id = @p", new NpgsqlParameter("p", id)).ToListAsync(ct)).FirstOrDefault()
            ?? throw ExceptionMetier.Introuvable("Période d'e-reporting");
        return Dto(p, await db.Database.SqlQueryRaw<LigneEnvoiSql>(SqlEnvois, new NpgsqlParameter("p", id)).ToListAsync(ct), Aujourdhui(services), tous);
    }

    // ---------------------------------------------------------------- routes

    public static RouteGroupBuilder MapEreportingFe(this RouteGroupBuilder api)
    {
        api.MapGet("/facture-electronique/ereporting/option", (HttpContext http, CancellationToken ct) =>
            OptionAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), http.RequestServices.GetRequiredService<ServiceFactureElectronique>(), ct));
        api.MapPut("/facture-electronique/ereporting/option", async (OptionEreportingFe o, HttpContext http, CancellationToken ct) =>
        {
            http.RequestServices.GetRequiredService<SpecialisationFactureElectronique>().ExigerParametrage(Utilisateur.Depuis(http));
            return await EnregistrerOptionAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(),
                http.RequestServices.GetRequiredService<ServiceFactureElectronique>(), o, ct);
        });
        api.MapGet("/facture-electronique/ereporting/periodes", (string? nature, HttpContext http, CancellationToken ct) =>
            PeriodesAsync(http.RequestServices, nature, ct));
        api.MapGet("/facture-electronique/ereporting/periodes/{id:long}", (long id, HttpContext http, CancellationToken ct) =>
            PeriodeAsync(http.RequestServices, id, true, ct));
        api.MapPost("/facture-electronique/ereporting/periodes/preparation", (DemandePreparationEreporting d, HttpContext http, CancellationToken ct) =>
            PreparerAsync(http.RequestServices, d, Utilisateur.Depuis(http), ct));
        api.MapPost("/facture-electronique/ereporting/periodes/{id:long}/envoi", (long id, HttpContext http, CancellationToken ct) =>
            EnvoyerAsync(http.RequestServices, id, Utilisateur.Depuis(http), ct));
        api.MapPost("/facture-electronique/ereporting/periodes/{id:long}/correction", (long id, HttpContext http, CancellationToken ct) =>
            CorrigerAsync(http.RequestServices, id, Utilisateur.Depuis(http), ct));
        api.MapPost("/facture-electronique/ereporting/periodes/{id:long}/relance", (long id, HttpContext http, CancellationToken ct) =>
            RelancerAsync(http.RequestServices, id, Utilisateur.Depuis(http), ct));
        return api;
    }
}
