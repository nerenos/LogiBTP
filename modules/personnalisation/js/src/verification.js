// Vérification des clés (ANALYSE-MODULE-PERSONNALISATION.md § 7.3) : toute clé littérale passée à texte, texteHtml,
// pluriel (dictionnaire) ou icone, iconeHtml (catalogue images/icones.json) doit exister ; les clés construites
// (gabarit `…${x}`) sont comptées à part, leurs préfixes vérifiés.
import fs from 'node:fs';
import { valeurBrute, variablesDe, cles } from '@logibtp/socle/dictionnaire';

const APPEL = /\b(texte|texteHtml|pluriel|icone|iconeHtml)\(\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g;

/** Appels relevés dans un texte source : [{ fonction, cle, construite, ligne }]. */
export function clesUtilisees(source) {
  const res = [];
  for (const m of source.matchAll(APPEL)) {
    const construite = m[2] === '`' && m[3].includes('${');
    res.push({ fonction: m[1], cle: construite ? m[3].slice(0, m[3].indexOf('${')) : m[3], construite, ligne: source.slice(0, m.index).split('\n').length });
  }
  return res;
}

// Une clé construite (`socle.grille.menu.${action}`) : au moins une clé du dictionnaire commence par son préfixe.
const existePrefixe = (toutes, prefixe) => !prefixe || toutes.some((c) => c.startsWith(prefixe));

/**
 * Vérifie les fichiers sources contre le dictionnaire et le catalogue des icônes : rend { manquantes, construites, pluriels }.
 * Un pluriel exige cle_un et cle_autre ; une clé construite exige qu'une clé commence par son préfixe.
 */
export function verifierCles({ fichiers, libelles, icones }) {
  const manquantes = [];
  const toutes = cles(libelles);
  let construites = 0;
  for (const f of fichiers) {
    for (const u of clesUtilisees(fs.readFileSync(f, 'utf8'))) {
      const ou = `${f}:${u.ligne}`;
      if (u.fonction.startsWith('icone')) {
        if (!u.construite && !(u.cle in icones)) manquantes.push({ ou, cle: u.cle, fonction: u.fonction });
        continue;
      }
      if (u.construite) {
        construites += 1;
        if (!existePrefixe(toutes, u.cle)) manquantes.push({ ou, cle: `${u.cle}…`, fonction: u.fonction });
      } else if (u.fonction === 'pluriel') {
        for (const s of ['_un', '_autre']) if (valeurBrute(libelles, `${u.cle}${s}`) === undefined) manquantes.push({ ou, cle: `${u.cle}${s}`, fonction: u.fonction });
      } else if (valeurBrute(libelles, u.cle) === undefined) manquantes.push({ ou, cle: u.cle, fonction: u.fonction });
    }
  }
  return { manquantes, construites };
}

export { variablesDe };
