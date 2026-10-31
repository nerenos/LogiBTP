// Module Personnalisation, lot P2 : écrit les messages d'erreur sûrs (catalogueErreurs) dans la section « erreurs » du
// fr.json de la couche de chaque code ; les autres clés des fichiers sont gardées. Rejouable :
//   npm run extraire-erreurs --workspace client
// Un code levé avec un message composé, plusieurs messages ou employé ailleurs garde le message du serveur (rapport).
import fs from 'node:fs';
import path from 'node:path';
import { catalogueErreurs } from '@logibtp/personnalisation';
import { COUCHES } from '../personnalisation/couches.js';
import { racine, sourcesErreurs, coucheErreur } from './erreurs-personnalisation.mjs';

const { retenus, ecartes } = catalogueErreurs(sourcesErreurs());
const parCouche = new Map();
for (const [code, r] of retenus) {
  const c = coucheErreur(r.chemins);
  if (!parCouche.has(c)) parCouche.set(c, {});
  parCouche.get(c)[code] = r.message;
}

// Toute couche connue perd ses anciennes entrées générées ; celles qui reçoivent des codes sont écrites.
const connues = new Set([...COUCHES.map((c) => path.relative(racine, c).split(path.sep).join('/')), ...parCouche.keys()]);
for (const couche of [...connues].sort()) {
  const fichier = path.join(racine, couche, 'fr.json');
  const actuel = fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, 'utf8')) : null;
  const erreurs = parCouche.get(couche);
  if (!actuel && !erreurs) continue;
  const { erreurs: _, ...reste } = actuel ?? {};
  const nouveau = erreurs ? { ...reste, erreurs } : reste;
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, `${JSON.stringify(nouveau, null, 2)}\n`);
  console.log(`${couche}/fr.json : ${Object.keys(erreurs ?? {}).length} codes`);
}
const absentes = [...parCouche.keys()].filter((c) => !COUCHES.some((x) => path.relative(racine, x).split(path.sep).join('/') === c));
if (absentes.length) console.log(`\nCouches à ajouter dans client/personnalisation/couches.js :\n  ${absentes.join('\n  ')}`);
const raisons = {};
for (const r of ecartes.values()) raisons[r] = (raisons[r] ?? 0) + 1;
console.log(`\n${retenus.size} codes écrits ; message du serveur gardé pour ${ecartes.size} codes :`, raisons);
