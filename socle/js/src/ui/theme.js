// Thème d'affichage : automatique (celui du système), clair ou sombre. Le choix est posé sur <html data-theme>,
// que socle.css interprète ; « auto » retire l'attribut et laisse jouer prefers-color-scheme.

export const THEMES = [
  { code: 'auto', libelle: 'Automatique (système)', icone: '🖥' },
  { code: 'clair', libelle: 'Clair', icone: '☀️' },
  { code: 'sombre', libelle: 'Sombre', icone: '🌙' },
];

export function appliquerTheme(choix, racine = globalThis.document?.documentElement) {
  if (!racine) return;
  if (choix === 'clair') racine.dataset.theme = 'light';
  else if (choix === 'sombre') racine.dataset.theme = 'dark';
  else delete racine.dataset.theme;
}
