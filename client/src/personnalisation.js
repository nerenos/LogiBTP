// Personnalisation du client (module Personnalisation, ANALYSE-MODULE-PERSONNALISATION.md § 5.2) : chargée par
// main.js AVANT l'import de l'application, pour que tout le code (constantes de module comprises) lise les vrais textes.
// fr.json, images/icones.json et le logo sont préchargés par index.html (greffon Vite) ; serveur injoignable sans
// copie gardée : dictionnaire du programme intégré au client (module virtuel, chargé seulement dans ce cas).
import { chargerDictionnaire, ADRESSE_PERSONNALISATION } from '@logibtp/socle/dictionnaire';

/** Logo du bandeau, préchargé par index.html (PRECHARGES de personnalisation/couches.js). */
export const LOGO = 'images/logo.svg';

let logo = '';

/** SVG du logo, inséré tel quel dans le bandeau (couleur du texte suivie) : SVG seul, sans script ni gestionnaire. */
export function logoValide(svg) {
  const t = String(svg ?? '').trim();
  return /^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(t) && !/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(t) ? t.replace(/^<\?xml[^>]*>\s*/i, '') : '';
}

async function lireLogo() {
  try {
    const r = await fetch(`${ADRESSE_PERSONNALISATION}${LOGO}`, { credentials: 'same-origin' });
    return r.ok ? logoValide(await r.text()) : '';
  } catch {
    return '';
  }
}

export async function chargerPersonnalisation() {
  const surManquante = import.meta.env?.DEV ? (cle) => console.warn(`[personnalisation] clé absente du dictionnaire : ${cle}`) : null;
  const [, svg] = await Promise.all([
    chargerDictionnaire({ secours: () => import('virtual:logibtp-personnalisation').then((m) => m.default), surManquante }),
    lireLogo(),
  ]);
  logo = svg;
}

/** Logo du bandeau (SVG), '' s'il manque : le bandeau affiche alors le nom de l'application. */
export const logoApplication = () => logo;
