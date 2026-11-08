using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Rentabilite;
using LogiBTP.Rentabilite.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Règles du module Rentabilité sur les pièces BTP (ANALYSE-MODULE-ANALYSE.md § 4, § 5.6, § 9), lot 1. Les faits sont
/// des flux datés : la somme jusqu'à T donne l'état à T (budget, budget d'exécution, engagé) ou le cumul (déboursé,
/// facturé). Seules les pièces valables comptent (<c>v_document_valable</c>) ; les commandes et ordres annulés sont
/// écartés, une facture annulée et son avoir d'annulation comptent tous deux (ils se compensent, V3). Rôle de chaque type
/// de pièce : <c>rentabilite_role_type</c> (db/258), jamais un code de type en dur.
/// <list type="bullet">
/// <item>Budget : lignes vendues des commandes clients (et des factures sans commande, Q5) ventilées sur leurs feuilles :
/// PA / PR des feuilles, PV de la ligne vendue réparti au prorata du PR des feuilles (à défaut du PA, à défaut à parts
/// égales), l'arrondi sur la plus forte ; frais annexes : PA / PR seuls (V20) ; postes de pied à part (POSTE, sans
/// nature). Ordre : l'OE qui reprend la ligne (au prorata des quantités reprises), sinon « Sans ordre ».</item>
/// <item>Budget d'exécution : la commande à sa date, la part reprise retirée à la date de l'OE et remplacée par les
/// lignes de l'OE (PV de la commande au prorata repris ; ligne ajoutée par l'OE : PV nul, Q6).</item>
/// <item>Engagé : commandes d'achat et de sous-traitance, réservations ; consommées à la date des réceptions, factures
/// sans réception, factures de sous-traitance, sorties (jamais en dessous de zéro, retour = réengagé), solde à sa date ;
/// main-d'œuvre planifiée après la dernière saisie (par salarié, ou du chantier pour une tâche théorique) au taux du
/// salarié ou du service, datée du jour.</item>
/// <item>Déboursé : réceptions au prix de la commande, écart de prix à la facture, factures sans réception, retours et
/// avoirs en négatif, pied des achats « Non ventilé » au prorata du chantier ; sous-traitance ; pointages retenus (non
/// valorisé : taux du service, signalé) ; sorties de stock au prix du mouvement ; carburant. Rien sur un chantier qui
/// tient un stock pour un article géré en stock (V45).</item>
/// <item>Facturé : factures, factures d'avancement (période), factures d'acompte, avoirs, ventilés comme le budget ;
/// postes de pied à part.</item>
/// <item>Production (§ 4.12, lot 4) : situations de production valables, cumulées ; chaque situation apporte l'écart de
/// chaque ligne du marché avec la situation de production précédente (date, puis création), ventilé comme le budget,
/// daté de la situation ; lignes seules (ni postes de pied ni frais annexes).</item>
/// <item>Matériel (lot 5, V46, R9) : heures pointées (<c>pointage_materiel</c>) en déboursé du chantier pointé, heures
/// planifiées (affectations après le dernier pointage du matériel) en engagé, au coût moyen horaire de la fiche, sinon du
/// type ou de son parent (<c>f_cout_horaire_materiel</c>), nature des paramètres ; matériel loué : heures sans valeur (coût
/// par la commande de location), jamais engagé par le planning.</item>
/// <item>Intérimaires (V43, R10) : option du Pointage ; non cochée, heures sans valeur (coût par les factures de l'agence) ;
/// cochée, coût valorisé du pointage sinon taux de la mission à la date.</item>
/// </list>
/// PR des coûts réels = PA × coefficient de frais généraux de la nature à la date (<c>rentabilite_coef_fg</c>).
/// </summary>
public sealed class SpecialisationRentabiliteBtp : SpecialisationRentabilite
{
    public const string Noeud = "rentabilite";
    public const string NoeudCouts = "rentabilite/couts";
    public const string NoeudPrevisions = "rentabilite/previsions";
    public const string NoeudFacturation = "rentabilite/facturation";

    public override int VersionRegles => 6;

    /// <summary>Règles appliquées (afa_regle), affichées dans la page des faits.</summary>
    public static class Regles
    {
        public const string LigneVendue = "LIGNE_VENDUE";
        public const string FraisAnnexes = "FRAIS_ANNEXES";
        public const string PostePied = "POSTE_PIED";
        public const string Commande = "COMMANDE";
        public const string RepriseOe = "REPRISE_OE";
        public const string OeReprise = "OE_REPRISE";
        public const string OeAjout = "OE_AJOUT";
        public const string FactureSansCommande = "FACTURE_SANS_COMMANDE";
        public const string FactureLigne = "FACTURE_LIGNE";
        public const string CommandeAchat = "COMMANDE_ACHAT";
        public const string CommandeSt = "COMMANDE_ST";
        public const string Reservation = "RESERVATION";
        public const string Consommation = "CONSOMMATION";
        public const string Reengagement = "REENGAGEMENT";
        public const string Solde = "SOLDE";
        public const string Reception = "RECEPTION";
        public const string Retour = "RETOUR";
        public const string EcartPrix = "ECART_PRIX";
        public const string FactureAchat = "FACTURE_ACHAT";
        public const string FactureSt = "FACTURE_ST";
        public const string PiedAchat = "PIED_ACHAT";
        public const string SortieStock = "SORTIE_STOCK";
        public const string RetourStock = "RETOUR_STOCK";
        public const string StockNonValorise = "STOCK_NON_VALORISE";
        public const string Pointage = "POINTAGE";
        public const string PointageTauxService = "POINTAGE_TAUX_SERVICE";
        public const string PointageNonValorise = "POINTAGE_NON_VALORISE";
        public const string Carburant = "CARBURANT";
        public const string TacheAffectee = "TACHE_AFFECTEE";
        public const string TacheTheorique = "TACHE_THEORIQUE";
        public const string TacheSansTaux = "TACHE_SANS_TAUX";
        public const string AcomptePaye = "ACOMPTE_PAYE";
        public const string AcompteRecu = "ACOMPTE_RECU";
        public const string AcompteUtilise = "ACOMPTE_UTILISE";
        public const string ProductionLigne = "PRODUCTION_LIGNE";
        public const string PointageInterim = "POINTAGE_INTERIM";
        public const string PointageMission = "POINTAGE_MISSION";
        public const string PointageMateriel = "POINTAGE_MATERIEL";
        public const string MaterielLoue = "MATERIEL_LOUE";
        public const string MaterielSansCout = "MATERIEL_SANS_COUT";
        public const string TacheMateriel = "TACHE_MATERIEL";
        public const string ProduitInterne = "PRODUIT_INTERNE";
    }

    /// <summary>
    /// Produit interne d'un pointage de matériel sur un autre chantier (plan materiel-suites, lot 7, MO4) : même montant que le
    /// déboursé valorisé sur ce chantier (heures × coût horaire effectif) ; 0 si le matériel est loué à la date ou sans coût.
    /// </summary>
    public static decimal MontantProduitInterne(int minutes, decimal? coutHoraire, bool loue) =>
        loue || coutHoraire is not { } c ? 0m : Math.Round(minutes / 60m * c, 6, MidpointRounding.AwayFromZero);

    public override IReadOnlyList<string> ReglesControle { get; } =
        [Regles.PointageNonValorise, Regles.PointageTauxService, Regles.StockNonValorise, Regles.TacheSansTaux, Regles.MaterielSansCout];

    public override bool DependDuJour(Fait f) => f.SourceType == SourceFait.Tache;

    public override async Task<bool> ActifAsync(RentabiliteDbContext db, CancellationToken ct) =>
        await db.Database.SqlQuery<bool>($"SELECT f_module_actif({ModulesFacultatifs.Rentabilite}) AS \"Value\"").FirstAsync(ct);

    // ================================================================= lectures SQL

    private sealed record PieceSql(long EntId, string Type, string Role, DateOnly Date, DateOnly? DateExterne, int? ChantierEntete, int? Marche,
        string? NatureAvoir, bool Annule, decimal TotalHt, long? Ordre, bool SansCommande, string? Numero);

    private sealed record LigneSql(long LigId, long EntId, long? ParentId, int Ordre, short Tyl, string TypePrix, decimal Ht, decimal Pa, decimal Pr,
        decimal Qte, string? Unite, int? NatId, int? ChaId, long? ArtId, string? Libelle, long? AvtSource, bool Solde, bool Heures);

    private sealed record LienSql(long Source, long Cible, decimal Qte);
    private sealed record SoldeSql(long LigId, DateOnly Date);
    private sealed record CoefSql(int? NatId, DateOnly Depuis, decimal Coef);
    private sealed record PointageSql(long PoiId, DateOnly Date, long? OrdreId, int? NatureId, int? SrvId, int Minutes, decimal? Cout, string? Salarie,
        bool Interim, decimal? TauxMission);
    private sealed record PointageMaterielSql(long PmaId, int MatId, DateOnly Date, int Minutes, long? TacId);
    private sealed record MaterielSql(int Id, decimal? Cout, bool Loueur, DateOnly? FinLocation, DateOnly? Derniere, string? Libelle)
    {
        /// <summary>Loué à cette date : un loueur et la location non terminée.</summary>
        public bool Loue(DateOnly date) => Loueur && (FinLocation is null || date <= FinLocation);
    }
    private sealed record OrdreSql(long Ent, long? Oe);
    private sealed record MouvementSql(long MvtId, long EntId, long? LigId, DateOnly Date, decimal Qte, decimal? Prix, string? Unite, int? NatId, string? Libelle);
    private sealed record CarburantSql(long MevId, DateOnly Date, decimal? Cout, string? Libelle);
    private sealed record TacheSql(long TacId, DateTime Debut, DateTime Fin, int Heures, int? SrvId, string? OrigineType, string? OrigineId, string? Libelle,
        string? ResType, string? ResId, int? AffHeures, decimal? AffQuantite);
    private sealed record TauxSql(int Id, decimal? Taux);
    private sealed record AcompteSql(string Indicateur, string Regle, DateOnly Date, long EntId, string Type, int MarId, string Source, long? SourceId,
        decimal Montant, string? Libelle);
    private sealed record DateSql(int Id, DateOnly? Date);

    private static readonly string[] RolesCommandes = [RolesRentabilite.Production, RolesRentabilite.CommandeVente, RolesRentabilite.OrdreExecution, RolesRentabilite.CommandeAchat,
        RolesRentabilite.CommandeSt, RolesRentabilite.ReservationStock, RolesRentabilite.ReceptionAchat, RolesRentabilite.RetourAchat];

    /// <summary>Signe d'une pièce comptable : avoir retourné, sauf l'avoir d'avancement (déjà négatif, V4).</summary>
    private static int Signe(PieceSql p) =>
        p.Role is RolesRentabilite.AvoirVente or RolesRentabilite.AvoirAchat or RolesRentabilite.AvoirSt && p.NatureAvoir != "AVANCEMENT" ? -1 : 1;

    /// <summary>Date du fait d'une pièce : date externe (comptable) des factures d'achat et de sous-traitance, sinon date du document (Q3).</summary>
    private static DateOnly DatePiece(PieceSql p) =>
        p.Role is RolesRentabilite.FactureAchat or RolesRentabilite.AvoirAchat or RolesRentabilite.FactureSt or RolesRentabilite.AvoirSt ? p.DateExterne ?? p.Date : p.Date;

    // ================================================================= calcul d'un chantier

    public override async Task<List<Fait>> CalculerAsync(RentabiliteDbContext db, int chantier, DateOnly aujourdhui, CancellationToken ct)
    {
        var c = new Calcul(chantier, aujourdhui);
        var tientStock = (await db.Database.SqlQuery<bool>($"SELECT (cha_depot OR cha_stock_tenu) AS \"Value\" FROM chantier WHERE cha_id = {chantier}").ToListAsync(ct))
            .FirstOrDefault();
        c.Coefs = await db.Database.SqlQuery<CoefSql>($"SELECT rcf_nat_id AS nat_id, rcf_depuis AS depuis, rcf_coef AS coef FROM rentabilite_coef_fg").ToListAsync(ct);
        c.TauxService = (await db.Database.SqlQuery<TauxSql>($"SELECT rts_srv_id AS id, rts_taux AS taux FROM rentabilite_taux_service").ToListAsync(ct))
            .Where(t => t.Taux is not null).ToDictionary(t => t.Id, t => t.Taux!.Value);

        var pieces = (await db.Database.SqlQuery<PieceSql>($"""
            SELECT d.ent_id, t.tyd_code AS type, x.rrt_role AS role, d.ent_date AS date, d.ent_date_externe AS date_externe, d.ent_chantier_id AS chantier_entete,
                   d.ent_marche_id AS marche, d.ent_nature_avoir AS nature_avoir, v.annule, coalesce(d.ent_total_ht, 0) AS total_ht,
                   f_rentabilite_ordre(d.ent_id) AS ordre,
                   (x.rrt_role IN ('FACTURE_VENTE', 'AVOIR_VENTE') AND f_rentabilite_ancetre(d.ent_id, 'COMMANDE_VENTE') IS NULL) AS sans_commande,
                   d.ent_numero AS numero
            FROM document_chantier dc
            JOIN document d ON d.ent_id = dc.dch_ent_id
            JOIN v_document_valable v ON v.ent_id = d.ent_id
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code
            WHERE dc.dch_cha_id = {chantier}
            """).ToListAsync(ct))
            // Commandes, ordres, réceptions annulés : hors analyse ; pièces comptables annulées : comptées avec leur avoir (V3).
            .Where(p => !(p.Annule && RolesCommandes.Contains(p.Role)))
            .ToDictionary(p => p.EntId);
        var ents = pieces.Keys.ToArray();
        List<LigneSql> lignes = ents.Length == 0 ? [] : await db.Database.SqlQuery<LigneSql>($"""
            SELECT l.lig_id, l.lig_ent_id AS ent_id, l.lig_parent_id AS parent_id, l.lig_ordre AS ordre, l.lig_tyl_id AS tyl,
                   coalesce(l.lig_type_prix, 'V') AS type_prix, coalesce(l.lig_montant_ht, 0) AS ht, coalesce(l.lig_montant_pa, 0) AS pa,
                   coalesce(l.lig_montant_pr, 0) AS pr, coalesce(l.lig_qte_totale, l.lig_qte, 0) AS qte, l.lig_unt_code AS unite, l.lig_nat_id AS nat_id,
                   l.lig_cha_id AS cha_id, l.lig_art_id AS art_id, left(coalesce(l.lig_libelle_brut, l.lig_libelle_affiche), 200) AS libelle,
                   l.lig_avt_source_lig_id AS avt_source, coalesce(l.lig_solde, FALSE) AS solde,
                   (lower(coalesce(l.lig_unt_code, '')) IN ('h', 'heure', 'heures')
                    AND EXISTS (SELECT 1 FROM nature_element n WHERE n.nat_id = l.lig_nat_id AND n.nat_rgn_code = 'MO')) AS heures
            FROM document_ligne l WHERE l.lig_ent_id = ANY({ents}) AND l.lig_tyl_id IN (1, 2, 3, 8, 11)
            """).ToListAsync(ct);
        c.Charger(pieces, lignes);
        var ids = lignes.Select(l => l.LigId).ToArray();
        c.Liens = ids.Length == 0 ? [] : (await db.Database.SqlQuery<LienSql>($"""
            SELECT k.lil_source_lig_id AS source, k.lil_cible_lig_id AS cible, coalesce(k.lil_qte, 0) AS qte
            FROM document_ligne_lien k WHERE k.lil_source_lig_id = ANY({ids}) OR k.lil_cible_lig_id = ANY({ids})
            """).ToListAsync(ct)).Where(k => c.Lignes.ContainsKey(k.Source) && c.Lignes.ContainsKey(k.Cible)).ToList();
        c.ChargerLiens();
        c.Soldes = ids.Length == 0 ? [] : (await db.Database.SqlQuery<SoldeSql>($"""
            SELECT lso_lig_id AS lig_id, max(lso_date)::date AS date FROM document_ligne_solde WHERE lso_lig_id = ANY({ids}) GROUP BY 1
            """).ToListAsync(ct)).ToDictionary(s => s.LigId, s => s.Date);
        var articles = lignes.Where(l => l.ArtId is not null).Select(l => l.ArtId!.Value).Distinct().ToArray();
        c.ArticlesStock = !tientStock || articles.Length == 0 ? [] : (await db.Database.SqlQuery<long>($"""
            SELECT ele_id AS "Value" FROM element WHERE ele_id = ANY({articles}) AND ele_gestion = 'STOCK'
            """).ToListAsync(ct)).ToHashSet();

        c.Budget();
        c.BudgetExecution();
        c.Facture();
        c.Production();
        c.Engage();
        c.DebourseAchats();

        // Pointages retenus (couche validée si la semaine l'est, sinon saisie).
        var pointages = await db.Database.SqlQuery<PointageSql>($"""
            SELECT p.poi_id, p.date_pointage AS date, p.ordre_id, p.nature_id, p.srv_id, p.minutes::int AS minutes, p.cout,
                   nullif(concat_ws(' ', s.sal_prenom, s.sal_nom), '') AS salarie, coalesce(s.sal_statut = 'INTERIM', FALSE) AS interim,
                   CASE WHEN s.sal_statut = 'INTERIM' THEN (SELECT m.mis_taux_horaire FROM mission_interim m WHERE m.mis_sal_id = s.sal_id
                        AND p.date_pointage BETWEEN m.mis_debut AND m.mis_fin ORDER BY m.mis_debut DESC LIMIT 1) END AS taux_mission
            FROM v_pointages_retenus p LEFT JOIN salarie s ON s.sal_id = p.sal_id
            WHERE p.chantier_id = {chantier}
            """).ToListAsync(ct);
        c.InterimValorises = (await db.Database.SqlQuery<bool>($"SELECT ppa_interim_imputes AS \"Value\" FROM poi_parametre WHERE ppa_id = 1").ToListAsync(ct))
            .FirstOrDefault();
        var ordresPointes = pointages.Where(p => p.OrdreId is not null).Select(p => p.OrdreId!.Value).Distinct().ToArray();
        Dictionary<long, long?> oes = ordresPointes.Length == 0 ? [] : (await db.Database.SqlQuery<OrdreSql>($"""
            SELECT x AS ent, f_rentabilite_ordre(x) AS oe FROM unnest({ordresPointes}) x
            """).ToListAsync(ct)).ToDictionary(o => o.Ent, o => o.Oe);
        c.Pointages(pointages, oes);

        // Matériel (lot 5) : heures pointées sur le chantier, coût horaire effectif, location, dernier pointage.
        c.NatureMateriel = (await db.Database.SqlQuery<int?>($"SELECT rpa_nat_materiel AS \"Value\" FROM rentabilite_parametre WHERE rpa_id = 1").ToListAsync(ct))
            .FirstOrDefault();
        var pointagesMateriel = await db.Database.SqlQuery<PointageMaterielSql>($"""
            SELECT pma_id, pma_mat_id AS mat_id, pma_date AS date, pma_minutes AS minutes, pma_tac_id AS tac_id
            FROM pointage_materiel WHERE pma_cha_id = {chantier}
            """).ToListAsync(ct);
        // Produit interne (lot 7, MO4) : heures des matériels suivis par ce chantier, pointées sur d'autres chantiers.
        var pointagesAilleurs = await db.Database.SqlQuery<PointageMaterielSql>($"""
            SELECT p.pma_id, p.pma_mat_id AS mat_id, p.pma_date AS date, p.pma_minutes AS minutes, p.pma_tac_id AS tac_id
            FROM pointage_materiel p JOIN materiel m ON m.mat_id = p.pma_mat_id
            WHERE m.mat_cha_id = {chantier} AND p.pma_cha_id IS DISTINCT FROM {chantier}
            """).ToListAsync(ct);
        var materielsPointes = pointagesMateriel.Concat(pointagesAilleurs).Select(p => p.MatId).ToArray();
        var tachesPointees = pointagesMateriel.Where(p => p.TacId is not null).Select(p => p.TacId!.Value).Distinct().ToArray();
        Dictionary<long, long?> oeTachesMateriel = tachesPointees.Length == 0 ? [] : (await db.Database.SqlQuery<OrdreSql>($"""
            SELECT t.tac_id AS ent, f_rentabilite_ordre(t.tac_origine_id::bigint) AS oe FROM pla_tache t
            WHERE t.tac_id = ANY({tachesPointees}) AND t.tac_origine_type = 'ordre' AND t.tac_origine_id ~ '^\d+$'
            """).ToListAsync(ct)).ToDictionary(o => o.Ent, o => o.Oe);
        if (!tientStock)
        {
            var mouvements = await db.Database.SqlQuery<MouvementSql>($"""
                SELECT m.mvt_id, m.mvt_ent_id AS ent_id, m.mvt_lig_id AS lig_id, m.mvt_date::date AS date, m.mvt_quantite AS qte,
                       coalesce(m.mvt_prix, m.mvt_pmp) AS prix, e.ele_unt_stock AS unite, l.lig_nat_id AS nat_id,
                       left(coalesce(l.lig_libelle_brut, e.ele_libelle), 200) AS libelle
                FROM stk_mouvement m
                JOIN document d ON d.ent_id = m.mvt_ent_id
                LEFT JOIN document_ligne l ON l.lig_id = m.mvt_lig_id
                LEFT JOIN element e ON e.ele_id = m.mvt_ele_id
                WHERE d.ent_chantier_id = {chantier} AND m.mvt_lieu_id <> {chantier} AND d.ent_id = ANY({ents})
                """).ToListAsync(ct);
            c.Mouvements(mouvements);
        }
        var carburant = await db.Database.SqlQuery<CarburantSql>($"""
            SELECT e.mev_id, e.mev_date::date AS date, e.mev_cout AS cout, e.mev_libelle AS libelle
            FROM materiel_evenement e JOIN materiel m ON m.mat_id = e.mev_mat_id
            WHERE e.mev_type = 'CARBURANT' AND m.mat_cha_id = {chantier}
            """).ToListAsync(ct);
        c.Carburant(carburant);

        // Acomptes en trésorerie (§ 4.7, R6) : payé = règlements pointés sur les reçus (module Règlements actif), sinon montant
        // des reçus ; utilisé = déductions des pièces valables. Montants TTC, hors des indicateurs de coût et du facturé.
        var acomptes = await db.Database.SqlQuery<AcompteSql>($"""
            SELECT {Indicateur.AcomptePaye} AS indicateur, {Regles.AcomptePaye} AS regle, r.reg_date AS date, d.ent_id, t.tyd_code AS type, mac.mac_mar_id AS mar_id,
                   {SourceFait.Reglement} AS source, pt.poi_id AS source_id, pt.poi_montant AS montant, mac.mac_libelle AS libelle
            FROM marche_acompte mac
            JOIN marche m ON m.mar_id = mac.mac_mar_id
            JOIN document d ON d.ent_id = mac.mac_piece_ent_id
            JOIN v_document_valable v ON v.ent_id = d.ent_id AND NOT v.annule
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN document_echeance e ON e.ech_ent_id = d.ent_id
            JOIN pointage pt ON pt.poi_echeance_id = e.ech_id AND pt.poi_reg_id IS NOT NULL
            JOIN reglement r ON r.reg_id = pt.poi_reg_id
            WHERE m.mar_cha_id = {chantier} AND mac.mac_mode = 'TRESORERIE' AND f_module_actif('reglement')
            UNION ALL
            SELECT {Indicateur.AcomptePaye}, {Regles.AcompteRecu}, d.ent_date, d.ent_id, t.tyd_code, mac.mac_mar_id, {SourceFait.Document}, NULL::bigint,
                   d.ent_total_ttc, mac.mac_libelle
            FROM marche_acompte mac
            JOIN marche m ON m.mar_id = mac.mac_mar_id
            JOIN document d ON d.ent_id = mac.mac_piece_ent_id
            JOIN v_document_valable v ON v.ent_id = d.ent_id AND NOT v.annule
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            WHERE m.mar_cha_id = {chantier} AND mac.mac_mode = 'TRESORERIE' AND NOT f_module_actif('reglement')
            UNION ALL
            SELECT {Indicateur.AcompteUtilise}, {Regles.AcompteUtilise}, d.ent_date, d.ent_id, t.tyd_code, mac.mac_mar_id,
                   {SourceFait.Document}, acd.acd_id, acd.acd_montant, mac.mac_libelle
            FROM acompte_deduction acd
            JOIN marche_acompte mac ON mac.mac_id = acd.acd_mac_id
            JOIN marche m ON m.mar_id = mac.mac_mar_id
            JOIN document d ON d.ent_id = acd.acd_ent_id
            JOIN v_document_valable v ON v.ent_id = d.ent_id AND NOT v.annule
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            WHERE m.mar_cha_id = {chantier} AND mac.mac_mode = 'TRESORERIE'
            """).ToListAsync(ct);
        c.Acomptes(acomptes);

        // Main-d'œuvre et matériel planifiés (engagé, daté du jour) : tâches non terminées du chantier qui finissent aujourd'hui ou après.
        var taches = await db.Database.SqlQuery<TacheSql>($"""
            SELECT t.tac_id, t.tac_debut AS debut, t.tac_fin AS fin, t.tac_heures AS heures, t.tac_srv_id AS srv_id, t.tac_origine_type AS origine_type,
                   t.tac_origine_id AS origine_id, t.tac_libelle AS libelle, a.aff_res_type AS res_type, a.aff_res_id AS res_id, a.aff_heures AS aff_heures,
                   a.aff_quantite
            FROM pla_tache t LEFT JOIN pla_affectation a ON a.aff_tac_id = t.tac_id
            WHERE t.tac_type_element = 'chantier' AND t.tac_id_element = {chantier.ToString()} AND t.tac_etat <> 'TERMINEE'
              AND t.tac_fin::date >= {aujourdhui}
            """).ToListAsync(ct);
        var materielsPlanifies = taches.Where(t => t.ResType == "MATERIEL" && int.TryParse(t.ResId, out _)).Select(t => int.Parse(t.ResId!));
        var idsMateriel = materielsPointes.Concat(materielsPlanifies).Distinct().ToArray();
        c.Materiels = idsMateriel.Length == 0 ? [] : (await db.Database.SqlQuery<MaterielSql>($"""
            SELECT m.mat_id AS id, f_cout_horaire_materiel(m.mat_id) AS cout, m.mat_loueur_id IS NOT NULL AS loueur, m.mat_fin_location AS fin_location,
                   (SELECT max(p.pma_date) FROM pointage_materiel p WHERE p.pma_mat_id = m.mat_id) AS derniere,
                   left(concat_ws(' ', m.mat_code, m.mat_designation), 200) AS libelle
            FROM materiel m WHERE m.mat_id = ANY({idsMateriel})
            """).ToListAsync(ct)).ToDictionary(m => m.Id);
        c.PointagesMateriel(pointagesMateriel, oeTachesMateriel);
        c.ProduitInterne(pointagesAilleurs);
        if (taches.Count > 0)
        {
            var salaries = taches.Where(t => t.ResType == "SALARIE" && int.TryParse(t.ResId, out _)).Select(t => int.Parse(t.ResId!)).Distinct().ToArray();
            var taux = (await db.Database.SqlQuery<TauxSql>($"""
                SELECT s.sal_id AS id, coalesce(s.sal_cout_horaire, round(s.sal_salaire / nullif(s.sal_heures_mois, 0) * 1.42, 4)) AS taux
                FROM salarie s WHERE s.sal_id = ANY({salaries}) AND s.sal_statut IS DISTINCT FROM 'INTERIM'
                """).ToListAsync(ct)).ToDictionary(t => t.Id, t => t.Taux);
            var dernieres = (await db.Database.SqlQuery<DateSql>($"""
                SELECT poi_sal_id AS id, max(poi_date) AS date FROM poi_pointage WHERE poi_sal_id = ANY({salaries}) GROUP BY 1
                """).ToListAsync(ct)).ToDictionary(d => d.Id, d => d.Date);
            var derniereChantier = (await db.Database.SqlQuery<DateOnly?>($"SELECT max(poi_date) AS \"Value\" FROM poi_pointage WHERE poi_cha_id = {chantier}")
                .ToListAsync(ct)).FirstOrDefault();
            var origines = taches.Where(t => t.OrigineType == "ordre" && long.TryParse(t.OrigineId, out _)).Select(t => long.Parse(t.OrigineId!)).Distinct().ToArray();
            Dictionary<long, long?> oeTaches = origines.Length == 0 ? [] : (await db.Database.SqlQuery<OrdreSql>($"""
                SELECT x AS ent, f_rentabilite_ordre(x) AS oe FROM unnest({origines}) x
                """).ToListAsync(ct)).ToDictionary(o => o.Ent, o => o.Oe);
            var naturesService = (await db.Database.SqlQuery<NatureServiceSql>($"""
                SELECT DISTINCT ON (nat_srv_id) nat_srv_id AS srv_id, nat_id FROM nature_element WHERE nat_srv_id IS NOT NULL AND nat_actif ORDER BY nat_srv_id, nat_id
                """).ToListAsync(ct)).ToDictionary(n => n.SrvId, n => n.NatId);
            c.Planning(taches, taux, dernieres, derniereChantier, oeTaches, naturesService);
        }
        return c.Faits;
    }

    private sealed record NatureServiceSql(int SrvId, int NatId);

    /// <summary>Calcul d'un chantier : pièces, lignes et liens chargés, faits produits par indicateur.</summary>
    private sealed class Calcul(int chantier, DateOnly aujourdhui)
    {
        public List<Fait> Faits { get; } = [];
        public List<CoefSql> Coefs { get; set; } = [];
        public Dictionary<int, decimal> TauxService { get; set; } = [];
        public Dictionary<long, PieceSql> Pieces { get; private set; } = [];
        public Dictionary<long, LigneSql> Lignes { get; private set; } = [];
        public List<LienSql> Liens { get; set; } = [];
        public Dictionary<long, DateOnly> Soldes { get; set; } = [];
        public HashSet<long> ArticlesStock { get; set; } = [];
        public bool InterimValorises { get; set; }
        public int? NatureMateriel { get; set; }
        public Dictionary<int, MaterielSql> Materiels { get; set; } = [];

        private readonly Dictionary<long, List<LigneSql>> enfants = [];
        private readonly Dictionary<long, List<LigneSql>> vendues = [];
        private readonly Dictionary<long, List<LigneSql>> fraisAnnexes = [];
        private readonly Dictionary<long, List<LigneSql>> pieds = [];
        private readonly Dictionary<long, decimal> parts = [];
        private ILookup<long, LienSql> liensSource = Array.Empty<LienSql>().ToLookup(x => x.Source);
        private ILookup<long, LienSql> liensCible = Array.Empty<LienSql>().ToLookup(x => x.Cible);
        // Part de chaque ligne de commande reprise par chaque OE (ligne vendue de la commande → OE → fraction).
        private readonly Dictionary<long, List<(long Oe, decimal Part)>> reprises = [];

        private static bool Chiffree(LigneSql l) => l.Tyl is 2 or 3;

        public void Charger(Dictionary<long, PieceSql> pieces, List<LigneSql> lignes)
        {
            Pieces = pieces;
            Lignes = lignes.ToDictionary(l => l.LigId);
            foreach (var l in lignes.Where(l => l.ParentId is not null))
            {
                if (!enfants.TryGetValue(l.ParentId!.Value, out var e)) enfants[l.ParentId.Value] = e = [];
                e.Add(l);
            }
            foreach (var g in lignes.GroupBy(l => l.EntId))
            {
                var p = pieces[g.Key];
                var v = new List<LigneSql>();
                var f = new List<LigneSql>();
                foreach (var racine in g.Where(l => l.ParentId is null).OrderBy(l => l.Ordre)) Parcourir(racine, false, false, v, f);
                vendues[g.Key] = v;
                fraisAnnexes[g.Key] = f;
                pieds[g.Key] = g.Where(l => l.Tyl == 8).OrderBy(l => l.Ordre).ToList();
                // Part du chantier dans la pièce : HT de ses lignes vendues / HT de toutes ; sans lignes : entête.
                var total = v.Sum(l => l.Ht);
                parts[g.Key] = total != 0 ? v.Where(l => ChantierDe(l, p) == chantier).Sum(l => l.Ht) / total : p.ChantierEntete == chantier ? 1 : 0;
            }
            foreach (var e in pieces.Keys.Where(e => !parts.ContainsKey(e)))
            {
                vendues[e] = [];
                fraisAnnexes[e] = [];
                pieds[e] = [];
                parts[e] = pieces[e].ChantierEntete == chantier ? 1 : 0;
            }
        }

        /// <summary>Lignes vendues (chiffrées de premier niveau, type V sur toute la branche) et feuilles de frais annexes (branche F).</summary>
        private void Parcourir(LigneSql l, bool horsVente, bool frais, List<LigneSql> v, List<LigneSql> f)
        {
            frais |= l.TypePrix == "F";
            horsVente |= l.TypePrix != "V";
            if (Chiffree(l))
            {
                if (frais) f.AddRange(Feuilles(l));
                else if (!horsVente) v.Add(l);
                return;
            }
            foreach (var e in enfants.GetValueOrDefault(l.LigId, []).OrderBy(x => x.Ordre)) Parcourir(e, horsVente, frais, v, f);
        }

        /// <summary>Feuilles d'une ligne chiffrée : lignes chiffrées sans ligne chiffrée en dessous (la ligne elle-même sans composante).</summary>
        public List<LigneSql> Feuilles(LigneSql l)
        {
            var r = new List<LigneSql>();
            void Descendre(LigneSql x)
            {
                var sous = enfants.GetValueOrDefault(x.LigId, []).OrderBy(e => e.Ordre).ToList();
                var avant = r.Count;
                foreach (var e in sous) Descendre(e);
                if (Chiffree(x) && r.Count == avant) r.Add(x);
            }
            Descendre(l);
            return r;
        }

        private int? ChantierDe(LigneSql l, PieceSql p) => l.ChaId ?? p.ChantierEntete;

        private decimal Coef(int? nature, DateOnly date) =>
            Coefs.Where(x => x.NatId == nature && x.Depuis <= date).OrderByDescending(x => x.Depuis).Select(x => (decimal?)x.Coef).FirstOrDefault()
            ?? Coefs.Where(x => x.NatId is null && x.Depuis <= date).OrderByDescending(x => x.Depuis).Select(x => (decimal?)x.Coef).FirstOrDefault()
            ?? 1m;

        private static decimal R6(decimal v) => decimal.Round(v, 6, MidpointRounding.AwayFromZero);

        /// <summary>Répartit un montant au prorata de poids (six décimales), l'arrondi sur le plus fort ; poids tous nuls : parts égales.</summary>
        public static decimal[] Repartir(decimal total, IReadOnlyList<decimal> poids)
        {
            var n = poids.Count;
            if (n == 0) return [];
            var somme = poids.Sum();
            var w = somme == 0 ? Enumerable.Repeat(1m, n).ToArray() : poids.ToArray();
            somme = w.Sum();
            var parts = w.Select(x => R6(total * x / somme)).ToArray();
            var plus = Array.IndexOf(w, w.MaxBy(Math.Abs));
            parts[plus] += total - parts.Sum();
            return parts;
        }

        /// <summary>PV d'une ligne vendue ventilé sur ses feuilles (prorata du PR, à défaut du PA).</summary>
        private (LigneSql Feuille, decimal Pv)[] Ventiler(LigneSql vendue, decimal pv)
        {
            var feuilles = Feuilles(vendue);
            var poids = feuilles.Select(x => Math.Abs(x.Pr)).ToList();
            if (poids.Sum() == 0) poids = feuilles.Select(x => Math.Abs(x.Pa)).ToList();
            var r = Repartir(pv, poids);
            return feuilles.Select((x, i) => (x, r[i])).ToArray();
        }

        private void Ajouter(string indicateur, string composante, DateOnly date, PieceSql? p, LigneSql? l, int? nature, decimal pa, decimal pr, decimal pv,
            string regle, long? ordre, string? libelle = null, decimal? qte = null, string? unite = null, decimal? heures = null, string source = SourceFait.Document,
            long? sourceId = null)
        {
            if (pa == 0 && pr == 0 && pv == 0 && (heures ?? 0) == 0 && regle is not (Regles.PointageNonValorise or Regles.StockNonValorise or Regles.TacheSansTaux or Regles.MaterielLoue
            or Regles.MaterielSansCout)) return;
            Faits.Add(new Fait(chantier, ordre, p?.Marche, indicateur, composante, date, nature, qte, unite, pa, pr, pv, heures, source, p?.Type, p?.EntId,
                l?.LigId, sourceId, regle, libelle ?? l?.Libelle));
        }

        private IEnumerable<(PieceSql P, LigneSql L)> VenduesDuChantier(params string[] roles) =>
            Pieces.Values.Where(p => roles.Contains(p.Role)).SelectMany(p => vendues[p.EntId].Where(l => ChantierDe(l, p) == chantier).Select(l => (p, l)));

        // ------------------------------------------------------------- budget

        /// <summary>Parts de chaque OE dans une ligne de commande : quantités reprises / quantité commandée (somme plafonnée à 1).</summary>
        private List<(long Oe, decimal Part)> Reprises(LigneSql commande)
        {
            if (reprises.TryGetValue(commande.LigId, out var r)) return r;
            var liens = liensSource[commande.LigId]
                .Select(k => (k, P: Pieces[Lignes[k.Cible].EntId]))
                .Where(x => x.P.Role == RolesRentabilite.OrdreExecution)
                .ToList();
            r = liens.GroupBy(x => x.P.EntId)
                .Select(g => (Oe: g.Key, Part: commande.Qte != 0 ? g.Sum(x => x.k.Qte) / commande.Qte : 1m / liens.Select(x => x.P.EntId).Distinct().Count()))
                .Where(x => x.Part > 0).ToList();
            var somme = r.Sum(x => x.Part);
            if (somme > 1) r = r.Select(x => (x.Oe, x.Part / somme)).ToList();
            return reprises[commande.LigId] = r;
        }

        /// <summary>Lien d'une ligne d'OE vers sa ligne de commande : part de la ligne de commande reprise par ce lien.</summary>
        private decimal PartLien(LienSql k, LigneSql commande) =>
            commande.Qte != 0 ? k.Qte / commande.Qte : 1m / Math.Max(1, liensSource[commande.LigId].Count(x => Pieces[Lignes[x.Cible].EntId].Role == RolesRentabilite.OrdreExecution));

        private void LignesBudget(string indicateur, PieceSql p, LigneSql l, decimal signe, DateOnly date, string regle, IReadOnlyList<(long? Oe, decimal Part)> repartition)
        {
            foreach (var (feuille, pv) in Ventiler(l, signe * l.Ht))
            {
                var pas = Repartir(signe * feuille.Pa, repartition.Select(x => x.Part).ToList());
                var prs = Repartir(signe * feuille.Pr, repartition.Select(x => x.Part).ToList());
                var pvs = Repartir(pv, repartition.Select(x => x.Part).ToList());
                var hs = feuille.Heures ? Repartir(signe * feuille.Qte, repartition.Select(x => x.Part).ToList()) : null;
                for (var i = 0; i < repartition.Count; i++)
                    Ajouter(indicateur, Composante.Vente, date, p, feuille, feuille.NatId, pas[i], prs[i], pvs[i], regle, repartition[i].Oe,
                        qte: repartition.Count == 1 ? signe * feuille.Qte : null, unite: feuille.Unite,
                        heures: hs?[i]);
            }
        }

        private void PiedEtFrais(string indicateur, PieceSql p, decimal signe, DateOnly date, string composante, bool frais)
        {
            var part = parts[p.EntId];
            foreach (var x in pieds[p.EntId])
                Ajouter(indicateur, Composante.Poste, date, p, x, null, 0, 0, signe * x.Ht * part, Regles.PostePied, p.Ordre);
            if (!frais) return;
            foreach (var x in fraisAnnexes[p.EntId].Where(x => ChantierDe(x, p) == chantier))
                Ajouter(indicateur, composante, date, p, x, x.NatId, signe * x.Pa, signe * x.Pr, 0, Regles.FraisAnnexes, null, qte: signe * x.Qte, unite: x.Unite);
        }

        public void Budget()
        {
            foreach (var (p, l) in VenduesDuChantier(RolesRentabilite.CommandeVente))
            {
                var r = Reprises(l);
                var rep = r.Select(x => ((long?)x.Oe, x.Part)).ToList();
                var reste = 1 - r.Sum(x => x.Part);
                if (reste > 0 || rep.Count == 0) rep.Add((null, reste > 0 ? reste : 1));
                LignesBudget(Indicateur.Budget, p, l, 1, p.Date, Regles.LigneVendue, rep);
            }
            foreach (var p in Pieces.Values.Where(p => p.Role == RolesRentabilite.CommandeVente)) PiedEtFrais(Indicateur.Budget, p, 1, p.Date, Composante.Vente, true);
            // Factures et avoirs de vente sans commande d'origine (Q5).
            foreach (var (p, l) in VenduesDuChantier(RolesRentabilite.FactureVente, RolesRentabilite.AvoirVente).Where(x => x.P.SansCommande))
                LignesBudget(Indicateur.Budget, p, l, Signe(p), p.Date, Regles.FactureSansCommande, [(null, 1)]);
            foreach (var p in Pieces.Values.Where(p => p.SansCommande)) PiedEtFrais(Indicateur.Budget, p, Signe(p), p.Date, Composante.Vente, true);
        }

        public void BudgetExecution()
        {
            foreach (var (p, l) in VenduesDuChantier(RolesRentabilite.CommandeVente))
            {
                LignesBudget(Indicateur.BudgetExecution, p, l, 1, p.Date, Regles.Commande, [(null, 1)]);
                foreach (var (oe, part) in Reprises(l))
                    LignesBudget(Indicateur.BudgetExecution, p, l, -part, Pieces[oe].Date, Regles.RepriseOe, [(null, 1)]);
            }
            foreach (var p in Pieces.Values.Where(p => p.Role == RolesRentabilite.CommandeVente)) PiedEtFrais(Indicateur.BudgetExecution, p, 1, p.Date, Composante.Vente, true);
            foreach (var (p, l) in VenduesDuChantier(RolesRentabilite.FactureVente, RolesRentabilite.AvoirVente).Where(x => x.P.SansCommande))
                LignesBudget(Indicateur.BudgetExecution, p, l, Signe(p), p.Date, Regles.FactureSansCommande, [(null, 1)]);
            foreach (var p in Pieces.Values.Where(p => p.SansCommande)) PiedEtFrais(Indicateur.BudgetExecution, p, Signe(p), p.Date, Composante.Vente, true);
            // Lignes des OE : reprises (PV de la commande au prorata repris) ou ajoutées (PV nul).
            foreach (var (p, l) in VenduesDuChantier(RolesRentabilite.OrdreExecution))
            {
                var sources = liensCible[l.LigId]
                    .Where(k => Lignes.TryGetValue(k.Source, out var s) && Pieces[s.EntId].Role == RolesRentabilite.CommandeVente)
                    .ToList();
                var pv = sources.Sum(k => Lignes[k.Source].Ht * PartLien(k, Lignes[k.Source]));
                foreach (var (feuille, pvf) in Ventiler(l, pv))
                    Ajouter(Indicateur.BudgetExecution, Composante.Vente, p.Date, p, feuille, feuille.NatId, feuille.Pa, feuille.Pr, pvf,
                        sources.Count > 0 ? Regles.OeReprise : Regles.OeAjout, p.EntId, qte: feuille.Qte, unite: feuille.Unite,
                        heures: feuille.Heures ? feuille.Qte : null);
            }
            foreach (var p in Pieces.Values.Where(p => p.Role == RolesRentabilite.OrdreExecution))
                foreach (var x in fraisAnnexes[p.EntId].Where(x => ChantierDe(x, p) == chantier))
                    Ajouter(Indicateur.BudgetExecution, Composante.Vente, p.Date, p, x, x.NatId, x.Pa, x.Pr, 0, Regles.FraisAnnexes, p.EntId, qte: x.Qte, unite: x.Unite);
        }

        // ------------------------------------------------------------- facturé

        /// <summary>Ligne de commande d'origine d'une ligne facturée (lien d'avancement, sinon liens de transformation remontés).</summary>
        private LigneSql? CommandeDe(LigneSql l)
        {
            var vus = new HashSet<long>();
            var file = new Queue<long>([l.LigId]);
            if (l.AvtSource is { } a) file.Enqueue(a);
            while (file.Count > 0)
            {
                var id = file.Dequeue();
                if (!vus.Add(id) || !Lignes.TryGetValue(id, out var x)) continue;
                if (Pieces[x.EntId].Role == RolesRentabilite.CommandeVente) return x;
                if (x.AvtSource is { } s) file.Enqueue(s);
                foreach (var k in liensCible[id]) file.Enqueue(k.Source);
            }
            return null;
        }

        public void Facture()
        {
            string[] roles = [RolesRentabilite.FactureVente, RolesRentabilite.FactureAcompte, RolesRentabilite.AvoirVente];
            foreach (var (p, l) in VenduesDuChantier(roles))
            {
                var commande = CommandeDe(l);
                var oe = commande is null ? null : Reprises(commande).OrderByDescending(x => x.Part).Select(x => (long?)x.Oe).FirstOrDefault();
                // Factures d'acompte : composante à part, hors du « réalisé » du bloc de résultats (Q15).
                var composante = p.Role == RolesRentabilite.FactureAcompte ? Composante.Acompte : Composante.Vente;
                foreach (var (feuille, pv) in Ventiler(l, Signe(p) * l.Ht))
                    Ajouter(Indicateur.Facture, composante, p.Date, p, feuille, feuille.NatId, 0, 0, pv, Regles.FactureLigne, oe ?? p.Ordre);
            }
            foreach (var p in Pieces.Values.Where(p => roles.Contains(p.Role))) PiedEtFrais(Indicateur.Facture, p, Signe(p), p.Date, Composante.Vente, false);
        }

        // ------------------------------------------------------------- production

        /// <summary>
        /// Production (§ 4.12) : situations de production en cumul ; chaque ligne vendue apporte son écart avec la même ligne
        /// du marché (lig_avt_source_lig_id) dans la situation de production précédente du marché, à la date de la situation.
        /// </summary>
        public void Production()
        {
            var precedents = new Dictionary<(int?, long), decimal>();
            foreach (var p in Pieces.Values.Where(p => p.Role == RolesRentabilite.Production).OrderBy(p => p.Date).ThenBy(p => p.EntId))
            {
                foreach (var l in vendues[p.EntId].Where(l => ChantierDe(l, p) == chantier))
                {
                    var cle = (p.Marche, l.AvtSource ?? l.LigId);
                    var ecart = l.Ht - precedents.GetValueOrDefault(cle);
                    precedents[cle] = l.Ht;
                    if (ecart == 0) continue;
                    var commande = CommandeDe(l);
                    var oe = commande is null ? null : Reprises(commande).OrderByDescending(x => x.Part).Select(x => (long?)x.Oe).FirstOrDefault();
                    foreach (var (feuille, pv) in Ventiler(l, ecart))
                        Ajouter(Indicateur.Production, Composante.Vente, p.Date, p, feuille, feuille.NatId, 0, 0, pv, Regles.ProductionLigne, oe ?? p.Ordre);
                }
            }
        }

        // ------------------------------------------------------------- engagé

        private bool EntreeDeStock(LigneSql l) => l.ArtId is { } a && ArticlesStock.Contains(a);

        public void Engage()
        {
            foreach (var (p, l) in VenduesDuChantier(RolesRentabilite.CommandeAchat, RolesRentabilite.CommandeSt, RolesRentabilite.ReservationStock))
            {
                if (p.Role == RolesRentabilite.CommandeAchat && EntreeDeStock(l)) continue;
                var (composante, regle) = p.Role switch
                {
                    RolesRentabilite.CommandeSt => (Composante.SousTraitance, Regles.CommandeSt),
                    RolesRentabilite.ReservationStock => (Composante.Stock, Regles.Reservation),
                    _ => (Composante.Achat, Regles.CommandeAchat),
                };
                var coef = Coef(l.NatId, p.Date);
                var unitaire = l.Qte != 0 ? l.Ht / l.Qte : (decimal?)null;
                Ajouter(Indicateur.Engage, composante, p.Date, p, l, l.NatId, l.Ht, l.Ht * coef, 0, regle, p.Ordre, qte: l.Qte, unite: l.Unite);
                // Consommations datées : (date, montant, pièce, ligne) ; montant négatif = réengagé (retour).
                var evenements = new List<(DateOnly Date, decimal Montant, PieceSql P, LigneSql L)>();
                foreach (var k in liensSource[l.LigId])
                {
                    var x = Lignes[k.Cible];
                    var px = Pieces[x.EntId];
                    if (px.Annule) continue;
                    var valeur = unitaire is { } u ? k.Qte * u : x.Ht;
                    switch (px.Role)
                    {
                        case RolesRentabilite.ReceptionAchat:
                            evenements.Add((DatePiece(px), valeur, px, x));
                            foreach (var r in liensSource[x.LigId].Where(r => Pieces[Lignes[r.Cible].EntId] is { Role: RolesRentabilite.RetourAchat, Annule: false }))
                                evenements.Add((DatePiece(Pieces[Lignes[r.Cible].EntId]), -(unitaire is { } u2 ? r.Qte * u2 : Lignes[r.Cible].Ht), Pieces[Lignes[r.Cible].EntId], Lignes[r.Cible]));
                            break;
                        // Facture liée à la commande et à une réception (remontée à l'origine) : déjà consommée par la réception.
                        case RolesRentabilite.FactureAchat when ValeurRecue(x) is null:
                        case RolesRentabilite.MouvementStock:
                            evenements.Add((DatePiece(px), valeur, px, x));
                            break;
                    }
                }
                if (p.Role == RolesRentabilite.CommandeSt)
                    foreach (var x in Lignes.Values.Where(x => (x.AvtSource == l.LigId || liensSource[l.LigId].Any(k => k.Cible == x.LigId))
                                                               && Pieces[x.EntId] is { Role: RolesRentabilite.FactureSt or RolesRentabilite.AvoirSt, Annule: false }))
                        evenements.Add((DatePiece(Pieces[x.EntId]), Signe(Pieces[x.EntId]) * x.Ht, Pieces[x.EntId], x));
                DateOnly? solde = Soldes.TryGetValue(l.LigId, out var ds) ? ds : l.Solde ? p.Date : null;
                var reste = l.Ht;
                var soldee = false;
                foreach (var e in evenements.OrderBy(e => e.Date).ThenBy(e => e.L.LigId))
                {
                    if (solde is { } s1 && !soldee && s1 < e.Date) { Solder(s1); }
                    if (soldee) continue;
                    var montant = e.Montant > 0 ? Math.Min(e.Montant, Math.Max(0, reste)) : Math.Max(e.Montant, reste - l.Ht);
                    if (montant == 0) continue;
                    reste -= montant;
                    Ajouter(Indicateur.Engage, composante, e.Date, e.P, e.L, l.NatId, -montant, -montant * coef, 0, montant > 0 ? Regles.Consommation : Regles.Reengagement,
                        p.Ordre);
                }
                if (solde is { } s2 && !soldee) Solder(s2);

                void Solder(DateOnly date)
                {
                    soldee = true;
                    if (reste <= 0) return;
                    Ajouter(Indicateur.Engage, composante, date, p, l, l.NatId, -reste, -reste * coef, 0, Regles.Solde, p.Ordre);
                    reste = 0;
                }
            }
        }

        // ------------------------------------------------------------- déboursé des pièces

        public void DebourseAchats()
        {
            foreach (var (p, l) in VenduesDuChantier(RolesRentabilite.ReceptionAchat, RolesRentabilite.RetourAchat))
            {
                if (EntreeDeStock(l)) continue;
                var s = p.Role == RolesRentabilite.RetourAchat ? -1 : 1;
                var d = DatePiece(p);
                Ajouter(Indicateur.Debourse, Composante.Achat, d, p, l, l.NatId, s * l.Ht, s * l.Ht * Coef(l.NatId, d), 0,
                    s > 0 ? Regles.Reception : Regles.Retour, p.Ordre, qte: s * l.Qte, unite: l.Unite);
            }
            string[] factures = [RolesRentabilite.FactureAchat, RolesRentabilite.AvoirAchat, RolesRentabilite.FactureSt, RolesRentabilite.AvoirSt];
            foreach (var (p, l) in VenduesDuChantier(factures))
            {
                if (EntreeDeStock(l)) continue;
                var st = p.Role is RolesRentabilite.FactureSt or RolesRentabilite.AvoirSt;
                var d = DatePiece(p);
                var s = Signe(p);
                var recu = ValeurRecue(l);
                var montant = recu is { } v ? s * (l.Ht - v) : s * l.Ht;
                var regle = st ? Regles.FactureSt : recu is null ? Regles.FactureAchat : Regles.EcartPrix;
                Ajouter(Indicateur.Debourse, st ? Composante.SousTraitance : Composante.Achat, d, p, l, l.NatId, montant, montant * Coef(l.NatId, d), 0, regle, p.Ordre,
                    qte: recu is null ? s * l.Qte : null, unite: l.Unite);
            }
            // Pied des pièces d'achat et de sous-traitance : « Non ventilé » (frais généraux), au prorata du chantier (V25).
            foreach (var p in Pieces.Values.Where(p => factures.Contains(p.Role)))
            {
                var st = p.Role is RolesRentabilite.FactureSt or RolesRentabilite.AvoirSt;
                var d = DatePiece(p);
                foreach (var x in pieds[p.EntId])
                {
                    var m = Signe(p) * x.Ht * parts[p.EntId];
                    Ajouter(Indicateur.Debourse, st ? Composante.SousTraitance : Composante.Achat, d, p, x, null, m, m * Coef(null, d), 0, Regles.PiedAchat, p.Ordre);
                }
            }
        }

        /// <summary>Valeur des réceptions facturées par une ligne de facture d'achat (au prix de la réception), null sans réception liée.</summary>
        private decimal? ValeurRecue(LigneSql facture)
        {
            var liens = liensCible[facture.LigId].Where(k => Pieces[Lignes[k.Source].EntId] is { Role: RolesRentabilite.ReceptionAchat, Annule: false }).ToList();
            if (liens.Count == 0) return null;
            return liens.Sum(k => Lignes[k.Source] is var r && r.Qte != 0 ? k.Qte / r.Qte * r.Ht : r.Ht);
        }

        // Montants d'une pièce pour le rapprochement.
        public decimal Part(long ent) => parts.GetValueOrDefault(ent);
        public decimal TotalPied(long ent) => pieds.GetValueOrDefault(ent, []).Sum(x => x.Ht);
        public decimal Recu(long ent) =>
            vendues.GetValueOrDefault(ent, []).Where(l => ChantierDe(l, Pieces[ent]) == chantier).Sum(l => ValeurRecue(l) ?? 0);

        // ------------------------------------------------------------- pointages, stock, matériel, planning

        public void Pointages(List<PointageSql> pointages, Dictionary<long, long?> oes)
        {
            foreach (var x in pointages)
            {
                var heures = x.Minutes / 60m;
                // Intérimaire (R10) : heures sans valeur si l'option du Pointage n'est pas cochée (coût par les factures de l'agence).
                var (pa, regle) = x.Interim && !InterimValorises ? (0m, Regles.PointageInterim)
                    : x.Cout is { } c ? (c, Regles.Pointage)
                    : x.Interim && x.TauxMission is { } tm ? (R6(heures * tm), Regles.PointageMission)
                    : x.SrvId is { } s && TauxService.TryGetValue(s, out var t) ? (heures * t, Regles.PointageTauxService)
                    : (0m, Regles.PointageNonValorise);
                var ordre = x.OrdreId is { } o ? oes.GetValueOrDefault(o) : null;
                Ajouter(Indicateur.Debourse, Composante.Mo, x.Date, null, null, x.NatureId, pa, pa * Coef(x.NatureId, x.Date), 0, regle, ordre, x.Salarie, heures, "h",
                    heures, SourceFait.Pointage, x.PoiId);
            }
        }

        /// <summary>
        /// Heures pointées du matériel (V46) : déboursé du chantier pointé au coût horaire effectif ; matériel loué à la date :
        /// heures sans valeur (coût par la commande de location) ; sans coût : signalé. Heures en quantité (h), jamais en heures de MO.
        /// </summary>
        public void PointagesMateriel(List<PointageMaterielSql> pointages, Dictionary<long, long?> oes)
        {
            foreach (var x in pointages)
            {
                var heures = x.Minutes / 60m;
                var m = Materiels.GetValueOrDefault(x.MatId);
                var (pa, regle) = m is not null && m.Loue(x.Date) ? (0m, Regles.MaterielLoue)
                    : m?.Cout is { } cout ? (R6(heures * cout), Regles.PointageMateriel)
                    : (0m, Regles.MaterielSansCout);
                var ordre = x.TacId is { } t ? oes.GetValueOrDefault(t) : null;
                Ajouter(Indicateur.Debourse, Composante.Materiel, x.Date, null, null, NatureMateriel, pa, pa * Coef(NatureMateriel, x.Date), 0, regle, ordre,
                    m?.Libelle, heures, "h", null, SourceFait.PointageMateriel, x.PmaId);
            }
        }

        /// <summary>Produit interne du chantier de suivi d'un matériel : PV seul, déboursé nul (marge : <c>Marges.Chantier</c>).</summary>
        public void ProduitInterne(List<PointageMaterielSql> pointages)
        {
            foreach (var x in pointages)
            {
                var m = Materiels.GetValueOrDefault(x.MatId);
                var pv = MontantProduitInterne(x.Minutes, m?.Cout, m is not null && m.Loue(x.Date));
                Ajouter(Indicateur.Debourse, Composante.ProduitInterne, x.Date, null, null, null, 0, 0, pv, Regles.ProduitInterne, null,
                    m?.Libelle, x.Minutes / 60m, "h", null, SourceFait.PointageMateriel, x.PmaId);
            }
        }

        public void Mouvements(List<MouvementSql> mouvements)
        {
            foreach (var m in mouvements)
            {
                if (!Pieces.TryGetValue(m.EntId, out var p) || p.Role != RolesRentabilite.MouvementStock) continue;
                // Mouvement au lieu de stock : une sortie (quantité négative au dépôt) est un coût du chantier, un retour au dépôt un coût négatif.
                var qte = -m.Qte;
                var pa = m.Prix is { } prix ? qte * prix : 0;
                var regle = m.Prix is null ? Regles.StockNonValorise : qte >= 0 ? Regles.SortieStock : Regles.RetourStock;
                var ligne = m.LigId is { } li && Lignes.TryGetValue(li, out var l) ? l : null;
                Faits.Add(new Fait(chantier, p.Ordre, p.Marche, Indicateur.Debourse, Composante.Stock, m.Date, m.NatId, qte, m.Unite, pa, pa * Coef(m.NatId, m.Date), 0,
                    null, SourceFait.Mouvement, p.Type, p.EntId, ligne?.LigId, m.MvtId, regle, m.Libelle));
            }
        }

        /// <summary>Acomptes en trésorerie : payé et utilisé (TTC, en PV), sans ordre ni nature.</summary>
        public void Acomptes(List<AcompteSql> acomptes)
        {
            foreach (var x in acomptes.Where(x => x.Montant != 0))
                Faits.Add(new Fait(chantier, null, x.MarId, x.Indicateur, Composante.Vente, x.Date, null, null, null, 0, 0, x.Montant, null, x.Source, x.Type,
                    x.EntId, null, x.SourceId, x.Regle, x.Libelle));
        }

        public void Carburant(List<CarburantSql> pleins)
        {
            foreach (var x in pleins.Where(x => x.Cout is not null))
                Ajouter(Indicateur.Debourse, Composante.Materiel, x.Date, null, null, null, x.Cout!.Value, x.Cout.Value * Coef(null, x.Date), 0, Regles.Carburant, null,
                    x.Libelle, source: SourceFait.Mouvement, sourceId: x.MevId);
        }

        /// <summary>
        /// Main-d'œuvre planifiée (V35, V36) : tâche affectée à des salariés, part de chaque affectation après la dernière saisie
        /// du salarié, à son taux ; tâche théorique sans affectation, part après la dernière saisie du chantier, au taux du
        /// service. Part = jours calendaires restants / jours de la tâche. Matériel hors location : heures après son dernier
        /// pointage, au coût horaire effectif (lot 5). Intérim, matériel loué et sous-traitants : par leurs commandes.
        /// </summary>
        public void Planning(List<TacheSql> taches, Dictionary<int, decimal?> taux, Dictionary<int, DateOnly?> dernieres, DateOnly? derniereChantier,
            Dictionary<long, long?> oes, Dictionary<int, int> naturesService)
        {
            static decimal Reste(TacheSql t, DateOnly? derniere)
            {
                var debut = DateOnly.FromDateTime(t.Debut);
                var fin = DateOnly.FromDateTime(t.Fin);
                var jours = fin.DayNumber - debut.DayNumber + 1;
                var depart = derniere is { } d && d >= debut ? d.AddDays(1) : debut;
                if (depart > fin) return 0;
                return (decimal)(fin.DayNumber - depart.DayNumber + 1) / Math.Max(1, jours);
            }
            foreach (var g in taches.GroupBy(t => t.TacId))
            {
                var t = g.First();
                var ordre = t.OrigineType == "ordre" && long.TryParse(t.OrigineId, out var o) ? oes.GetValueOrDefault(o) : null;
                int? nature = t.SrvId is { } s && naturesService.TryGetValue(s, out var n) ? n : null;
                var affectations = g.Where(x => x.ResType is not null).ToList();
                if (affectations.Count == 0)
                {
                    var heures = R6(t.Heures / 60m * Reste(t, derniereChantier));
                    var tauxService = t.SrvId is { } sv && TauxService.TryGetValue(sv, out var ts) ? ts : (decimal?)null;
                    var pa = heures * (tauxService ?? 0);
                    Ajouter(Indicateur.Engage, Composante.Mo, aujourdhui, null, null, nature, pa, pa * Coef(nature, aujourdhui), 0,
                        tauxService is null ? Regles.TacheSansTaux : Regles.TacheTheorique, ordre, t.Libelle, heures, "h", heures, SourceFait.Tache, t.TacId);
                    continue;
                }
                // Matériel planifié hors location (V35) : heures après son dernier pointage × quantité, au coût horaire effectif.
                foreach (var a in affectations.Where(a => a.ResType == "MATERIEL" && int.TryParse(a.ResId, out _)))
                {
                    if (!Materiels.TryGetValue(int.Parse(a.ResId!), out var m) || m.Loue(aujourdhui)) continue;
                    var heures = R6((a.AffHeures ?? 0) / 60m * (a.AffQuantite ?? 1) * Reste(t, m.Derniere));
                    var pa = R6(heures * (m.Cout ?? 0));
                    Ajouter(Indicateur.Engage, Composante.Materiel, aujourdhui, null, null, NatureMateriel, pa, pa * Coef(NatureMateriel, aujourdhui), 0,
                        m.Cout is null ? Regles.TacheSansTaux : Regles.TacheMateriel, ordre, $"{t.Libelle} · {m.Libelle}", heures, "h", null, SourceFait.Tache, t.TacId);
                }
                foreach (var a in affectations.Where(a => a.ResType == "SALARIE" && int.TryParse(a.ResId, out _)))
                {
                    var sal = int.Parse(a.ResId!);
                    if (!taux.TryGetValue(sal, out var tx)) continue;
                    var heures = R6((a.AffHeures ?? 0) / 60m * Reste(t, dernieres.GetValueOrDefault(sal)));
                    var pa = heures * (tx ?? 0);
                    Ajouter(Indicateur.Engage, Composante.Mo, aujourdhui, null, null, nature, pa, pa * Coef(nature, aujourdhui), 0,
                        tx is null ? Regles.TacheSansTaux : Regles.TacheAffectee, ordre, t.Libelle, heures, "h", heures, SourceFait.Tache, t.TacId);
                }
            }
        }

        public void ChargerLiens()
        {
            liensSource = Liens.ToLookup(k => k.Source);
            liensCible = Liens.ToLookup(k => k.Cible);
        }
    }

    // ================================================================= axes, pièces, portée

    public override Task<List<int>> ChantiersOuvertsAsync(RentabiliteDbContext db, CancellationToken ct) =>
        db.Database.SqlQuery<int>($"SELECT cha_id AS \"Value\" FROM chantier WHERE cha_statut = 'OUVERT' ORDER BY cha_id").ToListAsync(ct);

    /// <summary>Chantiers de la Liste : exclus = internes, dépôts et affaires de gestion (G : stock, matériel, dotations, SAV, frais) ; clos = non ouverts.</summary>
    public override Task<List<ChantierListe>> ChantiersListeAsync(RentabiliteDbContext db, CancellationToken ct) =>
        db.Database.SqlQuery<ChantierListe>($"""
            SELECT c.cha_id AS id, c.cha_code AS code, c.cha_libelle AS libelle, a.aff_id AS affaire_id, a.aff_code AS affaire_code, a.aff_libelle AS affaire,
                   i.ind_id::bigint AS charge_id, nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '') AS charge, c.cha_statut AS statut,
                   (coalesce(c.cha_interne, FALSE) OR coalesce(c.cha_depot, FALSE) OR coalesce(a.aff_nature = 'G', FALSE)) AS exclu,
                   (c.cha_statut <> 'OUVERT') AS clos
            FROM chantier c
            LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
            LEFT JOIN individu i ON i.ind_id = coalesce(c.cha_charge_ind_id, a.aff_responsable_ind_id)
            ORDER BY c.cha_code
            """).ToListAsync(ct);

    public override Task<List<OrdreChantier>> OrdresChantiersAsync(RentabiliteDbContext db, int[] chantiers, CancellationToken ct) =>
        db.Database.SqlQuery<OrdreChantier>($"""
            SELECT d.ent_chantier_id AS cha_id, d.ent_id AS id, d.ent_numero AS numero, d.ent_objet AS libelle, s.std_code AS statut
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code AND x.rrt_role = {RolesRentabilite.OrdreExecution}
            JOIN v_document_valable v ON v.ent_id = d.ent_id AND NOT v.annule
            JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE d.ent_chantier_id = ANY({chantiers})
            ORDER BY d.ent_date, d.ent_id
            """).ToListAsync(ct);

    public override async Task<ChantierRentabilite?> ChantierAsync(RentabiliteDbContext db, int chantier, CancellationToken ct) =>
        (await db.Database.SqlQuery<ChantierRentabilite>($"""
            SELECT c.cha_id AS id, c.cha_code AS code, c.cha_libelle AS libelle, a.aff_id AS affaire_id,
                   nullif(concat_ws(' ', a.aff_code, a.aff_libelle), '') AS affaire,
                   (SELECT nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), '') FROM individu i WHERE i.ind_id = coalesce(c.cha_charge_ind_id, a.aff_responsable_ind_id)) AS charge,
                   c.cha_statut AS statut
            FROM chantier c LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id WHERE c.cha_id = {chantier}
            """).ToListAsync(ct)).FirstOrDefault();

    public override Task<List<OrdreRentabilite>> OrdresAsync(RentabiliteDbContext db, int chantier, CancellationToken ct) =>
        db.Database.SqlQuery<OrdreRentabilite>($"""
            SELECT d.ent_id AS id, d.ent_numero AS numero, d.ent_objet AS libelle, s.std_code AS statut
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code AND x.rrt_role = {RolesRentabilite.OrdreExecution}
            JOIN v_document_valable v ON v.ent_id = d.ent_id AND NOT v.annule
            JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE d.ent_chantier_id = {chantier}
            ORDER BY d.ent_date, d.ent_id
            """).ToListAsync(ct);

    public override Task<List<NatureRentabilite>> NaturesAsync(RentabiliteDbContext db, CancellationToken ct) =>
        db.Database.SqlQuery<NatureRentabilite>($"""
            SELECT n.nat_id AS id, n.nat_code AS code, n.nat_libelle AS libelle, n.nat_rgn_code AS groupe, r.rgn_libelle AS groupe_libelle,
                   coalesce(r.rgn_ordre, 999) AS groupe_ordre
            FROM nature_element n LEFT JOIN regroupement_nature r ON r.rgn_code = n.nat_rgn_code
            ORDER BY coalesce(r.rgn_ordre, 999), n.nat_code
            """).ToListAsync(ct);

    public override async Task<Dictionary<long, PieceRentabilite>> PiecesAsync(RentabiliteDbContext db, long[] ids, CancellationToken ct) =>
        ids.Length == 0 ? [] : (await db.Database.SqlQuery<PieceRentabilite>($"""
            SELECT d.ent_id, t.tyd_code AS type, t.tyd_libelle AS type_libelle, d.ent_numero AS numero, d.ent_indice AS indice, d.ent_date AS date,
                   s.std_code AS statut, coalesce(v.annule, s.std_code = {StatutsDocument.Annule}) AS annulee, p.per_raison_sociale AS tiers, d.ent_tiers_id AS tiers_id
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN statut_document s ON s.std_id = d.ent_std_id
            LEFT JOIN v_document_valable v ON v.ent_id = d.ent_id
            LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
            WHERE d.ent_id = ANY({ids})
            """).ToListAsync(ct)).ToDictionary(p => p.EntId);

    private sealed record TypeRole(string Code, string Famille);

    public override async Task<Dictionary<int, string>> TiersAsync(RentabiliteDbContext db, int[] ids, CancellationToken ct) =>
        ids.Length == 0 ? [] : (await db.Database.SqlQuery<TiersNom>($"""
            SELECT per_id AS id, coalesce(per_raison_sociale, '') AS nom FROM personne WHERE per_id = ANY({ids})
            """).ToListAsync(ct)).ToDictionary(t => t.Id, t => t.Nom);

    private sealed record TiersNom(int Id, string Nom);

    /// <summary>Saisies prévisionnelles (lot 6) : action du nœud rentabilite/previsions (héritée de rentabilite à défaut).</summary>
    public override async Task AutoriserPrevisionAsync(IServiceProvider services, Utilisateur u, string action, CancellationToken ct)
    {
        if (services.GetService<IDroits>() is { } droits && !await droits.AutoriseAsync(u, NoeudPrevisions, action, ct))
            throw ExceptionMetier.AccesRefuse(action);
    }

    /// <summary>Prévisionnel de facturation (lot 7) : action MODIFIER du nœud rentabilite/facturation (héritée de rentabilite à défaut).</summary>
    public override async Task AutoriserFacturationAsync(IServiceProvider services, Utilisateur u, CancellationToken ct)
    {
        if (services.GetService<IDroits>() is { } droits && !await droits.AutoriseAsync(u, NoeudFacturation, ActionsDroits.Modifier, ct))
            throw ExceptionMetier.AccesRefuse(ActionsDroits.Modifier);
    }

    /// <summary>
    /// Portée (V65) : TOUT = tous les chantiers ; SOI (et EQUIPE, SERVICE) = chantiers dont l'individu de l'utilisateur est
    /// le chargé d'affaires, le conducteur ou le responsable de l'affaire ; coûts (PA / PR) de la page des faits : nœud
    /// rentabilite/couts ; types de pièces dont le nœud documents/… n'est pas consultable : détail masqué.
    /// </summary>
    public override async Task<PorteeRentabilite> PorteeAsync(IServiceProvider services, Utilisateur u, CancellationToken ct)
    {
        var droits = services.GetService<IDroits>();
        var db = services.GetRequiredService<RentabiliteDbContext>();
        var portee = droits is null ? "TOUT" : await droits.PorteeAsync(u, Noeud, ActionsDroits.Consulter, ct);
        var voirCouts = droits is null || await droits.AutoriseAsync(u, NoeudCouts, ActionsDroits.Consulter, ct);
        var masques = new HashSet<string>();
        if (droits is not null)
            foreach (var t in await db.Database.SqlQuery<TypeRole>($"""
                SELECT t.tyd_code AS code, t.tyd_famille AS famille FROM type_document t JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code
                """).ToListAsync(ct))
                if (!await droits.AutoriseAsync(u, FamillesDocument.NoeudDroits(t.Famille, t.Code), ActionsDroits.Consulter, ct)) masques.Add(t.Code);
        if (portee == "TOUT") return new PorteeRentabilite(true, new HashSet<int>(), voirCouts, masques);
        if (portee is null) return new PorteeRentabilite(false, new HashSet<int>(), voirCouts, masques);
        var chantiers = await db.Database.SqlQuery<int>($"""
            SELECT c.cha_id AS "Value" FROM chantier c LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
            WHERE EXISTS (SELECT 1 FROM individu i WHERE i.ind_utilisateur = {u.Code}
                          AND i.ind_id IN (c.cha_charge_ind_id, c.cha_conducteur_ind_id, a.aff_responsable_ind_id))
            """).ToListAsync(ct);
        return new PorteeRentabilite(false, chantiers.ToHashSet(), voirCouts, masques);
    }

    // ================================================================= rapprochement

    private sealed record PieceRappro(long EntId, string Role, string? NatureAvoir, decimal TotalHt, decimal Part, decimal Pied, decimal Recu);

    /// <summary>
    /// Rapprochement (§ 8) : total HT de chaque pièce (part du chantier) face à la somme de ses faits ; factures d'achat :
    /// total moins la valeur des réceptions facturées (comptées à la réception) ; réceptions : hors pied ; pointages :
    /// coûts valorisés ; mouvements de stock : valeur des mouvements.
    /// </summary>
    public override async Task<List<LigneRapprochement>> RapprochementAsync(RentabiliteDbContext db, int chantier, CancellationToken ct)
    {
        // Les faits et les pièces se relisent par un calcul complet (mêmes pièces, mêmes parts) : le contrôle porte sur les
        // lignes (faits) face aux totaux d'entête (pièces), qui viennent de deux chemins différents.
        var c = new Calcul(chantier, DateOnly.FromDateTime(DateTime.Today));
        var lignes = new List<LigneRapprochement>();
        var pieces = await db.Database.SqlQuery<PieceSql>($"""
            SELECT d.ent_id, t.tyd_code AS type, x.rrt_role AS role, d.ent_date AS date, d.ent_date_externe AS date_externe, d.ent_chantier_id AS chantier_entete,
                   d.ent_marche_id AS marche, d.ent_nature_avoir AS nature_avoir, v.annule, coalesce(d.ent_total_ht, 0) AS total_ht,
                   NULL::bigint AS ordre, FALSE AS sans_commande, d.ent_numero AS numero
            FROM document_chantier dc
            JOIN document d ON d.ent_id = dc.dch_ent_id
            JOIN v_document_valable v ON v.ent_id = d.ent_id
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code
            WHERE dc.dch_cha_id = {chantier}
            """).ToListAsync(ct);
        var retenues = pieces.Where(p => !(p.Annule && RolesCommandes.Contains(p.Role))).ToDictionary(p => p.EntId);
        var ents = retenues.Keys.ToArray();
        List<LigneSql> lignesSql = ents.Length == 0 ? [] : await db.Database.SqlQuery<LigneSql>($"""
            SELECT l.lig_id, l.lig_ent_id AS ent_id, l.lig_parent_id AS parent_id, l.lig_ordre AS ordre, l.lig_tyl_id AS tyl,
                   coalesce(l.lig_type_prix, 'V') AS type_prix, coalesce(l.lig_montant_ht, 0) AS ht, coalesce(l.lig_montant_pa, 0) AS pa,
                   coalesce(l.lig_montant_pr, 0) AS pr, coalesce(l.lig_qte_totale, l.lig_qte, 0) AS qte, l.lig_unt_code AS unite, l.lig_nat_id AS nat_id,
                   l.lig_cha_id AS cha_id, l.lig_art_id AS art_id, NULL::text AS libelle, l.lig_avt_source_lig_id AS avt_source, FALSE AS solde,
                   (lower(coalesce(l.lig_unt_code, '')) IN ('h', 'heure', 'heures')
                    AND EXISTS (SELECT 1 FROM nature_element n WHERE n.nat_id = l.lig_nat_id AND n.nat_rgn_code = 'MO')) AS heures
            FROM document_ligne l WHERE l.lig_ent_id = ANY({ents}) AND l.lig_tyl_id IN (1, 2, 3, 8, 11)
            """).ToListAsync(ct);
        c.Charger(retenues, lignesSql);
        var ids = lignesSql.Select(l => l.LigId).ToArray();
        c.Liens = ids.Length == 0 ? [] : (await db.Database.SqlQuery<LienSql>($"""
            SELECT k.lil_source_lig_id AS source, k.lil_cible_lig_id AS cible, coalesce(k.lil_qte, 0) AS qte
            FROM document_ligne_lien k WHERE k.lil_cible_lig_id = ANY({ids})
            """).ToListAsync(ct)).Where(k => c.Lignes.ContainsKey(k.Source) && c.Lignes.ContainsKey(k.Cible)).ToList();
        c.ChargerLiens();
        foreach (var p in retenues.Values.OrderBy(p => p.Date).ThenBy(p => p.EntId))
        {
            var part = c.Part(p.EntId);
            var s = Signe(p);
            switch (p.Role)
            {
                case RolesRentabilite.CommandeVente:
                    lignes.Add(new(SourceFait.Document, p.EntId, Indicateur.Budget, "PV", p.TotalHt * part, "Total HT de la commande (part du chantier)"));
                    break;
                case RolesRentabilite.FactureVente or RolesRentabilite.FactureAcompte or RolesRentabilite.AvoirVente:
                    lignes.Add(new(SourceFait.Document, p.EntId, Indicateur.Facture, "PV", s * p.TotalHt * part, "Total HT de la pièce (part du chantier)"));
                    break;
                case RolesRentabilite.ReceptionAchat or RolesRentabilite.RetourAchat:
                    var r = p.Role == RolesRentabilite.RetourAchat ? -1 : 1;
                    lignes.Add(new(SourceFait.Document, p.EntId, Indicateur.Debourse, "PA", r * (p.TotalHt - c.TotalPied(p.EntId)) * part,
                        "Total HT hors pied (part du chantier)"));
                    break;
                case RolesRentabilite.FactureAchat or RolesRentabilite.AvoirAchat or RolesRentabilite.FactureSt or RolesRentabilite.AvoirSt:
                    lignes.Add(new(SourceFait.Document, p.EntId, Indicateur.Debourse, "PA", s * (p.TotalHt * part - c.Recu(p.EntId)),
                        "Total HT (part du chantier) moins les réceptions facturées"));
                    break;
            }
        }
        var pointages = (await db.Database.SqlQuery<decimal?>($"SELECT sum(cout) AS \"Value\" FROM v_pointages_retenus WHERE chantier_id = {chantier}").ToListAsync(ct))
            .FirstOrDefault() ?? 0;
        lignes.Add(new(SourceFait.Pointage, null, Indicateur.Debourse, "PA", pointages, "Coût des pointages retenus valorisés"));
        return lignes;
    }
}
