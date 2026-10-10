import { TL, estChiffree } from '../calcul/index.js';
import { CFG_LIGNES as C, ancetres, parId } from './arbre.js';

// Dictionnaire des variables et données utilisables dans une formule à un point du document.
// Règles de portée du moteur : $$ document, $ titre (et titres englobants), @@ ouvrage (et ouvrages
// englobants), @ ligne courante ; seules les variables définies avant la ligne (ordre du document) sont lisibles.

function contexte(lignes, index, owner, type) {
  if (!owner) return null;
  if (owner.lig_tyl_id === type) return owner.lig_id;
  return ancetres(C, lignes, owner.lig_id).find((a) => a.lig_tyl_id === type)?.lig_id ?? null;
}

/**
 * Entrées du dictionnaire pour une ligne : [{ valeur: '{{ref}}', libelle, detail, groupe }].
 * `pourDefinition` : formules de l'onglet Définition (évaluées après la quantité de la ligne).
 */
export function dictionnaire(editeur, ligId, { pourDefinition = false } = {}) {
  const saisie = editeur.saisie;
  const res = editeur.resultat;
  const lignes = saisie.lignes;
  const index = parId(C, lignes);
  const ligne = index.get(ligId);
  if (!ligne) return [];
  const rang = new Map(res.lignes.map((l, i) => [l.lig_id, i]));
  const rangLigne = rang.get(ligId) ?? Infinity;
  const titresLigne = new Set([ligne, ...ancetres(C, lignes, ligId)].filter((x) => x.lig_tyl_id === TL.TITRE).map((x) => x.lig_id));
  const ouvragesLigne = new Set([ligne, ...ancetres(C, lignes, ligId)].filter((x) => x.lig_tyl_id === TL.OUVRAGE).map((x) => x.lig_id));
  const valeursVar = new Map(res.variables.map((v) => [v.var_id, v.var_valeur]));
  const metresCalc = new Map(res.metres.map((m) => [m.mtr_id, m]));
  const mliCalc = new Map(res.metre_lignes.map((m) => [m.mli_id, m]));

  const accessible = (portee, ownerId) => {
    const owner = ownerId === null || ownerId === undefined ? null : index.get(ownerId);
    if (owner && (rang.get(owner.lig_id) ?? Infinity) > rangLigne) return false;
    switch (portee) {
      case '$$': return true;
      case '$': return titresLigne.has(contexte(lignes, index, owner, TL.TITRE));
      case '@@': return ouvragesLigne.has(contexte(lignes, index, owner, TL.OUVRAGE));
      case '@': return owner?.lig_id === ligId;
      default: return false;
    }
  };

  const vus = new Map();
  const ajouter = (cible, ownerId, valeur, source) => {
    const m = /^(\$\$|\$|@@|@)(.+)$/.exec((cible ?? '').trim());
    if (!m || !accessible(m[1], ownerId)) return;
    vus.set(`${m[1]}${m[2]}`, { valeur, source, portee: m[1] });
  };
  for (const v of saisie.variables) ajouter(`${v.var_portee}${v.var_nom}`, v.var_lig_id, valeursVar.get(v.var_id), v.var_lig_id ? 'variable de ligne' : 'variable du document');
  for (const m of saisie.metres) if (m.mtr_variable) ajouter(m.mtr_variable, m.mtr_lig_id, metresCalc.get(m.mtr_id)?.mtr_resultat, 'résultat de métré');
  for (const x of saisie.metre_lignes) {
    if (!x.mli_variable) continue;
    const m = saisie.metres.find((y) => y.mtr_id === x.mli_mtr_id);
    ajouter(x.mli_variable, m?.mtr_lig_id, mliCalc.get(x.mli_id)?.mli_valeur, 'ligne de métré');
  }
  const PORTEES = { '$$': 'document', '$': 'titre', '@@': 'ouvrage', '@': 'ligne' };
  const entrees = [...vus].sort(([a], [b]) => a.localeCompare(b)).map(([ref, v]) => ({
    valeur: `{{${ref}}}`, libelle: `${PORTEES[v.portee]} · ${v.source}`, detail: v.valeur ?? '—', groupe: 'Variables',
  }));

  const donnees = [['lig_qte', 'Quantité saisie'], ['lig_pa', 'Prix d\'achat'], ['lig_coef_perte', 'Coefficient de perte']];
  if (pourDefinition) donnees.push(['lig_qte_vendue', 'Quantité vendue'], ['lig_qte_totale', 'Quantité totale']);
  for (const [col, lib] of donnees) entrees.push({ valeur: `{{${col}}}`, libelle: lib, detail: ligne[col] ?? '', groupe: 'Ligne' });
  const parent = index.get(ligne.lig_parent_id);
  if (parent && estChiffree(parent)) {
    const pc = res.lignes.find((l) => l.lig_id === parent.lig_id);
    entrees.push({ valeur: `{{document_ligne[${parent.lig_id}].lig_qte_vendue}}`, libelle: 'Quantité de l\'ouvrage parent', detail: pc?.lig_qte_vendue ?? '', groupe: 'Ligne' });
  }
  if (ligne.lig_art_id) entrees.push({ valeur: '{{article.art_poids}}', libelle: 'Poids de l\'article', detail: '', groupe: 'Article' });
  return entrees;
}
