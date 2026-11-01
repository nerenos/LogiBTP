// Lot P2 du module Personnalisation : sources relevées pour le catalogue des erreurs par code (catalogueErreurs du
// module) et couche qui reçoit chaque code. Partagé par extraire-erreurs.mjs et client/test/personnalisation.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IGNORES = new Set(['node_modules', 'bin', 'obj', 'dist', '.git', 'test', 'tests']);

function parcourir(dossier, filtre, res = []) {
  if (!fs.existsSync(dossier)) return res;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const f = path.join(dossier, e.name);
    if (e.isDirectory()) { if (!IGNORES.has(e.name) && !e.name.endsWith('.Tests') && !e.name.endsWith('.Testing')) parcourir(f, filtre, res); }
    else if (filtre(e.name)) res.push(f);
  }
  return res;
}

const lire = (f) => ({ chemin: path.relative(racine, f).split(path.sep).join('/'), source: fs.readFileSync(f, 'utf8') });

/** Sources C# de l'API (socle, modules, cœur) et JS des moteurs (fichiers qui appellent this.erreur / ErreurCalcul). */
export function sourcesErreurs() {
  const cs = ['socle/dotnet', 'modules', 'src'].flatMap((d) => parcourir(path.join(racine, d), (n) => n.endsWith('.cs'))).map(lire);
  const dossiersJs = ['socle/js/src', 'client/src', ...fs.readdirSync(path.join(racine, 'modules')).map((m) => `modules/${m}/js/src`)];
  const js = dossiersJs.flatMap((d) => parcourir(path.join(racine, d), (n) => n.endsWith('.js'))).map(lire)
    .filter((f) => /\bthis\.(erreur|avertir)\(|new ErreurCalcul\(/.test(f.source));
  return { cs, js };
}

/**
 * Couche d'un code : la plus basse de ses lieux (socle, puis module par ordre alphabétique, puis cœur), un module sans
 * paquet JS ayant son dossier personnalisation/ à sa racine.
 */
export function coucheErreur(chemins) {
  const couches = chemins.map((c) => {
    if (c.startsWith('socle/')) return '0|socle/js/personnalisation';
    const m = c.match(/^modules\/([^/]+)\//);
    if (m) return `1${m[1]}|modules/${m[1]}/${fs.existsSync(path.join(racine, 'modules', m[1], 'js')) ? 'js/' : ''}personnalisation`;
    return '2|client/personnalisation';
  }).sort();
  return couches[0].split('|')[1];
}
