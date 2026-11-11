import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { texte } from '@logibtp/socle/dictionnaire';
import { ECART_RECEPTION } from '@logibtp/facture-electronique';
import { receptionSousTraitanceHtml } from '../src/app/documents/tracabilite.js';
import { GARANTIE_MARCHE, SIGNAL_FE } from '../src/app/codes.js';

// Facturation électronique, lot 15 du cœur : facture de sous-traitance reçue en paiement direct (cadre S5 et payeur) et
// écarts de la réception (payeur, autoliquidation, contrat) lus du rapport d'origine dans l'onglet Traçabilité.

const textes = JSON.parse(fs.readFileSync(new URL('../personnalisation/fr.json', import.meta.url), 'utf8'));

describe('facture de sous-traitance reçue', () => {
  it('rien sans paiement direct ni écart', () => {
    expect(receptionSousTraitanceHtml(null)).toBe('');
    expect(receptionSousTraitanceHtml({ ecarts: [{ code: 'INCONNU' }] })).toBe('');
  });

  it('paiement direct : marché et payeur', () => {
    const html = receptionSousTraitanceHtml({ paiement_direct: { code_marche: 'ST-2026-014', payeur: { raison_sociale: 'COMMUNE DE MAVILLE' } } });
    expect(html).toContain('data-paiement-direct');
    expect(html).toContain('ST-2026-014');
    expect(html).toContain('COMMUNE DE MAVILLE');
  });

  it('écarts listés par leur texte', () => {
    const html = receptionSousTraitanceHtml({
      ecarts: [{ code: ECART_RECEPTION.AUTOLIQUIDATION_ABSENTE }, { code: ECART_RECEPTION.PAYEUR_DIFFERENT, payeur: 'COMMUNE <A>', maitre_ouvrage: 'SCI' }],
    });
    expect(html).toContain(`data-ecart="${ECART_RECEPTION.AUTOLIQUIDATION_ABSENTE}"`);
    expect(html).toContain('COMMUNE &lt;A&gt;');
    expect(html).not.toContain('COMMUNE <A>');
  });

  it('un texte par écart', () => {
    for (const code of Object.values(ECART_RECEPTION)) {
      expect(textes.facture_electronique_btp.sous_traitance.ecarts[code]).toBeTruthy();
      expect(texte(`facture_electronique_btp.sous_traitance.ecarts.${code}`)).not.toBe(`facture_electronique_btp.sous_traitance.ecarts.${code}`);
    }
  });

  it('codes du cœur', () => {
    expect(SIGNAL_FE.PAIEMENT_DIRECT).toBe('PAIEMENT_DIRECT');
    expect(Object.isFrozen(GARANTIE_MARCHE)).toBe(true);
  });
});
