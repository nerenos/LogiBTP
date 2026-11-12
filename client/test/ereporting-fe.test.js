import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existe, texte } from '@logibtp/socle/dictionnaire';
import { REGIME_EREPORTING, SOUS_FLUX_EREPORTING, TYPE_TRANSMISSION } from '@logibtp/facture-electronique';
import { NATURE_PERIODE_EREPORTING, ETAT_PERIODE_EREPORTING, TYPE_ELEMENT_FE } from '../src/app/codes.js';
import {
  actionsPeriode, cleSousFlux, detailPeriodeHtml, libellePeriode, periodesEreportingHtml, resumeEreportingTexte,
} from '../src/app/facture-electronique/ereporting-fe.js';
import { libelleElementFe } from '../src/app/documents/chronologie-document.js';

// Onglet « E-reporting » de la page Facturation électronique (lot 28) : le serveur calcule (Btp/EreportingBtp.cs),
// l'écran affiche ; tout code (nature, état, régime, sous-flux, type) prend son libellé et son icône.
const icones = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../personnalisation/images/icones.json'), 'utf8'));
const T = 'facture_electronique_btp.ereporting';

const periode = (etat, autres = {}) => ({
  id: 7, nature: NATURE_PERIODE_EREPORTING.TRANSACTIONS, debut: '2026-09-01', fin: '2026-09-30', correction: 0, essai: 1, etat,
  resume: { ventes_b2c: 2, factures_internationales: 1, total_ht: 750, total_tva: 120, ignorees: [] }, ecarts: [],
  envoyable: false, corrigeable: false, relancable: false,
  envois: [{ id: 1, sous_flux: '10.3', jour: null, identifiant: '842517310-20260901-103-001', type: 'IN', elements: 2, flux_id: 12, etat_flux: 'ACQUITTE' }],
  ...autres,
});

describe('e-reporting : libellés et icônes', () => {
  it('chaque code a son libellé', () => {
    for (const n of Object.values(NATURE_PERIODE_EREPORTING)) expect(existe(`${T}.natures.${n}`), n).toBe(true);
    for (const e of Object.values(ETAT_PERIODE_EREPORTING)) {
      expect(existe(`${T}.etats.${e}`), e).toBe(true);
      expect(icones[`facture_electronique_btp_ereporting_${e.toLowerCase()}`], e).toBeTruthy();
    }
    for (const r of Object.values(REGIME_EREPORTING)) expect(existe(`${T}.regimes.${r}`), r).toBe(true);
    for (const s of Object.values(SOUS_FLUX_EREPORTING)) expect(existe(`${T}.sous_flux.${cleSousFlux(s)}`), s).toBe(true);
    for (const t of Object.values(TYPE_TRANSMISSION)) expect(existe(`${T}.types.${t}`), t).toBe(true);
    for (const a of ['preparer', 'envoyer', 'corriger', 'relancer']) {
      expect(existe(`${T}.actions.${a}`) && existe(`${T}.actions.${a}_aide`), a).toBe(true);
      expect(icones[`facture_electronique_btp_ereporting_${a}`], a).toBeTruthy();
    }
    for (const a of ['envoyer', 'corriger', 'relancer']) expect(existe(`${T}.actions.confirmer_${a}`) && existe(`${T}.resultats.${a}`), a).toBe(true);
    expect(existe('facture_electronique_btp.onglets.ereporting') && existe('facture_electronique_btp.onglets.ereporting_titre')).toBe(true);
    expect(icones.facture_electronique_btp_ereporting).toBeTruthy();
    expect(libelleElementFe(TYPE_ELEMENT_FE.PERIODE_EREPORTING, '7')).toBe(texte('facture_electronique_btp.element_ereporting', { id: '7' }));
  });
});

describe('e-reporting : liste et détail des périodes', () => {
  it('libellé, résumé et actions selon le serveur et le droit', () => {
    const p = periode(ETAT_PERIODE_EREPORTING.PREPAREE, { envoyable: true });
    expect(libellePeriode(p)).toContain('01/09/2026');
    expect(resumeEreportingTexte(p)).toContain('750');
    expect(resumeEreportingTexte({ ...p, nature: NATURE_PERIODE_EREPORTING.PAIEMENTS, resume: { encaissements_b2c: 1, encaissements_internationaux: 1, total_encaisse: 390 } })).toContain('390');
    expect(actionsPeriode(p, true)).toEqual(['envoyer']);
    expect(actionsPeriode(p, false)).toEqual([]);
    expect(actionsPeriode(periode(ETAT_PERIODE_EREPORTING.ACCEPTEE, { corrigeable: true }), true)).toEqual(['corriger']);
    expect(actionsPeriode(periode(ETAT_PERIODE_EREPORTING.REJETEE, { relancable: true }), true)).toEqual(['relancer']);
  });

  it('tableau, écarts et envois', () => {
    const html = periodesEreportingHtml([periode(ETAT_PERIODE_EREPORTING.PREPAREE, { envoyable: true, ecarts: [{ sous_flux: '10.1', regle: 'G1.05', donnee: 'TT-19', rang: 1 }] })], { peutModifier: true });
    expect(html).toContain('data-action-periode="envoyer"');
    expect(html).toContain('data-etat-periode="PREPAREE"');
    expect(html).toContain('data-ecarts');
    expect(periodesEreportingHtml([])).toContain('data-ereporting-vide');
    const detail = detailPeriodeHtml(periode(ETAT_PERIODE_EREPORTING.ACCEPTEE, { ecarts: [{ sous_flux: '10.1', regle: 'G1.05', donnee: 'TT-19', rang: 1 }] }));
    expect(detail).toContain('data-ouvrir-flux="12"');
    expect(detail).toContain('G1.05');
    expect(detail).toContain('data-chronologie-periode');
  });
});
