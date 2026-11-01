import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDate, formatDateHeure, PadSignature } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { envoyerOuGarder, OPERATION_TERRAIN } from '../terrain/operations-terrain.js';

// Application de terrain, lot 5 (ANALYSE-TERRAIN.md T14 à T16) : réception d'un ordre de pose signée par le client sur
// l'écran. Décision (sans réserve, avec réserves, refus), réserves, motif du refus, signataire, courriel du PV ;
// le serveur édite le PV (modèle PV_RECEPTION), le range dans la GED de l'ordre avec son empreinte, valide l'étape
// « Réception », crée la tâche des réserves, bloque l'ordre refusé et envoie le PV au client (TerrainReceptionBtp.cs).
// Hors ligne : réception gardée sur l'appareil (signature comprise), envoyée au retour du réseau.

const ETATS = Object.freeze(Object.fromEntries([['SANS_RESERVE', 'terrain_btp_sans_reserve'], ['AVEC_RESERVES', 'terrain_btp_nc'], ['REFUSEE', 'terrain_btp_refus']]
  .map(([code, nom]) => [code, Object.freeze({
    icone: nom,
    get libelle() { return texte(`terrain_btp.reception.etats.${code}.libelle`); },
    get aide() { return texte(`terrain_btp.reception.etats.${code}.aide`); },
  })])));

export class PageReceptionTerrain extends PageBase {
  icone = icone('terrain_btp_reception');
  #modifiee = false;

  get modifiee() { return this.#modifiee; }

  urlCourante() { return `/terrain/reception/${this.params.id}`; }

  async ouvrir() {
    this.titre = texte('terrain_btp.reception.titre');
    this.ordre = Number(this.params.id);
    this.conteneur.innerHTML = `<div class="page-terrain" data-reception><p class="aide">${texteHtml('terrain_btp.chargement')}</p></div>`;
    try {
      this.d = await api.terrain.reception(this.ordre);
    } catch (e) {
      const zone = this.conteneur.querySelector('[data-reception]');
      zone.innerHTML = estHorsLigne(e)
        ? `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.reception.hors_ligne')}</p>`
        : `<p class="carte avertissement">${echapper(e.message)}</p>`;
      return;
    }
    this.titre = texte('terrain_btp.reception.titre_ordre', { numero: this.d.ordre.numero ?? '' }).trim();
    this.etat = 'SANS_RESERVE';
    this.#rendre();
  }

  #rendre() {
    const d = this.d;
    const zone = this.conteneur.querySelector('[data-reception]');
    const derniere = d.receptions[0];
    zone.innerHTML = `
      <div class="terrain-entete"><h1 class="page-titre">${iconeHtml('terrain_btp_reception')} ${texteHtml('terrain_btp.reception.titre')}</h1><a class="terrain-bouton" href="/terrain">${iconeHtml('precedent')} ${texteHtml('terrain_btp.page.titre')}</a></div>
      <div class="carte"><b>${echapper(d.ordre.numero ?? '')}</b> ${echapper(d.ordre.objet ?? '')}<br><span class="aide">${iconeHtml('terrain_btp_chantier')} ${echapper(d.ordre.chantier ?? '')}</span>
        ${d.client.nom ? `<br>${texteHtml('terrain_btp.reception.client', { nom: d.client.nom })}` : ''}
        ${d.etape ? `<br><span class="aide">${d.etape.valide_le ? texteHtml('terrain_btp.etape_validee', { etape: d.etape.libelle, date: formatDate(d.etape.valide_le) }) : texteHtml('terrain_btp.etape_a_valider', { etape: d.etape.libelle })}</span>` : ''}</div>
      ${d.receptions.length ? `<details class="terrain-historique" ${derniere ? '' : 'open'}><summary>${texteHtml('terrain_btp.reception.historique', { nombre: d.receptions.length })}</summary>
        <ul>${d.receptions.map((r) => `<li>${formatDateHeure(r.cree_le)} · ${echapper(ETATS[r.etat]?.libelle ?? r.etat)} · ${echapper(r.signataire ?? '')}
          ${r.pv ? ` · <a href="${echapper(api.terrain.urlPv(this.ordre, r.id))}" target="_blank" rel="noopener">${iconeHtml('terrain_btp_piece')} ${texteHtml('terrain_btp.reception.pv')}</a>` : ''}</li>`).join('')}</ul></details>` : ''}
      <div class="terrain-onglets" role="radiogroup" aria-label="${texteHtml('terrain_btp.reception.decision')}">${Object.entries(ETATS).map(([cle, e]) =>
        `<button type="button" role="radio" data-etat="${cle}" aria-selected="${cle === this.etat}">${iconeHtml(e.icone)} ${echapper(e.libelle)}</button>`).join('')}</div>
      <p class="aide" data-aide-etat>${echapper(ETATS[this.etat].aide)}</p>
      <label class="terrain-champ" data-bloc-reserves ${this.etat === 'AVEC_RESERVES' ? '' : 'hidden'}>${texteHtml('terrain_btp.reception.reserves')}
        <textarea data-reserves rows="4"></textarea></label>
      <label class="terrain-champ" data-bloc-motif ${this.etat === 'REFUSEE' ? '' : 'hidden'}>${texteHtml('terrain_btp.reception.motif')} <textarea data-motif rows="2"></textarea></label>
      <div class="terrain-champs">
        <label>${texteHtml('terrain_btp.reception.nom')} <input data-nom autocomplete="name" value="${echapper(d.client.contact ?? d.client.nom ?? '')}"></label>
        <label>${texteHtml('terrain_btp.reception.qualite')} <input data-qualite value="${texteHtml('terrain_btp.reception.qualite_defaut')}" placeholder="${texteHtml('terrain_btp.reception.qualite_exemple')}"></label>
      </div>
      <label class="terrain-champ">${texteHtml('terrain_btp.reception.envoyer_pv')} <input type="email" data-courriel inputmode="email" value="${echapper(d.client.courriel ?? '')}" placeholder="${texteHtml('terrain_btp.reception.courriel_aide')}"></label>
      <div class="terrain-champ"><span>${texteHtml('terrain_btp.reception.signature')} <small class="aide" data-aide-signature></small></span><div data-signature></div></div>
      <div class="terrain-enregistrer"><button type="button" class="principal" data-signer>${iconeHtml('terrain_btp_reception')} ${texteHtml('terrain_btp.reception.valider')}</button></div>
      <div data-resultat></div>`;
    const $ = (s) => zone.querySelector(s);
    this.pad = new PadSignature($('[data-signature]'), { changer: () => { this.#modifiee = true; } });
    const majEtat = () => {
      zone.querySelectorAll('[data-etat]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.etat === this.etat)));
      $('[data-aide-etat]').textContent = ETATS[this.etat].aide;
      $('[data-bloc-reserves]').hidden = this.etat !== 'AVEC_RESERVES';
      $('[data-bloc-motif]').hidden = this.etat !== 'REFUSEE';
      $('[data-aide-signature]').textContent = texte(this.etat === 'REFUSEE' ? 'terrain_btp.reception.signature_facultative' : 'terrain_btp.reception.signature_obligatoire');
    };
    zone.querySelectorAll('[data-etat]').forEach((b) => b.addEventListener('click', () => { this.etat = b.dataset.etat; this.#modifiee = true; majEtat(); }));
    zone.querySelectorAll('input, textarea').forEach((c) => c.addEventListener('input', () => { this.#modifiee = true; }));
    $('[data-signer]').addEventListener('click', () => this.#signer());
    majEtat();
  }

  async #signer() {
    const $ = (s) => this.conteneur.querySelector(s);
    const reception = {
      etat: this.etat,
      reserves: $('[data-reserves]').value.split('\n').map((x) => x.trim()).filter(Boolean),
      motif: $('[data-motif]').value.trim() || null,
      nom: $('[data-nom]').value.trim(),
      qualite: $('[data-qualite]').value.trim() || null,
      signature: this.pad.enPng(),
      courriel: $('[data-courriel]').value.trim() || null,
    };
    const manque = !reception.nom ? 'nom'
      : this.etat === 'AVEC_RESERVES' && !reception.reserves.length ? 'reserve'
        : this.etat === 'REFUSEE' && !reception.motif ? 'motif'
          : this.etat !== 'REFUSEE' && !reception.signature ? 'signature' : null;
    if (manque) { this.app.message(texte(`terrain_btp.reception.manque.${manque}`), 'avertissement'); return; }
    const bouton = $('[data-signer]');
    bouton.disabled = true;
    try {
      const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.RECEPTION, id: this.ordre, corps: { ordre: this.ordre, reception },
        libelle: this.d.ordre.numero ? texte('terrain_btp.reception.libelle', { numero: this.d.ordre.numero }) : texte('terrain_btp.reception.libelle_ordre'), url: this.urlCourante() }, () => api.terrain.enregistrerReception(this.ordre, reception));
      this.#modifiee = false;
      const res = $('[data-resultat]');
      if (r.horsLigne) {
        res.innerHTML = `<p class="carte">${iconeHtml('terrain_btp_attente')} ${texteHtml('terrain_btp.reception.gardee')}</p>`;
        bouton.hidden = true;
        return;
      }
      const rec = r.reponse.reception;
      res.innerHTML = `<div class="carte">${iconeHtml('terrain_btp_succes')} ${texteHtml('terrain_btp.reception.enregistree_etat', { etat: ETATS[rec.etat]?.libelle ?? rec.etat })}
        ${rec.pv ? `<a class="terrain-bouton" href="${echapper(api.terrain.urlPv(this.ordre, rec.id))}" target="_blank" rel="noopener">${iconeHtml('terrain_btp_piece')} ${texteHtml('terrain_btp.reception.ouvrir_pv')}</a>` : ''}
        ${rec.courriel && rec.pv ? `<p class="aide">${texteHtml('terrain_btp.reception.pv_envoye', { courriel: rec.courriel })}</p>` : ''}
        ${r.reponse.avertissements.map((a) => `<p class="avertissement">${iconeHtml('avertissement')} ${echapper(a)}</p>`).join('')}</div>`;
      bouton.hidden = true;
      this.app.message(texte('terrain_btp.reception.enregistree'), 'succes');
    } catch (e) {
      this.app.erreur(e);
    } finally {
      bouton.disabled = false;
    }
  }
}
