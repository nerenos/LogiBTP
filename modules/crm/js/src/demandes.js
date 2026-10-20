// Demandes du CRM : pré-dossiers suivis avant la création du projet, pour la veille commerciale (ANALYSE-MODULE-CRM.md,
// C8, C16, C18), contrôle répliqué dans ReglesDemande.cs (jeu modules/crm/tests/cas/03_demandes.json).
//
// États : VEILLE (repérée) → A_ETUDIER → EN_COURS (échanges, chiffrage préparatoire) → TRANSFORMEE (projet créé) ou
// SANS_SUITE (motif : perdue, non retenue, abandonnée). « Gagnée / perdue » relève ensuite du projet.

export const ETATS_DEMANDE = [
  { valeur: 'VEILLE', libelle: 'Veille' },
  { valeur: 'A_ETUDIER', libelle: 'À étudier' },
  { valeur: 'EN_COURS', libelle: 'En cours' },
  { valeur: 'TRANSFORMEE', libelle: 'Transformée en projet' },
  { valeur: 'SANS_SUITE', libelle: 'Sans suite' },
];

export const MOTIFS_SANS_SUITE = [
  { valeur: 'PERDUE', libelle: 'Perdue' },
  { valeur: 'NON_RETENUE', libelle: 'Non retenue' },
  { valeur: 'ABANDONNEE', libelle: 'Abandonnée' },
];

/** États d'une demande terminée (hors listes de travail). */
export const ETATS_DEMANDE_CLOS = ['TRANSFORMEE', 'SANS_SUITE'];

const vide = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Erreurs d'une demande (codes, dans cet ordre) : DEMANDE_OBJET, DEMANDE_ETAT, DEMANDE_MOTIF, DEMANDE_CIBLE,
 * DEMANDE_MONTANT. demande : { objet, etat, motif, cible_type, cible_id, montant_estime }.
 */
export function controlerDemande(d) {
  const erreurs = [];
  if (vide(d.objet) || String(d.objet).trim().length > 200) erreurs.push('DEMANDE_OBJET');
  if (!ETATS_DEMANDE.some((e) => e.valeur === d.etat)) erreurs.push('DEMANDE_ETAT');
  const motif = !vide(d.motif);
  if ((d.etat === 'SANS_SUITE') !== motif || (motif && !MOTIFS_SANS_SUITE.some((m) => m.valeur === d.motif))) erreurs.push('DEMANDE_MOTIF');
  if ((d.etat === 'TRANSFORMEE') !== (!vide(d.cible_type) && !vide(d.cible_id))) erreurs.push('DEMANDE_CIBLE');
  if (!vide(d.montant_estime) && !(Number(d.montant_estime) >= 0)) erreurs.push('DEMANDE_MONTANT');
  return erreurs;
}

export const MESSAGES_DEMANDE = {
  DEMANDE_OBJET: 'Objet obligatoire (200 caractères au plus)',
  DEMANDE_ETAT: 'État inconnu',
  DEMANDE_MOTIF: 'Une demande sans suite a un motif (perdue, non retenue, abandonnée), et seulement elle',
  DEMANDE_CIBLE: 'Une demande transformée désigne le projet créé, et seulement elle',
  DEMANDE_MONTANT: 'Le montant estimé est positif',
};
