// Lecture d'un fichier CSV de cartes carburant (plan materiel-suites, MO6). Chaque fournisseur de cartes a son fichier,
// décrit par des correspondances : noms de colonnes acceptés pour chaque champ, séparateur, format de date.
import { texte } from '@logibtp/socle/dictionnaire';
import { normaliser } from './correspondances.js';

/** Champs d'un plein : `requis` signale un champ obligatoire. */
export const CHAMPS_CARBURANT = Object.freeze({
  date: { requis: true },
  carte: { requis: false },
  immatriculation: { requis: false },
  litres: { requis: true },
  montant: { requis: false },
  kilometrage: { requis: false },
});

/** Format générique, reconnaissant les intitulés courants (chaque fournisseur fournit les siens). */
export const CORRESPONDANCES_CARBURANT = Object.freeze({
  separateur: null, // null : détecté sur l'en-tête (« ; », tabulation, « , »)
  formatDate: 'JJ/MM/AAAA', // ou 'AAAA-MM-JJ'
  colonnes: Object.freeze({
    date: ['date', 'date transaction', 'date operation'],
    carte: ['carte', 'numero carte', 'n carte'],
    immatriculation: ['immatriculation', 'plaque', 'vehicule'],
    litres: ['litres', 'quantite', 'volume'],
    montant: ['montant', 'montant ttc', 'montant ht'],
    kilometrage: ['kilometrage', 'km', 'odometre'],
  }),
});

function cellules(ligne, separateur) {
  const res = [];
  let cur = '';
  let guillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (guillemets) {
      if (c === '"' && ligne[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') guillemets = false; else cur += c;
    } else if (c === '"') guillemets = true;
    else if (c === separateur) { res.push(cur.trim()); cur = ''; } else cur += c;
  }
  res.push(cur.trim());
  return res;
}

/** Nombre décimal en texte à point (« 1 234,50 » → « 1234.50 ») ; '' si vide, null si illisible. Jamais de Number. */
function decimal(v) {
  const t = String(v ?? '').replace(/[\s ]/g, '').replace(',', '.');
  if (t === '') return '';
  return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
}

function date(v, format) {
  const t = String(v ?? '').trim();
  const iso = format === 'AAAA-MM-JJ';
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(t) : /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (!m) return null;
  const [a, mo, j] = iso ? [m[1], m[2], m[3]] : [m[3], m[2].padStart(2, '0'), m[1].padStart(2, '0')];
  const jour = `${a}-${mo}-${j}`;
  const d = new Date(Date.UTC(Number(a), Number(mo) - 1, Number(j)));
  return d.toISOString().slice(0, 10) === jour ? jour : null;
}

/**
 * Lit le texte d'un fichier de cartes carburant : { pleins: [{ rang, date, carte, immatriculation, litres, montant,
 * kilometrage }], erreurs: [{ rang, message }] }. Litres, montant et kilométrage sont des textes décimaux à point
 * ('' si absents) ; rang = numéro de la ligne de données (1 = première après l'en-tête) ; lignes vides ignorées.
 */
export function lireFichierCarburant(contenu, correspondances = CORRESPONDANCES_CARBURANT) {
  const brut = String(contenu ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const entete = brut.shift() ?? '';
  const separateur = correspondances.separateur ?? [';', '\t', ','].find((s) => entete.includes(s)) ?? ';';
  const intitules = cellules(entete, separateur).map(normaliser);
  const index = {};
  for (const champ of Object.keys(CHAMPS_CARBURANT)) {
    const acceptes = (correspondances.colonnes?.[champ] ?? []).map(normaliser);
    const i = intitules.findIndex((c) => acceptes.includes(c));
    if (i >= 0) index[champ] = i;
  }
  const pleins = [];
  const erreurs = [];
  const colonnes = Object.entries(CHAMPS_CARBURANT).filter(([c, d]) => d.requis && index[c] === undefined).map(([c]) => c);
  if (index.carte === undefined && index.immatriculation === undefined) colonnes.push('carte');
  if (colonnes.length) {
    return { pleins, erreurs: [{ rang: 0, message: texte('import.carburant.erreurs.entete', { colonnes: colonnes.join(', ') }) }] };
  }
  brut.forEach((ligne, i) => {
    if (!ligne.trim()) return;
    const rang = i + 1;
    const cel = cellules(ligne, separateur);
    const lire = (c) => (index[c] === undefined ? '' : (cel[index[c]] ?? ''));
    const fautes = [];
    const jour = date(lire('date'), correspondances.formatDate);
    if (!jour) fautes.push(texte('import.carburant.erreurs.date', { valeur: lire('date') }));
    const nombres = {};
    for (const c of ['litres', 'montant', 'kilometrage']) {
      const n = decimal(lire(c));
      if (n === null) fautes.push(texte('import.carburant.erreurs.nombre', { colonne: c, valeur: lire(c) }));
      else nombres[c] = n;
    }
    if (nombres.litres === '' || (nombres.litres !== undefined && /^-|^0+(\.0*)?$/.test(nombres.litres))) {
      fautes.push(texte('import.carburant.erreurs.litres'));
    }
    const carte = lire('carte');
    const immatriculation = lire('immatriculation');
    if (!carte && !immatriculation) fautes.push(texte('import.carburant.erreurs.identification'));
    if (fautes.length) erreurs.push({ rang, message: fautes.join(' ; ') });
    else pleins.push({ rang, date: jour, carte, immatriculation, litres: nombres.litres, montant: nombres.montant, kilometrage: nombres.kilometrage });
  });
  return { pleins, erreurs };
}
