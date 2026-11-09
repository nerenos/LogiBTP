import { describe, it, expect } from 'vitest';

const { filtrerArticles, unitesArticle, ligneDemande } = await import('../src/app/terrain/bibliotheque-terrain.js');
const { articlesAPrecharger } = await import('../src/app/terrain/operations-terrain.js');

// Articles du chantier tels que gardés sur l'appareil (fiche réduite de GET /api/terrain/bibliotheque/chantiers/{id}).
const ARTICLES = [
  { id: 1, code: 'COL-C2', libelle: 'Colle carrelage C2 grise', unite: 'kg', unite_achat: 'sac', conditionnements: [{ unite: 'sac', formule: '25' }, { unite: 'pal', formule: '1200' }] },
  { id: 2, code: 'BANDE', libelle: 'Bande à joint', unite: 'ml', unite_achat: null, conditionnements: [{ unite: 'rl', formule: '150' }] },
  { id: 3, code: 'PLAQ-BA13', libelle: 'Plaque de plâtre BA13 hydrofuge', unite: 'm2', unite_achat: 'u', conditionnements: [] },
];

describe('bibliothèque simplifiée du terrain (terrain-suites lot 18)', () => {
  it('choix d\'un article sans réseau : filtre des articles du chantier, mot à mot, sans accent ni casse', () => {
    expect(filtrerArticles(ARTICLES, 'platre ba13').map((a) => a.id)).toEqual([3]);
    expect(filtrerArticles(ARTICLES, 'COLLE  grise').map((a) => a.id)).toEqual([1]);
    expect(filtrerArticles(ARTICLES, 'joint carrelage')).toEqual([]);
    expect(filtrerArticles(ARTICLES, '  ')).toHaveLength(3);
    expect(filtrerArticles(null, 'x')).toEqual([]);
  });

  it('ligne de demande : unité de l\'article (achat par défaut), quantité positive', () => {
    expect(unitesArticle(ARTICLES[0])).toEqual(['sac', 'kg', 'pal']);
    expect(unitesArticle(ARTICLES[1])).toEqual(['ml', 'rl']);
    expect(ligneDemande(ARTICLES[0], '2,5', 'pal')).toEqual({ ele: 1, quantite: 2.5, unite: 'pal' });
    expect(ligneDemande(ARTICLES[0], '', 'litre')).toEqual({ ele: 1, quantite: 1, unite: 'sac' });
    expect(ligneDemande(ARTICLES[1], -3, null)).toEqual({ ele: 2, quantite: 1, unite: 'ml' });
  });

  it('articles des chantiers des tâches lues gardés hors ligne, sans doublon', () => {
    const lectures = [{ taches: [{ chantier: { id: 4 } }, { chantier: null }, { chantier: { id: 4 } }] }, { taches: [{ chantier: { id: 9 } }] }];
    expect(articlesAPrecharger(lectures)).toEqual(['/api/terrain/bibliotheque/chantiers/4', '/api/terrain/bibliotheque/chantiers/9']);
  });
});
