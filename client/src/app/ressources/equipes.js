// Compositions des équipes (cœur, référentiel des ressources) : une équipe est faite de périodes souples (du, au
// facultatif), chacune avec ses membres — salariés, intérimaires, matériels, sous-traitants ou autres équipes (renfort
// d'une équipe qui en encadre d'autres) — et au plus un chef (salarié ou intérimaire, contact des communications).
// En base, une ligne par membre et par période continue (`equipe_composition`). Répliqué dans ReglesEquipes.cs
// (jeu tests/ressources/03_equipes.json).

export const TYPES_MEMBRE = ['SALARIE', 'INTERIM', 'MATERIEL', 'SOUS_TRAITANT', 'EQUIPE'];
export const TYPES_CHEF = ['SALARIE', 'INTERIM'];

export const MESSAGES_EQUIPES = {
  EQU_CODE: 'Code de l\'équipe obligatoire',
  EQU_LIBELLE: 'Libellé de l\'équipe obligatoire',
  EQU_PERIODE: 'Période : début obligatoire, fin après le début',
  EQU_CHEVAUCHEMENT: 'Les périodes se chevauchent',
  EQU_TYPE: 'Type de membre inconnu',
  EQU_DOUBLON: 'Membre présent deux fois dans la période',
  EQU_SOI: 'Une équipe ne peut pas se contenir elle-même',
  EQU_CHEF_TYPE: 'Le chef d\'équipe est un salarié ou un intérimaire',
  EQU_CHEFS: 'Un seul chef d\'équipe par période',
  EQU_CYCLE: 'Une équipe ne peut pas contenir une équipe qui la contient',
};

/** « AAAA-MM-JJ » + n jours. */
export function ajouterJours(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const cle = (m) => `${m.type}:${m.id}`;
/** Comparaisons identiques en C# : ordinale pour les textes, numérique pour deux identifiants numériques. */
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compId = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : ordinal(a, b));
const trierMembres = (l) => l.sort((a, b) => Number(b.chef) - Number(a.chef) || ordinal(a.type, b.type) || compId(String(a.id), String(b.id)));

/**
 * Lignes de composition [{ type, id, du, au | null, chef }] → périodes [{ du, au | null, membres: [{ type, id, chef }] }] :
 * une période par intervalle entre deux changements (entrée, sortie, chef) ; les intervalles sans membre sont omis.
 */
export function periodesDepuisLignes(lignes) {
  const bornes = [...new Set(lignes.flatMap((l) => [l.du, ...(l.au ? [ajouterJours(l.au, 1)] : [])]))].sort();
  const r = [];
  for (let i = 0; i < bornes.length; i++) {
    const du = bornes[i];
    const au = i + 1 < bornes.length ? ajouterJours(bornes[i + 1], -1) : null;
    const membres = lignes.filter((l) => l.du <= du && (!l.au || l.au >= du)).map((l) => ({ type: l.type, id: String(l.id), chef: Boolean(l.chef) }));
    // Après la dernière borne, seuls les membres sans fin restent : la dernière période est alors ouverte.
    if (membres.length) r.push({ du, au, membres: trierMembres(membres) });
  }
  return r;
}

/**
 * Périodes → lignes de composition : un membre présent dans des périodes contiguës avec le même rôle (chef ou non)
 * fait une seule ligne ; tri par type, identifiant puis début.
 */
export function lignesDepuisPeriodes(periodes) {
  const triees = [...periodes].sort((a, b) => a.du.localeCompare(b.du));
  const ouvertes = new Map();
  const r = [];
  for (const p of triees) {
    for (const m of p.membres) {
      const k = `${cle(m)}|${m.chef ? 1 : 0}`;
      const l = ouvertes.get(k);
      if (l && l.au && ajouterJours(l.au, 1) === p.du) l.au = p.au ?? null;
      else {
        const n = { type: m.type, id: String(m.id), du: p.du, au: p.au ?? null, chef: Boolean(m.chef) };
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
  periodes.forEach((p, i) => {
    if (!p.du || (p.au && p.au < p.du)) r.push({ code: 'EQU_PERIODE', periode: i });
    const cles = p.membres.map(cle);
    if (p.membres.some((m) => !TYPES_MEMBRE.includes(m.type))) r.push({ code: 'EQU_TYPE', periode: i });
    if (new Set(cles).size !== cles.length) r.push({ code: 'EQU_DOUBLON', periode: i });
    if (id != null && p.membres.some((m) => m.type === 'EQUIPE' && String(m.id) === String(id))) r.push({ code: 'EQU_SOI', periode: i });
    if (p.membres.some((m) => m.chef && !TYPES_CHEF.includes(m.type))) r.push({ code: 'EQU_CHEF_TYPE', periode: i });
    if (p.membres.filter((m) => m.chef).length > 1) r.push({ code: 'EQU_CHEFS', periode: i });
  });
  const triees = periodes.map((p, i) => ({ ...p, i })).filter((p) => p.du).sort((a, b) => a.du.localeCompare(b.du));
  for (let k = 1; k < triees.length; k++) {
    const prec = triees[k - 1];
    if (!prec.au || prec.au >= triees[k].du) r.push({ code: 'EQU_CHEVAUCHEMENT', periode: triees[k].i });
  }
  return r.sort((a, b) => (a.periode ?? -1) - (b.periode ?? -1) || ordinal(a.code, b.code));
}

/** Période qui couvre une date (null sinon). */
export const periodeA = (periodes, date) => periodes.find((p) => p.du <= date && (!p.au || p.au >= date)) ?? null;
