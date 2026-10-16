import { CFG_LIGNES as C, ordreAffichage, echapper, formatNombre, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { TL, estTranche } from '../src/index.js';
import { ID_PIED } from './editeur-document.js';

// Plan du document : les tranches (titres) en arbre, avec leur montant, puis le pied. Deux modes au clic :
// « Aller à » sélectionne la tranche dans la grille (tranches parentes dépliées), « Filtrer » limite l'affichage de la
// grille à la tranche (la saisie et le calcul portent toujours sur tout le document). Le mode est gardé dans le navigateur.
// Glisser-déposer d'une tranche sur une autre : avant, après (bords) ou dedans (milieu), avec les règles de dépôt de
// l'éditeur ; la tranche est déplacée avec tout son contenu (une étape d'annulation).
// Boutons Ouvrages et Tout : réduire (ou ouvrir) d'un coup les lignes d'ouvrage, ou toutes les lignes, de la grille.

export class PlanDocument {
  constructor(conteneur, { editeur }) {
    this.conteneur = conteneur;
    this.editeur = editeur;
    this.replies = new Set();
    this.mode = lirePreferences().planMode === 'filtrer' ? 'filtrer' : 'aller';
    conteneur.classList.add('plan-document');
    conteneur.addEventListener('click', (e) => this.#clic(e));
    this.#glisser(conteneur);
    // Largeur du plan modifiée (dock redimensionné, déplacé) : libellés des boutons masqués ou réaffichés.
    this.observateur = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.#ajusterBarre());
    this.observateur?.observe(conteneur);
  }

  /** Tranches : titres dans l'ordre d'affichage, avec profondeur parmi les titres et présence de sous-tranches. */
  tranches() {
    const r = this.editeur.resultat;
    const titres = ordreAffichage(C, r.lignes, new Set()).map((x) => x.item).filter(estTranche);
    const ids = new Set(titres.map((l) => l.lig_id));
    const parId = new Map(r.lignes.map((l) => [l.lig_id, l]));
    const parentTitre = (l) => {
      let p = parId.get(l.lig_parent_id);
      while (p && !ids.has(p.lig_id)) p = parId.get(p.lig_parent_id);
      return p?.lig_id ?? null;
    };
    const res = titres.map((l) => ({ ligne: l, parent: parentTitre(l) }));
    const avecEnfants = new Set(res.map((t) => t.parent).filter((p) => p !== null));
    const profondeur = new Map();
    for (const t of res) profondeur.set(t.ligne.lig_id, t.parent === null ? 0 : profondeur.get(t.parent) + 1);
    return res.map((t) => ({ ...t, profondeur: profondeur.get(t.ligne.lig_id), aEnfants: avecEnfants.has(t.ligne.lig_id) }));
  }

  /** Tranche de la ligne courante de la grille (titre ancêtre le plus proche, ou le pied). */
  trancheCourante() {
    const ed = this.editeur;
    const id = ed.grille.courant;
    if (id === null || id === undefined) return null;
    const parId = new Map(ed.saisie.lignes.map((l) => [l.lig_id, l]));
    let l = parId.get(id);
    if (!l) return id === ID_PIED || id <= -1e12 ? ID_PIED : null;
    if (l.lig_parent_id === null && !estTranche(l) && (ed.resultat.pied ?? []).some((e) => e.lig_id === l.lig_id || e.lignes?.includes(l.lig_id))) return ID_PIED;
    while (l && !estTranche(l)) l = parId.get(l.lig_parent_id);
    return l?.lig_id ?? null;
  }

  rendre() {
    const ed = this.editeur;
    const pm = ed.saisie.document.ent_precision_montant ?? 2;
    const tranches = this.tranches();
    const masquees = new Set();
    for (const t of tranches) if (t.parent !== null && (this.replies.has(t.parent) || masquees.has(t.parent))) masquees.add(t.ligne.lig_id);
    const courante = this.trancheCourante();
    const filtre = ed.filtre;
    const item = (id, num, libelle, montant, { profondeur = 0, aEnfants = false, classe = '', ligne = null } = {}) => {
      // Demi-pastille du mode de vente (option, frais annexes…) de la tranche, comme dans la grille.
      const t = ligne ? ed.pastilleTypePrix(ligne) : null;
      const pastille = `<span class="type-prix" ${t ? `style="background:${echapper(t.fond)}" title="${echapper(t.libelle)}"` : ''}></span>`;
      return `
      <li data-id="${id}" ${id !== ID_PIED && !ed.magasin?.lectureSeule ? 'draggable="true"' : ''} class="${classe} ${id === courante ? 'courant' : ''} ${id === filtre ? 'filtre' : ''}" style="padding-left:${0.3 + profondeur * 0.9}rem" title="${echapper(libelle)}">
        <span class="pli" ${aEnfants ? 'data-pli' : ''}>${aEnfants ? (this.replies.has(id) ? '▸' : '▾') : ''}</span>
        ${pastille}<span class="num">${echapper(num)}</span><span class="lib">${echapper(libelle)}</span><span class="mt">${formatNombre(montant, pm)}</span></li>`;
    };
    const net = ed.resultat.document.ent_net_a_payer;
    this.conteneur.innerHTML = `
      <div class="plan-barre">
        <span class="plan-modes" role="group" aria-label="Clic sur une tranche">
          <button type="button" data-mode="aller" class="${this.mode === 'aller' ? 'actif' : ''}" title="Clic : aller à la ligne de la tranche dans la grille">↧<span class="lib-bouton"> Aller à</span></button>
          <button type="button" data-mode="filtrer" class="${this.mode === 'filtrer' ? 'actif' : ''}" title="Clic : n'afficher que la tranche dans la grille (affichage seulement)">⧩<span class="lib-bouton"> Filtrer</span></button>
        </span>
        <span class="plan-plis" role="group" aria-label="Lignes de la grille">
          ${this.boutonPli('ouvrages', 'Ouvrages', 'les lignes d\'ouvrage (composantes)', ed.toutReplie({ ouvrages: true }), ed.lignesRepliables({ ouvrages: true }).length > 0)}
          ${this.boutonPli('tout', 'Tout', 'toutes les lignes (titres, ouvrages, pied)', ed.toutReplie(), ed.lignesRepliables().length > 0)}
        </span>
        ${filtre !== null ? '<button type="button" data-tout class="filtre" title="Retirer le filtre d\'affichage">✕<span class="lib-bouton"> Tout afficher</span></button>' : ''}
      </div>
      <ul class="plan-arbre">
        ${tranches.filter((t) => !masquees.has(t.ligne.lig_id)).map((t) => item(t.ligne.lig_id, t.ligne.lig_numerotation ?? '', t.ligne.lig_libelle_brut || (t.ligne.lig_tyl_id === TL.SECTION ? 'Section' : 'Titre'), t.ligne.lig_montant_ht, t)).join('')}
        ${(ed.resultat.pied ?? []).length ? item(ID_PIED, '', 'Pied du document', net, { classe: 'pied' }) : ''}
      </ul>
      ${tranches.length ? '' : '<p class="aide">Aucun titre : ajoutez des lignes de type Titre pour structurer le document en tranches.</p>'}`;
    this.#ajusterBarre();
  }

  /** Bouton d'ouverture / réduction des lignes de la grille : réduit tant qu'une ligne est ouverte, sinon ouvre tout. */
  boutonPli(code, libelle, quoi, replie, actif) {
    return `<button type="button" data-plis="${code}" ${actif ? '' : 'disabled'} title="${replie ? 'Ouvrir' : 'Réduire'} ${quoi}">${replie ? '⊞' : '⊟'}<span class="lib-bouton"> ${libelle}</span></button>`;
  }

  /**
   * Barre des boutons sur une seule ligne : sans la place (plan étroit), les libellés sont masqués et seules les
   * icônes restent (le libellé reste en bulle).
   */
  #ajusterBarre() {
    const barre = this.conteneur.querySelector('.plan-barre');
    if (!barre) return;
    barre.classList.remove('compacte');
    if (barre.scrollWidth > barre.clientWidth + 1) barre.classList.add('compacte');
  }

  #glisser(conteneur) {
    const nettoyer = () => conteneur.querySelectorAll('.depot-avant, .depot-apres, .depot-enfant, .depot-interdit, .glisse')
      .forEach((x) => x.classList.remove('depot-avant', 'depot-apres', 'depot-enfant', 'depot-interdit', 'glisse'));
    const position = (li, e) => {
      const r = li.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return y < 0.3 ? 'avant' : y > 0.7 ? 'apres' : 'enfant';
    };
    conteneur.addEventListener('dragstart', (e) => {
      const li = e.target.closest('li[draggable="true"]');
      if (!li) return;
      this.glisse = Number(li.dataset.id);
      li.classList.add('glisse');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.id);
    });
    conteneur.addEventListener('dragover', (e) => {
      const li = e.target.closest('li[data-id]');
      if (this.glisse === undefined || !li) return;
      const cible = Number(li.dataset.id);
      const pos = position(li, e);
      conteneur.querySelectorAll('.depot-avant, .depot-apres, .depot-enfant, .depot-interdit').forEach((x) => x.classList.remove('depot-avant', 'depot-apres', 'depot-enfant', 'depot-interdit'));
      const ok = this.depotAutorise(this.glisse, cible, pos);
      li.classList.add(ok ? `depot-${pos}` : 'depot-interdit');
      if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    conteneur.addEventListener('drop', (e) => {
      const li = e.target.closest('li[data-id]');
      const id = this.glisse;
      this.glisse = undefined;
      nettoyer();
      if (id === undefined || !li) return;
      e.preventDefault();
      const cible = Number(li.dataset.id);
      const pos = position(li, e);
      if (!this.depotAutorise(id, cible, pos)) return;
      this.editeur.grille.o.actions.deplacer([id], cible, pos);
      this.editeur.allerA(id);
    });
    conteneur.addEventListener('dragend', () => { this.glisse = undefined; nettoyer(); });
  }

  /** Dépôt d'une tranche : pas sur elle-même ni dans ses sous-tranches, pas dans le pied ; règles de l'éditeur. */
  depotAutorise(id, cible, position) {
    if (id === cible || cible === ID_PIED) return false;
    const parId = new Map(this.editeur.saisie.lignes.map((l) => [l.lig_id, l]));
    for (let x = parId.get(cible); x; x = parId.get(x.lig_parent_id)) if (x.lig_id === id) return false;
    return this.editeur.grille.o.actions.depotAutorise([id], cible, position);
  }

  #clic(e) {
    const mode = e.target.closest('[data-mode]');
    if (mode) {
      this.mode = mode.dataset.mode;
      ecrirePreferences({ planMode: this.mode });
      // Passage en mode « Aller à » : le filtre éventuel est retiré.
      if (this.mode === 'aller' && this.editeur.filtre !== null) this.editeur.filtrer(null);
      this.rendre();
      return;
    }
    const plis = e.target.closest('[data-plis]');
    if (plis) {
      this.editeur.basculerPlis({ ouvrages: plis.dataset.plis === 'ouvrages' });
      this.rendre();
      return;
    }
    if (e.target.closest('[data-tout]')) {
      this.editeur.filtrer(null);
      this.rendre();
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = Number(li.dataset.id);
    if (e.target.closest('[data-pli]')) {
      if (this.replies.has(id)) this.replies.delete(id); else this.replies.add(id);
      this.rendre();
      return;
    }
    if (this.mode === 'filtrer') this.editeur.filtrer(this.editeur.filtre === id ? null : id);
    else this.editeur.allerA(id);
    this.rendre();
  }
}
