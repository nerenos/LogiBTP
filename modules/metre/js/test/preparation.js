// Dictionnaire des couches socle → métré posé avant les tests : les tables de libellés lisent leurs vrais textes.
import { readFileSync } from 'node:fs';
import { initialiserDictionnaire, fusionner } from '@logibtp/socle/dictionnaire';

const lire = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
initialiserDictionnaire({
  libelles: fusionner(lire('../../../../socle/js/personnalisation/fr.json'), lire('../personnalisation/fr.json')),
  icones: fusionner(lire('../../../../socle/js/personnalisation/images/icones.json'), lire('../personnalisation/images/icones.json')),
  surManquante: (cle) => { throw new Error(`Clé absente du dictionnaire : ${cle}`); },
});
