using LogiBTP.Domaine;
using LogiBTP.Mail.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Rapprochement d'un accusé de réception reçu par courriel et d'une commande (plan ar-courriel, lot 3) : commandes
/// d'achat et de sous-traitance (<see cref="TypesDocument.Arc"/>), pièces valables seulement (<c>v_document_valable</c>,
/// commandes annulées ou remplacées écartées), numéro comparé sans séparateurs ni casse.
/// </summary>
public static class AccuseCommandeBtp
{
    /// <summary>Commandes valables portant l'un des numéros reconnus (le numéro de la commande est comparé sans séparateurs ni casse).</summary>
    public const string SqlCommandes = """
        SELECT e.ent_id, e.ent_numero, e.ent_reference_externe, e.ent_tiers_id FROM document e
        JOIN type_document t ON t.tyd_id = e.ent_tyd_id
        JOIN v_document_valable v ON v.ent_id = e.ent_id AND NOT v.annule
        WHERE t.tyd_code = ANY(@types) AND e.ent_numero IS NOT NULL
          AND regexp_replace(upper(e.ent_numero), '[^A-Z0-9]', '', 'g') = ANY(@numeros)
        ORDER BY e.ent_id
        """;

    /// <summary>Numéros reconnus ramenés à leur forme comparable (lettres et chiffres en majuscules).</summary>
    public static string[] Comparables(IEnumerable<string> numeros) =>
        [.. numeros.Select(n => new string(n.Where(char.IsAsciiLetterOrDigit).ToArray()).ToUpperInvariant()).Where(n => n.Length > 0).Distinct()];

    /// <summary>Un seul élément trouvé : rattaché ; aucun : rien à proposer ; plusieurs : candidats, sans rattachement (décision AO3).</summary>
    public static ResolutionAccuse? Resoudre(IReadOnlyList<ElementTrouve> trouves) => trouves.Count switch
    {
        0 => null,
        1 => new ResolutionAccuse(trouves[0], []),
        _ => new ResolutionAccuse(null, trouves),
    };
}
