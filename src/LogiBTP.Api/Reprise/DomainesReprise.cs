using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Domaines de la reprise par source (plan reprise-mde-optim) : chaque lot de domaine (référentiels, annuaire,
/// bibliothèque, pièces…) ajoute les siens ici, avant <see cref="Codes.ValeursChamps"/> (suivi du seul recalcul des suivis ; le moteur
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
        public const string Ressources = "RESSOURCES";
        public const string Bibliotheque = "BIBLIOTHEQUE";
        public const string Structure = "STRUCTURE";
        public const string PiecesVente = "PIECES_VENTE";
        public const string Achats = "ACHATS";
        public const string Reglements = "REGLEMENTS";
        public const string Exploitation = "EXPLOITATION";
        public const string Stock = "STOCK";
        /// <summary>GED et notes (lot 16) : contenus rangés sous le répertoire de stockage de la société.</summary>
        public const string Ged = "GED";
        /// <summary>Valeurs des champs supplémentaires : déclaré en dernier (après toutes les fiches reprises).</summary>
        public const string ValeursChamps = "VALEURS_CHAMPS";
        /// <summary>Suivis tenus par triggers suspendus : premier domaine (<see cref="SuspensionSuivis"/>).</summary>
        public const string SuivisSuspendus = "SUIVIS_SUSPENDUS";
        /// <summary>Chantiers des pièces et file de la rentabilité recalculés : tout dernier domaine (<see cref="RecalculSuivis"/>).</summary>
        public const string Suivis = "SUIVIS";
    }

    /// <summary>Paramètre du module Comptabilité où l'analytique source est gardé (Q11), sans table cible.</summary>
    public const string ParametreAnalytique = "reprise_analytique";

    /// <param name="stockageGed">Répertoire de la GED de la société (sous le nom de sa base) ; null : documents non repris.</param>
    public static IReadOnlyList<IDomaineReprise> Pour(string source, string? stockageGed = null) => source switch
    {
        SourceReprise.Mde => [new SuspensionSuivis(), new SocieteMde(), new ReferentielsMde(), new ChampsMde(), new AnnuaireMde(), new RessourcesMde(), new BibliothequeMde(), new StructureMde(), new PiecesVenteMde(), new AchatsMde(), new ReglementsMde(), new ExploitationMde(), new StockMde(), new GedMde(stockageGed), new ValeursChampsMde(), new RecalculSuivis()],
        SourceReprise.Optim => [new SuspensionSuivis(), new SocieteOptim(), new ReferentielsOptim(), new ChampsOptim(), new AnnuaireOptim(), new RessourcesOptim(), new BibliothequeOptim(), new StructureOptim(), new PiecesVenteOptim(), new AchatsOptim(), new ReglementsOptim(), new ExploitationOptim(), new StockOptim(), new GedOptim(stockageGed), new ValeursChampsOptim(), new RecalculSuivis()],
        _ => throw new ArgumentException($"Source de reprise inconnue : {source}"),
    };
}
