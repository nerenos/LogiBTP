import { describe, it, expect } from 'vitest';
import { importerCarburant, resumeCarburant } from '../src/app/import/carburant-import.js';
import { rapportCarburant } from '../src/app/import/rapport-import.js';
import { formatImport } from '../src/app/import/formats.js';

const FICHIER = [
  'Date;Carte;Immatriculation;Litres;Montant;Km',
  '08/11/2026;70012345;;40,5;72,90;12000',
  '08/11/2026;;BB-456-BB;30;54;',
  '08/11/2026;9999;ZZ-000-ZZ;20;36;',
  '08/11/2026;70012345;;40,5;72,90;12000',
  '31/02/2026;70012345;;10;18;',
].join('\n');

// Serveur simulé : rapprochement par carte puis immatriculation, doublon ignoré (même carte, jour, litres, montant).
function serveur(pleins) {
  const vus = new Set();
  const rep = { ecrits: 0, doublons: [], non_rapproches: [], erreurs: [] };
  for (const p of pleins) {
    if (p.carte !== '70012345' && p.immatriculation !== 'BB-456-BB') { rep.non_rapproches.push(p.rang); continue; }
    const cle = [p.carte, p.immatriculation, p.date, p.litres, p.montant].join('|');
    if (vus.has(cle)) { rep.doublons.push(p.rang); continue; }
    vus.add(cle);
    rep.ecrits++;
  }
  return rep;
}

describe('import des cartes carburant', () => {
  it('pleins rapprochés par carte ou immatriculation, non rapproché et doublon signalés, ligne mal formée en erreur', async () => {
    let envoyes = null;
    const r = await importerCarburant(FICHIER, undefined, async (pleins) => { envoyes = pleins; return serveur(pleins); });
    expect(envoyes).toHaveLength(4);
    expect(envoyes[0]).toMatchObject({ date: '2026-11-08', carte: '70012345', litres: '40.5', montant: '72.90', kilometrage: '12000' });
    expect(r).toMatchObject({ lus: 4, ecrits: 2, doublons: [4], non_rapproches: [3] });
    expect(r.erreurs).toHaveLength(1);
    expect(r.erreurs[0].rang).toBe(5);
    expect(resumeCarburant(r)).toContain('2');
  });
  it('fichier sans plein lisible : rien envoyé', async () => {
    let appels = 0;
    const r = await importerCarburant('Date;Carte;Litres\n', undefined, async () => { appels++; return {}; });
    expect(appels).toBe(0);
    expect(r.ecrits).toBe(0);
  });
  it('rapport : pleins écrits, doublons, cartes non rapprochées et lignes en erreur', async () => {
    const r = await importerCarburant(FICHIER, undefined, async (pleins) => serveur(pleins));
    const html = rapportCarburant(r);
    expect(html).toContain('<td class="nombre">2</td>');
    expect(html).toContain('<p>4</p>');
    expect(html).toContain('<p>3</p>');
    expect(html).toContain('<li>');
  });
  it('format enregistré avec sa page, sans document créé', () => {
    expect(formatImport('CartesCarburant')).toMatchObject({ page: '/import/carburant', type: null });
  });
});
