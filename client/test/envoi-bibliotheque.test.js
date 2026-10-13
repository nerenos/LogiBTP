import { describe, it, expect } from 'vitest';
import { calculerDocument } from '../src/calcul/index.js';
import { DEFINITION_DEMO, DOCUMENT_DEMO } from '../src/app/demo.js';
import { PressePapiersBtp } from '../src/app/editeur-btp.js';
import { calculerOuvrage } from '../src/app/bibliotheque/bibliotheque.js';
import {
  typeElementDeLigne, compositionDepuisContenu, valeursDepuisLigne, doublons, codePropose, elementLie,
} from '../src/app/bibliotheque/envoi.js';

// Enregistrement dans la bibliothèque depuis un document : composition extraite d'un sous-arbre (même prix que dans le
// devis), valeurs de la fiche, doublons par code ou libellé.

const saisie = () => structuredClone({ ...DOCUMENT_DEMO, variables: DOCUMENT_DEMO.variables ?? [] });

describe('Envoi vers la bibliothèque', () => {
  it('type d\'élément selon la ligne et lien existant', () => {
    expect(typeElementDeLigne({ lig_tyl_id: 3 })).toBe('ARTICLE');
    expect(typeElementDeLigne({ lig_tyl_id: 2 })).toBe('OUVRAGE');
    expect(typeElementDeLigne({ lig_tyl_id: 1 })).toBe('ENSEMBLE');
    expect(typeElementDeLigne({ lig_tyl_id: 11 })).toBe('ENSEMBLE');
    expect(typeElementDeLigne({ lig_tyl_id: 5 })).toBeNull();
    expect(elementLie({ lig_proprietes: { element: { id: 7 } } })).toBe(7);
  });

  it('ouvrage du devis → composition : même PA par unité, ids renumérotés, métrés et variables suivis', () => {
    const s = saisie();
    const r = calculerDocument({ ...s, taux_tva: DEFINITION_DEMO.taux_tva });
    const dalle = s.lignes.find((l) => /Dalle béton armé/.test(l.lig_libelle_html));
    const contenu = new PressePapiersBtp().extraire(s, [dalle.lig_id], { entId: 0, coupe: false });
    const c = compositionDepuisContenu(contenu, s.document.ent_mode_calcul_ouvrage, new Map(r.lignes.map((l) => [l.lig_id, l.lig_qte_vendue])));
    // Main-d'œuvre de coulage : 16 h absolues pour 120 m² → 0,133333 h par m².
    expect(c.lignes.find((l) => /coulage/.test(l.lig_libelle_html))).toMatchObject({ lig_qte_type: 'R', lig_qte: 0.133333 });
    expect(c.lignes[0]).toMatchObject({ lig_id: 1, lig_parent_id: null, lig_tyl_id: 2 });
    expect(new Set(c.lignes.map((l) => l.lig_id)).size).toBe(c.lignes.length);
    for (const l of c.lignes.slice(1)) expect(c.lignes.some((x) => x.lig_id === l.lig_parent_id)).toBe(true);
    // PA par m² identique à celui de la ligne du devis (montant PA / quantité vendue).
    const ligne = r.lignes.find((l) => l.lig_id === dalle.lig_id);
    const parUnite = Number(ligne.lig_montant_pa) / Number(ligne.lig_qte_vendue);
    const p = calculerOuvrage(c, { coef_fg: dalle.lig_coef_fg, coef_benef: dalle.lig_coef_benef });
    expect(Number(p.pa)).toBeCloseTo(parUnite, 2);
  });

  it('valeurs d\'un article : PA ramené à l\'unité de stock, coefficients imposés', () => {
    const l = { lig_tyl_id: 3, lig_libelle_html: 'Plaque', lig_pa: 5.375, lig_coef_fg: 1.12, lig_coef_benef: 1.3, lig_unt_code: 'pl', lig_proprietes: { element: { ratio: '2.5' } } };
    const v = valeursDepuisLigne(l, 'ARTICLE', { creation: true });
    expect(v).toMatchObject({ pa_fixe: '2.15', coef_fg: '1.12', coef_fg_impose: true, coef_benef_impose: true, unite_stock: 'pl', scenario_pa: 'FIXE' });
  });

  it('doublons par code (même bibliothèque) ou par libellé, code proposé', () => {
    const l = { lig_code: 'GEN:HA10', lig_libelle_html: '<b>Acier HA10</b> – barre de 12 m' };
    const resultats = [
      { id: 1, bib_code: 'GEN', code: 'HA10', libelle: 'Autre libellé' },
      { id: 2, bib_code: 'FAB', code: 'X1', libelle: 'Acier HA10 – barre de 12 m' },
      { id: 3, bib_code: 'GEN', code: 'HA12', libelle: 'Acier HA12' },
    ];
    expect(doublons(l, resultats, { bib: 'GEN' }).map((x) => x.e.id)).toEqual([1, 2]);
    expect(codePropose(l)).toBe('HA10');
    expect(codePropose({ lig_libelle_html: 'Fenêtre PVC posée en rénovation' })).toBe('FENPVCPOSEN');
  });
});
