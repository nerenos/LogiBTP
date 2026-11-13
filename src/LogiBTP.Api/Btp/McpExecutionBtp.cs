using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using LogiBTP.Stock;
using LogiBTP.Stock.Web;
using Microsoft.EntityFrameworkCore;
using static LogiBTP.Api.Btp.McpDocumentsBtp;

namespace LogiBTP.Api.Btp;

/// <summary>Filtre des lignes d'un ordre d'exécution (Q8) : critères combinables, vides ignorés.</summary>
public sealed record FiltreOrdre(string? Service, string? Famille, string? Chapitre, string? Etiquette)
{
    private static bool Rempli(string? s) => !string.IsNullOrWhiteSpace(s);

    public bool Vide => !Rempli(Service) && !Rempli(Famille) && !Rempli(Chapitre) && !Rempli(Etiquette);
    public bool ParService => Rempli(Service);
    public bool ParFamille => Rempli(Famille);
    public bool ParChapitre => Rempli(Chapitre);
    public bool ParEtiquette => Rempli(Etiquette);
}

/// <summary>
/// Ligne d'une commande vue par le filtre : ligne de prix (ouvrage ou élément hors ouvrage, prix vendu) ou non, reste à
/// transformer en ordre d'exécution, service porteur de sa nature (de la ligne, sinon de l'élément), famille de l'élément.
/// </summary>
public sealed record LigneFiltrable(long LigId, long? ParentId, short Tyl, bool Prix, decimal Reste, string? Libelle, string? Numerotation,
    string? Etiquette, int? SrvId, int? FamId);

/// <summary>Ligne de prix classée : retenue ou écartée, motif (<see cref="MotifsLigneOrdre"/>), services porteurs, chapitre.</summary>
public sealed record LigneClassee(long LigId, bool Retenue, string Motif, IReadOnlyList<int> Services, int? FamId, string? Chapitre);

/// <summary>
/// Sélection des lignes d'une commande pour un ordre d'exécution (ANALYSE-MODULE-MCP.md § 7.2, Q8 ; plans/mcp.md lot 9).
/// Ordre des contrôles d'une ligne de prix : reste à transformer, chapitre (un titre ancêtre dont le libellé contient le
/// texte demandé ou dont la numérotation l'égale), étiquette (de la ligne ou d'un titre ancêtre), puis domaine : service
/// porteur de la nature (ligne, sinon élément ; ouvrage sans service propre : services de ses composantes) dans le
/// service demandé ou un de ses sous-services ; sans aucun service porteur, repli sur la famille de l'élément (famille
/// demandée ou une de ses sous-familles) ; famille seule demandée : famille de l'élément. Critères combinés (ET).
/// </summary>
public static class FiltreLignesOrdre
{
    /// <summary>L'identifiant est la racine ou un de ses descendants (arbre par parent).</summary>
    public static bool Dans(int? id, IReadOnlySet<int> racines, IReadOnlyDictionary<int, int?> parents)
    {
        var vus = new HashSet<int>();
        for (var x = id; x is int v && vus.Add(v); x = parents.GetValueOrDefault(v))
            if (racines.Contains(v)) return true;
        return false;
    }

    public static List<LigneClassee> Classer(IReadOnlyList<LigneFiltrable> lignes, FiltreOrdre f, IReadOnlySet<int> services, IReadOnlySet<int> familles,
        IReadOnlyDictionary<int, int?> parentsServices, IReadOnlyDictionary<int, int?> parentsFamilles)
    {
        var parId = lignes.ToDictionary(l => l.LigId);
        var enfants = lignes.Where(l => l.ParentId is not null).ToLookup(l => l.ParentId!.Value);
        IEnumerable<LigneFiltrable> Ancetres(LigneFiltrable l)
        {
            for (var p = l.ParentId; p is long v && parId.TryGetValue(v, out var x); p = x.ParentId) yield return x;
        }
        IEnumerable<LigneFiltrable> Descendants(long id)
        {
            foreach (var e in enfants[id])
            {
                yield return e;
                foreach (var d in Descendants(e.LigId)) yield return d;
            }
        }
        var resultat = new List<LigneClassee>();
        foreach (var l in lignes.Where(l => l.Prix))
        {
            var titres = Ancetres(l).Where(a => a.Tyl is TL.Titre or TL.Section).ToList();
            var porteurs = l.SrvId is int s ? [s] : Descendants(l.LigId).Where(d => d.SrvId is not null).Select(d => d.SrvId!.Value).Distinct().Order().ToList();
            var chapitre = titres.FirstOrDefault(t => !string.IsNullOrWhiteSpace(t.Libelle))?.Libelle;
            LigneClassee Classee(bool retenue, string motif, string? ch = null) => new(l.LigId, retenue, motif, porteurs, l.FamId, ch ?? chapitre);

            if (l.Reste <= 0) { resultat.Add(Classee(false, MotifsLigneOrdre.SansReste)); continue; }
            if (f.ParChapitre)
            {
                var c = f.Chapitre!.Trim();
                var t = titres.FirstOrDefault(t => (t.Libelle?.Contains(c, StringComparison.OrdinalIgnoreCase) ?? false)
                    || string.Equals(t.Numerotation?.Trim(), c, StringComparison.OrdinalIgnoreCase));
                if (t is null) { resultat.Add(Classee(false, MotifsLigneOrdre.HorsChapitre)); continue; }
                chapitre = t.Libelle;
            }
            if (f.ParEtiquette && !new[] { l }.Concat(Ancetres(l)).Any(a => string.Equals(a.Etiquette?.Trim(), f.Etiquette!.Trim(), StringComparison.OrdinalIgnoreCase)))
            {
                resultat.Add(Classee(false, MotifsLigneOrdre.AutreEtiquette));
                continue;
            }
            bool FamilleRetenue() => FamillesDans(l.FamId, familles, parentsFamilles);
            if (f.ParService)
            {
                if (porteurs.Count > 0)
                    resultat.Add(porteurs.Any(p => Dans(p, services, parentsServices)) ? Classee(true, MotifsLigneOrdre.Service) : Classee(false, MotifsLigneOrdre.AutreService));
                else if (!f.ParFamille) resultat.Add(Classee(false, MotifsLigneOrdre.SansService));
                else resultat.Add(FamilleRetenue() ? Classee(true, MotifsLigneOrdre.Famille) : Classee(false, MotifsLigneOrdre.AutreFamille));
            }
            else if (f.ParFamille)
                resultat.Add(FamilleRetenue() ? Classee(true, MotifsLigneOrdre.Famille) : Classee(false, MotifsLigneOrdre.AutreFamille));
            else resultat.Add(Classee(true, f.ParChapitre ? MotifsLigneOrdre.Chapitre : MotifsLigneOrdre.Etiquette));
        }
        return resultat;
    }

    private static bool FamillesDans(int? fam, IReadOnlySet<int> familles, IReadOnlyDictionary<int, int?> parents) => Dans(fam, familles, parents);
}

/// <summary>
/// Ordres d'exécution filtrés et demandes d'appro ventilées pour les agents IA (module MCP, lot 9 ; ANALYSE-MODULE-MCP.md
/// § 7.2). Routes de lecture du cœur (aucune écriture) et outils composés qui n'écrivent que par les routes existantes, avec
/// le jeton délégué (droits de l'agent, contrôles du module Document) :
/// <list type="bullet">
/// <item><c>GET /api/execution/marches/{id}/selection-ordre</c> : commandes valables du marché (<c>f_document_valable</c>), lignes de
/// prix retenues ou écartées par le filtre (<see cref="FiltreLignesOrdre"/>) avec leur motif et leur reste (suivi de l'étape de
/// la transformation V_COMMANDE → E_OE) ;</item>
/// <item><c>GET /api/execution/ordres/{id}/unites-stock</c> : articles gérés en stock d'une pièce, unité de la ligne et unité de
/// stock, facteur de conversion de l'article (mêmes règles que STK_UNITE / UNITE_TRANSFORMEE : <see cref="MouvementsStockBtp.RatioOuNull"/>) ;</item>
/// <item><c>GET /api/stock/demandes/{id}/ventilation</c> : ventilation d'une demande d'appro (<see cref="ReglesVentilation"/>, lot 8)
/// sur les données du stock : stock et prévisions des dépôts (<c>PrevisionsAsync</c>), mini / maxi, commandes fournisseur en cours
/// non affectées (sans lieu de livraison ni demande d'origine : jamais comptées deux fois avec les ENTREE des dépôts), fournisseur
/// principal et conditionnement (<c>ApprovisionnementsAsync</c>) ;</item>
/// <item>outils <c>preparer_ordre_execution</c> (aperçu, puis E_OE brouillon par <c>POST …/transformer</c> limité aux lignes retenues),
/// <c>preparer_demandes_appro</c> (E_OE validé → E_DAP brouillon, unités des articles converties en unité de stock par un PUT sous
/// verrou), <c>proposer_ventilation</c> (lecture : tableau STOCK / COMMANDE / ACHAT et réappros proposés ; les pièces viendront de
/// la file des propositions, lot 10).</item>
/// </list>
/// </summary>
public static class McpExecutionBtp
{
    public const string RouteSelection = "/api/execution/marches/{id}/selection-ordre";
    public const string RouteUnitesStock = "/api/execution/ordres/{id}/unites-stock";
    public const string RouteVentilation = "/api/stock/demandes/{id}/ventilation";

    public static readonly string NoeudOrdre = FamillesDocument.NoeudDroits(FamillesDocument.Execution, TypesDocument.EOe);
    public static readonly string NoeudDemande = FamillesDocument.NoeudDroits(FamillesDocument.Execution, TypesDocument.EDap);
    private static readonly string NoeudCommandeClient = FamillesDocument.NoeudDroits(FamillesDocument.Vente, TypesDocument.VCommande);

    /// <summary>Erreurs de validation des unités (UnitesLignesBtp) reprises dans la réponse d'une demande non convertie.</summary>
    private const string StkUnite = "STK_UNITE";
    private const string MetreLie = "METRE";

    private static async Task ExigerAsync(HttpContext http, string noeud, CancellationToken ct)
    {
        var droits = http.RequestServices.GetService<IDroits>();
        if (droits is not null && !await droits.AutoriseAsync(Utilisateur.Depuis(http), noeud, ActionsDroits.Consulter, ct))
            throw ExceptionMetier.AccesRefuse(ActionsDroits.Consulter);
    }

    private static string J(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------ sélection des lignes d'un ordre

    private sealed record ArbreSql(int Id, int? Parent, string Code);
    private sealed record LigneSql(long LigId, int? SrvId, int? FamId);
    private sealed record CommandeSql(long EntId);

    public static async Task<IResult> SelectionAsync(int marche, FiltreOrdre filtre, HttpContext http, LogiBtpContext db,
        DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations,
        CancellationToken ct)
    {
        await ExigerAsync(http, NoeudCommandeClient, ct);
        if (filtre.Vide) throw ExceptionMetier.Invalide(ErreursMcpBtp.FiltreVide, "Au moins un critère : service, famille, chapitre ou étiquette");
        var services = await db.Database.SqlQuery<ArbreSql>($"SELECT srv_id AS id, srv_parent_id AS parent, srv_code AS code FROM service").ToListAsync(ct);
        var familles = await db.Database.SqlQuery<ArbreSql>($"SELECT fam_id AS id, fam_parent_id AS parent, fam_code AS code FROM famille_element").ToListAsync(ct);
        HashSet<int> Racines(List<ArbreSql> arbre, string? code, string quoi)
        {
            if (string.IsNullOrWhiteSpace(code)) return [];
            var r = arbre.Where(a => string.Equals(a.Code, code.Trim(), StringComparison.OrdinalIgnoreCase)).Select(a => a.Id).ToHashSet();
            return r.Count > 0 ? r : throw ExceptionMetier.Invalide(ErreursMcpBtp.CritereInconnu, $"{quoi} inconnu : {code}");
        }
        var srvRacines = Racines(services, filtre.Service, "Service");
        var famRacines = Racines(familles, filtre.Famille, "Famille de bibliothèque");
        var parentsSrv = services.ToDictionary(s => s.Id, s => s.Parent);
        var parentsFam = familles.ToDictionary(f => f.Id, f => f.Parent);
        var codesSrv = services.ToDictionary(s => s.Id, s => s.Code);
        var codesFam = familles.ToDictionary(f => f.Id, f => f.Code);

        var tydCommande = await TypesDocumentBtp.IdAsync(db, TypesDocument.VCommande, ct);
        var tydOrdre = await TypesDocumentBtp.IdAsync(db, TypesDocument.EOe, ct);
        var etape = await db.TransformationsAutorisees.AsNoTracking().Where(t => t.TraSourceTydId == tydCommande && t.TraCibleTydId == tydOrdre)
            .Select(t => t.TraEtape).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Invalide("TRANSFORMATION_INTERDITE", "Transformation commande → ordre d'exécution non autorisée");
        var ids = await db.Database.SqlQuery<CommandeSql>($"""
            SELECT d.ent_id FROM document d
            WHERE d.ent_marche_id = {marche} AND d.ent_tyd_id = {tydCommande} AND f_document_valable(d.ent_id, FALSE)
            ORDER BY d.ent_date, d.ent_id
            """).Select(c => c.EntId).ToListAsync(ct);

        var commandes = new JsonArray();
        foreach (var id in ids)
        {
            var d = await documents.Charger(id, ct);
            var suivi = (await transformations.Suivi(d, ct)).ToDictionary(s => s.LigId, s => s.Etapes.FirstOrDefault(e => e.Etape == etape)?.Reliquat ?? s.Qte);
            var infos = (await db.Database.SqlQuery<LigneSql>($"""
                SELECT l.lig_id, n.nat_srv_id AS srv_id, e.ele_fam_id AS fam_id
                FROM document_ligne l
                LEFT JOIN element e ON e.ele_id = coalesce(l.lig_art_id,
                    CASE WHEN l.lig_proprietes -> 'element' ->> 'id' ~ '^[0-9]+$' THEN (l.lig_proprietes -> 'element' ->> 'id')::bigint END)
                LEFT JOIN nature_element n ON n.nat_id = coalesce(l.lig_nat_id, e.ele_nat_id)
                WHERE l.lig_ent_id = {id}
                """).ToListAsync(ct)).ToDictionary(x => x.LigId);
            var lignes = d.Lignes.Select(l => new LigneFiltrable(l.LigId, l.LigParentId, l.LigTylId, suivi.ContainsKey(l.LigId), suivi.GetValueOrDefault(l.LigId),
                l.LigLibelleBrut ?? l.LigLibelleAffiche, l.LigNumerotation, l.LigEtiquette, infos.GetValueOrDefault(l.LigId)?.SrvId, infos.GetValueOrDefault(l.LigId)?.FamId)).ToList();
            var classees = FiltreLignesOrdre.Classer(lignes, filtre, srvRacines, famRacines, parentsSrv, parentsFam);
            var parLig = d.Lignes.ToDictionary(l => l.LigId);
            commandes.Add(new JsonObject
            {
                ["ent_id"] = id, ["ent_numero"] = d.Document.EntNumero, ["ent_chantier_id"] = d.Document.EntChantierId, ["ent_objet"] = d.Document.EntObjet,
                ["retenues"] = classees.Count(c => c.Retenue), ["ecartees"] = classees.Count(c => !c.Retenue),
                ["lignes"] = new JsonArray([.. classees.Select(c =>
                {
                    var l = parLig[c.LigId];
                    return (JsonNode?)new JsonObject
                    {
                        ["lig_id"] = c.LigId, ["lig_numerotation"] = l.LigNumerotation, ["lig_code"] = l.LigCode, ["lig_libelle"] = l.LigLibelleBrut ?? l.LigLibelleAffiche,
                        ["lig_qte"] = l.LigQte, ["lig_unt_code"] = l.LigUntCode, ["reste"] = suivi.GetValueOrDefault(c.LigId), ["retenue"] = c.Retenue, ["motif"] = c.Motif,
                        ["services"] = new JsonArray([.. c.Services.Select(s => (JsonNode?)codesSrv.GetValueOrDefault(s))]),
                        ["famille"] = c.FamId is int fa ? codesFam.GetValueOrDefault(fa) : null, ["chapitre"] = c.Chapitre, ["lig_etiquette"] = l.LigEtiquette,
                    };
                })]),
            });
        }
        return Results.Json(new JsonObject
        {
            ["marche_id"] = marche, ["etape"] = etape,
            ["filtre"] = new JsonObject { ["service"] = filtre.Service, ["famille"] = filtre.Famille, ["chapitre"] = filtre.Chapitre, ["etiquette"] = filtre.Etiquette },
            ["commandes"] = commandes,
        });
    }

    // ------------------------------------------------------------------ unités de stock d'une pièce

    private sealed record ArticleLigneSql(long LigId, long EleId, string Code, string? Unite, string UniteStock, string Unites, string Proprietes, int Precision,
        decimal? Poids, decimal? Surface, decimal? SurfacePeinture, decimal? Volume, decimal? Hauteur, decimal? Largeur, decimal? Epaisseur, decimal? Longueur);

    private static MouvementsStockBtp.UnitesArticle Conversions(ArticleLigneSql a) =>
        new(a.UniteStock, a.Unites, a.Proprietes, a.Poids, a.Surface, a.SurfacePeinture, a.Volume, a.Hauteur, a.Largeur, a.Epaisseur, a.Longueur);

    private static bool Meme(string? a, string? b) =>
        string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b) || string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Unité de stock des articles gérés en stock d'une pièce : facteur = quantité en unité de stock pour 1 unité de la ligne (null : sans conversion).</summary>
    public static async Task<IResult> UnitesStockAsync(long id, HttpContext http, LogiBtpContext db, CancellationToken ct)
    {
        var code = await TypesDocumentBtp.CodeAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        var famille = await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == code).Select(t => t.TydFamille).FirstAsync(ct);
        await ExigerAsync(http, FamillesDocument.NoeudDroits(famille, code), ct);
        var lignes = await db.Database.SqlQuery<ArticleLigneSql>($"""
            SELECT l.lig_id, e.ele_id, e.ele_code AS code, l.lig_unt_code AS unite, e.ele_unt_stock AS unite_stock, e.ele_unites::text AS unites,
                   e.ele_proprietes::text AS proprietes, coalesce(u.unt_precision_qte, 2)::int AS precision,
                   e.ele_poids AS poids, e.ele_surface AS surface, e.ele_surface_peinture AS surface_peinture, e.ele_volume AS volume,
                   e.ele_hauteur AS hauteur, e.ele_largeur AS largeur, e.ele_epaisseur AS epaisseur, e.ele_longueur AS longueur
            FROM document_ligne l JOIN element e ON e.ele_id = l.lig_art_id LEFT JOIN unite u ON u.unt_code = e.ele_unt_stock
            WHERE l.lig_ent_id = {id} AND e.ele_gestion = 'STOCK' AND e.ele_type = 'ARTICLE' AND coalesce(l.lig_type_prix, 'V') = 'V'
            ORDER BY l.lig_id
            """).ToListAsync(ct);
        return Results.Json(lignes.Select(l => new JsonObject
        {
            ["lig_id"] = l.LigId, ["ele_id"] = l.EleId, ["code"] = l.Code, ["unite"] = l.Unite, ["unite_stock"] = l.UniteStock, ["precision"] = l.Precision,
            ["en_stock"] = Meme(l.Unite, l.UniteStock), ["facteur"] = Meme(l.Unite, l.UniteStock) ? 1m : MouvementsStockBtp.RatioOuNull(l.Unite, Conversions(l)),
        }).ToList());
    }

    // ------------------------------------------------------------------ ventilation d'une demande d'appro

    private sealed record DemandeSql(string? Numero, DateOnly Date, DateOnly? DateBesoin, long? Origine, int? Chantier);
    private sealed record BesoinSql(long LigId, long EleId, decimal Qte, string? Unite, DateOnly? DateLivraison, string UniteStock, string Unites, string Proprietes,
        int Precision, decimal? Poids, decimal? Surface, decimal? SurfacePeinture, decimal? Volume, decimal? Hauteur, decimal? Largeur, decimal? Epaisseur, decimal? Longueur);
    private sealed record CommandeRecevoirSql(long EntId, string? Numero, long? Tiers, DateOnly DateLivraison, long EleId, decimal Reste, string? Unite, string UniteStock,
        string Unites, string Proprietes, int Precision, decimal? Poids, decimal? Surface, decimal? SurfacePeinture, decimal? Volume, decimal? Hauteur, decimal? Largeur,
        decimal? Epaisseur, decimal? Longueur);

    private static decimal? Ratio(string? unite, string uniteStock, string unites, string proprietes, decimal? poids, decimal? surface, decimal? surfacePeinture,
        decimal? volume, decimal? hauteur, decimal? largeur, decimal? epaisseur, decimal? longueur) =>
        MouvementsStockBtp.RatioOuNull(unite, new(uniteStock, unites, proprietes, poids, surface, surfacePeinture, volume, hauteur, largeur, epaisseur, longueur));

    /// <summary>
    /// Ventilation proposée d'une demande d'appro (E_DAP) : besoins = articles gérés en stock de la demande (quantité totale en unité
    /// de stock, date de livraison de la ligne, sinon date de besoin, sinon date de la pièce ; dépôt préféré = dépôt d'origine) ;
    /// aucune écriture. lig_solde d'une ligne de la demande dit qu'elle solde sa ligne parente (ordre), pas qu'elle est servie :
    /// une demande validée garde tous ses besoins (lot 10).
    /// </summary>
    public static async Task<IResult> VentilationAsync(long id, decimal? procheMini, HttpContext http, LogiBtpContext db, StockDbContext sdb,
        SpecialisationStock specialisation, ServiceStock stock, CancellationToken ct)
    {
        var code = await TypesDocumentBtp.CodeAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        if (code != TypesDocument.EDap) throw ExceptionMetier.Invalide(ErreursMcpBtp.TypeNonPermis, $"Le document {id} n'est pas une demande d'approvisionnement");
        await ExigerAsync(http, NoeudDemande, ct);
        await ExigerAsync(http, "stock", ct);
        if (procheMini is < 0 or > 100) throw ExceptionMetier.Invalide(ErreursMcpBtp.Operation, "proche_mini : de 0 à 100 %");
        var demande = await db.Database.SqlQuery<DemandeSql>($"""
            SELECT ent_numero AS numero, ent_date AS date, ent_date_besoin AS date_besoin, ent_stk_origine_id::bigint AS origine, ent_chantier_id AS chantier
            FROM document WHERE ent_id = {id}
            """).FirstAsync(ct);
        var lignes = await db.Database.SqlQuery<BesoinSql>($"""
            SELECT l.lig_id, e.ele_id, coalesce(l.lig_qte_totale, l.lig_qte, 0) AS qte, l.lig_unt_code AS unite, l.lig_date_livraison AS date_livraison,
                   e.ele_unt_stock AS unite_stock, e.ele_unites::text AS unites, e.ele_proprietes::text AS proprietes, coalesce(u.unt_precision_qte, 2)::int AS precision,
                   e.ele_poids AS poids, e.ele_surface AS surface, e.ele_surface_peinture AS surface_peinture, e.ele_volume AS volume,
                   e.ele_hauteur AS hauteur, e.ele_largeur AS largeur, e.ele_epaisseur AS epaisseur, e.ele_longueur AS longueur
            FROM document_ligne l JOIN element e ON e.ele_id = l.lig_art_id LEFT JOIN unite u ON u.unt_code = e.ele_unt_stock
            WHERE l.lig_ent_id = {id} AND e.ele_gestion = 'STOCK' AND e.ele_type = 'ARTICLE' AND coalesce(l.lig_type_prix, 'V') = 'V'
            ORDER BY l.lig_chemin, l.lig_ordre
            """).ToListAsync(ct);

        var lieux = (await specialisation.LieuxAsync(sdb, ct)).Where(l => l.Depot).ToList();
        var origine = demande.Origine is long o && lieux.Any(l => l.Id == o) ? o.ToString(CultureInfo.InvariantCulture) : null;
        var dateDemande = demande.DateBesoin ?? demande.Date;
        var besoins = new List<BesoinStock>();
        var sansConversion = new JsonArray();
        foreach (var l in lignes)
        {
            var r = Ratio(l.Unite, l.UniteStock, l.Unites, l.Proprietes, l.Poids, l.Surface, l.SurfacePeinture, l.Volume, l.Hauteur, l.Largeur, l.Epaisseur, l.Longueur);
            if (r is null)
            {
                sansConversion.Add(new JsonObject { ["lig_id"] = l.LigId, ["ele_id"] = l.EleId, ["unite"] = l.Unite, ["unite_stock"] = l.UniteStock, ["code"] = StkUnite });
                continue;
            }
            var q = ArrondiCalcul.Arrondir(l.Qte * r.Value, l.Precision);
            if (q > 0) besoins.Add(new BesoinStock(l.LigId.ToString(CultureInfo.InvariantCulture), l.EleId.ToString(CultureInfo.InvariantCulture), q,
                J(l.DateLivraison ?? dateDemande), origine));
        }
        var articlesBesoin = besoins.Select(b => long.Parse(b.Article, CultureInfo.InvariantCulture)).ToHashSet();

        // Dépôts : stock présent, mini / maxi, événements prévus (réservations, commandes livrées au dépôt) des articles demandés et à seuil.
        var depots = new List<DepotDisponible>();
        var tous = new HashSet<long>(articlesBesoin);
        foreach (var lieu in lieux)
        {
            var etat = (await stock.EtatAsync(lieu.Id, null, true, ct)).Lignes.ToDictionary(x => x.EleId, x => x.Quantite);
            var seuils = await sdb.Seuils.AsNoTracking().Where(x => x.SseLieuId == lieu.Id).ToDictionaryAsync(x => x.SseEleId, ct);
            var previsions = await specialisation.PrevisionsAsync(sdb, lieu.Id, ct);
            var ids = articlesBesoin.Union(seuils.Keys).ToList();
            tous.UnionWith(ids);
            depots.Add(new DepotDisponible(lieu.Id.ToString(CultureInfo.InvariantCulture), [.. ids.Select(e => new ArticleDuDepot(e.ToString(CultureInfo.InvariantCulture),
                etat.GetValueOrDefault(e), seuils.GetValueOrDefault(e)?.SseMini, seuils.GetValueOrDefault(e)?.SseMaxi,
                previsions.Where(p => p.Ele == e).Select((p, i) => new EvenementPrevu($"{p.Type[0]}{p.EntId}-{i}", p.Type, J(p.Date), p.Quantite)).ToList()))]));
        }

        // Commandes fournisseur en cours non affectées : ni lieu de livraison (sinon ENTREE du dépôt ou commande d'un chantier),
        // ni demande d'appro d'origine ; reste = quantité − reçue (le plus grand des quantités reçues et facturées), en unité de stock.
        var ensemble = articlesBesoin.ToArray();
        var aRecevoir = ensemble.Length == 0 ? [] : await db.Database.SqlQuery<CommandeRecevoirSql>($"""
            SELECT d.ent_id, d.ent_numero AS numero, d.ent_tiers_id AS tiers,
                   f_date_livraison_ligne(l.lig_date_livraison, d.ent_arc_livraison, d.ent_date_livraison, d.ent_date) AS date_livraison,
                   e.ele_id, coalesce(l.lig_qte_totale, l.lig_qte, 0) - greatest(coalesce(x.reception, 0), coalesce(x.facturation, 0)) AS reste,
                   l.lig_unt_code AS unite, e.ele_unt_stock AS unite_stock, e.ele_unites::text AS unites, e.ele_proprietes::text AS proprietes,
                   coalesce(u.unt_precision_qte, 2)::int AS precision,
                   e.ele_poids AS poids, e.ele_surface AS surface, e.ele_surface_peinture AS surface_peinture, e.ele_volume AS volume,
                   e.ele_hauteur AS hauteur, e.ele_largeur AS largeur, e.ele_epaisseur AS epaisseur, e.ele_longueur AS longueur
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN statut_document s ON s.std_id = d.ent_std_id
            JOIN document_ligne l ON l.lig_ent_id = d.ent_id
            JOIN element e ON e.ele_id = l.lig_art_id
            LEFT JOIN unite u ON u.unt_code = e.ele_unt_stock
            LEFT JOIN LATERAL (
                SELECT sum(k.lil_qte) FILTER (WHERE k.lil_etape = 'RECEPTION') AS reception, sum(k.lil_qte) FILTER (WHERE k.lil_etape = 'FACTURATION') AS facturation
                FROM document_ligne_lien k JOIN document_ligne lc ON lc.lig_id = k.lil_cible_lig_id
                JOIN document dc ON dc.ent_id = lc.lig_ent_id JOIN statut_document sc ON sc.std_id = dc.ent_std_id
                WHERE k.lil_source_lig_id = l.lig_id AND dc.ent_verrouille AND sc.std_code <> ALL({SqlBtp.StatutsHorsVigueur})) x ON TRUE
            WHERE t.tyd_code = {TypesDocument.ACommande} AND d.ent_verrouille AND d.ent_is_reference AND s.std_code <> ALL({SqlBtp.StatutsHorsVigueurOuSolde})
              AND l.lig_type_prix = 'V' AND NOT l.lig_solde AND e.ele_id = ANY({ensemble})
              AND coalesce(d.ent_stk_destination_id, d.ent_chantier_id) IS NULL
              AND NOT EXISTS (SELECT 1 FROM document_lien k JOIN document ds ON ds.ent_id = k.lie_source_ent_id JOIN type_document ts ON ts.tyd_id = ds.ent_tyd_id
                              WHERE k.lie_cible_ent_id = d.ent_id AND ts.tyd_code = {TypesDocument.EDap})
            ORDER BY 4, d.ent_id, l.lig_ordre
            """).ToListAsync(ct);
        var commandes = new List<CommandeARecevoir>();
        var numeros = new Dictionary<string, string?>();
        foreach (var c in aRecevoir.Where(c => c.Reste > 0))
        {
            var r = Ratio(c.Unite, c.UniteStock, c.Unites, c.Proprietes, c.Poids, c.Surface, c.SurfacePeinture, c.Volume, c.Hauteur, c.Largeur, c.Epaisseur, c.Longueur);
            if (r is null) continue;
            var q = ArrondiCalcul.Arrondir(c.Reste * r.Value, c.Precision);
            if (q <= 0) continue;
            var cle = c.EntId.ToString(CultureInfo.InvariantCulture);
            numeros[cle] = c.Numero;
            commandes.Add(new CommandeARecevoir(cle, c.EleId.ToString(CultureInfo.InvariantCulture), q, J(c.DateLivraison), c.Tiers?.ToString(CultureInfo.InvariantCulture)));
        }

        var appros = await specialisation.ApprovisionnementsAsync(sdb, tous, ct);
        var articles = await specialisation.ArticlesAsync(sdb, tous, ct);
        var fournisseurs = appros.Values.Where(a => a.FournisseurId is not null).GroupBy(a => a.FournisseurId!.Value).ToDictionary(g => g.Key, g => g.First().Fournisseur);
        var v = ReglesVentilation.Ventiler(J(DateOnly.FromDateTime(DateTime.Today)), besoins, depots, commandes,
            [.. tous.Select(e => new ArticleFournisseur(e.ToString(CultureInfo.InvariantCulture), appros.GetValueOrDefault(e)?.FournisseurId?.ToString(CultureInfo.InvariantCulture),
                appros.GetValueOrDefault(e)?.Conditionnement ?? 1))],
            procheMini ?? ReglesVentilation.ProcheMiniDefaut);

        long? Id(string? s) => long.TryParse(s, CultureInfo.InvariantCulture, out var x) ? x : null;
        string? Depot(string? s) => Id(s) is long x ? lieux.FirstOrDefault(l => l.Id == x)?.Code : null;
        string? Fournisseur(string? s) => Id(s) is long x ? fournisseurs.GetValueOrDefault(x) : null;
        JsonObject Article(string s)
        {
            var e = Id(s)!.Value;
            var a = articles.GetValueOrDefault(e);
            return new JsonObject { ["ele_id"] = e, ["code"] = a?.Code, ["libelle"] = a?.Libelle, ["unite"] = a?.Unite };
        }
        JsonObject Avec(JsonObject o, JsonObject plus)
        {
            foreach (var (k, x) in plus.ToList()) { plus.Remove(k); o[k] = x; }
            return o;
        }
        var tableau = new JsonArray([.. v.Besoins.Select(b => (JsonNode?)Avec(Article(b.Article), new JsonObject
        {
            ["lig_id"] = Id(b.Id), ["quantite"] = b.Quantite,
            ["stock"] = b.Parts.Where(p => p.Nature == NaturePartAppro.Stock).Sum(p => p.Quantite),
            ["commande"] = b.Parts.Where(p => p.Nature == NaturePartAppro.Commande).Sum(p => p.Quantite),
            ["achat"] = b.Parts.Where(p => p.Nature == NaturePartAppro.Achat).Sum(p => p.Quantite),
            ["parts"] = new JsonArray([.. b.Parts.Select(p => (JsonNode?)new JsonObject
            {
                ["nature"] = p.Nature, ["depot_id"] = Id(p.Depot), ["depot"] = Depot(p.Depot), ["commande_id"] = Id(p.Commande),
                ["commande"] = p.Commande is null ? null : numeros.GetValueOrDefault(p.Commande), ["fournisseur_id"] = Id(p.Fournisseur),
                ["fournisseur"] = Fournisseur(p.Fournisseur), ["quantite"] = p.Quantite, ["unites_achat"] = p.UnitesAchat,
            })]),
        }))]);
        var reappros = new JsonArray([.. v.Reappros.Select(r => (JsonNode?)new JsonObject
        {
            ["depot_id"] = Id(r.Depot), ["depot"] = Depot(r.Depot),
            ["fournisseurs"] = new JsonArray([.. r.Fournisseurs.Select(f => (JsonNode?)new JsonObject
            {
                ["fournisseur_id"] = Id(f.Fournisseur), ["fournisseur"] = Fournisseur(f.Fournisseur),
                ["lignes"] = new JsonArray([.. f.Lignes.Select(l => (JsonNode?)Avec(Article(l.Article), new JsonObject
                {
                    ["motif"] = l.Motif, ["disponible"] = l.Disponible, ["mini"] = l.Mini, ["maxi"] = l.Maxi, ["quantite"] = l.Quantite, ["unites_achat"] = l.UnitesAchat,
                }))]),
            })]),
        })]);
        return Results.Json(new JsonObject
        {
            ["ent_id"] = id, ["ent_numero"] = demande.Numero, ["aujourdhui"] = J(DateOnly.FromDateTime(DateTime.Today)),
            ["proche_mini"] = procheMini ?? ReglesVentilation.ProcheMiniDefaut, ["besoins"] = tableau, ["reappros"] = reappros, ["sans_conversion"] = sansConversion,
            // Proposition seulement : aucune pièce créée (réservation, demande de stock, commande : file des propositions, lot 10).
            ["ecriture"] = false,
        });
    }

    /// <summary>Routes de lecture de l'exécution (sous le module Exécution).</summary>
    public static RouteGroupBuilder MapMcpExecution(this RouteGroupBuilder api)
    {
        api.MapGet("/execution/marches/{id:int}/selection-ordre", (int id, string? service, string? famille, string? chapitre, string? etiquette, HttpContext http,
                LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
                TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations, CancellationToken ct) =>
            SelectionAsync(id, new FiltreOrdre(service, famille, chapitre, etiquette), http, db, documents, transformations, ct));
        api.MapGet("/execution/ordres/{id:long}/unites-stock", (long id, HttpContext http, LogiBtpContext db, CancellationToken ct) => UnitesStockAsync(id, http, db, ct));
        return api;
    }

    /// <summary>Route de lecture de la ventilation (sous le module Stock).</summary>
    public static RouteGroupBuilder MapVentilationDemandes(this RouteGroupBuilder api)
    {
        api.MapGet("/stock/demandes/{id:long}/ventilation", (long id, decimal? proche_mini, HttpContext http, LogiBtpContext db, StockDbContext sdb,
                SpecialisationStock specialisation, ServiceStock stock, CancellationToken ct) =>
            VentilationAsync(id, proche_mini, http, db, sdb, specialisation, stock, ct));
        return api;
    }

    // ------------------------------------------------------------------ outils

    private static string? Texte(ExecutionOutil x, string cle) => OperationsLignesBtp.Texte(x.Arguments.GetValueOrDefault(cle))?.Trim() is { Length: > 0 } s ? s : null;

    /// <summary>preparer_ordre_execution : aperçu des lignes (retenues, écartées, motif), puis un E_OE brouillon par commande, limité aux lignes retenues.</summary>
    public static Task<ReponseInterne> PreparerOrdreAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var marche = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("marche_id")) ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Marché attendu (marche_id)");
        var filtre = new FiltreOrdre(Texte(x, "service"), Texte(x, "famille"), Texte(x, "chapitre"), Texte(x, "etiquette"));
        if (filtre.Vide) throw new ErreurOutilMcp(422, ErreursMcpBtp.FiltreVide, "Au moins un critère : service, famille, chapitre ou étiquette");
        var apercu = x.Arguments.GetValueOrDefault("apercu") is JsonValue a && a.TryGetValue<bool>(out var b) && b;
        var requete = string.Join("&", new[] { ("service", filtre.Service), ("famille", filtre.Famille), ("chapitre", filtre.Chapitre), ("etiquette", filtre.Etiquette) }
            .Where(p => p.Item2 is not null).Select(p => $"{p.Item1}={Uri.EscapeDataString(p.Item2!)}"));
        var selection = (await AppelAsync(x, "GET", Chemin(RouteSelection, marche, requete), null, ct)) as JsonObject ?? [];
        var commandes = selection["commandes"] as JsonArray ?? [];
        var resultat = new JsonObject { ["marche_id"] = marche, ["apercu"] = apercu, ["selection"] = commandes.DeepClone(), ["ordres"] = new JsonArray() };
        if (apercu) return resultat;
        var aTransformer = commandes.OfType<JsonObject>()
            .Select(c => (Id: c["ent_id"]!.GetValue<long>(), Lignes: (c["lignes"] as JsonArray ?? []).OfType<JsonObject>()
                .Where(l => l["retenue"]?.GetValue<bool>() == true).Select(l => l["lig_id"]!.GetValue<long>()).ToList()))
            .Where(c => c.Lignes.Count > 0).ToList();
        if (aTransformer.Count == 0) throw new ErreurOutilMcp(422, ErreursMcpBtp.AucuneLigne, "Aucune ligne retenue par le filtre", resultat);
        var ordre = await LireAsync<DefinitionType>(x, Chemin(RouteDefinition, TypesDocument.EOe), ct);
        var ordres = (JsonArray)resultat["ordres"]!;
        foreach (var (id, lignes) in aTransformer)
        {
            // Transformation existante (droits TRANSFORMER de la commande et CREER de l'ordre, reliquats, liens) limitée aux lignes retenues.
            var corps = new JsonObject
            {
                ["cible_tyd_id"] = ordre.Type.TydId,
                ["lignes"] = new JsonArray([.. lignes.Select(l => (JsonNode?)new JsonObject { ["lig_id"] = l })]),
            };
            var cree = (await AppelAsync(x, "POST", Chemin(RouteTransformer, id), corps, ct)).Deserialize<DocumentCompletBtp>(OperationsLignesBtp.Json)
                ?? throw new EchecAppel(new ReponseInterne(500, ""));
            var resume = await ResumeAsync(x, cree, null, ordre, ct);
            resume["commande_id"] = id;
            resume["lignes_retenues"] = lignes.Count;
            ordres.Add(resume);
        }
        return resultat;
    });

    /// <summary>
    /// preparer_demandes_appro : ordre d'exécution validé → demande d'appro brouillon (tout le reliquat), puis articles gérés en stock
    /// passés dans l'unité de stock quand l'article donne la conversion (quantité, prix d'achat ; liens convertis par le serveur,
    /// UNITE_TRANSFORMEE) ; lignes sans conversion (STK_UNITE à la validation) ou à quantité de métré : laissées et signalées.
    /// </summary>
    public static Task<ReponseInterne> PreparerDemandesAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var id = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("id")) ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Ordre d'exécution attendu (id)");
        var ordre = await LireAsync<DefinitionType>(x, Chemin(RouteDefinition, TypesDocument.EOe), ct);
        var demande = await LireAsync<DefinitionType>(x, Chemin(RouteDefinition, TypesDocument.EDap), ct);
        var source = await LireAsync<DocumentCompletBtp>(x, Chemin(RouteDocument, id), ct);
        if (source.Document.EntTydId != ordre.Type.TydId) throw new ErreurOutilMcp(422, ErreursMcpBtp.TypeNonPermis, $"Le document {id} n'est pas un ordre d'exécution");
        var cree = (await AppelAsync(x, "POST", Chemin(RouteTransformer, id), new JsonObject { ["cible_tyd_id"] = demande.Type.TydId }, ct))
            .Deserialize<DocumentCompletBtp>(OperationsLignesBtp.Json) ?? throw new EchecAppel(new ReponseInterne(500, ""));
        var dap = cree.Document.EntId;
        var unites = (await AppelAsync(x, "GET", Chemin(RouteUnitesStock, dap), null, ct)) as JsonArray ?? [];
        var parLigne = unites.OfType<JsonObject>().ToDictionary(u => u["lig_id"]!.GetValue<long>());
        var converties = new JsonArray();
        var nonConverties = new JsonArray();
        void Convertir(DocumentCompletBtp d)
        {
            foreach (var l in d.Lignes)
            {
                if (!parLigne.TryGetValue(l.LigId, out var u) || u["en_stock"]?.GetValue<bool>() == true) continue;
                var info = new JsonObject { ["lig_id"] = l.LigId, ["code"] = u["code"]?.DeepClone(), ["unite"] = l.LigUntCode, ["unite_stock"] = u["unite_stock"]?.DeepClone() };
                if (u["facteur"] is not JsonValue fv || !fv.TryGetValue<decimal>(out var facteur) || facteur <= 0)
                {
                    info["motif"] = StkUnite;
                    nonConverties.Add(info);
                    continue;
                }
                if (l.LigMtrId is not null || l.LigQteSource != "S")
                {
                    info["motif"] = MetreLie;
                    nonConverties.Add(info);
                    continue;
                }
                var precision = u["precision"]?.GetValue<int>() ?? 2;
                info["qte"] = l.LigQte;
                l.LigQte = l.LigQte is decimal q ? ArrondiCalcul.Arrondir(q * facteur, precision) : null;
                if (l.LigPa is decimal pa) l.LigPa = ArrondiCalcul.Arr6(pa / facteur);
                l.LigUntCode = u["unite_stock"]!.GetValue<string>();
                info["qte_stock"] = l.LigQte;
                converties.Add(info);
            }
        }
        var aConvertir = parLigne.Values.Any(u => u["en_stock"]?.GetValue<bool>() != true);
        var resume = aConvertir
            ? await ModifierAsync(x, dap, cree.Document.EntVersion, null, demande, ct, Convertir)
            : await ResumeAsync(x, cree, null, demande, ct);
        resume["ordre_id"] = id;
        resume["unites_converties"] = converties;
        resume["unites_non_converties"] = nonConverties;
        return resume;
    });
}
