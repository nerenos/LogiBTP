using System.Data;
using System.Data.Common;
using Microsoft.Data.SqlClient;

namespace LogiBTP.Import.Reprise.Lecteurs;

/// <summary>
/// Lecteur d'une base MDE (SQL Server). Connexion en intention de lecture (<c>ApplicationIntent=ReadOnly</c>), chaque
/// lecture dans une transaction annulée à la fin ; lecture sans verrou partagé durable (READ COMMITTED). Tables du
/// schéma <c>dbo</c>. Le pilote refuse la globalisation invariante (pages de code des collations) : l'hôte qui l'utilise
/// (LogiBTP.Api, tests) la désactive dans son projet (<c>InvariantGlobalization</c> à false, cultures fixées au démarrage).
/// </summary>
public sealed class LecteurSqlServer : LecteurAdo
{
    private readonly string chaine;

    public LecteurSqlServer(string chaine) : base(SourceReprise.Mde)
    {
        var b = new SqlConnectionStringBuilder(chaine) { ApplicationIntent = ApplicationIntent.ReadOnly, ApplicationName = "LogiBTP reprise" };
        this.chaine = b.ConnectionString;
    }

    protected override DbConnection NouvelleConnexion() => new SqlConnection(chaine);

    protected override async Task<DbTransaction> CommencerLectureAsync(DbConnection connexion, CancellationToken ct) =>
        await connexion.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

    protected override string RequeteTables =>
        "SELECT TABLE_NAME AS nom FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo'";

    protected override string Proteger(string table) => "[dbo].[" + table.Replace("]", "]]") + "]";
}
