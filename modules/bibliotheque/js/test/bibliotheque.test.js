import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reglePremierTarif, calculerElement, convertir, codeAppel, analyserCodeAppel, coefficientsEffectifs } from '../src/calcul.js';
import { FournisseurBibliothequeMemoire } from '../src/fournisseurs.js';
import { suivreTarifs, signalerTarifs, actionsLigneTarif, tarifDepuisSaisie } from '../ui/onglets.js';
import { entreeDepuisLigne } from '../src/fournisseurs.js';
import { S } from '@logibtp/socle';
import { elementVendu, TYPE_ELEMENT } from '../src/codes.js';

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

describe('coefficients par période (jeu partagé avec CoefficientsElement.cs)', () => {
  const jeuCoefs = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_coefficients.json'), 'utf8'));
  for (const c of jeuCoefs.cas) {
    it(c.nom, () => expect(coefficientsEffectifs(c.element, jeuCoefs.periodes, c.date, jeuCoefs.defauts)).toEqual(c.attendu));
  }
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

describe('onglet Prix : rechargement des tarifs', () => {
  it('tarif ajouté depuis la fiche Tarifs, puis onglet Prix : tarif proposé et prix recalculé', async () => {
    const elements = [{ id: 1, bib_id: 1, code: 'HA10', type: 'ARTICLE', libelle_html: 'Acier', unite_stock: 'ml',
      unites: [], proprietes: {}, scenario_pa: 'FOURNISSEUR_PRINCIPAL', coef_fg: '1.1', coef_benef: '1.2', coef_remise: '1', pv_fixe: false }];
    const f = new FournisseurBibliothequeMemoire({ bibliotheques: [{ id: 1, code: 'GEN', libelle: 'G', defaut: true, ordre: 0 }], elements });
    let tarifs = await f.tarifs(1);
    const vus = [];
    const fin = suivreTarifs(async (id) => { tarifs = await f.tarifs(id); vus.push(id); });
    expect(tarifs).toHaveLength(0);
    const r = await f.enregistrerTarif(1, { fournisseur: 'X', unite: 'ml', prix: '10', principal: true });
    signalerTarifs(1, r.tarifs);
    await new Promise((ok) => setTimeout(ok, 0));
    fin();
    expect(vus).toEqual([1]);
    expect(tarifs).toHaveLength(1);
    expect(calculerElement(entreeDepuisLigne(elements[0], tarifs)).pa).toBe('10');
    signalerTarifs(1, []);
    expect(vus).toHaveLength(1);
  });
});

describe('onglet Tarifs : enregistrement à la sortie de ligne', () => {
  it("ligne modifiée : un seul EnregistrerTarif ; aucun bouton d'enregistrement par ligne existante ; ajout conservé", async () => {
    const elements = [{ id: 1, bib_id: 1, code: 'HA10', type: 'ARTICLE', libelle_html: 'Acier', unite_stock: 'ml',
      unites: [], proprietes: {}, scenario_pa: 'FIXE', coef_fg: '1', coef_benef: '1', coef_remise: '1', pv_fixe: false }];
    const f = new FournisseurBibliothequeMemoire({ bibliotheques: [{ id: 1, code: 'GEN', libelle: 'G', defaut: true, ordre: 0 }], elements });
    let appels = 0;
    const origine = f.enregistrerTarif.bind(f);
    f.enregistrerTarif = (...a) => { appels++; return origine(...a); };
    const r1 = await f.enregistrerTarif(1, tarifDepuisSaisie({}, { fournisseur: 'X', unite: 'ml', prix: '10' }));
    appels = 0;
    const t = r1.tarifs[0];
    const r2 = await f.enregistrerTarif(1, tarifDepuisSaisie(t, { prix: '12,5', remise1: null, delai: null }));
    expect(appels).toBe(1);
    expect(r2.tarifs[0].prix).toBe('12.5');
    expect(actionsLigneTarif(t, true)).toEqual(['supprimer']);
    expect(actionsLigneTarif({}, true)).toEqual(['enregistrer']);
    expect(actionsLigneTarif(t, false)).toEqual([]);
  });
});

describe("premier tarif d'un élément", () => {
  const nouvelElement = (extra = {}) => {
    const elements = [{ id: 1, bib_id: 1, code: 'X', type: 'ARTICLE', libelle_html: 'X', unite_stock: 'ml', unites: [], proprietes: {},
      scenario_pa: 'FIXE', pa_fixe: null, coef_fg: '1', coef_benef: '1', coef_remise: '1', pv_fixe: false, ...extra }];
    return { f: new FournisseurBibliothequeMemoire({ bibliotheques: [{ id: 1, code: 'GEN', libelle: 'G', defaut: true, ordre: 0 }], elements }), e: elements[0] };
  };

  it('premier tarif : principal et scénario FOURNISSEUR_PRINCIPAL ; second tarif : rien ne change', async () => {
    const { f, e } = nouvelElement();
    const r = await f.enregistrerTarif(1, { fournisseur: 'A', unite: 'ml', prix: '10', principal: false });
    expect(r.tarifs[0].principal).toBe(true);
    expect(e.scenario_pa).toBe('FOURNISSEUR_PRINCIPAL');
    expect(r.prix.pa).toBe('10');
    e.scenario_pa = 'FIXE';
    const r2 = await f.enregistrerTarif(1, { fournisseur: 'B', unite: 'ml', prix: '8', principal: false });
    expect(r2.tarifs.find((t) => t.fournisseur === 'B').principal).toBe(false);
    expect(e.scenario_pa).toBe('FIXE');
  });

  it('élément avec PA saisi : scénario conservé, premier tarif principal', async () => {
    const { f, e } = nouvelElement({ pa_fixe: '5' });
    const r = await f.enregistrerTarif(1, { fournisseur: 'A', unite: 'ml', prix: '10' });
    expect(r.tarifs[0].principal).toBe(true);
    expect(e.scenario_pa).toBe('FIXE');
  });

  const jeuPremier = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/03_premier_tarif.json'), 'utf8'));
  for (const c of jeuPremier.cas) {
    it(`cas partagé : ${c.nom}`, () => {
      expect(reglePremierTarif(c.autres, c.principal, c.scenario, c.pa_fixe)).toEqual(c.attendu);
    });
  }

  it("import : premier tarif d'un élément sans PA principal et FOURNISSEUR_PRINCIPAL ; élément déjà tarifé inchangé", async () => {
    const { f, e } = nouvelElement();
    const lignes = [{ element: 'X', unite: 'ml', prix: '10' }];
    await f.importerTarifs({ tiers_id: 7, fournisseur: 'A', lignes, simulation: false });
    expect(e.scenario_pa).toBe('FOURNISSEUR_PRINCIPAL');
    expect((await f.tarifs(1))[0].principal).toBe(true);
    e.scenario_pa = 'FIXE';
    await f.importerTarifs({ tiers_id: 7, fournisseur: 'A', lignes: [{ element: 'X', unite: 'ml', prix: '12' }], simulation: false });
    expect(e.scenario_pa).toBe('FIXE');
    const autre = nouvelElement({ pa_fixe: '5' });
    await autre.f.importerTarifs({ tiers_id: 7, fournisseur: 'A', lignes, simulation: false });
    expect(autre.e.scenario_pa).toBe('FIXE');
  });

  it('règle pure', () => {
    expect(reglePremierTarif(0, false, 'FIXE', 0)).toEqual({ principal: true, scenario: 'FOURNISSEUR_PRINCIPAL' });
    expect(reglePremierTarif(0, false, 'PMP', null)).toEqual({ principal: true, scenario: 'PMP' });
    expect(reglePremierTarif(2, false, 'FIXE', null)).toEqual({ principal: false, scenario: 'FIXE' });
  });
});

describe('filtre des choix', () => {
  const elements = () => ['A', 'B', 'C'].map((code, i) => ({ id: i + 1, bib_id: 1, code, type: 'ARTICLE', libelle: code, unite_stock: 'u' }));
  const bibliotheques = [{ id: 1, code: 'GEN', libelle: 'G', defaut: true, ordre: 0 }];

  it('sans filtre : tous les éléments', async () => {
    const f = new FournisseurBibliothequeMemoire({ bibliotheques, elements: elements() });
    expect((await f.rechercher()).map((e) => e.code)).toEqual(['A', 'B', 'C']);
  });

  it('élément écarté des choix, présent dans la fiche', async () => {
    const f = new FournisseurBibliothequeMemoire({ bibliotheques, elements: elements(), filtreChoix: (e) => e.code !== 'B' });
    expect((await f.rechercher()).map((e) => e.code)).toEqual(['A', 'C']);
    expect((await f.element(2)).code).toBe('B');
  });
});

describe('éléments vendus (réplique de TypeElement.EstVendu)', () => {
  it('article et ouvrage seulement', () => {
    expect(Object.values(TYPE_ELEMENT).filter(elementVendu)).toEqual(['ARTICLE', 'OUVRAGE']);
    expect(elementVendu(null)).toBe(false);
  });
});
