using System.Text.Json;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Droits.Web;
using LogiBTP.Reglements.Web;
using LogiBTP.Relances;
using LogiBTP.Relances.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using static LogiBTP.Api.Btp.SqlBtp;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Relances spécialisé par le cœur (plans/relances.md, lot 4) : pièces en attente lues par le rôle de leur type
/// (type_document.tyd_role_relance, db/283), parmi les pièces valables non annulées (PerimetreDocuments) ; devis ENVOYE
/// non rejetés, non expirés, non transformés (groupe d'indices compris) ; factures à reste échu : reste du module
/// Règlements s'il est actif (ServiceReglement), sinon échéances du document tant que le statut n'est pas PAYE (Q8) ;
/// tiers relancé = intervenant PAYEUR de la facture, sinon le tiers (Q6) ; chargé = responsable de l'affaire
/// (aff_responsable_ind_id), sinon chargé d'affaires du client (Q9) ; portée du nœud « relances » par chargé.
/// </summary>
public sealed class SpecialisationRelanceBtp(IHttpContextAccessor http) : SpecialisationRelance
{
    /// <summary>Nœud des droits : Consulter (liste), Créer (préparer un lot), Valider (envoyer, noter, numéro de recommandé).</summary>
    public const string Noeud = "relances";

    private const string NatureRetenue = "RETENUE";

    // Pièces relancées : rôle du type, valables non annulées, tiers relancé (payeur d'une facture), chargé, échéances du
    // document (lues sans le module Règlements).
    public static string SqlPieces => $"""
        WITH p AS (
          SELECT d.ent_id, t.tyd_role_relance AS nature, d.ent_groupe_id, d.ent_numero, d.ent_date, d.ent_envoye_le, d.ent_total_ttc,
                 d.ent_net_a_payer, s.std_code,
                 coalesce((SELECT (x ->> 'per_id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.ent_intervenants) = 'array' THEN d.ent_intervenants ELSE '[]'::jsonb END) x
                           WHERE t.tyd_role_relance = 'FACTURE' AND x ->> 'fonction' = 'PAYEUR' AND jsonb_typeof(x -> 'per_id') = 'number' LIMIT 1), d.ent_tiers_id) AS tiers_id,
                 coalesce(a.aff_responsable_ind_id, c.per_cli_charge_ind_id) AS charge_id
          FROM document d
          JOIN type_document t ON t.tyd_id = d.ent_tyd_id
          JOIN statut_document s ON s.std_id = d.ent_std_id
          LEFT JOIN personne c ON c.per_id = d.ent_tiers_id
          LEFT JOIN affaire a ON a.aff_id = coalesce(d.ent_affaire_id, (SELECT h.cha_aff_id FROM chantier h WHERE h.cha_id = d.ent_chantier_id))
          WHERE t.tyd_role_relance IS NOT NULL AND d.ent_tiers_id IS NOT NULL AND {PerimetreDocuments.Sql("d")}
            AND (@pieces IS NULL OR d.ent_id = ANY(@pieces))
            AND (t.tyd_role_relance <> 'DEVIS' OR (s.std_code = 'ENVOYE' AND d.ent_rejete_le IS NULL
                 AND (d.ent_date_validite IS NULL OR d.ent_date_validite >= @jour)
                 AND NOT EXISTS (SELECT 1 FROM document_lien l
                                 JOIN document src ON src.ent_id = l.lie_source_ent_id
                                 JOIN document x ON x.ent_id = l.lie_cible_ent_id
                                 JOIN statut_document sx ON sx.std_id = x.ent_std_id
                                 WHERE l.lie_type = 'TRANSFORMATION' AND sx.std_code NOT IN ('ANNULE', 'REMPLACE')
                                   AND (src.ent_id = d.ent_id OR src.ent_groupe_id = d.ent_groupe_id))))
            AND (t.tyd_role_relance <> 'FACTURE' OR @reglement OR s.std_code <> 'PAYE'))
        SELECT coalesce(json_agg(json_build_object(
          'id', p.ent_id, 'nature', p.nature, 'groupe_id', p.ent_groupe_id, 'numero', p.ent_numero, 'date', p.ent_date,
          'depart', coalesce(p.ent_envoye_le::date, p.ent_date), 'tiers_id', p.tiers_id, 'tiers', tp.per_raison_sociale,
          'charge_id', p.charge_id, 'charge', nullif(concat_ws(' ', i.ind_prenom, i.ind_nom), ''),
          'montant', CASE WHEN p.nature = 'DEVIS' THEN p.ent_total_ttc ELSE p.ent_net_a_payer END,
          'echeances', (SELECT coalesce(json_agg(json_build_object('id', e.ech_id, 'date', e.ech_date, 'montant', e.ech_montant, 'nature', e.ech_nature)
                                                 ORDER BY e.ech_rang), '[]') FROM document_echeance e WHERE e.ech_ent_id = p.ent_id)
          ) ORDER BY p.ent_id), '[]') AS "Value"
        FROM p
        LEFT JOIN personne tp ON tp.per_id = p.tiers_id
        LEFT JOIN individu i ON i.ind_id = p.charge_id
        WHERE (@tiers IS NULL OR p.tiers_id = @tiers)
        """;

    /// <summary>Pièce lue (SqlPieces).</summary>
    public sealed record LignePiece(long Id, string Nature, long? GroupeId, string? Numero, DateOnly Date, DateOnly Depart, long TiersId, string? Tiers,
        long? ChargeId, string? Charge, decimal Montant, List<EcheanceDocument>? Echeances);

    /// <summary>Échéance du document (document_echeance) : sans le module Règlements, son montant est dû en entier.</summary>
    public sealed record EcheanceDocument(long Id, DateOnly? Date, decimal Montant, string Nature);

    private IServiceProvider? Services => http.HttpContext?.RequestServices;

    private static DateOnly Aujourdhui => DateOnly.FromDateTime(DateTime.Today);

    public override async Task<List<PieceEnAttente>> PiecesEnAttenteAsync(RelanceDbContext db, FiltrePieces filtre, CancellationToken ct)
    {
        var s = Services;
        var reglement = s?.GetService<ModulesSociete>() is { } m && await m.EstActifAsync(ModulesFacultatifs.Reglement, ct) ? s.GetService<ServiceReglement>() : null;
        Func<IReadOnlyCollection<long>, CancellationToken, Task<List<EcheanceDto>>>? echeances = reglement is null ? null
            : (pieces, c) => reglement.Echeances(new FiltreEcheances(Sens: "E", Pieces: pieces), true, c);
        return await PiecesAsync(db, filtre, Aujourdhui, echeances, ct);
    }

    /// <summary>
    /// Pièces en attente à une date (fin de validité des devis) ; <paramref name="echeancesReglement"/> : échéances ouvertes
    /// du module Règlements (reste à payer) des factures listées, null sans le module.
    /// </summary>
    public static async Task<List<PieceEnAttente>> PiecesAsync(DbContext db, FiltrePieces filtre, DateOnly jour,
        Func<IReadOnlyCollection<long>, CancellationToken, Task<List<EcheanceDto>>>? echeancesReglement, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>(SqlPieces,
            P("pieces", filtre.Pieces?.ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint), P("tiers", filtre.TiersId, NpgsqlDbType.Bigint),
            P("jour", jour, NpgsqlDbType.Date), P("reglement", echeancesReglement is not null, NpgsqlDbType.Boolean)).FirstAsync(ct);
        var lignes = JsonSerializer.Deserialize<List<LignePiece>>(json, JsonCalcul.Options) ?? [];
        Dictionary<long, List<EcheanceDto>>? ouvertes = null;
        if (echeancesReglement is not null)
        {
            var factures = lignes.Where(l => l.Nature == RolesRelance.Facture).Select(l => l.Id).ToList();
            ouvertes = factures.Count == 0 ? [] : (await echeancesReglement(factures, ct)).GroupBy(e => e.PieceId).ToDictionary(g => g.Key, g => g.ToList());
        }
        return Construire(lignes, ouvertes);
    }

    /// <summary>
    /// Pièces du module depuis les lignes lues : devis (départ = envoi, montant TTC) ; facture avec le reste de ses
    /// échéances ouvertes du module Règlements (<paramref name="ouvertes"/>, null sans le module) ou, sans lui, le montant
    /// de ses échéances (sans échéance : le net à payer à la date de la pièce) ; retenue de garantie datée de sa
    /// libération, sa part cautionnée exigible à la date de la pièce ; facture sans échéance ouverte : absente.
    /// </summary>
    public static List<PieceEnAttente> Construire(IEnumerable<LignePiece> lignes, IReadOnlyDictionary<long, List<EcheanceDto>>? ouvertes)
    {
        var res = new List<PieceEnAttente>();
        foreach (var l in lignes)
        {
            if (l.Nature == RolesRelance.Devis)
            {
                res.Add(new PieceEnAttente(l.Id, NatureRelance.Devis, l.TiersId, l.ChargeId, l.Depart, l.Montant, GroupeId: l.GroupeId, Numero: l.Numero,
                    Tiers: l.Tiers, Charge: l.Charge));
                continue;
            }
            var echeances = ouvertes is null ? EcheancesDocument(l) : EcheancesReglement(l, ouvertes.GetValueOrDefault(l.Id) ?? []);
            if (echeances.Count == 0) continue;
            res.Add(new PieceEnAttente(l.Id, NatureRelance.Facture, l.TiersId, l.ChargeId, Montant: l.Montant, Echeances: echeances, GroupeId: l.GroupeId,
                Numero: l.Numero, Tiers: l.Tiers, Charge: l.Charge));
        }
        return res;
    }

    private static List<EcheanceRelance> EcheancesDocument(LignePiece l) =>
        l.Echeances is { Count: > 0 } e
            ? [.. e.Select(x => x.Nature == NatureRetenue ? new EcheanceRelance(x.Id, x.Date, x.Montant, true) : new EcheanceRelance(x.Id, x.Date ?? l.Date, x.Montant))]
            : [new EcheanceRelance(-l.Id, l.Date, l.Montant)];

    private static List<EcheanceRelance> EcheancesReglement(LignePiece l, List<EcheanceDto> ouvertes)
    {
        var res = new List<EcheanceRelance>();
        foreach (var e in ouvertes.Where(e => !e.Reglee))
        {
            if (e.Nature != NatureRetenue)
            {
                res.Add(new EcheanceRelance(e.Id, e.Date ?? e.DatePiece ?? l.Date, e.Reste));
                continue;
            }
            if (e.ExigibleCaution > 0) res.Add(new EcheanceRelance(e.Id, e.DatePiece ?? l.Date, e.ExigibleCaution));
            if (e.Reste - e.ExigibleCaution is var retenu && retenu > 0) res.Add(new EcheanceRelance(e.Id, e.Date, retenu, true));
        }
        return res;
    }

    // Individus couverts par une portée : soi ; EQUIPE : aussi les membres des équipes dont on est le chef aujourd'hui ;
    // SERVICE : aussi les membres des services dont on est le responsable (service ou service parent).
    private static string SqlIndividus => $$"""
        WITH moi AS (SELECT ind_id FROM individu WHERE ind_utilisateur = @u)
        SELECT ind_id AS "Value" FROM moi
        UNION SELECT s.sal_ind_id::bigint FROM salarie s WHERE @equipe AND s.sal_ind_id IS NOT NULL AND s.sal_id IN ({{ComptesBtp.SqlEquipiers}})
        UNION SELECT m.sme_ind_id::bigint FROM service_membre m JOIN service v ON v.srv_id = m.sme_srv_id LEFT JOIN service p ON p.srv_id = v.srv_parent_id
              WHERE @service AND (v.srv_responsable_id IN (SELECT ind_id FROM moi) OR p.srv_responsable_id IN (SELECT ind_id FROM moi))
        """;

    /// <summary>
    /// Portée (Q9) du nœud « relances » pour Consulter : TOUT, sinon les pièces dont le chargé est l'un des individus
    /// couverts (SOI, EQUIPE, SERVICE) ; refusée : aucune pièce. Sans le module Droits : TOUT.
    /// </summary>
    public override async Task<PorteeRelance> PorteeAsync(RelanceDbContext db, Utilisateur utilisateur, CancellationToken ct)
    {
        var droits = Services?.GetService<IDroits>();
        var portee = droits is null ? "TOUT" : await droits.PorteeAsync(utilisateur, Noeud, ActionsDroits.Consulter, ct);
        return await PorteeAsync(db, utilisateur.Code, portee, ct);
    }

    /// <summary>Portée accordée (<paramref name="portee"/> : SOI, EQUIPE, SERVICE, TOUT ; null : refusée) traduite en chargés.</summary>
    public static async Task<PorteeRelance> PorteeAsync(DbContext db, string utilisateur, string? portee, CancellationToken ct)
    {
        if (portee == "TOUT") return PorteeRelance.Toutes;
        if (portee is null) return new PorteeRelance(false, []);
        var individus = await db.Database.SqlQueryRaw<long>(SqlIndividus, new NpgsqlParameter("u", utilisateur),
            new NpgsqlParameter("equipe", portee is "EQUIPE" or "SERVICE"), new NpgsqlParameter("service", portee == "SERVICE"),
            new NpgsqlParameter("jour", Aujourdhui)).ToListAsync(ct);
        return new PorteeRelance(false, individus.ToHashSet());
    }
}

/// <summary>
/// Routes du cœur pour le module Relances : droit propre à la préparation (POST /api/relances/lots, même gabarit que la
/// lecture des lots, rattachée au nœud en lecture par la table des routes : Créer exigé) ; libellés des pièces et des
/// tiers affichés par la page /relances (GET /api/relances/libelles?pieces=&tiers=).
/// </summary>
public static class RoutesRelancesBtp
{
    private const string SqlLibelles = """
        SELECT json_build_object(
          'pieces', (SELECT coalesce(json_object_agg(d.ent_id, concat_ws(' ', t.tyd_libelle, coalesce(d.ent_numero, '#' || d.ent_id))), json_build_object())
                     FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = ANY(@pieces)),
          'tiers', (SELECT coalesce(json_object_agg(per_id, per_raison_sociale), json_build_object()) FROM personne WHERE per_id = ANY(@tiers)))::text AS "Value"
        """;

    public static TBuilder DroitsRelances<TBuilder>(this TBuilder routes) where TBuilder : IEndpointConventionBuilder =>
        routes.AddEndpointFilter(async (contexte, suite) =>
        {
            var h = contexte.HttpContext;
            if (HttpMethods.IsPost(h.Request.Method) && h.GetEndpoint() is RouteEndpoint ep && ep.RoutePattern.RawText is { } g
                && RoutesDroits.Normaliser(g) == "/api/relances/lots" && h.RequestServices.GetService<IDroits>() is { } droits)
                await droits.ExigerAsync(Utilisateur.Depuis(h), SpecialisationRelanceBtp.Noeud, ActionsDroits.Creer, h.RequestAborted);
            return await suite(contexte);
        });

    public static RouteGroupBuilder MapLibellesRelances(this RouteGroupBuilder api)
    {
        api.MapGet("/relances/libelles", (long[]? pieces, long[]? tiers, LogiBtpContext db, CancellationToken ct) =>
            db.JsonAsync(SqlLibelles, ct, P("pieces", pieces ?? [], NpgsqlDbType.Array | NpgsqlDbType.Bigint), P("tiers", tiers ?? [], NpgsqlDbType.Array | NpgsqlDbType.Bigint)));
        return api;
    }
}
