using LogiBTP.Crm.Web;
using LogiBTP.Domaine;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module CRM par le cœur : éléments rattachables (tiers, individus, structure des affaires,
/// documents : groupe d'indices, page de l'indice de référence) avec leur libellé et leur page, individu de l'utilisateur (`ind_utilisateur`), services de l'entreprise et
/// leurs membres (db/193).
/// </summary>
public class SpecialisationCrmBtp(IServiceScopeFactory scopes) : SpecialisationCrm
{
    public override IReadOnlyList<TypeElementCrm> TypesElements { get; } =
    [
        new(TypesFiche.Personne, "Tiers", "🏢"), new(TypesFiche.Individu, "Contact", "👤"), new(TypesFiche.Projet, "Projet", "🎯"), new(TypesFiche.Affaire, "Affaire", "🗂"),
        new(TypesFiche.Chantier, "Chantier", "🏗"), new(TypesFiche.Marche, "Marché", "📜"), new("document", "Document", "📄"),
    ];

    /// <summary>Libellé de chaque type : requête sur ses identifiants (liste fermée, jamais saisie).</summary>
    private static readonly Dictionary<string, string> Libelles = new()
    {
        [TypesFiche.Personne] = "SELECT per_id::text AS id, coalesce(nullif(per_nom_commercial, ''), per_raison_sociale) AS libelle, NULL::text AS url FROM personne WHERE per_id = ANY(@ids)",
        [TypesFiche.Individu] = "SELECT ind_id::text AS id, concat_ws(' ', ind_prenom, ind_nom) AS libelle, NULL::text AS url FROM individu WHERE ind_id = ANY(@ids)",
        [TypesFiche.Projet] = "SELECT prj_id::text AS id, concat_ws(' – ', prj_code, prj_libelle) AS libelle, NULL::text AS url FROM projet WHERE prj_id = ANY(@ids)",
        [TypesFiche.Affaire] = "SELECT aff_id::text AS id, concat_ws(' – ', aff_code, aff_libelle) AS libelle, NULL::text AS url FROM affaire WHERE aff_id = ANY(@ids)",
        [TypesFiche.Chantier] = "SELECT cha_id::text AS id, concat_ws(' – ', cha_code, cha_libelle) AS libelle, NULL::text AS url FROM chantier WHERE cha_id = ANY(@ids)",
        [TypesFiche.Marche] = "SELECT mar_id::text AS id, concat_ws(' – ', mar_code, mar_libelle) AS libelle, NULL::text AS url FROM marche WHERE mar_id = ANY(@ids)",
        ["document"] = """
            SELECT DISTINCT ON (coalesce(d.ent_groupe_id, d.ent_id)) coalesce(d.ent_groupe_id, d.ent_id)::text AS id,
                   concat_ws(' ', t.tyd_libelle, coalesce(d.ent_numero, '(brouillon)'), '–', d.ent_objet) AS libelle, '/document/' || d.ent_id AS url
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE coalesce(d.ent_groupe_id, d.ent_id) = ANY(@ids)
            ORDER BY coalesce(d.ent_groupe_id, d.ent_id), d.ent_is_reference DESC, d.ent_id DESC
            """,
    };

    private static string? Url(string type, string id) => type switch
    {
        TypesFiche.Personne or TypesFiche.Individu or TypesFiche.Projet or TypesFiche.Affaire or TypesFiche.Chantier or TypesFiche.Marche => $"/fiche/{type}/{id}",
        _ => null,
    };

    public override async Task<List<ElementDecrit>> DecrireAsync(CrmDbContext db, IReadOnlyCollection<ElementCrm> elements, CancellationToken ct)
    {
        var res = new List<ElementDecrit>();
        foreach (var g in elements.GroupBy(e => e.Type))
        {
            var icone = TypesElements.FirstOrDefault(t => t.Code == g.Key)?.Icone;
            var libelles = new Dictionary<string, LibelleSql>();
            var ids = g.Select(e => long.TryParse(e.Id, out var x) ? x : (long?)null).Where(x => x is not null).Select(x => x!.Value).Distinct().ToArray();
            if (Libelles.TryGetValue(g.Key, out var sql) && ids.Length > 0)
            {
                libelles = await db.Database.SqlQueryRaw<LibelleSql>(sql, new NpgsqlParameter("ids", ids)).ToDictionaryAsync(x => x.Id, ct);
            }
            var type = TypesElements.FirstOrDefault(t => t.Code == g.Key)?.Libelle ?? g.Key;
            res.AddRange(g.Select(e => libelles.TryGetValue(e.Id, out var l)
                ? new ElementDecrit(e.Type, e.Id, l.Libelle ?? e.Id, l.Url ?? Url(e.Type, e.Id), icone)
                : new ElementDecrit(e.Type, e.Id, $"{type} {e.Id} (introuvable)", null, icone)));
        }
        return res;
    }

    /// <summary>Projet de la structure (code du chrono des fiches projet, statut En cours) repris de la demande.</summary>
    public override async Task<ElementCrm?> CreerProjetAsync(CrmDbContext db, CrmDemande d, string? responsable, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var code = await scope.ServiceProvider.GetRequiredService<LogiBTP.Socle.Web.IChronosFiches>().AttribuerAsync(TypesFiche.Projet, new Dictionary<string, object?>(), ct)
            ?? throw LogiBTP.Socle.Web.ExceptionMetier.Conflit("PROJET_IMPOSSIBLE", "Chrono des projets indisponible");
        var commentaire = d.DemDescriptionHtml is null ? null : System.Text.RegularExpressions.Regex.Replace(d.DemDescriptionHtml, "<[^>]+>", " ").Trim();
        // Responsable du projet : celui de la demande s'il est un individu de notre structure (règle de la fiche projet).
        long? responsableId = d.DemResponsableId is long r && await IndividusStructure.EstDeLaStructureAsync(db, r, ct) ? r : null;
        var id = await db.Database.SqlQueryRaw<int>("""
            INSERT INTO projet (prj_code, prj_libelle, prj_tiers_id, prj_statut, prj_montant_estime, prj_responsable_ind_id, prj_commentaire, prj_proprietes)
            VALUES (@code, left(@libelle, 150), @tiers, 'EN_COURS', @montant, @responsable, @commentaire, jsonb_build_object('crm_demande', @demande::text))
            RETURNING prj_id AS "Value"
            """,
            new NpgsqlParameter("code", code), new NpgsqlParameter("libelle", d.DemObjet), new NpgsqlParameter("tiers", NpgsqlTypes.NpgsqlDbType.Bigint) { Value = (object?)d.DemTiersId ?? DBNull.Value },
            new NpgsqlParameter("montant", NpgsqlTypes.NpgsqlDbType.Numeric) { Value = (object?)d.DemMontantEstime ?? DBNull.Value },
            new NpgsqlParameter("responsable", NpgsqlTypes.NpgsqlDbType.Bigint) { Value = (object?)responsableId ?? DBNull.Value },
            new NpgsqlParameter("commentaire", NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)commentaire ?? DBNull.Value },
            new NpgsqlParameter("demande", d.DemNumero)).ToListAsync(ct); // pas d'accolades dans le SQL : EF les lit comme des paramètres
        return new ElementCrm(TypesFiche.Projet, id[0].ToString());
    }

    /// <summary>
    /// Périmètre du fil : un projet, une affaire, un chantier ou un marché agrège ce qui lui est rattaché (chantiers,
    /// marchés, documents par groupe d'indices) ; les autres éléments restent seuls.
    /// </summary>
    public override async Task<List<ElementCrm>> PerimetreAsync(CrmDbContext db, ElementCrm element, CancellationToken ct)
    {
        var res = new List<ElementCrm> { element };
        if (element.Type is not (TypesFiche.Projet or TypesFiche.Affaire or TypesFiche.Chantier or TypesFiche.Marche) || !int.TryParse(element.Id, out var id)) return res;
        var lignes = await db.Database.SqlQueryRaw<PerimetreSql>("""
            WITH chantiers AS (
                SELECT cha_id FROM chantier WHERE (@type = 'affaire' AND cha_aff_id = @id) OR (@type = 'projet' AND cha_prj_id = @id) OR (@type = 'chantier' AND cha_id = @id)),
            marches AS (
                SELECT mar_id FROM marche WHERE mar_cha_id IN (SELECT cha_id FROM chantiers) OR (@type = 'marche' AND mar_id = @id))
            SELECT 'chantier' AS type, cha_id::text AS id FROM chantiers WHERE @type <> 'chantier'
            UNION SELECT 'marche', mar_id::text FROM marches WHERE @type <> 'marche'
            UNION SELECT DISTINCT 'document', coalesce(ent_groupe_id, ent_id)::text FROM document
              WHERE (@type = 'projet' AND ent_projet_id = @id) OR (@type = 'affaire' AND ent_affaire_id = @id)
                 OR ent_chantier_id IN (SELECT cha_id FROM chantiers) OR ent_marche_id IN (SELECT mar_id FROM marches)
            """, new NpgsqlParameter("type", element.Type), new NpgsqlParameter("id", id)).ToListAsync(ct);
        res.AddRange(lignes.Select(l => new ElementCrm(l.Type, l.Id)));
        return res;
    }

    /// <summary>
    /// Documents de la GED des éléments (internes, ni supprimés ni archivés) : un document de l'application est rangé sous
    /// le code de son type et son groupe d'indices ; image = type MIME image/*, affichée par le contenu de sa version.
    /// </summary>
    public override async Task<List<DocumentFil>> DocumentsAsync(CrmDbContext db, IReadOnlyCollection<ElementCrm> elements, DateTimeOffset? avant, int taille, CancellationToken ct)
    {
        if (elements.Count == 0) return [];
        var cibles = elements.Where(e => e.Type != "document").Select(e => (Ged: (e.Type, e.Id), Element: e)).ToList();
        var groupes = elements.Where(e => e.Type == "document").Select(e => long.TryParse(e.Id, out var g) ? g : -1).Where(g => g > 0).ToArray();
        if (groupes.Length > 0)
        {
            var types = await db.Database.SqlQueryRaw<PerimetreSql>("""
                SELECT DISTINCT t.tyd_code AS type, coalesce(d.ent_groupe_id, d.ent_id)::text AS id
                FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE coalesce(d.ent_groupe_id, d.ent_id) = ANY(@g)
                """, new NpgsqlParameter("g", groupes)).ToListAsync(ct);
            cibles.AddRange(types.Select(t => (Ged: (t.Type, t.Id), Element: new ElementCrm("document", t.Id))));
        }
        var parGed = cibles.GroupBy(c => c.Ged).ToDictionary(g => g.Key, g => g.First().Element);
        var lignes = await db.Database.SqlQueryRaw<DocumentSql>("""
            SELECT d.dge_id AS id, d.dge_titre AS titre, d.dge_type_element AS type_element, d.dge_id_element AS id_element,
                   coalesce(v.vge_type_mime, '') LIKE 'image/%' AS image, d.dge_cree_le AS quand, d.dge_cree_par AS par, v.vge_id AS version
            FROM document_ged d
            JOIN unnest(@types, @ids) AS c(t, i) ON c.t = d.dge_type_element AND c.i = d.dge_id_element
            LEFT JOIN version_ged v ON v.vge_document = d.dge_id AND v.vge_numero = d.dge_version_courante
            WHERE NOT d.dge_supprime AND NOT d.dge_archive AND coalesce(d.dge_confidentialite, 'INTERNE') = 'INTERNE' AND d.dge_cree_le < @avant
            ORDER BY d.dge_cree_le DESC LIMIT @taille
            """,
            new NpgsqlParameter("types", parGed.Keys.Select(k => k.Item1).ToArray()), new NpgsqlParameter("ids", parGed.Keys.Select(k => k.Item2).ToArray()),
            new NpgsqlParameter("avant", avant ?? DateTimeOffset.MaxValue), new NpgsqlParameter("taille", taille)).ToListAsync(ct);
        return lignes.Select(l => new DocumentFil(parGed.GetValueOrDefault((l.TypeElement, l.IdElement)) ?? new ElementCrm(l.TypeElement, l.IdElement), l.Id, l.Titre, l.Image,
            l.Quand, l.Par, $"/ged/{l.Id}", l.Image && l.Version is long v ? $"/api/ged/versions/{v}/contenu" : null)).ToList();
    }

    /// <summary>Documents par numéro ou objet (groupe d'indices, indice de référence).</summary>
    public override async Task<List<ElementDecrit>> RechercherAsync(CrmDbContext db, string type, string texte, CancellationToken ct)
    {
        if (type != "document") return [];
        var lignes = await db.Database.SqlQueryRaw<LibelleSql>("""
            SELECT coalesce(d.ent_groupe_id, d.ent_id)::text AS id, concat_ws(' ', t.tyd_libelle, coalesce(d.ent_numero, '(brouillon)'), '–', d.ent_objet) AS libelle,
                   '/document/' || d.ent_id AS url
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            WHERE d.ent_is_reference AND (d.ent_numero ILIKE @m OR d.ent_objet ILIKE @m)
            ORDER BY d.ent_id DESC LIMIT 15
            """, new NpgsqlParameter("m", $"%{texte.Trim()}%")).ToListAsync(ct);
        return lignes.Select(l => new ElementDecrit("document", l.Id, l.Libelle ?? l.Id, l.Url, "📄")).ToList();
    }

    public override Task<long?> IndividuAsync(CrmDbContext db, string utilisateur, CancellationToken ct) =>
        ComptesBtp.IndividuAsync(db, utilisateur, ct);

    public override async Task<Dictionary<long, string>> IndividusAsync(CrmDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        var liste = ids.Distinct().ToArray();
        if (liste.Length == 0) return [];
        return await db.Database.SqlQueryRaw<IndividuSql>(
            "SELECT ind_id AS id, concat_ws(' ', ind_prenom, ind_nom) AS nom FROM individu WHERE ind_id = ANY(@ids)", new NpgsqlParameter("ids", liste))
            .ToDictionaryAsync(x => x.Id, x => x.Nom, ct);
    }

    public override Task<List<ServiceEntreprise>> ServicesIndividuAsync(CrmDbContext db, long individu, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ServiceEntreprise>("""
            SELECT s.srv_id AS id, s.srv_code AS code, s.srv_libelle AS libelle, m.sme_principal AS principal
            FROM service_membre m JOIN service s ON s.srv_id = m.sme_srv_id WHERE m.sme_ind_id = @i AND s.srv_actif
            ORDER BY m.sme_principal DESC, s.srv_ordre
            """, new NpgsqlParameter("i", individu)).ToListAsync(ct);

    public override Task<List<ServiceEntreprise>> ServicesAsync(CrmDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ServiceEntreprise>("""
            SELECT s.srv_id AS id, s.srv_code AS code, CASE WHEN p.srv_id IS NULL THEN s.srv_libelle ELSE p.srv_libelle || ' › ' || s.srv_libelle END AS libelle,
                   FALSE AS principal
            FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id WHERE s.srv_actif
            ORDER BY coalesce(p.srv_ordre, s.srv_ordre), s.srv_parent_id NULLS FIRST, s.srv_ordre
            """).ToListAsync(ct);

    private sealed record LibelleSql(string Id, string? Libelle, string? Url);
    private sealed record PerimetreSql(string Type, string Id);
    private sealed record DocumentSql(long Id, string Titre, string TypeElement, string IdElement, bool Image, DateTimeOffset Quand, string? Par, long? Version);
    private sealed record IndividuSql(long Id, string Nom);
}
