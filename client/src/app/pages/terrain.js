import { texte, texteHtml, pluriel, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { aujourdhui, ajouterJours, ACTION_DROIT } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { EcranEtapesAtelier } from '@logibtp/execution/ui';
import { ecrireDuree } from '@logibtp/pointage';
import { MODULE_FACULTATIF, TYPE_DOCUMENT, TYPE_FICHE } from '../codes.js';
import { echapper, lirePreferences, formatDate, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ETATS_TACHE, COULEURS_ETAT } from '../planning/etats.js';
import { NAVIGATIONS, lundiDe, mobileAffiche, lienItineraire, liensTexte, numeroTel, adressesAPrecharger, actionsTache, minutesPointees, tachesGardees, jourPointage, plansTache, plansTacheHtml, plansAPrecharger } from '../terrain/terrain.js';
import { PointageTerrain } from '../terrain/pointage-terrain.js';
import { SavTerrain } from '../terrain/sav-terrain.js';
import { DemandesTerrain } from '../terrain/demandes-terrain.js';
import { recevoirLivraison, pointerMateriel } from '../terrain/complements-terrain.js';
import { saisirAvancement, envoyerPhotos, signalerNonConformite, demanderApprovisionnement } from '../terrain/actions-tache.js';
import { fournisseurEtapes, OPERATION_TERRAIN, memoriserLimitePhotos, articlesAPrecharger } from '../terrain/operations-terrain.js';
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
// Évolutions du 01/11/2026 : raccourcis de la carte vers le pointage de la tâche et le fil du chantier, tâche pointée
// signalée (minutes du jour, ou journée gardée sur l'appareil), aujourd'hui encadré dans la semaine, liste défilante,
// actions soumises aux droits terrain/demande, avancement, materiel, livraison, onglet Mes demandes ; réglages
// (application de navigation, présaisie) dans les préférences (/parametres#terrain).

const ONGLETS = textesParCode('terrain_btp.page.onglets', ['jour', 'semaine', 'pointage', 'ordres', 'sav', 'demandes']);
const ICONES_ONGLET = { pointage: 'pointage_saisie', ordres: 'pointage_ordre', sav: 'terrain_btp_sav', demandes: 'terrain_btp_demande' };
/** Onglets sans période (pas de barre jour / semaine). */
const SANS_PERIODE = new Set(['ordres', 'sav', 'demandes']);
/** Nœud de droits et action de chaque action d'une tâche soumise à un droit propre. */
const DROITS_ACTION = { avancement: 'terrain/avancement', demande: 'terrain/demande', materiel: 'terrain/materiel', livraison: 'terrain/livraison' };

const jourDe = (instant) => instant.slice(0, 10);
const heureDe = (instant) => instant.slice(11, 16);
const nomJour = (jour) => { const [a, m, j] = jour.split('-').map(Number); return `${texte(`terrain_btp.page.jours.${new Date(Date.UTC(a, m - 1, j)).getUTCDay()}`)} ${formatDate(jour)}`; };
const taille = (o) => (o == null ? '' : o < 1048576 ? texte('terrain_btp.page.taille_ko', { taille: Math.max(1, Math.round(o / 1024)) }) : texte('terrain_btp.page.taille_mo', { taille: (o / 1048576).toFixed(1).replace('.', ',') }));

export class PageTerrain extends PageBase {
  icone = icone('terrain_btp_page');

  #modifiee = false;

  get modifiee() { return this.#modifiee; }

  async ouvrir() {
    this.titre = texte('terrain_btp.page.titre');
    // Onglets Ordres et SAV : module Exécution actif seulement ; SAV : droit à part, refusé par défaut (T20).
    const execution = this.app.moduleActif(MODULE_FACULTATIF.EXECUTION);
    // Mes demandes : droit de consulter terrain/demande.
    const permis = { ordres: execution, sav: execution && this.app.peut('execution/sav', ACTION_DROIT.CONSULTER), demandes: this.app.peut('terrain/demande', ACTION_DROIT.CONSULTER) };
    this.onglets = Object.fromEntries(Object.entries(ONGLETS).filter(([cle]) => !(cle in permis) || permis[cle]));
    this.gardees = new Set();
    this.onglet = this.onglets[this.requete.onglet] ? this.requete.onglet : 'jour';
    this.jour = /^\d{4}-\d{2}-\d{2}$/.test(this.requete.jour ?? '') ? this.requete.jour : aujourdhui();
    this.conteneur.innerHTML = `<div class="page-terrain" data-terrain>
      <nav class="terrain-onglets" role="tablist">${Object.entries(this.onglets).map(([cle, l]) => `<button type="button" role="tab" data-onglet="${cle}">${ICONES_ONGLET[cle] ? `${iconeHtml(ICONES_ONGLET[cle])} ` : ''}${echapper(l)}</button>`).join('')}</nav>
      <div class="terrain-periode" data-barre-periode><button type="button" data-decaler="-1" aria-label="${texteHtml('terrain_btp.page.precedente')}">${iconeHtml('precedent')}</button><b data-periode></b>
        <button type="button" data-decaler="1" aria-label="${texteHtml('terrain_btp.page.suivante')}">${iconeHtml('suivant')}</button><button type="button" data-aujourdhui>${texteHtml('terrain_btp.page.onglets.jour')}</button>
        <a class="terrain-bouton" href="/parametres#terrain" data-reglages aria-label="${texteHtml('terrain_btp.page.reglages')}" title="${texteHtml('terrain_btp.page.reglages')}">${iconeHtml('terrain_btp_reglages')}</a></div>
      <div data-attentes></div>
      <div class="terrain-liste" data-liste></div>
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
    // Actions d'une carte de tâche (pointage, avancement, photos, non-conformité, demande, matériel, livraison, fil).
    $('[data-liste]').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-action-tache]');
      if (!b) return;
      const t = this.donnees?.taches.find((x) => x.id === Number(b.dataset.tache));
      if (!t) return;
      if (b.dataset.actionTache === 'pointage') await aller(() => { this.onglet = 'pointage'; this.jour = b.dataset.jour; this.tacheAPointer = t.id; });
      else if (b.dataset.actionTache === 'fil') this.app.naviguer(`/crm/fil?type=${TYPE_FICHE.CHANTIER}&id=${t.chantier.id}`);
      else if (b.dataset.actionTache === 'avancement') await saisirAvancement(this.app, t);
      else if (b.dataset.actionTache === 'photos') await envoyerPhotos(this.app, t);
      else if (b.dataset.actionTache === 'nc') await signalerNonConformite(this.app, t, this.donnees.motifs ?? []);
      else if (b.dataset.actionTache === 'demande') await demanderApprovisionnement(this.app, t);
      else if (b.dataset.actionTache === 'livraison') await recevoirLivraison(this.app, t);
      else if (b.dataset.actionTache === 'materiel') await pointerMateriel(this.app, t);
      else if (b.dataset.actionTache === 'reception') this.app.naviguer(`/terrain/reception/${t.ordre.id}`);
    });
    this.desabonner = this.app.abonner(SUJET_ATTENTE, async () => {
      this.#rendreAttentes();
      if (this.donnees && (this.onglet === 'jour' || this.onglet === 'semaine')) { await this.#lireGardees(); this.#rendre(); }
    });
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
    zone.innerHTML = `${attente ? `<p class="carte">${iconeHtml('terrain_btp_attente')} ${echapper(pluriel('terrain_btp.page.attente', attente))}</p>` : ''}
      ${refusees.map((o) => `<div class="carte avertissement terrain-refus">${iconeHtml('terrain_btp_refus')} <b>${echapper(o.libelle)}</b> : ${texteHtml('terrain_btp.page.refus', { erreur: o.erreur ?? '' })}
        <span class="terrain-actions"><button type="button" class="terrain-bouton" data-reessayer="${echapper(o.cle)}">${iconeHtml('terrain_btp_reessayer')} ${texteHtml('terrain_btp.pointage.reessayer')}</button>
        <button type="button" class="terrain-bouton" data-abandonner="${echapper(o.cle)}">${iconeHtml('retirer')} ${texteHtml('terrain_btp.page.abandonner')}</button>
        ${o.url ? `<a class="terrain-bouton" href="${echapper(o.url)}">${texteHtml('terrain_btp.page.ouvrir')}</a>` : ''}</span></div>`).join('')}`;
    zone.querySelectorAll('[data-reessayer]').forEach((b) => b.addEventListener('click', async () => {
      await marquerOperation(b.dataset.reessayer, { etat: ETAT_ATTENTE.ATTENTE, erreur: null });
      this.app.publier(SUJET_ATTENTE, {});
      this.app.envoyerAttentes();
    }));
    zone.querySelectorAll('[data-abandonner]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmer(texte('terrain_btp.page.abandonner_confirmer')))) return;
      await retirerOperation(b.dataset.abandonner);
      this.app.publier(SUJET_ATTENTE, {});
    }));
  }

  /**
   * Préchargement (T10), une fois par jour et par compte, réseau joignable : les lectures de la période sont faites pour
   * que le service worker les garde, puis les pièces « Terrain » des tâches lues (taille limitée par le service worker)
   * et les plans cochés « Terrain » (budget à part).
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
    const lectures = [];
    const sav = this.app.moduleActif(MODULE_FACULTATIF.EXECUTION) && this.app.peut('execution/sav', ACTION_DROIT.CONSULTER);
    for (const url of adressesAPrecharger(jour, premier.personne.id, { demandes: this.app.peut('terrain/demande', ACTION_DROIT.CONSULTER), sav })) {
      const r = await lire(url);
      if (r?.taches) lectures.push(r);
      for (const t of r?.taches ?? []) for (const p of t.pieces ?? []) pieces.add(p.id);
    }
    for (const id of pieces) await fetch(api.terrain.urlPiece(id), { credentials: 'same-origin' }).catch(() => null);
    // Plans cochés « Terrain » : gardés par le service worker dans leur propre budget (pièces intactes).
    for (const id of plansAPrecharger(lectures)) await fetch(api.terrain.urlPlan(id), { credentials: 'same-origin' }).catch(() => null);
    // Articles des chantiers (bibliothèque simplifiée des demandes, terrain-suites lot 18).
    if (this.app.peut('terrain/demande', ACTION_DROIT.CONSULTER)) for (const url of articlesAPrecharger(lectures)) await lire(url);
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
    this.conteneur.querySelector('[data-periode]').textContent = du === au ? nomJour(du) : texte('terrain_btp.page.periode', { du: formatDate(du), au: formatDate(au) });
    this.app.routeur?.remplacerUrl(this.urlCourante());
    this.#modifiee = false;
    this.conteneur.querySelector('[data-barre-periode]').hidden = SANS_PERIODE.has(this.onglet);
    this.conteneur.querySelector('[data-liste]').scrollTop = 0;
    if (this.onglet === 'pointage') {
      const tache = this.tacheAPointer ?? null;
      this.tacheAPointer = null;
      await this.pointage.ouvrir(du, { tache });
      return;
    }
    if (this.onglet === 'demandes') { await new DemandesTerrain(this.conteneur.querySelector('[data-liste]'), { app: this.app }).ouvrir(); return; }
    if (this.onglet === 'sav') { await new SavTerrain(this.conteneur.querySelector('[data-liste]'), { app: this.app }).ouvrir(); return; }
    if (this.onglet === 'ordres') {
      await new EcranEtapesAtelier(this.conteneur.querySelector('[data-liste]'), fournisseurEtapes(this.app, () => api.terrain.etapes()), { titre: `${icone('pointage_ordre')} ${texte('terrain_btp.page.ordres')}`, message: (t, n) => this.app.message(t, n) }).ouvrir();
      return;
    }
    try {
      this.donnees = await api.terrain.taches(du, au);
      memoriserLimitePhotos(this.donnees.taille_max_photo);
      await this.#lireGardees();
    } catch (e) {
      if (!estHorsLigne(e)) { this.app.erreur(e); return; }
      this.donnees = null;
      this.conteneur.querySelector('[data-liste]').innerHTML = `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.page.hors_ligne')}</p>`;
      return;
    }
    this.#rendre();
  }

  /** Journées de pointage gardées sur l'appareil (pas encore envoyées) : leurs tâches sont signalées pointées. */
  async #lireGardees() {
    const ops = await listeOperations(this.app.utilisateur()).catch(() => []);
    this.gardees = tachesGardees(ops.filter((o) => o.type === OPERATION_TERRAIN.JOURNEE));
  }

  #rendre() {
    const d = this.donnees;
    if (!d) return;
    const liste = this.conteneur.querySelector('[data-liste]');
    if (!d.personne) {
      liste.innerHTML = `<p class="carte avertissement">${texteHtml('terrain_btp.page.sans_salarie')}</p>`;
      return;
    }
    if (this.onglet === 'jour') {
      liste.innerHTML = d.taches.length ? d.taches.map((t) => this.#carte(t, this.jour)).join('') : `<p class="terrain-vide">${texteHtml('terrain_btp.page.aucune_jour')}</p>`;
      return;
    }
    // Semaine : tâches regroupées par jour (une tâche de plusieurs jours sous chacun de ses jours) ; aujourd'hui encadré,
    // affiché même sans tâche, et amené en tête de la liste.
    const today = aujourdhui();
    const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(d.du, i));
    liste.innerHTML = jours.map((j) => {
      const taches = d.taches.filter((t) => t.debut < `${ajouterJours(j, 1)}T00:00` && t.fin > `${j}T00:00`);
      if (!taches.length && j !== today) return '';
      return `<section class="terrain-journee${j === today ? ' terrain-aujourdhui' : ''}"${j === today ? ' aria-current="date"' : ''}>
        <h2 class="terrain-jour">${echapper(nomJour(j))}${j === today ? ` <small>${texteHtml('terrain_btp.page.aujourdhui')}</small>` : ''}</h2>
        ${taches.length ? taches.map((t) => this.#carte(t, j)).join('') : `<p class="aide">${texteHtml('terrain_btp.page.aucune_jour')}</p>`}</section>`;
    }).join('') || `<p class="terrain-vide">${texteHtml('terrain_btp.page.aucune_semaine')}</p>`;
    const cadre = liste.querySelector('.terrain-aujourdhui');
    if (cadre && d.taches.length) liste.scrollTop = cadre.offsetTop - liste.offsetTop;
  }

  /** Droits des actions d'une tâche (pointage : droit de saisie de ses heures, fil : module CRM et son droit). */
  #droitsActions() {
    const a = this.app;
    return {
      ...Object.fromEntries(Object.entries(DROITS_ACTION).map(([cle, noeud]) => [cle, a.peut(noeud, ACTION_DROIT.CREER)])),
      pointage: a.peut('pointage', ACTION_DROIT.MODIFIER),
      fil: a.moduleActif(MODULE_FACULTATIF.CRM) && a.acces('crm'),
    };
  }

  /**
   * Carte d'une tâche affichée sous le jour `jour` : résumé (horaires, chantier, ordre, état, pointage du jour), détail
   * dépliable (lieu, contact, consignes, actions, plans en vigueur, pièces).
   */
  #carte(t, jour) {
    const m = mobileAffiche(t, this.donnees.chantiers);
    const plusieursJours = jourDe(t.debut) !== jourDe(t.fin.endsWith('T00:00') ? ajouterJours(jourDe(t.fin), -1) : t.fin);
    const horaires = plusieursJours ? `${formatDate(jourDe(t.debut))} ${heureDe(t.debut)} → ${formatDate(jourDe(t.fin))} ${heureDe(t.fin)}` : `${heureDe(t.debut)} – ${heureDe(t.fin)}`;
    const etat = t.etat ? `<span class="terrain-etat" style="--couleur:${COULEURS_ETAT[t.etat] ?? COULEURS_ETAT.OPTION}">${echapper(ETATS_TACHE[t.etat] ?? t.etat)}</span>` : '';
    // Pointage du jour : minutes enregistrées, sinon journée gardée sur l'appareil (envoyée au retour du réseau).
    const minutes = minutesPointees(t, jour);
    const gardee = !minutes && this.gardees.has(`${jour}|${t.id}`);
    const pointee = minutes ? `<span class="terrain-pointee" title="${texteHtml('terrain_btp.page.pointee_aide')}">${iconeHtml('pointage_saisie')} ${texteHtml('terrain_btp.page.pointee', { duree: ecrireDuree(minutes) })}</span>`
      : gardee ? `<span class="terrain-pointee gardee" title="${texteHtml('terrain_btp.page.pointee_gardee_aide')}">${iconeHtml('terrain_btp_attente')} ${texteHtml('terrain_btp.page.pointee_gardee')}</span>` : '';
    const today = aujourdhui();
    const droits = this.#droitsActions();
    if (t.debut.slice(0, 10) > today) droits.pointage = false;
    const actions = actionsTache(t, droits, { pose: t.ordre?.type === TYPE_DOCUMENT.E_PO });
    const jourPointer = jourPointage(t, jour, today);
    const herite = (c) => (c.herite ? ` <small class="aide">${texteHtml('terrain_btp.page.herite')}</small>` : '');
    const tel = m.telephone && numeroTel(m.telephone.valeur);
    const liens = liensTexte(m.liens);
    const lignes = [
      m.adresse && `<p class="terrain-ligne"><span>${iconeHtml('terrain_btp_adresse')} ${echapper(m.adresse.valeur)}${herite(m.adresse)}</span>
        <a class="terrain-bouton" href="${echapper(lienItineraire(m.adresse.valeur, this.#navigation(), navigator.userAgent))}" target="_blank" rel="noopener">${iconeHtml('terrain_btp_itineraire')} ${texteHtml('terrain_btp.page.itineraire')}</a></p>`,
      (m.contact || m.telephone) && `<p class="terrain-ligne"><span>${iconeHtml('terrain_btp_contact')} ${echapper(m.contact?.valeur ?? '')}${m.contact ? herite(m.contact) : ''}${m.telephone ? ` · ${echapper(m.telephone.valeur)}` : ''}</span>
        ${tel ? `<a class="terrain-bouton" href="tel:${echapper(tel)}">${iconeHtml('terrain_btp_appeler')} ${texteHtml('terrain_btp.page.appeler')}</a>` : ''}</p>`,
      m.commentaire && `<p class="terrain-consignes">${echapper(m.commentaire).replace(/\n/g, '<br>')}</p>`,
      liens.length && `<ul class="terrain-liens">${liens.map((l) => `<li>${l.url ? `<a href="${echapper(l.url)}" target="_blank" rel="noopener noreferrer">${iconeHtml('terrain_btp_lien')} ${echapper(l.libelle)}</a>` : echapper(l.texte)}</li>`).join('')}</ul>`,
      t.equipiers.length && `<p>${iconeHtml('pointage_equipe')} ${t.equipiers.map(echapper).join(', ')}</p>`,
      t.memo && `<p class="aide">${echapper(t.memo)}</p>`,
      actions.length && `<div class="terrain-actions">${actions
        .map((a) => `<button type="button" class="terrain-bouton" data-action-tache="${a}" data-tache="${t.id}"${a === 'pointage' ? ` data-jour="${jourPointer}"` : ''}>${iconeHtml(`terrain_btp_${a}`)} ${texteHtml(`terrain_btp.page.actions.${a}`)}</button>`).join('')}</div>`,
      plansTacheHtml(plansTache(t, this.donnees.plans), { url: (id) => api.terrain.urlPlan(id), taille }),
      t.pieces.length && `<div class="terrain-pieces"><b>${texteHtml('terrain_btp.page.pieces')}</b>${t.pieces.map((p) => `<a class="terrain-piece" href="${echapper(api.terrain.urlPiece(p.id))}" target="_blank" rel="noopener">
        ${iconeHtml('terrain_btp_piece')} <span>${echapper(p.titre)}</span><small class="aide">${echapper([p.nom_fichier, taille(p.taille)].filter(Boolean).join(' · '))}</small></a>`).join('')}</div>`,
    ].filter(Boolean);
    return `<details class="terrain-tache${minutes || gardee ? ' terrain-tache-pointee' : ''}" style="--couleur:${echapper(t.couleur ?? 'var(--terrain-tache)')}" ${this.onglet === 'jour' ? 'open' : ''}>
      <summary><span class="terrain-horaires">${echapper(horaires)}</span> ${etat} ${pointee}
        <b class="terrain-libelle">${echapper(t.libelle)}</b>
        <span class="terrain-element">${t.chantier ? `${iconeHtml('terrain_btp_chantier')} ${echapper(`${t.chantier.code} ${t.chantier.libelle}`)}` : ''}${t.ordre ? ` · ${iconeHtml('pointage_ordre')} ${echapper(t.ordre.numero ?? t.ordre.type)}` : ''}${t.service ? ` · ${echapper(t.service)}` : ''}</span></summary>
      <div class="terrain-detail">${lignes.join('') || `<p class="aide">${texteHtml('terrain_btp.page.sans_information')}</p>`}</div>
    </details>`;
  }
}
