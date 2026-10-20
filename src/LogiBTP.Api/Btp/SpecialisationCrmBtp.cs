using LogiBTP.Crm.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module CRM par le cœur : éléments rattachables (tiers, individus, structure des affaires,
/// documents : groupe d'indices, page de l'indice de référence) avec leur libellé et leur page, individu de l'utilisateur (`ind_utilisateur`), services de l'entreprise et
/// leurs membres (db/193).
/// </summary>
public class SpecialisationCrmBtp : SpecialisationCrm
{
    public override IReadOnlyList<TypeElementCrm> TypesElements { get; } =
    [
        new("personne", "Tiers", "🏢"), new("individu", "Contact", "👤"), new("projet", "Projet", "🎯"), new("affaire", "Affaire", "🗂"),
        new("chantier", "Chantier", "🏗"), new("marche", "Marché", "📜"), new("document", "Document", "📄"),
    ];

    /// <summary>Libellé de chaque type : requête sur ses identifiants (liste fermée, jamais saisie).</summary>
    private static readonly Dictionary<string, string> Libelles = new()
    {
        ["personne"] = "SELECT per_id::text AS id, coalesce(nullif(per_nom_commercial, ''), per_raison_sociale) AS libelle, NULL::text AS url FROM personne WHERE per_id = ANY(@ids)",
        ["individu"] = "SELECT ind_id::text AS id, concat_ws(' ', ind_prenom, ind_nom) AS libelle, NULL::text AS url FROM individu WHERE ind_id = ANY(@ids)",
        ["projet"] = "SELECT prj_id::text AS id, concat_ws(' – ', prj_code, prj_libelle) AS libelle, NULL::text AS url FROM projet WHERE prj_id = ANY(@ids)",
        ["affaire"] = "SELECT aff_id::text AS id, concat_ws(' – ', aff_code, aff_libelle) AS libelle, NULL::text AS url FROM affaire WHERE aff_id = ANY(@ids)",
        ["chantier"] = "SELECT cha_id::text AS id, concat_ws(' – ', cha_code, cha_libelle) AS libelle, NULL::text AS url FROM chantier WHERE cha_id = ANY(@ids)",
        ["marche"] = "SELECT mar_id::text AS id, concat_ws(' – ', mar_code, mar_libelle) AS libelle, NULL::text AS url FROM marche WHERE mar_id = ANY(@ids)",
        ["document"] = """
            SELECT DISTINCT ON (coalesce(d.ent_groupe_id, d.ent_id)) coalesce(d.ent_groupe_id, d.ent_id)::text AS id,
                   concat_ws(' ', t.tyd_libelle, coalesce(d.ent_numero, '(brouillon)'), '–', d.ent_objet) AS libelle, '/document/' || d.ent_id AS url
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE coalesce(d.ent_groupe_id, d.ent_id) = ANY(@ids)
            ORDER BY coalesce(d.ent_groupe_id, d.ent_id), d.ent_is_reference DESC, d.ent_id DESC
            """,
    };

    private static string? Url(string type, string id) => type switch
    {
        "personne" or "individu" or "projet" or "affaire" or "chantier" or "marche" => $"/fiche/{type}/{id}",
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

    /// <summary>Projet de la structure (code PRJ-AAAA-NNN, statut En cours) repris de la demande.</summary>
    public override async Task<ElementCrm?> CreerProjetAsync(CrmDbContext db, CrmDemande d, string? responsable, CancellationToken ct)
    {
        var commentaire = d.DemDescriptionHtml is null ? null : System.Text.RegularExpressions.Regex.Replace(d.DemDescriptionHtml, "<[^>]+>", " ").Trim();
        var id = await db.Database.SqlQueryRaw<int>("""
            INSERT INTO projet (prj_code, prj_libelle, prj_tiers_id, prj_statut, prj_montant_estime, prj_responsable, prj_commentaire, prj_proprietes)
            SELECT 'PRJ-' || extract(year FROM now())::int || '-' || lpad((coalesce(max(substring(prj_code FROM '^PRJ-[0-9][0-9][0-9][0-9]-([0-9]+)$')::int), 0) + 1)::text, 3, '0'),
                   left(@libelle, 150), @tiers, 'EN_COURS', @montant, left(@responsable, 100), @commentaire, jsonb_build_object('crm_demande', @demande::text)
            FROM projet WHERE prj_code LIKE 'PRJ-' || extract(year FROM now())::int || '-%'
            RETURNING prj_id AS "Value"
            """,
            new NpgsqlParameter("libelle", d.DemObjet), new NpgsqlParameter("tiers", NpgsqlTypes.NpgsqlDbType.Bigint) { Value = (object?)d.DemTiersId ?? DBNull.Value },
            new NpgsqlParameter("montant", NpgsqlTypes.NpgsqlDbType.Numeric) { Value = (object?)d.DemMontantEstime ?? DBNull.Value },
            new NpgsqlParameter("responsable", NpgsqlTypes.NpgsqlDbType.Varchar) { Value = (object?)responsable ?? DBNull.Value },
            new NpgsqlParameter("commentaire", NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)commentaire ?? DBNull.Value },
            new NpgsqlParameter("demande", d.DemNumero)).ToListAsync(ct); // pas d'accolades dans le SQL : EF les lit comme des paramètres
        return new ElementCrm("projet", id[0].ToString());
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
        db.Database.SqlQueryRaw<long?>("SELECT ind_id AS \"Value\" FROM individu WHERE ind_utilisateur = @u", new NpgsqlParameter("u", utilisateur)).FirstOrDefaultAsync(ct);

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
    private sealed record IndividuSql(long Id, string Nom);
}
