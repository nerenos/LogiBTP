namespace LogiBTP.Comptabilite;

public sealed record PropositionEn16931(string Categorie, string? Vatex);

/// <summary>Règle répliquée dans tva.js (jeu tests/cas/05_tva_en16931.json).</summary>
public static class ReglesTva
{
    /// <summary>Catégorie EN 16931 et code VATEX proposés pour un comportement de TVA ; null si inconnu.</summary>
    public static PropositionEn16931? Proposer(string? comportement) => comportement switch
    {
        ComportementTva.Normale => new(CategorieEn16931.Standard, null),
        ComportementTva.Autoliquidation or ComportementTva.Intracommunautaire => new(CategorieEn16931.Autoliquidation, Vatex.Autoliquidation),
        ComportementTva.Exoneree => new(CategorieEn16931.Exoneree, Vatex.Exoneration),
        _ => null,
    };
}
