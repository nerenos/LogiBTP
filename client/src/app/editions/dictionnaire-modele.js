import { echapper } from '@logibtp/socle/ui';
import { CATALOGUE_FONCTIONS, CATEGORIES_FONCTIONS, CONTEXTES, FORMATS_CHAMP, OPERATEURS } from '@logibtp/edition';
import { api } from '../api.js';

const cacheSources = new Map(); // source → entrées du dictionnaire du serveur

/** Valeur d'exemple d'un chemin dans les données de l'aperçu (« a[].b » : premier élément de la collection a). */
function exemple(donnees, chemin) {
  let v = donnees;
  for (const partie of chemin.split('.')) {
    if (v === null || v === undefined) return undefined;
    const tableau = partie.endsWith('[]');
    v = v[tableau ? partie.slice(0, -2) : partie];
    if (tableau) v = Array.isArray(v) ? v[0] : undefined;
  }
  return v;
}

function apercuValeur(v) {
  if (v === undefined) return '';
  if (v === null) return '∅';
  if (Array.isArray(v)) return `[${v.length}] ${v.slice(0, 3).map((x) => (typeof x === 'object' && x !== null ? '{…}' : String(x))).join(' · ')}`;
  if (typeof v === 'object') return '{…}';
  const s = String(v).replace(/<[^>]+>/g, '');
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/**
 * Texte inséré pour une donnée : collection → son chemin (propriété collection, Somme(…)) ; champ d'une collection
 * « a[].b » → {{ligne.b}} (ligne et element désignent l'élément courant) ; autre champ → {{chemin}} ; Alt+clic : chemin nu
 * (dans une expression « =… »).
 */
function texteDonnee(entree, nu) {
  if (entree.type === 'collection' && !entree.chemin.includes('[]')) return entree.chemin;
  const chemin = entree.chemin.includes('[]') ? `ligne.${entree.chemin.slice(entree.chemin.lastIndexOf('[].') + 3)}` : entree.chemin;
  return nu ? chemin : `{{${chemin}}}`;
}

/**
 * Dictionnaire de l'éditeur du modèle : données de la source (serveur, avec la valeur de l'aperçu en exemple),
 * paramètres du modèle, contextes, fonctions, formats, styles, couleurs et traits de la charte, opérateurs. Un clic
 * insère l'entrée à la position du curseur de l'éditeur ; recherche sur le chemin, le libellé et la description.
 */
export class DictionnaireModele {
  /**
   * @param zone conteneur du dictionnaire
   * @param editeur EditeurModeleApercu (page.prep, inserer(texte, recul))
   */
  constructor(zone, editeur) {
    this.zone = zone;
    this.editeur = editeur;
    this.filtre = '';
    this.ouverts = new Set(['Fonctions : Conditions']);
  }

  async charger() {
    const p = this.editeur.page.prep;
    const source = p.modele?.source ?? p.modele?.contenu?.source ?? 'document';
    if (!cacheSources.has(source)) cacheSources.set(source, await api.editions.dictionnaire(source).catch(() => []));
    this.donnees = cacheSources.get(source);
    this.rendre();
  }

  /** Groupes affichés : [{ titre, entrees: [{ cle, libelle, detail, exemple, inserer(nu) → texte, recul }] }]. */
  groupes() {
    const p = this.editeur.page.prep;
    const groupes = new Map();
    const ajouter = (titre, e) => { if (!groupes.has(titre)) groupes.set(titre, []); groupes.get(titre).push(e); };
    for (const d of this.donnees ?? []) {
      ajouter(`Données : ${d.groupe ?? 'Source'}`, {
        cle: d.chemin, libelle: d.libelle, detail: d.type, exemple: apercuValeur(exemple(p.donnees, d.chemin)),
        inserer: (nu) => texteDonnee(d, nu),
      });
    }
    const parametres = new Map();
    for (const x of p.modele?.contenu?.parametres ?? []) parametres.set(x.nom, x.libelle ?? x.type ?? '');
    for (const pr of p.modele?.contenu?.presentations ?? []) for (const k of Object.keys(pr.parametres ?? {})) if (!parametres.has(k)) parametres.set(k, `présentation ${pr.code}`);
    parametres.set('presentation', 'code de la présentation choisie');
    for (const [nom, libelle] of parametres) ajouter('Paramètres du modèle', { cle: nom, libelle, detail: 'paramètre', inserer: () => `Parametre("${nom}")` });
    for (const c of CONTEXTES) ajouter('Contextes', { cle: c.nom, libelle: c.description, detail: c.exemple, inserer: () => c.nom });
    for (const cat of CATEGORIES_FONCTIONS) {
      for (const f of CATALOGUE_FONCTIONS.filter((x) => x.categorie === cat)) {
        const vide = /\(\)$/.test(f.signature);
        ajouter(`Fonctions : ${cat}`, { cle: f.signature, libelle: f.description, detail: f.exemple, inserer: () => `${f.nom}()`, recul: vide ? 0 : 1 });
      }
    }
    for (const f of FORMATS_CHAMP) ajouter('Formats des champs', { cle: f.format, libelle: f.description, inserer: () => f.format.replace(':N', ':2') });
    for (const o of OPERATEURS) ajouter('Opérateurs', { cle: o.symbole, libelle: o.description, inserer: () => o.symbole.split(' ')[0] });
    const charte = p.charte ?? {};
    for (const [nom, s] of Object.entries(charte.styles ?? {})) ajouter('Charte : styles', { cle: nom, libelle: [s.base && `base ${s.base}`, s.taille && `${s.taille} pt`, s.graisse >= 600 && 'gras', s.italique && 'italique', s.couleur].filter(Boolean).join(', '), inserer: () => nom });
    for (const [nom, c] of Object.entries(charte.couleurs ?? {})) ajouter('Charte : couleurs', { cle: nom, libelle: String(c), couleur: c, inserer: () => nom });
    for (const [nom, tr] of Object.entries(charte.traits ?? {})) ajouter('Charte : traits', { cle: nom, libelle: `${tr.epaisseur} mm, ${tr.couleur}`, inserer: () => nom });
    return [...groupes].map(([titre, entrees]) => ({ titre, entrees }));
  }

  rendre() {
    const f = this.filtre.trim().toLowerCase();
    const groupes = this.groupes().map((g) => ({
      ...g, entrees: f ? g.entrees.filter((e) => `${e.cle} ${e.libelle} ${e.detail ?? ''}`.toLowerCase().includes(f)) : g.entrees,
    })).filter((g) => g.entrees.length);
    this.entrees = groupes.flatMap((g) => g.entrees);
    let i = 0;
    this.zone.innerHTML = `<div class="dictionnaire-barre"><input type="search" placeholder="Rechercher une donnée, une fonction, un style…" value="${echapper(this.filtre)}">
        <span class="aide">Clic : insérer · Alt+clic : chemin sans {{ }}</span></div>
      <div class="dictionnaire-corps">${groupes.map((g) => `<details ${f || this.ouverts.has(g.titre) ? 'open' : ''} data-groupe="${echapper(g.titre)}">
        <summary>${echapper(g.titre)} <small>${g.entrees.length}</small></summary>
        ${g.entrees.map((e) => `<button type="button" class="dictionnaire-entree" data-i="${i++}" title="${echapper([e.libelle, e.detail].filter(Boolean).join('\n'))}">
          <code>${echapper(e.cle)}</code><span>${e.couleur ? `<i class="pastille-couleur" style="background:${echapper(e.couleur)}"></i>` : ''}${echapper(e.libelle ?? '')}</span>${e.exemple ? `<em>${echapper(e.exemple)}</em>` : ''}</button>`).join('')}
      </details>`).join('') || '<p class="aide">Aucune entrée.</p>'}</div>`;
    const recherche = this.zone.querySelector('input[type="search"]');
    recherche.addEventListener('input', () => {
      this.filtre = recherche.value;
      const pos = recherche.selectionStart;
      this.rendre();
      const r = this.zone.querySelector('input[type="search"]');
      r.focus();
      r.setSelectionRange(pos, pos);
    });
    this.zone.querySelectorAll('details[data-groupe]').forEach((d) => d.addEventListener('toggle', () => {
      if (this.filtre) return;
      if (d.open) this.ouverts.add(d.dataset.groupe); else this.ouverts.delete(d.dataset.groupe);
    }));
    this.zone.querySelectorAll('.dictionnaire-entree').forEach((b) => b.addEventListener('click', (ev) => {
      const e = this.entrees[Number(b.dataset.i)];
      this.editeur.inserer(e.inserer(ev.altKey), e.recul ?? 0);
    }));
  }
}
