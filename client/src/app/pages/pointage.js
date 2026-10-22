import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { controlerSemaine, MESSAGES_POINTAGE, lundiDe, joursSemaine, lireDuree, ecrireDuree } from '@logibtp/pointage';
import { api } from '../api.js';

// Module Pointage, lot 1 : saisie au bureau (grille hebdomadaire d'un salarié : une ligne par chantier, ordre, type et
// sous-type de main-d'œuvre, une colonne par jour) et paramètres (pas, amplitudes, validation, sous-types). Contrôles
// répliqués (controles.js ↔ ReglesPointage.cs) : erreurs refusées par le serveur, avertissements signalés.

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const decaler = (date, jours) => new Date(new Date(`${date}T00:00:00Z`).getTime() + jours * 86400000).toISOString().slice(0, 10);
const jourCourt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const nomSalarie = (s, ordre) => (ordre === 'PN' ? `${s.prenom} ${s.nom}` : `${s.nom} ${s.prenom}`);
const cleLigne = (p) => [p.cha_id, p.ent_id ?? '', p.type_mo, p.sous_type ?? '', p.motif ?? ''].join('|');

/**
 * Lignes de la grille depuis les pointages : regroupement par chantier, ordre, type, sous-type et motif ; une case =
 * un pointage (plusieurs pointages le même jour sur la même ligne : case en lecture seule, valeurs gardées).
 */
function lignesDepuis(pointages, jours) {
  const lignes = new Map();
  for (const p of pointages) {
    const k = cleLigne(p);
    if (!lignes.has(k)) lignes.set(k, { cha_id: p.cha_id, ent_id: p.ent_id, type_mo: p.type_mo, sous_type: p.sous_type, motif: p.motif, cases: jours.map(() => []) });
    lignes.get(k).cases[jours.indexOf(p.date)].push(p);
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
          id: p.id ?? null, date: jours[i], cha_id: l.cha_id ?? null, ent_id: l.ent_id ?? null, type_mo: l.type_mo ?? null, sous_type: l.sous_type || null,
          minutes: p.minutes, debut: plage ? p.debut : null, fin: plage ? p.fin : null, motif: l.motif || null, commentaire: p.commentaire ?? null,
        });
      }
    });
  }
  return r;
}

/** Saisie hebdomadaire au bureau : salariés du service avec leurs totaux, grille de la semaine du salarié choisi. */
export class PageSaisiePointage extends PageBase {
  icone = '⏱';
  #modifie = false;

  get modifiee() { return this.#modifie; }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ lundi: this.lundi, service: this.service, salarie: this.salarie }).filter(([, v]) => v));
    return `/pointage/saisie?${p}`;
  }

  async ouvrir() {
    this.titre = 'Saisie des pointages';
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><h1 class="page-titre">⏱ Saisie des pointages</h1>
      <p class="ligne"><button type="button" data-prec title="Semaine précédente">◀</button> <input type="date" data-date>
        <button type="button" data-suiv title="Semaine suivante">▶</button> <span data-semaine class="aide"></span>
        · <span data-service></span> <input type="search" data-recherche placeholder="Salarié, matricule…"></p>
      <div class="pointage-corps"><div data-salaries class="pointage-salaries"></div><div data-grille class="pointage-grille"></div></div></div>`;
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
    const services = this.ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle, detail: s.code }));
    const srv = creerCombo({ options: services, valeur: this.service, vide: true, titre: 'Service' });
    this.conteneur.querySelector('[data-service]').append(srv);
    srv.addEventListener('change', () => { this.service = srv.valeurCombo; this.#url(); this.#chargerSalaries(); });
    const date = this.conteneur.querySelector('[data-date]');
    const changerSemaine = async (lundi) => {
      if (this.#modifie && !confirm('Abandonner les modifications de la semaine ?')) { date.value = this.lundi; return; }
      this.lundi = lundi; this.#url(); await this.#chargerSalaries(); if (this.salarie) await this.#chargerSemaine();
    };
    date.value = this.lundi;
    date.addEventListener('change', () => date.value && changerSemaine(lundiDe(date.value)));
    this.conteneur.querySelector('[data-prec]').addEventListener('click', () => { date.value = decaler(this.lundi, -7); changerSemaine(date.value); });
    this.conteneur.querySelector('[data-suiv]').addEventListener('click', () => { date.value = decaler(this.lundi, 7); changerSemaine(date.value); });
    this.conteneur.querySelector('[data-recherche]').addEventListener('change', (e) => { this.recherche = e.target.value; this.#chargerSalaries(); });
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
      if (this.#modifie && !confirm('Abandonner les modifications de la semaine ?')) return;
      this.salarie = tr.dataset.id; this.#url();
      zone.querySelectorAll('tr.selection').forEach((x) => x.classList.remove('selection'));
      tr.classList.add('selection');
      await this.#chargerSemaine();
    }));
  }

  async #chargerSemaine() {
    try { this.semaine = await api.pointage.semaine(this.salarie, this.lundi); } catch (e) { this.app.erreur(e); return; }
    const jours = joursSemaine(this.lundi);
    for (const p of this.semaine.pointages) p.minutes_origine = p.minutes;
    this.lignes = lignesDepuis(this.semaine.pointages, jours);
    this.#modifie = false;
    this.#rendreGrille();
  }

  #options() {
    const chantiers = new Map([...this.chantiers, ...this.semaine.chantiers].map((c) => [c.id, c]));
    const recents = new Set(this.semaine.recents);
    return {
      chantiers: [...chantiers.values()].sort((a, b) => Number(recents.has(b.id)) - Number(recents.has(a.id)))
        .map((c) => ({ valeur: c.id, libelle: `${c.code} ${c.libelle}`, detail: c.interne ? 'interne' : recents.has(c.id) ? 'récent' : c.clos ? 'clos' : '' })),
      clos: new Set([...chantiers.values()].filter((c) => c.clos).map((c) => c.id)),
      types: this.ref.types_mo.map((t) => ({ valeur: t.id, libelle: t.libelle, detail: t.code })),
      sousTypes: this.ref.sous_types.map((s) => ({ valeur: s.code, libelle: s.libelle })),
      nc: new Set(this.ref.sous_types.filter((s) => s.non_conformite).map((s) => s.code)),
    };
  }

  #controles(o) {
    const jours = joursSemaine(this.lundi);
    const pointages = [];
    this.lignes.forEach((l, i) => l.cases.forEach((c, j) => c.forEach((p, k) => {
      if (p.minutes) {
        pointages.push({ cle: `${i}:${j}:${k}`, date: jours[j], cha_id: l.cha_id ?? null, type_mo: l.type_mo ?? null, minutes: p.minutes,
          debut: p.debut != null && p.minutes === p.minutes_origine ? p.debut : null, fin: p.fin != null && p.minutes === p.minutes_origine ? p.fin : null,
          non_conformite: o.nc.has(l.sous_type), motif: l.motif, chantier_clos: o.clos.has(l.cha_id) });
      }
    })));
    return controlerSemaine({ parametres: this.ref.parametres, pointages });
  }

  #rendreGrille() {
    const zone = this.conteneur.querySelector('[data-grille]');
    const s = this.semaine;
    const jours = joursSemaine(this.lundi);
    const o = this.#options();
    const pas = this.ref.parametres.pas_minutes;
    zone.innerHTML = `<h2>${echapper(nomSalarie(s.salarie, this.ref.parametres.ordre_nom))} <small class="aide">${echapper(s.salarie.matricule)}${s.salarie.service ? ` · ${echapper(s.salarie.service)}` : ''}</small></h2>
      ${s.avec_validation ? '<p class="avertissement">Des pointages de cette semaine ont été repris dans la synthèse : les corrections du service RH priment.</p>' : ''}
      <table class="grille-pointage"><thead><tr><th>Chantier</th><th>Ordre</th><th>Type de MO</th><th>Sous-type</th><th>Motif</th>
        ${jours.map((d, i) => `<th class="nombre">${JOURS[i]} ${jourCourt(d)}</th>`).join('')}<th class="nombre">Total</th><th></th></tr></thead><tbody></tbody>
        <tfoot><tr><th colspan="5">Total</th>${jours.map((_, i) => `<th class="nombre" data-total="${i}"></th>`).join('')}<th class="nombre" data-total="s"></th><th></th></tr></tfoot></table>
      <p><button type="button" data-ajouter>＋ Ligne</button> <button type="button" data-enregistrer>Enregistrer la semaine</button>
        <span class="aide">Durées au pas de ${pas} min : « 7:30 », « 7h30 » ou « 7,5 ».</span></p>
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
    const changer = () => { this.#modifie = true; majTotaux(); };
    const rendreLignes = () => {
      corps.innerHTML = this.lignes.map((l, i) => `<tr data-i="${i}"><td data-c="cha"></td><td data-c="ordre"></td><td data-c="type"></td><td data-c="st"></td>
        <td><input data-motif size="14" value="${echapper(l.motif ?? '')}" ${o.nc.has(l.sous_type) ? '' : 'disabled'}></td>
        ${l.cases.map((c, j) => `<td data-j="${j}"><input class="duree" size="5" value="${ecrireDuree(c.reduce((a, p) => a + (p.minutes || 0), 0))}" ${c.length > 1 ? 'readonly title="Plusieurs pointages ce jour : modifier depuis la synthèse"' : c[0]?.debut != null ? `title="${ecrireDuree(c[0].debut)} – ${ecrireDuree(c[0].fin)}"` : ''}></td>`).join('')}
        <td class="nombre" data-total-ligne></td><td><button type="button" data-retirer title="Retirer la ligne">✕</button></td></tr>`).join('');
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        const l = this.lignes[Number(tr.dataset.i)];
        const ordres = s.ordres.filter((x) => x.cha_id === l.cha_id).map((x) => ({ valeur: x.id, libelle: x.numero ?? `#${x.id}`, detail: x.objet ?? x.type }));
        const combos = {
          cha: creerCombo({ options: o.chantiers, valeur: l.cha_id ?? '', vide: false, titre: 'Chantier' }),
          ordre: creerCombo({ options: ordres, valeur: l.ent_id ?? '', vide: true, titre: 'Ordre (facultatif)' }),
          type: creerCombo({ options: o.types, valeur: l.type_mo ?? '', vide: false, titre: 'Type de main-d\'œuvre' }),
          st: creerCombo({ options: o.sousTypes, valeur: l.sous_type ?? '', vide: true, titre: 'Sous-type' }),
        };
        for (const [k, c] of Object.entries(combos)) tr.querySelector(`[data-c="${k}"]`).append(c);
        combos.cha.addEventListener('change', () => { l.cha_id = combos.cha.valeurCombo ? Number(combos.cha.valeurCombo) : null; l.ent_id = null; this.#modifie = true; rendreLignes(); });
        combos.ordre.addEventListener('change', () => { l.ent_id = combos.ordre.valeurCombo ? Number(combos.ordre.valeurCombo) : null; changer(); });
        combos.type.addEventListener('change', () => { l.type_mo = combos.type.valeurCombo ? Number(combos.type.valeurCombo) : null; changer(); });
        combos.st.addEventListener('change', () => {
          l.sous_type = combos.st.valeurCombo || null;
          tr.querySelector('[data-motif]').disabled = !o.nc.has(l.sous_type);
          changer();
        });
        tr.querySelector('[data-motif]').addEventListener('change', (e) => { l.motif = e.target.value.trim() || null; changer(); });
        tr.querySelectorAll('td[data-j] input').forEach((inp) => inp.addEventListener('change', () => {
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
        tr.querySelector('[data-retirer]').addEventListener('click', () => { this.lignes.splice(this.lignes.indexOf(l), 1); this.#modifie = true; rendreLignes(); });
      });
      majTotaux();
    };
    zone.querySelector('[data-ajouter]').addEventListener('click', () => {
      const prec = this.lignes.at(-1);
      const typeService = this.ref.types_mo.find((t) => t.srv_id === s.salarie.srv_id)?.id;
      this.lignes.push({ cha_id: prec?.cha_id ?? s.recents[0] ?? null, ent_id: null, type_mo: prec?.type_mo ?? typeService ?? null, sous_type: 'PRODUCTION', motif: null, cases: jours.map(() => []) });
      this.#modifie = true;
      rendreLignes();
    });
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.semaine = await api.pointage.enregistrerSemaine(this.salarie, this.lundi, { pointages: pointagesDepuis(this.lignes, jours) });
        for (const p of this.semaine.pointages) p.minutes_origine = p.minutes;
        this.lignes = lignesDepuis(this.semaine.pointages, jours);
        this.#modifie = false;
        this.#rendreGrille();
        this.app.message('Semaine enregistrée', 'succes');
        this.#chargerSalaries();
      } catch (e) { this.app.erreur(e); }
    });
    rendreLignes();
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
    let st = await api.pointage.sousTypes();
    const rendre = () => {
      corps.innerHTML = `<h2>Société</h2><table><tbody>
        <tr><td>Libellé des salariés</td><td><label><input type="radio" name="ordre" value="NP" ${p.ordre_nom === 'NP' ? 'checked' : ''} ${ro}> Nom Prénom</label>
          <label><input type="radio" name="ordre" value="PN" ${p.ordre_nom === 'PN' ? 'checked' : ''} ${ro}> Prénom Nom</label></td></tr>
        <tr><td>Pas de saisie (minutes, 0 = libre)</td><td><input type="number" data-pas min="0" max="60" value="${p.pas_minutes}" ${ro}></td></tr>
        <tr><td>Amplitude maximale du jour (heures)</td><td><input type="number" data-jour min="0" max="24" step="0.25" value="${p.amplitude_jour / 60}" ${ro}></td></tr>
        <tr><td>Amplitude maximale de la semaine (heures)</td><td><input type="number" data-semaine min="0" max="168" step="0.25" value="${p.amplitude_semaine / 60}" ${ro}></td></tr>
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
        const saisie = {
          ordre_nom: v('[name="ordre"]:checked').value, pas_minutes: Number(v('[data-pas]').value), amplitude_jour: Math.round(Number(v('[data-jour]').value) * 60),
          amplitude_semaine: Math.round(Number(v('[data-semaine]').value) * 60), validation: v('[name="validation"]:checked').value,
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
    st = st.map((x) => ({ ...x, existant: true }));
    rendre();
  }
}
