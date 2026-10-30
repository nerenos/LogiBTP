import { echapper, creerCombo } from '@logibtp/socle/ui';
import { lireDuree, ecrireDuree } from '@logibtp/pointage';
import { api } from '../api.js';
import { choisirRestaurant } from '../pointage/repas.js';
import { choixMultiple } from '../choix-multiple.js';
import { EcranEtapesAtelier } from '@logibtp/execution/ui';
import { MODULE_FACULTATIF } from '../codes.js';
import { completerJournee } from './terrain.js';

// Application de terrain, lot 2 (ANALYSE-TERRAIN.md, T4, T7, T8, T21, T22) : pointage de la journée sur le terrain.
// Une ligne par tâche du jour (niveau de détail planifié) ou en saisie libre (chantier puis ordre choisis) ; chef de
// l'équipe d'une tâche ou droit de saisie libre en équipe : la ligne nouvelle vaut aussi pour les membres cochés ;
// ligne d'une saisie d'équipe : « pour l'équipe » applique la modification aux membres encore identiques.
// Serveur : TerrainPointageBtp.cs (mêmes contrôles et blocages que la saisie au bureau).

let referentiels = null;

/** Ligne éditable depuis un pointage enregistré. */
const depuisPointage = (p) => ({ id: p.id, tac_id: p.tac_id, cha_id: p.cha_id, ent_id: p.ent_id, type_mo: p.type_mo, sous_type: p.sous_type, minutes: p.minutes,
  motif: p.motif, commentaire: p.commentaire, membres: [], groupe: p.groupe, nb_groupe: p.nb_groupe, equipe: false });

export class PointageTerrain {
  /** Options : app, message(texte, niveau), modifiee(bool) : signale une saisie non enregistrée. */
  constructor(zone, { app, modifiee = () => {} }) {
    this.zone = zone;
    this.app = app;
    this.modifiee = modifiee;
  }

  async ouvrir(jour) {
    this.jour = jour;
    try {
      referentiels ??= await api.pointage.referentiels();
      this.d = await api.terrain.journee(jour);
    } catch (e) { this.app.erreur(e); return; }
    this.lignes = (this.d.pointages ?? []).map(depuisPointage);
    this.repas = null;
    if (this.d.personne) api.pointage.repas(this.d.personne.id, jour, jour).then((r) => { this.repas = r[0] ?? null; this.#rendreRepas(); }).catch(() => {});
    this.modifiee(false);
    this.#rendre();
  }

  get #pas() { return referentiels?.parametres?.pas_minutes ?? 0; }

  #tache(id) { return this.d.taches.find((t) => t.id === id) ?? null; }
  #chantier(id) { return this.d.chantiers.find((c) => c.id === id) ?? null; }
  #ordre(id) { return this.d.ordres.find((o) => o.id === id) ?? null; }

  #changer() { this.modifiee(true); this.#rendreBilan(); }

  #rendre() {
    const d = this.d;
    if (!d.personne) { this.zone.innerHTML = '<p class="carte avertissement">Votre compte n\'est lié à aucun salarié.</p>'; return; }
    const lecture = d.valide;
    const sansLigne = d.taches.filter((t) => !this.lignes.some((l) => l.tac_id === t.id));
    this.zone.innerHTML = `<div class="terrain-pointage">
      <p class="terrain-bilan" data-bilan></p>
      ${lecture ? '<p class="carte">🔒 Journée validée : consultation seulement (une correction se demande au service RH).</p>' : ''}
      ${!lecture && sansLigne.length ? `<div class="terrain-a-pointer"><b>À pointer</b>${sansLigne.map((t) => `<button type="button" class="terrain-bouton" data-pointer="${t.id}">＋ ${echapper(t.libelle)}${t.chef && t.membres.length ? ` · 👥 ${t.membres.length + 1}` : ''}</button>`).join('')}</div>` : ''}
      <datalist id="terrain-motifs-pointage">${(d.motifs ?? []).map((m) => `<option value="${echapper(m)}">`).join('')}</datalist>
      <div data-lignes></div>
      <div data-etape-terminee></div>
      ${lecture ? '' : `<div class="terrain-actions">
        ${d.libre ? '<button type="button" class="terrain-bouton" data-libre>🛠 Saisie libre</button>' : ''}
        <button type="button" class="terrain-bouton" data-completer title="Répartit les heures prévues au calendrier, moins celles déjà saisies, entre les lignes sans durée">⇥ Compléter la journée</button>
      </div>`}
      <p class="terrain-ligne"><span data-repas>🍽 …</span>${lecture ? '' : '<button type="button" class="terrain-bouton" data-choisir-repas>🍽 Repas</button>'}</p>
      ${lecture ? '' : '<div class="terrain-enregistrer"><button type="button" class="principal" data-enregistrer>💾 Enregistrer la journée</button></div>'}
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
      if (minutes.every((m) => m == null)) { this.app.message(d.minutes_prevues ? 'Rien à compléter : la journée est pleine ou sans ligne vide' : 'Aucune heure prévue ce jour au calendrier', 'avertissement'); return; }
      minutes.forEach((m, i) => { if (m != null) this.lignes[i].minutes = m; });
      this.modifiee(true);
      this.#rendre();
    });
    $('[data-choisir-repas]')?.addEventListener('click', () => this.#choisirRepas());
    $('[data-enregistrer]')?.addEventListener('click', () => this.enregistrer());
    this.#rendreLignes(lecture);
    this.#rendreBilan();
    this.#rendreRepas();
  }

  #rendreBilan() {
    const saisi = this.lignes.reduce((s, l) => s + (l.minutes ?? 0), 0);
    const b = this.zone.querySelector('[data-bilan]');
    if (b) b.textContent = `Prévu ${ecrireDuree(this.d.minutes_prevues) || '0:00'} h · saisi ${ecrireDuree(saisi) || '0:00'} h`;
  }

  #rendreRepas() {
    const z = this.zone.querySelector('[data-repas]');
    if (z) z.textContent = this.repas ? `🍽 ${this.repas.restaurant}` : '🍽 Pas de repas au restaurant';
  }

  async #choisirRepas() {
    const chantier = this.lignes.find((l) => l.cha_id)?.cha_id ?? null;
    const choix = await choisirRestaurant({ charger: (q) => api.pointage.restaurants(chantier, q), actuel: this.repas });
    if (!choix) return;
    try {
      await api.pointage.enregistrerRepas(this.d.personne.id, { date: this.jour, restaurant_id: choix.restaurant_id ?? null, nouveau: choix.nouveau ?? null, ville: choix.ville ?? null, cha_id: chantier });
      this.repas = (await api.pointage.repas(this.d.personne.id, this.jour, this.jour))[0] ?? null;
      this.#rendreRepas();
      this.app.message(choix.aucun ? 'Repas retiré' : 'Repas enregistré', 'succes');
    } catch (e) { this.app.erreur(e); }
  }

  #rendreLignes(lecture) {
    const zone = this.zone.querySelector('[data-lignes]');
    if (!this.lignes.length) { zone.innerHTML = '<p class="terrain-vide">Aucun pointage ce jour.</p>'; return; }
    zone.innerHTML = this.lignes.map((l, i) => {
      const t = this.#tache(l.tac_id);
      const c = this.#chantier(l.cha_id);
      const o = this.#ordre(l.ent_id);
      const titre = t ? echapper(t.libelle) : l.libre ? '🛠 Saisie libre' : '🛠 Saisie libre (enregistrée)';
      const lieu = [c && `🏗 ${c.code} ${c.libelle}`, o && `🧩 ${o.numero ?? o.type}`].filter(Boolean).map(echapper).join(' · ');
      const nc = referentiels.sous_types.find((s) => s.code === l.sous_type)?.non_conformite;
      // Équipe d'une tâche (courte) : cases à cocher ; saisie libre : équipiers choisis par recherche (étiquettes).
      const proposes = l.id || !t?.chef ? [] : t.membres;
      const libreEquipe = !l.id && l.libre && this.d.equipiers.length > 0;
      return `<div class="terrain-saisie" data-i="${i}">
        <p class="terrain-ligne"><b>${titre}</b>${lecture ? '' : `<button type="button" class="terrain-bouton" data-retirer aria-label="Retirer la ligne" title="Retirer la ligne${l.groupe ? ' (pour vous seul)' : ''}">✕</button>`}</p>
        ${l.libre ? '<div class="terrain-champs"><label>Chantier <span data-combo="chantier"></span></label><label>Ordre <span data-combo="ordre"></span></label></div>' : lieu ? `<p class="aide">${lieu}</p>` : ''}
        <div class="terrain-champs">
          <label>Type <span data-combo="type"></span></label>
          <label>Activité <span data-combo="sous-type"></span></label>
          <label>Durée <input data-minutes inputmode="decimal" size="6" placeholder="7:30" value="${ecrireDuree(l.minutes ?? 0)}" ${lecture ? 'readonly' : ''}></label>
        </div>
        ${nc ? `<label class="large">Motif de non-conformité <input data-motif list="terrain-motifs-pointage" value="${echapper(l.motif ?? '')}" ${lecture ? 'readonly' : ''}></label>` : ''}
        <label class="large">Commentaire <input data-commentaire value="${echapper(l.commentaire ?? '')}" ${lecture ? 'readonly' : ''}></label>
        ${proposes.length && !lecture ? `<fieldset class="terrain-membres"><legend>👥 Pour l'équipe</legend>${proposes.map((m) => `<label class="coche"><input type="checkbox" data-membre="${m.id}" ${l.membres.includes(m.id) ? 'checked' : ''}> ${echapper(m.libelle)}</label>`).join('')}</fieldset>` : ''}
        ${libreEquipe && !lecture ? '<fieldset class="terrain-membres"><legend>👥 Équipiers (même pointage pour chacun)</legend><span data-equipiers></span></fieldset>' : ''}
        ${l.groupe && l.nb_groupe > 1 && !lecture ? `<label class="coche"><input type="checkbox" data-equipe ${l.equipe ? 'checked' : ''}> 👥 Appliquer la modification ${l.nb_groupe > 2 ? `aux ${l.nb_groupe - 1} autres membres encore identiques` : "à l'autre membre s'il est encore identique"}</label>` : ''}
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
        options: this.d.equipiers.map((m) => ({ valeur: m.id, libelle: m.libelle })), valeurs: l.membres, titre: 'Ajouter un équipier', aucun: 'seul',
        changer: (v) => { l.membres = v.map(Number); this.modifiee(true); },
      }));
      bloc.querySelector('[data-retirer]')?.addEventListener('click', () => { this.lignes.splice(this.lignes.indexOf(l), 1); this.modifiee(true); this.#rendre(); });
    });
  }

  /** Enregistre la journée ; renvoie vrai si c'est fait. */
  async enregistrer() {
    const incompletes = this.lignes.filter((l) => !l.cha_id || !l.type_mo || !(l.minutes > 0));
    if (incompletes.length) { this.app.message('Chaque ligne a un chantier, un type et une durée (ou retirez-la)', 'avertissement'); return false; }
    try {
      this.d = await api.terrain.enregistrerJournee({
        date: this.jour,
        lignes: this.lignes.map((l) => ({ id: l.id, tac_id: l.tac_id, cha_id: l.cha_id, ent_id: l.ent_id, type_mo: l.type_mo, sous_type: l.sous_type, minutes: l.minutes,
          motif: l.motif, commentaire: l.commentaire, membres: l.id ? null : l.membres, equipe: l.equipe })),
      });
    } catch (e) { this.app.erreur(e); return false; }
    const ordres = [...new Set(this.lignes.filter((l) => l.ent_id).map((l) => l.ent_id))];
    this.lignes = this.d.pointages.map(depuisPointage);
    this.modifiee(false);
    this.app.message('Journée enregistrée', 'succes');
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
    await new EcranEtapesAtelier(zone, {
      charger: async () => ({ ordres: (await api.terrain.etapes(ordres)).ordres }),
      valider: (entId, code) => api.terrain.validerEtape(entId, code), ordre: (numero) => api.terrain.ordreEtapes(numero),
    }, { titre: 'Étape terminée ?', message: (t, n) => this.app.message(t, n) }).ouvrir();
    zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
