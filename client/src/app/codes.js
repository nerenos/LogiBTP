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

/** Types de prix d'un marché (révision et actualisation, CONCEPTION-REVISION-PRIX.md Q1). */
export const TYPE_PRIX = Object.freeze({
  FERME: 'FERME',
  ACTUALISABLE: 'ACTUALISABLE',
  REVISABLE: 'REVISABLE',
});

/** Arrondi du coefficient de révision. */
export const ARRONDI_REVISION = Object.freeze({
  PROCHE: 'PROCHE',
  SUPERIEUR: 'SUPERIEUR',
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
  RENTABILITE: 'rentabilite',
  SOUS_TRAITANCE: 'sous_traitance',
  STOCK: 'stock',
});

/** Rôle d'un type de pièce dans le module Rentabilité (rentabilite_role_type, db/258). */
export const ROLE_RENTABILITE = Object.freeze({
  COMMANDE_VENTE: 'COMMANDE_VENTE',
  FACTURE_VENTE: 'FACTURE_VENTE',
  FACTURE_ACOMPTE: 'FACTURE_ACOMPTE',
  AVOIR_VENTE: 'AVOIR_VENTE',
  ORDRE_EXECUTION: 'ORDRE_EXECUTION',
  COMMANDE_ACHAT: 'COMMANDE_ACHAT',
  RECEPTION_ACHAT: 'RECEPTION_ACHAT',
  RETOUR_ACHAT: 'RETOUR_ACHAT',
  FACTURE_ACHAT: 'FACTURE_ACHAT',
  AVOIR_ACHAT: 'AVOIR_ACHAT',
  COMMANDE_ST: 'COMMANDE_ST',
  FACTURE_ST: 'FACTURE_ST',
  AVOIR_ST: 'AVOIR_ST',
  RESERVATION_STOCK: 'RESERVATION_STOCK',
  MOUVEMENT_STOCK: 'MOUVEMENT_STOCK',
  RECU_ACOMPTE: 'RECU_ACOMPTE',
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

/** États affichés d'un document dans les listes, calculés par v_liste_documents (db/253, Q3 : jamais de statut posé). */
export const ETAT_LISTE_DOCUMENT = Object.freeze({ EXPIRE: 'EXPIRE', REFUSE: 'REFUSE' });

/**
 * Erreurs de validation d'un document qui désignent un champ hors des lignes (I2) : émises par le module Document
 * (TIERS_OBLIGATOIRE, DATE_*, PROPRIETE_OBLIGATOIRE, CONDITION_PAIEMENT) et par le cœur (SpecialisationBtp).
 */
export const ERREUR_DOCUMENT = Object.freeze({
  TIERS_OBLIGATOIRE: 'TIERS_OBLIGATOIRE', ADRESSE_LIVRAISON: 'ADRESSE_LIVRAISON', MARCHE_OBLIGATOIRE: 'MARCHE_OBLIGATOIRE',
  EXE_CHANTIER: 'EXE_CHANTIER', EXE_CHANTIER_UNIQUE: 'EXE_CHANTIER_UNIQUE', DATE_FUTURE: 'DATE_FUTURE', DATE_ANTERIEURE: 'DATE_ANTERIEURE',
  PROPRIETE_OBLIGATOIRE: 'PROPRIETE_OBLIGATOIRE', CONDITION_PAIEMENT: 'CONDITION_PAIEMENT',
});

/**
 * Champ en cause de chaque erreur de ERREUR_DOCUMENT : onglet de la page document, élément (sélecteur dans la vue de
 * l'onglet) encadré et clé du libellé (`document_btp.page.champs_erreur.<cle>`).
 */
export const CHAMPS_ERREUR_DOCUMENT = Object.freeze({
  [ERREUR_DOCUMENT.TIERS_OBLIGATOIRE]: { onglet: 'entete', selecteur: '.annuaire-document', cle: 'tiers' },
  [ERREUR_DOCUMENT.ADRESSE_LIVRAISON]: { onglet: 'entete', selecteur: '[data-adresse]', cle: 'adresse' },
  [ERREUR_DOCUMENT.MARCHE_OBLIGATOIRE]: { onglet: 'entete', selecteur: '.rattachement-document', cle: 'rattachement' },
  [ERREUR_DOCUMENT.EXE_CHANTIER]: { onglet: 'entete', selecteur: '.rattachement-document', cle: 'rattachement' },
  [ERREUR_DOCUMENT.EXE_CHANTIER_UNIQUE]: { onglet: 'entete', selecteur: '.rattachement-document', cle: 'rattachement' },
  [ERREUR_DOCUMENT.DATE_FUTURE]: { onglet: 'entete', selecteur: '[data-champ="ent_date"]', cle: 'date' },
  [ERREUR_DOCUMENT.DATE_ANTERIEURE]: { onglet: 'entete', selecteur: '[data-champ="ent_date"]', cle: 'date' },
  [ERREUR_DOCUMENT.PROPRIETE_OBLIGATOIRE]: { onglet: 'entete', selecteur: '[data-prop]', cle: 'propriete' },
  [ERREUR_DOCUMENT.CONDITION_PAIEMENT]: { onglet: 'reglements', selecteur: '.reglement-document', cle: 'reglement' },
});

/** Pastilles de la colonne État des documents (format `pastille` du module Liste) : code → libellé et teinte (L2). */
export const PASTILLES_ETAT_DOCUMENT = Object.freeze([
  { valeur: 'BROUILLON', libelle: 'Brouillon', teinte: 'neutre' },
  { valeur: 'APPROUVE', libelle: 'Approuvé', teinte: 'info' },
  { valeur: 'VALIDE', libelle: 'Validé', teinte: 'info' },
  { valeur: 'ENVOYE', libelle: 'Envoyé', teinte: 'envoye' },
  { valeur: 'ACCEPTE', libelle: 'Accepté', teinte: 'succes' },
  { valeur: 'FACTURATION', libelle: 'En facturation', teinte: 'termine' },
  { valeur: 'FACTURE', libelle: 'Facturé', teinte: 'termine' },
  { valeur: 'SOLDE', libelle: 'Soldé', teinte: 'termine' },
  { valeur: 'PAYE_PARTIEL', libelle: 'Payé partiellement', teinte: 'succes' },
  { valeur: 'PAYE', libelle: 'Payé', teinte: 'succes' },
  { valeur: ETAT_LISTE_DOCUMENT.EXPIRE, libelle: 'Expiré', teinte: 'attention' },
  { valeur: ETAT_LISTE_DOCUMENT.REFUSE, libelle: 'Refusé', teinte: 'erreur' },
  { valeur: 'NON_RETENU', libelle: 'Non retenu', teinte: 'erreur' },
  { valeur: 'ANNULE', libelle: 'Annulé', teinte: 'barre' },
  { valeur: 'REMPLACE', libelle: 'Remplacé', teinte: 'barre' },
].map(Object.freeze));

/** Pastilles des statuts de la structure (projet, affaire, chantier, marché ; contraintes de db/160). */
export const PASTILLES_STATUT_STRUCTURE = Object.freeze({
  projet: [
    { valeur: 'EN_COURS', libelle: 'En cours', teinte: 'info' }, { valeur: 'REMIS', libelle: 'Offre remise', teinte: 'envoye' },
    { valeur: 'OBTENU', libelle: 'Obtenu', teinte: 'succes' }, { valeur: 'PERDU', libelle: 'Perdu', teinte: 'erreur' },
    { valeur: 'ABANDONNE', libelle: 'Abandonné', teinte: 'barre' },
  ],
  affaire: [{ valeur: 'OUVERTE', libelle: 'Ouverte', teinte: 'info' }, { valeur: 'CLOSE', libelle: 'Close', teinte: 'termine' }],
  chantier: [
    { valeur: 'OUVERT', libelle: 'Ouvert', teinte: 'info' }, { valeur: 'TERMINE', libelle: 'Terminé', teinte: 'succes' },
    { valeur: 'CLOS', libelle: 'Clos', teinte: 'termine' },
  ],
  marche: [
    { valeur: 'EN_COURS', libelle: 'En cours', teinte: 'info' }, { valeur: 'SOLDE', libelle: 'Soldé', teinte: 'termine' },
    { valeur: 'RESILIE', libelle: 'Résilié', teinte: 'erreur' },
  ],
});
