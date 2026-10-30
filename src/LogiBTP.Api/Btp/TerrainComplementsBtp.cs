using System.Globalization;
using System.Text.RegularExpressions;
using LogiBTP.Crm;
using LogiBTP.Crm.Web;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

public sealed record LigneLivree(long LigId, decimal Qte);
public sealed record LivraisonTerrain(List<LigneLivree> Lignes, string? NumeroBl, string? Commentaire);
public sealed record MaterielTerrain(int MatId, DateOnly Date, int? Minutes, decimal? Heures, decimal? Kilometres, decimal? Litres, decimal? Cout, string? Commentaire);

/// <summary>
/// Application de terrain, lot 7 (ANALYSE-TERRAIN.md T18, T19) : réception de livraison simplifiée et pointage des
/// matériels depuis une tâche. Livraison : commandes fournisseur validées du chantier, reliquat ligne à ligne ; le
/// serveur crée le bon de livraison en brouillon (profil système BORNE, droit de la personne : terrain/livraison) et une
/// tâche du CRM au service Achat : le stock ne bouge qu'à la validation au bureau, le prix restant celui de la commande.
/// Matériel : heures d'utilisation (pointage_materiel), relevés de compteurs (source TERRAIN, mêmes contrôles que la
/// fiche) et plein de carburant ; matériels proposés : ceux de la tâche et ceux affectés à la personne.
/// </summary>
public static partial class TerrainBtp
{
    private const string EtapeReceptionLivraison = "RECEPTION";

    private sealed record CommandeLivrable(long EntId, string? Numero, string? Objet, string? Fournisseur);
    private sealed record MaterielTache(int Id, string Libelle, string? Compteurs, decimal? Heures, decimal? Kilometres);

    /// <summary>Chantier du planning de la personne à un mois près, sinon refus.</summary>
    private static async Task ExigerChantierPlanningAsync(LogiBtpContext db, int salarie, int chantier, CancellationToken ct)
    {
        if (!await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM pla_tache t JOIN pla_affectation a ON a.aff_tac_id = t.tac_id
                           WHERE a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text AND t.tac_type_element = 'chantier' AND t.tac_id_element = @c::text
                             AND t.tac_debut < current_date + 31 AND t.tac_fin > current_date - 31) AS "Value"
            """, new NpgsqlParameter("s", salarie), new NpgsqlParameter("c", chantier)).FirstAsync(ct))
            throw ExceptionMetier.Introuvable($"Chantier {chantier} de votre planning");
    }

    private static string SansBalises(string? html) => System.Net.WebUtility.HtmlDecode(Regex.Replace(html ?? "", "<[^>]+>", " ")).Trim();

    private static RouteGroupBuilder MapComplementsTerrain(this RouteGroupBuilder g)
    {
        // Commandes à recevoir d'un chantier de la personne, avec le reliquat de chaque ligne.
        g.MapGet("/livraisons", async (int chantier, HttpContext http, LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
            TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations, CancellationToken ct) =>
        {
            var s = await ComptesBtp.SalarieAsync(db, Utilisateur.Depuis(http).Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            await ExigerChantierPlanningAsync(db, s, chantier, ct);
            var commandes = await db.Database.SqlQueryRaw<CommandeLivrable>($"""
                SELECT d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, p.per_raison_sociale AS fournisseur
                FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document st ON st.std_id = d.ent_std_id
                LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
                WHERE t.tyd_code = 'A_COMMANDE' AND d.ent_chantier_id = @c AND d.ent_verrouille AND d.ent_is_reference AND st.std_code NOT IN ({SqlBtp.HorsVigueurOuSolde})
                ORDER BY d.ent_date DESC, d.ent_id DESC LIMIT 20
                """, new NpgsqlParameter("c", chantier)).ToListAsync(ct);
            var res = new List<object>();
            foreach (var c in commandes)
            {
                var suivi = await transformations.Suivi(await documents.Charger(c.EntId, ct), ct);
                var lignes = suivi.Select(l => new { lig_id = l.LigId, libelle = SansBalises(l.Libelle), qte = l.Qte,
                        reste = l.Etapes.FirstOrDefault(e => e.Etape == EtapeReceptionLivraison)?.Reliquat ?? 0 })
                    .Where(l => l.reste > 0).ToList();
                if (lignes.Count > 0) res.Add(new { ent_id = c.EntId, numero = c.Numero, objet = c.Objet, fournisseur = c.Fournisseur, lignes });
            }
            return new { commandes = res };
        });

        // Livraison reçue : bon de livraison brouillon, à contrôler et valider au bureau.
        g.MapPost("/livraisons/{ent:long}", async (long ent, LivraisonTerrain l, HttpContext http, LogiBtpContext db, IServiceProvider services,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            var chantier = await db.Database.SqlQueryRaw<int?>("SELECT ent_chantier_id AS \"Value\" FROM document WHERE ent_id = @e", new NpgsqlParameter("e", ent)).FirstOrDefaultAsync(ct)
                ?? throw ExceptionMetier.Introuvable($"Commande {ent}");
            await ExigerChantierPlanningAsync(db, s, chantier, ct);
            var lignes = (l.Lignes ?? []).Where(x => x.Qte > 0).Select(x => new LigneATransformer { LigId = x.LigId, Qte = x.Qte }).ToList();
            if (lignes.Count == 0) throw ExceptionMetier.Invalide("TERRAIN_LIVRAISON", "Au moins une quantité reçue");
            var systeme = new Utilisateur(u.Code, Profils.Borne);
            var cree = await transformations.Transformer(ent, new DemandeTransformation { CibleTydId = await TypesDocumentBtp.IdAsync(db, TypesDocument.AReception, ct), Lignes = lignes }, systeme, ct);
            var id = cree.Document.EntId;
            var bl = l.NumeroBl?.Trim();
            if (!string.IsNullOrEmpty(bl))
            {
                var d = await documents.Charger(id, ct);
                d.Document.EntReferenceExterne = bl;
                await documents.Enregistrer(id, d, systeme, ct);
            }
            var numero = await db.Database.SqlQueryRaw<string?>("SELECT ent_numero AS \"Value\" FROM document WHERE ent_id = @e", new NpgsqlParameter("e", id)).FirstAsync(ct);
            var avertissements = new List<string>();
            var srv = await db.Database.SqlQueryRaw<int?>("SELECT srv_id AS \"Value\" FROM service WHERE srv_code = 'ACHAT'").FirstOrDefaultAsync(ct);
            if (srv is int achat && await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.Crm, ct))
                await SuiteAsync(avertissements, "Tâche du bureau non créée", async () =>
                {
                    var groupe = await db.Database.SqlQueryRaw<long>("SELECT coalesce(ent_groupe_id, ent_id) AS \"Value\" FROM document WHERE ent_id = @e", new NpgsqlParameter("e", id)).FirstAsync(ct);
                    var texte = $"Livraison reçue sur le chantier : bon {numero ?? id.ToString(CultureInfo.InvariantCulture)} à contrôler et valider{(string.IsNullOrWhiteSpace(l.Commentaire) ? "" : $" ({l.Commentaire.Trim()})")}";
                    await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie(NatureNote.Tache, EtatNote.AFaire, null, achat, texte, null, null, DateTimeOffset.UtcNow.AddDays(2), null, false, false, false,
                        [new("document", groupe.ToString(CultureInfo.InvariantCulture), true), new(TypesFiche.Chantier, chantier.ToString(CultureInfo.InvariantCulture))], null), u, ct);
                });
            return new { ent_id = id, numero, avertissements };
        });

        // Matériels d'une tâche : affectés à la tâche ou à la personne ; compteurs suivis et dernières valeurs.
        g.MapGet("/taches/{id:long}/materiels", async (long id, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var (s, _) = await TacheAsync(db, Utilisateur.Depuis(http), id, ct);
            return await MaterielsTacheAsync(db, id, s, ct);
        });

        g.MapPost("/taches/{id:long}/materiel", async (long id, MaterielTerrain m, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var (s, t) = await TacheAsync(db, u, id, ct);
            if (!(await MaterielsTacheAsync(db, id, s, ct)).Any(x => x.Id == m.MatId)) throw ExceptionMetier.Introuvable($"Matériel {m.MatId} de cette tâche");
            if (m.Date > DateOnly.FromDateTime(DateTime.Today)) throw ExceptionMetier.Invalide("TERRAIN_DATE", "Pointage d'un jour à venir");
            if (m.Minutes is null or <= 0 && m.Heures is null && m.Kilometres is null && m.Litres is null) throw ExceptionMetier.Invalide("TERRAIN_MATERIEL", "Rien à enregistrer");
            var note = string.IsNullOrWhiteSpace(m.Commentaire) ? null : m.Commentaire.Trim();
            if (m.Heures is decimal h) await CompteursMateriel.AjouterReleveAsync(db, m.MatId, new ReleveSaisi(m.Date, "H", h, false, note), "TERRAIN", null, u.Code, ct);
            if (m.Kilometres is decimal km) await CompteursMateriel.AjouterReleveAsync(db, m.MatId, new ReleveSaisi(m.Date, "KM", km, false, note), "TERRAIN", null, u.Code, ct);
            if (m.Litres is not null)
                await CompteursMateriel.EnregistrerEvenementAsync(db, m.MatId, null, new EvenementSaisi("CARBURANT", m.Date, null, $"Plein : {t.Libelle}", note, m.Cout, m.Litres, null, null), u.Code, ct);
            if (m.Minutes is > 0)
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO pointage_materiel (pma_mat_id, pma_cha_id, pma_tac_id, pma_sal_id, pma_date, pma_minutes, pma_commentaire, pma_par)
                    VALUES (@m, @c, @t, @s, @d, @n, @x, @u)
                    """, [new NpgsqlParameter("m", m.MatId), new NpgsqlParameter("c", NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)t.ChaId ?? DBNull.Value }, new NpgsqlParameter("t", id),
                        new NpgsqlParameter("s", s), new NpgsqlParameter("d", m.Date), new NpgsqlParameter("n", m.Minutes.Value), SqlBtp.P("x", note), new NpgsqlParameter("u", u.Code)], ct);
            return Results.Ok(new { ok = true });
        });
        return g;
    }

    private static Task<List<MaterielTache>> MaterielsTacheAsync(LogiBtpContext db, long tache, int salarie, CancellationToken ct) =>
        db.Database.SqlQueryRaw<MaterielTache>("""
            SELECT m.mat_id AS id, r.libelle, m.mat_compteurs AS compteurs, m.mat_heures AS heures, m.mat_kilometres AS kilometres
            FROM materiel m JOIN v_ressource r ON r.type = 'MATERIEL' AND r.id = m.mat_id::text
            WHERE m.mat_id::text IN (SELECT a.aff_res_id FROM pla_affectation a WHERE a.aff_tac_id = @t AND a.aff_res_type = 'MATERIEL')
               OR m.mat_id IN (SELECT f.maf_mat_id FROM materiel_affectation f WHERE f.maf_type IN ('SALARIE', 'INTERIM') AND f.maf_ressource = @s::text
                               AND f.maf_du <= current_date AND (f.maf_au IS NULL OR f.maf_au >= current_date))
            ORDER BY r.libelle
            """, new NpgsqlParameter("t", tache), new NpgsqlParameter("s", salarie)).ToListAsync(ct);
}
