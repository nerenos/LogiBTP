using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Socle.Donnees;

/// <summary>
/// Refus de la base traduits une seule fois pour tout le serveur (codes <see cref="LogiBTP.Socle.ErreursEnregistrement"/>) :
/// unicité (23505) → 409 DOUBLON, clé étrangère (23503) → 409 UTILISE, NOT NULL / CHECK / conversion / trop long
/// (23502, 23514, 22P02, 22001, 22003, 22007, 22008) et refus d'un trigger (P0001) → 422 VALEUR. Le reste n'est pas
/// traduit (erreur technique, 500).
/// </summary>
public static class ErreursBase
{
    public static ExceptionMetier? Traduire(Exception e) => e switch
    {
        ExceptionMetier m => m,
        PostgresException p => Traduire(p),
        DbUpdateException { InnerException: PostgresException p } => Traduire(p),
        _ => null,
    };

    public static ExceptionMetier? Traduire(PostgresException e) => e.SqlState switch
    {
        PostgresErrorCodes.UniqueViolation => ExceptionMetier.Conflit(LogiBTP.Socle.ErreursEnregistrement.Doublon, "Cette valeur existe déjà (doublon)",
            new { contrainte = e.ConstraintName }),
        PostgresErrorCodes.ForeignKeyViolation => ExceptionMetier.Conflit(LogiBTP.Socle.ErreursEnregistrement.Utilise,
            e.MessageText.Contains("is still referenced", StringComparison.Ordinal) || e.Detail?.Contains("is still referenced", StringComparison.Ordinal) == true
                ? "Cet élément est utilisé ailleurs"
                : "Élément lié introuvable", new { contrainte = e.ConstraintName }),
        PostgresErrorCodes.NotNullViolation => ExceptionMetier.Invalide(LogiBTP.Socle.ErreursEnregistrement.Valeur, "Valeur obligatoire manquante",
            new[] { new { champ = e.ColumnName ?? "", code = LogiBTP.Socle.ErreursEnregistrement.Obligatoire, message = "Valeur obligatoire" } }),
        PostgresErrorCodes.CheckViolation or PostgresErrorCodes.InvalidTextRepresentation or PostgresErrorCodes.StringDataRightTruncation
            or PostgresErrorCodes.NumericValueOutOfRange or PostgresErrorCodes.DatetimeFieldOverflow or PostgresErrorCodes.InvalidDatetimeFormat
            => ExceptionMetier.Invalide(LogiBTP.Socle.ErreursEnregistrement.Valeur, $"Valeur refusée par la base : {e.MessageText}",
                new { contrainte = e.ConstraintName, colonne = e.ColumnName }),
        PostgresErrorCodes.RaiseException => ExceptionMetier.Invalide(LogiBTP.Socle.ErreursEnregistrement.Valeur, e.MessageText),
        _ => null,
    };

    /// <summary>
    /// Traduit les refus de la base levés par une route (à placer après <c>UseErreursMetier</c>, qui les renvoie au client).
    /// </summary>
    public static IApplicationBuilder UseErreursBase(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        try
        {
            await next(http);
        }
        catch (Exception e) when (e is PostgresException or DbUpdateException && Traduire(e) is not null)
        {
            throw Traduire(e)!;
        }
    });
}
