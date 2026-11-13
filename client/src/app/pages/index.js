import { texte } from '@logibtp/socle/dictionnaire';
import { PageAccueil } from './accueil.js';
import { PageListe } from './liste.js';
import { PageFiche } from './fiche.js';
import { PageDocument } from './document.js';
import { PageFusionDocument } from './fusion-document.js';
import { PageGed } from './ged.js';
import { PageParametres } from './parametres.js';
import { PageParametresBibliotheque } from './parametres-bibliotheque.js';
import { PageParametresAnnuaire, PageNotreSociete } from './parametres-annuaire.js';
import { PageParametresDocuments } from './parametres-documents.js';
import { PageParametresSousTraitance } from './parametres-sous-traitance.js';
import { PageParametresRevision } from './parametres-revision.js';
import { PagePlanComptable, PageTiersComptables, PageParametresComptabilite, PageVentilation, PageExportComptable } from './comptabilite.js';
import { PageComparatifConsultation } from './consultation.js';
import { PageStock, PageMouvementStock } from '../stock/etat.js';
import { PageEtatValorise } from '../stock/etat-valorise.js';
import { PageClotures } from '../stock/clotures.js';
import { PageParametresStock } from '../stock/parametres.js';
import { PageInventaires, PageInventaire } from '../stock/inventaires.js';
import { PageApprovisionnement, PageProjection } from '../stock/approvisionnement.js';
import { PageMagasin, PageDotations, PageSaisiesAValider, PageFicheDotation } from '../stock/magasin.js';
import { PageLotStock } from '../stock/lot.js';
import { PageEquipement } from '../sav/equipement.js';
import { PageParametresGed } from './parametres-ged.js';
import { PageParametresRaccourcis } from './parametres-raccourcis.js';
import { PageGraphe } from './graphe.js';
import { PageIntrouvable } from './introuvable.js';
import { PageImportOptim } from './import-optim.js';
import { PageImportCarburant } from './import-carburant.js';
import { PageReglements } from './reglements.js';
import { PageRelances } from './relances.js';
import { PageParametresAgents, PageJournalAgents, PagePropositionsAgents, PagePropositionAgent } from './agents.js';
import { PageFactureElectronique } from './facture-electronique.js';
import { PageMarchesAFacturer } from './marches-a-facturer.js';
import { PageEdition } from './edition.js';
import { PageParametresEditions } from './parametres-editions.js';
import { PageParametresModules } from './parametres-modules.js';
import { PageParametresInstallation } from './parametres-installation.js';
import { PageParametresServices } from './parametres-services.js';
import { PageParametresReferentiels } from './parametres-referentiels.js';
import { PageCrm } from './crm.js';
import { PageNoteCrm } from './crm-note.js';
import { PageSuiviCrm } from './crm-suivi.js';
import { PageRappelsCrm } from './crm-rappels.js';
import { PageDemandesCrm } from './crm-demandes.js';
import { PageDemandeCrm } from './crm-demande.js';
import { PagePlansCrm } from './crm-plans.js';
import { PagePlanCrm } from './crm-plan.js';
import { PageDiffusionsCrm } from './crm-diffusions.js';
import { PageDiffusionCrm } from './crm-diffusion.js';
import { PageFilCrm } from './crm-fil.js';
import { PageParametresCrm } from './parametres-crm.js';
import { PageConnexion } from './connexion.js';
import { PageCompte } from './compte.js';
import { PageParametresComptes } from './parametres-comptes.js';
import { PageParametresDroits } from './parametres-droits.js';
import { PageParametresRessources } from './parametres-ressources.js';
import { PageHabilitations } from './habilitations.js';
import { PageRelevesAValider } from './releves-a-valider.js';
import { PageParametresCalendriers } from './parametres-calendriers.js';
import { PageNotifications, PageParametresNotifications } from './notifications.js';
import { PageParametresConnexions } from './parametres-connexions.js';
import { PageParametresMail } from './parametres-mail.js';
import { PageMail, PageMessageMail, PageRedactionMail } from './mail.js';
import { PageSyntheseExecution, PageExecutionChantier, PageParametresExecution, PageAtelierExecution } from './execution.js';
import { PageDelegationsControle } from '../execution/delegations.js';
import { PageRentabilite, PageRentabiliteFacturation, PageRentabiliteChantier, PageRentabiliteFaits, PageRentabiliteRapprochement, PageRentabiliteChangements, PageParametresRentabilite } from './rentabilite.js';
import { PageTerrain } from './terrain.js';
import { PageReceptionTerrain } from './terrain-reception.js';
import { PageSavTerrain } from './terrain-sav.js';
import { PagePlanningPrototype } from './planning-prototype.js';
import { PageBorne, PageParametresBornes, PageGroupePointage } from './borne.js';
import { PagePlanning, PageParametresPlanning } from './planning.js';
import { PageEquipes } from './planning-equipes.js';
import { PageRestaurantsPointage } from './restaurants.js';
import { PageSaisiePointage, PageSynthesePointage, PageExportPointage, PageParametresPointage, PageCongesPointage } from './pointage.js';

// Routes de l'application. Chaque URL désigne un écran précis : elle se partage, se rouvre dans une autre fenêtre
// et sert à restaurer la session.
export const ROUTES = [
  { nom: 'accueil', chemin: '/', page: PageAccueil, titre: texte('pages_btp.accueil.titre') },
  { nom: 'connexion', chemin: '/connexion', page: PageConnexion, titre: texte('authentification_btp.connexion.titre') },
  { nom: 'compte', chemin: '/compte', page: PageCompte, titre: texte('authentification_btp.mon_compte.titre') },
  { nom: 'liste', chemin: '/liste/:theme?', page: PageListe, titre: texte('pages_btp.liste.titre') },
  { nom: 'fiche', chemin: '/fiche/:type/:id', page: PageFiche, titre: texte('pages_btp.routes.fiche') },
  { nom: 'document', chemin: '/document/:id', page: PageDocument, titre: texte('pages_btp.routes.document') },
  { nom: 'fusion-document', chemin: '/fusion/document/:id', page: PageFusionDocument, titre: texte('hors_ligne_btp.routes.fusion') },
  { nom: 'ged', chemin: '/ged/:id?', page: PageGed, titre: texte('pages_btp.ged.titre') },
  { nom: 'parametres', chemin: '/parametres', page: PageParametres, titre: texte('parametres_btp.general.titre') },
  { nom: 'parametres-bibliotheque', chemin: '/parametres/bibliotheque', page: PageParametresBibliotheque, titre: texte('parametres_btp.bibliotheque.titre') },
  { nom: 'parametres-annuaire', chemin: '/parametres/annuaire', page: PageParametresAnnuaire, titre: texte('parametres_btp.annuaire.titre') },
  { nom: 'parametres-documents', chemin: '/parametres/documents', page: PageParametresDocuments, titre: texte('parametres_btp.documents.titre') },
  { nom: 'parametres-revision', chemin: '/parametres/revision', page: PageParametresRevision, titre: texte('revision_btp.routes.parametres') },
  { nom: 'parametres-sous-traitance', chemin: '/parametres/sous-traitance', page: PageParametresSousTraitance, titre: texte('sous_traitance_btp.routes.parametres') },
  { nom: 'consultation-comparatif', chemin: '/consultation/comparatif', page: PageComparatifConsultation, titre: texte('sous_traitance_btp.routes.comparatif') },
  { nom: 'stock', chemin: '/stock', page: PageStock, titre: texte('stock_btp.routes.stock') },
  { nom: 'etat-valorise', chemin: '/stock/etat-valorise', page: PageEtatValorise, titre: texte('stock_btp.routes.etat_valorise') },
  { nom: 'clotures-stock', chemin: '/stock/clotures', page: PageClotures, titre: texte('stock_btp.routes.clotures') },
  { nom: 'mouvement-stock', chemin: '/stock/mouvement/:id', page: PageMouvementStock, titre: texte('stock_btp.routes.mouvement') },
  { nom: 'lot-stock', chemin: '/stock/lot/:id', page: PageLotStock, titre: texte('stock_btp.routes.lot') },
  { nom: 'equipement', chemin: '/sav/equipement/:id', page: PageEquipement, titre: texte('sav_btp.routes.equipement') },
  { nom: 'inventaires', chemin: '/stock/inventaires', page: PageInventaires, titre: texte('stock_btp.routes.inventaires') },
  { nom: 'inventaire', chemin: '/stock/inventaire/:id', page: PageInventaire, titre: texte('stock_btp.routes.inventaire') },
  { nom: 'approvisionnement', chemin: '/stock/approvisionnement', page: PageApprovisionnement, titre: texte('stock_btp.routes.approvisionnement') },
  { nom: 'projection-stock', chemin: '/stock/projection', page: PageProjection, titre: texte('stock_btp.routes.projection') },
  { nom: 'magasin', chemin: '/stock/magasin', page: PageMagasin, titre: texte('stock_btp.routes.magasin') },
  { nom: 'dotations', chemin: '/stock/dotations', page: PageDotations, titre: texte('stock_btp.routes.dotations') },
  { nom: 'saisies-stock', chemin: '/stock/a-valider', page: PageSaisiesAValider, titre: texte('stock_btp.routes.a_valider') },
  { nom: 'fiche-dotation', chemin: '/stock/dotations/fiche', page: PageFicheDotation, titre: texte('stock_btp.routes.fiche_dotation') },
  { nom: 'parametres-stock', chemin: '/parametres/stock', page: PageParametresStock, titre: texte('stock_btp.routes.parametres') },
  { nom: 'comptabilite-plan', chemin: '/comptabilite/plan', page: PagePlanComptable, titre: texte('comptabilite_btp.routes.plan') },
  { nom: 'comptabilite-tiers', chemin: '/comptabilite/tiers', page: PageTiersComptables, titre: texte('comptabilite_btp.routes.tiers') },
  { nom: 'comptabilite-export', chemin: '/comptabilite/export', page: PageExportComptable, titre: texte('comptabilite_btp.routes.export') },
  { nom: 'comptabilite-ventilation', chemin: '/comptabilite/ventilation', page: PageVentilation, titre: texte('comptabilite_btp.routes.ventilation') },
  { nom: 'parametres-comptabilite', chemin: '/parametres/comptabilite', page: PageParametresComptabilite, titre: texte('comptabilite_btp.routes.parametres') },
  { nom: 'parametres-ged', chemin: '/parametres/ged', page: PageParametresGed, titre: texte('parametres_btp.ged.titre') },
  { nom: 'parametres-editions', chemin: '/parametres/editions', page: PageParametresEditions, titre: texte('edition_btp.routes.parametres') },
  { nom: 'parametres-modules', chemin: '/parametres/modules', page: PageParametresModules, titre: texte('parametres_btp.modules.titre') },
  { nom: 'parametres-ressources', chemin: '/parametres/ressources', page: PageParametresRessources, titre: texte('ressources_btp.parametres.titre') },
  { nom: 'execution-synthese', chemin: '/execution/synthese', page: PageSyntheseExecution, titre: texte('execution_btp.routes.synthese') },
  { nom: 'execution-chantier', chemin: '/execution/chantier/:id', page: PageExecutionChantier, titre: texte('execution_btp.routes.chantier') },
  { nom: 'execution-atelier', chemin: '/execution/atelier', page: PageAtelierExecution, titre: texte('execution_btp.routes.atelier') },
  { nom: 'execution-delegations', chemin: '/execution/delegations', page: PageDelegationsControle, titre: texte('execution_btp.routes.delegations') },
  { nom: 'terrain', chemin: '/terrain', page: PageTerrain, titre: texte('terrain_btp.page.titre') },
  { nom: 'terrain-reception', chemin: '/terrain/reception/:id', page: PageReceptionTerrain, titre: texte('terrain_btp.reception.titre') },
  { nom: 'terrain-sav', chemin: '/terrain/sav/:id', page: PageSavTerrain, titre: texte('terrain_btp.sav_page.titre') },
  { nom: 'rentabilite', chemin: '/rentabilite', page: PageRentabilite, titre: texte('rentabilite_btp.routes.accueil') },
  { nom: 'rentabilite-facturation', chemin: '/rentabilite/facturation', page: PageRentabiliteFacturation, titre: texte('rentabilite_btp.routes.facturation') },
  { nom: 'rentabilite-chantier', chemin: '/rentabilite/chantier/:id', page: PageRentabiliteChantier, titre: texte('rentabilite_btp.routes.chantier') },
  { nom: 'rentabilite-faits', chemin: '/rentabilite/faits', page: PageRentabiliteFaits, titre: texte('rentabilite_btp.routes.faits') },
  { nom: 'rentabilite-rapprochement', chemin: '/rentabilite/rapprochement/:id', page: PageRentabiliteRapprochement, titre: texte('rentabilite_btp.routes.rapprochement') },
  { nom: 'rentabilite-changements', chemin: '/rentabilite/changements/:id', page: PageRentabiliteChangements, titre: texte('rentabilite_btp.routes.changements') },
  { nom: 'parametres-rentabilite', chemin: '/parametres/rentabilite', page: PageParametresRentabilite, titre: texte('rentabilite_btp.routes.parametres') },
  { nom: 'parametres-execution', chemin: '/parametres/execution', page: PageParametresExecution, titre: texte('execution_btp.routes.parametres') },
  { nom: 'borne', chemin: '/borne', page: PageBorne, titre: texte('pointage.routes.borne') },
  { nom: 'parametres-bornes', chemin: '/parametres/bornes', page: PageParametresBornes, titre: texte('pointage.routes.parametres_bornes') },
  { nom: 'pointage-groupe', chemin: '/pointage/groupe', page: PageGroupePointage, titre: texte('pointage.routes.pointage_groupe') },
  { nom: 'planning', chemin: '/planning', page: PagePlanning, titre: texte('planning_btp.routes.planning') },
  { nom: 'planning-prototype', chemin: '/planning/prototype', page: PagePlanningPrototype, titre: texte('planning_btp.routes.prototype') },
  { nom: 'parametres-planning', chemin: '/parametres/planning', page: PageParametresPlanning, titre: texte('planning_btp.routes.parametres') },
  { nom: 'planning-equipes', chemin: '/planning/equipes', page: PageEquipes, titre: texte('planning_btp.routes.equipes') },
  { nom: 'pointage-saisie', chemin: '/pointage/saisie', page: PageSaisiePointage, titre: texte('pointage.routes.pointage_saisie') },
  { nom: 'pointage-synthese', chemin: '/pointage/synthese', page: PageSynthesePointage, titre: texte('pointage.routes.pointage_synthese') },
  { nom: 'pointage-export', chemin: '/pointage/export', page: PageExportPointage, titre: texte('pointage.routes.pointage_export') },
  { nom: 'pointage-conges', chemin: '/pointage/conges', page: PageCongesPointage, titre: texte('pointage.routes.pointage_conges') },
  { nom: 'pointage-restaurants', chemin: '/pointage/restaurants', page: PageRestaurantsPointage, titre: texte('pointage.routes.pointage_restaurants') },
  { nom: 'parametres-pointage', chemin: '/parametres/pointage', page: PageParametresPointage, titre: texte('pointage.routes.parametres_pointage') },
  { nom: 'notifications', chemin: '/notifications', page: PageNotifications, titre: texte('notifications_btp.boite.titre') },
  { nom: 'parametres-notifications', chemin: '/parametres/notifications', page: PageParametresNotifications, titre: texte('notifications_btp.preferences.titre') },
  { nom: 'parametres-mail', chemin: '/parametres/mail', page: PageParametresMail, titre: texte('mail_btp.routes.parametres') },
  { nom: 'mail', chemin: '/mail', page: PageMail, titre: texte('mail_btp.routes.mail') },
  { nom: 'mail-nouveau', chemin: '/mail/nouveau', page: PageRedactionMail, titre: texte('mail_btp.routes.nouveau') },
  { nom: 'mail-message', chemin: '/mail/message/:id', page: PageMessageMail, titre: texte('mail_btp.routes.message') },
  { nom: 'parametres-connexions', chemin: '/parametres/connexions', page: PageParametresConnexions, titre: texte('oauth_btp.connexions.titre') },
  { nom: 'parametres-calendriers', chemin: '/parametres/calendriers', page: PageParametresCalendriers, titre: texte('calendrier_btp.routes.calendriers') },
  { nom: 'releves-a-valider', chemin: '/ressources/releves-a-valider', page: PageRelevesAValider, titre: texte('ressources_btp.releves_a_valider.titre') },
  { nom: 'habilitations', chemin: '/ressources/habilitations', page: PageHabilitations, titre: texte('ressources_btp.surveiller.titre') },
  { nom: 'parametres-comptes', chemin: '/parametres/comptes', page: PageParametresComptes, titre: texte('authentification_btp.comptes.titre') },
  { nom: 'parametres-installation', chemin: '/parametres/installation', page: PageParametresInstallation, titre: texte('parametres_btp.installation.titre') },
  { nom: 'parametres-droits', chemin: '/parametres/droits', page: PageParametresDroits, titre: texte('droits_btp.profils.titre') },
  { nom: 'parametres-services', chemin: '/parametres/services', page: PageParametresServices, titre: texte('parametres_btp.services.titre') },
  { nom: 'parametres-referentiels', chemin: '/parametres/referentiels', page: PageParametresReferentiels, titre: texte('parametres_btp.referentiels.titre') },
  { nom: 'parametres-crm', chemin: '/parametres/crm', page: PageParametresCrm, titre: texte('crm_btp.routes.parametres_crm') },
  { nom: 'parametres-raccourcis', chemin: '/parametres/raccourcis', page: PageParametresRaccourcis, titre: texte('parametres_btp.general.raccourcis.titre') },
  { nom: 'graphe', chemin: '/annuaire/graphe', page: PageGraphe, titre: texte('pages_btp.routes.graphe') },
  { nom: 'notre-societe', chemin: '/annuaire/societe', page: PageNotreSociete, titre: texte('parametres_btp.societe.titre') },
  { nom: 'import-optim', chemin: '/import/optimbtp', page: PageImportOptim, titre: texte('import_btp.routes.optim') },
  { nom: 'import-carburant', chemin: '/import/carburant', page: PageImportCarburant, titre: texte('import_btp.routes.carburant') },
  { nom: 'reglements', chemin: '/reglements', page: PageReglements, titre: texte('reglements_btp.routes.reglements') },
  { nom: 'relances', chemin: '/relances', page: PageRelances, titre: texte('relances_btp.routes.relances') },
  // Module MCP (agents IA, plans/mcp.md lot 11) : propositions, journal, levées par profil ; délégations dans Mon compte (#agents).
  { nom: 'agents-propositions', chemin: '/agents/propositions', page: PagePropositionsAgents, titre: texte('agents_btp.routes.propositions') },
  { nom: 'agents-proposition', chemin: '/agents/propositions/:id', page: PagePropositionAgent, titre: texte('agents_btp.routes.propositions') },
  { nom: 'agents-journal', chemin: '/agents/journal', page: PageJournalAgents, titre: texte('agents_btp.routes.journal') },
  { nom: 'parametres-agents', chemin: '/parametres/agents', page: PageParametresAgents, titre: texte('agents_btp.routes.parametres') },
  { nom: 'facture-electronique', chemin: '/facture-electronique', page: PageFactureElectronique, titre: texte('facture_electronique_btp.routes.page') },
  { nom: 'marches-a-facturer', chemin: '/marches/a-facturer', page: PageMarchesAFacturer, titre: texte('structure_btp.routes.marches_a_facturer') },
  { nom: 'crm-note', chemin: '/crm/note/:id', page: PageNoteCrm, titre: texte('crm_btp.routes.note') },
  { nom: 'crm-suivi', chemin: '/crm/suivi', page: PageSuiviCrm, titre: texte('crm_btp.routes.suivi') },
  { nom: 'crm-rappels', chemin: '/crm/rappels', page: PageRappelsCrm, titre: texte('crm_btp.routes.rappels') },
  { nom: 'crm-demandes', chemin: '/crm/demandes', page: PageDemandesCrm, titre: texte('crm_btp.routes.demandes') },
  { nom: 'crm-demande', chemin: '/crm/demande/:id', page: PageDemandeCrm, titre: texte('crm_btp.routes.demande') },
  { nom: 'crm-plans', chemin: '/crm/plans', page: PagePlansCrm, titre: texte('crm_btp.routes.plans') },
  { nom: 'crm-plan', chemin: '/crm/plan/:id', page: PagePlanCrm, titre: texte('crm_btp.routes.plan') },
  { nom: 'crm-diffusions', chemin: '/crm/diffusions', page: PageDiffusionsCrm, titre: texte('crm_btp.routes.diffusions') },
  { nom: 'crm-diffusion', chemin: '/crm/diffusion/:id', page: PageDiffusionCrm, titre: texte('crm_btp.routes.diffusion') },
  { nom: 'crm-fil', chemin: '/crm/fil', page: PageFilCrm, titre: texte('crm_btp.routes.fil') },
  { nom: 'crm', chemin: '/crm', page: PageCrm, titre: texte('crm_btp.routes.crm') },
  { nom: 'edition', chemin: '/edition', page: PageEdition, titre: texte('edition_btp.routes.apercu') },
  { nom: '404', chemin: '/404', page: PageIntrouvable, titre: texte('pages_btp.introuvable.titre') },
];
