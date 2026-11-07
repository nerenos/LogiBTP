import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDateHeure, PadSignature, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { MODULE_FACULTATIF } from '../codes.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { envoyerOuGarder, OPERATION_TERRAIN, formulairePhotos } from '../terrain/operations-terrain.js';
import { selecteurPhotos } from '../terrain/actions-tache.js';

// Application de terrain, lot 6 (ANALYSE-TERRAIN.md T20 ; Exécution E12, E22) : compte rendu d'une intervention SAV
// (droit execution/sav) : constat, travaux, fournitures, photos, intervention terminée ou à reprendre, signature du client
// ou client absent, courriel de confirmation. Le serveur édite le bon (modèle BON_SAV), le range dans la GED de l'ordre
// avec son empreinte, valide les étapes et prévient le bureau (TerrainSavBtp.cs). Hors ligne : compte rendu gardé sur
// l'appareil (signature et photos comprises), envoyé au retour du réseau.

export class PageSavTerrain extends PageBase {
  icone = icone('terrain_btp_sav');
  #modifiee = false;

  get modifiee() { return this.#modifiee; }

  urlCourante() { return `/terrain/sav/${this.params.id}`; }

  async ouvrir() {
    this.titre = texte('terrain_btp.sav_page.titre');
    this.ordre = Number(this.params.id);
    this.conteneur.innerHTML = `<div class="page-terrain" data-sav><p class="aide">${texteHtml('terrain_btp.chargement')}</p></div>`;
    try {
      this.d = await api.terrain.sav(this.ordre);
      this.avecEquipement = this.app.moduleActif(MODULE_FACULTATIF.SAV) && this.app.acces('sav');
    } catch (e) {
      this.conteneur.querySelector('[data-sav]').innerHTML = estHorsLigne(e)
        ? `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.sav_page.hors_ligne')}</p>`
        : `<p class="carte avertissement">${echapper(e.message)}</p>`;
      return;
    }
    this.titre = texte('terrain_btp.sav_page.titre_ordre', { numero: this.d.ordre.numero ?? '' }).trim();
    this.#rendre();
  }

  #rendre() {
    const d = this.d;
    const zone = this.conteneur.querySelector('[data-sav]');
    zone.innerHTML = `
      <div class="terrain-entete"><h1 class="page-titre">${iconeHtml('terrain_btp_sav')} ${texteHtml('terrain_btp.sav_page.titre')}</h1><a class="terrain-bouton" href="/terrain?onglet=sav">${iconeHtml('precedent')} ${texteHtml('terrain_btp.page.titre')}</a></div>
      <div class="carte"><b>${echapper(d.ordre.numero ?? '')}</b> ${echapper(d.ordre.objet ?? '')}<br><span class="aide">${iconeHtml('terrain_btp_chantier')} ${echapper(d.ordre.chantier ?? '')}</span>
        ${d.client.nom ? `<br>${texteHtml('terrain_btp.reception.client', { nom: d.client.nom })}` : ''}${d.adresse ? `<br>${iconeHtml('terrain_btp_adresse')} ${echapper(d.adresse)}` : ''}</div>
      ${d.comptes_rendus.length ? `<details class="terrain-historique"><summary>${texteHtml('terrain_btp.sav_page.historique', { nombre: d.comptes_rendus.length })}</summary>
        <ul>${d.comptes_rendus.map((c) => `<li>${formatDateHeure(c.cree_le)} · ${c.terminee ? `${iconeHtml('terrain_btp_succes')} ${texteHtml('terrain_btp.sav_page.terminee')}` : `${iconeHtml('terrain_btp_a_reprendre')} ${texteHtml('terrain_btp.sav_page.a_reprendre')}`} · ${echapper(c.absent ? texte('terrain_btp.sav_page.client_absent') : c.signataire ?? '')}${c.equipement ? ` · ${echapper(c.equipement.numero)}` : ''}
          ${c.bon ? ` · <a href="${echapper(api.terrain.urlBonSav(this.ordre, c.id))}" target="_blank" rel="noopener">${iconeHtml('terrain_btp_piece')} ${texteHtml('terrain_btp.sav_page.bon')}</a>` : ''}</li>`).join('')}</ul></details>` : ''}
      ${this.avecEquipement ? `<div class="terrain-champ"><span>${texteHtml('terrain_btp.sav_page.equipement')}</span>
        <input data-eq-recherche inputmode="search" autocomplete="off" placeholder="${texteHtml('terrain_btp.sav_page.equipement_recherche')}"><span data-equipement></span></div>` : ''}
      <label class="terrain-champ">${texteHtml('terrain_btp.sav_page.constat')} <textarea data-constat rows="3"></textarea></label>
      <label class="terrain-champ">${texteHtml('terrain_btp.sav_page.travaux')} <textarea data-travaux rows="4"></textarea></label>
      <label class="terrain-champ">${texteHtml('terrain_btp.sav_page.fournitures')} <textarea data-fournitures rows="3"></textarea></label>
      <details class="terrain-champ"><summary>${iconeHtml('terrain_btp_photos')} ${texteHtml('terrain_btp.page.actions.photos')}</summary><div data-photos></div></details>
      <label class="coche"><input type="checkbox" data-terminee checked> ${texteHtml('terrain_btp.sav_page.intervention_terminee')}</label>
      <label class="coche"><input type="checkbox" data-absent> ${texteHtml('terrain_btp.sav_page.absent')}</label>
      <div data-bloc-signature>
        <div class="terrain-champs">
          <label>${texteHtml('terrain_btp.reception.nom')} <input data-nom autocomplete="name" value="${echapper(d.client.contact ?? d.client.nom ?? '')}"></label>
          <label>${texteHtml('terrain_btp.reception.qualite')} <input data-qualite value="${texteHtml('terrain_btp.reception.qualite_defaut')}"></label>
        </div>
        <div class="terrain-champ"><span>${texteHtml('terrain_btp.reception.signature')}</span><div data-signature></div></div>
      </div>
      <label class="terrain-champ">${texteHtml('terrain_btp.sav_page.envoyer_bon')} <input type="email" data-courriel inputmode="email" value="${echapper(d.client.courriel ?? '')}" placeholder="${texteHtml('terrain_btp.reception.courriel_aide')}"></label>
      <div class="terrain-enregistrer"><button type="button" class="principal" data-signer>${iconeHtml('enregistrer')} ${texteHtml('terrain_btp.sav_page.enregistrer')}</button></div>
      <div data-resultat></div>`;
    const $ = (s) => zone.querySelector(s);
    this.pad = new PadSignature($('[data-signature]'), { changer: () => { this.#modifiee = true; } });
    this.photos = selecteurPhotos($('[data-photos]'));
    zone.querySelectorAll('input, textarea').forEach((c) => c.addEventListener('input', () => { this.#modifiee = true; }));
    $('[data-absent]').addEventListener('change', (e) => { $('[data-bloc-signature]').hidden = e.target.checked; });
    $('[data-signer]').addEventListener('click', () => this.#enregistrer());
    if (this.avecEquipement) this.#equipements('');
  }

  /** Choix de l'équipement installé (module SAV) : recherche par numéro de série ou code-barres lu au clavier ; ceux du chantier d'abord. */
  async #equipements(recherche) {
    const zone = this.conteneur.querySelector('[data-equipement]');
    const champ = this.conteneur.querySelector('[data-eq-recherche]');
    if (!champ.dataset.branche) {
      champ.dataset.branche = '1';
      champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.#equipements(champ.value.trim()); } });
    }
    let liste = [];
    try { liste = await api.terrain.equipementsSav(recherche, this.ordre); } catch { this.avecEquipement = false; zone.textContent = ''; return; }
    this.comboEquipement = creerCombo({ options: liste.map((q) => ({ valeur: q.id, libelle: `${q.numero} · ${q.article ?? ''}${q.chantier ? ` · ${q.chantier}` : ''}` })),
      valeur: recherche && liste.length === 1 ? liste[0].id : '', vide: true });
    this.comboEquipement.addEventListener('change', () => { this.#modifiee = true; });
    zone.replaceChildren(this.comboEquipement);
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
      equipement: this.comboEquipement?.valeurCombo ? Number(this.comboEquipement.valeurCombo) : null,
    };
    const manque = !compteRendu.constat ? 'constat' : !compteRendu.travaux ? 'travaux'
      : !absent && !compteRendu.nom ? 'nom' : !absent && !compteRendu.signature ? 'signature' : null;
    if (manque) { this.app.message(texte(`terrain_btp.sav_page.manque.${manque}`), 'avertissement'); return; }
    const bouton = $('[data-signer]');
    bouton.disabled = true;
    try {
      const photos = this.photos.nombre ? await this.photos.photos(texte('terrain_btp.sav_page.libelle', { numero: this.d.ordre.numero ?? '' }).trim()) : null;
      const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.SAV, id: `${this.ordre}:${Date.now()}`, corps: { ordre: this.ordre, compteRendu, photos },
        libelle: texte('terrain_btp.sav_page.libelle', { numero: this.d.ordre.numero ?? '' }).trim(), url: this.urlCourante() }, async () => {
        // Photos d'abord : un compte rendu enregistré peut terminer l'ordre.
        if (photos) await api.terrain.photosSav(this.ordre, formulairePhotos(photos));
        return api.terrain.enregistrerSav(this.ordre, compteRendu);
      });
      this.#modifiee = false;
      bouton.hidden = true;
      const res = $('[data-resultat]');
      if (r.horsLigne) { res.innerHTML = `<p class="carte">${iconeHtml('terrain_btp_attente')} ${texteHtml('terrain_btp.sav_page.gardee')}</p>`; return; }
      const c = r.reponse.compte_rendu;
      res.innerHTML = `<div class="carte">${iconeHtml('terrain_btp_succes')} ${texteHtml('terrain_btp.sav_page.enregistre_point')}
        ${c.bon ? `<a class="terrain-bouton" href="${echapper(api.terrain.urlBonSav(this.ordre, c.id))}" target="_blank" rel="noopener">${iconeHtml('terrain_btp_piece')} ${texteHtml('terrain_btp.sav_page.ouvrir_bon')}</a>` : ''}
        ${c.courriel && c.bon ? `<p class="aide">${texteHtml('terrain_btp.sav_page.bon_envoye', { courriel: c.courriel })}</p>` : ''}
        ${r.reponse.avertissements.map((a) => `<p class="avertissement">${iconeHtml('avertissement')} ${echapper(a)}</p>`).join('')}</div>`;
      this.app.message(texte('terrain_btp.sav_page.enregistre'), 'succes');
    } catch (e) {
      this.app.erreur(e);
    } finally {
      bouton.disabled = false;
    }
  }
}
