// Lecture des périodes (ANALYSE-MODULE-ANALYSE.md § 5.3), répliquée dans Periodes.cs (jeu tests/cas/01_periodes.json) :
// « AAAA » = année, « MM/AAAA » = mois, sinon une date à saisie abrégée du socle (« 15 », « 15/10 », « 31/10/2026 ») ;
// une année ou un mois donnent leur premier jour en début de période, leur dernier jour en fin. Raccourcis : mois en
// cours, mois précédent, exercice (année civile) en cours, depuis l'origine.
import { completerDate, joursDuMois, ajouterMois, aujourdhui } from '@logibtp/socle';
import { BORNE_PERIODE, RACCOURCI_PERIODE, ERREUR_PERIODE } from './codes.js';

const pad = (n, l = 2) => String(n).padStart(l, '0');
const premier = (a, m) => `${pad(a, 4)}-${pad(m)}-01`;
const dernier = (a, m) => `${pad(a, 4)}-${pad(m)}-${pad(joursDuMois(a, m))}`;

/** Texte saisi → { date: 'AAAA-MM-JJ' | null (vide), erreur: code | null }. */
export function lirePeriode(texte, borne, reference = aujourdhui()) {
  const s = String(texte ?? '').trim();
  if (s === '') return { date: null, erreur: null };
  const fin = borne === BORNE_PERIODE.FIN;
  const annee = /^(\d{4})$/.exec(s);
  if (annee) {
    const a = Number(annee[1]);
    if (a < 1) return { date: null, erreur: ERREUR_PERIODE.DATE };
    return { date: fin ? dernier(a, 12) : premier(a, 1), erreur: null };
  }
  const mois = /^(\d{1,2})[/.\-\s](\d{4})$/.exec(s);
  if (mois) {
    const m = Number(mois[1]);
    const a = Number(mois[2]);
    if (m < 1 || m > 12 || a < 1) return { date: null, erreur: ERREUR_PERIODE.DATE };
    return { date: fin ? dernier(a, m) : premier(a, m), erreur: null };
  }
  const d = completerDate(s, reference);
  return d ? { date: d, erreur: null } : { date: null, erreur: ERREUR_PERIODE.DATE };
}

/** Début après la fin : code d'erreur, sinon null. */
export function controlerPeriode(du, au) {
  return du && au && du > au ? ERREUR_PERIODE.ORDRE : null;
}

/** Bornes { du, au } d'un raccourci (null : depuis l'origine, ou jusqu'à aujourd'hui inclus). */
export function raccourciPeriode(code, reference = aujourdhui()) {
  const [a, m] = String(reference).slice(0, 10).split('-').map(Number);
  switch (code) {
    case RACCOURCI_PERIODE.MOIS: return { du: premier(a, m), au: dernier(a, m) };
    case RACCOURCI_PERIODE.MOIS_PRECEDENT: {
      const [pa, pm] = ajouterMois(premier(a, m), -1).split('-').map(Number);
      return { du: premier(pa, pm), au: dernier(pa, pm) };
    }
    case RACCOURCI_PERIODE.EXERCICE: return { du: premier(a, 1), au: dernier(a, 12) };
    case RACCOURCI_PERIODE.ORIGINE: return { du: null, au: null };
    default: return null;
  }
}
