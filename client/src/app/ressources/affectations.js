// Affectations d'un matériel (lot 5b des demandes du 25/10/2026), répliquées dans ReglesAffectations.cs (jeu
// tests/ressources/04_affectations.json) : une affectation datée (du, au facultatif = en cours) à un salarié, un
// intérimaire, un sous-traitant ou un autre matériel (porteur : petit outillage dans un camion) ; une seule à la fois.
import { TYPE_RESSOURCE } from '../codes.js';

export const TYPES_AFFECTATION = Object.values(TYPE_RESSOURCE);

export const LIBELLES_AFFECTATION = { SALARIE: 'Salarié', INTERIM: 'Intérimaire', SOUS_TRAITANT: 'Sous-traitant', MATERIEL: 'Matériel (porteur)' };

export const MESSAGES_AFFECTATIONS = {
  AFF_TYPE: 'Type d\'affectation inconnu',
  AFF_CIBLE: 'Affecté à qui ?',
  AFF_DATE: 'Début obligatoire, fin après le début',
  AFF_SOI: 'Un matériel ne s\'affecte pas à lui-même',
  AFF_CHEVAUCHEMENT: 'Une seule affectation à la fois : périodes qui se chevauchent',
  AFF_BOUCLE: 'Matériels porteurs en boucle',
};

const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const FIN = '9999-12-31';

/** Erreurs d'une saisie [{ code, affectation }], triées par affectation puis code. */
export function controlerAffectations(materiel, affectations) {
  const r = [];
  affectations.forEach((a, i) => {
    if (!TYPES_AFFECTATION.includes(a.type)) r.push({ code: 'AFF_TYPE', affectation: i });
    if (!String(a.id ?? '').trim()) r.push({ code: 'AFF_CIBLE', affectation: i });
    const datesValables = (x) => Boolean(x.du) && !(x.au && x.au < x.du);
    if (!datesValables(a)) r.push({ code: 'AFF_DATE', affectation: i });
    if (a.type === 'MATERIEL' && String(a.id) === String(materiel)) r.push({ code: 'AFF_SOI', affectation: i });
    // Chevauchement avec une affectation précédente (dates valables des deux côtés).
    const chevauche = datesValables(a) && affectations.slice(0, i).some((b) => datesValables(b) && a.du <= (b.au ?? FIN) && b.du <= (a.au ?? FIN));
    if (chevauche) r.push({ code: 'AFF_CHEVAUCHEMENT', affectation: i });
  });
  return r.sort((a, b) => a.affectation - b.affectation || ordinal(a.code, b.code));
}

/** Indice de l'affectation qui couvre la date (ISO), null sinon. */
export function affectationA(affectations, date) {
  const i = affectations.findIndex((a) => a.du && a.du <= date && (!a.au || a.au >= date));
  return i < 0 ? null : i;
}
