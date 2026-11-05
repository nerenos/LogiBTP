import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Délégations du contrôle N+1 des étapes d'ordres (module Exécution, E30 ; serveur : Btp/DelegationsControle.cs,
// db/268) : par service, membres désignés par le responsable pour contrôler à sa place, pour une période ou sans fin.

/** Délégation vide d'un service (sans fin, à partir d'aujourd'hui non imposé). */
const nouvelle = () => ({ ind_id: null, du: null, au: null, commentaire: '' });

/**
 * Page `/execution/delegations` : un tableau par service ; modifiable par le responsable du service (ou de son parent),
 * un administrateur ou le droit de modifier le paramétrage ; les autres services en consultation.
 */
export class PageDelegationsControle extends PageBase {
  icone = icone('execution_btp_delegations');
  #modifies = new Set();

  get modifiee() { return this.#modifies.size > 0; }

  async ouvrir() {
    this.titre = texte('execution_btp.delegations.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('execution_btp_delegations')} ${texteHtml('execution_btp.delegations.titre')}</h1>
      <label><input type="checkbox" data-tous> ${texteHtml('execution_btp.delegations.tous')}</label></div>
      <p class="aide">${texteHtml('execution_btp.delegations.aide')}</p><div data-services></div></div>`;
    this.conteneur.querySelector('[data-tous]').addEventListener('change', () => this.#rendre());
    this.services = await api.execution.delegations();
    this.#rendre();
  }

  #rendre() {
    const zone = this.conteneur.querySelector('[data-services]');
    const tous = this.conteneur.querySelector('[data-tous]').checked;
    const visibles = this.services.filter((s) => tous || s.modifiable || s.delegations.length > 0);
    zone.innerHTML = visibles.length ? '' : `<p class="aide">${texteHtml('execution_btp.delegations.aucun')}</p>`;
    for (const s of visibles) zone.append(this.#service(s));
  }

  #service(s) {
    const bloc = document.createElement('section');
    const lecture = !s.modifiable;
    bloc.innerHTML = `<h2 class="titre-actions">${echapper(s.libelle)} <small>${echapper(s.code)}</small>
        ${lecture ? '' : `<button type="button" class="bouton-icone" data-ajouter title="${texteHtml('execution_btp.delegations.ajouter')}">${iconeHtml('ajouter')}</button>
          <button type="button" data-enregistrer hidden>${texteHtml('commun.enregistrer')}</button>`}</h2>
      <p class="aide">${texteHtml('execution_btp.delegations.responsable', { nom: s.responsable ?? texte('execution_btp.delegations.sans_responsable') })}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('execution_btp.delegations.delegue')}</th><th>${texteHtml('execution_btp.delegations.du')}</th>
        <th>${texteHtml('execution_btp.delegations.au')}</th><th>${texteHtml('execution_btp.delegations.commentaire')}</th><th>${texteHtml('execution_btp.delegations.trace')}</th>
        ${lecture ? '' : '<th class="cellule-boutons"></th>'}</tr></thead><tbody></tbody></table>`;
    const corps = bloc.querySelector('tbody');
    const changer = () => { this.#modifies.add(s.srv_id); bloc.querySelector('[data-enregistrer]').hidden = false; };
    const rendre = () => {
      corps.innerHTML = s.delegations.length ? '' : `<tr><td colspan="6" class="aide">${texteHtml('execution_btp.delegations.aucune')}</td></tr>`;
      s.delegations.forEach((d, i) => {
        const tr = document.createElement('tr');
        if (d.en_vigueur) tr.classList.add('actif');
        tr.innerHTML = `<td data-delegue></td>
          <td><input type="date" data-du value="${d.du ?? ''}" ${lecture ? 'disabled' : ''}></td>
          <td><input type="date" data-au value="${d.au ?? ''}" ${lecture ? 'disabled' : ''}></td>
          <td><input data-commentaire size="30" maxlength="200" value="${echapper(d.commentaire ?? '')}" ${lecture ? 'readonly' : ''}></td>
          <td class="aide">${d.par ? texteHtml('execution_btp.delegations.par', { par: d.par, le: formatDateHeure(d.le) }) : ''}${d.en_vigueur ? ` ${texteHtml('execution_btp.delegations.en_vigueur')}` : ''}</td>
          ${lecture ? '' : `<td class="cellule-boutons"><button type="button" class="bouton-icone" data-retirer title="${texteHtml('commun.supprimer')}">${iconeHtml('supprimer')}</button></td>`}`;
        if (lecture) {
          tr.querySelector('[data-delegue]').textContent = d.individu ?? '';
        } else {
          const combo = creerCombo({ options: s.membres, valeur: d.ind_id ?? '', vide: true });
          combo.addEventListener('change', () => { d.ind_id = combo.valeurCombo ? Number(combo.valeurCombo) : null; changer(); });
          tr.querySelector('[data-delegue]').append(combo);
          tr.querySelector('[data-du]').addEventListener('change', (e) => { d.du = e.target.value || null; changer(); });
          tr.querySelector('[data-au]').addEventListener('change', (e) => { d.au = e.target.value || null; changer(); });
          tr.querySelector('[data-commentaire]').addEventListener('change', (e) => { d.commentaire = e.target.value; changer(); });
          tr.querySelector('[data-retirer]').addEventListener('click', () => { s.delegations.splice(i, 1); changer(); rendre(); });
        }
        corps.append(tr);
      });
    };
    rendre();
    bloc.querySelector('[data-ajouter]')?.addEventListener('click', () => { s.delegations.push(nouvelle()); changer(); rendre(); });
    bloc.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      if (s.delegations.some((d) => !d.ind_id)) { this.app.message(texte('execution_btp.delegations.delegue_manquant'), 'avertissement'); return; }
      try {
        this.services = await api.execution.enregistrerDelegations(s.srv_id, s.delegations.map((d) => ({ ind_id: d.ind_id, du: d.du, au: d.au, commentaire: d.commentaire })));
        this.#modifies.delete(s.srv_id);
        this.app.message(texte('execution_btp.delegations.enregistre', { service: s.libelle }), 'succes');
        this.#rendre();
      } catch (e) { this.app.erreur(e); }
    });
    return bloc;
  }
}

