import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDate, formatDateHeure, PadSignature, ouvrirDialogue } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { envoyerOuGarder, OPERATION_TERRAIN, receptionGardee, formulaireLevee, pvLeveeAttendu } from '../terrain/operations-terrain.js';
import { selecteurPhotos, boutonPrincipal } from '../terrain/actions-tache.js';
import { ETAT_RESERVE } from '../codes.js';
import { lireOperation } from '../hors-ligne/operations.js';

// Application de terrain, lot 5 (ANALYSE-TERRAIN.md T14 à T16) : réception d'un ordre de pose signée par le client sur
// l'écran. Décision (sans réserve, avec réserves, refus), réserves, motif du refus, signataire, courriel du PV ;
// le serveur édite le PV (modèle PV_RECEPTION), le range dans la GED de l'ordre avec son empreinte, valide l'étape
// « Réception », crée la tâche des réserves, bloque l'ordre refusé et envoie le PV au client (TerrainReceptionBtp.cs).
// Hors ligne : réception gardée sur l'appareil (signature comprise), envoyée au retour du réseau.
// Terrain-suites lot 15 : réserves suivies de l'ordre et leur levée (commentaire, photo), gardée hors ligne avec l'heure
// de l'appareil (TerrainReservesBtp.cs). Lot 16 : toutes levées, PV de levée des réserves signé par le client (édité,
// rangé dans la GED de l'ordre et envoyé par le serveur), gardé hors ligne avec l'heure de l'appareil.

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
    this.pvLeveeGarde = Boolean(await lireOperation(this.app.utilisateur(), OPERATION_TERRAIN.PV_LEVEE, this.ordre).catch(() => null));
    // Levées gardées sur l'appareil, pas encore envoyées : marquées « sur l'appareil ».
    this.d.reserves = await Promise.all((this.d.reserves ?? []).map(async (r) => (r.etat === ETAT_RESERVE.OUVERTE
      && await lireOperation(this.app.utilisateur(), OPERATION_TERRAIN.LEVEE_RESERVE, r.id).catch(() => null) ? { ...r, gardee: true } : r)));
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
      <div data-reserves-suivies></div>
      <div data-pv-levee></div>
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
    this.#rendreReserves();
  }

  /** Réserves suivies de l'ordre : état, levée (date, par qui, commentaire), bouton « Lever » des réserves ouvertes. */
  #rendreReserves() {
    const zone = this.conteneur.querySelector('[data-reserves-suivies]');
    const reserves = this.d.reserves ?? [];
    if (!reserves.length) { zone.innerHTML = ''; this.#rendrePvLevee(); return; }
    const ouvertes = reserves.filter((r) => r.etat === ETAT_RESERVE.OUVERTE && !r.gardee).length;
    zone.innerHTML = `<div class="carte"><b>${iconeHtml('terrain_btp_reserve')} ${texteHtml('terrain_btp.reception.reserves_suivies.titre')}</b>
      <span class="aide">${texteHtml(ouvertes ? 'terrain_btp.reception.reserves_suivies.ouvertes' : 'terrain_btp.reception.reserves_suivies.toutes_levees', { nombre: ouvertes })}</span>
      <ul class="terrain-reserves">${reserves.map((r) => `<li>${echapper(r.libelle)}<br><small class="aide">${r.gardee
        ? `${iconeHtml('terrain_btp_attente')} ${texteHtml('terrain_btp.reception.reserves_suivies.gardee')}`
        : r.etat === ETAT_RESERVE.LEVEE
          ? `${iconeHtml('terrain_btp_reserve_levee')} ${texteHtml('terrain_btp.reception.reserves_suivies.levee', { date: formatDateHeure(r.levee_le), par: r.levee_par ?? '' })}${r.commentaire ? ` · ${echapper(r.commentaire)}` : ''}`
          : `${iconeHtml('terrain_btp_reserve')} ${texteHtml('terrain_btp.reception.reserves_suivies.ouverte', { date: formatDate(r.recue_le) })}`}</small>
        ${r.etat === ETAT_RESERVE.OUVERTE && !r.gardee ? `<button type="button" class="terrain-bouton" data-lever="${r.id}">${iconeHtml('terrain_btp_reserve_levee')} ${texteHtml('terrain_btp.reception.reserves_suivies.lever')}</button>` : ''}</li>`).join('')}</ul></div>`;
    zone.querySelectorAll('[data-lever]').forEach((b) => b.addEventListener('click', () => this.#lever(reserves.find((r) => r.id === Number(b.dataset.lever)))));
    this.#rendrePvLevee();
  }

  /** PV de levée des réserves : PV déjà signés (liens), formulaire de signature quand toutes les réserves sont levées. */
  #rendrePvLevee() {
    const zone = this.conteneur.querySelector('[data-pv-levee]');
    const d = this.d;
    const levees = d.levees ?? [];
    const signer = !this.pvLeveeGarde && pvLeveeAttendu(d);
    zone.innerHTML = `${levees.length ? `<p class="aide">${levees.map((l) => `${iconeHtml('terrain_btp_piece')} ${texteHtml('terrain_btp.reception.pv_levee.signe', { date: formatDateHeure(l.cree_le), signataire: l.signataire ?? '' })}
        ${l.pv ? ` · <a href="${echapper(api.terrain.urlPvLevee(this.ordre, l.id))}" target="_blank" rel="noopener">${texteHtml('terrain_btp.reception.pv')}</a>` : ''}`).join('<br>')}</p>` : ''}
      ${this.pvLeveeGarde ? `<p class="carte">${iconeHtml('terrain_btp_attente')} ${texteHtml('terrain_btp.reception.pv_levee.gardee')}</p>` : ''}
      ${signer ? `<div class="carte"><b>${iconeHtml('terrain_btp_reserve_levee')} ${texteHtml('terrain_btp.reception.pv_levee.titre')}</b>
        <p class="aide">${texteHtml('terrain_btp.reception.pv_levee.aide')}</p>
        <div class="terrain-champs">
          <label>${texteHtml('terrain_btp.reception.nom')} <input data-levee-nom autocomplete="name" value="${echapper(d.client.contact ?? d.client.nom ?? '')}"></label>
          <label>${texteHtml('terrain_btp.reception.qualite')} <input data-levee-qualite value="${texteHtml('terrain_btp.reception.qualite_defaut')}" placeholder="${texteHtml('terrain_btp.reception.qualite_exemple')}"></label>
        </div>
        <label class="terrain-champ">${texteHtml('terrain_btp.reception.envoyer_pv')} <input type="email" data-levee-courriel inputmode="email" value="${echapper(d.client.courriel ?? '')}" placeholder="${texteHtml('terrain_btp.reception.courriel_aide')}"></label>
        <div class="terrain-champ"><span>${texteHtml('terrain_btp.reception.signature')} <small class="aide">${texteHtml('terrain_btp.reception.signature_obligatoire')}</small></span><div data-levee-signature></div></div>
        <div class="terrain-enregistrer"><button type="button" class="principal" data-signer-levee>${iconeHtml('terrain_btp_reserve_levee')} ${texteHtml('terrain_btp.reception.pv_levee.valider')}</button></div>
        <div data-levee-resultat></div></div>` : ''}`;
    if (!signer) return;
    this.padLevee = new PadSignature(zone.querySelector('[data-levee-signature]'), { changer: () => { this.#modifiee = true; } });
    zone.querySelector('[data-signer-levee]').addEventListener('click', () => this.#signerPvLevee());
  }

  async #signerPvLevee() {
    const $ = (s) => this.conteneur.querySelector(s);
    const pv = {
      nom: $('[data-levee-nom]').value.trim(),
      qualite: $('[data-levee-qualite]').value.trim() || null,
      signature: this.padLevee.enPng(),
      courriel: $('[data-levee-courriel]').value.trim() || null,
    };
    const manque = !pv.nom ? 'nom' : !pv.signature ? 'signature' : null;
    if (manque) { this.app.message(texte(`terrain_btp.reception.manque.${manque}`), 'avertissement'); return; }
    const bouton = $('[data-signer-levee]');
    bouton.disabled = true;
    try {
      const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.PV_LEVEE, id: this.ordre, corps: { ordre: this.ordre, pv: receptionGardee(pv) },
        libelle: texte('terrain_btp.reception.pv_levee.libelle', { numero: this.d.ordre.numero ?? '' }), url: this.urlCourante() }, () => api.terrain.signerPvLevee(this.ordre, pv));
      this.#modifiee = false;
      if (r.horsLigne) {
        this.pvLeveeGarde = true;
      } else {
        this.d.levees = [r.reponse.levee, ...(this.d.levees ?? [])];
        this.d.pv_levee_attendu = false;
        this.d.reserves = (this.d.reserves ?? []).map((x) => ({ ...x, pv_levee: x.pv_levee ?? r.reponse.levee.id }));
        this.app.message(texte('terrain_btp.reception.pv_levee.enregistre'), 'succes');
        r.reponse.avertissements.forEach((a) => this.app.message(a, 'avertissement'));
      }
      this.#rendrePvLevee();
    } catch (e) {
      this.app.erreur(e);
      bouton.disabled = false;
    }
  }

  /** Levée d'une réserve : commentaire et photo ; serveur injoignable : gardée sur l'appareil avec son heure. */
  async #lever(reserve) {
    const fait = await ouvrirDialogue({
      titre: `${icone('terrain_btp_reserve_levee')} ${texte('terrain_btp.reception.reserves_suivies.lever_titre')}`,
      html: `<p><b>${echapper(reserve.libelle)}</b></p>
        <p><label>${texteHtml('terrain_btp.actions.commentaire')}<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
        <p class="aide">${texteHtml('terrain_btp.reception.reserves_suivies.photo')}</p><div data-photos></div>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: false }],
      construire: (dlg, fermer) => {
        const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
        boutonPrincipal(dlg, texte('terrain_btp.reception.reserves_suivies.lever'), async () => {
          const commentaire = dlg.querySelector('[data-commentaire]').value.trim() || null;
          try {
            const photos = s.nombre ? await s.photos(commentaire) : null;
            const levee = { ordre: this.ordre, reserve: reserve.id, commentaire, photos };
            const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.LEVEE_RESERVE, id: reserve.id, corps: { ...levee, levee_le: new Date().toISOString() },
              libelle: texte('terrain_btp.reception.reserves_suivies.libelle', { reserve: reserve.libelle, numero: this.d.ordre.numero ?? '' }), url: this.urlCourante() },
            () => api.terrain.leverReserve(this.ordre, reserve.id, formulaireLevee(levee)));
            if (r.reponse) {
              this.d.reserves = r.reponse.reserves;
              this.d.pv_levee_attendu = r.reponse.pv_levee_attendu;
              this.app.message(texte('terrain_btp.reception.reserves_suivies.levee_ok'), 'succes');
            } else {
              this.d.reserves = this.d.reserves.map((x) => (x.id === reserve.id ? { ...x, gardee: true } : x));
            }
            fermer(true);
          } catch (e) { this.app.erreur(e); }
        });
      },
    });
    if (fait) this.#rendreReserves();
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
      // Gardée hors ligne : heure de signature sur l'appareil jointe (imprimée sur le PV avec l'heure de réception par le
      // serveur, terrain-suites lot 13) ; envoyée en ligne : heure du serveur seule.
      const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.RECEPTION, id: this.ordre, corps: { ordre: this.ordre, reception: receptionGardee(reception) },
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
