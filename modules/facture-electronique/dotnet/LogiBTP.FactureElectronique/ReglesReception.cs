namespace LogiBTP.FactureElectronique;

/// <summary>
/// Réception hors plateforme (plans/facturation-electronique.md, lot 14) : fichier proposé comme facture reçue
/// (glisser-déposer, pièce jointe d'un courriel). Règle miroir : <c>js/src/reception.js</c> (jeu
/// <c>tests/cas/03_fichiers_facture.json</c>). Le contenu reste contrôlé par la lecture. Sous-traitance (lot 15) :
/// <see cref="ControlerSousTraitance"/> ↔ <c>controlerSousTraitance</c> (jeu <c>tests/cas/04_sous_traitance.json</c>).
/// </summary>
public static class ReglesReception
{
    /// <summary>Extensions d'une facture reçue : Factur-X (PDF) ou XML CII / UBL.</summary>
    public static readonly IReadOnlyList<string> ExtensionsFacture = [".pdf", ".xml"];

    /// <summary>Types MIME d'une facture reçue.</summary>
    public static readonly IReadOnlyList<string> TypesMimeFacture = ["application/pdf", "application/xml", "text/xml"];

    /// <summary>Vrai si le fichier (nom, type MIME) est proposé comme facture reçue : extension .pdf ou .xml, ou type MIME d'une facture.</summary>
    public static bool EstFichierFacture(string? nom, string? type)
    {
        var n = (nom ?? "").Trim().ToLowerInvariant();
        var t = (type ?? "").Split(';')[0].Trim().ToLowerInvariant();
        return ExtensionsFacture.Any(e => n.EndsWith(e, StringComparison.Ordinal)) || TypesMimeFacture.Contains(t);
    }

    private static string Normaliser(string? x) => (x ?? "").Trim().ToUpperInvariant();

    /// <summary>
    /// Contrôle d'une facture de sous-traitance reçue (lot 15) : cadre (BT-23), payeur (EXT-FR-FE-BG-02 présent),
    /// ventilations de TVA (BG-23 : catégorie, VATEX), autoliquidation attendue du sous-traitant (null : inconnue).
    /// Paiement direct : cadre S5 avec un payeur. Écarts (<see cref="EcartReception"/>, jamais bloquants) : S5 sans payeur,
    /// payeur hors S5 ; autoliquidation attendue et une ventilation hors AE, non attendue et une ventilation AE ; ventilation
    /// AE sans le code VATEX-FR-AE (casse et espaces ignorés).
    /// </summary>
    public static ControleSousTraitance ControlerSousTraitance(string? cadre, bool payeur, IReadOnlyList<TvaControlee> tva, bool? autoliquidation)
    {
        var s5 = Normaliser(cadre) == CadreFacturation.S5;
        var ecarts = new List<string>();
        if (s5 && !payeur) ecarts.Add(EcartReception.PayeurAbsent);
        if (payeur && !s5) ecarts.Add(EcartReception.PayeurHorsS5);
        var ae = tva.Where(t => Normaliser(t.Categorie) == CategorieTva.Autoliquidation).ToList();
        if (autoliquidation == true && tva.Any(t => Normaliser(t.Categorie) != CategorieTva.Autoliquidation)) ecarts.Add(EcartReception.AutoliquidationAbsente);
        if (autoliquidation == false && ae.Count > 0) ecarts.Add(EcartReception.AutoliquidationInattendue);
        if (ae.Any(t => Normaliser(t.Vatex) != CodeExoneration.Autoliquidation)) ecarts.Add(EcartReception.VatexAutoliquidation);
        return new ControleSousTraitance(s5 && payeur, ecarts);
    }

    /// <summary>Ventilations de TVA d'une facture lue (BG-23 : catégorie BT-118, VATEX BT-121).</summary>
    public static IReadOnlyList<TvaControlee> Ventilations(Facture f) => [.. f.DetailsTva.Select(t => new TvaControlee(t.Categorie, t.CodeExoneration))];
}

/// <summary>Ventilation de TVA contrôlée : catégorie (BT-118) et code de motif d'exonération (BT-121, VATEX).</summary>
public sealed record TvaControlee(string? Categorie, string? Vatex);

/// <summary>Résultat du contrôle d'une facture de sous-traitance reçue : paiement direct, écarts (<see cref="EcartReception"/>).</summary>
public sealed record ControleSousTraitance(bool PaiementDirect, IReadOnlyList<string> Ecarts);
