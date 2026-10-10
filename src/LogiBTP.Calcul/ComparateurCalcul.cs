using System.Globalization;
using LogiBTP.Domaine;

namespace LogiBTP.Calcul;

/// <summary>Écart entre la valeur calculée par le client et celle recalculée par le serveur.</summary>
public sealed record EcartCalcul(long? LigId, string Champ, string? ValeurClient, string? ValeurServeur);

/// <summary>Comparaison champ par champ des résultats des deux moteurs (comparaison.js côté client).</summary>
public static class ComparateurCalcul
{
    public static readonly string[] ChampsDocument = ["ent_coef_fa", "ent_total_ht", "ent_total_tva", "ent_total_ttc", "ent_net_a_payer"];

    public static readonly string[] ChampsLigne =
    [
        "lig_qte_base", "lig_qte_vendue", "lig_qte_totale", "lig_pa", "lig_pr", "lig_pv", "lig_coef_fg", "lig_coef_benef",
        "lig_coef_fa", "lig_pv_affiche", "lig_pv_remise", "lig_montant_pa", "lig_montant_pr", "lig_montant_ht",
        "lig_base_calcul", "lig_montant_tva", "lig_taux_tva", "lig_numerotation", "lig_libelle_affiche",
    ];

    private static string Cle(DocumentLigne l) =>
        l.LigIsEcartArrondi ? $"ecart:{l.LigParentId}" : l.LigId.ToString(CultureInfo.InvariantCulture);

    private static string? Texte(object? v) => v switch
    {
        null => null,
        decimal d => d.ToString(CultureInfo.InvariantCulture),
        _ => Convert.ToString(v, CultureInfo.InvariantCulture),
    };

    private static bool Egales(object? a, object? b) => (a, b) switch
    {
        (null, null) => true,
        (null, _) or (_, null) => false,
        (decimal x, decimal y) => x == y,
        _ => Equals(a, b),
    };

    public static List<EcartCalcul> Comparer(Document client, IEnumerable<DocumentLigne> lignesClient, Document serveur, IEnumerable<DocumentLigne> lignesServeur)
    {
        var ecarts = new List<EcartCalcul>();
        foreach (var champ in ChampsDocument)
        {
            var c = AccesColonnes.Lire(client, champ);
            var s = AccesColonnes.Lire(serveur, champ);
            if (!Egales(c, s)) ecarts.Add(new EcartCalcul(null, champ, Texte(c), Texte(s)));
        }
        var cotesServeur = lignesServeur.GroupBy(Cle).ToDictionary(g => g.Key, g => g.First());
        foreach (var lc in lignesClient)
        {
            if (!cotesServeur.Remove(Cle(lc), out var ls))
            {
                ecarts.Add(new EcartCalcul(lc.LigId, "*", "présente", "absente"));
                continue;
            }
            foreach (var champ in ChampsLigne)
            {
                var c = AccesColonnes.Lire(lc, champ);
                var s = AccesColonnes.Lire(ls, champ);
                if (!Egales(c, s)) ecarts.Add(new EcartCalcul(ls.LigId, champ, Texte(c), Texte(s)));
            }
        }
        foreach (var ls in cotesServeur.Values) ecarts.Add(new EcartCalcul(ls.LigId, "*", "absente", "présente"));
        return ecarts;
    }

    public static List<EcartCalcul> Comparer(ResultatCalcul client, ResultatCalcul serveur) =>
        Comparer(client.Document, client.Lignes, serveur.Document, serveur.Lignes);
}
