import { describe, it, expect, vi, afterEach } from 'vitest';
import { dateLocale, aujourdhui, numeroJour, depuisNumero, ajouterJours, joursEntre, jourSemaine, ajouterMois } from '../src/calcul/index.js';

describe('dates', () => {
  afterEach(() => vi.useRealTimers());

  it('date du jour dans le fuseau du poste, pas en UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 28, 0, 30));
    expect(aujourdhui()).toBe('2026-10-28');
    expect(dateLocale(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('jours', () => {
    expect(depuisNumero(numeroJour('2026-03-29'))).toBe('2026-03-29');
    expect(ajouterJours('2026-03-28', 2)).toBe('2026-03-30');
    expect(ajouterJours('2026-01-01', -1)).toBe('2025-12-31');
    expect(joursEntre('2026-02-01', '2026-03-01')).toBe(28);
    expect(jourSemaine('2026-10-26')).toBe(1);
    expect(jourSemaine('2026-11-01')).toBe(7);
  });

  it('mois, fin de mois ramenée', () => {
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28');
    expect(ajouterMois('2024-02-29', 12)).toBe('2025-02-28');
    expect(ajouterMois('2026-03-15', -3)).toBe('2025-12-15');
  });
});
