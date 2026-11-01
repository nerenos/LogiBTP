import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatDate } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { estHorsLigne } from '../hors-ligne/attente.js';

// Application de terrain : onglet « Mes demandes » (droit terrain/demande, Consulter) : demandes d'approvisionnement
// (ordres E_DAP) créées par la personne depuis ses tâches, des 90 derniers jours, avec leur statut, leur état
// d'exécution, les articles demandés et les documents qui en sont issus (commande, réservation…). Lecture seule :
// une demande se crée depuis la carte d'une tâche. Serveur : GET /api/terrain/demandes (TerrainReceptionBtp.cs).

/** Libellé de l'état d'exécution d'un ordre (null : aucun). */
const execution = (code) => (code ? texte(`terrain_btp.demandes.execution.${code}`) : null);

/** Texte d'un libellé HTML de ligne (DOMParser : ni script ni chargement d'image), à échapper ensuite. */
const texteDe = (html) => new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent.trim();

export class DemandesTerrain {
  constructor(zone, { app }) {
    this.zone = zone;
    this.app = app;
  }

  async ouvrir() {
    this.zone.innerHTML = `<p class="aide">${texteHtml('terrain_btp.chargement')}</p>`;
    let demandes;
    try {
      demandes = await api.terrain.demandes();
    } catch (e) {
      if (!estHorsLigne(e)) { this.app.erreur(e); this.zone.innerHTML = ''; return; }
      this.zone.innerHTML = `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.demandes.hors_ligne')}</p>`;
      return;
    }
    if (!demandes.length) { this.zone.innerHTML = `<p class="terrain-vide">${texteHtml('terrain_btp.demandes.aucune')}</p>`; return; }
    this.zone.innerHTML = `<p class="aide">${texteHtml('terrain_btp.demandes.aide')}</p>${demandes.map((d) => this.#carte(d)).join('')}`;
  }

  #carte(d) {
    const exe = execution(d.execution);
    const articles = (d.articles ?? []).map(texteDe).filter(Boolean).map((a) => `<li>${echapper(a)}</li>`).join('');
    const suites = (d.suites ?? []).map((s) => `<li>${echapper([s.type, s.numero, s.statut && `(${s.statut})`].filter(Boolean).join(' '))}</li>`).join('');
    return `<details class="terrain-tache terrain-demande" data-statut="${echapper(d.statut ?? '')}">
      <summary><span class="terrain-horaires">${echapper(formatDate(d.date))}</span>
        <span class="terrain-etat terrain-statut">${echapper(d.statut_libelle ?? d.statut ?? '')}</span>${exe ? ` <span class="terrain-etat terrain-statut">${echapper(exe)}</span>` : ''}
        <b class="terrain-libelle">${echapper(d.numero ?? texte('terrain_btp.demandes.sans_numero'))}</b>
        <span class="terrain-element">${d.chantier ? `${iconeHtml('terrain_btp_chantier')} ${echapper(`${d.chantier.code} ${d.chantier.libelle}`)}` : ''}</span></summary>
      <div class="terrain-detail">
        ${articles ? `<div><b>${texteHtml('terrain_btp.demandes.articles')}</b><ul class="terrain-liens">${articles}</ul></div>` : ''}
        <div><b>${texteHtml('terrain_btp.demandes.suites')}</b>${suites ? `<ul class="terrain-liens">${suites}</ul>` : `<p class="aide">${texteHtml('terrain_btp.demandes.sans_suite')}</p>`}</div>
      </div>
    </details>`;
  }
}
