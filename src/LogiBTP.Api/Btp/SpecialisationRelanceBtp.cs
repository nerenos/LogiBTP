using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using LogiBTP.Crm;
using LogiBTP.Crm.Web;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Droits.Web;
using LogiBTP.Editions.Web;
using LogiBTP.Mail;
using LogiBTP.Mail.Web;
using LogiBTP.Reglements.Web;
using LogiBTP.Relances;
using LogiBTP.Relances.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using static LogiBTP.Api.Btp.SqlBtp;
using DestinataireSaisi = LogiBTP.Mail.Web.DestinataireSaisi;
using ResultatEnvoi = LogiBTP.Relances.Web.ResultatEnvoi;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Relances spécialisé par le cœur (plans/relances.md, lot 4) : pièces en attente lues par le rôle de leur type
/// (type_document.tyd_role_relance, db/283), parmi les pièces valables non annulées (PerimetreDocuments) ; devis ENVOYE
/// non rejetés, non expirés, non transformés (groupe d'indices compris) ; factures à reste échu : reste du module
/// Règlements s'il est actif (ServiceReglement), sinon échéances du document tant que le statut n'est pas PAYE (Q8) ;
/// tiers relancé = intervenant PAYEUR de la facture, sinon le tiers (Q6) ; chargé = responsable de l'affaire
/// (aff_responsable_ind_id), sinon chargé d'affaires du client (Q9) ; portée du nœud « relances » par chargé.
/// Lot 6 : envoi par courriel (module Mail, usage RELANCE, modèles par nature et niveau de db/285, lot de priorité
/// basse, édition de chaque pièce jointe, bascule en courrier sans adresse, Q11, Q21) ; note RELANCE du CRM (Q14).
/// Lot 7 : lettre (COURRIER, RECOMMANDE, bascule du courriel) produite par le module Édition (source « relance »,
/// modèles RELANCE_1, RELANCE_2, MISE_EN_DEMEURE), rangée en GED de chaque pièce (catégorie relance, db/286) ;
/// recommandé en ATTENTE_NUMERO jusqu'à la saisie de son numéro (Q12).
/// </summary>
public sealed class SpecialisationRelanceBtp(IHttpContextAccessor http, ILogger<SpecialisationRelanceBtp> journal) : SpecialisationRelance
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

    public override async Task<List<PieceEnAttente>> PiecesEnAttenteAsync(RelanceDbContext db, FiltrePieces filtre, CancellationToken ct) =>
        await PiecesAsync(db, filtre, Aujourdhui, await EcheancesReglementAsync(Services, ct), ct);

    /// <summary>Lecture des échéances ouvertes du module Règlements s'il est actif pour la société ; null sinon.</summary>
    public static async Task<Func<IReadOnlyCollection<long>, CancellationToken, Task<List<EcheanceDto>>>?> EcheancesReglementAsync(IServiceProvider? s, CancellationToken ct)
    {
        var reglement = s?.GetService<ModulesSociete>() is { } m && await m.EstActifAsync(ModulesFacultatifs.Reglement, ct) ? s.GetService<ServiceReglement>() : null;
        return reglement is null ? null : (pieces, c) => reglement.Echeances(new FiltreEcheances(Sens: "E", Pieces: pieces), true, c);
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

    // Surcharge des tiers (db/284, Q6, Q21) : règle propre, « ne pas relancer », mode préféré (le contact et le commentaire
    // servent à l'envoi, lot 6). Les tiers sans surcharge sont absents.
    private const string SqlSurcharges = """
        SELECT per_id AS id, per_rel_regle::text AS regle, per_rel_ne_pas_relancer AS ne_pas_relancer, per_rel_mode AS mode
        FROM personne
        WHERE per_id = ANY(@tiers) AND (per_rel_ne_pas_relancer OR per_rel_regle IS NOT NULL OR per_rel_mode IS NOT NULL)
        """;

    /// <summary>Surcharge d'un tiers lue (SqlSurcharges).</summary>
    public sealed record LigneSurcharge(long Id, string? Regle, bool NePasRelancer, string? Mode);

    public override async Task<Dictionary<long, SurchargeTiers>> RegleDuTiersAsync(RelanceDbContext db, IReadOnlyCollection<long> tiers, CancellationToken ct) =>
        await SurchargesAsync(db, tiers, ct);

    /// <summary>
    /// Surcharges des tiers listés. Une règle propre invalide (niveaux, délais, modes contrôlés comme pour une facture)
    /// est ignorée : le tiers garde la règle de la nature.
    /// </summary>
    public static async Task<Dictionary<long, SurchargeTiers>> SurchargesAsync(DbContext db, IReadOnlyCollection<long> tiers, CancellationToken ct)
    {
        var lignes = await db.Database.SqlQueryRaw<LigneSurcharge>(SqlSurcharges, P("tiers", tiers.ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint)).ToListAsync(ct);
        return lignes.ToDictionary(l => l.Id, l => new SurchargeTiers(LireRegle(l.Regle), l.NePasRelancer, l.Mode));
    }

    /// <summary>Règle propre d'un tiers (JSON snake_case) ; null si absente, illisible ou invalide.</summary>
    public static RegleRelance? LireRegle(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var regle = JsonSerializer.Deserialize<RegleRelance>(json, JsonCalcul.Options);
            return regle is not null && ReglesRelance.Controler(regle, NatureRelance.Facture).Count == 0 ? regle : null;
        }
        catch (JsonException) { return null; }
    }

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

    // ----- Envoi par courriel (lot 6, Q11, Q20, Q21) -----

    /// <summary>Usage du module Mail (expéditeur, modèles) et origine du lot des courriels d'un lot de relances.</summary>
    public const string Usage = "RELANCE";

    private const string MarqueTableau = "\u0001tableau\u0001";

    // Pièces d'un envoi : libellé, contacts figés (client, payeur) et intervenants (destinataire), type et groupe d'indices
    // (dernière édition rangée en GED).
    private const string SqlPiecesCourriel = """
        SELECT d.ent_id AS id, t.tyd_code AS type, t.tyd_libelle AS libelle, d.ent_numero AS numero, d.ent_date AS date, d.ent_groupe_id AS groupe_id,
               d.ent_tiers_id AS tiers_id, d.ent_contact_client::text AS contact_client, d.ent_contact_payeur::text AS contact_payeur,
               d.ent_intervenants::text AS intervenants
        FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        WHERE d.ent_id = ANY(@ids) ORDER BY d.ent_id
        """;

    private const string SqlTiersCourriel = """
        SELECT per_id AS id, per_raison_sociale AS raison_sociale, per_rel_contact_ind_id AS contact_id, per_rel_commentaire AS commentaire
        FROM personne WHERE per_id = ANY(@ids)
        """;

    /// <summary>Pièce d'un envoi lue (SqlPiecesCourriel).</summary>
    public sealed record PieceCourriel(long Id, string Type, string Libelle, string? Numero, DateOnly Date, long? GroupeId, long? TiersId,
        string? ContactClient, string? ContactPayeur, string? Intervenants)
    {
        public string Titre => $"{Libelle} {Numero ?? $"#{Id}"}";
    }

    /// <summary>Tiers relancé lu (SqlTiersCourriel) : contact de relance et commentaire (db/284).</summary>
    public sealed record TiersCourriel(long Id, string? RaisonSociale, long? ContactId, string? Commentaire);

    private sealed record ModeleRelance(long Id, string Type, string Objet, string CorpsHtml, bool Defaut);

    /// <summary>Courriel préparé : destinataire, objet, corps HTML, pièces jointes (« ged:&lt;id&gt; »).</summary>
    public sealed record CourrielRelance(DestinataireSaisi Destinataire, string Objet, string CorpsHtml, List<string> Pieces);

    private static readonly NumberFormatInfo Fr = new() { NumberGroupSeparator = " ", NumberDecimalSeparator = "," };

    private static string Montant(decimal m) => m.ToString("#,##0.00", Fr) + " €";

    private static string Date(DateOnly d) => d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    /// <summary>Courriel d'une relance groupée ; tiers sans adresse connue : bascule en courrier, avec sa lettre (Q21).</summary>
    public override async Task<ResultatEnvoi> EnvoyerCourrielAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct)
    {
        var s = Services ?? throw new InvalidOperationException("Envoi d'une relance hors d'une requête");
        var enAttente = await PiecesEnAttenteAsync(db, new FiltrePieces(Pieces: envoi.Pieces.Select(p => p.PieceId).ToList()), ct);
        return await CourrielAsync(db, envoi, enAttente, s.GetRequiredService<ServiceEnvoiMail>(), (p, c) => PieceJointeAsync(s, p, envoi.Auteur, c), ct)
            ?? await BasculerEnCourrierAsync(db, envoi, ct);
    }

    /// <summary>Envoi en courrier d'un groupe proposé en courriel faute d'adresse (mode inscrit au journal : COURRIER).</summary>
    public async Task<ResultatEnvoi> BasculerEnCourrierAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) =>
        (await EnvoyerCourrierAsync(db, envoi with { Mode = ModeRelance.Courrier }, ct)) with { Mode = ModeRelance.Courrier };

    /// <summary>
    /// Met en file le courriel d'une relance groupée (null : aucune adresse, le groupe bascule en courrier) : destinataire,
    /// modèle de la nature et du niveau, pièces jointes (<paramref name="pieceJointe"/> : dernière édition en GED, sinon
    /// produite), lot du Mail du lot de relances (priorité basse), élément du courriel = le tiers, liens aux pièces.
    /// </summary>
    public static async Task<ResultatEnvoi?> CourrielAsync(DbContext db, EnvoiRelance envoi, IReadOnlyList<PieceEnAttente> enAttente, ServiceEnvoiMail mail,
        Func<PieceCourriel, CancellationToken, Task<string?>> pieceJointe, CancellationToken ct)
    {
        var c = await PreparerCourrielAsync(db, envoi, enAttente, pieceJointe, ct);
        if (c is null) return null;
        var lot = await LotMailAsync(db, mail, envoi, ct);
        var r = await mail.EnvoyerAutomatiqueAsync(new EnvoiAutomatique(Usage, [c.Destinataire], c.Objet, c.CorpsHtml, envoi.Auteur.Code, ReglesEnvoi.Basse,
            TypesFiche.Personne, envoi.TiersId.ToString(CultureInfo.InvariantCulture), c.Pieces, Lot: lot), ct);
        // Courriel rattaché à chaque pièce relancée (le Mail le rattache au tiers).
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO mail_lien (mli_mme_id, mli_type_element, mli_id_element, mli_origine, mli_par)
            SELECT m, 'document', p::text, 'ENVOI', @u FROM unnest(@messages) m, unnest(@pieces) p
            ON CONFLICT (mli_mme_id, mli_type_element, mli_id_element) DO NOTHING
            """, [P("messages", r.Messages.ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint),
                  P("pieces", envoi.Pieces.Select(p => p.PieceId).Distinct().ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint), new NpgsqlParameter("u", envoi.Auteur.Code)], ct);
        return new ResultatEnvoi(EtatRelance.Envoyee, CourrielId: r.Messages[0]);
    }

    /// <summary>
    /// Lot du Mail d'un lot de relances (un seul pour toutes ses validations, priorité basse, fin signalée à l'auteur) :
    /// créé au premier courriel, compté ensuite courriel par courriel.
    /// </summary>
    private static async Task<long> LotMailAsync(DbContext db, ServiceEnvoiMail mail, EnvoiRelance envoi, CancellationToken ct)
    {
        var libelle = $"Relances : lot {envoi.LotId}";
        var existant = await db.Database.SqlQueryRaw<long>("""
            SELECT mlo_id AS "Value" FROM mail_lot WHERE mlo_origine = @o AND mlo_libelle = @l ORDER BY mlo_id DESC LIMIT 1
            """, new NpgsqlParameter("o", Usage), new NpgsqlParameter("l", libelle)).ToListAsync(ct);
        if (existant.Count == 0) return await mail.CreerLotAsync(Usage, libelle, envoi.Auteur.Code, 1, 1, ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE mail_lot SET mlo_messages = mlo_messages + 1, mlo_destinataires = mlo_destinataires + 1 WHERE mlo_id = @id",
            [new NpgsqlParameter("id", existant[0])], ct);
        return existant[0];
    }

    /// <summary>
    /// Courriel d'une relance groupée sans le mettre en file ; null sans adresse. Destinataire (Q11) : contact de relance
    /// du tiers, sinon contact figé d'une pièce (client si le tiers est celui de la pièce, sinon payeur), sinon
    /// intervenant de la pièce pour ce tiers, sinon le tiers. Modèle : celui du niveau dans la règle, sinon celui de la
    /// nature et du niveau (mmo_type « NATURE_n »), sinon le plus haut niveau inférieur, sinon la nature, sinon le modèle
    /// par défaut de l'usage, sinon un texte minimal.
    /// </summary>
    public static async Task<CourrielRelance?> PreparerCourrielAsync(DbContext db, EnvoiRelance envoi, IReadOnlyList<PieceEnAttente> enAttente,
        Func<PieceCourriel, CancellationToken, Task<string?>> pieceJointe, CancellationToken ct)
    {
        var ids = envoi.Pieces.Select(p => p.PieceId).Distinct().ToArray();
        var pieces = await db.Database.SqlQueryRaw<PieceCourriel>(SqlPiecesCourriel, P("ids", ids, NpgsqlDbType.Array | NpgsqlDbType.Bigint)).ToListAsync(ct);
        var tiers = (await db.Database.SqlQueryRaw<TiersCourriel>(SqlTiersCourriel, P("ids", new[] { envoi.TiersId }, NpgsqlDbType.Array | NpgsqlDbType.Bigint))
            .ToListAsync(ct)).FirstOrDefault();
        var destinataire = await DestinataireAsync(db, envoi.TiersId, tiers?.ContactId, pieces, ct);
        if (destinataire is null) return null;

        var charge = envoi.ChargeId is long ch ? (await db.Database.SqlQueryRaw<string>(
            "SELECT nullif(trim(concat_ws(' ', ind_prenom, ind_nom)), '') AS \"Value\" FROM individu WHERE ind_id = @i", new NpgsqlParameter("i", ch)).ToListAsync(ct)).FirstOrDefault() : null;
        var parId = pieces.ToDictionary(p => p.Id);
        var attente = enAttente.ToDictionary(p => p.Id);
        string Titre(long id) => parId.TryGetValue(id, out var p) ? p.Titre : $"#{id}";
        var echues = envoi.Pieces.SelectMany(p => attente.TryGetValue(p.PieceId, out var a) ? (a.Echeances ?? [])
                .Where(e => !e.Retenue && e.Date is DateOnly d && d < envoi.Date && e.Reste > 0).Select(e => $"{Titre(p.PieceId)} : {Montant(e.Reste)} au {Date(e.Date!.Value)}") : [])
            .ToList();
        var variables = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["tiers"] = tiers?.RaisonSociale, ["contact"] = destinataire.Nom, ["pieces"] = string.Join(", ", envoi.Pieces.Select(p => Titre(p.PieceId))),
            ["nombre"] = envoi.Pieces.Count.ToString(CultureInfo.InvariantCulture), ["montant"] = Montant(envoi.Pieces.Sum(p => p.Montant)),
            ["jours_retard"] = envoi.Pieces.Max(p => p.Jours).ToString(CultureInfo.InvariantCulture), ["echeances"] = echues.Count == 0 ? "aucune" : string.Join(" ; ", echues),
            ["niveau"] = envoi.Niveau.ToString(CultureInfo.InvariantCulture), ["charge"] = charge ?? envoi.Auteur.Code, ["commentaire"] = envoi.Commentaire,
            ["utilisateur"] = envoi.Auteur.Code, ["date"] = Date(envoi.Date),
        };
        var tableau = new StringBuilder("<table><thead><tr><th>Pièce</th><th>Date</th><th>Montant</th><th>Jours</th></tr></thead><tbody>");
        foreach (var p in envoi.Pieces)
        {
            var date = parId.TryGetValue(p.PieceId, out var x) ? Date(x.Date) : "";
            tableau.Append(CultureInfo.InvariantCulture, $"<tr><td>{WebUtility.HtmlEncode(Titre(p.PieceId))}</td><td>{date}</td><td>{WebUtility.HtmlEncode(Montant(p.Montant))}</td><td>{p.Jours}</td></tr>");
        }
        tableau.Append("</tbody></table>");

        var modele = await ModeleAsync(db, envoi, ct);
        var objet = Adresses.Remplir(modele?.Objet ?? "Relance – {{pieces}}", variables, false);
        var corps = Adresses.Remplir((modele?.CorpsHtml ?? "<p>Bonjour,</p>{{tableau}}<p>Cordialement,<br>{{charge}}</p>").Replace("{{tableau}}", MarqueTableau), variables, true)
            .Replace(MarqueTableau, tableau.ToString());

        var jointes = new List<string>();
        foreach (var p in pieces)
            if (await pieceJointe(p, ct) is { } r && !jointes.Contains(r)) jointes.Add(r);
        return new CourrielRelance(destinataire, objet, corps, jointes);
    }

    private static async Task<ModeleRelance?> ModeleAsync(DbContext db, EnvoiRelance envoi, CancellationToken ct)
    {
        var modeles = await db.Database.SqlQueryRaw<ModeleRelance>("""
            SELECT mmo_id AS id, mmo_type AS type, mmo_objet AS objet, mmo_corps_html AS corps_html, mmo_defaut AS defaut
            FROM mail_modele WHERE mmo_actif AND (mmo_usage = @u OR mmo_id = @m)
            """, new NpgsqlParameter("u", Usage), P("m", envoi.ModeleCourriel, NpgsqlDbType.Bigint)).ToListAsync(ct);
        int? Rang(ModeleRelance m) => m.Type.StartsWith(envoi.Nature + "_", StringComparison.Ordinal) && int.TryParse(m.Type[(envoi.Nature.Length + 1)..], out var n) ? n : null;
        return modeles.FirstOrDefault(m => m.Id == envoi.ModeleCourriel)
            ?? modeles.Where(m => Rang(m) is int n && n <= envoi.Niveau).OrderByDescending(m => Rang(m)).FirstOrDefault()
            ?? modeles.FirstOrDefault(m => m.Type == envoi.Nature)
            ?? modeles.Where(m => m.Type == "").OrderByDescending(m => m.Defaut).FirstOrDefault();
    }

    private static async Task<DestinataireSaisi?> DestinataireAsync(DbContext db, long tiers, long? contact, List<PieceCourriel> pieces, CancellationToken ct)
    {
        async Task<DestinataireSaisi?> Annuaire(long? ind)
        {
            using var inst = await ContactsDocument.Instantane(db, tiers, ind, ct);
            return inst is null ? null : Adresse(inst.RootElement, tiers, ind);
        }
        if (contact is long c && await Annuaire(c) is { } d) return d;
        foreach (var p in pieces)
        {
            var fige = p.TiersId == tiers ? p.ContactClient : p.ContactPayeur;
            if (fige is null) continue;
            using var j = JsonDocument.Parse(fige);
            if (j.RootElement.ValueKind == JsonValueKind.Object && Adresse(j.RootElement, tiers, null) is { } f) return f;
        }
        foreach (var p in pieces)
        {
            using var j = JsonDocument.Parse(p.Intervenants ?? "[]");
            if (j.RootElement.ValueKind != JsonValueKind.Array) continue;
            foreach (var i in j.RootElement.EnumerateArray())
            {
                if (!i.TryGetProperty("per_id", out var per) || per.ValueKind != JsonValueKind.Number || per.GetInt64() != tiers) continue;
                long? ind = i.TryGetProperty("ind_id", out var x) && x.ValueKind == JsonValueKind.Number ? x.GetInt64() : null;
                if (ind is not null && await Annuaire(ind) is { } a) return a;
            }
        }
        return await Annuaire(null);
    }

    /// <summary>Adresse valide d'un instantané de l'annuaire (contact figé ou relevé), s'il désigne bien le tiers.</summary>
    private static DestinataireSaisi? Adresse(JsonElement r, long tiers, long? ind)
    {
        if (r.TryGetProperty("per_id", out var per) && per.ValueKind == JsonValueKind.Number && per.GetInt64() != tiers) return null;
        if (LectureJson.TexteNonVide(r, "email") is not { } email || !Adresses.Valide(email)) return null;
        var nom = r.TryGetProperty("contact", out var c) && c.ValueKind == JsonValueKind.Object ? LectureJson.TexteNonVide(c, "nom") : null;
        long? contact = c.ValueKind == JsonValueKind.Object && c.TryGetProperty("ind_id", out var i) && i.ValueKind == JsonValueKind.Number ? i.GetInt64() : ind;
        return new DestinataireSaisi(email, nom ?? LectureJson.TexteNonVide(r, "raison_sociale"), tiers, contact);
    }

    /// <summary>Dernière édition d'une pièce rangée en GED (catégorie edition, type et groupe d'indices de la pièce).</summary>
    public static async Task<long?> DerniereEditionAsync(DbContext db, PieceCourriel p, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<long>("""
            SELECT dge_id AS "Value" FROM document_ged
            WHERE dge_categorie = @c AND dge_type_element = @t AND dge_id_element = @e AND NOT dge_supprime AND dge_parent_id IS NULL
            ORDER BY dge_cree_le DESC, dge_id DESC LIMIT 1
            """, new NpgsqlParameter("c", CategoriesGed.Edition), new NpgsqlParameter("t", p.Type),
            new NpgsqlParameter("e", (p.GroupeId ?? p.Id).ToString(CultureInfo.InvariantCulture))).ToListAsync(ct)).Cast<long?>().FirstOrDefault();

    /// <summary>
    /// PDF joint d'une pièce (devis compris) : sa dernière édition rangée en GED, sinon édition produite à l'envoi par le
    /// modèle par défaut et rangée en GED comme une édition de la pièce (Q11 a) ; une édition impossible fait échouer
    /// l'envoi du groupe (il reste proposé, l'échec est signalé).
    /// </summary>
    private static async Task<string?> PieceJointeAsync(IServiceProvider s, PieceCourriel p, Utilisateur u, CancellationToken ct)
    {
        if (await DerniereEditionAsync(s.GetRequiredService<LogiBtpContext>(), p, ct) is long id) return $"ged:{id}";
        var element = p.Id.ToString(CultureInfo.InvariantCulture);
        var (pdf, _, preparation) = await s.GetRequiredService<ServiceEdition>().Pdf(s, new DemandeEdition("document", element), false, u, ct);
        var depot = await s.GetRequiredService<SpecialisationEdition>().DeposerAsync(s,
            new TacheEdition { EttSource = "document", EttIdElement = element, EttMotif = "ENVOI", EttDemandePar = u.Code, EttCreeLe = DateTimeOffset.UtcNow },
            pdf, preparation, u, ct);
        return depot is long d ? $"ged:{d}" : null;
    }

    // ----- Lettres et recommandés (lot 7, Q12, Q13 b) -----

    /// <summary>Lettre simple : PDF du module Édition rangé en GED de chaque pièce ; ENVOYEE.</summary>
    public override Task<ResultatEnvoi> EnvoyerCourrierAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) => LettreServeurAsync(db, envoi, ct);

    /// <summary>Lettre recommandée : même lettre, en ATTENTE_NUMERO jusqu'à la saisie de son numéro (PUT /api/relances/{id}/recommande).</summary>
    public override Task<ResultatEnvoi> EnvoyerRecommandeAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) => LettreServeurAsync(db, envoi, ct);

    private Task<ResultatEnvoi> LettreServeurAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct)
    {
        var s = Services ?? throw new InvalidOperationException("Envoi d'une relance hors d'une requête");
        return LettreAsync(db, envoi, ProduireLettre(s, envoi), RangerLettre(s, envoi.Auteur), ct);
    }

    /// <summary>PDF d'une lettre produit par le module Édition (moteur du serveur) : octets, pages, libellé, nom du fichier, alertes du moteur (JSON).</summary>
    public sealed record LettreProduite(byte[] Pdf, int Pages, string Libelle, string NomFichier, string Alertes = "[]");

    /// <summary>Lettre à ranger en GED d'une pièce : type et groupe d'indices de la pièce, titre, date, résumé, PDF.</summary>
    public sealed record LettreARanger(string TypeElement, string IdElement, string Titre, DateOnly Date, string Resume, string Modele, LettreProduite Lettre);

    /// <summary>Production par le module Édition : source « relance », modèle choisi, paramètres de l'envoi (mode, date, commentaire).</summary>
    public static Func<string, string, CancellationToken, Task<LettreProduite>> ProduireLettre(IServiceProvider s, EnvoiRelance envoi) => async (modele, id, ct) =>
    {
        var parametres = new Dictionary<string, JsonElement>
        {
            ["mode"] = JsonSerializer.SerializeToElement(envoi.Mode),
            ["date"] = JsonSerializer.SerializeToElement(envoi.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        };
        if (!string.IsNullOrWhiteSpace(envoi.Commentaire)) parametres["commentaire"] = JsonSerializer.SerializeToElement(envoi.Commentaire);
        var (pdf, nom, preparation) = await s.GetRequiredService<ServiceEdition>().Pdf(s, new DemandeEdition(SourceRelanceEdition.Source, id, modele, Parametres: parametres),
            false, envoi.Auteur, ct);
        return new LettreProduite(pdf.Octets, pdf.Pages, preparation.Element, nom, pdf.AlertesJson);
    };

    /// <summary>Dépôt dans la GED du serveur (catégorie relance, confidentialité interne) ; renvoie le document créé.</summary>
    public static Func<LettreARanger, CancellationToken, Task<long>> RangerLettre(IServiceProvider s, Utilisateur u) => async (l, ct) =>
    {
        await using var flux = new MemoryStream(l.Lettre.Pdf);
        var fichier = new FormFile(flux, 0, l.Lettre.Pdf.Length, "fichier", l.Lettre.NomFichier) { Headers = new HeaderDictionary(), ContentType = "application/pdf" };
        var depot = await s.GetRequiredService<LogiBTP.Ged.Web.ServiceGed>().DeposerFichier(fichier, new LogiBTP.Ged.Web.MetaDepot
        {
            Titre = l.Titre, Categorie = CategoriesGed.Relance, TypeElement = l.TypeElement, IdElement = l.IdElement, Auteur = u.Code,
            DateDocument = l.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), Confidentialite = NiveauConfidentialite.Interne, Resume = l.Resume,
            MotsCles = ["relance", l.Modele.ToLowerInvariant()],
        }, u, ct);
        return depot.Id;
    };

    /// <summary>
    /// Lettre d'une relance groupée (une par groupe) : modèle du niveau dans la règle, sinon modèle par défaut
    /// (<see cref="ModeleParDefaut"/>) ; PDF produit une fois (<paramref name="produire"/>), rangé en GED de chaque pièce
    /// (<paramref name="ranger"/>, groupe d'indices de la pièce, catégorie relance) ; ENVOYEE, ou ATTENTE_NUMERO pour un
    /// recommandé ; document GED de la première pièce gardé au journal. Une production ou un dépôt impossible fait
    /// échouer l'envoi du groupe (il reste proposé, l'échec est signalé).
    /// </summary>
    public static async Task<ResultatEnvoi> LettreAsync(DbContext db, EnvoiRelance envoi, Func<string, string, CancellationToken, Task<LettreProduite>> produire,
        Func<LettreARanger, CancellationToken, Task<long>> ranger, CancellationToken ct)
    {
        var modele = await ModeleLettreAsync(db, envoi, ct);
        var lettre = await produire(modele, SourceRelanceEdition.Identifiant(envoi.Pieces.Select(p => p.RelanceId)), ct);
        var pieces = await db.Database.SqlQueryRaw<PieceCourriel>(SqlPiecesCourriel,
            P("ids", envoi.Pieces.Select(p => p.PieceId).Distinct().ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint)).ToListAsync(ct);
        var recommande = envoi.Mode == ModeRelance.Recommande;
        var resume = $"Lettre de relance {Par(envoi.Mode)}, niveau {envoi.Niveau} ({modele}), {lettre.Pages} page(s) : {string.Join(", ", pieces.Select(p => p.Titre))}";
        long? premier = null;
        foreach (var element in pieces.GroupBy(p => (p.Type, (p.GroupeId ?? p.Id).ToString(CultureInfo.InvariantCulture))))
        {
            var id = await ranger(new LettreARanger(element.Key.Type, element.Key.Item2, $"{lettre.Libelle} du {Date(envoi.Date)}", envoi.Date, resume, modele, lettre), ct);
            premier ??= id;
        }
        return new ResultatEnvoi(recommande ? EtatRelance.AttenteNumero : EtatRelance.Envoyee, GedId: premier);
    }

    /// <summary>
    /// Modèle par défaut d'une lettre (Q13 b) : dernier niveau de la règle d'une facture (ou au-delà : répétition) →
    /// mise en demeure ; niveau 1 → RELANCE_1 ; sinon RELANCE_2.
    /// </summary>
    public static string ModeleParDefaut(string nature, int niveau, int dernierNiveau) =>
        nature == NatureRelance.Facture && niveau >= dernierNiveau ? ModelesEdition.MiseEnDemeure
        : niveau <= 1 ? ModelesEdition.Relance1 : ModelesEdition.Relance2;

    /// <summary>
    /// Modèle de la lettre : celui du niveau dans la règle (identifiant de modele_edition, actif, de la source relance),
    /// sinon le modèle par défaut selon le dernier niveau de la règle du tiers (surcharge), sinon de la nature
    /// (relance_regle), sinon de la règle par défaut.
    /// </summary>
    public static async Task<string> ModeleLettreAsync(DbContext db, EnvoiRelance envoi, CancellationToken ct)
    {
        if (envoi.ModeleEdition is long m && (await db.Database.SqlQueryRaw<string>("""
                SELECT med_code AS "Value" FROM modele_edition WHERE med_id = @m AND med_actif AND med_genre = 'RAPPORT' AND med_source = @s
                """, new NpgsqlParameter("m", m), new NpgsqlParameter("s", SourceRelanceEdition.Source)).ToListAsync(ct)).FirstOrDefault() is { } code)
            return code;
        var regle = (await SurchargesAsync(db, [envoi.TiersId], ct)).GetValueOrDefault(envoi.TiersId)?.Regle;
        if (regle is null)
        {
            var niveaux = (await db.Database.SqlQueryRaw<string>("SELECT rrg_niveaux::text AS \"Value\" FROM relance_regle WHERE rrg_nature = @n",
                new NpgsqlParameter("n", envoi.Nature)).ToListAsync(ct)).FirstOrDefault();
            var lus = niveaux is null ? null : JsonSerializer.Deserialize<List<NiveauRelance>>(niveaux, JsonCalcul.Options);
            regle = lus is { Count: > 0 } ? new RegleRelance(lus) : ReglesRelance.RegleParDefaut(envoi.Nature);
        }
        return ModeleParDefaut(envoi.Nature, envoi.Niveau, regle.Niveaux.Max(n => n.Rang));
    }

    // ----- Note RELANCE du CRM (Q14) -----

    /// <summary>Note RELANCE du CRM pour les relances faites (envoyées, notées), si le module est actif ; un échec est journalisé.</summary>
    public override async Task ApresEnvoiAsync(RelanceDbContext db, IReadOnlyList<RelanceDto> relances, CancellationToken ct)
    {
        var s = Services;
        if (s?.GetService<ModulesSociete>() is not { } m || !await m.EstActifAsync(ModulesFacultatifs.Crm, ct)) return;
        var crm = s.GetRequiredService<ServiceCrm>();
        await NoterAsync(db, relances, async (n, u, c) => (await crm.Enregistrer(null, n, u, c)).Note.Id, ct, journal);
    }

    private static string Par(string mode) => mode switch
    {
        ModeRelance.Courriel => "par courriel",
        ModeRelance.Courrier => "par courrier",
        ModeRelance.Recommande => "par lettre recommandée",
        ModeRelance.Tache => "par appel",
        _ => mode,
    };

    /// <summary>
    /// Une note RELANCE (type de note du CRM, action close) par relance groupée faite : rattachée à chaque pièce (groupe
    /// d'indices : remet à zéro l'indicateur « Devis à relancer », db/267) et au tiers ; liée au courriel (mail_lien
    /// crm_note) quand il y en a un. Renvoie les notes créées.
    /// </summary>
    public static async Task<List<long>> NoterAsync(DbContext db, IReadOnlyList<RelanceDto> relances, Func<NoteSaisie, Utilisateur, CancellationToken, Task<long>> noter,
        CancellationToken ct, ILogger? journal = null)
    {
        var notes = new List<long>();
        if (relances.Count == 0) return notes;
        var tno = await SpecialisationCrmBtp.TypeNoteAsync(db, SpecialisationCrmBtp.TypeNoteRelance, ct);
        var pieces = (await db.Database.SqlQueryRaw<PieceCourriel>(SqlPiecesCourriel,
            P("ids", relances.Select(r => r.PieceId).Distinct().ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint)).ToListAsync(ct)).ToDictionary(p => p.Id);
        var tiers = (await db.Database.SqlQueryRaw<TiersCourriel>(SqlTiersCourriel,
            P("ids", relances.Select(r => r.TiersId).Distinct().ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint)).ToListAsync(ct)).ToDictionary(t => t.Id);
        foreach (var g in relances.GroupBy(r => (r.LotId, r.LotId is null ? r.Id : r.Groupe)))
        {
            var l = g.ToList();
            var r0 = l[0];
            try
            {
                string Titre(long id) => pieces.TryGetValue(id, out var p) ? p.Titre : $"#{id}";
                var objet = $"Relance {Par(r0.Mode)} de niveau {l.Max(r => r.Niveau)} : {string.Join(", ", l.Select(r => Titre(r.PieceId)))}";
                if (objet.Length > ReglesNote.LongueurObjet) objet = objet[..(ReglesNote.LongueurObjet - 1)] + "…";
                var html = new StringBuilder($"<p>Relance {WebUtility.HtmlEncode(Par(r0.Mode))} du {Date(r0.Date)}")
                    .Append(r0.CourrielId is long m ? $", courriel n° {m}" : "").Append("</p><ul>");
                foreach (var r in l)
                    html.Append(CultureInfo.InvariantCulture, $"<li>{WebUtility.HtmlEncode(Titre(r.PieceId))} : niveau {r.Niveau}, {WebUtility.HtmlEncode(Montant(r.Montant))}, {r.Jours} jours</li>");
                html.Append("</ul>");
                if (!string.IsNullOrWhiteSpace(r0.Commentaire)) html.Append("<p>").Append(WebUtility.HtmlEncode(r0.Commentaire)).Append("</p>");
                if (tiers.GetValueOrDefault(r0.TiersId)?.Commentaire is { Length: > 0 } ct2) html.Append("<p>Commentaire du tiers : ").Append(WebUtility.HtmlEncode(ct2)).Append("</p>");
                var liens = l.Select(r => new LienSaisi("document", (pieces.GetValueOrDefault(r.PieceId)?.GroupeId ?? r.GroupeId ?? r.PieceId).ToString(CultureInfo.InvariantCulture)))
                    .Append(new LienSaisi(TypesFiche.Personne, r0.TiersId.ToString(CultureInfo.InvariantCulture))).ToList();
                liens[0] = liens[0] with { Principal = true };
                var note = await noter(new NoteSaisie(NatureNote.Action, EtatNote.Memo, tno, null, objet, html.ToString(), null, null, null, false, false, false, liens, null),
                    new Utilisateur(r0.Auteur, Profils.Admin), ct);
                notes.Add(note);
                if (r0.CourrielId is long courriel)
                    await db.Database.ExecuteSqlRawAsync("""
                        INSERT INTO mail_lien (mli_mme_id, mli_type_element, mli_id_element, mli_origine, mli_par) VALUES (@m, 'crm_note', @n, 'ENVOI', @u)
                        ON CONFLICT (mli_mme_id, mli_type_element, mli_id_element) DO NOTHING
                        """, [new NpgsqlParameter("m", courriel), new NpgsqlParameter("n", note.ToString(CultureInfo.InvariantCulture)), new NpgsqlParameter("u", r0.Auteur)], ct);
            }
            catch (Exception e) when (e is not OperationCanceledException && journal is not null)
            {
                journal.LogWarning(e, "Relances : note du CRM non posée (lot {Lot}, groupe {Groupe})", r0.LotId, r0.Groupe);
            }
        }
        return notes;
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
