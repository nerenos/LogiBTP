// Choix du chantier ou de l'ordre à la borne (lot 10 des demandes du 25/10/2026, A30) : tuiles des chantiers (proposés,
// récents, ou tous) et des ordres en cours, filtrées en direct par le champ de saisie sur le code, le libellé, la ville,
// le client, le numéro et l'objet de l'ordre ; chaque mot saisi doit se retrouver (casse et accents indifférents).

const normaliser = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/**
 * Tuiles du choix : chantiers puis ordres ({ genre: 'chantier' | 'ordre', id, cha_id, ent_id, code, libelle, detail, texte }).
 * Un ordre porte le code de son chantier dans son détail et dans le texte filtré.
 */
export function tuilesChoix(chantiers, ordres = []) {
  const parId = new Map(chantiers.map((c) => [c.id, c]));
  return [
    ...chantiers.map((c) => ({
      genre: 'chantier', id: c.id, cha_id: c.id, ent_id: null, code: c.code, libelle: c.libelle ?? '',
      detail: [c.ville, c.client].filter(Boolean).join(' · '),
      texte: normaliser([c.code, c.libelle, c.ville, c.client].join(' ')),
    })),
    ...ordres.map((o) => {
      const c = parId.get(o.cha_id);
      return {
        genre: 'ordre', id: `o${o.id}`, cha_id: o.cha_id, ent_id: o.id, code: o.numero ?? `#${o.id}`, libelle: o.objet ?? '',
        detail: [o.type, c?.code].filter(Boolean).join(' · '),
        texte: normaliser([o.numero, o.objet, o.type, c?.code, c?.libelle, c?.ville, c?.client].join(' ')),
      };
    }),
  ];
}

/** Tuiles dont le texte contient chaque mot de la saisie (toutes si la saisie est vide). */
export function filtrerChoix(tuiles, saisie) {
  const mots = normaliser(saisie).split(/\s+/).filter(Boolean);
  return mots.length ? tuiles.filter((t) => mots.every((m) => t.texte.includes(m))) : tuiles;
}

/** Tuile désignée exactement par la saisie (code d'un chantier ou numéro d'un ordre), sinon null. */
export function tuileExacte(tuiles, saisie) {
  const s = normaliser(saisie).trim();
  return s ? tuiles.find((t) => normaliser(t.code) === s) ?? null : null;
}
