// Dictionnaire du socle (couche personnalisation/) posé avant les tests : les composants affichent leurs vrais textes.
import { readFileSync } from 'node:fs';
import { initialiserDictionnaire } from '../src/dictionnaire/index.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../personnalisation/${f}`, import.meta.url), 'utf8'));
initialiserDictionnaire({ libelles: lire('fr.json'), icones: lire('images/icones.json'), emojis: lire('images/emojis.json') });
