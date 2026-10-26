// Import des tarifs d'un fournisseur (lot 8 des demandes du 25/10/2026, A12) : lecture d'un fichier CSV à format fixe.
// Première ligne : en-têtes (ordre libre, casse et accents indifférents), séparateur « ; », tabulation ou « , » (détecté
// sur l'en-tête). Colonnes reconnues (COLONNES_TARIFS) ; une ligne doit désigner l'élément (code d'appel, référence
// fournisseur ou code-barres) et porter un prix public ou un prix net. Nombres à virgule ou à point, dates JJ/MM/AAAA
// ou AAAA-MM-JJ, principal : oui / 1 / x. Le serveur rapproche les éléments et contrôle (ServiceBibliotheque.ImporterTarifs).

export const COLONNES_TARIFS = [
  ['element', "Code de l'élément (CODE ou BIB:CODE)"], ['reference', 'Référence fournisseur'], ['code_barre', 'Code-barres'],
  ['libelle', 'Libellé fournisseur'], ['unite', "Unité d'achat"], ['prix_public', 'Prix public HT'], ['remise1', 'Remise 1 (%)'],
  ['remise2', 'Remise 2 (%)'], ['prix', 'Prix net HT (sans prix public)'], ['delai', 'Délai de livraison (jours)'],
  ['debut', 'Début de validité'], ['fin', 'Fin de validité'], ['principal', 'Tarif principal (oui / non)'],
];

const NOMBRES = ['prix_public', 'remise1', 'remise2', 'prix'];
const normaliser = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[\s-]+/g, '_');

/** Découpe une ligne CSV (guillemets doubles, "" = guillemet). */
function cellules(ligne, separateur) {
  const r = [];
  let c = '';
  let guillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const x = ligne[i];
    if (guillemets) {
      if (x === '"' && ligne[i + 1] === '"') { c += '"'; i++; } else if (x === '"') guillemets = false; else c += x;
    } else if (x === '"') guillemets = true;
    else if (x === separateur) { r.push(c); c = ''; } else c += x;
  }
  r.push(c);
  return r.map((v) => v.trim());
}

/** Nombre saisi (virgule ou point, espaces) en texte décimal, null si vide ; NaN si illisible. */
function nombre(v) {
  const t = String(v ?? '').replace(/[\s ]/g, '').replace(',', '.');
  if (t === '') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? t : Number.NaN;
}

/** Date JJ/MM/AAAA ou AAAA-MM-JJ en ISO, null si vide ; undefined si illisible. */
function date(v) {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined;
}

/**
 * Lit le texte d'un fichier CSV de tarifs : { lignes: [{ rang, element, reference, code_barre, libelle, unite, prix_public,
 * remise1, remise2, prix, delai, debut, fin, principal }], erreurs: [{ rang, message }], inconnues: [en-têtes ignorés] }.
 * rang = numéro de la ligne de données (1 = première ligne après l'en-tête) ; les lignes vides sont ignorées.
 */
export function lireCsvTarifs(texte) {
  const brut = String(texte ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const entete = brut.shift() ?? '';
  const separateur = [';', '\t', ','].find((s) => entete.includes(s)) ?? ';';
  const codes = cellules(entete, separateur).map(normaliser);
  const connus = new Set(COLONNES_TARIFS.map(([c]) => c));
  const inconnues = codes.filter((c) => c && !connus.has(c));
  const lignes = [];
  const erreurs = [];
  if (!codes.some((c) => ['element', 'reference', 'code_barre'].includes(c))) {
    return { lignes, erreurs: [{ rang: 0, message: 'En-tête : une colonne element, reference ou code_barre est obligatoire' }], inconnues };
  }
  brut.forEach((texteLigne, i) => {
    if (!texteLigne.trim()) return;
    const rang = i + 1;
    const v = Object.fromEntries(codes.map((c, k) => [c, cellules(texteLigne, separateur)[k] ?? '']));
    const l = { rang };
    for (const c of ['element', 'reference', 'code_barre', 'libelle', 'unite']) l[c] = v[c] ? v[c] : null;
    const fautes = [];
    for (const c of NOMBRES) {
      const n = nombre(v[c]);
      if (Number.isNaN(n)) fautes.push(`${c} illisible`); else l[c] = n;
    }
    const d = nombre(v.delai);
    if (Number.isNaN(d) || (d !== null && !/^\d+$/.test(d))) fautes.push('délai illisible'); else l.delai = d === null ? null : Number(d);
    for (const c of ['debut', 'fin']) {
      const x = date(v[c]);
      if (x === undefined) fautes.push(`${c} : date JJ/MM/AAAA ou AAAA-MM-JJ`); else l[c] = x;
    }
    l.principal = ['oui', 'o', '1', 'x', 'vrai', 'true'].includes(normaliser(v.principal));
    if (!l.element && !l.reference && !l.code_barre) fautes.push('élément, référence ou code-barres obligatoire');
    if (l.prix_public === null && l.prix === null) fautes.push('prix public ou prix net obligatoire');
    if (fautes.length) erreurs.push({ rang, message: fautes.join(' ; ') }); else lignes.push(l);
  });
  return { lignes, erreurs, inconnues };
}

/** Modèle de fichier (en-tête et une ligne d'exemple), séparateur « ; ». */
export function modeleCsvTarifs() {
  return `${COLONNES_TARIFS.map(([c]) => c).join(';')}\r\nHA10;REF-123;3760001234567;Acier HA10 barre 12 m;t;1350,00;20;5;;7;01/01/2027;;oui\r\n`;
}
