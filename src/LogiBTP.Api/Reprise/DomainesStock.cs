using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>Consommation de fourniture hors pièce (Q15) : sortie d'un article du lieu de stock vers un chantier.</summary>
public sealed record ConsommationReprise(int ChaId, DateOnly Date, long EleId, int? LieuId, decimal Qte, decimal? Prix, int? NatId,
    string? Libelle, string Emplacement);

/// <summary>
/// Stock et consommations reprises (plan reprise-mde-optim, lot 14, Q15 et Q18) : inventaire d'ouverture (un comptage
/// par article et par lieu à la date de reprise, sans historique des mouvements ; prix de la source sinon PA de l'article) ;
/// lieux = chantiers (dépôt sans chantier → premier dépôt géré, INT-DEPOT ; chantier interne → dépôt géré ; autre chantier
/// → stock tenu) ; consommations de fournitures hors pièce en sorties de stock validées (une par chantier, lieu et mois,
/// mouvements datés du jour de la source, antérieurs à l'inventaire : seul le coût du chantier en Rentabilité les voit) ;
/// heures de matériel hors pièce en pointages de matériel (source IMPORT).
/// </summary>
public sealed class StockReprise
{
    public const string TableSortie = "reprise_consommation";
    public const string SourceImport = "IMPORT";
    public const string CommentaireInventaire = "Inventaire d'ouverture (reprise)";

    private readonly ContexteReprise ctx;
    private readonly int? depotDefaut;
    private readonly Dictionary<long, (string? Code, string? Libelle, string? Unite, int? NatId)> elements;
    private readonly Dictionary<(long Ele, int Lieu), (decimal Qte, decimal? Prix)> inventaire = [];
    private readonly Dictionary<(int Cha, int Lieu, int Annee, int Mois), List<ConsommationReprise>> sorties = [];
    private readonly HashSet<int> lieux = [];

    private StockReprise(ContexteReprise ctx, int? depotDefaut, Dictionary<long, (string?, string?, string?, int?)> elements)
    {
        this.ctx = ctx;
        this.depotDefaut = depotDefaut;
        this.elements = elements;
    }

    public static async Task<StockReprise> OuvrirAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var depot = (await SqlReprise.LireAsync(ctx.Unite, "SELECT cha_id FROM chantier WHERE cha_depot ORDER BY cha_interne DESC, cha_id LIMIT 1",
            r => r.GetInt32(0), ct)).Cast<int?>().FirstOrDefault();
        var elements = (await SqlReprise.LireAsync(ctx.Unite, "SELECT ele_id, ele_code, ele_libelle, ele_unt_stock, ele_nat_id FROM element",
                r => (Id: r.GetInt64(0), Code: r.IsDBNull(1) ? null : r.GetString(1), Libelle: r.IsDBNull(2) ? null : r.GetString(2),
                    Unite: r.IsDBNull(3) ? null : r.GetString(3), Nat: r.IsDBNull(4) ? (int?)null : r.GetInt32(4)), ct))
            .ToDictionary(e => e.Id, e => (e.Code, e.Libelle, e.Unite, e.Nat));
        return new StockReprise(ctx, depot, elements);
    }

    /// <summary>Dépôt par défaut (premier dépôt géré, INT-DEPOT d'une base neuve).</summary>
    public int? DepotDefaut => depotDefaut;

    /// <summary>Lieu de stock d'un chantier repris : marqué dépôt géré (chantier interne) ou stock tenu (chantier).</summary>
    public async Task<int> LieuAsync(int chaId, CancellationToken ct)
    {
        if (lieux.Add(chaId))
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                UPDATE chantier SET cha_depot = cha_depot OR cha_interne, cha_stock_tenu = cha_stock_tenu OR NOT cha_interne
                WHERE cha_id = $1 AND NOT cha_depot
                """, ct, chaId);
        return chaId;
    }

    /// <summary>Quantité en stock de la source : cumulée par article et par lieu (lots, tailles et couleurs confondus).</summary>
    public void Inventorier(long eleId, int lieuId, decimal qte, decimal? prix)
    {
        if (qte == 0) return;
        var k = (eleId, lieuId);
        var (q, p) = inventaire.GetValueOrDefault(k);
        inventaire[k] = (q + qte, prix ?? p);
    }

    public void Consommer(ConsommationReprise c, int lieuId) =>
        (sorties.TryGetValue((c.ChaId, lieuId, c.Date.Year, c.Date.Month), out var l) ? l : sorties[(c.ChaId, lieuId, c.Date.Year, c.Date.Month)] = []).Add(c);

    /// <summary>Heures d'un matériel sur un chantier, un jour (consommation hors pièce).</summary>
    public async Task PointerMaterielAsync(int matId, int chaId, DateOnly date, int minutes, string? commentaire, CancellationToken ct) =>
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO pointage_materiel (pma_mat_id, pma_cha_id, pma_date, pma_minutes, pma_commentaire, pma_par, pma_source)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, ct, matId, chaId, date, minutes, PiecesReprise.Couper(commentaire, 250), ctx.Options.Auteur ?? "reprise", SourceImport);

    /// <summary>Inventaire d'ouverture (stk_comptage) puis sorties de stock des consommations.</summary>
    public async Task TerminerAsync(CancellationToken ct)
    {
        var date = new DateTimeOffset(ctx.Options.DateReprise.ToDateTime(new TimeOnly(23, 59)), TimeSpan.Zero);
        var volume = ctx.Rapport.Volume("stk_comptage");
        foreach (var ((ele, lieu), (qte, prix)) in inventaire)
        {
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                INSERT INTO stk_comptage (cpt_ele_id, cpt_lieu_id, cpt_date, cpt_quantite, cpt_prix, cpt_commentaire, cpt_par)
                VALUES ($1, $2, $3, $4, coalesce($5, (SELECT ele_pa FROM element WHERE ele_id = $1)), $6, $7)
                """, ct, ele, lieu, date, qte, prix, CommentaireInventaire, ctx.Options.Auteur ?? "reprise");
            volume.Ecrites++;
        }
        if (sorties.Count == 0) return;
        await using var pieces = await PiecesReprise.OuvrirAsync(ctx, ct);
        var mouvements = ctx.Rapport.Volume("stk_mouvement");
        foreach (var ((cha, lieu, annee, mois), lignes) in sorties.OrderBy(s => (s.Key.Annee, s.Key.Mois, s.Key.Cha)))
        {
            var cle = $"{cha}-{lieu}-{annee:0000}{mois:00}";
            var source = lignes.Select((c, i) =>
            {
                var e = elements.GetValueOrDefault(c.EleId);
                return new LignePiece
                {
                    Cle = i.ToString(), Type = TL.Element, Code = e.Code, Qte = c.Qte, PrecisionQte = 6, Unite = e.Unite,
                    LibelleHtml = System.Net.WebUtility.HtmlEncode(c.Libelle ?? e.Libelle ?? ""), NatId = c.NatId ?? e.NatId, Pa = c.Prix ?? 0,
                    ChantierId = cha,
                };
            }).ToList();
            var ent = await pieces.EcrireAsync(new PieceSource
            {
                Origine = (TableSortie, cle), TypeDocument = TypesDocument.SSortie, Numero = $"REP-{annee:0000}{mois:00}-{cha}",
                Date = lignes.Max(c => c.Date), Objet = $"Consommations reprises {mois:00}/{annee:0000}", ChantierId = cha,
                Statut = PiecesReprise.Statut.Valide, Verrouille = true, Lignes = source,
            }, ct);
            if (ent is not long entId) continue;
            await SqlReprise.ExecuterAsync(ctx.Unite, "UPDATE document SET ent_stk_origine_id = $1 WHERE ent_id = $2", ct, lieu, entId);
            var ligIds = await SqlReprise.LireAsync(ctx.Unite,
                "SELECT lig_id FROM document_ligne WHERE lig_ent_id = $1 AND lig_parent_id IS NULL ORDER BY lig_ordre", r => r.GetInt64(0), ct, entId);
            foreach (var (c, lig) in lignes.Zip(ligIds))
            {
                await SqlReprise.ExecuterAsync(ctx.Unite, """
                    INSERT INTO stk_mouvement (mvt_ele_id, mvt_lieu_id, mvt_date, mvt_quantite, mvt_prix, mvt_ent_id, mvt_lig_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """, ct, c.EleId, lieu, new DateTimeOffset(c.Date.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero), -c.Qte, c.Prix, entId, lig);
                mouvements.Ecrites++;
            }
        }
        await pieces.TerminerAsync(ct);
    }
}

/// <summary>
/// Stock MDE (lot 14) : PMESTOCKREEL par dépôt (PMEDEPOT : chantier du dépôt, sinon dépôt par défaut) en inventaire
/// d'ouverture ; PMECHTSUIVFO sans pièce d'origine (TYPEORIG, BLORIG, BRORIG, BSORIG, FACORIG, MVTORIG, CLELIGORIG vides ;
/// les bons de régie CLEREGIEORIG en sont) en sorties de stock ; PMECHTSUIVMAT en heures de matériel (DUREE en heures).
/// PMECHTSUIVREGIE n'est pas lu : ses fournitures, matériels et heures sont recopiés dans les tables de suivi.
/// </summary>
public sealed class StockMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Stock;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Ressources, DomainesReprise.Codes.Structure, DomainesReprise.Codes.Bibliotheque];

    public const string Depot = "PMEDEPOT";
    public const string StockReel = "PMESTOCKREEL";
    public const string SuiviFournitures = "PMECHTSUIVFO";
    public const string SuiviMateriel = "PMECHTSUIVMAT";

    private static readonly string[] Origines = ["TYPEORIG", "BLORIG", "BRORIG", "BSORIG", "FACORIG", "MVTORIG", "CLELIGORIG"];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var s = await StockReprise.OuvrirAsync(ctx, ct);
        var depots = new Dictionary<string, int?>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in await SqlReprise.SourceAsync(ctx, "SELECT CODE, CODECHT FROM PMEDEPOT", ct))
            depots[d.Texte("CODE")!] = (int?)ctx.Registre.Trouver(StructureMde.Chantier, d.Texte("CODECHT")) is int c ? await s.LieuAsync(c, ct) : s.DepotDefaut;
        int? Lieu(string? depot) => depot is not null && depots.TryGetValue(depot, out var l) ? l : s.DepotDefaut;

        var volume = ctx.Rapport.Volume(StockReel);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMESTOCKREEL", ct))
        {
            volume.Lues++;
            var ele = ctx.Registre.Trouver(BibliothequeMde.Element, l.Texte("CODEARTICLE"));
            if (ele is null || Lieu(l.Texte("CODEDEPOT")) is not int lieu || (l.Decimal("QUANTITE") ?? 0) == 0)
            {
                volume.Ecartees++;
                continue;
            }
            s.Inventorier(ele.Value, lieu, l.Decimal("QUANTITE")!.Value, null);
            volume.Ecrites++;
        }

        volume = ctx.Rapport.Volume(SuiviFournitures);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMECHTSUIVFO ORDER BY DATESUIVI, CLE", ct))
        {
            volume.Lues++;
            if (Origines.Any(o => l.Texte(o) is not null))
            {
                volume.Ecartees++;
                continue;
            }
            var emplacement = $"{SuiviFournitures} {l.Texte("CLE")}";
            var cha = (int?)ctx.Registre.Trouver(StructureMde.Chantier, l.Texte("CODECHT"));
            var ele = ctx.Registre.Trouver(BibliothequeMde.Element, l.Texte("CODEELEM"));
            var date = SourcesRessources.Jour(l, "DATESUIVI");
            var qte = l.Decimal("QTE") ?? 0;
            if (cha is null || ele is null || date is null || qte == 0 || Lieu(l.Texte("CODEDEPOT")) is not int lieu)
            {
                volume.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ConsommationNonReprise, emplacement,
                    ele is null ? "Fourniture sans article repris : non reprise" : "Chantier, date, quantité ou dépôt absent : non reprise");
                continue;
            }
            s.Consommer(new ConsommationReprise(cha.Value, date.Value, ele.Value, lieu, qte, l.Decimal("DEBUNIT") is { } p and not 0 ? p : null,
                (int?)ctx.Registre.Trouver(BibliothequeMde.Nature, l.Texte("CLENATURE")), l.Texte("LIBELLE"), emplacement), lieu);
            volume.Ecrites++;
        }

        volume = ctx.Rapport.Volume(SuiviMateriel);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMECHTSUIVMAT ORDER BY DATEDEB, CLE", ct))
        {
            volume.Lues++;
            var emplacement = $"{SuiviMateriel} {l.Texte("CLE")}";
            var cha = (int?)ctx.Registre.Trouver(StructureMde.Chantier, l.Texte("CODECHT"));
            var mat = (int?)ctx.Registre.Trouver(RessourcesMde.Materiel, l.Texte("CODEMAT"));
            var date = SourcesRessources.Jour(l, "DATEDEB");
            var minutes = ExploitationReprise.Minutes(l.Decimal("DUREE"));
            var heures = l.Texte("UNITE") is null or "H" or "h";
            if (cha is null || mat is null || date is null || minutes <= 0 || !heures)
            {
                volume.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ConsommationNonReprise, emplacement,
                    !heures ? $"Durée en unité « {l.Texte("UNITE")} » (heures attendues) : non reprise" : "Matériel, chantier, date ou durée absent : non reprise");
                continue;
            }
            await s.PointerMaterielAsync(mat.Value, cha.Value, date.Value, minutes, l.Texte("INFO"), ct);
            volume.Ecrites++;
        }
        await s.TerminerAsync(ct);
    }
}

/// <summary>
/// Stock OPTIM (lot 14) : bib_article_stock (ARS_QteStock ; lieu = chantier ARS_AchatStockAtelier, sinon dépôt par
/// défaut ; lignes désactivées écartées) en inventaire d'ouverture ; svc_rapport_conso sans pièce (RCS_DOE_ID, RCS_TRS_ID,
/// RCS_CPH_ID, RCS_VSI_ID, RCS_VDE_ID, RCS_VRV_ID nuls et RCS_Document vide ; ni projet ni désactivée) en sorties de
/// stock depuis le dépôt par défaut ; sans article : non reprise.
/// </summary>
public sealed class StockOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Stock;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Ressources, DomainesReprise.Codes.Structure, DomainesReprise.Codes.Bibliotheque];

    public const string ArticleStock = "bib_article_stock";
    public const string Consommation = "svc_rapport_conso";

    private static readonly string[] Pieces = ["RCS_DOE_ID", "RCS_TRS_ID", "RCS_CPH_ID", "RCS_VSI_ID", "RCS_VDE_ID", "RCS_VRV_ID"];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var s = await StockReprise.OuvrirAsync(ctx, ct);
        var volume = ctx.Rapport.Volume(ArticleStock);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM bib_article_stock", ct))
        {
            volume.Lues++;
            var ele = ctx.Registre.Trouver(BibliothequeOptim.Article, l.Texte("ARS_ART_ID"));
            var cha = (int?)ctx.Registre.Trouver(StructureOptim.Chantier, l.Texte("ARS_AchatStockAtelier"));
            int? lieu = cha is int c ? await s.LieuAsync(c, ct) : s.DepotDefaut;
            if (l.Booleen("ARS_IsDesactive") == true || ele is null || lieu is null || (l.Decimal("ARS_QteStock") ?? 0) == 0)
            {
                volume.Ecartees++;
                continue;
            }
            s.Inventorier(ele.Value, lieu.Value, l.Decimal("ARS_QteStock")!.Value, null);
            volume.Ecrites++;
        }

        volume = ctx.Rapport.Volume(Consommation);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM svc_rapport_conso ORDER BY RCS_Date, RCS_ID", ct))
        {
            volume.Lues++;
            if (Pieces.Any(p => (l.Entier(p) ?? 0) != 0) || l.Texte("RCS_Document") is not null
                || l.Booleen("RCS_IsProjet") == true || l.Booleen("RCS_IsDesactive") == true)
            {
                volume.Ecartees++;
                continue;
            }
            var emplacement = $"{Consommation} {l.Texte("RCS_ID")}";
            var cha = (int?)ctx.Registre.Trouver(StructureOptim.Chantier, l.Texte("RCS_CHT_ID"));
            var ele = ctx.Registre.Trouver(BibliothequeOptim.Article, l.Texte("RCS_ART_ID"));
            var date = SourcesRessources.Jour(l, "RCS_Date");
            var qte = l.Decimal("RCS_QUANTITE") ?? 0;
            if (cha is null || ele is null || date is null || qte == 0 || s.DepotDefaut is not int lieu)
            {
                volume.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ConsommationNonReprise, emplacement,
                    ele is null ? "Consommation sans article repris : non reprise" : "Chantier, date, quantité ou dépôt absent : non reprise");
                continue;
            }
            s.Consommer(new ConsommationReprise(cha.Value, date.Value, ele.Value, lieu, qte, l.Decimal("RCS_PrixUnitaire") is { } p and not 0 ? p : null,
                null, l.Texte("RCS_MateriauLib"), emplacement), lieu);
            volume.Ecrites++;
        }
        await s.TerminerAsync(ct);
    }
}
