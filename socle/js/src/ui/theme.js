// Thème d'affichage : automatique (celui du système), clair ou sombre. Le choix est posé sur <html data-theme>,
// que theme.css (module Personnalisation) interprète ; « auto » retire l'attribut et laisse jouer prefers-color-scheme.
import { texte, icone } from '../dictionnaire/index.js';

export const THEMES = [
  { code: 'auto', libelle: texte('socle.theme.auto'), icone: icone('theme_auto') },
  { code: 'clair', libelle: texte('socle.theme.clair'), icone: icone('theme_clair') },
  { code: 'sombre', libelle: texte('socle.theme.sombre'), icone: icone('theme_sombre') },
];

/** Densité d'affichage (I6) : confortable par défaut, compacte en option ; posée sur <html data-densite>. */
export const DENSITES = [
  { code: 'confortable', libelle: texte('socle.densite.confortable'), icone: icone('densite_confortable') },
  { code: 'compacte', libelle: texte('socle.densite.compacte'), icone: icone('densite_compacte') },
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
