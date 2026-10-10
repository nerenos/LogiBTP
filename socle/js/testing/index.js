// Outils communs aux suites qui rejouent les jeux de test partagés JS / C# (tests/cas/*.json).
import fs from 'node:fs';
import path from 'node:path';
import { D } from '../src/calcul/decimal.js';

/** Fichiers JSON d'un dossier, triés. */
export function lireCas(dossier) {
  return fs.readdirSync(dossier).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ fichier: f, cas: JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')) }));
}

/** Égalité attendu / obtenu : nombres comparés en décimal exact, null = absent. */
export function egal(attendu, obtenu) {
  if (attendu === null) return obtenu === null || obtenu === undefined;
  if (typeof attendu === 'number') return obtenu !== null && obtenu !== undefined && D(obtenu).eq(attendu);
  return obtenu === attendu;
}

/** Vérifie chaque champ attendu ; ajoute les différences à `fautes`. */
export function verifier(attendu, obtenu, chemin, fautes) {
  if (!obtenu) { fautes.push(`${chemin} : introuvable`); return; }
  for (const [champ, v] of Object.entries(attendu)) {
    if (!egal(v, obtenu[champ])) fautes.push(`${chemin}.${champ} : attendu ${JSON.stringify(v)}, obtenu ${JSON.stringify(obtenu[champ] ?? null)}`);
  }
}

/** Compare la liste des codes d'erreur produits à celle attendue (absente = aucune erreur). */
export function verifierErreurs(attendus = [], erreurs, fautes) {
  const codes = erreurs.map((e) => e.code).sort();
  const att = [...attendus].sort();
  if (JSON.stringify(codes) !== JSON.stringify(att)) fautes.push(`erreurs : attendu ${JSON.stringify(att)}, obtenu ${JSON.stringify(erreurs)}`);
}
