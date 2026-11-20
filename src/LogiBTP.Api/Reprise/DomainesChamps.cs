using LogiBTP.Fiches;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Champs supplémentaires MDE (lot 5, Q12) : <c>SYS_RTCINFOS</c> des tables de fiches (table « table_fiche » des
/// correspondances ; les tables de pièces sont ignorées : leurs valeurs d'en-tête vont en note CRM au lot 10), type
/// par « type_champ » (DATATYPE). Clé du registre : « TABLENAME.FIELDNAME ».
/// </summary>
public sealed class ChampsMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Champs;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Referentiels];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var createur = await ChampsReprise.Createur.LireAsync(ctx, ct);
        var volume = ctx.Rapport.Volume("SYS_RTCINFOS");
        foreach (var l in await SqlReprise.SourceAsync(ctx,
                     "SELECT TABLENAME, FIELDNAME, DISPLAYNAME, DATATYPE FROM SYS_RTCINFOS ORDER BY TABLENAME, FIELDNAME", ct))
        {
            volume.Lues++;
            var cle = $"{l.Texte("TABLENAME")}.{l.Texte("FIELDNAME")}";
            var fiche = ctx.Correspondre(TablesCorrespondance.TableFiche, l.Texte("TABLENAME"), $"SYS_RTCINFOS {cle}");
            var type = ctx.Correspondre(TablesCorrespondance.TypeChamp, l.Texte("DATATYPE") ?? "", $"SYS_RTCINFOS {cle}");
            if (fiche is not { Ignorer: false, Cible: { } typeFiche } || l.Texte("FIELDNAME") is null) { volume.Ecartees++; continue; }
            var libelle = l.Texte("DISPLAYNAME") ?? l.Texte("FIELDNAME")!;

            // Champ existant de la fiche : par la table champ_fiche (« type_fiche.code » ou ignorer), sinon par le libellé.
            ChampStandard? standard = null;
            if (ctx.Correspondances.Tables.TryGetValue(TablesCorrespondance.ChampFiche, out var table) && table.Trouver(cle) is not null)
            {
                var e = ctx.Correspondre(TablesCorrespondance.ChampFiche, cle, $"SYS_RTCINFOS {cle}");
                if (e is not { Ignorer: false, Cible: { } cible }) { volume.Ecartees++; continue; }
                standard = cible.Split('.', 2) is [var tf, var code] && tf == typeFiche ? createur.Standard(typeFiche, code) : null;
                if (standard is null)
                {
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, $"SYS_RTCINFOS {cle}",
                        $"Champ « {cible} » inconnu de la fiche {typeFiche} : champ supplémentaire créé");
                }
            }
            else standard = createur.StandardDuLibelle(typeFiche, libelle);

            var champ = standard is not null ? createur.Utiliser(typeFiche, cle, standard)
                : await createur.CreerAsync(typeFiche, cle, libelle, type is { Ignorer: false, Cible: { } t } ? t : TypesChampSupplementaire.Texte, ct);
            if (champ is null) volume.Ecartees++; else volume.Ecrites++;
        }
    }
}

/// <summary>
/// Valeurs des champs supplémentaires MDE : colonnes <c>RTCFIELD*</c> des tables de fiches, écrites sur la fiche reprise
/// (registre : table source + CODE, posé par les domaines des lots 6 à 9). Exécuté en dernier.
/// </summary>
public sealed class ValeursChampsMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.ValeursChamps;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Champs];

    /// <summary>Tables de fiches MDE à zones supplémentaires et leur lecture (texte constant, clé CODE).</summary>
    private static readonly IReadOnlyDictionary<string, string> Requetes = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["PMECLIENT"] = "SELECT * FROM PMECLIENT",
        ["PMEFOURNISSEUR"] = "SELECT * FROM PMEFOURNISSEUR",
        ["PMECHARGEAFFAIRE"] = "SELECT * FROM PMECHARGEAFFAIRE",
        ["PMESALARIE"] = "SELECT * FROM PMESALARIE",
        ["PMEELEMENT"] = "SELECT * FROM PMEELEMENT",
        ["PMECHANTIER"] = "SELECT * FROM PMECHANTIER",
        ["PMEMATERIEL"] = "SELECT * FROM PMEMATERIEL",
    };

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        foreach (var (table, requete) in Requetes)
        {
            var champs = new List<(string Colonne, ChampRepris Champ)>();
            foreach (var l in await SqlReprise.SourceAsync(ctx,
                         "SELECT FIELDNAME FROM SYS_RTCINFOS WHERE TABLENAME = @table", ct, new Dictionary<string, object?> { ["table"] = table }))
                if (l.Texte("FIELDNAME") is { } f && ChampsReprise.Trouver(ctx, $"{table}.{f}") is { } c) champs.Add((f, c));
            if (champs.Count == 0) continue;
            var volume = ctx.Rapport.Volume($"{table}.RTCFIELD");
            foreach (var l in await SqlReprise.SourceAsync(ctx, requete, ct))
            {
                var id = ctx.Registre.Trouver(table, l.Texte("CODE") is { } code ? ctx.CleConservee(table, code) : null);
                foreach (var (colonne, champ) in champs.Where(c => l.Contient(c.Colonne)))
                {
                    if (ChampsReprise.Convertir(ctx, champ, l.Brut(colonne)) is not { } valeur) continue;
                    volume.Lues++;
                    if (id is null) { volume.Ecartees++; continue; }
                    await ChampsReprise.EcrireAsync(ctx, champ, id.Value, valeur, ct);
                    volume.Ecrites++;
                }
            }
        }
    }
}

/// <summary>
/// Champs supplémentaires OPTIM (lot 5, Q12) : une définition <c>z_dataspec_bdd</c> devient un champ de chaque fiche
/// dont des valeurs la citent (entité par la table « entite » des correspondances) ; type déduit des valeurs (date,
/// texte, sinon nombre). Clé du registre : « DTB_ID.entité ».
/// </summary>
public sealed class ChampsOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Champs;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Referentiels];

    private const string Requete = """
        SELECT b.DTB_ID, b.DTB_Code, b.DTB_Libelle, d.DTD_TypeEntite,
               MAX(CASE WHEN d.DTD_Date IS NOT NULL THEN 1 ELSE 0 END) AS avec_date,
               MAX(CASE WHEN d.DTD_TXT IS NOT NULL AND d.DTD_TXT <> '' THEN 1 ELSE 0 END) AS avec_texte
        FROM z_dataspec_bdd b JOIN z_dataspec_data d ON d.DTD_DTB_ID = b.DTB_ID
        WHERE b.DTB_IsDesactive = 0
        GROUP BY b.DTB_ID, b.DTB_Code, b.DTB_Libelle, d.DTD_TypeEntite
        ORDER BY b.DTB_Ordre, b.DTB_ID, d.DTD_TypeEntite
        """;

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var createur = await ChampsReprise.Createur.LireAsync(ctx, ct);
        var volume = ctx.Rapport.Volume("z_dataspec_bdd");
        foreach (var l in await SqlReprise.SourceAsync(ctx, Requete, ct))
        {
            volume.Lues++;
            var cle = $"{l.Texte("DTB_ID")}.{l.Texte("DTD_TypeEntite")}";
            if (ctx.Correspondre(TablesCorrespondance.Entite, l.Texte("DTD_TypeEntite"), $"z_dataspec_bdd {cle}") is not { Ignorer: false, Cible: { } fiche })
            { volume.Ecartees++; continue; }
            var type = l.Booleen("avec_date") == true ? TypesChampSupplementaire.Date
                : l.Booleen("avec_texte") == true ? TypesChampSupplementaire.Texte : TypesChampSupplementaire.Nombre;
            if (await createur.CreerAsync(fiche, cle, l.Texte("DTB_Libelle") ?? l.Texte("DTB_Code") ?? cle, type, ct) is null) volume.Ecartees++;
            else volume.Ecrites++;
        }
    }
}

/// <summary>
/// Valeurs des champs supplémentaires OPTIM (<c>z_dataspec_data</c>) : écrites sur la fiche reprise de l'entité
/// (registre : table source de l'entité + identifiant). Exécuté en dernier.
/// </summary>
public sealed class ValeursChampsOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.ValeursChamps;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Champs];

    /// <summary>Table source d'une entité polymorphe (clé du registre des fiches reprises).</summary>
    public static readonly IReadOnlyDictionary<string, string> TablesEntites = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["TRS"] = "bib_tiers", ["PRS"] = "bib_personne", ["SLR"] = "ref_salarie", ["MTR"] = "bib_materiel",
        ["ART"] = "bib_article", ["AFF"] = "afc_affaire", ["CHT"] = "afc_chantier",
    };

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume("z_dataspec_data");
        foreach (var l in await SqlReprise.SourceAsync(ctx,
                     "SELECT DTD_ID, DTD_DTB_ID, DTD_TypeEntite, DTD_Entite_Id, DTD_TXT, DTD_Num, DTD_Date FROM z_dataspec_data ORDER BY DTD_ID", ct))
        {
            var entite = l.Texte("DTD_TypeEntite") ?? "";
            if (ChampsReprise.Trouver(ctx, $"{l.Texte("DTD_DTB_ID")}.{entite}") is not { } champ) continue;
            var brut = champ.Type switch
            {
                TypesChampSupplementaire.Date => l.Brut("DTD_Date"),
                TypesChampSupplementaire.Texte => l.Brut("DTD_TXT"),
                _ => l.Decimal("DTD_Num") is { } n && n != 0 ? n : null,
            };
            if (ChampsReprise.Convertir(ctx, champ, brut) is not { } valeur) continue;
            volume.Lues++;
            var id = TablesEntites.TryGetValue(entite, out var table) && l.Texte("DTD_Entite_Id") is { } cle
                ? ctx.Registre.Trouver(table, ctx.CleConservee(table, cle)) : null;
            if (id is null) { volume.Ecartees++; continue; }
            await ChampsReprise.EcrireAsync(ctx, champ, id.Value, valeur, ct);
            volume.Ecrites++;
        }
    }
}
