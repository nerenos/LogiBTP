import { texte, pluriel, icone, textesParCode, couleurTheme } from '@logibtp/socle/dictionnaire';
import { urlDocument, urlFiche, TYPE_FICHE } from '../codes.js';
import { FAMILLE_DOCUMENT } from '@logibtp/document';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { parcourirEnLargeur } from '@logibtp/graphe';
import { VueGraphe, tronquer } from '@logibtp/graphe/ui';

// Graphe de la structure des affaires (onglet Graphe des fiches projet, affaire, chantier, marché) : affaires et
// projets en haut, chantiers, marchés, puis les documents rattachés en colonnes sous l'élément le plus précis
// (marché, sinon chantier, affaire, projet) ; liens de transformation entre documents (devis → commande → facture…).
// Parcours en largeur depuis la fiche jusqu'au niveau de représentation choisi (module Graphe).

const CLE = { projet: 'P', affaire: 'A', chantier: 'C', marche: 'M', document: 'D' };
const ORDRE = { affaire: 0, projet: 0, chantier: 1, marche: 2 };
const ICONES = { projet: icone('structure_btp_projet'), affaire: icone('structure_btp_affaire'), chantier: icone('structure_btp_chantier'), marche: icone('structure_btp_marche'), document: icone('structure_btp_document') };
const COULEURS = ['projet', 'affaire', 'chantier', 'marche'];
const LIBELLES = textesParCode('structure_btp.graphe.types', ['projet', 'affaire', 'chantier', 'marche', 'document']);

/** Éléments de la structure liés au départ (chantiers de l'affaire, marchés du chantier, parents…), sans limite de profondeur. */
export function perimetreStructure(refs, depart) {
  const g = construireGrapheStructure(refs, { documents: [], liens: [] }, depart, { profondeur: 10, documents: false, liens: false });
  const ids = (t) => g.noeuds.filter((n) => n.type === t).map((n) => n.id);
  return { projets: ids(TYPE_FICHE.PROJET), affaires: ids(TYPE_FICHE.AFFAIRE), chantiers: ids(TYPE_FICHE.CHANTIER), marches: ids(TYPE_FICHE.MARCHE) };
}

/**
 * Graphe { noeuds, aretes } (format du module Graphe). refs : référentiels de la structure ; docs : { documents, liens }
 * (route /structure/documents) ; depart : { type, id } ; options : profondeur, documents, liens (transformations).
 */
export function construireGrapheStructure(refs, docs, depart, { profondeur = 3, documents = true, liens = true } = {}) {
  const tous = new Map();
  const aretes = [];
  const noeud = (type, x, autres = {}) => {
    const cle = `${CLE[type]}${x.id}`;
    if (!tous.has(cle)) {
      tous.set(cle, {
        cle, type, id: x.id, libelle: x.code ?? x.numero ?? String(x.id), sous_titre: x.libelle ?? null, ordre: ORDRE[type] ?? 9, icone: ICONES[type],
        actif: !['CLOSE', 'CLOS', 'PERDU', 'ABANDONNE', 'RESILIE'].includes(x.statut), statut: x.statut ?? null, colonne: type === 'document', ...autres,
      });
    }
    return cle;
  };
  const arete = (de, vers, type, libelle = null) => aretes.push({ cle: `${type}:${de}-${vers}`, de, vers, type, libelle, actif: true });
  for (const a of refs.affaires ?? []) noeud(TYPE_FICHE.AFFAIRE, a);
  for (const p of refs.projets ?? []) noeud(TYPE_FICHE.PROJET, p);
  for (const c of refs.chantiers ?? []) {
    const k = noeud(TYPE_FICHE.CHANTIER, c);
    if (c.aff_id && tous.has(`A${c.aff_id}`)) arete(`A${c.aff_id}`, k, 'structure');
    if (c.prj_id && tous.has(`P${c.prj_id}`)) arete(`P${c.prj_id}`, k, 'structure');
  }
  for (const m of refs.marches ?? []) {
    const k = noeud(TYPE_FICHE.MARCHE, m, { montant_ht: m.montant_ht ?? null });
    if (m.cha_id && tous.has(`C${m.cha_id}`)) arete(`C${m.cha_id}`, k, 'structure');
  }
  if (documents) {
    for (const d of docs.documents ?? []) {
      // Rattachement le plus précis : marché, chantier, affaire, puis projet.
      const parent = [['M', d.marche_id], ['C', d.chantier_id], ['A', d.affaire_id], ['P', d.projet_id]].map(([p, id]) => (id ? `${p}${id}` : null)).find((k) => k && tous.has(k));
      if (!parent) continue;
      const k = noeud('document', { id: d.id, code: d.numero ?? `#${d.id}`, libelle: d.type_libelle, statut: null },
        { statut_document: d.statut, type_document: d.type, objet: d.objet, total_ht: d.total_ht, famille: d.famille });
      arete(parent, k, 'document');
    }
    if (liens) {
      for (const l of docs.liens ?? []) {
        if (tous.has(`D${l.source}`) && tous.has(`D${l.cible}`)) arete(`D${l.source}`, `D${l.cible}`, 'transformation', l.type === 'COPIE' ? texte('structure_btp.graphe.copie') : null);
      }
    }
  }
  const k0 = `${CLE[depart.type]}${depart.id}`;
  if (!tous.has(k0)) return { noeuds: [], aretes: [] };
  const voisins = new Map([...tous.keys()].map((k) => [k, []]));
  for (const a of aretes) { voisins.get(a.de).push(a.vers); voisins.get(a.vers).push(a.de); }
  const distances = parcourirEnLargeur(k0, (k) => voisins.get(k) ?? [], Math.min(Math.max(Number(profondeur) || 3, 1), 10));
  const noeuds = [...distances].map(([k, distance]) => ({ ...tous.get(k), distance, depart: k === k0 }));
  const presents = new Set(distances.keys());
  return {
    noeuds: noeuds.sort((a, b) => a.ordre - b.ordre || a.cle.localeCompare(b.cle, 'fr', { numeric: true })),
    aretes: aretes.filter((a) => presents.has(a.de) && presents.has(a.vers)),
  };
}

/** Vue du graphe de la structure : spécialisation de la vue du module Graphe. */
export class VueGrapheStructure extends VueGraphe {
  static CLE_REGLAGES = 'structureGraphe';

  /** options (en plus de celles de VueGraphe) : structure (referentiels, documents) ; naviguer(url, evenement). */
  constructor(conteneur, options) {
    super(conteneur, { ...options, ouvrir: (n, e) => options.naviguer(n.type === 'document' ? urlDocument(n.id) : urlFiche(n.type, n.id), e) });
  }

  async chargerGraphe(depart, reglages) {
    const refs = await this.options.structure.referentiels();
    const docs = reglages.documents ? await this.options.structure.documents(perimetreStructure(refs, depart)) : { documents: [], liens: [] };
    return construireGrapheStructure(refs, docs, depart, reglages);
  }

  reglagesDefaut() { return { profondeur: 3, documents: true, liens: true }; }

  controlesReglages() {
    return [
      { code: 'documents', libelle: texte('structure_btp.graphe.reglages.documents'), titre: texte('structure_btp.graphe.reglages.documents_aide'), type: 'case' },
      { code: 'liens', libelle: texte('structure_btp.graphe.reglages.liens'), titre: texte('structure_btp.graphe.reglages.liens_aide'), type: 'case' },
    ];
  }

  dimensions(n) { return n.type === 'document' ? { w: 170, h: 34 } : { w: 184, h: 46 }; }

  couleurNoeud(n) { return COULEURS.includes(n.type) ? couleurTheme(`--graphe-structure-${n.type}`) : 'var(--bord)'; }

  corpsNoeud(n, g) {
    if (n.type !== 'document') return super.corpsNoeud(n, g);
    const { x, y, w, h, bord } = g;
    const couleur = couleurTheme(n.famille === FAMILLE_DOCUMENT.ACHAT ? '--graphe-structure-achat' : n.famille === FAMILLE_DOCUMENT.SOUS_TRAITANCE ? '--graphe-structure-sous-traitance' : '--graphe-structure-vente');
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="var(--fond)" ${bord}/>
      <rect x="${x}" y="${y}" width="5" height="${h}" rx="2" fill="${couleur}"/>
      <text x="${x + 12}" y="${y + 14}" font-size="11" font-weight="600" fill="var(--texte)">${echapper(tronquer(n.libelle, 22))}</text>
      <text x="${x + 12}" y="${y + 27}" font-size="9.5" fill="var(--discret)">${echapper(tronquer([n.sous_titre, n.statut_document].filter(Boolean).join(' · '), 30))}</text>`;
  }

  styleArete(a) {
    return {
      structure: 'stroke="var(--discret)" stroke-width="1.8" marker-end="url(#graphe-fleche)"',
      document: 'stroke="var(--discret)" stroke-width="1" opacity="0.7"',
      transformation: 'stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="6 4" marker-end="url(#graphe-fleche-lien)"',
    }[a.type] ?? super.styleArete(a);
  }

  libelleArete(a) { return a.libelle ? { texte: a.libelle, secondaire: false, couleur: 'var(--accent)' } : null; }

  legende() { return [{ classe: 'l-hier', libelle: texte('structure_btp.graphe.legende.structure') }, { classe: 'l-rat', libelle: texte('structure_btp.graphe.legende.rattache') }, { classe: 'l-lien', libelle: texte('structure_btp.graphe.legende.transformation') }]; }

  compte(g) {
    if (!g.noeuds.length) return texte('structure_btp.graphe.introuvable');
    const n = (t) => g.noeuds.filter((x) => x.type === t).length;
    return ['chantiers', 'marches', 'documents'].map((t) => pluriel(`structure_btp.graphe.compte.${t}`, n(t.slice(0, -1)))).join(', ');
  }

  titreNoeud(n) { return [`${LIBELLES[n.type]} ${n.libelle}`, n.sous_titre, n.statut_document, n.objet].filter(Boolean).join(' – '); }

  infosNoeud(n) {
    const details = n.type === 'document'
      ? [n.sous_titre, n.statut_document, n.total_ht !== null && n.total_ht !== undefined ? texte('structure_btp.graphe.montant_ht', { montant: formatNombre(n.total_ht, 2) }) : null, n.objet]
      : [LIBELLES[n.type], n.sous_titre, n.montant_ht ? texte('structure_btp.graphe.montant_ht', { montant: formatNombre(n.montant_ht, 2) }) : null];
    return `<p class="aide">${details.filter(Boolean).map(echapper).join(' · ')} · ${n.distance === 0 ? texteHtml('structure_btp.graphe.depart') : pluriel('structure_btp.graphe.sauts', n.distance)}</p>`;
  }

  boutonsNoeud(n) {
    const b = super.boutonsNoeud(n).filter((x) => n.type !== 'document' || x.code === 'ouvrir');
    const ouvrir = b.find((x) => x.code === 'ouvrir');
    if (ouvrir && n.type === 'document') ouvrir.libelle = texte('structure_btp.graphe.ouvrir_document');
    return b;
  }

  relationVoisin(a, n) {
    if (a.type === 'transformation') return a.de === n.cle ? (a.libelle ? texte('structure_btp.graphe.transforme_en_type', { type: a.libelle }) : texte('structure_btp.graphe.transforme_en')) : texte('structure_btp.graphe.issu_de');
    if (a.type === 'document') return a.de === n.cle ? texte('structure_btp.graphe.legende.rattache') : texte('structure_btp.graphe.rattache_a');
    const autre = this.noeud(a.de === n.cle ? a.vers : a.de);
    return LIBELLES[autre?.type] ?? '';
  }

  nomExport() { return `graphe-${this.depart.type}-${this.depart.id}.svg`; }
}
