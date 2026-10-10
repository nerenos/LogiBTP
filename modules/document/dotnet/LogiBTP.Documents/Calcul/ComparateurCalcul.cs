using System.Globalization;
using LogiBTP.Socle;

namespace LogiBTP.Documents;

/// <summary>Écart entre la valeur calculée par le client et celle recalculée par le serveur.</summary>
public sealed record EcartCalcul(long? LigId, string Champ, string? ValeurClient, string? ValeurServeur);

/// <summary>
/// Comparaison champ par champ des résultats des deux moteurs (comparaison.js côté client).
/// Classe mère : une spécialisation ajoute ses champs et sa règle d'appariement des lignes.
/// </summary>
public class ComparateurCalcul
{
    public static readonly string[] ChampsDocumentGeneriques = ["ent_total_ht", "ent_total_tva", "ent_total_ttc", "ent_net_a_payer"];

    public static readonly string[] ChampsLigneGeneriques =
    [
        "lig_qte_vendue", "lig_qte_totale", "lig_pv", "lig_pv_remise", "lig_montant_ht",
        "lig_base_calcul", "lig_montant_tva", "lig_taux_tva", "lig_numerotation", "lig_libelle_affiche",
    ];

    public virtual IReadOnlyList<string> ChampsDocument => ChampsDocumentGeneriques;
    public virtual IReadOnlyList<string> ChampsLigne => ChampsLigneGeneriques;

    /// <summary>Clé d'appariement d'une ligne entre les deux résultats (par défaut son ID).</summary>
    protected virtual string Cle(DocumentLigne l) => l.LigId.ToString(CultureInfo.InvariantCulture);

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

    public List<EcartCalcul> Comparer(Document client, IEnumerable<DocumentLigne> lignesClient, Document serveur, IEnumerable<DocumentLigne> lignesServeur)
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
}
