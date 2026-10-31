// Rétention et archivage par catégorie et type d'élément lié. Même règle que RegleRetention.cs (jeu partagé
// modules/ged/tests/cas/04_retention.json) ; règles par défaut identiques aux INSERT de db/051_ged_organisation.sql.
//   - règle applicable : active, catégorie et type d'élément nuls ou égaux à ceux du document ; la plus précise
//     (catégorie et type, catégorie seule, type seul, aucun), puis la plus petite priorité, puis le plus petit id ;
//   - échéances comptées en mois depuis la date du document (à défaut, la date UTC du dépôt), fin de mois ramenée au
//     dernier jour du mois d'arrivée (31 janvier + 1 mois = 28 ou 29 février) ;
//   - statut à une date : FIN_CONSERVATION (fin atteinte), A_ARCHIVER (archivage atteint), sinon ACTIF.
import { pairesParCode } from '@logibtp/socle/dictionnaire';
import { ajouterMois } from '@logibtp/socle';

export const ACTIONS_FIN = pairesParCode('ged.actions_fin', ['REVOIR', 'DETRUIRE']);

export const REGLES_RETENTION_DEFAUT = [
  { id: 1, libelle: 'Factures reçues', categorie: 'facture_recue', type_element: null, duree_active_mois: 24, duree_conservation_mois: 120, action_fin: 'REVOIR', priorite: 10, actif: true },
  { id: 2, libelle: 'Factures émises', categorie: 'facture_emise', type_element: null, duree_active_mois: 24, duree_conservation_mois: 120, action_fin: 'REVOIR', priorite: 10, actif: true },
  { id: 3, libelle: 'Devis signés', categorie: 'devis_signe', type_element: null, duree_active_mois: 24, duree_conservation_mois: 120, action_fin: 'REVOIR', priorite: 10, actif: true },
  { id: 4, libelle: 'Contrats', categorie: 'contrat', type_element: null, duree_active_mois: 36, duree_conservation_mois: 120, action_fin: 'REVOIR', priorite: 10, actif: true },
  { id: 5, libelle: 'Courriers', categorie: 'courrier', type_element: null, duree_active_mois: 24, duree_conservation_mois: 60, action_fin: 'DETRUIRE', priorite: 50, actif: true },
  { id: 6, libelle: 'Mails', categorie: 'mail', type_element: null, duree_active_mois: 12, duree_conservation_mois: 60, action_fin: 'DETRUIRE', priorite: 50, actif: true },
  { id: 7, libelle: 'Photos et plans', categorie: 'photo', type_element: null, duree_active_mois: 36, duree_conservation_mois: null, action_fin: 'REVOIR', priorite: 50, actif: true },
  { id: 8, libelle: 'Plans', categorie: 'plan', type_element: null, duree_active_mois: 36, duree_conservation_mois: null, action_fin: 'REVOIR', priorite: 50, actif: true },
  { id: 9, libelle: 'Autres documents', categorie: null, type_element: null, duree_active_mois: 60, duree_conservation_mois: null, action_fin: 'REVOIR', priorite: 1000, actif: true },
];

const vide = (v) => v === null || v === undefined || v === '';
const precision = (r) => (vide(r.categorie) ? 0 : 2) + (vide(r.type_element) ? 0 : 1);

/** Règle applicable au document (ou null). */
export function regleRetention(doc, regles) {
  return regles
    .filter((r) => r.actif !== false && (vide(r.categorie) || r.categorie === doc.categorie) && (vide(r.type_element) || r.type_element === doc.type_element))
    .sort((a, b) => precision(b) - precision(a) || (a.priorite ?? 100) - (b.priorite ?? 100) || a.id - b.id)[0] ?? null;
}

export { ajouterMois };

/**
 * Échéances du document à la date `aujourdhui` (AAAA-MM-JJ) :
 * { regle, base, archiver_le, fin_le, action_fin, statut }.
 */
export function echeancesRetention(doc, regles, aujourdhui) {
  const r = regleRetention(doc, regles);
  const base = doc.date_document ? String(doc.date_document).slice(0, 10) : new Date(doc.cree_le).toISOString().slice(0, 10);
  const archiver = r && !vide(r.duree_active_mois) ? ajouterMois(base, Number(r.duree_active_mois)) : null;
  const fin = r && !vide(r.duree_conservation_mois) ? ajouterMois(base, Number(r.duree_conservation_mois)) : null;
  const statut = fin && aujourdhui >= fin ? 'FIN_CONSERVATION' : archiver && aujourdhui >= archiver ? 'A_ARCHIVER' : 'ACTIF';
  return { regle: r?.id ?? null, base, archiver_le: archiver, fin_le: fin, action_fin: r?.action_fin ?? null, statut };
}
