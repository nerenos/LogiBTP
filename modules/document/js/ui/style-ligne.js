import { texte, texteHtml, iconeHtml, couleurTheme } from '@logibtp/socle/dictionnaire';
import { creerCombo } from '@logibtp/socle/ui';
import { PROPRIETES_STYLE_LIGNE, normaliserStyle } from '../src/styles-lignes.js';
import { TAILLE_STYLE_LIGNE } from '../src/codes.js';

// Style d'une ligne à l'écran (lot 6 fiches-lignes-documents) : conversion d'un style résolu en classes et variables CSS
// (grille et plan), et éditeur d'un style (détail de la ligne, options du document, écran de paramétrage).

/** Couleurs du thème proposées pour un style (variables --document-style-*, définies dans theme.css). */
export const PALETTE_STYLE = Object.freeze(['bleu', 'vert', 'orange', 'rouge', 'violet', 'gris', 'fond-bleu', 'fond-vert', 'fond-orange', 'fond-rouge', 'fond-gris'].map((n) => `--document-style-${n}`));

/** Valeur CSS d'une couleur de style : #rrggbb tel quel, variable du thème (--nom) en var(). */
export const couleurCss = (c) => (typeof c === 'string' && c.startsWith('--') ? `var(${c})` : c);

/**
 * Classes et variables CSS d'un style résolu : { classes: ['ls-couleur', …], variables: { '--ligne-couleur': … } }, ou
 * null sans style. Les règles (socle.css, document.css) ne s'appliquent qu'aux propriétés fixées.
 */
export function presentationStyle(style) {
  const s = normaliserStyle(style);
  if (!Object.keys(s).length) return null;
  const classes = [];
  const variables = {};
  if (s.couleur) { classes.push('ls-couleur'); variables['--ligne-couleur'] = couleurCss(s.couleur); }
  if (s.fond) { classes.push('ls-fond'); variables['--ligne-fond'] = couleurCss(s.fond); }
  if (s.gras !== undefined) { classes.push('ls-gras'); variables['--ligne-poids'] = s.gras ? '700' : '400'; }
  if (s.italique !== undefined) { classes.push('ls-italique'); variables['--ligne-fonte'] = s.italique ? 'italic' : 'normal'; }
  if (s.souligne !== undefined || s.barre !== undefined) {
    classes.push('ls-deco');
    variables['--ligne-deco'] = [s.souligne ? 'underline' : '', s.barre ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
  }
  if (s.taille) { classes.push('ls-taille'); variables['--ligne-taille'] = `var(--document-style-taille-${s.taille.toLowerCase()})`; }
  return { classes: ['ligne-stylee', ...classes], variables };
}

/** Attribut style="…" des variables d'un style (plan), déjà échappé pour un attribut entre guillemets. */
export function attributVariables(presentation) {
  return presentation ? Object.entries(presentation.variables).map(([k, v]) => `${k}:${v}`).join(';').replace(/"/g, '&quot;') : '';
}

const cle = (c) => c.replace('--document-style-', '');

/**
 * Éditeur d'un style : une couleur (palette du thème ou couleur libre) pour le texte et pour le fond, quatre choix
 * oui / non / hérité (gras, italique, souligné, barré), la taille et un bouton d'effacement. `surChangement(style)`
 * reçoit le style nettoyé (propriétés fixées seulement). Renvoie l'élément.
 */
export function creerEditeurStyle({ style = {}, surChangement, lectureSeule = false, classe = '' } = {}) {
  let etat = normaliserStyle(style);
  const racine = document.createElement('div');
  racine.className = `editeur-style ${classe}`.trim();
  const rendre = () => {
  racine.replaceChildren();
  const changer = (propriete, valeur) => {
    if (valeur === '' || valeur === null || valeur === undefined) delete etat[propriete];
    else etat[propriete] = valeur;
    surChangement?.(normaliserStyle(etat));
  };
  const champ = (libelle, element) => {
    const l = document.createElement('label');
    l.innerHTML = `<span>${libelle}</span>`;
    l.append(element);
    racine.append(l);
  };
  const palette = PALETTE_STYLE.map((c) => ({ valeur: c, libelle: texte(`document.styles.palette.${cle(c)}`), couleur: couleurTheme(c, '') }));
  for (const p of ['couleur', 'fond']) {
    const zone = document.createElement('span');
    zone.className = 'editeur-style-couleur';
    const combo = creerCombo({ options: palette, valeur: PALETTE_STYLE.includes(etat[p]) ? etat[p] : '' });
    const libre = document.createElement('input');
    libre.type = 'color';
    libre.title = texte('document.styles.libre');
    libre.value = /^#[0-9a-f]{6}$/.test(etat[p] ?? '') ? etat[p] : couleurTheme('--document-style-defaut', '#808080');
    combo.readOnly = lectureSeule;
    libre.disabled = lectureSeule;
    combo.addEventListener('change', () => changer(p, combo.valeurCombo));
    libre.addEventListener('change', () => { combo.definirValeur(''); changer(p, libre.value); });
    zone.append(combo, libre);
    champ(texteHtml(`document.styles.${p}`), zone);
  }
  const ouiNon = [{ valeur: 'oui', libelle: texte('commun.oui') }, { valeur: 'non', libelle: texte('commun.non') }];
  for (const p of ['gras', 'italique', 'souligne', 'barre']) {
    const combo = creerCombo({ options: ouiNon, valeur: etat[p] === undefined ? '' : etat[p] ? 'oui' : 'non' });
    combo.readOnly = lectureSeule;
    combo.addEventListener('change', () => changer(p, combo.valeurCombo === '' ? '' : combo.valeurCombo === 'oui'));
    champ(texteHtml(`document.styles.${p}`), combo);
  }
  const taille = creerCombo({ options: Object.values(TAILLE_STYLE_LIGNE).map((t) => ({ valeur: t, libelle: texte(`document.styles.taille.${t}`) })), valeur: etat.taille ?? '' });
  taille.readOnly = lectureSeule;
  taille.addEventListener('change', () => changer('taille', taille.valeurCombo));
  champ(texteHtml('document.styles.taille_titre'), taille);
  if (!lectureSeule) {
    const effacer = document.createElement('button');
    effacer.type = 'button';
    effacer.title = texte('document.styles.effacer_aide');
    effacer.innerHTML = `${iconeHtml('retirer')} ${texteHtml('document.styles.effacer')}`;
    effacer.addEventListener('click', () => { etat = {}; surChangement?.({}); rendre(); });
    racine.append(effacer);
  }
  };
  rendre();
  return racine;
}

export { PROPRIETES_STYLE_LIGNE };
