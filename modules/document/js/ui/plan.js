import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { CFG_LIGNES as C, ordreAffichage, echapper, formatNombre, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { TL, estTranche } from '../src/index.js';
import { ID_PIED, LIBELLES_TYPE_PRIX } from './editeur-document.js';

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
      // Tranche de frais annexes : montant en italique (hors total) et complément (part ventilée).
      const frais = ligne?.lig_tyl_id === TL.TITRE && ligne.lig_type_prix === 'F';
      const complement = ligne ? ed.complementTranche(ligne) : null;
      return `
      <li data-id="${id}" ${id !== ID_PIED && !ed.magasin?.lectureSeule ? 'draggable="true"' : ''} class="${classe} ${frais ? 'tranche-frais' : ''} ${id === courante ? 'courant' : ''} ${id === filtre ? 'filtre' : ''}" style="padding-left:${0.3 + profondeur * 0.9}rem" title="${echapper(complement ? `${libelle} — ${complement}` : libelle)}">
        <span class="pli" ${aEnfants ? 'data-pli' : ''}>${aEnfants ? iconeHtml(this.replies.has(id) ? 'document_deplier' : 'replier') : ''}</span>
        ${pastille}<span class="num">${echapper(num)}</span><span class="lib">${echapper(libelle)}</span>${complement ? `<small class="complement">${echapper(complement)}</small>` : ''}<span class="mt">${formatNombre(montant, pm)}</span></li>`;
    };
    const net = ed.resultat.document.ent_net_a_payer;
    this.conteneur.innerHTML = `
      <div class="plan-barre">
        <span class="plan-modes" role="group" aria-label="${texteHtml('document.plan.clic')}">
          <button type="button" data-mode="aller" class="${this.mode === 'aller' ? 'actif' : ''}" title="${texteHtml('document.plan.aller_aide')}">${iconeHtml('document_aller')}<span class="lib-bouton"> ${texteHtml('document.plan.aller')}</span></button>
          <button type="button" data-mode="filtrer" class="${this.mode === 'filtrer' ? 'actif' : ''}" title="${texteHtml('document.plan.filtrer_aide')}">${iconeHtml('document_filtrer')}<span class="lib-bouton"> ${texteHtml('document.plan.filtrer')}</span></button>
        </span>
        <span class="plan-plis" role="group" aria-label="${texteHtml('document.plan.lignes')}">
          ${this.boutonPli('ouvrages', ed.toutReplie({ ouvrages: true }), ed.lignesRepliables({ ouvrages: true }).length > 0)}
          ${this.boutonPli('tout', ed.toutReplie(), ed.lignesRepliables().length > 0)}
        </span>
        ${filtre !== null ? `<button type="button" data-tout class="filtre" title="${texteHtml('document.plan.retirer_filtre')}">${iconeHtml('retirer')}<span class="lib-bouton"> ${texteHtml('document.plan.tout_afficher')}</span></button>` : ''}
      </div>
      <ul class="plan-arbre">
        ${tranches.filter((t) => !masquees.has(t.ligne.lig_id)).map((t) => item(t.ligne.lig_id, t.ligne.lig_numerotation ?? '', t.ligne.lig_libelle_brut || texte(t.ligne.lig_tyl_id === TL.SECTION ? 'document.plan.section' : 'document.plan.titre'), t.ligne.lig_montant_ht, t)).join('')}
        ${(ed.resultat.pied ?? []).length ? item(ID_PIED, '', texte('document.plan.pied'), net, { classe: 'pied' }) : ''}
      </ul>
      ${tranches.length ? '' : `<p class="aide">${texteHtml('document.plan.aucun_titre')}</p>`}
      ${this.legendeHtml()}`;
    this.#ajusterBarre();
  }

  /**
   * Légende (D6) : étiquettes et modes de vente du document (clic : filtre par pastille de la grille), fonds des lignes
   * et marques présents dans le document seulement. Couleurs lues dans les données ou le thème (classes), jamais
   * recopiées. Repliable (préférence `planLegende` du navigateur).
   */
  legende() {
    const ed = this.editeur;
    const lignes = ed.resultat.lignes ?? [];
    const etiquettesPresentes = new Set(lignes.map((l) => l.lig_etiquette).filter(Boolean));
    const etiquettes = ed.etiquettes().filter((e) => etiquettesPresentes.has(e.code));
    const types = new Set(lignes.map((l) => ed.typePrixEffectif(l)));
    const modes = Object.keys(LIBELLES_TYPE_PRIX).filter((t) => t !== 'V' && types.has(t));
    const tyl = new Set(lignes.map((l) => l.lig_tyl_id));
    const fonds = [['section', tyl.has(TL.SECTION)], ['titre', tyl.has(TL.TITRE)], ['ouvrage', tyl.has(TL.OUVRAGE)], ['pied', (ed.resultat.pied ?? []).length > 0]]
      .filter(([, present]) => present).map(([code]) => code);
    const marques = [
      ['hors_total', modes.some((t) => t !== 'F')],
      ['frais', types.has('F')],
      ['soldee', Boolean(ed.restes) && lignes.some((l) => Number(l.lig_qte_vendue ?? 0) === 0 && ed.soldeLigne?.({ item: l, calcule: l })?.avant?.soldee)],
      ['non_editee', lignes.some((l) => l.lig_is_non_editee)],
    ].filter(([, present]) => present).map(([code]) => code);
    return { etiquettes, modes, fonds, marques };
  }

  legendeHtml() {
    const ed = this.editeur;
    const { etiquettes, modes, fonds, marques } = this.legende();
    if (!etiquettes.length && !modes.length && !fonds.length && !marques.length) return '';
    const { etiquettes: filtreEtq, types: filtreTypes } = ed.filtreMarqueurs ?? { etiquettes: new Set(), types: new Set() };
    const groupe = (cle, contenu) => (contenu ? `<div class="legende-groupe"><strong>${texteHtml(`document.plan.legende.${cle}`)}</strong><ul>${contenu}</ul></div>` : '');
    const pastille = (attr, valeur, couleur, libelle, actif) => `<li><button type="button" class="lien legende-filtre${actif ? ' actif' : ''}" ${attr}="${echapper(valeur)}" aria-pressed="${actif}"
      title="${texteHtml('document.plan.legende.filtrer', { nom: libelle })}"><span class="legende-pastille" ${couleur ? `style="background:${echapper(couleur)}"` : ''}></span>${echapper(libelle)}</button></li>`;
    const ouverte = lirePreferences().planLegende !== false;
    return `<details class="plan-legende" ${ouverte ? 'open' : ''}>
      <summary>${texteHtml('document.plan.legende.titre')}</summary>
      ${groupe('etiquettes', etiquettes.map((e) => pastille('data-legende-etq', e.code, e.couleur, e.libelle, filtreEtq.has(e.code))).join(''))}
      ${groupe('modes', modes.map((t) => pastille('data-legende-type', t, ed.couleurTypePrix(t)?.couleur, LIBELLES_TYPE_PRIX[t], filtreTypes.has(t))).join(''))}
      ${groupe('fonds', fonds.map((f) => `<li><span class="legende-fond fond-${f}"></span>${texteHtml(`document.plan.legende.fond_${f}`)}</li>`).join(''))}
      ${groupe('marques', marques.map((m) => `<li><span class="legende-marque marque-${m}">${texteHtml('document.plan.legende.exemple')}</span>${texteHtml(`document.plan.legende.marque_${m}`)}</li>`).join(''))}
    </details>`;
  }

  /** Bouton d'ouverture / réduction des lignes de la grille : réduit tant qu'une ligne est ouverte, sinon ouvre tout. */
  boutonPli(code, replie, actif) {
    return `<button type="button" data-plis="${code}" ${actif ? '' : 'disabled'} title="${texteHtml(`document.plan.plis.${code}_${replie ? 'ouvrir' : 'reduire'}`)}">${iconeHtml(replie ? 'document_tout_ouvrir' : 'document_tout_reduire')}<span class="lib-bouton"> ${texteHtml(`document.plan.plis.${code}`)}</span></button>`;
  }

  /**
   * Barre des boutons sur une seule ligne : sans la place (plan étroit), les libellés sont masqués et seules les
   * icônes restent (le libellé reste en bulle). La barre garde la largeur de ses boutons : on la compare au panneau.
   */
  #ajusterBarre() {
    const barre = this.conteneur.querySelector('.plan-barre');
    if (!barre) return;
    barre.classList.remove('compacte');
    if (barre.scrollWidth > barre.parentElement.clientWidth + 1) barre.classList.add('compacte');
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
    const legende = e.target.closest('[data-legende-etq], [data-legende-type]');
    if (legende) {
      // Étiquette ou mode de la légende : bascule dans le filtre par pastille de la grille.
      const ed = this.editeur;
      const etiquettes = new Set(ed.filtreMarqueurs.etiquettes);
      const types = new Set(ed.filtreMarqueurs.types);
      const basculer = (ens, v) => (ens.has(v) ? ens.delete(v) : ens.add(v));
      if (legende.dataset.legendeEtq !== undefined) basculer(etiquettes, legende.dataset.legendeEtq);
      else basculer(types, legende.dataset.legendeType);
      ed.filtrerMarqueurs({ etiquettes: [...etiquettes], types: [...types] });
      this.rendre();
      return;
    }
    if (e.target.closest('.plan-legende > summary')) {
      const d = e.target.closest('.plan-legende');
      // L'état ouvert change après le clic.
      setTimeout(() => ecrirePreferences({ planLegende: d.open }), 0);
      return;
    }
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
