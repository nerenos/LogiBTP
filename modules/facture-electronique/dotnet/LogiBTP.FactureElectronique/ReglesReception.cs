namespace LogiBTP.FactureElectronique;

/// <summary>
/// Réception hors plateforme (plans/facturation-electronique.md, lot 14) : fichier proposé comme facture reçue
/// (glisser-déposer, pièce jointe d'un courriel). Règle miroir : <c>js/src/reception.js</c> (jeu
/// <c>tests/cas/03_fichiers_facture.json</c>). Le contenu reste contrôlé par la lecture.
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
}
