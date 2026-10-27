// Bibliothèque de démonstration : source de db/116_bibliotheque_demo.sql
// (généré par client/scripts/generer-vues-liste.mjs). Prix en unité de stock ; les prix calculés (PA, PR, PV)
// sont recalculés par le script ou par l'API à la première modification.

export const BIBLIOTHEQUES = [
  { id: 1, code: 'GEN', libelle: 'Bibliothèque générale', defaut: true, actif: true, ordre: 1 },
  { id: 2, code: 'FAB', libelle: 'Catalogue fabricants', defaut: false, actif: true, ordre: 2 },
];

export const REGROUPEMENTS = [
  { code: 'MO', libelle: "Main-d'œuvre", ordre: 10 }, { code: 'MATERIAUX', libelle: 'Matériaux', ordre: 20 }, { code: 'ENGIN', libelle: 'Engins', ordre: 30 },
  { code: 'SOUS_TRAITANCE', libelle: 'Sous-traitance', ordre: 40 }, { code: 'PRESTATION', libelle: 'Prestations', ordre: 50 }, { code: 'VENTE', libelle: 'Vente', ordre: 60 },
  // Regroupement personnalisé : la fabrication réunit main-d'œuvre d'atelier et sous-traitance.
  { code: 'FABRICATION', libelle: 'Fabrication', ordre: 70 },
];

export const NATURES = [
  { id: 1, code: 'MO', libelle: "Main-d'œuvre", regroupement: 'MO', axe_analytique: 'MO', compte_achat: '641100', compte_vente: '704000', actif: true, types: ['MO'] },
  { id: 2, code: 'MAT', libelle: 'Matériaux et fournitures', regroupement: 'MATERIAUX', axe_analytique: 'FOURN', compte_achat: '601000', compte_vente: '701000', actif: true, types: ['MATERIAUX'] },
  { id: 3, code: 'LOC', libelle: "Location d'engins", regroupement: 'ENGIN', axe_analytique: 'ENGIN', compte_achat: '613500', compte_vente: '706000', actif: true, types: ['ENGIN'] },
  { id: 4, code: 'ST', libelle: 'Sous-traitance', regroupement: 'SOUS_TRAITANCE', axe_analytique: 'ST', compte_achat: '604000', compte_vente: '704000', actif: true, types: ['SOUS_TRAITANCE'] },
  { id: 5, code: 'OUV', libelle: 'Ouvrages', regroupement: 'VENTE', axe_analytique: 'VENTE', compte_achat: null, compte_vente: '704000', actif: true, types: ['DIVERS'] },
  { id: 6, code: 'ISO', libelle: 'Isolants', regroupement: 'MATERIAUX', axe_analytique: 'FOURN', compte_achat: '601000', compte_vente: '701000', actif: true, isolant: true, types: ['MATERIAUX'] },
  { id: 7, code: 'FABAT', libelle: 'Fabrication atelier', regroupement: 'FABRICATION', axe_analytique: 'FAB', compte_achat: '604100', compte_vente: '704000', actif: true, types: ['MO', 'SOUS_TRAITANCE'] },
  { id: 8, code: 'AMO', libelle: 'Amortissement du matériel', regroupement: 'ENGIN', axe_analytique: 'ENGIN', compte_achat: '681120', compte_vente: null, actif: true, types: ['AMORTISSEMENT', 'FACTURATION_INTERNE'] },
].map((n) => ({ isolant: false, types: [], ...n }));

/** Coefficients par période : globaux (2025, 2026, 2027 à venir) et propres à des natures. */
export const PERIODES_COEFFICIENTS = [
  { id: 1, nat_id: null, debut: '2025-01-01', coef_fg: '1.1', coef_benef: '1.2', commentaire: 'Coefficients 2025', cree_par: 'admin' },
  { id: 2, nat_id: null, debut: '2026-01-01', coef_fg: '1.12', coef_benef: '1.18', commentaire: 'Révision annuelle 2026', cree_par: 'admin' },
  { id: 3, nat_id: null, debut: '2027-01-01', coef_fg: '1.15', coef_benef: '1.16', commentaire: 'Prévision 2027', cree_par: 'admin' },
  { id: 4, nat_id: 1, debut: '2026-01-01', coef_fg: '1.35', coef_benef: '1.15', commentaire: "Charges sociales de la main-d'œuvre", cree_par: 'admin' },
  { id: 5, nat_id: 3, debut: '2026-01-01', coef_fg: '1.05', coef_benef: null, commentaire: 'Location : frais réduits, bénéfice global', cree_par: 'admin' },
].map((p) => ({ cree_le: '2025-12-15T09:00:00Z', ...p }));

export const FAMILLES = [
  { id: 1, bib_id: 1, parent_id: null, code: 'GO', libelle: 'Gros œuvre', ordre: 1 },
  { id: 2, bib_id: 1, parent_id: 1, code: 'BET', libelle: 'Béton', ordre: 1 },
  { id: 3, bib_id: 1, parent_id: 2, code: 'ARM', libelle: 'Armatures', ordre: 2 },
  { id: 4, bib_id: 1, parent_id: 1, code: 'MAC', libelle: 'Maçonnerie', ordre: 2 },
  { id: 5, bib_id: 1, parent_id: null, code: 'MO', libelle: "Main-d'œuvre", ordre: 2 },
  { id: 6, bib_id: 1, parent_id: null, code: 'ENG', libelle: 'Engins et matériel', ordre: 3 },
  { id: 7, bib_id: 2, parent_id: null, code: 'PLAT', libelle: 'Plâtrerie', ordre: 1 },
  { id: 8, bib_id: 2, parent_id: 7, code: 'ISOL', libelle: 'Isolation', ordre: 2 },
];

/** Unités ajoutées au référentiel pour la démo (palette, plaque). */
export const UNITES_BIBLIOTHEQUE = [{ unt_code: 'pal', unt_libelle: 'Palette' }, { unt_code: 'pl', unt_libelle: 'Plaque' }, { unt_code: 'rl', unt_libelle: 'Rouleau' }];

const article = (o) => ({
  type: 'ARTICLE', actif: true, gestion: 'NON_GERE', unites: [], scenario_pa: 'FIXE', scenarios: null, pa_fixe: null, dernier_pa: null, pmp: null,
  coef_fg: '1.1', coef_benef: '1.2', pv: null, pv_fixe: false, coef_remise: '1', composition: null, image_ged: null, proprietes: {},
  coef_fg_impose: false, coef_benef_impose: false,
  poids: null, surface: null, surface_peinture: null, volume: null, hauteur: null, largeur: null, epaisseur: null, longueur: null, isolant_r: null, isolant_lambda: null, isolant_u: null,
  unite_achat: null, unite_vente: null, fam_id: null, nat_id: null, ...o,
});
const acier = (id, code, diametre, poids) => article({
  id, bib_id: 1, code, libelle_html: `<p><b>Acier HA${diametre}</b> – barre de 12 m</p><p>Fe E500, NF A 35-080-1</p>`, fam_id: 3, nat_id: 2, gestion: 'STOCK',
  unite_stock: 'ml', unite_achat: 't', unite_vente: 'kg', unites: [{ unite: 'kg', formule: '1 / {{poids}}' }, { unite: 't', formule: '1000 / {{poids}}' }],
  poids, epaisseur: diametre, scenario_pa: 'FOURNISSEUR_PRINCIPAL', coef_fg: '1.08', coef_benef: '1.25',
});

// Poste de pied : ni prix ni unités (unité de stock « u » exigée par la base), déduction par défaut.
const poste = (o) => article({
  type: 'POSTE_PIED', bib_id: 1, unite_stock: 'u', coef_fg: '1', coef_benef: '1', pied_base: null, pied_sens: 'DEDUCTION', pied_retenue: false, cpt_code: null, tva_code: null, ...o,
});

// Ligne d'ouvrage (format des lignes de document) et ses composantes.
const L = (o) => ({ lig_ent_id: 0, lig_proprietes: {}, lig_coef_remise: 1, lig_precision_qte: 2, lig_precision_pv: 2, lig_type_prix: 'V', lig_qte_source: 'S', lig_coef_perte: 1, ...o });

export const ELEMENTS = [
  acier(1, 'HA10', 10, 0.617),
  acier(2, 'HA12', 12, 0.888),
  article({
    id: 3, bib_id: 1, code: 'BPE25', libelle_html: "<p><b>Béton prêt à l'emploi C25/30</b></p><p>XC1, Dmax 20, S3 – livré toupie</p>", fam_id: 2, nat_id: 2, gestion: 'ACHAT',
    unite_stock: 'm3', scenario_pa: 'MEILLEUR_MIN', poids: 2400, volume: 1, proprietes: { masse_volumique: 2400 },
    unites: [{ unite: 't', formule: '1000 / {{poids}}' }],
  }),
  article({
    id: 4, bib_id: 1, code: 'PARP20', libelle_html: '<p><b>Parpaing creux 20 × 20 × 50</b></p><p>B40, NF</p>', fam_id: 4, nat_id: 2, gestion: 'STOCK',
    unite_stock: 'u', unite_achat: 'pal', unite_vente: 'm2', poids: 18.5, hauteur: 200, largeur: 500, epaisseur: 200, volume: 0.02, surface_peinture: 0.1,
    unites: [{ unite: 'pal', formule: '60' }, { unite: 'm2', formule: '1000000 / ({{hauteur}} * {{largeur}})' }],
    scenario_pa: 'DERNIER_PA', dernier_pa: '1.32', pmp: '1.28',
  }),
  article({
    id: 5, bib_id: 1, code: 'MOMAC', libelle_html: '<p><b>Heure de maçon</b> N3P2</p>', fam_id: 5, nat_id: 1, unite_stock: 'h', pa_fixe: '38', coef_fg: '1.35', coef_benef: '1.15',
  }),
  article({
    id: 6, bib_id: 1, code: 'LMP25', libelle_html: '<p><b>Location mini-pelle 2,5 t</b> (journée, sans chauffeur)</p>', fam_id: 6, nat_id: 3, gestion: 'ACHAT',
    unite_stock: 'j', pa_fixe: '210', coef_fg: '1.05', coef_benef: '1.25', coef_benef_impose: true, coef_remise: '0.95',
  }),
  article({
    id: 7, bib_id: 1, code: 'DAL15', type: 'OUVRAGE', libelle_html: '<p><b>Dalle béton armé ép. 15 cm</b></p><p>Béton C25/30, treillis HA10, coulage et talochage</p>',
    fam_id: 2, nat_id: 5, unite_stock: 'm2', coef_fg: '1.1', coef_benef: '1.2',
    composition: {
      mode: 'D',
      lignes: [
        L({ lig_id: 1, lig_parent_id: null, lig_ordre: 1, lig_tyl_id: 2, lig_libelle_html: '<b>Dalle béton armé ép. 15 cm</b>', lig_qte: 1, lig_unt_code: 'm2', lig_coef_fg: 1.1, lig_coef_benef: 1.2 }),
        L({ lig_id: 2, lig_parent_id: 1, lig_ordre: 1, lig_tyl_id: 3, lig_libelle_html: "Béton prêt à l'emploi C25/30", lig_qte_source: 'M', lig_mtr_id: 10, lig_qte_type: 'R', lig_coef_perte: 1.05, lig_precision_qte: 4, lig_unt_code: 'm3', lig_pa: 112.5, lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_proprietes: { element: { id: 3, bib: 'GEN', code: 'BPE25' } } }),
        L({ lig_id: 3, lig_parent_id: 1, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Acier HA10 (treillis 20 × 20)', lig_qte: 10, lig_qte_type: 'R', lig_coef_perte: 1.1, lig_unt_code: 'ml', lig_pa: 0.71, lig_coef_fg: 1.08, lig_coef_benef: 1.25, lig_proprietes: { element: { id: 1, bib: 'GEN', code: 'HA10' } } }),
        L({ lig_id: 4, lig_parent_id: 1, lig_ordre: 3, lig_tyl_id: 3, lig_libelle_html: 'Heure de maçon (coulage, talochage)', lig_qte: 0.45, lig_qte_type: 'R', lig_unt_code: 'h', lig_pa: 38, lig_coef_fg: 1.35, lig_coef_benef: 1.15, lig_proprietes: { element: { id: 5, bib: 'GEN', code: 'MOMAC' } } }),
      ],
      metres: [{
        mtr_id: 10, mtr_lig_id: 2, mtr_libelle: 'Volume de béton par m²', mtr_unt_code: 'm3', mtr_variable: null,
        mtr_script: 'Epaisseur est un numérique = 0.15   // m\n\nRenvoyer 1 * Epaisseur   // 1 m² de dalle',
      }],
      variables: [],
    },
  }),
  article({
    id: 8, bib_id: 2, code: 'BA13', libelle_html: '<p><b>Plaque de plâtre BA13</b> standard</p><p>1,20 × 2,50 m</p>', fam_id: 7, nat_id: 2, gestion: 'STOCK',
    unite_stock: 'm2', unite_achat: 'pl', unite_vente: 'm2', unites: [{ unite: 'pl', formule: '{{hauteur}} * {{largeur}} / 1000000' }],
    poids: 8.6, surface: 1, surface_peinture: 1, hauteur: 2500, largeur: 1200, epaisseur: 12.5, proprietes: { reference_fabricant: 'BA13-STD' },
    scenario_pa: 'PMP', pmp: '2.15', dernier_pa: '2.24', coef_fg: '1.12', coef_benef: '1.3',
  }),
  article({
    id: 9, bib_id: 2, code: 'LV100', libelle_html: '<p><b>Laine de verre 100 mm</b> revêtue kraft</p><p>Rouleau 1,20 × 6 m</p>', fam_id: 8, nat_id: 6, gestion: 'STOCK',
    unite_stock: 'm2', unite_achat: 'rl', unite_vente: 'm2', unites: [{ unite: 'rl', formule: '{{largeur}} * 6000 / 1000000' }],
    poids: 1.2, surface: 1, hauteur: 6000, largeur: 1200, epaisseur: 100, isolant_lambda: '0.032', isolant_r: '3.15', isolant_u: '0.32',
    pa_fixe: '4.85', coef_fg: '1.12', coef_benef: '1.3',
  }),
  // Ensemble : fenêtre paramétrable (largeur × hauteur de la tranche), volet roulant en option aux mêmes dimensions,
  // couleur hors standard en variante. Inséré dans un devis, on ajuste $largeur et $hauteur sur le titre.
  article({
    id: 10, bib_id: 1, code: 'FENPAR', type: 'ENSEMBLE', libelle_html: '<p><b>Fenêtre PVC paramétrable</b> avec volet roulant en option</p>',
    nat_id: 5, unite_stock: 'u', coef_fg: '1.1', coef_benef: '1.2',
    composition: {
      mode: 'V',
      lignes: [
        L({ lig_id: 1, lig_parent_id: null, lig_ordre: 1, lig_tyl_id: 1, lig_libelle_html: '<b>Fenêtre PVC {{$largeur}} × {{$hauteur}} m</b>' }),
        L({ lig_id: 2, lig_parent_id: 1, lig_ordre: 1, lig_tyl_id: 2, lig_libelle_html: '<b>Fenêtre PVC oscillo-battante</b> double vitrage 4/16/4 – {{$largeur}} × {{$hauteur}} m', lig_qte: 1, lig_unt_code: 'u', lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_nat_id: 5 }),
        L({ lig_id: 3, lig_parent_id: 2, lig_ordre: 1, lig_tyl_id: 3, lig_libelle_html: 'Châssis PVC et vitrage (surface)', lig_qte_source: 'M', lig_mtr_id: 20, lig_qte_type: 'R', lig_precision_qte: 3, lig_unt_code: 'm2', lig_pa: 280, lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_nat_id: 2 }),
        L({ lig_id: 4, lig_parent_id: 2, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Pose en tableau et calfeutrement', lig_qte: 2.5, lig_qte_type: 'R', lig_unt_code: 'h', lig_pa: 42, lig_coef_fg: 1.35, lig_coef_benef: 1.15, lig_nat_id: 1 }),
        L({ lig_id: 5, lig_parent_id: 1, lig_ordre: 2, lig_tyl_id: 2, lig_libelle_html: '<b>Option : volet roulant électrique</b> – {{$largeur}} × {{$hauteur}} m', lig_type_prix: 'O', lig_qte: 1, lig_unt_code: 'u', lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_nat_id: 5 }),
        L({ lig_id: 6, lig_parent_id: 5, lig_ordre: 1, lig_tyl_id: 3, lig_libelle_html: 'Tablier aluminium et coffre (surface)', lig_type_prix: 'O', lig_qte_source: 'M', lig_mtr_id: 21, lig_qte_type: 'R', lig_precision_qte: 3, lig_unt_code: 'm2', lig_pa: 165, lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_nat_id: 2 }),
        L({ lig_id: 7, lig_parent_id: 5, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Moteur radio et pose', lig_type_prix: 'O', lig_qte: 1, lig_qte_type: 'R', lig_unt_code: 'u', lig_pa: 120, lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_nat_id: 2 }),
        L({ lig_id: 8, lig_parent_id: 1, lig_ordre: 3, lig_tyl_id: 3, lig_libelle_html: 'Variante : couleur hors standard (RAL au choix, plaxage 2 faces)', lig_type_prix: 'A', lig_qte_source: 'M', lig_mtr_id: 22, lig_precision_qte: 3, lig_unt_code: 'm2', lig_pa: 45, lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_nat_id: 2 }),
      ],
      metres: [
        { mtr_id: 20, mtr_lig_id: 3, mtr_libelle: 'Surface de la fenêtre', mtr_unt_code: 'm2', mtr_variable: null,
          mtr_script: 'Renvoyer $largeur * $hauteur   // largeur × hauteur de la tranche' },
        { mtr_id: 21, mtr_lig_id: 6, mtr_libelle: 'Surface du volet (hauteur + coffre)', mtr_unt_code: 'm2', mtr_variable: null,
          mtr_script: 'Coffre est un numérique = 0.2   // hauteur du coffre (m)\n\nRenvoyer $largeur * ($hauteur + Coffre)' },
        { mtr_id: 22, mtr_lig_id: 8, mtr_libelle: 'Surface plaxée', mtr_unt_code: 'm2', mtr_variable: null,
          mtr_script: 'Renvoyer $largeur * $hauteur   // surface de la fenêtre' },
      ],
      variables: [
        { var_id: 40, var_lig_id: 1, var_mtr_id: null, var_portee: '$', var_nom: 'largeur', var_operation: '=', var_formule: '1,2', var_ordre: 1 },
        { var_id: 41, var_lig_id: 1, var_mtr_id: null, var_portee: '$', var_nom: 'hauteur', var_operation: '=', var_formule: '1,35', var_ordre: 2 },
      ],
    },
  }),
  // Postes de pied (POSTE_PIED) : insérés dans le pied des documents (code, F3 ou glisser), sans prix.
  poste({ id: 11, code: 'RG5', libelle_html: '<p>Retenue de garantie 5 %</p>', pied_niveau: 'TTC', pied_mode: 'P', pied_base: 'CUMUL', pied_valeur: '5', pied_retenue: true, cpt_code: '411700' }),
  poste({ id: 12, code: 'PRORATA', libelle_html: '<p>Compte prorata 1,5 %</p>', pied_niveau: 'HT', pied_mode: 'P', pied_base: 'TOTAL_HT', pied_valeur: '1.5' }),
  poste({ id: 13, code: 'REMISE5', libelle_html: '<p>Remise commerciale 5 %</p>', pied_niveau: 'HT', pied_mode: 'P', pied_base: 'CUMUL', pied_valeur: '5' }),
  poste({ id: 14, code: 'FRAISDOS', libelle_html: '<p>Frais de dossier</p>', pied_niveau: 'HT', pied_mode: 'M', pied_sens: 'AJOUT', pied_valeur: '150', tva_code: 'T20' }),
];

export const TARIFS = [
  { id: 1, ele_id: 1, fournisseur: 'Aciers du Rhône', reference: 'HA10-12', libelle: 'HA10 L 12 m', unite: 't', prix: '1150', debut: '2026-01-01', fin: null, principal: true, lien: 'https://example.com/tarifs/aciers-du-rhone' },
  { id: 2, ele_id: 1, fournisseur: 'Métal Distribution', reference: 'B10', libelle: 'Barre HA10', unite: 'kg', prix: '1.12', debut: null, fin: '2026-12-31', principal: false, lien: null },
  { id: 3, ele_id: 1, fournisseur: 'Aciers du Rhône', reference: 'HA10-12-P', libelle: 'HA10 promotion (fin de série)', unite: 't', prix: '1080', debut: '2025-01-01', fin: '2025-12-31', principal: false, lien: null },
  { id: 4, ele_id: 2, fournisseur: 'Aciers du Rhône', reference: 'HA12-12', libelle: 'HA12 L 12 m', unite: 't', prix: '1130', debut: '2026-01-01', fin: null, principal: true, lien: null },
  { id: 5, ele_id: 3, fournisseur: 'Béton Lyonnais', reference: 'C25-XC1', libelle: 'C25/30 XC1 S3', unite: 'm3', prix: '118', debut: null, fin: null, principal: true, lien: null },
  { id: 6, ele_id: 3, fournisseur: 'Unibéton', reference: 'U-C25', libelle: 'C25/30 toupie 8 m³', unite: 'm3', prix: '112.5', debut: '2026-03-01', fin: null, principal: false, lien: null },
  { id: 7, ele_id: 3, fournisseur: 'Béton Express', reference: 'BE-25', libelle: 'C25/30 petite quantité', unite: 'm3', prix: '125', debut: null, fin: null, principal: false, lien: null },
  { id: 8, ele_id: 4, fournisseur: 'Matériaux Rhône-Alpes', reference: 'PAR20', libelle: 'Parpaing 20 (palette de 60)', unite: 'pal', prix: '79.2', debut: null, fin: null, principal: true, lien: null },
];

export const PARAMETRES_BIBLIOTHEQUE = {
  scenario_defaut: 'FIXE', scenarios_autorises: ['FIXE', 'FOURNISSEUR_PRINCIPAL', 'DERNIER_PA', 'MEILLEUR_MIN', 'MEILLEUR_MAX', 'PMP'], coef_fg_defaut: 1.1, coef_benef_defaut: 1.2,
};
