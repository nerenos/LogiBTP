// Exporte les résultats du moteur JS pour chaque jeu de test partagé dans tests/resultats-js/.
// Le test xUnit Parite_avec_le_moteur_js les compare champ par champ au moteur C#.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerDocument } from '../src/calcul/index.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests');
const sortie = path.join(racine, 'resultats-js');
fs.mkdirSync(sortie, { recursive: true });

for (const f of fs.readdirSync(path.join(racine, 'cas')).filter((x) => x.endsWith('.json'))) {
  const cas = JSON.parse(fs.readFileSync(path.join(racine, 'cas', f), 'utf8'));
  fs.writeFileSync(path.join(sortie, f), JSON.stringify(calculerDocument(cas.entree), null, 2));
}
console.log(`Résultats exportés dans ${sortie}`);
