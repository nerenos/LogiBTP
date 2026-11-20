using System.Globalization;
using System.Text.Json;
using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle;

namespace LogiBTP.Api.Reprise;

/// <summary>Tarif fournisseur d'un élément lu d'une source (plan reprise-mde-optim, lot 8).</summary>
public sealed record TarifSource
{
    public long? FournisseurPerId { get; init; }
    public string? Fournisseur { get; init; }
    public string? Reference { get; init; }
    public string? Libelle { get; init; }
    /// <summary>Unité du tarif (code cible) ; null : unité d'achat, sinon de stock de l'élément.</summary>
    public string? Unite { get; init; }
    public decimal? PrixPublic { get; init; }
    public decimal? Remise1 { get; init; }
    public decimal? Remise2 { get; init; }
    /// <summary>Prix net par unité du tarif (sinon prix public remisé).</summary>
    public decimal? PrixNet { get; init; }
    public bool Principal { get; init; }
    public DateOnly? Debut { get; init; }
}

/// <summary>Composante d'un ouvrage lue d'une source : élément repris (clé du registre) ou ligne libre.</summary>
public sealed record ComposanteSource
{
    /// <summary>Élément composant (table source, clé) ; null ou absent du registre : ligne sans lien vers la bibliothèque.</summary>
    public (string Table, string Cle)? Composant { get; init; }
    public string? LibelleHtml { get; init; }
    public string? Unite { get; init; }
    /// <summary>Quantité pour une unité d'ouvrage, avant perte.</summary>
    public decimal Quantite { get; init; }
    /// <summary>Quantité absolue (fixe pour l'ouvrage, « A ») plutôt que relative (« R »).</summary>
    public bool Absolue { get; init; }
    /// <summary>Coefficient de perte de la composante (Q9 : multiplie la quantité) ; null : celui de l'élément composant.</summary>
    public decimal? CoefPerte { get; init; }
    /// <summary>PA unitaire hors perte ; null : celui de l'élément composant.</summary>
    public decimal? Pa { get; init; }
    public decimal? CoefFg { get; init; }
    public decimal? CoefBenef { get; init; }
    public long? NatId { get; init; }
    /// <summary>Ligne de texte de la composition (libellé seul, ni quantité ni prix).</summary>
    public bool Texte { get; init; }
}

/// <summary>Élément de bibliothèque lu d'une source, forme commune MDE / OPTIM (lot 8).</summary>
public sealed record ElementSource
{
    /// <summary>Clé du registre : PMEELEMENT + CODE, bib_article + ART_ID.</summary>
    public required (string Table, string Cle) Origine { get; init; }
    public required long BibId { get; init; }
    public string? Code { get; init; }
    /// <summary>ARTICLE, OUVRAGE ou TEXTE (<see cref="TypeElement"/>).</summary>
    public string Type { get; init; } = TypeElement.Article;
    public string? LibelleHtml { get; init; }
    public string? Libelle { get; init; }
    public string? DescriptionHtml { get; init; }
    public long? FamId { get; init; }
    public long? NatId { get; init; }
    public string Gestion { get; init; } = GestionElement.NonGere;
    public string? UniteStock { get; init; }
    public string? UniteAchat { get; init; }
    public string? UniteVente { get; init; }
    /// <summary>Quantité en unité de stock pour 1 unité (unités d'achat, de vente et des tarifs).</summary>
    public List<(string Unite, decimal Ratio)> Conversions { get; init; } = [];
    public decimal? Pa { get; init; }
    public decimal? CoefFg { get; init; }
    public decimal? CoefBenef { get; init; }
    /// <summary>PV unitaire de la source : retrouvé par le calcul à 0,01 € près, sinon imposé (PV fixe).</summary>
    public decimal? PvSource { get; init; }
    /// <summary>PV imposé dans la source.</summary>
    public bool PvImpose { get; init; }
    /// <summary>Coefficient de perte de l'article (Q9) : appliqué aux quantités des composantes qui l'utilisent, gardé en donnée technique.</summary>
    public decimal CoefPerte { get; init; } = 1;
    public string? TvaCode { get; init; }
    public string? CompteVente { get; init; }
    public string? CodeBarre { get; init; }
    public int? DelaiLivraison { get; init; }
    public bool Actif { get; init; } = true;
    public List<TarifSource> Tarifs { get; init; } = [];
    public List<ComposanteSource> Composantes { get; init; } = [];
    /// <summary>Modes de calcul essayés dans l'ordre pour retrouver le PV source (D : déboursé, V : prix de vente).</summary>
    public IReadOnlyList<string> Modes { get; init; } = [ModeOuvrage.Vente, ModeOuvrage.Debourse];
}

/// <summary>Mode de calcul d'un ouvrage (composition, ent_mode_calcul_ouvrage).</summary>
public static class ModeOuvrage
{
    public const string Debourse = "D";
    public const string Vente = "V";
}

/// <summary>
/// Écritures de la bibliothèque pendant une reprise (plan reprise-mde-optim, lot 8) : bibliothèques, familles, éléments
/// (articles, textes, ouvrages et leur composition), conversions d'unités, tarifs fournisseurs. Prix par le calcul du
/// module (articles : <see cref="CalculElement"/>, ouvrages : <see cref="ElementsBibliotheque.CalculerOuvrage"/>) ; un PV
/// source non retrouvé à 0,01 € près est imposé (PV fixe) et signalé. Perte (Q9) : coefficient de perte des composantes.
/// </summary>
public sealed class BibliothequeReprise
{
    /// <summary>Tolérance de l'écart entre le PV calculé et le PV source.</summary>
    public const decimal Tolerance = 0.01m;
    /// <summary>Donnée technique de l'élément qui garde son coefficient de perte (ele_proprietes).</summary>
    public const string ProprieteCoefPerte = "coef_perte";
    private const int TypeLigneOuvrage = 2;
    private const int TypeLigneElement = 3;
    private const int TypeLigneTexte = 4;

    /// <summary>Élément repris, tel qu'une composante l'utilise : CoefVente = PV / PA (coefficient de vente effectif).</summary>
    private sealed record ElementRepris(long Id, string BibCode, string Code, string Unite, long? NatId, decimal? Pa, decimal CoefVente, decimal CoefPerte);

    private readonly ContexteReprise ctx;
    private readonly ReferentielsCible cibles;
    private readonly string uniteDefaut;
    private readonly Dictionary<long, string> codesTaux;
    private readonly Dictionary<long, string> bibliotheques = [];
    private readonly HashSet<string> codesBibliotheques = new(StringComparer.Ordinal);
    private readonly Dictionary<long, HashSet<string>> codesElements = [];
    private readonly Dictionary<long, HashSet<string>> codesFamilles = [];
    private readonly Dictionary<long, ElementRepris> elements = [];
    private readonly Dictionary<long, string> noms = [];
    private readonly List<(long Id, string Regroupement)> natures;
    private readonly string commentaire;

    private BibliothequeReprise(ContexteReprise ctx, ReferentielsCible cibles, string uniteDefaut, Dictionary<long, string> codesTaux,
        List<(long, string)> natures, string commentaire)
    {
        this.ctx = ctx; this.cibles = cibles; this.uniteDefaut = uniteDefaut; this.codesTaux = codesTaux; this.natures = natures;
        this.commentaire = commentaire;
    }

    public static async Task<BibliothequeReprise> LireAsync(ContexteReprise ctx, ReferentielsCible cibles, string source, CancellationToken ct)
    {
        var unite = (await SqlReprise.LireAsync(ctx.Unite, "SELECT unt_code FROM unite WHERE unt_actif ORDER BY unt_ordre, unt_code LIMIT 1",
            r => r.GetString(0), ct)).FirstOrDefault() ?? throw new InvalidOperationException("Aucune unité dans la base cible");
        var taux = (await SqlReprise.LireAsync(ctx.Unite, "SELECT ttv_id, ttv_code FROM taux_tva", r => ((long)r.GetInt32(0), r.GetString(1)), ct))
            .ToDictionary(t => t.Item1, t => t.Item2);
        var natures = await SqlReprise.LireAsync(ctx.Unite, "SELECT nat_id, coalesce(nat_rgn_code, '') FROM nature_element WHERE nat_actif ORDER BY nat_id",
            r => ((long)r.GetInt32(0), r.GetString(1)), ct);
        var b = new BibliothequeReprise(ctx, cibles, unite, taux, natures, $"Reprise {source}");
        foreach (var (id, code) in await SqlReprise.LireAsync(ctx.Unite, "SELECT bib_id, bib_code FROM bibliotheque", r => ((long)r.GetInt32(0), r.GetString(1)), ct))
        {
            b.bibliotheques[id] = code;
            b.codesBibliotheques.Add(code);
        }
        foreach (var (bib, code) in await SqlReprise.LireAsync(ctx.Unite, "SELECT ele_bib_id, ele_code FROM element", r => ((long)r.GetInt32(0), r.GetString(1)), ct))
            b.Codes(b.codesElements, bib).Add(code);
        foreach (var (bib, code) in await SqlReprise.LireAsync(ctx.Unite, "SELECT fam_bib_id, fam_code FROM famille_element", r => ((long)r.GetInt32(0), r.GetString(1)), ct))
            b.Codes(b.codesFamilles, bib).Add(code);
        return b;
    }

    private HashSet<string> Codes(Dictionary<long, HashSet<string>> parBib, long bib) =>
        parBib.TryGetValue(bib, out var c) ? c : parBib[bib] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>Code de taux de TVA (ttv_code) d'un taux repris (ttv_id).</summary>
    public string? CodeTva(long? ttvId) => ttvId is { } id && codesTaux.TryGetValue(id, out var c) ? c : null;

    /// <summary>
    /// Coefficient de perte d'une valeur source : 0 ou négatif = aucune perte (1) ; inférieur à 1 = fraction (0,05 → 1,05) ;
    /// jusqu'à 3 = coefficient ; au-delà = pourcentage (5 → 1,05). Hypothèse à confirmer sur les bases réelles.
    /// </summary>
    public static decimal CoefPerte(decimal? valeur) => valeur switch
    {
        null or <= 0 => 1m,
        < 1 => 1 + valeur.Value,
        <= 3 => valeur.Value,
        _ => 1 + valeur.Value / 100,
    };

    /// <summary>Remise en pourcentage d'une valeur source : nulle = aucune ; jusqu'à 1 = fraction (0,3 → 30 %) ; sinon pourcentage.</summary>
    public static decimal? RemisePct(decimal? valeur) => valeur switch
    {
        null or <= 0 => null,
        <= 1 => valeur.Value * 100,
        > 100 => 100,
        _ => valeur.Value,
    };

    /// <summary>Coefficient source (0 ou absent : 1).</summary>
    public static decimal Coef(decimal? valeur) => valeur is > 0 ? valeur.Value : 1m;

    /// <summary>Première nature active d'un regroupement (nature posée par défaut, listée).</summary>
    public long? NatureDe(string regroupement)
    {
        var n = natures.FirstOrDefault(x => x.Regroupement == regroupement);
        return n.Id > 0 ? n.Id : natures.Count > 0 ? natures[0].Id : null;
    }

    private void Renomme(string table, string souhaite, string obtenu)
    {
        if (!string.Equals(souhaite, obtenu, StringComparison.Ordinal))
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.CodeRenomme, $"{table} {souhaite}",
                $"Code « {souhaite} » trop long, invalide ou déjà pris : créé sous « {obtenu} »");
    }

    /// <summary>Bibliothèque : code au format de LogiBTP (^[A-Z0-9_]{1,10}$), libre sinon suffixé.</summary>
    public async Task<long> BibliothequeAsync(string tableSource, string cle, string? code, string? libelle, bool defaut, bool actif, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var souhaite = Associations.Normaliser(code) is { Length: > 0 } n ? n : "BIB";
        var obtenu = Associations.CodeLibre(souhaite, 10, codesBibliotheques.Contains);
        Renomme(tableSource, code?.Trim() ?? souhaite, obtenu);
        codesBibliotheques.Add(obtenu);
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO bibliotheque (bib_code, bib_libelle, bib_defaut, bib_actif, bib_ordre) VALUES ($1, $2, $3, $4, $5) RETURNING bib_id
            """, ct, obtenu, AnnuaireReprise.Couper(libelle, 100) ?? obtenu, defaut, actif, bibliotheques.Count + 1), CultureInfo.InvariantCulture);
        bibliotheques[id] = obtenu;
        ctx.Registre.Inscrire(tableSource, cle, "bibliotheque", id);
        volume.Ecrites++;
        return id;
    }

    /// <summary>Famille d'éléments (arbre : parent déjà repris).</summary>
    public async Task<long> FamilleAsync(string tableSource, string cle, long bibId, long? parentId, string? code, string? libelle, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var codes = Codes(codesFamilles, bibId);
        var souhaite = AnnuaireReprise.Couper(code, 30) ?? RessourcesReprise.CodeDe(libelle ?? cle, 30);
        var obtenu = Associations.CodeLibre(souhaite, 30, codes.Contains);
        Renomme(tableSource, souhaite, obtenu);
        codes.Add(obtenu);
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO famille_element (fam_bib_id, fam_parent_id, fam_code, fam_libelle, fam_ordre) VALUES ($1, $2, $3, $4, $5) RETURNING fam_id
            """, ct, (int)bibId, parentId is { } p ? (int?)p : null, obtenu, AnnuaireReprise.Couper(libelle, 100) ?? obtenu, codes.Count),
            CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(tableSource, cle, "famille_element", id);
        volume.Ecrites++;
        return id;
    }

    /// <summary>Unités d'un élément : conversions vers l'unité de stock (rapport positif), unités sans rapport non reprises (signalées).</summary>
    private (string Stock, string? Achat, string? Vente, List<UniteElement> Unites) Unites(ElementSource e, string code)
    {
        var stock = e.UniteStock ?? e.UniteVente ?? e.UniteAchat;
        if (stock is null)
        {
            stock = uniteDefaut;
            if (e.Type != TypeElement.Texte) ctx.Rapport.Forcer(TypesFicheReprise.Element, code, "unite_stock", stock);
        }
        var unites = new List<UniteElement>();
        foreach (var (u, ratio) in e.Conversions)
            if (u != stock && ratio > 0 && unites.All(x => x.Unite != u))
                unites.Add(new UniteElement { Unite = u, Formule = ArrondiCalcul.Arr6(ratio).ToString("0.######", CultureInfo.InvariantCulture) });
        string? Garder(string? u)
        {
            if (u is null || u == stock || unites.Any(x => x.Unite == u)) return u;
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ConversionManquante, $"{e.Origine.Table} {e.Origine.Cle}",
                $"Unité « {u} » sans rapport avec l'unité de stock « {stock} » : non reprise");
            return null;
        }
        return (stock, Garder(e.UniteAchat), Garder(e.UniteVente), unites);
    }

    /// <summary>Article ou texte : prix par le calcul du module (scénario FIXE), PV source retrouvé sinon imposé ; tarifs fournisseurs.</summary>
    public async Task<long?> ElementAsync(ElementSource e, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(e.Origine.Table);
        volume.Lues++;
        if (!bibliotheques.TryGetValue(e.BibId, out var bibCode)) { volume.Ecartees++; return null; }
        var codes = Codes(codesElements, e.BibId);
        var souhaite = AnnuaireReprise.Couper(e.Code, 30) ?? $"E{e.Origine.Cle}";
        var code = Associations.CodeLibre(souhaite, 30, codes.Contains);
        Renomme(e.Origine.Table, e.Code?.Trim() ?? souhaite, code);
        codes.Add(code);
        var (stock, achat, vente, unites) = Unites(e, code);
        var html = string.IsNullOrWhiteSpace(e.LibelleHtml) ? Rtf.HtmlDe(e.Libelle ?? code) : e.LibelleHtml!;
        var libelle = AnnuaireReprise.Couper(e.Libelle, 4000) ?? Rtf.TexteDe(html);
        var natId = e.NatId;
        if (natId is null && TypeElement.EstVendu(e.Type))
        {
            natId = NatureDe(e.Type == TypeElement.Ouvrage ? "VENTE" : "MATERIAUX");
            if (natId is not null) ctx.Rapport.Forcer(TypesFicheReprise.Element, code, "nat_id", natId.Value.ToString(CultureInfo.InvariantCulture));
        }

        decimal? pa = null, pr = null, pv = null, pvNet = null;
        var coefFg = Coef(e.CoefFg);
        var coefBenef = Coef(e.CoefBenef);
        var pvFixe = false;
        string? composition = null;
        if (e.Type == TypeElement.Ouvrage && e.Composantes.Count > 0)
            (pa, pr, pv, pvNet, coefFg, coefBenef, pvFixe, composition) = Ouvrage(e, code, stock, natId, coefFg, coefBenef);
        else if (e.Type != TypeElement.Texte)
        {
            var entree = new EntreeElement
            {
                UniteStock = stock, Unites = unites, Scenario = ScenarioPa.Fixe, PaFixe = e.Pa ?? 0, CoefFg = coefFg, CoefBenef = coefBenef,
                Pv = e.PvSource, PvFixe = e.PvImpose && e.PvSource is not null, CoefRemise = 1,
            };
            var r = CalculElement.Calculer(entree, Date);
            var convertie = achat is not null && achat != stock || vente is not null && vente != stock;
            if (!entree.PvFixe && convertie && e.PvSource is { } brut && r.Pv is { } calculeBrut && Math.Abs(calculeBrut - brut) > Tolerance)
            {
                // Unités différentes : la source n'a que des rapports (pas de formule) et ses prix ne sont pas forcément exprimés
                // dans l'unité de stock ; PA, PV et rapports repris tels quels (coefficient déduit, PV non imposé), à corriger à la main.
                entree.PvFixe = true;
                r = CalculElement.Calculer(entree, Date);
                entree.PvFixe = false;
                ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.ConversionBrute, $"{e.Origine.Table} {e.Origine.Cle}",
                    $"{code} : unités {string.Join(", ", new[] { achat, stock, vente }.OfType<string>().Distinct())}, rapports repris bruts "
                    + $"({string.Join(", ", unites.Select(u => $"{u.Unite} = {u.Formule} {stock}"))}), PA et PV de la source gardés, à vérifier");
            }
            else if (!entree.PvFixe && e.PvSource is { } attendu && r.Pv is { } calcule && Math.Abs(calcule - attendu) > Tolerance)
            {
                entree.PvFixe = true;
                r = CalculElement.Calculer(entree, Date);
                Imposer(e, code, calcule, attendu);
            }
            (pa, pr, pv, pvNet, coefBenef, pvFixe) = (r.Pa, r.Pr, r.Pv, r.PvNet, r.CoefBenef ?? coefBenef, entree.PvFixe);
        }

        var proprietes = e.CoefPerte != 1 ? SqlReprise.Json.De(new Dictionary<string, decimal> { [ProprieteCoefPerte] = e.CoefPerte }) : SqlReprise.Json.De(new { });
        var compte = e.CompteVente is null ? null : await cibles.CompteAsync(e.CompteVente, null, ReferentielsCible.TypeCompte.General, ReferentielsCible.SensCompte.Vente, ct);
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO element (ele_bib_id, ele_code, ele_type, ele_libelle_html, ele_libelle, ele_fam_id, ele_nat_id, ele_gestion, ele_unt_stock,
                ele_unt_achat, ele_unt_vente, ele_unites, ele_scenario_pa, ele_pa_fixe, ele_pa, ele_coef_fg, ele_pr, ele_coef_benef, ele_pv,
                ele_pv_fixe, ele_coef_remise, ele_pv_net, ele_composition, ele_proprietes, ele_actif, ele_usage, ele_commentaire_prix, ele_maj_par,
                ele_cpt_code, ele_tva_code, ele_code_barre, ele_description_html, ele_delai_livraison)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 1, $21, $22, $23, $24, $25, $26, $27,
                $28, $29, $30, $31, $32)
            RETURNING ele_id
            """, ct, (int)e.BibId, code, e.Type, html, libelle, e.FamId is { } f ? (int?)f : null, natId is { } n ? (int?)n : null,
            e.Type == TypeElement.Ouvrage || e.Type == TypeElement.Texte ? GestionElement.NonGere : e.Gestion, stock, achat, vente,
            SqlReprise.Json.De(unites.Select(u => new { unite = u.Unite, formule = u.Formule })), ScenarioPa.Fixe,
            e.Type == TypeElement.Article ? e.Pa ?? 0 : null, pa, coefFg, pr, coefBenef, pv, pvFixe, pvNet,
            composition is null ? null : new SqlReprise.Json(composition), proprietes, e.Actif, e.Actif ? "A" : "S", commentaire,
            AnnuaireReprise.Couper(ctx.Options.Auteur, 50), compte, e.TvaCode, AnnuaireReprise.Couper(e.CodeBarre, 50), e.DescriptionHtml,
            e.DelaiLivraison is >= 0 ? e.DelaiLivraison : null), CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(e.Origine.Table, e.Origine.Cle, TypesFicheReprise.Element, id);
        elements[id] = new ElementRepris(id, bibCode, code, stock, natId, pa, pa is > 0 && pv is { } prixVente ? ArrondiCalcul.Arr6(prixVente / pa.Value) : coefFg * coefBenef, e.CoefPerte);
        volume.Ecrites++;
        await TarifsAsync(id, e, stock, ct);
        return id;
    }

    private string Date => ctx.Options.DateReprise.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private void Imposer(ElementSource e, string code, decimal calcule, decimal attendu) =>
        ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.PrixImpose, $"{e.Origine.Table} {e.Origine.Cle}",
            $"{code} : PV calculé {calcule.ToString("0.00", CultureInfo.InvariantCulture)} ≠ PV source {attendu.ToString("0.00", CultureInfo.InvariantCulture)}, PV imposé");

    /// <summary>
    /// Ouvrage : composition au format des documents (racine de type ouvrage, composantes avec leur perte en coefficient
    /// de quantité), prix par le moteur dans le premier mode qui retrouve le PV source, sinon PV imposé.
    /// </summary>
    private (decimal? Pa, decimal? Pr, decimal? Pv, decimal? PvNet, decimal CoefFg, decimal CoefBenef, bool PvFixe, string Composition) Ouvrage(
        ElementSource e, string code, string stock, long? natId, decimal coefFg, decimal coefBenef)
    {
        var lignes = new List<Dictionary<string, object?>>();
        var racine = new Dictionary<string, object?>
        {
            ["lig_id"] = 1, ["lig_qte"] = 1, ["lig_ordre"] = 1, ["lig_ent_id"] = 0, ["lig_nat_id"] = natId, ["lig_tyl_id"] = TypeLigneOuvrage,
            ["lig_coef_fg"] = coefFg, ["lig_coef_benef"] = coefBenef, ["lig_unt_code"] = stock, ["lig_parent_id"] = null, ["lig_type_prix"] = "V",
            ["lig_coef_perte"] = 1, ["lig_proprietes"] = new Dictionary<string, object>(), ["lig_qte_source"] = "S", ["lig_coef_remise"] = 1,
            ["lig_libelle_html"] = string.IsNullOrWhiteSpace(e.LibelleHtml) ? Rtf.HtmlDe(e.Libelle ?? code) : e.LibelleHtml,
            ["lig_precision_pv"] = 2, ["lig_precision_qte"] = 2,
        };
        lignes.Add(racine);
        var ordre = 0;
        foreach (var c in e.Composantes)
        {
            var composant = c.Composant is { } k && ctx.Registre.Trouver(k.Table, ctx.CleConservee(k.Table, k.Cle)) is { } id
                && elements.TryGetValue(id, out var x) ? x : null;
            if (composant is null && c.Composant is { } absent)
                ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.ComposanteHorsBibliotheque, $"{e.Origine.Table} {e.Origine.Cle}",
                    $"{code} : composante {absent.Cle} absente ou en sommeil, reprise sans lien vers la bibliothèque");
            ordre++;
            if (c.Texte)
            {
                lignes.Add(new Dictionary<string, object?>
                {
                    ["lig_id"] = ordre + 1, ["lig_ordre"] = ordre, ["lig_ent_id"] = 0, ["lig_tyl_id"] = TypeLigneTexte, ["lig_parent_id"] = 1,
                    ["lig_type_prix"] = "V", ["lig_coef_perte"] = 1, ["lig_proprietes"] = new Dictionary<string, object>(), ["lig_qte_source"] = "S",
                    ["lig_coef_remise"] = 1, ["lig_libelle_html"] = c.LibelleHtml ?? "", ["lig_precision_pv"] = 2, ["lig_precision_qte"] = 2,
                });
                continue;
            }
            var qte = ArrondiCalcul.Arr6(c.Quantite);
            var perte = c.CoefPerte ?? composant?.CoefPerte ?? 1m;
            lignes.Add(new Dictionary<string, object?>
            {
                ["lig_id"] = ordre + 1, ["lig_pa"] = ArrondiCalcul.Arr6(c.Pa ?? composant?.Pa ?? 0), ["lig_qte"] = qte, ["lig_ordre"] = ordre,
                ["lig_ent_id"] = 0, ["lig_nat_id"] = c.NatId ?? composant?.NatId, ["lig_tyl_id"] = TypeLigneElement,
                ["lig_coef_fg"] = Coef(c.CoefFg), ["lig_qte_type"] = c.Absolue ? "A" : "R", ["lig_unt_code"] = c.Unite ?? composant?.Unite ?? uniteDefaut,
                ["lig_parent_id"] = 1, ["lig_type_prix"] = "V", ["lig_coef_benef"] = c.CoefBenef is > 0 ? c.CoefBenef : composant?.CoefVente ?? 1m,
                ["lig_coef_perte"] = perte,
                ["lig_proprietes"] = composant is null ? new Dictionary<string, object>()
                    : new Dictionary<string, object> { ["element"] = new Dictionary<string, object> { ["id"] = composant.Id, ["bib"] = composant.BibCode, ["code"] = composant.Code } },
                ["lig_qte_source"] = "S", ["lig_coef_remise"] = 1, ["lig_libelle_html"] = c.LibelleHtml ?? composant?.Code ?? "",
                ["lig_precision_pv"] = 2, // Précision de la quantité vendue (quantité × perte), arrondie par le moteur.
                ["lig_precision_qte"] = Math.Clamp(Decimales(ArrondiCalcul.Arr6(qte * perte)), 2, 6),
            });
        }
        string Json(string mode) => JsonSerializer.Serialize(new Dictionary<string, object> { ["mode"] = mode, ["lignes"] = lignes, ["metres"] = Array.Empty<object>(), ["variables"] = Array.Empty<object>() });

        var modes = e.Modes.Count > 0 ? e.Modes : [ModeOuvrage.Vente];
        if (e.PvImpose && e.PvSource is { } impose) return Fixe(modes[0], impose);
        var calculs = modes.Select(m => (Mode: m, R: ElementsBibliotheque.CalculerOuvrage(Json(m), coefFg, coefBenef, 1))).ToList();
        var retenu = e.PvSource is not { } attendu || attendu == 0 ? calculs[0]
            : calculs.FirstOrDefault(c => c.R.Pv is { } v && Math.Abs(v - attendu) <= Tolerance);
        if (retenu.Mode is not null)
            return (retenu.R.Pa, retenu.R.Pr, retenu.R.Pv, retenu.R.PvNet, coefFg, coefBenef, false, Json(retenu.Mode));
        Imposer(e, code, calculs[0].R.Pv ?? 0, e.PvSource!.Value);
        return Fixe(modes[0], e.PvSource.Value);

        (decimal? Pa, decimal? Pr, decimal? Pv, decimal? PvNet, decimal CoefFg, decimal CoefBenef, bool PvFixe, string Composition) Fixe(string mode, decimal pvSource)
        {
            racine["lig_pv"] = pvSource;
            racine["lig_pv_fixe"] = true;
            var json = Json(mode);
            var r = ElementsBibliotheque.CalculerOuvrage(json, coefFg, coefBenef, 1, pvSource);
            return (r.Pa, r.Pr, r.Pv, r.PvNet, coefFg, ElementsBibliotheque.CoefDeduit(r.Pv, r.Pr) ?? coefBenef, true, json);
        }
    }

    private static int Decimales(decimal v)
    {
        var t = v.ToString("0.######", CultureInfo.InvariantCulture);
        var i = t.IndexOf('.');
        return i < 0 ? 0 : t.Length - i - 1;
    }

    /// <summary>Tarifs fournisseurs : un seul principal (le premier marqué) ; prix net, sinon prix public remisé.</summary>
    private async Task TarifsAsync(long eleId, ElementSource e, string stock, CancellationToken ct)
    {
        var principal = false;
        foreach (var t in e.Tarifs)
        {
            var volume = ctx.Rapport.Volume("tarif_fournisseur");
            volume.Lues++;
            var nom = t.Fournisseur ?? (t.FournisseurPerId is { } per ? await NomAsync(per, ct) : null);
            var net = t.PrixNet is > 0 ? t.PrixNet.Value
                : t.PrixPublic is { } pp ? CalculElement.PrixNetTarif(new TarifCalcul { PrixPublic = pp, Remise1 = t.Remise1, Remise2 = t.Remise2 }) : 0;
            if (nom is null || net < 0) { volume.Ecartees++; continue; }
            var estPrincipal = t.Principal && !principal;
            principal |= estPrincipal;
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                INSERT INTO tarif_fournisseur (tfo_ele_id, tfo_fournisseur, tfo_tiers_id, tfo_reference, tfo_libelle, tfo_unt_code, tfo_prix, tfo_debut,
                    tfo_principal, tfo_maj_par, tfo_prix_public, tfo_remise1, tfo_remise2)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                """, ct, eleId, AnnuaireReprise.Couper(nom, 100), t.FournisseurPerId, AnnuaireReprise.Couper(t.Reference, 50),
                AnnuaireReprise.Couper(t.Libelle, 200), t.Unite ?? e.UniteAchat ?? stock, ArrondiCalcul.Arr6(net), t.Debut, estPrincipal,
                AnnuaireReprise.Couper(ctx.Options.Auteur, 50), t.PrixPublic is > 0 ? t.PrixPublic : null, t.Remise1, t.Remise2);
            volume.Ecrites++;
        }
    }

    private async Task<string?> NomAsync(long perId, CancellationToken ct)
    {
        if (noms.TryGetValue(perId, out var n)) return n;
        var nom = (await SqlReprise.LireAsync(ctx.Unite, "SELECT coalesce(per_raison_sociale, per_nom_commercial) FROM personne WHERE per_id = $1",
            r => r.IsDBNull(0) ? null : r.GetString(0), ct, perId)).FirstOrDefault();
        if (nom is not null) noms[perId] = nom;
        return nom;
    }
}

/// <summary>Types de fiches de la bibliothèque dans le registre et la liste des valeurs forcées.</summary>
public static class TypesFicheReprise
{
    public const string Element = LogiBTP.Domaine.TypesFiche.Element;
}
