using System.Data;
using System.Data.Common;
using MySqlConnector;

namespace LogiBTP.Import.Reprise.Lecteurs;

/// <summary>
/// Lecteur d'une base OptimBTP (MariaDB). Chaque lecture dans une transaction en lecture seule
/// (<c>START TRANSACTION READ ONLY</c> : toute écriture est refusée par le serveur), annulée à la fin. Dates nulles
/// (<c>0000-00-00</c>) rendues nulles ; tables de la base courante.
/// </summary>
public sealed class LecteurMariaDb : LecteurAdo
{
    private readonly string chaine;

    public LecteurMariaDb(string chaine) : base(SourceReprise.Optim)
    {
        var b = new MySqlConnectionStringBuilder(chaine)
        {
            ConvertZeroDateTime = true,
            AllowZeroDateTime = false,
            ApplicationName = "LogiBTP reprise",
            CharacterSet = "utf8mb4",
        };
        this.chaine = b.ConnectionString;
    }

    protected override DbConnection NouvelleConnexion() => new MySqlConnection(chaine);

    protected override async Task<DbTransaction> CommencerLectureAsync(DbConnection connexion, CancellationToken ct) =>
        await ((MySqlConnection)connexion).BeginTransactionAsync(IsolationLevel.RepeatableRead, isReadOnly: true, ct);

    protected override string RequeteTables =>
        "SELECT TABLE_NAME AS nom FROM information_schema.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = DATABASE()";

    protected override string Proteger(string table) => "`" + table.Replace("`", "``") + "`";
}
