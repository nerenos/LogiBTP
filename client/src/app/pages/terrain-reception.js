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

const ETATS = Object.freeze({
  SANS_RESERVE: { libelle: '✅ Sans réserve', aide: 'Les travaux sont conformes.' },
  AVEC_RESERVES: { libelle: '⚠ Avec réserves', aide: 'Les réserves seront levées par l\'entreprise.' },
  REFUSEE: { libelle: '⛔ Refus', aide: 'La réception est refusée : l\'ordre est bloqué.' },
});

export class PageReceptionTerrain extends PageBase {
  icone = '✍';
  #modifiee = false;

  get modifiee() { return this.#modifiee; }

  urlCourante() { return `/terrain/reception/${this.params.id}`; }

  async ouvrir() {
    this.titre = 'Réception de pose';
    this.ordre = Number(this.params.id);
    this.conteneur.innerHTML = '<div class="page-terrain" data-reception><p class="aide">Chargement…</p></div>';
    try {
      this.d = await api.terrain.reception(this.ordre);
    } catch (e) {
      const zone = this.conteneur.querySelector('[data-reception]');
      zone.innerHTML = estHorsLigne(e)
        ? '<p class="carte avertissement">📵 Hors ligne : cet ordre n\'a pas été ouvert sur cet appareil avec le réseau.</p>'
        : `<p class="carte avertissement">${echapper(e.message)}</p>`;
      return;
    }
    this.titre = `Réception ${this.d.ordre.numero ?? ''}`.trim();
    this.etat = 'SANS_RESERVE';
    this.#rendre();
  }

  #rendre() {
    const d = this.d;
    const zone = this.conteneur.querySelector('[data-reception]');
    const derniere = d.receptions[0];
    zone.innerHTML = `
      <div class="terrain-entete"><h1 class="page-titre">✍ Réception de pose</h1><a class="terrain-bouton" href="/terrain">◀ Mon terrain</a></div>
      <div class="carte"><b>${echapper(d.ordre.numero ?? '')}</b> ${echapper(d.ordre.objet ?? '')}<br><span class="aide">🏗 ${echapper(d.ordre.chantier ?? '')}</span>
        ${d.client.nom ? `<br>Client : ${echapper(d.client.nom)}` : ''}
        ${d.etape ? `<br><span class="aide">Étape « ${echapper(d.etape.libelle)} » : ${d.etape.valide_le ? `validée le ${formatDate(d.etape.valide_le)}` : 'à valider'}</span>` : ''}</div>
      ${d.receptions.length ? `<details class="terrain-historique" ${derniere ? '' : 'open'}><summary>Réceptions déjà signées (${d.receptions.length})</summary>
        <ul>${d.receptions.map((r) => `<li>${formatDateHeure(r.cree_le)} · ${echapper(ETATS[r.etat]?.libelle ?? r.etat)} · ${echapper(r.signataire ?? '')}
          ${r.pv ? ` · <a href="${echapper(api.terrain.urlPv(this.ordre, r.id))}" target="_blank" rel="noopener">📄 PV</a>` : ''}</li>`).join('')}</ul></details>` : ''}
      <div class="terrain-onglets" role="radiogroup" aria-label="Décision">${Object.entries(ETATS).map(([cle, e]) =>
        `<button type="button" role="radio" data-etat="${cle}" aria-selected="${cle === this.etat}">${e.libelle}</button>`).join('')}</div>
      <p class="aide" data-aide-etat>${echapper(ETATS[this.etat].aide)}</p>
      <label class="terrain-champ" data-bloc-reserves ${this.etat === 'AVEC_RESERVES' ? '' : 'hidden'}>Réserves (une par ligne)
        <textarea data-reserves rows="4"></textarea></label>
      <label class="terrain-champ" data-bloc-motif ${this.etat === 'REFUSEE' ? '' : 'hidden'}>Motif du refus <textarea data-motif rows="2"></textarea></label>
      <div class="terrain-champs">
        <label>Nom du signataire <input data-nom autocomplete="name" value="${echapper(d.client.contact ?? d.client.nom ?? '')}"></label>
        <label>Qualité <input data-qualite value="Client" placeholder="Client, maître d'œuvre…"></label>
      </div>
      <label class="terrain-champ">Envoyer le PV à <input type="email" data-courriel inputmode="email" value="${echapper(d.client.courriel ?? '')}" placeholder="adresse du client (facultatif)"></label>
      <div class="terrain-champ"><span>Signature du client <small class="aide" data-aide-signature></small></span><div data-signature></div></div>
      <div class="terrain-enregistrer"><button type="button" class="principal" data-signer>✍ Valider la réception</button></div>
      <div data-resultat></div>`;
    const $ = (s) => zone.querySelector(s);
    this.pad = new PadSignature($('[data-signature]'), { changer: () => { this.#modifiee = true; } });
    const majEtat = () => {
      zone.querySelectorAll('[data-etat]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.etat === this.etat)));
      $('[data-aide-etat]').textContent = ETATS[this.etat].aide;
      $('[data-bloc-reserves]').hidden = this.etat !== 'AVEC_RESERVES';
      $('[data-bloc-motif]').hidden = this.etat !== 'REFUSEE';
      $('[data-aide-signature]').textContent = this.etat === 'REFUSEE' ? '(facultative pour un refus)' : '(obligatoire)';
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
    const manque = !reception.nom ? 'le nom du signataire'
      : this.etat === 'AVEC_RESERVES' && !reception.reserves.length ? 'au moins une réserve'
        : this.etat === 'REFUSEE' && !reception.motif ? 'le motif du refus'
          : this.etat !== 'REFUSEE' && !reception.signature ? 'la signature du client' : null;
    if (manque) { this.app.message(`Il manque ${manque}`, 'avertissement'); return; }
    const bouton = $('[data-signer]');
    bouton.disabled = true;
    try {
      const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.RECEPTION, id: this.ordre, corps: { ordre: this.ordre, reception },
        libelle: `Réception de ${this.d.ordre.numero ?? 'l\'ordre'}`, url: this.urlCourante() }, () => api.terrain.enregistrerReception(this.ordre, reception));
      this.#modifiee = false;
      const res = $('[data-resultat]');
      if (r.horsLigne) {
        res.innerHTML = '<p class="carte">⏳ Réception signée et gardée sur cet appareil : le PV sera édité et envoyé au retour du réseau.</p>';
        bouton.hidden = true;
        return;
      }
      const rec = r.reponse.reception;
      res.innerHTML = `<div class="carte">✅ Réception enregistrée (${echapper(ETATS[rec.etat]?.libelle ?? rec.etat)}).
        ${rec.pv ? `<a class="terrain-bouton" href="${echapper(api.terrain.urlPv(this.ordre, rec.id))}" target="_blank" rel="noopener">📄 Ouvrir le PV signé</a>` : ''}
        ${rec.courriel && rec.pv ? `<p class="aide">PV envoyé à ${echapper(rec.courriel)}.</p>` : ''}
        ${r.reponse.avertissements.map((a) => `<p class="avertissement">⚠ ${echapper(a)}</p>`).join('')}</div>`;
      bouton.hidden = true;
      this.app.message('Réception enregistrée', 'succes');
    } catch (e) {
      this.app.erreur(e);
    } finally {
      bouton.disabled = false;
    }
  }
}
