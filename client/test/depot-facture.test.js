import { describe, it, expect } from 'vitest';
import {
  TYPES_DEPOT_FACTURE, SOURCE_FE_RECUES, CLASSE_CIBLE, peutDeposerFacture, glisseFacture, fichiersFacture, resultatDepot, importerFacturesRecues,
  activerDepotFactures,
} from '../src/app/facture-electronique/depot-facture.js';
import { proposerFacture } from '../src/app/pages/mail.js';
import { SOURCES_LISTE } from '../src/app/vues-liste.js';
import { MODULE_FACULTATIF, TYPE_DOCUMENT, TYPE_ELEMENT_FE } from '../src/app/codes.js';

// Facturation électronique, lot 14 du cœur : réception hors plateforme (Factur-X ou XML glissé sur la liste des factures
// reçues ou sur une facture d'achat, pièce jointe d'un courriel reçu) par la même route que l'import, marquée hors plateforme.

const app = ({ module = true, droit = true } = {}) => {
  const a = { messages: [], erreurs: [], urls: [] };
  return Object.assign(a, {
    moduleActif: (code) => (code === MODULE_FACULTATIF.FACTURE_ELECTRONIQUE ? module : true),
    peut: (noeud, action) => droit && noeud === 'facture_electronique' && action === 'MODIFIER',
    message: (t, n) => a.messages.push([t, n]),
    erreur: (e) => a.erreurs.push(e),
    naviguer: (url) => a.urls.push(url),
  });
};
const fichier = (name, type, contenu = '<x/>') => ({ name, type, arrayBuffer: async () => new TextEncoder().encode(contenu).buffer });
const transfert = (fichiers, types = ['Files']) => ({ types, files: fichiers, items: fichiers.map((f) => ({ kind: 'file', type: f.type })) });

describe('réception hors plateforme : dépôt d’une facture', () => {
  it('pièces de la page qui acceptent une facture glissée, source de la liste à traiter', () => {
    expect(TYPES_DEPOT_FACTURE).toEqual([TYPE_DOCUMENT.A_FACTURE, TYPE_DOCUMENT.A_FACTURE_AVT, TYPE_DOCUMENT.A_AVOIR, TYPE_DOCUMENT.T_FACTURE_AVT]);
    expect(SOURCES_LISTE[SOURCE_FE_RECUES]).toBeTruthy();
  });

  it('module actif et droit Modifier exigés', () => {
    expect(peutDeposerFacture(app())).toBe(true);
    expect(peutDeposerFacture(app({ module: false }))).toBe(false);
    expect(peutDeposerFacture(app({ droit: false }))).toBe(false);
  });

  it('glissé de fichiers : facture possible, autres glissés laissés', () => {
    expect(glisseFacture(transfert([fichier('f.pdf', 'application/pdf')]))).toBe(true);
    expect(glisseFacture(transfert([fichier('f.xml', '')]))).toBe(true);
    expect(glisseFacture(transfert([fichier('photo.jpg', 'image/jpeg')]))).toBe(false);
    expect(glisseFacture({ types: ['application/x-logibtp-article'], files: [], items: [] })).toBe(false);
    expect(fichiersFacture([fichier('a.pdf', 'application/pdf'), fichier('b.jpg', 'image/jpeg'), fichier('c.XML', '')]).map((f) => f.name)).toEqual(['a.pdf', 'c.XML']);
  });

  it('résultat : pièce créée ouverte, sinon facture à traiter avec son erreur', () => {
    expect(resultatDepot({ id: 5, type_element: TYPE_ELEMENT_FE.DOCUMENT, id_element: '42', numero: 'F1' }, 'f.pdf'))
      .toMatchObject({ piece: 42, flux: 5, niveau: 'succes' });
    expect(resultatDepot({ id: 6, type_element: null, id_element: null, numero: 'F1', derniere_erreur: 'FACTURE_EN_DOUBLE' }, 'f.pdf'))
      .toMatchObject({ piece: null, flux: 6, niveau: 'avertissement', valeurs: { erreur: 'FACTURE_EN_DOUBLE' } });
  });

  it('import hors plateforme : contenu en base 64, pièce ouverte', async () => {
    const a = app();
    const corps = [];
    const r = await importerFacturesRecues(a, [fichier('f.xml', 'text/xml', 'abc')], {
      importer: async (c) => { corps.push(c); return { id: 9, type_element: TYPE_ELEMENT_FE.DOCUMENT, id_element: '77', numero: 'F9' }; },
    });
    expect(corps).toEqual([{ nom: 'f.xml', contenu: btoa('abc'), hors_plateforme: true }]);
    expect(r[0].piece).toBe(77);
    expect(a.urls).toEqual(['/document/77']);
    expect(a.messages[0][1]).toBe('succes');
  });

  it('zone de dépôt : accepte une facture, laisse un dépôt déjà pris ou refusé', async () => {
    const ecouteurs = {};
    const classes = new Set();
    const zone = { addEventListener: (t, f) => { ecouteurs[t] = f; }, removeEventListener: (t) => { delete ecouteurs[t]; }, contains: () => false,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    let accepte = true;
    const retirer = activerDepotFactures(zone, { app: app(), accepte: () => accepte, ouvrir: false });
    const evt = (dt, pris = false) => ({ dataTransfer: dt, defaultPrevented: pris, empeche: false, preventDefault() { this.empeche = true; } });
    const survol = evt(transfert([fichier('f.pdf', 'application/pdf')]));
    ecouteurs.dragover(survol);
    expect([survol.empeche, classes.has(CLASSE_CIBLE)]).toEqual([true, true]);
    const pris = evt(transfert([fichier('f.pdf', 'application/pdf')]), true);
    ecouteurs.dragover(pris);
    expect(pris.empeche).toBe(false);
    accepte = false;
    const ailleurs = evt(transfert([fichier('f.pdf', 'application/pdf')]));
    await ecouteurs.drop(ailleurs);
    expect([ailleurs.empeche, classes.has(CLASSE_CIBLE)]).toEqual([false, false]);
    retirer();
    expect(Object.keys(ecouteurs)).toEqual([]);
  });

  it('« Créer la facture » proposé sur une pièce jointe Factur-X ou XML d’un courriel reçu', () => {
    expect(proposerFacture({ sens: 'R' }, { nom: 'F1.pdf', type: 'application/pdf' }, app())).toBe(true);
    expect(proposerFacture({ sens: 'E' }, { nom: 'F1.pdf', type: 'application/pdf' }, app())).toBe(false);
    expect(proposerFacture({ sens: 'R' }, { nom: 'photo.jpg', type: 'image/jpeg' }, app())).toBe(false);
    expect(proposerFacture({ sens: 'R' }, { nom: 'F1.xml', type: null }, app({ droit: false }))).toBe(false);
  });
});
