import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatDate, ouvrirDialogue, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { boutonPrincipal } from './actions-tache.js';

// Application de terrain, lot 6 (T20) : onglet 🧰 SAV de /terrain, visible avec le droit execution/sav, refusé par
// défaut. Interventions ouvertes de la personne, nouvelle intervention sur un chantier existant ou, pour un client sans
// chantier, sur un chantier « Entretien et dépannage » créé par le serveur (E20). Création : réseau exigé (numéro de
// l'ordre) ; le compte rendu, lui, se garde sur l'appareil.

export class SavTerrain {
  constructor(zone, { app }) { this.zone = zone; this.app = app; }

  async ouvrir() {
    let d;
    try {
      d = await api.terrain.interventions();
    } catch (e) {
      this.zone.innerHTML = estHorsLigne(e) ? `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.sav.hors_ligne')}</p>` : `<p class="carte avertissement">${echapper(e.message)}</p>`;
      return;
    }
    this.zone.innerHTML = `${d.creer ? `<div class="terrain-actions"><button type="button" class="terrain-bouton" data-nouvelle>${iconeHtml('ajouter')} ${texteHtml('terrain_btp.sav.nouvelle')}</button></div>` : ''}
      ${d.ordres.map((o) => `<a class="carte terrain-intervention" href="/terrain/sav/${o.ent_id}">
        <b>${echapper(o.numero ?? '')}</b> <span>${echapper(o.objet ?? '')}</span>
        <small class="aide">${echapper([o.client, o.ville, o.fait ? texte('terrain_btp.sav.compte_rendu', { date: formatDate(o.fait) }) : null].filter(Boolean).join(' · '))}</small></a>`).join('')
      || `<p class="terrain-vide">${texteHtml('terrain_btp.sav.aucune')}</p>`}`;
    this.zone.querySelector('[data-nouvelle]')?.addEventListener('click', () => this.#nouvelle());
  }

  async #nouvelle() {
    let c;
    try { c = await api.terrain.choixSav(); } catch (e) { this.app.erreur(e); return; }
    let chantier = null;
    let client = null;
    const id = await ouvrirDialogue({
      titre: `${icone('terrain_btp_sav')} ${texte('terrain_btp.sav.nouvelle')}`,
      html: `<p><label>${texteHtml('terrain_btp.sav.champs.objet')}<br><input data-objet size="34" placeholder="${texteHtml('terrain_btp.sav.champs.objet_exemple')}"></label></p>
        <p><label>${texteHtml('terrain_btp.sav.champs.chantier')} <span data-chantier></span></label></p>
        <details data-sans-chantier><summary>${texteHtml('terrain_btp.sav.champs.sans_chantier')}</summary>
          <p><label>${texteHtml('terrain_btp.sav.champs.client')} <span data-client></span></label></p>
          <p><label>${texteHtml('terrain_btp.sav.champs.adresse')}<br><input data-adresse size="34"></label></p>
          <p><label>${texteHtml('terrain_btp.sav.champs.code_postal')} <input data-cp size="6" inputmode="numeric"></label> <label>${texteHtml('terrain_btp.sav.champs.ville')} <input data-ville size="18"></label></p>
        </details>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: null }],
      construire: (dlg, fermer) => {
        const combo = (sel, options, changer) => {
          const cb = creerCombo({ options: options.map((x) => ({ valeur: x.id, libelle: x.libelle, detail: x.detail ?? '' })), valeur: '', vide: true });
          cb.addEventListener('change', () => changer(cb.valeurCombo ? Number(cb.valeurCombo) : null));
          dlg.querySelector(sel).append(cb);
        };
        combo('[data-chantier]', c.chantiers, (v) => { chantier = v; });
        combo('[data-client]', c.clients, (v) => { client = v; });
        boutonPrincipal(dlg, texte('commun.creer'), async () => {
          const objet = dlg.querySelector('[data-objet]').value.trim();
          if (!objet) { dlg.querySelector('[data-objet]').focus(); return; }
          if (!chantier && !client) { this.app.message(texte('terrain_btp.sav.choisir'), 'avertissement'); return; }
          const val = (s) => dlg.querySelector(s).value.trim() || null;
          try {
            const r = await api.terrain.creerIntervention({ cha_id: chantier, objet,
              nouveau: chantier ? null : { client, adresse: val('[data-adresse]'), code_postal: val('[data-cp]'), ville: val('[data-ville]') } });
            fermer(r.ent_id);
          } catch (e) { this.app.erreur(e); }
        });
      },
    });
    if (id) this.app.naviguer(`/terrain/sav/${id}`);
  }
}
