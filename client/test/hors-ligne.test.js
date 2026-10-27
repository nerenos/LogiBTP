import { describe, it, expect } from 'vitest';
import { produce } from 'immer';
import { enteteACreer, envoiCree, estHorsLigne, cleAttente } from '../src/app/hors-ligne/attente.js';
import { appliquerReponse } from '../src/app/documents/reponse.js';
import { ErreurApi } from '../src/app/api.js';

// Mode hors ligne, lot 3 : documents enregistrés sur le poste puis envoyés au retour de l'API.
describe('saisie des documents hors ligne', () => {
  const initial = { ent_id: -5, ent_tyd_id: 1, ent_numero: null, ent_version: 1, ent_objet: 'Nouveau devis', ent_tiers_id: null, ent_validite_jours: null, ent_proprietes: {} };
  const serveur = { ent_id: 42, ent_tyd_id: 1, ent_numero: 'DV2026-00007', ent_version: 1, ent_objet: 'Nouveau devis', ent_tiers_id: null, ent_validite_jours: 30,
    ent_proprietes: {}, ent_texte_intro: '<p>Modèle</p>' };

  it("garde l'entête du serveur et les champs saisis hors ligne à la création", () => {
    const local = { ...initial, ent_objet: 'Maison Martin', ent_tiers_id: 14, ent_validite_jours: null, ent_numero: 'X', ent_version: 3 };
    const doc = enteteACreer(local, initial, serveur);
    // Saisis hors ligne : repris ; non modifiés : défauts du serveur (validité, texte du modèle) ; tenus par le serveur : jamais.
    expect(doc).toMatchObject({ ent_id: 42, ent_numero: 'DV2026-00007', ent_version: 1, ent_objet: 'Maison Martin', ent_tiers_id: 14,
      ent_validite_jours: 30, ent_texte_intro: '<p>Modèle</p>' });
  });

  it('rattache les lignes et les ventilations au document créé', () => {
    const envoi = { document: initial, lignes: [{ lig_id: -1, lig_ent_id: -5 }], ventilations: [{ vfr_id: -2, vfr_ent_id: -5 }], metres: [] };
    const e = envoiCree(envoi, initial, serveur);
    expect(e.lignes[0].lig_ent_id).toBe(42);
    expect(e.ventilations[0].vfr_ent_id).toBe(42);
    expect(e.document.ent_id).toBe(42);
  });

  it("reconnaît le serveur injoignable (réseau, service worker, relais) et pas les refus de l'API", () => {
    expect(estHorsLigne(new TypeError('Failed to fetch'))).toBe(true);
    expect(estHorsLigne(new ErreurApi(503, 'HORS_LIGNE', 'Hors ligne'))).toBe(true);
    expect(estHorsLigne(new ErreurApi(500, 'HTTP', 'Internal Server Error'))).toBe(true);
    expect(estHorsLigne(new ErreurApi(409, 'VERSION', 'Modifié'))).toBe(false);
    expect(estHorsLigne(new ErreurApi(422, 'VALIDATION', 'Invalide'))).toBe(false);
    expect(cleAttente('direction', -5)).toBe('direction:-5');
  });

  it("applique les identifiants définitifs et garde l'entête saisi depuis l'envoi", () => {
    const saisie = {
      document: { ent_id: -5, ent_objet: 'Saisi après', ent_version: 1 },
      lignes: [{ lig_id: -1, lig_parent_id: null, lig_mtr_id: -3 }, { lig_id: -2, lig_parent_id: -1, lig_mtr_id: null }],
      metres: [{ mtr_id: -3, mtr_lig_id: -1 }], variables: [], ventilations: [],
    };
    const rep = {
      document: { document: { ent_id: 42, ent_numero: 'DV2026-00007', ent_version: 2, ent_objet: 'Envoyé' } },
      correspondance_lignes: { '-1': 100, '-2': 101 }, correspondances: { metres: { '-3': 7 } }, ecarts: [],
    };
    let map;
    const s = produce(saisie, (d) => { map = appliquerReponse(d, rep, { identiteSeule: true }); });
    expect(s.document).toMatchObject({ ent_id: 42, ent_numero: 'DV2026-00007', ent_version: 2, ent_objet: 'Saisi après' });
    expect(s.lignes.map((l) => [l.lig_id, l.lig_parent_id, l.lig_ent_id])).toEqual([[100, null, 42], [101, 100, 42]]);
    expect(s.metres[0]).toEqual({ mtr_id: 7, mtr_lig_id: 100 });
    expect(map(-2)).toBe(101);
    expect(produce(saisie, (d) => { appliquerReponse(d, rep); }).document.ent_objet).toBe('Envoyé');
  });
});
