// Codes du cœur côté client, répliqués dans src/LogiBTP.Domaine/Codes.cs (parité vérifiée par CodesTests.cs).

/** Types de fiches du cœur (clés de TYPES_FICHE, type d'élément de la GED, du CRM et du planning). */
export const TYPE_FICHE = Object.freeze({
  SALARIE: 'salarie',
  MATERIEL: 'materiel',
  ELEMENT: 'element',
  PERSONNE: 'personne',
  INDIVIDU: 'individu',
  PROJET: 'projet',
  AFFAIRE: 'affaire',
  CHANTIER: 'chantier',
  MARCHE: 'marche',
});

/** Types de documents connus du code (les autres types sont du paramétrage). */
export const TYPE_DOCUMENT = Object.freeze({
  V_DEVIS: 'V_DEVIS',
  V_COMMANDE: 'V_COMMANDE',
  V_RECEPTION: 'V_RECEPTION',
  V_RETOUR: 'V_RETOUR',
  V_SITUATION: 'V_SITUATION',
  V_FACTURE: 'V_FACTURE',
  V_FACTURE_AVT: 'V_FACTURE_AVT',
  V_REPRISE_AVT: 'V_REPRISE_AVT',
  V_AVOIR: 'V_AVOIR',
  V_DEMANDE_ACOMPTE: 'V_DEMANDE_ACOMPTE',
  A_COMMANDE: 'A_COMMANDE',
  A_RECEPTION: 'A_RECEPTION',
  A_RETOUR: 'A_RETOUR',
  A_FACTURE: 'A_FACTURE',
  T_AO: 'T_AO',
  T_COMMANDE: 'T_COMMANDE',
  T_FACTURE_AVT: 'T_FACTURE_AVT',
  E_OE: 'E_OE',
  E_PO: 'E_PO',
  E_DAP: 'E_DAP',
  E_SAV: 'E_SAV',
  E_OST: 'E_OST',
  E_DAC: 'E_DAC',
  E_ENT: 'E_ENT',
  S_ENTREE: 'S_ENTREE',
  S_SORTIE: 'S_SORTIE',
  S_TRANSFERT: 'S_TRANSFERT',
  S_RESERVATION: 'S_RESERVATION',
});

/** Commandes qui reçoivent un accusé de réception (ARC). */
export const TYPES_ARC = Object.freeze([TYPE_DOCUMENT.A_COMMANDE, TYPE_DOCUMENT.T_COMMANDE]);

/** Documents d'où l'on sous-traite (assistant « Sous-traiter »). */
export const TYPES_SOUS_TRAITABLES = Object.freeze([TYPE_DOCUMENT.V_COMMANDE, TYPE_DOCUMENT.V_DEVIS, TYPE_DOCUMENT.E_OST, TYPE_DOCUMENT.E_DAC]);

/** Types de postes de pied d'un marché (marche_poste). */
export const TYPE_POSTE_MARCHE = Object.freeze({
  PAIEMENT_DIRECT: 'PAIEMENT_DIRECT',
  PRORATA: 'PRORATA',
  REMISE: 'REMISE',
  AUTRE: 'AUTRE',
});

/** Types de ressources affectées (planning, affectations du matériel). */
export const TYPE_RESSOURCE = Object.freeze({
  SALARIE: 'SALARIE',
  INTERIM: 'INTERIM',
  SOUS_TRAITANT: 'SOUS_TRAITANT',
  MATERIEL: 'MATERIEL',
});

/** Modules facultatifs d'une société (module_societe) : app.moduleActif(code), propriété module des menus. */
export const MODULE_FACULTATIF = Object.freeze({
  CRM: 'crm',
  EXECUTION: 'execution',
  PLANNING: 'planning',
  POINTAGE: 'pointage',
  REGLEMENT: 'reglement',
  SOUS_TRAITANCE: 'sous_traitance',
  STOCK: 'stock',
});

/** Sujets publiés entre les fenêtres de l'application (app.publier / app.abonner). */
export const SUJET_FENETRE = Object.freeze({
  CRM: 'crm',
  ENREGISTRE: 'enregistre',
  SESSION: 'session',
  MAIL: 'mail',
  NOTIFICATIONS: 'notifications',
  COMPTEUR_NOTIFICATIONS: 'compteur-notifications',
  OAUTH: 'oauth',
  THEMES: 'themes',
  HORS_LIGNE_ENVOYE: 'hors-ligne-envoye',
  PLANNING_ALLER: 'planning-aller',
  PLANNING_PANNEAU: 'planning-panneau',
  PLANNING_SELECTION: 'planning-selection',
});

/** Adresse de la fiche d'un élément. */
export const urlFiche = (type, id) => `/fiche/${type}/${id}`;

/** Adresse d'un document. */
export const urlDocument = (id) => `/document/${id}`;

/** Préférences de l'application dans le localStorage (recopiée dans public/demarrage-theme.js). */
export const CLE_PREFERENCES_NAVIGATION = 'logibtp.navigation';
