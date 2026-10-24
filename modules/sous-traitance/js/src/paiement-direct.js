import { Dz, S, ZERO } from '@logibtp/socle';

// Module Sous-traitance : paiement direct d'un sous-traitant par le maître d'ouvrage (ANALYSE-MODULE-SOUS-TRAITANCE.md
// § 5.5, ST14 à ST16, ST32). Règles partagées avec ReglesPaiementDirect.cs (jeu tests/cas/03_plafonds.json) : montant
// payé par le maître d'ouvrage (TTC, ou HT en autoliquidation), délai d'acceptation de la demande (15 jours), contrôles
// d'une acceptation (cumul accepté ≤ montant agréé, montant ≤ demande, refus partiel motivé) et état de la demande.

export const ETATS_PAIEMENT_DIRECT = {
  RECUE: { libelle: 'Demande reçue', icone: '📥' },
  ACCEPTEE: { libelle: 'Acceptée', icone: '✅' },
  PARTIELLE: { libelle: 'Acceptée en partie', icone: '◐' },
  REFUSEE: { libelle: 'Refusée', icone: '⛔' },
  TRANSMISE: { libelle: 'Transmise au maître d\'ouvrage', icone: '📤' },
  PAYEE: { libelle: 'Payée par le maître d\'ouvrage', icone: '💶' },
};
export const MESSAGES_PAIEMENT_DIRECT = {
  PD_PLAFOND: 'Le cumul accepté dépasse le montant agréé du sous-traitant',
  PD_DEMANDE: 'Le montant accepté dépasse la demande du sous-traitant',
  PD_MOTIF: 'Motif obligatoire pour refuser tout ou partie de la demande',
  PD_NEGATIF: 'Montant accepté négatif',
};
export const DELAI_ACCEPTATION_JOURS = 15;

const jours = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Montant que le maître d'ouvrage paie au sous-traitant : TTC de sa facture, HT en autoliquidation (la TVA reste due par nous). */
export const montantPaiementDirect = ({ ht, ttc, autoliquidation }) => S(autoliquidation ? Dz(ht) : Dz(ttc));

/** Fin du délai d'acceptation d'une demande reçue, et demande en retard à une date. */
export function delaiAcceptation(recueLe, aujourdhui) {
  const echeance = jours(recueLe, DELAI_ACCEPTATION_JOURS);
  return { echeance, depasse: aujourdhui > echeance, alerte: aujourdhui >= jours(echeance, -3) };
}

/**
 * Acceptation d'une demande : montant accepté ≤ demande, cumul accepté (précédents + celui-ci) ≤ montant agréé (sans
 * agrément : pas de plafond), refus total ou partiel motivé ; état ACCEPTEE, PARTIELLE ou REFUSEE.
 */
export function controlerAcceptation({ demande, accepte, cumulPrecedent = 0, montantAgree = null, motif = null }) {
  const d = Dz(demande);
  const a = Dz(accepte);
  const erreurs = [];
  if (a.isNegative()) erreurs.push('PD_NEGATIF');
  if (a.gt(d)) erreurs.push('PD_DEMANDE');
  const cumul = Dz(cumulPrecedent).plus(a);
  if (montantAgree !== null && montantAgree !== undefined && cumul.gt(Dz(montantAgree))) erreurs.push('PD_PLAFOND');
  const etat = a.isZero() ? 'REFUSEE' : a.lt(d) ? 'PARTIELLE' : 'ACCEPTEE';
  if (etat !== 'ACCEPTEE' && !String(motif ?? '').trim()) erreurs.push('PD_MOTIF');
  const reste = montantAgree === null || montantAgree === undefined ? null : S(Dz(montantAgree).minus(cumul).lt(ZERO) ? ZERO : Dz(montantAgree).minus(cumul));
  return { etat, cumul: S(cumul), reste_agree: reste, erreurs };
}
