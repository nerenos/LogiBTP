using LogiBTP.Droits.Web;
using Xunit;

namespace LogiBTP.Droits.Tests;

/// <summary>Rattachement des routes de l'API aux nœuds : gabarit normalisé, préfixe le plus long, valeurs de la route.</summary>
public class RoutesDroitsTests
{
    private static readonly RouteDroits[] Table =
    [
        new("/api/auth", ModeRoute.Session),
        new("/api/documents", ModeRoute.Module, "documents"),
        new("/api/documents/types", ModeRoute.Session),
        new("/api/fiches/{type}", ModeRoute.Module, "fiches/{type}"),
        new("/api/droits/profils", ModeRoute.Action, "administration/profils", "MODIFIER"),
    ];

    [Theory]
    [InlineData("/api/documents/{id:long}", "/api/documents/{id}")]
    [InlineData("api/fiches/{type}/{id:long?}", "/api/fiches/{type}/{id}")]
    [InlineData("/api/ged/{**chemin}", "/api/ged/{chemin}")]
    [InlineData("/api/sante/", "/api/sante")]
    public void Gabarit_normalise(string gabarit, string attendu) => Assert.Equal(attendu, RoutesDroits.Normaliser(gabarit));

    [Theory]
    [InlineData("/api/documents", "/api/documents")]
    [InlineData("/api/documents/{id:long}/valider", "/api/documents")]
    [InlineData("/api/documents/types/{code}", "/api/documents/types")]
    [InlineData("/api/fiches/{type}/{id:long}", "/api/fiches/{type}")]
    [InlineData("/api/auth/connexion", "/api/auth")]
    [InlineData("/api/documentsx", null)]
    [InlineData("/api/stock", null)]
    public void Prefixe_le_plus_long(string gabarit, string? attendu) => Assert.Equal(attendu, RoutesDroits.Trouver(Table, gabarit)?.Prefixe);

    [Fact]
    public void Noeud_avec_les_valeurs_de_la_route()
    {
        Assert.Equal("fiches/salarie", RoutesDroits.Noeud("fiches/{type}", n => n == "type" ? "salarie" : null));
        Assert.Equal("documents", RoutesDroits.Noeud("documents", _ => null));
    }
}
