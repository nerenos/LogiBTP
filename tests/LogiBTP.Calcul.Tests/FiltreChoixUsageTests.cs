using LogiBTP.Annuaire.Web;
using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque.Web;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>« Ne plus utiliser » (db/228) : les fiches à N sont écartées des seuls choix, celles en sommeil (S) restent proposées.</summary>
public class FiltreChoixUsageTests
{
    private class AnnuaireCapture() : ServiceAnnuaireBtp(null!, null!)
    {
        public readonly List<string> Requetes = [];
        protected override Task<List<Dictionary<string, object?>>> Lire(string sql, IReadOnlyList<object?> parametres, CancellationToken ct)
        {
            Requetes.Add(sql);
            return Task.FromResult(new List<Dictionary<string, object?>>());
        }
    }

    [Fact]
    public async Task Tiers_et_individus_a_N_ecartes_des_recherches_seulement()
    {
        var s = new AnnuaireCapture();
        await s.RechercherPersonnes("abc", null, 30, CancellationToken.None);
        await s.RechercherIndividus(null, 30, CancellationToken.None);
        Assert.Contains("per_usage = 'N'", s.Requetes[0]);
        Assert.Contains("ind_usage = 'N'", s.Requetes[1]);
        Assert.DoesNotContain("'S'", s.Requetes[0] + s.Requetes[1]);
    }

    [Fact]
    public void Elements_a_N_ecartes_des_recherches_et_pas_ceux_en_sommeil()
    {
        var options = new DbContextOptionsBuilder<BibliothequeDbContext>().UseNpgsql("Host=localhost;Database=x").Options;
        using var db = new BibliothequeDbContext(options);
        var service = new ServiceBibliothequeBtp(db, new SpecialisationBibliotheque());
        var sql = service.FiltreChoixPublic(db.Elements).ToQueryString();
        Assert.Contains("ele_usage = 'N'", sql);
        Assert.DoesNotContain("'S'", sql);
    }
}

internal static class ServiceBibliothequeBtpExtensions
{
    public static IQueryable<Element> FiltreChoixPublic(this ServiceBibliothequeBtp s, IQueryable<Element> q) => new Ouvreur(s).Filtrer(q);

    private sealed class Ouvreur(ServiceBibliothequeBtp s)
    {
        public IQueryable<Element> Filtrer(IQueryable<Element> q) =>
            (IQueryable<Element>)typeof(ServiceBibliothequeBtp).GetMethod("FiltreChoix", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.Invoke(s, [q])!;
    }
}
