using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>Valeur d'une liste paramétrable : code, libellé, code parent (deux niveaux), couleur, ordre, actif.</summary>
public sealed record ValeurListe(string Code, string Libelle, string? Parent, string? Couleur, int Ordre, bool Actif);

/// <summary>
/// Listes de valeurs paramétrables du cœur (db/227, table liste_valeur) : types de matériel, activités des personnes,
/// priorités et évaluations des projets. Lecture : toute session ; écriture : administrateur, liste complète ; une
/// valeur retirée encore employée (<see cref="Usages"/>) est désactivée, sinon supprimée.
/// </summary>
public static class ListesValeurs
{
    /// <summary>Listes connues : libellé, deux niveaux ou non.</summary>
    public static readonly IReadOnlyDictionary<string, (string Libelle, bool Hierarchie)> Listes = new Dictionary<string, (string, bool)>
    {
        ["TYPE_MATERIEL"] = ("Types de matériel", true),
        ["ACTIVITE"] = ("Activités des personnes", true),
        ["PRIORITE_PROJET"] = ("Priorités des projets", false),
        ["EVALUATION_PROJET"] = ("Évaluations des projets", false),
        ["ENERGIE"] = ("Énergies du matériel", false),
        ["ETAT_MATERIEL"] = ("Conditions du matériel", false),
    };

    /// <summary>Requête qui dit si un code est employé (paramètre @c), par liste ; absente : jamais employé.</summary>
    private static readonly Dictionary<string, string> Usages = new()
    {
        ["TYPE_MATERIEL"] = "SELECT EXISTS (SELECT 1 FROM materiel WHERE mat_famille = @c) AS \"Value\"",
        ["ENERGIE"] = "SELECT EXISTS (SELECT 1 FROM materiel WHERE mat_energie = @c) AS \"Value\"",
        ["ETAT_MATERIEL"] = "SELECT EXISTS (SELECT 1 FROM materiel WHERE mat_condition = @c) OR EXISTS (SELECT 1 FROM materiel_etat WHERE met_condition = @c) AS \"Value\"",
    };

    private sealed record LigneValeur(string Code, string Libelle, string? Parent, string? Couleur, int Ordre, bool Actif);

    public static async Task<List<ValeurListe>> LireAsync(LogiBtpContext db, string liste, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LigneValeur>("""
            SELECT lva_code AS code, lva_libelle AS libelle, lva_parent AS parent, lva_couleur AS couleur, lva_ordre AS ordre, lva_actif AS actif
            FROM liste_valeur WHERE lva_liste = @l ORDER BY lva_ordre, lva_code
            """, new NpgsqlParameter("l", liste)).ToListAsync(ct))
        .Select(v => new ValeurListe(v.Code, v.Libelle, v.Parent, v.Couleur, v.Ordre, v.Actif)).ToList();

    public static async Task<List<ValeurListe>> EnregistrerAsync(LogiBtpContext db, string liste, List<ValeurListe> valeurs, Utilisateur u, CancellationToken ct)
    {
        u.ExigerParametres();
        if (!Listes.TryGetValue(liste, out var def)) throw ExceptionMetier.Introuvable($"Liste {liste}");
        Controler(def.Hierarchie, valeurs).Lever();
        var codes = valeurs.Select(v => v.Code.Trim()).ToHashSet();

        await using var tx = await db.Unite().CommencerAsync(ct);
        var avant = await LireAsync(db, liste, ct);
        foreach (var v in avant.Where(a => !codes.Contains(a.Code)))
        {
            var employee = Usages.TryGetValue(liste, out var sql)
                && await db.Database.SqlQueryRaw<bool>(sql, new NpgsqlParameter("c", v.Code)).FirstAsync(ct);
            await db.Database.ExecuteSqlRawAsync(employee
                ? "UPDATE liste_valeur SET lva_actif = FALSE, lva_parent = NULL WHERE lva_liste = @l AND lva_code = @c"
                : "DELETE FROM liste_valeur WHERE lva_liste = @l AND lva_code = @c",
                [new NpgsqlParameter("l", liste), new NpgsqlParameter("c", v.Code)], ct);
        }
        foreach (var v in valeurs)
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO liste_valeur (lva_liste, lva_code, lva_libelle, lva_parent, lva_couleur, lva_ordre, lva_actif)
                VALUES (@l, @c, @lib, @p, @coul, @o, @a)
                ON CONFLICT (lva_liste, lva_code) DO UPDATE SET lva_libelle = EXCLUDED.lva_libelle, lva_parent = EXCLUDED.lva_parent,
                    lva_couleur = EXCLUDED.lva_couleur, lva_ordre = EXCLUDED.lva_ordre, lva_actif = EXCLUDED.lva_actif
                """,
                [new NpgsqlParameter("l", liste), new NpgsqlParameter("c", v.Code.Trim()), new NpgsqlParameter("lib", v.Libelle.Trim()),
                 SqlBtp.P("p", v.Parent), SqlBtp.P("coul", v.Couleur),
                 new NpgsqlParameter("o", v.Ordre), new NpgsqlParameter("a", v.Actif)], ct);
        }
        await tx.CommitAsync(ct);
        return await LireAsync(db, liste, ct);
    }

    /// <summary>
    /// Contrôles d'une liste saisie (format commun : 422 VALIDATION, champ « rang.champ ») : code (30) et libellé (100)
    /// obligatoires, couleur (9), codes uniques, regroupement connu de la liste, deux niveaux au plus.
    /// </summary>
    public static Controles Controler(bool hierarchie, IReadOnlyList<ValeurListe> valeurs)
    {
        var parCode = valeurs.Where(v => !string.IsNullOrWhiteSpace(v.Code)).GroupBy(v => v.Code.Trim()).ToDictionary(g => g.Key, g => g.First());
        return new Controles()
            .Uniques(valeurs, v => v.Code, "code", "Code")
            .Lignes(valeurs, (c, v) => c
                .Obligatoire("code", v.Code, "Code").Longueur("code", v.Code?.Trim(), 30, "Code")
                .Obligatoire("libelle", v.Libelle, "Libellé").Longueur("libelle", v.Libelle?.Trim(), 100, "Libellé")
                .Longueur("couleur", v.Couleur, 9, "Couleur")
                .Si(v.Parent is not null && (!hierarchie || !parCode.TryGetValue(v.Parent, out var p) || v.Parent == v.Code?.Trim() || p.Parent is not null),
                    "parent", ErreursEnregistrement.Inconnu, $"Regroupement {v.Parent} inconnu ou lui-même rangé (deux niveaux au plus)"));
    }

    public static IEndpointRouteBuilder MapListesValeurs(this IEndpointRouteBuilder api)
    {
        api.MapGet("/listes-valeurs", () => Listes.Select(l => new { code = l.Key, libelle = l.Value.Libelle, hierarchie = l.Value.Hierarchie }));
        api.MapGet("/listes-valeurs/{liste}", (string liste, LogiBtpContext db, CancellationToken ct) => LireAsync(db, liste, ct));
        api.MapPut("/listes-valeurs/{liste}", (string liste, List<ValeurListe> v, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            EnregistrerAsync(db, liste, v, Utilisateur.Depuis(http), ct));
        return api;
    }
}
