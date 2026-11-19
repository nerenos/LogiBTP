using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Bibliotheque;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle;

namespace LogiBTP.Api.Reprise;

/// <summary>Aides communes des domaines de bibliothèque.</summary>
internal static class SourcesBibliotheque
{
    /// <summary>
    /// Ordre de reprise des éléments : non composés d'abord, puis ouvrages après leurs composantes (parcours en
    /// profondeur ; un cycle est rompu à la seconde visite).
    /// </summary>
    public static List<string> Ordre(IEnumerable<string> cles, IReadOnlyDictionary<string, List<string>> composants)
    {
        var ordre = new List<string>();
        var vus = new HashSet<string>(StringComparer.Ordinal);
        void Visiter(string cle)
        {
            if (!vus.Add(cle)) return;
            foreach (var c in composants.GetValueOrDefault(cle) ?? []) Visiter(c);
            ordre.Add(cle);
        }
        var liste = cles.ToList();
        foreach (var c in liste.Where(c => !composants.ContainsKey(c))) Visiter(c);
        foreach (var c in liste) Visiter(c);
        return ordre;
    }

    public static string? Html(string? texte) => Rtf.HtmlDe(texte) is { Length: > 0 } h ? h : null;
}

/// <summary>
/// Bibliothèque MDE (plan reprise-mde-optim, lot 8) : natures (PMENATUREELEMENT, regroupement par la table
/// « regroupement_nature »), bibliothèques (PMEBIBLIO), familles (PMEFAMILLE), éléments hors sommeil (PMEELEMENT ;
/// type par la composition, sinon la table « type_element »), compositions (PMEELEMENTOUVCOMP), unités de vente
/// (PMEELEMENTUNITEVTE), tarifs fournisseurs (PMEELEMENTARTFOUR ⋈ PMEFOURNISSEURTARIF). Perte d'un article : DEBOURSE / PA.
/// </summary>
public sealed class BibliothequeMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Bibliotheque;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Referentiels, DomainesReprise.Codes.Annuaire];

    public const string Nature = "PMENATUREELEMENT";
    public const string Bibliotheque = "PMEBIBLIO";
    public const string Famille = "PMEFAMILLE";
    public const string Element = "PMEELEMENT";
    public const string Technique = "PMEELEMENTARTTEC";
    public const string Fournisseur = "PMEFOURNISSEUR";

    private const string RequeteTarifs = """
        SELECT A.CODEART, A.PRINCIPAL, A.CODEFOUR, A.PAPUBLIC, A.REMISEFOUR1, A.REMISEFOUR2, A.PANET, A.UNITEACHAT, A.RATIO, A.DATETARIF,
               T.REFERENCE AS T_REFERENCE, T.LIBELLE AS T_LIBELLE
        FROM PMEELEMENTARTFOUR A LEFT JOIN PMEFOURNISSEURTARIF T ON T.CLE = A.CLETARIFFOUR ORDER BY A.CODEART, A.NUMORDRE, A.CLE
        """;

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var cibles = await ReferentielsCible.LireAsync(ctx, ct);
        var b = await BibliothequeReprise.LireAsync(ctx, cibles, SourceReprise.Mde, ct);

        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT CLE, TYPEELEM, ABREVIATION, LIBELLE, ACTIF FROM PMENATUREELEMENT ORDER BY NUMORDRE, CLE", ct))
        {
            var regle = ctx.Correspondre(TablesCorrespondance.RegroupementNature, l.Texte("TYPEELEM"), $"{Nature} {l.Texte("CLE")}");
            await cibles.NatureAsync(Nature, l.Texte("CLE")!, l.Texte("ABREVIATION") ?? l.Texte("CLE")!, l.Texte("LIBELLE") ?? l.Texte("CLE")!,
                regle is { Ignorer: false } ? regle.Cible : null, l.Booleen("ACTIF") != false, ct);
        }

        // MDE n'a pas de bibliothèque par défaut : celle qui a le plus d'éléments hors sommeil.
        var premiere = true;
        foreach (var l in await SqlReprise.SourceAsync(ctx, """
                     SELECT B.CODE, B.LIBELLE, (SELECT COUNT(*) FROM PMEELEMENT E WHERE E.CODEBIBLIO = B.CODE AND E.SOMMEIL = 0) AS NB
                     FROM PMEBIBLIO B ORDER BY NB DESC, B.CODE
                     """, ct))
        {
            await b.BibliothequeAsync(Bibliotheque, l.Texte("CODE")!, l.Texte("CODE"), l.Texte("LIBELLE"), premiere, true, ct);
            premiere = false;
        }

        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT CODE, CODEBIBLIO, LIBELLE, NIVEAU, CODEPARENT FROM PMEFAMILLE ORDER BY NIVEAU, CODE", ct))
        {
            if (ctx.Registre.Trouver(Bibliotheque, l.Texte("CODEBIBLIO")) is not { } bib) { var v = ctx.Rapport.Volume(Famille); v.Lues++; v.Ecartees++; continue; }
            await b.FamilleAsync(Famille, l.Texte("CODE")!, bib, ctx.Registre.Trouver(Famille, l.Texte("CODEPARENT")), l.Texte("CODE"), l.Texte("LIBELLE"), ct);
        }

        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEELEMENT ORDER BY CODE", ct))
            .ToDictionary(l => l.Texte("CODE")!, StringComparer.Ordinal);
        var composantes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEELEMENTOUVCOMP WHERE SOMMEIL = 0 ORDER BY CODEOUV, NUMORDRE", ct))
            .GroupBy(c => c.Texte("CODEOUV")!).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var unitesVente = (await SqlReprise.SourceAsync(ctx, "SELECT CODEART, UNITE, EQUIVSTOCK FROM PMEELEMENTUNITEVTE ORDER BY CODEART, NUMORDRE", ct))
            .GroupBy(c => c.Texte("CODEART")!).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var techniques = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEELEMENTARTTEC ORDER BY CODEART", ct))
            .Where(t => t.Texte("CODEART") is not null).ToDictionary(t => t.Texte("CODEART")!, StringComparer.Ordinal);
        var tarifs = (await SqlReprise.SourceAsync(ctx, RequeteTarifs, ct))
            .GroupBy(c => c.Texte("CODEART")!).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        string? Unite(string? code) => code is null ? null : ctx.Registre.TrouverCode(RegistreMde.Unite, code.Trim());
        decimal Perte(LigneSource e) => e.Decimal("PA") is > 0 and var pa && e.Decimal("DEBOURSE") is > 0 and var deb
            ? ArrondiCalcul.Arr6(deb / pa) : BibliothequeReprise.CoefPerte(e.Decimal("COEFPERTE"));

        var volume = ctx.Rapport.Volume(Element);
        var actifs = lignes.Values.Where(l => l.Booleen("SOMMEIL") != true).Select(l => l.Texte("CODE")!).ToList();
        foreach (var _ in lignes.Values.Where(l => l.Booleen("SOMMEIL") == true)) { volume.Lues++; volume.Ecartees++; }
        var retenus = actifs.ToHashSet(StringComparer.Ordinal);
        var composants = composantes.ToDictionary(kv => kv.Key, kv => kv.Value.Select(c => c.Texte("CODECOMPO")).OfType<string>().Where(retenus.Contains).ToList(),
            StringComparer.Ordinal);
        var typesElement = ctx.Correspondances.Tables[TablesCorrespondance.TypeElement];

        foreach (var cle in SourcesBibliotheque.Ordre(actifs, composants))
        {
            var l = lignes[cle];
            if (ctx.Registre.Trouver(Bibliotheque, l.Texte("CODEBIBLIO")) is not { } bib) { volume.Lues++; volume.Ecartees++; continue; }
            var compos = composantes.GetValueOrDefault(cle) ?? [];
            var type = TypeElement.Article;
            if (compos.Count > 0) type = TypeElement.Ouvrage;
            else if (typesElement.Trouver(l.Texte("TYPEELEM")) is { Ignorer: false, Cible: { } t } entree)
            {
                type = t;
                ctx.Rapport.Appliquer(TablesCorrespondance.TypeElement, entree.Source, t);
            }

            var stock = Unite(l.Texte("UNITESTOCK"));
            var achat = Unite(l.Texte("UNITEACHAT"));
            var vente = Unite(l.Texte("UNITEVENTE"));
            var conversions = new List<(string, decimal)>();
            if (achat is not null && l.Decimal("RATIOSTOCK") is > 0 and var rs) conversions.Add((achat, rs));
            // RATIOSTOCK : unités de stock pour 1 unité d'achat (sens de LogiBTP) ; RATIOVENTE : unités de vente pour 1 unité
            // de stock (1 barre = 141,57 kg), donc inversé (1 kg = 0,007064 barre).
            if (vente is not null && l.Decimal("RATIOVENTE") is > 0 and var rv) conversions.Add((vente, ArrondiCalcul.Arr6(1 / rv)));
            foreach (var u in unitesVente.GetValueOrDefault(cle) ?? [])
                if (Unite(u.Texte("UNITE")) is { } uv && u.Decimal("EQUIVSTOCK") is > 0 and var eq) conversions.Add((uv, eq));

            var lesTarifs = new List<TarifSource>();
            foreach (var t in tarifs.GetValueOrDefault(cle) ?? [])
            {
                var unite = Unite(t.Texte("UNITEACHAT"));
                if (unite is not null && t.Decimal("RATIO") is > 0 and var ratio) conversions.Add((unite, ratio));
                lesTarifs.Add(new TarifSource
                {
                    FournisseurPerId = ctx.Registre.Trouver(Fournisseur, t.Texte("CODEFOUR")), Fournisseur = null,
                    Reference = t.Texte("T_REFERENCE") ?? l.Texte("REFERENCE"), Libelle = t.Texte("T_LIBELLE"), Unite = unite,
                    PrixPublic = t.Decimal("PAPUBLIC"), Remise1 = BibliothequeReprise.RemisePct(t.Decimal("REMISEFOUR1")),
                    Remise2 = BibliothequeReprise.RemisePct(t.Decimal("REMISEFOUR2")), PrixNet = t.Decimal("PANET"),
                    Principal = t.Booleen("PRINCIPAL") == true || t.Texte("CODEFOUR") is { } f && f == l.Texte("CODEFOURPRINC"),
                    Debut = SourcesRessources.Jour(t, "DATETARIF"),
                });
            }

            var gestion = l.Booleen("GESTSTOCK") == true ? GestionElement.Stock
                : l.Texte("CODESSTPRINC") is not null ? GestionElement.SousTraitance
                : l.Texte("CODEFOURPRINC") is not null || lesTarifs.Count > 0 ? GestionElement.Achat : GestionElement.NonGere;
            var eleId = await b.ElementAsync(new ElementSource
            {
                Origine = (Element, cle), BibId = bib, Code = cle, Type = type,
                LibelleHtml = SourcesBibliotheque.Html(l.Texte("LIBELLECOM")) ?? SourcesBibliotheque.Html(l.Texte("LIBELLE")),
                Libelle = l.Texte("LIBELLE"), DescriptionHtml = SourcesBibliotheque.Html(l.Texte("LIBELLETEC")),
                FamId = ctx.Registre.Trouver(Famille, l.Texte("CODEFAMILLE")), NatId = ctx.Registre.Trouver(Nature, l.Texte("CLENATURE")),
                Gestion = gestion, UniteStock = stock, UniteAchat = achat, UniteVente = vente, Conversions = conversions,
                Pa = l.Decimal("PA"), CoefFg = l.Decimal("COEFFG"), CoefBenef = l.Decimal("COEFBEN"),
                PvSource = l.Decimal("PV"), PvImpose = l.Booleen("OPTIONPVIMPOSE") == true, CoefPerte = Perte(l),
                TvaCode = b.CodeTva(ctx.Registre.Trouver(RegistreMde.Tva, RegistreMde.CleTva(l.Texte("CATEGORIE"), l.Texte("TVA")))),
                CompteVente = l.Texte("COMPTEVENTE"), CodeBarre = l.Texte("CODEBARRE"), Tarifs = lesTarifs,
                Modes = [ModeOuvrage.Debourse, ModeOuvrage.Vente],
                Composantes = compos.Select(c =>
                {
                    var composant = c.Texte("CODECOMPO");
                    var source = composant is not null ? lignes.GetValueOrDefault(composant) : null;
                    var perte = source is null ? 1m : Perte(source);
                    var qte = c.Decimal("QUANTITEUNIT") is { } qu && qu != 0 ? qu : c.Decimal("QUANTITEBASE") ?? 0;
                    return new ComposanteSource
                    {
                        Composant = composant is null ? null : (Element, composant),
                        LibelleHtml = SourcesBibliotheque.Html(c.Texte("LIBELLECOM")) ?? SourcesBibliotheque.Html(c.Texte("LIBELLE"))
                                      ?? SourcesBibliotheque.Html(source?.Texte("LIBELLE")),
                        Unite = Unite(c.Texte("UNITE")), Quantite = qte, CoefPerte = perte,
                        Pa = ArrondiCalcul.Arr6((c.Decimal("DEBOURSE") ?? 0) / perte),
                        CoefFg = c.Decimal("COEFFG"), CoefBenef = c.Decimal("COEFBEN"), NatId = ctx.Registre.Trouver(Nature, c.Texte("CLENATURE")),
                    };
                }).ToList(),
            }, ct);
            if (eleId is { } id && techniques.GetValueOrDefault(cle) is { } tec) await TechniquesAsync(ctx, id, tec, ct);
        }
    }

    /// <summary>
    /// Données techniques (PMEELEMENTARTTEC) par unité de stock : longueur, largeur, hauteur en m (en mm dans LogiBTP), poids
    /// en kg, VOLUME en m² (surface, défaut : MDE s'en sert comme d'une surface) ou en m³ selon l'option de la reprise.
    /// Unités UNITE* renseignées : non converties (valeurs lues dans l'unité par défaut), signalées.
    /// </summary>
    private static async Task TechniquesAsync(ContexteReprise ctx, long eleId, LigneSource t, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(Technique);
        volume.Lues++;
        decimal? Valeur(string c) => t.Decimal(c) is { } v && v != 0 ? v : null;
        decimal? Mm(string c) => Valeur(c) is { } v ? ArrondiCalcul.Arr6(v * 1000) : null;
        foreach (var u in new[] { "UNITELONG", "UNITELARG", "UNITEHAUT", "UNITEPOIDS", "UNITEVOL" })
            if (t.Texte(u) is { } code)
                ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.UniteTechnique, $"{Technique} {t.Texte("CODEART")}",
                    $"{u} = « {code} » : valeur reprise dans l'unité par défaut (m, m², kg), à vérifier");
        var (longueur, largeur, hauteur, poids, vol) = (Mm("LONGUEUR"), Mm("LARGEUR"), Mm("HAUTEUR"), Valeur("POIDS"), Valeur("VOLUME"));
        if (longueur is null && largeur is null && hauteur is null && poids is null && vol is null) { volume.Ecartees++; return; }
        if (ctx.Options.VolumeMde == VolumeMde.Volume)
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                UPDATE element SET ele_longueur = $2, ele_largeur = $3, ele_hauteur = $4, ele_poids = $5, ele_volume = $6 WHERE ele_id = $1
                """, ct, (int)eleId, longueur, largeur, hauteur, poids, vol);
        else
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                UPDATE element SET ele_longueur = $2, ele_largeur = $3, ele_hauteur = $4, ele_poids = $5, ele_surface = $6 WHERE ele_id = $1
                """, ct, (int)eleId, longueur, largeur, hauteur, poids, vol);
        volume.Ecrites++;
    }
}

/// <summary>
/// Bibliothèque OPTIM (lot 8) : bibliothèques (bib_bibliotheque), familles (bib_type_prod_prest), articles hors
/// désactivés (bib_article ; textes en éléments TEXTE, Q7), compositions (bib_article_lien_ouvrage), tarifs
/// (bib_article_lien_tarif : tarif de référence = PA et PV, tarifs d'un tiers = tarifs fournisseurs). Natures reprises au lot 4.
/// </summary>
public sealed class BibliothequeOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Bibliotheque;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Referentiels, DomainesReprise.Codes.Annuaire];

    public const string Bibliotheque = "bib_bibliotheque";
    public const string Famille = "bib_type_prod_prest";
    public const string Article = "bib_article";

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var cibles = await ReferentielsCible.LireAsync(ctx, ct);
        var b = await BibliothequeReprise.LireAsync(ctx, cibles, SourceReprise.Optim, ct);

        long? defaut = null;
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM bib_bibliotheque ORDER BY BIB_IsDefaut DESC, BIB_ID", ct))
        {
            var id = await b.BibliothequeAsync(Bibliotheque, l.Texte("BIB_ID")!, l.Texte("BIB_Code"), l.Texte("BIB_Libelle"), defaut is null,
                l.Booleen("BIB_IsDesactive") != true, ct);
            defaut ??= id;
        }

        var familles = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM bib_type_prod_prest WHERE TPP_IsDesactive = 0 ORDER BY TPP_Niveau, TPP_ID", ct))
        {
            var bib = ctx.Registre.Trouver(Bibliotheque, l.Texte("TPP_BIB_ID")) ?? defaut;
            if (bib is null) { var v = ctx.Rapport.Volume(Famille); v.Lues++; v.Ecartees++; continue; }
            var parent = ctx.Registre.Trouver(Famille, l.Texte("TPP_TPP_ID"));
            familles[l.Texte("TPP_ID")!] = bib.Value;
            await b.FamilleAsync(Famille, l.Texte("TPP_ID")!, bib.Value, parent, l.Texte("TPP_Code"), l.Texte("TPP_Libelle"), ct);
        }

        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM bib_article ORDER BY ART_ID", ct)).ToDictionary(l => l.Texte("ART_ID")!, StringComparer.Ordinal);
        var composantes = (await SqlReprise.SourceAsync(ctx,
                "SELECT * FROM bib_article_lien_ouvrage WHERE coalesce(ARO_IsDesactive, 0) = 0 ORDER BY ARO_ART_ID_Ouvrage, ARO_Ordre, ARO_ID", ct))
            .GroupBy(c => c.Texte("ARO_ART_ID_Ouvrage")!).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var tarifs = (await SqlReprise.SourceAsync(ctx,
                "SELECT * FROM bib_article_lien_tarif WHERE ARL_IsDesactive = 0 AND coalesce(ARL_AFF_ID, 0) = 0 ORDER BY ARL_ART_ID, ARL_IsRef DESC, ARL_ID", ct))
            .GroupBy(c => c.Texte("ARL_ART_ID")!).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        string? Unite(string? id) => id is null or "0" ? null : ctx.Registre.TrouverCode(RegistreOptim.Unite, id);
        static decimal Net(LigneSource t) =>
            ArrondiCalcul.Arr6((t.Decimal("ARL_PrixAchat") ?? 0) * (1 - (BibliothequeReprise.RemisePct(t.Decimal("ARL_TxRemise")) ?? 0) / 100));

        var volume = ctx.Rapport.Volume(Article);
        var actifs = lignes.Values.Where(l => l.Booleen("ART_IsDesactive") != true).Select(l => l.Texte("ART_ID")!).ToList();
        foreach (var _ in lignes.Values.Where(l => l.Booleen("ART_IsDesactive") == true)) { volume.Lues++; volume.Ecartees++; }
        var retenus = actifs.ToHashSet(StringComparer.Ordinal);
        var composants = composantes.ToDictionary(kv => kv.Key,
            kv => kv.Value.Select(c => c.Texte("ARO_ART_ID_Composant")).OfType<string>().Where(retenus.Contains).ToList(), StringComparer.Ordinal);

        foreach (var cle in SourcesBibliotheque.Ordre(actifs, composants))
        {
            var l = lignes[cle];
            var bib = ctx.Registre.Trouver(Bibliotheque, l.Texte("ART_BIB_ID")) ?? defaut;
            if (bib is null) { volume.Lues++; volume.Ecartees++; continue; }
            var compos = composantes.GetValueOrDefault(cle) ?? [];
            var type = l.Booleen("ART_IsTexte") == true ? TypeElement.Texte
                : l.Booleen("ART_IsOuvrage") == true || compos.Count > 0 ? TypeElement.Ouvrage : TypeElement.Article;
            var famille = new[] { l.Texte("ART_TPP_ID_SsFam"), l.Texte("ART_TPP_ID") }.FirstOrDefault(f => f is not null and not "0");
            long? famId = null;
            if (famille is not null && familles.TryGetValue(famille, out var bibFamille))
            {
                if (bibFamille == bib) famId = ctx.Registre.Trouver(Famille, famille);
                else ctx.Rapport.Perdre(Article, "ART_TPP_ID", famille, "Famille d'une autre bibliothèque");
            }

            var stock = Unite(l.Texte("ART_UNT_ID"));
            var lesTarifs = tarifs.GetValueOrDefault(cle) ?? [];
            var reference = lesTarifs.FirstOrDefault(t => t.Booleen("ARL_IsRef") == true) ?? lesTarifs.FirstOrDefault();
            var conversions = new List<(string, decimal)>();
            string? achat = null;
            var fournisseurs = new List<TarifSource>();
            foreach (var t in lesTarifs.Where(t => t.Id("ARL_TRS_ID") is not null))
            {
                if (Unite(t.Texte("ARL_UNT_IDConv")) is { } conv && t.Decimal("ARL_Conv") is > 0 and var ratio)
                {
                    conversions.Add((conv, ratio));
                    achat ??= conv;
                }
                var trs = t.Texte("ARL_TRS_ID")!;
                fournisseurs.Add(new TarifSource
                {
                    FournisseurPerId = ctx.Registre.Trouver(RegistreOptim.Tiers, ctx.CleConservee(RegistreOptim.Tiers, trs)),
                    // Prix de la source par unité de l'article ; l'unité de conversion n'est qu'une unité d'achat déclarée.
                    Reference = t.Texte("ARL_REFERENCE"), Libelle = t.Texte("ARL_Commentaire"), Unite = stock,
                    PrixPublic = t.Decimal("ARL_PrixAchat"), Remise1 = BibliothequeReprise.RemisePct(t.Decimal("ARL_TxRemise")), PrixNet = Net(t),
                    Principal = t == reference || t.Booleen("ARL_IsRef") == true,
                });
            }
            var pa = reference is null ? 0 : Net(reference);
            decimal? pv = reference?.Decimal("ARL_PrixVente") is > 0 and var p ? p : null;

            await b.ElementAsync(new ElementSource
            {
                Origine = (Article, cle), BibId = bib.Value, Code = l.Texte("ART_Code"), Type = type,
                LibelleHtml = l.Texte("ART_LibelleHTML") ?? SourcesBibliotheque.Html(l.Texte("ART_LibelleRTF")) ?? SourcesBibliotheque.Html(l.Texte("ART_Libelle")),
                Libelle = l.Texte("ART_Libelle"), DescriptionHtml = SourcesBibliotheque.Html(l.Texte("ART_LibTech")),
                FamId = famId, NatId = ctx.Registre.Trouver(RegistreOptim.Nature, l.Texte("ART_FTY_ID")),
                Gestion = fournisseurs.Count > 0 ? GestionElement.Achat : GestionElement.NonGere,
                UniteStock = stock, UniteAchat = achat, Conversions = conversions,
                // PV de référence retrouvé par le coefficient de bénéfice (PV / PA), imposé s'il est en montant fixe.
                Pa = pa, CoefFg = 1, CoefBenef = pv is { } v && pa > 0 ? ArrondiCalcul.Arr6(v / pa) : 1, PvSource = pv,
                PvImpose = reference?.Booleen("ARL_IsMtFixe") == true || type == TypeElement.Article && pv is not null && pa == 0,
                CoefPerte = BibliothequeReprise.CoefPerte(l.Decimal("ART_CoefPerte")),
                TvaCode = b.CodeTva(ctx.Registre.Trouver(RegistreOptim.Tva, l.Texte("ART_PRM_TVA"))),
                CodeBarre = l.Texte("ART_CodeBarre"), DelaiLivraison = (int?)l.Entier("ART_DelaiLivr"), Tarifs = fournisseurs,
                Modes = [ModeOuvrage.Vente],
                Composantes = compos.Select(c => new ComposanteSource
                {
                    Composant = (Article, c.Texte("ARO_ART_ID_Composant") ?? ""),
                    LibelleHtml = lignes.GetValueOrDefault(c.Texte("ARO_ART_ID_Composant") ?? "") is { } s
                        ? s.Texte("ART_LibelleHTML") ?? SourcesBibliotheque.Html(s.Texte("ART_Libelle")) : null,
                    Quantite = c.Decimal("ARO_Qte") ?? 0, Absolue = c.Booleen("ARO_QteFixe") == true,
                    CoefPerte = c.Decimal("ARO_CoefPerte") is > 0 and var cp ? BibliothequeReprise.CoefPerte(cp) : null,
                }).ToList(),
            }, ct);
        }
    }
}
