import { ERREUR_FUSION } from './codes.js';

// Fusions de doublons de la reprise d'une base (plan reprise-mde-optim, lot 3). Règles répliquées dans
// LogiBTP.Import/Reprise/FusionsReprise.cs (Controler).

const nettoyer = (cle) => String(cle ?? '').trimEnd();

/**
 * Groupes de fusion à enregistrer d'après les choix de l'écran : pour chaque doublon proposé (rang dans `doublons`),
 * `{ fusionner, conservee }` ; les autres fiches du doublon sont fusionnées dans la conservée.
 * @returns {{ table_source: string, cle_conservee: string, cles_fusionnees: string[] }[]}
 */
export function groupesFusion(doublons, choix) {
  const groupes = [];
  doublons.forEach((d, i) => {
    const c = choix[i];
    if (!c?.fusionner) return;
    const conservee = nettoyer(c.conservee ?? d.fiches[0]?.cle);
    groupes.push({
      table_source: d.table,
      cle_conservee: conservee,
      cles_fusionnees: d.fiches.map((f) => nettoyer(f.cle)).filter((cle) => cle !== conservee),
    });
  });
  return groupes;
}

/**
 * Contrôle des groupes : au moins une clé fusionnée, la conservée hors des fusionnées, une clé une seule fois par table.
 * @returns {{ code: string, rang: number, cle: string }[]}
 */
export function controlerFusions(groupes) {
  const erreurs = [];
  const vues = new Set();
  groupes.forEach((g, rang) => {
    const conservee = nettoyer(g.cle_conservee);
    const fusionnees = (g.cles_fusionnees ?? []).map(nettoyer);
    if (fusionnees.length === 0) { erreurs.push({ code: ERREUR_FUSION.GROUPE_VIDE, rang, cle: conservee }); return; }
    if (fusionnees.includes(conservee)) erreurs.push({ code: ERREUR_FUSION.CONSERVEE_FUSIONNEE, rang, cle: conservee });
    for (const cle of new Set([conservee, ...fusionnees])) {
      const k = `${g.table_source}\u0000${cle}`;
      if (vues.has(k)) erreurs.push({ code: ERREUR_FUSION.CLE_EN_DOUBLE, rang, cle });
      vues.add(k);
    }
  });
  return erreurs;
}

/** Choix initiaux de l'écran : un doublon déjà retenu (même table, une de ses clés conservée) est coché. */
export function choixDepuisFusions(doublons, fusions) {
  return doublons.map((d) => {
    const cles = new Set(d.fiches.map((f) => nettoyer(f.cle)));
    const f = fusions.find((x) => x.table_source === d.table && cles.has(nettoyer(x.cle_conservee)));
    return f ? { fusionner: true, conservee: nettoyer(f.cle_conservee) } : { fusionner: false, conservee: nettoyer(d.fiches[0]?.cle) };
  });
}
