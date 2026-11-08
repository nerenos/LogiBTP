import { describe, it, expect } from 'vitest';
import { relancesFaites, relancesRecentes, JOURS_PASTILLE } from '../src/app/relances/journal-relances.js';

// Journal des relances sur la page document et la fiche tiers (plans/relances.md, lot 8) : seules les relances faites comptent.
describe('Journal des relances', () => {
  it('ne garde que les relances envoyées ou en attente de numéro, de la plus récente à la plus ancienne', () => {
    const journal = [
      { id: 1, etat: 'ENVOYEE', date: '2026-10-01', niveau: 1 },
      { id: 2, etat: 'PROPOSEE', date: '2026-11-01', niveau: 2 },
      { id: 3, etat: 'ANNULEE', date: '2026-11-02', niveau: 2 },
      { id: 4, etat: 'ATTENTE_NUMERO', date: '2026-10-20', niveau: 2 },
      { id: 5, etat: 'ENVOYEE', date: '2026-10-20', niveau: 2 },
    ];
    expect(relancesFaites(journal).map((r) => r.id)).toEqual([5, 4, 1]);
    expect(relancesFaites(null)).toEqual([]);
  });

  // Pastille « relancé N » de la fiche tiers (lot 9, Q17 b) : relances faites de la fenêtre seulement.
  it('compte les relances faites des derniers jours pour la pastille', () => {
    const journal = [
      { id: 1, etat: 'ENVOYEE', date: '2026-11-01', niveau: 1 },
      { id: 2, etat: 'ATTENTE_NUMERO', date: '2026-09-10', niveau: 2 },
      { id: 3, etat: 'ENVOYEE', date: '2026-08-01', niveau: 1 },
      { id: 4, etat: 'PROPOSEE', date: '2026-11-05', niveau: 2 },
      { id: 5, etat: 'ENVOYEE', date: '2026-11-20', niveau: 3 },
    ];
    expect(JOURS_PASTILLE).toBe(90);
    expect(relancesRecentes(journal, '2026-11-08').map((r) => r.id)).toEqual([1, 2]);
    expect(relancesRecentes(journal, '2026-11-08', 30).map((r) => r.id)).toEqual([1]);
    expect(relancesRecentes([], '2026-11-08')).toEqual([]);
  });
});
