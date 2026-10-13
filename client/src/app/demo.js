// Document de démonstration, utilisé quand l'API n'est pas joignable (calcul local complet).
import { ETIQUETTES_LIGNE, COULEURS_TYPE_PRIX, MODELES_DOCUMENT } from './vues-document.js';

export const DEFINITION_DEMO = {
  type: { tyd_id: 1, tyd_code: 'V_DEVIS', tyd_libelle: 'Devis client', tyd_famille: 'V' },
  proprietes: [
    { prd_id: 1, prd_niveau: 'E', prd_code: 'chantier', prd_libelle: 'Chantier', prd_type_donnee: 'texte', prd_obligatoire: true, prd_groupe: 'Chantier', prd_ordre: 1 },
    { prd_id: 2, prd_niveau: 'E', prd_code: 'duree_validite', prd_libelle: 'Durée de validité (jours)', prd_type_donnee: 'entier', prd_ordre: 2 },
  ],
  statuts: [{ std_id: 1, std_code: 'BROUILLON', std_libelle: 'Brouillon', std_modifiable: true }],
  etiquettes: ETIQUETTES_LIGNE,
  couleurs_type_prix: COULEURS_TYPE_PRIX,
  modeles: MODELES_DOCUMENT,
  types_ligne: [
    { tyl_id: 1, tyl_code: 'TITRE', tyl_libelle: 'Titre' },
    { tyl_id: 2, tyl_code: 'OUVRAGE', tyl_libelle: 'Ouvrage' },
    { tyl_id: 3, tyl_code: 'ELEMENT', tyl_libelle: 'Élément' },
    { tyl_id: 4, tyl_code: 'TEXTE', tyl_libelle: 'Texte' },
    { tyl_id: 5, tyl_code: 'SOUS_TOTAL', tyl_libelle: 'Sous-total' },
    { tyl_id: 6, tyl_code: 'IMAGE', tyl_libelle: 'Image' },
    { tyl_id: 7, tyl_code: 'SAUT_PAGE', tyl_libelle: 'Saut de page' },
    { tyl_id: 8, tyl_code: 'PIED_HT', tyl_libelle: 'Poste de pied HT' },
    { tyl_id: 9, tyl_code: 'PIED_TTC', tyl_libelle: 'Poste de pied TTC' },
    { tyl_id: 10, tyl_code: 'TVA', tyl_libelle: 'Ventilation TVA' },
  ],
  taux_tva: [
    { ttv_id: 1, ttv_code: 'T20', ttv_libelle: 'TVA 20 %', ttv_taux: 20, ttv_categorie: 'N' },
    { ttv_id: 2, ttv_code: 'T10', ttv_libelle: 'TVA 10 %', ttv_taux: 10, ttv_categorie: 'N' },
    { ttv_id: 4, ttv_code: 'AL20', ttv_libelle: 'Autoliquidation', ttv_taux: 20, ttv_categorie: 'A', ttv_mention: 'Autoliquidation – article 283-2 nonies du CGI' },
  ],
  unites: [
    ['u', 'Unité'], ['ens', 'Ensemble'], ['ft', 'Forfait'], ['pce', 'Pièce'], ['m', 'Mètre'], ['ml', 'Mètre linéaire'],
    ['m2', 'Mètre carré'], ['m3', 'Mètre cube'], ['kg', 'Kilogramme'], ['t', 'Tonne'], ['l', 'Litre'], ['h', 'Heure'], ['j', 'Jour'],
  ].map(([unt_code, unt_libelle]) => ({ unt_code, unt_libelle })),
  transformations: [],
  droits: ['CREER', 'MODIFIER'],
};

const L = (o) => ({ lig_ent_id: 0, lig_proprietes: {}, ...o });

export const DOCUMENT_DEMO = {
  document: {
    ent_id: 0, ent_tyd_id: 1, ent_numero: 'DÉMO', ent_date: '2026-09-23', ent_objet: 'Extension maison individuelle',
    ent_std_id: 1, ent_tiers_id: 1, ent_mode_calcul_ouvrage: 'V', ent_modele: 'COMPLET', ent_precision_montant: 2, ent_version: 1, ent_bib_id: null,
    ent_num_format: { separateur: '.', niveaux: [{ style: 'A' }, { style: '1' }, { style: 'a' }] },
    ent_proprietes: { chantier: 'Maison Martin – Lyon', duree_validite: 30 },
  },
  lignes: [
    L({ lig_id: 1, lig_parent_id: null, lig_ordre: 1, lig_tyl_id: 1, lig_libelle_html: '<b>Gros œuvre</b>', lig_tva_id: 1 }),
    L({ lig_id: 16, lig_parent_id: 1, lig_ordre: 0, lig_tyl_id: 4, lig_libelle_html: "<p><b>Conditions d'exécution</b></p><p>Accès chantier par la rue des Lilas.<br>Stationnement et évacuation des gravats à la charge de l'entreprise.</p>" }),
    L({ lig_id: 2, lig_etiquette: 'PRIX_CONFIRME', lig_parent_id: 1, lig_ordre: 1, lig_tyl_id: 2, lig_libelle_html: '<p><b>Dalle béton armé ép. 15 cm</b></p><p>Béton C25/30 dosé à 350 kg/m³, treillis soudé ST25 compris.<br>Finition talochée, joints de retrait tous les 25 m².</p>', lig_qte: 120, lig_unt_code: 'm2', lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_tva_id: 1 }),
    L({ lig_id: 3, lig_parent_id: 2, lig_ordre: 1, lig_tyl_id: 3, lig_libelle_html: 'Béton C25/30', lig_qte: 0.15, lig_qte_type: 'R', lig_coef_perte: 1.05, lig_precision_qte: 4, lig_unt_code: 'm3', lig_pa: 110, lig_coef_fg: 1.1, lig_coef_benef: 1.2 }),
    L({ lig_id: 4, lig_parent_id: 2, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Treillis soudé ST25', lig_qte: 1.1, lig_qte_type: 'R', lig_unt_code: 'm2', lig_pa: 3.8, lig_coef_fg: 1.1, lig_coef_benef: 1.2 }),
    L({ lig_id: 5, lig_etiquette: 'A_CHIFFRER', lig_parent_id: 2, lig_ordre: 3, lig_tyl_id: 3, lig_libelle_html: 'Main-d\'œuvre coulage', lig_qte: 16, lig_qte_type: 'A', lig_unt_code: 'h', lig_pa: 38, lig_coef_fg: 1.1, lig_coef_benef: 1.2 }),
    L({ lig_id: 6, lig_etiquette: 'A_VERIFIER', lig_parent_id: 1, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Murs parpaings – {{@surface}} m²<br><i>Parpaings creux 20 × 20 × 50, chaînages horizontaux et verticaux compris</i>', lig_qte_source: 'M', lig_mtr_id: 100, lig_unt_code: 'm2', lig_pa: 42, lig_coef_benef: 1.25, lig_tva_id: 1 }),
    L({ lig_id: 7, lig_parent_id: 1, lig_ordre: 3, lig_tyl_id: 5, lig_libelle_html: 'Sous-total gros œuvre' }),
    L({ lig_id: 8, lig_parent_id: null, lig_ordre: 2, lig_tyl_id: 1, lig_libelle_html: '<b>Menuiseries</b>', lig_tva_id: 2 }),
    L({ lig_id: 9, lig_etiquette: 'VALIDE', lig_parent_id: 8, lig_ordre: 1, lig_tyl_id: 2, lig_libelle_html: '<p>Fenêtre PVC 120 × 135 posée</p><ul><li>Double vitrage 4/16/4 argon, Uw 1,3</li><li>Oscillo-battant, poignée centrée</li><li>Pose en rénovation sur dormant existant</li></ul>', lig_qte: 4, lig_unt_code: 'u', lig_pv_fixe: true, lig_pv: 890, lig_tva_id: 2 }),
    L({ lig_id: 10, lig_parent_id: 9, lig_ordre: 1, lig_tyl_id: 3, lig_libelle_html: 'Fenêtre PVC', lig_qte: 1, lig_unt_code: 'u', lig_pa: 420, lig_coef_benef: 1.3 }),
    L({ lig_id: 11, lig_parent_id: 9, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Pose', lig_qte: 3.5, lig_unt_code: 'h', lig_pa: 38, lig_coef_benef: 1.4 }),
    L({ lig_id: 12, lig_etiquette: 'ATTENTE_PRIX', lig_parent_id: 8, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Option : volets roulants motorisés', lig_qte: 4, lig_unt_code: 'u', lig_pa: 310, lig_coef_benef: 1.3, lig_type_prix: 'O', lig_tva_id: 2 }),
    L({ lig_id: 13, lig_parent_id: null, lig_ordre: 3, lig_tyl_id: 8, lig_libelle_html: 'Remise commerciale', lig_pied_mode: 'P', lig_pied_base: 'CUMUL', lig_pied_valeur: 3, lig_pied_sens: -1 }),
    L({ lig_id: 14, lig_parent_id: null, lig_ordre: 4, lig_tyl_id: 10, lig_libelle_html: 'TVA' }),
    L({ lig_id: 15, lig_parent_id: null, lig_ordre: 5, lig_tyl_id: 9, lig_libelle_html: 'Retenue de garantie 5 %', lig_pied_mode: 'P', lig_pied_base: 'CUMUL', lig_pied_valeur: 5, lig_pied_sens: -1 }),
  ],
  metres: [{ mtr_id: 100, mtr_lig_id: 6, mtr_libelle: 'Surface des murs', mtr_unt_code: 'm2', mtr_variable: '@surface' }],
  metre_lignes: [
    { mli_id: 101, mli_mtr_id: 100, mli_parent_id: null, mli_ordre: 1, mli_type: 'D', mli_operateur: '+', mli_commentaire: 'Linéaire de murs' },
    { mli_id: 102, mli_mtr_id: 100, mli_parent_id: 101, mli_ordre: 1, mli_type: 'V', mli_operateur: '+', mli_formule: '8,4', mli_commentaire: 'Façade nord' },
    { mli_id: 103, mli_mtr_id: 100, mli_parent_id: 101, mli_ordre: 2, mli_type: 'V', mli_operateur: '+', mli_formule: '6,2', mli_commentaire: 'Pignon est' },
    { mli_id: 104, mli_mtr_id: 100, mli_parent_id: 101, mli_ordre: 3, mli_type: 'V', mli_operateur: '+', mli_formule: '8,4', mli_commentaire: 'Façade sud' },
    { mli_id: 105, mli_mtr_id: 100, mli_parent_id: null, mli_ordre: 2, mli_type: 'V', mli_operateur: '*', mli_formule: '{{$$hauteur_etage}}', mli_commentaire: 'Hauteur d\'étage' },
    { mli_id: 106, mli_mtr_id: 100, mli_parent_id: null, mli_ordre: 3, mli_type: 'V', mli_operateur: '-', mli_formule: '2 * 1,2 * 1,35', mli_commentaire: 'Deux fenêtres' },
  ],
  variables: [
    { var_id: 1, var_ent_id: 0, var_lig_id: null, var_mtr_id: null, var_portee: '$$', var_nom: 'hauteur_etage', var_operation: '=', var_formule: '2,5', var_ordre: 1 },
  ],
  tva: [],
};
