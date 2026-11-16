using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Domaines de la reprise par source (plan reprise-mde-optim) : chaque lot de domaine (référentiels, annuaire,
/// bibliothèque, pièces…) ajoute les siens ici. Le moteur les ordonne par leurs dépendances.
/// </summary>
public static class DomainesReprise
{
    public static IReadOnlyList<IDomaineReprise> Pour(string source) => source switch
    {
        SourceReprise.Mde => [],
        SourceReprise.Optim => [],
        _ => throw new ArgumentException($"Source de reprise inconnue : {source}"),
    };
}
