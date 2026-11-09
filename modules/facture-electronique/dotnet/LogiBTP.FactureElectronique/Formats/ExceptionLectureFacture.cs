namespace LogiBTP.FactureElectronique.Formats;

/// <summary>Échec de la lecture d'une facture : code <see cref="ErreurFe"/> (XML_ILLISIBLE, XSD_INVALIDE, PROFIL_INCONNU…) et détails.</summary>
public sealed class ExceptionLectureFacture(string code, string message, IReadOnlyList<string>? details = null) : Exception(message)
{
    /// <summary>Code d'erreur (<see cref="ErreurFe"/>).</summary>
    public string Code { get; } = code;

    /// <summary>Détails (messages XSD, terme en cause).</summary>
    public IReadOnlyList<string> Details { get; } = details ?? [];
}
