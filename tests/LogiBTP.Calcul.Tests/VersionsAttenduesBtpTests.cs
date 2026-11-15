using LogiBTP.Api.Btp;
using LogiBTP.Installation;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Versions attendues embarquées dans l'API (plan versionnement-schema, lot 6) : identiques à celles du manifeste du dépôt.</summary>
public class VersionsAttenduesBtpTests
{
    [Fact]
    public void Ressource_embarquee_identique_au_manifeste_du_depot()
    {
        var embarquees = VersionsAttenduesBtp.Lire();
        var depot = VersionsAttendues.Depuis(File.ReadAllLines(Path.Combine(CasPartages.RacineDepot(), ManifesteScripts.CheminRelatif)), MigrationsCoeur.Liste);
        Assert.Equal(depot.ParModule.OrderBy(p => p.Key), embarquees.ParModule.OrderBy(p => p.Key));
        Assert.Contains("coeur", embarquees.ParModule.Keys);
        Assert.All(embarquees.ParModule.Values, v => Assert.True(v >= VersionModule.Socle));
    }
}
