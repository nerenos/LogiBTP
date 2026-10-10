import { estPied } from './types.js';

const FORMAT_DEFAUT = { separateur: '.', niveaux: [{ style: '1' }] };

export function lireFormat(f) {
  if (!f) return FORMAT_DEFAUT;
  const o = typeof f === 'string' ? JSON.parse(f) : f;
  const niveaux = Array.isArray(o.niveaux) && o.niveaux.length > 0 ? o.niveaux : FORMAT_DEFAUT.niveaux;
  return { separateur: o.separateur ?? '.', niveaux };
}

/** 1 → A, 26 → Z, 27 → AA (comme les colonnes d'un tableur). */
function enLettres(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function formaterRang(n, style) {
  if (n <= 0 || style === '1') return String(n);
  const s = enLettres(n);
  return style === 'a' ? s.toLowerCase() : s;
}

/** « 4 » → 4, « D » ou « d » → 4, « AA » → 27 ; null si invalide. */
export function lireDepart(texte) {
  const t = (texte ?? '').trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (/^[A-Za-z]+$/.test(t)) {
    let n = 0;
    for (const c of t.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
    return n;
  }
  return null;
}

/**
 * Numérotation des lignes Titre, Ouvrage et Élément (section 5).
 * lig_num_depart redémarre la séquence ; lig_num_manuelle conserve la valeur saisie
 * et la séquence continue comme si la ligne avait reçu sa valeur calculée.
 */
export function numeroter(moteur) {
  const format = lireFormat(moteur.doc.ent_num_format);
  const parcourir = (parentId, prefixe, niveau) => {
    let rang = 0;
    for (const l of moteur.enfantsDe(parentId)) {
      if (estPied(l) || !moteur.estNumerotee(l)) {
        l.lig_numerotation = null;
        parcourir(l.lig_id, prefixe, niveau);
        continue;
      }
      const depart = l.lig_num_depart ? lireDepart(l.lig_num_depart) : null;
      if (l.lig_num_depart && depart === null) {
        moteur.avertir(l.lig_id, 'NUM_DEPART', `Valeur de départ de numérotation invalide « ${l.lig_num_depart} »`);
      }
      rang = depart ?? rang + 1;
      const style = format.niveaux[Math.min(niveau, format.niveaux.length - 1)].style;
      const auto = formaterRang(rang, style);
      const calcule = prefixe ? `${prefixe}${format.separateur}${auto}` : auto;
      if (!l.lig_num_manuelle) l.lig_numerotation = calcule;
      parcourir(l.lig_id, l.lig_numerotation ?? calcule, niveau + 1);
    }
  };
  parcourir(null, '', 0);
}
