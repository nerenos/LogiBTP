import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import {
  controlerSemaine, MESSAGES_POINTAGE, lundiDe, joursSemaine, lireDuree, ecrireDuree,
  ETATS_VALIDATION, MESSAGES_VALIDATION, estBloque,
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
        ${admin ? '<p><button type="button" data-ajouter>＋ Sous-type</button> <button type="button" data-enregistrer>Enregistrer</button></p>' : ''}`;
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
  }
}
