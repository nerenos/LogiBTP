using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace LogiBTP.Socle.Tests;

/// <summary>
/// Unité d'écriture : deux contextes EF d'une même portée écrivent dans une seule transaction (annulée entièrement sur
/// erreur), imbrication par point de sauvegarde, effets après validation, lot à une transaction par élément.
/// Table temporaire de la connexion de la portée. Base PostgreSQL : variable LOGIBTP_TEST_PG, sinon rien.
/// </summary>
public sealed class UniteEcritureTests
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");

    public sealed class Ligne
    {
        public int Id { get; set; }
        public string Valeur { get; set; } = "";
    }

    public sealed class ContexteA(DbContextOptions<ContexteA> o) : DbContext(o)
    {
        public DbSet<Ligne> Lignes => Set<Ligne>();
        protected override void OnModelCreating(ModelBuilder b) => b.Entity<Ligne>(e =>
        {
            e.ToTable("t_unite");
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Valeur).HasColumnName("valeur");
        });
    }

    public sealed class ContexteB(DbContextOptions<ContexteB> o) : DbContext(o)
    {
        public DbSet<Ligne> Lignes => Set<Ligne>();
        protected override void OnModelCreating(ModelBuilder b) => b.Entity<Ligne>(e =>
        {
            e.ToTable("t_unite");
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Valeur).HasColumnName("valeur");
        });
    }

    private static async Task<AsyncServiceScope> Portee()
    {
        var services = new ServiceCollection();
        services.AddScoped(_ => new ConnexionRequete(Connexion!));
        services.AddScoped<UniteEcriture>();
        services.AddDbContext<ContexteA>((sp, o) => o.ConfigurerBase(sp));
        services.AddDbContext<ContexteB>((sp, o) => o.ConfigurerBase(sp));
        var portee = services.BuildServiceProvider().CreateAsyncScope();
        // Table temporaire : propre à la connexion de la portée, donc vue par les deux contextes.
        var a = portee.ServiceProvider.GetRequiredService<ContexteA>();
        await a.Database.OpenConnectionAsync();
        await a.Database.ExecuteSqlRawAsync("CREATE TEMP TABLE t_unite (id serial PRIMARY KEY, valeur text NOT NULL UNIQUE)");
        return portee;
    }

    private static async Task<List<string>> Valeurs(IServiceProvider sp) =>
        await sp.GetRequiredService<ContexteA>().Lignes.AsNoTracking().OrderBy(l => l.Id).Select(l => l.Valeur).ToListAsync();

    [Fact]
    public async Task Deux_contextes_dans_une_seule_transaction_annulee_sur_erreur()
    {
        if (Connexion is null) return;
        await using var p = await Portee();
        var sp = p.ServiceProvider;
        var unite = sp.GetRequiredService<UniteEcriture>();
        await Assert.ThrowsAsync<InvalidOperationException>(() => unite.ExecuterAsync(async ct =>
        {
            var a = sp.GetRequiredService<ContexteA>();
            a.Lignes.Add(new Ligne { Valeur = "a" });
            await a.SaveChangesAsync(ct);
            var b = sp.GetRequiredService<ContexteB>();
            b.Lignes.Add(new Ligne { Valeur = "b" });
            await b.SaveChangesAsync(ct);
            await b.Database.ExecuteSqlRawAsync("INSERT INTO t_unite (valeur) VALUES ('c')", ct);
            throw new InvalidOperationException("échec après les écritures");
        }, default));
        Assert.Empty(await Valeurs(sp));
        Assert.False(unite.EnCours);
    }

    [Fact]
    public async Task Transaction_explicite_d_un_contexte_englobe_les_autres()
    {
        if (Connexion is null) return;
        await using var p = await Portee();
        var sp = p.ServiceProvider;
        var a = sp.GetRequiredService<ContexteA>();
        await using (var tx = await a.Unite().CommencerAsync(default))
        {
            Assert.NotNull(a.Database.CurrentTransaction);
            a.Lignes.Add(new Ligne { Valeur = "a" });
            await a.SaveChangesAsync();
            var b = sp.GetRequiredService<ContexteB>();
            b.Lignes.Add(new Ligne { Valeur = "b" });
            await b.SaveChangesAsync();
            Assert.True(sp.GetRequiredService<UniteEcriture>().EnCours);
            await tx.RollbackAsync();
        }
        Assert.Empty(await Valeurs(sp));

        // Validée : les deux écritures restent.
        await using (var tx = await a.Unite().CommencerAsync(default))
        {
            // Transaction d'EF ouverte à côté de l'unité : refusée.
            await Assert.ThrowsAsync<InvalidOperationException>(() => sp.GetRequiredService<ContexteB>().Database.BeginTransactionAsync());
            a.Lignes.Add(new Ligne { Valeur = "a2" });
            await a.SaveChangesAsync();
            var b = sp.GetRequiredService<ContexteB>();
            b.Lignes.Add(new Ligne { Valeur = "b2" });
            await b.SaveChangesAsync();
            await tx.CommitAsync();
        }
        Assert.Equal(["a2", "b2"], await Valeurs(sp));
    }

    [Fact]
    public async Task Imbrication_par_point_de_sauvegarde()
    {
        if (Connexion is null) return;
        await using var p = await Portee();
        var sp = p.ServiceProvider;
        var unite = sp.GetRequiredService<UniteEcriture>();
        var a = sp.GetRequiredService<ContexteA>();
        await unite.ExecuterAsync(async ct =>
        {
            a.Lignes.Add(new Ligne { Valeur = "externe" });
            await a.SaveChangesAsync(ct);
            // Doublon dans l'imbriquée : elle seule est annulée, l'appelant continue.
            var refus = await Assert.ThrowsAsync<DbUpdateException>(() => unite.ExecuterAsync(async c =>
            {
                var b = sp.GetRequiredService<ContexteB>();
                b.Lignes.Add(new Ligne { Valeur = "interne" });
                b.Lignes.Add(new Ligne { Valeur = "externe" });
                await b.SaveChangesAsync(c);
            }, ct));
            Assert.Equal(ErreursEnregistrement.Doublon, ErreursBase.Traduire(refus)?.Code);
            sp.GetRequiredService<ContexteB>().ChangeTracker.Clear();
            a.Lignes.Add(new Ligne { Valeur = "apres" });
            await a.SaveChangesAsync(ct);
        }, default);
        Assert.Equal(["externe", "apres"], await Valeurs(sp));
    }

    [Fact]
    public async Task Effets_apres_validation_seulement()
    {
        if (Connexion is null) return;
        await using var p = await Portee();
        var sp = p.ServiceProvider;
        var unite = sp.GetRequiredService<UniteEcriture>();
        var lances = new List<string>();
        await unite.ExecuterAsync(async ct =>
        {
            unite.ApresValidation(_ => { lances.Add("valide"); return Task.CompletedTask; });
            await Task.CompletedTask;
            Assert.Empty(lances);
        }, default);
        Assert.Equal(["valide"], lances);

        await Assert.ThrowsAsync<InvalidOperationException>(() => unite.ExecuterAsync(_ =>
        {
            unite.ApresValidation(_ => { lances.Add("annule"); return Task.CompletedTask; });
            throw new InvalidOperationException();
        }, default));
        // Point de sauvegarde annulé : ses effets sont abandonnés, ceux de l'englobante restent.
        await unite.ExecuterAsync(async ct =>
        {
            unite.ApresValidation(_ => { lances.Add("englobante"); return Task.CompletedTask; });
            try
            {
                await unite.ExecuterAsync(_ =>
                {
                    unite.ApresValidation(_ => { lances.Add("imbriquee"); return Task.CompletedTask; });
                    throw new InvalidOperationException();
                }, ct);
            }
            catch (InvalidOperationException)
            {
                // voulu
            }
        }, default);
        Assert.Equal(["valide", "englobante"], lances);

        // Transaction ouverte à la main : effets lancés à sa validation ; sans transaction : tout de suite.
        await using (var tx = await unite.CommencerAsync(default))
        {
            unite.ApresValidation(_ => { lances.Add("manuelle"); return Task.CompletedTask; });
            await tx.CommitAsync();
        }
        await unite.ApresValidationAsync(_ => { lances.Add("immediat"); return Task.CompletedTask; }, default);
        Assert.Equal(["valide", "englobante", "manuelle", "immediat"], lances);
    }

    [Fact]
    public async Task Lot_une_transaction_par_element()
    {
        if (Connexion is null) return;
        await using var p = await Portee();
        var sp = p.ServiceProvider;
        var unite = sp.GetRequiredService<UniteEcriture>();
        var rapport = await unite.ParElementAsync(new[] { "x", "y", "x", "z" }, v => v, async (v, ct) =>
        {
            var b = sp.GetRequiredService<ContexteB>();
            b.ChangeTracker.Clear();
            await b.Database.ExecuteSqlRawAsync("INSERT INTO t_unite (valeur) VALUES ({0})", [v + "-1"], ct);
            await b.Database.ExecuteSqlRawAsync("INSERT INTO t_unite (valeur) VALUES ({0})", [v], ct);
        }, default);
        Assert.Equal(3, rapport.Reussis);
        Assert.Equal(1, rapport.Echecs);
        var echec = Assert.Single(rapport.Elements, e => !e.Ok);
        Assert.Equal(ErreursEnregistrement.Doublon, echec.Code);
        // Le second « x » n'a rien laissé (pas même « x-1 » en double, refusé lui aussi).
        Assert.Equal(["x-1", "x", "y-1", "y", "z-1", "z"], await Valeurs(sp));
    }

    [Fact]
    public void Refus_de_la_base_traduits()
    {
        static PostgresException E(string etat) => new("refus", "ERROR", "ERROR", etat);
        Assert.Equal((409, ErreursEnregistrement.Doublon), Code(E(PostgresErrorCodes.UniqueViolation)));
        Assert.Equal((409, ErreursEnregistrement.Utilise), Code(E(PostgresErrorCodes.ForeignKeyViolation)));
        Assert.Equal((422, ErreursEnregistrement.Valeur), Code(E(PostgresErrorCodes.NotNullViolation)));
        Assert.Equal((422, ErreursEnregistrement.Valeur), Code(E(PostgresErrorCodes.CheckViolation)));
        Assert.Equal((422, ErreursEnregistrement.Valeur), Code(E(PostgresErrorCodes.RaiseException)));
        Assert.Null(ErreursBase.Traduire(E(PostgresErrorCodes.DeadlockDetected)));
        Assert.Equal((409, ErreursEnregistrement.Doublon), Code(new DbUpdateException("x", E(PostgresErrorCodes.UniqueViolation))));

        static (int, string) Code(Exception e) => ErreursBase.Traduire(e) is { } m ? (m.Statut, m.Code) : (0, "");
    }
}
