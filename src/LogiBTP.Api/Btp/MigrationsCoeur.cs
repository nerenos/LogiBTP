using LogiBTP.Installation;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Migrations de code figées du cœur et des modules (module Installation, <see cref="IMigrationCode"/>) : reprises de données
/// impossibles en SQL, jouées par l'installeur à leur place dans le plan. Vide : toutes les mineures sont des scripts SQL.
/// Règle « figée » : documentation/MIGRATIONS.md.
/// </summary>
public static class MigrationsCoeur
{
    public static readonly IReadOnlyList<IMigrationCode> Liste = [];
}
