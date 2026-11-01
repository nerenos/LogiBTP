// Dictionnaire des couches socle → navigation posé avant les tests : les composants affichent leurs vrais textes.
import { readFileSync } from 'node:fs';
import { initialiserDictionnaire, fusionner } from '@logibtp/socle/dictionnaire';

const lire = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
initialiserDictionnaire({
  libelles: fusionner(lire('../../../../socle/js/personnalisation/fr.json'), lire('../personnalisation/fr.json')),
  icones: lire('../../../../socle/js/personnalisation/images/icones.json'),
});
