import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import {
  JOURS_SEMAINE, REGLES_FERME, MESSAGES_CALENDRIER, controlerCalendrier, controlerRegle, lirePlages, ecrirePlages, duree, joursFermes, ajouterJours,
} from '@logibtp/calendrier';
import { api } from '../api.js';

const ZONES = {
  NATIONAL: 'France (nationaux)', ALSACE_MOSELLE: 'Alsace-Moselle', MARTINIQUE: 'Martinique', GUADELOUPE: 'Guadeloupe', GUYANE: 'Guyane',
  REUNION: 'La Réunion', MAYOTTE: 'Mayotte', SAINT_MARTIN: 'Saint-Martin', SAINT_BARTHELEMY: 'Saint-Barthélemy',
};
const OPTIONS_REGLES = Object.entries(REGLES_FERME).map(([valeur, libelle]) => ({ valeur, libelle }));
const OPTIONS_JOURS = JOURS_SEMAINE.map((libelle, i) => ({ valeur: i + 1, libelle }));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const messages = (codes) => codes.map((c) => MESSAGES_CALENDRIER[c] ?? c).join(' · ');
const entier = (v) => (String(v ?? '').trim() === '' ? null : Number(v));

/** Résumé d'une règle de jour fermé (« 1er mai », « Pâques + 39 j »…). */
function resume(r) {
  switch (r.regle) {
    case 'DATE': return jour(r.date);
    case 'ANNUEL': return `${r.jour}/${String(r.mois).padStart(2, '0')}`;
    case 'NIEME': return `${r.rang}${r.rang === 1 ? 'er' : 'e'} ${(JOURS_SEMAINE[r.jour - 1] ?? '?').toLowerCase()} du mois ${r.mois}`;
    case 'DERNIER': return `dernier ${(JOURS_SEMAINE[r.jour - 1] ?? '?').toLowerCase()} du mois ${r.mois}`;
    case 'PAQUES': return `Pâques ${r.decalage >= 0 ? '+' : '−'} ${Math.abs(r.decalage ?? 0)} j`;
    case 'PERIODE': return `du ${jour(r.du)} au ${jour(r.au)}`;
    default: return '';
  }
}

/**
 * Calendriers de travail (module Calendrier ; Planning P12, P13, P22) : plages par jour et semaine du cycle, plages
 * datées (horaires d'été), calendrier par défaut ; jours fériés de la société (catalogue français à cocher, règles
 * saisies) ; calendrier et fermetures de chaque service ; aperçu des journées. Administrateur.
 */
export class PageParametresCalendriers extends PageBase {
  icone = '📅';

  get modifiee() { return Boolean(this.edition?.modifiee); }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Calendriers de travail';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">📅 Calendriers de travail</h1>
      <section class="carte" data-liste></section><section class="carte" data-edition hidden></section>
      <section class="carte" data-feries></section><section class="carte" data-services></section></div>`;
    if (!app.enLigne) { this.conteneur.querySelector('[data-liste]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    this.admin = app.estAdmin();
    await this.#rendreListe();
    await Promise.all([this.#rendreFeries(), this.#rendreServices()]);
  }

  async #rendreListe() {
    this.calendriers = await api.calendriers.liste();
    const zone = this.conteneur.querySelector('[data-liste]');
    const hebdo = (c) => Array.from({ length: c.cycle_semaines }, (_, s) => duree(c.plages.filter((p) => p.semaine === s + 1 && !p.du && !p.au).reduce((t, p) => t + p.fin - p.debut, 0))).join(' / ');
    zone.innerHTML = `<h2>Calendriers</h2>
      <p class="aide">Un calendrier s'affecte à un service, et se surcharge sur la fiche d'un salarié ou d'un matériel ; sans calendrier, le calendrier par défaut s'applique.</p>
      <table><thead><tr><th>Code</th><th>Libellé</th><th>Cycle</th><th>Heures par semaine</th><th>Défaut</th><th>Actif</th><th class="nombre">Utilisé</th><th></th></tr></thead><tbody>
      ${this.calendriers.map((c, i) => `<tr><td><b>${echapper(c.code)}</b></td><td>${echapper(c.libelle)}</td><td>${c.cycle_semaines > 1 ? `${c.cycle_semaines} semaines` : 'hebdomadaire'}</td>
        <td>${hebdo(c)}</td><td>${c.defaut ? '★' : ''}</td><td>${c.actif ? '✔' : ''}</td><td class="nombre">${c.utilisations || ''}</td>
        <td><button type="button" data-i="${i}">${this.admin ? 'Modifier…' : 'Voir…'}</button></td></tr>`).join('')}</tbody></table>
      ${this.admin ? '<p><button type="button" data-nouveau>＋ Calendrier</button></p>' : ''}`;
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
      zone.innerHTML = `<h2>${cal.id ? `Calendrier ${echapper(cal.code)}` : 'Nouveau calendrier'}</h2>
        <p class="ligne"><label>Code <input data-c="code" value="${echapper(cal.code)}" size="14" maxlength="20" ${dis}></label>
          <label>Libellé <input data-c="libelle" value="${echapper(cal.libelle)}" size="36" maxlength="80" ${dis}></label>
          <label>Cycle (semaines) <input data-c="cycle_semaines" value="${cal.cycle_semaines}" size="3" inputmode="numeric" ${dis}></label>
          <label>Semaine 1 du cycle : celle du <input type="date" data-c="reference" value="${echapper(cal.reference ?? '')}" ${dis}></label>
          <label class="ligne"><input type="checkbox" data-c="defaut" ${cal.defaut ? 'checked' : ''} ${dis}> Par défaut</label>
          <label class="ligne"><input type="checkbox" data-c="actif" ${cal.actif ? 'checked' : ''} ${dis}> Actif</label></p>
        <p class="aide">Plages par jour, par exemple « 8:00-12:00 13:00-17:00 » ; vide : jour non travaillé.</p>
        <table class="grille-calendrier"><thead><tr><th>Jour</th>${semaines.map((s) => `<th>${cal.cycle_semaines > 1 ? `Semaine ${s}` : 'Plages'}</th>`).join('')}</tr></thead><tbody>
        ${JOURS_SEMAINE.map((nom, j) => `<tr><th>${nom}</th>${semaines.map((s) => {
          const p = permanentes(s, j + 1);
          return `<td><input data-plage="${s}:${j + 1}" value="${echapper(ecrirePlages(p))}" size="22" ${dis}> <small class="aide">${p.length ? duree(p.reduce((t, x) => t + x.fin - x.debut, 0)) : ''}</small></td>`;
        }).join('')}</tr>`).join('')}
        <tr><th>Total</th>${semaines.map((s) => `<td><b>${duree(cal.plages.filter((p) => p.semaine === s && !p.du && !p.au).reduce((t, x) => t + x.fin - x.debut, 0))}</b></td>`).join('')}</tr></tbody></table>
        <h3>Plages datées</h3><p class="aide">Pendant leur période, elles remplacent les plages permanentes du même jour (horaires d'été…).</p>
        <table><thead><tr><th>Du</th><th>Au</th><th>Semaine</th><th>Jour</th><th>Plages</th><th></th></tr></thead><tbody>
        ${groupesDates().map((g, i) => `<tr data-d="${i}"><td><input type="date" data-dc="du" value="${echapper(g.du ?? '')}" ${dis}></td><td><input type="date" data-dc="au" value="${echapper(g.au ?? '')}" ${dis}></td>
          <td><input data-dc="semaine" value="${g.semaine}" size="2" ${dis}></td><td data-jour></td><td><input data-dc="plages" value="${echapper(ecrirePlages(g.plages))}" size="22" ${dis}></td>
          <td>${this.admin ? '<button type="button" data-retirer-date>✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
        ${this.admin ? '<p><button type="button" data-ajouter-date>＋ Plages datées</button></p>' : ''}
        <p class="connexion-erreur" data-erreur hidden></p>
        <p>${this.admin ? `<button type="button" class="principal" data-enregistrer>Enregistrer le calendrier</button>
          ${cal.id && !cal.defaut ? '<button type="button" data-supprimer class="danger">Supprimer</button>' : ''}` : ''} <button type="button" data-fermer>Fermer</button></p>
        <h3>Aperçu (deux semaines)</h3><div data-apercu><p class="aide">${cal.id ? 'Chargement…' : 'Enregistrez le calendrier pour voir ses journées.'}</p></div>`;
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
        if (lues === null) { erreur.textContent = `${JOURS_SEMAINE[j - 1]} : saisie illisible (ex. 8:00-12:00 13:00-17:00)`; erreur.hidden = false; return; }
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
            if (lues === null) { erreur.textContent = 'Plages datées : saisie illisible'; erreur.hidden = false; return; }
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
        if (codes.length) { erreur.textContent = codes.includes('CODE') ? 'Code et libellé obligatoires' : messages(codes); erreur.hidden = false; return; }
        try {
          const r = cal.id ? await api.calendriers.modifier(cal.id, cal) : await api.calendriers.creer(cal);
          this.edition.modifiee = false;
          this.app.message('Calendrier enregistré', 'succes');
          await this.#rendreListe();
          this.#editer(structuredClone(r));
          await this.#rendreServices();
        } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
      });
      zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        if (!await confirmer(`Supprimer le calendrier ${cal.code} ?`)) return;
        try { await api.calendriers.supprimer(cal.id); this.edition = null; zone.hidden = true; await this.#rendreListe(); } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
      });
      zone.querySelector('[data-fermer]').addEventListener('click', async () => {
        if (this.edition?.modifiee && !await confirmer('Abandonner les modifications du calendrier ?')) return;
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
    zone.innerHTML = `<table><thead><tr><th>Date</th><th>Plages</th><th>Durée</th></tr></thead><tbody>
      ${journees.map((j) => `<tr${j.minutes ? '' : ' class="discret"'}><td>${JOURS_SEMAINE[new Date(`${j.date}T00:00:00Z`).getUTCDay() === 0 ? 6 : new Date(`${j.date}T00:00:00Z`).getUTCDay() - 1]} ${jour(j.date)}</td>
        <td>${j.fermee ? `🚫 ${echapper(j.fermee.join(' · '))}` : echapper(ecrirePlages(j.plages))}</td><td>${j.minutes ? duree(j.minutes) : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  /** Jours fermés d'une portée : tableau éditable (catalogue à cocher, règles saisies), aperçu des dates d'une année. */
  async #tableFermes(zone, { portee = null, titre, aide, catalogue = false }) {
    let regles = (await api.calendriers.joursFermes(portee)).map((r) => ({ ...r }));
    let annee = new Date().getFullYear();
    const dis = this.admin ? '' : 'disabled';
    const rendre = () => {
      const lignes = regles.map((r, i) => `<tr data-i="${i}"><td><input type="checkbox" data-r="actif" ${r.actif ? 'checked' : ''} ${dis}></td>
        <td>${r.code ? echapper(r.libelle) : `<input data-r="libelle" value="${echapper(r.libelle)}" size="28" ${dis}>`}</td>
        <td>${catalogue ? echapper(ZONES[r.zone] ?? (r.zone ? r.zone : 'Saisie')) : ''}</td>
        <td>${r.code ? echapper(resume(r)) : `<span data-regle></span> ${this.#champsRegle(r, dis)}`}</td>
        <td>${!r.code && this.admin ? '<button type="button" data-retirer>✕</button>' : ''}</td></tr>`).join('');
      const fermes = joursFermes(regles, `${annee}-01-01`, `${annee}-12-31`);
      zone.innerHTML = `<h2>${titre}</h2><p class="aide">${aide}</p>
        <table><thead><tr><th>Actif</th><th>Libellé</th><th>${catalogue ? 'Zone' : ''}</th><th>Règle</th><th></th></tr></thead><tbody>${lignes}</tbody></table>
        <p class="connexion-erreur" data-erreur hidden></p>
        ${this.admin ? `<p><button type="button" data-ajouter>＋ Jour fermé</button> <button type="button" data-ajouter-periode>＋ Période de fermeture</button>
          <button type="button" class="principal" data-enregistrer>Enregistrer</button></p>` : ''}
        <details><summary>Dates de l'année <input data-annee value="${annee}" size="5" inputmode="numeric"> : ${fermes.length} jour(s)</summary>
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
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { regles.push({ id: null, libelle: 'Pont', regle: 'DATE', date: aujourdhui(), actif: true }); rendre(); });
      zone.querySelector('[data-ajouter-periode]')?.addEventListener('click', () => { regles.push({ id: null, libelle: 'Fermeture', regle: 'PERIODE', du: `${annee}-08-01`, au: `${annee}-08-21`, actif: true }); rendre(); });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        const erreur = zone.querySelector('[data-erreur]');
        const fautes = regles.map((r) => ({ r, codes: controlerRegle(r) })).filter((x) => x.codes.length || !x.r.libelle);
        if (fautes.length) { erreur.textContent = fautes.map((f) => `${f.r.libelle || '(sans libellé)'} : ${messages(f.codes) || 'libellé obligatoire'}`).join(' · '); erreur.hidden = false; return; }
        const [type, id] = portee ? portee.split(':') : [null, null];
        try { regles = (await api.calendriers.enregistrerJoursFermes({ type, id, regles })).map((r) => ({ ...r })); this.app.message('Jours fermés enregistrés', 'succes'); rendre(); } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
      });
    };
    rendre();
  }

  #champsRegle(r, dis) {
    const n = (k, taille = 3) => `<input data-r="${k}" value="${r[k] ?? ''}" size="${taille}" inputmode="numeric" ${dis} title="${k}">`;
    const d = (k) => `<input type="date" data-r="${k}" value="${echapper(r[k] ?? '')}" ${dis}>`;
    switch (r.regle) {
      case 'DATE': return d('date');
      case 'ANNUEL': return `jour ${n('jour')} mois ${n('mois')}`;
      case 'NIEME': return `rang ${n('rang', 2)} jour (1 = lundi) ${n('jour', 2)} mois ${n('mois')}`;
      case 'DERNIER': return `jour (1 = lundi) ${n('jour', 2)} mois ${n('mois')}`;
      case 'PAQUES': return `décalage ${n('decalage', 4)} jours`;
      case 'PERIODE': return `du ${d('du')} au ${d('au')}`;
      default: return '';
    }
  }

  #rendreFeries() {
    return this.#tableFermes(this.conteneur.querySelector('[data-feries]'), {
      titre: 'Jours fériés et fermetures de la société', catalogue: true,
      aide: "Liste française proposée : cochez les jours fériés de vos établissements (nationaux, Alsace-Moselle, outre-mer) ; ajoutez ponts et fermetures. Règles : date unique, chaque année, n-ième ou dernier jour de la semaine d'un mois, relatif à Pâques, période.",
    });
  }

  /** Calendrier de chaque service et fermetures propres au service (fermeture de l'atelier en août…). */
  async #rendreServices() {
    const zone = this.conteneur.querySelector('[data-services]');
    const services = await api.calendriers.services();
    const options = this.calendriers.filter((c) => c.actif).map((c) => ({ valeur: c.id, libelle: c.libelle, detail: c.code }));
    zone.innerHTML = `<h2>Services</h2><p class="aide">Calendrier de chaque service (vide : par défaut) et ses fermetures propres.</p>
      <table><thead><tr><th>Service</th><th>Calendrier</th><th></th></tr></thead><tbody>
      ${services.filter((s) => s.actif).map((s) => `<tr data-srv="${s.srv_id}"><td>${echapper(s.libelle)} <small class="aide">${echapper(s.code)}</small></td><td data-cal></td>
        <td><button type="button" data-fermetures>Fermetures…</button></td></tr>`).join('')}</tbody></table>
      ${this.admin ? '<p><button type="button" class="principal" data-enregistrer>Enregistrer les calendriers des services</button></p>' : ''}
      <div data-fermetures-service></div>`;
    const choix = new Map();
    zone.querySelectorAll('tr[data-srv]').forEach((tr) => {
      const s = services.find((x) => x.srv_id === Number(tr.dataset.srv));
      const c = creerCombo({ options, valeur: s.cal_id ?? '', vide: true });
      c.readOnly = !this.admin;
      c.addEventListener('change', () => choix.set(s.srv_id, c.valeurCombo ? Number(c.valeurCombo) : null));
      tr.querySelector('[data-cal]').append(c);
      tr.querySelector('[data-fermetures]').addEventListener('click', () => this.#tableFermes(zone.querySelector('[data-fermetures-service]'), {
        portee: `service:${s.srv_id}`, titre: `Fermetures du service ${s.libelle}`, aide: "S'ajoutent aux jours fermés de la société pour les ressources de ce service.",
      }).catch((e) => this.app.erreur(e)));
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        await api.calendriers.enregistrerServices([...choix.entries()].map(([srv_id, cal_id]) => ({ srv_id, cal_id })));
        this.app.message('Calendriers des services enregistrés', 'succes');
        await this.#rendreListe();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
