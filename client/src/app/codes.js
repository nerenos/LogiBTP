// Codes du cœur côté client, répliqués dans src/LogiBTP.Domaine/Codes.cs (parité vérifiée par CodesTests.cs).

import { STATUT_CDV } from '@logibtp/facture-electronique';

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
  V_PRODUCTION: 'V_PRODUCTION',
  V_FACTURE: 'V_FACTURE',
  V_FACTURE_AVT: 'V_FACTURE_AVT',
  V_REPRISE_AVT: 'V_REPRISE_AVT',
  V_AVOIR: 'V_AVOIR',
  V_DEMANDE_ACOMPTE: 'V_DEMANDE_ACOMPTE',
  A_COMMANDE: 'A_COMMANDE',
  A_RECEPTION: 'A_RECEPTION',
  A_RETOUR: 'A_RETOUR',
  A_FACTURE: 'A_FACTURE',
  A_FACTURE_AVT: 'A_FACTURE_AVT',
  A_AVOIR: 'A_AVOIR',
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
  S_INVENTAIRE: 'S_INVENTAIRE',
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
  FACTURE_ELECTRONIQUE: 'facture_electronique',
  PLANNING: 'planning',
  POINTAGE: 'pointage',
  REGLEMENT: 'reglement',
  RELANCE: 'relance',
  RENTABILITE: 'rentabilite',
  SAV: 'sav',
  SOUS_TRAITANCE: 'sous_traitance',
  STOCK: 'stock',
});

/** Avertissements de gestion du cœur à la validation d'une pièce (non bloquants). */
export const AVERTISSEMENT_GESTION = Object.freeze({
  TVA_NON_AUTOLIQUEE: 'TVA_NON_AUTOLIQUEE',
});

/** Modèles d'édition connus du code (editions/modeles.js) ; FRAIS_ANNEXES (interne) n'est jamais le dernier imprimé du document. */
export const MODELE_EDITION = Object.freeze({
  FRAIS_ANNEXES: 'FRAIS_ANNEXES',
  FICHE_DOTATION: 'FICHE_DOTATION',
  // Lettres de relance (source « relance ») ; MISE_EN_DEMEURE : dernier niveau des factures.
  RELANCE_1: 'RELANCE_1',
  RELANCE_2: 'RELANCE_2',
  MISE_EN_DEMEURE: 'MISE_EN_DEMEURE',
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
  PRODUCTION: 'PRODUCTION',
});

/** Type d'élément du cœur rattaché à un flux de facturation électronique (fe_flux.ffl_type_element) : pièce (ent_id). */
export const TYPE_ELEMENT_FE = Object.freeze({
  DOCUMENT: 'DOCUMENT',
  /** Ligne de la liste « Factures reçues à traiter » sans pièce (db/296) : flux reçu, ouvert dans la page du module. */
  FLUX: 'fe_flux',
});

/** Avertissement d'émission lié à l'annuaire des plateformes (lot 20). */
export const AVERTISSEMENT_ANNUAIRE_FE = Object.freeze({
  HORS_ANNUAIRE: 'HORS_ANNUAIRE',
  NON_VERIFIE: 'NON_VERIFIE',
});

/** Plateforme de réception inscrite sur la fiche d'un tiers depuis l'annuaire (lot 20). */
export const PLATEFORME_ANNUAIRE_FE = Object.freeze({
  PA: 'PA',
  PPF: 'PPF',
});

/** Nature d'une pièce émise en facture électronique (lot 21, Q8) : lettre du cadre BT-23 (biens, services, mixte). */
export const NATURE_FE = Object.freeze({
  BIENS: 'B',
  SERVICES: 'S',
  MIXTE: 'M',
});

/**
 * Situation de la pièce émise qui fixe le chiffre du cadre BT-23 (lot 21) : dépôt simple (1), déjà payée (2), définitive
 * après acompte (4), émise comme sous-traitant (5) ou cotraitant (6).
 */
export const SITUATION_CADRE_FE = Object.freeze({
  DEPOT: 'DEPOT',
  DEJA_PAYEE: 'DEJA_PAYEE',
  DEFINITIVE_APRES_ACOMPTE: 'DEFINITIVE_APRES_ACOMPTE',
  SOUS_TRAITANT: 'SOUS_TRAITANT',
  COTRAITANT: 'COTRAITANT',
});

/**
 * Écarts de l'émission d'une pièce de vente en facture électronique (lot 22, Btp/EmissionFactureBtp.cs), en plus de la
 * complétude du module : données de LogiBTP manquantes ou provisoires (bandeau de la pièce dans l'éditeur).
 */
export const ECART_EMISSION_FE = Object.freeze({
  NUMERO_PROVISOIRE: 'NUMERO_PROVISOIRE',
  SOCIETE_ABSENTE: 'SOCIETE_ABSENTE',
  TIERS_ABSENT: 'TIERS_ABSENT',
  ADRESSE_ABSENTE: 'ADRESSE_ABSENTE',
  TVA_ABSENTE: 'TVA_ABSENTE',
  IBAN_ABSENT: 'IBAN_ABSENT',
  PAIEMENT_ABSENT: 'PAIEMENT_ABSENT',
  ACOMPTE_ABSENT: 'ACOMPTE_ABSENT',
  ORIGINE_ABSENTE: 'ORIGINE_ABSENTE',
});

/**
 * État de l'émission d'une pièce de vente en facture électronique (lot 24, document_fe_emission.dfe_etat, db/300) : à
 * émettre (tâche de fond), envoyer plus tard ou émission manuelle (bouton « Émettre »), émise (flux en file), échec de
 * la production, hors flux 2 (tiers particulier, international ou absent de l'annuaire : envoi habituel).
 */
export const ETAT_EMISSION_FE = Object.freeze({
  A_EMETTRE: 'A_EMETTRE',
  DIFFEREE: 'DIFFEREE',
  EMISE: 'EMISE',
  ECHEC: 'ECHEC',
  HORS_FLUX: 'HORS_FLUX',
});

/** Motif d'une pièce hors flux 2 ou d'un échec de l'émission (document_fe_emission.dfe_motif, lot 24). */
export const MOTIF_EMISSION_FE = Object.freeze({
  B2C: 'B2C',
  INTERNATIONAL: 'INTERNATIONAL',
  HORS_ANNUAIRE: 'HORS_ANNUAIRE',
  INCOMPLETE: 'INCOMPLETE',
  PRODUCTION: 'PRODUCTION',
  AVOIR_INTERNE: 'AVOIR_INTERNE',
});

/**
 * Transmission de l'avoir interne d'annulation d'une facture émise rejetée (213) ou refusée (210), choisie par
 * l'utilisateur (lot 25, Q14) : déposé pour archivage seul (note BAR ARCHIVEONLY), ou non déposé.
 */
export const TRANSMISSION_AVOIR_INTERNE_FE = Object.freeze({
  ARCHIVAGE_SEUL: 'ARCHIVAGE_SEUL',
  AUCUNE: 'AUCUNE',
});

/**
 * Pastille « Facture électronique » d'une pièce (colonne statut_fe de v_liste_documents, page document) hors statuts du
 * cycle de vie (STATUT_CDV du module) : flux en file ou déposé sans statut, flux en erreur ou échec de l'émission.
 */
export const PASTILLE_EMISSION_FE = Object.freeze({
  A_EMETTRE: 'A_EMETTRE',
  DIFFEREE: 'DIFFEREE',
  EN_FILE: 'EN_FILE',
  ERREUR: 'ERREUR',
  HORS_FLUX: 'HORS_FLUX',
});

/**
 * Pastilles de la colonne « Facture électronique » des listes de factures (vues-liste.js, db/121) : états de l'émission
 * puis statuts du cycle de vie (codes STATUT_CDV du module) ; libellés gardés en base avec la vue.
 */
export const PASTILLES_EMISSION_FE_LISTE = Object.freeze([
  { valeur: PASTILLE_EMISSION_FE.A_EMETTRE, libelle: 'À émettre', teinte: 'info' },
  { valeur: PASTILLE_EMISSION_FE.DIFFEREE, libelle: 'Envoi différé', teinte: 'neutre' },
  { valeur: PASTILLE_EMISSION_FE.EN_FILE, libelle: 'En cours d\'envoi', teinte: 'envoye' },
  { valeur: PASTILLE_EMISSION_FE.ERREUR, libelle: 'En erreur', teinte: 'erreur' },
  { valeur: PASTILLE_EMISSION_FE.HORS_FLUX, libelle: 'Envoi habituel', teinte: 'neutre' },
  { valeur: STATUT_CDV.DEPOSEE, libelle: 'Déposée', teinte: 'envoye' },
  { valeur: STATUT_CDV.EMISE, libelle: 'Émise', teinte: 'envoye' },
  { valeur: STATUT_CDV.RECUE, libelle: 'Reçue', teinte: 'envoye' },
  { valeur: STATUT_CDV.MISE_A_DISPOSITION, libelle: 'Mise à disposition', teinte: 'envoye' },
  { valeur: STATUT_CDV.PRISE_EN_CHARGE, libelle: 'Prise en charge', teinte: 'info' },
  { valeur: STATUT_CDV.APPROUVEE, libelle: 'Approuvée', teinte: 'succes' },
  { valeur: STATUT_CDV.APPROUVEE_PARTIELLEMENT, libelle: 'Approuvée partiellement', teinte: 'attention' },
  { valeur: STATUT_CDV.EN_LITIGE, libelle: 'En litige', teinte: 'attention' },
  { valeur: STATUT_CDV.SUSPENDUE, libelle: 'Suspendue', teinte: 'attention' },
  { valeur: STATUT_CDV.COMPLETEE, libelle: 'Complétée', teinte: 'info' },
  { valeur: STATUT_CDV.REFUSEE, libelle: 'Refusée', teinte: 'erreur' },
  { valeur: STATUT_CDV.PAIEMENT_TRANSMIS, libelle: 'Paiement transmis', teinte: 'succes' },
  { valeur: STATUT_CDV.ENCAISSEE, libelle: 'Encaissée', teinte: 'termine' },
  { valeur: STATUT_CDV.REJETEE, libelle: 'Rejetée', teinte: 'erreur' },
  { valeur: STATUT_CDV.VISEE, libelle: 'Visée', teinte: 'info' },
  { valeur: STATUT_CDV.ANNULEE, libelle: 'Annulée', teinte: 'barre' },
  { valeur: STATUT_CDV.ERREUR_ROUTAGE, libelle: 'Erreur de routage', teinte: 'erreur' },
  { valeur: STATUT_CDV.IRRECEVABLE, libelle: 'Irrecevable', teinte: 'erreur' },
]);

/** Erreurs de l'émission d'une pièce (validation refusée, bouton « Émettre »), lot 24. */
export const ERREUR_EMISSION_FE = Object.freeze({
  INCOMPLETE: 'FE_INCOMPLETE',
  DEJA_EMISE: 'FE_DEJA_EMISE',
  NON_EMETTABLE: 'FE_NON_EMETTABLE',
  ANNULATION_IMPOSSIBLE: 'FE_ANNULATION_IMPOSSIBLE',
});

/** Signaux de notification de la facturation électronique (db/295, types du module « facture_electronique »). */
export const SIGNAL_FE = Object.freeze({
  RECUE: 'RECUE',
  REJET: 'REJET',
  REFUS: 'REFUS',
  LITIGE: 'LITIGE',
  ERREUR_FILE: 'ERREUR_FILE',
  // Demande de paiement direct (statut 224) reçue d'un sous-traitant (lot 15, db/297).
  PAIEMENT_DIRECT: 'PAIEMENT_DIRECT',
});

/** Garantie de paiement d'un marché de sous-traitance (marche.mar_garantie) qui ouvre une demande de paiement (module Sous-traitance, 092b). */
export const GARANTIE_MARCHE = Object.freeze({
  PAIEMENT_DIRECT: 'PAIEMENT_DIRECT',
  DELEGATION: 'DELEGATION',
});

/** Rôle d'un type de pièce dans le module Relances (type_document.tyd_role_relance, db/283) ; sans rôle : jamais relancé. */
export const ROLE_RELANCE = Object.freeze({
  DEVIS: 'DEVIS',
  FACTURE: 'FACTURE',
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

/** États d'une réserve suivie d'une réception de pose (Codes.cs : EtatsReserve ; plan terrain-suites, lot 14, db/290). */
export const ETAT_RESERVE = Object.freeze({ OUVERTE: 'OUVERTE', LEVEE: 'LEVEE' });

/** Erreurs du terrain testées par l'interface (Codes.cs : ErreursTerrain) ; ORDRE_INCONNU : plan terrain-suites, lot 10. */
export const ERREUR_TERRAIN = Object.freeze({ ORDRE_INCONNU: 'ORDRE_INCONNU' });

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

/** Statuts du cycle des documents propres au cœur (db/179) ↔ StatutsDocumentBtp ; ceux du module : STATUT_DOCUMENT. */
export const STATUT_DOCUMENT_BTP = Object.freeze({
  FACTURATION: 'FACTURATION',
  FACTURE: 'FACTURE',
});

/** Pastilles de la colonne État des documents (format `pastille` du module Liste) : code → libellé et teinte (L2). */
export const PASTILLES_ETAT_DOCUMENT = Object.freeze([
  { valeur: 'BROUILLON', libelle: 'Brouillon', teinte: 'neutre' },
  { valeur: 'APPROUVE', libelle: 'Approuvé', teinte: 'info' },
  { valeur: 'VALIDE', libelle: 'Validé', teinte: 'info' },
  { valeur: 'ENVOYE', libelle: 'Envoyé', teinte: 'envoye' },
  { valeur: 'ACCEPTE', libelle: 'Accepté', teinte: 'succes' },
  { valeur: STATUT_DOCUMENT_BTP.FACTURATION, libelle: 'En facturation', teinte: 'termine' },
  { valeur: STATUT_DOCUMENT_BTP.FACTURE, libelle: 'Facturé', teinte: 'termine' },
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
