// Vues de colonnes de la grille des lignes fournies par le cœur : une vue par défaut par modèle de saisie (tous types
// de documents), une vue par défaut par type de document issu d'une transformation et une vue de débogage. Les colonnes du reste à solder (qte_parent, reste, solde) n'apparaissent que
// dans un document issu d'une transformation. Les mêmes définitions alimentent la démo hors ligne et le script
// db/150_documents_vues.sql (généré par client/scripts/generer-vues-liste.mjs) : une seule source de vérité.

const cols = (...cles) => cles.map((cle) => ({ cle }));

// Documents issus d'une transformation : vue par défaut de leur type (sans modèle choisi) qui privilégie la
// ventilation (parent, précédent, ce document, cumul, %, reste) ; pas de coefficients ; ventes : PV net seul. Dans un
// document d'avancement, les mêmes clés désignent les valeurs d'avancement (ALIAS_AVANCEMENT du module Document).
const ENTETE = ['num', 'type', 'code', 'libelle', 'nature', 'unite'];
const VENTILATION = ['qte_parent', 'montant_parent', 'pct_prec', 'qte_prec', 'montant_prec', 'pct_periode', 'qte', 'montant', 'pct_cumul', 'qte_cumul', 'montant_cumul', 'reste', 'solde'];
const VUES_TRANSFORMES = [
  { nom: 'Ventilation (ventes)', types: ['V_COMMANDE', 'V_RECEPTION', 'V_RETOUR', 'V_FACTURE', 'V_AVOIR'], colonnes: [...ENTETE, 'pvnet', ...VENTILATION, 'tva', 'commentaire'] },
  // Avancement : vue réglée par l'utilisateur (quantités, %, montants : parent, précédent, cumul saisissable).
  { nom: 'Avancement', types: ['V_SITUATION', 'V_FACTURE_AVT', 'V_REPRISE_AVT', 'A_FACTURE_AVT'],
    colonnes: ['num', 'libelle', 'unite', 'pvnet', 'qte_parent', 'qte_prec', 'qte_cumul', 'pct_prec', 'pct_cumul', 'montant_parent', 'montant_prec', 'montant_cumul'] },
  { nom: 'Ventilation (achats)', types: ['A_COMMANDE', 'A_RECEPTION', 'A_RETOUR', 'A_FACTURE', 'A_AVOIR'], colonnes: [...ENTETE, 'pv', 'remise', 'pvnet', ...VENTILATION, 'tva', 'commentaire'] },
];

export const VUES_DOCUMENT = [
  {
    id: 1, nom: 'Complet', tyd_id: null, mod_code: 'COMPLET', globale: true, proprietaire: null, par_defaut: true,
    definition: { colonnes: cols('num', 'type', 'code', 'libelle', 'nature', 'compte', 'qte', 'qte_parent', 'reste', 'solde', 'unite', 'pa', 'fg', 'benef', 'pv', 'remise', 'pvnet', 'montant', 'tva', 'commentaire'), debogage: false, systeme: [] },
  },
  {
    id: 2, nom: 'Chiffrage', tyd_id: null, mod_code: 'CHIFFRAGE', globale: true, proprietaire: null, par_defaut: true,
    definition: { colonnes: cols('num', 'type', 'code', 'libelle', 'nature', 'qte', 'unite', 'pa', 'fg', 'benef', 'pv', 'pvnet', 'montant'), debogage: false, systeme: [] },
  },
  {
    id: 3, nom: 'À la volée', tyd_id: null, mod_code: 'VOLEE', globale: true, proprietaire: null, par_defaut: true,
    definition: { colonnes: cols('num', 'code', 'libelle', 'nature', 'qte', 'qte_parent', 'reste', 'solde', 'unite', 'pv', 'montant', 'tva'), debogage: false, systeme: [] },
  },
  {
    // Débogage : colonnes système (identifiants, liens, valeurs calculées masquées) pour comprendre une erreur.
    id: 4, nom: 'Débogage', tyd_id: null, mod_code: null, globale: true, proprietaire: null, par_defaut: false,
    definition: {
      colonnes: cols('num', 'type', 'code', 'libelle', 'nature', 'qte', 'pv', 'montant', 'tva'), debogage: true,
      systeme: ['_controles', 'lig_id', 'lig_parent_id', 'lig_ordre', 'lig_tyl_id', 'lig_type_prix', 'lig_variante_de_id', 'lig_st_depuis_id',
        'lig_pied_mode', 'lig_pied_base', 'lig_pied_base_id', 'lig_base_calcul', 'lig_qte_totale', 'lig_montant_pr', 'lig_etiquette'],
    },
  },
  // Une vue par défaut par type (tyd_code : identifiant résolu dans la base par le script généré).
  ...VUES_TRANSFORMES.flatMap((g, i) => g.types.map((code, j) => ({
    id: 10 + i * 10 + j, nom: g.nom, tyd_id: null, tyd_code: code, mod_code: null, globale: true, proprietaire: null, par_defaut: true,
    definition: { colonnes: cols(...g.colonnes), debogage: false, systeme: [] },
  }))),
];

/** Modèles de saisie (démo hors ligne ; table modele_document en ligne). */
export const MODELES_DOCUMENT = [
  { code: 'COMPLET', libelle: 'Complet' },
  { code: 'CHIFFRAGE', libelle: 'Chiffrage (déboursé)' },
  { code: 'VOLEE', libelle: 'Document à la volée' },
];

/** Étiquettes de lignes et couleurs des modes de vente (démo hors ligne ; mêmes valeurs que 013_document_affichage.sql). */
export const ETIQUETTES_LIGNE = [
  { code: 'A_CHIFFRER', libelle: 'À chiffrer', couleur: '#ef4444', ordre: 10, actif: true },
  { code: 'A_VERIFIER', libelle: 'À vérifier', couleur: '#f59e0b', ordre: 20, actif: true },
  { code: 'ATTENTE_PRIX', libelle: 'En attente de prix', couleur: '#a855f7', ordre: 30, actif: true },
  { code: 'PRIX_CONFIRME', libelle: 'Prix confirmé', couleur: '#22c55e', ordre: 40, actif: true },
  { code: 'VALIDE', libelle: 'Validé', couleur: '#2563eb', ordre: 50, actif: true },
];

export const COULEURS_TYPE_PRIX = [
  { type: 'O', libelle: 'Option', couleur: '#06b6d4' },
  { type: 'M', libelle: 'Pour mémoire', couleur: '#94a3b8' },
  { type: 'A', libelle: 'Variante', couleur: '#ec4899' },
  { type: 'F', libelle: 'Frais annexes', couleur: '#f97316' },
];
