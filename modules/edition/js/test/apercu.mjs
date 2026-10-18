// Aperçu d'essai : pages SVG + polices en data URI dans un fichier HTML autonome.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageSvg, policesCss, FACES_EDITION } from '../src/index.js';
const dossier = fileURLToPath(new URL('../polices/', import.meta.url));
export function ecrireApercu(resultat, chemin, ressources = {}, seule = null) {
  const faces = FACES_EDITION.map((f) => ({ ...f, url: 'data:font/ttf;base64,' + readFileSync(dossier + f.fichier).toString('base64') }));
  const pages = seule ? resultat.pages.filter((p) => p.numero === seule) : resultat.pages;
  const html = `<!doctype html><meta charset="utf-8"><title>Aperçu</title><style>body{background:#888;margin:0;padding:8px}svg{display:block;margin:0 auto 16px;box-shadow:0 2px 8px #0005;height:${seule ? '96vh' : 'auto'};width:auto}${policesCss(faces)}</style>`
    + pages.map((p) => pageSvg(p, { ressources })).join('');
  writeFileSync(chemin, html);
}
