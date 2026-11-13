// Module MCP, délégations : liste (les miennes, ou toutes pour l'administrateur), création (modèle de plafond, échéance,
// garde-fous levables cochés, client, portée), secret affiché une seule fois avec la configuration à coller dans
// Claude Code, révocation. Composant sans métier : l'application fournit les appels, l'origine de la société et la copie.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui, MODELE_PLAFOND } from '@logibtp/socle';
import { echapper, formatDate, formatDateHeure, creerCombo, confirmer, ouvrirDialogue, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { echeanceDelegation } from '../src/delegation.js';
import { choixEcran, corpsDelegation, configurationClaudeCode, trierDelegations } from './modeles.js';

export const GROUPE_RACCOURCIS_DELEGATIONS = 'mcp_delegations';
declarerRaccourcis(GROUPE_RACCOURCIS_DELEGATIONS, {
  libelle: texte('mcp.raccourcis.groupe_delegations'),
  actions: { nouvelle: { libelle: texte('mcp.raccourcis.nouvelle_delegation'), defaut: 'Ctrl+Shift+N' } },
});

/** Tableau des délégations (HTML) : `peut.revoquer` ajoute le bouton des délégations actives ; `toutes` montre le compte. */
export function delegationsHtml(liste, { peut = {}, toutes = false } = {}) {
  if (!liste?.length) return `<p class="aide">${texteHtml('mcp.delegations.aucune')}</p>`;
  const lignes = trierDelegations(liste).map((d) => `<tr data-code="${echapper(d.code)}" class="${d.active ? 'mcp-active' : 'mcp-inactive'}">
      ${toutes ? `<td>${echapper(d.compte)}</td>` : ''}<td>${echapper(d.libelle)}</td><td>${echapper(texte(`mcp.modeles.${d.modele}`))}</td>
      <td>${echapper(d.client ?? '')}</td><td>${(d.leves ?? []).map((g) => `<span class="mcp-pastille">${echapper(texte(`mcp.gardes_fous.${g}`))}</span>`).join(' ')}</td>
      <td>${formatDate(d.echeance)}</td><td>${d.premier_usage ? formatDateHeure(d.premier_usage) : `<span class="aide">${texteHtml('mcp.delegations.jamais')}</span>`}</td>
      <td>${d.active ? `${iconeHtml('mcp_active')} ${texteHtml('mcp.delegations.active')}`
        : d.revoquee_le ? `${iconeHtml('mcp_revoquee')} ${texteHtml('mcp.delegations.revoquee', { date: formatDateHeure(d.revoquee_le), par: d.revoquee_par ?? '' })}`
          : `${iconeHtml('mcp_echue')} ${texteHtml('mcp.delegations.echue')}`}</td>
      <td class="cellule-boutons">${peut.revoquer && d.active ? `<button type="button" class="bouton-icone danger" data-revoquer="${echapper(d.code)}" title="${echapper(texte('mcp.delegations.revoquer'))}">${iconeHtml('mcp_revoquer')}</button>` : ''}</td></tr>`).join('');
  return `<table class="tableau-compact mcp-table"><thead><tr>${toutes ? `<th>${texteHtml('mcp.delegations.compte')}</th>` : ''}<th>${texteHtml('mcp.delegations.libelle')}</th>
    <th>${texteHtml('mcp.delegations.modele')}</th><th>${texteHtml('mcp.delegations.client')}</th><th>${texteHtml('mcp.delegations.leves')}</th>
    <th>${texteHtml('mcp.delegations.echeance')}</th><th>${texteHtml('mcp.delegations.premier_usage')}</th><th>${texteHtml('mcp.delegations.etat')}</th><th></th></tr></thead>
    <tbody>${lignes}</tbody></table>`;
}

/** Contenu de la fenêtre du secret (HTML) : secret, adresse, commande et fichier .mcp.json, chacun avec son bouton de copie. */
export function secretHtml(config, secret) {
  const bloc = (cle, valeur, multiligne = false) => `<section class="mcp-copie"><h3>${texteHtml(`mcp.secret.${cle}`)}</h3>
    ${multiligne ? `<pre class="mcp-code" data-valeur="${cle}">${echapper(valeur)}</pre>` : `<code class="mcp-code" data-valeur="${cle}">${echapper(valeur)}</code>`}
    <button type="button" data-copier="${cle}">${iconeHtml('mcp_copier')} ${texteHtml('mcp.secret.copier')}</button></section>`;
  return `<p class="mcp-avertissement">${iconeHtml('mcp_avertissement')} ${texteHtml('mcp.secret.une_fois')}</p>
    ${bloc('secret', secret)}${bloc('url', config.url)}${bloc('commande', config.commande)}${bloc('json', config.json, true)}
    <p class="aide">${texteHtml('mcp.secret.aide')}</p>`;
}

/**
 * Délégations. options : { api: { liste(), choix(), creer(corps), revoquer(code) } (promesses), origine (adresse de la
 * société, « https://… »), toutes (vue administrateur : toutes les délégations, sans création), peut: { creer, revoquer },
 * copier(texte) (presse-papiers), apresEcriture(), message(texte), erreur(e) }.
 */
export class PanneauDelegations {
  #zone;
  #o;
  #liste = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = {
      api: {}, peut: {}, toutes: false, origine: globalThis.location?.origin ?? '',
      copier: (t) => globalThis.navigator?.clipboard?.writeText(t), apresEcriture: () => {}, message: () => {}, erreur: () => {}, ...options,
    };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('keydown', (e) => {
      if (actionDe(e, GROUPE_RACCOURCIS_DELEGATIONS) === 'nouvelle' && this.#peutCreer()) { e.preventDefault(); this.nouvelle(); }
    });
  }

  #peutCreer() { return Boolean(this.#o.peut.creer) && !this.#o.toutes; }

  async charger() {
    try {
      this.#liste = (await this.#o.api.liste()) ?? [];
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #rendre() {
    const titre = this.#o.toutes ? 'mcp.delegations.titre_toutes' : 'mcp.delegations.titre';
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('mcp_delegation')} ${texteHtml(titre)}
        ${this.#peutCreer() ? `<button type="button" data-nouvelle>${iconeHtml('mcp_ajouter')} ${texteHtml('mcp.delegations.nouvelle')}</button>` : ''}</h2>
      ${this.#o.toutes ? '' : `<p class="aide">${texteHtml('mcp.delegations.aide')}</p>`}
      ${delegationsHtml(this.#liste, { peut: this.#o.peut, toutes: this.#o.toutes })}`;
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-nouvelle]')) this.nouvelle();
    else if (b.dataset.revoquer) this.#revoquer(this.#liste.find((d) => d.code === b.dataset.revoquer));
  }

  /** Saisie d'une nouvelle délégation, puis secret affiché une seule fois. */
  async nouvelle() {
    if (!this.#peutCreer()) return;
    let choix;
    try {
      choix = choixEcran(await this.#o.api.choix());
    } catch (e) {
      this.#o.erreur(e);
      return;
    }
    if (!choix.modeles.length) { this.#o.message(texte('mcp.creation.aucun_modele')); return; }
    let modele;
    let portee;
    const jour = aujourdhui();
    const corps = await ouvrirDialogue({
      titre: texte('mcp.creation.titre'), classe: 'mcp-dialogue', valeurAnnulation: null,
      html: `<label>${texteHtml('mcp.creation.libelle')} <input type="text" data-libelle maxlength="200"></label>
        <label>${texteHtml('mcp.creation.modele')} <span data-modele></span></label>
        <p class="aide" data-aide-modele></p>
        <label>${texteHtml('mcp.creation.jours')} <input type="number" data-jours min="1" max="${choix.echeance_max}" step="1" value="${choix.echeance_defaut}">
          <span class="aide" data-echeance></span></label>
        <label>${texteHtml('mcp.creation.client')} <input type="text" data-client maxlength="100" value="${echapper(texte('mcp.creation.client_defaut'))}"></label>
        ${choix.portees.length ? `<label>${texteHtml('mcp.creation.portee')} <span data-portee></span></label>` : ''}
        <fieldset class="mcp-gardes-fous"><legend>${texteHtml('mcp.creation.gardes_fous')}</legend>
          <p class="aide">${texteHtml(choix.levables.length ? 'mcp.creation.gardes_fous_aide' : 'mcp.creation.aucun_levable')}</p>
          ${choix.gardes_fous.map((g) => `<label class="ligne" title="${echapper(texte(`mcp.gardes_fous_aide.${g}`))}"><input type="checkbox" data-leve="${g}" ${choix.levables.includes(g) ? '' : 'disabled'}>
            ${texteHtml('mcp.creation.lever', { garde_fou: texte(`mcp.gardes_fous.${g}`) })}</label>`).join('')}</fieldset>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: null },
        { libelle: texte('mcp.creation.creer'), principal: true, valeur: (d) => corpsDelegation({
          libelle: d.querySelector('[data-libelle]').value, modele: modele.valeurCombo, jours: d.querySelector('[data-jours]').value,
          client: d.querySelector('[data-client]').value, portee: portee?.valeurCombo,
          leves: [...d.querySelectorAll('[data-leve]:checked')].map((c) => c.dataset.leve),
        }) }],
      construire: (d) => {
        const defaut = choix.modeles.includes(MODELE_PLAFOND.PREPARATION) ? MODELE_PLAFOND.PREPARATION : choix.modeles[0];
        modele = creerCombo({ options: choix.modeles.map((m) => ({ valeur: m, libelle: texte(`mcp.modeles.${m}`) })), valeur: defaut, vide: false });
        d.querySelector('[data-modele]').append(modele);
        const aide = () => { d.querySelector('[data-aide-modele]').textContent = texte(`mcp.modeles_aide.${modele.valeurCombo}`); };
        modele.addEventListener('change', aide);
        aide();
        if (choix.portees.length) {
          portee = creerCombo({ options: choix.portees.map((p) => ({ valeur: p, libelle: texte(`mcp.portees.${p}`) })), valeur: '', vide: true });
          d.querySelector('[data-portee]').append(portee);
        }
        const jours = d.querySelector('[data-jours]');
        const echeance = () => {
          const n = Number.parseInt(jours.value, 10);
          d.querySelector('[data-echeance]').textContent = texte('mcp.creation.echeance', { date: formatDate(echeanceDelegation(jour, Number.isFinite(n) ? n : null, choix.echeance_max)) });
        };
        jours.addEventListener('input', echeance);
        echeance();
      },
    });
    if (!corps) return;
    try {
      const cree = await this.#o.api.creer(corps);
      this.#o.apresEcriture();
      await this.charger();
      await this.afficherSecret(cree.secret);
    } catch (e) {
      this.#o.erreur(e);
    }
  }

  /** Fenêtre du secret (une seule fois) : secret, adresse /mcp et configuration de Claude Code, copiables. */
  afficherSecret(secret) {
    const config = configurationClaudeCode({ origine: this.#o.origine, secret });
    const valeurs = { secret, url: config.url, commande: config.commande, json: config.json };
    return ouvrirDialogue({
      titre: texte('mcp.secret.titre'), classe: 'mcp-dialogue mcp-secret', valeurAnnulation: undefined,
      html: secretHtml(config, secret),
      boutons: [{ libelle: texte('mcp.secret.fermer'), valeur: undefined, principal: true }],
      construire: (d) => d.querySelectorAll('[data-copier]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await this.#o.copier(valeurs[b.dataset.copier]);
          this.#o.message(texte('mcp.secret.copie'));
        } catch (e) {
          this.#o.erreur(e);
        }
      })),
    });
  }

  async #revoquer(d) {
    if (!d || !await confirmer(texte('mcp.delegations.confirmer_revocation', { libelle: d.libelle }), { ok: texte('mcp.delegations.revoquer'), danger: true })) return;
    try {
      await this.#o.api.revoquer(d.code);
      this.#o.apresEcriture();
    } catch (e) {
      this.#o.erreur(e);
    }
    await this.charger();
  }
}
