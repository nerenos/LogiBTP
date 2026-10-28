// Compositions des équipes (cœur, référentiel des ressources) : une équipe est une suite de compositions datées par
// leur seul début ; chacune vaut jusqu'au début de la suivante (ni trou ni chevauchement), la dernière sans fin. Membres :
// salariés, intérimaires, matériels, sous-traitants ou autres équipes (renfort d'une équipe qui en encadre d'autres) ;
// au plus un chef par composition (salarié ou intérimaire, contact des communications). En base : les compositions
// (`equipe_periode`, commentaire) et une ligne par membre et par suite continue de compositions (`equipe_composition`).
// Répliqué dans ReglesEquipes.cs (jeu tests/ressources/03_equipes.json).
import { ajouterJours } from '@logibtp/socle';

export const TYPES_MEMBRE = ['SALARIE', 'INTERIM', 'MATERIEL', 'SOUS_TRAITANT', 'EQUIPE'];
export const TYPES_CHEF = ['SALARIE', 'INTERIM'];

export const MESSAGES_EQUIPES = {
  EQU_CODE: 'Code de l\'équipe obligatoire',
  EQU_LIBELLE: 'Libellé de l\'équipe obligatoire',
  EQU_PERIODE: 'Date de début de la composition obligatoire',
  EQU_DATE_DOUBLE: 'Deux compositions commencent le même jour',
  EQU_TYPE: 'Type de membre inconnu',
  EQU_DOUBLON: 'Membre présent deux fois dans la composition',
  EQU_SOI: 'Une équipe ne peut pas se contenir elle-même',
  EQU_CHEF_TYPE: 'Le chef d\'équipe est un salarié ou un intérimaire',
  EQU_CHEFS: 'Un seul chef d\'équipe par composition',
  EQU_CYCLE: 'Une équipe ne peut pas contenir une équipe qui la contient',
  EQU_ORDRE: 'Une composition ne peut pas commencer avant une composition plus ancienne non chargée',
  EQU_VERSION: 'L\'équipe a été modifiée par ailleurs',
  EQU_VERROU: 'L\'équipe est en cours de modification par un autre utilisateur',
};

const cle = (m) => `${m.type}:${m.id}`;
/** Comparaisons identiques en C# : ordinale pour les textes, numérique pour deux identifiants numériques. */
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compId = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : ordinal(a, b));
const trierMembres = (l) => l.sort((a, b) => Number(b.chef) - Number(a.chef) || ordinal(a.type, b.type) || compId(String(a.id), String(b.id)));

/** Compositions triées par début, chacune avec sa fin : la veille du début de la suivante (la dernière : null). */
export function finsPeriodes(periodes) {
  const t = periodes.filter((p) => p.du).sort((a, b) => ordinal(a.du, b.du));
  return t.map((p, i) => ({ ...p, au: i + 1 < t.length ? ajouterJours(t[i + 1].du, -1) : null }));
}

/** Lignes de composition [{ type, id, du, au | null, chef }] et débuts des compositions → compositions datées (membres au début de chacune). */
export function periodesDepuisLignes(lignes, debuts) {
  const t = [...new Set(debuts)].sort(ordinal);
  return t.map((du, i) => ({
    du,
    au: i + 1 < t.length ? ajouterJours(t[i + 1], -1) : null,
    membres: trierMembres(lignes.filter((l) => l.du <= du && (!l.au || l.au >= du)).map((l) => ({ type: l.type, id: String(l.id), chef: Boolean(l.chef) }))),
  }));
}

/**
 * Compositions → lignes : un membre présent dans des compositions successives avec le même rôle (chef ou non) fait une
 * seule ligne ; tri par type, identifiant puis début.
 */
export function lignesDepuisPeriodes(periodes) {
  const ouvertes = new Map();
  const r = [];
  for (const p of finsPeriodes(periodes)) {
    for (const m of p.membres) {
      const k = `${cle(m)}|${m.chef ? 1 : 0}`;
      const l = ouvertes.get(k);
      if (l && l.au && ajouterJours(l.au, 1) === p.du) l.au = p.au;
      else {
        const n = { type: m.type, id: String(m.id), du: p.du, au: p.au, chef: Boolean(m.chef) };
        ouvertes.set(k, n);
        r.push(n);
      }
    }
  }
  return r.sort((a, b) => ordinal(a.type, b.type) || compId(a.id, b.id) || ordinal(a.du, b.du));
}

/**
 * Contrôle d'une équipe saisie : [{ code, periode }] (periode : indice dans la saisie, null pour l'équipe), triés.
 * `id` : identifiant de l'équipe (null à la création) pour refuser qu'elle se contienne.
 */
export function controlerEquipe({ id = null, code, libelle, periodes }) {
  const r = [];
  if (!String(code ?? '').trim()) r.push({ code: 'EQU_CODE', periode: null });
  if (!String(libelle ?? '').trim()) r.push({ code: 'EQU_LIBELLE', periode: null });
  const vus = new Set();
  periodes.forEach((p, i) => {
    if (!p.du) r.push({ code: 'EQU_PERIODE', periode: i });
    else if (vus.has(p.du)) r.push({ code: 'EQU_DATE_DOUBLE', periode: i });
    vus.add(p.du);
    const cles = p.membres.map(cle);
    if (p.membres.some((m) => !TYPES_MEMBRE.includes(m.type))) r.push({ code: 'EQU_TYPE', periode: i });
    if (new Set(cles).size !== cles.length) r.push({ code: 'EQU_DOUBLON', periode: i });
    if (id != null && p.membres.some((m) => m.type === 'EQUIPE' && String(m.id) === String(id))) r.push({ code: 'EQU_SOI', periode: i });
    if (p.membres.some((m) => m.chef && !TYPES_CHEF.includes(m.type))) r.push({ code: 'EQU_CHEF_TYPE', periode: i });
    if (p.membres.filter((m) => m.chef).length > 1) r.push({ code: 'EQU_CHEFS', periode: i });
  });
  return r.sort((a, b) => (a.periode ?? -1) - (b.periode ?? -1) || ordinal(a.code, b.code));
}

/** Composition qui couvre une date (compositions datées : `au` renseigné), null sinon. */
export const periodeA = (periodes, date) => periodes.find((p) => p.du <= date && (!p.au || p.au >= date)) ?? null;
