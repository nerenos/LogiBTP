import { texte, texteHtml, iconeHtml, couleurTheme } from '@logibtp/socle/dictionnaire';
import { creerCombo } from '@logibtp/socle/ui';
import { PROPRIETES_STYLE_LIGNE, normaliserStyle } from '../src/styles-lignes.js';
import { TAILLE_STYLE_LIGNE } from '../src/codes.js';

// Style d'une ligne à l'écran (lot 6 fiches-lignes-documents) : conversion d'un style résolu en classes et variables CSS
// (grille et plan), et éditeur d'un style (détail de la ligne, options du document, écran de paramétrage).

/** Teintes de la palette des styles (16, lisibles en thème clair et sombre : variables de theme.css). */
export const TEINTES_STYLE = Object.freeze(['rouge', 'orange', 'ambre', 'jaune', 'citron', 'vert', 'emeraude', 'sarcelle', 'cyan', 'ciel', 'bleu', 'indigo', 'violet', 'pourpre', 'rose', 'gris']);

/** Couleurs du thème proposées pour le texte (--document-style-<teinte>) et pour le fond (--document-style-fond-<teinte>). */
export const PALETTE_TEXTE = Object.freeze(TEINTES_STYLE.map((n) => `--document-style-${n}`));
export const PALETTE_FOND = Object.freeze(TEINTES_STYLE.map((n) => `--document-style-fond-${n}`));
export const PALETTE_STYLE = Object.freeze([...PALETTE_TEXTE, ...PALETTE_FOND]);

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

const teinte = (c) => c.replace('--document-style-', '').replace(/^fond-/, '');

/**
 * Éditeur d'un style : une couleur (palette du thème en 16 teintes ou couleur libre) pour le texte et pour le fond,
 * quatre interrupteurs (gras, italique, souligné, barré : non fixé = hérité, atténué ; fixé = oui / non, avec un bouton
 * de retour à l'hérité), la taille et un bouton d'effacement. `surChangement(style)`
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
  for (const p of ['couleur', 'fond']) {
    const liste = p === 'fond' ? PALETTE_FOND : PALETTE_TEXTE;
    // Une couleur enregistrée de l'autre palette (styles d'avant les 16 teintes) reste proposée telle quelle.
    const options = [...liste, ...(PALETTE_STYLE.includes(etat[p]) && !liste.includes(etat[p]) ? [etat[p]] : [])]
      .map((c) => ({ valeur: c, libelle: texte(`document.styles.palette.${teinte(c)}`), couleur: couleurTheme(c, '') }));
    const zone = document.createElement('span');
    zone.className = 'editeur-style-couleur';
    const combo = creerCombo({ options, valeur: PALETTE_STYLE.includes(etat[p]) ? etat[p] : '' });
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
  for (const p of ['gras', 'italique', 'souligne', 'barre']) {
    const zone = document.createElement('span');
    zone.className = 'editeur-style-interrupteur';
    const bascule = document.createElement('input');
    bascule.type = 'checkbox';
    bascule.className = 'interrupteur';
    bascule.setAttribute('role', 'switch');
    bascule.disabled = lectureSeule;
    const herite = document.createElement('button');
    herite.type = 'button';
    herite.className = 'editeur-style-herite';
    herite.title = texte('document.styles.herite_aide');
    herite.innerHTML = iconeHtml('retirer');
    const afficher = () => {
      const fixe = etat[p] !== undefined;
      bascule.checked = etat[p] === true;
      bascule.classList.toggle('herite', !fixe);
      bascule.title = fixe ? '' : texte('document.styles.herite');
      herite.hidden = !fixe || lectureSeule;
    };
    bascule.addEventListener('change', () => { changer(p, bascule.checked); afficher(); });
    herite.addEventListener('click', () => { changer(p, ''); afficher(); });
    afficher();
    zone.append(bascule, herite);
    champ(texteHtml(`document.styles.${p}`), zone);
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
