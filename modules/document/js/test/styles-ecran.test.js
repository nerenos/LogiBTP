import { describe, it, expect } from 'vitest';
import { presentationStyle, attributVariables, couleurCss } from '../ui/style-ligne.js';
import { stylesLignes, TL } from '../src/index.js';
import { retirerMiseEnForme } from '@logibtp/socle/ui';

// Style à l'écran (lot 6) : classes et variables CSS, tranche paramétrée, libellé saisi et réimposition.
describe('Styles des lignes à l\'écran', () => {
  it('aucun style : pas de présentation', () => {
    expect(presentationStyle({})).toBeNull();
    expect(presentationStyle(null)).toBeNull();
  });

  it('tranche 1 en gras bleu : classes et variables de la ligne entière', () => {
    const p = presentationStyle({ couleur: '--document-style-bleu', gras: true });
    expect(p.classes).toEqual(['ligne-stylee', 'ls-couleur', 'ls-gras']);
    expect(p.variables).toEqual({ '--ligne-couleur': 'var(--document-style-bleu)', '--ligne-poids': '700' });
    expect(attributVariables(p)).toBe('--ligne-couleur:var(--document-style-bleu);--ligne-poids:700');
  });

  it('souligné et barré se combinent ; non gras explicite', () => {
    const p = presentationStyle({ souligne: true, barre: true, gras: false, taille: 'GRANDE', fond: '#AABBCC' });
    expect(p.variables['--ligne-deco']).toBe('underline line-through');
    expect(p.variables['--ligne-poids']).toBe('400');
    expect(p.variables['--ligne-taille']).toBe('var(--document-style-taille-grande)');
    expect(couleurCss('#aabbcc')).toBe('#aabbcc');
    expect(p.variables['--ligne-fond']).toBe('#aabbcc');
  });

  it('tranche paramétrée visible ; libellé rouge saisi gardé ; réimposer le retire', () => {
    const lignes = [{ lig_id: 1, lig_parent_id: null, lig_tyl_id: TL.TITRE, lig_libelle_html: '<span style="color: red">Gros œuvre</span>' }];
    const styles = stylesLignes(lignes, { famille: 'V', type: 'V_DEVIS', styles: [{ classe: 'TRANCHE_1', famille: null, type: null, valeur: { couleur: '--document-style-bleu', gras: true } }] });
    expect(styles.get(1)).toEqual({ couleur: '--document-style-bleu', gras: true });
    expect(lignes[0].lig_libelle_html).toContain('red');
    expect(retirerMiseEnForme(lignes[0].lig_libelle_html)).toBe('Gros œuvre');
  });
});
