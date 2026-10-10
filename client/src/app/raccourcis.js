import config from '../config/raccourcis.json';

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

const index = new Map();
for (const [action, valeur] of Object.entries(config)) {
  if (action.startsWith('_')) continue;
  for (const c of Array.isArray(valeur) ? valeur : [valeur]) index.set(c.toUpperCase(), action);
}

/** Action associée à un événement clavier, ou null. */
export function actionDe(e) {
  return index.get(combinaison(e).toUpperCase()) ?? null;
}

export function libelleRaccourci(action) {
  const v = config[action];
  return (Array.isArray(v) ? v[0] : v ?? '').replace('Ctrl', 'Ctrl').replace('Shift', 'Maj').replace('Arrow', '').replace('Enter', 'Entrée');
}
