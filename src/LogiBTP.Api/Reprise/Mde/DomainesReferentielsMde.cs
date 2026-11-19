using System.Globalization;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise.Mde;

/// <summary>Clés du registre posées par les domaines MDE du lot 4 (lues par les lots suivants).</summary>
public static class RegistreMde
{
    public const string Societe = "SYS_DEFSTE";
    public const string Unite = "PMEUNITEMESURE";
    /// <summary>Taux de TVA : clé « catégorie|code » (TVA.CODECATEGORIE, TVA.CODE).</summary>
    public const string Tva = "TVA";
    /// <summary>Condition de paiement (APIMODEREGLEMENT.CODE → cpa_code).</summary>
    public const string Condition = "APIMODEREGLEMENT";
    /// <summary>Mode de règlement de la condition (première ligne, APIMODEREGLEMENT.CODE → mre_code).</summary>
    public const string ModeCondition = "APIMODEREGLEMENT.MODE";
    public const string Pays = "APIPAYS";
    public const string Civilite = "APICIVILITE";
    /// <summary>Forme juridique (APICIVILITE.FORMEJURIDIQUE = 1) : libellé gardé pour per_forme_libelle.</summary>
    public const string FormeJuridique = "APICIVILITE.FORME";

    public static string CleTva(string? categorie, string? code) => $"{categorie?.Trim()}|{code?.Trim()}";
}

/// <summary>
/// Société de la base MDE (plan reprise-mde-optim, lot 4) : identité de <c>SYS_DEFSTE</c> en personne « société de la
/// base » avec ses coordonnées ; devise autre que l'euro bloquante (Q10) ; décimales signalées.
/// </summary>
public sealed class SocieteMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Societe;
    public IReadOnlyList<string> Dependances => [];

    private const string Requete = """
        SELECT TOP 1 DOSSIER, NOM, ADRESSE, CODEPOSTAL, VILLE, SIRET, TELEPHONE, FAX, EMAIL, SITEINTERNET, APE,
               NINTRACOMMUNAUTAIRE, FORMEJURIDIQUE, CAPITALSOCIAL, RCS, VILLERCS, NBREDEC, DEVISEPIVOT,
               DECIMALEQTE, DECIMALEPU, DECIMALETOT, DECIMALETPS
        FROM SYS_DEFSTE ORDER BY DOSSIER
        """;

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var s = (await SqlReprise.SourceAsync(ctx, Requete, ct)).FirstOrDefault();
        var volume = ctx.Rapport.Volume("SYS_DEFSTE");
        if (s is null)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Bloquant, CodeAnomalie.SocieteManquante, "SYS_DEFSTE", "Aucune société dans SYS_DEFSTE");
            return;
        }
        volume.Lues++;
        if (s.Texte("DEVISEPIVOT") is { } devise && !DevisesMde.EstEuro(await DevisesMde.EuroAsync(ctx, ct), devise))
            ctx.Rapport.Signaler(NiveauAnomalie.Bloquant, CodeAnomalie.DeviseEtrangere, "SYS_DEFSTE.DEVISEPIVOT",
                $"Devise de la société {devise} : la reprise se fait en euros (Q10)");
        ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.Decimales, "SYS_DEFSTE",
            string.Create(CultureInfo.InvariantCulture,
                $"Décimales de la source : quantités {s.Entier("DECIMALEQTE")}, prix unitaires {s.Entier("DECIMALEPU")}, totaux {s.Entier("DECIMALETOT")}, temps {s.Entier("DECIMALETPS")} ; LogiBTP calcule en 6 décimales et arrondit les montants à 2 ; lignes reprises affichées avec {ctx.Options.DecimalesQte?.ToString(CultureInfo.InvariantCulture) ?? "les décimales de la source"} pour les quantités et {ctx.Options.DecimalesPrix?.ToString(CultureInfo.InvariantCulture) ?? "6"} pour les prix"));

        var rcs = string.Join(" ", new[] { s.Texte("RCS"), s.Texte("VILLERCS") }.Where(x => x is not null));
        var perId = await AnnuaireReprise.InsererPersonneAsync(ctx.Unite, new PersonneReprise
        {
            Niveau = AnnuaireReprise.Niveau.Societe, RaisonSociale = s.Texte("NOM") ?? "?", SocieteBase = true,
            Siret = s.Texte("SIRET")?.Replace(" ", "", StringComparison.Ordinal), TvaIntra = s.Texte("NINTRACOMMUNAUTAIRE"),
            Naf = s.Texte("APE"), FormeLibelle = s.Texte("FORMEJURIDIQUE"), Capital = Montant(s.Texte("CAPITALSOCIAL")),
            Rcs = rcs.Length > 0 ? rcs : null,
        }, ct);
        var (l1, l2, l3) = AnnuaireReprise.Lignes(s.Texte("ADRESSE"));
        var coordonnees = new[]
        {
            new CoordonneeReprise(AnnuaireReprise.Nature.Adresse, AnnuaireReprise.Usage.Siege, true)
                { Ligne1 = l1, Ligne2 = l2, Ligne3 = l3, CodePostal = s.Texte("CODEPOSTAL"), Ville = s.Texte("VILLE"), Pays = "FR" },
            new CoordonneeReprise(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Standard, true) { Valeur = s.Texte("TELEPHONE") },
            new CoordonneeReprise(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Fax, false) { Valeur = s.Texte("FAX") },
            new CoordonneeReprise(AnnuaireReprise.Nature.Email, AnnuaireReprise.Usage.Pro, true) { Valeur = s.Texte("EMAIL") },
            new CoordonneeReprise(AnnuaireReprise.Nature.Web, AnnuaireReprise.Usage.Site, true) { Valeur = s.Texte("SITEINTERNET") },
        };
        for (var i = 0; i < coordonnees.Length; i++)
            await AnnuaireReprise.AjouterCoordonneeAsync(ctx.Unite, perId, coordonnees[i], i, ctx.Options.Auteur, ct);
        ctx.Registre.Inscrire(RegistreMde.Societe, s.Texte("DOSSIER") ?? "", "personne", perId);
        volume.Ecrites++;
    }

    /// <summary>Montant saisi en texte (capital social), séparateur décimal point ou virgule ; null s'il est illisible.</summary>
    internal static decimal? Montant(string? texte) =>
        decimal.TryParse((texte ?? "").Replace(" ", "", StringComparison.Ordinal).Replace(',', '.'), NumberStyles.Number,
            CultureInfo.InvariantCulture, out var m) ? m : null;
}

/// <summary>
/// Référentiels MDE (plan reprise-mde-optim, lot 4) : plan comptable, collectifs, journaux et exigibilité ; unités ;
/// taux de TVA (TVA puis PMETVA, catégorie par CATEGORIEACHATVENTE) ; conditions et modes de règlement
/// (APIMODEREGLEMENT / L) ; pays ; civilités et formes juridiques ; axes et grilles analytiques gardés dans le
/// paramétrage comptable (Q11).
/// </summary>
public sealed class ReferentielsMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Referentiels;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Societe];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var cibles = await ReferentielsCible.LireAsync(ctx, ct);
        await ComptesAsync(ctx, cibles, ct);
        await UnitesAsync(ctx, cibles, ct);
        await TvaAsync(ctx, cibles, ct);
        await ReglementsAsync(ctx, cibles, ct);
        await PaysAsync(ctx, ct);
        await CivilitesAsync(ctx, ct);
        await AnalytiqueAsync(ctx, ct);
    }

    private static async Task ComptesAsync(ContexteReprise ctx, ReferentielsCible cibles, CancellationToken ct)
    {
        var param = (await SqlReprise.SourceAsync(ctx, """
            SELECT TOP 1 JOURNVENCODE, JOURNACHCODE, CPTCOLCLI, CPTCOLFRS, CPTCOLSST, EXIGIBILITETVA FROM CMP_PARAMGEN
            """, ct)).FirstOrDefault();
        var defste = (await SqlReprise.SourceAsync(ctx, "SELECT TOP 1 JOURNALVENTE, JOURNALACHAT FROM SYS_DEFSTE ORDER BY DOSSIER", ct)).FirstOrDefault();
        var collectifs = (await SqlReprise.SourceAsync(ctx, "SELECT DISTINCT COMPTE FROM COMM_TIERS WHERE COMPTE IS NOT NULL", ct))
            .Select(l => l.Texte("COMPTE")).OfType<string>().ToHashSet(StringComparer.Ordinal);
        foreach (var c in new[] { param?.Texte("CPTCOLCLI"), param?.Texte("CPTCOLFRS"), param?.Texte("CPTCOLSST") }.OfType<string>())
            collectifs.Add(c);

        var volume = ctx.Rapport.Volume("CMP_PLANCP");
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT COMPTE, NOM FROM CMP_PLANCP ORDER BY COMPTE", ct))
        {
            volume.Lues++;
            if (l.Texte("COMPTE") is not { } compte) { volume.Ecartees++; continue; }
            var (type, sens) = ReferentielsCible.Classer(compte, collectifs);
            await cibles.CompteAsync(compte, l.Texte("NOM"), type, sens, ct);
            volume.Ecrites++;
        }

        // Collectifs par type de tiers, journaux des ventes et des achats, exigibilité de la TVA (paramétrage comptable).
        async Task Collectif(string? compte, string sql)
        {
            if (await cibles.CompteAsync(compte, compte, ReferentielsCible.TypeCompte.Collectif, ReferentielsCible.SensCompte.Aucun, ct) is { } c)
                await SqlReprise.ExecuterAsync(ctx.Unite, sql, ct, c);
        }
        await Collectif(param?.Texte("CPTCOLCLI"), "UPDATE collectif_tiers SET col_cpt_code = $1 WHERE col_code IN ('CLIENT_PRO', 'CLIENT_PRIVE')");
        await Collectif(param?.Texte("CPTCOLFRS"), "UPDATE collectif_tiers SET col_cpt_code = $1 WHERE col_code = 'FOURNISSEUR'");
        await Collectif(param?.Texte("CPTCOLSST"), "UPDATE collectif_tiers SET col_cpt_code = $1 WHERE col_code = 'SOUS_TRAITANT'");
        if ((param?.Texte("JOURNVENCODE") ?? defste?.Texte("JOURNALVENTE")) is { } jv)
            await SqlReprise.ExecuterAsync(ctx.Unite, "UPDATE type_comptable SET tco_journal = $1 WHERE tco_sens = 'VENTE'", ct, AnnuaireReprise.Couper(jv, 10));
        if ((param?.Texte("JOURNACHCODE") ?? defste?.Texte("JOURNALACHAT")) is { } ja)
            await SqlReprise.ExecuterAsync(ctx.Unite, "UPDATE type_comptable SET tco_journal = $1 WHERE tco_sens = 'ACHAT'", ct, AnnuaireReprise.Couper(ja, 10));
        if (param?.Texte("EXIGIBILITETVA") is "D" or "E")
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                INSERT INTO parametre_comptabilite (pcp_cle, pcp_valeur) VALUES ('tva_sur_debits', to_jsonb($1::boolean))
                ON CONFLICT (pcp_cle) DO UPDATE SET pcp_valeur = EXCLUDED.pcp_valeur
                """, ct, param.Texte("EXIGIBILITETVA") == "D");
    }

    private static async Task UnitesAsync(ContexteReprise ctx, ReferentielsCible cibles, CancellationToken ct)
    {
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT UNITE, NBDEC FROM PMEUNITEMESURE ORDER BY UNITE", ct))
            await cibles.UniteAsync(RegistreMde.Unite, l.Texte("UNITE") ?? "", l.Texte("UNITE"), l.Texte("UNITE"), (int?)l.Entier("NBDEC"), true, ct);
    }

    private static async Task TvaAsync(ContexteReprise ctx, ReferentielsCible cibles, CancellationToken ct)
    {
        var categories = (await SqlReprise.SourceAsync(ctx, "SELECT CODE, TYPE FROM CATEGORIEACHATVENTE", ct))
            .Where(l => l.Texte("CODE") is not null)
            .ToDictionary(l => l.Texte("CODE")!, l => l.Texte("TYPE"), StringComparer.Ordinal);
        var vues = new HashSet<string>(StringComparer.Ordinal);
        foreach (var table in new[] { "TVA", "PMETVA" })
        {
            var requete = table == "TVA"
                ? "SELECT CODECATEGORIE, CODE, TAUX, COMPTEV, COMPTEA, LIBELLE, ANEPASUTILISER FROM TVA ORDER BY CODECATEGORIE, CODE"
                : "SELECT CODECATEGORIE, CODE, TAUX, COMPTEV, COMPTEA, LIBELLE, ANEPASUTILISER FROM PMETVA ORDER BY CODECATEGORIE, CODE";
            foreach (var l in await SqlReprise.SourceAsync(ctx, requete, ct))
            {
                var cle = RegistreMde.CleTva(l.Texte("CODECATEGORIE"), l.Texte("CODE"));
                if (!vues.Add(cle)) continue;
                var taux = l.Decimal("TAUX") ?? 0;
                var type = categories.GetValueOrDefault(l.Texte("CODECATEGORIE") ?? "");
                var categorie = type is "N" or "A" or "I" or "E" ? type : Associations.CategorieNormale;
                if (type is not null && categorie != type)
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, $"CATEGORIEACHATVENTE {l.Texte("CODECATEGORIE")}",
                        $"Type de catégorie « {type} » inconnu : TVA normale");
                if (categorie == Associations.CategorieNormale && taux == 0) categorie = "E";
                var collectee = await cibles.CompteAsync(l.Texte("COMPTEV"), l.Texte("LIBELLE"), ReferentielsCible.TypeCompte.Tva, ReferentielsCible.SensCompte.Vente, ct);
                var deductible = await cibles.CompteAsync(l.Texte("COMPTEA"), l.Texte("LIBELLE"), ReferentielsCible.TypeCompte.Tva, ReferentielsCible.SensCompte.Achat, ct);
                await cibles.TauxAsync(RegistreMde.Tva, cle, taux, categorie, l.Texte("LIBELLE") ?? cle, l.Booleen("ANEPASUTILISER") != true,
                    collectee, deductible, ct);
            }
        }
    }

    private static async Task ReglementsAsync(ContexteReprise ctx, ReferentielsCible cibles, CancellationToken ct)
    {
        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT CODE, LIG, POUR, JOUR, NJ, TYPEP, MOISENTIER FROM APIMODEREGLEMENTL ORDER BY CODE, LIG", ct))
            .GroupBy(l => l.Texte("CODE") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        foreach (var m in await SqlReprise.SourceAsync(ctx, "SELECT CODE, NOM FROM APIMODEREGLEMENT ORDER BY CODE", ct))
        {
            if (m.Texte("CODE") is not { } code) continue;
            var detail = lignes.GetValueOrDefault(code) ?? [];
            var conditions = detail.Select(l => new LigneConditionReprise(
                l.Decimal("POUR") ?? 100, (int)(l.Entier("NJ") ?? 0),
                l.Entier("JOUR") is > 0 ? ReferentielsCible.BaseEcheance.Jour
                    : l.Booleen("MOISENTIER") == true ? ReferentielsCible.BaseEcheance.FinMois : ReferentielsCible.BaseEcheance.Net,
                l.Entier("JOUR") is > 0 and var j ? (int)j : null)).ToList();
            await cibles.ConditionAsync(RegistreMde.Condition, code, m.Texte("NOM") ?? code, conditions, ct);

            // Mode de règlement : type de paiement de la première ligne (table mode_paiement), sinon rapproché par le nom.
            var typep = detail.FirstOrDefault()?.Texte("TYPEP");
            var e = typep is null ? null : ctx.Correspondre(TablesCorrespondance.ModePaiement, typep, $"APIMODEREGLEMENTL {code}");
            if (e is { Ignorer: false, Cible: { } mode }) ctx.Registre.InscrireCode(RegistreMde.ModeCondition, code, mode);
            else if (e is null) await cibles.ModeAsync(RegistreMde.ModeCondition, code, null, m.Texte("NOM"), ct);
        }
    }

    private static async Task PaysAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume("APIPAYS");
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT CODE, NOM FROM APIPAYS ORDER BY CODE", ct))
        {
            volume.Lues++;
            var iso = PaysIso.Code(l.Texte("CODE")) ?? ReferentielsCible.Pays(ctx, l.Texte("NOM"), $"APIPAYS {l.Texte("CODE")}");
            if (iso is null || l.Texte("CODE") is not { } code) { volume.Ecartees++; continue; }
            ctx.Registre.InscrireCode(RegistreMde.Pays, code, iso);
            volume.Ecrites++;
        }
    }

    private static async Task CivilitesAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume("APICIVILITE");
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT LIBELLE, FORMEJURIDIQUE FROM APICIVILITE ORDER BY LIBELLE", ct))
        {
            volume.Lues++;
            if (l.Texte("LIBELLE") is not { } libelle) { volume.Ecartees++; continue; }
            if (l.Booleen("FORMEJURIDIQUE") == true)
            {
                ctx.Registre.InscrireCode(RegistreMde.FormeJuridique, libelle, libelle);
                volume.Ecrites++;
                continue;
            }
            if (ctx.Correspondre(TablesCorrespondance.Civilite, libelle, $"APICIVILITE {libelle}") is { Ignorer: false, Cible: { } c })
            {
                ctx.Registre.InscrireCode(RegistreMde.Civilite, libelle, c);
                volume.Ecrites++;
            }
            else volume.Ecartees++;
        }
    }

    /// <summary>Axes, postes et grilles analytiques : sans table cible, gardés dans le paramétrage comptable pour l'export (Q11).</summary>
    private static async Task AnalytiqueAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var axes = (await SqlReprise.SourceAsync(ctx, "SELECT CODE, LIBELLE, ACTIF, AXEDEFAUT FROM CMP_AXEANALYTIQUE ORDER BY CODE", ct))
            .Select(l => new { code = l.Texte("CODE"), libelle = l.Texte("LIBELLE"), actif = l.Booleen("ACTIF"), defaut = l.Booleen("AXEDEFAUT") }).ToList();
        var postes = (await SqlReprise.SourceAsync(ctx, "SELECT AXE, CODE, LIBELLE, SOMMEIL FROM CMP_POSTEANA ORDER BY AXE, CODE", ct))
            .Select(l => new { axe = l.Texte("AXE"), code = l.Texte("CODE"), libelle = l.Texte("LIBELLE"), sommeil = l.Booleen("SOMMEIL") }).ToList();
        var grilles = (await SqlReprise.SourceAsync(ctx, "SELECT CODE, AXE, POSTE, PCT, MONTANT, QUANTITE FROM CMP_GRILLEANA WHERE ISTEMP IS NULL OR ISTEMP = 0 ORDER BY CODE, AXE, POSTE", ct))
            .Select(l => new { code = l.Texte("CODE"), axe = l.Texte("AXE"), poste = l.Texte("POSTE"), pct = l.Decimal("PCT"), montant = l.Decimal("MONTANT"), quantite = l.Decimal("QUANTITE") }).ToList();
        if (axes.Count + postes.Count + grilles.Count == 0) return;
        await SqlReprise.FusionnerParametreComptaAsync(ctx.Unite, DomainesReprise.ParametreAnalytique,
            new Dictionary<string, object> { ["source"] = SourceReprise.Mde, ["axes"] = axes, ["postes"] = postes, ["grilles"] = grilles }, ct);
        ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.SansEquivalent, "CMP_AXEANALYTIQUE",
            $"Analytique ({axes.Count} axes, {postes.Count} postes, {grilles.Count} lignes de grilles) gardé dans le paramètre comptable « {DomainesReprise.ParametreAnalytique} » pour l'export");
    }
}

/// <summary>
/// Devises MDE (Q10 : la reprise se fait en euros). MDE code souvent l'euro « E » : une devise est l'euro si son code est
/// EUR, E ou €, ou si APIDEVISEE la déclare en euro (CODEISO EUR ou symbole €). Toute autre devise est bloquante.
/// </summary>
public static class DevisesMde
{
    private static readonly string[] CodesEuro = ["EUR", "E", "€", "EURO"];

    /// <summary>Codes de devise de la source qui désignent l'euro (comparaison sans casse ni espaces).</summary>
    public static async Task<HashSet<string>> EuroAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var euro = new HashSet<string>(CodesEuro, StringComparer.OrdinalIgnoreCase);
        foreach (var d in await SqlReprise.SourceAsync(ctx, "SELECT CODE, SYMBOLE, CODEISO FROM APIDEVISEE", ct))
            if (d.Texte("CODE") is { } code
                && (euro.Contains(d.Texte("CODEISO") ?? "") || (d.Texte("SYMBOLE") ?? "").Trim() == "€"))
                euro.Add(code.Trim());
        return euro;
    }

    /// <summary>Vrai si la devise est absente ou désigne l'euro.</summary>
    public static bool EstEuro(HashSet<string> euro, string? devise) =>
        string.IsNullOrWhiteSpace(devise) || euro.Contains(devise.Trim());
}
