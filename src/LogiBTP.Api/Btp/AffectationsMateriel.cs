using LogiBTP.Domaine.Ressources;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Affectation saisie d'un matériel : type, ressource, période, commentaire, condition du matériel au retour.</summary>
public sealed record AffectationMaterielSaisie(string Type, string? Ressource, DateOnly? Du, DateOnly? Au, string? Commentaire, string? Retour = null);

/// <summary>
/// Affectations du matériel (db/231, lot 5b des demandes du 25/10/2026) : historique d'un matériel (saisi en entier,
/// contrôlé par <see cref="ReglesAffectations"/> puis réécrit), ressources proposées, matériel affecté à une ressource
/// aujourd'hui (directement, ou porté par un matériel qui lui est affecté, à toute profondeur) et son historique.
/// Condition du matériel (db/252, FM3) : au départ (celle du matériel, gardée), au retour (obligatoire pour clore
/// l'affectation d'un matériel identifié) ; un nouveau retour devient la condition du matériel (tracée dans
/// materiel_etat) ; retour endommagé ou hors service → événement du matériel et notification au responsable de son
/// service, sinon aux administrateurs.
/// </summary>
public static class AffectationsMateriel
{

    /// <summary>Libellé d'une ressource affectée (type, identifiant texte).</summary>
    private const string Libelle = """
        (SELECT r.libelle || CASE WHEN r.type IN ('SALARIE', 'INTERIM') THEN coalesce(' (' || r.code || ')', '') ELSE '' END
         FROM v_ressource r WHERE r.id = a.maf_ressource AND (r.type = a.maf_type OR r.type IN ('SALARIE', 'INTERIM') AND a.maf_type IN ('SALARIE', 'INTERIM')))
        """;

    private const string SqlHistorique = $"""
        SELECT coalesce(json_agg(json_build_object('type', a.maf_type, 'ressource', a.maf_ressource, 'libelle', {Libelle},
               'du', a.maf_du, 'au', a.maf_au, 'commentaire', a.maf_commentaire, 'maj_par', a.maf_maj_par,
               'depart', a.maf_condition_depart, 'retour', a.maf_condition_retour, 'retour_requis', a.maf_retour_requis) ORDER BY a.maf_du), '[]') AS "Value"
        FROM materiel_affectation a WHERE a.maf_mat_id = @m
        """;

    /// <summary>Ressources proposées : salariés et intérimaires actifs, sous-traitants actifs, matériels en service.</summary>
    private const string SqlCibles = $$"""
        SELECT coalesce(json_agg(json_build_object('type', x.type, 'id', x.id, 'libelle', x.libelle) ORDER BY x.type, x.libelle), '[]') AS "Value"
        FROM (SELECT r.type, r.id, r.libelle || CASE WHEN r.type IN ('SALARIE', 'INTERIM') THEN coalesce(' (' || r.code || ')', '') ELSE '' END AS libelle
              FROM v_ressource r WHERE r.actif AND r.type <> 'EQUIPE' AND {{SqlBtp.RessourceUtilisable}}) x
        """;

    /// <summary>
    /// Matériel affecté aujourd'hui à une ressource : directement (niveau 0), puis porté par ce matériel (niveaux
    /// suivants, porteur dans « via ») ; historique des affectations directes passées.
    /// </summary>
    private const string SqlRessource = """
        WITH RECURSIVE courant AS (
            SELECT maf_mat_id AS mat, maf_type AS type, maf_ressource AS ressource, maf_du AS du
            FROM materiel_affectation WHERE maf_du <= current_date AND (maf_au IS NULL OR maf_au >= current_date)),
        porte AS (
            SELECT c.mat, NULL::int AS via, 0 AS niveau, c.du FROM courant c WHERE c.type = @t AND c.ressource = @r
            UNION ALL
            SELECT c.mat, p.mat, p.niveau + 1, c.du FROM courant c JOIN porte p ON c.type = 'MATERIEL' AND c.ressource = p.mat::text WHERE p.niveau < 10)
        SELECT json_build_object(
            'courant', coalesce((SELECT json_agg(json_build_object('id', m.mat_id, 'code', m.mat_code, 'designation', m.mat_designation,
                    'type', coalesce((SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'TYPE_MATERIEL' AND l.lva_code = m.mat_famille), m.mat_famille),
                    'immatriculation', m.mat_immatriculation, 'du', p.du, 'niveau', p.niveau,
                    'via', (SELECT v.mat_code || ' ' || v.mat_designation FROM materiel v WHERE v.mat_id = p.via)) ORDER BY p.niveau, m.mat_code)
                FROM porte p JOIN materiel m ON m.mat_id = p.mat), '[]'),
            'historique', coalesce((SELECT json_agg(json_build_object('id', m.mat_id, 'code', m.mat_code, 'designation', m.mat_designation,
                    'du', a.maf_du, 'au', a.maf_au) ORDER BY a.maf_du DESC)
                FROM materiel_affectation a JOIN materiel m ON m.mat_id = a.maf_mat_id
                WHERE a.maf_type = @t AND a.maf_ressource = @r AND a.maf_au < current_date), '[]')) AS "Value"
        """;

    private sealed record Porteur(string Mat, string Ressource);
    private sealed record Existante(string Type, string Ressource, DateOnly Du, string? Depart, string? Retour, bool RetourRequis);
    private sealed record EtatMateriel(string Mode, string Condition, string? Responsable, string Libelle);

    /// <summary>Conditions qui signalent un retour à traiter (événement et notification).</summary>
    public static readonly string[] ConditionsASignaler = ["ENDOMMAGE", "HS"];

    /// <summary>Historique complet d'un matériel, contrôlé puis réécrit (une transaction).</summary>
    public static async Task EnregistrerAsync(LogiBtpContext db, int materiel, List<AffectationMaterielSaisie> saisie, Utilisateur u, CancellationToken ct,
        LogiBTP.Notifications.Web.ServiceNotification? notifications = null)
    {
        var liste = saisie.OrderBy(a => a.Du).Select(a => a with { Retour = string.IsNullOrWhiteSpace(a.Retour) ? null : a.Retour.Trim() }).ToList();
        var etat = (await db.Database.SqlQueryRaw<EtatMateriel>("""
            SELECT m.mat_mode AS mode, m.mat_condition AS condition, m.mat_code || ' ' || m.mat_designation AS libelle,
                   (SELECT r.ind_utilisateur FROM service sv JOIN individu r ON r.ind_id = sv.srv_responsable_id WHERE sv.srv_id = m.mat_srv_id) AS responsable
            FROM materiel m WHERE m.mat_id = @m
            """, new NpgsqlParameter("m", materiel)).ToListAsync(ct)).FirstOrDefault() ?? throw ExceptionMetier.Introuvable("Matériel");
        // Affectations enregistrées (même type, ressource et début) : condition au départ et retour exigé ou non.
        var existantes = await db.Database.SqlQueryRaw<Existante>("""
            SELECT maf_type AS type, maf_ressource AS ressource, maf_du AS du, maf_condition_depart AS depart, maf_condition_retour AS retour,
                   maf_retour_requis AS retour_requis
            FROM materiel_affectation WHERE maf_mat_id = @m
            """, new NpgsqlParameter("m", materiel)).ToListAsync(ct);
        Existante? Avant(AffectationMaterielSaisie a) => existantes.FirstOrDefault(x => x.Type == a.Type && x.Ressource == a.Ressource?.Trim() && x.Du == a.Du);
        var regles = liste.Select(a => new AffectationMateriel(a.Type, a.Ressource?.Trim(), a.Du, a.Au, a.Retour, Avant(a)?.RetourRequis ?? true)).ToList();
        var erreurs = ReglesAffectations.Controler(materiel.ToString(System.Globalization.CultureInfo.InvariantCulture), regles, etat.Mode == "IDENTIFIE");
        if (erreurs.Count > 0)
        {
            throw ExceptionMetier.Invalide(erreurs[0].Code, string.Join(" ; ", erreurs.Select(e => $"affectation {e.Affectation + 1} : {e.Code}").Distinct()));
        }
        // Porteurs actuels des autres matériels : un matériel ne peut pas porter, même indirectement, son porteur.
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        if (ReglesAffectations.A(regles, aujourdhui) is int i && regles[i].Type == TypesRessource.Materiel)
        {
            var porteurs = (await db.Database.SqlQueryRaw<Porteur>("""
                SELECT maf_mat_id::text AS mat, maf_ressource AS ressource FROM materiel_affectation
                WHERE maf_type = 'MATERIEL' AND maf_du <= current_date AND (maf_au IS NULL OR maf_au >= current_date) AND maf_mat_id <> @m
                """, new NpgsqlParameter("m", materiel)).ToListAsync(ct)).ToDictionary(p => p.Mat, p => p.Ressource);
            if (ReglesAffectations.Boucle(porteurs, materiel.ToString(System.Globalization.CultureInfo.InvariantCulture), regles[i].Id!))
            {
                throw ExceptionMetier.Invalide("AFF_BOUCLE", "Matériels porteurs en boucle : le porteur choisi est lui-même porté par ce matériel");
            }
        }
        // Nouveau retour (condition saisie qui n'était pas enregistrée) : le plus récent devient la condition du matériel.
        var retour = liste.Where(a => a.Retour is not null && a.Au is not null && Avant(a)?.Retour != a.Retour).MaxBy(a => a.Au);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM materiel_affectation WHERE maf_mat_id = @m", [new NpgsqlParameter("m", materiel)], ct);
        foreach (var a in liste)
        {
            var avant = Avant(a);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO materiel_affectation (maf_mat_id, maf_type, maf_ressource, maf_du, maf_au, maf_commentaire, maf_maj_par,
                                                  maf_condition_depart, maf_condition_retour, maf_retour_requis)
                VALUES (@m, @t, @r, @du, @au, @c, @u, @dep, @ret, @req)
                """,
                [new NpgsqlParameter("m", materiel), new NpgsqlParameter("t", a.Type), new NpgsqlParameter("r", a.Ressource!.Trim()),
                 new NpgsqlParameter("du", a.Du!.Value), SqlBtp.P("au", a.Au),
                 SqlBtp.P("c", a.Commentaire?.Trim()), new NpgsqlParameter("u", u.Code),
                 new NpgsqlParameter("dep", (object?)(avant is null ? etat.Condition : avant.Depart) ?? DBNull.Value),
                 SqlBtp.P("ret", a.Retour), new NpgsqlParameter("req", avant?.RetourRequis ?? true)], ct);
        }
        var signaler = retour is not null && ConditionsASignaler.Contains(retour.Retour);
        if (retour is not null)
        {
            var libelle = (await db.Database.SqlQueryRaw<string>("""
                SELECT coalesce((SELECT r.libelle FROM v_ressource r WHERE r.id = @r AND (r.type = @t OR r.type IN ('SALARIE', 'INTERIM') AND @t IN ('SALARIE', 'INTERIM')) LIMIT 1), @r)
                       || ' · ' || coalesce((SELECT lva_libelle FROM liste_valeur WHERE lva_liste = 'ETAT_MATERIEL' AND lva_code = @c), @c) AS "Value"
                """, new NpgsqlParameter("r", retour.Ressource!.Trim()), new NpgsqlParameter("t", retour.Type), new NpgsqlParameter("c", retour.Retour!)).ToListAsync(ct))[0];
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE materiel SET mat_condition = @c, mat_etat_source = 'AFFECTATION', mat_etat_motif = left('Retour de ' || @l, 200), mat_etat_par = @u
                WHERE mat_id = @m AND mat_condition IS DISTINCT FROM @c
                """, [new NpgsqlParameter("c", retour.Retour!), new NpgsqlParameter("l", libelle), new NpgsqlParameter("u", u.Code), new NpgsqlParameter("m", materiel)], ct);
            if (signaler)
            {
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO materiel_evenement (mev_mat_id, mev_type, mev_date, mev_libelle, mev_description, mev_maj_par)
                    VALUES (@m, 'SINISTRE', @d, left('Retour de ' || @l, 150), @x, @u)
                    """, [new NpgsqlParameter("m", materiel), new NpgsqlParameter("d", retour.Au!.Value), new NpgsqlParameter("l", libelle),
                       SqlBtp.P("x", retour.Commentaire?.Trim()), new NpgsqlParameter("u", u.Code)], ct);
            }
        }
        await tx.CommitAsync(ct);
        if (signaler && notifications is not null)
        {
            var destinataires = etat.Responsable is { } r ? [r] : await DestinatairesBtp.AdministrateursAsync(db, ct);
            var id = materiel.ToString(System.Globalization.CultureInfo.InvariantCulture);
            await notifications.PublierAsync(destinataires.Select(d => new LogiBTP.Notifications.Web.NouvelleNotification(d, "ressources", "MATERIEL_RETOUR",
                $"Matériel rendu {(retour!.Retour == "HS" ? "hors service" : "endommagé")} : {etat.Libelle}", retour.Commentaire, LogiBTP.Socle.NiveauNotification.Attention,
                $"/fiche/materiel/{id}", "materiel", id, $"materiel-retour:{id}:{retour.Au:yyyy-MM-dd}")), ct);
        }
    }

    public static IEndpointRouteBuilder MapAffectationsMateriel(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources");
        g.MapGet("/materiels/{id:int}/affectations", (int id, LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlHistorique, ct, new NpgsqlParameter("m", id)));
        g.MapPut("/materiels/{id:int}/affectations", async (int id, List<AffectationMaterielSaisie> l, HttpContext http, LogiBtpContext db,
            LogiBTP.Notifications.Web.ServiceNotification notifications, CancellationToken ct) =>
        {
            await EnregistrerAsync(db, id, l, Utilisateur.Depuis(http), ct, notifications);
            return await db.JsonAsync(SqlHistorique, ct, new NpgsqlParameter("m", id));
        });
        // Historique de la disponibilité et de la condition (db/252), récent d'abord.
        g.MapGet("/materiels/{id:int}/etats", (int id, LogiBtpContext db, CancellationToken ct) => db.JsonAsync("""
            SELECT coalesce(json_agg(json_build_object('le', e.met_le, 'etat', e.met_etat, 'condition', e.met_condition,
                   'condition_libelle', (SELECT lva_libelle FROM liste_valeur WHERE lva_liste = 'ETAT_MATERIEL' AND lva_code = e.met_condition),
                   'motif', e.met_motif, 'source', e.met_source, 'par', e.met_par) ORDER BY e.met_le DESC, e.met_id DESC), '[]') AS "Value"
            FROM materiel_etat e WHERE e.met_mat_id = @m
            """, ct, new NpgsqlParameter("m", id)));
        g.MapGet("/affectations/cibles", (LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlCibles, ct));
        g.MapGet("/affectations/{type}/{id}", (string type, string id, LogiBtpContext db, CancellationToken ct) =>
            db.JsonAsync(SqlRessource, ct, new NpgsqlParameter("t", type.ToUpperInvariant()), new NpgsqlParameter("r", id)));
        return api;
    }
}
