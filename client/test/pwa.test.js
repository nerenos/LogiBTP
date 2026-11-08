import { describe, it, expect } from 'vitest';
import { traitement, empreinte, cleDonnee, reponseAGarder, reponseEnPanne, erreurHorsLigne, TAILLE_MAX_DONNEE, BUDGET_PLANS, estPlanTerrain, plansARetirer } from '../src/pwa/regles.js';

// Service worker (application installable, mode hors ligne) : traitement des requêtes et mise en cache des lectures.
describe('règles du service worker', () => {
  const origine = 'https://acme.logibtp.fr';
  const t = (methode, chemin, navigation = false) => traitement({ methode, url: `${origine}${chemin}`, origine, navigation });

  it("classe les requêtes de l'API", () => {
    expect(t('GET', '/api/sante')).toBe('reseau');
    expect(t('GET', '/api/diffusion?sujets=planning')).toBe('reseau');
    expect(t('GET', '/api/ged/versions/12/contenu')).toBe('reseau');
    expect(t('POST', '/api/editions/pdf')).toBe('reseau');
    expect(t('GET', '/api/documents/5')).toBe('donnee');
    // Définition d'une fiche : options des listes par requête SQL résolues par le serveur, gardées pour le hors ligne.
    expect(t('GET', '/api/fiches/salarie/definition')).toBe('donnee');
    expect(t('POST', '/api/listes/lot')).toBe('donnee');
    expect(t('POST', '/api/structure/documents')).toBe('donnee');
    expect(t('PUT', '/api/documents/5')).toBe('ecriture');
    expect(t('POST', '/api/listes/modifier')).toBe('ecriture');
    expect(t('DELETE', '/api/fiches/salarie/3')).toBe('ecriture');
  });

  it("classe les pages, les fichiers de l'application et les autres origines", () => {
    expect(t('GET', '/document/5', true)).toBe('page');
    expect(t('GET', '/assets/index-abc.js')).toBe('fichier');
    expect(t('GET', '/personnalisation/fr.json')).toBe('personnalisation');
    expect(t('GET', '/personnalisation/images/logo.svg?v=abc')).toBe('personnalisation');
    expect(t('POST', '/connexion')).toBe('reseau');
    expect(traitement({ methode: 'GET', url: 'https://recherche-entreprises.api.gouv.fr/search?q=x', origine })).toBe('reseau');
  });

  it('donne une clé stable aux lectures en POST', () => {
    expect(empreinte('')).toBe('811c9dc5');
    expect(empreinte('{"a":1}')).toBe(empreinte('{"a":1}'));
    expect(empreinte('{"a":1}')).not.toBe(empreinte('{"a":2}'));
    expect(cleDonnee(`${origine}/api/documents/5`, 'GET')).toBe(`${origine}/api/documents/5`);
    expect(cleDonnee(`${origine}/api/listes/lot`, 'POST', '{"a":1}')).toBe(`${origine}/api/listes/lot?__corps=${empreinte('{"a":1}')}`);
  });

  it('ne garde que les réponses JSON réussies de taille raisonnable', () => {
    expect(reponseAGarder({ statut: 200, typeContenu: 'application/json; charset=utf-8', taille: null })).toBe(true);
    expect(reponseAGarder({ statut: 200, typeContenu: 'application/pdf', taille: '10' })).toBe(false);
    expect(reponseAGarder({ statut: 401, typeContenu: 'application/problem+json', taille: '10' })).toBe(false);
    expect(reponseAGarder({ statut: 200, typeContenu: 'application/json', taille: String(TAILLE_MAX_DONNEE + 1) })).toBe(false);
    // Pièces de l'application de terrain : gardées quel que soit leur type, jusqu'à 25 Mo.
    expect(reponseAGarder({ statut: 200, typeContenu: 'application/pdf', taille: '1000000', url: 'https://a.fr/api/terrain/pieces/7' })).toBe(true);
    expect(reponseAGarder({ statut: 200, typeContenu: 'image/jpeg', taille: String(26 * 1024 * 1024), url: 'https://a.fr/api/terrain/pieces/7' })).toBe(false);
  });

  it('traite un relais sans API comme une panne et répond HORS_LIGNE', () => {
    expect([502, 503, 504].every(reponseEnPanne)).toBe(true);
    expect(reponseEnPanne(500, '')).toBe(true);
    expect(reponseEnPanne(500, 'application/problem+json')).toBe(false);
    expect(erreurHorsLigne(true)).toMatchObject({ status: 503, code: 'HORS_LIGNE' });
    expect(erreurHorsLigne(false).title).toMatch(/non consultée/);
  });
});

describe('plans du terrain gardés hors ligne (plan terrain-suites, lot 4)', () => {
  const Mo = 1024 * 1024;

  it('reconnus et gardés quel que soit leur type, jusqu’au budget', () => {
    expect(estPlanTerrain('https://a.fr/api/terrain/plans/12')).toBe(true);
    expect(estPlanTerrain('https://a.fr/api/terrain/pieces/12')).toBe(false);
    expect(reponseAGarder({ statut: 200, typeContenu: 'application/pdf', taille: String(10 * Mo), url: 'https://a.fr/api/terrain/plans/12' })).toBe(true);
    expect(reponseAGarder({ statut: 200, typeContenu: 'application/pdf', taille: String(BUDGET_PLANS + 1), url: 'https://a.fr/api/terrain/plans/12' })).toBe(false);
    expect(BUDGET_PLANS).toBe(25 * Mo);
  });

  it('budget atteint : plans les plus anciens retirés, pièces « Terrain » hors du compte', () => {
    const gardes = [{ cle: 'p1', taille: 10 * Mo }, { cle: 'p2', taille: 10 * Mo }, { cle: 'p3', taille: 4 * Mo }];
    expect(plansARetirer(gardes, 'p4', 1 * Mo)).toEqual([]);
    expect(plansARetirer(gardes, 'p4', 6 * Mo)).toEqual(['p1']);
    expect(plansARetirer(gardes, 'p4', 15 * Mo)).toEqual(['p1', 'p2']);
    // Plan déjà gardé remplacé : sa taille précédente ne compte pas.
    expect(plansARetirer(gardes, 'p1', 11 * Mo)).toEqual([]);
    // Plus grand que le budget : non gardé, rien n'est retiré.
    expect(plansARetirer(gardes, 'p4', 26 * Mo)).toBeNull();
    // Les pièces suivent leur propre règle (25 Mo par pièce), indépendante du budget des plans.
    expect(reponseAGarder({ statut: 200, typeContenu: 'application/pdf', taille: String(20 * Mo), url: 'https://a.fr/api/terrain/pieces/7' })).toBe(true);
  });
});
