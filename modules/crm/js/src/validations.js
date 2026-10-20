// Suivi des validations (ANALYSE-MODULE-CRM.md, § 2.4, C9 à C11), état d'un plan répliqué dans ReglesValidation.cs
// (jeu modules/crm/tests/cas/04_validations.json).
//
// Un plan (ou toute pièce technique) a des indices (A, B…) ; chaque indice diffusé attend le visa de tiers. Un statut
// de visa a un effet : ACCEPTE (bon pour exécution, avec observations), REFUSE (bloquant), NEUTRE (sans objet, pour
// information). L'indice en vigueur est le dernier dont tous les visas attendus sont reçus, sans refus, avec au moins
// une acceptation.

export const EFFETS_VISA = ['ACCEPTE', 'REFUSE', 'NEUTRE'];

export const STATUTS_PLAN = [
  { valeur: 'SANS_INDICE', libelle: 'Sans indice' },
  { valeur: 'A_DIFFUSER', libelle: 'À diffuser' },
  { valeur: 'SANS_VISA', libelle: 'Diffusé sans visa attendu' },
  { valeur: 'EN_ATTENTE', libelle: 'Visas en attente' },
  { valeur: 'REFUSE', libelle: 'Refusé' },
  { valeur: 'VALIDE', libelle: 'Bon pour exécution' },
];

const jour = (v) => (v ? String(v).slice(0, 10) : null);

/** État d'un indice : { statut, attendus, recus, manquants, retards, refus, acceptes }. */
function etatIndice(indice, effets, aujourdhui) {
  const visas = indice.visas ?? [];
  const recus = visas.filter((v) => v.statut);
  const manquants = visas.length - recus.length;
  const retards = visas.filter((v) => !v.statut && v.attendu_le && jour(v.attendu_le) < aujourdhui).length;
  const refus = recus.filter((v) => effets[v.statut] === 'REFUSE').length;
  const acceptes = recus.filter((v) => effets[v.statut] === 'ACCEPTE').length;
  let statut;
  if (!indice.date) statut = 'A_DIFFUSER';
  else if (!visas.length) statut = 'SANS_VISA';
  else if (refus) statut = 'REFUSE';
  else if (manquants) statut = 'EN_ATTENTE';
  else statut = acceptes ? 'VALIDE' : 'SANS_VISA';
  return { statut, attendus: visas.length, recus: recus.length, manquants, retards, refus, acceptes };
}

/**
 * État d'un plan : { statut, indice (dernier), en_vigueur (dernier indice validé ou null), manquants, retards,
 * bloquant }. plan : { indices: [{ indice, date, visas: [{ statut, attendu_le }] }] } dans l'ordre de création ;
 * statuts : [{ code, effet }] ; aujourdhui : AAAA-MM-JJ. Bloquant : le dernier indice n'est pas bon pour exécution.
 */
export function etatPlan(plan, statuts, aujourdhui) {
  const effets = Object.fromEntries((statuts ?? []).map((s) => [s.code, s.effet]));
  const indices = plan.indices ?? [];
  if (!indices.length) return { statut: 'SANS_INDICE', indice: null, en_vigueur: null, manquants: 0, retards: 0, bloquant: true };
  const etats = indices.map((i) => ({ i, e: etatIndice(i, effets, aujourdhui) }));
  const dernier = etats[etats.length - 1];
  const valides = etats.filter((x) => x.e.statut === 'VALIDE');
  return {
    statut: dernier.e.statut,
    indice: dernier.i.indice,
    en_vigueur: valides.length ? valides[valides.length - 1].i.indice : null,
    manquants: dernier.e.manquants,
    retards: dernier.e.retards,
    bloquant: dernier.e.statut !== 'VALIDE',
  };
}

/** Indice suivant : A → B, Z → AA, AZ → BA ; vide → A. */
export function indiceSuivant(indice) {
  const s = String(indice ?? '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return 'A';
  const lettres = s.split('');
  let i = lettres.length - 1;
  while (i >= 0 && lettres[i] === 'Z') { lettres[i] = 'A'; i--; }
  if (i < 0) return `A${lettres.join('')}`;
  lettres[i] = String.fromCharCode(lettres[i].charCodeAt(0) + 1);
  return lettres.join('');
}
