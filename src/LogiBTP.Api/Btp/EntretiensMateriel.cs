using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Domaine.Ressources;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Nouvel ordre d'entretien : nature (PREVENTIF, CURATIF, REGLEMENTAIRE), objet, opérations en lignes de texte.</summary>
public sealed record NouvelEntretien(string? Nature, string? Objet, List<string>? Operations, int? Plan = null);

/// <summary>Entretien d'un ordre E_ENT : nature et relevé du compteur à l'intervention (facultatif).</summary>
public sealed record EntretienSaisi(string? Nature, ReleveSaisi? Releve);

/// <summary>
/// Ordre d'entretien du matériel (db/234, lot 5c-3 des demandes du 25/10/2026, M5) : type E_ENT du module Exécution,
/// créé depuis la fiche matériel sur son chantier de suivi (première imputation : chantier créé s'il manque), lignes =
/// opérations (main-d'œuvre d'atelier en heures, pointée sur l'ordre) et pièces (articles ; E_ENT → E_DAP pour les sortir
/// du stock, → A_COMMANDE pour une réparation extérieure) ; nature et relevé du compteur à l'intervention (relevé de
/// source ORDRE contrôlé par <see cref="ReglesCompteurs"/>) ; clôture (état TERMINE) → événement ENTRETIEN (trigger).
/// </summary>
public static class EntretiensMateriel
{
    public static readonly string[] Natures = ["PREVENTIF", "CURATIF", "REGLEMENTAIRE"];

    private sealed record MaterielOrdreSql(int? MatId, string? Nature, int Tyd);

    private static async Task<IResult> Json(LogiBtpContext db, string sql, CancellationToken ct, params NpgsqlParameter[] p) =>
        Results.Content(await db.Database.SqlQueryRaw<string>(sql, p).FirstAsync(ct), "application/json");

    /// <summary>Ordres d'entretien d'un matériel (indice de référence), les plus récents d'abord.</summary>
    private const string SqlOrdres = """
        SELECT coalesce(json_agg(json_build_object('id', d.ent_id, 'numero', d.ent_numero, 'objet', d.ent_objet, 'date', d.ent_date,
               'nature', d.ent_ent_nature, 'etat', d.ent_exe_etat, 'statut', s.std_libelle, 'statut_code', s.std_code,
               'debut_prevu', d.ent_debut_prevu, 'fin_prevue', d.ent_fin_prevue, 'plan', d.ent_mpl_id) ORDER BY d.ent_date DESC, d.ent_id DESC), '[]') AS "Value"
        FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id AND t.tyd_code = 'E_ENT'
        JOIN statut_document s ON s.std_id = d.ent_std_id
        WHERE d.ent_mat_id = @m AND d.ent_is_reference
        """;

    /// <summary>Entretien d'un ordre : matériel, unités suivies, nature, relevé de l'ordre.</summary>
    private const string SqlEntretien = """
        SELECT json_build_object('materiel', CASE WHEN m.mat_id IS NULL THEN NULL ELSE json_build_object('id', m.mat_id, 'code', m.mat_code, 'designation', m.mat_designation,
                   'compteurs', m.mat_compteurs, 'heures', m.mat_heures, 'kilometres', m.mat_kilometres) END,
               'nature', d.ent_ent_nature, 'etat', d.ent_exe_etat,
               'releve', (SELECT json_build_object('date', r.mre_date, 'unite', r.mre_unite, 'valeur', r.mre_valeur, 'remise', r.mre_remise)
                          FROM materiel_releve r WHERE r.mre_ent_id = d.ent_id AND r.mre_source = 'ORDRE' ORDER BY r.mre_id DESC LIMIT 1)) AS "Value"
        FROM document d LEFT JOIN materiel m ON m.mat_id = d.ent_mat_id WHERE d.ent_id = @e
        """;

    /// <summary>Crée l'ordre d'entretien d'un matériel (brouillon) sur son chantier de suivi ; renvoie son identifiant.</summary>
    public static async Task<long> CreerAsync(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
        int materiel, NouvelEntretien n, Utilisateur u, CancellationToken ct)
    {
        if (n.Nature is not null && !Natures.Contains(n.Nature)) throw ExceptionMetier.Invalide("ENT_NATURE", "Nature d'entretien inconnue");
        var designation = await db.Database.SqlQueryRaw<string>("SELECT mat_code || ' ' || mat_designation AS \"Value\" FROM materiel WHERE mat_id = @m",
            new NpgsqlParameter("m", materiel)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("Matériel");
        var chantier = await CoutsMateriel.ChantierMaterielAsync(db, materiel, ct);
        var tyd = await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == TypesDocument.EEnt).Select(t => t.TydId).FirstAsync(ct);
        var objet = string.IsNullOrWhiteSpace(n.Objet) ? $"Entretien {designation}" : n.Objet.Trim();
        var cree = await documents.Creer(new CreationDocument { EntTydId = tyd, EntObjet = objet.Length > 200 ? objet[..200] : objet }, u, ct);
        var c = await documents.Charger(cree.Document.EntId, ct);
        c.Document.EntChantierId = chantier;
        // Rattachement complet (le chantier complète son affaire, comme completerRattachement de l'interface).
        c.Document.EntAffaireId = await db.Database.SqlQueryRaw<int?>("SELECT cha_aff_id AS \"Value\" FROM chantier WHERE cha_id = @c",
            new NpgsqlParameter("c", chantier)).FirstAsync(ct);
        // Adresse du chantier reprise comme l'interface le fait pour un bloc vide (pas d'ordre « modifié » à l'ouverture).
        c.Document.EntAdresseLivraison ??= await AdressesDocument.Chantier(db, chantier, ct);
        var i = 0;
        foreach (var op in (n.Operations ?? []).Where(o => !string.IsNullOrWhiteSpace(o)))
        {
            i++;
            foreach (var x in c.Lignes.Where(x => x.LigParentId is null && x.LigOrdre >= i)) x.LigOrdre++;
            c.Lignes.Add(new DocumentLigneBtp { LigId = -i, LigEntId = c.Document.EntId, LigOrdre = i, LigTylId = TL.Texte, LigLibelleHtml = System.Net.WebUtility.HtmlEncode(op.Trim()), LigTypePrix = "V" });
        }
        // Pied : ligne de TVA, comme une pièce saisie (l'éditeur ne marque pas l'ordre modifié à l'ouverture).
        if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
            c.Lignes.Add(new DocumentLigneBtp { LigId = -1000, LigEntId = c.Document.EntId, LigOrdre = i + 100, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
        await documents.Enregistrer(c.Document.EntId, c, u, ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE document SET ent_mat_id = @m, ent_ent_nature = @n, ent_mpl_id = @p WHERE ent_id = @e",
            [new NpgsqlParameter("m", materiel), new NpgsqlParameter("n", (object?)n.Nature ?? DBNull.Value), new NpgsqlParameter("p", (object?)n.Plan ?? DBNull.Value),
             new NpgsqlParameter("e", c.Document.EntId)], ct);
        return c.Document.EntId;
    }

    /// <summary>Enregistre la nature et remplace le relevé de l'ordre (contrôlé sans l'ancien relevé de cet ordre).</summary>
    public static async Task EnregistrerAsync(LogiBtpContext db, long entId, EntretienSaisi s, Utilisateur u, CancellationToken ct)
    {
        var o = await db.Database.SqlQueryRaw<MaterielOrdreSql>("SELECT ent_mat_id AS mat_id, ent_ent_nature AS nature, ent_tyd_id AS tyd FROM document WHERE ent_id = @e",
            new NpgsqlParameter("e", entId)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("Ordre");
        if (o.MatId is not { } materiel) throw ExceptionMetier.Invalide("ENT_MATERIEL", "Ordre sans matériel");
        if (s.Nature is not null && !Natures.Contains(s.Nature)) throw ExceptionMetier.Invalide("ENT_NATURE", "Nature d'entretien inconnue");
        var releve = s.Releve is { Valeur: not null } r ? r with { Date = r.Date ?? DateOnly.FromDateTime(DateTime.Today) } : null;
        if (releve is not null) await CompteursMateriel.ControlerReleveAsync(db, materiel, releve, null, entId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE document SET ent_ent_nature = @n WHERE ent_id = @e",
            [new NpgsqlParameter("n", (object?)s.Nature ?? DBNull.Value), new NpgsqlParameter("e", entId)], ct);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM materiel_releve WHERE mre_ent_id = @e AND mre_source = 'ORDRE'", [new NpgsqlParameter("e", entId)], ct);
        if (releve is not null) await CompteursMateriel.InsererReleveAsync(db, materiel, releve, "ORDRE", null, entId, u.Code, ct);
        // Ordre déjà clos : la date de l'entretien de l'historique suit le relevé.
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE materiel_evenement SET mev_date = coalesce((SELECT max(r.mre_date) FROM materiel_releve r WHERE r.mre_ent_id = @e), mev_date)
            WHERE mev_ent_id = @e AND mev_type = 'ENTRETIEN' AND mev_maj_par = 'ordre'
            """, [new NpgsqlParameter("e", entId)], ct);
        await tx.CommitAsync(ct);
    }

    public static IEndpointRouteBuilder MapEntretiensMateriel(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources");
        g.MapGet("/materiels/{id:int}/ordres", (int id, LogiBtpContext db, CancellationToken ct) => Json(db, SqlOrdres, ct, new NpgsqlParameter("m", id)));
        g.MapPost("/materiels/{id:int}/ordres", async (int id, NouvelEntretien n, HttpContext http, LogiBtpContext db,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
            Results.Ok(new { ent_id = await CreerAsync(db, documents, id, n, Utilisateur.Depuis(http), ct) }));
        g.MapGet("/entretiens/{entId:long}", (long entId, LogiBtpContext db, CancellationToken ct) => Json(db, SqlEntretien, ct, new NpgsqlParameter("e", entId)));
        g.MapPut("/entretiens/{entId:long}", async (long entId, EntretienSaisi s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerAsync(db, entId, s, Utilisateur.Depuis(http), ct);
            return await Json(db, SqlEntretien, ct, new NpgsqlParameter("e", entId));
        });
        return api;
    }
}
