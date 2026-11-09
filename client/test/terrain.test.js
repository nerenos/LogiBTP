import { describe, it, expect } from 'vitest';
import { lundiDe, mobileAffiche, lienItineraire, liensTexte, numeroTel, presaisirJournee, actionsTache, minutesPointees, tachesGardees, jourPointage, adressesAPrecharger, plansTache, plansTacheHtml, plansAPrecharger, ligneDuPointage, champsPhotosHtml, TYPES_PHOTOS, estHeic, completerReferentiel, journeeSansReseau, chercherOrdre, preparerPhoto, decisionPhoto, DECISION_PHOTO, PhotoTropLourde } from '../src/app/terrain/terrain.js';

describe('application de terrain', () => {
  it('présaisie : heures du calendrier au prorata des tâches, équipe du chef reprise', () => {
    const taches = [{ id: 1, cha_id: 7, ent_id: null, type_mo: 3, poids: 300, chef: false, membres: [] }, { id: 2, cha_id: 8, ent_id: 4, type_mo: 3, poids: 100, chef: true, membres: [{ id: 9 }] }];
    const l = presaisirJournee(taches, 480, 15);
    expect(l.map((x) => x.minutes)).toEqual([360, 120]);
    expect(l[1]).toMatchObject({ id: null, tac_id: 2, ent_id: 4, membres: [9] });
    expect(presaisirJournee([], 480)).toEqual([]);
    expect(presaisirJournee(taches, 0)).toEqual([]);
  });

  it('ligne d\'ordre d\'un pointage : tâche d\'origine ligne sur son document, sinon enregistrée ou aucune', () => {
    const tache = { id: 1, ent_id: 4, lig_id: 42, ligne: 'L1 Pose cloisons' };
    expect(ligneDuPointage({ tac_id: 1, ent_id: 4 }, tache)).toBe('L1 Pose cloisons');
    expect(ligneDuPointage({ tac_id: 1, ent_id: 5 }, tache)).toBeNull();
    expect(ligneDuPointage({ tac_id: 2, ent_id: 4 }, { id: 2, ent_id: 4, lig_id: null })).toBeNull();
    expect(ligneDuPointage({ id: 9, ent_id: 4, ligne: 'L2 Enduit' }, null)).toBe('L2 Enduit');
    expect(ligneDuPointage({ ent_id: null }, null)).toBeNull();
  });

  it('champs photo sans image/* ni HEIC : l\'iPhone transcode en JPEG', () => {
    expect(TYPES_PHOTOS).toBe('image/jpeg,image/png');
    const champs = [...champsPhotosHtml().matchAll(/<input type="file"[^>]*>/g)].map((m) => m[0]);
    expect(champs).toHaveLength(2);
    for (const c of champs) expect(c).toContain('accept="image/jpeg,image/png"');
    expect(champs[0]).toContain('capture="environment"');
    expect(champs[1]).toContain('multiple');
    expect(champsPhotosHtml()).not.toMatch(/image\/\*|heic/i);
  });

  it('photo HEIC reconnue par son type ou son extension', () => {
    expect(estHeic({ type: 'image/heic', name: 'a' })).toBe(true);
    expect(estHeic({ type: '', name: 'IMG_0001.HEIF' })).toBe(true);
    expect(estHeic({ type: 'image/jpeg', name: 'IMG_0001.jpg' })).toBe(false);
    expect(estHeic(null)).toBe(false);
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
    expect(a).toContain('/api/terrain/journee/chantiers');
    expect(a.length).toBe(14 + 2 + 7 + 7 + 3);
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

describe('plans en vigueur d’une tâche (plan terrain-suites, lot 3)', () => {
  const plans = {
    5: [
      { id: 1, repere: 'R01', nom: 'Plan de masse', indice: 'B', terrain: true, fichiers: [{ id: 11, titre: 'R01_B.pdf', nom_fichier: 'R01_B.pdf', taille: 2048 }] },
      { id: 2, repere: 'R02', nom: 'Coupe', indice: '', terrain: false, fichiers: [{ id: 21, titre: 'R02.pdf', nom_fichier: 'R02.pdf', taille: null }] },
    ],
  };

  it('cochés en tête, les autres à part ; tâche sans plan : rien', () => {
    const p = plansTache({ id: 5 }, plans);
    expect(p.entete.map((x) => x.id)).toEqual([1]);
    expect(p.autres.map((x) => x.id)).toEqual([2]);
    expect(plansTache({ id: 6 }, plans)).toEqual({ entete: [], autres: [] });
    expect(plansTacheHtml(plansTache({ id: 6 }, plans), { url: (id) => `/p/${id}` })).toBe('');
  });

  it('autres plans repliés sous « Voir tous les plans »', () => {
    const html = plansTacheHtml(plansTache({ id: 5 }, plans), { url: (id) => `/p/${id}` });
    const [tete, replie] = html.split('<details');
    expect(tete).toContain('href="/p/11"');
    expect(tete).toContain('Indice B');
    expect(replie).not.toMatch(/^[^>]*\bopen\b/);
    expect(replie).toContain('Voir tous les plans (1 autre)');
    expect(replie).toContain('href="/p/21"');
    expect(replie).toContain('Premier indice');
  });
});

describe('plans cochés préchargés (plan terrain-suites, lot 4)', () => {
  it('fichiers des seuls plans cochés, sans doublon', () => {
    const lectures = [
      { plans: { 5: [{ terrain: true, fichiers: [{ id: 11 }, { id: 12 }] }, { terrain: false, fichiers: [{ id: 21 }] }] } },
      { plans: { 6: [{ terrain: true, fichiers: [{ id: 11 }] }] } },
      { taches: [] }, null,
    ];
    expect(plansAPrecharger(lectures)).toEqual([11, 12]);
  });
  it('hors ligne (terrain-suites lot 9) : ordre préchargé trouvé par son numéro sans réseau, chantiers du service ajoutés', () => {
    const gardes = { personne: { id: 12 }, libre: 'SOI', chantiers: [{ id: 3, code: 'C3' }, { id: 4, code: 'C4' }],
      ordres: [{ id: 30, cha_id: 3, numero: 'OP-2026-0012' }, { id: 31, cha_id: 4, numero: 'OP-2026-0125' }, { id: 32, cha_id: 4, numero: 'OP-2026-0126' }] };
    // Journée jamais lue : saisie libre seulement, aucun pointage connu (rien de retiré au serveur).
    const d = journeeSansReseau('2026-11-09', gardes);
    expect(d).toMatchObject({ personne: { id: 12 }, taches: [], pointages: [], libre: 'SOI', sansReseau: true });
    expect(d.chantiers).toHaveLength(2);
    expect(journeeSansReseau('2026-11-09', { ...gardes, libre: null })).toBeNull();
    expect(journeeSansReseau('2026-11-09', null)).toBeNull();
    // Journée gardée : chantiers et ordres du service ajoutés, sans doublon.
    const j = completerReferentiel({ chantiers: [{ id: 3, code: 'C3' }], ordres: [{ id: 30, cha_id: 3, numero: 'OP-2026-0012' }] }, gardes);
    expect(j.chantiers.map((c) => c.id)).toEqual([3, 4]);
    expect(j.ordres.map((o) => o.id)).toEqual([30, 31, 32]);
    expect(completerReferentiel(j, null)).toBe(j);
    // Numéro exact sans casse ni espaces, sinon le seul qui le contient.
    expect(chercherOrdre(' op-2026-0012 ', j.ordres)?.id).toBe(30);
    expect(chercherOrdre('0125', j.ordres)?.id).toBe(31);
    expect(chercherOrdre('012', j.ordres)).toBeNull();
    expect(chercherOrdre('9999', j.ordres)).toBeNull();
    expect(chercherOrdre('', j.ordres)).toBeNull();
  });
  it('photos (terrain-suites lot 12) : contrôle contre la limite de dépôt de la GED avant d\'être gardées', async () => {
    expect(decisionPhoto(900, 1000)).toBe(DECISION_PHOTO.GARDER);
    expect(decisionPhoto(1200, 1000)).toBe(DECISION_PHOTO.REDUIRE);
    expect(decisionPhoto(1200, 1000, { origine: true })).toBe(DECISION_PHOTO.REFUSER);
    expect(decisionPhoto(1200, null)).toBe(DECISION_PHOTO.GARDER);
    const lourde = new File([new Uint8Array(3 * 1024 * 1024)], 'chantier.jpg', { type: 'image/jpeg' });
    const limite = 2 * 1024 * 1024;
    // Qualité d'origine trop lourde : refusée tout de suite, limite en Mo dans le message.
    const refus = await preparerPhoto(lourde, { origine: true, limite }).catch((e) => e);
    expect(refus).toBeInstanceOf(PhotoTropLourde);
    expect(refus.message).toContain('2');
    // Navigateur qui ne sait pas réduire (pas de createImageBitmap) : refusée elle aussi, jamais gardée trop lourde.
    await expect(preparerPhoto(lourde, { limite })).rejects.toBeInstanceOf(PhotoTropLourde);
    // Sous la limite : inchangée.
    expect(await preparerPhoto(lourde, { origine: true, limite: 4 * 1024 * 1024 })).toBe(lourde);
  });
});
