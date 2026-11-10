using LogiBTP.Documents;
using LogiBTP.Droits.Web;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Droits spécialisé pour le BTP : catalogue (modules, types de documents par famille, types de fiches, fonctions
/// d'administration) et rattachement de chaque route /api à un nœud. Conventions des modules : documents/{famille}/{code}
/// (module Document), fiches/{type} (module Fiche), crm (module CRM), pointage (module Pointage).
/// </summary>
public sealed class SpecialisationDroitsBtp : SpecialisationDroits
{
    private static readonly string[] Cycle = [.. ActionsDroits.Cascade];
    private static readonly string[] Simple = [ActionsDroits.Consulter, ActionsDroits.Modifier, ActionsDroits.Creer, ActionsDroits.Supprimer];
    private static readonly string[] Fiche = [.. Simple, ActionsDroits.Deverrouiller, ActionsDroits.Rgpd, ActionsDroits.ModifierCode];
    private static readonly string[] Lecture = [ActionsDroits.Consulter, ActionsDroits.Modifier];

    private static readonly Dictionary<string, string> Familles = new()
    {
        ["V"] = "Ventes", ["A"] = "Achats", ["T"] = "Sous-traitance", ["S"] = "Stock", ["E"] = "Exécution",
    };

    private sealed record TypeLu(string Code, string Libelle, string Famille);
    private sealed record FicheLue(string Code, string Libelle);

    public override async Task<IReadOnlyList<NoeudCatalogue>> CatalogueAsync(IServiceProvider services, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var types = await db.Database.SqlQueryRaw<TypeLu>("SELECT tyd_code AS \"Code\", tyd_libelle AS \"Libelle\", tyd_famille AS \"Famille\" FROM type_document ORDER BY tyd_famille, tyd_code").ToListAsync(ct);
        var fiches = await db.Database.SqlQueryRaw<FicheLue>("SELECT tyf_code AS \"Code\", tyf_libelle AS \"Libelle\" FROM type_fiche WHERE tyf_actif ORDER BY tyf_libelle").ToListAsync(ct);
        var n = new List<NoeudCatalogue>
        {
            new("documents", "Documents", Cycle, Icone: "📄", Aide: "Pièces de vente, d'achat, de stock, d'exécution et de sous-traitance"),
        };
        foreach (var f in types.Select(t => t.Famille).Distinct())
        {
            n.Add(new(FamillesDocument.NoeudDroits(f), Familles.GetValueOrDefault(f, f), Cycle));
            n.AddRange(types.Where(t => t.Famille == f).Select(t => new NoeudCatalogue(FamillesDocument.NoeudDroits(f, t.Code), t.Libelle, Cycle)));
        }
        n.Add(new("fiches", "Fiches", Fiche, Icone: "🗂", Aide: "Salariés, matériels, tiers, structure des affaires, éléments de bibliothèque ; Modifier le code : changer le code d'une fiche déjà créée"));
        n.AddRange(fiches.Select(f => new NoeudCatalogue($"fiches/{f.Code}", f.Libelle, Fiche)));
        n.AddRange(
        [
            new("listes", "Listes", Lecture, Icone: "📋", Aide: "Listes de données (vues, recherche, saisie en liste)"),
            new("structure", "Structure des affaires", Simple, Icone: "🏗", Aide: "Rattachements, marchés, acomptes, intervenants"),
            new("annuaire", "Annuaire", Simple, Icone: "📇"),
            new("bibliotheque", "Bibliothèque", Simple, Icone: "📚"),
            new("ged", "GED", Simple, Icone: "🗄"),
            new("editions", "Éditions", Simple, Icone: "🖨"),
            new("ressources", "Ressources", Simple, Icone: "🧰", Aide: "Habilitations, équipes, missions d'intérim, services"),
            new("calendriers", "Calendriers", Simple, Icone: "📅"),
            new("crm", "CRM", [.. Simple, ActionsDroits.Superviser, ActionsDroits.Rgpd], Icone: "💬",
                Aide: "Superviser : voir les notes de tous ; RGPD : lever le masquage des notes privées"),
            new("reglement", "Règlements", Simple, Icone: "💶"),
            new(SpecialisationRelanceBtp.Noeud, "Relances", [ActionsDroits.Consulter, ActionsDroits.Creer, ActionsDroits.Valider], Portee: true, Icone: "📨",
                Aide: "Devis envoyés et factures à reste échu ; Créer : préparer un lot ; Valider : envoyer, noter une relance faite, saisir un numéro de recommandé ; portée : pièces dont on est le chargé (soi, son équipe, son service) ou tout"),
            new(SpecialisationFactureElectroniqueBtp.Noeud, "Facturation électronique", Lecture, Icone: "🧾",
                Aide: "Flux émis et reçus de la plateforme agréée, statuts, chronologie des pièces ; Modifier : nouvelle tentative, dépôt et import manuels, relève ; paramètres de la plateforme : nœud Paramètres"),
            new("execution", "Exécution", Simple, Icone: "🧭"),
            new(SpecialisationExecutionBtp.NoeudControle, "Contrôle du N+1 des étapes d'ordres", [ActionsDroits.Valider], Portee: true,
                Aide: "En plus du responsable du service porteur et de ses délégués : portée service (ordres des services dont on est membre) ou tout"),
            new("execution/sav", "Interventions SAV sur le terrain", Simple, Aide: "Refusé par défaut : ses interventions dans « Mon terrain », compte rendu, bon signé par le client"),
            new("sous_traitance", "Sous-traitance", Simple, Icone: "🤝"),
            new("stock", "Stock", Simple, Icone: "📦"),
            new("sav", "SAV : équipements installés", Simple, Icone: "🛠", Aide: "Numéros de série posés chez les clients : garantie, retrait, remplacement"),
            new(SpecialisationRentabiliteBtp.Noeud, "Rentabilité", Lecture, Portee: true, Icone: "📈",
                Aide: "Suivi économique des chantiers ; portée : soi (chantiers dont on est chargé d'affaires, conducteur ou responsable de l'affaire) ou tout ; Modifier : recalculer"),
            new(SpecialisationRentabiliteBtp.NoeudCouts, "Coûts (PA / PR) dans le détail des chiffres", [ActionsDroits.Consulter],
                Aide: "Refusé : les PA et PR sont masqués dans la page des faits et le rapprochement (les autres écrans gardent leurs montants)"),
            new(SpecialisationRentabiliteBtp.NoeudPrevisions, "Saisies prévisionnelles", Simple,
                Aide: "Budget d'un avenant en négociation, facture non parvenue… : créer, modifier, solder, supprimer une saisie sur les chantiers visibles"),
            new(SpecialisationRentabiliteBtp.NoeudFacturation, "Prévisionnel de facturation", Lecture,
                Aide: "Montants à facturer par chantier et par mois ; Modifier : enregistrer une nouvelle version de la prévision"),
            new("comptabilite", "Comptabilité", Simple, Icone: "📒", Aide: "Plan comptable, comptes des tiers, TVA et catégories de TVA"),
            new("pointage", "Pointage MO", [ActionsDroits.Consulter, ActionsDroits.Modifier, ActionsDroits.Valider, ActionsDroits.Creer, ActionsDroits.Supprimer], Portee: true, Icone: "⏱",
                Aide: "Portée : soi (ses heures), son équipe (chef du jour), son service (responsable), tout"),
            new("pointage/saisie_libre", "Saisie libre du terrain", [ActionsDroits.Creer], Portee: true,
                Aide: "Travail non planifié saisi sur le terrain : soi (seul), son équipe (le chef compose l'équipe de la tâche)"),
            new("pointage/bornes", "Bornes d'atelier", Simple, Aide: "Appareils, PIN, paramétrage des bornes"),
            new(SpecialisationListeBtp.NoeudRepas, "Liste des repas des salariés", [ActionsDroits.Consulter], Aide: "Repas déclarés par salarié et par période (réservé aux droits RH) ; refusé : la liste des repas répond 403"),
            new("planning", "Planning", Simple, Icone: "📆"),
            new("terrain", "Application de terrain", [ActionsDroits.Consulter], Icone: "📱", Aide: "Ses tâches du planning, leur adresse, leur contact et les pièces diffusées sur le terrain"),
            new("terrain/livraison", "Réception de livraison sur le terrain", [ActionsDroits.Creer], Aide: "Bon de livraison en brouillon depuis une commande du chantier, validé au bureau"),
            new("terrain/demande", "Demandes d'approvisionnement sur le terrain", [ActionsDroits.Consulter, ActionsDroits.Creer],
                Aide: "Créer : demande depuis une tâche (ordre E_DAP brouillon) ; Consulter : onglet « Mes demandes »"),
            new("terrain/avancement", "Avancement des tâches sur le terrain", [ActionsDroits.Creer], Aide: "Avancement réel daté d'une tâche de son planning"),
            new("terrain/materiel", "Pointage des matériels sur le terrain", [ActionsDroits.Creer], Aide: "Heures d'engin, compteurs et pleins des matériels d'une tâche"),
            new("mail", "Messagerie", Simple, Icone: "📧"),
            new("connexions", "Connexions externes (OAuth)", Simple, Icone: "🔐"),
            new("parametres", "Paramètres", Lecture, Icone: "🛠",
                Aide: "Pages de paramétrage (/parametres) : Consulter pour les voir, Modifier pour les enregistrer ; comptes, profils et installation restent à l'administrateur"),
            new("administration", "Administration", Lecture, Icone: "⚙"),
            new("administration/profils", "Profils et droits", Lecture),
            new("administration/comptes", "Comptes utilisateurs", Lecture),
            new("administration/installation", "Installation (certificat, bases, sauvegardes)", Lecture),
        ]);
        return n;
    }

    public override IReadOnlyList<RouteDroits> Routes { get; } =
    [
        new("/api/sante", ModeRoute.Publique),
        new("/api/societe", ModeRoute.Publique),
        new("/api/oauth/retour", ModeRoute.Publique),
        new("/api/pointage/borne", ModeRoute.Publique),
        new("/api/auth", ModeRoute.Session),
        new("/api/auth/comptes", ModeRoute.Module, "administration/comptes"),
        new("/api/auth/personne", ModeRoute.Module, "administration/comptes"),
        new("/api/auth/personnes", ModeRoute.Module, "administration/comptes"),
        new("/api/auth/comptes-api", ModeRoute.Module, "administration/comptes"),
        new("/api/auth/exclusions", ModeRoute.Module, "administration/comptes"),
        new("/api/droits", ModeRoute.Session),
        new("/api/droits/catalogue", ModeRoute.Module, "administration/profils"),
        new("/api/droits/profils", ModeRoute.Module, "administration/profils"),
        new("/api/droits/journal", ModeRoute.Module, "administration/profils"),
        new("/api/modules", ModeRoute.Session),
        new("/api/listes-valeurs", ModeRoute.Session),
        new("/api/installation", ModeRoute.Module, "administration/installation"),
        new("/api/diffusion", ModeRoute.Session),
        new("/api/notifications", ModeRoute.Session),
        // Préférences du compte connecté (accueil) : chacun les siennes, sans nœud de droits.
        new("/api/preferences", ModeRoute.Session),
        // Pages de paramétrage : lecture (Consulter sur « parametres ») et écriture (Modifier). Seules les routes qui ne
        // servent que ces pages ; les référentiels lus aussi par les écrans métier restent sous leur module.
        new("/api/parametres-documents", ModeRoute.Parametrage),
        new("/api/regles-documents", ModeRoute.Parametrage),
        new("/api/types-document/numerotation", ModeRoute.Parametrage),
        new("/api/unites/parametrage", ModeRoute.Parametrage),
        new("/api/fiches/{type}/parametrage", ModeRoute.Parametrage),
        new("/api/fiches/{type}/chrono", ModeRoute.Parametrage),
        new("/api/crm/parametres", ModeRoute.Parametrage),
        new("/api/crm/statuts-visa", ModeRoute.Parametrage),
        new("/api/comptabilite/parametres", ModeRoute.Parametrage),
        new("/api/ged/parametres", ModeRoute.Parametrage),
        new("/api/ged/regles", ModeRoute.Parametrage),
        new("/api/mail/parametres", ModeRoute.Parametrage),
        new("/api/mail/regles", ModeRoute.Parametrage),
        new("/api/oauth/parametres", ModeRoute.Parametrage),
        new("/api/planning/parametres", ModeRoute.Parametrage),
        new("/api/pointage/parametres", ModeRoute.Parametrage),
        new("/api/pointage/sous-types", ModeRoute.Parametrage),
        new("/api/pointage/profils", ModeRoute.Parametrage),
        new("/api/stock/parametres", ModeRoute.Parametrage),
        new("/api/stock/clotures", ModeRoute.Parametrage),
        new("/api/editions-btp/mentions", ModeRoute.Parametrage),
        new("/api/editions/chartes", ModeRoute.Parametrage),
        new("/api/editions/defauts", ModeRoute.Parametrage),
        new("/api/execution/parcours-modeles", ModeRoute.Parametrage),
        new("/api/execution/sav-parametres", ModeRoute.Parametrage),
        new("/api/rentabilite/parametres", ModeRoute.Parametrage),
        new("/api/facture-electronique/parametres", ModeRoute.Parametrage),
        // Module Document : définitions et référentiels lus par la page document.
        new("/api/documents", ModeRoute.Module, "documents"),
        new("/api/calcul", ModeRoute.Module, "documents"),
        new("/api/cas-test", ModeRoute.Module, "documents"),
        new("/api/historique", ModeRoute.Module, "documents"),
        new("/api/lignes", ModeRoute.Module, "documents"),
        new("/api/types-document", ModeRoute.Module, "documents"),
        new("/api/vues-document", ModeRoute.Module, "documents"),
        new("/api/etiquettes-ligne", ModeRoute.Module, "documents"),
        new("/api/couleurs-type-prix", ModeRoute.Module, "documents"),
        new("/api/modeles-document", ModeRoute.Module, "documents"),
        new("/api/conditions-paiement", ModeRoute.Module, "documents"),
        new("/api/modes-reglement", ModeRoute.Module, "documents"),
        new("/api/unites", ModeRoute.Module, "documents"),
        new("/api/parametres-documents", ModeRoute.Module, "documents"),
        new("/api/regles-documents", ModeRoute.Module, "documents"),
        new("/api/comptes-comptables", ModeRoute.Module, "documents"),
        new("/api/fiches/{type}", ModeRoute.Module, "fiches/{type}"),
        new("/api/listes", ModeRoute.Module, "listes"),
        // Lectures des listes envoyées en POST (demande dans le corps) : consultation.
        new("/api/listes/lot", ModeRoute.Action, "listes", ActionsDroits.Consulter),
        new("/api/listes/segments", ModeRoute.Action, "listes", ActionsDroits.Consulter),
        new("/api/listes/controle", ModeRoute.Action, "listes", ActionsDroits.Consulter),
        new("/api/listes/agregats", ModeRoute.Action, "listes", ActionsDroits.Consulter),
        new("/api/listes/lignes", ModeRoute.Action, "listes", ActionsDroits.Consulter),
        new("/api/structure", ModeRoute.Module, "structure"),
        new("/api/annuaire", ModeRoute.Module, "annuaire"),
        new("/api/entreprises-fr", ModeRoute.Module, "annuaire"),
        new("/api/bibliotheque", ModeRoute.Module, "bibliotheque"),
        new("/api/ged", ModeRoute.Module, "ged"),
        new("/api/editions", ModeRoute.Module, "editions"),
        new("/api/editions-btp", ModeRoute.Module, "editions"),
        new("/api/ressources", ModeRoute.Module, "ressources"),
        new("/api/services", ModeRoute.Module, "ressources"),
        new("/api/calendriers", ModeRoute.Module, "calendriers"),
        new("/api/crm", ModeRoute.Module, "crm"),
        new("/api/reglements", ModeRoute.Module, "reglement"),
        // Module Relances : lecture et suspensions (écriture : toute action d'écriture) ; préparation (POST /lots) : Créer,
        // posé par DroitsRelancesBtp ; annulation de relances proposées : Créer ; envoi, relance notée et numéro : Valider.
        new("/api/relances", ModeRoute.Module, SpecialisationRelanceBtp.Noeud),
        new("/api/relances/lots/{id}/annuler", ModeRoute.Action, SpecialisationRelanceBtp.Noeud, ActionsDroits.Creer),
        new("/api/relances/lots/{id}/valider", ModeRoute.Action, SpecialisationRelanceBtp.Noeud, ActionsDroits.Valider),
        new("/api/relances/{id}/recommande", ModeRoute.Action, SpecialisationRelanceBtp.Noeud, ActionsDroits.Valider),
        new("/api/relances/notees", ModeRoute.Action, SpecialisationRelanceBtp.Noeud, ActionsDroits.Valider),
        // Module Facturation électronique : lecture (flux, détail, fichiers, chronologies, santé, vérification du journal)
        // Consulter ; actions sur un flux (nouvelle tentative, dépôt manuel confirmé, import, relève) : Modifier.
        new("/api/facture-electronique", ModeRoute.Module, SpecialisationFactureElectroniqueBtp.Noeud),
        new("/api/facture-electronique/flux/{id}/tentative", ModeRoute.Action, SpecialisationFactureElectroniqueBtp.Noeud, ActionsDroits.Modifier),
        new("/api/facture-electronique/flux/{id}/depot-manuel", ModeRoute.Action, SpecialisationFactureElectroniqueBtp.Noeud, ActionsDroits.Modifier),
        new("/api/facture-electronique/import", ModeRoute.Action, SpecialisationFactureElectroniqueBtp.Noeud, ActionsDroits.Modifier),
        new("/api/facture-electronique/releve", ModeRoute.Action, SpecialisationFactureElectroniqueBtp.Noeud, ActionsDroits.Modifier),
        new("/api/execution", ModeRoute.Module, "execution"),
        new("/api/liaisons", ModeRoute.Module, "planning"),
        new("/api/sous-traitance", ModeRoute.Module, "sous_traitance"),
        new("/api/stock", ModeRoute.Module, "stock"),
        new("/api/sav", ModeRoute.Module, "sav"),
        new("/api/comptabilite", ModeRoute.Module, "comptabilite"),
        new("/api/rentabilite", ModeRoute.Module, SpecialisationRentabiliteBtp.Noeud),
        new("/api/rentabilite/previsions", ModeRoute.Module, SpecialisationRentabiliteBtp.NoeudPrevisions),
        new("/api/rentabilite/facturation", ModeRoute.Module, SpecialisationRentabiliteBtp.NoeudFacturation),
        new("/api/stock/bornes", ModeRoute.Module, "pointage/bornes"),
        new("/api/pointage", ModeRoute.Module, "pointage"),
        new("/api/pointage/appareils", ModeRoute.Module, "pointage/bornes"),
        new("/api/pointage/pins", ModeRoute.Module, "pointage/bornes"),
        new("/api/planning", ModeRoute.Module, "planning"),
        new("/api/terrain", ModeRoute.Module, "terrain"),
        // Pointage de la journée sur le terrain : droit de saisie de ses heures (équipe et saisie libre contrôlées ensuite).
        new("/api/terrain/journee", ModeRoute.Action, "pointage", ActionsDroits.Modifier),
        // Étapes, avancement, non-conformités et photos : sur ses ordres et ses tâches seulement (contrôlé par la route).
        new("/api/terrain/etapes", ModeRoute.Action, "terrain", ActionsDroits.Consulter),
        new("/api/terrain/taches", ModeRoute.Action, "terrain", ActionsDroits.Consulter),
        // Réception de pose et demande d'approvisionnement : ordres et chantiers de son planning (contrôlé par la route ;
        // la demande crée un ordre E_DAP sous le droit CREER de son type). Réserves suivies et leur levée
        // (receptions/{ent}/reserves, terrain-suites lot 14) : mêmes règles que la réception.
        new("/api/terrain/receptions", ModeRoute.Action, "terrain", ActionsDroits.Consulter),
        // Demandes : nœud terrain/demande (Consulter : ses demandes ; Créer : nouvelle demande, posé par la route).
        new("/api/terrain/demandes", ModeRoute.Action, "terrain", ActionsDroits.Consulter),
        // Bibliothèque simplifiée (terrain-suites lot 17) : articles des demandes, nœud terrain/demande (Consulter).
        new("/api/terrain/bibliotheque", ModeRoute.Action, "terrain/demande", ActionsDroits.Consulter),
        // SAV du terrain : droit à part, refusé par défaut (T20).
        new("/api/terrain/sav", ModeRoute.Module, "execution/sav"),
        // Livraison : chantiers de son planning (contrôlé par la route), bon brouillon créé par le serveur.
        new("/api/terrain/livraisons", ModeRoute.Action, "terrain/livraison", ActionsDroits.Creer),
        new("/api/mail", ModeRoute.Module, "mail"),
        new("/api/oauth", ModeRoute.Module, "connexions"),
    ];

    private sealed record ProfilCompte(string Profil, int Nombre);

    public override async Task<IReadOnlyDictionary<string, int>> ComptesParProfilAsync(IServiceProvider services, CancellationToken ct) =>
        (await services.GetRequiredService<LogiBtpContext>().Database
            .SqlQueryRaw<ProfilCompte>("SELECT cpt_profil AS \"Profil\", COUNT(*)::int AS \"Nombre\" FROM compte GROUP BY cpt_profil").ToListAsync(ct))
        .ToDictionary(p => p.Profil, p => p.Nombre);
}
