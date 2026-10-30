import { PageBase } from '@logibtp/navigation';
import { echapper, formatDateHeure, PadSignature } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { envoyerOuGarder, OPERATION_TERRAIN, formulairePhotos } from '../terrain/operations-terrain.js';
import { selecteurPhotos } from '../terrain/actions-tache.js';

// Application de terrain, lot 6 (ANALYSE-TERRAIN.md T20 ; Exécution E12, E22) : compte rendu d'une intervention SAV
// (droit execution/sav) : constat, travaux, fournitures, photos, intervention terminée ou à reprendre, signature du client
// ou client absent, courriel de confirmation. Le serveur édite le bon (modèle BON_SAV), le range dans la GED de l'ordre
// avec son empreinte, valide les étapes et prévient le bureau (TerrainSavBtp.cs). Hors ligne : compte rendu gardé sur
// l'appareil (signature et photos comprises), envoyé au retour du réseau.

export class PageSavTerrain extends PageBase {
  icone = '🧰';
  #modifiee = false;

  get modifiee() { return this.#modifiee; }

  urlCourante() { return `/terrain/sav/${this.params.id}`; }

  async ouvrir() {
    this.titre = 'Intervention SAV';
    this.ordre = Number(this.params.id);
    this.conteneur.innerHTML = '<div class="page-terrain" data-sav><p class="aide">Chargement…</p></div>';
    try {
      this.d = await api.terrain.sav(this.ordre);
    } catch (e) {
      this.conteneur.querySelector('[data-sav]').innerHTML = estHorsLigne(e)
        ? '<p class="carte avertissement">📵 Hors ligne : cette intervention n\'a pas été ouverte sur cet appareil avec le réseau.</p>'
        : `<p class="carte avertissement">${echapper(e.message)}</p>`;
      return;
    }
    this.titre = `SAV ${this.d.ordre.numero ?? ''}`.trim();
    this.#rendre();
  }

  #rendre() {
    const d = this.d;
    const zone = this.conteneur.querySelector('[data-sav]');
    zone.innerHTML = `
      <div class="terrain-entete"><h1 class="page-titre">🧰 Intervention SAV</h1><a class="terrain-bouton" href="/terrain?onglet=sav">◀ Mon terrain</a></div>
      <div class="carte"><b>${echapper(d.ordre.numero ?? '')}</b> ${echapper(d.ordre.objet ?? '')}<br><span class="aide">🏗 ${echapper(d.ordre.chantier ?? '')}</span>
        ${d.client.nom ? `<br>Client : ${echapper(d.client.nom)}` : ''}${d.adresse ? `<br>📍 ${echapper(d.adresse)}` : ''}</div>
      ${d.comptes_rendus.length ? `<details class="terrain-historique"><summary>Comptes rendus déjà faits (${d.comptes_rendus.length})</summary>
        <ul>${d.comptes_rendus.map((c) => `<li>${formatDateHeure(c.cree_le)} · ${c.terminee ? '✅ Terminée' : '🔁 À reprendre'} · ${echapper(c.absent ? 'client absent' : c.signataire ?? '')}
          ${c.bon ? ` · <a href="${echapper(api.terrain.urlBonSav(this.ordre, c.id))}" target="_blank" rel="noopener">📄 Bon</a>` : ''}</li>`).join('')}</ul></details>` : ''}
      <label class="terrain-champ">Constat <textarea data-constat rows="3"></textarea></label>
      <label class="terrain-champ">Travaux réalisés <textarea data-travaux rows="4"></textarea></label>
      <label class="terrain-champ">Fournitures (une par ligne) <textarea data-fournitures rows="3"></textarea></label>
      <details class="terrain-champ"><summary>📷 Photos</summary><div data-photos></div></details>
      <label class="coche"><input type="checkbox" data-terminee checked> Intervention terminée (sinon : à reprendre, le bureau est prévenu)</label>
      <label class="coche"><input type="checkbox" data-absent> Client absent (bon non signé)</label>
      <div data-bloc-signature>
        <div class="terrain-champs">
          <label>Nom du signataire <input data-nom autocomplete="name" value="${echapper(d.client.contact ?? d.client.nom ?? '')}"></label>
          <label>Qualité <input data-qualite value="Client"></label>
        </div>
        <div class="terrain-champ"><span>Signature du client</span><div data-signature></div></div>
      </div>
      <label class="terrain-champ">Envoyer le bon à <input type="email" data-courriel inputmode="email" value="${echapper(d.client.courriel ?? '')}" placeholder="adresse du client (facultatif)"></label>
      <div class="terrain-enregistrer"><button type="button" class="principal" data-signer>💾 Enregistrer le compte rendu</button></div>
      <div data-resultat></div>`;
    const $ = (s) => zone.querySelector(s);
    this.pad = new PadSignature($('[data-signature]'), { changer: () => { this.#modifiee = true; } });
    this.photos = selecteurPhotos($('[data-photos]'));
    zone.querySelectorAll('input, textarea').forEach((c) => c.addEventListener('input', () => { this.#modifiee = true; }));
    $('[data-absent]').addEventListener('change', (e) => { $('[data-bloc-signature]').hidden = e.target.checked; });
    $('[data-signer]').addEventListener('click', () => this.#enregistrer());
  }

  async #enregistrer() {
    const $ = (s) => this.conteneur.querySelector(s);
    const absent = $('[data-absent]').checked;
    const compteRendu = {
      constat: $('[data-constat]').value.trim(),
      travaux: $('[data-travaux]').value.trim(),
      fournitures: $('[data-fournitures]').value.split('\n').map((x) => x.trim()).filter(Boolean),
      terminee: $('[data-terminee]').checked,
      absent,
      nom: absent ? null : $('[data-nom]').value.trim(),
      qualite: absent ? null : $('[data-qualite]').value.trim() || null,
      signature: absent ? null : this.pad.enPng(),
      courriel: $('[data-courriel]').value.trim() || null,
    };
    const manque = !compteRendu.constat ? 'le constat' : !compteRendu.travaux ? 'les travaux réalisés'
      : !absent && !compteRendu.nom ? 'le nom du signataire' : !absent && !compteRendu.signature ? 'la signature du client' : null;
    if (manque) { this.app.message(`Il manque ${manque}`, 'avertissement'); return; }
    const bouton = $('[data-signer]');
    bouton.disabled = true;
    try {
      const photos = this.photos.nombre ? await this.photos.photos(`Intervention ${this.d.ordre.numero ?? ''}`.trim()) : null;
      const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.SAV, id: `${this.ordre}:${Date.now()}`, corps: { ordre: this.ordre, compteRendu, photos },
        libelle: `Intervention ${this.d.ordre.numero ?? ''}`.trim(), url: this.urlCourante() }, async () => {
        // Photos d'abord : un compte rendu enregistré peut terminer l'ordre.
        if (photos) await api.terrain.photosSav(this.ordre, formulairePhotos(photos));
        return api.terrain.enregistrerSav(this.ordre, compteRendu);
      });
      this.#modifiee = false;
      bouton.hidden = true;
      const res = $('[data-resultat]');
      if (r.horsLigne) { res.innerHTML = '<p class="carte">⏳ Compte rendu gardé sur cet appareil : le bon sera édité et envoyé au retour du réseau.</p>'; return; }
      const c = r.reponse.compte_rendu;
      res.innerHTML = `<div class="carte">✅ Compte rendu enregistré.
        ${c.bon ? `<a class="terrain-bouton" href="${echapper(api.terrain.urlBonSav(this.ordre, c.id))}" target="_blank" rel="noopener">📄 Ouvrir le bon</a>` : ''}
        ${c.courriel && c.bon ? `<p class="aide">Bon envoyé à ${echapper(c.courriel)}.</p>` : ''}
        ${r.reponse.avertissements.map((a) => `<p class="avertissement">⚠ ${echapper(a)}</p>`).join('')}</div>`;
      this.app.message('Compte rendu enregistré', 'succes');
    } catch (e) {
      this.app.erreur(e);
    } finally {
      bouton.disabled = false;
    }
  }
}
