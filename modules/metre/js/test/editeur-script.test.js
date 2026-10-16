import { describe, it, expect } from 'vitest';
import { modeleFonction, STRUCTURES } from '../ui/editeur-script.js';
import { FONCTIONS, analyserScript } from '../src/index.js';

// Modèles insérés par l'éditeur (complétion, dictionnaire) : appels de fonction et structures du langage.
describe('Éditeur de script : modèles', () => {
  it('appel de fonction depuis sa signature', () => {
    expect(modeleFonction(FONCTIONS.arrondi)).toBe('Arrondi(${x}; ${décimales})');
    expect(modeleFonction(FONCTIONS.min)).toBe('Min(${a}; ${b})');
    expect(modeleFonction(FONCTIONS.taille)).toBe('Taille(${chaîne})');
  });

  it('chaque fonction a une signature et une description', () => {
    for (const f of Object.values(FONCTIONS)) {
      expect(f.signature).toMatch(/^[\p{L}]+\(.*\)$/u);
      expect(f.description).toBeTruthy();
    }
  });

  it('les structures, champs remplis, sont des instructions valides', () => {
    const remplir = (modele) => modele.replace(/\$\{([^}]*)\}/g, (_, nom) => ({
      condition: 'Vrai', i: 'k', début: '1', fin: '3', pas: '1', Nom: 'Valeur', valeur: '2', texte: 'a', Vrai: 'Vrai', quantité: '1', '': '',
    }[nom] ?? nom));
    for (const s of STRUCTURES) {
      const corps = remplir(s.modele);
      // Déclarations en tête ; Sortir / Continuer dans une boucle ; SinonSi dans un Si.
      const texte = /est (un|une)/.test(corps) ? corps
        : /^(Sortir|Continuer)$/.test(corps) ? `Pour k = 1 à 2\n${corps}\nFin`
          : corps.startsWith('SinonSi') ? `Si Faux alors\n${corps}\nFin` : corps;
      expect(analyserScript(texte).erreurs, s.libelle).toEqual([]);
    }
  });
});
