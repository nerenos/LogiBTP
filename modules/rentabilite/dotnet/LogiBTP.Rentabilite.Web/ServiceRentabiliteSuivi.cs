using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Filtre de la Liste : période, chantiers exclus (internes, affaires de gestion) et clos affichés.</summary>
public sealed record FiltreListe(DateOnly? Du, DateOnly? Au, bool Exclus, bool Clos);

/// <summary>Somme des faits ouverts d'un chantier par ordre, indicateur et composante (Liste).</summary>
public sealed record AgregatListe(int ChaId, long? OrdreId, string Indicateur, string Composante, decimal Pa, decimal Pr, decimal Pv, decimal? Heures,
    decimal PaPeriode, decimal PrPeriode, decimal PvPeriode, decimal? HeuresPeriode);

/// <summary>Fraîcheur d'un chantier de la Liste : dernier calcul, attente, erreur ; changements depuis le dernier contrôle de l'utilisateur.</summary>
public sealed record EtatChantierListe(int ChaId, DateTimeOffset? CalculeLe, string? Etat, bool EnAttente, string? Erreur, DateTimeOffset? ControleLe,
    int Changements, int PrevisionsEchues);

public sealed record ListeRentabilite(DateOnly? Du, DateOnly? Au, bool VoirCouts, IReadOnlyList<ChantierListe> Chantiers, IReadOnlyList<OrdreChantier> Ordres,
    IReadOnlyList<AgregatListe> Agregats, IReadOnlyList<EtatChantierListe> Etats);

/// <summary>Contrôle d'un chantier par un utilisateur (§ 10.4) ; <c>Changements</c> : faits ouverts ou clos depuis.</summary>
public sealed record ControleLu(long Id, long CalculId, string Par, DateTimeOffset Le, int Changements);

/// <summary>Photo des chiffres d'un chantier (§ 10.3) : faits connus au calcul, datés jusqu'au <c>Date</c>.</summary>
public sealed record PhotoLue(long Id, DateOnly Date, long CalculId, string Type, string? Libelle, string? Par, DateTimeOffset Le);

/// <summary>Référence comparée dans le Détail (dernier contrôle ou photo) et ses agrégats.</summary>
public sealed record ReferenceDetail(string Code, long CalculId, DateOnly? Au, DateTimeOffset Le, IReadOnlyList<AgregatFaits> Agregats);

/// <summary>Ce qui a changé depuis un calcul : faits ajoutés et retirés (un fait modifié apparaît dans les deux).</summary>
public sealed record ChangementsChantier(ChantierRentabilite Chantier, long Depuis, DateTimeOffset? DepuisLe, bool VoirCouts, IReadOnlyList<FaitLu> Ajoutes,
    IReadOnlyList<FaitLu> Retires, IReadOnlyDictionary<long, PieceRentabilite> Pieces, IReadOnlyList<NatureRentabilite> Natures, IReadOnlyList<OrdreRentabilite> Ordres);

/// <summary>Vue enregistrée de la Liste ; propriétaire vide = vue globale.</summary>
public sealed record VueRentabilite(int Id, string Nom, string? Proprietaire, JsonElement Parametres, bool Defaut);

/// <summary>Vue saisie : globale (administrateur) ou personnelle ; défaut : ouverte d'abord.</summary>
public sealed record VueSaisie(int? Id, string Nom, bool Globale, bool Defaut, JsonElement Parametres);

/// <summary>Liste (§ 6), contrôles « ce qui a changé » (§ 10.4), photos (§ 10.3) et vues enregistrées.</summary>
public partial class ServiceRentabilite
{
    // ---------------------------------------------------------------- liste

    /// <summary>
    /// Liste : chantiers visibles (portée), sans les exclus ni les clos sauf demande ; sommes des faits par chantier,
    /// ordre, indicateur et composante ; fraîcheur et changements depuis le dernier contrôle de l'utilisateur.
    /// </summary>
    public async Task<ListeRentabilite> ListeAsync(IServiceProvider services, Utilisateur u, FiltreListe f, CancellationToken ct)
    {
        if (Periodes.Controler(f.Du, f.Au) is { } erreur) throw ExceptionMetier.Invalide(erreur, "Le début de la période est après sa fin");
        var p = await spec.PorteeAsync(services, u, ct);
        var chantiers = (await spec.ChantiersListeAsync(db, ct))
            .Where(c => p.Voit(c.Id) && (f.Exclus || !c.Exclu) && (f.Clos || !c.Clos)).ToList();
        var ids = chantiers.Select(c => c.Id).ToArray();
        var agregats = await db.Database.SqlQuery<AgregatListe>($"""
            SELECT afa_cha_id AS cha_id, afa_ordre_id AS ordre_id, afa_indicateur AS indicateur, afa_composante AS composante,
                   sum(afa_montant_pa) AS pa, sum(afa_montant_pr) AS pr, sum(afa_montant_pv) AS pv, sum(afa_heures) AS heures,
                   coalesce(sum(afa_montant_pa) FILTER (WHERE afa_date >= {f.Du}), 0) AS pa_periode,
                   coalesce(sum(afa_montant_pr) FILTER (WHERE afa_date >= {f.Du}), 0) AS pr_periode,
                   coalesce(sum(afa_montant_pv) FILTER (WHERE afa_date >= {f.Du}), 0) AS pv_periode,
                   sum(afa_heures) FILTER (WHERE afa_date >= {f.Du}) AS heures_periode
            FROM rentabilite_fait
            WHERE afa_cha_id = ANY({ids}) AND afa_calcul_fin IS NULL AND ({f.Au}::date IS NULL OR afa_date <= {f.Au})
            GROUP BY 1, 2, 3, 4
            """).ToListAsync(ct);
        if (!p.VoirCouts) agregats = agregats.Select(a => a with { Pa = 0, Pr = 0, PaPeriode = 0, PrPeriode = 0 }).ToList();
        var etats = await db.Database.SqlQuery<EtatChantierListe>($"""
            SELECT c AS cha_id, k.rca_fin AS calcule_le, k.rca_etat AS etat, (q.arq_cha_id IS NOT NULL) AS en_attente, q.arq_erreur AS erreur,
                   r.rco_le AS controle_le,
                   CASE WHEN r.rco_rca_id IS NULL THEN 0 ELSE f_rentabilite_changements(c, r.rco_rca_id) END AS changements,
                   (SELECT count(*)::int FROM rentabilite_prevision p WHERE p.rpr_cha_id = c AND p.rpr_supprimee_le IS NULL AND p.rpr_soldee_le IS NULL
                      AND p.rpr_echeance < {Aujourdhui}) AS previsions_echues
            FROM unnest({ids}) c
            LEFT JOIN LATERAL (SELECT rca_fin, rca_etat FROM rentabilite_calcul WHERE rca_cha_id = c ORDER BY rca_id DESC LIMIT 1) k ON TRUE
            LEFT JOIN rentabilite_a_recalculer q ON q.arq_cha_id = c
            LEFT JOIN LATERAL (SELECT rco_rca_id, rco_le FROM rentabilite_controle WHERE rco_cha_id = c AND rco_par = {u.Code} ORDER BY rco_id DESC LIMIT 1) r ON TRUE
            """).ToListAsync(ct);
        return new ListeRentabilite(f.Du, f.Au, p.VoirCouts, chantiers, await spec.OrdresChantiersAsync(db, ids, ct), agregats, etats);
    }

    // ---------------------------------------------------------------- contrôles

    /// <summary>Marque des chantiers contrôlés par l'utilisateur au dernier calcul réussi de chacun ; renvoie le nombre de chantiers marqués.</summary>
    public async Task<int> ControlerAsync(IServiceProvider services, Utilisateur u, IReadOnlyCollection<int> chantiers, CancellationToken ct)
    {
        var p = await spec.PorteeAsync(services, u, ct);
        var visibles = chantiers.Where(p.Voit).Distinct().ToArray();
        return await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO rentabilite_controle (rco_cha_id, rco_rca_id, rco_par)
            SELECT c, k.rca_id, {u.Code} FROM unnest({visibles}) c
            JOIN LATERAL (SELECT rca_id FROM rentabilite_calcul WHERE rca_cha_id = c AND rca_etat = {EtatCalcul.Ok} ORDER BY rca_id DESC LIMIT 1) k ON TRUE
            """, ct);
    }

    private async Task<ControleLu?> DernierControleAsync(Utilisateur u, int chantier, CancellationToken ct) =>
        (await db.Database.SqlQuery<ControleLu>($"""
            SELECT r.rco_id AS id, r.rco_rca_id AS calcul_id, r.rco_par AS par, r.rco_le AS le,
                   f_rentabilite_changements(r.rco_cha_id, r.rco_rca_id) AS changements
            FROM rentabilite_controle r WHERE r.rco_cha_id = {chantier} AND r.rco_par = {u.Code}
            ORDER BY r.rco_id DESC LIMIT 1
            """).ToListAsync(ct)).FirstOrDefault();

    /// <summary>
    /// Ce qui a changé depuis un calcul (par défaut le dernier contrôle de l'utilisateur) : faits ouverts depuis et encore
    /// ouverts, faits connus alors et clos depuis. PA / PR et types non consultables comme dans la page des faits.
    /// </summary>
    public async Task<ChangementsChantier> ChangementsAsync(IServiceProvider services, Utilisateur u, int chantier, long? calcul, CancellationToken ct)
    {
        var (c, p) = await AccesAsync(services, u, chantier, ct);
        DateTimeOffset? le = null;
        if (calcul is null)
        {
            var controle = await DernierControleAsync(u, chantier, ct) ?? throw ExceptionMetier.Introuvable("Contrôle");
            (calcul, le) = (controle.CalculId, controle.Le);
        }
        else le = (await db.Database.SqlQuery<DateTimeOffset?>($"SELECT rca_fin AS \"Value\" FROM rentabilite_calcul WHERE rca_id = {calcul} AND rca_cha_id = {chantier}")
            .ToListAsync(ct)).FirstOrDefault() ?? throw ExceptionMetier.Introuvable("Calcul");
        var faits = await db.Database.SqlQuery<FaitLu>($"""
            WITH c AS (
                SELECT f.*, f_rentabilite_signature(f) AS sig, (f.afa_calcul_debut > {calcul}) AS ajoute,
                       row_number() OVER (PARTITION BY f_rentabilite_signature(f), (f.afa_calcul_debut > {calcul}) ORDER BY f.afa_id) AS rang
                FROM rentabilite_fait f
                WHERE f.afa_cha_id = {chantier}
                  AND (f.afa_calcul_debut > {calcul} AND f.afa_calcul_fin IS NULL OR f.afa_calcul_debut <= {calcul} AND f.afa_calcul_fin > {calcul}))
            SELECT afa_id, afa_ordre_id, afa_mar_id, afa_indicateur, afa_composante, afa_date, afa_nat_id, afa_qte, afa_unite, afa_montant_pa, afa_montant_pr,
                   afa_montant_pv, afa_heures, afa_source_type, afa_type_piece, afa_ent_id, afa_lig_id, afa_source_id, afa_regle, afa_libelle, afa_calcul_debut
            FROM c
            -- un fait retiré puis rétabli à l'identique n'est pas un changement (paires de même signature écartées)
            WHERE NOT EXISTS (SELECT 1 FROM c o WHERE o.sig = c.sig AND o.ajoute <> c.ajoute AND o.rang = c.rang)
            ORDER BY afa_date, afa_ent_id, afa_lig_id, afa_id
            """).ToListAsync(ct);
        var visibles = faits.Where(x => x.AfaTypePiece is not { } t || !p.TypesMasques.Contains(t))
            .Select(x => p.VoirCouts ? x : x with { AfaMontantPa = null, AfaMontantPr = null }).ToList();
        var ajoutes = visibles.Where(x => x.AfaCalculDebut > calcul).ToList();
        var retires = visibles.Where(x => x.AfaCalculDebut <= calcul).ToList();
        var pieces = await spec.PiecesAsync(db, visibles.Where(x => x.AfaEntId is not null).Select(x => x.AfaEntId!.Value).Distinct().ToArray(), ct);
        var natures = await spec.NaturesAsync(db, ct);
        var utilisees = visibles.Where(x => x.AfaNatId is not null).Select(x => x.AfaNatId!.Value).ToHashSet();
        return new ChangementsChantier(c, calcul.Value, le, p.VoirCouts, ajoutes, retires, pieces, natures.Where(n => utilisees.Contains(n.Id)).ToList(),
            await spec.OrdresAsync(db, chantier, ct));
    }

    // ---------------------------------------------------------------- photos

    private Task<List<PhotoLue>> PhotosAsync(int chantier, CancellationToken ct) =>
        db.Database.SqlQuery<PhotoLue>($"""
            SELECT rph_id AS id, rph_date AS date, rph_rca_id AS calcul_id, rph_type AS type, rph_libelle AS libelle, rph_par AS par, rph_le AS le
            FROM rentabilite_photo WHERE rph_cha_id = {chantier} ORDER BY rph_date DESC, rph_id DESC
            """).ToListAsync(ct);

    /// <summary>Photo à la demande d'un chantier, à une date (aujourd'hui par défaut), au dernier calcul réussi.</summary>
    public async Task<PhotoLue> PhotographierAsync(IServiceProvider services, Utilisateur u, int chantier, DateOnly? date, string? libelle, CancellationToken ct)
    {
        await AccesAsync(services, u, chantier, ct);
        var jour = date ?? Aujourdhui;
        var id = (await db.Database.SqlQuery<long>($"""
            INSERT INTO rentabilite_photo (rph_cha_id, rph_date, rph_rca_id, rph_type, rph_libelle, rph_par)
            SELECT {chantier}, {jour}, k.rca_id, {TypePhoto.Manuel}, {libelle}, {u.Code}
            FROM (SELECT rca_id FROM rentabilite_calcul WHERE rca_cha_id = {chantier} AND rca_etat = {EtatCalcul.Ok} ORDER BY rca_id DESC LIMIT 1) k
            RETURNING rph_id AS "Value"
            """).ToListAsync(ct)).FirstOrDefault();
        if (id == 0) throw ExceptionMetier.Invalide("RENTABILITE_SANS_CALCUL", "Le chantier n'a encore jamais été calculé");
        return (await PhotosAsync(chantier, ct)).Single(x => x.Id == id);
    }

    /// <summary>Retire une photo prise à la demande (son auteur ou un administrateur ; les photos de fin de mois restent).</summary>
    public async Task SupprimerPhotoAsync(Utilisateur u, long photo, CancellationToken ct)
    {
        var n = await db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM rentabilite_photo WHERE rph_id = {photo} AND rph_type = {TypePhoto.Manuel} AND (rph_par = {u.Code} OR {u.EstAdmin})
            """, ct);
        if (n == 0) throw ExceptionMetier.Introuvable("Photo");
    }

    /// <summary>Photos de fin de mois des chantiers ouverts (une par chantier et par date) ; renvoie le nombre de photos prises.</summary>
    public async Task<int> PhotosMoisAsync(DateOnly finMois, CancellationToken ct)
    {
        var chantiers = (await spec.ChantiersOuvertsAsync(db, ct)).ToArray();
        return await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO rentabilite_photo (rph_cha_id, rph_date, rph_rca_id, rph_type)
            SELECT c, {finMois}, k.rca_id, {TypePhoto.Mois} FROM unnest({chantiers}) c
            JOIN LATERAL (SELECT rca_id FROM rentabilite_calcul WHERE rca_cha_id = c AND rca_etat = {EtatCalcul.Ok} ORDER BY rca_id DESC LIMIT 1) k ON TRUE
            ON CONFLICT DO NOTHING
            """, ct);
    }

    // ---------------------------------------------------------------- vues

    /// <summary>Vues de la Liste : globales et celles de l'utilisateur.</summary>
    public Task<List<VueRentabilite>> VuesAsync(Utilisateur u, CancellationToken ct) =>
        db.Database.SqlQuery<VueRentabilite>($"""
            SELECT rvu_id AS id, rvu_nom AS nom, rvu_proprietaire AS proprietaire, rvu_parametres AS parametres, rvu_defaut AS defaut
            FROM rentabilite_vue WHERE rvu_proprietaire IS NULL OR rvu_proprietaire = {u.Code}
            ORDER BY rvu_proprietaire NULLS FIRST, rvu_nom
            """).ToListAsync(ct);

    /// <summary>Crée ou modifie une vue (globale : administrateur) ; une vue par défaut retire ce rang aux autres vues de même portée.</summary>
    public async Task<VueRentabilite> EnregistrerVueAsync(Utilisateur u, VueSaisie v, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(v.Nom)) throw ExceptionMetier.Invalide("RENTABILITE_VUE_NOM", "Nom de la vue obligatoire");
        if (v.Globale) u.ExigerAdmin();
        var proprietaire = v.Globale ? null : u.Code;
        var json = v.Parametres.ValueKind == JsonValueKind.Undefined ? "{}" : v.Parametres.GetRawText();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (v.Id is { } id)
        {
            var existante = (await VuesAsync(u, ct)).FirstOrDefault(x => x.Id == id) ?? throw ExceptionMetier.Introuvable("Vue");
            if (existante.Proprietaire is null) u.ExigerAdmin();
        }
        if (v.Defaut)
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE rentabilite_vue SET rvu_defaut = FALSE WHERE rvu_proprietaire IS NOT DISTINCT FROM {proprietaire}", ct);
        var nouvel = v.Id is { } i
            ? (await db.Database.SqlQuery<int>($"""
                UPDATE rentabilite_vue SET rvu_nom = {v.Nom.Trim()}, rvu_proprietaire = {proprietaire}, rvu_parametres = {json}::jsonb, rvu_defaut = {v.Defaut},
                    rvu_maj_le = now()
                WHERE rvu_id = {i} RETURNING rvu_id AS "Value"
                """).ToListAsync(ct)).Single()
            : (await db.Database.SqlQuery<int>($"""
                INSERT INTO rentabilite_vue (rvu_nom, rvu_proprietaire, rvu_parametres, rvu_defaut) VALUES ({v.Nom.Trim()}, {proprietaire}, {json}::jsonb, {v.Defaut})
                RETURNING rvu_id AS "Value"
                """).ToListAsync(ct)).Single();
        await tx.CommitAsync(ct);
        return (await VuesAsync(u, ct)).Single(x => x.Id == nouvel);
    }

    public async Task SupprimerVueAsync(Utilisateur u, int id, CancellationToken ct)
    {
        var v = (await VuesAsync(u, ct)).FirstOrDefault(x => x.Id == id) ?? throw ExceptionMetier.Introuvable("Vue");
        if (v.Proprietaire is null) u.ExigerAdmin();
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM rentabilite_vue WHERE rvu_id = {id}", ct);
    }
}
