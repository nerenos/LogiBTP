using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Domaines de la reprise par source (plan reprise-mde-optim) : chaque lot de domaine (référentiels, annuaire,
/// bibliothèque, pièces…) ajoute les siens ici. Le moteur les ordonne par leurs dépendances.
/// </summary>
public static class DomainesReprise
{
    /// <summary>Codes des domaines (communs aux deux sources).</summary>
    public static class Codes
    {
        public const string Societe = "SOCIETE";
        public const string Referentiels = "REFERENTIELS";
    }

    /// <summary>Paramètre du module Comptabilité où l'analytique source est gardé (Q11), sans table cible.</summary>
    public const string ParametreAnalytique = "reprise_analytique";

    public static IReadOnlyList<IDomaineReprise> Pour(string source) => source switch
    {
        SourceReprise.Mde => [new SocieteMde(), new ReferentielsMde()],
        SourceReprise.Optim => [new SocieteOptim(), new ReferentielsOptim()],
        _ => throw new ArgumentException($"Source de reprise inconnue : {source}"),
    };
}
