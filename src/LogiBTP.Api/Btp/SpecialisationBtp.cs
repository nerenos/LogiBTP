using LogiBTP.Calcul;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Document BTP complet : document générique + métrés et variables (module Métré).</summary>
public sealed class DocumentCompletBtp : DocumentComplet<DocumentBtp, DocumentLigneBtp>
{
    public List<Metre> Metres { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
    /// <summary>Frais annexes : clés de ventilation saisies et détail calculé (db/167).</summary>
    public List<VentilationFrais> Ventilations { get; set; } = [];
    public List<VentilationFraisLigne> VentilationsLignes { get; set; } = [];
}

/// <summary>
/// Spécialisation BTP des services du module Document : moteur MoteurDevisBtp, mode de calcul des ouvrages,
/// persistance des métrés (scripts) et des variables (correspondances « metres », « variables »),
/// lignes d'écart d'arrondi calculées.
/// </summary>
public sealed class SpecialisationBtp : SpecialisationDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>
{
    /// <summary>Accès aux services de la requête (modules facultatifs consultés à la validation) ; posé par Program.cs.</summary>
    public static IHttpContextAccessor? Http { get; set; }

    public const string ComplementMetres = "metres";
    public const string ComplementVariables = "variables";
    public const string ComplementVentilations = "ventilations";

    public override ComparateurCalcul Comparateur { get; } = new ComparateurBtp();

    /// <summary>Règles du cœur ajoutées au catalogue du module (CONCEPTION-REGLES-DOCUMENTS.md, § 6.2 et § 8).</summary>
    public override IEnumerable<DefinitionRegle> Regles => base.Regles.Concat(
    [
        new("NATURE_OBLIGATOIRE", "Nature obligatoire", "Nature des lignes de prix exigée à la validation (analyses).", "BOOLEEN", true, null, "BLOQUANT"),
        new("POSTES_MARCHE", "Postes du marché", "Retenue de garantie et postes du marché posés au pied des factures du marché.", "BOOLEEN", false),
        new("FRAIS_ANNEXES", "Frais annexes et prorata", "Frais annexes et coefficient de prorata utilisables (ventes).", "BOOLEEN", false),
        new("REMISE_MAX", "Remise maximale (%)", "Remise de ligne ou de pied au-delà de ce % : avertissement (-1 : pas de seuil).", "NOMBRE", -1, null, "AVERTISSEMENT"),
        new("MARGE_MIN", "Marge minimale (%)", "Marge nette sous ce % à la validation d'un devis ou d'une facture directe : avertissement (-1 : pas de seuil).", "NOMBRE", -1, null, "AVERTISSEMENT"),
        new("ENCOURS_CLIENT", "Encours client maximal", "Encours du client au-delà de ce montant : avertissement (-1 : pas de seuil ; la fiche du tiers l'emporte).", "NOMBRE", -1, null, "AVERTISSEMENT"),
        new("PRIX_ACHAT_ECART", "Écart de prix d'achat (%)", "Prix facturé différent de la commande au-delà de ce % : avertissement (-1 : pas de contrôle).", "NOMBRE", -1, null, "AVERTISSEMENT"),
        new("REFERENCE_MARCHE_PUBLIC", "Référence d'une commande de marché public", "Référence externe exigée sur une commande d'un marché public.", "BOOLEEN", false, null, "BLOQUANT"),
        new("ECART_FACTURE_RECUE", "Écart toléré d'une facture reçue (€)", "Facture de sous-traitance reçue : écart maximal entre le HT saisi et le total ventilé sur les lignes (-1 : pas de contrôle).", "NOMBRE", 1, null, "BLOQUANT"),
    ]);

    // ------------------------------------------------------------------ calcul

    public override EntreeDocument<DocumentBtp, DocumentLigneBtp> CreerEntree(DocumentCompletBtp saisie, List<TauxTva> tauxTva, OptionsCalcul options) => new EntreeCalcul
    {
        Document = saisie.Document, Lignes = saisie.Lignes, TauxTva = tauxTva, Options = options,
        Metres = saisie.Metres, Variables = saisie.Variables, Ventilations = saisie.Ventilations,
    };

    public override ResultatDocument<DocumentBtp, DocumentLigneBtp> Calculer(EntreeDocument<DocumentBtp, DocumentLigneBtp> entree) =>
        MoteurDevisBtp.Calculer(entree as EntreeCalcul ?? new EntreeCalcul
        {
            Document = entree.Document, Lignes = entree.Lignes, TauxTva = entree.TauxTva, Entites = entree.Entites, Options = entree.Options,
        });

    public override DocumentCompletBtp VersComplet(ResultatDocument<DocumentBtp, DocumentLigneBtp> r)
    {
        var c = base.VersComplet(r);
        if (r is ResultatCalcul b)
        {
            c.Metres = b.Metres;
            c.Variables = b.Variables;
            c.Ventilations = b.Ventilations;
            c.VentilationsLignes = b.VentilationsLignes;
        }
        return c;
    }

    /// <summary>
    /// Validation : la ventilation calculée des frais annexes est figée en clés de ligne (montant par unité), pour que
    /// les prix des lignes inchangées restent les mêmes dans un nouvel indice ; les clés orphelines disparaissent.
    /// </summary>
    /// <summary>Total HT attendu après la conversion des ouvrages sans composante (contrôlé après le calcul de la validation).</summary>
    private static readonly AsyncLocal<decimal?> totalAttendu = new();

    /// <summary>Statuts d'une commande client hors de l'encours : facturée, soldée ou hors vigueur.</summary>
    private static readonly string[] StatutsCommandeClose = [StatutsDocumentBtp.Facture, .. SqlBtp.StatutsHorsVigueurOuSolde];

    public override void PreparerValidation(ResultatDocument<DocumentBtp, DocumentLigneBtp> r)
    {
        if (totalAttendu.Value is decimal attendu)
        {
            totalAttendu.Value = null;
            if (attendu != r.Document.EntTotalHt)
            {
                throw ExceptionMetier.Invalide("OUVRAGE_PRESTATION_ECART",
                    $"Ouvrages sans composante passés en prestation : le total HT changerait ({attendu:0.00} → {r.Document.EntTotalHt:0.00}) ; ajoutez des composantes ou transformez-les en éléments");
            }
        }
        if (r is ResultatCalcul b) b.Ventilations = FigerVentilation(b.VentilationsLignes, b.Lignes, b.Document.EntId);
    }

    /// <summary>
    /// Clés de ligne en montant par unité de quantité reproduisant un détail de ventilation (identifiants temporaires
    /// négatifs). Réplique de figerVentilation (client/src/app/frais-annexes.js).
    /// </summary>
    public static List<VentilationFrais> FigerVentilation(IEnumerable<VentilationFraisLigne> detail, IEnumerable<DocumentLigneBtp> lignes, long entId)
    {
        var parId = lignes.ToDictionary(l => l.LigId);
        var res = new List<VentilationFrais>();
        long n = 0;
        foreach (var g in detail.GroupBy(v => (v.VflSourceLigId, v.VflLigId)))
        {
            if (!parId.TryGetValue(g.Key.VflLigId, out var l) || (l.LigQteVendue ?? 0) == 0) continue;
            res.Add(new VentilationFrais
            {
                VfrId = --n, VfrEntId = entId, VfrSourceLigId = g.Key.VflSourceLigId, VfrCible = "LIGNE", VfrLigId = g.Key.VflLigId,
                VfrMode = "M", VfrValeur = ArrondiCalcul.Arr6(g.Sum(v => v.VflMontant) / l.LigQteVendue!.Value),
            });
        }
        return res;
    }

    /// <summary>
    /// Nature obligatoire sur les lignes de prix (éléments, ouvrages et composantes), hors écart d'arrondi : exigée à la
    /// validation. Réplique de controlesValidation (client/src/calcul/controles-btp.js).
    /// </summary>
    public override void ControlerValidation(EntreeDocument<DocumentBtp, DocumentLigneBtp> entree, List<MessageCalcul> erreurs)
    {
        foreach (var l in entree.Lignes.Where(l => TL.EstChiffree(l) && !l.LigIsEcartArrondi && l.LigNatId is null))
            erreurs.Add(new MessageCalcul(l.LigId, "NATURE_OBLIGATOIRE", "Nature obligatoire sur une ligne de prix"));
    }

    /// <summary>
    /// Commande client : un marché est obligatoire pour la valider (créé ou choisi par l'utilisateur), sauf la commande
    /// intermédiaire d'un devis facturé directement (CONCEPTION-ACHATS-MARCHES.md, Q16 et 13.1) ; unités des lignes.
    /// </summary>
    public override async Task ControlerValidationAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> erreurs, CancellationToken ct)
    {
        // Unités des lignes transformées et des articles gérés en stock (garde-fou, lot 0 du module Rentabilité).
        await UnitesLignesBtp.ControlerAsync(db, document, type, erreurs, ct);
        if (type.TydFamille == "E")
        {
            await ControlerOrdreAsync(db, document, erreurs, ct);
            return;
        }
        if (type.TydCode == TypesDocument.VCommande && !document.Document.EntIntermediaire && document.Document.EntMarcheId is null)
        {
            erreurs.Add(new MessageCalcul(null, "MARCHE_OBLIGATOIRE", "Marché à créer ou à choisir avant de valider la commande"));
        }
        // Commande de sous-traitance : marché de sous-traitance obligatoire (ST2) ; sens et sous-traitant contrôlés ensuite.
        if (type.TydCode == TypesDocument.TCommande && document.Document.EntMarcheId is null)
        {
            erreurs.Add(new MessageCalcul(null, "MARCHE_ST_OBLIGATOIRE", "Marché de sous-traitance à créer ou à choisir avant de valider la commande"));
        }
        // Commande fournisseur : adresse de livraison obligatoire (chantier rattaché : reprise à la validation).
        if (type.TydCode == TypesDocument.ACommande && document.Document.EntAdresseLivraison is null && document.Document.EntChantierId is null)
        {
            erreurs.Add(new MessageCalcul(null, "ADRESSE_LIVRAISON", "Commande fournisseur : adresse de livraison à choisir (chantier, dépôt, retrait au comptoir ou saisie libre)"));
        }
        // Stock : date du mouvement, lieux des entrées, sorties et transferts (module Stock, S9, S10).
        MouvementsStockBtp.Controler(document.Document, type, erreurs);
        await MouvementsStockBtp.ControlerLotsAsync(db, document.Lignes, type, erreurs, ct);
        await ControlerAvancementNumerote(db, document, type, erreurs, ct);
        await ControlerProductionMois(db, document, type, erreurs, ct);
    }

    /// <summary>
    /// Situation de production (R7) : une par marché et par mois ; une autre situation de production valable du même
    /// marché datée du même mois (hors indices du même document) refuse la validation.
    /// </summary>
    private static async Task ControlerProductionMois(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> erreurs, CancellationToken ct)
    {
        var d = document.Document;
        if (type.TydAvancement != TypesAvancement.Production || d.EntMarcheId is not int marche) return;
        var debut = new DateOnly(d.EntDate.Year, d.EntDate.Month, 1);
        var autre = await db.Database.SqlQuery<string?>($"""
            SELECT x.ent_numero AS "Value" FROM document x
            WHERE x.ent_marche_id = {marche} AND x.ent_tyd_id = {type.TydId} AND x.ent_id <> {d.EntId}
              AND x.ent_groupe_id IS DISTINCT FROM (SELECT g.ent_groupe_id FROM document g WHERE g.ent_id = {d.EntId}) AND f_document_valable(x.ent_id, FALSE)
              AND x.ent_date >= {debut} AND x.ent_date < {debut.AddMonths(1)}
            LIMIT 1
            """).ToListAsync(ct);
        if (autre.Count > 0)
        {
            erreurs.Add(new MessageCalcul(null, "PRODUCTION_MOIS",
                $"Une situation de production du marché est déjà validée pour {debut:MM/yyyy} ({autre[0]}) : révisez-la plutôt que d'en valider une autre"));
        }
    }

    /// <summary>Quantités des liens de transformation converties dans l'unité de la ligne d'origine (UnitesLignesBtp).</summary>
    public override Task ApresRecalculLiensAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, long entId, CancellationToken ct) =>
        UnitesLignesBtp.ConvertirLiensAsync(db, entId, ct);

    /// <summary>
    /// Facture d'avancement d'un marché : refusée tant qu'une facture d'avancement créée avant elle dans le même marché
    /// n'a pas son numéro comptable, quel que soit son statut (chronologie sans trou) ; les factures à 0 sont ignorées.
    /// Pas de forçage : l'utilisateur numérote d'abord l'autre facture (changement de numéro).
    /// </summary>
    private static async Task ControlerAvancementNumerote(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> erreurs, CancellationToken ct)
    {
        var d = document.Document;
        // Facture de sous-traitance reçue (ST8, ST10) : le total ventilé sur les lignes doit retrouver le HT de la facture.
        if (type.TydCode == TypesDocument.TFactureAvt && d.EntStSaisie == "RECUE")
        {
            var tolerance = decimal.TryParse(await Regle(db, "ECART_FACTURE_RECUE", type.TydId, ct), System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var t) ? t : 1m;
            if (d.EntStRecuHt is null) erreurs.Add(new MessageCalcul(null, "ST_FACTURE_RECUE", "Facture reçue : montant HT de la facture du sous-traitant à saisir"));
            else if (tolerance >= 0 && Math.Abs(document.Document.EntTotalHt - d.EntStRecuHt.Value) > tolerance)
            {
                erreurs.Add(new MessageCalcul(null, "ST_ECART_FACTURE",
                    $"Facture reçue : {Euros(d.EntStRecuHt.Value)} HT saisis, {Euros(document.Document.EntTotalHt)} ventilés sur les lignes (« Ventiler au prorata »)"));
            }
        }
        // Pièces exigées du sous-traitant (module Sous-traitance, ST13) : commande et facture de sous-traitance.
        await SpecialisationSousTraitanceBtp.ControlerPiecesAsync(Http?.HttpContext?.RequestServices, type.TydCode, d.EntMarcheId, erreurs, ct);
        if (type.TydCode == TypesDocument.TCommande && d.EntMarcheId is int mst)
        {
            var m = await db.Database.SqlQuery<string>($"SELECT mar_sens || ':' || coalesce(mar_tiers_id::text, '') AS \"Value\" FROM marche WHERE mar_id = {mst}").FirstOrDefaultAsync(ct);
            if (m is null || !m.StartsWith("ST:", StringComparison.Ordinal) || (d.EntTiersId is long t && m != $"ST:{t}"))
            {
                erreurs.Add(new MessageCalcul(null, "MARCHE_ST_SENS", "Le marché de la commande doit être un marché de sous-traitance de ce sous-traitant"));
            }
        }
        if (type.TydAvancement == "F" && d.EntMarcheId is int marche)
        {
            var groupe = d.EntGroupeId ?? -d.EntId;
            var sansNumero = await (from x in db.Documents.AsNoTracking()
                                    join t in db.TypesDocument.AsNoTracking() on x.EntTydId equals t.TydId
                                    where x.EntMarcheId == marche && t.TydAvancement == "F" && x.EntId < d.EntId && x.EntNumero == null
                                        && x.EntTotalHt != 0 && (x.EntGroupeId == null || x.EntGroupeId != groupe)
                                    orderby x.EntId
                                    select new { x.EntId, x.EntDate, x.EntObjet }).ToListAsync(ct);
            foreach (var x in sansNumero)
            {
                erreurs.Add(new MessageCalcul(null, "AVANCEMENT_NON_NUMEROTE",
                    $"La facture d'avancement du {x.EntDate:dd/MM/yyyy}{(string.IsNullOrEmpty(x.EntObjet) ? "" : $" « {x.EntObjet} »")} (document {x.EntId}), créée avant celle-ci dans le marché, n'a pas de numéro : numérotez-la d'abord"));
            }
        }
        await ControlerMarchePublic(db, document, type, erreurs, ct);
    }

    /// <summary>Commande d'un marché public : référence externe (engagement) exigée si la règle REFERENCE_MARCHE_PUBLIC l'active (R12).</summary>
    private static async Task ControlerMarchePublic(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> erreurs, CancellationToken ct)
    {
        var d = document.Document;
        if (type.TydCode == TypesDocument.VCommande && d.EntMarcheId is int marche && string.IsNullOrWhiteSpace(d.EntReferenceExterne)
            && await Regle(db, "REFERENCE_MARCHE_PUBLIC", type.TydId, ct) == "true"
            && await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM marche WHERE mar_id = {marche} AND mar_nature = 'U'").FirstAsync(ct) > 0)
        {
            erreurs.Add(new MessageCalcul(null, "REFERENCE_MARCHE_PUBLIC", "Commande d'un marché public : référence externe (n° d'engagement) à saisir"));
        }
        await ControlerFraisAnnexes(db, document, type, erreurs, ct);
    }

    /// <summary>Valeur d'une règle des documents (texte JSON, null si non paramétrée : défaut du catalogue).</summary>
    private static async Task<string?> Regle(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, string code, int tydId, CancellationToken ct) =>
        (await db.Database.SqlQuery<string?>($"SELECT f_regle_document({code}, {tydId})::text AS \"Value\"").ToListAsync(ct)).FirstOrDefault();

    /// <summary>Montant à la française (l'API tourne sans globalisation) : 12 345,67 €.</summary>
    private static string Euros(decimal m) =>
        m.ToString("#,##0.00", System.Globalization.CultureInfo.InvariantCulture).Replace(',', ' ').Replace('.', ',') + " €";

    private static string Nombre(decimal n) => n.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture).Replace('.', ',');

    private static decimal? Seuil(IReadOnlyDictionary<string, System.Text.Json.Nodes.JsonNode?> regles, string code) =>
        regles.TryGetValue(code, out var v) && v is System.Text.Json.Nodes.JsonValue j && j.TryGetValue<decimal>(out var n) && n >= 0 ? n : null;

    /// <summary>
    /// Avertissements de gestion à la validation (CONCEPTION-REGLES-DOCUMENTS.md, lot 6) : remise au-delà du seuil (R13),
    /// marge nette sous le minimum (R14, devis et factures directes), encours client dépassé (R15), prix d'achat facturé
    /// différent de la commande (R16).
    /// </summary>
    public override async Task AvertissementsAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        IReadOnlyDictionary<string, System.Text.Json.Nodes.JsonNode?> regles, string action, List<MessageCalcul> avertissements, CancellationToken ct)
    {
        if (action != "VALIDER") return;
        // Lots et numéros de série (S24.2) : entrée d'un article suivi dont une partie reste sans lot.
        await MouvementsStockBtp.AvertirLotsAsync(db, document.Lignes, type, avertissements, ct);
        var d = document.Document;
        await AvertirTvaAutoliqueeAsync(db, document, type, avertissements, ct);
        var parId = document.Lignes.ToDictionary(l => l.LigId);
        // Lignes vendues : lignes de prix hors composantes d'ouvrage, options et frais annexes.
        var vendues = document.Lignes.Where(l => TL.EstChiffree(l) && !(l.LigParentId is long p && parId.TryGetValue(p, out var parent) && parent.LigTylId == TL.Ouvrage)
            && l.LigTypePrix == "V").ToList();

        if (Seuil(regles, "REMISE_MAX") is decimal remiseMax)
        {
            foreach (var l in vendues.Where(l => (1 - l.LigCoefRemise) * 100 > remiseMax))
            {
                avertissements.Add(new MessageCalcul(l.LigId, "REMISE_MAX", $"Ligne {l.LigNumerotation} : remise de {Nombre((1 - l.LigCoefRemise) * 100)} % au-delà de {Nombre(remiseMax)} %"));
            }
            foreach (var p in document.Lignes.Where(l => l.LigTylId == TL.PiedHt && !l.LigPiedRetenue))
            {
                var pct = p.LigPiedMode switch
                {
                    "P" when p.LigPiedSens == -1 => p.LigPiedValeur ?? 0,
                    "C" => (1 - (p.LigPiedValeur ?? 1)) * 100,
                    _ => p.LigBaseCalcul is decimal b && b != 0 && p.LigMontantHt < 0 ? -(p.LigMontantHt ?? 0) / b * 100 : 0,
                };
                if (pct > remiseMax) avertissements.Add(new MessageCalcul(p.LigId, "REMISE_MAX", $"Remise de pied de {Nombre(pct)} % au-delà de {Nombre(remiseMax)} %"));
            }
        }

        // Marge nette (onglet Analyse) : PV remisé sans frais annexes ni prorata − revient, sur le PV ; factures : directes seulement.
        if (Seuil(regles, "MARGE_MIN") is decimal margeMin
            && await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM document_lien WHERE lie_cible_ent_id = {d.EntId} AND lie_type = 'TRANSFORMATION'").FirstAsync(ct) == 0)
        {
            decimal vente = 0, revient = 0;
            foreach (var l in vendues)
            {
                var coef = l.LigCoefFa * l.LigCoefProrata;
                vente += coef == 0 ? 0 : (l.LigMontantHt ?? 0) / coef;
                revient += l.LigMontantPr ?? 0;
            }
            if (vente > 0 && (vente - revient) / vente * 100 < margeMin)
            {
                avertissements.Add(new MessageCalcul(null, "MARGE_MIN", $"Marge nette de {Nombre((vente - revient) / vente * 100)} % sous le minimum de {Nombre(margeMin)} %"));
            }
        }

        // Encours du client : échéances non réglées des pièces validées + commandes en cours + ce document (la fiche du tiers l'emporte).
        if (type.TydFamille == FamillesDocument.Vente && d.EntTiersId is long tiers && (type.TydCode == TypesDocument.VCommande || type.TydNumerotationContinue))
        {
            var plafond = (await db.Database.SqlQuery<decimal?>($"SELECT per_cli_encours_max AS \"Value\" FROM personne WHERE per_id = {tiers}").ToListAsync(ct)).FirstOrDefault()
                ?? Seuil(regles, "ENCOURS_CLIENT");
            if (plafond is decimal max && max >= 0)
            {
                var encours = await db.Database.SqlQuery<decimal>($"""
                    SELECT coalesce((SELECT sum(e.ech_montant - coalesce((SELECT sum(p.poi_montant) FROM pointage p WHERE p.poi_echeance_id = e.ech_id), 0))
                                     FROM document_echeance e JOIN document x ON x.ent_id = e.ech_ent_id JOIN type_document t ON t.tyd_id = x.ent_tyd_id
                                     JOIN statut_document s ON s.std_id = x.ent_std_id
                                     WHERE x.ent_tiers_id = {tiers} AND t.tyd_famille = 'V' AND x.ent_verrouille AND s.std_code <> ALL({SqlBtp.StatutsHorsVigueur})), 0)
                         + coalesce((SELECT sum(x.ent_total_ttc) FROM document x JOIN type_document t ON t.tyd_id = x.ent_tyd_id
                                     JOIN statut_document s ON s.std_id = x.ent_std_id
                                     WHERE x.ent_tiers_id = {tiers} AND t.tyd_code = 'V_COMMANDE' AND x.ent_verrouille AND x.ent_id <> {d.EntId}
                                       AND s.std_code <> ALL({StatutsCommandeClose})), 0) AS "Value"
                    """).FirstAsync(ct);
                var total = encours + d.EntNetAPayer;
                if (total > max)
                {
                    avertissements.Add(new MessageCalcul(null, "ENCOURS_CLIENT", $"Encours du client de {Euros(total)} (ce document compris) au-delà du plafond de {Euros(max)}"));
                }
            }
        }

        // Facture fournisseur : prix unitaire différent de celui de la commande (ligne d'origine) au-delà du seuil.
        if (Seuil(regles, "PRIX_ACHAT_ECART") is decimal ecartMax && FamillesDocument.EstAchat(type.TydFamille))
        {
            var origines = vendues.Where(l => l.LigOrigineId is not null).Select(l => l.LigOrigineId!.Value).ToList();
            if (origines.Count > 0)
            {
                var prix = await db.Lignes.AsNoTracking().Where(l => origines.Contains(l.LigId))
                    .ToDictionaryAsync(l => l.LigId, l => l.LigPvRemise ?? l.LigPv ?? 0, ct);
                foreach (var l in vendues.Where(l => l.LigOrigineId is long o && prix.ContainsKey(o)))
                {
                    var avant = prix[l.LigOrigineId!.Value];
                    var maintenant = l.LigPvRemise ?? l.LigPv ?? 0;
                    if (avant != 0 && Math.Abs(maintenant - avant) / Math.Abs(avant) * 100 > ecartMax)
                    {
                        avertissements.Add(new MessageCalcul(l.LigId, "PRIX_ACHAT_ECART", $"Ligne {l.LigNumerotation} : prix {Euros(maintenant)} au lieu de {Euros(avant)} à la commande"));
                    }
                }
            }
        }
    }

    /// <summary>
    /// Pièce d'achat d'un fournisseur intracommunautaire (Comptabilité active) : une ligne de prix dont la TVA n'est pas
    /// autoliquidée est signalée (avertissement non bloquant, numéros des lignes en cause).
    /// </summary>
    private static async Task AvertirTvaAutoliqueeAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> avertissements, CancellationToken ct)
    {
        if (document.Document.EntTiersId is not long tiers || type.TydFamille != FamillesDocument.Achat) return;
        var intracom = (await db.Database.SqlQuery<bool>($"SELECT coalesce(per_fou_tva_intracom, FALSE) AS \"Value\" FROM personne WHERE per_id = {tiers}").ToListAsync(ct)).FirstOrDefault();
        if (!intracom) return;
        var categories = await db.Database.SqlQuery<TauxCategorie>($"SELECT ttv_id AS id, ttv_categorie AS categorie FROM taux_tva").ToListAsync(ct);
        TvaAchatBtp.Avertir(type.TydFamille, intracom, true, document.Lignes, categories.ToDictionary(c => c.Id, c => c.Categorie), avertissements);
    }

    private sealed record TauxCategorie(int Id, string Categorie);

    /// <summary>Frais annexes et coefficient de prorata réservés aux ventes (règle FRAIS_ANNEXES, P11 ; controlesValidation).</summary>
    private static async Task ControlerFraisAnnexes(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> erreurs, CancellationToken ct)
    {
        var regle = await db.Database.SqlQuery<string>($"SELECT coalesce(f_regle_document('FRAIS_ANNEXES', {type.TydId})::text, 'false') AS \"Value\"").FirstAsync(ct);
        if (regle == "true") return;
        foreach (var l in document.Lignes.Where(l => l.LigTypePrix == "F" || l.LigCoefProrata != 1))
        {
            erreurs.Add(new MessageCalcul(l.LigId, "FRAIS_ANNEXES_INTERDITS", "Frais annexes et prorata réservés aux ventes"));
        }
    }

    /// <summary>
    /// Montant de validation dépassé (module Droits, D12) : demande de validation = tâche du CRM (module actif) à prendre
    /// par le service du document, sinon du type, sinon le premier service administratif ; rattachée au document.
    /// Une tâche impossible à créer est journalisée sans changer le refus.
    /// </summary>
    public override async Task MontantDepasseAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        Utilisateur u, DepassementValidation depassement, CancellationToken ct)
    {
        var services = Http?.HttpContext?.RequestServices;
        if (services is null || !await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.Crm, ct)) return;
        var d = document.Document;
        try
        {
            var srv = d.EntSrvId ?? await db.Database.SqlQuery<int?>($"""
                SELECT COALESCE((SELECT tyd_srv_id FROM type_document WHERE tyd_id = {type.TydId}),
                    (SELECT srv_id FROM service WHERE srv_nature = 'ADMINISTRATIF' AND srv_actif ORDER BY srv_parent_id NULLS FIRST, srv_id LIMIT 1)) AS "Value"
                """).FirstOrDefaultAsync(ct);
            var objet = $"Validation demandée : {type.TydLibelle} {d.EntNumero ?? d.EntId.ToString()} ({depassement.Montant:0.00} € HT)";
            var message = depassement.Motif == "PIECE"
                ? $"<p>{System.Net.WebUtility.HtmlEncode(u.Code)} ne peut valider que {depassement.Limite.Piece:0.00} € HT par pièce.</p>"
                : $"<p>Cumul validé par {System.Net.WebUtility.HtmlEncode(u.Code)} pour ce tiers sur {depassement.Limite.Jours} jours : {depassement.Cumul + depassement.Montant:0.00} € HT pour une limite de {depassement.Limite.Cumul:0.00} €.</p>";
            await services.GetRequiredService<LogiBTP.Crm.Web.ServiceCrm>().Enregistrer(null, new LogiBTP.Crm.Web.NoteSaisie(LogiBTP.Crm.NatureNote.Tache, LogiBTP.Crm.EtatNote.AFaire, null, srv, objet, message,
                null, DateTimeOffset.UtcNow.AddDays(2), null, false, false, false, [new LogiBTP.Crm.Web.LienSaisi("document", (d.EntGroupeId ?? d.EntId).ToString(), true)], null), u, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            services.GetRequiredService<ILoggerFactory>().CreateLogger("Droits").LogWarning(e, "Demande de validation non créée pour le document {Document}", d.EntId);
        }
    }

    /// <summary>
    /// Validation : commande client inscrite à son marché (base ou avenant, montant recalculé, db/170) ; document
    /// d'avancement d'un marché : numéro de situation (Q29 : le suivant, sauf numéro saisi) et, pour une facture ou un
    /// avoir d'avancement, documents précédents déduits figés (13.7, document_deduction) ; facture reçue par la plateforme :
    /// Approuvée (205, <see cref="StatutsReceptionBtp"/>).
    /// </summary>
    public override async Task ApresValidationAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, long entId, TypeDocument type, CancellationToken ct)
    {
        // Ordre (module Exécution) : « à faire » dès sa transmission ; ordre d'exécution : budget planifié figé (E16).
        if (type.TydFamille == "E")
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document SET ent_exe_etat = 'A_FAIRE' WHERE ent_id = {entId} AND ent_exe_etat IS NULL", ct);
            if (type.TydCode == TypesDocument.EOe) await ExecutionBtp.FigerBudgetAsync(db, entId, "validation", ct);
            return;
        }
        // Facture reçue par la plateforme (module Facturation électronique, lot 13) : Approuvée (205) à la validation.
        if (type.TydCode is TypesDocument.AFacture or TypesDocument.TFactureAvt && Http?.HttpContext?.RequestServices is { } requete)
        {
            await new StatutsReceptionBtp(requete, requete.GetRequiredService<ILoggerFactory>().CreateLogger<StatutsReceptionBtp>())
                .ApprouverAsync(entId, Utilisateur.Depuis(Http.HttpContext).Code, ct);
        }
        // Stock : mouvements des livraisons, réceptions, factures sans livraison et transferts (module Stock, § 4).
        await MouvementsStockBtp.EcrireAsync(db, entId, type, ct);
        // Lots sortis vers un chantier : leurs certificats matière y seront copiés (file traitée hors de la transaction, S24.6).
        if (MouvementsStockBtp.Concerne(type)) await LotsStockBtp.PlanifierCopiesAsync(db, entId, null, ct);
        // Numéros de série livrés sur un chantier client : équipements installés du module SAV (lot 4 du plan Stock).
        await EquipementsSavBtp.EcrireAsync(db, entId, type, ct);
        // Édition de la pièce validée produite par le serveur et rangée en GED (module Édition, Q15) ; pièce de vente à
        // numérotation continue (facture, avoir…) : au coffre-fort. Ligne de la file insérée dans la transaction.
        if (FamillesDocument.EstCommerciale(type.TydFamille))
        {
            var coffre = type.TydFamille == "V" && type.TydNumerotationContinue;
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO edition_tache (ett_source, ett_id_element, ett_motif, ett_coffre, ett_demande_par) VALUES ('document', {entId.ToString()}, 'VALIDATION', {coffre}, 'validation')", ct);
        }
        if (type.TydCode is TypesDocument.VCommande or TypesDocument.TCommande) await db.Database.ExecuteSqlInterpolatedAsync($"SELECT f_marche_commande({entId})", ct);
        // Déductions d'acompte de la pièce (facture ou avoir d'avancement), relues sur ses lignes.
        if (type.TydAvancement == "F" || type.TydCode == TypesDocument.VAvoir) await Acomptes.Ecrire((LogiBtpContext)db, entId, ct);
        var doc = await db.Documents.AsNoTracking().FirstAsync(d => d.EntId == entId, ct);
        // Révision des prix du marché (lot G1) : détail par période figé (pièces d'avancement, facture de régularisation).
        if (doc.EntMarcheId is not null && (doc.EntAvtPresentation == "P" || type.TydCode == TypesDocument.VFacture)) await RevisionPrix.EcrireAsync(db, entId, ct);
        // Un avoir d'annulation reprend la pièce annulée (son numéro de situation) : ni numéro ni déduction.
        if (doc.EntAvtPresentation is null || doc.EntMarcheId is null || doc.EntNatureAvoir == "ANNULATION") return;
        await NumeroterAvancement(db, entId, ct);
        if (doc.EntAvtPresentation != "P") return;
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM document_deduction WHERE ded_ent_id = {entId}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO document_deduction (ded_ent_id, ded_deduit_ent_id, ded_rang, ded_montant_ht, ded_montant_ttc)
            SELECT d.ent_id, x.ent_id, x.ent_rang_avancement, x.ent_total_ht, x.ent_total_ttc
            FROM document d
            JOIN document x ON x.ent_marche_id = d.ent_marche_id AND x.ent_id <> d.ent_id AND f_document_valable(x.ent_id, FALSE)
            JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id
            WHERE d.ent_id = {entId} AND (x.ent_avt_presentation = 'P' OR tx.tyd_avancement = 'R')
              AND (x.ent_rang_avancement IS NULL OR d.ent_rang_avancement IS NULL OR x.ent_rang_avancement < d.ent_rang_avancement)
            """, ct);
    }

    /// <summary>
    /// Numéro de situation (Q29) d'un document d'avancement du marché qui n'en a pas : le suivant des documents validés
    /// de même nature (situations de travaux de référence, situations de production, ou factures d'avancement et reprises) ;
    /// à la création depuis le marché et
    /// à la validation (un numéro saisi est gardé).
    /// </summary>
    public static async Task NumeroterAvancement(DbContext db, long entId, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE document d SET ent_rang_avancement = 1 + coalesce((
                SELECT max(x.ent_rang_avancement) FROM document x
                JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id
                JOIN type_document td ON td.tyd_id = d.ent_tyd_id
                WHERE x.ent_marche_id = d.ent_marche_id AND x.ent_id <> d.ent_id AND f_document_valable(x.ent_id, FALSE)
                  AND CASE WHEN td.tyd_avancement IN ('S', 'D') THEN tx.tyd_avancement = td.tyd_avancement
                           ELSE x.ent_avt_presentation = 'P' OR tx.tyd_avancement = 'R' END), 0)
            WHERE d.ent_id = {entId} AND d.ent_rang_avancement IS NULL AND d.ent_avt_presentation IS NOT NULL AND d.ent_marche_id IS NOT NULL
            """, ct);
    }

    /// <summary>
    /// Pièce d'un marché : postes de pied du marché synchronisés avant le calcul de la validation (retenue de garantie et
    /// postes TTC des factures, modèle de pied des commandes ; CONCEPTION-MARCHES-REGLEMENTS.md, Q5 à Q9, 11.3).
    /// </summary>
    public override async Task CompleterValidationAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp saisie, TypeDocument type, CancellationToken ct)
    {
        if (await PostesMarche.Portee(db, type, saisie.Document, ct) is string portee) await PostesMarche.Appliquer(db, saisie, portee, ct);
        // Stock : le tiers est notre société (P6).
        if (type.TydFamille is FamillesDocument.Stock or FamillesDocument.Execution && saisie.Document.EntTiersId is null)
        {
            saisie.Document.EntTiersId = (await db.Database.SqlQuery<long?>($"SELECT per_id AS \"Value\" FROM personne WHERE per_societe_base LIMIT 1").ToListAsync(ct)).FirstOrDefault();
        }
        // Stock : date-heure du mouvement à la minute, l'instant de la validation si elle n'est pas saisie (S5, S10).
        if (MouvementsStockBtp.Concerne(type)) saisie.Document.EntDateMouvement = MouvementsStockBtp.Minute(saisie.Document.EntDateMouvement);
        // Ouvrage sans composante : devient un élément de nature Prestation (P20, P24) ; le total validé ne doit pas changer.
        var ouvrages = saisie.Lignes.Where(l => l.LigTylId == TL.Ouvrage && !saisie.Lignes.Any(c => c.LigParentId == l.LigId)).ToList();
        if (ouvrages.Count > 0)
        {
            var prestation = (await db.Database.SqlQuery<int?>($"SELECT nat_id AS \"Value\" FROM nature_element WHERE nat_code = 'PRE'").ToListAsync(ct)).FirstOrDefault();
            foreach (var l in ouvrages)
            {
                l.LigTylId = TL.Element;
                l.LigNatId = prestation ?? l.LigNatId;
            }
            totalAttendu.Value = saisie.Document.EntTotalHt;
        }
        // Coordonnées figées du client et du payeur : prises dans l'annuaire si l'entête n'en a pas encore.
        await ContactsDocument.Completer(db, saisie.Document, type.TydFamille, ct);
        // Adresse des travaux ou de livraison : celle du chantier si elle manque ; ventes : vidée si identique au client.
        await AdressesDocument.Completer(db, saisie.Document, type.TydFamille, ct);
        // Facture d'avancement d'un marché : déductions des acomptes émis (Q12, 11.2).
        if (type.TydAvancement == "F" && saisie.Document.EntMarcheId is not null && saisie.Document.EntNatureAvoir is null)
        {
            await Acomptes.Appliquer((LogiBtpContext)db, saisie, ct);
        }
        // Révision des prix du marché (lot G1) : poste de la période et régularisation des périodes précédentes.
        await RevisionPrix.Appliquer(db, saisie, type, ct);
    }

    /// <summary>
    /// Dévalidation : la nouvelle version remplace l'ancienne dans le marché (commande), les déductions des factures
    /// d'avancement, les acomptes (demande, pièce, déductions).
    /// </summary>
    public override async Task ReporterVersionAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, long ancien, long nouveau, IReadOnlyDictionary<long, long> lignes, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE marche_document SET mdo_ent_id = {nouveau} WHERE mdo_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE marche SET mar_ent_id = {nouveau} WHERE mar_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_deduction SET ded_ent_id = {nouveau} WHERE ded_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_deduction SET ded_deduit_ent_id = {nouveau} WHERE ded_deduit_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE acompte_deduction SET acd_ent_id = {nouveau} WHERE acd_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE marche_acompte SET mac_demande_ent_id = {nouveau} WHERE mac_demande_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE marche_acompte SET mac_piece_ent_id = {nouveau} WHERE mac_piece_ent_id = {ancien}", ct);
        await RevisionPrix.ReporterVersionAsync(db, ancien, nouveau, ct);
    }

    /// <summary>Délai de paiement (mêmes codes que les conditions de paiement) et mode de règlement du tiers (annuaire).</summary>
    public override async Task<ReglementTiers?> ReglementTiersAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentBtp document, CancellationToken ct)
    {
        if (document.EntTiersId is not long tiers) return null;
        // Règlement du tiers selon le sens de la pièce (db/229) : fournisseur pour les achats, client sinon ; à défaut le
        // couple commun de la fiche.
        var famille = await db.TypesDocument.Where(t => t.TydId == document.EntTydId).Select(t => t.TydFamille).FirstOrDefaultAsync(ct) ?? "V";
        var achat = FamillesDocument.EstAchat(famille);
        var v = await db.Database.SqlQuery<string>($"""
            SELECT coalesce(CASE WHEN {achat} THEN per_fou_delai_paiement ELSE per_cli_delai_paiement END, per_delai_paiement, '') || '|'
                || coalesce(CASE WHEN {achat} THEN per_fou_mode_reglement ELSE per_cli_mode_reglement END, per_mode_reglement, '') AS "Value"
            FROM personne WHERE per_id = {tiers}
            """).FirstOrDefaultAsync(ct);
        if (v is null) return null;
        var x = v.Split('|');
        return new ReglementTiers(x[0] == "" ? null : x[0], x[1] == "" ? null : x[1]);
    }

    public override void CopierEnteteSaisie(DocumentBtp cible, DocumentBtp saisie)
    {
        cible.EntModeCalculOuvrage = saisie.EntModeCalculOuvrage;
        cible.EntBibId = saisie.EntBibId;
        cible.EntProjetId = saisie.EntProjetId;
        cible.EntAffaireId = saisie.EntAffaireId;
        cible.EntChantierId = saisie.EntChantierId;
        cible.EntMarcheId = saisie.EntMarcheId;
        cible.EntIntervenants = saisie.EntIntervenants ?? cible.EntIntervenants;
        cible.EntRedacteurId = saisie.EntRedacteurId;
        // Coordonnées figées : remplacées seulement quand l'entête en porte (rechargées depuis l'annuaire).
        cible.EntContactClient = saisie.EntContactClient ?? cible.EntContactClient;
        cible.EntContactPayeur = saisie.EntContactPayeur ?? cible.EntContactPayeur;
        cible.EntFaLignes = saisie.EntFaLignes ?? "V";
        cible.EntFaMode = saisie.EntFaMode ?? "C";
        cible.EntStSaisie = saisie.EntStSaisie;
        cible.EntStRecuHt = saisie.EntStRecuHt;
        cible.EntStRecuTva = saisie.EntStRecuTva;
        cible.EntStRecuTtc = saisie.EntStRecuTtc;
        cible.EntDateMouvement = saisie.EntDateMouvement;
        cible.EntStkOrigineId = saisie.EntStkOrigineId;
        cible.EntStkDestinationId = saisie.EntStkDestinationId;
        cible.EntDateBesoin = saisie.EntDateBesoin;
        cible.EntDateLivraison = saisie.EntDateLivraison;
        cible.EntMoisRevision = saisie.EntMoisRevision is DateOnly m ? new DateOnly(m.Year, m.Month, 1) : null;
    }

    /// <summary>Ventes : payeur et adresse des travaux identiques au client restent vides (lot F).</summary>
    public override void CopierEnteteSaisie(DocumentBtp cible, DocumentBtp saisie, TypeDocument type)
    {
        CopierEnteteSaisie(cible, saisie);
        // Payeur vidé dans la saisie (identique au client, ou retiré) : la copie « ?? » ne l'efface pas.
        if (saisie.EntContactPayeur is null && type.TydFamille == "V") cible.EntContactPayeur = null;
        AdressesDocument.ViderIdentiques(cible, type.TydFamille);
    }

    // ------------------------------------------------------------------ chargement

    public override async Task ChargerComplements(DocumentDbContext<DocumentBtp, DocumentLigneBtp> contexte, DocumentCompletBtp complet,
        IReadOnlyCollection<long> lignes, CancellationToken ct)
    {
        var db = (LogiBtpContext)contexte;
        var entId = complet.Document.EntId;
        complet.Metres = await db.Metres.AsNoTracking().Where(m => lignes.Contains(m.MtrLigId)).OrderBy(m => m.MtrId).ToListAsync(ct);
        complet.Variables = await db.Variables.AsNoTracking().Where(v => v.VarEntId == entId)
            .OrderBy(v => v.VarOrdre).ThenBy(v => v.VarId).ToListAsync(ct);
        complet.Ventilations = await db.VentilationsFrais.AsNoTracking().Where(v => v.VfrEntId == entId).OrderBy(v => v.VfrId).ToListAsync(ct);
        complet.VentilationsLignes = await db.VentilationsFraisLignes.AsNoTracking().Where(v => v.VflEntId == entId).OrderBy(v => v.VflId).ToListAsync(ct);
    }

    // ------------------------------------------------------------------ écriture

    /// <summary>lig_mtr_id peut viser un métré pas encore créé : renseigné après l'écriture des métrés.</summary>
    public override void PreparerLigneAEcrire(DocumentLigneBtp copie) => copie.LigMtrId = null;

    public override async Task EcrireComplements(DocumentDbContext<DocumentBtp, DocumentLigneBtp> contexte, long entId, DocumentCompletBtp r,
        Correspondances corr, CancellationToken ct)
    {
        var db = (LogiBtpContext)contexte;
        await EcrireMetres(db, r, corr, ct);
        await EcrireVariables(db, entId, r, corr, ct);
        await EcrireVentilations(db, entId, r, corr, ct);
    }

    /// <summary>
    /// Clés de ventilation (une ligne supprimée garde sa clé, orpheline, jusqu'à la validation) puis détail calculé,
    /// réécrit à chaque enregistrement.
    /// </summary>
    private static async Task EcrireVentilations(LogiBtpContext db, long entId, DocumentCompletBtp r, Correspondances corr, CancellationToken ct)
    {
        var cVentilations = corr.Complement(ComplementVentilations);
        long? Ligne(long? id) => id is long v ? corr.Lignes.GetValueOrDefault(v, v) : null;
        var existantes = await db.VentilationsFrais.Where(v => v.VfrEntId == entId).ToDictionaryAsync(v => v.VfrId, ct);
        var nouvelles = new List<(long Temp, VentilationFrais Entite)>();
        foreach (var v in r.Ventilations)
        {
            var copie = JsonCalcul.Cloner(v);
            copie.VfrEntId = entId;
            copie.VfrSourceLigId = Ligne(v.VfrSourceLigId);
            copie.VfrLigId = Ligne(v.VfrLigId);
            if (existantes.Remove(v.VfrId, out var entite))
            {
                db.Entry(entite).CurrentValues.SetValues(copie);
                cVentilations[v.VfrId] = v.VfrId;
            }
            else
            {
                copie.VfrId = 0;
                db.VentilationsFrais.Add(copie);
                nouvelles.Add((v.VfrId, copie));
            }
        }
        db.VentilationsFrais.RemoveRange(existantes.Values);
        db.VentilationsFraisLignes.RemoveRange(await db.VentilationsFraisLignes.Where(v => v.VflEntId == entId).ToListAsync(ct));
        await db.SaveChangesAsync(ct);
        foreach (var (temp, e) in nouvelles) cVentilations[temp] = e.VfrId;

        foreach (var v in r.VentilationsLignes)
        {
            if (!corr.Lignes.TryGetValue(v.VflSourceLigId, out var source) || !corr.Lignes.TryGetValue(v.VflLigId, out var ligne)) continue;
            db.VentilationsFraisLignes.Add(new VentilationFraisLigne
            {
                VflEntId = entId, VflSourceLigId = source, VflLigId = ligne, VflMontant = v.VflMontant,
                VflVfrId = v.VflVfrId is long k && cVentilations.TryGetValue(k, out var k2) ? k2 : null,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    private static async Task EcrireMetres(LogiBtpContext db, DocumentCompletBtp r, Correspondances corr, CancellationToken ct)
    {
        var ids = corr.Lignes;
        var cMetres = corr.Complement(ComplementMetres);
        var lignesDoc = ids.Values.ToList();
        var existants = await db.Metres.Where(m => lignesDoc.Contains(m.MtrLigId)).ToDictionaryAsync(m => m.MtrId, ct);
        var nouveaux = new List<(long Temp, Metre Entite)>();
        foreach (var m in r.Metres)
        {
            if (!ids.TryGetValue(m.MtrLigId, out var ligId)) continue;
            var copie = JsonCalcul.Cloner(m);
            copie.MtrLigId = ligId;
            if (existants.Remove(m.MtrId, out var entite))
            {
                db.Entry(entite).CurrentValues.SetValues(copie);
                cMetres[m.MtrId] = m.MtrId;
            }
            else
            {
                copie.MtrId = 0;
                db.Metres.Add(copie);
                nouveaux.Add((m.MtrId, copie));
            }
        }
        db.Metres.RemoveRange(existants.Values);
        await db.SaveChangesAsync(ct);
        foreach (var (temp, e) in nouveaux) cMetres[temp] = e.MtrId;

        foreach (var l in r.Lignes)
        {
            var e = await db.Lignes.FindAsync([ids[l.LigId]], ct);
            e!.LigMtrId = l.LigMtrId is long mt && cMetres.TryGetValue(mt, out var mt2) ? mt2 : null;
        }

        await db.SaveChangesAsync(ct);
    }

    private static async Task EcrireVariables(LogiBtpContext db, long entId, DocumentCompletBtp r, Correspondances corr, CancellationToken ct)
    {
        var cMetres = corr.Complement(ComplementMetres);
        var cVariables = corr.Complement(ComplementVariables);
        var existantes = await db.Variables.Where(v => v.VarEntId == entId).ToDictionaryAsync(v => v.VarId, ct);
        var nouvelles = new List<(long Temp, VariableDefinition Entite)>();
        foreach (var v in r.Variables)
        {
            if (v.VarLigId is long vl && !corr.Lignes.ContainsKey(vl)) continue;
            if (v.VarMtrId is long vm && !cMetres.ContainsKey(vm)) continue;
            var copie = JsonCalcul.Cloner(v);
            copie.VarEntId = entId;
            copie.VarLigId = v.VarLigId is long l ? corr.Lignes[l] : null;
            copie.VarMtrId = v.VarMtrId is long m ? cMetres[m] : null;
            if (existantes.Remove(v.VarId, out var entite))
            {
                db.Entry(entite).CurrentValues.SetValues(copie);
                cVariables[v.VarId] = v.VarId;
            }
            else
            {
                copie.VarId = 0;
                db.Variables.Add(copie);
                nouvelles.Add((v.VarId, copie));
            }
        }
        db.Variables.RemoveRange(existantes.Values);
        await db.SaveChangesAsync(ct);
        foreach (var (temp, e) in nouvelles) cVariables[temp] = e.VarId;
    }

    // ------------------------------------------------------------------ copies et transformations

    public override void RenumeroterComplements(DocumentCompletBtp d, IReadOnlyDictionary<long, long> lig, ref long n)
    {
        var mtr = new Dictionary<long, long>();
        foreach (var m in d.Metres) mtr[m.MtrId] = --n;
        static long? Map(IReadOnlyDictionary<long, long> t, long? id) => id is long v && t.TryGetValue(v, out var r) ? r : null;
        // Les lignes portent déjà leur nouvel ID ; seul lig_mtr_id reste à convertir.
        foreach (var l in d.Lignes) l.LigMtrId = Map(mtr, l.LigMtrId);
        foreach (var m in d.Metres)
        {
            m.MtrId = mtr[m.MtrId];
            m.MtrLigId = lig[m.MtrLigId];
        }
        foreach (var v in d.Variables)
        {
            v.VarLigId = Map(lig, v.VarLigId);
            v.VarMtrId = Map(mtr, v.VarMtrId);
        }
        // Frais annexes : les clés suivent leurs lignes (une clé orpheline n'est pas copiée).
        var vfr = new Dictionary<long, long>();
        var cles = new List<VentilationFrais>();
        foreach (var v in d.Ventilations)
        {
            if (v.VfrSourceLigId is long s && !lig.ContainsKey(s)) continue;
            if (v.VfrCible == "LIGNE" && (v.VfrLigId is not long l || !lig.ContainsKey(l))) continue;
            vfr[v.VfrId] = --n;
            v.VfrId = vfr[v.VfrId];
            v.VfrSourceLigId = Map(lig, v.VfrSourceLigId);
            v.VfrLigId = Map(lig, v.VfrLigId);
            cles.Add(v);
        }
        d.Ventilations = cles;
        d.VentilationsLignes = d.VentilationsLignes.Where(v => lig.ContainsKey(v.VflSourceLigId) && lig.ContainsKey(v.VflLigId)).ToList();
        foreach (var v in d.VentilationsLignes)
        {
            v.VflSourceLigId = lig[v.VflSourceLigId];
            v.VflLigId = lig[v.VflLigId];
            v.VflVfrId = Map(vfr, v.VflVfrId);
        }
    }

    public override void FiltrerComplements(DocumentCompletBtp c, ISet<long> lignes)
    {
        c.Metres = c.Metres.Where(m => lignes.Contains(m.MtrLigId)).ToList();
        var mids = c.Metres.Select(m => m.MtrId).ToHashSet();
        c.Variables = c.Variables.Where(v => (v.VarLigId is null || lignes.Contains(v.VarLigId.Value))
            && (v.VarMtrId is null || mids.Contains(v.VarMtrId.Value))).ToList();
        foreach (var l in c.Lignes.Where(l => l.LigMtrId is long m && !mids.Contains(m))) l.LigMtrId = null;
        // Transformation : la ventilation est figée en clés de ligne (prix unitaires conservés, quantités transformées).
        c.VentilationsLignes = c.VentilationsLignes.Where(v => lignes.Contains(v.VflSourceLigId) && lignes.Contains(v.VflLigId)).ToList();
        c.Ventilations = FigerVentilation(c.VentilationsLignes, c.Lignes, c.Document.EntId);
    }

    /// <summary>Plusieurs sources : métrés, variables, clés et détail de ventilation mis bout à bout (identifiants distincts).</summary>
    public override void FusionnerComplements(DocumentCompletBtp cible, DocumentCompletBtp ajout)
    {
        cible.Metres.AddRange(ajout.Metres);
        cible.Variables.AddRange(ajout.Variables);
        cible.Ventilations.AddRange(ajout.Ventilations);
        cible.VentilationsLignes.AddRange(ajout.VentilationsLignes);
    }

    /// <summary>
    /// Contenu d'une source d'achat repris avec d'autres (facture de plusieurs livraisons) : chaque ligne garde son
    /// chantier, celui de la ligne sinon celui de la source (l'entête de la facture reste vide s'ils diffèrent, db/248).
    /// </summary>
    public override void PreparerContenuSource(DocumentCompletBtp contenu, DocumentBtp source, TypeDocument typeSource, TypeDocument typeCible)
    {
        if (source.EntChantierId is not int chantier || !FamillesDocument.EstAchat(typeCible.TydFamille)) return;
        foreach (var l in contenu.Lignes.Where(l => TL.EstChiffree(l) && l.LigChaId is null)) l.LigChaId = chantier;
    }

    /// <summary>
    /// Document créé depuis plusieurs sources : un rattachement (projet, affaire, chantier, marché) n'est gardé que s'il
    /// est commun à toutes (une facture fournisseur peut couvrir plusieurs chantiers).
    /// </summary>
    public override void PreparerEntetePlusieurs(DocumentBtp cible, IReadOnlyList<DocumentBtp> sources)
    {
        static T? Commun<T>(IEnumerable<T?> v) where T : struct => v.Distinct().Count() == 1 ? v.First() : null;
        cible.EntProjetId = Commun(sources.Select(s => s.EntProjetId));
        cible.EntAffaireId = Commun(sources.Select(s => s.EntAffaireId));
        cible.EntChantierId = Commun(sources.Select(s => s.EntChantierId));
        cible.EntMarcheId = Commun(sources.Select(s => s.EntMarcheId));
    }

    /// <summary>
    /// Une commande client d'un marché ne se transforme pas seule en BL, situation ou facture d'avancement : ces
    /// documents se créent depuis le marché, avec toutes ses commandes (CONCEPTION-ACHATS-MARCHES.md, Q19).
    /// </summary>
    /// <summary>
    /// Ordre (famille E, module Exécution) : un seul chantier par ordre (E4), obligatoire ; les documents repris (sources
    /// des transformations) sont du même chantier.
    /// </summary>
    private static async Task ControlerOrdreAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, List<MessageCalcul> erreurs, CancellationToken ct)
    {
        var d = document.Document;
        if (d.EntChantierId is null)
        {
            erreurs.Add(new MessageCalcul(null, "EXE_CHANTIER", "Chantier obligatoire : un ordre porte sur un seul chantier"));
            return;
        }
        var autres = await db.Database.SqlQuery<string>($"""
            SELECT coalesce(s.ent_numero, s.ent_id::text) AS "Value" FROM document_lien l JOIN document s ON s.ent_id = l.lie_source_ent_id
            WHERE l.lie_cible_ent_id = {d.EntId} AND l.lie_type = 'TRANSFORMATION' AND s.ent_chantier_id IS DISTINCT FROM {d.EntChantierId}
            """).ToListAsync(ct);
        if (autres.Count > 0)
        {
            erreurs.Add(new MessageCalcul(null, "EXE_CHANTIER_UNIQUE", $"Documents repris d'un autre chantier : {string.Join(", ", autres)} (un ordre ne couvre qu'un chantier)"));
        }
    }

    public override void ControlerTransformation(DocumentCompletBtp source, TypeDocument typeSource, TypeDocument typeCible, bool depuisPlusieurs)
    {
        // Type d'ordre désactivé (E39) : plus de nouvel ordre de ce type.
        if (!typeCible.TydActif) throw LogiBTP.Socle.Web.ExceptionMetier.Invalide("TYPE_INACTIF", $"{typeCible.TydLibelle} : type de document désactivé");
        if (!depuisPlusieurs && typeSource.TydCode == TypesDocument.VCommande && source.Document.EntMarcheId is not null
            && typeCible.TydCode is TypesDocument.VReception or TypesDocument.VSituation or TypesDocument.VFactureAvt or TypesDocument.VRepriseAvt)
        {
            throw LogiBTP.Socle.Web.ExceptionMetier.Invalide("MARCHE_CREATION", "Commande d'un marché : créez ce document depuis la fiche du marché (toutes ses commandes)");
        }
    }

    public override bool EstLigneCalculee(DocumentLigneBtp l) => l.LigIsEcartArrondi;

    public override void AjusterLigneTransformee(DocumentLigneBtp l)
    {
        l.LigQteSource = "S";
        l.LigCoefPerte = 1;
    }
}
