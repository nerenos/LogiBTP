using System.Text.Json;

namespace LogiBTP.Documents;

/// <summary>
/// Facture de plusieurs livraisons d'une même commande (CONCEPTION-ACHATS-MARCHES.md 13.14 a, décision du 31/10/2026) :
/// une section par commande d'origine, une tranche (titre) par livraison ; le pied de la section est celui de la
/// première livraison (copie du pied de la commande : remises et port s'appliquent une seule fois), les pieds des
/// livraisons suivantes sont retirés. Le contenu d'une livraison est pris tel quel (racine du document) ou dans son
/// unique section.
/// </summary>
public static class RegroupementLivraisons
{
    /// <summary>Propriété de la section regroupée (lig_proprietes) : identifiant de la commande d'origine.</summary>
    public const string Marqueur = "livraisons_de";

    /// <summary>Commande d'origine d'une section regroupée (sinon null).</summary>
    public static long? Origine(DocumentLigne section) =>
        section.LigTylId == TL.Section && section.LigProprietes is { } p && p.RootElement.ValueKind == JsonValueKind.Object
            && p.RootElement.TryGetProperty(Marqueur, out var v) && v.TryGetInt64(out var id) ? id : null;

    /// <summary>
    /// Contenu d'une livraison mis dans une tranche : (lignes du corps rattachées à la tranche, tranche comprise ; lignes
    /// du pied, rattachées à la racine). La section propre de la livraison est retirée.
    /// </summary>
    public static (List<TLigne> Corps, List<TLigne> Pied) Tranche<TLigne>(List<TLigne> lignes, string libelle, Func<long> nouvelId)
        where TLigne : DocumentLigne, new()
    {
        var racine = lignes.Where(l => l.LigParentId is null).OrderBy(l => l.LigOrdre).ThenBy(l => l.LigId).ToList();
        var sections = racine.Where(l => l.LigTylId == TL.Section).ToList();
        var porteur = sections.Count == 1 ? sections[0] : null;
        var enfants = porteur is null ? racine
            : lignes.Where(l => l.LigParentId == porteur.LigId).OrderBy(l => l.LigOrdre).ThenBy(l => l.LigId).Concat(racine.Where(l => l != porteur)).ToList();
        var tranche = new TLigne
        {
            LigId = nouvelId(), LigEntId = lignes.FirstOrDefault()?.LigEntId ?? 0, LigTylId = TL.Titre, LigLibelleHtml = System.Net.WebUtility.HtmlEncode(libelle),
        };
        var corps = new List<TLigne> { tranche };
        var pied = new List<TLigne>();
        var vuPied = false;
        var ordre = 0;
        foreach (var l in enfants)
        {
            if (TL.EstPied(l) || (l.LigTylId == TL.SousTotal && vuPied))
            {
                vuPied = true;
                l.LigParentId = null;
                pied.Add(l);
                continue;
            }
            l.LigParentId = tranche.LigId;
            l.LigOrdre = ++ordre;
        }
        var ids = new HashSet<long>(pied.Select(l => l.LigId)) { porteur?.LigId ?? long.MinValue };
        corps.AddRange(lignes.Where(l => !ids.Contains(l.LigId)));
        return (corps, pied);
    }

    /// <summary>
    /// Section de la commande : une tranche par livraison (dans l'ordre), puis le pied de la première ; renvoie toutes les
    /// lignes, la section à la racine (ordre 0, à renuméroter par l'appelant).
    /// </summary>
    public static List<TLigne> Regrouper<TLigne>(IReadOnlyList<(List<TLigne> Lignes, string Libelle)> livraisons, long origine, string libelleSection, string? codeSection, Func<long> nouvelId)
        where TLigne : DocumentLigne, new()
    {
        if (livraisons.Count == 0) return [];
        var section = new TLigne
        {
            LigId = nouvelId(), LigEntId = livraisons[0].Lignes.FirstOrDefault()?.LigEntId ?? 0, LigTylId = TL.Section,
            LigLibelleHtml = System.Net.WebUtility.HtmlEncode(libelleSection), LigCode = codeSection,
            LigProprietes = JsonSerializer.SerializeToDocument(new Dictionary<string, long> { [Marqueur] = origine }),
        };
        var res = new List<TLigne> { section };
        var ordre = 0;
        List<TLigne>? piedSection = null;
        foreach (var (lignes, libelle) in livraisons)
        {
            var (corps, pied) = Tranche(lignes, libelle, nouvelId);
            corps[0].LigParentId = section.LigId;
            corps[0].LigOrdre = ++ordre;
            res.AddRange(corps);
            piedSection ??= pied;
        }
        foreach (var l in piedSection ?? [])
        {
            l.LigParentId = section.LigId;
            l.LigOrdre = ++ordre;
            res.Add(l);
        }
        return res;
    }

    /// <summary>
    /// Ajoute des livraisons à une section de commande déjà regroupée : tranches insérées avant son pied, pieds des
    /// livraisons ajoutées retirés ; renvoie les lignes à ajouter au document.
    /// </summary>
    public static List<TLigne> Ajouter<TLigne>(TLigne section, List<TLigne> enfantsSection, IReadOnlyList<(List<TLigne> Lignes, string Libelle)> livraisons, Func<long> nouvelId)
        where TLigne : DocumentLigne, new()
    {
        var ordonnes = enfantsSection.OrderBy(l => l.LigOrdre).ThenBy(l => l.LigId).ToList();
        var premierPied = ordonnes.FindIndex(TL.EstPied);
        var avant = premierPied < 0 ? ordonnes : ordonnes.Take(premierPied).ToList();
        var apres = premierPied < 0 ? [] : ordonnes.Skip(premierPied).ToList();
        var ordre = 0;
        foreach (var l in avant) l.LigOrdre = ++ordre;
        var res = new List<TLigne>();
        foreach (var (lignes, libelle) in livraisons)
        {
            var (corps, _) = Tranche(lignes, libelle, nouvelId);
            corps[0].LigParentId = section.LigId;
            corps[0].LigOrdre = ++ordre;
            res.AddRange(corps);
        }
        foreach (var l in apres) l.LigOrdre = ++ordre;
        return res;
    }
}
