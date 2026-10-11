import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerElement, convertir, codeAppel, analyserCodeAppel } from '../src/calcul.js';
import { FournisseurBibliothequeMemoire } from '../src/fournisseurs.js';
import { S } from '@logibtp/socle';

const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_calcul.json'), 'utf8'));

describe('calcul (jeu partagé avec CalculElement.cs)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => expect(calculerElement(c.entree, jeu.date)).toEqual(c.attendu));
  }
  for (const c of jeu.conversions) {
    it(c.nom, () => expect(S(convertir(c.quantite, c.de, c.vers, c.element).toDecimalPlaces(6))).toBe(c.attendu));
  }
  it('codes d\'appel', () => {
    expect(codeAppel({ bib_code: 'GEN', code: 'BET01' }, 'GEN')).toBe('BET01');
    expect(codeAppel({ bib_code: 'FOUR', code: 'BET01' }, 'GEN')).toBe('FOUR:BET01');
    expect(analyserCodeAppel('four: BET01', 'GEN')).toEqual({ bibliotheque: 'FOUR', code: 'BET01' });
  });
});

describe('fournisseur en mémoire', () => {
  const nouveau = () => {
    const elements = [{ id: 1, bib_id: 1, code: 'HA10', type: 'ARTICLE', libelle_html: '<b>Acier HA10</b>', unite_stock: 'ml',
      unites: [{ unite: 't', formule: '1000 / {{poids_ml}}' }], proprietes: { poids_ml: 0.617 }, scenario_pa: 'FOURNISSEUR_PRINCIPAL',
      coef_fg: '1.1', coef_benef: '1.2', coef_remise: '1', pv_fixe: false }];
    const f = new FournisseurBibliothequeMemoire({ bibliotheques: [{ id: 1, code: 'GEN', libelle: 'Générale', defaut: true, ordre: 0 }], elements });
    return { f, e: elements[0] };
  };

  it('tarif principal : PA recalculé, historique avec commentaire', async () => {
    const { f, e } = nouveau();
    expect(e.pa).toBeNull();
    expect(e.libelle).toBe('Acier HA10');
    const r = await f.enregistrerTarif(1, { fournisseur: 'Aciers du Rhône', unite: 't', prix: '1234', principal: true });
    expect(r.prix.pa).toBe('0.761378');
    const h = await f.historique(1);
    expect(h[0].commentaire).toBe('Tarif fournisseur Aciers du Rhône : 1234 / t');
    expect(h[0].apres.pa).toBe('0.761378');
    expect(h).toHaveLength(2);
  });

  it('familles : chemin, pas de cycle, code unique', async () => {
    const { f } = nouveau();
    await f.enregistrerFamille({ bib_id: 1, code: 'GO', libelle: 'Gros œuvre' });
    await f.enregistrerFamille({ bib_id: 1, code: 'BET', libelle: 'Béton', parent_id: 1 });
    const fams = await f.familles(1);
    expect(fams.map((x) => x.chemin)).toEqual(['Gros œuvre', 'Gros œuvre › Béton']);
    await expect(f.enregistrerFamille({ id: 1, bib_id: 1, code: 'GO', libelle: 'Gros œuvre', parent_id: 2 })).rejects.toMatchObject({ code: 'PARENT' });
    await expect(f.enregistrerFamille({ bib_id: 1, code: 'go', libelle: 'Doublon' })).rejects.toMatchObject({ code: 'CODE' });
  });

  it('paramétrage réservé à l\'administrateur', async () => {
    const { f } = nouveau();
    f.profil = 'SAISIE';
    await expect(f.enregistrerBibliotheque({ code: 'FOUR', libelle: 'Fournisseurs' })).rejects.toMatchObject({ code: 'ACCES_REFUSE' });
  });
});
