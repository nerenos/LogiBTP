// Analyseur XML minimal (éléments, attributs, texte, CDATA, entités) : les fichiers d'échange lus par le module sont
// des arbres simples ; pas de DOMParser pour fonctionner aussi sous Node (tests).

import { texte } from '@logibtp/socle/dictionnaire';

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export const decoderEntites = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITES[e] ?? m;
});

/** Arbre { nom, attributs, enfants, texte } de l'élément racine. */
export function analyserXml(source) {
  const racine = { nom: '#document', attributs: {}, enfants: [], texte: '' };
  const pile = [racine];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const lt = source.indexOf('<', i);
    const haut = pile[pile.length - 1];
    if (lt < 0) { haut.texte += decoderEntites(source.slice(i)); break; }
    if (lt > i) haut.texte += decoderEntites(source.slice(i, lt));
    if (source.startsWith('<!--', lt)) { i = source.indexOf('-->', lt) + 3; continue; }
    if (source.startsWith('<![CDATA[', lt)) {
      const f = source.indexOf(']]>', lt);
      haut.texte += source.slice(lt + 9, f);
      i = f + 3;
      continue;
    }
    if (source[lt + 1] === '?' || source[lt + 1] === '!') { i = source.indexOf('>', lt) + 1; continue; }
    const gt = source.indexOf('>', lt);
    if (gt < 0) throw new Error(texte('import.xml.balise'));
    let corps = source.slice(lt + 1, gt);
    if (corps[0] === '/') {
      const nom = corps.slice(1).trim();
      if (haut.nom !== nom) throw new Error(texte('import.xml.fermeture', { nom, ouvert: haut.nom }));
      pile.pop();
      i = gt + 1;
      continue;
    }
    const auto = corps.endsWith('/');
    if (auto) corps = corps.slice(0, -1);
    const m = /^([^\s]+)\s*([\s\S]*)$/.exec(corps);
    const el = { nom: m[1], attributs: {}, enfants: [], texte: '' };
    for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) el.attributs[a[1]] = decoderEntites(a[3] ?? a[4]);
    haut.enfants.push(el);
    if (!auto) pile.push(el);
    i = gt + 1;
  }
  if (pile.length !== 1) throw new Error(texte('import.xml.non_ferme', { nom: pile[pile.length - 1].nom }));
  const el = racine.enfants[0];
  if (!el) throw new Error(texte('import.xml.vide'));
  return el;
}

/** Premier enfant nommé. */
export const enfant = (el, nom) => el?.enfants.find((e) => e.nom === nom) ?? null;
/** Enfants nommés. */
export const enfants = (el, nom) => el?.enfants.filter((e) => e.nom === nom) ?? [];
/** Valeurs des feuilles d'un élément : { nom: texte }. */
export const feuilles = (el) => Object.fromEntries((el?.enfants ?? []).filter((e) => !e.enfants.length).map((e) => [e.nom, e.texte]));
