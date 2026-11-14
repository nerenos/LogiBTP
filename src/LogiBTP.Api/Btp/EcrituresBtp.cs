using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Registre des routes d'écriture de l'application (plan « Enregistrement des données », lot 7) : chaque route /api autre
/// que GET déclare son type d'écriture (<see cref="TypesEcriture"/>), donc son format d'échange et de contrôle ; la plus
/// longue déclaration qui couvre la route l'emporte (un module par défaut, puis ses exceptions). Une route ajoutée sans
/// type : exception au démarrage en développement (<c>VerifierRoutesEcriture</c>) et test <c>EcrituresBtpTests</c>.
/// </summary>
public static class EcrituresBtp
{
    private const string Fiche = TypesEcriture.Fiche, Document = TypesEcriture.Document, Parametrage = TypesEcriture.Parametrage,
        Action = TypesEcriture.Action, Lot = TypesEcriture.Lot, Fichier = TypesEcriture.Fichier, Session = TypesEcriture.Session,
        Lecture = TypesEcriture.Lecture;

    public static IReadOnlyList<RouteEcriture> Routes { get; } =
    [
        // Session, préférences et connexions.
        new("/api/auth", Session), new("/api/oauth", Session), new("/api/preferences", Session),
        new("/api/notifications", Session), new("/api/notifications/executer", Lot),
        new("/api/listes/vues", Session), new("/api/rentabilite/vues", Session), new("/api/planning/vues", Session),

        // Lectures par POST (critères ou contenu dans le corps).
        new("/api/calcul", Lecture), new("/api/structure/documents", Lecture), new("/api/planning/calcul", Lecture),
        new("/api/listes/agregats", Lecture), new("/api/listes/controle", Lecture), new("/api/listes/lignes", Lecture),
        new("/api/listes/segments", Lecture), new("/api/listes/sources/requete", Lecture),
        new("/api/editions/apercu", Lecture), new("/api/editions/pdf", Lecture), new("/api/editions/verifier", Lecture),
        new("/api/comptabilite/export/apercu", Lecture), new("/api/mail/estimer", Lecture),
        new("/api/pointage/borne/identifier", Lecture),

        // Fiches (module Fiche) et documents (module Document).
        new("/api/fiches/{type}", Fiche), new("/api/fiches/{type}/{id}", Fiche),
        new("/api/fiches/{type}/{id}/confidentiel", Action), new("/api/fiches/{type}/{id}/secret", Action),
        new("/api/fiches/{type}/{id}/verrou", Action), new("/api/fiches/{type}/code", Lecture),
        new("/api/fiches/{type}/chrono", Parametrage), new("/api/fiches/{type}/parametrage", Parametrage),
        new("/api/documents", Document), new("/api/documents/{id}", Document), new("/api/documents/{id}/copie", Document),
        new("/api/documents/{id}/indices", Document), new("/api/documents/{id}/transformer", Document),
        new("/api/documents/{id}/*", Action),
        new("/api/documents/plusieurs", Lot), new("/api/cas-test", Action), new("/api/structure/documents/{id}", Action),
        new("/api/structure/marches/{id}/documents", Document), new("/api/lignes", Action),

        // Paramétrage : tables et listes de valeurs enregistrées entières.
        new("/api/annuaire", Parametrage), new("/api/annuaire/coordonnees", Action), new("/api/annuaire/individus", Action),
        new("/api/annuaire/personnes", Action),
        new("/api/bibliotheque", Parametrage), new("/api/bibliotheque/elements", Action),
        new("/api/bibliotheque/recalcul", Lot), new("/api/bibliotheque/tarifs/import", Fichier),
        new("/api/calendriers", Parametrage),
        new("/api/comptabilite", Parametrage), new("/api/comptabilite/export", Lot), new("/api/comptabilite/export/{id}", Action), new("/api/comptabilite/export/modele", Parametrage),
        new("/api/comptabilite/tiers/generer", Lot),
        new("/api/conditions-paiement", Parametrage), new("/api/couleurs-type-prix", Parametrage), new("/api/droits", Parametrage),
        new("/api/editions-btp", Parametrage), new("/api/editions", Parametrage), new("/api/editions/productions", Action),
        new("/api/editions/import", Fichier), new("/api/etiquettes-ligne", Parametrage),
        new("/api/listes-valeurs", Parametrage), new("/api/listes/themes", Parametrage), new("/api/modes-reglement", Parametrage),
        new("/api/modules", Parametrage), new("/api/parametres-documents", Parametrage), new("/api/regles-documents", Parametrage),
        new("/api/services", Parametrage), new("/api/types-document", Parametrage), new("/api/unites", Parametrage),
        new("/api/vues-document", Parametrage),
        new("/api/crm/parametres", Parametrage), new("/api/crm/statuts-visa", Parametrage), new("/api/crm/types-notes", Parametrage),
        new("/api/execution/delegations", Parametrage), new("/api/execution/etats", Parametrage), new("/api/execution/etats-types", Parametrage),
        new("/api/execution/etats-types/{type}/appliquer", Lot), new("/api/execution/parcours-modeles", Parametrage),
        new("/api/execution/sav-parametres", Parametrage), new("/api/execution/types", Parametrage),
        new("/api/facture-electronique/parametres", Parametrage), new("/api/facture-electronique/annuaire/option", Parametrage),
        new("/api/facture-electronique/emission/option", Parametrage), new("/api/facture-electronique/ereporting/option", Parametrage),
        new("/api/ged/regles", Parametrage), new("/api/ged/repertoires", Parametrage),
        new("/api/mail/comptes", Parametrage), new("/api/mail/modeles", Parametrage), new("/api/mail/parametres", Parametrage),
        new("/api/mail/regles", Parametrage), new("/api/mail/usages", Parametrage),
        new("/api/planning/parametres", Parametrage), new("/api/planning/notifications", Parametrage),
        new("/api/pointage/groupes", Parametrage), new("/api/pointage/natures-absence", Parametrage), new("/api/pointage/parametres", Parametrage),
        new("/api/pointage/profils", Parametrage), new("/api/pointage/sous-types", Parametrage), new("/api/pointage/appareils", Parametrage),
        new("/api/relances/regles", Parametrage),
        new("/api/rentabilite/parametres", Parametrage),
        new("/api/ressources/calendriers-services", Parametrage), new("/api/ressources/motifs", Parametrage),
        new("/api/ressources/natures-mo", Parametrage), new("/api/ressources/plans-entretien/types", Parametrage),
        new("/api/ressources/types-habilitation", Parametrage),
        new("/api/sous-traitance/pieces-types", Parametrage),
        new("/api/stock/marques", Parametrage), new("/api/stock/parametres", Parametrage),
        new("/api/structure/revision/formules", Parametrage), new("/api/structure/revision/index", Parametrage),

        // Actions sur un élément, par module (défaut), et traitements en lot ou fichiers déposés.
        new("/api/crm", Action), new("/api/execution", Action), new("/api/facture-electronique", Action),
        new("/api/facture-electronique/import", Fichier), new("/api/facture-electronique/releve", Lot),
        new("/api/facture-electronique/encaissements/validation", Lot), new("/api/facture-electronique/ereporting/periodes/preparation", Lot),
        new("/api/ged", Action), new("/api/ged/documents", Fichier), new("/api/ged/documents/{id}", Action),
        new("/api/ged/documents/{id}/versions", Fichier), new("/api/ged/documents/{id}/derivations", Fichier),
        new("/api/ged/indexation", Lot), new("/api/ged/retention/appliquer", Lot),
        new("/api/liaisons", Action), new("/api/listes/lot", Lot), new("/api/listes/modifier", Action),
        new("/api/mail", Action), new("/api/mail/traiter", Lot),
        new("/api/planning", Action), new("/api/pointage", Action), new("/api/pointage/export", Lot), new("/api/pointage/valoriser", Lot),
        new("/api/pointage/synthese/valider", Lot), new("/api/pointage/synthese/devalider", Lot),
        new("/api/mcp", Action), new("/api/mcp/parametres", Parametrage),
        // File des propositions des agents (lot 10) : décisions d'un humain (acceptation : action exécutée sous son identité).
        new("/api/mcp/propositions", Action),
        // Serveur d'autorisation OAuth (lot 12) : jeton émis (session d'un client distant), consentement (délégation créée), liste blanche.
        new("/api/mcp/oauth/token", Session), new("/api/mcp/oauth/demandes", Action), new("/api/mcp/clients", Parametrage),
        // Recettes des agents (lot 13) : paramétrage de l'administrateur.
        new("/api/mcp/recettes", Parametrage),
        new("/api/reglements", Action), new("/api/relances", Action), new("/api/relances/lots", Lot), new("/api/relances/lots/{id}/annuler", Action),
        new("/api/rentabilite", Action), new("/api/rentabilite/recalculer-tout", Lot), new("/api/rentabilite/chantiers/{id}/photos", Fichier),
        new("/api/ressources", Action), new("/api/ressources/materiels/pleins-carburant", Lot),
        new("/api/sav", Action), new("/api/sous-traitance", Action), new("/api/stock", Action), new("/api/stock/revaloriser", Lot),
        new("/api/stock/marquer", Lot), new("/api/stock/inventaires/{id}/generer", Lot), new("/api/stock/inventaires/{id}/valider", Lot),
        new("/api/stock/lots/{id}/certificats", Fichier),
        new("/api/structure", Action), new("/api/structure/revision/valeurs", Parametrage),
        new("/api/terrain", Action), new("/api/terrain/sav/{ent}/photos", Fichier), new("/api/terrain/taches/{id}/photos", Fichier),
    ];
}
