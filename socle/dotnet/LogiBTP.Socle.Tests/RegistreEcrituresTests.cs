using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Socle.Tests;

/// <summary>Registre des routes d'écriture (plus longue déclaration, paramètres, joker) et contrôles par champ (422 VALIDATION).</summary>
public sealed class RegistreEcrituresTests
{
    private static readonly RouteEcriture[] Routes =
    [
        new("/api/documents", TypesEcriture.Document),
        new("/api/documents/{id}", TypesEcriture.Document),
        new("/api/documents/{id}/copie", TypesEcriture.Document),
        new("/api/documents/{id}/*", TypesEcriture.Action),
        new("/api/fiches/{type}/parametrage", TypesEcriture.Parametrage),
    ];

    [Theory]
    [InlineData("/api/documents", TypesEcriture.Document)]
    [InlineData("/api/documents/{id:long}", TypesEcriture.Document)]
    [InlineData("/api/documents/{id:long}/copie", TypesEcriture.Document)]
    [InlineData("/api/documents/{id:long}/valider", TypesEcriture.Action)]
    [InlineData("/api/documents/{id}/verrou/force", TypesEcriture.Action)]
    [InlineData("/api/fiches/{type}/parametrage/", TypesEcriture.Parametrage)]
    [InlineData("/api/fiches/{type}/{id}", null)]
    [InlineData("/api/document", null)]
    public void Plus_longue_declaration(string gabarit, string? type) =>
        Assert.Equal(type, RegistreEcritures.Trouver(Routes, gabarit)?.Type);

    [Fact]
    public void Gabarit_normalise() =>
        Assert.Equal("/api/a/{id}/b/{reste}", RegistreEcritures.Normaliser("api/a/{id:long:min(1)}/b/{*reste}/"));

    [Fact]
    public void Controles_par_champ_et_par_ligne()
    {
        var lignes = new[] { ("A", "x"), ("", "y"), ("A", new string('z', 5)) };
        var c = new Controles()
            .Obligatoire("libelle", "  ", "Libellé")
            .Uniques(lignes, l => l.Item1, "code", "Code")
            .Lignes(lignes, (k, l) => k.Obligatoire("code", l.Item1, "Code").Longueur("libelle", l.Item2, 4, "Libellé"))
            .Parmi("mode", "Z", ["A", "B"], "Mode");
        Assert.Equal(
            [("libelle", "OBLIGATOIRE"), ("2.code", "DOUBLON"), ("1.code", "OBLIGATOIRE"), ("2.libelle", "LONGUEUR"), ("mode", "FORMAT")],
            c.Erreurs.Select(e => (e.Champ, e.Code)));
        var e = Assert.Throws<ExceptionMetier>(c.Lever);
        Assert.Equal((422, ErreursEnregistrement.Validation), (e.Statut, e.Code));
        Assert.Same(c.Erreurs, e.Details);
        new Controles().Lever();
    }
}
