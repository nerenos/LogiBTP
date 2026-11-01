import { describe, it, expect } from 'vitest';
import { lundiDe, mobileAffiche, lienItineraire, liensTexte, numeroTel, presaisirJournee, actionsTache, minutesPointees, tachesGardees, jourPointage, adressesAPrecharger } from '../src/app/terrain/terrain.js';

describe('application de terrain', () => {
  it('présaisie : heures du calendrier au prorata des tâches, équipe du chef reprise', () => {
    const taches = [{ id: 1, cha_id: 7, ent_id: null, type_mo: 3, poids: 300, chef: false, membres: [] }, { id: 2, cha_id: 8, ent_id: 4, type_mo: 3, poids: 100, chef: true, membres: [{ id: 9 }] }];
    const l = presaisirJournee(taches, 480, 15);
    expect(l.map((x) => x.minutes)).toEqual([360, 120]);
    expect(l[1]).toMatchObject({ id: null, tac_id: 2, ent_id: 4, membres: [9] });
    expect(presaisirJournee([], 480)).toEqual([]);
    expect(presaisirJournee(taches, 0)).toEqual([]);
  });

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

  it('actions d\'une tâche selon les droits : sans chantier aucune, réception sur un ordre de pose seulement', () => {
    const t = { chantier: { id: 3 } };
    expect(actionsTache({ chantier: null }, { pointage: true })).toEqual([]);
    expect(actionsTache(t, {})).toEqual(['photos', 'nc']);
    expect(actionsTache(t, { pointage: true, avancement: true, demande: true, materiel: true, livraison: true, fil: true }, { pose: true }))
      .toEqual(['pointage', 'avancement', 'photos', 'nc', 'demande', 'materiel', 'livraison', 'reception', 'fil']);
    expect(actionsTache(t, { demande: false, fil: true })).toEqual(['photos', 'nc', 'fil']);
  });

  it('tâche pointée : minutes du jour, journées gardées sur l\'appareil', () => {
    const t = { id: 5, pointages: [{ date: '2026-11-02', minutes: 240 }, { date: '2026-11-03', minutes: 60 }] };
    expect(minutesPointees(t, '2026-11-02')).toBe(240);
    expect(minutesPointees(t, '2026-11-04')).toBe(0);
    expect(minutesPointees({ id: 1 }, '2026-11-02')).toBe(0);
    const g = tachesGardees([{ id: '2026-11-02', corps: { lignes: [{ tac_id: 5, minutes: 120 }, { tac_id: 6, minutes: null }, { tac_id: null, minutes: 60 }] } }]);
    expect([...g]).toEqual(['2026-11-02|5']);
  });

  it('jour de pointage depuis la carte : jour affiché dans la tâche, sinon son début, jamais à venir', () => {
    const t = { debut: '2026-11-02T08:00', fin: '2026-11-05T00:00' };
    expect(jourPointage(t, '2026-11-03', '2026-11-10')).toBe('2026-11-03');
    expect(jourPointage(t, '2026-11-05', '2026-11-10')).toBe('2026-11-02');
    expect(jourPointage(t, '2026-11-04', '2026-11-03')).toBe('2026-11-03');
  });

  it('préchargement : mes demandes avec le droit seulement', () => {
    expect(adressesAPrecharger('2026-10-30', 12)).not.toContain('/api/terrain/demandes');
    expect(adressesAPrecharger('2026-10-30', 12, { demandes: true })).toContain('/api/terrain/demandes');
  });
});
