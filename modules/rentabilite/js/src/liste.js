// Liste de la Rentabilité (ANALYSE-MODULE-ANALYSE.md § 6) : colonnes du Détail plus acomptes en trésorerie, rapports et
// heures de main-d'œuvre ; arbre multi-origine (chargé d'affaires › affaire › chantier › ordre, ou affaire › chantier ›
// ordre), total figé en pied ; lignes affichées selon les nœuds ouverts ; lignes du CSV. Calculs en décimal.
import { arrondir, Dz } from '@logibtp/socle';
import { texte } from '@logibtp/socle/dictionnaire';
import { INDICATEUR, COMPOSANTE, NIVEAU_LISTE } from './codes.js';
import { COLONNES_DETAIL, COUT, SENS, valeursColonnes } from './indicateurs.js';

/** Rapport a / b (Decimal en %), null si la base est nulle. */
const pourcent = (a, b) => (b.isZero() ? null : a.times(100).dividedBy(b));

/** Partie positive (Decimal) : la valeur, ou zéro si elle est négative. */
const positif = (v) => (v.isNegative() ? Dz(0) : v);

/** Colonnes de la Liste : celles du Détail, rapports, heures de main-d'œuvre et acomptes en trésorerie (R6). */
export const COLONNES_LISTE = Object.freeze([
  ...COLONNES_DETAIL,
  Object.freeze({ code: 'pct_depense', calcul: (v) => pourcent(v.depense, v.budget_execution), pourcent: true, faits: [INDICATEUR.ENGAGE, INDICATEUR.DEBOURSE], sens: SENS.LIBRE, teinte: 'depense' }),
  Object.freeze({ code: 'pct_facture', calcul: (v) => pourcent(v.facture, v.budget_pv), pourcent: true, faits: [INDICATEUR.FACTURE], sens: SENS.LIBRE, teinte: 'facture' }),
  Object.freeze({ code: 'heures', indicateurs: [INDICATEUR.DEBOURSE], champ: 'heures', periode: true, heures: true, faits: [INDICATEUR.DEBOURSE], sens: SENS.POSITIF, teinte: 'debourse' }),
  Object.freeze({ code: 'acompte_paye', indicateurs: [INDICATEUR.ACOMPTE_PAYE], champ: 'pv', faits: [INDICATEUR.ACOMPTE_PAYE], sens: SENS.POSITIF, teinte: 'acompte' }),
  Object.freeze({ code: 'acompte_utilise', indicateurs: [INDICATEUR.ACOMPTE_UTILISE], champ: 'pv', faits: [INDICATEUR.ACOMPTE_UTILISE], sens: SENS.POSITIF, teinte: 'acompte' }),
  Object.freeze({ code: 'acompte_reste', calcul: (v) => v.acompte_paye.minus(v.acompte_utilise), faits: [INDICATEUR.ACOMPTE_PAYE, INDICATEUR.ACOMPTE_UTILISE], sens: SENS.POSITIF, teinte: 'acompte' }),
  // Production (§ 4.12, lot 4) : réalisé (lignes facturées, sans acomptes ni postes : Q15), production des situations de
  // production, factures à établir (production > réalisé) et produits constatés d'avance (réalisé > production) au cumul.
  Object.freeze({ code: 'realise', indicateurs: [INDICATEUR.FACTURE], composante: COMPOSANTE.VENTE, champ: 'pv', periode: true, faits: [INDICATEUR.FACTURE], sens: SENS.POSITIF, teinte: 'facture' }),
  Object.freeze({ code: 'production', indicateurs: [INDICATEUR.PRODUCTION], champ: 'pv', periode: true, faits: [INDICATEUR.PRODUCTION], sens: SENS.POSITIF, teinte: 'production' }),
  Object.freeze({ code: 'fae', calcul: (v) => positif(v.production.minus(v.realise)), faits: [INDICATEUR.PRODUCTION, INDICATEUR.FACTURE], sens: SENS.POSITIF, teinte: 'production' }),
  Object.freeze({ code: 'pca', calcul: (v) => positif(v.realise.minus(v.production)), faits: [INDICATEUR.PRODUCTION, INDICATEUR.FACTURE], sens: SENS.POSITIF, teinte: 'production' }),
]);

const parLibelle = (a, b) => (a.dernier - b.dernier) || a.libelle.localeCompare(b.libelle, 'fr');

/**
 * Arbre de la Liste. chantiers : [{ id, code, libelle, affaire_id, affaire_code, affaire, charge_id, charge }] ;
 * agregats : [{ cha_id, ordre_id, indicateur, composante, pa, pr, pv, heures, *_periode }] ; ordres : [{ cha_id, id,
 * numero, libelle }] ; niveau : CHARGE (chargé d'affaires › affaire › chantier › ordre) ou AFFAIRE (affaire › chantier ›
 * ordre). Chaque nœud : { type, cle, libelle, valeurs, chantiers (identifiants), chantier, ordre (null, 0 = sans ordre,
 * id), enfants }. Les ordres d'un chantier ne sont détaillés que s'il en a au moins un ; « Sans ordre » regroupe le reste.
 */
export function arbreListe({ chantiers, agregats, ordres = [], niveau = NIVEAU_LISTE.AFFAIRE, cout = COUT.PR, periode = false }) {
  const valeurs = (l) => valeursColonnes(l, cout, { periode, colonnes: COLONNES_LISTE });
  const parChantier = new Map(chantiers.map((c) => [c.id, []]));
  for (const a of agregats) parChantier.get(a.cha_id)?.push(a);
  const ordresDe = new Map();
  for (const o of ordres) {
    if (!ordresDe.has(o.cha_id)) ordresDe.set(o.cha_id, new Map());
    ordresDe.get(o.cha_id).set(o.id, o);
  }

  const noeudChantier = (c) => {
    const lus = parChantier.get(c.id) ?? [];
    const avecOrdre = lus.filter((a) => a.ordre_id !== null && a.ordre_id !== undefined);
    const enfants = [];
    if (avecOrdre.length) {
      const connus = ordresDe.get(c.id) ?? new Map();
      for (const id of [...new Set(avecOrdre.map((a) => a.ordre_id))]) {
        const o = connus.get(id);
        enfants.push({ type: 'ordre', cle: `o${id}`, libelle: o ? [o.numero, o.libelle].filter(Boolean).join(' – ') : String(id), numero: o?.numero ?? '',
          valeurs: valeurs(avecOrdre.filter((a) => a.ordre_id === id)), chantiers: [c.id], chantier: c.id, ordre: id, enfants: [] });
      }
      enfants.sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'fr', { numeric: true }));
      const sans = lus.filter((a) => a.ordre_id === null || a.ordre_id === undefined);
      if (sans.length) {
        enfants.push({ type: 'sans_ordre', cle: `o0c${c.id}`, libelle: texte('rentabilite.liste.sans_ordre'), valeurs: valeurs(sans),
          chantiers: [c.id], chantier: c.id, ordre: 0, enfants: [] });
      }
    }
    return { type: 'chantier', cle: `c${c.id}`, libelle: [c.code, c.libelle].filter(Boolean).join(' – '), code: c.code, valeurs: valeurs(lus),
      chantiers: [c.id], chantier: c.id, ordre: null, enfants };
  };

  /** Regroupe des chantiers (identifiants) par une clé ; `vers` construit les enfants d'un groupe. */
  const grouper = (liste, type, cle, libelle, vers) => {
    const groupes = new Map();
    for (const c of liste) {
      const k = cle(c) ?? 0;
      if (!groupes.has(k)) groupes.set(k, { k, liste: [], libelle: libelle(c), dernier: k === 0 ? 1 : 0 });
      groupes.get(k).liste.push(c);
    }
    return [...groupes.values()].sort(parLibelle).map((g) => ({
      type, cle: `${type}${g.k}`,
      libelle: g.libelle, valeurs: valeurs(g.liste.flatMap((c) => parChantier.get(c.id) ?? [])),
      chantiers: g.liste.map((c) => c.id), chantier: null, ordre: null, enfants: vers(g.liste),
    }));
  };
  const charge = (c) => c.charge_id;
  const versChantiers = (liste) => [...liste].sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr', { numeric: true })).map(noeudChantier);
  const versAffaires = (prefixe) => (liste) => grouper(liste, 'affaire', (c) => c.affaire_id,
    (c) => (c.affaire_id ? [c.affaire_code, c.affaire].filter(Boolean).join(' – ') : texte('rentabilite.liste.sans_affaire')), versChantiers)
    .map((n) => ({ ...n, cle: `${prefixe}${n.cle}` }));

  const enfants = niveau === NIVEAU_LISTE.CHARGE
    ? grouper(chantiers, 'charge', charge, (c) => (c.charge_id ? c.charge ?? String(c.charge_id) : texte('rentabilite.liste.sans_charge')),
      (liste) => versAffaires(`ch${liste[0].charge_id ?? 0}-`)(liste))
    : versAffaires('')(chantiers);
  return { type: 'total', cle: 'total', libelle: texte('rentabilite.liste.total'), valeurs: valeurs(agregats.filter((a) => parChantier.has(a.cha_id))),
    chantiers: chantiers.map((c) => c.id), chantier: null, ordre: null, enfants };
}

/** Lignes affichées de l'arbre (sans le total) : un nœud ouvert montre ses enfants ; chaque ligne porte sa profondeur. */
export function lignesListe(racine, ouverts = new Set()) {
  const lignes = [];
  const parcourir = (noeuds, profondeur) => {
    for (const n of noeuds) {
      lignes.push({ ...n, profondeur, ouvert: ouverts.has(n.cle), feuille: !n.enfants.length });
      if (n.enfants.length && ouverts.has(n.cle)) parcourir(n.enfants, profondeur + 1);
    }
  };
  parcourir(racine.enfants, 0);
  return lignes;
}

/** Clés de tous les nœuds ayant des enfants jusqu'au type donné inclus (tout ouvrir jusqu'aux chantiers, par exemple). */
export function clesJusqua(racine, type) {
  const cles = [];
  const parcourir = (noeuds) => {
    for (const n of noeuds) {
      if (!n.enfants.length) continue;
      if (n.type === type) { cles.push(n.cle); continue; }
      cles.push(n.cle);
      parcourir(n.enfants);
    }
  };
  parcourir(racine.enfants);
  return cles;
}

/** Valeur arrondie pour l'affichage ou l'export (arrondi unique du socle) : `decimales` (0 ou 2) ; null reste null. */
export const arrondiAffiche = (v, decimales = 2) => (v === null || v === undefined ? null : arrondir(v, decimales));
