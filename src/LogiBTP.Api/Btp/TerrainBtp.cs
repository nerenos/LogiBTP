using System.Globalization;
using System.Text.Json;
using LogiBTP.Ged.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Application de terrain, lot 1 (ANALYSE-TERRAIN.md) : tâches du planning de la personne connectée (salarié ou
/// intérimaire lié à son compte, affecté seul ou par une équipe développée en membres) sur une période, avec leur
/// partie mobile (<c>tac_mobile</c> : adresse, contact, commentaire, liens), les valeurs par défaut de leur chantier
/// (adresse des travaux, contact sur place et son téléphone) et les pièces de la GED diffusées sur le terrain
/// (<c>dge_terrain</c>) du chantier, de ses marchés et de l'ordre d'origine de la tâche (ordre ou étape d'ordre).
/// Pièces confidentielles, secrètes ou à accès restreint jamais proposées. Routes <c>/api/terrain</c> (nœud « terrain »).
/// </summary>
public static partial class TerrainBtp
{
    /// <summary>Période lue au plus (jours).</summary>
    private const int JoursMax = 31;

    /// <summary>Tâches de la personne @s sur [@du, @au] (dates), avec leur chantier et l'ordre d'origine (ordre ou étape).</summary>
    private const string SqlTaches = """
        WITH t AS (
          SELECT DISTINCT t.* FROM pla_tache t JOIN pla_affectation a ON a.aff_tac_id = t.tac_id
          WHERE a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text
            AND t.tac_debut < (@au::date + 1) AND t.tac_fin > @du::date
        ), x AS (
          SELECT t.*, c.cha_id, c.cha_code, c.cha_libelle, d.ent_id, d.ent_numero, d.ent_objet, coalesce(d.ent_groupe_id, d.ent_id) AS groupe,
                 ty.tyd_code, sv.srv_libelle
          FROM t
          LEFT JOIN chantier c ON t.tac_type_element = 'chantier' AND t.tac_id_element ~ '^[0-9]+$' AND c.cha_id = t.tac_id_element::int
          LEFT JOIN exe_ordre_etape e ON t.tac_origine_type = 'etape' AND e.ore_id::text = t.tac_origine_id
          LEFT JOIN document d ON d.ent_id = CASE WHEN t.tac_origine_type = 'ordre' AND t.tac_origine_id ~ '^[0-9]+$' THEN t.tac_origine_id::bigint ELSE e.ore_ordre_id END
          LEFT JOIN type_document ty ON ty.tyd_id = d.ent_tyd_id
          LEFT JOIN service sv ON sv.srv_id = t.tac_srv_id
        )
        """;

    /// <summary>Condition d'une pièce « Terrain » g visible pour la ligne x (chantier, marchés du chantier, ordre).</summary>
    private const string SqlPieceVisible = """
        g.dge_terrain AND NOT g.dge_supprime AND NOT g.dge_archive
          AND g.dge_confidentialite IN ('PUBLIC', 'INTERNE') AND cardinality(g.dge_acces_profils) = 0 AND cardinality(g.dge_acces_utilisateurs) = 0
          AND ((g.dge_type_element = 'chantier' AND g.dge_id_element = x.cha_id::text)
            OR (g.dge_type_element = 'marche' AND g.dge_id_element IN (SELECT m.mar_id::text FROM marche m WHERE m.mar_cha_id = x.cha_id))
            OR (g.dge_type_element = x.tyd_code AND g.dge_id_element = x.groupe::text))
        """;

    private sealed record Personne(int Id, string Libelle);

    public static RouteGroupBuilder MapTerrain(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/terrain");

        // Tâches de la période (par défaut : aujourd'hui et les six jours suivants) ; personne nulle : compte sans salarié.
        g.MapGet("", async (string? du, string? au, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var (debut, fin) = Periode(du, au);
            if (await ComptesBtp.SalarieAsync(db, Utilisateur.Depuis(http).Code, ct) is not int s)
                return Results.Ok(new { personne = (object?)null, du = Jour(debut), au = Jour(fin), taches = Array.Empty<object>(), chantiers = new Dictionary<string, object?>() });
            var personne = await db.Database.SqlQueryRaw<Personne>(
                "SELECT s.sal_id AS id, concat_ws(' ', s.sal_prenom, s.sal_nom) AS libelle FROM salarie s WHERE s.sal_id = @s", new NpgsqlParameter("s", s)).FirstAsync(ct);
            var lignes = await db.Database.SqlQueryRaw<string>($$"""
                {{SqlTaches}}
                SELECT json_build_object(
                  'id', x.tac_id, 'libelle', x.tac_libelle, 'debut', to_char(x.tac_debut, 'YYYY-MM-DD"T"HH24:MI'), 'fin', to_char(x.tac_fin, 'YYYY-MM-DD"T"HH24:MI'),
                  'heures', x.tac_heures, 'etat', x.tac_etat, 'avancement', x.tac_avancement, 'memo', x.tac_memo, 'couleur', x.tac_couleur,
                  'type_element', x.tac_type_element, 'service', x.srv_libelle, 'mobile', x.tac_mobile,
                  'chantier', CASE WHEN x.cha_id IS NOT NULL THEN json_build_object('id', x.cha_id, 'code', x.cha_code, 'libelle', x.cha_libelle) END,
                  'ordre', CASE WHEN x.ent_id IS NOT NULL THEN json_build_object('id', x.ent_id, 'numero', x.ent_numero, 'objet', x.ent_objet, 'type', x.tyd_code) END,
                  'equipiers', (SELECT coalesce(json_agg(r.libelle ORDER BY r.libelle), '[]') FROM pla_affectation a JOIN v_ressource r ON r.type = a.aff_res_type AND r.id = a.aff_res_id
                                WHERE a.aff_tac_id = x.tac_id AND NOT (a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text)),
                  'pieces', (SELECT coalesce(json_agg(json_build_object('id', g.dge_id, 'titre', g.dge_titre, 'categorie', g.dge_categorie, 'element', g.dge_type_element,
                               'nom_fichier', v.vge_nom_fichier, 'type_mime', v.vge_type_mime, 'taille', v.vge_taille) ORDER BY g.dge_titre), '[]')
                             FROM document_ged g
                             CROSS JOIN LATERAL (SELECT w.vge_nom_fichier, w.vge_type_mime, w.vge_taille FROM version_ged w WHERE w.vge_document = g.dge_id ORDER BY w.vge_numero DESC LIMIT 1) v
                             WHERE {{SqlPieceVisible}})
                )::text AS "Value"
                FROM x ORDER BY x.tac_debut, x.tac_id
                """, Parametres(s, debut, fin)).ToListAsync(ct);
            var taches = lignes.Select(l => JsonDocument.Parse(l).RootElement).ToList();
            var chantiers = new Dictionary<string, object?>();
            foreach (var id in taches.Where(t => t.GetProperty("chantier").ValueKind == JsonValueKind.Object).Select(t => t.GetProperty("chantier").GetProperty("id").GetInt32()).Distinct())
                chantiers[id.ToString(CultureInfo.InvariantCulture)] = await DefautChantierAsync(db, id, ct);
            return Results.Ok(new { personne = new { id = personne.Id, libelle = personne.Libelle }, du = Jour(debut), au = Jour(fin), taches, chantiers, motifs = await MotifsAsync(db, ct) });
        });

        // Valeurs par défaut de la partie mobile d'une tâche sur ce chantier (repères du détail de la tâche du planning).
        g.MapGet("/chantiers/{id:int}", async (int id, LogiBtpContext db, CancellationToken ct) =>
            await DefautChantierAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable($"Chantier {id}"));

        // Contenu d'une pièce « Terrain » d'une tâche de la personne (30 jours autour d'aujourd'hui).
        g.MapGet("/pieces/{id:long}", async (long id, bool? telecharger, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Introuvable($"Pièce {id}");
            var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
            var version = await db.Database.SqlQueryRaw<long?>($$"""
                {{SqlTaches}}
                SELECT (SELECT w.vge_id FROM version_ged w WHERE w.vge_document = g.dge_id ORDER BY w.vge_numero DESC LIMIT 1) AS "Value"
                FROM x JOIN document_ged g ON g.dge_id = @piece AND {{SqlPieceVisible}}
                LIMIT 1
                """, [.. Parametres(s, aujourdhui.AddDays(-30), aujourdhui.AddDays(30)), new NpgsqlParameter("piece", id)]).FirstOrDefaultAsync(ct)
                ?? throw ExceptionMetier.Introuvable($"Pièce {id}");
            return await ged.Contenu(version, telecharger == true, http, u, ct);
        });
        return g.MapJournee().MapOrdresTerrain().MapReceptionTerrain().MapSavTerrain();
    }

    /// <summary>Motifs de non-conformité proposés (paramètres des ressources) ; tout autre motif reste saisissable.</summary>
    private static Task<List<string>> MotifsAsync(LogiBtpContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>("SELECT mot_libelle AS \"Value\" FROM motif WHERE mot_domaine = 'NON_CONFORMITE' AND mot_actif ORDER BY mot_ordre, mot_libelle").ToListAsync(ct);

    private static NpgsqlParameter[] Parametres(int salarie, DateOnly du, DateOnly au) =>
        [new("s", salarie), new("du", Jour(du)), new("au", Jour(au))];

    private static string Jour(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Période demandée, bornée à <see cref="JoursMax"/> jours (défaut : aujourd'hui et les six jours suivants).</summary>
    private static (DateOnly, DateOnly) Periode(string? du, string? au)
    {
        var debut = DateOnly.TryParseExact(du, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : DateOnly.FromDateTime(DateTime.Today);
        var fin = DateOnly.TryParseExact(au, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var f) ? f : debut.AddDays(6);
        if (fin < debut) throw ExceptionMetier.Invalide("TERRAIN_PERIODE", "Période inversée");
        if (fin.DayNumber - debut.DayNumber >= JoursMax) throw ExceptionMetier.Invalide("TERRAIN_PERIODE", $"Période limitée à {JoursMax} jours");
        return (debut, fin);
    }

    /// <summary>Adresse des travaux (une ligne), contact sur place et son téléphone d'un chantier (null : introuvable).</summary>
    private static async Task<object?> DefautChantierAsync(LogiBtpContext db, int chaId, CancellationToken ct)
    {
        using var a = await AdressesDocument.Chantier(db, chaId, ct);
        if (a is null) return null;
        var r = a.RootElement;
        static string? Texte(JsonElement e, string p) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        static string Joindre(string separateur, params string?[] parts) => string.Join(separateur, parts.Where(x => !string.IsNullOrWhiteSpace(x)));
        var adr = r.GetProperty("adresse");
        var adresse = Joindre(", ", Texte(adr, "ligne1"), Joindre(" ", Texte(adr, "code_postal"), Texte(adr, "ville")));
        return new { adresse = adresse.Length == 0 ? null : adresse, contact = Texte(r.GetProperty("contact"), "nom"), telephone = Texte(r, "telephone") };
    }
}
