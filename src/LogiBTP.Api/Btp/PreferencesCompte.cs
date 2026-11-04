using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Préférences du compte connecté gardées en base (db/264, table <c>preference_compte</c>) : réglages qui suivent
/// l'utilisateur d'un poste à l'autre, à la différence des préférences d'affichage du navigateur. Première clé :
/// « accueil » (raccourcis et widgets de la page d'accueil). Chacun ne lit et n'écrit que les siennes (route de session,
/// sans nœud de droits) ; la valeur est un objet JSON d'au plus <see cref="TailleMax"/> caractères.
/// </summary>
public static partial class PreferencesCompte
{
    /// <summary>Taille maximale d'une valeur (JSON sérialisé).</summary>
    public const int TailleMax = 64 * 1024;

    [GeneratedRegex("^[a-z0-9_.-]{1,60}$")]
    private static partial Regex CleValide();

    private static string Compte(HttpContext http) => Utilisateur.Depuis(http).Code.ToLowerInvariant();

    private static string Cle(string cle) =>
        CleValide().IsMatch(cle) ? cle : throw ExceptionMetier.Invalide("PREFERENCE_CLE", "Clé de préférence invalide (minuscules, chiffres, « _ . - », 60 caractères au plus).");

    public static IEndpointRouteBuilder MapPreferencesCompte(this IEndpointRouteBuilder api)
    {
        // Valeur enregistrée, ou null si le compte n'a encore rien enregistré pour cette clé.
        api.MapGet("/preferences/{cle}", async (string cle, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var json = await db.Database.SqlQueryRaw<string?>(
                "SELECT prc_valeur::text AS \"Value\" FROM preference_compte WHERE prc_compte = @c AND prc_cle = @k",
                new NpgsqlParameter("c", Compte(http)), new NpgsqlParameter("k", Cle(cle))).FirstOrDefaultAsync(ct);
            return Results.Content(json ?? "null", "application/json");
        });

        // Remplace la valeur de la clé (objet JSON).
        api.MapPut("/preferences/{cle}", async (string cle, JsonElement valeur, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            Cle(cle);
            if (valeur.ValueKind != JsonValueKind.Object)
                throw ExceptionMetier.Invalide("PREFERENCE_VALEUR", "La préférence doit être un objet JSON.");
            var texte = valeur.GetRawText();
            if (texte.Length > TailleMax)
                throw ExceptionMetier.Invalide("PREFERENCE_TAILLE", $"Préférence trop volumineuse ({texte.Length} caractères, {TailleMax} au plus).");
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO preference_compte (prc_compte, prc_cle, prc_valeur) VALUES (@c, @k, @v)
                ON CONFLICT (prc_compte, prc_cle) DO UPDATE SET prc_valeur = EXCLUDED.prc_valeur, prc_maj_le = now()
                """, [new NpgsqlParameter("c", Compte(http)), new NpgsqlParameter("k", cle), new NpgsqlParameter("v", NpgsqlDbType.Jsonb) { Value = texte }], ct);
            return Results.NoContent();
        });
        return api;
    }
}
