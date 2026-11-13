using System.Data;
using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace LogiBTP.Socle.Donnees;

/// <summary>
/// Connexion unique d'une portée de services (requête HTTP ou portée d'une tâche de fond) : tous les contextes EF et
/// toutes les commandes Npgsql de la portée passent par elle, si bien qu'une transaction ouverte couvre tout ce qui
/// s'écrit dans la portée. Créée à la demande, fermée et libérée avec la portée.
/// </summary>
public sealed class ConnexionRequete : IAsyncDisposable, IDisposable
{
    private readonly Func<NpgsqlConnection> creer;
    private readonly bool proprietaire;
    private NpgsqlConnection? connexion;

    /// <summary>Connexion créée à la demande sur la chaîne donnée (base de la société courante).</summary>
    public ConnexionRequete(string chaine)
    {
        creer = () => new NpgsqlConnection(chaine);
        proprietaire = true;
    }

    /// <summary>Connexion existante (contexte construit hors injection, tests) : jamais libérée ici.</summary>
    public ConnexionRequete(NpgsqlConnection existante)
    {
        connexion = existante;
        creer = () => existante;
        proprietaire = false;
    }

    public NpgsqlConnection Connexion => connexion ??= creer();

    public void Dispose()
    {
        if (proprietaire) connexion?.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        if (proprietaire && connexion is not null) await connexion.DisposeAsync();
    }
}

/// <summary>
/// Unité d'écriture de la portée : une seule transaction pour tout ce qui s'écrit (fiche et champs gérés, document,
/// lignes, compléments, historique, liens…), tous contextes EF confondus ; annulée entièrement si une écriture échoue.
/// <list type="bullet">
/// <item><see cref="ExecuterAsync{T}"/> ouvre la transaction, ou, si elle est déjà ouverte, un point de sauvegarde
/// (une erreur annule alors le travail imbriqué seul, l'appelant décide du reste) ;</item>
/// <item>une transaction explicite s'ouvre par <c>db.Unite().CommencerAsync(ct)</c> (jamais <c>Database.BeginTransaction</c>,
/// refusé pendant une unité) ; tout contexte EF branché (<see cref="ExtensionsDonnees.ConfigurerBase"/>) qui écrit pendant
/// la transaction y est inscrit (<see cref="InterceptionUnite"/>) : son <c>SaveChanges</c> s'y fait sous un point de
/// sauvegarde d'EF ;</item>
/// <item>les effets externes (courriel, géocodage, plateforme…) s'inscrivent par <see cref="ApresValidation"/> et
/// s'exécutent après le commit, jamais si la transaction est annulée ; leur échec est journalisé sans rien annuler ;</item>
/// <item>traitement en lot : <see cref="ParElementAsync{T}"/>, une transaction par élément.</item>
/// </list>
/// </summary>
public sealed class UniteEcriture(ConnexionRequete connexion, ILogger<UniteEcriture>? journal = null) : IAsyncDisposable, IDisposable
{
    private readonly List<Func<CancellationToken, Task>> pendantes = [];
    private readonly List<Func<CancellationToken, Task>> validees = [];
    private int compteur;
    private bool ouverteParUnite;
    private readonly List<DbContext> contextes = [];

    /// <summary>Intercepteur EF propre à cette unité (ajouté aux options des contextes de la portée).</summary>
    public InterceptionUnite Interception => field ??= new InterceptionUnite(this);

    public NpgsqlConnection Connexion => connexion.Connexion;

    /// <summary>Transaction en cours (null : aucune).</summary>
    public NpgsqlTransaction? Transaction { get; private set; }

    public bool EnCours => Transaction is not null;

    /// <summary>Exécute <paramref name="ecrire"/> dans la transaction de l'unité (ouverte ici, ou point de sauvegarde si elle l'est déjà).</summary>
    public async Task<T> ExecuterAsync<T>(Func<CancellationToken, Task<T>> ecrire, CancellationToken ct)
    {
        var proprietaire = !EnCours;
        await using var tx = await CommencerAsync(ct);
        T resultat;
        try
        {
            resultat = await ecrire(ct);
        }
        catch
        {
            await AnnulerSansMasquer(tx);
            throw;
        }
        await tx.CommitAsync(ct);
        if (proprietaire) await ExecuterValideesAsync(ct);
        return resultat;
    }

    /// <summary>Annulation après une erreur : un échec de l'annulation (connexion perdue) ne masque pas l'erreur d'origine.</summary>
    private async Task AnnulerSansMasquer(TransactionUnite tx)
    {
        try
        {
            await tx.RollbackAsync(CancellationToken.None);
        }
        catch (Exception e) when (e is NpgsqlException or InvalidOperationException)
        {
            journal?.LogWarning(e, "Annulation de la transaction de l'unité d'écriture impossible");
        }
    }

    public Task ExecuterAsync(Func<CancellationToken, Task> ecrire, CancellationToken ct) =>
        ExecuterAsync(async c => { await ecrire(c); return true; }, ct);

    /// <summary>
    /// Lecture protégée (requête saisie dans le paramétrage…) : transaction READ ONLY annulée à la fin ; dans une
    /// transaction déjà ouverte, point de sauvegarde annulé à la fin (rien de ce qui s'y exécute ne reste).
    /// </summary>
    public async Task<T> LireAsync<T>(Func<NpgsqlConnection, NpgsqlTransaction, CancellationToken, Task<T>> lire, int? delaiMs, CancellationToken ct)
    {
        var imbriquee = EnCours;
        await using var tx = await CommencerAsync(ct);
        var cadre = (imbriquee ? "" : "SET TRANSACTION READ ONLY; ") + (delaiMs is int d ? $"SET LOCAL statement_timeout = {d};" : "");
        try
        {
            if (cadre.Length > 0)
            {
                await using var cmd = new NpgsqlCommand(cadre, Connexion, Transaction);
                await cmd.ExecuteNonQueryAsync(ct);
            }
            return await lire(Connexion, Transaction!, ct);
        }
        finally
        {
            await AnnulerSansMasquer(tx);
        }
    }

    /// <summary>
    /// Effet externe à lancer après la validation de la transaction en cours (abandonné si elle est annulée) ; sans
    /// transaction en cours, lancé à la fin de la prochaine unité ou de la requête.
    /// </summary>
    public void ApresValidation(Func<CancellationToken, Task> action)
    {
        if (EnCours) pendantes.Add(action);
        else validees.Add(action);
    }

    /// <summary>
    /// Traitement en lot : chaque élément dans sa propre transaction (point de sauvegarde si l'appelant en a ouvert
    /// une) ; un élément en erreur n'écrit rien de lui et n'arrête pas les suivants.
    /// </summary>
    public async Task<RapportLot<TResultat>> ParElementAsync<TElement, TResultat>(IEnumerable<TElement> elements, Func<TElement, string> cle,
        Func<TElement, CancellationToken, Task<TResultat>> traiter, CancellationToken ct)
    {
        var resultats = new List<ResultatElement<TResultat>>();
        foreach (var e in elements)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var r = await ExecuterAsync(c => traiter(e, c), ct);
                resultats.Add(new(cle(e), true, r, null, null, null));
            }
            catch (Exception x) when (x is not OperationCanceledException)
            {
                var m = ErreursBase.Traduire(x);
                if (m is null) journal?.LogError(x, "Traitement en lot : élément {Cle} en erreur", cle(e));
                resultats.Add(new(cle(e), false, default, m?.Code ?? LogiBTP.Socle.ErreursEnregistrement.Erreur, m?.Message ?? "Erreur inattendue", m?.Details));
            }
        }
        return new RapportLot<TResultat>(resultats);
    }

    public Task<RapportLot<bool>> ParElementAsync<TElement>(IEnumerable<TElement> elements, Func<TElement, string> cle,
        Func<TElement, CancellationToken, Task> traiter, CancellationToken ct) =>
        ParElementAsync(elements, cle, async (e, c) => { await traiter(e, c); return true; }, ct);

    /// <summary>Lance les effets externes des transactions validées (fin d'unité, fin de requête) ; un échec est journalisé.</summary>
    public async Task ExecuterValideesAsync(CancellationToken ct)
    {
        while (validees.Count > 0 && !EnCours)
        {
            var a = validees[0];
            validees.RemoveAt(0);
            try
            {
                await a(ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal?.LogWarning(e, "Action après validation en échec (sans effet sur les données enregistrées)");
            }
        }
    }

    // ------------------------------------------------------------------ transactions

    /// <summary>Transaction de l'unité : la vraie si aucune n'est ouverte (propriétaire), sinon un point de sauvegarde.</summary>
    public Task<TransactionUnite> CommencerAsync(CancellationToken ct) => CommencerAsync(IsolationLevel.Unspecified, ct);

    public async Task<TransactionUnite> CommencerAsync(IsolationLevel niveau, CancellationToken ct)
    {
        if (Transaction is null)
        {
            if (Connexion.State != ConnectionState.Open)
            {
                await Connexion.OpenAsync(ct);
                ouverteParUnite = true;
            }
            Transaction = await Connexion.BeginTransactionAsync(niveau, ct);
            foreach (var c in contextes) Inscrire(c);
            return new TransactionUnite(this, Transaction, null, pendantes.Count);
        }
        var nom = "unite_" + ++compteur;
        await Transaction.SaveAsync(nom, ct);
        return new TransactionUnite(this, Transaction, nom, pendantes.Count);
    }

    /// <summary>
    /// Contexte de la portée connu de l'unité : inscrit à la transaction en cours (et aux suivantes), pour que ses
    /// commandes et son <c>SaveChanges</c> s'y fassent.
    /// </summary>
    public void Enroler(DbContext contexte)
    {
        if (!contextes.Contains(contexte)) contextes.Add(contexte);
        Inscrire(contexte);
    }

    private void Inscrire(DbContext c)
    {
        if (Transaction is null) return;
        var actuelle = c.Database.CurrentTransaction?.GetDbTransaction();
        if (ReferenceEquals(actuelle, Transaction)) return;
        if (actuelle is not null) throw new InvalidOperationException("Contexte déjà engagé dans une autre transaction que celle de l'unité d'écriture");
        c.Database.UseTransaction(Transaction);
    }

    internal async Task TerminerAsync(bool valider, CancellationToken ct)
    {
        var tx = Transaction!;
        try
        {
            if (valider) await tx.CommitAsync(ct);
            else await tx.RollbackAsync(ct);
        }
        finally
        {
            Fermer(valider);
            await tx.DisposeAsync();
            if (ouverteParUnite)
            {
                ouverteParUnite = false;
                await Connexion.CloseAsync();
            }
        }
    }

    private void Fermer(bool valider)
    {
        Transaction = null;
        if (valider) validees.AddRange(pendantes);
        pendantes.Clear();
        foreach (var c in contextes)
        {
            try
            {
                if (c.Database.CurrentTransaction is not null) c.Database.UseTransaction(null);
            }
            catch (ObjectDisposedException)
            {
                // Contexte déjà libéré : rien à détacher.
            }
        }
    }

    /// <summary>Point de sauvegarde annulé : ses effets externes en attente sont abandonnés.</summary>
    internal void AbandonnerDepuis(int rang)
    {
        if (rang < pendantes.Count) pendantes.RemoveRange(rang, pendantes.Count - rang);
    }

    /// <summary>Libération synchrone d'une portée (<c>using var scope = CreateScope()</c>) : transaction restée ouverte annulée.</summary>
    public void Dispose()
    {
        if (Transaction is not null)
        {
            journal?.LogWarning("Transaction de l'unité d'écriture restée ouverte en fin de portée : annulée");
            var tx = Transaction;
            Fermer(false);
            try
            {
                tx.Rollback();
            }
            catch (Exception e) when (e is NpgsqlException or InvalidOperationException)
            {
                journal?.LogWarning(e, "Annulation de la transaction de l'unité d'écriture impossible");
            }
            tx.Dispose();
        }
        if (validees.Count > 0) journal?.LogWarning("{Nombre} action(s) après validation non lancée(s) en fin de portée", validees.Count);
    }

    public async ValueTask DisposeAsync()
    {
        if (Transaction is not null)
        {
            journal?.LogWarning("Transaction de l'unité d'écriture restée ouverte en fin de portée : annulée");
            await TerminerAsync(false, CancellationToken.None);
        }
        if (validees.Count > 0) journal?.LogWarning("{Nombre} action(s) après validation non lancée(s) en fin de portée", validees.Count);
    }

    // ------------------------------------------------------------------ unité d'un contexte

    private static readonly ConditionalWeakTable<DbContext, UniteEcriture> Seules = new();

    /// <summary>
    /// Unité du contexte : celle de la portée s'il est branché par <see cref="ExtensionsDonnees.ConfigurerBase"/>, sinon
    /// (contexte construit à la main : tests, outils) une unité propre à ce contexte, sur sa connexion.
    /// </summary>
    public static UniteEcriture De(DbContext db)
    {
        var options = db.GetService<IDbContextOptions>();
        var interception = options.FindExtension<Microsoft.EntityFrameworkCore.Infrastructure.CoreOptionsExtension>()?.Interceptors?
            .OfType<InterceptionUnite>().FirstOrDefault();
        var unite = interception?.Unite ?? Seules.GetValue(db, c => new UniteEcriture(new ConnexionRequete((NpgsqlConnection)c.Database.GetDbConnection())));
        unite.Enroler(db);
        return unite;
    }
}

/// <summary>
/// Transaction rendue par l'unité : la transaction réelle (propriétaire : validation = commit, effets externes
/// libérés) ou un point de sauvegarde (validation = RELEASE, annulation = ROLLBACK TO). Non terminée à sa libération : annulée.
/// </summary>
public sealed class TransactionUnite : IAsyncDisposable
{
    private readonly UniteEcriture unite;
    private readonly string? pointSauvegarde;
    private readonly int rang;
    private bool terminee;

    internal TransactionUnite(UniteEcriture unite, NpgsqlTransaction reelle, string? pointSauvegarde, int rang)
    {
        this.unite = unite;
        Reelle = reelle;
        this.pointSauvegarde = pointSauvegarde;
        this.rang = rang;
    }

    /// <summary>Transaction Npgsql sous-jacente (commandes Npgsql écrites à la main).</summary>
    public NpgsqlTransaction Reelle { get; }

    /// <summary>Vrai : transaction réelle (premier niveau) ; faux : point de sauvegarde dans une transaction déjà ouverte.</summary>
    public bool Proprietaire => pointSauvegarde is null;

    public async Task CommitAsync(CancellationToken ct = default)
    {
        if (terminee) return;
        terminee = true;
        if (Proprietaire) await unite.TerminerAsync(true, ct);
        else await Reelle.ReleaseAsync(pointSauvegarde!, ct);
    }

    public async Task RollbackAsync(CancellationToken ct = default)
    {
        if (terminee) return;
        terminee = true;
        if (Proprietaire) await unite.TerminerAsync(false, ct);
        else
        {
            unite.AbandonnerDepuis(rang);
            await Reelle.RollbackAsync(pointSauvegarde!, ct);
            await Reelle.ReleaseAsync(pointSauvegarde!, ct);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (!terminee && unite.EnCours) await RollbackAsync(CancellationToken.None);
        terminee = true;
    }
}
