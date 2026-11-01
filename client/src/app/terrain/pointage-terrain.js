import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo, formatDate, confirmer, lirePreferences } from '@logibtp/socle/ui';
import { aujourdhui } from '@logibtp/socle';
import { lireDuree, ecrireDuree } from '@logibtp/pointage';
import { api } from '../api.js';
import { choisirRestaurant } from '../pointage/repas.js';
import { choixMultiple } from '../choix-multiple.js';
import { EcranEtapesAtelier } from '@logibtp/execution/ui';
import { MODULE_FACULTATIF } from '../codes.js';
import { completerJournee, presaisirJournee } from './terrain.js';
import { envoyerOuGarder, fournisseurEtapes, OPERATION_TERRAIN } from './operations-terrain.js';
import { lireOperation, marquerOperation, retirerOperation } from '../hors-ligne/operations.js';
import { estHorsLigne, ETAT_ATTENTE } from '../hors-ligne/attente.js';
import { SUJET_ATTENTE } from '../hors-ligne/synchro.js';

// Application de terrain, lot 2 (ANALYSE-TERRAIN.md, T4, T7, T8, T21, T22) : pointage de la journée sur le terrain.
// Une ligne par tâche du jour (niveau de détail planifié) ou en saisie libre (chantier puis ordre choisis) ; chef de
// l'équipe d'une tâche ou droit de saisie libre en équipe : la ligne nouvelle vaut aussi pour les membres cochés ;
// ligne d'une saisie d'équipe : « pour l'équipe » applique la modification aux membres encore identiques.
// Serveur : TerrainPointageBtp.cs (mêmes contrôles et blocages que la saisie au bureau).
// Lot 4 : serveur injoignable, la journée est gardée sur l'appareil (file d'opérations) et rouverte telle quelle ;
// refusée à l'envoi : bandeau avec la raison, Réessayer ou Abandonner ma saisie.

let referentiels = null;

/** Ligne éditable depuis un pointage enregistré. */
const depuisPointage = (p) => ({ id: p.id, tac_id: p.tac_id, cha_id: p.cha_id, ent_id: p.ent_id, type_mo: p.type_mo, sous_type: p.sous_type, minutes: p.minutes,
  motif: p.motif, commentaire: p.commentaire, membres: [], groupe: p.groupe, nb_groupe: p.nb_groupe, equipe: false });

/** Ligne éditable depuis une journée gardée sur l'appareil (corps de l'envoi). */
const depuisOperation = (l) => ({ ...l, membres: l.membres ?? [], groupe: null, nb_groupe: 0, equipe: Boolean(l.equipe), libre: !l.id && !l.tac_id });

export class PointageTerrain {
  /** Options : app, message(texte, niveau), modifiee(bool) : signale une saisie non enregistrée. */
  constructor(zone, { app, modifiee = () => {} }) {
    this.zone = zone;
    this.app = app;
    this.modifiee = modifiee;
  }

  async ouvrir(jour) {
    this.jour = jour;
    this.operation = await lireOperation(this.app.utilisateur(), OPERATION_TERRAIN.JOURNEE, jour).catch(() => null);
    try {
      referentiels ??= await api.pointage.referentiels();
      this.d = await api.terrain.journee(jour);
    } catch (e) {
      if (!estHorsLigne(e)) { this.app.erreur(e); return; }
      this.zone.innerHTML = `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.pointage.hors_ligne')}</p>`;
      return;
    }
    // Journée gardée sur l'appareil et pas encore envoyée : elle remplace celle du serveur.
    this.lignes = this.operation ? this.operation.corps.lignes.map(depuisOperation) : (this.d.pointages ?? []).map(depuisPointage);
    // Présaisie en préférence (T7) : journée vide, passée ou du jour ; rien n'est enregistré sans « Enregistrer ».
    const presaisie = !this.operation && !this.lignes.length && !this.d.valide && lirePreferences().terrainPresaisie && jour <= aujourdhui()
      ? presaisirJournee(this.d.taches ?? [], this.d.minutes_prevues, this.#pas) : [];
    this.lignes.push(...presaisie);
    this.desabonner?.();
    this.desabonner = this.app.abonner(SUJET_ATTENTE, async () => {
      if (!this.operation || !this.zone.isConnected) return;
      const op = await lireOperation(this.app.utilisateur(), OPERATION_TERRAIN.JOURNEE, this.jour).catch(() => null);
      if (!op) this.ouvrir(this.jour);
      else if (op.etat !== this.operation.etat) { this.operation = op; this.#rendre(); }
    });
    this.repas = null;
    if (this.d.personne) api.pointage.repas(this.d.personne.id, jour, jour).then((r) => { this.repas = r[0] ?? null; this.#rendreRepas(); }).catch(() => {});
    this.modifiee(presaisie.length > 0);
    this.#rendre();
  }

  get #pas() { return referentiels?.parametres?.pas_minutes ?? 0; }

  #tache(id) { return this.d.taches.find((t) => t.id === id) ?? null; }
  #chantier(id) { return this.d.chantiers.find((c) => c.id === id) ?? null; }
  #ordre(id) { return this.d.ordres.find((o) => o.id === id) ?? null; }

  #changer() { this.modifiee(true); this.#rendreBilan(); }

  #rendre() {
    const d = this.d;
    if (!d.personne) { this.zone.innerHTML = `<p class="carte avertissement">${texteHtml('terrain_btp.pointage.sans_salarie')}</p>`; return; }
    const lecture = d.valide;
    const sansLigne = d.taches.filter((t) => !this.lignes.some((l) => l.tac_id === t.id));
    this.zone.innerHTML = `<div class="terrain-pointage">
      ${this.#bandeauOperation()}
      <p class="terrain-bilan" data-bilan></p>
      ${lecture ? `<p class="carte">${iconeHtml('verrou')} ${texteHtml('terrain_btp.pointage.validee')}</p>` : ''}
      ${!lecture && sansLigne.length ? `<div class="terrain-a-pointer"><b>${texteHtml('terrain_btp.pointage.a_pointer')}</b>${sansLigne.map((t) => `<button type="button" class="terrain-bouton" data-pointer="${t.id}">${iconeHtml('ajouter')} ${echapper(t.libelle)}${t.chef && t.membres.length ? ` · ${iconeHtml('pointage_equipe')} ${t.membres.length + 1}` : ''}</button>`).join('')}</div>` : ''}
      <datalist id="terrain-motifs-pointage">${(d.motifs ?? []).map((m) => `<option value="${echapper(m)}">`).join('')}</datalist>
      <div data-lignes></div>
      <div data-etape-terminee></div>
      ${lecture ? '' : `<div class="terrain-actions">
        ${d.libre ? `<button type="button" class="terrain-bouton" data-libre>${iconeHtml('terrain_btp_libre')} ${texteHtml('terrain_btp.pointage.libre')}</button>` : ''}
        <button type="button" class="terrain-bouton" data-completer title="${texteHtml('terrain_btp.pointage.completer_aide')}">${iconeHtml('pointage_completer')} ${texteHtml('terrain_btp.pointage.completer')}</button>
      </div>`}
      <p class="terrain-ligne"><span data-repas>${iconeHtml('pointage_repas')} …</span>${lecture ? '' : `<button type="button" class="terrain-bouton" data-choisir-repas>${iconeHtml('pointage_repas')} ${texteHtml('terrain_btp.pointage.repas.bouton')}</button>`}</p>
      ${lecture ? '' : `<div class="terrain-enregistrer"><button type="button" class="principal" data-enregistrer>${iconeHtml('enregistrer')} ${texteHtml('terrain_btp.pointage.enregistrer')}</button></div>`}
    </div>`;
    const $ = (s) => this.zone.querySelector(s);
    this.zone.querySelectorAll('[data-pointer]').forEach((b) => b.addEventListener('click', () => {
      const t = this.#tache(Number(b.dataset.pointer));
      this.lignes.push({ id: null, tac_id: t.id, cha_id: t.cha_id, ent_id: t.ent_id, type_mo: t.type_mo, sous_type: null, minutes: null, motif: null, commentaire: null,
        membres: t.chef ? t.membres.map((m) => m.id) : [], groupe: null, nb_groupe: 0, equipe: false });
      this.modifiee(true);
      this.#rendre();
    }));
    $('[data-libre]')?.addEventListener('click', () => {
      this.lignes.push({ id: null, tac_id: null, cha_id: null, ent_id: null, type_mo: null, sous_type: null, minutes: null, motif: null, commentaire: null,
        membres: [], groupe: null, nb_groupe: 0, equipe: false, libre: true });
      this.modifiee(true);
      this.#rendre();
    });
    $('[data-completer]')?.addEventListener('click', () => {
      const minutes = completerJournee(this.lignes.map((l) => ({ minutes: l.minutes, poids: this.#tache(l.tac_id)?.poids ?? 0 })), d.minutes_prevues, this.#pas);
      if (minutes.every((m) => m == null)) { this.app.message(texte(d.minutes_prevues ? 'terrain_btp.pointage.rien_a_completer' : 'terrain_btp.pointage.sans_heures'), 'avertissement'); return; }
      minutes.forEach((m, i) => { if (m != null) this.lignes[i].minutes = m; });
      this.modifiee(true);
      this.#rendre();
    });
    $('[data-choisir-repas]')?.addEventListener('click', () => this.#choisirRepas());
    $('[data-reessayer]')?.addEventListener('click', async () => {
      await marquerOperation(this.operation.cle, { etat: ETAT_ATTENTE.ATTENTE, erreur: null });
      this.operation = { ...this.operation, etat: ETAT_ATTENTE.ATTENTE, erreur: null };
      this.app.publier(SUJET_ATTENTE, {});
      this.app.envoyerAttentes();
      this.#rendre();
    });
    $('[data-abandonner]')?.addEventListener('click', async () => {
      if (!(await confirmer(texte('terrain_btp.pointage.abandonner_confirmer')))) return;
      await retirerOperation(this.operation.cle);
      this.app.publier(SUJET_ATTENTE, {});
      this.ouvrir(this.jour);
    });
    $('[data-enregistrer]')?.addEventListener('click', () => this.enregistrer());
    this.#rendreLignes(lecture);
    this.#rendreBilan();
    this.#rendreRepas();
  }

  /** Bandeau d'une journée gardée sur l'appareil : en attente d'envoi, ou refusée avec la raison. */
  #bandeauOperation() {
    const o = this.operation;
    if (!o) return '';
    if (o.etat === ETAT_ATTENTE.ERREUR) {
      return `<div class="carte avertissement">${iconeHtml('terrain_btp_refus')} ${texteHtml('terrain_btp.pointage.refus', { erreur: o.erreur ?? '' })}
        <span class="terrain-actions"><button type="button" class="terrain-bouton" data-reessayer>${iconeHtml('terrain_btp_reessayer')} ${texteHtml('terrain_btp.pointage.reessayer')}</button>
        <button type="button" class="terrain-bouton" data-abandonner>${iconeHtml('retirer')} ${texteHtml('terrain_btp.pointage.abandonner')}</button></span></div>`;
    }
    return `<p class="carte">${iconeHtml('terrain_btp_attente')} ${texteHtml('terrain_btp.pointage.gardee', { date: formatDate(o.le.slice(0, 10)) })}</p>`;
  }

  #rendreBilan() {
    const saisi = this.lignes.reduce((s, l) => s + (l.minutes ?? 0), 0);
    const b = this.zone.querySelector('[data-bilan]');
    if (b) b.textContent = texte('terrain_btp.pointage.bilan', { prevu: ecrireDuree(this.d.minutes_prevues) || '0:00', saisi: ecrireDuree(saisi) || '0:00' });
  }

  #rendreRepas() {
    const z = this.zone.querySelector('[data-repas]');
    if (z) z.textContent = `${icone('pointage_repas')} ${this.repas ? this.repas.restaurant : texte('terrain_btp.pointage.repas.aucun')}`;
  }

  async #choisirRepas() {
    const chantier = this.lignes.find((l) => l.cha_id)?.cha_id ?? null;
    const choix = await choisirRestaurant({ charger: (q) => api.pointage.restaurants(chantier, q), actuel: this.repas });
    if (!choix) return;
    const repas = { date: this.jour, restaurant_id: choix.restaurant_id ?? null, nouveau: choix.nouveau ?? null, ville: choix.ville ?? null, cha_id: chantier };
    try {
      const r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.REPAS, id: this.jour, corps: { salarie: this.d.personne.id, repas },
        libelle: texte('terrain_btp.pointage.repas.libelle', { date: formatDate(this.jour) }), url: `/terrain?onglet=pointage&jour=${this.jour}` }, () => api.pointage.enregistrerRepas(this.d.personne.id, repas));
      if (r.horsLigne) {
        this.repas = choix.aucun ? null : { restaurant: texte('terrain_btp.pointage.repas.garde', { restaurant: choix.nouveau ?? texte('terrain_btp.pointage.repas.choisi'), icone: icone('terrain_btp_attente') }) };
        this.#rendreRepas();
        return;
      }
      this.repas = (await api.pointage.repas(this.d.personne.id, this.jour, this.jour))[0] ?? null;
      this.#rendreRepas();
      this.app.message(texte(choix.aucun ? 'terrain_btp.pointage.repas.retire' : 'terrain_btp.pointage.repas.enregistre'), 'succes');
    } catch (e) { this.app.erreur(e); }
  }

  #rendreLignes(lecture) {
    const zone = this.zone.querySelector('[data-lignes]');
    if (!this.lignes.length) { zone.innerHTML = `<p class="terrain-vide">${texteHtml('terrain_btp.pointage.aucun')}</p>`; return; }
    zone.innerHTML = this.lignes.map((l, i) => {
      const t = this.#tache(l.tac_id);
      const c = this.#chantier(l.cha_id);
      const o = this.#ordre(l.ent_id);
      const titre = t ? echapper(t.libelle) : `${iconeHtml('terrain_btp_libre')} ${texteHtml(l.libre ? 'terrain_btp.pointage.libre' : 'terrain_btp.pointage.libre_enregistree')}`;
      const lieu = [c && `${icone('terrain_btp_chantier')} ${c.code} ${c.libelle}`, o && `${icone('pointage_ordre')} ${o.numero ?? o.type}`].filter(Boolean).map(echapper).join(' · ');
      const nc = referentiels.sous_types.find((s) => s.code === l.sous_type)?.non_conformite;
      // Équipe d'une tâche (courte) : cases à cocher ; saisie libre : équipiers choisis par recherche (étiquettes).
      const proposes = l.id || !t?.chef ? [] : t.membres;
      const libreEquipe = !l.id && l.libre && this.d.equipiers.length > 0;
      return `<div class="terrain-saisie" data-i="${i}">
        <p class="terrain-ligne"><b>${titre}</b>${lecture ? '' : `<button type="button" class="terrain-bouton" data-retirer aria-label="${texteHtml('terrain_btp.pointage.retirer')}" title="${texteHtml(l.groupe ? 'terrain_btp.pointage.retirer_seul' : 'terrain_btp.pointage.retirer')}">${iconeHtml('retirer')}</button>`}</p>
        ${l.libre ? `<div class="terrain-champs"><label>${texteHtml('terrain_btp.pointage.chantier')} <span data-combo="chantier"></span></label><label>${texteHtml('terrain_btp.pointage.ordre')} <span data-combo="ordre"></span></label></div>` : lieu ? `<p class="aide">${lieu}</p>` : ''}
        <div class="terrain-champs">
          <label>${texteHtml('terrain_btp.pointage.type')} <span data-combo="type"></span></label>
          <label>${texteHtml('terrain_btp.pointage.activite')} <span data-combo="sous-type"></span></label>
          <label>${texteHtml('terrain_btp.pointage.duree')} <input data-minutes inputmode="decimal" size="6" placeholder="7:30" value="${ecrireDuree(l.minutes ?? 0)}" ${lecture ? 'readonly' : ''}></label>
        </div>
        ${nc ? `<label class="large">${texteHtml('terrain_btp.pointage.motif')} <input data-motif list="terrain-motifs-pointage" value="${echapper(l.motif ?? '')}" ${lecture ? 'readonly' : ''}></label>` : ''}
        <label class="large">${texteHtml('terrain_btp.pointage.commentaire')} <input data-commentaire value="${echapper(l.commentaire ?? '')}" ${lecture ? 'readonly' : ''}></label>
        ${proposes.length && !lecture ? `<fieldset class="terrain-membres"><legend>${iconeHtml('pointage_equipe')} ${texteHtml('terrain_btp.pointage.pour_equipe')}</legend>${proposes.map((m) => `<label class="coche"><input type="checkbox" data-membre="${m.id}" ${l.membres.includes(m.id) ? 'checked' : ''}> ${echapper(m.libelle)}</label>`).join('')}</fieldset>` : ''}
        ${libreEquipe && !lecture ? `<fieldset class="terrain-membres"><legend>${iconeHtml('pointage_equipe')} ${texteHtml('terrain_btp.pointage.equipiers')}</legend><span data-equipiers></span></fieldset>` : ''}
        ${l.groupe && l.nb_groupe > 1 && !lecture ? `<label class="coche"><input type="checkbox" data-equipe ${l.equipe ? 'checked' : ''}> ${iconeHtml('pointage_equipe')} ${l.nb_groupe > 2 ? texteHtml('terrain_btp.appliquer_autres', { nombre: l.nb_groupe - 1 }) : texteHtml('terrain_btp.appliquer_autre')}</label>` : ''}
      </div>`;
    }).join('');
    zone.querySelectorAll('.terrain-saisie').forEach((bloc) => {
      const l = this.lignes[Number(bloc.dataset.i)];
      const combo = (cle, options, valeur, changer, vide = false) => {
        const z = bloc.querySelector(`[data-combo="${cle}"]`);
        if (!z) return null;
        const cb = creerCombo({ options, valeur: valeur ?? '', vide });
        cb.disabled = lecture;
        cb.addEventListener('change', () => { changer(cb.valeurCombo === '' || cb.valeurCombo == null ? null : cb.valeurCombo); this.#changer(); });
        z.append(cb);
        return cb;
      };
      if (l.libre) {
        combo('chantier', this.d.chantiers.map((c) => ({ valeur: c.id, libelle: `${c.code} ${c.libelle}`, detail: c.ville ?? '' })), l.cha_id, (v) => {
          l.cha_id = v == null ? null : Number(v); l.ent_id = null; this.#rendreLignes(lecture);
        });
        combo('ordre', this.d.ordres.filter((o) => o.cha_id === l.cha_id).map((o) => ({ valeur: o.id, libelle: o.numero ?? o.type, detail: o.objet ?? '' })), l.ent_id, (v) => {
          l.ent_id = v == null ? null : Number(v);
          const srv = this.#ordre(l.ent_id)?.srv_id;
          if (srv && !l.type_mo) { l.type_mo = referentiels.types_mo.find((t) => t.srv_id === srv)?.id ?? null; this.#rendreLignes(lecture); }
        }, true);
      }
      combo('type', referentiels.types_mo.map((t) => ({ valeur: t.id, libelle: t.libelle, detail: t.code })), l.type_mo, (v) => { l.type_mo = v == null ? null : Number(v); });
      combo('sous-type', referentiels.sous_types.map((s) => ({ valeur: s.code, libelle: s.libelle })), l.sous_type, (v) => { l.sous_type = v; this.#rendreLignes(lecture); }, true);
      const champ = (sel, changer) => bloc.querySelector(sel)?.addEventListener('change', (e) => { changer(e.target); this.#changer(); });
      champ('[data-minutes]', (e) => { l.minutes = lireDuree(e.value); e.value = ecrireDuree(l.minutes ?? 0); });
      champ('[data-motif]', (e) => { l.motif = e.value.trim() || null; });
      champ('[data-commentaire]', (e) => { l.commentaire = e.value.trim() || null; });
      champ('[data-equipe]', (e) => { l.equipe = e.checked; });
      bloc.querySelectorAll('[data-membre]').forEach((c) => c.addEventListener('change', () => {
        l.membres = [...bloc.querySelectorAll('[data-membre]:checked')].map((x) => Number(x.dataset.membre));
        this.modifiee(true);
      }));
      bloc.querySelector('[data-equipiers]')?.append(choixMultiple({
        options: this.d.equipiers.map((m) => ({ valeur: m.id, libelle: m.libelle })), valeurs: l.membres, titre: texte('terrain_btp.pointage.ajouter_equipier'), aucun: texte('terrain_btp.pointage.seul'),
        changer: (v) => { l.membres = v.map(Number); this.modifiee(true); },
      }));
      bloc.querySelector('[data-retirer]')?.addEventListener('click', () => { this.lignes.splice(this.lignes.indexOf(l), 1); this.modifiee(true); this.#rendre(); });
    });
  }

  /** Enregistre la journée ; renvoie vrai si c'est fait. */
  async enregistrer() {
    const incompletes = this.lignes.filter((l) => !l.cha_id || !l.type_mo || !(l.minutes > 0));
    if (incompletes.length) { this.app.message(texte('terrain_btp.pointage.incomplete'), 'avertissement'); return false; }
    const corps = {
      date: this.jour,
      // Pointages du jour connus de l'appareil : seuls ceux-là peuvent être retirés (un pointage ajouté ailleurs reste).
      connus: (this.d.pointages ?? []).map((p) => p.id),
      lignes: this.lignes.map((l) => ({ id: l.id, tac_id: l.tac_id, cha_id: l.cha_id, ent_id: l.ent_id, type_mo: l.type_mo, sous_type: l.sous_type, minutes: l.minutes,
        motif: l.motif, commentaire: l.commentaire, membres: l.id ? null : l.membres, equipe: l.equipe })),
    };
    let r;
    try {
      r = await envoyerOuGarder(this.app, { type: OPERATION_TERRAIN.JOURNEE, id: this.jour, corps, libelle: texte('terrain_btp.pointage.libelle', { date: formatDate(this.jour) }),
        url: `/terrain?onglet=pointage&jour=${this.jour}` }, () => api.terrain.enregistrerJournee(corps));
    } catch (e) { this.app.erreur(e); return false; }
    if (r.horsLigne) {
      this.operation = await lireOperation(this.app.utilisateur(), OPERATION_TERRAIN.JOURNEE, this.jour);
      this.modifiee(false);
      this.#rendre();
      return true;
    }
    this.d = r.reponse;
    // Journée relue pour que l'appareil garde sa dernière version (consultation hors ligne).
    api.terrain.journee(this.jour).catch(() => {});
    // Envoyée : une journée gardée sur l'appareil (refusée puis corrigée) n'a plus lieu d'être.
    if (this.operation) { await retirerOperation(this.operation.cle); this.operation = null; this.app.publier(SUJET_ATTENTE, {}); }
    const ordres = [...new Set(this.lignes.filter((l) => l.ent_id).map((l) => l.ent_id))];
    this.lignes = this.d.pointages.map(depuisPointage);
    this.modifiee(false);
    this.app.message(texte('terrain_btp.pointage.enregistree'), 'succes');
    this.#rendre();
    await this.#etapeTerminee(ordres);
    return true;
  }

  /** E52 : après un pointage sur des ordres, leur étape en cours est proposée (« Étape terminée ? »). */
  async #etapeTerminee(ordres) {
    if (!ordres.length || !this.app.moduleActif(MODULE_FACULTATIF.EXECUTION)) return;
    let r;
    try { r = await api.terrain.etapes(ordres); } catch { return; }
    const aValider = r.ordres.filter((o) => o.etapes.some((e) => !e.valide_le));
    if (!aValider.length) return;
    const zone = this.zone.querySelector('[data-etape-terminee]');
    await new EcranEtapesAtelier(zone, fournisseurEtapes(this.app, () => api.terrain.etapes(ordres)), { titre: texte('terrain_btp.pointage.etape_terminee'), message: (t, n) => this.app.message(t, n) }).ouvrir();
    zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
