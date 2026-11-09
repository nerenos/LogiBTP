using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Jeu partagé avec cycle-vie.js : rôle du sens, propriétés des statuts, motifs, contrôles, posables, statut affiché.</summary>
public class ReglesCycleVieTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "facture-electronique", "tests", "cas", "01_cycle_vie.json"));

    private static string? Texte(JsonNode? n) => n?.GetValue<string>();
    private static List<string> Liste(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];
    private static IEnumerable<JsonNode> Cas(string section) => Jeu[section]!.AsArray().Select(c => c!);

    [Fact]
    public void Role_selon_le_sens()
    {
        foreach (var c in Cas("sens")) Assert.Equal(Texte(c["attendu"]), ReglesCycleVie.EmetteurDuSens(Texte(c["sens"])));
    }

    [Fact]
    public void Proprietes_des_statuts()
    {
        foreach (var c in Cas("proprietes"))
        {
            var s = Texte(c["statut"]);
            var a = c["attendu"]!;
            Assert.True(Liste(a["emetteurs"]).SequenceEqual(ReglesCycleVie.EmetteursStatut(s)), $"émetteurs de {s}");
            Assert.True(a["terminal"]!.GetValue<bool>() == ReglesCycleVie.Terminal(s), $"terminal {s}");
            Assert.True(a["motif_obligatoire"]!.GetValue<bool>() == ReglesCycleVie.MotifObligatoire(s), $"motif obligatoire {s}");
            Assert.True(a["obligatoire_ppf"]!.GetValue<bool>() == ReglesCycleVie.ObligatoirePpf(s), $"obligatoire PPF {s}");
        }
    }

    [Fact]
    public void Motifs_autorises_par_statut()
    {
        foreach (var c in Cas("motifs"))
        {
            var obtenu = ReglesCycleVie.MotifsAutorises(Texte(c["statut"]), Texte(c["emetteur"]), c["b2g"]!.GetValue<bool>());
            Assert.True(Liste(c["attendu"]).SequenceEqual(obtenu), $"motifs de {c["statut"]} ({c["emetteur"]}, b2g {c["b2g"]})");
        }
    }

    [Fact]
    public void Controle_des_statuts()
    {
        foreach (var c in Cas("controles"))
        {
            var e = c["entree"]!;
            var obtenu = ReglesCycleVie.Controler(new StatutPropose(
                Texte(e["sens"])!, Liste(e["historique"]), Texte(e["statut"])!, Texte(e["emetteur"]), Texte(e["motif"]), Texte(e["action"]),
                e["b2g"]!.GetValue<bool>()));
            Assert.True(Liste(c["attendu"]).SequenceEqual(obtenu), $"{c["nom"]} : obtenu [{string.Join(", ", obtenu)}]");
        }
    }

    [Fact]
    public void Statuts_posables()
    {
        foreach (var c in Cas("posables"))
        {
            var obtenu = ReglesCycleVie.StatutsPosables(Texte(c["sens"]), Liste(c["historique"]));
            Assert.True(Liste(c["attendu"]).SequenceEqual(obtenu), $"{c["nom"]} : obtenu [{string.Join(", ", obtenu)}]");
        }
    }

    [Fact]
    public void Statut_affiche()
    {
        foreach (var c in Cas("affiches")) Assert.True(Texte(c["attendu"]) == ReglesCycleVie.StatutAffiche(Liste(c["historique"])), $"{c["nom"]}");
    }
}
