import { describe, it, expect } from 'vitest';
import { planifierEntretiensDemo, MOIS_HISTORIQUE } from '../scripts/entretiens-demo.mjs';
import { echeanceEntretien } from '../src/app/ressources/entretiens.js';
import { ajouterMois } from '@logibtp/socle';

// Démonstration d'entretiens (plan materiel-suites, lot 5, MO3).
describe('démonstration : historique d\'entretiens', () => {
  const aujourdhui = '2026-11-08';
  const echeances = [
    ...[1, 2, 3].map((m) => ({ materiel_id: m, plan_id: m, code: 'VIDANGE', nature: 'PREVENTIF', mois: 12 })),
    { materiel_id: 4, plan_id: 4, code: 'REVISION', nature: 'PREVENTIF', mois: 6 },
    { materiel_id: 5, plan_id: 5, code: 'PNEUS', nature: 'PREVENTIF', mois: null },
  ];
  const faits = planifierEntretiensDemo(echeances, aujourdhui);
  const dernier = (id) => faits.filter((f) => f.materiel_id === id).at(-1);
  const etat = (id) => echeanceEntretien({ plan: { mois: echeances.find((e) => e.materiel_id === id).mois },
    reference: { date: dernier(id).date }, courant: { date: aujourdhui } }).etat;

  it('les états se répartissent : à jour, à échéance proche et en retard', () => {
    expect([1, 2, 3].map(etat).sort()).toEqual(['A_PREVOIR', 'EN_RETARD', 'OK']);
  });

  it('pas de plan en mois : aucun entretien ; jamais de date future', () => {
    expect(faits.some((f) => f.materiel_id === 5)).toBe(false);
    expect(faits.every((f) => f.date <= aujourdhui)).toBe(true);
  });

  it('plan semestriel : plusieurs entretiens sur les 12 derniers mois, dans l\'ordre', () => {
    const l = faits.filter((f) => f.materiel_id === 4).map((f) => f.date);
    expect(l.length).toBeGreaterThan(1);
    expect([...l].sort()).toEqual(l);
    expect(l.slice(1).every((d) => d >= ajouterMois(aujourdhui, -MOIS_HISTORIQUE))).toBe(true);
  });
});
