using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

public sealed record SousTraitantChoix(long Id, string Libelle);
public sealed record DemandeSousTraiter(string Cible, List<long>? Lignes, List<long>? SousTraitants);

/// <summary>
/// Sous-traitance, lot 5 (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.1, ST30) : comparatif des offres d'un lot de consultation
/// (lignes de prix rapprochées par code, sinon par libellé), assistant « Sous-traiter » (lignes d'une commande ou d'un
/// devis client transformées en appel d'offres pour un ou plusieurs sous-traitants — un document du lot chacun — ou en
/// commande de sous-traitance), engagé et réalisé de la sous-traitance d'un marché de vente (commandes validées,
/// factures validées, paiement direct) comparés au déboursé de sous-traitance prévu.
/// </summary>
public static class SousTraitanceAssistant
{
    private static readonly string[] Sources = ["V_COMMANDE", "V_DEVIS", "E_OST", "E_DAC"];

    // Lignes de prix d'un document (éléments et ouvrages, hors composantes d'un ouvrage) ; clé de rapprochement.
    private const string SqlLignes = """
        WITH RECURSIVE arbre AS (
            SELECT l.lig_id, ARRAY[l.lig_ordre] AS chemin FROM document_ligne l WHERE l.lig_ent_id = ANY(@ids) AND l.lig_parent_id IS NULL
            UNION ALL
            SELECT l.lig_id, a.chemin || l.lig_ordre FROM document_ligne l JOIN arbre a ON l.lig_parent_id = a.lig_id)
        SELECT l.lig_ent_id AS ent_id, l.lig_id, (row_number() OVER (PARTITION BY l.lig_ent_id ORDER BY a.chemin))::int AS lig_ordre, nullif(l.lig_code, '') AS code,
               trim(regexp_replace(regexp_replace(coalesce(l.lig_libelle_html, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')) AS libelle,
               coalesce(l.lig_qte_vendue, l.lig_qte, 0) AS qte, coalesce(l.lig_montant_ht, 0) AS montant
        FROM document_ligne l JOIN arbre a ON a.lig_id = l.lig_id LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
        WHERE l.lig_tyl_id IN (2, 3) AND coalesce(p.lig_tyl_id, 0) <> 2
        """;

    private sealed record LigneOffre(long EntId, long LigId, int LigOrdre, string? Code, string Libelle, decimal Qte, decimal Montant);
    private sealed record DocumentOffre(long Id, string? Numero, string? Tiers, decimal TotalHt, string Statut, bool Valide, string TypeCode, bool Terminal);

    /// <summary>Comparatif des offres du lot : une rangée par ligne rapprochée, une offre par document (quantité, PU, montant), totaux.</summary>
    public static async Task<object> ComparatifAsync(LogiBtpContext db, long id, CancellationToken ct)
    {
        var code = await db.Database.SqlQueryRaw<string?>("SELECT ent_consultation AS \"Value\" FROM document WHERE ent_id = @id", new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Invalide("CONSULTATION_VIDE", "Pas encore de lot de consultation pour ce document");
        var docs = await db.Database.SqlQueryRaw<DocumentOffre>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, p.per_raison_sociale AS tiers, coalesce(d.ent_total_ht, 0) AS total_ht, s.std_libelle AS statut, d.ent_verrouille AS valide,
                   t.tyd_code AS type_code, s.std_terminal AS terminal
            FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
            WHERE d.ent_consultation = @c AND d.ent_is_reference AND s.std_code NOT IN ('REMPLACE', 'ANNULE')
            ORDER BY d.ent_id
            """, new NpgsqlParameter("c", code)).ToListAsync(ct);
        var lignes = await db.Database.SqlQueryRaw<LigneOffre>(SqlLignes,
            new NpgsqlParameter("ids", docs.Select(d => d.Id).ToArray())).ToListAsync(ct);
        string Cle(LigneOffre l) => l.Code is { } c ? $"c:{c.ToLowerInvariant()}" : $"l:{l.Libelle.ToLowerInvariant()}";
        // Ordre des rangées : celui du premier document qui porte la ligne.
        var rangees = lignes.GroupBy(Cle).Select(g => new
        {
            cle = g.Key, code = g.First().Code, libelle = g.First().Libelle,
            ordre = docs.FindIndex(d => d.Id == g.First().EntId) * 100000 + g.First().LigOrdre,
            offres = g.GroupBy(l => l.EntId).ToDictionary(x => x.Key.ToString(), x =>
            {
                var q = x.Sum(l => l.Qte);
                var m = x.Sum(l => l.Montant);
                return new { qte = q, pu = q == 0 ? (decimal?)null : Math.Round(m / q, 4, MidpointRounding.AwayFromZero), montant = m };
            }),
        }).OrderBy(r => r.ordre).ToList();
        return new { code, documents = docs, lignes = rangees };
    }

    /// <summary>
    /// Sous-traiter : lignes choisies (vide : tout le reliquat) d'une commande ou d'un devis client transformées en appel
    /// d'offres (un document par sous-traitant, même lot de consultation) ou en commande de sous-traitance (un seul
    /// sous-traitant) ; le sous-traitant devient le tiers du document créé.
    /// </summary>
    public static async Task<object> SousTraiterAsync(LogiBtpContext db, TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations,
        DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, long id, DemandeSousTraiter d, Utilisateur u, CancellationToken ct)
    {
        if (d.Cible is not ("T_AO" or "T_COMMANDE")) throw ExceptionMetier.Invalide("ST_CIBLE", "Appel d'offres ou commande de sous-traitance");
        var sources = await db.Database.SqlQueryRaw<string>("""
            SELECT t.tyd_code AS "Value" FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @id
            """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        if (!Sources.Contains(sources)) throw ExceptionMetier.Invalide("ST_SOURCE", "Seuls une commande ou un devis client, un ordre de sous-traitance se sous-traitent");
        var sts = (d.SousTraitants ?? []).Distinct().ToList();
        if (d.Cible == "T_COMMANDE" && sts.Count > 1) throw ExceptionMetier.Invalide("ST_UN_SEUL", "Une commande de sous-traitance est passée à un seul sous-traitant");
        var tyd = await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == d.Cible).Select(t => t.TydId).FirstAsync(ct);
        // Sélection développée : titres et sections donnent leurs lignes de prix (éléments, ouvrages hors composantes).
        var lignes = d.Lignes is { Count: > 0 } choisies
            ? await db.Database.SqlQueryRaw<long>("""
                WITH RECURSIVE sel AS (
                    SELECT lig_id FROM document_ligne WHERE lig_ent_id = @id AND lig_id = ANY(@l)
                    UNION
                    SELECT l.lig_id FROM document_ligne l JOIN sel s ON l.lig_parent_id = s.lig_id)
                SELECT l.lig_id AS "Value" FROM document_ligne l JOIN sel s ON s.lig_id = l.lig_id LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
                WHERE l.lig_tyl_id IN (2, 3) AND coalesce(p.lig_tyl_id, 0) <> 2
                """, new NpgsqlParameter("id", id), new NpgsqlParameter("l", choisies.ToArray())).ToListAsync(ct)
            : [];
        if (d.Lignes is { Count: > 0 } && lignes.Count == 0) throw ExceptionMetier.Invalide("ST_LIGNES", "Aucune ligne de prix dans la sélection");
        var demande = new DemandeTransformation { CibleTydId = tyd, Lignes = lignes.Select(l => new LigneATransformer { LigId = l }).ToList() };
        var cree = await transformations.Transformer(id, demande, u, ct);
        var ids = new List<long> { cree.Document.EntId };
        if (d.Cible == "T_AO")
        {
            for (var i = 1; i < sts.Count; i++)
            {
                ids.Add((await Consultations.CopierAsync(db, documents, ids[0], u, ct)).Id);
            }
        }
        for (var i = 0; i < Math.Min(ids.Count, sts.Count); i++)
        {
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE document SET ent_tiers_id = @p, ent_intervenants = NULL, ent_contact_client = NULL, ent_contact_payeur = NULL
                WHERE ent_id = @id AND NOT ent_verrouille
                """, [new NpgsqlParameter("p", sts[i]), new NpgsqlParameter("id", ids[i])], ct);
        }
        return new { documents = ids };
    }

    private sealed record LigneEngage(int MarcheId, string Code, string? Libelle, string? SousTraitant, string? Garantie, decimal? MontantAgree,
        decimal Engage, decimal Facture, decimal PaiementDirect);

    /// <summary>
    /// Engagé et réalisé de la sous-traitance d'un marché de vente (ST30) : marchés de sous-traitance liés (ou du même
    /// chantier sans marché de vente) avec leurs commandes validées (engagé), factures et avoirs validés non annulés
    /// (réalisé), paiement direct accepté ; déboursé de sous-traitance prévu = lignes de nature ST des commandes du marché.
    /// </summary>
    public static async Task<object> EngageAsync(LogiBtpContext db, int marche, CancellationToken ct)
    {
        var lignes = await db.Database.SqlQueryRaw<LigneEngage>("""
            SELECT m.mar_id AS marche_id, m.mar_code AS code, m.mar_libelle AS libelle, p.per_raison_sociale AS sous_traitant, m.mar_garantie AS garantie,
                   m.mar_montant_agree AS montant_agree,
                   coalesce((SELECT sum(c.ent_total_ht) FROM marche_document x JOIN document c ON c.ent_id = x.mdo_ent_id WHERE x.mdo_mar_id = m.mar_id AND c.ent_verrouille), 0) AS engage,
                   coalesce((SELECT sum(CASE WHEN f.ent_nature_avoir IS NULL THEN 1 ELSE -1 END * abs(f.ent_total_ht))
                             FROM document f JOIN type_document t ON t.tyd_id = f.ent_tyd_id JOIN statut_document s ON s.std_id = f.ent_std_id
                             WHERE f.ent_marche_id = m.mar_id AND t.tyd_code IN ('T_FACTURE_AVT', 'T_AVOIR') AND f.ent_verrouille AND s.std_code <> 'ANNULE'), 0) AS facture,
                   coalesce((SELECT sum(z.spd_montant_accepte) FROM stt_paiement_direct z
                             WHERE z.spd_marche_id = m.mar_id AND z.spd_etat IN ('ACCEPTEE', 'PARTIELLE', 'TRANSMISE', 'PAYEE')), 0) AS paiement_direct
            FROM marche m LEFT JOIN personne p ON p.per_id = m.mar_tiers_id
            WHERE m.mar_sens = 'ST' AND (m.mar_marche_vente_id = @id
               OR (m.mar_marche_vente_id IS NULL AND m.mar_cha_id = (SELECT mar_cha_id FROM marche WHERE mar_id = @id)))
            ORDER BY m.mar_code
            """, new NpgsqlParameter("id", marche)).ToListAsync(ct);
        var prevu = await db.Database.SqlQueryRaw<decimal>("""
            SELECT coalesce(sum(coalesce(l.lig_pr, 0) * coalesce(l.lig_qte_totale, l.lig_qte_vendue, 0)), 0) AS "Value"
            FROM marche_document x JOIN document c ON c.ent_id = x.mdo_ent_id AND c.ent_verrouille
            JOIN document_ligne l ON l.lig_ent_id = c.ent_id JOIN nature_element n ON n.nat_id = l.lig_nat_id
            WHERE x.mdo_mar_id = @id AND n.nat_code = 'ST' AND NOT EXISTS (SELECT 1 FROM document_ligne e WHERE e.lig_parent_id = l.lig_id)
            """, new NpgsqlParameter("id", marche)).FirstAsync(ct);
        return new { prevu, engage = lignes.Sum(l => l.Engage), facture = lignes.Sum(l => l.Facture), marches = lignes };
    }

    /// <summary>Comparatif (tout lot de consultation, achats compris) ; assistant et engagé : module Sous-traitance actif.</summary>
    public static RouteGroupBuilder MapSousTraitanceAssistant(this RouteGroupBuilder api)
    {
        api.MapGet("/structure/documents/{id:long}/consultation/comparatif", (long id, LogiBtpContext db, CancellationToken ct) => ComparatifAsync(db, id, ct));
        var st = api.MapGroup("").ExigeModule("sous_traitance", "Sous-traitance");
        st.MapPost("/structure/documents/{id:long}/sous-traiter", (long id, DemandeSousTraiter d, HttpContext http, LogiBtpContext db,
            TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
            CancellationToken ct) => SousTraiterAsync(db, transformations, documents, id, d, Utilisateur.Depuis(http), ct));
        // Sous-traitants de l'annuaire (relation SOUS_TRAITANT), pour l'assistant.
        st.MapGet("/structure/sous-traitants", async (LogiBtpContext db, CancellationToken ct) => await db.Database.SqlQueryRaw<SousTraitantChoix>("""
            SELECT per_id AS id, per_raison_sociale AS libelle FROM personne WHERE per_casquettes ? 'SOUS_TRAITANT' AND per_actif AND per_raison_sociale IS NOT NULL ORDER BY per_raison_sociale
            """).ToListAsync(ct));
        st.MapGet("/structure/marches/{id:int}/sous-traitance", (int id, LogiBtpContext db, CancellationToken ct) => EngageAsync(db, id, ct));
        return api;
    }
}
