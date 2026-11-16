using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Domaines de la reprise par source (plan reprise-mde-optim) : chaque lot de domaine (référentiels, annuaire,
/// bibliothèque, pièces…) ajoute les siens ici, avant <see cref="Codes.ValeursChamps"/> qui reste le dernier (le moteur
/// garde l'ordre de déclaration entre domaines sans dépendance l'un de l'autre).
/// </summary>
public static class DomainesReprise
{
    /// <summary>Codes des domaines (communs aux deux sources).</summary>
    public static class Codes
    {
        public const string Societe = "SOCIETE";
        public const string Referentiels = "REFERENTIELS";
        public const string Champs = "CHAMPS";
        public const string Annuaire = "ANNUAIRE";
        /// <summary>Valeurs des champs supplémentaires : déclaré en dernier (après toutes les fiches reprises).</summary>
        public const string ValeursChamps = "VALEURS_CHAMPS";
    }

    /// <summary>Paramètre du module Comptabilité où l'analytique source est gardé (Q11), sans table cible.</summary>
    public const string ParametreAnalytique = "reprise_analytique";

    public static IReadOnlyList<IDomaineReprise> Pour(string source) => source switch
    {
        SourceReprise.Mde => [new SocieteMde(), new ReferentielsMde(), new ChampsMde(), new AnnuaireMde(), new ValeursChampsMde()],
        SourceReprise.Optim => [new SocieteOptim(), new ReferentielsOptim(), new ChampsOptim(), new AnnuaireOptim(), new ValeursChampsOptim()],
        _ => throw new ArgumentException($"Source de reprise inconnue : {source}"),
    };
}
