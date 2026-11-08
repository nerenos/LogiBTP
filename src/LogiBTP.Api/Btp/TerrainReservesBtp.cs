using System.Globalization;
using System.Text.Json;
using LogiBTP.Domaine;
using LogiBTP.Ged.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Levée d'une réserve saisie sur le terrain ; <c>LeveeLe</c> : heure de l'appareil, envoyée par une levée gardée hors ligne.</summary>
public sealed record LeveeReserve(string? Commentaire, DateTimeOffset? LeveeLe = null);

/// <summary>
/// Réserves suivies d'une réception de pose (plan terrain-suites, lot 14 ; TS14 a) : une ligne par réserve dans
/// <c>reception_reserve</c> (db/290), écrite à la réception avec réserves ; levée depuis le terrain (commentaire, photo
/// déposée dans la GED de l'ordre, heure de l'appareil hors ligne) par une personne qui peut signer la réception de
/// l'ordre (mêmes règles : atelier E51 ou tâche du planning). La tâche du CRM des réserves reste créée comme alerte.
/// Levée d'une réserve déjà levée : rien n'est changé (envoi rejoué depuis l'appareil).
/// </summary>
public static partial class TerrainBtp
{
    private sealed record EtatReserveLu(string Etat);

    /// <summary>Réserves à suivre d'une réception : libellés saisis, rangés de 1 à n ; aucune hors réception avec réserves.</summary>
    public static List<(short Ordre, string Libelle)> ReservesSuivies(string etat, IEnumerable<string>? reserves) =>
        etat != "AVEC_RESERVES" ? [] : [.. (reserves ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).Select((x, i) => ((short)(i + 1), x))];

    /// <summary>Réserves de la réception écrites une par une (dans la transaction de la réception).</summary>
    public static async Task EcrireReservesAsync(LogiBtpContext db, long rec, long ent, IEnumerable<(short Ordre, string Libelle)> reserves, CancellationToken ct)
    {
        foreach (var (ordre, libelle) in reserves)
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO reception_reserve (rre_rec_id, rre_ent_id, rre_ordre, rre_libelle) VALUES (@r, @e, @o, @l)
                ON CONFLICT (rre_rec_id, rre_ordre) DO NOTHING
                """, [new NpgsqlParameter("r", rec), new NpgsqlParameter("e", ent), new NpgsqlParameter("o", ordre), new NpgsqlParameter("l", libelle)], ct);
    }

    /// <summary>Réserves suivies de l'ordre (toutes ses réceptions), des plus anciennes aux plus récentes.</summary>
    public static async Task<JsonElement> ReservesAsync(LogiBtpContext db, long ent, CancellationToken ct) =>
        JsonDocument.Parse(await db.Database.SqlQueryRaw<string>("""
            SELECT coalesce(json_agg(json_build_object('id', x.rre_id, 'reception', x.rre_rec_id, 'recue_le', r.rec_le, 'ordre', x.rre_ordre,
                     'libelle', x.rre_libelle, 'photo', x.rre_dge_id, 'etat', x.rre_etat, 'levee_le', x.rre_levee_le,
                     'levee_appareil_le', x.rre_levee_appareil_le, 'levee_par', x.rre_levee_par, 'commentaire', x.rre_levee_commentaire,
                     'photo_levee', x.rre_levee_dge_id) ORDER BY x.rre_rec_id, x.rre_ordre), '[]')::text AS "Value"
            FROM reception_reserve x JOIN reception_pose r ON r.rec_id = x.rre_rec_id WHERE x.rre_ent_id = @e
            """, new NpgsqlParameter("e", ent)).FirstAsync(ct)).RootElement;

    /// <summary>
    /// Lève une réserve de l'ordre : contrôle de la personne (mêmes règles que la réception), réserve de l'ordre, puis
    /// photo déposée (si fournie) et réserve passée LEVEE. Renvoie l'ordre et le nombre de réserves encore ouvertes.
    /// Réserve déjà levée : inchangée (pas de nouvelle photo).
    /// </summary>
    public static async Task<(long Ordre, bool Levee, int Ouvertes)> LeverReserveAsync(LogiBtpContext db, Utilisateur u, long ent, long res, LeveeReserve saisie,
        Func<Task<long?>>? photo, CancellationToken ct)
    {
        await OrdreReceptionAsync(db, u, ent, ct);
        var etat = await db.Database.SqlQueryRaw<EtatReserveLu>("SELECT rre_etat AS etat FROM reception_reserve WHERE rre_id = @r AND rre_ent_id = @e",
            new NpgsqlParameter("r", res), new NpgsqlParameter("e", ent)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Réserve {res} de l'ordre");
        var levee = false;
        if (etat.Etat == EtatsReserve.Ouverte)
        {
            var dge = photo is null ? null : await photo();
            levee = await db.Database.ExecuteSqlRawAsync("""
                UPDATE reception_reserve SET rre_etat = @levee, rre_levee_le = now(), rre_levee_appareil_le = @app, rre_levee_par = @u,
                       rre_levee_commentaire = @c, rre_levee_dge_id = @d
                WHERE rre_id = @r AND rre_etat = @ouverte
                """, [new NpgsqlParameter("levee", EtatsReserve.Levee), new NpgsqlParameter("ouverte", EtatsReserve.Ouverte),
                    SqlBtp.P("app", HeureAppareil(saisie.LeveeLe, DateTimeOffset.UtcNow), NpgsqlTypes.NpgsqlDbType.TimestampTz), new NpgsqlParameter("u", u.Code),
                    SqlBtp.P("c", string.IsNullOrWhiteSpace(saisie.Commentaire) ? null : saisie.Commentaire.Trim()),
                    SqlBtp.P("d", dge, NpgsqlTypes.NpgsqlDbType.Bigint), new NpgsqlParameter("r", res)], ct) > 0;
        }
        var ouvertes = await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM reception_reserve WHERE rre_ent_id = @e AND rre_etat = @o",
            new NpgsqlParameter("e", ent), new NpgsqlParameter("o", EtatsReserve.Ouverte)).FirstAsync(ct);
        return (ent, levee, ouvertes);
    }

    private static RouteGroupBuilder MapReservesReception(this RouteGroupBuilder g)
    {
        // Réserves suivies de l'ordre (mêmes droits que la réception).
        g.MapGet("/receptions/{ent:long}/reserves", async (long ent, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await OrdreReceptionAsync(db, Utilisateur.Depuis(http), ent, ct);
            return await ReservesAsync(db, ent, ct);
        });

        // Levée d'une réserve : formulaire (commentaire, levee_le de l'appareil, photo facultative déposée dans la GED de l'ordre).
        g.MapPost("/receptions/{ent:long}/reserves/{res:long}/levee", async (long ent, long res, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var form = await http.Request.ReadFormAsync(ct);
            var photo = form.Files.GetFile("photo");
            if (photo is not null && !(photo.ContentType ?? "").StartsWith("image/", StringComparison.OrdinalIgnoreCase)) throw ExceptionMetier.Invalide("TERRAIN_PHOTO", "Images seulement");
            var leveeLe = DateTimeOffset.TryParse(form["levee_le"].ToString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var h) ? h : (DateTimeOffset?)null;
            var saisie = new LeveeReserve(form["commentaire"].ToString(), leveeLe);
            var (_, levee, ouvertes) = await LeverReserveAsync(db, u, ent, res, saisie, photo is null ? null : async () =>
            {
                var o = await LireOrdreAsync(db, ent, ct);
                var d = await ged.DeposerFichier(photo, new MetaDepot
                {
                    Titre = $"Levée de réserve · {o.Numero} · {DateTime.Now:dd/MM/yyyy HH:mm}", Categorie = CategoriesGed.Photo, TypeElement = o.Type,
                    IdElement = o.Groupe.ToString(CultureInfo.InvariantCulture), Auteur = u.Code,
                    Resume = string.IsNullOrWhiteSpace(saisie.Commentaire) ? null : saisie.Commentaire.Trim(),
                }, ServeurEditions, ct);
                return d.Id;
            }, ct);
            return new { levee, ouvertes, reserves = await ReservesAsync(db, ent, ct) };
        }).DisableAntiforgery();
        return g;
    }
}
