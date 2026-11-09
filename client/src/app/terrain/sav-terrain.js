import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatDate, ouvrirDialogue, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ACTION_DROIT } from '@logibtp/socle';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { listeOperations } from '../hors-ligne/operations.js';
import { boutonPrincipal } from './actions-tache.js';
import { envoyerOuGarder, OPERATION_TERRAIN, interventionGardee, idSavLocal, nouvelAppareilSav } from './operations-terrain.js';

// Application de terrain, lot 6 (T20) : onglet 🧰 SAV de /terrain, visible avec le droit execution/sav, refusé par
// défaut. Interventions ouvertes de la personne, nouvelle intervention sur un chantier existant ou, pour un client sans
// chantier, sur un chantier « Entretien et dépannage » créé par le serveur (E20). Sans réseau (terrain-suites lot 23) :
// intervention créée sur l'appareil avec un numéro provisoire, sur un chantier ou un client déjà lus (choix gardés par
// le service worker), créée par le serveur à l'envoi, avant son compte rendu, sans doublon (identifiant de l'appareil).

export class SavTerrain {
  constructor(zone, { app }) { this.zone = zone; this.app = app; }

  async ouvrir() {
    let d = null;
    let erreur = null;
    try {
      d = await api.terrain.interventions();
    } catch (e) {
      erreur = e;
    }
    // Interventions créées sur l'appareil, pas encore envoyées.
    const locales = (await listeOperations(this.app.utilisateur()).catch(() => [])).filter((o) => o.type === OPERATION_TERRAIN.SAV_CREATION);
    const creer = d ? d.creer : this.app.peut('execution/sav', ACTION_DROIT.CREER);
    const avertissement = !erreur ? '' : estHorsLigne(erreur) ? `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.sav.hors_ligne')}</p>` : `<p class="carte avertissement">${echapper(erreur.message)}</p>`;
    const cartesLocales = locales.map((o) => `<a class="carte terrain-intervention" href="/terrain/sav/${idSavLocal(o.corps.appareil)}">
        <b>${echapper(o.corps.affichage.ordre.numero)}</b> <span>${echapper(o.corps.affichage.ordre.objet ?? '')}</span>
        <small class="aide">${iconeHtml('terrain_btp_attente')} ${echapper([o.corps.affichage.client.nom ?? o.corps.affichage.ordre.chantier, texte('terrain_btp.sav.sur_appareil')].filter(Boolean).join(' · '))}</small></a>`).join('');
    const cartes = (d?.ordres ?? []).map((o) => `<a class="carte terrain-intervention" href="/terrain/sav/${o.ent_id}">
        <b>${echapper(o.numero ?? '')}</b> <span>${echapper(o.objet ?? '')}</span>
        <small class="aide">${echapper([o.client, o.ville, o.fait ? texte('terrain_btp.sav.compte_rendu', { date: formatDate(o.fait) }) : null].filter(Boolean).join(' · '))}</small></a>`).join('');
    this.zone.innerHTML = `${creer ? `<div class="terrain-actions"><button type="button" class="terrain-bouton" data-nouvelle>${iconeHtml('ajouter')} ${texteHtml('terrain_btp.sav.nouvelle')}</button></div>` : ''}
      ${avertissement}${cartesLocales}${cartes || (erreur || cartesLocales ? '' : `<p class="terrain-vide">${texteHtml('terrain_btp.sav.aucune')}</p>`)}`;
    this.zone.querySelector('[data-nouvelle]')?.addEventListener('click', () => this.#nouvelle());
  }

  async #nouvelle() {
    let c;
    try {
      c = await api.terrain.choixSav();
    } catch (e) {
      if (estHorsLigne(e)) this.app.message(texte('terrain_btp.sav.choix_hors_ligne'), 'avertissement'); else this.app.erreur(e);
      return;
    }
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
          const nouveau = chantier ? null : { client, adresse: val('[data-adresse]'), code_postal: val('[data-cp]'), ville: val('[data-ville]') };
          const appareil = nouvelAppareilSav();
          const gardee = interventionGardee({
            appareil, objet, cha_id: chantier, nouveau,
            chantier: chantier ? c.chantiers.find((x) => x.id === chantier)?.libelle ?? null : null,
            client: chantier ? null : c.clients.find((x) => x.id === client)?.libelle ?? null,
            adresse: nouveau ? [nouveau.adresse, nouveau.code_postal, nouveau.ville].filter(Boolean).join(' ') || null : null,
          });
          try {
            // Sans réseau : gardée sur l'appareil avec un numéro provisoire, créée par le serveur à l'envoi.
            const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.SAV_CREATION, id: appareil, corps: gardee,
              libelle: texte('terrain_btp.sav.creation', { numero: gardee.affichage.ordre.numero }), url: `/terrain/sav/${idSavLocal(appareil)}` },
            () => api.terrain.creerIntervention(gardee.creation));
            fermer(r.horsLigne ? idSavLocal(appareil) : r.reponse.ent_id);
          } catch (e) { this.app.erreur(e); }
        });
      },
    });
    if (id) this.app.naviguer(`/terrain/sav/${id}`);
  }
}
