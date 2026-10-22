import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import {
  controlerSemaine, MESSAGES_POINTAGE, lundiDe, joursSemaine, lireDuree, ecrireDuree,
  ETATS_VALIDATION, MESSAGES_VALIDATION, estBloque, UNITES_RUBRIQUE, SAISIES_RUBRIQUE, TYPES_REGLE, controlerProfil, MESSAGES_PAIE,
} from '@logibtp/pointage';
import { api } from '../api.js';

// Module Pointage : saisie au bureau (lot 1 : grille hebdomadaire d'un salarié, une ligne par chantier, ordre, type et
// sous-type de main-d'œuvre, une colonne par jour), synthèse et validation (lot 2 : couche validée, simple ou double
// validation, dévalidation avec motif, demandes de correction) et paramètres. Contrôles répliqués (controles.js ↔
// ReglesPointage.cs, validation.js ↔ ReglesValidation.cs) : erreurs refusées par le serveur, avertissements signalés.

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const decaler = (date, jours) => new Date(new Date(`${date}T00:00:00Z`).getTime() + jours * 86400000).toISOString().slice(0, 10);
const jourCourt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const horodatage = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const nomSalarie = (s, ordre) => (ordre === 'PN' ? `${s.prenom} ${s.nom}` : `${s.nom} ${s.prenom}`);
const cleLigne = (p) => [p.cha_id, p.ent_id ?? '', p.type_mo, p.sous_type ?? '', p.motif ?? ''].join('|');
const iconeEtat = (e) => ETATS_VALIDATION[e]?.icone ?? '';

/**
 * Lignes de la grille depuis les pointages : regroupement par chantier, ordre, type, sous-type et motif ; une case =
 * un pointage (plusieurs pointages le même jour sur la même ligne : case en lecture seule, valeurs gardées).
 */
function lignesDepuis(pointages, jours) {
  const lignes = new Map();
  for (const p of pointages) {
    const k = cleLigne(p);
    if (!lignes.has(k)) lignes.set(k, { cha_id: p.cha_id, ent_id: p.ent_id, type_mo: p.type_mo, sous_type: p.sous_type, motif: p.motif, cases: jours.map(() => []) });
    lignes.get(k).cases[jours.indexOf(p.date)].push({ ...p, minutes_origine: p.minutes });
  }
  return [...lignes.values()];
}

/** Pointages à envoyer depuis les lignes : une case modifiée remplace son pointage (plage effacée si la durée change). */
function pointagesDepuis(lignes, jours) {
  const r = [];
  for (const l of lignes) {
    l.cases.forEach((c, i) => {
      for (const p of c) {
        if (!p.minutes) continue;
        const plage = p.debut != null && p.minutes === p.minutes_origine;
        r.push({
          id: p.id ?? null, origine_id: p.origine_id ?? null, date: jours[i], cha_id: l.cha_id ?? null, ent_id: l.ent_id ?? null, type_mo: l.type_mo ?? null,
          sous_type: l.sous_type || null, minutes: p.minutes, debut: plage ? p.debut : null, fin: plage ? p.fin : null, motif: l.motif || null,
          commentaire: p.commentaire ?? null,
        });
      }
    });
  }
  return r;
}

/**
 * Grille hebdomadaire d'un salarié (saisie ou couche validée) : combos chantier, ordre, type et sous-type, motif d'une
 * non-conformité, durées par jour, totaux, contrôles en direct. Jours verrouillés (validés) en lecture seule.
 * Options : ref (référentiels), chantiers (proposés), donnees { salarie, pointages, chantiers, ordres, recents },
 * lundi, lecture, verrouilles (index des jours), change().
 */
class GrillePointage {
  #o;
  modifiee = false;

  constructor(zone, options) {
    this.zone = zone;
    this.#o = options;
    this.jours = joursSemaine(options.lundi);
    this.lignes = lignesDepuis(options.donnees.pointages, this.jours);
    this.#rendre();
  }

  pointages() { return pointagesDepuis(this.lignes, this.jours); }

  #options() {
    const d = this.#o.donnees;
    const chantiers = new Map([...this.#o.chantiers, ...(d.chantiers ?? [])].map((c) => [c.id, c]));
    const recents = new Set(d.recents ?? []);
    const ref = this.#o.ref;
    return {
      chantiers: [...chantiers.values()].sort((a, b) => Number(recents.has(b.id)) - Number(recents.has(a.id)))
        .map((c) => ({ valeur: c.id, libelle: `${c.code} ${c.libelle}`, detail: c.interne ? 'interne' : recents.has(c.id) ? 'récent' : c.clos ? 'clos' : '' })),
      clos: new Set([...chantiers.values()].filter((c) => c.clos).map((c) => c.id)),
      types: ref.types_mo.map((t) => ({ valeur: t.id, libelle: t.libelle, detail: t.code })),
      sousTypes: ref.sous_types.map((s) => ({ valeur: s.code, libelle: s.libelle })),
      nc: new Set(ref.sous_types.filter((s) => s.non_conformite).map((s) => s.code)),
    };
  }

  #controles(o) {
    const pointages = [];
    this.lignes.forEach((l, i) => l.cases.forEach((c, j) => c.forEach((p, k) => {
      if (p.minutes) {
        const plage = p.debut != null && p.minutes === p.minutes_origine;
        pointages.push({ cle: `${i}:${j}:${k}`, date: this.jours[j], cha_id: l.cha_id ?? null, type_mo: l.type_mo ?? null, minutes: p.minutes,
          debut: plage ? p.debut : null, fin: plage ? p.fin : null, non_conformite: o.nc.has(l.sous_type), motif: l.motif, chantier_clos: o.clos.has(l.cha_id) });
      }
    })));
    return controlerSemaine({ parametres: this.#o.ref.parametres, pointages });
  }

  #rendre() {
    const { zone, jours } = this;
    const o = this.#options();
    const lecture = Boolean(this.#o.lecture);
    const verrou = new Set(this.#o.verrouilles ?? []);
    const d = this.#o.donnees;
    zone.innerHTML = `<table class="grille-pointage"><thead><tr><th>Chantier</th><th>Ordre</th><th>Type de MO</th><th>Sous-type</th><th>Motif</th>
        ${jours.map((x, i) => `<th class="nombre"${verrou.has(i) ? ' title="Jour validé"' : ''}>${verrou.has(i) ? '🔒 ' : ''}${JOURS[i]} ${jourCourt(x)}</th>`).join('')}<th class="nombre">Total</th><th></th></tr></thead><tbody></tbody>
        <tfoot><tr><th colspan="5">Total</th>${jours.map((_, i) => `<th class="nombre" data-total="${i}"></th>`).join('')}<th class="nombre" data-total="s"></th><th></th></tr></tfoot></table>
      ${lecture ? '' : `<p><button type="button" data-ajouter>＋ Ligne</button> <span class="aide">Durées au pas de ${this.#o.ref.parametres.pas_minutes} min : « 7:30 », « 7h30 » ou « 7,5 ».</span></p>`}
      <div data-controles></div>`;
    const corps = zone.querySelector('tbody');
    const majTotaux = () => {
      const tot = jours.map((_, i) => this.lignes.reduce((a, l) => a + l.cases[i].reduce((b, p) => b + (p.minutes || 0), 0), 0));
      tot.forEach((t, i) => { zone.querySelector(`[data-total="${i}"]`).textContent = ecrireDuree(t); });
      zone.querySelector('[data-total="s"]').textContent = ecrireDuree(tot.reduce((a, b) => a + b, 0));
      corps.querySelectorAll('tr').forEach((tr, i) => {
        tr.querySelector('[data-total-ligne]').textContent = ecrireDuree(this.lignes[i].cases.flat().reduce((a, p) => a + (p.minutes || 0), 0));
      });
      const c = this.#controles(o);
      corps.querySelectorAll('td.erreur, td.avertissement').forEach((td) => td.classList.remove('erreur', 'avertissement'));
      for (const x of c.filter((y) => y.cle)) {
        const [i, j] = x.cle.split(':').map(Number);
        corps.querySelector(`tr[data-i="${i}"] td[data-j="${j}"]`)?.classList.add(x.niveau === 'ERREUR' ? 'erreur' : 'avertissement');
      }
      zone.querySelector('[data-controles]').innerHTML = c.length ? `<ul class="controles">${c.map((x) => `<li class="${x.niveau === 'ERREUR' ? 'erreur' : 'avertissement'}">${x.niveau === 'ERREUR' ? '⛔' : '⚠'} ${echapper(MESSAGES_POINTAGE[x.code] ?? x.code)}${x.date ? ` (${jourCourt(x.date)})` : ''}${x.cle ? ` — ${JOURS[Number(x.cle.split(':')[1])]}, ligne ${Number(x.cle.split(':')[0]) + 1}` : ''}</li>`).join('')}</ul>` : '';
    };
    const changer = () => { this.modifiee = true; majTotaux(); this.#o.change?.(); };
    const rendreLignes = () => {
      corps.innerHTML = this.lignes.map((l, i) => {
        const fige = lecture || l.cases.some((c, j) => verrou.has(j) && c.length);
        return `<tr data-i="${i}"><td data-c="cha"></td><td data-c="ordre"></td><td data-c="type"></td><td data-c="st"></td>
        <td><input data-motif size="14" value="${echapper(l.motif ?? '')}" ${!fige && o.nc.has(l.sous_type) ? '' : 'disabled'}></td>
        ${l.cases.map((c, j) => `<td data-j="${j}"><input class="duree" size="5" value="${ecrireDuree(c.reduce((a, p) => a + (p.minutes || 0), 0))}" ${lecture || verrou.has(j) || c.length > 1 ? 'readonly' : ''} ${c.length > 1 ? 'title="Plusieurs pointages ce jour"' : c[0]?.debut != null ? `title="${ecrireDuree(c[0].debut)} – ${ecrireDuree(c[0].fin)}"` : ''}></td>`).join('')}
        <td class="nombre" data-total-ligne></td><td>${fige ? '' : '<button type="button" data-retirer title="Retirer la ligne">✕</button>'}</td></tr>`;
      }).join('');
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        const l = this.lignes[Number(tr.dataset.i)];
        const fige = lecture || l.cases.some((c, j) => verrou.has(j) && c.length);
        const ordres = (d.ordres ?? []).filter((x) => x.cha_id === l.cha_id).map((x) => ({ valeur: x.id, libelle: x.numero ?? `#${x.id}`, detail: x.objet ?? x.type }));
        const combos = {
          cha: creerCombo({ options: o.chantiers, valeur: l.cha_id ?? '', vide: false, titre: 'Chantier' }),
          ordre: creerCombo({ options: ordres, valeur: l.ent_id ?? '', vide: true, titre: 'Ordre (facultatif)' }),
          type: creerCombo({ options: o.types, valeur: l.type_mo ?? '', vide: false, titre: 'Type de main-d\'œuvre' }),
          st: creerCombo({ options: o.sousTypes, valeur: l.sous_type ?? '', vide: true, titre: 'Sous-type' }),
        };
        for (const [k, c] of Object.entries(combos)) { c.readOnly = fige; tr.querySelector(`[data-c="${k}"]`).append(c); }
        if (fige) return;
        combos.cha.addEventListener('change', () => { l.cha_id = combos.cha.valeurCombo ? Number(combos.cha.valeurCombo) : null; l.ent_id = null; this.modifiee = true; this.#o.change?.(); rendreLignes(); });
        combos.ordre.addEventListener('change', () => { l.ent_id = combos.ordre.valeurCombo ? Number(combos.ordre.valeurCombo) : null; changer(); });
        combos.type.addEventListener('change', () => { l.type_mo = combos.type.valeurCombo ? Number(combos.type.valeurCombo) : null; changer(); });
        combos.st.addEventListener('change', () => {
          l.sous_type = combos.st.valeurCombo || null;
          tr.querySelector('[data-motif]').disabled = !o.nc.has(l.sous_type);
          changer();
        });
        tr.querySelector('[data-motif]').addEventListener('change', (e) => { l.motif = e.target.value.trim() || null; changer(); });
        tr.querySelectorAll('td[data-j] input:not([readonly])').forEach((inp) => inp.addEventListener('change', () => {
          const j = Number(inp.closest('td').dataset.j);
          const m = lireDuree(inp.value);
          if (m === null) { inp.classList.add('invalide'); return; }
          inp.classList.remove('invalide');
          const c = l.cases[j];
          if (c.length === 0 && m) c.push({ minutes: m });
          else if (c.length === 1) c[0].minutes = m;
          inp.value = ecrireDuree(m);
          changer();
        }));
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.lignes.splice(this.lignes.indexOf(l), 1); this.modifiee = true; this.#o.change?.(); rendreLignes(); });
      });
      majTotaux();
    };
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      const prec = this.lignes.at(-1);
      const typeService = this.#o.ref.types_mo.find((t) => t.srv_id === d.salarie.srv_id)?.id;
      this.lignes.push({ cha_id: prec?.cha_id ?? d.recents?.[0] ?? null, ent_id: null, type_mo: prec?.type_mo ?? typeService ?? null, sous_type: 'PRODUCTION', motif: null, cases: jours.map(() => []) });
      this.modifiee = true;
      this.#o.change?.();
      rendreLignes();
    });
    rendreLignes();
  }
}

/** Barre de semaine commune (◀ date ▶, service, recherche) : appelle `changer` avec le nouveau lundi. */
function barreSemaine(conteneur, page, { changerSemaine, changerFiltre }) {
  const services = page.ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle, detail: s.code }));
  const srv = creerCombo({ options: services, valeur: page.service, vide: true, titre: 'Service' });
  conteneur.querySelector('[data-service]').append(srv);
  srv.addEventListener('change', () => { page.service = srv.valeurCombo; changerFiltre(); });
  const date = conteneur.querySelector('[data-date]');
  date.value = page.lundi;
  const aller = async (lundi) => { if (!(await changerSemaine(lundi))) date.value = page.lundi; };
  date.addEventListener('change', () => date.value && aller(lundiDe(date.value)));
  conteneur.querySelector('[data-prec]').addEventListener('click', () => { date.value = decaler(page.lundi, -7); aller(date.value); });
  conteneur.querySelector('[data-suiv]').addEventListener('click', () => { date.value = decaler(page.lundi, 7); aller(date.value); });
  conteneur.querySelector('[data-recherche]').addEventListener('change', (e) => { page.recherche = e.target.value; changerFiltre(); });
}

const BARRE = `<p class="ligne"><button type="button" data-prec title="Semaine précédente">◀</button> <input type="date" data-date>
  <button type="button" data-suiv title="Semaine suivante">▶</button> <span data-semaine class="aide"></span>
  · <span data-service></span> <input type="search" data-recherche placeholder="Salarié, matricule…"></p>`;

/** Saisie hebdomadaire au bureau : salariés du service avec leurs totaux, grille de la semaine du salarié choisi. */
export class PageSaisiePointage extends PageBase {
  icone = '⏱';

  get modifiee() { return Boolean(this.grille?.modifiee); }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ lundi: this.lundi, service: this.service, salarie: this.salarie }).filter(([, v]) => v));
    return `/pointage/saisie?${p}`;
  }

  async ouvrir() {
    this.titre = 'Saisie des pointages';
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><h1 class="page-titre">⏱ Saisie des pointages</h1>${BARRE}
      <div class="pointage-corps"><div data-salaries class="pointage-salaries"></div><div data-detail class="pointage-grille"></div></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-salaries]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    if (this.requete.pointage) {
      const pos = await api.pointage.position(this.requete.pointage).catch(() => null);
      if (pos) Object.assign(this.requete, { salarie: String(pos.salarie), lundi: pos.lundi });
    }
    this.ref = await api.pointage.referentiels();
    this.chantiers = await api.pointage.chantiers();
    this.lundi = lundiDe(this.requete.lundi ?? aujourdhui());
    this.service = this.requete.service ?? '';
    this.salarie = this.requete.salarie ?? '';
    barreSemaine(this.conteneur, this, {
      changerSemaine: async (lundi) => {
        if (this.modifiee && !confirm('Abandonner les modifications de la semaine ?')) return false;
        this.lundi = lundi; this.#url(); await this.#chargerSalaries(); if (this.salarie) await this.#chargerSemaine();
        return true;
      },
      changerFiltre: () => { this.#url(); this.#chargerSalaries(); },
    });
    await this.#chargerSalaries();
    if (this.salarie) await this.#chargerSemaine();
  }

  #url() { this.app.routeur.remplacerUrl(this.urlCourante()); }

  async #chargerSalaries() {
    const jours = joursSemaine(this.lundi);
    this.conteneur.querySelector('[data-semaine]').textContent = `du ${jourCourt(jours[0])} au ${jourCourt(jours[6])}`;
    const zone = this.conteneur.querySelector('[data-salaries]');
    if (!this.service && !this.recherche) { zone.innerHTML = '<p class="aide">Choisissez un service ou cherchez un salarié.</p>'; return; }
    let l;
    try { l = await api.pointage.salaries({ service: this.service, recherche: this.recherche, lundi: this.lundi }); } catch (e) { this.app.erreur(e); return; }
    const ordre = this.ref.parametres.ordre_nom;
    zone.innerHTML = l.length ? `<table class="pleine-largeur"><thead><tr><th>Salarié</th>${JOURS.map((j) => `<th>${j}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${l.map((x) => `<tr data-id="${x.salarie.id}" class="cliquable${String(x.salarie.id) === String(this.salarie) ? ' selection' : ''}">
        <td title="${echapper(x.salarie.matricule)}${x.salarie.service ? ` · ${echapper(x.salarie.service)}` : ''}">${echapper(nomSalarie(x.salarie, ordre))}${x.salarie.interimaire ? ' <small class="aide">intérim</small>' : ''}</td>
        ${x.jours.map((m) => `<td class="nombre">${ecrireDuree(m)}</td>`).join('')}<td class="nombre"><b>${ecrireDuree(x.jours.reduce((a, b) => a + b, 0))}</b></td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucun salarié.</p>';
    zone.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
      if (this.modifiee && !confirm('Abandonner les modifications de la semaine ?')) return;
      this.salarie = tr.dataset.id; this.#url();
      zone.querySelectorAll('tr.selection').forEach((x) => x.classList.remove('selection'));
      tr.classList.add('selection');
      await this.#chargerSemaine();
    }));
  }

  async #chargerSemaine() {
    try { this.semaine = await api.pointage.semaine(this.salarie, this.lundi); } catch (e) { this.app.erreur(e); return; }
    this.#rendre();
  }

  #rendre() {
    const s = this.semaine;
    const zone = this.conteneur.querySelector('[data-detail]');
    const verrouilles = s.etats.map((e, i) => (estBloque(e) ? i : -1)).filter((i) => i >= 0);
    zone.innerHTML = `<h2>${echapper(nomSalarie(s.salarie, this.ref.parametres.ordre_nom))} <small class="aide">${echapper(s.salarie.matricule)}${s.salarie.service ? ` · ${echapper(s.salarie.service)}` : ''}</small></h2>
      ${verrouilles.length ? '<p class="avertissement">🔒 Jours validés : non modifiables ici ; une correction s\'envoie au service RH.</p>' : ''}
      ${s.corrigee ? '<p class="avertissement">Cette semaine a été corrigée dans la synthèse : les corrections du service RH priment.</p>' : ''}
      <div data-grille></div>
      <p><button type="button" data-enregistrer>Enregistrer la semaine</button> ${verrouilles.length ? '<button type="button" data-correction>✉ Demander une correction…</button>' : ''}</p>
      ${s.corrections.length ? `<h3>Demandes de correction</h3><ul>${s.corrections.map((c) => `<li>${horodatage(c.le)} — ${echapper({ EN_ATTENTE: 'en attente', APPLIQUEE: 'appliquée', REJETEE: 'rejetée' }[c.etat])}${c.motif ? ` : ${echapper(c.motif)}` : ''}${c.reponse ? ` <span class="aide">(réponse : ${echapper(c.reponse)})</span>` : ''}</li>`).join('')}</ul>` : ''}`;
    this.grille = new GrillePointage(zone.querySelector('[data-grille]'), { ref: this.ref, chantiers: this.chantiers, donnees: s, lundi: this.lundi, verrouilles });
    const correction = async () => {
      const motif = prompt('Motif de la demande de correction (envoyée au service RH) :');
      if (motif === null) return;
      try {
        await api.pointage.demanderCorrection({ salarie: Number(this.salarie), lundi: this.lundi, pointages: this.grille.pointages(), motif });
        this.app.message('Demande de correction envoyée au service RH', 'succes');
        await this.#chargerSemaine();
      } catch (e) { this.app.erreur(e); }
    };
    zone.querySelector('[data-correction]')?.addEventListener('click', correction);
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.semaine = await api.pointage.enregistrerSemaine(this.salarie, this.lundi, { pointages: this.grille.pointages() });
        this.#rendre();
        this.app.message('Semaine enregistrée', 'succes');
        this.#chargerSalaries();
      } catch (e) {
        if (e.code === 'POI_VALIDE' && confirm(`${e.message}\n\nEnvoyer la semaine au service RH comme demande de correction ?`)) await correction();
        else this.app.erreur(e);
      }
    });
  }
}

/**
 * Synthèse MO (lot 2) : salariés d'un service avec heures retenues, état de chaque jour et exceptions (par défaut seuls
 * les salariés à examiner, « Tout voir »), validation de la sélection ou de tout ce qui est sans exception,
 * dévalidation avec motif, demandes de correction, détail d'une semaine (saisie et couche validée modifiable).
 */
export class PageSynthesePointage extends PageBase {
  icone = '✅';

  get modifiee() { return Boolean(this.grille?.modifiee); }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ lundi: this.lundi, service: this.service, salarie: this.salarie, tout: this.tout ? '1' : '' }).filter(([, v]) => v));
    return `/pointage/synthese?${p}`;
  }

  async ouvrir() {
    this.titre = 'Synthèse des pointages';
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><h1 class="page-titre">✅ Synthèse des pointages</h1>${BARRE}
      <p class="ligne"><label><input type="checkbox" data-tout> Tout voir</label> · <span data-periode></span>
        <button type="button" data-valider>✔ Valider la sélection</button> <button type="button" data-tout-valider></button>
        <button type="button" data-devalider>↶ Dévalider la sélection…</button></p>
      <div data-corrections></div><div data-liste></div><div data-detail></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-liste]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    this.ref = await api.pointage.referentiels();
    this.chantiers = await api.pointage.chantiers();
    this.lundi = lundiDe(this.requete.lundi ?? decaler(aujourdhui(), -7));
    this.service = this.requete.service ?? '';
    this.salarie = this.requete.salarie ?? '';
    this.tout = this.requete.tout === '1';
    this.selection = new Set();
    const c = this.conteneur;
    c.querySelector('[data-tout]').checked = this.tout;
    c.querySelector('[data-tout]').addEventListener('change', (e) => { this.tout = e.target.checked; this.#url(); this.#rendreListe(); });
    if (this.ref.parametres.blocage === 'JOUR') {
      c.querySelector('[data-periode]').innerHTML = 'Période : <input type="date" data-du> au <input type="date" data-au>';
    }
    barreSemaine(c, this, {
      changerSemaine: async (lundi) => {
        if (this.modifiee && !confirm('Abandonner les corrections en cours ?')) return false;
        this.lundi = lundi; this.salarie = ''; this.#url(); await this.#charger();
        return true;
      },
      changerFiltre: () => { this.#url(); this.#charger(); },
    });
    c.querySelector('[data-valider]').addEventListener('click', () => this.#agir('valider', [...this.selection]));
    c.querySelector('[data-devalider]').addEventListener('click', () => this.#agir('devalider', [...this.selection]));
    c.querySelector('[data-tout-valider]').addEventListener('click', () => this.#agir('valider', this.#sansException().map((l) => l.salarie.id)));
    await this.#charger();
  }

  #url() { this.app.routeur.remplacerUrl(this.urlCourante()); }

  #periode() {
    const du = this.conteneur.querySelector('[data-du]')?.value || null;
    const au = this.conteneur.querySelector('[data-au]')?.value || null;
    return { du, au };
  }

  #sansException() {
    return (this.donnees?.lignes ?? []).filter((l) => !l.exceptions.length && l.etats.some((e) => e !== 'VALIDE') && (this.donnees.rh || l.chef));
  }

  async #agir(action, salaries) {
    if (!salaries.length) { this.app.message('Aucun salarié sélectionné', 'avertissement'); return; }
    let motif = null;
    if (action === 'devalider') {
      motif = prompt('Motif de la dévalidation (tracé) :');
      if (motif === null) return;
    }
    try {
      const r = await api.pointage[action]({ salaries, lundi: this.lundi, ...this.#periode(), motif });
      const refus = r.resultats.filter((x) => x.codes.length);
      const faits = r.resultats.length - refus.length;
      this.app.message(`${faits} salarié(s) ${action === 'valider' ? 'validé(s)' : 'dévalidé(s)'} (niveau ${r.role})${refus.length ? ` · ${refus.length} refus : ${[...new Set(refus.flatMap((x) => x.codes))].map((x) => MESSAGES_VALIDATION[x] ?? x).join(', ')}` : ''}`,
        refus.length ? 'avertissement' : 'succes');
      if (r.resultats.some((x) => x.apres_export)) this.app.message('Dévalidation après un export de paie : un export correctif sera à faire (tracé au journal).', 'avertissement');
      this.selection.clear();
      await this.#charger();
    } catch (e) { this.app.erreur(e); }
  }

  async #charger() {
    const jours = joursSemaine(this.lundi);
    this.conteneur.querySelector('[data-semaine]').textContent = `du ${jourCourt(jours[0])} au ${jourCourt(jours[6])}`;
    try { this.donnees = await api.pointage.synthese({ service: this.service, recherche: this.recherche, lundi: this.lundi }); } catch (e) { this.app.erreur(e); return; }
    this.#rendreCorrections();
    this.#rendreListe();
    if (this.salarie) await this.#chargerDetail();
    else this.conteneur.querySelector('[data-detail]').innerHTML = '';
  }

  #nom(id) {
    const l = this.donnees.lignes.find((x) => x.salarie.id === id);
    return l ? nomSalarie(l.salarie, this.ref.parametres.ordre_nom) : `Salarié ${id}`;
  }

  #rendreCorrections() {
    const zone = this.conteneur.querySelector('[data-corrections]');
    const l = this.donnees.corrections;
    zone.innerHTML = l.length ? `<h2>Demandes de correction (${l.length})</h2><ul>${l.map((c) => `<li>${echapper(this.#nom(c.salarie))} — ${horodatage(c.le)} par ${echapper(c.par)}${c.motif ? ` : ${echapper(c.motif)}` : ''}
      <button type="button" data-voir="${c.salarie}">Voir</button></li>`).join('')}</ul>` : '';
    zone.querySelectorAll('[data-voir]').forEach((b) => b.addEventListener('click', () => this.#ouvrir(b.dataset.voir)));
  }

  #rendreListe() {
    const zone = this.conteneur.querySelector('[data-liste]');
    const d = this.donnees;
    const lignes = d.lignes.filter((l) => this.tout || l.exceptions.length || String(l.salarie.id) === String(this.salarie));
    const sans = this.#sansException();
    const bouton = this.conteneur.querySelector('[data-tout-valider]');
    bouton.textContent = `✔ Tout valider sans exception (${sans.length})`;
    bouton.disabled = !sans.length;
    const masques = d.lignes.length - lignes.length;
    zone.innerHTML = `${d.lignes.length ? '' : '<p class="aide">Aucun salarié (choisissez un service ; un chef de service ne voit que ses salariés).</p>'}
      ${lignes.length ? `<table class="pleine-largeur synthese-pointage"><thead><tr><th><input type="checkbox" data-tous title="Tout sélectionner"></th><th>Salarié</th>
        ${joursSemaine(this.lundi).map((x, i) => `<th class="nombre">${JOURS[i]} ${jourCourt(x)}</th>`).join('')}<th class="nombre">Total</th><th>À examiner</th></tr></thead><tbody>
        ${lignes.map((l) => `<tr data-id="${l.salarie.id}" class="cliquable${String(l.salarie.id) === String(this.salarie) ? ' selection' : ''}">
          <td><input type="checkbox" data-choix ${this.selection.has(l.salarie.id) ? 'checked' : ''} ${d.rh || l.chef ? '' : 'disabled'}></td>
          <td>${echapper(nomSalarie(l.salarie, this.ref.parametres.ordre_nom))}${l.corrigee ? ' <span title="Corrigé dans la synthèse">✎</span>' : ''}${l.salarie.interimaire ? ' <small class="aide">intérim</small>' : ''}</td>
          ${l.jours.map((m, i) => `<td class="nombre etat-${l.etats[i].toLowerCase()}" title="${echapper(ETATS_VALIDATION[l.etats[i]].libelle)}">${ecrireDuree(m)} ${iconeEtat(l.etats[i])}</td>`).join('')}
          <td class="nombre"><b>${ecrireDuree(l.jours.reduce((a, b) => a + b, 0))}</b></td>
          <td>${l.exceptions.map((x) => `<span class="badge-exception" title="${echapper(MESSAGES_VALIDATION[x])}">${echapper(MESSAGES_VALIDATION[x])}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${masques ? `<p class="aide">${masques} salarié(s) sans exception masqué(s) (« Tout voir »).</p>` : ''}
      <p class="aide">${Object.values(ETATS_VALIDATION).map((e) => `${e.icone} ${e.libelle}`).join(' · ')} · validation ${this.ref.parametres.validation === 'DOUBLE' ? 'double (chef puis RH)' : 'simple (RH)'} · vous validez au niveau ${d.rh ? 'RH' : 'chef de service'}.</p>`;
    zone.querySelector('[data-tous]')?.addEventListener('change', (e) => {
      for (const l of lignes) if (d.rh || l.chef) { if (e.target.checked) this.selection.add(l.salarie.id); else this.selection.delete(l.salarie.id); }
      this.#rendreListe();
    });
    zone.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = Number(tr.dataset.id);
      tr.querySelector('[data-choix]').addEventListener('click', (e) => { e.stopPropagation(); if (e.target.checked) this.selection.add(id); else this.selection.delete(id); });
      tr.addEventListener('click', () => this.#ouvrir(id));
    });
  }

  async #ouvrir(id) {
    if (this.modifiee && !confirm('Abandonner les corrections en cours ?')) return;
    this.salarie = String(id);
    this.#url();
    this.conteneur.querySelectorAll('.synthese-pointage tr.selection').forEach((x) => x.classList.remove('selection'));
    this.conteneur.querySelector(`.synthese-pointage tr[data-id="${id}"]`)?.classList.add('selection');
    await this.#chargerDetail();
  }

  async #chargerDetail() {
    try { this.detail = await api.pointage.detailSynthese(this.salarie, this.lundi); } catch (e) { this.app.erreur(e); return; }
    this.#rendreDetail();
  }

  #rendreDetail() {
    const d = this.detail;
    const zone = this.conteneur.querySelector('[data-detail]');
    const valideRh = d.etats.includes('VALIDE');
    const modifiable = !valideRh && (d.rh || !d.etats.includes('VALIDE_CHEF'));
    const base = d.valide ?? d.saisie.map((p) => ({ ...p, origine_id: p.id, id: null }));
    zone.innerHTML = `<h2>${echapper(nomSalarie(d.salarie, this.ref.parametres.ordre_nom))} <small class="aide">${echapper(d.salarie.matricule)} · ${d.etats.map(iconeEtat).join(' ')}</small></h2>
      ${d.corrections.filter((c) => c.etat === 'EN_ATTENTE').map((c) => `<div class="correction-attente"><b>Demande de correction</b> de ${echapper(c.par)} le ${horodatage(c.le)}${c.motif ? ` : ${echapper(c.motif)}` : ''}
        ${d.rh ? `<button type="button" data-appliquer="${c.id}">Appliquer</button> <button type="button" data-rejeter="${c.id}">Rejeter…</button>` : ''}
        <div data-correction="${c.id}"></div></div>`).join('')}
      <h3>${d.corrigee ? 'Couche validée (corrigée)' : 'Pointages retenus (saisie)'}${modifiable ? '' : ' <small class="aide">— semaine validée : dévalider pour corriger</small>'}</h3>
      <div data-grille-valide></div>
      <p>${modifiable ? `<button type="button" data-enregistrer>Enregistrer les corrections</button>${d.corrigee ? ' <button type="button" data-retablir>Revenir à la saisie</button>' : ''}` : ''}
        <button type="button" data-valider-un>✔ Valider la semaine</button> <button type="button" data-devalider-un>↶ Dévalider…</button></p>
      ${d.corrigee ? '<details><summary>Saisie d\'origine</summary><div data-grille-saisie></div></details>' : ''}
      <div data-paie></div>
      ${d.validations.length ? `<h3>Validations</h3><ul>${d.validations.map((v) => `<li>${v.niveau === 'RH' ? 'RH' : 'Chef'} du ${jourCourt(v.du)} au ${jourCourt(v.au)} par ${echapper(v.par)} le ${horodatage(v.le)}${v.annule_le ? ` — <s>annulée</s> par ${echapper(v.annule_par)} le ${horodatage(v.annule_le)} : ${echapper(v.annule_motif ?? '')}` : ''}</li>`).join('')}</ul>` : ''}
      ${d.journal.length ? `<details><summary>Journal (${d.journal.length})</summary><ul>${d.journal.map((j) => `<li>${horodatage(j.le)} ${echapper(j.action)} par ${echapper(j.par)}</li>`).join('')}</ul></details>` : ''}`;
    const donnees = (pointages) => ({ salarie: d.salarie, pointages, chantiers: d.chantiers, ordres: d.ordres, recents: [] });
    this.grille = new GrillePointage(zone.querySelector('[data-grille-valide]'), { ref: this.ref, chantiers: this.chantiers, donnees: donnees(base), lundi: this.lundi, lecture: !modifiable });
    if (d.corrigee) new GrillePointage(zone.querySelector('[data-grille-saisie]'), { ref: this.ref, chantiers: this.chantiers, donnees: donnees(d.saisie), lundi: this.lundi, lecture: true });
    for (const c of d.corrections.filter((x) => x.etat === 'EN_ATTENTE')) {
      new GrillePointage(zone.querySelector(`[data-correction="${c.id}"]`), { ref: this.ref, chantiers: this.chantiers, donnees: donnees(c.pointages), lundi: this.lundi, lecture: true });
    }
    const apres = async (promesse, message) => {
      try { this.detail = await promesse; this.grille = null; this.app.message(message, 'succes'); await this.#charger(); } catch (e) { this.app.erreur(e); }
    };
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', () => apres(api.pointage.enregistrerSynthese(this.salarie, this.lundi, { pointages: this.grille.pointages() }), 'Corrections enregistrées'));
    zone.querySelector('[data-retablir]')?.addEventListener('click', () => confirm('Abandonner la couche validée et revenir aux pointages saisis ?')
      && apres(api.pointage.retablirSynthese(this.salarie, this.lundi), 'Retour à la saisie'));
    zone.querySelector('[data-valider-un]').addEventListener('click', () => this.#agir('valider', [Number(this.salarie)]));
    zone.querySelector('[data-devalider-un]').addEventListener('click', () => this.#agir('devalider', [Number(this.salarie)]));
    zone.querySelectorAll('[data-appliquer]').forEach((b) => b.addEventListener('click', () => apres(api.pointage.appliquerCorrection(b.dataset.appliquer, {}), 'Correction appliquée')));
    zone.querySelectorAll('[data-rejeter]').forEach((b) => b.addEventListener('click', () => {
      const reponse = prompt('Réponse au demandeur :');
      if (reponse !== null) apres(api.pointage.rejeterCorrection(b.dataset.rejeter, { reponse }), 'Correction rejetée');
    }));
    this.#rendrePaie(zone.querySelector('[data-paie]'), modifiable);
  }

  /**
   * Variables de paie de la semaine (profil du salarié) : une ligne par rubrique, valeur par jour, semaine (heures
   * supplémentaires) et total ; rubriques saisies (S) ou modifiables (SC) en cases éditables ; zones des chantiers.
   */
  async #rendrePaie(zone, modifiable) {
    let v;
    try { v = await api.pointage.variables(this.salarie, this.lundi); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!v.profil) { zone.innerHTML = '<p class="aide">Aucun profil de paie : variables non calculées.</p>'; return; }
    const jours = joursSemaine(this.lundi);
    const saisies = new Map(v.saisies.map((s) => [`${s.date}|${s.rubrique}`, s.valeur]));
    const valeurJour = (code, i) => v.variables?.jours[i]?.valeurs[code];
    const affiche = (r, x) => (x == null || x === 0 ? '' : r.unite === 'H' ? ecrireDuree(x) : String(x));
    const total = (r) => (r.unite === 'ZONE'
      ? Object.entries(v.variables?.totaux ?? {}).filter(([k]) => k.startsWith(`${r.code}_`)).map(([k, n]) => `Z${k.slice(r.code.length + 1)} × ${n}`).join(', ')
      : affiche(r, v.variables?.totaux[r.code]));
    zone.innerHTML = `<h3>Variables de paie <small class="aide">${echapper(v.profil.libelle)}${v.profil.export ? '' : ' (non exportées)'}</small></h3>
      <table class="grille-pointage variables-paie"><thead><tr><th>Rubrique</th>${jours.map((x, i) => `<th class="nombre">${JOURS[i]}</th>`).join('')}<th class="nombre">Semaine</th><th class="nombre">Total</th></tr></thead><tbody>
      ${v.rubriques.map((r) => `<tr><td title="${echapper(SAISIES_RUBRIQUE[r.saisie])}${r.code_paie ? ` · paie ${echapper(r.code_paie)}` : ''}">${echapper(r.libelle)} <small class="aide">${echapper(r.code)}</small></td>
        ${jours.map((x, i) => (r.saisie !== 'C' && modifiable
          ? `<td><input class="duree" data-rub="${echapper(r.code)}" data-jour="${x}" data-unite="${r.unite}" size="4" value="${saisies.has(`${x}|${r.code}`) ? affiche(r, saisies.get(`${x}|${r.code}`)) || '0' : ''}" placeholder="${affiche(r, valeurJour(r.code, i))}"></td>`
          : `<td class="nombre">${affiche(r, valeurJour(r.code, i))}</td>`)).join('')}
        <td class="nombre">${affiche(r, v.variables?.semaine[r.code])}</td><td class="nombre"><b>${total(r)}</b></td></tr>`).join('')}</tbody></table>
      ${modifiable && v.rubriques.some((r) => r.saisie !== 'C') ? '<p><button type="button" data-rubriques>Enregistrer les rubriques saisies</button> <span class="aide">Case vide : valeur calculée ; 0 : annule le calcul (rubrique modifiable).</span></p>' : ''}
      ${v.zones.length ? `<h4>Zones de déplacement${v.agence ? ` (agence ${echapper(v.agence)})` : ''}</h4><table><tbody>${v.zones.map((z) => `<tr><td>${echapper(z.code)} ${echapper(z.libelle)}</td>
        <td>${z.zone == null ? '<span class="badge-exception">à valider</span>' : `zone ${z.zone}`}</td>
        <td>${this.donnees.rh && v.agence ? `<input type="number" min="0" max="9" size="2" data-zone="${z.cha_id}" value="${z.zone ?? ''}"> <button type="button" data-zone-ok="${z.cha_id}">Valider la zone</button>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`;
    zone.querySelector('[data-rubriques]')?.addEventListener('click', async () => {
      const valeurs = [];
      for (const inp of zone.querySelectorAll('input[data-rub]')) {
        if (inp.value.trim() === '') continue;
        const n = inp.dataset.unite === 'H' ? lireDuree(inp.value) : Number(inp.value);
        if (n === null || Number.isNaN(n)) { inp.classList.add('invalide'); return; }
        valeurs.push({ date: inp.dataset.jour, rubrique: inp.dataset.rub, valeur: n });
      }
      try { await api.pointage.enregistrerVariables(this.salarie, this.lundi, { valeurs }); this.app.message('Rubriques enregistrées', 'succes'); this.#rendrePaie(zone, modifiable); } catch (e) { this.app.erreur(e); }
    });
    zone.querySelectorAll('[data-zone-ok]').forEach((b) => b.addEventListener('click', async () => {
      const n = zone.querySelector(`[data-zone="${b.dataset.zoneOk}"]`).value;
      try {
        await api.pointage.enregistrerZones(b.dataset.zoneOk, [{ agence: v.agence, zone: n === '' ? null : Number(n) }]);
        this.app.message('Zone validée', 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    }));
  }
}

/**
 * Export des variables de paie (semaines entières, jours validés par le RH, profils exportés : aperçu, fichier CSV
 * tracé, historique) et valorisation des heures (taux des fiches ou coûts réels importés après la paie).
 */
export class PageExportPointage extends PageBase {
  icone = '📤';

  async ouvrir() {
    this.titre = 'Export de paie et valorisation';
    const lundi = lundiDe(decaler(aujourdhui(), -28));
    const dimanche = decaler(lundiDe(aujourdhui()), -1);
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><h1 class="page-titre">📤 Export de paie et valorisation</h1>
      <p class="ligne">Du <input type="date" data-du value="${lundi}"> au <input type="date" data-au value="${dimanche}"> · <span data-service></span>
        <button type="button" data-apercu>Aperçu</button> <button type="button" data-exporter>📤 Exporter (CSV)</button></p>
      <p class="aide">Semaines entières (du lundi au dimanche). Seuls les salariés dont tous les jours sont validés par le service RH sont exportés ; un salarié dévalidé après un export est signalé.</p>
      <div data-resultat></div>
      <h2>Valorisation des heures</h2>
      <p class="ligne"><label><input type="radio" name="mode" value="SALARIE" checked> Coût horaire des fiches (intérim : taux de la mission)</label>
        <label><input type="radio" name="mode" value="IMPORT"> Coûts réels importés après la paie</label></p>
      <p data-import hidden><textarea data-taux rows="4" cols="50" placeholder="matricule;coût horaire (une ligne par salarié)"></textarea></p>
      <p><button type="button" data-valoriser>Valoriser les pointages de la période</button> <span data-valorisation class="aide"></span></p>
      <h2>Exports précédents</h2><div data-historique></div></div>`;
    const c = this.conteneur;
    if (!this.app.enLigne) { c.querySelector('[data-resultat]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const ref = await api.pointage.referentiels();
    const srv = creerCombo({ options: ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle })), valeur: '', vide: true, titre: 'Service (vide : tous)' });
    c.querySelector('[data-service]').append(srv);
    const demande = () => ({ du: c.querySelector('[data-du]').value, au: c.querySelector('[data-au]').value, service: srv.valeurCombo ? Number(srv.valeurCombo) : null });
    const afficher = (r) => {
      c.querySelector('[data-resultat]').innerHTML = `<p>${r.salaries} salarié(s) exporté(s), ${r.lignes.length} ligne(s)${r.id ? ` · export n° ${r.id} enregistré` : ''}.</p>
        ${r.non_valides.length ? `<p class="avertissement">${r.non_valides.length} salarié(s) avec des jours non validés (non exportés) : ${r.non_valides.slice(0, 20).map((x) => `${echapper(x.salarie.nom)} ${echapper(x.salarie.prenom)} (${x.jours.map(jourCourt).join(', ')})`).join(' ; ')}${r.non_valides.length > 20 ? '…' : ''}</p>` : ''}
        ${r.lignes.length ? `<table><thead><tr><th>Matricule</th><th>Salarié</th><th>Rubrique</th><th>Code paie</th><th>Libellé</th><th class="nombre">Quantité</th></tr></thead><tbody>
          ${r.lignes.slice(0, 300).map((l) => `<tr><td>${echapper(l.matricule)}</td><td>${echapper(l.nom)} ${echapper(l.prenom)}</td><td>${echapper(l.rubrique)}</td><td>${echapper(l.code_paie ?? '')}</td><td>${echapper(l.libelle)}</td><td class="nombre">${l.quantite}</td></tr>`).join('')}</tbody></table>
          ${r.lignes.length > 300 ? '<p class="aide">Aperçu limité à 300 lignes (le fichier contient tout).</p>' : ''}` : ''}`;
    };
    const telecharger = (csv, nom) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
      a.download = nom;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const historique = async () => {
      const l = await api.pointage.exports().catch(() => []);
      c.querySelector('[data-historique]').innerHTML = l.length ? `<table><thead><tr><th>N°</th><th>Période</th><th>Salariés</th><th>Lignes</th><th>Par</th><th>Le</th><th></th></tr></thead><tbody>
        ${l.map((e) => `<tr><td>${e.id}</td><td>${jourCourt(e.du)} – ${jourCourt(e.au)}</td><td class="nombre">${e.salaries}</td><td class="nombre">${e.lignes}</td><td>${echapper(e.par)}</td><td>${horodatage(e.le)}</td>
          <td><a href="/api/pointage/exports/${e.id}/fichier" download>Télécharger</a></td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun export.</p>';
    };
    c.querySelector('[data-apercu]').addEventListener('click', async () => { try { afficher(await api.pointage.apercuExport(demande())); } catch (e) { this.app.erreur(e); } });
    c.querySelector('[data-exporter]').addEventListener('click', async () => {
      if (!confirm('Enregistrer l\'export et télécharger le fichier ?')) return;
      try {
        const r = await api.pointage.exporter(demande());
        afficher(r);
        telecharger(r.csv, `variables-paie-${r.du}-${r.au}.csv`);
        await historique();
      } catch (e) { this.app.erreur(e); }
    });
    c.querySelectorAll('[name="mode"]').forEach((r) => r.addEventListener('change', () => { c.querySelector('[data-import]').hidden = c.querySelector('[name="mode"]:checked').value !== 'IMPORT'; }));
    c.querySelector('[data-valoriser]').addEventListener('click', async () => {
      const mode = c.querySelector('[name="mode"]:checked').value;
      const taux = mode === 'IMPORT' ? c.querySelector('[data-taux]').value.split(/\r?\n/).map((l) => l.split(/[;\t]/)).filter((x) => x.length >= 2 && x[0].trim())
        .map(([m, t]) => ({ matricule: m.trim(), taux: Number(t.trim().replace(',', '.')) })) : null;
      if (taux?.some((t) => Number.isNaN(t.taux))) { this.app.message('Taux illisible dans l\'import', 'erreur'); return; }
      try {
        const r = await api.pointage.valoriser({ ...demande(), mode, taux });
        c.querySelector('[data-valorisation]').textContent = `${r.pointages} pointage(s) valorisé(s) pour ${r.salaries} salarié(s) · ${r.sans_taux} sans taux · coût ${Number(r.cout).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`;
      } catch (e) { this.app.erreur(e); }
    });
    await historique();
  }
}

/** Paramètres du pointage (administrateur) : libellés, pas, amplitudes, validation, sous-types de main-d'œuvre. */
export class PageParametresPointage extends PageBase {
  icone = '⏱';

  async ouvrir() {
    this.titre = 'Paramètres du pointage';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">⏱ Paramètres du pointage</h1><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.app.enLigne) { corps.innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const admin = this.app.estAdmin();
    const ro = admin ? '' : 'disabled';
    let p = await api.pointage.parametres();
    let st = (await api.pointage.sousTypes()).map((x) => ({ ...x, existant: true }));
    const rendre = () => {
      corps.innerHTML = `<h2>Société</h2><table><tbody>
        <tr><td>Libellé des salariés</td><td><label><input type="radio" name="ordre" value="NP" ${p.ordre_nom === 'NP' ? 'checked' : ''} ${ro}> Nom Prénom</label>
          <label><input type="radio" name="ordre" value="PN" ${p.ordre_nom === 'PN' ? 'checked' : ''} ${ro}> Prénom Nom</label></td></tr>
        <tr><td>Pas de saisie (minutes, 0 = libre)</td><td><input type="number" data-pas min="0" max="60" value="${p.pas_minutes}" ${ro}></td></tr>
        <tr><td>Amplitude maximale du jour (heures)</td><td><input type="number" data-jour min="0" max="24" step="0.25" value="${p.amplitude_jour / 60}" ${ro}></td></tr>
        <tr><td>Amplitude maximale de la semaine (heures)</td><td><input type="number" data-semaine min="0" max="168" step="0.25" value="${p.amplitude_semaine / 60}" ${ro}></td></tr>
        <tr><td>Seuil des heures supplémentaires (heures par semaine)</td><td><input type="number" data-seuil min="0" max="168" step="0.25" value="${p.seuil_semaine / 60}" ${ro}></td></tr>
        <tr><td>Validation</td><td><label><input type="radio" name="validation" value="SIMPLE" ${p.validation === 'SIMPLE' ? 'checked' : ''} ${ro}> Simple (RH)</label>
          <label><input type="radio" name="validation" value="DOUBLE" ${p.validation === 'DOUBLE' ? 'checked' : ''} ${ro}> Double (chef de service puis RH)</label></td></tr>
        <tr><td>Blocage à la validation</td><td><label><input type="radio" name="blocage" value="JOUR" ${p.blocage === 'JOUR' ? 'checked' : ''} ${ro}> À la journée</label>
          <label><input type="radio" name="blocage" value="SEMAINE" ${p.blocage === 'SEMAINE' ? 'checked' : ''} ${ro}> À la semaine</label></td></tr>
        <tr><td>Intérimaires</td><td><label><input type="checkbox" data-interim ${p.interim_imputes ? 'checked' : ''} ${ro}> Heures imputées aux chantiers avec un coût</label></td></tr>
        </tbody></table>
        <h2>Sous-types de main-d'œuvre</h2><p class="aide">Le type de main-d'œuvre est une nature du regroupement Main-d'œuvre (bibliothèque) ; le sous-type précise l'activité.</p>
        <table><thead><tr><th>Code</th><th>Libellé</th><th>Productif</th><th>Non-conformité (motif)</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
        ${st.map((x, i) => `<tr data-i="${i}"><td><input data-code size="14" value="${echapper(x.code)}" ${admin && !x.existant ? '' : 'readonly'}></td><td><input data-libelle size="28" value="${echapper(x.libelle)}" ${ro}></td>
          <td><input type="checkbox" data-productif ${x.productif ? 'checked' : ''} ${ro}></td><td><input type="checkbox" data-nc ${x.non_conformite ? 'checked' : ''} ${ro}></td>
          <td><input type="number" data-ordre size="4" value="${x.ordre}" ${ro}></td><td><input type="checkbox" data-actif ${x.actif ? 'checked' : ''} ${ro}></td>
          <td>${admin ? '<button type="button" data-retirer>✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
        ${admin ? '<p><button type="button" data-ajouter>＋ Sous-type</button> <button type="button" data-enregistrer>Enregistrer</button></p>' : ''}
        <h2>Profils de paie</h2><div data-profils></div>`;
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        const x = st[Number(tr.dataset.i)];
        tr.querySelector('[data-code]').addEventListener('change', (e) => { x.code = e.target.value.trim().toUpperCase(); });
        tr.querySelector('[data-libelle]').addEventListener('change', (e) => { x.libelle = e.target.value; });
        tr.querySelector('[data-productif]').addEventListener('change', (e) => { x.productif = e.target.checked; });
        tr.querySelector('[data-nc]').addEventListener('change', (e) => { x.non_conformite = e.target.checked; });
        tr.querySelector('[data-ordre]').addEventListener('change', (e) => { x.ordre = Number(e.target.value) || 0; });
        tr.querySelector('[data-actif]').addEventListener('change', (e) => { x.actif = e.target.checked; });
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { st.splice(st.indexOf(x), 1); rendre(); });
      });
      corps.querySelector('[data-ajouter]')?.addEventListener('click', () => { st.push({ code: '', libelle: '', productif: true, non_conformite: false, ordre: (st.length + 1) * 10, actif: true }); rendre(); });
      corps.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        const v = (sel) => corps.querySelector(sel);
        const heures = (sel) => Math.round(Number(v(sel).value) * 60);
        const saisie = {
          ordre_nom: v('[name="ordre"]:checked').value, pas_minutes: Number(v('[data-pas]').value), amplitude_jour: heures('[data-jour]'),
          amplitude_semaine: heures('[data-semaine]'), seuil_semaine: heures('[data-seuil]'), validation: v('[name="validation"]:checked').value,
          blocage: v('[name="blocage"]:checked').value, interim_imputes: v('[data-interim]').checked,
        };
        try {
          p = await api.pointage.enregistrerParametres(saisie);
          st = (await api.pointage.enregistrerSousTypes(st)).map((x) => ({ ...x, existant: true }));
          rendre();
          this.app.message('Paramètres enregistrés', 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
    this.#profils(admin);
  }

  /**
   * Profils de paie : rubriques (code, libellé, unité, saisie, code de paie) et règles typées (paramètres en JSON :
   * voir TYPES_REGLE de paie.js) ; contrôle `controlerProfil` avant l'envoi.
   */
  async #profils(admin) {
    const zone = this.conteneur.querySelector('[data-profils]');
    let profils = await api.pointage.profils();
    let courant = profils[0] ?? null;
    const ro = admin ? '' : 'disabled';
    const options = (o) => Object.entries(o).map(([valeur, libelle]) => ({ valeur, libelle, detail: valeur }));
    /** Combos des colonnes à liste fermée (unité, saisie, type de règle). */
    const combos = (tr, objet, colonnes) => {
      for (const [cle, liste] of colonnes) {
        const c = creerCombo({ options: options(liste), valeur: objet[cle], vide: false });
        c.readOnly = !admin;
        c.addEventListener('change', () => { objet[cle] = c.valeurCombo; });
        tr.querySelector(`[data-c="${cle}"]`).append(c);
      }
    };
    const rendre = () => {
      zone.innerHTML = `<p class="ligne">${profils.map((x, i) => `<button type="button" data-p="${i}" class="${x === courant ? 'actif' : ''}">${echapper(x.libelle || x.code || '(nouveau)')}${x.actif ? '' : ' (inactif)'}</button>`).join(' ')}
        ${admin ? '<button type="button" data-nouveau>＋ Profil</button>' : ''}</p>
        ${courant ? `<p class="ligne"><label>Code <input data-code size="10" value="${echapper(courant.code)}" ${admin && !courant.id ? '' : 'readonly'}></label>
          <label>Libellé <input data-libelle size="36" value="${echapper(courant.libelle)}" ${ro}></label>
          <label><input type="checkbox" data-export ${courant.export ? 'checked' : ''} ${ro}> Exporté vers la paie</label>
          <label><input type="checkbox" data-actif ${courant.actif ? 'checked' : ''} ${ro}> Actif</label></p>
          <h3>Rubriques</h3><table><thead><tr><th>Code</th><th>Libellé</th><th>Unité</th><th>Saisie</th><th>Code paie</th><th>Ordre</th><th></th></tr></thead><tbody>
          ${courant.rubriques.map((r, i) => `<tr data-r="${i}"><td><input data-f="code" size="8" value="${echapper(r.code)}" ${ro}></td><td><input data-f="libelle" size="28" value="${echapper(r.libelle)}" ${ro}></td>
            <td data-c="unite"></td><td data-c="saisie"></td>
            <td><input data-f="code_paie" size="8" value="${echapper(r.code_paie ?? '')}" ${ro}></td><td><input data-f="ordre" type="number" size="3" value="${r.ordre}" ${ro}></td>
            <td>${admin ? '<button type="button" data-retirer-r>✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
          ${admin ? '<p><button type="button" data-ajouter-r>＋ Rubrique</button></p>' : ''}
          <h3>Règles (dans l'ordre)</h3><table><thead><tr><th>Type</th><th>Rubrique</th><th>Paramètres (JSON)</th><th>Ordre</th><th>Active</th><th></th></tr></thead><tbody>
          ${courant.regles.map((r, i) => `<tr data-g="${i}"><td data-c="type"></td><td><input data-f="rubrique" size="8" value="${echapper(r.rubrique ?? '')}" ${ro}></td>
            <td><input data-f="parametres" size="60" value="${echapper(JSON.stringify(r.parametres ?? {}))}" ${ro}></td><td><input data-f="ordre" type="number" size="3" value="${r.ordre}" ${ro}></td>
            <td><input type="checkbox" data-f="actif" ${r.actif ? 'checked' : ''} ${ro}></td><td>${admin ? '<button type="button" data-retirer-g>✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
          ${admin ? '<p><button type="button" data-ajouter-g>＋ Règle</button> <button type="button" data-enregistrer-p>Enregistrer les profils</button></p>' : ''}
          <p class="aide">Paramètres : CUMUL_HEURES { sous_types, exclure } · SEUIL_JOUR { base, seuil (minutes), valeur, exclu_si } · TRANCHES_SEMAINE { base, seuil, deduire, tranches [{ rubrique, jusqu_a }] } · ZONE { exclu_si } · PLAFOND { max, max_semaine }.</p>` : ''}`;
      zone.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { courant = profils[Number(b.dataset.p)]; rendre(); }));
      zone.querySelector('[data-nouveau]')?.addEventListener('click', () => {
        profils.push(courant = { id: null, code: '', libelle: '', export: true, ordre: (profils.length + 1) * 10, actif: true, rubriques: [], regles: [] }); rendre();
      });
      zone.querySelectorAll('tr[data-r]').forEach((tr) => combos(tr, courant.rubriques[Number(tr.dataset.r)], [['unite', UNITES_RUBRIQUE], ['saisie', SAISIES_RUBRIQUE]]));
      zone.querySelectorAll('tr[data-g]').forEach((tr) => combos(tr, courant.regles[Number(tr.dataset.g)], [['type', TYPES_REGLE]]));
      if (!courant || !admin) return;
      zone.querySelector('[data-code]').addEventListener('change', (e) => { courant.code = e.target.value.trim().toUpperCase(); });
      zone.querySelector('[data-libelle]').addEventListener('change', (e) => { courant.libelle = e.target.value; });
      zone.querySelector('[data-export]').addEventListener('change', (e) => { courant.export = e.target.checked; });
      zone.querySelector('[data-actif]').addEventListener('change', (e) => { courant.actif = e.target.checked; });
      const lier = (tr, objet) => tr.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => {
        const f = el.dataset.f;
        if (f === 'actif') objet[f] = el.checked;
        else if (f === 'ordre') objet[f] = Number(el.value) || 0;
        else if (f === 'parametres') {
          try { objet[f] = JSON.parse(el.value || '{}'); el.classList.remove('invalide'); } catch { el.classList.add('invalide'); }
        } else if (f === 'code' || f === 'rubrique') objet[f] = el.value.trim().toUpperCase() || null;
        else objet[f] = el.value;
      }));
      zone.querySelectorAll('tr[data-r]').forEach((tr) => {
        const r = courant.rubriques[Number(tr.dataset.r)];
        lier(tr, r);
        tr.querySelector('[data-retirer-r]').addEventListener('click', () => { courant.rubriques.splice(courant.rubriques.indexOf(r), 1); rendre(); });
      });
      zone.querySelectorAll('tr[data-g]').forEach((tr) => {
        const g = courant.regles[Number(tr.dataset.g)];
        lier(tr, g);
        tr.querySelector('[data-retirer-g]').addEventListener('click', () => { courant.regles.splice(courant.regles.indexOf(g), 1); rendre(); });
      });
      zone.querySelector('[data-ajouter-r]').addEventListener('click', () => { courant.rubriques.push({ code: '', libelle: '', unite: 'H', saisie: 'C', code_paie: null, ordre: (courant.rubriques.length + 1) * 10 }); rendre(); });
      zone.querySelector('[data-ajouter-g]').addEventListener('click', () => { courant.regles.push({ type: 'CUMUL_HEURES', rubrique: null, parametres: {}, ordre: (courant.regles.length + 1) * 10, actif: true }); rendre(); });
      zone.querySelector('[data-enregistrer-p]').addEventListener('click', async () => {
        if (zone.querySelector('.invalide')) { this.app.message('Paramètres JSON illisibles', 'erreur'); return; }
        for (const x of profils) {
          const e = controlerProfil(x);
          if (e.length) { this.app.message(`Profil ${x.code} : ${e.map((c) => MESSAGES_PAIE[c]).join(', ')}`, 'erreur'); return; }
        }
        try {
          profils = await api.pointage.enregistrerProfils(profils);
          courant = profils.find((x) => x.code === courant.code) ?? profils[0] ?? null;
          rendre();
          this.app.message('Profils enregistrés', 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }
}
