import { texte, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { TYPE_FICHE, MODULE_FACULTATIF } from '../codes.js';
import { Bandeau, DISPOSITION_MENU } from '@logibtp/navigation/ui';
import { THEMES, DENSITES } from '@logibtp/socle/ui';

// Menus du bandeau, regroupés par classe de métier, et catalogue des raccourcis de l'accueil (tous les éléments
// de menu ayant une URL). Les menus Fenêtres et Paramètres sont construits à l'ouverture (état courant).

const L = (theme) => `/liste/${theme}`;
/** Positions du menu (sous-menu Paramètres › Position du menu). */
const POSITIONS_MENU = [
  { mode: DISPOSITION_MENU.HAUT, libelle: texte('navigation_btp.positions.haut'), iconeHtml: iconeHtml('navigation_btp_menu_haut') },
  { mode: DISPOSITION_MENU.GAUCHE, libelle: texte('navigation_btp.positions.gauche'), iconeHtml: iconeHtml('navigation_btp_menu_gauche') },
  { mode: DISPOSITION_MENU.DROITE, libelle: texte('navigation_btp.positions.droite'), iconeHtml: iconeHtml('navigation_btp_menu_droite') },
];
/** Création rapide (bouton ＋ sur la ligne du menu) : fiche ou document. */
const F = (type, titre, requete = '') => ({ url: `/fiche/${type}/nouveau${requete}`, titre });
const D = (code, titre) => ({ url: `/document/nouveau?type=${code}`, titre });

/** Menus métier (statiques). */
export const MENUS_METIER = [
  {
    code: 'ressources', libelle: texte('navigation_btp.menus.ressources.libelle'), court: texte('navigation_btp.menus.ressources.court'), droit: 'ressources', elements: [
      { code: 'ressources', libelle: texte('navigation_btp.menus.ressources.ressources.libelle'), iconeHtml: iconeHtml('navigation_btp_ressources'), iconeHtml: iconeHtml('navigation_btp_ressources'), url: L('ressources'), info: texte('navigation_btp.menus.ressources.ressources.info') },
      { separateur: true },
      { code: 'salaries', libelle: texte('navigation_btp.menus.ressources.salaries.libelle'), iconeHtml: iconeHtml('navigation_btp_salaries'), url: L('salaries'), creation: F(TYPE_FICHE.SALARIE, texte('navigation_btp.menus.ressources.salaries.creation')) },
      { code: 'materiels', libelle: texte('navigation_btp.menus.ressources.materiels.libelle'), iconeHtml: iconeHtml('navigation_btp_materiels'), url: L('materiels'), creation: F(TYPE_FICHE.MATERIEL, texte('navigation_btp.menus.ressources.materiels.creation')) },
      { separateur: true },
      { code: 'habilitations', libelle: texte('navigation_btp.menus.ressources.habilitations.libelle'), iconeHtml: iconeHtml('navigation_btp_habilitations'), url: '/ressources/habilitations', info: texte('navigation_btp.menus.ressources.habilitations.info') },
      { code: 'parametrage-ressources', libelle: texte('navigation_btp.menus.ressources.parametrage_ressources.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_ressources'), url: '/parametres/ressources' },
    ],
  },
  {
    code: 'annuaire', libelle: texte('navigation_btp.menus.annuaire.libelle'), droit: 'annuaire', elements: [
      { code: 'tiers', libelle: texte('navigation_btp.menus.annuaire.tiers.libelle'), iconeHtml: iconeHtml('navigation_btp_tiers'), url: '/liste/tiers?vue=20', info: texte('navigation_btp.menus.annuaire.tiers.info'), creation: F(TYPE_FICHE.PERSONNE, texte('navigation_btp.menus.annuaire.tiers.creation')) },
      { code: 'clients', libelle: texte('navigation_btp.menus.annuaire.clients.libelle'), iconeHtml: iconeHtml('navigation_btp_clients'), url: '/liste/tiers?vue=21', creation: F(TYPE_FICHE.PERSONNE, texte('navigation_btp.menus.annuaire.clients.creation'), '?casquette=CLIENT') },
      { code: 'fournisseurs', libelle: texte('navigation_btp.menus.annuaire.fournisseurs.libelle'), iconeHtml: iconeHtml('navigation_btp_fournisseurs'), url: '/liste/tiers?vue=22', creation: F(TYPE_FICHE.PERSONNE, texte('navigation_btp.menus.annuaire.fournisseurs.creation'), '?casquette=FOURNISSEUR') },
      { code: 'sous-traitants', libelle: texte('navigation_btp.menus.annuaire.sous_traitants.libelle'), iconeHtml: iconeHtml('navigation_btp_sous_traitants'), url: '/liste/tiers?vue=23', creation: F(TYPE_FICHE.PERSONNE, texte('navigation_btp.menus.annuaire.sous_traitants.creation'), '?casquette=SOUS_TRAITANT') },
      { code: 'prescripteurs', libelle: texte('navigation_btp.menus.annuaire.prescripteurs.libelle'), iconeHtml: iconeHtml('navigation_btp_prescripteurs'), url: '/liste/tiers?vue=24', creation: F(TYPE_FICHE.PERSONNE, texte('navigation_btp.menus.annuaire.prescripteurs.creation'), '?casquette=ARCHITECTE') },
      { separateur: true },
      { code: 'contacts', libelle: texte('navigation_btp.menus.annuaire.contacts.libelle'), iconeHtml: iconeHtml('navigation_btp_contacts'), url: '/liste/contacts?vue=25', creation: F(TYPE_FICHE.INDIVIDU, texte('navigation_btp.menus.annuaire.contacts.creation')) },
      { code: 'equipe-interne', libelle: texte('navigation_btp.menus.annuaire.equipe_interne.libelle'), iconeHtml: iconeHtml('navigation_btp_equipe_interne'), url: '/liste/contacts?vue=26', creation: F(TYPE_FICHE.INDIVIDU, texte('navigation_btp.menus.annuaire.equipe_interne.creation')) },
      { separateur: true },
      { code: 'graphe-relations', libelle: texte('navigation_btp.menus.annuaire.graphe_relations.libelle'), iconeHtml: iconeHtml('navigation_btp_graphe_relations'), url: '/annuaire/graphe', info: texte('navigation_btp.menus.annuaire.graphe_relations.info') },
      { code: 'notre-societe', libelle: texte('navigation_btp.menus.annuaire.notre_societe.libelle'), iconeHtml: iconeHtml('navigation_btp_notre_societe'), url: '/annuaire/societe', info: texte('navigation_btp.menus.annuaire.notre_societe.info') },
      { code: 'parametrage-annuaire', libelle: texte('navigation_btp.menus.annuaire.parametrage_annuaire.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_annuaire'), url: '/parametres/annuaire' },
    ],
  },
  {
    code: 'bibliotheque', libelle: texte('navigation_btp.menus.bibliotheque.libelle'), court: texte('navigation_btp.menus.bibliotheque.court'), droit: 'bibliotheque', elements: [
      { code: 'articles', libelle: texte('navigation_btp.menus.bibliotheque.articles.libelle'), iconeHtml: iconeHtml('navigation_btp_articles'), url: '/liste/bibliotheque?vue=12', creation: F(TYPE_FICHE.ELEMENT, texte('navigation_btp.menus.bibliotheque.articles.creation')) },
      { code: 'ouvrages', libelle: texte('navigation_btp.menus.bibliotheque.ouvrages.libelle'), iconeHtml: iconeHtml('navigation_btp_ouvrages'), url: '/liste/bibliotheque?vue=13', creation: F(TYPE_FICHE.ELEMENT, texte('navigation_btp.menus.bibliotheque.ouvrages.creation'), '?type=OUVRAGE') },
      { code: 'ensembles', libelle: texte('navigation_btp.menus.bibliotheque.ensembles.libelle'), iconeHtml: iconeHtml('navigation_btp_ensembles'), url: '/liste/bibliotheque?vue=15', creation: F(TYPE_FICHE.ELEMENT, texte('navigation_btp.menus.bibliotheque.ensembles.creation'), '?type=ENSEMBLE') },
      { code: 'textes', libelle: texte('navigation_btp.menus.bibliotheque.textes.libelle'), iconeHtml: iconeHtml('navigation_btp_textes'), url: '/liste/bibliotheque?vue=1400', creation: F(TYPE_FICHE.ELEMENT, texte('navigation_btp.menus.bibliotheque.textes.creation'), '?type=TEXTE') },
      { code: 'elements', libelle: texte('navigation_btp.menus.bibliotheque.elements.libelle'), iconeHtml: iconeHtml('navigation_btp_elements'), url: '/liste/bibliotheque?vue=14', creation: F(TYPE_FICHE.ELEMENT, texte('navigation_btp.menus.bibliotheque.elements.creation')) },
      { separateur: true },
      { code: 'parametrage-bibliotheque', libelle: texte('navigation_btp.menus.bibliotheque.parametrage_bibliotheque.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_bibliotheque'), url: '/parametres/bibliotheque' },
    ],
  },
  {
    code: 'affaires', libelle: texte('navigation_btp.menus.affaires.libelle'), droit: 'structure', elements: [
      { code: 'projets', libelle: texte('navigation_btp.menus.affaires.projets.libelle'), iconeHtml: iconeHtml('navigation_btp_projets'), url: L('projets'), creation: F(TYPE_FICHE.PROJET, texte('navigation_btp.menus.affaires.projets.creation')) },
      { code: 'affaires', libelle: texte('navigation_btp.menus.affaires.affaires.libelle'), iconeHtml: iconeHtml('navigation_btp_affaires'), url: L('affaires'), info: texte('navigation_btp.menus.affaires.affaires.info'), creation: F(TYPE_FICHE.AFFAIRE, texte('navigation_btp.menus.affaires.affaires.creation')) },
      { code: 'chantiers', libelle: texte('navigation_btp.menus.affaires.chantiers.libelle'), iconeHtml: iconeHtml('navigation_btp_chantiers'), url: L('chantiers'), creation: F(TYPE_FICHE.CHANTIER, texte('navigation_btp.menus.affaires.chantiers.creation')) },
      { code: 'marches', libelle: texte('navigation_btp.menus.affaires.marches.libelle'), iconeHtml: iconeHtml('navigation_btp_marches'), url: L('marches'), info: texte('navigation_btp.menus.affaires.marches.info'), creation: F(TYPE_FICHE.MARCHE, texte('navigation_btp.menus.affaires.marches.creation')) },
      { code: 'revision-prix', libelle: texte('navigation_btp.menus.affaires.revision_prix.libelle'), iconeHtml: iconeHtml('navigation_btp_revision_prix'), url: '/parametres/revision', info: texte('navigation_btp.menus.affaires.revision_prix.info') },
      { separateur: true, module: MODULE_FACULTATIF.RENTABILITE, droit: 'rentabilite' },
      { code: 'rentabilite', libelle: texte('navigation_btp.menus.affaires.rentabilite.libelle'), iconeHtml: iconeHtml('navigation_btp_rentabilite'), url: '/rentabilite', info: texte('navigation_btp.menus.affaires.rentabilite.info'), module: MODULE_FACULTATIF.RENTABILITE, droit: 'rentabilite' },
      { code: 'rentabilite-facturation', libelle: texte('navigation_btp.menus.affaires.rentabilite_facturation.libelle'), iconeHtml: iconeHtml('navigation_btp_rentabilite_facturation'), url: '/rentabilite/facturation', info: texte('navigation_btp.menus.affaires.rentabilite_facturation.info'), module: MODULE_FACULTATIF.RENTABILITE, droit: 'rentabilite' },
      { code: 'parametrage-rentabilite', libelle: texte('navigation_btp.menus.affaires.parametrage_rentabilite.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_rentabilite'), url: '/parametres/rentabilite', module: MODULE_FACULTATIF.RENTABILITE, droit: 'rentabilite' },
    ],
  },
  {
    code: 'ventes', libelle: texte('navigation_btp.menus.ventes.libelle'), droit: 'documents/V', elements: [
      { code: 'devis', libelle: texte('navigation_btp.menus.ventes.devis.libelle'), iconeHtml: iconeHtml('navigation_btp_devis'), url: L('devis'), creation: D('V_DEVIS', texte('navigation_btp.menus.ventes.devis.creation')) },
      { code: 'commandes', libelle: texte('navigation_btp.menus.ventes.commandes.libelle'), iconeHtml: iconeHtml('navigation_btp_commandes'), url: L('commandes'), creation: D('V_COMMANDE', texte('navigation_btp.menus.ventes.commandes.creation')) },
      { code: 'livraisons', libelle: texte('navigation_btp.menus.ventes.livraisons.libelle'), iconeHtml: iconeHtml('navigation_btp_livraisons'), url: L('livraisons'), creation: D('V_RECEPTION', texte('navigation_btp.menus.ventes.livraisons.creation')) },
      { code: 'situations', libelle: texte('navigation_btp.menus.ventes.situations.libelle'), iconeHtml: iconeHtml('navigation_btp_situations'), url: L('situations'), creation: D('V_SITUATION', texte('navigation_btp.menus.ventes.situations.creation')) },
      { code: 'marches-a-facturer', libelle: texte('navigation_btp.menus.ventes.marches_a_facturer.libelle'), iconeHtml: iconeHtml('navigation_btp_marches_a_facturer'), url: '/marches/a-facturer', droit: 'structure', info: texte('navigation_btp.menus.ventes.marches_a_facturer.info') },
      { code: 'factures', libelle: texte('navigation_btp.menus.ventes.factures.libelle'), iconeHtml: iconeHtml('navigation_btp_factures'), url: L('factures'), creation: D('V_FACTURE', texte('navigation_btp.menus.ventes.factures.creation')) },
      { code: 'documents', libelle: texte('navigation_btp.menus.ventes.documents.libelle'), iconeHtml: iconeHtml('navigation_btp_documents'), url: L('documents') },
      { code: 'reglements-clients', libelle: texte('navigation_btp.menus.ventes.reglements_clients.libelle'), iconeHtml: iconeHtml('navigation_btp_reglements_clients'), url: '/reglements?sens=E', info: texte('navigation_btp.menus.ventes.reglements_clients.info'), module: MODULE_FACULTATIF.REGLEMENT },
      { separateur: true },
      { code: 'import-optim', libelle: texte('navigation_btp.menus.ventes.import_optim.libelle'), iconeHtml: iconeHtml('navigation_btp_import_optim'), url: '/import/optimbtp', info: texte('navigation_btp.menus.ventes.import_optim.info') },
    ],
  },
  {
    code: 'achats', libelle: texte('navigation_btp.menus.achats.libelle'), droit: 'documents/A', elements: [
      { code: 'ddp', libelle: texte('navigation_btp.menus.achats.ddp.libelle'), iconeHtml: iconeHtml('navigation_btp_ddp'), url: L('achats_ddp'), creation: D('A_DEVIS', texte('navigation_btp.menus.achats.ddp.creation')) },
      { code: 'commandes-fournisseurs', libelle: texte('navigation_btp.menus.achats.commandes_fournisseurs.libelle'), iconeHtml: iconeHtml('navigation_btp_commandes_fournisseurs'), url: L('achats_commandes'), creation: D('A_COMMANDE', texte('navigation_btp.menus.achats.commandes_fournisseurs.creation')) },
      { code: 'livraisons-fournisseurs', libelle: texte('navigation_btp.menus.achats.livraisons_fournisseurs.libelle'), iconeHtml: iconeHtml('navigation_btp_livraisons_fournisseurs'), url: L('achats_livraisons'), creation: D('A_RECEPTION', texte('navigation_btp.menus.achats.livraisons_fournisseurs.creation')) },
      { code: 'factures-fournisseurs', libelle: texte('navigation_btp.menus.achats.factures_fournisseurs.libelle'), iconeHtml: iconeHtml('navigation_btp_factures_fournisseurs'), url: L('achats_factures'), creation: D('A_FACTURE', texte('navigation_btp.menus.achats.factures_fournisseurs.creation')) },
      { separateur: true, libelle: texte('navigation_btp.menus.achats.titre_demandes_execution.libelle') },
      { code: 'achats-dac', libelle: texte('navigation_btp.menus.achats.achats_dac.libelle'), iconeHtml: iconeHtml('navigation_btp_achats_dac'), url: '/liste/ordres?vue=1107', module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', type: 'E_DAC', creation: D('E_DAC', texte('navigation_btp.menus.achats.achats_dac.creation')) },
      { code: 'achats-dap', libelle: texte('navigation_btp.menus.achats.achats_dap.libelle'), iconeHtml: iconeHtml('navigation_btp_achats_dap'), url: '/liste/ordres?vue=1003', module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', type: 'E_DAP', creation: D('E_DAP', texte('navigation_btp.menus.achats.achats_dap.creation')) },
      { separateur: true },
      { code: 'reglements-fournisseurs', libelle: texte('navigation_btp.menus.achats.reglements_fournisseurs.libelle'), iconeHtml: iconeHtml('navigation_btp_reglements_fournisseurs'), url: '/reglements?sens=D', info: texte('navigation_btp.menus.achats.reglements_fournisseurs.info'), module: MODULE_FACULTATIF.REGLEMENT },
    ],
  },
  {
    code: 'sous-traitance', libelle: texte('navigation_btp.menus.sous_traitance.libelle'), court: texte('navigation_btp.menus.sous_traitance.court'), module: MODULE_FACULTATIF.SOUS_TRAITANCE, droit: 'sous_traitance', elements: [
      { code: 'st-ao', libelle: texte('navigation_btp.menus.sous_traitance.st_ao.libelle'), iconeHtml: iconeHtml('navigation_btp_st_ao'), url: L('st_ao'), type: 'T_AO', creation: D('T_AO', texte('navigation_btp.menus.sous_traitance.st_ao.creation')) },
      { code: 'st-commandes', libelle: texte('navigation_btp.menus.sous_traitance.st_commandes.libelle'), iconeHtml: iconeHtml('navigation_btp_st_commandes'), url: L('st_commandes'), type: 'T_COMMANDE', creation: D('T_COMMANDE', texte('navigation_btp.menus.sous_traitance.st_commandes.creation')) },
      { code: 'st-factures', libelle: texte('navigation_btp.menus.sous_traitance.st_factures.libelle'), iconeHtml: iconeHtml('navigation_btp_st_factures'), url: L('st_factures'), type: 'T_FACTURE_AVT' },
      { code: 'st-marches', libelle: texte('navigation_btp.menus.sous_traitance.st_marches.libelle'), iconeHtml: iconeHtml('navigation_btp_st_marches'), url: L('marches_st'), info: texte('navigation_btp.menus.sous_traitance.st_marches.info'), creation: F(TYPE_FICHE.MARCHE, texte('navigation_btp.menus.sous_traitance.st_marches.creation'), '?sens=ST') },
      { code: 'st-ordres', libelle: texte('navigation_btp.menus.sous_traitance.st_ordres.libelle'), iconeHtml: iconeHtml('navigation_btp_st_ordres'), url: '/liste/ordres?vue=1106', module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', type: 'E_OST', creation: D('E_OST', texte('navigation_btp.menus.sous_traitance.st_ordres.creation')) },
      { separateur: true },
      { code: 'st-pieces', libelle: texte('navigation_btp.menus.sous_traitance.st_pieces.libelle'), iconeHtml: iconeHtml('navigation_btp_st_pieces'), url: '/parametres/sous-traitance', info: texte('navigation_btp.menus.sous_traitance.st_pieces.info') },
    ],
  },
  {
    code: 'stock', libelle: texte('navigation_btp.menus.stock.libelle'), module: MODULE_FACULTATIF.STOCK, droit: 'stock', elements: [
      { code: 'stock-magasin', libelle: texte('navigation_btp.menus.stock.stock_magasin.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_magasin'), url: '/stock/magasin', info: texte('navigation_btp.menus.stock.stock_magasin.info') },
      { code: 'stock-a-valider', libelle: texte('navigation_btp.menus.stock.stock_a_valider.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_a_valider'), url: '/stock/a-valider', info: texte('navigation_btp.menus.stock.stock_a_valider.info') },
      { code: 'stock-dotations', libelle: texte('navigation_btp.menus.stock.stock_dotations.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_dotations'), url: '/stock/dotations', info: texte('navigation_btp.menus.stock.stock_dotations.info') },
      { separateur: true },
      { code: 'stock-etat', libelle: texte('navigation_btp.menus.stock.stock_etat.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_etat'), url: '/stock', info: texte('navigation_btp.menus.stock.stock_etat.info') },
      { code: 'stock-mouvements', libelle: texte('navigation_btp.menus.stock.stock_mouvements.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_mouvements'), url: L('stk_mouvements') },
      { code: 'stock-documents', libelle: texte('navigation_btp.menus.stock.stock_documents.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_documents'), url: L('stock_documents'), creation: D('S_TRANSFERT', texte('navigation_btp.menus.stock.stock_documents.creation')) },
      { code: 'stock-appro', libelle: texte('navigation_btp.menus.stock.stock_appro.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_appro'), url: '/stock/approvisionnement', info: texte('navigation_btp.menus.stock.stock_appro.info') },
      { code: 'stock-reservations', libelle: texte('navigation_btp.menus.stock.stock_reservations.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_reservations'), url: L('stock_reservations'), creation: D('S_RESERVATION', texte('navigation_btp.menus.stock.stock_reservations.creation')) },
      { code: 'stock-inventaires', libelle: texte('navigation_btp.menus.stock.stock_inventaires.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_inventaires'), url: '/stock/inventaires', info: texte('navigation_btp.menus.stock.stock_inventaires.info') },
      { code: 'stock-depots', libelle: texte('navigation_btp.menus.stock.stock_depots.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_depots'), url: L('depots'), info: texte('navigation_btp.menus.stock.stock_depots.info') },
      { separateur: true },
      { code: 'stock-parametres', libelle: texte('navigation_btp.menus.stock.stock_parametres.libelle'), iconeHtml: iconeHtml('navigation_btp_stock_parametres'), url: '/parametres/stock' },
    ],
  },
  {
    code: 'execution', libelle: texte('navigation_btp.menus.execution.libelle'), court: texte('navigation_btp.menus.execution.court'), module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', elements: [
      { code: 'execution-atelier', libelle: texte('navigation_btp.menus.execution.execution_atelier.libelle'), iconeHtml: iconeHtml('navigation_btp_execution_atelier'), url: '/execution/atelier', info: texte('navigation_btp.menus.execution.execution_atelier.info') },
      { code: 'execution-synthese', libelle: texte('navigation_btp.menus.execution.execution_synthese.libelle'), iconeHtml: iconeHtml('navigation_btp_execution_synthese'), url: '/execution/synthese', info: texte('navigation_btp.menus.execution.execution_synthese.info') },
      { separateur: true },
      { code: 'ordres-oe', libelle: texte('navigation_btp.menus.execution.ordres_oe.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_oe'), url: '/liste/ordres?vue=1001', type: 'E_OE', info: texte('navigation_btp.menus.execution.ordres_oe.info') },
      { code: 'ordres-be', libelle: texte('navigation_btp.menus.execution.ordres_be.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_be'), url: '/liste/ordres?vue=1100', type: 'E_BE', creation: D('E_BE', texte('navigation_btp.menus.execution.ordres_be.creation')) },
      { code: 'ordres-bm', libelle: texte('navigation_btp.menus.execution.ordres_bm.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_bm'), url: '/liste/ordres?vue=1101', type: 'E_BM', creation: D('E_BM', texte('navigation_btp.menus.execution.ordres_bm.creation')) },
      { code: 'ordres-of', libelle: texte('navigation_btp.menus.execution.ordres_of.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_of'), url: '/liste/ordres?vue=1102', type: 'E_OF', creation: D('E_OF', texte('navigation_btp.menus.execution.ordres_of.creation')) },
      { code: 'ordres-co', libelle: texte('navigation_btp.menus.execution.ordres_co.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_co'), url: '/liste/ordres?vue=1103', type: 'E_CO', creation: D('E_CO', texte('navigation_btp.menus.execution.ordres_co.creation')) },
      { code: 'ordres-li', libelle: texte('navigation_btp.menus.execution.ordres_li.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_li'), url: '/liste/ordres?vue=1104', type: 'E_LI', creation: D('E_LI', texte('navigation_btp.menus.execution.ordres_li.creation')) },
      { code: 'ordres-sav', libelle: texte('navigation_btp.menus.execution.ordres_sav.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_sav'), url: '/liste/ordres?vue=1105', type: 'E_SAV', creation: D('E_SAV', texte('navigation_btp.menus.execution.ordres_sav.creation')) },
      { code: 'ordres-ost', libelle: texte('navigation_btp.menus.execution.ordres_ost.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_ost'), url: '/liste/ordres?vue=1106', type: 'E_OST', creation: D('E_OST', texte('navigation_btp.menus.execution.ordres_ost.creation')) },
      { code: 'ordres-dac', libelle: texte('navigation_btp.menus.execution.ordres_dac.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_dac'), url: '/liste/ordres?vue=1107', type: 'E_DAC', creation: D('E_DAC', texte('navigation_btp.menus.execution.ordres_dac.creation')) },
      { code: 'ordres-po', libelle: texte('navigation_btp.menus.execution.ordres_po.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_po'), url: '/liste/ordres?vue=1002', type: 'E_PO' },
      { code: 'ordres-dap', libelle: texte('navigation_btp.menus.execution.ordres_dap.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_dap'), url: '/liste/ordres?vue=1003', type: 'E_DAP', creation: D('E_DAP', texte('navigation_btp.menus.execution.ordres_dap.creation')) },
      { code: 'ordres-ent', libelle: texte('navigation_btp.menus.execution.ordres_ent.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_ent'), url: '/liste/ordres?vue=1108', type: 'E_ENT', info: texte('navigation_btp.menus.execution.ordres_ent.info') },
      { code: 'ordres', libelle: texte('navigation_btp.menus.execution.ordres.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres'), url: '/liste/ordres?vue=1000' },
      { code: 'ordres-bloques', libelle: texte('navigation_btp.menus.execution.ordres_bloques.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_bloques'), url: '/liste/ordres?vue=1004' },
      { code: 'ordres-retard', libelle: texte('navigation_btp.menus.execution.ordres_retard.libelle'), iconeHtml: iconeHtml('navigation_btp_ordres_retard'), url: '/liste/ordres?vue=1005' },
      { separateur: true },
      { code: 'parametrage-execution', libelle: texte('navigation_btp.menus.execution.parametrage_execution.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_execution'), url: '/parametres/execution' },
      { code: 'types-ordres', libelle: texte('navigation_btp.menus.execution.types_ordres.libelle'), iconeHtml: iconeHtml('navigation_btp_types_ordres'), url: '/parametres/documents' },
    ],
  },
  {
    code: 'planning', libelle: texte('navigation_btp.menus.planning.libelle'), module: MODULE_FACULTATIF.PLANNING, droit: 'planning', elements: [
      { code: 'planning-atelier', libelle: texte('navigation_btp.menus.planning.planning_atelier.libelle'), iconeHtml: iconeHtml('navigation_btp_planning_atelier'), url: '/planning?vue=ATELIER_JOUR' },
      { code: 'planning-pose', libelle: texte('navigation_btp.menus.planning.planning_pose.libelle'), iconeHtml: iconeHtml('navigation_btp_planning_pose'), url: '/planning?vue=POSE_SEMAINE' },
      { code: 'planning-chantiers', libelle: texte('navigation_btp.menus.planning.planning_chantiers.libelle'), iconeHtml: iconeHtml('navigation_btp_planning_chantiers'), url: '/planning?vue=CHANTIERS_GANTT' },
      { code: 'planning-charge', libelle: texte('navigation_btp.menus.planning.planning_charge.libelle'), iconeHtml: iconeHtml('navigation_btp_planning_charge'), url: '/planning?vue=CHARGE_SERVICE' },
      { code: 'planning-livraisons', libelle: texte('navigation_btp.menus.planning.planning_livraisons.libelle'), iconeHtml: iconeHtml('navigation_btp_planning_livraisons'), url: '/planning?vue=LIVRAISONS' },
      { separateur: true },
      { code: 'planning-equipes', libelle: texte('navigation_btp.menus.planning.planning_equipes.libelle'), iconeHtml: iconeHtml('navigation_btp_planning_equipes'), url: '/planning/equipes', info: texte('navigation_btp.menus.planning.planning_equipes.info') },
      { separateur: true },
      { code: 'parametrage-planning', libelle: texte('navigation_btp.menus.planning.parametrage_planning.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_planning'), url: '/parametres/planning' },
    ],
  },
  {
    code: 'pointage', libelle: texte('navigation_btp.menus.pointage.libelle'), module: MODULE_FACULTATIF.POINTAGE, droit: 'pointage', elements: [
      // Mon terrain (I9) : conditions propres, affiché même sans le module ni le droit du Pointage (`independant`).
      { code: 'terrain', libelle: texte('navigation_btp.menus.terrain.terrain.libelle'), iconeHtml: iconeHtml('navigation_btp_terrain'), url: '/terrain', module: MODULE_FACULTATIF.PLANNING, droit: 'terrain', independant: true, info: texte('navigation_btp.menus.terrain.terrain.info') },
      { separateur: true },
      { code: 'pointage-saisie', libelle: texte('navigation_btp.menus.pointage.pointage_saisie.libelle'), iconeHtml: iconeHtml('navigation_btp_pointage_saisie'), url: '/pointage/saisie', info: texte('navigation_btp.menus.pointage.pointage_saisie.info') },
      { code: 'pointage-synthese', libelle: texte('navigation_btp.menus.pointage.pointage_synthese.libelle'), iconeHtml: iconeHtml('navigation_btp_pointage_synthese'), url: '/pointage/synthese', info: texte('navigation_btp.menus.pointage.pointage_synthese.info') },
      { code: 'pointage-export', libelle: texte('navigation_btp.menus.pointage.pointage_export.libelle'), iconeHtml: iconeHtml('navigation_btp_pointage_export'), url: '/pointage/export', info: texte('navigation_btp.menus.pointage.pointage_export.info') },
      { code: 'pointage-conges', libelle: texte('navigation_btp.menus.pointage.pointage_conges.libelle'), iconeHtml: iconeHtml('navigation_btp_pointage_conges'), url: '/pointage/conges', info: texte('navigation_btp.menus.pointage.pointage_conges.info') },
      { code: 'pointages', libelle: texte('navigation_btp.menus.pointage.pointages.libelle'), iconeHtml: iconeHtml('navigation_btp_pointages'), url: '/liste/pointages?vue=1010' },
      { code: 'pointages-nc', libelle: texte('navigation_btp.menus.pointage.pointages_nc.libelle'), iconeHtml: iconeHtml('navigation_btp_pointages_nc'), url: '/liste/pointages?vue=1011' },
      { code: 'pointages-improductifs', libelle: texte('navigation_btp.menus.pointage.pointages_improductifs.libelle'), iconeHtml: iconeHtml('navigation_btp_pointages_improductifs'), url: '/liste/pointages?vue=1012' },
      { separateur: true },
      { code: 'parametrage-pointage', libelle: texte('navigation_btp.menus.pointage.parametrage_pointage.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_pointage'), url: '/parametres/pointage' },
      { code: 'bornes', libelle: texte('navigation_btp.menus.pointage.bornes.libelle'), iconeHtml: iconeHtml('navigation_btp_bornes'), url: '/parametres/bornes', info: texte('navigation_btp.menus.pointage.bornes.info') },
    ],
  },
  {
    code: 'comptabilite', libelle: texte('navigation_btp.menus.comptabilite.libelle'), court: texte('navigation_btp.menus.comptabilite.court'), droit: 'comptabilite', elements: [
      { code: 'compta-plan', libelle: texte('navigation_btp.menus.comptabilite.compta_plan.libelle'), iconeHtml: iconeHtml('navigation_btp_compta_plan'), url: '/comptabilite/plan', info: texte('navigation_btp.menus.comptabilite.compta_plan.info') },
      { code: 'compta-tiers', libelle: texte('navigation_btp.menus.comptabilite.compta_tiers.libelle'), iconeHtml: iconeHtml('navigation_btp_compta_tiers'), url: '/comptabilite/tiers', info: texte('navigation_btp.menus.comptabilite.compta_tiers.info') },
      { code: 'compta-ventilation', libelle: texte('navigation_btp.menus.comptabilite.compta_ventilation.libelle'), iconeHtml: iconeHtml('navigation_btp_compta_ventilation'), url: '/comptabilite/ventilation', info: texte('navigation_btp.menus.comptabilite.compta_ventilation.info') },
      { code: 'compta-export', libelle: texte('navigation_btp.menus.comptabilite.compta_export.libelle'), iconeHtml: iconeHtml('navigation_btp_compta_export'), url: '/comptabilite/export', info: texte('navigation_btp.menus.comptabilite.compta_export.info') },
      { separateur: true },
      { code: 'parametrage-comptabilite', libelle: texte('navigation_btp.menus.comptabilite.parametrage_comptabilite.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_comptabilite'), url: '/parametres/comptabilite', info: texte('navigation_btp.menus.comptabilite.parametrage_comptabilite.info') },
    ],
  },
  {
    code: 'suivi', libelle: texte('navigation_btp.menus.suivi.libelle'), module: MODULE_FACULTATIF.CRM, droit: 'crm', elements: [
      { code: 'crm-mes', libelle: texte('navigation_btp.menus.suivi.crm_mes.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_mes'), url: '/crm?vue=mes', info: texte('navigation_btp.menus.suivi.crm_mes.info'), creation: { url: '/crm/note/nouveau?nature=TACHE', titre: texte('navigation_btp.menus.suivi.crm_mes.titre') } },
      { code: 'crm-rappels', libelle: texte('navigation_btp.menus.suivi.crm_rappels.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_rappels'), url: '/crm/rappels', info: texte('navigation_btp.menus.suivi.crm_rappels.info') },
      { code: 'crm-a-prendre', libelle: texte('navigation_btp.menus.suivi.crm_a_prendre.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_a_prendre'), url: '/crm?vue=a_prendre' },
      { code: 'crm-recues', libelle: texte('navigation_btp.menus.suivi.crm_recues.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_recues'), url: '/crm?vue=recues' },
      { code: 'crm-toutes', libelle: texte('navigation_btp.menus.suivi.crm_toutes.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_toutes'), url: '/crm?vue=toutes', creation: { url: '/crm/note/nouveau', titre: texte('navigation_btp.menus.suivi.crm_toutes.titre') } },
      { separateur: true },
      { code: 'crm-demandes', libelle: texte('navigation_btp.menus.suivi.crm_demandes.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_demandes'), url: '/crm/demandes', info: texte('navigation_btp.menus.suivi.crm_demandes.info'), creation: { url: '/crm/demande/nouveau', titre: texte('navigation_btp.menus.suivi.crm_demandes.titre') } },
      { code: 'crm-mes-demandes', libelle: texte('navigation_btp.menus.suivi.crm_mes_demandes.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_mes_demandes'), url: '/crm/demandes?vue=mes' },
      { separateur: true },
      { code: 'crm-plans', libelle: texte('navigation_btp.menus.suivi.crm_plans.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_plans'), url: '/crm/plans', info: texte('navigation_btp.menus.suivi.crm_plans.info'), creation: { url: '/crm/plan/nouveau', titre: texte('navigation_btp.menus.suivi.crm_plans.titre') } },
      { code: 'crm-diffusions', libelle: texte('navigation_btp.menus.suivi.crm_diffusions.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_diffusions'), url: '/crm/diffusions' },
      { separateur: true },
      { code: 'crm-fil', libelle: texte('navigation_btp.menus.suivi.crm_fil.libelle'), iconeHtml: iconeHtml('navigation_btp_crm_fil'), url: '/crm/fil', info: texte('navigation_btp.menus.suivi.crm_fil.info') },
      { separateur: true },
      { code: 'parametrage-crm', libelle: texte('navigation_btp.menus.suivi.parametrage_crm.libelle'), iconeHtml: iconeHtml('navigation_btp_parametrage_crm'), url: '/parametres/crm' },
    ],
  },
  {
    code: 'documents-ged', libelle: texte('navigation_btp.menus.documents_ged.libelle'), droit: 'ged', elements: [
      { code: 'ged', libelle: texte('navigation_btp.menus.documents_ged.ged.libelle'), iconeHtml: iconeHtml('navigation_btp_ged'), url: '/ged' },
      { code: 'coffre', libelle: texte('navigation_btp.menus.documents_ged.coffre.libelle'), iconeHtml: iconeHtml('navigation_btp_coffre'), url: '/ged?coffre=1', info: texte('navigation_btp.menus.documents_ged.coffre.info') },
      { code: 'ged-liste', libelle: texte('navigation_btp.menus.documents_ged.ged_liste.libelle'), iconeHtml: iconeHtml('navigation_btp_ged_liste'), url: L('ged') },
      { code: 'courriels', libelle: texte('navigation_btp.menus.documents_ged.courriels.libelle'), iconeHtml: iconeHtml('navigation_btp_courriels'), url: '/mail?vue=envoyes', info: texte('navigation_btp.menus.documents_ged.courriels.info'), creation: { url: '/mail/nouveau', titre: texte('navigation_btp.menus.documents_ged.courriels.titre') } },
    ],
  },
];

/**
 * Menu du bandeau de chaque thème de liste (premier élément de menu qui ouvre `/liste/<thème>`) : { groupe, ordre },
 * pour regrouper la combo des thèmes des listes comme le bandeau.
 */
export function groupesThemes() {
  const groupes = new Map();
  MENUS_METIER.forEach((m, i) => (m.elements ?? []).forEach((e, j) => {
    const theme = /^\/liste\/([^?/]+)/.exec(e.url ?? '')?.[1];
    if (theme && !groupes.has(theme)) groupes.set(theme, { groupe: m.libelle.replace('&', ''), ordre: i * 100 + j });
  }));
  return groupes;
}

/**
 * Menu ou élément visible : sans module, ou module actif pour la société (`module` : code de `module_societe`) ; type de
 * document actif (`type` : code de `type_document`, E39) ; droits du profil (`droit` : nœud du module Droits, au moins
 * une action sur le nœud ou ses descendants). Une page de paramétrage (`url` /parametres…) exige en plus le nœud
 * « parametres » (Consulter ou Modifier) ; les pages administrateur (comptes, profils, installation) gardent leur droit.
 */
const visible = (app, x) => (!x.module || app.moduleActif?.(x.module) !== false) && (!x.type || app.typeActif?.(x.type) !== false)
  && (!x.droit || app.acces?.(x.droit) !== false)
  && (!x.url?.startsWith('/parametres') || x.droit || app.acces?.('parametres') !== false);

/**
 * Éléments visibles d'un menu : un élément `independant` ne dépend que de ses propres conditions ; sans les conditions
 * du menu, seuls ceux-là restent (menu Pointage réduit à Mon terrain, Q16).
 */
export function elementsMenu(app, m) {
  const menuVisible = visible(app, m);
  return elementsVisibles(app, (m.elements ?? []).filter((e) => menuVisible || e.independant));
}

/** Éléments visibles, sans séparateur en tête, en fin ni en double (le dernier des deux est gardé). */
export function elementsVisibles(app, elements) {
  const res = [];
  for (const e of elements.filter((x) => visible(app, x))) {
    if (e.separateur && !res.length) continue;
    // Deux séparateurs de suite (éléments masqués entre eux) : le second, qui porte le titre de ce qui suit.
    if (e.separateur && res.at(-1).separateur) res.pop();
    res.push(e);
  }
  while (res.at(-1)?.separateur) res.pop();
  return res;
}

/** Menus complets : métier (filtrés par les modules actifs), puis Paramètres et Fenêtres (dynamiques). */
export function menus(app) {
  return [
    ...MENUS_METIER.filter((m) => elementsMenu(app, m).length).map((m) => ({ ...m, elements: () => elementsMenu(app, m) })),
    {
      code: 'parametres', libelle: texte('navigation_btp.menus.parametres.libelle'), court: texte('navigation_btp.menus.parametres.court'), elements: () => elementsVisibles(app, [
        { code: 'preferences', libelle: texte('navigation_btp.menus.parametres.preferences.libelle'), iconeHtml: iconeHtml('navigation_btp_preferences'), url: '/parametres' },
        { separateur: true },
        {
          libelle: texte('navigation_btp.menus.parametres.theme_d_affichage.libelle'), iconeHtml: iconeHtml('navigation_btp_theme_d_affichage'), info: THEMES.find((t) => t.code === app.preferences.get('theme'))?.libelle,
          sousMenu: () => THEMES.map((t) => ({ libelle: t.libelle, icone: t.icone, coche: app.preferences.get('theme') === t.code, action: () => app.changerTheme(t.code) })),
        },
        {
          libelle: texte('navigation_btp.menus.parametres.densite.libelle'), iconeHtml: iconeHtml('navigation_btp_densite'), info: DENSITES.find((d) => d.code === (app.preferences.get('densite') ?? 'confortable'))?.libelle,
          sousMenu: () => DENSITES.map((d) => ({ libelle: d.libelle, icone: d.icone, coche: (app.preferences.get('densite') ?? 'confortable') === d.code, action: () => app.changerDensite(d.code) })),
        },
        {
          libelle: texte('navigation_btp.menus.parametres.position_du_menu.libelle'), iconeHtml: iconeHtml('navigation_btp_position_du_menu'), info: POSITIONS_MENU.find((p) => p.mode === (app.bandeau?.disposition.mode ?? DISPOSITION_MENU.HAUT))?.libelle,
          sousMenu: () => POSITIONS_MENU.map((p) => ({
            libelle: p.libelle, icone: p.icone, coche: app.bandeau?.disposition.mode === p.mode, action: () => app.changerMenu({ mode: p.mode }),
          })),
        },
        { code: 'themes', libelle: texte('navigation_btp.menus.parametres.themes.libelle'), iconeHtml: iconeHtml('navigation_btp_themes'), action: () => app.gererThemes(), desactive: !app.peutGererThemes() },
        {
          libelle: texte('navigation_btp.menus.parametres.fiches.libelle'), iconeHtml: iconeHtml('navigation_btp_fiches'), titre: texte('navigation_btp.menus.parametres.fiches.titre'), desactive: !app.estAdmin(), sousMenu: () => [
            { libelle: texte('navigation_btp.menus.parametres.fiche_salarie.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_salarie'), action: () => app.parametrerFiche(TYPE_FICHE.SALARIE) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_materiel.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_materiel'), action: () => app.parametrerFiche(TYPE_FICHE.MATERIEL) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_element.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_element'), action: () => app.parametrerFiche(TYPE_FICHE.ELEMENT) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_personne.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_personne'), action: () => app.parametrerFiche(TYPE_FICHE.PERSONNE) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_individu.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_individu'), action: () => app.parametrerFiche(TYPE_FICHE.INDIVIDU) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_chantier.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_chantier'), action: () => app.parametrerFiche(TYPE_FICHE.CHANTIER) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_affaire.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_affaire'), action: () => app.parametrerFiche(TYPE_FICHE.AFFAIRE) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_projet.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_projet'), action: () => app.parametrerFiche(TYPE_FICHE.PROJET) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_marche.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_marche'), action: () => app.parametrerFiche(TYPE_FICHE.MARCHE) },
            { libelle: texte('navigation_btp.menus.parametres.fiche_sous_traitant.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_sous_traitant'), action: () => app.parametrerFiche('sous_traitant') },
            { libelle: texte('navigation_btp.menus.parametres.fiche_fournisseur.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_fournisseur'), action: () => app.parametrerFiche('fournisseur') },
            { libelle: texte('navigation_btp.menus.parametres.fiche_client.libelle'), iconeHtml: iconeHtml('navigation_btp_fiche_client'), action: () => app.parametrerFiche('client') },              
          ],
        },
        { separateur: true, libelle: texte('navigation_btp.menus.parametres.titre_documents.libelle') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_documents.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_documents'), url: '/parametres/documents' },
        { libelle: texte('navigation_btp.menus.parametres.parametres_editions.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_editions'), url: '/parametres/editions' },
        { libelle: texte('navigation_btp.menus.parametres.parametres_ged.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_ged'), url: '/parametres/ged' },
        { separateur: true, libelle: texte('navigation_btp.menus.parametres.titre_annuaire_et_bibliotheque.libelle') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_annuaire.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_annuaire'), url: '/parametres/annuaire' },
        { libelle: texte('navigation_btp.menus.parametres.parametres_bibliotheque.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_bibliotheque'), url: '/parametres/bibliotheque' },
        { separateur: true, libelle: texte('navigation_btp.menus.parametres.titre_organisation.libelle') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_modules.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_modules'), url: '/parametres/modules', titre: texte('navigation_btp.menus.parametres.parametres_modules.titre') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_services.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_services'), url: '/parametres/services', titre: texte('navigation_btp.menus.parametres.parametres_services.titre') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_referentiels.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_referentiels'), url: '/parametres/referentiels', titre: texte('navigation_btp.menus.parametres.parametres_referentiels.titre') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_calendriers.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_calendriers'), url: '/parametres/calendriers', titre: texte('navigation_btp.menus.parametres.parametres_calendriers.titre') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_ressources.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_ressources'), url: '/parametres/ressources', titre: texte('navigation_btp.menus.parametres.parametres_ressources.titre') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_mail.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_mail'), url: '/parametres/mail', titre: texte('navigation_btp.menus.parametres.parametres_mail.titre'), desactive: !app.estAdmin() },
        { libelle: texte('navigation_btp.menus.parametres.parametres_connexions.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_connexions'), url: '/parametres/connexions', titre: texte('navigation_btp.menus.parametres.parametres_connexions.titre') },
        { libelle: texte('navigation_btp.menus.parametres.parametres_comptes.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_comptes'), url: '/parametres/comptes', titre: texte('navigation_btp.menus.parametres.parametres_comptes.titre'), droit: 'administration/comptes' },
        { libelle: texte('navigation_btp.menus.parametres.parametres_droits.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_droits'), url: '/parametres/droits', titre: texte('navigation_btp.menus.parametres.parametres_droits.titre'), droit: 'administration/profils' },
        { libelle: texte('navigation_btp.menus.parametres.parametres_installation.libelle'), iconeHtml: iconeHtml('navigation_btp_parametres_installation'), url: '/parametres/installation', titre: texte('navigation_btp.menus.parametres.parametres_installation.titre'), droit: 'administration/installation' },
        { separateur: true },
        { code: 'raccourcis', libelle: texte('navigation_btp.menus.parametres.raccourcis.libelle'), iconeHtml: iconeHtml('navigation_btp_raccourcis'), url: '/parametres/raccourcis' },
        { code: 'notifications', libelle: texte('navigation_btp.menus.parametres.notifications.libelle'), iconeHtml: iconeHtml('navigation_btp_notifications'), url: '/parametres/notifications' },
        { code: 'apropos', libelle: texte('navigation_btp.menus.parametres.apropos.libelle'), iconeHtml: iconeHtml('navigation_btp_apropos'), url: '/parametres#apropos', fenetre: false },
      ]),
    },
    {
      code: 'fenetres', libelle: texte('navigation_btp.menus.fenetres.libelle'), court: texte('navigation_btp.menus.fenetres.court'), elements: () => {
        const liste = app.fenetres.liste();
        return [
          ...liste.map((f) => ({
            libelle: f.titre || f.url, icone: f.icone || icone('navigation_btp_fenetre'), coche: f.courante, info: f.courante ? texte('navigation_btp.fenetres.courante') : f.url,
            classe: f.modifiee ? 'fenetre-modifiee' : '', titre: f.modifiee ? texte('navigation_btp.fenetres.modifiee') : texte('navigation_btp.fenetres.premier_plan'),
            action: () => { if (!f.courante && !app.fenetres.focaliser(f.id)) app.message(texte('navigation_btp.fenetres.focalisation_refusee'), 'avertissement'); },
          })),
          { separateur: true },
          { libelle: texte('navigation_btp.menus.fenetres.liste_des_fenetres.libelle'), iconeHtml: iconeHtml('navigation_btp_liste_des_fenetres'), raccourci: 'Ctrl+Maj+F', action: () => app.listeFenetres() },
          { libelle: texte('navigation_btp.menus.fenetres.nouvelle_fenetre.libelle'), iconeHtml: iconeHtml('navigation_btp_nouvelle_fenetre'), action: () => app.naviguer(app.routeur.cle ?? '/', { nouvelleFenetre: true }), titre: texte('navigation_btp.menus.fenetres.nouvelle_fenetre.titre') },
          { libelle: texte('navigation_btp.menus.fenetres.restaurer_ma_session_precedent.libelle'), iconeHtml: iconeHtml('navigation_btp_restaurer_ma_session_precedent'), action: () => app.restaurerSession(), desactive: !app.fenetres.sessionPrecedente() },
          { separateur: true },
          { libelle: texte('navigation_btp.menus.fenetres.fermer_cette_fenetre.libelle'), iconeHtml: iconeHtml('navigation_btp_fermer_cette_fenetre'), action: () => app.fermerFenetre() },
          { libelle: texte('navigation_btp.menus.fenetres.fermer_la_session.libelle'), iconeHtml: iconeHtml('navigation_btp_fermer_la_session'), action: () => app.fermerSession(), titre: texte('navigation_btp.menus.fenetres.fermer_la_session.titre') },
        ];
      },
    },
  ];
}

/** Raccourcis proposés à l'accueil : éléments de menu métier ayant une URL. */
export function catalogueRaccourcis(app = null) {
  return [
    ...MENUS_METIER.flatMap((m) => (app ? elementsMenu(app, m) : m.elements).filter((e) => e.url && e.code).map((e) => ({ code: e.code, libelle: e.libelle, icone: e.icone, iconeHtml: e.iconeHtml, url: e.url, groupe: Bandeau.libelle(m.libelle) }))),
    { code: 'preferences', libelle: texte('navigation_btp.menus.parametres.preferences.libelle'), iconeHtml: iconeHtml('navigation_btp_preferences'), url: '/parametres', groupe: Bandeau.libelle(texte('navigation_btp.menus.parametres.libelle')) },
  ];
}

export const RACCOURCIS_DEFAUT = ['tiers', 'clients', 'contacts', 'salaries', 'materiels', 'devis', 'factures', 'ged', 'coffre'];
