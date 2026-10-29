import { TYPE_FICHE, MODULE_FACULTATIF } from '../codes.js';
import { Bandeau, DISPOSITION_MENU } from '@logibtp/navigation/ui';
import { THEMES } from '@logibtp/socle/ui';

// Menus du bandeau, regroupés par classe de métier, et catalogue des raccourcis de l'accueil (tous les éléments
// de menu ayant une URL). Les menus Fenêtres et Paramètres sont construits à l'ouverture (état courant).

const L = (theme) => `/liste/${theme}`;
/** Positions du menu (sous-menu Paramètres › Position du menu). */
const POSITIONS_MENU = [
  { mode: DISPOSITION_MENU.HAUT, libelle: 'En haut', icone: '☰' },
  { mode: DISPOSITION_MENU.GAUCHE, libelle: 'À gauche, sur toute la hauteur', icone: '▌' },
  { mode: DISPOSITION_MENU.DROITE, libelle: 'À droite, sur toute la hauteur', icone: '▐' },
];
/** Création rapide (bouton ＋ sur la ligne du menu) : fiche ou document. */
const F = (type, titre, requete = '') => ({ url: `/fiche/${type}/nouveau${requete}`, titre });
const D = (code, titre) => ({ url: `/document/nouveau?type=${code}`, titre });

/** Menus métier (statiques). */
export const MENUS_METIER = [
  {
    code: 'ressources', libelle: '&Ressources', court: 'Res.', droit: 'ressources', elements: [
      { code: 'ressources', libelle: 'Toutes les ressources', icone: '🧰', url: L('ressources'), info: 'Équipes, salariés, intérim, matériel, sous-traitants' },
      { separateur: true },
      { code: 'salaries', libelle: 'Salariés et intérimaires', icone: '👷', url: L('salaries'), creation: F(TYPE_FICHE.SALARIE, 'Nouveau salarié') },
      { code: 'materiels', libelle: 'Matériels', icone: '🚜', url: L('materiels'), creation: F(TYPE_FICHE.MATERIEL, 'Nouveau matériel') },
      { separateur: true },
      { code: 'habilitations', libelle: 'Habilitations, entretiens et visites à surveiller', icone: '🪪', url: '/ressources/habilitations', info: 'Expirées ou à renouveler : CACES, visites médicales, VGP…' },
      { code: 'parametrage-ressources', libelle: "Types d'habilitations, motifs, natures MO…", icone: '⚙', url: '/parametres/ressources' },
    ],
  },
  {
    code: 'annuaire', libelle: '&Tiers', droit: 'annuaire', elements: [
      { code: 'tiers', libelle: 'Tous les tiers', icone: '🏢', url: '/liste/tiers?vue=20', info: 'Sociétés, établissements, particuliers…', creation: F(TYPE_FICHE.PERSONNE, 'Nouvelle personne (société…)') },
      { code: 'clients', libelle: 'Clients et prospects', icone: '💶', url: '/liste/tiers?vue=21', creation: F(TYPE_FICHE.PERSONNE, 'Nouveau client', '?casquette=CLIENT') },
      { code: 'fournisseurs', libelle: 'Fournisseurs et loueurs', icone: '📦', url: '/liste/tiers?vue=22', creation: F(TYPE_FICHE.PERSONNE, 'Nouveau fournisseur', '?casquette=FOURNISSEUR') },
      { code: 'sous-traitants', libelle: 'Sous-traitants, cotraitants, intérim', icone: '🤝', url: '/liste/tiers?vue=23', creation: F(TYPE_FICHE.PERSONNE, 'Nouveau sous-traitant', '?casquette=SOUS_TRAITANT') },
      { code: 'prescripteurs', libelle: 'Prescripteurs et maîtres d\'ouvrage', icone: '📐', url: '/liste/tiers?vue=24', creation: F(TYPE_FICHE.PERSONNE, 'Nouveau prescripteur', '?casquette=ARCHITECTE') },
      { separateur: true },
      { code: 'contacts', libelle: 'Contacts (individus)', icone: '👤', url: '/liste/contacts?vue=25', creation: F(TYPE_FICHE.INDIVIDU, 'Nouvel individu (contact)') },
      { code: 'equipe-interne', libelle: 'Notre société : salariés et rôles', icone: '🎩', url: '/liste/contacts?vue=26', creation: F(TYPE_FICHE.INDIVIDU, 'Nouvel individu') },
      { separateur: true },
      { code: 'graphe-relations', libelle: 'Graphe des relations', icone: '🕸️', url: '/annuaire/graphe', info: 'Hiérarchie, liens et contacts (depuis notre société)' },
      { code: 'notre-societe', libelle: 'Notre société', icone: '🏛️', url: '/annuaire/societe', info: 'Fiche de la société de cette base' },
      { code: 'parametrage-annuaire', libelle: 'Niveaux, relations, liens, rôles…', icone: '⚙', url: '/parametres/annuaire' },
    ],
  },
  {
    code: 'bibliotheque', libelle: '&Bibliothèque', court: 'Bib', droit: 'bibliotheque', elements: [
      { code: 'articles', libelle: 'Articles', icone: '🧱', url: '/liste/bibliotheque?vue=12', creation: F(TYPE_FICHE.ELEMENT, 'Nouvel article') },
      { code: 'ouvrages', libelle: 'Ouvrages', icone: '🏗️', url: '/liste/bibliotheque?vue=13', creation: F(TYPE_FICHE.ELEMENT, 'Nouvel ouvrage', '?type=OUVRAGE') },
      { code: 'ensembles', libelle: 'Ensembles (structures réutilisables)', icone: '🧩', url: '/liste/bibliotheque?vue=15', creation: F(TYPE_FICHE.ELEMENT, 'Nouvel ensemble', '?type=ENSEMBLE') },
      { code: 'textes', libelle: 'Textes (lignes et textes d’édition)', icone: '📝', url: '/liste/bibliotheque?vue=1400', creation: F(TYPE_FICHE.ELEMENT, 'Nouveau texte', '?type=TEXTE') },
      { code: 'elements', libelle: 'Tous les éléments', icone: '📚', url: '/liste/bibliotheque?vue=14', creation: F(TYPE_FICHE.ELEMENT, 'Nouvel article') },
      { separateur: true },
      { code: 'parametrage-bibliotheque', libelle: 'Bibliothèques, familles, natures…', icone: '⚙', url: '/parametres/bibliotheque' },
    ],
  },
  {
    code: 'affaires', libelle: 'A&ffaires', droit: 'structure', elements: [
      { code: 'projets', libelle: 'Projets (chiffrage)', icone: '🎯', url: L('projets'), creation: F(TYPE_FICHE.PROJET, 'Nouveau projet') },
      { code: 'affaires', libelle: 'Affaires', icone: '🗂', url: L('affaires'), info: 'Regroupement de chantiers, ou affaire de gestion (frais hors chantier)', creation: F(TYPE_FICHE.AFFAIRE, 'Nouvelle affaire') },
      { code: 'chantiers', libelle: 'Chantiers', icone: '🏗', url: L('chantiers'), creation: F(TYPE_FICHE.CHANTIER, 'Nouveau chantier') },
      { code: 'marches', libelle: 'Marchés', icone: '📜', url: L('marches'), info: 'Ouverts à la validation des commandes clients : suivi de la facturation', creation: F(TYPE_FICHE.MARCHE, 'Nouveau marché') },
    ],
  },
  {
    code: 'ventes', libelle: '&Ventes', droit: 'documents/V', elements: [
      { code: 'devis', libelle: 'Devis', icone: '📝', url: L('devis'), creation: D('V_DEVIS', 'Nouveau devis') },
      { code: 'commandes', libelle: 'Commandes clients', icone: '🤝', url: L('commandes'), creation: D('V_COMMANDE', 'Nouvelle commande client') },
      { code: 'livraisons', libelle: 'Bons de livraison et de retour', icone: '🚚', url: L('livraisons'), creation: D('V_RECEPTION', 'Nouveau bon de livraison') },
      { code: 'situations', libelle: 'Situations de travaux', icone: '📈', url: L('situations'), creation: D('V_SITUATION', 'Nouvelle situation de travaux') },
      { code: 'factures', libelle: 'Factures, factures d\'avancement, avoirs', icone: '💶', url: L('factures'), creation: D('V_FACTURE', 'Nouvelle facture') },
      { code: 'documents', libelle: 'Tous les documents', icone: '📄', url: L('documents') },
      { code: 'reglements-clients', libelle: 'Règlements clients', icone: '💳', url: '/reglements?sens=E', info: 'Échéances, règlements, pointage et cautions (module Règlements)', module: MODULE_FACULTATIF.REGLEMENT },
      { separateur: true },
      { code: 'import-optim', libelle: 'Importer un devis OptimBTP', icone: '📥', url: '/import/optimbtp', info: 'Fichier .optim : lignes, prix et coefficients repris, champs non repris listés' },
    ],
  },
  {
    code: 'achats', libelle: '&Achats', droit: 'documents/A', elements: [
      { code: 'ddp', libelle: 'Demandes de prix (DDP)', icone: '📨', url: L('achats_ddp'), creation: D('A_DEVIS', 'Nouvelle demande de prix') },
      { code: 'commandes-fournisseurs', libelle: 'Commandes fournisseurs', icone: '📦', url: L('achats_commandes'), creation: D('A_COMMANDE', 'Nouvelle commande fournisseur') },
      { code: 'livraisons-fournisseurs', libelle: 'Bons de livraison et de retour fournisseurs', icone: '🚛', url: L('achats_livraisons'), creation: D('A_RECEPTION', 'Nouveau bon de livraison fournisseur') },
      { code: 'factures-fournisseurs', libelle: 'Factures fournisseurs', icone: '🧾', url: L('achats_factures'), creation: D('A_FACTURE', 'Nouvelle facture fournisseur') },
      { separateur: true, libelle: 'Demandes (Exécution)' },
      { code: 'achats-dac', libelle: "Demandes d'achat", icone: '🧾', url: '/liste/ordres?vue=1107', module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', type: 'E_DAC', creation: D('E_DAC', "Nouvel ordre : demande d'achat") },
      { code: 'achats-dap', libelle: "Demandes d'approvisionnement", icone: '🛒', url: '/liste/ordres?vue=1003', module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', type: 'E_DAP', creation: D('E_DAP', "Nouvelle demande d'approvisionnement") },
      { separateur: true },
      { code: 'reglements-fournisseurs', libelle: 'Règlements fournisseurs', icone: '💳', url: '/reglements?sens=D', info: 'Échéances à payer, règlements émis et pointage (module Règlements)', module: MODULE_FACULTATIF.REGLEMENT },
    ],
  },
  {
    code: 'sous-traitance', libelle: 'Sous-&traitance', court: 'SsT', module: MODULE_FACULTATIF.SOUS_TRAITANCE, droit: 'sous_traitance', elements: [
      { code: 'st-ao', libelle: "Appels d'offres", icone: '📨', url: L('st_ao'), type: 'T_AO', creation: D('T_AO', "Nouvel appel d'offres de sous-traitance") },
      { code: 'st-commandes', libelle: 'Commandes de sous-traitance', icone: '📝', url: L('st_commandes'), type: 'T_COMMANDE', creation: D('T_COMMANDE', 'Nouvelle commande de sous-traitance') },
      { code: 'st-factures', libelle: 'Factures de sous-traitance', icone: '🧾', url: L('st_factures'), type: 'T_FACTURE_AVT' },
      { code: 'st-marches', libelle: 'Marchés de sous-traitance', icone: '🤝', url: L('marches_st'), info: 'Un marché par sous-traitant et axe de facturation sur un chantier', creation: F(TYPE_FICHE.MARCHE, 'Nouveau marché de sous-traitance', '?sens=ST') },
      { code: 'st-ordres', libelle: 'Ordres de sous-traitance (Exécution)', icone: '🛠', url: '/liste/ordres?vue=1106', module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', type: 'E_OST', creation: D('E_OST', 'Nouvel ordre : ordre de sous-traitance') },
      { separateur: true },
      { code: 'st-pieces', libelle: 'Pièces exigées…', icone: '⚙', url: '/parametres/sous-traitance', info: 'Kbis, URSSAF, assurances, DC4… : validité, rappels, actions bloquées' },
    ],
  },
  {
    code: 'stock', libelle: 'Stoc&k', module: MODULE_FACULTATIF.STOCK, droit: 'stock', elements: [
      { code: 'stock-magasin', libelle: 'Magasin (comptoir)', icone: '🏪', url: '/stock/magasin', info: 'Sorties et retours : chantiers, dotations des salariés (EPI, outillage)' },
      { code: 'stock-a-valider', libelle: 'Saisies de la borne à valider', icone: '✅', url: '/stock/a-valider', info: 'Sorties et retours saisis par les salariés : accepter ou refuser' },
      { code: 'stock-dotations', libelle: 'Dotations des salariés', icone: '🦺', url: '/stock/dotations', info: 'EPI et outillage dotés par salarié sur une période' },
      { separateur: true },
      { code: 'stock-etat', libelle: 'État du stock', icone: '📦', url: '/stock', info: 'Quantités et valeur d\'un dépôt à une date-heure' },
      { code: 'stock-mouvements', libelle: 'Mouvements de stock', icone: '🔁', url: L('stk_mouvements') },
      { code: 'stock-documents', libelle: 'Entrées, sorties et transferts', icone: '🚚', url: L('stock_documents'), creation: D('S_TRANSFERT', 'Nouveau transfert de stock') },
      { code: 'stock-appro', libelle: 'Approvisionnement', icone: '🚚', url: '/stock/approvisionnement', info: 'Ruptures à venir, propositions de commande, mini / maxi' },
      { code: 'stock-reservations', libelle: 'Réservations', icone: '📌', url: L('stock_reservations'), creation: D('S_RESERVATION', 'Nouvelle réservation de stock') },
      { code: 'stock-inventaires', libelle: 'Inventaires', icone: '📋', url: '/stock/inventaires', info: 'Lots de bordereaux comptés à une date-heure, écarts, corrections' },
      { code: 'stock-depots', libelle: 'Dépôts', icone: '🏬', url: L('depots'), info: 'Chantiers cochés « Dépôt de stock » (affaire STOCK) ou qui tiennent un stock' },
      { separateur: true },
      { code: 'stock-parametres', libelle: 'Valorisation, emplacements et marques…', icone: '⚙', url: '/parametres/stock' },
    ],
  },
  {
    code: 'execution', libelle: '&Exécution', court: 'Exe', module: MODULE_FACULTATIF.EXECUTION, droit: 'execution', elements: [
      { code: 'execution-atelier', libelle: 'Étapes à valider (atelier, tablette)', icone: '🧩', url: '/execution/atelier', info: 'Étapes des ordres dont vous êtes la ressource ou de votre service sur vos chantiers du jour' },
      { code: 'execution-synthese', libelle: 'Synthèse par chantier', icone: '🧭', url: '/execution/synthese', info: 'Un état par service (parcours et ordres), clic droit pour imposer un état' },
      { separateur: true },
      { code: 'ordres-oe', libelle: "Ordres d'exécution", icone: '🛠', url: '/liste/ordres?vue=1001', type: 'E_OE', info: "Lancés depuis la fiche du marché (▶ Ordre d'exécution)" },
      { code: 'ordres-be', libelle: "Ordres du bureau d'études", icone: '🧑‍💻', url: '/liste/ordres?vue=1100', type: 'E_BE', creation: D('E_BE', "Nouvel ordre : ordre du bureau d'études") },
      { code: 'ordres-bm', libelle: 'Ordres des méthodes', icone: '📐', url: '/liste/ordres?vue=1101', type: 'E_BM', creation: D('E_BM', 'Nouvel ordre : ordre du bureau des méthodes') },
      { code: 'ordres-of', libelle: 'Ordres de fabrication', icone: '🏭', url: '/liste/ordres?vue=1102', type: 'E_OF', creation: D('E_OF', 'Nouvel ordre : ordre de fabrication') },
      { code: 'ordres-co', libelle: 'Ordres de colisage', icone: '📦', url: '/liste/ordres?vue=1103', type: 'E_CO', creation: D('E_CO', 'Nouvel ordre : ordre de colisage') },
      { code: 'ordres-li', libelle: 'Ordres de livraison', icone: '🚚', url: '/liste/ordres?vue=1104', type: 'E_LI', creation: D('E_LI', 'Nouvel ordre : ordre de livraison') },
      { code: 'ordres-sav', libelle: 'Interventions SAV', icone: '🧰', url: '/liste/ordres?vue=1105', type: 'E_SAV', creation: D('E_SAV', 'Nouvel ordre : intervention SAV') },
      { code: 'ordres-ost', libelle: 'Ordres de sous-traitance', icone: '🤝', url: '/liste/ordres?vue=1106', type: 'E_OST', creation: D('E_OST', 'Nouvel ordre : ordre de sous-traitance') },
      { code: 'ordres-dac', libelle: "Demandes d'achat", icone: '🧾', url: '/liste/ordres?vue=1107', type: 'E_DAC', creation: D('E_DAC', "Nouvel ordre : demande d'achat") },
      { code: 'ordres-po', libelle: 'Ordres de pose', icone: '🔧', url: '/liste/ordres?vue=1002', type: 'E_PO' },
      { code: 'ordres-dap', libelle: "Demandes d'approvisionnement", icone: '🛒', url: '/liste/ordres?vue=1003', type: 'E_DAP', creation: D('E_DAP', "Nouvelle demande d'approvisionnement") },
      { code: 'ordres-ent', libelle: "Ordres d'entretien du matériel", icone: '🔩', url: '/liste/ordres?vue=1108', type: 'E_ENT', info: 'Créés depuis la fiche du matériel (onglet Compteurs)' },
      { code: 'ordres', libelle: 'Tous les ordres', icone: '📋', url: '/liste/ordres?vue=1000' },
      { code: 'ordres-bloques', libelle: 'Ordres bloqués', icone: '⛔', url: '/liste/ordres?vue=1004' },
      { code: 'ordres-retard', libelle: 'Ordres en retard', icone: '⏰', url: '/liste/ordres?vue=1005' },
      { separateur: true },
      { code: 'parametrage-execution', libelle: 'Paramètres : modèles de parcours, états…', icone: '⚙', url: '/parametres/execution' },
      { code: 'types-ordres', libelle: "Types d'ordres (activation, service)…", icone: '⚙', url: '/parametres/documents' },
    ],
  },
  {
    code: 'planning', libelle: 'P&lanning', module: MODULE_FACULTATIF.PLANNING, droit: 'planning', elements: [
      { code: 'planning-atelier', libelle: 'Atelier par jour', icone: '🏭', url: '/planning?vue=ATELIER_JOUR' },
      { code: 'planning-pose', libelle: 'Pose par semaine', icone: '🔧', url: '/planning?vue=POSE_SEMAINE' },
      { code: 'planning-chantiers', libelle: 'Chantiers (Gantt)', icone: '📊', url: '/planning?vue=CHANTIERS_GANTT' },
      { code: 'planning-charge', libelle: 'Charge par service', icone: '📈', url: '/planning?vue=CHARGE_SERVICE' },
      { code: 'planning-livraisons', libelle: 'Livraisons', icone: '🚚', url: '/planning?vue=LIVRAISONS' },
      { separateur: true },
      { code: 'planning-equipes', libelle: 'Équipes et compositions', icone: '👥', url: '/planning/equipes', info: 'Équipes, membres par périodes (salariés, intérimaires, matériels, sous-traitants, équipes en renfort), chef d\'équipe' },
      { separateur: true },
      { code: 'parametrage-planning', libelle: 'Paramètres : heures travaillées, jours masqués…', icone: '⚙', url: '/parametres/planning' },
    ],
  },
  {
    code: 'pointage', libelle: '&Pointage', module: MODULE_FACULTATIF.POINTAGE, droit: 'pointage', elements: [
      { code: 'pointage-saisie', libelle: 'Saisie des pointages', icone: '⏱', url: '/pointage/saisie', info: 'Grille hebdomadaire par salarié, au chantier ou sur un chantier interne' },
      { code: 'pointage-synthese', libelle: 'Synthèse et validation', icone: '✅', url: '/pointage/synthese', info: 'Salariés à examiner, corrections, validation simple ou double, demandes de correction' },
      { code: 'pointage-export', libelle: 'Export de paie et valorisation', icone: '📤', url: '/pointage/export', info: 'Variables de paie des jours validés (CSV), coût des heures' },
      { code: 'pointage-conges', libelle: 'Congés et absences', icone: '🏖', url: '/pointage/conges', info: 'Demandes de congés (pour soi ou ses équipiers), validation RH avec la nature' },
      { code: 'pointages', libelle: 'Liste des pointages', icone: '📋', url: '/liste/pointages?vue=1010' },
      { code: 'pointages-nc', libelle: 'Non-conformités', icone: '⚠', url: '/liste/pointages?vue=1011' },
      { code: 'pointages-improductifs', libelle: 'Temps improductif', icone: '⏸', url: '/liste/pointages?vue=1012' },
      { separateur: true },
      { code: 'parametrage-pointage', libelle: 'Paramètres : pas, validation, sous-types…', icone: '⚙', url: '/parametres/pointage' },
      { code: 'bornes', libelle: 'Bornes et PIN…', icone: '🏭', url: '/parametres/bornes', info: 'Enregistrer une borne d\'atelier, poser les PIN des salariés' },
    ],
  },
  {
    code: 'comptabilite', libelle: 'Co&mptabilité', court: 'Compta', droit: 'comptabilite', elements: [
      { code: 'compta-plan', libelle: 'Plan comptable', icone: '📒', url: '/comptabilite/plan', info: 'Comptes généraux, collectifs, TVA : type, sens d\'usage, longueur' },
      { code: 'compta-tiers', libelle: 'Tiers par compte', icone: '🗂', url: '/comptabilite/tiers', info: 'Comptes auxiliaires et collectifs des clients, fournisseurs et sous-traitants' },
      { code: 'compta-ventilation', libelle: 'Ventilation natures × TVA', icone: '🧮', url: '/comptabilite/ventilation', info: 'Compte des lignes par type comptable, nature et taux de TVA' },
      { code: 'compta-export', libelle: 'Export des écritures', icone: '📤', url: '/comptabilite/export', info: 'Factures, avoirs, achats et sous-traitance vers le logiciel comptable (Sage 100)' },
      { separateur: true },
      { code: 'parametrage-comptabilite', libelle: 'Paramètres : longueur, collectifs, types comptables, TVA…', icone: '⚙', url: '/parametres/comptabilite', info: 'Longueur des comptes, préfixes, collectifs, catégories et taux de TVA' },
    ],
  },
  {
    code: 'suivi', libelle: '&Suivi', module: MODULE_FACULTATIF.CRM, droit: 'crm', elements: [
      { code: 'crm-mes', libelle: 'Mes tâches', icone: '☑', url: '/crm?vue=mes', info: 'Notes dont je suis responsable', creation: { url: '/crm/note/nouveau?nature=TACHE', titre: 'Nouvelle tâche' } },
      { code: 'crm-rappels', libelle: 'Mes rappels', icone: '⏰', url: '/crm/rappels', info: 'Rouge : échu ou imminent · orange : bientôt · vert : à venir' },
      { code: 'crm-a-prendre', libelle: 'À prendre dans mes services', icone: '🙋', url: '/crm?vue=a_prendre' },
      { code: 'crm-recues', libelle: 'Notes reçues', icone: '📥', url: '/crm?vue=recues' },
      { code: 'crm-toutes', libelle: 'Toutes les notes', icone: '🗒', url: '/crm?vue=toutes', creation: { url: '/crm/note/nouveau', titre: 'Nouvelle note' } },
      { separateur: true },
      { code: 'crm-demandes', libelle: 'Demandes (veille commerciale)', icone: '📨', url: '/crm/demandes', info: 'Avant-projets et consultations suivis avant la création du projet', creation: { url: '/crm/demande/nouveau', titre: 'Nouvelle demande' } },
      { code: 'crm-mes-demandes', libelle: 'Mes demandes', icone: '📬', url: '/crm/demandes?vue=mes' },
      { separateur: true },
      { code: 'crm-plans', libelle: 'Plans et visas', icone: '📐', url: '/crm/plans', info: 'Indices, visas des tiers, indice en vigueur', creation: { url: '/crm/plan/nouveau', titre: 'Nouveau plan' } },
      { code: 'crm-diffusions', libelle: 'Bordereaux de diffusion', icone: '📤', url: '/crm/diffusions' },
      { separateur: true },
      { code: 'crm-fil', libelle: 'Fil d\'actualité', icone: '📰', url: '/crm/fil', info: 'Notes publiées et événements ; le fil d\'un chantier se trouve dans son suivi' },
      { separateur: true },
      { code: 'parametrage-crm', libelle: 'Paramètres : types de notes, rappels, statuts de visa…', icone: '⚙', url: '/parametres/crm' },
    ],
  },
  {
    code: 'documents-ged', libelle: '&GED', droit: 'ged', elements: [
      { code: 'ged', libelle: 'GED : tous les documents', icone: '📎', url: '/ged' },
      { code: 'coffre', libelle: 'Coffre-fort', icone: '🔒', url: '/ged?coffre=1', info: 'Documents administratifs scellés' },
      { code: 'ged-liste', libelle: 'Recherche de documents (liste)', icone: '🔎', url: L('ged') },
      { code: 'courriels', libelle: 'Courriels envoyés et en attente', icone: '📬', url: '/mail?vue=envoyes', info: 'File d’envoi, erreurs, suivi des envois', creation: { url: '/mail/nouveau', titre: 'Nouveau courriel' } },
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
 * une action sur le nœud ou ses descendants).
 */
const visible = (app, x) => (!x.module || app.moduleActif?.(x.module) !== false) && (!x.type || app.typeActif?.(x.type) !== false)
  && (!x.droit || app.acces?.(x.droit) !== false);

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
    ...MENUS_METIER.filter((m) => visible(app, m)).map((m) => ({ ...m, elements: () => elementsVisibles(app, m.elements) })),
    {
      code: 'parametres', libelle: '&Paramètres', court: 'Param.', elements: () => elementsVisibles(app, [
        { code: 'preferences', libelle: 'Préférences', icone: '⚙', url: '/parametres' },
        { separateur: true },
        {
          libelle: "Thème d'affichage", icone: '🎨', info: THEMES.find((t) => t.code === app.preferences.get('theme'))?.libelle,
          sousMenu: () => THEMES.map((t) => ({ libelle: t.libelle, icone: t.icone, coche: app.preferences.get('theme') === t.code, action: () => app.changerTheme(t.code) })),
        },
        {
          libelle: 'Position du menu', icone: '▐', info: POSITIONS_MENU.find((p) => p.mode === (app.bandeau?.disposition.mode ?? DISPOSITION_MENU.HAUT))?.libelle,
          sousMenu: () => POSITIONS_MENU.map((p) => ({
            libelle: p.libelle, icone: p.icone, coche: app.bandeau?.disposition.mode === p.mode, action: () => app.changerMenu({ mode: p.mode }),
          })),
        },
        { code: 'themes', libelle: 'Thèmes et vues de liste…', icone: '🗂', action: () => app.gererThemes(), desactive: !app.peutGererThemes() },
        {
          libelle: 'Fiches', icone: '🗃', titre: 'Champs supplémentaires des fiches (administrateur)', desactive: !app.estAdmin(), sousMenu: () => [
            { libelle: 'Fiche salarié : champs…', icone: '👷', action: () => app.parametrerFiche(TYPE_FICHE.SALARIE) },
            { libelle: 'Fiche matériel : champs…', icone: '🚜', action: () => app.parametrerFiche(TYPE_FICHE.MATERIEL) },
            { libelle: 'Fiche élément : données techniques…', icone: '📚', action: () => app.parametrerFiche(TYPE_FICHE.ELEMENT) },
            { libelle: 'Fiche personne : champs…', icone: '🏢', action: () => app.parametrerFiche(TYPE_FICHE.PERSONNE) },
            { libelle: 'Fiche individu : champs…', icone: '👤', action: () => app.parametrerFiche(TYPE_FICHE.INDIVIDU) },
            { libelle: 'Fiche chantier : champs…', icone: '🏗', action: () => app.parametrerFiche(TYPE_FICHE.CHANTIER) },
            { libelle: 'Fiche affaire : champs…', icone: '🗂', action: () => app.parametrerFiche(TYPE_FICHE.AFFAIRE) },
            { libelle: 'Fiche projet : champs…', icone: '🎯', action: () => app.parametrerFiche(TYPE_FICHE.PROJET) },
            { libelle: 'Fiche marché : champs…', icone: '📜', action: () => app.parametrerFiche(TYPE_FICHE.MARCHE) },
            { libelle: 'Fiche sous-traitant : champs…', icone: '🤝', action: () => app.parametrerFiche('sous_traitant') },
            { libelle: 'Fiche fournisseur : champs…', icone: '📦', action: () => app.parametrerFiche('fournisseur') },
            { libelle: 'Fiche client : champs…', icone: '📝', action: () => app.parametrerFiche('client') },              
          ],
        },
        { separateur: true, libelle: 'Documents' },
        { libelle: 'Étiquettes et couleurs des lignes…', icone: '🏷', url: '/parametres/documents' },
        { libelle: 'Éditions : modèles et mentions…', icone: '🖨', url: '/parametres/editions' },
        { libelle: 'GED : rétention et classification…', icone: '⏳', url: '/parametres/ged' },
        { separateur: true, libelle: 'Annuaire et bibliothèque' },
        { libelle: 'Annuaire : niveaux, relations, liens, rôles…', icone: '🏢', url: '/parametres/annuaire' },
        { libelle: 'Bibliothèques, familles, natures, scénarios…', icone: '⚙', url: '/parametres/bibliotheque' },
        { separateur: true, libelle: 'Organisation' },
        { libelle: 'Modules de la société…', icone: '🧩', url: '/parametres/modules', titre: 'Activer ou désactiver les modules facultatifs' },
        { libelle: 'Services et membres…', icone: '🏢', url: '/parametres/services', titre: 'Services de l’entreprise et salariés rattachés' },
        { libelle: 'Référentiels communs…', icone: '🗃', url: '/parametres/referentiels', titre: 'Types de matériel, activités, priorités et évaluations des projets, modes de règlement, unités, numérotation des documents' },
        { libelle: 'Calendriers et jours fériés…', icone: '📅', url: '/parametres/calendriers', titre: 'Horaires de travail, cycles, jours fériés, fermetures des services' },
        { libelle: 'Référentiel des ressources…', icone: '🧰', url: '/parametres/ressources', titre: "Types d'habilitations, motifs, natures de main-d'œuvre par service" },
        { libelle: 'Messagerie : comptes, alias, modèles…', icone: '📧', url: '/parametres/mail', titre: 'Comptes de messagerie, expéditeur par usage, modèles, limitations des envois', desactive: !app.estAdmin() },
        { libelle: 'Connexions externes (OAuth)…', icone: '🔐', url: '/parametres/connexions', titre: 'Connexions aux services externes : Gmail…' },
        { libelle: 'Comptes utilisateurs…', icone: '👥', url: '/parametres/comptes', titre: 'Comptes de connexion des salariés et intérimaires', droit: 'administration/comptes' },
        { libelle: 'Profils et droits…', icone: '🛡', url: '/parametres/droits', titre: 'Profils, droits par module, document, fiche et fonction ; journal des modifications', droit: 'administration/profils' },
        { libelle: 'Installation : certificat, bases, sauvegardes…', icone: '🖥', url: '/parametres/installation', titre: 'État du serveur : certificat HTTPS, bases des sociétés, dernière sauvegarde, espace disque', droit: 'administration/installation' },
        { separateur: true },
        { code: 'raccourcis', libelle: 'Raccourcis clavier…', icone: '⌨', url: '/parametres/raccourcis' },
        { code: 'notifications', libelle: 'Notifications : préférences…', icone: '🔔', url: '/parametres/notifications' },
        { code: 'apropos', libelle: 'À propos de LogiBTP', icone: 'ℹ️', url: '/parametres#apropos', fenetre: false },
      ]),
    },
    {
      code: 'fenetres', libelle: 'Fe&nêtres', court: 'Fen.', elements: () => {
        const liste = app.fenetres.liste();
        return [
          ...liste.map((f) => ({
            libelle: f.titre || f.url, icone: f.icone || '🗔', coche: f.courante, info: f.courante ? 'Cette fenêtre' : f.url,
            classe: f.modifiee ? 'fenetre-modifiee' : '', titre: f.modifiee ? 'Modifications non enregistrées' : 'Mettre au premier plan',
            action: () => { if (!f.courante && !app.fenetres.focaliser(f.id)) app.message('Le navigateur ne permet pas de mettre cette fenêtre au premier plan : elle est signalée', 'avertissement'); },
          })),
          { separateur: true },
          { libelle: 'Liste des fenêtres…', icone: '🗗', raccourci: 'Ctrl+Maj+F', action: () => app.listeFenetres() },
          { libelle: 'Nouvelle fenêtre', icone: '⧉', action: () => app.naviguer(app.routeur.cle ?? '/', { nouvelleFenetre: true }), titre: 'Ouvre la page courante dans une fenêtre séparée' },
          { libelle: 'Restaurer ma session précédente', icone: '↺', action: () => app.restaurerSession(), desactive: !app.fenetres.sessionPrecedente() },
          { separateur: true },
          { libelle: 'Fermer cette fenêtre', icone: '✕', action: () => app.fermerFenetre() },
          { libelle: 'Fermer la session…', icone: '⏻', action: () => app.fermerSession(), titre: 'Ferme toutes les fenêtres ; la session pourra être restaurée depuis l\'accueil' },
        ];
      },
    },
  ];
}

/** Raccourcis proposés à l'accueil : éléments de menu métier ayant une URL. */
export function catalogueRaccourcis(app = null) {
  return [
    ...MENUS_METIER.filter((m) => !app || visible(app, m)).flatMap((m) => m.elements.filter((e) => e.url && e.code && (!app || visible(app, e))).map((e) => ({ code: e.code, libelle: e.libelle, icone: e.icone, url: e.url, groupe: Bandeau.libelle(m.libelle) }))),
    { code: 'preferences', libelle: 'Préférences', icone: '⚙', url: '/parametres', groupe: 'Paramètres' },
  ];
}

export const RACCOURCIS_DEFAUT = ['tiers', 'clients', 'contacts', 'salaries', 'materiels', 'devis', 'factures', 'ged', 'coffre'];
