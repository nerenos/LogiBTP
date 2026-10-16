// Options et variantes à la transformation (CONCEPTION-ACHATS-MARCHES.md, Q11 et Q12), répliqué dans Options.cs
// (jeu modules/document/tests/options/01_unites.json).
//
// Le type de prix est porté par chaque ligne ; sous une tranche option ou variante, toute la descendance a le même
// type. Une unité est donc la ligne la plus haute d'un bloc option (O) ou variante (A) : son parent est absent ou
// vendu (V). Pour une variante, base_id est la ligne dont elle est la variante (lig_variante_de_id), proposée elle
// aussi au choix (l'utilisateur garde la base, la variante, ou les deux). Ordre : identifiants croissants.

/** Unités d'options et de variantes d'un document : [{ lig_id, type_prix, base_id }]. */
export function unitesOptionnelles(lignes) {
  const parId = new Map(lignes.map((l) => [l.lig_id, l]));
  return lignes
    .filter((l) => {
      const t = l.lig_type_prix ?? 'V';
      if (t !== 'O' && t !== 'A') return false;
      const p = l.lig_parent_id === null || l.lig_parent_id === undefined ? null : parId.get(l.lig_parent_id);
      return !p || (p.lig_type_prix ?? 'V') === 'V';
    })
    .map((l) => ({
      lig_id: l.lig_id,
      type_prix: l.lig_type_prix,
      base_id: l.lig_type_prix === 'A' && parId.has(l.lig_variante_de_id) ? l.lig_variante_de_id : null,
    }))
    .sort((a, b) => a.lig_id - b.lig_id);
}
