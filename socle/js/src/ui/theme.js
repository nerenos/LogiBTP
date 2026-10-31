// Thème d'affichage : automatique (celui du système), clair ou sombre. Le choix est posé sur <html data-theme>,
// que socle.css interprète ; « auto » retire l'attribut et laisse jouer prefers-color-scheme.

export const THEMES = [
  { code: 'auto', libelle: 'Automatique (système)', icone: '🖥' },
  { code: 'clair', libelle: 'Clair', icone: '☀️' },
  { code: 'sombre', libelle: 'Sombre', icone: '🌙' },
];

/** Densité d'affichage (I6) : confortable par défaut, compacte en option ; posée sur <html data-densite>. */
export const DENSITES = [
  { code: 'confortable', libelle: 'Confortable', icone: '🔍' },
  { code: 'compacte', libelle: 'Compacte', icone: '🔬' },
];

export function appliquerDensite(choix, racine = globalThis.document?.documentElement) {
  if (!racine) return;
  if (choix === 'compacte') racine.dataset.densite = 'compacte';
  else delete racine.dataset.densite;
}

export function appliquerTheme(choix, racine = globalThis.document?.documentElement) {
  if (!racine) return;
  if (choix === 'clair') racine.dataset.theme = 'light';
  else if (choix === 'sombre') racine.dataset.theme = 'dark';
  else delete racine.dataset.theme;
}
