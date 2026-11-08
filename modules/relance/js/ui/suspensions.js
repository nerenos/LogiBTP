// Module Relances, suspensions : liste des suspensions (pièce ou tiers, jusqu'au compris, motif), saisie, modification,
// suppression. Composant sans métier : l'application fournit les appels, les libellés de pièce et de tiers et le choix
// d'une pièce ou d'un tiers.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { formatDate, echapper, creerCombo, champDate, confirmer, ouvrirDialogue, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { MOTIF_SUSPENSION } from '../src/codes.js';
import { suspensionActive, controlerSuspension, corpsSuspension } from './modeles.js';

export const GROUPE_RACCOURCIS_SUSPENSIONS = 'relances_suspensions';
declarerRaccourcis(GROUPE_RACCOURCIS_SUSPENSIONS, {
  libelle: texte('relance.raccourcis.groupe_suspensions'),
  actions: { nouvelle: { libelle: texte('relance.raccourcis.nouvelle_suspension'), defaut: 'Ctrl+Shift+N' } },
});

/**
 * Suspensions. options : { peut: { creer, modifier, supprimer }, api: { liste(), creer(corps), modifier(id, corps), supprimer(id) } (promesses),
 * libelleTiers(id), libellePiece(id), choisirPiece() → Promise<{ id } | null>, choisirTiers() → Promise<{ id } | null>, apresEcriture(), erreur(e) }.
 * `nouvelle({ piece_id, tiers_id })` ouvre la saisie pour une cible donnée (depuis la liste de travail).
 */
export class PanneauSuspensions {
  #zone;
  #o;
  #liste = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, api: {}, libelleTiers: (id) => texte('relance.tiers_sans_nom', { id }), libellePiece: (id) => texte('relance.piece_sans_nom', { id }),
      choisirPiece: async () => null, choisirTiers: async () => null, apresEcriture: () => {}, erreur: () => {}, ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('keydown', (e) => {
      if (actionDe(e, GROUPE_RACCOURCIS_SUSPENSIONS) === 'nouvelle' && this.#o.peut.creer) { e.preventDefault(); this.nouvelle(); }
    });
  }

  async charger() {
    try {
      this.#liste = (await this.#o.api.liste()) ?? [];
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #cible(s) {
    return s.piece_id ? `${iconeHtml('relance_piece')} ${echapper(this.#o.libellePiece(s.piece_id))}` : `${iconeHtml('relance_tiers')} ${echapper(this.#o.libelleTiers(s.tiers_id))}`;
  }

  #rendre() {
    const { peut } = this.#o;
    const jour = aujourdhui();
    const lignes = this.#liste.map((s) => {
      const active = suspensionActive(s, jour);
      return `<tr class="${active ? 'relance-suspension-active' : 'relance-suspension-terminee'}" data-id="${s.id}"><td>${this.#cible(s)}</td>
        <td>${echapper(texte(`relance.motifs.${s.motif}`))}</td><td>${formatDate(s.jusqu_au)}</td>
        <td>${echapper(texte(active ? 'relance.suspensions.active' : 'relance.suspensions.terminee'))}</td><td>${echapper(s.commentaire ?? '')}</td><td>${echapper(s.cree_par ?? '')}</td>
        <td class="relance-boutons">${peut.modifier ? `<button type="button" data-modifier="${s.id}" title="${echapper(texte('relance.suspensions.modifier'))}">${iconeHtml('relance_modifier')}</button>` : ''}
          ${peut.supprimer ? `<button type="button" data-supprimer="${s.id}" title="${echapper(texte('relance.suspensions.supprimer'))}">${iconeHtml('relance_supprimer')}</button>` : ''}</td></tr>`;
    }).join('');
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('relance_suspendre')} ${texteHtml('relance.suspensions.titre')}
        ${peut.creer ? `<button type="button" data-nouvelle>${iconeHtml('relance_ajouter')} ${texteHtml('relance.suspensions.nouvelle')}</button>` : ''}</h2>
      ${this.#liste.length ? `<table class="relance-table"><thead><tr><th>${texteHtml('relance.suspensions.cible')}</th><th>${texteHtml('relance.suspensions.motif')}</th>
        <th>${texteHtml('relance.suspensions.jusqu_au')}</th><th>${texteHtml('relance.suspensions.etat')}</th><th>${texteHtml('relance.suspensions.commentaire')}</th>
        <th>${texteHtml('relance.suspensions.auteur')}</th><th></th></tr></thead><tbody>${lignes}</tbody></table>` : `<p class="aide">${texteHtml('relance.suspensions.aucune')}</p>`}`;
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-nouvelle]')) this.nouvelle();
    else if (b.dataset.modifier) this.#saisie(this.#liste.find((s) => String(s.id) === b.dataset.modifier));
    else if (b.dataset.supprimer) this.#supprimer(this.#liste.find((s) => String(s.id) === b.dataset.supprimer));
  }

  /** Saisie d'une suspension ; `cible` ({ piece_id } ou { tiers_id }) l'impose, sinon le choix est proposé. */
  nouvelle(cible = {}) {
    return this.#saisie({ piece_id: null, tiers_id: null, jusqu_au: '', motif: MOTIF_SUSPENSION.PROMESSE, commentaire: '', ...cible }, true);
  }

  async #saisie(s, creation = false) {
    if (!s) return;
    let cible = { piece_id: s.piece_id, tiers_id: s.tiers_id };
    let motif;
    const libelleCible = () => (cible.piece_id ? this.#o.libellePiece(cible.piece_id) : cible.tiers_id ? this.#o.libelleTiers(cible.tiers_id) : texte('relance.suspensions.aucune_cible'));
    const corps = await ouvrirDialogue({
      titre: texte(creation ? 'relance.suspensions.nouvelle' : 'relance.suspensions.modifier'), valeurAnnulation: null,
      html: `<p>${texteHtml('relance.suspensions.cible')} <strong data-cible>${echapper(libelleCible())}</strong>
          ${creation && !(s.piece_id || s.tiers_id) ? `<button type="button" data-piece>${iconeHtml('relance_piece')} ${texteHtml('relance.suspensions.choisir_piece')}</button>
            <button type="button" data-tiers>${iconeHtml('relance_tiers')} ${texteHtml('relance.suspensions.choisir_tiers')}</button>` : ''}</p>
        <label>${texteHtml('relance.suspensions.motif')} <span data-motif></span></label>
        <label>${texteHtml('relance.suspensions.jusqu_au')} <input type="date" data-jusqu-au value="${echapper(s.jusqu_au ?? '')}"></label>
        <label>${texteHtml('relance.suspensions.commentaire')} <input type="text" data-commentaire value="${echapper(s.commentaire ?? '')}"></label>
        <p class="relance-erreurs" data-erreur></p>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: null },
        { libelle: texte('commun.ok'), principal: true, valeur: (d) => ({ ...cible, motif: motif.valeurCombo, jusqu_au: d.querySelector('[data-jusqu-au]').value, commentaire: d.querySelector('[data-commentaire]').value }) }],
      construire: (d) => {
        motif = creerCombo({ options: Object.values(MOTIF_SUSPENSION).map((m) => ({ valeur: m, libelle: texte(`relance.motifs.${m}`) })), valeur: s.motif, vide: false });
        d.querySelector('[data-motif]').append(motif);
        champDate(d.querySelector('[data-jusqu-au]'));
        const choisir = (cle, appel) => d.querySelector(`[data-${cle}]`)?.addEventListener('click', async () => {
          const c = await appel();
          if (!c) return;
          cible = cle === 'piece' ? { piece_id: c.id, tiers_id: null } : { piece_id: null, tiers_id: c.id };
          d.querySelector('[data-cible]').textContent = libelleCible();
        });
        choisir('piece', () => this.#o.choisirPiece());
        choisir('tiers', () => this.#o.choisirTiers());
        // Saisie incomplète : message dans la fenêtre, qui reste ouverte.
        d.querySelector('.dialogue-boutons .principal').addEventListener('click', (e) => {
          const manques = controlerSuspension({ ...cible, motif: motif.valeurCombo, jusqu_au: d.querySelector('[data-jusqu-au]').value });
          if (!manques.length) return;
          d.querySelector('[data-erreur]').textContent = texte(`relance.suspensions.manque.${manques[0]}`);
          e.stopImmediatePropagation();
        }, { capture: true });
      },
    });
    if (!corps) return;
    try {
      await (creation ? this.#o.api.creer(corpsSuspension(corps)) : this.#o.api.modifier(s.id, corpsSuspension(corps)));
      this.#o.apresEcriture();
    } catch (err) {
      this.#o.erreur(err);
    }
    await this.charger();
  }

  async #supprimer(s) {
    if (!s || !await confirmer(texte('relance.suspensions.confirmer_suppression', { cible: s.piece_id ? this.#o.libellePiece(s.piece_id) : this.#o.libelleTiers(s.tiers_id) }), { ok: texte('commun.supprimer'), danger: true })) return;
    try {
      await this.#o.api.supprimer(s.id);
      this.#o.apresEcriture();
    } catch (e) {
      this.#o.erreur(e);
    }
    await this.charger();
  }
}
