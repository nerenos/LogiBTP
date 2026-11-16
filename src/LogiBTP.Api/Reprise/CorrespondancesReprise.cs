using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Correspondances par défaut de la reprise d'une base MDE ou OptimBTP (plan reprise-mde-optim, lot 0) : fichiers
/// <c>Reprise/Correspondances/&lt;source&gt;.json</c> embarqués, tables attendues par source et noms des listes de cibles.
/// Les listes elles-mêmes (types de documents, casquettes…) sont lues dans la base cible au moment de la reprise.
/// </summary>
public static class CorrespondancesReprise
{
    /// <summary>Noms des listes de cibles fournies par le cœur (les listes neutres sont celles du module Import).</summary>
    public static class Listes
    {
        public const string TypeDocument = "TYPE_DOCUMENT";
        public const string TypeFiche = "TYPE_FICHE";
        public const string TypeLigne = "TYPE_LIGNE";
        public const string Casquette = "CASQUETTE";
        public const string TypeLien = "TYPE_LIEN";
        public const string RegroupementNature = "REGROUPEMENT_NATURE";
        public const string NatureNote = "NATURE_NOTE";
        public const string ModeReglement = "MODE_REGLEMENT";
        public const string Civilite = "CIVILITE";
    }

    /// <summary>Tables attendues dans le fichier de correspondances d'une source.</summary>
    public static IReadOnlyCollection<string> TablesAttendues(string source) => source switch
    {
        SourceReprise.Mde =>
        [
            "type_document", "type_fiche", "type_facture", "etat_suite", "type_tiers", "tiers_payeur",
            "type_ligne_vente", "type_ligne_achat", "part_sous_traitance", "mode_avancement", "type_arrondi", "compteur",
            "mode_paiement", "civilite", "pays",
        ],
        SourceReprise.Optim =>
        [
            "type_document_vente", "type_document_achat", "nature_message", "entite", "categorie_tiers", "regroupement_nature",
            "civilite", "pays",
        ],
        _ => [],
    };

    /// <summary>Texte du fichier par défaut d'une source (ressource embarquée).</summary>
    public static string TexteParDefaut(string source)
    {
        var nom = $"LogiBTP.Api.Reprise.Correspondances.{source.ToLowerInvariant()}.json";
        using var flux = typeof(CorrespondancesReprise).Assembly.GetManifestResourceStream(nom)
            ?? throw new InvalidOperationException($"Correspondances par défaut introuvables : {nom}");
        using var lecteur = new StreamReader(flux);
        return lecteur.ReadToEnd();
    }

    /// <summary>Fichier par défaut d'une source, lu (sans validation : elle demande les listes de la base cible).</summary>
    public static FichierCorrespondances ParDefaut(string source) =>
        FichierCorrespondances.Lire(TexteParDefaut(source)).Fichier
        ?? throw new InvalidOperationException($"Correspondances par défaut illisibles : {source}");
}
