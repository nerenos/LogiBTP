import config from './raccourcis.json';

/** Représentation normalisée d'un événement clavier : « Ctrl+Shift+Enter », « Alt+ArrowUp », « + ». */
export function combinaison(e) {
  const touche = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  // Pour les symboles (+, -…), Maj dépend de la disposition du clavier : on l'ignore.
  const symbole = e.key.length === 1 && !/[A-Z0-9]/i.test(e.key);
  const parties = [];
  if (e.ctrlKey || e.metaKey) parties.push('Ctrl');
  if (e.altKey) parties.push('Alt');
  if (e.shiftKey && !symbole) parties.push('Shift');
  parties.push(touche === ' ' ? 'Space' : touche);
  return parties.join('+');
}

let actuelle = config;
const index = new Map();

/** Charge une configuration de raccourcis (fusionnée avec celle par défaut du socle). */
export function configurerRaccourcis(surcharge = {}) {
  actuelle = { ...config, ...surcharge };
  index.clear();
  for (const [action, valeur] of Object.entries(actuelle)) {
    if (action.startsWith('_')) continue;
    for (const c of Array.isArray(valeur) ? valeur : [valeur]) index.set(c.toUpperCase(), action);
  }
}
configurerRaccourcis();

/** Action associée à un événement clavier, ou null. */
export function actionDe(e) {
  return index.get(combinaison(e).toUpperCase()) ?? null;
}

export function libelleRaccourci(action) {
  const v = actuelle[action];
  return (Array.isArray(v) ? v[0] : v ?? '').replace('Ctrl', 'Ctrl').replace('Shift', 'Maj').replace('Arrow', '').replace('Enter', 'Entrée');
}
