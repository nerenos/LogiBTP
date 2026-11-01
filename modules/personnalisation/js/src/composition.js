// Composition des couches de personnalisation (Node : construction du client, serveur de développement, tests).
// Une couche est un dossier « personnalisation/ » d'un paquet (socle, modules) ou du cœur, dans l'ordre socle → modules →
// cœur, qui peut contenir :
//   fr.json             textes (fusion profonde : la couche suivante l'emporte clé par clé)
//   theme.css           variables du thème (concaténées dans l'ordre : les suivantes l'emportent)
//   images/icones.json  catalogue des icônes (fusion)
//   images/<fichier>    images (celle de la dernière couche qui la fournit)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fusionner } from '@logibtp/socle/dictionnaire';

export const DICTIONNAIRE = 'fr.json';
export const THEME = 'theme.css';
export const ICONES = 'images/icones.json';

const lireJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

/** Fichiers d'images d'une couche (chemins relatifs à la couche, « images/… »), hors catalogue des icônes. */
function images(dossier) {
  const racine = path.join(dossier, 'images');
  if (!fs.existsSync(racine)) return [];
  const res = [];
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) parcourir(f);
      else res.push(path.relative(dossier, f).split(path.sep).join('/'));
    }
  };
  parcourir(racine);
  return res.filter((f) => f !== ICONES).sort();
}

/** Empreinte courte d'un contenu (version du dictionnaire, suffixe des adresses d'images). */
export const empreinte = (contenu) => createHash('sha256').update(contenu).digest('hex').slice(0, 16);

/**
 * Compose les couches : { libelles, icones, theme, images: Map<relatif, chemin absolu>, fichiers: [sources lues] }.
 * _meta.version du dictionnaire = empreinte de tout le contenu composé (textes, icônes, thème, images).
 */
export function composer(couches) {
  const dossiers = couches.map((c) => path.resolve(c));
  const libelles = fusionner(...dossiers.map((d) => lireJson(path.join(d, DICTIONNAIRE))));
  const icones = fusionner(...dossiers.map((d) => lireJson(path.join(d, ICONES))));
  // Chaque thème précédé du paquet qui le fournit (dossier parent de la couche : js, client…).
  const themes = dossiers.map((d) => path.join(d, THEME)).filter((f) => fs.existsSync(f));
  const origine = (f) => path.relative(path.resolve(f, '../../..'), f).split(path.sep).join('/');
  const theme = themes.map((f) => `/* ${origine(f)} */\n${fs.readFileSync(f, 'utf8')}`).join('\n');
  const imgs = new Map();
  for (const d of dossiers) for (const r of images(d)) imgs.set(r, path.join(d, r));
  const h = createHash('sha256').update(JSON.stringify([libelles, icones, theme]));
  for (const [r, f] of [...imgs].sort()) h.update(r).update(fs.readFileSync(f));
  const meta = { ...(libelles._meta ?? {}) };
  delete meta.version;
  return {
    libelles: { ...libelles, _meta: { ...meta, version: h.digest('hex').slice(0, 16) } },
    icones,
    theme,
    images: imgs,
    fichiers: [
      ...dossiers.flatMap((d) => [DICTIONNAIRE, ICONES, THEME].map((f) => path.join(d, f))).filter((f) => fs.existsSync(f)),
      ...imgs.values(),
    ],
  };
}

/** Contenu servi d'un fichier composé (chemin relatif à /personnalisation/), ou null. */
export function contenu(composition, relatif) {
  const r = relatif.replace(/^\/+/, '');
  if (r === DICTIONNAIRE) return { type: 'application/json; charset=utf-8', corps: JSON.stringify(composition.libelles) };
  if (r === ICONES) return { type: 'application/json; charset=utf-8', corps: JSON.stringify(composition.icones) };
  if (r === THEME) return { type: 'text/css; charset=utf-8', corps: composition.theme };
  const f = composition.images.get(r);
  if (!f) return null;
  const ext = path.extname(r).toLowerCase();
  const type = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' }[ext]
    ?? 'application/octet-stream';
  return { type, corps: fs.readFileSync(f) };
}
