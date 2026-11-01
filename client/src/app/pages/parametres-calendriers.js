import { texte, texteHtml, textesParCode, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import {
  JOURS_SEMAINE, REGLES_FERME, MESSAGES_CALENDRIER, controlerCalendrier, controlerRegle, lirePlages, ecrirePlages, duree, joursFermes, ajouterJours,
} from '@logibtp/calendrier';
import { api } from '../api.js';

const ZONES = textesParCode('calendrier_btp.zones', ['NATIONAL', 'ALSACE_MOSELLE', 'MARTINIQUE', 'GUADELOUPE', 'GUYANE', 'REUNION', 'MAYOTTE', 'SAINT_MARTIN', 'SAINT_BARTHELEMY']);
const OPTIONS_REGLES = Object.entries(REGLES_FERME).map(([valeur, libelle]) => ({ valeur, libelle }));
const OPTIONS_JOURS = JOURS_SEMAINE.map((libelle, i) => ({ valeur: i + 1, libelle }));
const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const messages = (codes) => codes.map((c) => MESSAGES_CALENDRIER[c] ?? c).join(' · ');
const entier = (v) => (String(v ?? '').trim() === '' ? null : Number(v));

/** Résumé d'une règle de jour fermé (« 1er mai », « Pâques + 39 j »…). */
function resume(r) {
  switch (r.regle) {
    case 'DATE': return jour(r.date);
    case 'ANNUEL': return texte('calendrier_btp.resume.annuel', { jour: r.jour, mois: String(r.mois).padStart(2, '0') });
    case 'NIEME': return r.rang === 1 ? texte('calendrier_btp.resume.nieme_premier', { jour: (JOURS_SEMAINE[r.jour - 1] ?? '?').toLowerCase(), mois: r.mois }) : texte('calendrier_btp.resume.nieme', { rang: r.rang, jour: (JOURS_SEMAINE[r.jour - 1] ?? '?').toLowerCase(), mois: r.mois });
    case 'DERNIER': return texte('calendrier_btp.resume.dernier', { jour: (JOURS_SEMAINE[r.jour - 1] ?? '?').toLowerCase(), mois: r.mois });
    case 'PAQUES': return texte('calendrier_btp.resume.paques', { signe: r.decalage >= 0 ? '+' : '−', jours: Math.abs(r.decalage ?? 0) });
    case 'PERIODE': return texte('calendrier_btp.resume.periode', { du: jour(r.du), au: jour(r.au) });
    default: return '';
  }
}

/**
 * Calendriers de travail (module Calendrier ; Planning P12, P13, P22) : plages par jour et semaine du cycle, plages
 * datées (horaires d'été), calendrier par défaut ; jours fériés de la société (catalogue français à cocher, règles
 * saisies) ; calendrier et fermetures de chaque service ; aperçu des journées. Administrateur.
 */
export class PageParametresCalendriers extends PageBase {
  icone = icone('calendrier_btp_calendrier');

  get modifiee() { return Boolean(this.edition?.modifiee); }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('calendrier_btp.routes.calendriers');
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('calendrier_btp_calendrier')} ${texteHtml('calendrier_btp.routes.calendriers')}</h1>
      <section class="carte" data-liste></section><section class="carte" data-edition hidden></section>
      <section class="carte" data-feries></section><section class="carte" data-services></section></div>`;
    this.admin = app.estAdmin();
    await this.#rendreListe();
    await Promise.all([this.#rendreFeries(), this.#rendreServices()]);
  }

  async #rendreListe() {
    this.calendriers = await api.calendriers.liste();
    const zone = this.conteneur.querySelector('[data-liste]');
    const hebdo = (c) => Array.from({ length: c.cycle_semaines }, (_, s) => duree(c.plages.filter((p) => p.semaine === s + 1 && !p.du && !p.au).reduce((t, p) => t + p.fin - p.debut, 0))).join(' / ');
    zone.innerHTML = `<h2>${texteHtml('calendrier_btp.liste.titre')}</h2>
      <p class="aide">${texteHtml('calendrier_btp.liste.aide')}</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('calendrier_btp.liste.cycle')}</th><th>${texteHtml('calendrier_btp.liste.heures')}</th><th>${texteHtml('calendrier_btp.liste.defaut')}</th><th>${texteHtml('calendrier_btp.liste.actif')}</th><th class="nombre">${texteHtml('calendrier_btp.liste.utilise')}</th><th></th></tr></thead><tbody>
      ${this.calendriers.map((c, i) => `<tr><td><b>${echapper(c.code)}</b></td><td>${echapper(c.libelle)}</td><td>${c.cycle_semaines > 1 ? texteHtml('calendrier_btp.liste.semaines', { nombre: c.cycle_semaines }) : texteHtml('calendrier_btp.liste.hebdomadaire')}</td>
        <td>${hebdo(c)}</td><td>${c.defaut ? iconeHtml('calendrier_btp_defaut') : ''}</td><td>${c.actif ? iconeHtml('calendrier_btp_actif') : ''}</td><td class="nombre">${c.utilisations || ''}</td>
        <td><button type="button" data-i="${i}">${this.admin ? texteHtml('calendrier_btp.liste.modifier') : texteHtml('calendrier_btp.liste.voir')}</button></td></tr>`).join('')}</tbody></table>
      ${this.admin ? `<p><button type="button" data-nouveau>${iconeHtml('ajouter')} ${texteHtml('calendrier_btp.liste.calendrier')}</button></p>` : ''}`;
    zone.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => this.#editer(structuredClone(this.calendriers[Number(b.dataset.i)]))));
    zone.querySelector('[data-nouveau]')?.addEventListener('click', () => this.#editer({
      id: null, code: '', libelle: '', cycle_semaines: 1, reference: null, defaut: false, actif: true,
      plages: structuredClone(this.calendriers.find((c) => c.defaut)?.plages.filter((p) => !p.du && !p.au && p.semaine === 1) ?? []),
    }));
  }

  /** Édition d'un calendrier : grille jours × semaines du cycle, plages datées, aperçu. */
  #editer(cal) {
    const zone = this.conteneur.querySelector('[data-edition]');
    zone.hidden = false;
    this.edition = { cal, modifiee: false };
    const dis = this.admin ? '' : 'disabled';
    const permanentes = (s, j) => cal.plages.filter((p) => p.semaine === s && p.jour === j && !p.du && !p.au);
    const datees = () => cal.plages.filter((p) => p.du || p.au);
    const groupesDates = () => {
      const g = new Map();
      for (const p of datees()) {
        const cle = `${p.du ?? ''}|${p.au ?? ''}|${p.semaine}|${p.jour}`;
        g.set(cle, [...(g.get(cle) ?? []), p]);
      }
      return [...g.entries()].map(([cle, plages]) => { const [du, au, semaine, j] = cle.split('|'); return { du: du || null, au: au || null, semaine: Number(semaine), jour: Number(j), plages }; });
    };
    const rendre = () => {
      const semaines = Array.from({ length: cal.cycle_semaines }, (_, i) => i + 1);
      zone.innerHTML = `<h2>${cal.id ? texteHtml('calendrier_btp.edition.titre', { code: cal.code }) : texteHtml('calendrier_btp.edition.nouveau')}</h2>
        <p class="ligne"><label>${texteHtml('commun.code')} <input data-c="code" value="${echapper(cal.code)}" size="14" maxlength="20" ${dis}></label>
          <label>${texteHtml('commun.libelle')} <input data-c="libelle" value="${echapper(cal.libelle)}" size="36" maxlength="80" ${dis}></label>
          <label>${texteHtml('calendrier_btp.edition.cycle')} <input data-c="cycle_semaines" value="${cal.cycle_semaines}" size="3" inputmode="numeric" ${dis}></label>
          <label>${texteHtml('calendrier_btp.edition.reference')} <input type="date" data-c="reference" value="${echapper(cal.reference ?? '')}" ${dis}></label>
          <label class="ligne"><input type="checkbox" data-c="defaut" ${cal.defaut ? 'checked' : ''} ${dis}> ${texteHtml('calendrier_btp.edition.par_defaut')}</label>
          <label class="ligne"><input type="checkbox" data-c="actif" ${cal.actif ? 'checked' : ''} ${dis}> ${texteHtml('calendrier_btp.liste.actif')}</label></p>
        <p class="aide">${texteHtml('calendrier_btp.edition.aide')}</p>
        <table class="grille-calendrier tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('calendrier_btp.edition.jour')}</th>${semaines.map((s) => `<th>${cal.cycle_semaines > 1 ? texteHtml('calendrier_btp.edition.semaine', { numero: s }) : texteHtml('calendrier_btp.edition.plages')}</th>`).join('')}</tr></thead><tbody>
        ${JOURS_SEMAINE.map((nom, j) => `<tr><th>${nom}</th>${semaines.map((s) => {
          const p = permanentes(s, j + 1);
          return `<td><input data-plage="${s}:${j + 1}" value="${echapper(ecrirePlages(p))}" size="22" ${dis}> <small class="aide">${p.length ? duree(p.reduce((t, x) => t + x.fin - x.debut, 0)) : ''}</small></td>`;
        }).join('')}</tr>`).join('')}
        <tr><th>${texteHtml('commun.total')}</th>${semaines.map((s) => `<td><b>${duree(cal.plages.filter((p) => p.semaine === s && !p.du && !p.au).reduce((t, x) => t + x.fin - x.debut, 0))}</b></td>`).join('')}</tr></tbody></table>
        <h3>${texteHtml('calendrier_btp.edition.datees')}</h3><p class="aide">${texteHtml('calendrier_btp.edition.datees_aide')}</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('calendrier_btp.edition.du')}</th><th>${texteHtml('calendrier_btp.edition.au')}</th><th>${texteHtml('calendrier_btp.edition.semaine_col')}</th><th>${texteHtml('calendrier_btp.edition.jour')}</th><th>${texteHtml('calendrier_btp.edition.plages')}</th><th></th></tr></thead><tbody>
        ${groupesDates().map((g, i) => `<tr data-d="${i}"><td><input type="date" data-dc="du" value="${echapper(g.du ?? '')}" ${dis}></td><td><input type="date" data-dc="au" value="${echapper(g.au ?? '')}" ${dis}></td>
          <td><input data-dc="semaine" value="${g.semaine}" size="2" ${dis}></td><td data-jour></td><td><input data-dc="plages" value="${echapper(ecrirePlages(g.plages))}" size="22" ${dis}></td>
          <td>${this.admin ? `<button type="button" data-retirer-date title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table>
        ${this.admin ? `<p><button type="button" data-ajouter-date>${iconeHtml('ajouter')} ${texteHtml('calendrier_btp.edition.datees')}</button></p>` : ''}
        <p class="connexion-erreur" data-erreur hidden></p>
        <p>${this.admin ? `<button type="button" class="principal" data-enregistrer>${texteHtml('calendrier_btp.edition.enregistrer')}</button>
          ${cal.id && !cal.defaut ? `<button type="button" data-supprimer class="danger">${texteHtml('commun.supprimer')}</button>` : ''}` : ''} <button type="button" data-fermer>${texteHtml('commun.fermer')}</button></p>
        <h3>${texteHtml('calendrier_btp.edition.apercu')}</h3><div data-apercu><p class="aide">${cal.id ? texteHtml('calendrier_btp.edition.chargement') : texteHtml('calendrier_btp.edition.enregistrer_dabord')}</p></div>`;
      const erreur = zone.querySelector('[data-erreur]');
      const marquer = () => { this.edition.modifiee = true; };
      zone.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        const k = c.dataset.c;
        cal[k] = c.type === 'checkbox' ? c.checked : k === 'cycle_semaines' ? Math.max(1, Number(c.value) || 1) : (c.value || null);
        marquer();
        if (k === 'cycle_semaines') rendre();
      }));
      zone.querySelectorAll('[data-plage]').forEach((c) => c.addEventListener('change', () => {
        const [s, j] = c.dataset.plage.split(':').map(Number);
        const lues = lirePlages(c.value);
        if (lues === null) { erreur.textContent = texte('calendrier_btp.edition.illisible', { jour: JOURS_SEMAINE[j - 1] }); erreur.hidden = false; return; }
        cal.plages = [...cal.plages.filter((p) => !(p.semaine === s && p.jour === j && !p.du && !p.au)), ...lues.map((p) => ({ semaine: s, jour: j, ...p, du: null, au: null }))];
        marquer();
        rendre();
      }));
      const groupes = groupesDates();
      zone.querySelectorAll('tr[data-d]').forEach((tr) => {
        const g = groupes[Number(tr.dataset.d)];
        const remplacer = (n) => {
          cal.plages = [...cal.plages.filter((p) => !g.plages.includes(p)), ...(n.plages ?? []).map((p) => ({ semaine: n.semaine, jour: n.jour, ...p, du: n.du, au: n.au }))];
          marquer();
          rendre();
        };
        const j = creerCombo({ options: OPTIONS_JOURS, valeur: g.jour, vide: false });
        j.readOnly = !this.admin;
        j.addEventListener('change', () => remplacer({ ...g, jour: Number(j.valeurCombo) }));
        tr.querySelector('[data-jour]').append(j);
        tr.querySelectorAll('[data-dc]').forEach((c) => c.addEventListener('change', () => {
          if (c.dataset.dc === 'plages') {
            const lues = lirePlages(c.value);
            if (lues === null) { erreur.textContent = texte('calendrier_btp.edition.datees_illisible'); erreur.hidden = false; return; }
            remplacer({ ...g, plages: lues });
          } else remplacer({ ...g, [c.dataset.dc]: c.dataset.dc === 'semaine' ? Number(c.value) || 1 : (c.value || null), plages: g.plages.map((p) => ({ debut: p.debut, fin: p.fin })) });
        }));
        tr.querySelector('[data-retirer-date]')?.addEventListener('click', () => remplacer({ ...g, plages: [] }));
      });
      zone.querySelector('[data-ajouter-date]')?.addEventListener('click', () => {
        const an = new Date().getFullYear();
        cal.plages.push({ semaine: 1, jour: 1, debut: 420, fin: 720, du: `${an}-07-01`, au: `${an}-08-31` });
        marquer();
        rendre();
      });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        const codes = controlerCalendrier(cal);
        if (!cal.code || !cal.libelle) codes.push('CODE');
        if (codes.length) { erreur.textContent = codes.includes('CODE') ? texte('calendrier_btp.edition.code_libelle') : messages(codes); erreur.hidden = false; return; }
        try {
          const r = cal.id ? await api.calendriers.modifier(cal.id, cal) : await api.calendriers.creer(cal);
          this.edition.modifiee = false;
          this.app.message(texte('calendrier_btp.edition.enregistre'), 'succes');
          await this.#rendreListe();
          this.#editer(structuredClone(r));
          await this.#rendreServices();
        } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
      });
      zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        if (!await confirmer(texte('calendrier_btp.edition.confirmer_suppression', { code: cal.code }))) return;
        try { await api.calendriers.supprimer(cal.id); this.edition = null; zone.hidden = true; await this.#rendreListe(); } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
      });
      zone.querySelector('[data-fermer]').addEventListener('click', async () => {
        if (this.edition?.modifiee && !await confirmer(texte('calendrier_btp.edition.abandonner'))) return;
        this.edition = null;
        zone.hidden = true;
      });
      if (cal.id) this.#apercu(zone.querySelector('[data-apercu]'), cal.id).catch((e) => this.app.erreur(e));
    };
    rendre();
    zone.scrollIntoView({ block: 'start' });
  }

  async #apercu(zone, id, portee = '') {
    const du = aujourdhui();
    const journees = await api.calendriers.journees(id, du, ajouterJours(du, 13), portee);
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('calendrier_btp.edition.date')}</th><th>${texteHtml('calendrier_btp.edition.plages')}</th><th>${texteHtml('calendrier_btp.edition.duree')}</th></tr></thead><tbody>
      ${journees.map((j) => `<tr${j.minutes ? '' : ' class="discret"'}><td>${JOURS_SEMAINE[new Date(`${j.date}T00:00:00Z`).getUTCDay() === 0 ? 6 : new Date(`${j.date}T00:00:00Z`).getUTCDay() - 1]} ${jour(j.date)}</td>
        <td>${j.fermee ? `${iconeHtml('calendrier_btp_ferme')} ${echapper(j.fermee.join(' · '))}` : echapper(ecrirePlages(j.plages))}</td><td>${j.minutes ? duree(j.minutes) : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  /** Jours fermés d'une portée : tableau éditable (catalogue à cocher, règles saisies), aperçu des dates d'une année. */
  async #tableFermes(zone, { portee = null, titre, aide, catalogue = false }) {
    let regles = (await api.calendriers.joursFermes(portee)).map((r) => ({ ...r }));
    let annee = new Date().getFullYear();
    const dis = this.admin ? '' : 'disabled';
    const rendre = () => {
      const lignes = regles.map((r, i) => `<tr data-i="${i}"><td><input type="checkbox" data-r="actif" ${r.actif ? 'checked' : ''} ${dis}></td>
        <td>${r.code ? echapper(r.libelle) : `<input data-r="libelle" value="${echapper(r.libelle)}" size="28" ${dis}>`}</td>
        <td>${catalogue ? echapper(ZONES[r.zone] ?? (r.zone ? r.zone : texte('calendrier_btp.fermes.saisie'))) : ''}</td>
        <td>${r.code ? echapper(resume(r)) : `<span data-regle></span> ${this.#champsRegle(r, dis)}`}</td>
        <td>${!r.code && this.admin ? `<button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('');
      const fermes = joursFermes(regles, `${annee}-01-01`, `${annee}-12-31`);
      zone.innerHTML = `<h2>${echapper(titre)}</h2><p class="aide">${echapper(aide)}</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('calendrier_btp.liste.actif')}</th><th>${texteHtml('commun.libelle')}</th><th>${catalogue ? texteHtml('calendrier_btp.fermes.zone') : ''}</th><th>${texteHtml('calendrier_btp.fermes.regle')}</th><th></th></tr></thead><tbody>${lignes}</tbody></table>
        <p class="connexion-erreur" data-erreur hidden></p>
        ${this.admin ? `<p><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('calendrier_btp.fermes.jour_ferme')}</button> <button type="button" data-ajouter-periode>${iconeHtml('ajouter')} ${texteHtml('calendrier_btp.fermes.periode')}</button>
          <button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button></p>` : ''}
        <details><summary>${texteHtml('calendrier_btp.fermes.dates')} <input data-annee value="${annee}" size="5" inputmode="numeric"> : ${echapper(pluriel('calendrier_btp.fermes.jours', fermes.length))}</summary>
          <p>${fermes.map((f) => `${jour(f.date)} ${echapper(f.libelles.join(' · '))}`).join('<br>')}</p></details>`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const r = regles[Number(tr.dataset.i)];
        const c = tr.querySelector('[data-regle]');
        if (c) {
          const combo = creerCombo({ options: OPTIONS_REGLES, valeur: r.regle, vide: false });
          combo.readOnly = !this.admin;
          combo.addEventListener('change', () => { r.regle = combo.valeurCombo; rendre(); });
          c.append(combo);
        }
        tr.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('change', () => {
          const k = x.dataset.r;
          r[k] = x.type === 'checkbox' ? x.checked : ['mois', 'jour', 'rang', 'decalage'].includes(k) ? entier(x.value) : (x.value || null);
          if (k !== 'libelle') rendre();
        }));
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { regles.splice(Number(tr.dataset.i), 1); rendre(); });
      });
      zone.querySelector('[data-annee]').addEventListener('change', (e) => { annee = Number(e.target.value) || annee; rendre(); });
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { regles.push({ id: null, libelle: texte('calendrier_btp.fermes.pont'), regle: 'DATE', date: aujourdhui(), actif: true }); rendre(); });
      zone.querySelector('[data-ajouter-periode]')?.addEventListener('click', () => { regles.push({ id: null, libelle: texte('calendrier_btp.fermes.fermeture'), regle: 'PERIODE', du: `${annee}-08-01`, au: `${annee}-08-21`, actif: true }); rendre(); });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        const erreur = zone.querySelector('[data-erreur]');
        const fautes = regles.map((r) => ({ r, codes: controlerRegle(r) })).filter((x) => x.codes.length || !x.r.libelle);
        if (fautes.length) { erreur.textContent = fautes.map((f) => `${f.r.libelle || texte('calendrier_btp.fermes.sans_libelle')} : ${messages(f.codes) || texte('calendrier_btp.fermes.libelle_obligatoire')}`).join(' · '); erreur.hidden = false; return; }
        const [type, id] = portee ? portee.split(':') : [null, null];
        try { regles = (await api.calendriers.enregistrerJoursFermes({ type, id, regles })).map((r) => ({ ...r })); this.app.message(texte('calendrier_btp.fermes.enregistres'), 'succes'); rendre(); } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
      });
    };
    rendre();
  }

  #champsRegle(r, dis) {
    const n = (k, taille = 3) => `<input data-r="${k}" value="${echapper(r[k] ?? '')}" size="${taille}" inputmode="numeric" ${dis} title="${k}">`;
    const d = (k) => `<input type="date" data-r="${k}" value="${echapper(r[k] ?? '')}" ${dis}>`;
    switch (r.regle) {
      case 'DATE': return d('date');
      case 'ANNUEL': return `${texteHtml('calendrier_btp.fermes.c_jour')} ${n('jour')} ${texteHtml('calendrier_btp.fermes.c_mois')} ${n('mois')}`;
      case 'NIEME': return `${texteHtml('calendrier_btp.fermes.c_rang')} ${n('rang', 2)} ${texteHtml('calendrier_btp.fermes.c_jour_semaine')} ${n('jour', 2)} ${texteHtml('calendrier_btp.fermes.c_mois')} ${n('mois')}`;
      case 'DERNIER': return `${texteHtml('calendrier_btp.fermes.c_jour_semaine')} ${n('jour', 2)} ${texteHtml('calendrier_btp.fermes.c_mois')} ${n('mois')}`;
      case 'PAQUES': return `${texteHtml('calendrier_btp.fermes.c_decalage')} ${n('decalage', 4)} ${texteHtml('calendrier_btp.fermes.c_jours')}`;
      case 'PERIODE': return `${texteHtml('calendrier_btp.fermes.c_du')} ${d('du')} ${texteHtml('calendrier_btp.fermes.c_au')} ${d('au')}`;
      default: return '';
    }
  }

  #rendreFeries() {
    return this.#tableFermes(this.conteneur.querySelector('[data-feries]'), {
      titre: texte('calendrier_btp.fermes.societe'), catalogue: true,
      aide: texte('calendrier_btp.fermes.societe_aide'),
    });
  }

  /** Calendrier de chaque service et fermetures propres au service (fermeture de l'atelier en août…). */
  async #rendreServices() {
    const zone = this.conteneur.querySelector('[data-services]');
    const services = await api.calendriers.services();
    const options = this.calendriers.filter((c) => c.actif).map((c) => ({ valeur: c.id, libelle: c.libelle, detail: c.code }));
    zone.innerHTML = `<h2>${texteHtml('calendrier_btp.services.titre')}</h2><p class="aide">${texteHtml('calendrier_btp.services.aide')}</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('calendrier_btp.services.service')}</th><th>${texteHtml('calendrier_btp.liste.calendrier')}</th><th></th></tr></thead><tbody>
      ${services.filter((s) => s.actif).map((s) => `<tr data-srv="${s.srv_id}"><td>${echapper(s.libelle)} <small class="aide">${echapper(s.code)}</small></td><td data-cal></td>
        <td><button type="button" data-fermetures>${texteHtml('calendrier_btp.services.fermetures')}</button></td></tr>`).join('')}</tbody></table>
      ${this.admin ? `<p><button type="button" class="principal" data-enregistrer>${texteHtml('calendrier_btp.services.enregistrer')}</button></p>` : ''}
      <div data-fermetures-service></div>`;
    const choix = new Map();
    zone.querySelectorAll('tr[data-srv]').forEach((tr) => {
      const s = services.find((x) => x.srv_id === Number(tr.dataset.srv));
      const c = creerCombo({ options, valeur: s.cal_id ?? '', vide: true });
      c.readOnly = !this.admin;
      c.addEventListener('change', () => choix.set(s.srv_id, c.valeurCombo ? Number(c.valeurCombo) : null));
      tr.querySelector('[data-cal]').append(c);
      tr.querySelector('[data-fermetures]').addEventListener('click', () => this.#tableFermes(zone.querySelector('[data-fermetures-service]'), {
        portee: `service:${s.srv_id}`, titre: texte('calendrier_btp.services.titre_fermetures', { service: s.libelle }), aide: texte('calendrier_btp.services.aide_fermetures'),
      }).catch((e) => this.app.erreur(e)));
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        await api.calendriers.enregistrerServices([...choix.entries()].map(([srv_id, cal_id]) => ({ srv_id, cal_id })));
        this.app.message(texte('calendrier_btp.services.enregistres'), 'succes');
        await this.#rendreListe();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
