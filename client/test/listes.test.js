import { describe, it, expect } from 'vitest';
import { estTypeDocument } from '../src/app/listes.js';

// Ouverture depuis une liste : toutes les familles de documents s'ouvrent dans la page document (analyse des demandes
// du 25/10/2026, B1 : les ordres E_ et les pièces de sous-traitance T_ affichaient « écran pas encore disponible »).
describe('estTypeDocument', () => {
  it('reconnaît toutes les familles de documents', () => {
    for (const t of ['V_DEVIS', 'A_COMMANDE', 'S_TRANSFERT', 'E_OE', 'E_SAV', 'T_AO', 'T_COMMANDE']) expect(estTypeDocument(t)).toBe(true);
  });
  it('écarte les fiches et les autres éléments', () => {
    for (const t of ['salarie', 'equipe', 'element', 'document_ged', 'pointage', '', null, undefined]) expect(estTypeDocument(t)).toBe(false);
  });
});
