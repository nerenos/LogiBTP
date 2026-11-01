// Thème d'affichage : automatique (celui du système), clair ou sombre. Le choix est posé sur <html data-theme>,
// que theme.css (module Personnalisation) interprète ; « auto » retire l'attribut et laisse jouer prefers-color-scheme.
import { texte, icone } from '../dictionnaire/index.js';

export const THEMES = [
  { code: 'auto', libelle: texte('socle.theme.auto'), icone: icone('theme_auto') },
  { code: 'clair', libelle: texte('socle.theme.clair'), icone: icone('theme_clair') },
  { code: 'sombre', libelle: texte('socle.theme.sombre'), icone: icone('theme_sombre') },
];

export function appliquerTheme(choix, racine = globalThis.document?.documentElement) {
  if (!racine) return;
  if (choix === 'clair') racine.dataset.theme = 'light';
  else if (choix === 'sombre') racine.dataset.theme = 'dark';
  else delete racine.dataset.theme;
}
