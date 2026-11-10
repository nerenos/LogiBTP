import { it, expect } from 'vitest';

it('les écrans se chargent et déclarent leurs raccourcis', async () => {
  const ui = await import('../ui/index.js');
  expect(Object.keys(ui)).toEqual(expect.arrayContaining(['ParametresFe', 'TableauFlux', 'DetailFlux', 'Chronologie', 'PanneauDepotManuel', 'creerApiFe', 'chronologieHtml']));
  const { actionDe, catalogueRaccourcis } = await import('@logibtp/socle/ui');
  const touche = (key, o = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  expect(actionDe(touche('s', { ctrlKey: true }), ui.GROUPE_RACCOURCIS_PARAMETRES)).toBe('enregistrer');
  expect(actionDe(touche('T', { altKey: true, shiftKey: true }), ui.GROUPE_RACCOURCIS_DETAIL)).toBe('tentative');
  const groupes = catalogueRaccourcis().map((g) => g.groupe);
  expect(groupes).toEqual(expect.arrayContaining([ui.GROUPE_RACCOURCIS_TABLEAU, ui.GROUPE_RACCOURCIS_CHRONOLOGIE, ui.GROUPE_RACCOURCIS_DEPOT, ui.GROUPE_RACCOURCIS_DETAIL]));
});

it('les appels suivent les routes du module', async () => {
  const { creerApiFe } = await import('../ui/index.js');
  const appels = [];
  const api = creerApiFe({ json: async (m, c, b) => { appels.push([m, c, b]); return null; }, fichier: async (c) => { appels.push(['FICHIER', c]); return null; } });
  await api.flux('sens=Out&limite=50');
  await api.detail(7);
  await api.fichier(7, 'Converted');
  await api.chronologieElement('DOCUMENT', 'F 1');
  await api.confirmerDepot(7, { etat: 'Ok' });
  await api.importer({ nom: 'a.xml', contenu: 'PA==' });
  await api.sante();
  expect(appels).toEqual([
    ['GET', '/facture-electronique/flux?sens=Out&limite=50', undefined],
    ['GET', '/facture-electronique/flux/7', undefined],
    ['FICHIER', '/facture-electronique/flux/7/fichier?document=Converted'],
    ['GET', '/facture-electronique/chronologie?type_element=DOCUMENT&id_element=F%201', undefined],
    ['POST', '/facture-electronique/flux/7/depot-manuel', { etat: 'Ok' }],
    ['POST', '/facture-electronique/import', { nom: 'a.xml', contenu: 'PA==' }],
    ['GET', '/facture-electronique/sante', undefined],
  ]);
});
