using System.Threading.Channels;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Journal technique (§ 3.7) : erreurs de l'application (niveau LOGIBTP_JOURNAL_NIVEAU lu au démarrage, Error par défaut)
/// écrites dans <c>journal_technique</c> de la base principale, en tâche de fond ; repli sur un fichier quotidien
/// (<c>journaux/technique-AAAAMMJJ.log</c>) si la base ne répond pas — cas typique : l'erreur à journaliser vient de la
/// base. Messages et exceptions masqués (<see cref="Masquage"/>) avant toute écriture : ni mot de passe, ni jeton, ni
/// donnée personnelle. Le journal d'audit (connexions, droits, usurpations) est tenu par les modules, toujours actif.
/// </summary>
public sealed class JournalTechnique : ILoggerProvider
{
    private sealed record Entree(DateTimeOffset Le, string Niveau, string Categorie, string Message, string? Exception);

    private readonly Channel<Entree> file = Channel.CreateBounded<Entree>(new BoundedChannelOptions(10_000) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly string? connexion;
    private readonly string dossier;
    private readonly LogLevel niveau;
    private readonly Task ecriture;

    public JournalTechnique(string? connexion, string dossier, LogLevel niveau)
    {
        this.connexion = connexion;
        this.dossier = dossier;
        this.niveau = niveau;
        ecriture = Task.Run(EcrireAsync);
    }

    public static LogLevel Niveau(string? texte) => Enum.TryParse<LogLevel>(texte, true, out var n) ? n : LogLevel.Error;

    public ILogger CreateLogger(string categorie) => new Journal(this, categorie);

    private sealed class Journal(JournalTechnique j, string categorie) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel niveau) => niveau >= j.niveau && niveau != LogLevel.None;

        public void Log<TState>(LogLevel niveau, EventId id, TState etat, Exception? exception, Func<TState, Exception?, string> formater)
        {
            if (!IsEnabled(niveau)) return;
            j.file.Writer.TryWrite(new Entree(DateTimeOffset.UtcNow, niveau.ToString(), categorie,
                Masquage.Texte(formater(etat, exception)) ?? "", Masquage.Texte(exception?.ToString())));
        }
    }

    private async Task EcrireAsync()
    {
        await foreach (var e in file.Reader.ReadAllAsync())
        {
            try
            {
                if (connexion is null) throw new InvalidOperationException("sans base");
                await using var cnx = new NpgsqlConnection(connexion);
                await cnx.OpenAsync();
                await using var cmd = new NpgsqlCommand("""
                    INSERT INTO journal_technique (jte_le, jte_niveau, jte_categorie, jte_message, jte_exception) VALUES (@le, @n, @c, @m, @e)
                    """, cnx);
                cmd.Parameters.AddWithValue("le", e.Le);
                cmd.Parameters.AddWithValue("n", e.Niveau);
                cmd.Parameters.AddWithValue("c", e.Categorie.Length > 200 ? e.Categorie[..200] : e.Categorie);
                cmd.Parameters.AddWithValue("m", e.Message);
                cmd.Parameters.AddWithValue("e", (object?)e.Exception ?? DBNull.Value);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception) when (true)
            {
                try
                {
                    Directory.CreateDirectory(dossier);
                    await File.AppendAllTextAsync(Path.Combine(dossier, $"technique-{e.Le:yyyyMMdd}.log"),
                        $"{e.Le:O} {e.Niveau} {e.Categorie} {e.Message}{(e.Exception is null ? "" : Environment.NewLine + e.Exception)}{Environment.NewLine}");
                }
                catch (IOException)
                {
                    // Ni base ni disque : l'entrée est perdue (la console garde la trace).
                }
            }
        }
    }

    public void Dispose()
    {
        file.Writer.TryComplete();
        ecriture.Wait(TimeSpan.FromSeconds(5));
    }
}

/// <summary>
/// Purge nocturne des journaux (D24), dans chaque base : journal technique 30 jours, audit (connexions, droits) un an,
/// adresses IP des sessions, journaux et machines effacées après six mois ; jetons remplacés, codes et exclusions
/// échus retirés.
/// </summary>
public sealed class PurgeJournaux(Microsoft.Extensions.Options.IOptions<OptionsSocietes> societes, ILogger<PurgeJournaux> journal) : BackgroundService
{
    private static readonly string[] Requetes =
    [
        "DELETE FROM journal_technique WHERE jte_le < now() - interval '30 days'",
        "DELETE FROM journal_connexion WHERE jco_le < now() - interval '1 year'",
        "DELETE FROM journal_droits WHERE jdr_le < now() - interval '1 year'",
        "UPDATE journal_connexion SET jco_adresse = NULL, jco_navigateur = NULL WHERE jco_le < now() - interval '6 months' AND jco_adresse IS NOT NULL",
        "UPDATE session_utilisateur SET ses_adresse = NULL, ses_navigateur = NULL WHERE ses_vu_le < now() - interval '6 months' AND ses_adresse IS NOT NULL",
        "UPDATE machine_connue SET mac_adresse = NULL WHERE mac_vu_le < now() - interval '6 months' AND mac_adresse IS NOT NULL",
        "DELETE FROM jeton_remplace WHERE jre_remplace_le < now() - interval '2 days'",
        "DELETE FROM code_connexion WHERE cco_cree_le < now() - interval '1 day'",
        "DELETE FROM ip_exclue WHERE ipe_fin < now() - interval '30 days'",
        "DELETE FROM session_utilisateur WHERE (ses_fermee_le IS NOT NULL OR ses_expire_le < now()) AND ses_vu_le < now() - interval '6 months'",
    ];

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMinutes(5), ct);
        while (!ct.IsCancellationRequested)
        {
            foreach (var s in societes.Value.Societes())
            {
                await using var cnx = new NpgsqlConnection(s.Connexion);
                try
                {
                    await cnx.OpenAsync(ct);
                    foreach (var r in Requetes)
                    {
                        try { await new NpgsqlCommand(r, cnx).ExecuteNonQueryAsync(ct); }
                        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedTable) { }
                    }
                }
                catch (Exception e) when (e is NpgsqlException or InvalidOperationException)
                {
                    journal.LogError(e, "Purge des journaux impossible pour la société {Societe}", s.Code ?? "principale");
                }
            }
            await Task.Delay(TimeSpan.FromHours(24), ct);
        }
    }
}
