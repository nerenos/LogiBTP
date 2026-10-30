import { describe, it, expect } from 'vitest';
import { lundiDe, mobileAffiche, lienItineraire, liensTexte, numeroTel } from '../src/app/terrain/terrain.js';

describe('application de terrain', () => {
  it('lundi de la semaine', () => {
    expect(lundiDe('2026-10-30')).toBe('2026-10-26');
    expect(lundiDe('2026-10-26')).toBe('2026-10-26');
    expect(lundiDe('2026-11-01')).toBe('2026-10-26');
  });

  it('partie mobile complétée par le chantier', () => {
    const defauts = { 7: { adresse: '1 rue du Port, 13002 Marseille', contact: 'M. Martin', telephone: '04 91 00 00 00' } };
    const m = mobileAffiche({ chantier: { id: 7 }, mobile: { contact: 'Mme Durand ', commentaire: 'Badge à l\'accueil' } }, defauts);
    expect(m.adresse).toEqual({ valeur: '1 rue du Port, 13002 Marseille', herite: true });
    expect(m.contact).toEqual({ valeur: 'Mme Durand', herite: false });
    expect(m.telephone.herite).toBe(true);
    expect(m.commentaire).toBe('Badge à l\'accueil');
    expect(mobileAffiche({ chantier: null, mobile: {} }, defauts).adresse).toBeNull();
  });

  it('itinéraire selon l\'appareil ou le choix', () => {
    const a = '1 rue du Port, Marseille';
    expect(lienItineraire(a, 'AUTO', 'Mozilla/5.0 (Linux; Android 14)')).toBe(`geo:0,0?q=${encodeURIComponent(a)}`);
    expect(lienItineraire(a, 'AUTO', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile')).toMatch(/^https:\/\/maps\.apple\.com\//);
    expect(lienItineraire(a, 'AUTO', 'Mozilla/5.0 (Windows NT 10.0)')).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    expect(lienItineraire(a, 'WAZE')).toMatch(/^https:\/\/waze\.com\/ul\?q=/);
  });

  it('liens saisis : http(s) seulement cliquables', () => {
    expect(liensTexte('https://exemple.fr/plan.pdf\n\njavascript:alert(1)\nportail : code 1234')).toEqual([
      { url: 'https://exemple.fr/plan.pdf', libelle: 'exemple.fr/plan.pdf' }, { texte: 'javascript:alert(1)' }, { texte: 'portail : code 1234' },
    ]);
  });

  it('numéro de téléphone', () => {
    expect(numeroTel('04 91 00-00-00')).toBe('0491000000');
    expect(numeroTel('+33 6 12')).toBe('+33612');
    expect(numeroTel('voir accueil')).toBeNull();
  });
});

describe('compléter la journée', () => {
  it('répartit le reste au prorata des poids, au pas, reste à la plus lourde', async () => {
    const { completerJournee } = await import('../src/app/terrain/terrain.js');
    expect(completerJournee([{ minutes: 60 }, { minutes: null, poids: 300 }, { minutes: 0, poids: 100 }], 480, 15)).toEqual([null, 315, 105]);
    expect(completerJournee([{ minutes: null }, { minutes: null }], 420, 15)).toEqual([210, 210]);
    expect(completerJournee([{ minutes: 480 }, { minutes: null, poids: 1 }], 420, 15)).toEqual([null, null]);
    expect(completerJournee([{ minutes: null, poids: 1 }, { minutes: null, poids: 2 }], 425, 0)).toEqual([141, 284]);
    expect(completerJournee([{ minutes: null, poids: 105.9 }, { minutes: null, poids: 0 }], 420, 15)).toEqual([420, null]);
  });
});

describe('photos', () => {
  it('réduit le plus grand côté sans jamais agrandir', async () => {
    const { dimensionsReduites } = await import('../src/app/terrain/terrain.js');
    expect(dimensionsReduites(4000, 3000)).toEqual({ largeur: 2000, hauteur: 1500, reduite: true });
    expect(dimensionsReduites(3000, 4032)).toEqual({ largeur: 1488, hauteur: 2000, reduite: true });
    expect(dimensionsReduites(1200, 900)).toEqual({ largeur: 1200, hauteur: 900, reduite: false });
  });
});

describe('hors ligne', () => {
  it('adresses à garder : deux semaines de tâches, la semaine des journées', async () => {
    const { adressesAPrecharger } = await import('../src/app/terrain/terrain.js');
    const a = adressesAPrecharger('2026-10-30', 12);
    expect(a).toContain('/api/terrain?du=2026-10-26&au=2026-10-26');
    expect(a).toContain('/api/terrain?du=2026-11-08&au=2026-11-08');
    expect(a).toContain('/api/terrain?du=2026-11-02&au=2026-11-08');
    expect(a).toContain('/api/terrain/journee?date=2026-11-01');
    expect(a).not.toContain('/api/terrain/journee?date=2026-11-02');
    expect(a).toContain('/api/pointage/repas/12?du=2026-10-30&au=2026-10-30');
    expect(a.length).toBe(14 + 2 + 7 + 7 + 2);
  });
});
