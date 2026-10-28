using System.Globalization;
using System.Text.Json;
using LogiBTP.Domaine;
using LogiBTP.Fiches;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>Fonction d'intervenant (db/162_intervenants.sql) : portée S structure, D document, T tous.</summary>
public sealed record FonctionIntervenant(string Code, string Libelle, string Portee, bool Unique, bool PaiementDirect, bool Actif);

/// <summary>Intervenant saisi (fiche ou document) : tiers et/ou contact de l'annuaire avec une fonction.</summary>
public sealed record IntervenantSaisi(string? Fonction, long? PerId, long? IndId, bool Principal, bool PaiementDirect, string? Commentaire);

/// <summary>
/// Intervenants (petit annuaire) des projets, affaires, chantiers et marchés : champ géré « intervenants » des fiches
/// (lu avec les noms de l'annuaire, enregistré en remplaçant la liste de l'objet). Contrôles répliqués de
/// controlerIntervenants (client/src/app/structure/structure.js, test client/test/structure.test.js).
/// </summary>
public static class Intervenants
{
    /// <summary>Colonne de rattachement par type de fiche (liste fermée : jamais de nom de colonne saisi).</summary>
    public static readonly IReadOnlyDictionary<string, string> Colonnes = new Dictionary<string, string>
    {
        [TypesFiche.Projet] = "itv_prj_id", [TypesFiche.Affaire] = "itv_aff_id", [TypesFiche.Chantier] = "itv_cha_id", [TypesFiche.Marche] = "itv_mar_id",
    };

    public static bool Gere(string type) => Colonnes.ContainsKey(type);

    private const string SelectFonctions = """
        SELECT coalesce(json_agg(json_build_object('code', fin_code, 'libelle', fin_libelle, 'portee', fin_portee, 'unique', fin_unique,
               'paiement_direct', fin_paiement_direct, 'actif', fin_actif) ORDER BY fin_ordre, fin_code), '[]')::text AS "Value" FROM fonction_intervenant
        """;

    public static async Task<List<FonctionIntervenant>> Fonctions(LogiBtpContext db, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>(SelectFonctions).FirstAsync(ct);
        return JsonSerializer.Deserialize<List<JsonElement>>(json)!.Select(f => new FonctionIntervenant(
            f.GetProperty("code").GetString()!, f.GetProperty("libelle").GetString()!, f.GetProperty("portee").GetString()!,
            f.GetProperty("unique").GetBoolean(), f.GetProperty("paiement_direct").GetBoolean(), f.GetProperty("actif").GetBoolean())).ToList();
    }

    /// <summary>Intervenants d'un objet de la structure, avec les noms du tiers et du contact (JSON).</summary>
    public static async Task<JsonElement> Lire(LogiBtpContext db, string type, long id, CancellationToken ct)
    {
        var sql = $"""
            SELECT coalesce(json_agg(json_build_object('fonction', i.itv_fin_code, 'per_id', i.itv_per_id, 'tiers', p.per_raison_sociale,
                   'ind_id', i.itv_ind_id, 'contact', nullif(trim(concat_ws(' ', d.ind_prenom, d.ind_nom)), ''), 'principal', i.itv_principal,
                   'paiement_direct', i.itv_paiement_direct, 'commentaire', i.itv_commentaire) ORDER BY i.itv_ordre, i.itv_id), '[]')::text AS "Value"
            FROM intervenant i LEFT JOIN personne p ON p.per_id = i.itv_per_id LEFT JOIN individu d ON d.ind_id = i.itv_ind_id
            WHERE i.{Colonnes[type]} = {"{0}"}
            """;
        var json = await db.Database.SqlQueryRaw<string>(sql, (int)id).FirstAsync(ct);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    public static List<IntervenantSaisi> Lus(JsonElement liste)
    {
        if (liste.ValueKind != JsonValueKind.Array) throw ExceptionMetier.Invalide("VALIDATION", "Intervenants : liste attendue");
        static string? Texte(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String && v.GetString()!.Trim() != "" ? v.GetString()!.Trim() : null;
        static long? Entier(JsonElement e, string k) => e.TryGetProperty(k, out var v)
            ? v.ValueKind == JsonValueKind.Number ? v.GetInt64() : v.ValueKind == JsonValueKind.String && long.TryParse(v.GetString(), out var n) ? n : null : null;
        static bool Vrai(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
        return liste.EnumerateArray().Select(e => new IntervenantSaisi(Texte(e, "fonction"), Entier(e, "per_id"), Entier(e, "ind_id"), Vrai(e, "principal"),
            Vrai(e, "paiement_direct"), Texte(e, "commentaire"))).ToList();
    }

    /// <summary>
    /// Contrôles : fonction connue, active et de la portée (S structure, D document) ; tiers ou contact ; une seule
    /// occurrence d'une fonction unique ; paiement direct réservé aux fonctions qui l'admettent (information seulement :
    /// montants et agréments relèveront de la gestion de la sous-traitance).
    /// </summary>
    public static List<string> Controler(IReadOnlyList<IntervenantSaisi> liste, IReadOnlyList<FonctionIntervenant> fonctions, char portee)
    {
        var erreurs = new List<string>();
        var vues = new Dictionary<string, int>();
        for (var i = 0; i < liste.Count; i++)
        {
            var x = liste[i];
            var n = i + 1;
            var f = fonctions.FirstOrDefault(y => y.Code == x.Fonction);
            if (f is null) { erreurs.Add($"Intervenant {n} : fonction inconnue"); continue; }
            if (f.Portee != "T" && f.Portee[0] != portee) erreurs.Add($"Intervenant {n} : fonction « {f.Libelle} » non proposée ici");
            if (x.PerId is null && x.IndId is null) erreurs.Add($"Intervenant {n} : tiers ou contact à choisir");
            vues[f.Code] = vues.GetValueOrDefault(f.Code) + 1;
            if (f.Unique && vues[f.Code] == 2) erreurs.Add($"Un seul intervenant « {f.Libelle} »");
            if (x.PaiementDirect && !f.PaiementDirect) erreurs.Add($"Intervenant {n} : paiement direct réservé aux sous-traitants");
        }
        return erreurs;
    }

    public static async Task Valider(LogiBtpContext db, IReadOnlyList<IntervenantSaisi> liste, char portee, CancellationToken ct)
    {
        var erreurs = Controler(liste, await Fonctions(db, ct), portee);
        if (erreurs.Count > 0)
        {
            throw ExceptionMetier.Invalide("VALIDATION", "Intervenants incorrects", erreurs.Select(m => new ErreurChamp("intervenants", "METIER", m)).ToList());
        }
    }

    /// <summary>Remplace les intervenants de l'objet par la liste saisie (ordre de saisie conservé).</summary>
    public static async Task Ecrire(LogiBtpContext db, string type, long id, IReadOnlyList<IntervenantSaisi> liste, CancellationToken ct)
    {
        static NpgsqlParameter P(string nom, NpgsqlDbType type, object? v) => new(nom, type) { Value = v ?? DBNull.Value };
        var deleteSql = type switch
        {
            TypesFiche.Projet => "DELETE FROM intervenant WHERE itv_prj_id = @id",
            TypesFiche.Affaire => "DELETE FROM intervenant WHERE itv_aff_id = @id",
            TypesFiche.Chantier => "DELETE FROM intervenant WHERE itv_cha_id = @id",
            TypesFiche.Marche => "DELETE FROM intervenant WHERE itv_mar_id = @id",
            _ => throw new ArgumentOutOfRangeException(nameof(type)),
        };
        await db.Database.ExecuteSqlRawAsync(deleteSql, [P("id", NpgsqlDbType.Integer, (int)id)], ct);
        var insertSql = type switch
        {
            TypesFiche.Projet => "INSERT INTO intervenant (itv_prj_id, itv_fin_code, itv_per_id, itv_ind_id, itv_principal, itv_paiement_direct, itv_commentaire, itv_ordre) VALUES (@objet, @fonction, @per, @ind, @principal, @pd, @commentaire, @ordre)",
            TypesFiche.Affaire => "INSERT INTO intervenant (itv_aff_id, itv_fin_code, itv_per_id, itv_ind_id, itv_principal, itv_paiement_direct, itv_commentaire, itv_ordre) VALUES (@objet, @fonction, @per, @ind, @principal, @pd, @commentaire, @ordre)",
            TypesFiche.Chantier => "INSERT INTO intervenant (itv_cha_id, itv_fin_code, itv_per_id, itv_ind_id, itv_principal, itv_paiement_direct, itv_commentaire, itv_ordre) VALUES (@objet, @fonction, @per, @ind, @principal, @pd, @commentaire, @ordre)",
            TypesFiche.Marche => "INSERT INTO intervenant (itv_mar_id, itv_fin_code, itv_per_id, itv_ind_id, itv_principal, itv_paiement_direct, itv_commentaire, itv_ordre) VALUES (@objet, @fonction, @per, @ind, @principal, @pd, @commentaire, @ordre)",
            _ => throw new ArgumentOutOfRangeException(nameof(type)),
        };
        var ordre = 0;
        foreach (var x in liste)
        {
            ordre++;
            await db.Database.ExecuteSqlRawAsync(insertSql, [P("objet", NpgsqlDbType.Integer, (int)id), P("fonction", NpgsqlDbType.Varchar, x.Fonction), P("per", NpgsqlDbType.Bigint, x.PerId),
                    P("ind", NpgsqlDbType.Bigint, x.IndId), P("principal", NpgsqlDbType.Boolean, x.Principal), P("pd", NpgsqlDbType.Boolean, x.PaiementDirect),
                    P("commentaire", NpgsqlDbType.Text, x.Commentaire),
                    P("ordre", NpgsqlDbType.Integer, ordre)], ct);
        }
    }
}
