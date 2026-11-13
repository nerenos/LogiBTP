// Module MCP, file des propositions des agents : liste (à valider, les miennes, toutes pour l'administrateur) et détail
// d'une proposition (contenu, écarts d'une correction, avertissements) avec ses décisions : accepter (exécutée sous
// l'identité de l'humain), corriger le contenu, refuser avec motif. Composant sans métier : l'application fournit les
// appels, l'adresse d'une cible et la navigation.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { echapper, formatDate, formatDateHeure, confirmer, saisir, ouvrirDialogue, lireStockage, ecrireStockage, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { aplatir, ecartsContenu, lireContenu, texteAvertissement, etatAffiche } from './modeles.js';

export const GROUPE_RACCOURCIS_PROPOSITIONS = 'mcp_propositions';
declarerRaccourcis(GROUPE_RACCOURCIS_PROPOSITIONS, {
  libelle: texte('mcp.raccourcis.groupe_propositions'),
  actions: {
    accepter: { libelle: texte('mcp.raccourcis.accepter'), defaut: 'Ctrl+Enter' },
    refuser: { libelle: texte('mcp.raccourcis.refuser'), defaut: 'Ctrl+Delete' },
  },
});

/** Vues de la file (paramètre `vue` de GET /api/mcp/propositions) ; « toutes » réservée à l'administrateur. */
export const VUES_PROPOSITIONS = Object.freeze({ A_VALIDER: 'a_valider', MIENNES: 'miennes', TOUTES: 'toutes' });

/** Clé du navigateur de la dernière vue choisie. */
export const CLE_VUE = 'mcpPropositionsVue';

/** Tableau de la file (HTML) : libellé, action, agent, échéance, état affiché (échue calculée). */
export function propositionsHtml(liste, jour = aujourdhui()) {
  if (!liste?.length) return `<p class="aide">${texteHtml('mcp.propositions.aucune')}</p>`;
  return `<table class="tableau-compact mcp-table mcp-propositions"><thead><tr><th>${texteHtml('mcp.propositions.colonnes.libelle')}</th>
      <th>${texteHtml('mcp.propositions.colonnes.action')}</th><th>${texteHtml('mcp.propositions.colonnes.compte')}</th><th>${texteHtml('mcp.propositions.colonnes.client')}</th>
      <th>${texteHtml('mcp.propositions.colonnes.cree_le')}</th><th>${texteHtml('mcp.propositions.colonnes.echeance')}</th><th>${texteHtml('mcp.propositions.colonnes.etat')}</th></tr></thead><tbody>
    ${liste.map((p) => {
    const { etat } = etatAffiche(p, jour);
    const nb = (p.avertissements ?? []).length;
    return `<tr data-id="${echapper(p.id)}" class="mcp-etat-${etat.toLowerCase()}"><td><a href="#" data-ouvrir="${echapper(p.id)}">${echapper(p.libelle || texte('mcp.propositions.sans_libelle', { id: p.id }))}</a>
        ${nb ? ` <span class="mcp-avertissement" title="${echapper(texte('mcp.propositions.avertissements_n', { n: nb }))}">${iconeHtml('mcp_avertissement')} ${nb}</span>` : ''}</td>
      <td>${echapper(p.action)}</td><td>${echapper(p.compte)}</td><td>${iconeHtml('mcp_agent')} ${echapper(p.client ?? '')}</td>
      <td>${formatDateHeure(p.cree_le)}</td><td>${formatDate(p.echeance)}</td><td>${echapper(texte(`mcp.etats.${etat}`))}</td></tr>`;
  }).join('')}</tbody></table>`;
}

/** Contenu (chemins et valeurs) d'une proposition, avec les écarts d'une correction en cours s'ils sont donnés (HTML). */
export function contenuHtml(contenu, ecarts = null) {
  const lignes = aplatir(contenu);
  const modifies = new Map((ecarts ?? []).map((x) => [x.chemin, x]));
  const corps = lignes.length
    ? `<table class="tableau-compact mcp-table mcp-contenu"><thead><tr><th>${texteHtml('mcp.propositions.champ')}</th><th>${texteHtml('mcp.propositions.valeur')}</th></tr></thead><tbody>
      ${lignes.map((l) => `<tr class="${modifies.has(l.chemin) ? 'mcp-ecart' : ''}"><td><code>${echapper(l.chemin)}</code></td><td>${echapper(l.valeur)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="aide">${texteHtml('mcp.propositions.contenu_vide')}</p>`;
  return corps;
}

/** Écarts avant / après (HTML) : chemin, valeur proposée par l'agent, valeur corrigée. */
export function ecartsHtml(ecarts) {
  if (!ecarts?.length) return `<p class="aide">${texteHtml('mcp.propositions.aucun_ecart')}</p>`;
  return `<table class="tableau-compact mcp-table mcp-ecarts"><thead><tr><th>${texteHtml('mcp.propositions.champ')}</th><th>${texteHtml('mcp.propositions.avant')}</th><th>${texteHtml('mcp.propositions.apres')}</th></tr></thead><tbody>
    ${ecarts.map((x) => `<tr><td><code>${echapper(x.chemin)}</code></td><td class="mcp-avant">${x.avant === null ? `<span class="aide">${texteHtml('mcp.propositions.absent')}</span>` : echapper(x.avant)}</td>
      <td class="mcp-apres">${x.apres === null ? `<span class="aide">${texteHtml('mcp.propositions.absent')}</span>` : echapper(x.apres)}</td></tr>`).join('')}</tbody></table>`;
}

/** Détail d'une proposition (HTML) ; `peut.decider` : boutons des décisions quand elle est encore en attente. */
export function propositionHtml(p, { peut = {}, jour = aujourdhui(), adresseCible = null } = {}) {
  const { etat, ouverte } = etatAffiche(p, jour);
  const avertissements = p.avertissements ?? [];
  const decider = peut.decider && ouverte;
  return `<h2 class="titre-actions">${iconeHtml('mcp_proposition')} ${echapper(p.libelle || texte('mcp.propositions.sans_libelle', { id: p.id }))}
      <span class="mcp-pastille mcp-etat-${etat.toLowerCase()}">${echapper(texte(`mcp.etats.${etat}`))}</span></h2>
    <dl class="definitions"><dt>${texteHtml('mcp.propositions.colonnes.action')}</dt><dd>${echapper(p.action)}</dd>
      <dt>${texteHtml('mcp.propositions.agent')}</dt><dd>${iconeHtml('mcp_agent')} ${texteHtml('mcp.propositions.via', { compte: p.compte, client: p.client ?? '' })}</dd>
      ${p.cible_type ? `<dt>${texteHtml('mcp.propositions.cible')}</dt><dd>${adresseCible ? `<a href="${echapper(adresseCible)}" data-cible>${echapper(`${p.cible_type} ${p.cible_id ?? ''}`)}</a>` : echapper(`${p.cible_type} ${p.cible_id ?? ''}`)}</dd>` : ''}
      <dt>${texteHtml('mcp.propositions.colonnes.cree_le')}</dt><dd>${formatDateHeure(p.cree_le)}</dd>
      <dt>${texteHtml('mcp.propositions.colonnes.echeance')}</dt><dd>${formatDate(p.echeance)}</dd>
      <dt>${texteHtml('mcp.propositions.droit')}</dt><dd>${echapper(`${p.noeud} · ${p.droit}`)}</dd>
      ${p.corrige_le ? `<dt>${texteHtml('mcp.propositions.corrigee')}</dt><dd>${texteHtml('mcp.propositions.par_le', { par: p.corrige_par ?? '', date: formatDateHeure(p.corrige_le) })}</dd>` : ''}
      ${p.traitee_le ? `<dt>${texteHtml('mcp.propositions.traitee')}</dt><dd>${texteHtml('mcp.propositions.par_le', { par: p.traitee_par ?? '', date: formatDateHeure(p.traitee_le) })}</dd>` : ''}
      ${p.motif ? `<dt>${texteHtml('mcp.propositions.motif')}</dt><dd>${echapper(p.motif)}</dd>` : ''}</dl>
    ${avertissements.length ? `<section class="mcp-avertissements"><h3>${iconeHtml('mcp_avertissement')} ${texteHtml('mcp.propositions.avertissements')}</h3>
      <ul>${avertissements.map((a) => `<li>${echapper(texteAvertissement(a))}</li>`).join('')}</ul></section>` : ''}
    <section><h3>${texteHtml('mcp.propositions.contenu')}</h3>${contenuHtml(p.contenu)}</section>
    ${p.resultat ? `<section><h3>${texteHtml('mcp.propositions.resultat')}</h3>${contenuHtml(p.resultat)}</section>` : ''}
    ${decider ? `<div class="barre-outils mcp-decisions"><div class="groupe-outils">
      <button type="button" class="principal" data-decision="accepter">${iconeHtml('mcp_accepter')} ${texteHtml('mcp.propositions.accepter')}</button>
      <button type="button" data-decision="corriger">${iconeHtml('mcp_corriger')} ${texteHtml('mcp.propositions.corriger')}</button>
      <button type="button" class="danger" data-decision="refuser">${iconeHtml('mcp_refuser')} ${texteHtml('mcp.propositions.refuser')}</button></div></div>` : ''}`;
}

/**
 * File des propositions. options : { api: { liste({ vue }), lire(id), corriger(id, contenu), refuser(id, motif), accepter(id) },
 * admin (vue « toutes »), ouvrir(id, e) (navigation vers le détail), erreur(e) }.
 */
export class FilePropositions {
  #zone;
  #o;
  #liste = [];
  #vue;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { api: {}, admin: false, ouvrir: () => {}, erreur: () => {}, ...options };
    const vue = lireStockage(CLE_VUE, VUES_PROPOSITIONS.A_VALIDER);
    this.#vue = this.#vues().includes(vue) ? vue : VUES_PROPOSITIONS.A_VALIDER;
    this.#zone.addEventListener('click', (e) => {
      const a = e.target.closest('[data-ouvrir]');
      if (a) { e.preventDefault(); this.#o.ouvrir(a.dataset.ouvrir, e); return; }
      const v = e.target.closest('button[data-vue]');
      if (v) { this.#vue = v.dataset.vue; ecrireStockage(CLE_VUE, this.#vue); this.charger(); }
    });
  }

  #vues() { return Object.values(VUES_PROPOSITIONS).filter((v) => this.#o.admin || v !== VUES_PROPOSITIONS.TOUTES); }

  async charger() {
    try {
      this.#liste = (await this.#o.api.liste({ vue: this.#vue })) ?? [];
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#zone.innerHTML = `<div class="barre-outils"><div class="groupe-outils" role="tablist">${this.#vues().map((v) => `<button type="button" role="tab" data-vue="${v}" aria-selected="${v === this.#vue}" class="${v === this.#vue ? 'actif' : ''}">${texteHtml(`mcp.propositions.vues.${v}`)}</button>`).join('')}</div></div>
      ${propositionsHtml(this.#liste)}`;
  }
}

/**
 * Détail d'une proposition. options : { api (comme FilePropositions), id, peut: { decider }, adresseCible(p) → url | null,
 * naviguer(url, e), apresDecision(p), message(texte), erreur(e) }.
 */
export class DetailProposition {
  #zone;
  #o;
  #p = null;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { api: {}, peut: { decider: true }, adresseCible: () => null, naviguer: () => {}, apresDecision: () => {}, message: () => {}, erreur: () => {}, ...options };
    this.#zone.addEventListener('click', (e) => {
      const c = e.target.closest('a[data-cible]');
      if (c) { e.preventDefault(); this.#o.naviguer(c.getAttribute('href'), e); return; }
      const b = e.target.closest('button[data-decision]');
      if (b) this.decider(b.dataset.decision);
    });
    this.#zone.addEventListener('keydown', (e) => {
      const action = actionDe(e, GROUPE_RACCOURCIS_PROPOSITIONS);
      if (action === 'accepter' || action === 'refuser') { e.preventDefault(); this.decider(action); }
    });
  }

  get proposition() { return this.#p; }

  async charger() {
    try {
      this.#p = await this.#o.api.lire(this.#o.id);
    } catch (e) {
      this.#o.erreur(e);
      this.#zone.innerHTML = `<p class="aide">${texteHtml('mcp.propositions.introuvable')}</p>`;
      return;
    }
    this.#rendre();
  }

  #rendre() {
    this.#zone.innerHTML = propositionHtml(this.#p, { peut: this.#o.peut, adresseCible: this.#o.adresseCible(this.#p) });
  }

  /** Décision de l'humain (accepter, corriger, refuser), chacune confirmée ou saisie dans une fenêtre du socle. */
  async decider(decision) {
    const p = this.#p;
    if (!p || !this.#o.peut.decider || !etatAffiche(p).ouverte) return;
    try {
      if (decision === 'accepter') {
        if (!await confirmer(texte('mcp.propositions.confirmer_acceptation', { libelle: p.libelle || p.action }), { ok: texte('mcp.propositions.accepter') })) return;
        this.#p = await this.#o.api.accepter(p.id);
        this.#o.message(texte('mcp.propositions.acceptee'));
      } else if (decision === 'refuser') {
        const motif = await saisir(texte('mcp.propositions.question_motif'), '', { titre: texte('mcp.propositions.refuser'), obligatoire: true, multiligne: true });
        if (motif === null) return;
        this.#p = await this.#o.api.refuser(p.id, motif.trim());
        this.#o.message(texte('mcp.propositions.refusee'));
      } else if (decision === 'corriger') {
        const contenu = await this.#corriger(p);
        if (!contenu) return;
        this.#p = await this.#o.api.corriger(p.id, contenu);
        this.#o.message(texte('mcp.propositions.corrigee_ok'));
      } else return;
      this.#o.apresDecision(this.#p);
    } catch (e) {
      this.#o.erreur(e);
      await this.charger();
      return;
    }
    this.#rendre();
  }

  /** Fenêtre de correction : contenu en JSON, écarts avant / après recalculés à la saisie ; null si annulée. */
  #corriger(p) {
    return ouvrirDialogue({
      titre: texte('mcp.propositions.corriger'), classe: 'mcp-dialogue mcp-correction', valeurAnnulation: null,
      html: `<p class="aide">${texteHtml('mcp.propositions.corriger_aide')}</p>
        <textarea class="mcp-json" rows="14" data-json>${echapper(JSON.stringify(p.contenu ?? {}, null, 2))}</textarea>
        <p class="mcp-erreur" data-erreur></p><h3>${texteHtml('mcp.propositions.ecarts')}</h3><div data-ecarts>${ecartsHtml([])}</div>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: null },
        { libelle: texte('mcp.propositions.enregistrer_correction'), principal: true, valeur: (d) => lireContenu(d.querySelector('[data-json]').value).contenu ?? null }],
      construire: (d) => {
        const zone = d.querySelector('[data-json]');
        const bouton = d.querySelector('.dialogue-boutons .principal');
        const maj = () => {
          const r = lireContenu(zone.value);
          d.querySelector('[data-erreur]').textContent = r.erreur ? texte('mcp.propositions.json_invalide') : '';
          d.querySelector('[data-ecarts]').innerHTML = ecartsHtml(r.erreur ? [] : ecartsContenu(p.contenu ?? {}, r.contenu));
          if (bouton) bouton.disabled = Boolean(r.erreur) || !ecartsContenu(p.contenu ?? {}, r.contenu ?? {}).length;
        };
        zone.addEventListener('input', maj);
        maj();
      },
    });
  }
}
