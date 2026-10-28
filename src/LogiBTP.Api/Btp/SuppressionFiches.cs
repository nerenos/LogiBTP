using LogiBTP.Domaine;
using LogiBTP.Fiches;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Contrôles métier avant la suppression d'une fiche du cœur (SpecialisationFicheBtp.AvantSuppressionAsync) : les
/// références sans clé étrangère (tiers d'un document, élément d'une ligne ou d'une composition, règlements…) et celles
/// qu'une clé en cascade effacerait sans le dire (intervenants de la structure) refusent la suppression (409
/// FICHE_UTILISEE, avec les usages trouvés) ; notre société et un individu titulaire d'un compte utilisateur sont
/// protégés (409 FICHE_PROTEGEE). Les autres usages sont arrêtés par les clés étrangères (ServiceFiche.Supprimer).
/// </summary>
public static class SuppressionFiches
{
    private sealed record Usage(string Libelle, string Sql, string? Table = null);

    private static readonly Dictionary<string, Usage[]> Usages = new()
    {
        [TypesFiche.Personne] =
        [
            new("document(s) dont elle est le tiers", "SELECT count(*)::int AS \"Value\" FROM document WHERE ent_tiers_id = @id"),
            new("intervention(s) dans les projets, affaires, chantiers ou marchés", "SELECT count(*)::int AS \"Value\" FROM intervenant WHERE itv_per_id = @id"),
            new("poste(s) de pied de marché", "SELECT count(*)::int AS \"Value\" FROM marche_poste WHERE mpo_per_id = @id"),
            new("règlement(s)", "SELECT count(*)::int AS \"Value\" FROM reglement WHERE reg_tiers_id = @id", "reglement"),
            new("caution(s)", "SELECT count(*)::int AS \"Value\" FROM caution WHERE cau_tiers_id = @id", "caution"),
        ],
        [TypesFiche.Individu] =
        [
            new("intervention(s) dans les projets, affaires, chantiers ou marchés", "SELECT count(*)::int AS \"Value\" FROM intervenant WHERE itv_ind_id = @id"),
        ],
        [TypesFiche.Element] =
        [
            new("ligne(s) de document", "SELECT count(*)::int AS \"Value\" FROM document_ligne WHERE lig_art_id = @id"),
            new("composition(s) d'autres éléments", """
                SELECT count(*)::int AS "Value" FROM element WHERE ele_id <> @id AND jsonb_path_exists(coalesce(ele_composition, '{}'),
                    '$.lignes[*] ? (@.lig_art_id == $id || @.lig_proprietes.element.id == $id)', jsonb_build_object('id', @id))
                """),
        ],
    };

    private static readonly Dictionary<string, (string Sql, string Message)> Protections = new()
    {
        [TypesFiche.Personne] = ("SELECT count(*)::int AS \"Value\" FROM personne WHERE per_id = @id AND per_societe_base",
            "Fiche de notre société : suppression impossible"),
        [TypesFiche.Individu] = ("SELECT count(*)::int AS \"Value\" FROM individu WHERE ind_id = @id AND ind_utilisateur IS NOT NULL",
            "Individu titulaire d'un compte utilisateur : suppression impossible"),
    };

    public static async Task Controler(LogiBtpContext db, string type, string id, CancellationToken ct)
    {
        if (!Usages.ContainsKey(type) && !Protections.ContainsKey(type)) return;
        if (!long.TryParse(id, out var n)) throw ExceptionMetier.Introuvable($"Fiche {type} {id}");
        if (Protections.TryGetValue(type, out var p) && await Compter(db, p.Sql, n, ct) > 0)
            throw ExceptionMetier.Conflit("FICHE_PROTEGEE", p.Message);
        var trouves = new List<string>();
        foreach (var u in Usages.GetValueOrDefault(type, []))
        {
            // Table d'un module facultatif (Règlements) : absente, rien à contrôler.
            if (u.Table is not null && await db.Database.SqlQuery<string?>($"SELECT to_regclass({u.Table})::text AS \"Value\"").FirstAsync(ct) is null) continue;
            var nb = await Compter(db, u.Sql, n, ct);
            if (nb > 0) trouves.Add($"{nb} {u.Libelle}");
        }
        if (trouves.Count > 0)
            throw ExceptionMetier.Conflit(ErreursFiche.FicheUtilisee, $"Cet élément est utilisé ({string.Join(", ", trouves)}) : suppression impossible", trouves);
    }

    private static Task<int> Compter(LogiBtpContext db, string sql, long id, CancellationToken ct) =>
        db.Database.SqlQueryRaw<int>(sql, new Npgsql.NpgsqlParameter("id", id)).FirstAsync(ct);
}
