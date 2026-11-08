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
    public void Ressources_a_N_ecartees_des_choix_de_nouvelle_affectation_et_pas_celles_en_sommeil()
    {
        var f = SqlBtp.RessourceUtilisable;
        Assert.Contains("sal_usage = 'N'", f);
        Assert.Contains("mat_usage = 'N'", f);
        Assert.Contains("per_usage = 'N'", f);
        Assert.DoesNotContain("'S'", f);
        var src = File.ReadAllText(Path.Combine(Racine(), "src/LogiBTP.Api/Btp/SpecialisationPlanningBtp.cs")) + File.ReadAllText(Path.Combine(Racine(), "src/LogiBTP.Api/Btp/AffectationsMateriel.cs"));
        Assert.Equal(2, src.Split("SqlBtp.RessourceUtilisable").Length - 1);
        // Pointage, magasin : seuls les choix sans identifiant explicite écartent les N (valeur posée toujours lisible).
        Assert.Contains("@ids IS NULL AND s.sal_actif AND s.sal_usage <> 'N'", File.ReadAllText(Path.Combine(Racine(), "src/LogiBTP.Api/Btp/SpecialisationPointageBtp.cs")));
        Assert.Contains("{id}::int IS NULL AND s.sal_actif AND s.sal_usage <> 'N') OR s.sal_id = {id}", File.ReadAllText(Path.Combine(Racine(), "src/LogiBTP.Api/Btp/MagasinBtp.cs")));
    }

    private static string Racine()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "LogiBTP.slnx"))) d = d.Parent;
        return d!.FullName;
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
