import { describe, it, expect } from 'vitest';
import { creerApiSimulee } from '../../modules/facture-electronique/js/demo/api-simulee.js';
import {
  ongletChronologieVisible, requeteFluxPiece, chronologieDocumentHtml, historiqueDocumentHtml, libelleElementFe, boutonsStatuts, statutsFactureHtml,
  factureRecue, requeteFacturesRecues, GROUPE_RACCOURCIS_STATUTS_FE,
} from '../src/app/documents/chronologie-document.js';
import { actionDe } from '@logibtp/socle/ui';
import { nomFichier } from '../src/app/facture-electronique/api-fe.js';
import { menus } from '../src/app/navigation/menus.js';
import { ONGLETS_DOCUMENT } from '../src/app/raccourcis.js';
import { MODULE_FACULTATIF, TYPE_ELEMENT_FE } from '../src/app/codes.js';

// Facturation électronique, lot 11 du cœur : onglet Chronologie d'une pièce liée à un flux de la plateforme simulée
// (même comportement que PlateformeSimulee : accusé Ok, statuts 200 → 205), menu et page du module.
const PIECE = '4242';

async function pieceEmise() {
  const api = creerApiSimulee();
  await api.emettre('FA-2026-4242', PIECE);
  await api.emettre('FA-2026-0001');
  for (let i = 0; i < 4; i++) await api.relever();
  return api;
}

describe('onglet Chronologie de la page document', () => {
  it('visible sur une pièce liée à un flux de la plateforme simulée, avec ses étapes et l\'historique du document', async () => {
    const api = await pieceEmise();
    const flux = await api.flux(requeteFluxPiece(PIECE));
    expect(flux.map((f) => f.numero)).toEqual(['FA-2026-4242']);
    expect(ongletChronologieVisible({ moduleActif: true, peutConsulter: true, entId: Number(PIECE), flux })).toBe(true);

    const evenements = await api.chronologieElement(TYPE_ELEMENT_FE.DOCUMENT, PIECE);
    expect(evenements.length).toBeGreaterThan(3);
    expect(evenements.every((e) => e.id_element === PIECE)).toBe(true);
    const historique = [
      { his_id: 1, his_version: 1, his_action: 'CREATION', his_date: '2026-11-09T08:00:00Z', his_utilisateur: 'dupont' },
      { his_id: 2, his_version: 2, his_action: 'VALIDATION', his_date: '2026-11-10T09:00:00Z', his_utilisateur: 'dupont' },
    ];
    const html = chronologieDocumentHtml(evenements, historique);
    expect(html).toContain('data-chronologie-fe');
    expect(html).toContain('data-historique-document');
    expect((html.match(/class="fe-etape /g) ?? []).length).toBe(evenements.length);
    expect(html).toContain(libelleElementFe(TYPE_ELEMENT_FE.DOCUMENT, PIECE));
    expect(html).toContain(`data-ouvrir-flux="${flux[0].id}"`);
    expect(html.indexOf('data-version="2"')).toBeLessThan(html.indexOf('data-version="1"'));
  });

  it('masqué sans flux, sans droit, module désactivé ou pièce non enregistrée', async () => {
    const api = await pieceEmise();
    const sans = await api.flux(requeteFluxPiece('999'));
    expect(sans).toEqual([]);
    const flux = await api.flux(requeteFluxPiece(PIECE));
    expect(ongletChronologieVisible({ moduleActif: true, peutConsulter: true, entId: 999, flux: sans })).toBe(false);
    expect(ongletChronologieVisible({ moduleActif: true, peutConsulter: false, entId: Number(PIECE), flux })).toBe(false);
    expect(ongletChronologieVisible({ moduleActif: false, peutConsulter: true, entId: Number(PIECE), flux })).toBe(false);
    expect(ongletChronologieVisible({ moduleActif: true, peutConsulter: true, entId: -1, flux })).toBe(false);
    expect(historiqueDocumentHtml([])).toContain('aide');
  });

  it('raccourci de l\'onglet et requête des flux de la pièce', () => {
    expect(ONGLETS_DOCUMENT.ongletChronologie).toBe('chronologie');
    expect(Object.fromEntries(new URLSearchParams(requeteFluxPiece(12)))).toEqual({ type_element: 'DOCUMENT', id_element: '12', limite: '1' });
  });
});

describe('statuts posés sur une facture reçue (lot 13)', () => {
  const detail = (codes, affiche = codes.at(-1) ?? null) => ({ flux: { id: 5, sens: 'In', numero: 'F-1', statut_affiche: affiche }, statuts: codes.map((code) => ({ code })) });
  it('boutons En litige et Refuser selon le cycle de vie et le droit', () => {
    expect(boutonsStatuts(detail(['204']), true)).toEqual(['207', '210']);
    expect(boutonsStatuts(detail(['204', '207']), true)).toEqual(['207', '210']);
    expect(boutonsStatuts(detail(['204', '205']), true)).toEqual(['207']);
    expect(boutonsStatuts(detail(['204', '207', '210']), true)).toEqual([]);
    expect(boutonsStatuts(detail(['204']), false)).toEqual([]);
    const html = statutsFactureHtml(detail(['204', '205']), true);
    expect(html).toContain('data-poser-statut="207"');
    expect(html).not.toContain('data-poser-statut="210"');
    expect(statutsFactureHtml(null, true)).toBe('');
  });
  it('facture reçue de la pièce (CDAR exclus), requête et raccourcis', () => {
    const flux = [{ id: 9, sens: 'Out', type: 'SupplierInvoiceLC', numero: 'F-1' }, { id: 7, sens: 'In', type: 'SupplierInvoice', numero: 'F-1' }];
    expect(factureRecue(flux)?.id).toBe(7);
    expect(factureRecue([])).toBeNull();
    expect(Object.fromEntries(new URLSearchParams(requeteFacturesRecues(12)))).toMatchObject({ type_element: 'DOCUMENT', id_element: '12', sens: 'In' });
    const touche = (key, o = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
    expect(actionDe(touche('L', { altKey: true, shiftKey: true }), GROUPE_RACCOURCIS_STATUTS_FE)).toBe('207');
    expect(actionDe(touche('X', { altKey: true, shiftKey: true }), GROUPE_RACCOURCIS_STATUTS_FE)).toBe('210');
  });
});

describe('page et menu de la facturation électronique', () => {
  const app = (inactifs = [], acces = () => true) => ({ moduleActif: (c) => !inactifs.includes(c), acces, peutGererThemes: () => false, estAdmin: () => false, preferences: { get: () => 'auto' }, fenetres: { liste: () => [] } });
  const ventes = (a) => menus(a).find((m) => m.code === 'ventes').elements().map((e) => e.code);
  it('menu selon le module et le droit', () => {
    expect(ventes(app())).toContain('facture-electronique');
    expect(ventes(app([MODULE_FACULTATIF.FACTURE_ELECTRONIQUE]))).not.toContain('facture-electronique');
    expect(ventes(app([], (n) => n !== 'facture_electronique'))).not.toContain('facture-electronique');
  });
  it('nom du fichier téléchargé', () => {
    expect(nomFichier('attachment; filename=FA-1.xml; filename*=UTF-8\'\'FA%201.xml')).toBe('FA 1.xml');
    expect(nomFichier('attachment; filename="FA-1.pdf"')).toBe('FA-1.pdf');
    expect(nomFichier(null)).toBeNull();
  });
});
