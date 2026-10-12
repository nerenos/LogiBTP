import { echapper } from '@logibtp/socle/ui';
import { choisirPersonne } from './selection.js';

// Liens d'une personne : hiérarchie (niveau supérieur, niveaux inférieurs) et liens typés avec d'autres personnes
// (facturer à, livrer à, factor, partenaire…), vus des deux côtés (libellé inverse depuis la cible).

export class EditeurLiens {
  /**
   * options : valeur() → liens ; definir(liens) ; modifiable ; annuaire ; types (référentiel des types de lien) ;
   * parent ({ id, libelle } | null) ; enfants (résumés) ; personneId ; ouvrirFiche({ type, id }, evenement) ; message.
   */
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.options = options;
    this.rendre();
  }

  get liens() { return this.options.valeur() ?? []; }

  #definir(liens) {
    this.options.definir(liens);
    this.rendre();
  }

  /** Options de type : sens direct et sens inverse (« ← » : vu depuis l'autre personne). */
  #optionsType(l) {
    const types = this.options.types.filter((t) => t.actif !== false || t.code === l.tli_code);
    return types.map((t) => `<option value="${t.code}|0" ${t.code === l.tli_code && !l.inverse ? 'selected' : ''}>${echapper(t.libelle)} →</option>
      <option value="${t.code}|1" ${t.code === l.tli_code && l.inverse ? 'selected' : ''}>← ${echapper(t.libelle_inverse)}</option>`).join('');
  }

  rendre() {
    const { modifiable, parent, enfants = [] } = this.options;
    const lien = (type, id, libelle) => `<a href="/fiche/${type}/${id}" data-ouvrir="${type}:${id}">${echapper(libelle)}</a>`;
    const type = (l) => {
      const t = this.options.types.find((x) => x.code === l.tli_code);
      return t ? (l.inverse ? t.libelle_inverse : t.libelle) : l.tli_code;
    };
    this.conteneur.innerHTML = `<div class="liens">
      <fieldset class="fiche-groupe"><legend>Hiérarchie</legend>
        <p>Niveau supérieur : ${parent ? lien('personne', parent.id, parent.libelle) : '<span class="aide">aucun (racine)</span>'}
          <small class="aide">(champ « Niveau supérieur » de l'onglet Identité)</small></p>
        <p>Niveaux inférieurs : ${enfants.length ? enfants.map((e) => `${echapper(e.icone ?? '')} ${lien('personne', e.id, e.raison_sociale)}${e.ville ? ` <small class="aide">${echapper(e.ville)}</small>` : ''}`).join(' · ') : '<span class="aide">aucun</span>'}</p>
      </fieldset>
      <fieldset class="fiche-groupe"><legend>Liens avec d'autres personnes</legend>
        ${this.liens.length ? `<table class="coord-table"><thead><tr><th>Lien</th><th>Personne</th><th>Commentaire</th><th>Début</th><th>Fin</th>${modifiable ? '<th></th>' : ''}</tr></thead><tbody>
        ${this.liens.map((l, i) => (modifiable ? `<tr data-i="${i}"><td><select data-l="type">${this.#optionsType(l)}</select></td>
            <td>${l.autre_id ? lien('personne', l.autre_id, l.autre ?? `Personne ${l.autre_id}`) : ''} <button type="button" data-choisir title="Choisir la personne">…</button></td>
            <td><input data-l="commentaire" value="${echapper(l.commentaire ?? '')}"></td><td><input type="date" data-l="debut" value="${echapper(l.debut ?? '')}"></td>
            <td><input type="date" data-l="fin" value="${echapper(l.fin ?? '')}"></td><td><button type="button" data-retirer title="Retirer">✕</button></td></tr>`
          : `<tr><td>${echapper(type(l))}</td><td>${l.autre_id ? lien('personne', l.autre_id, l.autre ?? '') : ''}</td><td>${echapper(l.commentaire ?? '')}</td>
            <td>${echapper(l.debut ?? '')}</td><td>${echapper(l.fin ?? '')}</td></tr>`)).join('')}</tbody></table>` : '<p class="aide">Aucun lien.</p>'}
        ${modifiable ? '<p><button type="button" data-ajout>＋ Lien</button></p>' : ''}
      </fieldset></div>`;
    this.#brancher();
  }

  #brancher() {
    const c = this.conteneur;
    c.querySelectorAll('[data-ouvrir]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const [type, id] = a.dataset.ouvrir.split(':');
      this.options.ouvrirFiche?.({ type, id: Number(id) }, e);
    }));
    c.querySelectorAll('tr[data-i]').forEach((tr) => {
      const i = Number(tr.dataset.i);
      const modifier = (ch) => this.options.definir(this.liens.map((l, j) => (j === i ? { ...l, ...ch } : l)));
      tr.querySelector('[data-l="type"]').addEventListener('change', (e) => {
        const [code, inverse] = e.target.value.split('|');
        modifier({ tli_code: code, inverse: inverse === '1' });
      });
      tr.querySelectorAll('input[data-l]').forEach((el) => el.addEventListener('input', () => modifier({ [el.dataset.l]: el.value || null })));
      tr.querySelector('[data-retirer]').addEventListener('click', () => this.#definir(this.liens.filter((_, j) => j !== i)));
      tr.querySelector('[data-choisir]').addEventListener('click', async () => {
        const p = await choisirPersonne({ annuaire: this.options.annuaire, titre: 'Personne liée', exclure: [Number(this.options.personneId)] });
        if (p) this.#definir(this.liens.map((l, j) => (j === i ? { ...l, autre_id: p.id, autre: p.raison_sociale } : l)));
      });
    });
    c.querySelector('[data-ajout]')?.addEventListener('click', async () => {
      const p = await choisirPersonne({ annuaire: this.options.annuaire, titre: 'Personne liée', exclure: [Number(this.options.personneId)] });
      if (!p) return;
      const type = this.options.types.find((t) => t.actif !== false);
      this.#definir([...this.liens, { lpe_id: null, tli_code: type?.code ?? null, inverse: false, autre_id: p.id, autre: p.raison_sociale }]);
    });
  }
}
