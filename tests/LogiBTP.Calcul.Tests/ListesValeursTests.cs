using LogiBTP.Api.Btp;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Contrôles d'une liste de valeurs saisie (format commun des écritures : erreurs par champ « rang.champ »).</summary>
public class ListesValeursTests
{
    private static ValeurListe V(string code, string libelle = "L", string? parent = null) => new(code, libelle, parent, null, 0, true);

    [Fact]
    public void Erreurs_par_ligne_et_par_champ()
    {
        var c = ListesValeurs.Controler(true, [V("A"), V("A"), V("", ""), V("B", parent: "A"), V("C", parent: "B"), V(new string('X', 31))]);
        Assert.Equal(
            [("1.code", "DOUBLON"), ("2.code", "OBLIGATOIRE"), ("2.libelle", "OBLIGATOIRE"), ("4.parent", "INCONNU"), ("5.code", "LONGUEUR")],
            c.Erreurs.Select(e => (e.Champ, e.Code)));
    }

    [Fact]
    public void Liste_sans_hierarchie_refuse_un_regroupement() =>
        Assert.Equal([("1.parent", "INCONNU")], ListesValeurs.Controler(false, [V("A"), V("B", parent: "A")]).Erreurs.Select(e => (e.Champ, e.Code)));

    [Fact]
    public void Liste_correcte() => Assert.True(ListesValeurs.Controler(true, [V("A"), V("B", parent: "A")]).Valides);
}
