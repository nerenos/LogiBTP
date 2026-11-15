namespace LogiBTP.Socle.Donnees;

/// <summary>Résultat d'un élément d'un traitement en lot : clé de l'élément, succès, résultat ou erreur (code, message, détails).</summary>
public sealed record ResultatElement<T>(string Cle, bool Ok, T? Resultat, string? Code, string? Message, object? Details);

/// <summary>
/// Réponse commune des traitements en lot (une transaction par élément, <see cref="UniteEcriture.ParElementAsync{TElement, TResultat}"/>) :
/// chaque élément avec son issue, et les totaux.
/// </summary>
public sealed record RapportLot<T>(IReadOnlyList<ResultatElement<T>> Elements)
{
    public int Reussis => Elements.Count(e => e.Ok);
    public int Echecs => Elements.Count(e => !e.Ok);
}
