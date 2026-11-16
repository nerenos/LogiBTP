using LogiBTP.Import.Reprise;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>Format et validation d'un fichier de correspondances de reprise.</summary>
public class CorrespondancesTests
{
    private static readonly string[] Tables = ["type_document"];

    private static readonly Dictionary<string, IReadOnlyCollection<string>> Cibles = new()
    {
        ["TYPE_DOCUMENT"] = ["V_DEVIS", "V_FACTURE"],
    };

    private static FichierCorrespondances Lire(string entrees, string source = "MDE", string tables = "") =>
        FichierCorrespondances.Lire($$"""
            {
              // commentaire admis
              "source": "{{source}}", "version": 1,
              "tables": {
                "type_document": { "colonne": "X.TYPEDOC", "cibles": ["TYPE_DOCUMENT"], "entrees": [ {{entrees}} ] }{{tables}}
              }
            }
            """).Fichier!;

    private static List<string> Codes(FichierCorrespondances f, string? source = null) =>
        f.Valider(Tables, Cibles, source).Select(e => e.Code).ToList();

    [Fact]
    public void Fichier_valide()
    {
        var f = Lire("""{ "source": "DC", "cible": "V_DEVIS" }, { "source": "XX", "ignorer": true, "motif": "Non repris" },""");
        Assert.Empty(Codes(f, SourceReprise.Mde));
        Assert.Equal("V_DEVIS", f.Tables["type_document"].Trouver("DC  ")!.Cible);
        Assert.True(f.Tables["type_document"].Trouver("XX")!.Ignorer);
        Assert.Null(f.Tables["type_document"].Trouver("ZZ"));
    }

    [Fact]
    public void Json_illisible()
    {
        var (fichier, erreur) = FichierCorrespondances.Lire("{ \"source\": ");
        Assert.Null(fichier);
        Assert.Equal(ErreurCorrespondance.FormatInvalide, erreur!.Code);
    }

    [Fact]
    public void Source_inconnue_ou_differente()
    {
        Assert.Contains(ErreurCorrespondance.SourceInconnue, Codes(Lire("", source: "BATIGEST")));
        Assert.Contains(ErreurCorrespondance.SourceDifferente, Codes(Lire("", source: "OPTIM"), SourceReprise.Mde));
    }

    [Fact]
    public void Table_manquante_ou_inconnue()
    {
        var f = Lire("", tables: """, "autre": { "cibles": [], "entrees": [] }""");
        var erreurs = f.Valider(["type_document", "type_tiers"], Cibles);
        Assert.Contains(erreurs, e => e.Code == ErreurCorrespondance.TableManquante && e.Emplacement == "type_tiers");
        Assert.Contains(erreurs, e => e.Code == ErreurCorrespondance.TableInconnue && e.Emplacement == "autre");
    }

    [Fact]
    public void Valeur_en_double()
    {
        var erreurs = Lire("""{ "source": "DC", "cible": "V_DEVIS" }, { "source": "DC ", "cible": "V_FACTURE" }""").Valider(Tables, Cibles);
        Assert.Contains(erreurs, e => e.Code == ErreurCorrespondance.ValeurEnDouble && e.Emplacement == "type_document[1]");
    }

    [Fact]
    public void Cible_inconnue_sans_cible_ou_ambigue()
    {
        var codes = Codes(Lire("""
            { "source": "A", "cible": "V_INCONNU" },
            { "source": "B" },
            { "source": "C", "cible": "V_DEVIS", "ignorer": true, "motif": "x" },
            { "source": "D", "ignorer": true }
            """));
        Assert.Equal([ErreurCorrespondance.CibleInconnue, ErreurCorrespondance.SansCible, ErreurCorrespondance.CibleEtIgnorer,
            ErreurCorrespondance.MotifManquant], codes);
    }

    [Fact]
    public void Liste_de_cibles_inconnue_et_listes_du_module()
    {
        var f = FichierCorrespondances.Lire("""
            { "source": "OPTIM", "version": 1, "tables": {
              "type_document": { "cibles": ["INCONNUE", "ETAT_SUITE"], "entrees": [ { "source": "S", "cible": "SOLDEE" } ] } } }
            """).Fichier!;
        var erreurs = f.Valider(Tables, Cibles);
        Assert.Equal([ErreurCorrespondance.ListeCiblesInconnue], erreurs.Select(e => e.Code));
    }
}
