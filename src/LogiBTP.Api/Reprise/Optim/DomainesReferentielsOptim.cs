using System.Globalization;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise.Optim;

/// <summary>Clés du registre posées par les domaines OPTIM du lot 4 (lues par les lots suivants).</summary>
public static class RegistreOptim
{
    public const string Societe = "ref_societe";
    /// <summary>Fiche tiers d'une société reprise (bib_tiers.TRS_ID) : le lot 6 ne la reprend pas en tiers.</summary>
    public const string Tiers = "bib_tiers";
    public const string Unite = "z_unite";
    /// <summary>Unité par son code (lignes qui portent le code plutôt que l'identifiant).</summary>
    public const string UniteCode = "z_unite.CODE";
    public const string Tva = "z_parametre.TVA";
    public const string Mode = "z_parametre.MODE";
    public const string Civilite = "z_parametre.CIVILITE";
    public const string Nature = "ref_famille_type";
}

/// <summary>Sociétés OPTIM retenues (R1) : ordre de reprise et société principale.</summary>
internal static class SocietesOptim
{
    /// <summary>Identifiants demandés (SCT_ID) ; non numériques ignorés (signalés par le domaine).</summary>
    public static IReadOnlyList<long> Ids(ContexteReprise ctx) =>
        ctx.Options.Societes.Select(s => long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : 0)
            .Where(v => v > 0).Distinct().ToList();
}

/// <summary>
/// Sociétés OPTIM d'un même SIREN regroupées dans la base (plan reprise-mde-optim, lot 4, Q1 / R1) : la société de
/// tête (sans société mère parmi les retenues) devient la société de la base, les autres ses établissements ; identité
/// tirée de la fiche tiers de la société (<c>SCT_TRS_ID</c>) et de ses adresses (<c>z_adresse</c>). Codes analytiques
/// des établissements gardés dans le paramétrage comptable.
/// </summary>
public sealed class SocieteOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Societe;
    public IReadOnlyList<string> Dependances => [];

    private const string RequeteSocietes = """
        SELECT s.SCT_ID, s.SCT_SCT_ID, s.SCT_Niveau, s.SCT_RaisonSociale, s.SCT_LibelleCourt, s.SCT_CodeAna, s.SCT_IsDesactive,
               t.TRS_ID, t.TRS_Code, t.TRS_Siret, t.TRS_RaisonSociale, t.TRS_NomReduit, t.TRS_TvaIntra
        FROM ref_societe s LEFT JOIN bib_tiers t ON t.TRS_ID = s.SCT_TRS_ID
        ORDER BY s.SCT_ID
        """;

    private const string RequeteAdresses = """
        SELECT ADR_Id, ADR_Libelle, ADR_Ligne1, ADR_Ligne2, ADR_CP, ADR_Ville, ADR_Pays, ADR_NumTel1, ADR_NumPort, ADR_Email
        FROM z_adresse WHERE ADR_TypeEntite = 'TRS' AND ADR_Entite_Id = @tiers AND ADR_IsDesactive = 0 ORDER BY ADR_Id
        """;

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var ids = SocietesOptim.Ids(ctx);
        if (ids.Count == 0 || ids.Count != ctx.Options.Societes.Count)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Bloquant, CodeAnomalie.SocieteManquante, "ref_societe",
                "Sociétés à reprendre : indiquer un ou plusieurs SCT_ID (établissements d'un même SIREN)");
            return;
        }
        var toutes = (await SqlReprise.SourceAsync(ctx, RequeteSocietes, ct)).ToDictionary(l => l.Entier("SCT_ID")!.Value);
        var inconnues = ids.Where(i => !toutes.ContainsKey(i)).ToList();
        if (inconnues.Count > 0)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Bloquant, CodeAnomalie.SocieteInconnue, "ref_societe",
                $"Société inconnue dans la base source : {string.Join(", ", inconnues)}");
            return;
        }
        var retenues = ids.Select(i => toutes[i]).ToList();
        var sirens = retenues.Select(s => Siren(s.Texte("TRS_Siret"))).OfType<string>().Distinct().ToList();
        if (sirens.Count > 1)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Bloquant, CodeAnomalie.SirenDifferents, "ref_societe",
                $"Les sociétés retenues n'ont pas le même SIREN ({string.Join(", ", sirens)}) : une base par société (Q1)");
            return;
        }

        // Tête : la société dont la mère n'est pas retenue (niveau le plus haut), puis ses établissements.
        var tete = retenues.OrderBy(s => ids.Contains(s.Id("SCT_SCT_ID") ?? 0) ? 1 : 0).ThenBy(s => s.Entier("SCT_Niveau") ?? 0).First();
        var volume = ctx.Rapport.Volume("ref_societe");
        long? teteId = null;
        var analytique = new List<object>();
        foreach (var s in retenues.OrderBy(s => s == tete ? 0 : 1).ThenBy(s => s.Entier("SCT_ID")))
        {
            volume.Lues++;
            var perId = await AnnuaireReprise.InsererPersonneAsync(ctx.Unite, new PersonneReprise
            {
                Code = s.Texte("TRS_Code"),
                Niveau = s == tete ? AnnuaireReprise.Niveau.Societe : AnnuaireReprise.Niveau.Etablissement,
                RaisonSociale = s.Texte("SCT_RaisonSociale") ?? s.Texte("TRS_RaisonSociale") ?? "?",
                Sigle = s.Texte("SCT_LibelleCourt"), SocieteBase = s == tete, ParentId = s == tete ? null : teteId,
                Siret = s.Texte("TRS_Siret")?.Replace(" ", "", StringComparison.Ordinal), TvaIntra = s.Texte("TRS_TvaIntra"),
                Actif = s.Booleen("SCT_IsDesactive") != true,
            }, ct);
            teteId ??= perId;
            var ordre = 0;
            if (s.Id("TRS_ID") is { } trs)
            {
                foreach (var a in await SqlReprise.SourceAsync(ctx, RequeteAdresses, ct, new Dictionary<string, object?> { ["tiers"] = trs }))
                {
                    var ou = $"z_adresse {a.Texte("ADR_Id")}";
                    var premiere = ordre == 0;
                    foreach (var c in new[]
                    {
                        new CoordonneeReprise(AnnuaireReprise.Nature.Adresse, premiere ? AnnuaireReprise.Usage.Siege : AnnuaireReprise.Usage.Autre, premiere)
                        {
                            Libelle = a.Texte("ADR_Libelle"), Ligne1 = a.Texte("ADR_Ligne1"), Ligne2 = a.Texte("ADR_Ligne2"),
                            CodePostal = a.Texte("ADR_CP"), Ville = a.Texte("ADR_Ville"), Pays = ReferentielsCible.Pays(ctx, a.Texte("ADR_Pays"), ou),
                        },
                        new CoordonneeReprise(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Standard, premiere) { Valeur = a.Texte("ADR_NumTel1") },
                        new CoordonneeReprise(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Portable, false) { Valeur = a.Texte("ADR_NumPort") },
                        new CoordonneeReprise(AnnuaireReprise.Nature.Email, AnnuaireReprise.Usage.Pro, premiere) { Valeur = a.Texte("ADR_Email") },
                    })
                        await AnnuaireReprise.AjouterCoordonneeAsync(ctx.Unite, perId, c, ordre++, ctx.Options.Auteur, ct);
                }
                ctx.Registre.Inscrire(RegistreOptim.Tiers, trs.ToString(CultureInfo.InvariantCulture), "personne", perId);
            }
            ctx.Registre.Inscrire(RegistreOptim.Societe, s.Texte("SCT_ID")!, "personne", perId);
            if (s.Texte("SCT_CodeAna") is { } ana)
                analytique.Add(new { societe = s.Texte("SCT_ID"), libelle = s.Texte("SCT_LibelleCourt"), code_analytique = ana });
            volume.Ecrites++;
        }
        if (analytique.Count > 0)
            await SqlReprise.FusionnerParametreComptaAsync(ctx.Unite, DomainesReprise.ParametreAnalytique,
                new Dictionary<string, object> { ["source"] = SourceReprise.Optim, ["etablissements"] = analytique }, ct);
    }

    private static string? Siren(string? siret) =>
        siret?.Replace(" ", "", StringComparison.Ordinal) is { Length: >= 9 } s ? s[..9] : null;
}

/// <summary>
/// Référentiels OPTIM (plan reprise-mde-optim, lot 4) : plan comptable des sociétés retenues (<c>svcz_compte</c>) ;
/// unités (<c>z_unite</c>) ; taux de TVA et modes de règlement de <c>z_parametre</c>, retrouvés par les colonnes qui
/// les citent (leur <c>PRM_TypeParam</c> varie d'une base à l'autre ; taux en <c>PRM_Param_Num1</c>) ; civilités
/// (type de la table « civilite » des correspondances) ; natures depuis les types de familles (<c>ref_famille_type</c>).
/// </summary>
public sealed class ReferentielsOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Referentiels;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Societe];

    private const string RequeteTva = """
        SELECT PRM_ID, PRM_Code, PRM_Libelle, PRM_Param_Num1, PRM_IsDesactive FROM z_parametre WHERE PRM_ID IN (
            SELECT ART_PRM_TVA FROM bib_article UNION SELECT VDL_PRM_TVA FROM vte_doc_ligne
            UNION SELECT VDE_PRM_TVA_DEF FROM vte_doc_entete UNION SELECT VSL_PRM_TVA FROM vte_situation_ligne
            UNION SELECT DOE_PRM_ID_TVA FROM ach_doc_entete UNION SELECT PST_PRM_ID_TVA FROM afc_prestation_st
            UNION SELECT TRS_TVA FROM bib_tiers UNION SELECT TRS_TVAVte FROM bib_tiers)
        ORDER BY PRM_Ordre, PRM_ID
        """;

    private const string RequeteModes = """
        SELECT PRM_ID, PRM_Code, PRM_Libelle FROM z_parametre WHERE PRM_ID IN (
            SELECT TRS_ModeReglement FROM bib_tiers UNION SELECT TRS_ModeReglementVte FROM bib_tiers
            UNION SELECT VDE_PRM_ModeRegl FROM vte_doc_entete UNION SELECT DOE_ModeReglement FROM ach_doc_entete
            UNION SELECT VER_ModeRegl FROM vac_doc_echeance_reglement UNION SELECT VRV_ModeRegl FROM vac_reglement_facture_vte)
        ORDER BY PRM_Ordre, PRM_ID
        """;

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var cibles = await ReferentielsCible.LireAsync(ctx, ct);
        await ComptesAsync(ctx, cibles, ct);

        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT UNT_ID, UNT_Code, UNT_Libelle, UNT_IsDesactive FROM z_unite ORDER BY UNT_ID", ct))
            if (await cibles.UniteAsync(RegistreOptim.Unite, l.Texte("UNT_ID")!, l.Texte("UNT_Code"), l.Texte("UNT_Libelle"), null,
                    l.Booleen("UNT_IsDesactive") != true, ct) is { } unite && l.Texte("UNT_Code") is { } code)
                ctx.Registre.InscrireCode(RegistreOptim.UniteCode, code, unite);

        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteTva, ct))
        {
            var taux = l.Decimal("PRM_Param_Num1") ?? 0;
            var libelle = Associations.Normaliser(l.Texte("PRM_Libelle"));
            // Catégorie lue dans le libellé (OPTIM n'en a pas) : autoliquidation, intracommunautaire, exonération.
            var categorie = libelle.Contains("AUTOLIQ", StringComparison.Ordinal) ? "A"
                : libelle.Contains("INTRA", StringComparison.Ordinal) ? "I"
                : taux == 0 ? "E" : Associations.CategorieNormale;
            await cibles.TauxAsync(RegistreOptim.Tva, l.Texte("PRM_ID")!, taux, categorie, l.Texte("PRM_Libelle") ?? l.Texte("PRM_Code") ?? "",
                l.Booleen("PRM_IsDesactive") != true, null, null, ct);
        }

        var volumeModes = ctx.Rapport.Volume(RegistreOptim.Mode);
        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteModes, ct))
        {
            volumeModes.Lues++;
            if (await cibles.ModeAsync(RegistreOptim.Mode, l.Texte("PRM_ID")!, l.Texte("PRM_Code"), l.Texte("PRM_Libelle"), ct) is null)
                volumeModes.Ecartees++;
            else volumeModes.Ecrites++;
        }

        await CivilitesAsync(ctx, ct);
        await NaturesAsync(ctx, cibles, ct);
    }

    private static async Task ComptesAsync(ContexteReprise ctx, ReferentielsCible cibles, CancellationToken ct)
    {
        var societes = SocietesOptim.Ids(ctx).ToHashSet();
        var collectifs = (await SqlReprise.SourceAsync(ctx, "SELECT DISTINCT TRS_CompteTiers FROM bib_tiers WHERE TRS_CompteTiers IS NOT NULL", ct))
            .Select(l => l.Texte("TRS_CompteTiers")).OfType<string>().ToHashSet(StringComparer.Ordinal);
        var volume = ctx.Rapport.Volume("svcz_compte");
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT CPT_NumCompte, CPT_Libelle, CPT_SCT_ID FROM svcz_compte ORDER BY CPT_NumCompte, CPT_ID", ct))
        {
            volume.Lues++;
            // Plan commun (SCT_ID = 0) ou d'une société retenue.
            if (l.Texte("CPT_NumCompte") is not { } compte || l.Id("CPT_SCT_ID") is { } sct && !societes.Contains(sct)) { volume.Ecartees++; continue; }
            var (type, sens) = ReferentielsCible.Classer(compte, collectifs);
            await cibles.CompteAsync(compte, l.Texte("CPT_Libelle"), type, sens, ct);
            volume.Ecrites++;
        }
    }

    private static async Task CivilitesAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var table = ctx.Correspondances.Tables[TablesCorrespondance.Civilite];
        if (table.TypeParametre is null) return;
        var volume = ctx.Rapport.Volume(RegistreOptim.Civilite);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT PRM_ID, PRM_Code FROM z_parametre WHERE PRM_TypeParam = @type ORDER BY PRM_ID", ct,
                     new Dictionary<string, object?> { ["type"] = table.TypeParametre }))
        {
            volume.Lues++;
            if (ctx.Correspondre(TablesCorrespondance.Civilite, l.Texte("PRM_Code"), $"z_parametre {l.Texte("PRM_ID")}") is { Ignorer: false, Cible: { } c })
            {
                ctx.Registre.InscrireCode(RegistreOptim.Civilite, l.Texte("PRM_ID")!, c);
                volume.Ecrites++;
            }
            else volume.Ecartees++;
        }
    }

    /// <summary>Types de familles → natures, regroupement par le premier indicateur vrai de la table « regroupement_nature ».</summary>
    private static async Task NaturesAsync(ContexteReprise ctx, ReferentielsCible cibles, CancellationToken ct)
    {
        var regles = ctx.Correspondances.Tables[TablesCorrespondance.RegroupementNature].Entrees;
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM ref_famille_type ORDER BY FTY_Ordre, FTY_ID", ct))
        {
            var regle = regles.FirstOrDefault(r => l.Contient(r.Source) && l.Booleen(r.Source) == true);
            if (regle is not null) ctx.Rapport.Appliquer(TablesCorrespondance.RegroupementNature, regle.Source, regle.Ignorer ? $"ignoré : {regle.Motif}" : regle.Cible!);
            await cibles.NatureAsync(RegistreOptim.Nature, l.Texte("FTY_ID")!, l.Texte("FTY_Code") ?? l.Texte("FTY_ID")!,
                l.Texte("FTY_Libelle") ?? l.Texte("FTY_Code") ?? "", regle is { Ignorer: false } ? regle.Cible : null,
                l.Booleen("FTY_IsDesactive") != true, ct);
        }
    }
}
