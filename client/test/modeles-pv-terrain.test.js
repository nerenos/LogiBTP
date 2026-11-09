import { describe, it, expect } from 'vitest';
import { evaluerFormule, verifierModele } from '@logibtp/edition';
import { MODELES_EDITION } from '../src/app/editions/modeles.js';

// PV signés sur le terrain (plan terrain-suites, lots 13 et 16) : forme de signature et heures imprimées (TS13 a,
// TS16 a) ; PV de levée des réserves (TS14 a), source annexe levee_reserves du serveur (EditionsBtp.cs).
const modele = (code) => MODELES_EDITION.find((m) => m.code === code);
const formules = (m) => { const r = []; JSON.stringify(m.contenu, (k, v) => { if (k === 'valeur' && typeof v === 'string') r.push(v); return v; }); return r; };
const chemin = (objet, c) => c.split('.').reduce((o, k) => (o == null ? null : o[k] ?? null), objet);
const evaluer = (f, donnees) => evaluerFormule(f, { resoudre: (c) => chemin(donnees, Array.isArray(c) ? c.join('.') : c) });

describe('PV signés sur le terrain', () => {
  for (const [code, source] of [['PV_RECEPTION', 'reception_pose'], ['PV_LEVEE_RESERVES', 'levee_reserves']]) {
    it(`${code} : modèle valide, deux heures hors ligne, une seule en ligne`, () => {
      const m = modele(code);
      expect(m?.types).toEqual(['E_PO']);
      expect(verifierModele(m.contenu)).toEqual([]);
      expect(m.contenu.sources_annexes).toEqual([source]);
      const f = formules(m).find((x) => x.includes('Signature électronique simple, '));
      const horsLigne = evaluer(f, { sources: { [source]: { recu_le: '08/11/2026 11:00', signe_appareil_le: '08/11/2026 09:30' } } });
      expect(horsLigne).toBe('Signature électronique simple, signée sur l’appareil le 08/11/2026 09:30, reçue le 08/11/2026 11:00.');
      const enLigne = evaluer(f, { sources: { [source]: { recu_le: '08/11/2026 11:00', signe_appareil_le: null } } });
      expect(enLigne).toBe('Signature électronique simple, signée et reçue le 08/11/2026 11:00.');
    });
  }

  it('PV de levée : réserves levées listées avec leur date et le commentaire', () => {
    const f = formules(modele('PV_LEVEE_RESERVES')).find((x) => x.includes('element.levee_le'));
    expect(evaluer(f, { element: { libelle: 'Joint', levee_le: '08/11/2026', commentaire: 'refait' } })).toBe('• Joint — levée le 08/11/2026 (refait)');
    expect(evaluer(f, { element: { libelle: 'Plinthe', levee_le: '08/11/2026', commentaire: null } })).toBe('• Plinthe — levée le 08/11/2026');
  });
});
