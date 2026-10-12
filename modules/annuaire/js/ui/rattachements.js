import { echapper } from '@logibtp/socle/ui';
import { texteCoordonnee, estVide, coordonneesParDefaut } from '../src/coordonnees.js';
import { EditeurCoordonnees } from './coordonnees.js';
import { choisirPersonne, choisirIndividu } from './selection.js';

// Rattachements des individus aux personnes, vus d'une personne (contacts : salariés, dirigeants…) ou d'un individu
// (personnes auxquelles il est rattaché, dont son compte particulier). Chaque rattachement porte sa fonction, son
// service, ses dates et ses coordonnées propres (portable et e-mail professionnels…).

const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '');

export class EditeurRattachements {
  /**
   * options : cote ('personne' : contacts ; 'individu' : personnes) ; valeur() ; definir(rattachements) ; modifiable ;
   * annuaire (recherches) ; ouvrirFiche({ type, id }) ; niveaux (référentiel, icônes) ; historique(cooId) ; message.
   */
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.options = options;
    this.ouverts = new Set();
    this.rendre();
  }

  get liste() { return this.options.valeur() ?? []; }

  #definir(liste) {
    this.options.definir(liste);
    this.rendre();
  }

  #modifier(i, changement) {
    this.options.definir(this.liste.map((r, j) => (j === i ? { ...r, ...changement } : r)));
  }

  rendre() {
    const { cote, modifiable } = this.options;
    const liste = this.liste;
    const titreAjout = cote === 'personne' ? '＋ Contact' : '＋ Rattacher à une personne';
    this.conteneur.innerHTML = `<div class="rattachements">
      ${liste.length ? liste.map((r, i) => this.#carte(r, i)).join('') : `<p class="aide">${cote === 'personne' ? 'Aucun contact rattaché.' : 'Rattaché à aucune personne.'}</p>`}
      ${modifiable ? `<p><button type="button" data-ajout>${titreAjout}</button></p>` : ''}</div>`;
    this.conteneur.querySelectorAll('.rattachement[data-i]').forEach((carte) => this.#brancher(carte, Number(carte.dataset.i)));
    this.conteneur.querySelector('[data-ajout]')?.addEventListener('click', () => this.#ajouter().catch((e) => this.options.message?.(e.message, 'erreur')));
  }

  #carte(r, i) {
    const { cote, modifiable } = this.options;
    const nom = cote === 'personne' ? (r.individu || [r.nouvel_individu?.civilite, r.nouvel_individu?.prenom, r.nouvel_individu?.nom].filter(Boolean).join(' ')) : r.personne;
    const icone = cote === 'personne' ? '👤' : this.options.niveaux?.find((n) => n.code === r.niveau)?.icone ?? '🏢';
    const cible = cote === 'personne' ? r.ind_id : r.per_id;
    const coords = (r.coordonnees ?? []).filter((u) => !estVide(u));
    const ouvert = this.ouverts.has(i) || (modifiable && !r.rat_id);
    return `<article class="rattachement ${r.actif === false ? 'inactif' : ''}" data-i="${i}">
      <header>
        <span class="rattachement-nom">${icone} ${cible ? `<a href="/fiche/${cote === 'personne' ? 'individu' : 'personne'}/${cible}" data-ouvrir>${echapper(nom ?? '')}</a>` : `<b>${echapper(nom ?? '')}</b> <small class="aide">(nouveau)</small>`}</span>
        ${r.principal ? '<span class="badge" title="Contact principal de la personne">★ principal</span>' : ''}${r.titulaire ? '<span class="badge">titulaire</span>' : ''}${r.actif === false ? '<span class="badge gris">inactif</span>' : ''}
        <span class="rattachement-fonction">${echapper([r.fonction, r.service].filter(Boolean).join(' · '))}</span>
        <span class="aide">${r.debut || r.fin ? `${dateFr(r.debut) || '…'} → ${dateFr(r.fin) || '…'}` : ''}</span>
        <span class="rattachement-coords">${coords.slice(0, 3).map((u) => echapper(texteCoordonnee(u))).join(' · ')}</span>
        <button type="button" data-plier title="${ouvert ? 'Replier' : 'Détails et coordonnées propres'}">${ouvert ? '▴' : '▾'}</button>
        ${modifiable ? '<button type="button" data-retirer title="Retirer ce rattachement (à l\'enregistrement)">✕</button>' : ''}
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

  #brancher(carte, i) {
    const r = this.liste[i];
    carte.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.options.ouvrirFiche?.({ type: this.options.cote === 'personne' ? 'individu' : 'personne', id: this.options.cote === 'personne' ? r.ind_id : r.per_id }, e);
    });
    carte.querySelector('[data-plier]').addEventListener('click', () => {
      if (this.ouverts.has(i)) this.ouverts.delete(i); else this.ouverts.add(i);
      this.rendre();
    });
    carte.querySelector('[data-retirer]')?.addEventListener('click', () => {
      const nom = this.options.cote === 'personne' ? r.individu : r.personne;
      if (r.rat_id && !confirm(`Retirer le rattachement ${nom ? `de ${nom} ` : ''}? Ses coordonnées propres seront supprimées à l'enregistrement.`)) return;
      this.ouverts.clear();
      this.#definir(this.liste.filter((_, j) => j !== i));
    });
    carte.querySelectorAll('[data-r]').forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      this.#modifier(i, { [el.dataset.r]: el.type === 'checkbox' ? el.checked : el.value || null });
    }));
    const zone = carte.querySelector('.rattachement-coordonnees');
    if (zone) {
      new EditeurCoordonnees(zone, {
        valeur: () => this.liste[i]?.coordonnees ?? [], definir: (c) => this.#modifier(i, { coordonnees: c }), modifiable: this.options.modifiable,
        historique: this.options.historique, ouvrirFiche: this.options.ouvrirFiche, message: this.options.message, compact: true, nom: `r${i}`,
      });
    }
  }

  async #ajouter() {
    const { cote, annuaire } = this.options;
    const liste = this.liste;
    let nouveau;
    if (cote === 'personne') {
      const r = await choisirIndividu({ annuaire, titre: 'Ajouter un contact', exclure: liste.map((x) => Number(x.ind_id)).filter(Boolean) });
      if (!r) return;
      nouveau = r.individu
        ? { ind_id: r.individu.id, individu: r.individu.nom_complet }
        : { nouvel_individu: r.nouveau, individu: [r.nouveau.civilite, r.nouveau.prenom, r.nouveau.nom].filter(Boolean).join(' ') };
    } else {
      const p = await choisirPersonne({ annuaire, titre: 'Rattacher à une personne', exclure: liste.map((x) => Number(x.per_id)).filter(Boolean) });
      if (!p) return;
      nouveau = { per_id: p.id, personne: p.raison_sociale, niveau: p.niveau };
    }
    // Coordonnées professionnelles proposées : un portable et un e-mail.
    const coordonnees = coordonneesParDefaut({ telephone: 'PORTABLE', email: 'PRO' }).filter((c) => c.nature !== 'ADRESSE');
    this.ouverts.add(liste.length);
    this.#definir([...liste, { rat_id: null, fonction: null, service: null, principal: liste.length === 0 && cote === 'personne', titulaire: false, actif: true, coordonnees, ...nouveau }]);
  }
}
