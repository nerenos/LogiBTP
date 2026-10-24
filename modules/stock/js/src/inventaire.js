import { D, Dz, S } from '@logibtp/socle';

// Lot d'inventaire (ANALYSE-MODULE-STOCK.md § 5.3, S6, S30), répliqué dans ReglesInventaire.cs (jeu
// modules/stock/tests/cas/03_inventaire.json) : les lignes de tous les bordereaux du lot sont cumulées par article ; une
// ligne sans quantité n'est pas comptée (l'article n'est pas mis à 0) ; un article compté plusieurs fois au même
// emplacement est signalé (avertissement, jamais refusé) ; un prix saisi (valeur d'inventaire : stock lent, obsolète…)
// vaut pour l'article, deux prix différents sont refusés ; « Appliquer au PMP » exige un prix.

export const MESSAGES_INVENTAIRE = {
  INV_DOUBLON_EMPLACEMENT: 'Article compté plusieurs fois au même emplacement : les quantités sont cumulées',
  INV_QUANTITE_NEGATIVE: 'Quantité comptée négative',
  INV_PRIX_DIFFERENTS: 'Deux prix d\'inventaire différents pour le même article',
  INV_PMP_SANS_PRIX: '« Appliquer au PMP » sans prix saisi',
};

const vide = (v) => v === null || v === undefined || v === '';

/**
 * Entrée : lignes [{ bordereau, ele, emp, quantite, prix, appliquer_pmp, commentaire }]. Résultat : { comptages: [{ ele,
 * quantite, prix, appliquer_pmp, commentaire, lignes }], avertissements: [{ code, ele, emp, nombre }], erreurs: [{ code,
 * ele }] }, articles dans l'ordre de leur première ligne comptée.
 */
export function controlerLot({ lignes = [] }) {
  const parArticle = new Map();
  const parEmplacement = new Map();
  const erreurs = [];
  for (const l of lignes) {
    if (vide(l.quantite)) continue;
    const q = Dz(l.quantite);
    if (q.lt(0)) erreurs.push({ code: 'INV_QUANTITE_NEGATIVE', ele: l.ele });
    const a = parArticle.get(l.ele) ?? { ele: l.ele, quantite: Dz(0), prix: new Set(), appliquer: false, commentaires: [], lignes: 0 };
    a.quantite = a.quantite.plus(q);
    if (!vide(l.prix)) a.prix.add(S(D(l.prix)));
    a.appliquer ||= Boolean(l.appliquer_pmp);
    const c = String(l.commentaire ?? '').trim();
    if (c && !a.commentaires.includes(c)) a.commentaires.push(c);
    a.lignes += 1;
    parArticle.set(l.ele, a);
    if (!vide(l.emp)) {
      const cle = `${l.ele}|${l.emp}`;
      parEmplacement.set(cle, { ele: l.ele, emp: l.emp, nombre: (parEmplacement.get(cle)?.nombre ?? 0) + 1 });
    }
  }
  const comptages = [];
  for (const a of parArticle.values()) {
    if (a.prix.size > 1) erreurs.push({ code: 'INV_PRIX_DIFFERENTS', ele: a.ele });
    if (a.appliquer && a.prix.size === 0) erreurs.push({ code: 'INV_PMP_SANS_PRIX', ele: a.ele });
    comptages.push({ ele: a.ele, quantite: S(a.quantite), prix: a.prix.size === 1 ? [...a.prix][0] : null, appliquer_pmp: a.appliquer && a.prix.size === 1,
      commentaire: a.commentaires.length ? a.commentaires.join(' ; ') : null, lignes: a.lignes });
  }
  const avertissements = [...parEmplacement.values()].filter((x) => x.nombre > 1).map((x) => ({ code: 'INV_DOUBLON_EMPLACEMENT', ...x }));
  return { comptages, avertissements, erreurs };
}
