import { aujourdhui, ajouterJours, ACTION_DROIT } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { EcranEtapesAtelier } from '@logibtp/execution/ui';
import { MODULE_FACULTATIF, TYPE_DOCUMENT } from '../codes.js';
import { echapper, creerCombo, lirePreferences, ecrirePreferences, formatDate, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ETATS_TACHE, COULEURS_ETAT } from '../planning/etats.js';
import { NAVIGATIONS, lundiDe, mobileAffiche, lienItineraire, liensTexte, numeroTel, adressesAPrecharger } from '../terrain/terrain.js';
import { PointageTerrain } from '../terrain/pointage-terrain.js';
import { SavTerrain } from '../terrain/sav-terrain.js';
import { saisirAvancement, envoyerPhotos, signalerNonConformite, demanderApprovisionnement } from '../terrain/actions-tache.js';
import { fournisseurEtapes } from '../terrain/operations-terrain.js';
import { listeOperations, marquerOperation, retirerOperation } from '../hors-ligne/operations.js';
import { estHorsLigne, ETAT_ATTENTE } from '../hors-ligne/attente.js';
import { SUJET_ATTENTE } from '../hors-ligne/synchro.js';

// Application de terrain, lot 1 (ANALYSE-TERRAIN.md) : page personnelle pour tablette et smartphone. Tâches du planning
// de la personne connectée (aujourd'hui ou la semaine), partie mobile (adresse, contact, consignes, liens) complétée par
// le chantier, itinéraire, pièces de la GED diffusées sur le terrain ; lot 2 : onglet Pointage de la journée
// (terrain/pointage-terrain.js) ; lot 3 : onglet Ordres (étapes, composant de l'atelier), avancement, photos et
// non-conformité depuis la carte d'une tâche (terrain/actions-tache.js) ; lot 4 : saisies gardées sur l'appareil hors
// ligne (terrain/operations-terrain.js), listées en tête (refusées : réessayer, abandonner), lectures de la période
// préchargées une fois par jour pour être consultées sans réseau ; lot 6 : onglet SAV (droit execution/sav).

const ONGLETS = { jour: 'Aujourd\'hui', semaine: 'Semaine', pointage: '⏱ Pointage', ordres: '🧩 Ordres', sav: '🧰 SAV' };
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const jourDe = (instant) => instant.slice(0, 10);
const heureDe = (instant) => instant.slice(11, 16);
const nomJour = (jour) => { const [a, m, j] = jour.split('-').map(Number); return `${JOURS[new Date(Date.UTC(a, m - 1, j)).getUTCDay()]} ${formatDate(jour)}`; };
const taille = (o) => (o == null ? '' : o < 1048576 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1048576).toFixed(1).replace('.', ',')} Mo`);

export class PageTerrain extends PageBase {
  icone = '📱';

  #modifiee = false;

  get modifiee() { return this.#modifiee; }

  async ouvrir() {
    this.titre = 'Mon terrain';
    // Onglets Ordres et SAV : module Exécution actif seulement ; SAV : droit à part, refusé par défaut (T20).
    const execution = this.app.moduleActif(MODULE_FACULTATIF.EXECUTION);
    this.onglets = Object.fromEntries(Object.entries(ONGLETS).filter(([cle]) => (cle !== 'ordres' && cle !== 'sav') || (execution && (cle === 'ordres' || this.app.peut('execution/sav', ACTION_DROIT.CONSULTER)))));
    this.onglet = this.onglets[this.requete.onglet] ? this.requete.onglet : 'jour';
    this.jour = /^\d{4}-\d{2}-\d{2}$/.test(this.requete.jour ?? '') ? this.requete.jour : aujourdhui();
    this.conteneur.innerHTML = `<div class="page-terrain">
      <div class="terrain-entete"><h1 class="page-titre">📱 Mon terrain</h1><span class="aide" data-personne></span></div>
      <nav class="terrain-onglets" role="tablist">${Object.entries(this.onglets).map(([cle, l]) => `<button type="button" role="tab" data-onglet="${cle}">${l}</button>`).join('')}</nav>
      <div class="terrain-periode" data-barre-periode><button type="button" data-decaler="-1" aria-label="Période précédente">◀</button><b data-periode></b>
        <button type="button" data-decaler="1" aria-label="Période suivante">▶</button><button type="button" data-aujourdhui>Aujourd'hui</button></div>
      <div data-attentes></div>
      <div class="terrain-liste" data-liste></div>
      <details class="terrain-reglages"><summary>⚙ Itinéraire</summary><p class="ligne">Application de navigation <span data-navigation></span></p>
        <p class="aide">L'itinéraire s'ouvre dans l'application choisie ; aucune position n'est enregistrée.</p></details>
    </div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    // Changement d'onglet ou de jour : une journée pointée non enregistrée est d'abord confirmée.
    const aller = async (changer) => { if (this.#modifiee && !(await this.quitter())) return; changer(); this.#charger(); };
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => aller(() => { this.onglet = b.dataset.onglet; })));
    this.conteneur.querySelectorAll('[data-decaler]').forEach((b) => b.addEventListener('click', () => aller(() => {
      this.jour = ajouterJours(this.jour, Number(b.dataset.decaler) * (this.onglet === 'semaine' ? 7 : 1));
    })));
    $('[data-aujourdhui]').addEventListener('click', () => aller(() => { this.jour = aujourdhui(); }));
    this.pointage = new PointageTerrain($('[data-liste]'), { app: this.app, modifiee: (m) => { this.#modifiee = m; } });
    const nav = creerCombo({ options: Object.entries(NAVIGATIONS).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: this.#navigation(), vide: false });
    nav.addEventListener('change', () => { ecrirePreferences({ terrainNavigation: nav.valeurCombo }); this.#rendre(); });
    $('[data-navigation]').append(nav);
    // Actions d'une carte de tâche (avancement, photos, non-conformité).
    $('[data-liste]').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-action-tache]');
      if (!b) return;
      const t = this.donnees?.taches.find((x) => x.id === Number(b.dataset.tache));
      if (!t) return;
      if (b.dataset.actionTache === 'avancement') await saisirAvancement(this.app, t);
      else if (b.dataset.actionTache === 'photos') await envoyerPhotos(this.app, t);
      else if (b.dataset.actionTache === 'nc') await signalerNonConformite(this.app, t, this.donnees.motifs ?? []);
      else if (b.dataset.actionTache === 'demande') await demanderApprovisionnement(this.app, t);
      else if (b.dataset.actionTache === 'reception') this.app.naviguer(`/terrain/reception/${t.ordre.id}`);
    });
    this.desabonner = this.app.abonner(SUJET_ATTENTE, () => this.#rendreAttentes());
    this.#rendreAttentes();
    await this.#charger();
    this.#precharger();
  }

  fermer() { this.desabonner?.(); this.pointage?.desabonner?.(); super.fermer?.(); }

  /** Saisies du terrain gardées sur l'appareil : nombre en attente, refusées avec la raison (réessayer, abandonner). */
  async #rendreAttentes() {
    const zone = this.conteneur.querySelector('[data-attentes]');
    if (!zone) return;
    const ops = (await listeOperations(this.app.utilisateur()).catch(() => [])).filter((o) => o.type.startsWith('terrain-'));
    const refusees = ops.filter((o) => o.etat === ETAT_ATTENTE.ERREUR);
    const attente = ops.length - refusees.length;
    zone.innerHTML = `${attente ? `<p class="carte">⏳ ${attente} saisie${attente > 1 ? 's' : ''} sur cet appareil, envoyée${attente > 1 ? 's' : ''} au retour du réseau.</p>` : ''}
      ${refusees.map((o) => `<div class="carte avertissement terrain-refus">⛔ <b>${echapper(o.libelle)}</b> : envoi refusé (${echapper(o.erreur ?? '')})
        <span class="terrain-actions"><button type="button" class="terrain-bouton" data-reessayer="${echapper(o.cle)}">↻ Réessayer</button>
        <button type="button" class="terrain-bouton" data-abandonner="${echapper(o.cle)}">✕ Abandonner</button>
        ${o.url ? `<a class="terrain-bouton" href="${echapper(o.url)}">Ouvrir</a>` : ''}</span></div>`).join('')}`;
    zone.querySelectorAll('[data-reessayer]').forEach((b) => b.addEventListener('click', async () => {
      await marquerOperation(b.dataset.reessayer, { etat: ETAT_ATTENTE.ATTENTE, erreur: null });
      this.app.publier(SUJET_ATTENTE, {});
      this.app.envoyerAttentes();
    }));
    zone.querySelectorAll('[data-abandonner]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmer('Abandonner cette saisie gardée sur l\'appareil ? Elle ne sera jamais envoyée.'))) return;
      await retirerOperation(b.dataset.abandonner);
      this.app.publier(SUJET_ATTENTE, {});
    }));
  }

  /**
   * Préchargement (T10), une fois par jour et par compte, réseau joignable : les lectures de la période sont faites pour
   * que le service worker les garde, puis les pièces « Terrain » des tâches lues (taille limitée par le service worker).
   */
  async #precharger() {
    if (this.app.apiPerdue || globalThis.navigator?.onLine === false) return;
    const cle = `terrainPrecharge:${this.app.utilisateur()}`;
    const jour = aujourdhui();
    try { if (localStorage.getItem(cle) === jour) return; } catch { /* stockage indisponible : préchargement refait */ }
    const lire = async (url) => { try { const r = await fetch(url, { credentials: 'same-origin' }); return r.ok && /json/.test(r.headers.get('Content-Type') ?? '') ? r.json() : null; } catch { return null; } };
    const premier = await lire(`/api/terrain?${new URLSearchParams({ du: jour, au: jour })}`);
    if (!premier?.personne) return;
    const pieces = new Set();
    for (const url of adressesAPrecharger(jour, premier.personne.id)) {
      const r = await lire(url);
      for (const t of r?.taches ?? []) for (const p of t.pieces ?? []) pieces.add(p.id);
    }
    for (const id of pieces) await fetch(api.terrain.urlPiece(id), { credentials: 'same-origin' }).catch(() => null);
    try { localStorage.setItem(cle, jour); } catch { /* sans stockage : refait à la prochaine ouverture */ }
  }

  urlCourante() { return `/terrain?onglet=${this.onglet}&jour=${this.jour}`; }

  #navigation() { const n = lirePreferences().terrainNavigation; return NAVIGATIONS[n] ? n : 'AUTO'; }

  #periode() {
    if (this.onglet !== 'semaine') return { du: this.jour, au: this.jour };
    const du = lundiDe(this.jour);
    return { du, au: ajouterJours(du, 6) };
  }

  async #charger() {
    const { du, au } = this.#periode();
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.onglet === this.onglet)));
    this.conteneur.querySelector('[data-periode]').textContent = du === au ? nomJour(du) : `du ${formatDate(du)} au ${formatDate(au)}`;
    this.app.routeur?.remplacerUrl(this.urlCourante());
    this.#modifiee = false;
    this.conteneur.querySelector('[data-barre-periode]').hidden = this.onglet === 'ordres' || this.onglet === 'sav';
    if (this.onglet === 'pointage') { await this.pointage.ouvrir(du); return; }
    if (this.onglet === 'sav') { await new SavTerrain(this.conteneur.querySelector('[data-liste]'), { app: this.app }).ouvrir(); return; }
    if (this.onglet === 'ordres') {
      await new EcranEtapesAtelier(this.conteneur.querySelector('[data-liste]'), fournisseurEtapes(this.app, () => api.terrain.etapes()), { titre: '🧩 Mes ordres : étapes à valider', message: (t, n) => this.app.message(t, n) }).ouvrir();
      return;
    }
    try {
      this.donnees = await api.terrain.taches(du, au);
    } catch (e) {
      if (!estHorsLigne(e)) { this.app.erreur(e); return; }
      this.donnees = null;
      this.conteneur.querySelector('[data-liste]').innerHTML = '<p class="carte avertissement">📵 Hors ligne : cette période n\'a pas été consultée sur cet appareil. Les deux semaines autour d\'aujourd\'hui sont gardées dès l\'ouverture de « Mon terrain » avec le réseau.</p>';
      return;
    }
    this.#rendre();
  }

  #rendre() {
    const d = this.donnees;
    if (!d) return;
    const liste = this.conteneur.querySelector('[data-liste]');
    this.conteneur.querySelector('[data-personne]').textContent = d.personne?.libelle ?? '';
    if (!d.personne) {
      liste.innerHTML = '<p class="carte avertissement">Votre compte n\'est lié à aucun salarié : demandez à l\'administrateur de le relier à votre fiche.</p>';
      return;
    }
    if (!d.taches.length) {
      liste.innerHTML = `<p class="terrain-vide">Aucune tâche planifiée ${this.onglet === 'jour' ? 'ce jour' : 'cette semaine'}.</p>`;
      return;
    }
    if (this.onglet === 'jour') { liste.innerHTML = d.taches.map((t) => this.#carte(t)).join(''); return; }
    // Semaine : tâches regroupées par jour (une tâche de plusieurs jours sous chacun de ses jours).
    const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(d.du, i));
    liste.innerHTML = jours.map((j) => {
      const taches = d.taches.filter((t) => t.debut < `${ajouterJours(j, 1)}T00:00` && t.fin > `${j}T00:00`);
      return taches.length ? `<h2 class="terrain-jour">${echapper(nomJour(j))}</h2>${taches.map((t) => this.#carte(t)).join('')}` : '';
    }).join('') || '<p class="terrain-vide">Aucune tâche planifiée cette semaine.</p>';
  }

  /** Carte d'une tâche : résumé (horaires, chantier, ordre, état), détail dépliable (lieu, contact, consignes, pièces). */
  #carte(t) {
    const m = mobileAffiche(t, this.donnees.chantiers);
    const plusieursJours = jourDe(t.debut) !== jourDe(t.fin.endsWith('T00:00') ? ajouterJours(jourDe(t.fin), -1) : t.fin);
    const horaires = plusieursJours ? `${formatDate(jourDe(t.debut))} ${heureDe(t.debut)} → ${formatDate(jourDe(t.fin))} ${heureDe(t.fin)}` : `${heureDe(t.debut)} – ${heureDe(t.fin)}`;
    const etat = t.etat ? `<span class="terrain-etat" style="--couleur:${COULEURS_ETAT[t.etat] ?? '#98a2b3'}">${echapper(ETATS_TACHE[t.etat] ?? t.etat)}</span>` : '';
    const herite = (c) => (c.herite ? ' <small class="aide">(chantier)</small>' : '');
    const tel = m.telephone && numeroTel(m.telephone.valeur);
    const liens = liensTexte(m.liens);
    const lignes = [
      m.adresse && `<p class="terrain-ligne"><span>📍 ${echapper(m.adresse.valeur)}${herite(m.adresse)}</span>
        <a class="terrain-bouton" href="${echapper(lienItineraire(m.adresse.valeur, this.#navigation(), navigator.userAgent))}" target="_blank" rel="noopener">🧭 Itinéraire</a></p>`,
      (m.contact || m.telephone) && `<p class="terrain-ligne"><span>👤 ${echapper(m.contact?.valeur ?? '')}${m.contact ? herite(m.contact) : ''}${m.telephone ? ` · ${echapper(m.telephone.valeur)}` : ''}</span>
        ${tel ? `<a class="terrain-bouton" href="tel:${echapper(tel)}">📞 Appeler</a>` : ''}</p>`,
      m.commentaire && `<p class="terrain-consignes">${echapper(m.commentaire).replace(/\n/g, '<br>')}</p>`,
      liens.length && `<ul class="terrain-liens">${liens.map((l) => `<li>${l.url ? `<a href="${echapper(l.url)}" target="_blank" rel="noopener noreferrer">🔗 ${echapper(l.libelle)}</a>` : echapper(l.texte)}</li>`).join('')}</ul>`,
      t.equipiers.length && `<p>👥 ${t.equipiers.map(echapper).join(', ')}</p>`,
      t.memo && `<p class="aide">${echapper(t.memo)}</p>`,
      t.chantier && `<div class="terrain-actions">${[['avancement', '📈 Avancement'], ['photos', '📷 Photos'], ['nc', '⚠ Non-conformité'], ['demande', '📦 Demande'],
        ...(t.ordre?.type === TYPE_DOCUMENT.E_PO ? [['reception', '✍ Réception']] : [])]
        .map(([a, l]) => `<button type="button" class="terrain-bouton" data-action-tache="${a}" data-tache="${t.id}">${l}</button>`).join('')}</div>`,
      t.pieces.length && `<div class="terrain-pieces"><b>Pièces</b>${t.pieces.map((p) => `<a class="terrain-piece" href="${echapper(api.terrain.urlPiece(p.id))}" target="_blank" rel="noopener">
        📄 <span>${echapper(p.titre)}</span><small class="aide">${echapper([p.nom_fichier, taille(p.taille)].filter(Boolean).join(' · '))}</small></a>`).join('')}</div>`,
    ].filter(Boolean);
    return `<details class="terrain-tache" style="--couleur:${echapper(t.couleur ?? '#2563eb')}" ${this.onglet === 'jour' ? 'open' : ''}>
      <summary><span class="terrain-horaires">${echapper(horaires)}</span> ${etat}
        <b class="terrain-libelle">${echapper(t.libelle)}</b>
        <span class="terrain-element">${t.chantier ? `🏗 ${echapper(`${t.chantier.code} ${t.chantier.libelle}`)}` : ''}${t.ordre ? ` · 🧩 ${echapper(t.ordre.numero ?? t.ordre.type)}` : ''}${t.service ? ` · ${echapper(t.service)}` : ''}</span></summary>
      <div class="terrain-detail">${lignes.join('') || '<p class="aide">Aucune information de terrain pour cette tâche.</p>'}</div>
    </details>`;
  }
}
