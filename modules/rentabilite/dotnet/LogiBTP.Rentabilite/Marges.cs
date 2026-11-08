namespace LogiBTP.Rentabilite;

/// <summary>Marges d'un chantier : produit, marge brute et nette en montant et en % du produit (null si produit nul).</summary>
public sealed record MargeChantier(decimal Produit, decimal Brute, decimal? TauxBrute, decimal Nette, decimal? TauxNette);

/// <summary>
/// Marge d'un chantier avec produit interne (lot 6, refacturation interne du matériel), répliquée dans js/src/marge.js
/// (jeu tests/cas/03_marge_produit_interne.json) : le produit interne (composante PRODUIT_INTERNE) s'ajoute au HT des
/// lignes du chantier de suivi, sans pièce ni écriture comptable.
/// </summary>
public static class Marges
{
    public static MargeChantier Chantier(decimal lignes, decimal produitInterne, decimal pa, decimal pr)
    {
        var produit = lignes + produitInterne;
        var brute = produit - pa;
        var nette = produit - pr;
        return new MargeChantier(produit, brute, produit == 0 ? null : brute * 100m / produit, nette, produit == 0 ? null : nette * 100m / produit);
    }
}
