import { describe, it, expect } from 'vitest';
import { memeAdresse, adresseIdentiqueAuClient, payeurIdentiqueAuClient } from '../src/app/structure/adresses.js';

// Adresse des travaux et payeur comparés au client (réplique de AdressesDocument.cs, lot F).
const client = { per_id: 5, contact: { ind_id: 9, nom: 'M. Martin' }, telephone: '01 02 03 04 05',
  adresse: { ligne1: '12 rue des Lilas', code_postal: '69003', ville: 'Lyon', pays: 'FR' } };

describe('Adresse des travaux et payeur identiques au client', () => {
  it('adresse : casse, espaces et pays par défaut ignorés', () => {
    expect(memeAdresse({ ligne1: '12  RUE des lilas', code_postal: '69003', ville: 'lyon' }, client.adresse)).toBe(true);
    expect(memeAdresse({ ligne1: '14 rue des Lilas', code_postal: '69003', ville: 'Lyon' }, client.adresse)).toBe(false);
  });

  it('adresse des travaux identique : même adresse sans information propre', () => {
    expect(adresseIdentiqueAuClient({ adresse: { ...client.adresse } }, client)).toBe(true);
    expect(adresseIdentiqueAuClient({ adresse: { ...client.adresse }, contact: { ind_id: 9 }, telephone: '01 02 03 04 05' }, client)).toBe(true);
    expect(adresseIdentiqueAuClient({ adresse: { ...client.adresse }, instructions: 'Portail bleu' }, client)).toBe(false);
    expect(adresseIdentiqueAuClient({ adresse: { ...client.adresse }, contact: { ind_id: 12 } }, client)).toBe(false);
    expect(adresseIdentiqueAuClient({ adresse: { ...client.adresse }, mention: 'Retrait au comptoir' }, client)).toBe(false);
    expect(adresseIdentiqueAuClient(null, client)).toBe(false);
  });

  it('payeur identique : même personne et même contact', () => {
    expect(payeurIdentiqueAuClient({ per_id: 5, contact: { ind_id: 9 } }, client)).toBe(true);
    expect(payeurIdentiqueAuClient({ per_id: 5, contact: null }, client)).toBe(false);
    expect(payeurIdentiqueAuClient({ per_id: 6, contact: { ind_id: 9 } }, client)).toBe(false);
  });
});
