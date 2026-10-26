using LogiBTP.Domaine.Ressources;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Relevé saisi : date, unité, valeur, remise à zéro, commentaire.</summary>
public sealed record ReleveSaisi(DateOnly? Date, string? Unite, decimal? Valeur, bool Remise, string? Commentaire);

/// <summary>Événement saisi, avec son relevé de compteur facultatif (obligatoire pour un plein si le matériel a un compteur).</summary>
public sealed record EvenementSaisi(string? Type, DateOnly? Date, DateOnly? Fin, string? Libelle, string? Description, decimal? Cout, decimal? Litres, long? EntId, ReleveSaisi? Releve);

/// <summary>
/// Compteurs et événements du matériel (db/233, lot 5c-2 des demandes du 25/10/2026) : relevés datés en heures ou
/// kilomètres contrôlés par <see cref="ReglesCompteurs"/> (une saisie ne fait apparaître aucune erreur nouvelle dans
/// l'historique), événements (panne, sinistre, accident, immobilisation, contrôle, entretien, plein de carburant) avec
/// relevé lié ; un plein est la première imputation possible : chantier de suivi créé s'il manque
/// (<see cref="CoutsMateriel.ChantierMaterielAsync"/>) et coût porté par <c>v_cout_chantier</c> (nature CARBURANT).
/// </summary>
public static class CompteursMateriel
{
    private sealed record ReleveSql(int Id, DateOnly Date, string Unite, decimal Valeur, bool Remise, int? MevId);

    private static async Task<IResult> Json(LogiBtpContext db, string sql, CancellationToken ct, params NpgsqlParameter[] p) =>
        Results.Content(await db.Database.SqlQueryRaw<string>(sql, p).FirstAsync(ct), "application/json");

    /// <summary>Historique du matériel : unités suivies, compteurs, relevés (récents d'abord), événements.</summary>
    public const string SqlHistorique = """
        SELECT json_build_object(
            'compteurs', m.mat_compteurs, 'heures', m.mat_heures, 'kilometres', m.mat_kilometres, 'chantier', m.mat_cha_id,
            'releves', coalesce((SELECT json_agg(json_build_object('id', r.mre_id, 'date', r.mre_date, 'unite', r.mre_unite, 'valeur', r.mre_valeur,
                    'remise', r.mre_remise, 'source', r.mre_source, 'ent_id', r.mre_ent_id, 'numero', d.ent_numero, 'evenement', r.mre_mev_id,
                    'commentaire', r.mre_commentaire, 'maj_par', r.mre_maj_par) ORDER BY r.mre_date DESC, r.mre_id DESC)
                FROM materiel_releve r LEFT JOIN document d ON d.ent_id = r.mre_ent_id WHERE r.mre_mat_id = m.mat_id), '[]'),
            'evenements', coalesce((SELECT json_agg(json_build_object('id', e.mev_id, 'type', e.mev_type, 'date', e.mev_date, 'fin', e.mev_fin,
                    'libelle', e.mev_libelle, 'description', e.mev_description, 'cout', e.mev_cout, 'litres', e.mev_litres,
                    'ent_id', e.mev_ent_id, 'numero', d.ent_numero, 'maj_par', e.mev_maj_par,
                    'releve', (SELECT json_build_object('unite', r.mre_unite, 'valeur', r.mre_valeur, 'remise', r.mre_remise) FROM materiel_releve r WHERE r.mre_mev_id = e.mev_id LIMIT 1))
                    ORDER BY e.mev_date DESC, e.mev_id DESC)
                FROM materiel_evenement e LEFT JOIN document d ON d.ent_id = e.mev_ent_id WHERE e.mev_mat_id = m.mat_id), '[]')) AS "Value"
        FROM materiel m WHERE m.mat_id = @m
        """;

    public static Task<IResult> HistoriqueAsync(LogiBtpContext db, int materiel, CancellationToken ct) => Json(db, SqlHistorique, ct, new NpgsqlParameter("m", materiel));

    private static async Task<string[]> UnitesAsync(LogiBtpContext db, int materiel, CancellationToken ct) =>
        ReglesCompteurs.UnitesCompteurs(await db.Database.SqlQueryRaw<string>("SELECT mat_compteurs AS \"Value\" FROM materiel WHERE mat_id = @m", new NpgsqlParameter("m", materiel))
            .FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("Matériel"));

    /// <summary>
    /// Contrôle un relevé ajouté (ou remplaçant celui de l'événement <paramref name="sansEvenement"/>) : refusé s'il fait
    /// apparaître une erreur qui n'existait pas dans l'historique (lui-même ou un relevé suivant devenu décroissant).
    /// </summary>
    public static async Task ControlerReleveAsync(LogiBtpContext db, int materiel, ReleveSaisi r, int? sansEvenement, CancellationToken ct)
    {
        var unites = await UnitesAsync(db, materiel, ct);
        var existants = (await db.Database.SqlQueryRaw<ReleveSql>("""
            SELECT mre_id AS id, mre_date AS date, mre_unite AS unite, mre_valeur AS valeur, mre_remise AS remise, mre_mev_id AS mev_id
            FROM materiel_releve WHERE mre_mat_id = @m ORDER BY mre_id
            """, new NpgsqlParameter("m", materiel)).ToListAsync(ct)).Where(x => sansEvenement is null || x.MevId != sansEvenement)
            .Select(x => new ReleveCompteur(x.Unite, x.Date, x.Valeur, x.Remise)).ToList();
        var avant = ReglesCompteurs.Controler(unites, existants).ToHashSet();
        var apres = ReglesCompteurs.Controler(unites, [.. existants, new ReleveCompteur(r.Unite, r.Date, r.Valeur, r.Remise)]);
        if (apres.FirstOrDefault(e => !avant.Contains(e)) is { } erreur)
        {
            throw ExceptionMetier.Invalide(erreur.Code, erreur.Code == "REL_DECROISSANT" && erreur.Releve < existants.Count
                ? "Un relevé postérieur deviendrait inférieur à celui-ci" : erreur.Code);
        }
    }

    private static Task InsererReleveAsync(LogiBtpContext db, int materiel, ReleveSaisi r, string source, int? evenement, long? ordre, string utilisateur, CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync("""
            INSERT INTO materiel_releve (mre_mat_id, mre_date, mre_unite, mre_valeur, mre_remise, mre_source, mre_ent_id, mre_mev_id, mre_commentaire, mre_maj_par)
            VALUES (@m, @d, @u, @v, @r, @s, @o, @e, @c, @p)
            """,
            [new NpgsqlParameter("m", materiel), new NpgsqlParameter("d", r.Date!.Value), new NpgsqlParameter("u", r.Unite!), new NpgsqlParameter("v", r.Valeur!.Value),
             new NpgsqlParameter("r", r.Remise), new NpgsqlParameter("s", source), new NpgsqlParameter("o", (object?)ordre ?? DBNull.Value),
             new NpgsqlParameter("e", (object?)evenement ?? DBNull.Value), new NpgsqlParameter("c", (object?)r.Commentaire?.Trim() ?? DBNull.Value),
             new NpgsqlParameter("p", utilisateur)], ct);

    /// <summary>Ajoute un relevé contrôlé (source SAISIE, ORDRE, BORNE…), lié à un ordre s'il y a lieu.</summary>
    public static async Task AjouterReleveAsync(LogiBtpContext db, int materiel, ReleveSaisi r, string source, long? ordre, string utilisateur, CancellationToken ct)
    {
        await ControlerReleveAsync(db, materiel, r, null, ct);
        await InsererReleveAsync(db, materiel, r, source, null, ordre, utilisateur, ct);
    }

    /// <summary>Crée (<paramref name="id"/> nul) ou remplace un événement et son relevé ; renvoie son identifiant.</summary>
    public static async Task<int> EnregistrerEvenementAsync(LogiBtpContext db, int materiel, int? id, EvenementSaisi e, string utilisateur, CancellationToken ct)
    {
        var erreurs = ReglesCompteurs.ControlerEvenement(new EvenementMateriel(e.Type, e.Date, e.Fin, e.Libelle, e.Litres, e.Cout));
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], string.Join(", ", erreurs));
        var releve = e.Releve is { Valeur: not null } r ? r with { Date = r.Date ?? e.Date } : null;
        if (releve is not null) await ControlerReleveAsync(db, materiel, releve, id, ct);
        if (e.Type == "CARBURANT") await CoutsMateriel.ChantierMaterielAsync(db, materiel, ct);
        var libelle = string.IsNullOrWhiteSpace(e.Libelle) ? null : e.Libelle.Trim();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        NpgsqlParameter[] p =
        [
            new("m", materiel), new("t", e.Type!), new("d", e.Date!.Value), new("f", (object?)e.Fin ?? DBNull.Value), new("l", (object?)libelle ?? DBNull.Value),
            new("x", (object?)e.Description?.Trim() ?? DBNull.Value), new("o", (object?)e.EntId ?? DBNull.Value), new("c", (object?)e.Cout ?? DBNull.Value),
            new("q", (object?)e.Litres ?? DBNull.Value), new("p", utilisateur), new("i", (object?)id ?? DBNull.Value),
        ];
        var mev = id is null
            ? (await db.Database.SqlQueryRaw<int>("""
                INSERT INTO materiel_evenement (mev_mat_id, mev_type, mev_date, mev_fin, mev_libelle, mev_description, mev_ent_id, mev_cout, mev_litres, mev_maj_par)
                VALUES (@m, @t, @d, @f, @l, @x, @o, @c, @q, @p) RETURNING mev_id AS "Value"
                """, p).ToListAsync(ct))[0]
            : await db.Database.ExecuteSqlRawAsync("""
                UPDATE materiel_evenement SET mev_type = @t, mev_date = @d, mev_fin = @f, mev_libelle = @l, mev_description = @x, mev_ent_id = @o,
                       mev_cout = @c, mev_litres = @q, mev_maj_par = @p, mev_maj_le = now()
                WHERE mev_id = @i AND mev_mat_id = @m
                """, p, ct) == 1 ? id.Value : throw ExceptionMetier.Introuvable("Événement");
        await db.Database.ExecuteSqlRawAsync("DELETE FROM materiel_releve WHERE mre_mev_id = @e", [new NpgsqlParameter("e", mev)], ct);
        if (releve is not null) await InsererReleveAsync(db, materiel, releve, e.Type == "CARBURANT" ? "CARBURANT" : "SAISIE", mev, e.EntId, utilisateur, ct);
        await tx.CommitAsync(ct);
        return mev;
    }

    public static IEndpointRouteBuilder MapCompteursMateriel(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources/materiels/{id:int}");
        g.MapGet("/compteurs", (int id, LogiBtpContext db, CancellationToken ct) => HistoriqueAsync(db, id, ct));
        g.MapPost("/releves", async (int id, ReleveSaisi r, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await AjouterReleveAsync(db, id, r, "SAISIE", null, Utilisateur.Depuis(http).Code, ct);
            return await HistoriqueAsync(db, id, ct);
        });
        // Relevé saisi seul : supprimable (celui d'un événement se retire avec l'événement, celui d'un ordre avec l'ordre).
        g.MapDelete("/releves/{rid:int}", async (int id, int rid, LogiBtpContext db, CancellationToken ct) =>
        {
            var n = await db.Database.ExecuteSqlRawAsync("DELETE FROM materiel_releve WHERE mre_id = @r AND mre_mat_id = @m AND mre_mev_id IS NULL AND mre_source <> 'ORDRE'",
                [new NpgsqlParameter("r", rid), new NpgsqlParameter("m", id)], ct);
            if (n == 0) throw ExceptionMetier.Invalide("REL_LIE", "Relevé introuvable ou lié à un événement ou à un ordre");
            return await HistoriqueAsync(db, id, ct);
        });
        g.MapPost("/evenements", async (int id, EvenementSaisi e, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerEvenementAsync(db, id, null, e, Utilisateur.Depuis(http).Code, ct);
            return await HistoriqueAsync(db, id, ct);
        });
        g.MapPut("/evenements/{eid:int}", async (int id, int eid, EvenementSaisi e, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerEvenementAsync(db, id, eid, e, Utilisateur.Depuis(http).Code, ct);
            return await HistoriqueAsync(db, id, ct);
        });
        g.MapDelete("/evenements/{eid:int}", async (int id, int eid, LogiBtpContext db, CancellationToken ct) =>
        {
            await db.Database.ExecuteSqlRawAsync("DELETE FROM materiel_evenement WHERE mev_id = @e AND mev_mat_id = @m", [new NpgsqlParameter("e", eid), new NpgsqlParameter("m", id)], ct);
            return await HistoriqueAsync(db, id, ct);
        });
        return api;
    }
}
