using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LogiBTP.Socle.Donnees;

/// <summary>
/// Intercepteurs EF de l'unité d'écriture, ajoutés aux contextes de la portée par <see cref="ExtensionsDonnees.ConfigurerBase"/> :
/// un contexte qui enregistre pendant la transaction de l'unité y est inscrit (son <c>SaveChanges</c> s'y fait, sous un
/// point de sauvegarde d'EF) ; une transaction ouverte par <c>Database.BeginTransaction</c> pendant l'unité est refusée
/// (elle s'ouvre par <c>db.Unite().CommencerAsync</c>).
/// </summary>
public sealed class InterceptionUnite(UniteEcriture unite) : SaveChangesInterceptor
{
    public UniteEcriture Unite { get; } = unite;

    internal DebutTransaction Debut => field ??= new DebutTransaction(Unite);

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } c) Unite.Enroler(c);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } c) Unite.Enroler(c);
        return ValueTask.FromResult(result);
    }

    internal sealed class DebutTransaction(UniteEcriture unite) : DbTransactionInterceptor
    {
        public override InterceptionResult<DbTransaction> TransactionStarting(DbConnection connection, TransactionStartingEventData eventData,
            InterceptionResult<DbTransaction> result) => Verifier(result);

        public override ValueTask<InterceptionResult<DbTransaction>> TransactionStartingAsync(DbConnection connection,
            TransactionStartingEventData eventData, InterceptionResult<DbTransaction> result, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Verifier(result));

        private InterceptionResult<DbTransaction> Verifier(InterceptionResult<DbTransaction> result) => unite.EnCours
            ? throw new InvalidOperationException("Transaction déjà ouverte par l'unité d'écriture : ouvrir par db.Unite().CommencerAsync(ct)")
            : result;
    }
}
