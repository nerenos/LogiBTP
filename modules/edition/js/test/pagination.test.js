import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { polices } from './aide.js';
import { editer, assembler, produirePdf, mettreEnLignes } from '../src/index.js';

let p;
beforeAll(async () => { p = await polices(); });
const textes = (page) => page.elements.filter((e) => e.t === 'texte').map((e) => e.texte);
const lignes = (n, groupes) => Array.from({ length: n }, (_, i) => ({ lib: `Ligne ${i}`, mt: '1', g: `G${Math.floor((i * groupes) / n)}` }));

describe('pagination complète', () => {
  it('entête de groupe répétée « (suite) » tant que le groupe continue', () => {
    const m = { bandes: [{ mode: 'GROUPE', collection: 'lignes', rupture: 'element.g', options: { entete_chaque_page: true },
      entete: { type: 'champ', valeur: '=groupe.valeur & Si(groupe.suite; " (suite)"; "")' },
      contenu: { type: 'champ', valeur: '{{element.lib}}' } }] };
    const r = editer(m, { lignes: lignes(200, 2) }, { polices: p });
    expect(r.pages.length).toBeGreaterThan(2);
    const suites = r.pages.slice(1).map((pg) => textes(pg)[0]);
    expect(suites.every((t) => /^G\d \(suite\)$/.test(t) || /^G\d$/.test(t))).toBe(true);
    expect(suites).toContain('G0 (suite)');
  });
  it('veuves et orphelines : jamais une seule ligne isolée d’un texte coupé', () => {
    const r = mettreEnLignes([{ texte: 'mot '.repeat(200), style: {} }], 60, p);
    const b = r.lignes;
    expect(b.length).toBeGreaterThan(6);
    const m = { bandes: [
      { contenu: { type: 'espace', hauteur: 262 } },
      { contenu: { type: 'champ', valeur: 'mot '.repeat(400) } }] };
    const ed = editer(m, {}, { polices: p });
    const premiere = ed.pages[0].elements.filter((e) => e.t === 'texte');
    expect(premiere.length === 0 || premiere.length >= 2).toBe(true);
  });
  it('pages paires / impaires, miroir, nombre pair', () => {
    const m = { page: { miroir: true, nombre_pair: true, marges: { gauche: 25, droite: 10 } }, bandes: [
      { type: 'ENTETE_PAGE', pages: 'PAIRES', contenu: { type: 'champ', valeur: 'pair' } },
      { type: 'ENTETE_PAGE', pages: 'IMPAIRES', contenu: { type: 'champ', valeur: 'impair' } },
      { contenu: { type: 'champ', valeur: 'a' } }, { contenu: { type: 'saut_page' } }, { contenu: { type: 'champ', valeur: 'b' } },
      { contenu: { type: 'saut_page' } }, { contenu: { type: 'champ', valeur: 'c' } }] };
    const r = editer(m, {}, { polices: p });
    expect(r.pages).toHaveLength(4);
    expect(r.pages[3].blanche).toBe(true);
    expect(textes(r.pages[0])).toContain('impair');
    expect(textes(r.pages[1])).toContain('pair');
    const x = (pg) => Math.min(...pg.elements.filter((e) => e.t === 'texte').map((e) => e.x));
    expect(x(r.pages[0])).toBeCloseTo(25, 5);
    expect(x(r.pages[1])).toBeCloseTo(10, 5);
  });
  it('bande répétée sur chaque page et pied propre à la dernière', () => {
    const m = { bandes: [
      { type: 'PIED_PAGE', pages: 'DERNIERE', contenu: { type: 'champ', valeur: 'FIN' } },
      { options: { chaque_page: true }, contenu: { type: 'champ', valeur: 'Titre répété' } },
      { mode: 'REPETE', collection: 'lignes', contenu: { type: 'champ', valeur: '{{element.lib}}' } }] };
    const r = editer(m, { lignes: lignes(150, 1) }, { polices: p });
    for (const pg of r.pages) expect(textes(pg)).toContain('Titre répété');
    expect(textes(r.pages.at(-1))).toContain('FIN');
    expect(textes(r.pages[0])).not.toContain('FIN');
  });
  it('lot d’impression et annexes PDF', async () => {
    const un = editer({ bandes: [{ contenu: { type: 'champ', valeur: 'Pièce 1' } }] }, {}, { polices: p });
    const deux = editer({ bandes: [{ contenu: { type: 'champ', valeur: 'Pièce 2' } }] }, {}, { polices: p });
    const lot = assembler([un, deux]);
    expect(lot.pages.map((x) => x.rang)).toEqual([1, 2]);
    const annexe = await produirePdf(un, p, {});
    const pdf = await produirePdf(lot, p, { annexes: [annexe] });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);
  });
});

describe('blocs liés et sous-rapports', () => {
  it('bloc lié : paramètres lus par bloc.<nom>, valeur par défaut', () => {
    const blocs = { PIED: { parametres: [{ nom: 'titre', defaut: 'Défaut' }], contenu: { type: 'champ', valeur: '{{bloc.titre}} – {{societe}}' } } };
    const m = { bandes: [{ contenu: { type: 'pile', enfants: [{ type: 'bloc', bloc: 'PIED', parametres: { titre: 'Facture' } }, { type: 'bloc', bloc: 'PIED' }, { type: 'bloc', bloc: 'ABSENT' }] } }] };
    const r = editer(m, { societe: 'BTP' }, { polices: p, blocs });
    expect(textes(r.pages[0])).toEqual(['Facture – BTP', 'Défaut – BTP']);
    expect(r.alertes.map((a) => a.code)).toContain('BLOC_INTROUVABLE');
  });
  it('sous-rapport sur une source annexe, au plus trois niveaux', () => {
    const rapports = {
      SR: { bandes: [{ contenu: { type: 'tableau', collection: 'elements', colonnes: [{ cle: 'n', titre: 'N°', valeur: '{{element.numero}}' }] } }] },
      BOUCLE: { bandes: [{ contenu: { type: 'sous_rapport', rapport: 'BOUCLE' } }] },
    };
    const m = { bandes: [{ contenu: { type: 'sous_rapport', rapport: 'SR', donnees: 'sources.documents' } }, { contenu: { type: 'sous_rapport', rapport: 'BOUCLE' } }] };
    const r = editer(m, { sources: { documents: [{ numero: 'CC1' }, { numero: 'CC2' }] } }, { polices: p, rapports });
    expect(textes(r.pages[0])).toEqual(expect.arrayContaining(['N°', 'CC1', 'CC2']));
    expect(r.alertes.map((a) => a.code)).toContain('SOUS_RAPPORT_NIVEAU');
  });
});
