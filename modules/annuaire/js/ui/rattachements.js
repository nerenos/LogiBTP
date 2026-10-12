import { echapper } from '@logibtp/socle/ui';
import { texteCoordonnee, estVide, coordonneesParDefaut } from '../src/coordonnees.js';
import { TAILLE_PAGE_RATTACHEMENTS } from '../src/fournisseurs.js';
import { EditeurCoordonnees } from './coordonnees.js';
import { choisirPersonne, choisirIndividu } from './selection.js';

// Rattachements des individus aux personnes, vus d'une personne (contacts : salariés, dirigeants…) ou d'un individu
// (personnes auxquelles il est rattaché, dont son compte particulier). Chaque rattachement porte sa fonction, son
// service, ses dates et ses coordonnées propres (portable et e-mail professionnels…).
//
// Lecture par page (une société peut compter des milliers de salariés) avec recherche ; la valeur éditée (champ géré)
// ne contient que les modifications : rattachements modifiés, ajoutés (sans rat_id) ou retirés ({ rat_id, supprime }).

const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '');
let compteur = 0;

export class EditeurRattachements {
  /**
   * options : cote ('personne' : contacts ; 'individu' : personnes) ; premierePage (rattachements lus avec la fiche) ;
   * total (nombre de rattachements) ; charger({ recherche, page, taille }) → { lignes, total } (null : fiche non enregistrée) ;
   * modifications() → rattachements modifiés ; definir(modifications) ; modifiable ; annuaire (recherches) ;
   * ouvrirFiche({ type, id }, evenement) ; niveaux (référentiel, icônes) ; historique(cooId) ; message.
   */
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.options = options;
    this.ouverts = new Set();
    this.page = 1;
    this.recherche = '';
    this.lignes = options.premierePage ?? [];
    this.total = options.total ?? this.lignes.length;
    this.rendre();
  }

  get modifications() { return this.options.modifications() ?? []; }

  /** Rattachement affiché : version modifiée s'il y en a une. */
  #courant(l) { return this.modifications.find((m) => m.rat_id && m.rat_id === l.rat_id) ?? l; }

  #cle(r) { return r.rat_id ? `r${r.rat_id}` : r._cle; }

  /** Changement d'un rattachement (existant ou nouveau) reporté dans les modifications. */
  #modifier(r, changement, rendre = false) {
    const mods = [...this.modifications];
    const i = mods.findIndex((m) => this.#cle(m) === this.#cle(r));
    const base = i >= 0 ? mods[i] : r;
    const nouveau = { ...base, ...changement };
    if (i >= 0) mods[i] = nouveau; else mods.push(nouveau);
    this.options.definir(mods);
    if (rendre) this.rendre();
  }

  async #charger() {
    if (!this.options.charger) return;
    const zone = this.conteneur.querySelector('.rattachements-liste');
    zone?.classList.add('chargement');
    try {
      const r = await this.options.charger({ recherche: this.recherche, page: this.page, taille: TAILLE_PAGE_RATTACHEMENTS });
      this.lignes = r.lignes;
      this.total = r.total;
      this.ouverts.clear();
      this.rendre();
    } catch (e) {
      this.options.message?.(e.message, 'erreur');
    } finally {
      zone?.classList.remove('chargement');
    }
  }

  rendre() {
    const { cote, modifiable } = this.options;
    const nouveaux = this.modifications.filter((m) => !m.rat_id);
    const pages = Math.max(1, Math.ceil(this.total / TAILLE_PAGE_RATTACHEMENTS));
    const debut = this.total ? (this.page - 1) * TAILLE_PAGE_RATTACHEMENTS + 1 : 0;
    const fin = Math.min(this.page * TAILLE_PAGE_RATTACHEMENTS, this.total);
    const nbModifs = this.modifications.filter((m) => m.rat_id).length;
    const pagination = this.options.charger && (this.total > TAILLE_PAGE_RATTACHEMENTS || this.recherche);
    this.conteneur.innerHTML = `<div class="rattachements">
      <div class="rattachements-barre">
        ${this.options.charger ? `<input type="search" data-recherche placeholder="${cote === 'personne' ? 'Rechercher un contact (nom, fonction, service)…' : 'Rechercher une personne…'}" value="${echapper(this.recherche)}">` : ''}
        <span class="aide">${this.total} ${cote === 'personne' ? 'contact' : 'rattachement'}${this.total > 1 ? 's' : ''}${this.recherche ? ' trouvé(s)' : ''}${nbModifs + nouveaux.length ? ` · ${nbModifs + nouveaux.length} modification(s) à enregistrer` : ''}</span>
        ${pagination ? `<span class="rattachements-pages"><button type="button" data-page="-1" ${this.page <= 1 ? 'disabled' : ''} title="Page précédente">‹</button>
          <span>${debut}–${fin} sur ${this.total}</span>
          <button type="button" data-page="1" ${this.page >= pages ? 'disabled' : ''} title="Page suivante">›</button></span>` : ''}
        ${modifiable ? `<button type="button" data-ajout>${cote === 'personne' ? '＋ Contact' : '＋ Rattacher à une personne'}</button>` : ''}
      </div>
      ${nouveaux.length ? `<h4 class="rattachements-titre">Nouveaux (enregistrement de la fiche)</h4>${nouveaux.map((r) => this.#carte(r)).join('')}` : ''}
      <div class="rattachements-liste">
        ${this.lignes.length ? this.lignes.map((l) => this.#carte(this.#courant(l))).join('')
          : `<p class="aide">${this.recherche ? 'Aucun résultat.' : cote === 'personne' ? 'Aucun contact rattaché.' : 'Rattaché à aucune personne.'}</p>`}
      </div></div>`;
    this.conteneur.querySelectorAll('.rattachement[data-cle]').forEach((carte) => this.#brancher(carte));
    this.conteneur.querySelector('[data-ajout]')?.addEventListener('click', () => this.#ajouter().catch((e) => this.options.message?.(e.message, 'erreur')));
    this.conteneur.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { this.page += Number(b.dataset.page); this.#charger(); }));
    const recherche = this.conteneur.querySelector('[data-recherche]');
    let minuterie;
    recherche?.addEventListener('input', () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => { this.recherche = recherche.value.trim(); this.page = 1; this.#charger().then(() => { const r = this.conteneur.querySelector('[data-recherche]'); r?.focus(); r?.setSelectionRange(r.value.length, r.value.length); }); }, 300);
    });
  }

  #carte(r) {
    const { cote, modifiable } = this.options;
    const nom = cote === 'personne' ? (r.individu || [r.nouvel_individu?.civilite, r.nouvel_individu?.prenom, r.nouvel_individu?.nom].filter(Boolean).join(' ')) : r.personne;
    const icone = cote === 'personne' ? '👤' : this.options.niveaux?.find((n) => n.code === r.niveau)?.icone ?? '🏢';
    const cible = cote === 'personne' ? r.ind_id : r.per_id;
    const coords = (r.coordonnees ?? []).filter((u) => !estVide(u));
    const cle = this.#cle(r);
    const modifie = !!r.rat_id && this.modifications.some((m) => m.rat_id === r.rat_id);
    const ouvert = !r.supprime && (this.ouverts.has(cle) || (modifiable && !r.rat_id));
    return `<article class="rattachement ${r.actif === false ? 'inactif' : ''} ${r.supprime ? 'retire' : ''} ${modifie && !r.supprime ? 'modifie' : ''}" data-cle="${cle}">
      <header>
        <span class="rattachement-nom">${icone} ${cible ? `<a href="/fiche/${cote === 'personne' ? 'individu' : 'personne'}/${cible}" data-ouvrir>${echapper(nom ?? '')}</a>` : `<b>${echapper(nom ?? '')}</b> <small class="aide">(nouveau)</small>`}</span>
        ${r.principal ? '<span class="badge" title="Contact principal de la personne">★ principal</span>' : ''}${r.titulaire ? '<span class="badge">titulaire</span>' : ''}${r.actif === false ? '<span class="badge gris">inactif</span>' : ''}
        ${r.supprime ? '<span class="badge alerte">retiré à l\'enregistrement</span>' : modifie ? '<span class="badge">modifié</span>' : ''}
        <span class="rattachement-fonction">${echapper([r.fonction, r.service].filter(Boolean).join(' · '))}</span>
        <span class="aide">${r.debut || r.fin ? `${dateFr(r.debut) || '…'} → ${dateFr(r.fin) || '…'}` : ''}</span>
        <span class="rattachement-coords">${coords.slice(0, 3).map((u) => echapper(texteCoordonnee(u))).join(' · ')}</span>
        ${r.supprime ? (modifiable ? '<button type="button" data-annuler-retrait>Annuler le retrait</button>' : '')
          : `<button type="button" data-plier title="${ouvert ? 'Replier' : 'Détails et coordonnées propres'}">${ouvert ? '▴' : '▾'}</button>
             ${modifiable ? '<button type="button" data-retirer title="Retirer ce rattachement (à l\'enregistrement)">✕</button>' : ''}`}
      </header>
      ${ouvert ? `<div class="rattachement-detail">
        <div class="rattachement-champs">
          <label>Fonction <input data-r="fonction" value="${echapper(r.fonction ?? '')}" ${modifiable ? '' : 'readonly'}></label>
          <label>Service <input data-r="service" value="${echapper(r.service ?? '')}" ${modifiable ? '' : 'readonly'}></label>
          <label>Début <input type="date" data-r="debut" value="${echapper(r.debut ?? '')}" ${modifiable ? '' : 'readonly'}></label>
          <label>Fin <input type="date" data-r="fin" value="${echapper(r.fin ?? '')}" ${modifiable ? '' : 'readonly'}></label>
          <label class="ligne"><input type="checkbox" data-r="principal" ${r.principal ? 'checked' : ''} ${modifiable ? '' : 'disabled'}> Contact principal</label>
          <label class="ligne"><input type="checkbox" data-r="actif" ${r.actif !== false ? 'checked' : ''} ${modifiable ? '' : 'disabled'}> Actif</label>
          <label class="plein">Commentaire <input data-r="commentaire" value="${echapper(r.commentaire ?? '')}" ${modifiable ? '' : 'readonly'}></label>
        </div>
        <h4>Coordonnées propres à ce rattachement</h4>
        <div class="rattachement-coordonnees"></div>
      </div>` : ''}
    </article>`;
  }

  /** Rattachement d'une carte : modification ou nouveau, sinon ligne de la page. */
  #rattachement(cle) {
    return this.modifications.find((m) => this.#cle(m) === cle) ?? this.lignes.find((l) => this.#cle(l) === cle);
  }

  #brancher(carte) {
    const cle = carte.dataset.cle;
    const r = () => this.#rattachement(cle);
    carte.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const x = r();
      this.options.ouvrirFiche?.({ type: this.options.cote === 'personne' ? 'individu' : 'personne', id: this.options.cote === 'personne' ? x.ind_id : x.per_id }, e);
    });
    carte.querySelector('[data-plier]')?.addEventListener('click', () => {
      if (this.ouverts.has(cle)) this.ouverts.delete(cle); else this.ouverts.add(cle);
      this.rendre();
    });
    carte.querySelector('[data-retirer]')?.addEventListener('click', () => {
      const x = r();
      if (!x.rat_id) {
        this.options.definir(this.modifications.filter((m) => this.#cle(m) !== cle));
        this.rendre();
        return;
      }
      this.#modifier(x, { supprime: true }, true);
    });
    carte.querySelector('[data-annuler-retrait]')?.addEventListener('click', () => {
      const x = r();
      const { supprime, ...reste } = x;
      // Retrait annulé : si rien d'autre n'avait changé, le rattachement sort des modifications.
      const page = this.lignes.find((l) => l.rat_id === x.rat_id);
      const inchange = page && JSON.stringify(page) === JSON.stringify(reste);
      this.options.definir(inchange ? this.modifications.filter((m) => m.rat_id !== x.rat_id) : this.modifications.map((m) => (m.rat_id === x.rat_id ? reste : m)));
      this.rendre();
    });
    carte.querySelectorAll('[data-r]').forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      this.#modifier(r(), { [el.dataset.r]: el.type === 'checkbox' ? el.checked : el.value || null });
    }));
    const zone = carte.querySelector('.rattachement-coordonnees');
    if (zone) {
      new EditeurCoordonnees(zone, {
        valeur: () => r()?.coordonnees ?? [], definir: (c) => this.#modifier(r(), { coordonnees: c }), modifiable: this.options.modifiable,
        historique: this.options.historique, ouvrirFiche: this.options.ouvrirFiche, message: this.options.message, compact: true, nom: cle,
      });
    }
  }

  async #ajouter() {
    const { cote, annuaire } = this.options;
    const presents = [...this.lignes, ...this.modifications];
    let nouveau;
    if (cote === 'personne') {
      const r = await choisirIndividu({ annuaire, titre: 'Ajouter un contact', exclure: presents.map((x) => Number(x.ind_id)).filter(Boolean) });
      if (!r) return;
      nouveau = r.individu
        ? { ind_id: r.individu.id, individu: r.individu.nom_complet }
        : { nouvel_individu: r.nouveau, individu: [r.nouveau.civilite, r.nouveau.prenom, r.nouveau.nom].filter(Boolean).join(' ') };
    } else {
      const p = await choisirPersonne({ annuaire, titre: 'Rattacher à une personne', exclure: presents.map((x) => Number(x.per_id)).filter(Boolean) });
      if (!p) return;
      nouveau = { per_id: p.id, personne: p.raison_sociale, niveau: p.niveau };
    }
    // Coordonnées professionnelles proposées : un portable et un e-mail.
    const coordonnees = coordonneesParDefaut({ telephone: 'PORTABLE', email: 'PRO' }).filter((c) => c.nature !== 'ADRESSE');
    const cle = `n${++compteur}`;
    this.ouverts.add(cle);
    this.options.definir([...this.modifications, {
      _cle: cle, rat_id: null, fonction: null, service: null, principal: this.total === 0 && !this.modifications.some((m) => !m.rat_id) && cote === 'personne',
      titulaire: false, actif: true, coordonnees, ...nouveau,
    }]);
    this.rendre();
  }
}
