using LogiBTP.Domaine;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Géographie des adresses (lot 10, A29) : texte d'adresse, réponse GeoJSON, distance.</summary>
public class GeographieTests
{
    [Fact]
    public void Texte_adresse_sans_parties_vides()
    {
        Assert.Equal("12 rue de la Paix, 69002, Lyon", Geographie.TexteAdresse(" 12 rue de la Paix ", null, "", "69002", "Lyon"));
        Assert.Null(Geographie.TexteAdresse(null, " "));
    }

    [Fact]
    public void Reponse_geojson_lue_et_score_minimal()
    {
        const string json = """{"type":"FeatureCollection","features":[{"geometry":{"type":"Point","coordinates":[4.835659,45.764043]},"properties":{"score":0.9312,"label":"Lyon"}}]}""";
        Assert.Equal(new PositionGeo(45.764043m, 4.835659m, 0.931m), Geographie.LireReponse(json, 0.4m));
        Assert.Null(Geographie.LireReponse(json, 0.95m));
        Assert.Null(Geographie.LireReponse("""{"features":[]}""", 0.4m));
    }

    [Fact]
    public void Distance_a_vol_d_oiseau()
    {
        // Lyon (place Bellecour) → Villeurbanne (hôtel de ville) : 3,815 km ; Lyon → Paris : 391,49 km.
        Assert.Equal(3.8m, Geographie.DistanceKm(45.757814m, 4.832011m, 45.766640m, 4.879538m));
        Assert.Equal(391.5m, Geographie.DistanceKm(45.764043m, 4.835659m, 48.856614m, 2.352222m));
        Assert.Equal(0m, Geographie.DistanceKm(45.5m, 4.5m, 45.5m, 4.5m));
    }
}
