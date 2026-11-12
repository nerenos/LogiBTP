using System.Data.Common;
using System.Globalization;

namespace LogiBTP.Socle.Testing;

/// <summary>
/// Verrou consultatif PostgreSQL (session) partagé par des suites xUnit de projets différents qui écrivent les mêmes
/// tables d'une base jetable : <c>dotnet test LogiBTP.slnx</c> lance les projets de test en parallèle, chacun dans son
/// processus, et une collection xUnit ne sérialise que les tests d'un même assemblage. Pris sur sa propre connexion,
/// rendu à la libération (ou à la fermeture de la connexion). Sans connexion : rien.
/// </summary>
public sealed class VerrouBaseTests : IAsyncDisposable
{
    /// <summary>Tables de la facturation électronique (fe_parametre, file fe_flux, curseurs fe_releve, plateforme simulée en base).</summary>
    public const long FactureElectronique = 7_301_029_001;

    private readonly DbConnection? connexion;
    private readonly long cle;

    private VerrouBaseTests(DbConnection? connexion, long cle)
    {
        this.connexion = connexion;
        this.cle = cle;
    }

    /// <summary>Attend puis prend le verrou <paramref name="cle"/> sur <paramref name="connexion"/> (ouverte ici) ; null : verrou vide.</summary>
    public static async Task<VerrouBaseTests> PrendreAsync(DbConnection? connexion, long cle)
    {
        if (connexion is null) return new VerrouBaseTests(null, cle);
        await connexion.OpenAsync();
        await ExecuterAsync(connexion, $"SELECT pg_advisory_lock({cle.ToString(CultureInfo.InvariantCulture)})");
        return new VerrouBaseTests(connexion, cle);
    }

    public async ValueTask DisposeAsync()
    {
        if (connexion is null) return;
        try
        {
            await ExecuterAsync(connexion, $"SELECT pg_advisory_unlock({cle.ToString(CultureInfo.InvariantCulture)})");
        }
        finally
        {
            await connexion.DisposeAsync();
        }
    }

    private static async Task ExecuterAsync(DbConnection connexion, string sql)
    {
        await using var commande = connexion.CreateCommand();
        commande.CommandText = sql;
        commande.CommandTimeout = 0;
        await commande.ExecuteScalarAsync();
    }
}
