import { describe, it, expect } from 'vitest';
import { activerTitresCourts, ongletsDebordent } from '../src/ui/onglets.js';
import { retirerMiseEnForme } from '../src/ui/format.js';

// Faux DOM minimal : un bouton = un nœud texte (titre) ; `largeur` simule la place disponible.
function faux(titres, largeurDispo) {
  const boutons = titres.map(([titre, court]) => {
    const noeud = { nodeType: 3, textContent: titre };
    const attrs = {};
    return {
      dataset: { titre, court }, childNodes: [noeud], noeud, offsetParent: {}, offsetWidth: 1, offsetTop: 0,
      setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, attrs,
    };
  });
  const nav = {
    clientWidth: largeurDispo, classList: { toggle() {} },
    querySelectorAll: () => {
      // un bouton passe à la ligne s'il ne tient plus : cumul des largeurs des textes affichés
      let cumul = 0;
      for (const b of boutons) { cumul += b.noeud.textContent.length * 10; b.offsetTop = cumul > nav.clientWidth ? 30 : 0; }
      return boutons;
    },
  };
  return { nav, boutons };
}
const TITRES = [['Informations générales', 'Infos'], ['Pièces jointes', 'PJ'], ['Historique complet', 'Hist.']];

describe('titres courts des onglets', () => {
  it('débordement : tous les onglets passent au titre court, titre complet en infobulle', () => {
    const { nav, boutons } = faux(TITRES, 300);
    expect(ongletsDebordent(nav)).toBe(true);
    activerTitresCourts(nav);
    expect(boutons.map((b) => b.noeud.textContent)).toEqual(['Infos', 'PJ', 'Hist.']);
    expect(boutons[0].attrs.title).toBe('Informations générales');
  });
  it('aucun débordement : titres complets, pas d\'infobulle', () => {
    const { nav, boutons } = faux(TITRES, 2000);
    activerTitresCourts(nav);
    expect(boutons.map((b) => b.noeud.textContent)).toEqual(['Informations générales', 'Pièces jointes', 'Historique complet']);
    expect(boutons[0].attrs.title).toBeUndefined();
  });
});

describe('retirerMiseEnForme', () => {
  it('retire gras, italique, souligné, barré', () => {
    expect(retirerMiseEnForme('<b>a</b> <strong>b</strong> <i>c</i> <u>d</u> <s>e</s>')).toBe('a b c d e');
  });
  it('retire couleur, fond, taille ; garde l\'alignement', () => {
    expect(retirerMiseEnForme('<span style="color: red; font-size: 20px">x</span>')).toBe('x');
    expect(retirerMiseEnForme('<p style="text-align: center; background-color: #fff">x</p>')).toBe('<p style="text-align: center">x</p>');
  });
  it('garde listes et retours à la ligne', () => {
    expect(retirerMiseEnForme('<ul><li><b>a</b></li><li>b<br>c</li></ul>')).toBe('<ul><li>a</li><li>b<br>c</li></ul>');
  });
  it('vide', () => { expect(retirerMiseEnForme(null)).toBe(''); });
});
