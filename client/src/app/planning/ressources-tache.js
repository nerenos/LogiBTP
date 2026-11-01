import { texte, texteHtml, textesParCode, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { echapper, creerCombo, lirePreferences, ecrirePreferences, alerter, ouvrirModale } from '@logibtp/socle/ui';
import { versMinutes, depuisMinutes } from '@logibtp/planning';
import { ecrireDuree } from '@logibtp/pointage';
import { api } from '../api.js';

// Planning (cœur) : ressources d'une tâche — affectations regroupées par équipe (copie de la composition appliquée :
// un membre retiré de la tâche ne quitte pas l'équipe ; changement de composition pendant la tâche proposé à
// l'utilisateur), ajout par une combo unique ou par la fenêtre de choix (disponibilités sur la période de la tâche,
// information seulement), onglet « Ressources » du panneau (ressources glissées sur une tâche).

export const TYPE_GLISSER_RESSOURCE = 'application/x-logibtp-planning-ressource';
export const TYPES_RESSOURCE = textesParCode('planning_btp.types_ressource', ['SALARIE', 'INTERIM', 'MATERIEL', 'SOUS_TRAITANT']);
/** Nombre de ressources rendues par `GET /planning/disponibilites` (`RessourcesTache.LimiteDisponibilites`). */
const LIMITE_DISPONIBILITES = 1000;
const TYPES_ELEMENT = textesParCode('planning_btp.types_ressource', ['EQUIPE', 'SALARIE', 'INTERIM', 'MATERIEL', 'SOUS_TRAITANT']);
/** Disponibilités : libellé par code (module Personnalisation), couleur de la pastille (variables du thème). */
const ETATS_DISPO = Object.fromEntries(['LIBRE', 'PARTIEL', 'OCCUPE', 'ABSENT', 'HORS', 'SANS'].map((c) => [c, {
  get libelle() { return texte(`planning_btp.disponibilites.${c}`); }, couleur: `var(--planning-dispo-${c.toLowerCase()})`,
}]));

const cleDe = (r) => `${r.type}:${r.id}`;

/** Services choisis par un filtre : le service et ses sous-services (identifiants en texte). */
export function servicesFiltres(id, services) {
  if (id === '' || id == null) return null;
  return new Set([String(id), ...services.filter((s) => String(s.parent_id) === String(id)).map((s) => String(s.id))]);
}

let referentiels = null;
/** Services (avec leur parent) pour les filtres, lus une fois. */
const servicesConnus = async () => (await (referentiels ??= api.planning.referentiels().catch(() => ({ services: [] })))).services ?? [];
const jour = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const quand = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;

/** Bouton d'action d'une ligne (affiché au survol de la ligne). */
const action = (attr, symbole, titre) => `<button type="button" class="bouton-icone" ${attr} title="${titre}" aria-label="${titre}">${symbole}</button>`;

/** Combo unique de recherche et de choix d'une ressource (toutes les ressources, filtrées à la saisie). */
export function comboRessources(ressources, titre = texte('planning_btp.ressources.ajouter_titre')) {
  const c = creerCombo({
    options: ressources.map((r) => ({ valeur: cleDe(r), libelle: r.libelle, detail: r.service ?? TYPES_RESSOURCE[r.type] ?? r.type })),
    valeur: '', vide: true, titre,
  });
  c.placeholder = texte('planning_btp.ressources.ajouter');
  return c;
}

/**
 * Ressources d'une tâche dans le détail : affectations (membres d'équipe sous leur équipe, ressources ajoutées à part),
 * membres retirés de la tâche (rajoutables), changement de composition à appliquer, ajout par combo, par équipe
 * (aperçu de la composition à la date de début) ou par la fenêtre de choix. `saisie()` : { affectations, equipes }.
 */
export class RessourcesTache {
  constructor(zone, { tache, ressources, equipes, debut, periode, appliquerEquipe, message }) {
    this.zone = zone;
    this.tache = tache;
    this.ressources = ressources;
    this.listeEquipes = equipes;
    this.debut = debut;
    this.periode = periode;
    this.appliquerEquipe = appliquerEquipe;
    this.message = message;
    this.affs = tache.affectations.map((a) => ({ ...a }));
    this.equipes = new Map((tache.equipes ?? []).map((e) => [e.id, { ...e, membres: e.membres.map((m) => m.cle), libelles: new Map(e.membres.map((m) => [m.cle, m.libelle])) }]));
    this.libelles = new Map(ressources.map((r) => [cleDe(r), r.libelle]));
    zone.innerHTML = `<ul class="liste-ressources-tache" data-affectations></ul>
      <div class="ligne ajout-ressource"><span data-ajout></span>${action('data-choisir', iconeHtml('planning_btp_options'), texteHtml('planning_btp.ressources.choisir_titre'))}</div>
      <div class="ligne ajout-ressource"><span data-equipe></span></div><div data-apercu-equipe></div>`;
    const ajout = comboRessources(ressources);
    zone.querySelector('[data-ajout]').append(ajout);
    ajout.addEventListener('change', () => {
      const v = ajout.valeurCombo;
      ajout.definirValeur('');
      if (v) this.ajouter(v);
    });
    this.comboEquipe = creerCombo({ options: equipes.map((e) => ({ valeur: e.id, libelle: e.libelle, detail: e.code })), valeur: '', vide: true, titre: texte('planning_btp.ressources.equipe_titre') });
    this.comboEquipe.placeholder = texte('planning_btp.ressources.equipe');
    zone.querySelector('[data-equipe]').append(this.comboEquipe);
    this.comboEquipe.addEventListener('change', () => this.#apercuEquipe(Number(this.comboEquipe.valeurCombo) || null));
    zone.querySelector('[data-choisir]').addEventListener('click', () => this.#choisir());
    this.rendre();
  }

  /** Ajoute une ressource à la main (sans équipe) ; jamais de doublon. */
  ajouter(cle, libelle) {
    if (this.affs.some((a) => cleDe(a) === cle)) { this.message?.(texte('planning_btp.ressources.deja')); return; }
    const i = cle.indexOf(':');
    this.affs.push({ type: cle.slice(0, i), id: cle.slice(i + 1), libelle: libelle ?? this.libelles.get(cle) ?? cle });
    this.rendre();
  }

  saisie() {
    return {
      affectations: this.affs.map((a) => ({ type: a.type, id: a.id, equipe_id: a.equipe_id ?? null, quantite: a.quantite ?? null })),
      equipes: Object.fromEntries([...this.equipes].map(([id, e]) => [id, { date: e.date, membres: e.membres }])),
    };
  }

  /** Première ressource à capacité (premier créneau libre). */
  premiere() { return this.affs.find((a) => a.type !== 'EQUIPE' && a.capacite !== false); }

  rendre() {
    const ul = this.zone.querySelector('[data-affectations]');
    const ligne = (a, i) => `<li class="ligne-ressource"><span class="lr-libelle">${echapper(a.libelle ?? this.libelles.get(cleDe(a)) ?? cleDe(a))}</span>
      ${a.heures ? `<span class="lr-info">${texteHtml('planning_btp.bulle.duree', { duree: ecrireDuree(a.heures) })}</span>` : ''}<span class="lr-actions">${action(`data-retirer="${i}"`, iconeHtml('retirer'), texteHtml('planning_btp.ressources.retirer'))}</span></li>`;
    const blocs = [];
    for (const [id, e] of this.equipes) {
      const membres = this.affs.map((a, i) => [a, i]).filter(([a]) => a.equipe_id === id);
      const presents = new Set(membres.map(([a]) => cleDe(a)));
      const retires = e.membres.filter((m) => !presents.has(m));
      const ch = e.changement;
      blocs.push(`<li class="ligne-equipe"><span class="lr-libelle">${iconeHtml('planning_btp_equipe')} <b>${echapper(e.libelle)}</b> <small class="aide">${texteHtml('planning_btp.ressources.composition_du', { date: jour(e.date) })}</small></span>
          <span class="lr-actions">${action(`data-retirer-equipe="${id}"`, iconeHtml('retirer'), texteHtml('planning_btp.ressources.retirer_equipe'))}</span></li>
        ${ch ? `<li class="changement-equipe">${texteHtml('planning_btp.ressources.changement', { date: jour(ch.date) })} ${ch.entrees.map((m) => `${iconeHtml('ajouter')} ${echapper(m.libelle)}`).concat(ch.sorties.map((m) => `${iconeHtml('moins')} ${echapper(m.libelle)}`)).join(', ')}
          ${this.tache.id ? `<button type="button" data-appliquer-equipe="${id}" data-date="${ch.date}">${texteHtml('planning_btp.ressources.mettre_a_jour')}</button>` : ''}</li>` : ''}
        ${membres.map(([a, i]) => ligne(a, i).replace('class="ligne-ressource"', 'class="ligne-ressource membre"')).join('')}
        ${retires.map((m) => `<li class="ligne-ressource membre retire"><span class="lr-libelle">${echapper(e.libelles?.get(m) ?? this.libelles.get(m) ?? m)}</span><span class="lr-info">${texteHtml('planning_btp.ressources.retire')}</span>
          <span class="lr-actions">${action(`data-remettre="${id}|${m}"`, iconeHtml('planning_btp_remettre'), texteHtml('planning_btp.ressources.remettre'))}</span></li>`).join('')}`);
    }
    const seules = this.affs.map((a, i) => [a, i]).filter(([a]) => !a.equipe_id || !this.equipes.has(a.equipe_id));
    ul.innerHTML = blocs.join('') + seules.map(([a, i]) => ligne(a, i)).join('')
      || `<li class="aide">${texteHtml('planning_btp.ressources.aucune')}</li>`;
    ul.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { this.affs.splice(Number(b.dataset.retirer), 1); this.rendre(); }));
    ul.querySelectorAll('[data-retirer-equipe]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.retirerEquipe);
      this.affs = this.affs.filter((a) => a.equipe_id !== id);
      this.equipes.delete(id);
      this.rendre();
    }));
    ul.querySelectorAll('[data-remettre]').forEach((b) => b.addEventListener('click', () => {
      const [id, cle] = b.dataset.remettre.split('|');
      if (this.affs.some((a) => cleDe(a) === cle)) return;
      const i = cle.indexOf(':');
      this.affs.push({ type: cle.slice(0, i), id: cle.slice(i + 1), equipe_id: Number(id), libelle: this.equipes.get(Number(id))?.libelles?.get(cle) ?? this.libelles.get(cle) });
      this.rendre();
    }));
    ul.querySelectorAll('[data-appliquer-equipe]').forEach((b) => b.addEventListener('click', () => this.appliquerEquipe?.(Number(b.dataset.appliquerEquipe), b.dataset.date)));
  }

  /** Aperçu de la composition d'une équipe à la date de début : membres cochés à ajouter (les décochés restent dans l'équipe). */
  async #apercuEquipe(id) {
    const zone = this.zone.querySelector('[data-apercu-equipe]');
    if (!id) { zone.innerHTML = ''; return; }
    if (this.equipes.has(id)) { zone.innerHTML = `<p class="aide">${texteHtml('planning_btp.ressources.equipe_deja')}</p>`; return; }
    const date = (this.debut() || depuisMinutes(versMinutes(aujourdhui()))).slice(0, 10);
    let membres;
    try { membres = await api.planning.membresEquipe(id, date); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const equipe = this.listeEquipes.find((e) => e.id === id);
    zone.innerHTML = `<div class="apercu-equipe"><p><b>${echapper(equipe?.libelle ?? '')}</b> — ${texteHtml('planning_btp.ressources.composition_au', { date: jour(date) })}</p>
      ${membres.length ? `<ul>${membres.map((m) => {
        const deja = this.affs.some((a) => cleDe(a) === m.cle);
        return `<li><label><input type="checkbox" data-membre="${echapper(m.cle)}" ${deja ? 'disabled' : 'checked'}> ${echapper(m.libelle)}${deja ? ` <small class="aide">${texteHtml('planning_btp.ressources.deja_affecte')}</small>` : ''}</label></li>`;
      }).join('')}</ul>` : `<p class="aide">${texteHtml('planning_btp.ressources.aucun_membre')}</p>`}
      <p class="ligne"><button type="button" data-ajouter-membres ${membres.length ? '' : 'disabled'}>${iconeHtml('ajouter')} ${texteHtml('planning_btp.ressources.ajouter_tache')}</button> <button type="button" data-annuler-equipe>${texteHtml('commun.annuler')}</button></p></div>`;
    zone.querySelector('[data-annuler-equipe]').addEventListener('click', () => { zone.innerHTML = ''; this.comboEquipe.definirValeur(''); });
    zone.querySelector('[data-ajouter-membres]').addEventListener('click', () => {
      const coches = new Set([...zone.querySelectorAll('[data-membre]:checked')].map((x) => x.dataset.membre));
      this.equipes.set(id, { id, libelle: equipe?.libelle ?? texte('planning_btp.ressources.equipe_n', { numero: id }), date, membres: membres.map((m) => m.cle), libelles: new Map(membres.map((m) => [m.cle, m.libelle])), changement: null });
      for (const m of membres) if (coches.has(m.cle) && !this.affs.some((a) => cleDe(a) === m.cle)) this.affs.push({ type: m.type, id: m.id, equipe_id: id, libelle: m.libelle });
      zone.innerHTML = '';
      this.comboEquipe.definirValeur('');
      this.rendre();
    });
  }

  /** Fenêtre de choix : sélection de départ = affectations ; décocher retire de la tâche, cocher ajoute (sans équipe). */
  async #choisir() {
    const p = await this.periode();
    const avant = new Set(this.affs.map(cleDe));
    const choix = await choisirRessources({ ...p, exclure: this.tache.id, selection: avant });
    if (!choix) return;
    this.affs = this.affs.filter((a) => choix.cles.has(cleDe(a)));
    for (const cle of choix.cles) if (!avant.has(cle)) this.ajouter(cle, choix.libelles.get(cle));
    this.rendre();
  }
}

/**
 * Fenêtre de choix des ressources sur une période : disponibilités (libre, partielle, occupée — tâches en cause —,
 * absente, hors calendrier ; information, jamais bloquant), filtres d'affichage (texte, service, type, disponibles,
 * sélectionnées : une ressource masquée garde son choix). Résout { cles, libelles } ou null (abandon).
 */
export async function choisirRessources({ du, au, exclure, selection }) {
  let liste;
  let tous;
  try { [liste, tous] = await Promise.all([api.planning.disponibilites({ du, au, exclure: exclure ?? '', inclure: [...(selection ?? [])].join(',') }), servicesConnus()]); } catch (e) { await alerter(e.message); return null; }
  const choisies = new Set(selection);
  // Le serveur rend au plus LIMITE_DISPONIBILITES ressources, plus celles déjà choisies (toujours présentes).
  const limitee = liste.length >= LIMITE_DISPONIBILITES;
  return new Promise((resoudre) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogue-structure dialogue-ressources';
    // Services des ressources listées et leurs parents (un parent choisi comprend ses sous-services).
    const presents = new Set(liste.filter((r) => r.srv_id).map((r) => r.srv_id));
    for (const x of tous) if (presents.has(x.id) && x.parent_id) presents.add(x.parent_id);
    const services = tous.filter((x) => presents.has(x.id)).map((x) => [x.id, x.parent_id ? `${icone('sous_niveau')} ${x.libelle}` : x.libelle]);
    const types = [...new Set(liste.map((r) => r.type))];
    dlg.innerHTML = `<h3>${texteHtml('planning_btp.choix.titre', { du: quand(du), au: quand(au) })}</h3>
      <div class="ligne filtres-ressources"><input type="search" data-texte placeholder="${texteHtml('planning_btp.choix.rechercher')}"><span data-service></span><span data-type></span>
        <label><input type="checkbox" data-libres> ${texteHtml('planning_btp.choix.disponibles')}</label><label><input type="checkbox" data-choisies> ${texteHtml('planning_btp.choix.selectionnees')}</label></div>
      <div class="tableau-defilant"><table class="tableau-compact pleine-largeur"><thead><tr><th><input type="checkbox" data-tout title="${texteHtml('planning_btp.choix.tout')}"></th><th>${texteHtml('planning_btp.choix.ressource')}</th><th>${texteHtml('planning_btp.choix.type')}</th><th>${texteHtml('planning_btp.bulle.service')}</th><th>${texteHtml('planning_btp.choix.disponibilite')}</th></tr></thead><tbody></tbody></table></div>
      <p class="ligne"><span class="aide" data-compte></span><span class="espace"></span><button type="button" data-valider>${texteHtml('commun.valider')}</button> <button type="button" data-abandon>${texteHtml('commun.annuler')}</button></p>`;
    document.body.append(dlg);
    const service = creerCombo({ options: services.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: '', vide: true, titre: texte('planning_btp.bulle.service') });
    service.placeholder = texte('planning_btp.bulle.service');
    dlg.querySelector('[data-service]').append(service);
    const type = creerCombo({ options: types.map((t) => ({ valeur: t, libelle: TYPES_RESSOURCE[t] ?? t })), valeur: '', vide: true, titre: texte('planning_btp.choix.type') });
    type.placeholder = texte('planning_btp.choix.type');
    dlg.querySelector('[data-type]').append(type);
    const corps = dlg.querySelector('tbody');
    const filtreSrv = () => servicesFiltres(service.valeurCombo, tous);
    const visibles = () => {
      const t = dlg.querySelector('[data-texte]').value.trim().toLowerCase();
      return liste.filter((r) => (!t || `${r.libelle} ${r.service ?? ''}`.toLowerCase().includes(t))
        && (!filtreSrv() || filtreSrv().has(String(r.srv_id))) && (!type.valeurCombo || r.type === type.valeurCombo)
        && (!dlg.querySelector('[data-libres]').checked || r.etat === 'LIBRE' || r.etat === 'SANS')
        && (!dlg.querySelector('[data-choisies]').checked || choisies.has(r.cle)));
    };
    const compter = (v) => {
      const masquees = [...choisies].filter((c) => !v.some((r) => r.cle === c)).length;
      dlg.querySelector('[data-compte]').textContent = `${pluriel('planning_btp.choix.selection', choisies.size)}${masquees ? ` ${pluriel('planning_btp.choix.masquees', masquees)}` : ''}${limitee ? ` · ${texte('planning_btp.choix.limitee', { nombre: LIMITE_DISPONIBILITES })}` : ''}`;
      const tout = dlg.querySelector('[data-tout]');
      tout.checked = v.length > 0 && v.every((r) => choisies.has(r.cle));
      tout.indeterminate = !tout.checked && v.some((r) => choisies.has(r.cle));
    };
    const dispo = (r) => {
      const e = ETATS_DISPO[r.etat] ?? ETATS_DISPO.HORS;
      const h = (m) => ecrireDuree(m) || '0:00';
      const libelle = r.etat === 'PARTIEL' || r.etat === 'OCCUPE' ? texte('planning_btp.choix.occupe', { etat: e.libelle, occupe: h(r.occupe), travail: h(r.travail) }) : r.etat === 'LIBRE' ? texte('planning_btp.choix.libre', { etat: e.libelle, travail: h(r.travail) }) : e.libelle;
      const occ = r.occupations.map((o) => `${o.absence ? texteHtml('planning_btp.choix.absence') : echapper(o.libelle)} (${quand(o.debut)} ${iconeHtml('planning_vers')} ${quand(o.fin)})`);
      return `<span class="pastille-dispo" style="background:${e.couleur}"></span> ${echapper(libelle)}${occ.length ? `<br><small class="aide">${occ.slice(0, 3).join(' · ')}${occ.length > 3 ? ` · +${occ.length - 3}` : ''}</small>` : ''}`;
    };
    const rendre = () => {
      const v = visibles();
      corps.innerHTML = v.slice(0, 500).map((r) => `<tr data-cle="${echapper(r.cle)}" class="cliquable${choisies.has(r.cle) ? ' selection' : ''}">
        <td><input type="checkbox" ${choisies.has(r.cle) ? 'checked' : ''}></td><td>${echapper(r.libelle)}</td><td>${echapper(TYPES_RESSOURCE[r.type] ?? r.type)}</td>
        <td>${echapper(r.service ?? '')}</td><td>${dispo(r)}</td></tr>`).join('') || `<tr><td colspan="5" class="aide">${texteHtml('planning_btp.choix.aucune')}</td></tr>`;
      corps.querySelectorAll('tr[data-cle]').forEach((tr) => tr.addEventListener('click', (e) => {
        const c = tr.dataset.cle;
        if (choisies.has(c)) choisies.delete(c); else choisies.add(c);
        if (e.target.type !== 'checkbox') tr.querySelector('input').checked = choisies.has(c);
        tr.classList.toggle('selection', choisies.has(c));
        compter(v);
      }));
      compter(v);
    };
    dlg.querySelector('[data-tout]').addEventListener('change', (e) => { for (const r of visibles()) { if (e.target.checked) choisies.add(r.cle); else choisies.delete(r.cle); } rendre(); });
    dlg.querySelector('[data-texte]').addEventListener('input', rendre);
    for (const x of [service, type, dlg.querySelector('[data-libres]'), dlg.querySelector('[data-choisies]')]) x.addEventListener('change', rendre);
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(r);
    };
    dlg.addEventListener('close', () => finir(null));
    dlg.querySelector('[data-abandon]').addEventListener('click', () => finir(null));
    dlg.querySelector('[data-valider]').addEventListener('click', () => finir({ cles: new Set(choisies), libelles: new Map(liste.map((r) => [r.cle, r.libelle])) }));
    rendre();
    ouvrirModale(dlg, () => dlg.close());
    dlg.querySelector('[data-texte]').focus();
  });
}

/**
 * Onglet « Ressources » du panneau : ressources et équipes (recherche, service, type), en liste ou en tuiles
 * (préférence `planningRessourcesTuiles`), barre et entêtes figées ; chaque ligne ou tuile se glisse sur une tâche du
 * planning (ressource ajoutée, ou équipe à sa composition au début de la tâche, puis recalcul de la tâche).
 */
export function rendreOngletRessources(zone, ressources, services, equipes = []) {
  const libService = new Map(services.map((s) => [s.id, s.libelle]));
  const elements = [
    ...equipes.map((e) => ({ type: 'EQUIPE', id: String(e.id), libelle: e.libelle, code: e.code, srv_id: e.srv_id, service: libService.get(e.srv_id) ?? null })),
    ...ressources,
  ];
  let tuiles = Boolean(lirePreferences().planningRessourcesTuiles);
  zone.classList.add('onglet-liste');
  zone.innerHTML = `<div class="onglet-liste-haut"><div class="barre-aplanifier"><input type="search" data-filtre placeholder="${texteHtml('planning_btp.onglet.recherche')}"><span data-service></span><span data-type></span>
      <button type="button" class="bouton-icone" data-presentation></button></div>
    <p class="aide">${texteHtml('planning_btp.onglet.aide')}</p></div>
    <div class="onglet-liste-corps" data-liste></div>`;
  const service = creerCombo({ options: services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `${icone('sous_niveau')} ${s.libelle}` : s.libelle })), valeur: '', vide: true, titre: texte('planning_btp.bulle.service') });
  service.placeholder = texte('planning_btp.bulle.service');
  service.size = 9;
  zone.querySelector('[data-service]').append(service);
  const type = creerCombo({ options: Object.entries(TYPES_ELEMENT).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: '', vide: true, titre: texte('planning_btp.choix.type') });
  type.placeholder = texte('planning_btp.choix.type');
  type.size = 8;
  zone.querySelector('[data-type]').append(type);
  const symbole = (x) => iconeHtml(x.type === 'EQUIPE' ? 'planning_btp_equipe' : x.type === 'MATERIEL' ? 'planning_btp_materiel' : x.type === 'SOUS_TRAITANT' ? 'planning_btp_service' : 'planning_btp_salarie');
  const rendre = () => {
    const srv = servicesFiltres(service.valeurCombo, services);
    const pres = zone.querySelector('[data-presentation]');
    pres.textContent = tuiles ? icone('planning_btp_options') : icone('planning_btp_tuiles');
    pres.title = tuiles ? texte('planning_btp.aplanifier.en_liste') : texte('planning_btp.aplanifier.en_tuiles');
    const t = zone.querySelector('[data-filtre]').value.trim().toLowerCase();
    const l = elements.filter((x) => (!t || `${x.libelle} ${x.code ?? ''} ${x.service ?? ''}`.toLowerCase().includes(t))
      && (!srv || srv.has(String(x.srv_id))) && (!type.valeurCombo || x.type === type.valeurCombo));
    const vus = l.slice(0, 500);
    const liste = zone.querySelector('[data-liste]');
    const suite = l.length > 500 ? `<p class="aide">${texteHtml('planning_btp.onglet.suite', { nombre: l.length - 500 })}</p>` : '';
    liste.innerHTML = !l.length ? `<p class="aide">${texteHtml('planning_btp.onglet.aucune')}</p>` : tuiles
      ? `<div class="tuiles-aplanifier tuiles-ressources">${vus.map((x, i) => `<div class="tuile-aplanifier glissable${x.type === 'EQUIPE' ? ' tuile-equipe' : ''}" draggable="true" data-i="${i}" title="${echapper(x.libelle)}">
          <div class="ta-entete"><b>${symbole(x)} ${echapper(x.libelle)}</b></div><div class="ta-libelle">${echapper(TYPES_ELEMENT[x.type] ?? x.type)}${x.code && x.type === 'EQUIPE' ? ` · ${echapper(x.code)}` : ''}</div>
          <div class="ta-service">${echapper(x.service ?? '')}</div></div>`).join('')}</div>${suite}`
      : `<table class="tableau-compact pleine-largeur"><thead><tr><th>${texteHtml('planning_btp.choix.ressource')}</th><th>${texteHtml('planning_btp.choix.type')}</th><th>${texteHtml('planning_btp.bulle.service')}</th></tr></thead><tbody>
        ${vus.map((x, i) => `<tr draggable="true" class="glissable${x.type === 'EQUIPE' ? ' ligne-equipe-onglet' : ''}" data-i="${i}"><td>${symbole(x)} ${echapper(x.libelle)}</td><td>${echapper(TYPES_ELEMENT[x.type] ?? x.type)}</td><td>${echapper(x.service ?? '')}</td></tr>`).join('')}</tbody></table>${suite}`;
    liste.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('dragstart', (e) => {
      const x = vus[Number(el.dataset.i)];
      e.dataTransfer.setData(TYPE_GLISSER_RESSOURCE, JSON.stringify({ type: x.type, id: x.id, libelle: x.libelle }));
      e.dataTransfer.effectAllowed = 'copy';
    }));
  };
  zone.querySelector('[data-filtre]').addEventListener('input', rendre);
  zone.querySelector('[data-presentation]').addEventListener('click', () => { tuiles = !tuiles; ecrirePreferences({ planningRessourcesTuiles: tuiles }); rendre(); });
  service.addEventListener('change', rendre);
  type.addEventListener('change', rendre);
  rendre();
}
