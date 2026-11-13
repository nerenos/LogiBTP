using System.Globalization;
using System.Text.Json;
using LogiBTP.Domaine;
using LogiBTP.Ged.Web;
using LogiBTP.Mail.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>Levée d'une réserve saisie sur le terrain ; <c>LeveeLe</c> : heure de l'appareil, envoyée par une levée gardée hors ligne.</summary>
public sealed record LeveeReserve(string? Commentaire, DateTimeOffset? LeveeLe = null);

/// <summary>PV de levée des réserves signé par le client ; <c>SigneeLe</c> : heure de l'appareil (PV gardé hors ligne).</summary>
public sealed record PvLeveeSaisie(string Nom, string? Qualite, string? Signature, string? Courriel, DateTimeOffset? SigneeLe = null);

/// <summary>
/// Réserves suivies d'une réception de pose (plan terrain-suites, lot 14 ; TS14 a) : une ligne par réserve dans
/// <c>reception_reserve</c> (db/290), écrite à la réception avec réserves ; levée depuis le terrain (commentaire, photo
/// déposée dans la GED de l'ordre, heure de l'appareil hors ligne) par une personne qui peut signer la réception de
/// l'ordre (mêmes règles : atelier E51 ou tâche du planning). La tâche du CRM des réserves reste créée comme alerte.
/// Levée d'une réserve déjà levée : rien n'est changé (envoi rejoué depuis l'appareil).
/// Lot 16 : toutes les réserves levées, PV de levée signé par le client (PadSignature), édité par le modèle
/// PV_LEVEE_RESERVES (source annexe levee_reserves, image SIGNATURE_LEVEE), rangé dans la GED de l'ordre avec son
/// empreinte, envoyé au client par le module Mail ; il couvre les réserves levées qu'aucun PV ne constate encore.
/// </summary>
public static partial class TerrainBtp
{
    private sealed record EtatReserveLu(string Etat);
    private sealed record ComptesReserves(int Ouvertes, int ACouvrir);
    private sealed record LeveeLue(long Id, string? Signataire, string? Qualite, long? DgeId, string? Courriel, string Par, DateTimeOffset CreeLe, DateTimeOffset? SigneeAppareilLe);

    public const string ModelePvLevee = "PV_LEVEE_RESERVES";

    /// <summary>PV de levée à signer : plus aucune réserve ouverte et au moins une réserve levée qu'aucun PV ne constate.</summary>
    public static bool PvLeveeAttendu(int ouvertes, int aCouvrir) => ouvertes == 0 && aCouvrir > 0;

    private static Task<ComptesReserves> ComptesReservesAsync(LogiBtpContext db, long ent, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ComptesReserves>("""
            SELECT count(*) FILTER (WHERE rre_etat = @o)::int AS ouvertes, count(*) FILTER (WHERE rre_etat = @l AND rre_rlv_id IS NULL)::int AS a_couvrir
            FROM reception_reserve WHERE rre_ent_id = @e
            """, new NpgsqlParameter("e", ent), new NpgsqlParameter("o", EtatsReserve.Ouverte), new NpgsqlParameter("l", EtatsReserve.Levee)).FirstAsync(ct);

    private static async Task<List<object>> LeveesAsync(LogiBtpContext db, long ent, CancellationToken ct) =>
        [.. (await db.Database.SqlQueryRaw<LeveeLue>("""
            SELECT l.rlv_id AS id, s.sig_nom AS signataire, s.sig_qualite AS qualite, l.rlv_dge_id AS dge_id, l.rlv_courriel AS courriel, l.rlv_cree_par AS par,
                   l.rlv_cree_le AS cree_le, l.rlv_signee_appareil_le AS signee_appareil_le
            FROM reception_levee l LEFT JOIN signature s ON s.sig_id = l.rlv_sig_id WHERE l.rlv_ent_id = @e ORDER BY l.rlv_id DESC
            """, new NpgsqlParameter("e", ent)).ToListAsync(ct)).Select(l => (object)new
        {
            id = l.Id, signataire = l.Signataire, qualite = l.Qualite, pv = l.DgeId is not null, courriel = l.Courriel, par = l.Par, cree_le = l.CreeLe,
            signee_appareil_le = l.SigneeAppareilLe,
        })];

    /// <summary>PV de levée attendu pour l'ordre (toutes réserves levées, au moins une à constater).</summary>
    private static async Task<bool> PvLeveeAttenduAsync(LogiBtpContext db, long ent, CancellationToken ct)
    {
        var c = await ComptesReservesAsync(db, ent, ct);
        return PvLeveeAttendu(c.Ouvertes, c.ACouvrir);
    }

    /// <summary>
    /// PV de levée enregistré (transaction) : refus s'il reste une réserve ouverte ou si rien n'est à constater ;
    /// signature, PV et réserves levées non couvertes rattachées. Renvoie la signature et le PV.
    /// </summary>
    public static async Task<(long Signature, long Levee)> EnregistrerLeveeAsync(LogiBtpContext db, Utilisateur u, long ent, PvLeveeSaisie p, byte[]? image,
        CancellationToken ct)
    {
        await using var tx = db.Database.CurrentTransaction is null ? await db.Unite().CommencerAsync(ct) : null;
        var c = await ComptesReservesAsync(db, ent, ct);
        if (c.Ouvertes > 0) throw ExceptionMetier.Invalide("TERRAIN_RESERVES_OUVERTES", $"{c.Ouvertes} réserve(s) encore ouverte(s)");
        if (!PvLeveeAttendu(c.Ouvertes, c.ACouvrir)) throw ExceptionMetier.Invalide("TERRAIN_LEVEE_RIEN", "Aucune réserve levée à constater");
        var sig = (await db.Database.SqlQueryRaw<long>("""
            INSERT INTO signature (sig_type_element, sig_id_element, sig_nom, sig_qualite, sig_image, sig_par)
            VALUES ('document', @e::text, @n, @q, @i, @u) RETURNING sig_id AS "Value"
            """, new NpgsqlParameter("e", ent), new NpgsqlParameter("n", p.Nom.Trim()), SqlBtp.P("q", p.Qualite?.Trim()),
            SqlBtp.P("i", image, NpgsqlTypes.NpgsqlDbType.Bytea), new NpgsqlParameter("u", u.Code)).ToListAsync(ct))[0];
        var rlv = (await db.Database.SqlQueryRaw<long>("""
            INSERT INTO reception_levee (rlv_ent_id, rlv_sig_id, rlv_courriel, rlv_signee_appareil_le, rlv_cree_par)
            VALUES (@e, @s, @c, @app, @u) RETURNING rlv_id AS "Value"
            """, new NpgsqlParameter("e", ent), new NpgsqlParameter("s", sig), SqlBtp.P("c", string.IsNullOrWhiteSpace(p.Courriel) ? null : p.Courriel.Trim()),
            SqlBtp.P("app", HeureAppareil(p.SigneeLe, DateTimeOffset.UtcNow), NpgsqlTypes.NpgsqlDbType.TimestampTz), new NpgsqlParameter("u", u.Code)).ToListAsync(ct))[0];
        await db.Database.ExecuteSqlRawAsync("UPDATE reception_reserve SET rre_rlv_id = @l WHERE rre_ent_id = @e AND rre_etat = @levee AND rre_rlv_id IS NULL",
            [new NpgsqlParameter("l", rlv), new NpgsqlParameter("e", ent), new NpgsqlParameter("levee", EtatsReserve.Levee)], ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return (sig, rlv);
    }

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
                     'photo_levee', x.rre_levee_dge_id, 'pv_levee', x.rre_rlv_id) ORDER BY x.rre_rec_id, x.rre_ordre), '[]')::text AS "Value"
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

    /// <summary>
    /// PV de levée des réserves signé : contrôle de la personne (règles de la réception), signataire et signature
    /// obligatoires, enregistrement (<see cref="EnregistrerLeveeAsync"/>), PV édité et rangé dans la GED de l'ordre avec
    /// son empreinte (une édition en échec est rendue en avertissement), courriel au client. Renvoie le PV et les avertissements.
    /// </summary>
    public static async Task<(object Levee, List<string> Avertissements)> SignerPvLeveeAsync(IServiceProvider services, LogiBtpContext db, Utilisateur u, long ent,
        PvLeveeSaisie p, CancellationToken ct)
    {
        var o = await OrdreReceptionAsync(db, u, ent, ct);
        if (string.IsNullOrWhiteSpace(p.Nom)) throw ExceptionMetier.Invalide("TERRAIN_SIGNATAIRE", "Nom du signataire obligatoire");
        var image = ImageSignature(p.Signature) ?? throw ExceptionMetier.Invalide("TERRAIN_SIGNATURE", "Signature du client obligatoire");
        var (sig, rlv) = await EnregistrerLeveeAsync(db, u, ent, p, image, ct);
        var avertissements = new List<string>();
        long? dge = null;
        try
        {
            dge = await EditerPvAsync(services, db, o, ModelePvLevee, $"PV-levee-reserves-{(o.Numero ?? ent.ToString(CultureInfo.InvariantCulture))}-{DateTime.Today:yyyyMMdd}.pdf",
                $"PV de levée des réserves {o.Numero} du {DateTime.Today:dd/MM/yyyy}", $"Levée des réserves constatée, signée par {p.Nom.Trim()}", sig, u, ct);
            await db.Database.ExecuteSqlRawAsync("UPDATE reception_levee SET rlv_dge_id = @d WHERE rlv_id = @l", [new NpgsqlParameter("d", dge), new NpgsqlParameter("l", rlv)], ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            avertissements.Add($"PV non édité : {e.Message}");
        }
        if (!string.IsNullOrWhiteSpace(p.Courriel) && dge is long piece)
            await SuiteAsync(avertissements, "Courriel du PV non envoyé", async () =>
                await services.GetRequiredService<ServiceEnvoiMail>().EnvoyerAutomatiqueAsync(new EnvoiAutomatique(UsageCourrielReception,
                    [new DestinataireSaisi(p.Courriel.Trim(), o.Contact ?? o.Client)], $"Procès-verbal de levée des réserves – {o.Numero}",
                    $"<p>Bonjour,</p><p>Vous trouverez ci-joint le procès-verbal de levée des réserves des travaux ({System.Net.WebUtility.HtmlEncode(o.Objet ?? o.Numero ?? "")}), signé ce jour.</p><p>Cordialement.</p>",
                    u.Code, TypeElement: o.Type, IdElement: o.Groupe.ToString(CultureInfo.InvariantCulture), Pieces: [$"ged:{piece}"]), ct));
        return ((await LeveesAsync(db, ent, ct)).First(), avertissements);
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
            return new { levee, ouvertes, reserves = await ReservesAsync(db, ent, ct), pv_levee_attendu = await PvLeveeAttenduAsync(db, ent, ct) };
        }).DisableAntiforgery();

        // PV de levée des réserves signé par le client (lot 16) : édité, rangé dans la GED de l'ordre, envoyé par courriel.
        g.MapPost("/receptions/{ent:long}/levee", async (long ent, PvLeveeSaisie p, HttpContext http, LogiBtpContext db, IServiceProvider services, CancellationToken ct) =>
        {
            var (levee, avertissements) = await SignerPvLeveeAsync(services, db, Utilisateur.Depuis(http), ent, p, ct);
            return new { levee, avertissements };
        });

        // PV de levée signé (contenu de la GED, mêmes droits que la réception).
        g.MapGet("/receptions/{ent:long}/levees/{rlv:long}/pv", async (long ent, long rlv, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await OrdreReceptionAsync(db, u, ent, ct);
            var version = await db.Database.SqlQueryRaw<long?>("""
                SELECT (SELECT v.vge_id FROM version_ged v WHERE v.vge_document = l.rlv_dge_id ORDER BY v.vge_numero DESC LIMIT 1) AS "Value"
                FROM reception_levee l WHERE l.rlv_id = @l AND l.rlv_ent_id = @e
                """, new NpgsqlParameter("l", rlv), new NpgsqlParameter("e", ent)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("PV de levée des réserves");
            return await ged.Contenu(version, false, http, u, ct);
        });
        return g;
    }
}
