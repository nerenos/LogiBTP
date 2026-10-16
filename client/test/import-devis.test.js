import { describe, it, expect } from 'vitest';
import { convertirOptim } from '@logibtp/import';
import { saisieDevisImporte, ecartsImport } from '../src/app/import/devis-importe.js';
import { calculerDocument, TL } from '../src/calcul/index.js';
import { DEFINITION_DEMO } from '../src/app/demo.js';

// Devis OptimBTP converti dans le modèle BTP puis recalculé : mêmes montants que le logiciel d'origine.
const L = (o) => `<Ligne>${Object.entries({ IsSousDetail: 0, Ordre: 1, TypeLigne: 1, Qte: 0, PAU: 0, PRU: 0, PGU: 0, PctVte: 0, ...o }).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</Ligne>`;
const XML = `<Devis><Entete><Libelle>Parking</Libelle><DateDoc>20250918</DateDoc><ModeReglCode>Vir45</ModeReglCode><Reference>D9.00</Reference><RefExt>CDE-12</RefExt><Redacteur>Martin PAUL</Redacteur><TxTVA_Def>0.2</TxTVA_Def></Entete><Lignes>
${L({ Identifiant: 1, IdentifiantParent: 0, TypeLigne: 4, NumLigne: 7, Libelle: 'Voirie' })}
${L({ Identifiant: 2, IdentifiantParent: 1, NumLigne: '7.1', LibUnite: 'M2', Qte: 100, PAU: 10, PRU: 10.5, PctVte: 0.2, MntHT: 1260, TxTVA: 0.1, FTY_Code: 'MT', FTY_LibelleRgp: 'MATERIAUX', Libelle: 'Enrobés', Couleur: 'COUL_02' })}
${L({ Identifiant: 3, IdentifiantParent: 1, Ordre: 2, TypeLigne: 2, NumLigne: '7.3', LibUnite: 'U', Qte: 4, PctVte: 0.1, PVU: 95, MntHT: 380, Libelle: 'Ouvrage' })}
${L({ Identifiant: 4, IdentifiantParent: 3, IsSousDetail: 1, LibUnite: 'H', Qte: 2, PAU: 30, PRU: 30, PVU: 33, FTY_LibelleRgp: "MAIN D'OEUVRE", Libelle: 'MO' })}
${L({ Identifiant: 5, IdentifiantParent: 3, IsSousDetail: 1, Ordre: 2, LibUnite: 'ZZ', Qte: 0.25, QteFixe: 1, PAU: 100, PRU: 100, PVU: 110, Libelle: 'Forfait' })}
${L({ Identifiant: 6, IdentifiantParent: 1, Ordre: 3, NumLigne: '7.4', LibUnite: 'M2', Qte: 10, PGU: 5, PctVte: 0.15, PVU: 5.75, IsMntFixe: 1, MntHT: 57.5, FTY_Code: 'MT', Libelle: 'Globalisé', Couleur: 'COUL_05' })}
</Lignes><Parametres>
<Parametre><TypeParam>Appli</TypeParam><Code>VALIDITE_OFFRE</Code><Num1>2</Num1></Parametre>
<Parametre><TypeParam>Couleur</TypeParam><Code>COUL_02</Code><Libelle>A vérifier</Libelle><Num1>5938673</Num1></Parametre>
<Parametre><TypeParam>Couleur</TypeParam><Code>COUL_05</Code><Libelle>Ligne contrôlée</Libelle><Num1>7261820</Num1></Parametre>
</Parametres></Devis>`;

const NATURES = [{ id: 1, code: 'MO', libelle: 'MO', regroupement: 'MO' }, { id: 2, code: 'MAT', libelle: 'Matériaux', regroupement: 'MATERIAUX' }, { id: 5, code: 'OUV', libelle: 'Ouvrages', regroupement: 'VENTE' }];
const DEFINITION = { ...DEFINITION_DEMO, proprietes: [{ prd_code: 'mode_reglement', prd_options: [{ code: 'VIR', libelle: 'Virement' }] }] };

describe('Import d\'un devis dans le modèle BTP', () => {
  const devis = convertirOptim(XML);
  const s = saisieDevisImporte(devis, { definition: DEFINITION, natures: NATURES, redacteurs: [{ valeur: 7, libelle: 'Paul Martin' }] });

  it('reprend références, validité, rédacteur et étiquettes de couleur', () => {
    expect(s.document).toMatchObject({ ent_notre_reference: 'D9.00', ent_reference_externe: 'CDE-12', ent_validite_jours: 60, ent_redacteur_id: 7 });
    const par = (libelle) => s.lignes.find((l) => l.lig_libelle_html === libelle);
    expect(par('Enrobés').lig_etiquette).toBe('A_VERIFIER'); // « A vérifier » = étiquette « À vérifier »
    expect(par('Globalisé').lig_etiquette).toBe('OPTIM_COUL_05'); // sans correspondance : étiquette propre au document
    expect(s.document.ent_etiquettes).toEqual([{ code: 'OPTIM_COUL_05', libelle: 'Ligne contrôlée', couleur: '#7cce6e' }]);
    expect(s.correspondances.redacteur).toEqual({ nom: 'Martin PAUL', id: 7 });
  });

  it('englobe le corps dans une section et rapproche les référentiels', () => {
    const [section, ...corps] = s.lignes;
    expect(section).toMatchObject({ lig_tyl_id: TL.SECTION, lig_parent_id: null });
    expect(corps.every((l) => l.lig_id < 0)).toBe(true);
    const par = (libelle) => s.lignes.find((l) => l.lig_libelle_html === libelle);
    expect(par('Voirie')).toMatchObject({ lig_parent_id: section.lig_id, lig_num_depart: '7' });
    expect(par('Enrobés')).toMatchObject({ lig_unt_code: 'm2', lig_nat_id: 2, lig_tva_id: 2, lig_pa: 10, lig_coef_fg: 1.05, lig_coef_benef: 1.2 });
    // PV unitaire d'OptimBTP imposé à l'ouvrage et à ses composantes (mode bordereau).
    expect(par('Ouvrage')).toMatchObject({ lig_tyl_id: TL.OUVRAGE, lig_nat_id: 5, lig_tva_id: 1, lig_pv_fixe: true, lig_pv: 95 });
    expect(par('MO')).toMatchObject({ lig_qte_type: 'R', lig_nat_id: 1, lig_coef_benef: 1.1, lig_tva_id: null, lig_pv_fixe: true, lig_pv: 33 });
    expect(par('Forfait')).toMatchObject({ lig_qte_type: 'A', lig_qte: 1, lig_unt_code: null });
    expect(par('Globalisé')).toMatchObject({ lig_pa: 5, lig_pv_fixe: true, lig_pv: 5.75 });
    expect(s.document).toMatchObject({ ent_date: '2025-09-18', ent_mode_calcul_ouvrage: 'B', ent_proprietes: { mode_reglement: 'VIR' } });
    expect(s.correspondances.unites_inconnues).toEqual([{ unite: 'ZZ', nombre: 1 }]);
    expect(s.correspondances.natures_absentes).toEqual([{ nature: '(sans nature)', nombre: 1 }]);
  });

  it('retrouve les montants du logiciel d\'origine après calcul', () => {
    const r = calculerDocument({
      document: { ent_id: 0, ent_tyd_id: 1, ent_std_id: 1, ent_precision_montant: 2, ...s.document },
      lignes: s.lignes, taux_tva: DEFINITION.taux_tva, entites: {}, options: {}, metres: [], variables: [],
    });
    const e = ecartsImport(r, s.controles, 1697.5);
    expect(e).toMatchObject({ total_calcule: 1697.5, ecart_total: 0, lignes: [] });
    // Ouvrage au PVU d'origine (95) alors que son sous-détail vaut 93,5 : pas de ventilation, la composante garde son prix.
    const par = (libelle) => r.lignes.find((l) => l.lig_libelle_html === libelle);
    expect(Number(par('Ouvrage').lig_pv)).toBe(95);
    expect(Number(par('MO').lig_pv)).toBe(33);
    expect(r.lignes.some((l) => l.lig_is_ecart_arrondi)).toBe(false);
    expect(r.lignes.find((l) => l.lig_libelle_html === 'Ouvrage').lig_numerotation).toBe('7.3');
  });
});
