// Module MCP, liste blanche des clients OAuth de la société (lot 12, administrateur) : adresse du document de métadonnées
// du client (client_id CIMD), libellé, actif. Un client absent ou désactivé ne peut pas demander d'autorisation.
// Composant sans métier : l'application fournit les appels.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatDateHeure, confirmer } from '@logibtp/socle/ui';
import { corpsClients } from './modeles.js';

/** Tableau des clients (HTML) : actif cochable, libellé modifiable, adresse du document, retrait ; ligne d'ajout. */
export function clientsOAuthHtml(liste) {
  const lignes = (liste ?? []).map((c, i) => `<tr data-rang="${i}">
      <td><input type="checkbox" data-actif ${c.actif ? 'checked' : ''} title="${echapper(texte('mcp.clients.actif'))}"></td>
      <td><input type="text" data-libelle maxlength="100" value="${echapper(c.libelle ?? '')}"></td>
      <td><code class="mcp-code">${echapper(c.client_id)}</code></td>
      <td class="aide">${c.modifie_le ? texteHtml('mcp.clients.modifie', { date: formatDateHeure(c.modifie_le), par: c.modifie_par ?? '' }) : ''}</td>
      <td class="cellule-boutons"><button type="button" class="bouton-icone danger" data-retirer="${i}" title="${echapper(texte('mcp.clients.retirer'))}">${iconeHtml('mcp_revoquer')}</button></td></tr>`).join('');
  return `<table class="tableau-compact mcp-table"><thead><tr><th>${texteHtml('mcp.clients.actif')}</th><th>${texteHtml('mcp.clients.libelle')}</th>
      <th>${texteHtml('mcp.clients.client_id')}</th><th></th><th></th></tr></thead>
    <tbody>${lignes || `<tr><td colspan="5" class="aide">${texteHtml('mcp.clients.aucun')}</td></tr>`}</tbody>
    <tfoot><tr><td></td><td><input type="text" data-nouveau-libelle maxlength="100" placeholder="${echapper(texte('mcp.clients.libelle'))}"></td>
      <td><input type="url" data-nouveau-client maxlength="500" placeholder="${echapper(texte('mcp.clients.exemple'))}"></td><td></td>
      <td class="cellule-boutons"><button type="button" class="bouton-icone" data-ajouter title="${echapper(texte('mcp.clients.ajouter'))}">${iconeHtml('mcp_ajouter')}</button></td></tr></tfoot></table>`;
}

/**
 * Clients OAuth autorisés. options : { api: { liste(), enregistrer(liste) } (promesses), apresEcriture(), erreur(e) }.
 */
export class ClientsOAuth {
  #zone;
  #o;
  #liste = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { api: {}, apresEcriture: () => {}, erreur: () => {}, ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
  }

  async charger() {
    try {
      this.#liste = (await this.#o.api.liste()) ?? [];
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #rendre() {
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('mcp_client_oauth')} ${texteHtml('mcp.clients.titre')}
        <button type="button" data-enregistrer>${iconeHtml('mcp_enregistrer')} ${texteHtml('mcp.clients.enregistrer')}</button></h2>
      <p class="aide">${texteHtml('mcp.clients.aide')}</p>${clientsOAuthHtml(this.#liste)}`;
  }

  /** Saisie en cours : lignes affichées (actif, libellé modifiés), sans la ligne d'ajout. */
  #saisie() {
    return this.#liste.map((c, i) => {
      const tr = this.#zone.querySelector(`tr[data-rang="${i}"]`);
      return { ...c, actif: tr?.querySelector('[data-actif]')?.checked ?? c.actif, libelle: tr?.querySelector('[data-libelle]')?.value ?? c.libelle };
    });
  }

  async #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-ajouter]')) {
      const client = this.#zone.querySelector('[data-nouveau-client]').value.trim();
      if (!client) return;
      this.#liste = [...this.#saisie(), { client_id: client, libelle: this.#zone.querySelector('[data-nouveau-libelle]').value, actif: true }];
      this.#rendre();
    } else if (b.dataset.retirer !== undefined) {
      const c = this.#liste[Number(b.dataset.retirer)];
      if (!c || !await confirmer(texte('mcp.clients.confirmer_retrait', { client: c.libelle || c.client_id }), { ok: texte('mcp.clients.retirer'), danger: true })) return;
      this.#liste = this.#saisie().filter((x) => x !== this.#liste[Number(b.dataset.retirer)] && x.client_id !== c.client_id);
      this.#rendre();
    } else if (b.matches('[data-enregistrer]')) {
      try {
        this.#liste = (await this.#o.api.enregistrer(corpsClients(this.#saisie()))) ?? [];
        this.#o.apresEcriture();
      } catch (err) {
        this.#o.erreur(err);
      }
      this.#rendre();
    }
  }
}
