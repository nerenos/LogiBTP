import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, actionDe, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { ECHELLES, versMinutes, depuisMinutes, debutUnite, periodeFlottante } from '@logibtp/planning';
import { VuePlanning } from '@logibtp/planning/ui';
import { ecrireDuree, lireDuree } from '@logibtp/pointage';
import { api } from '../api.js';
import { ecouter } from '../diffusion.js';

// Module Planning, lot 2 : page du planning (vue choisie, période flottante, échelle, zoom), panneau ancré à droite :
// tâches à planifier (budget − planifié par chantier et service, glissées sur une ligne) et détail de la tâche
// sélectionnée (saisie, affectations, aperçu du calcul). Calcul par le serveur (ReglesPlanning.cs ↔ calcul.js).

const ETATS = { OPTION: 'Option', PREVUE: 'Prévue', CONFIRMEE: 'Confirmée', EN_COURS: 'En cours', TERMINEE: 'Terminée' };
const MODES = { 1: 'Début + heures → fin', 2: 'Début + fin → heures', 3: 'Charge (heures ventilées)' };
const LARGEURS = { HEURE: 40, DEMI_JOUR: 60, JOUR: 48, SEMAINE: 90 };
const TYPE_GLISSER = 'application/x-logibtp-planning';
const COULEURS_SERVICE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be185d', '#4d7c0f', '#dc2626'];
const versLocal = (s) => (s ? s.slice(0, 16) : '');
const SYNCHRO = { TEMPS_REEL: 'Temps réel', 30: 'Toutes les 30 s', 60: 'Toutes les minutes', 300: 'Toutes les 5 min', PAUSE: 'En pause', MANUEL: 'Manuelle (⟳)' };

/** Saisie d'une tâche lue (pour la recréer ou la rétablir). */
const saisieDe = (t) => ({
  calcul: t.calcul, debut: t.debut, fin: t.fin, heures: t.heures, nb_ressources: t.nb_ressources, srv_id: t.srv_id, type_element: t.type_element,
  id_element: t.id_element, origine_type: t.origine_type, origine_id: t.origine_id, libelle: t.libelle, memo: t.memo, avancement: t.avancement,
  couleur: t.couleur, etat: t.etat, affectations: t.affectations.map((a) => ({ type: a.type, id: a.id, equipe_id: a.equipe_id, quantite: a.quantite })),
  habilitations: t.habilitations ?? [],
});

/** Remet une tâche dans un état lu auparavant (version courante relue). */
async function restaurer(id, etat) {
  const cur = await api.planning.tache(id);
  return api.planning.modifier(id, { ...saisieDe(etat), version: cur.version });
}

async function supprimerTache(id) {
  const cur = await api.planning.tache(id);
  await api.planning.supprimer(id, cur.version);
}
const options = (o) => Object.entries(o).map(([valeur, libelle]) => ({ valeur, libelle }));

/** Vue du planning du cœur : barres libellées par chantier, couleur par service, tâches théoriques hachurées. */
class VuePlanningBtp extends VuePlanning {
  regroupement = 'RESSOURCE';

  contenuBarre(t) {
    const code = t.element ? `<b>${echapper(t.element.code)}</b> ` : '';
    const res = this.regroupement !== 'RESSOURCE' && t.ressources?.length ? ` <small>· ${echapper(t.ressources.join(', '))}</small>` : '';
    return `${code}${echapper(t.libelle)}${res}`;
  }

  classeBarre(t) { return `${t.theorique ? 'theorique' : ''} etat-${String(t.etat).toLowerCase()}`; }

  /** Capacité des services (lot 4) : un bloc par jour coloré par le rapport planifié / capacité. */
  decorationsLigne(l) {
    if (!l.cle.startsWith('srv:') || !this.charge) return [];
    const h = (m) => ecrireDuree(m) || '0:00';
    return (this.charge.get(Number(l.cle.slice(4))) ?? []).map((c) => {
      const r = c.capacite ? c.planifie / c.capacite : (c.planifie ? 2 : 0);
      return {
        debut: versMinutes(c.date), fin: versMinutes(c.date) + 1440, classe: r > 1 ? 'charge-plein' : r >= 0.7 ? 'charge-moyen' : 'charge-ok',
        titre: `${c.date} : planifié ${h(c.planifie)} h · capacité ${h(c.capacite)} h · disponible ${c.disponible < 0 ? '−' : ''}${h(Math.abs(c.disponible))} h`,
        texte: `${Math.round(c.planifie / 60)}/${Math.round(c.capacite / 60)} h`,
      };
    });
  }

  titreBarre(t) {
    return `${t.element ? `${t.element.code} ${t.element.libelle}\n` : ''}${t.libelle} (${ETATS[t.etat] ?? t.etat})\n${depuisMinutes(t.debut).replace('T', ' ')} → ${depuisMinutes(t.fin).replace('T', ' ')}\n${ecrireDuree(t.heures)} h${t.ressources?.length ? `\n${t.ressources.join(', ')}` : ''}`;
  }
}

export class PagePlanning extends PageBase {
  icone = '📅';

  urlCourante() { return `/planning?${new URLSearchParams(Object.entries({ vue: this.vue, du: this.du, consultation: this.consultation ? '1' : '' }).filter(([, v]) => v))}`; }

  async ouvrir() {
    this.titre = 'Planning';
    this.conteneur.innerHTML = `<div class="page-planning"><div class="barre-planning ligne">
        <b>📅</b> <span data-vue></span>
        <button type="button" data-prec title="Période précédente">◀</button><button type="button" data-aujourdhui>Aujourd'hui</button><button type="button" data-suiv title="Période suivante">▶</button>
        <span data-periode class="aide"></span> <span data-echelle></span>
        <button type="button" data-zoom="0.8" title="Zoom arrière">－</button><button type="button" data-zoom="1.25" title="Zoom avant">＋</button>
        <input type="search" data-recherche placeholder="Ressource…" size="14"> <button type="button" data-actualiser title="Actualiser">⟳</button>
        <button type="button" data-nouvelle>＋ Tâche</button> <button type="button" data-annuler title="Annuler (Ctrl+Z)" disabled>↶</button><button type="button" data-retablir title="Rétablir (Ctrl+Y)" disabled>↷</button>
        <span data-synchro></span> <button type="button" data-attente class="badge-exception" hidden title="Modifications des autres utilisateurs : actualiser"></button>
        <a data-lien-consultation title="Ouvrir la vue en consultation (lecture seule, actualisée en temps réel)">👁 Consultation</a> <button type="button" data-plein-ecran hidden>⛶ Plein écran</button>
        <span class="aide" data-etat></span></div>
      <div class="planning-corps"><div class="zone-planning" data-planning></div>
        <aside class="panneau-planning"><div class="onglets ligne"><button type="button" data-onglet="aplanifier" class="actif">À planifier</button><button type="button" data-onglet="tache">Tâche</button><button type="button" data-onglet="alertes">Alertes <span data-nb-alertes></span></button></div>
          <div data-panneau="aplanifier"></div><div data-panneau="tache" hidden></div><div data-panneau="alertes" hidden></div></aside></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-planning]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const c = this.conteneur;
    this.consultation = this.requete.consultation === '1';
    this.historique = [];
    this.refaire = [];
    this.attente = 0;
    [this.vues, this.ref] = await Promise.all([api.planning.vues(), api.planning.referentiels()]);
    this.vue = this.requete.vue ?? this.vues[0]?.code;
    this.couleurs = new Map(this.ref.services.map((s, i) => [s.id, COULEURS_SERVICE[i % COULEURS_SERVICE.length]]));
    const comboVue = creerCombo({ options: this.vues.map((v) => ({ valeur: v.code, libelle: v.libelle })), valeur: this.vue, vide: false, titre: 'Vue' });
    c.querySelector('[data-vue]').append(comboVue);
    comboVue.addEventListener('change', () => { this.vue = comboVue.valeurCombo; this.du = null; this.#definition(); this.#charger(); });
    this.comboEchelle = creerCombo({ options: Object.entries(ECHELLES).map(([valeur, e]) => ({ valeur, libelle: e.libelle })), valeur: 'JOUR', vide: false, titre: 'Échelle' });
    c.querySelector('[data-echelle]').append(this.comboEchelle);
    this.comboEchelle.addEventListener('change', () => this.planning.regler({ echelle: this.comboEchelle.valeurCombo, largeurColonne: LARGEURS[this.comboEchelle.valeurCombo] }));
    c.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => this.planning.zoomer(Number(b.dataset.zoom))));
    c.querySelector('[data-prec]').addEventListener('click', () => this.#decaler(-1));
    c.querySelector('[data-suiv]').addEventListener('click', () => this.#decaler(1));
    c.querySelector('[data-aujourdhui]').addEventListener('click', () => { this.du = null; this.#definition(); this.#charger(); });
    c.querySelector('[data-actualiser]').addEventListener('click', () => this.#charger());
    c.querySelector('[data-recherche]').addEventListener('change', (e) => { this.recherche = e.target.value; this.#charger(); });
    c.querySelector('[data-nouvelle]').addEventListener('click', () => this.#editer(null));
    c.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => this.#onglet(b.dataset.onglet)));
    this.#preparerSynchro();
    this.#preparerHistorique();
    if (this.consultation) {
      c.querySelectorAll('[data-nouvelle], [data-annuler], [data-retablir], [data-synchro], [data-lien-consultation], .panneau-planning').forEach((x) => { x.hidden = true; });
      const plein = c.querySelector('[data-plein-ecran]');
      plein.hidden = false;
      plein.addEventListener('click', () => c.querySelector('.page-planning').requestFullscreen?.());
    }
    this.planning = new VuePlanningBtp(c.querySelector('[data-planning]'), {
      debut: 0, fin: 1440, lecture: this.consultation, actions: {
        deplacer: (p) => this.#deplacer(p),
        scinder: (p) => this.#scinder(p),
        selection: (t) => { if (t) this.#editer(t.tache); },
        ouvrir: (t) => { this.#editer(t.tache); this.#onglet('tache'); },
        deposer: (e, p) => this.#deposer(e, p),
      },
    });
    this.du = this.requete.du ?? null;
    this.#definition();
    await this.#charger();
    await this.#aPlanifier();
  }

  fermer() {
    this.desabonner?.();
    clearInterval(this.intervalle);
    clearTimeout(this.minuterie);
    document.removeEventListener('keydown', this.clavier);
  }

  /** Synchronisation (P10) : temps réel, intervalle, pause ou manuelle (préférence du navigateur) ; consultation : temps réel. */
  #preparerSynchro() {
    const c = this.conteneur;
    this.synchro = this.consultation ? 'TEMPS_REEL' : String(lirePreferences().planningSynchro ?? 'TEMPS_REEL');
    const combo = creerCombo({ options: Object.entries(SYNCHRO).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: this.synchro, vide: false, titre: 'Synchronisation' });
    c.querySelector('[data-synchro]').append(combo);
    const appliquer = () => {
      clearInterval(this.intervalle);
      const n = Number(this.synchro);
      if (n) this.intervalle = setInterval(() => { if (this.attente) this.#charger(); }, n * 1000);
      if (this.synchro === 'TEMPS_REEL' && this.attente) this.#charger();
    };
    combo.addEventListener('change', () => { this.synchro = combo.valeurCombo; ecrirePreferences({ planningSynchro: this.synchro }); appliquer(); });
    c.querySelector('[data-attente]').addEventListener('click', () => this.#charger());
    c.querySelector('[data-lien-consultation]').addEventListener('click', (e) => {
      e.preventDefault();
      this.app.naviguer(`/planning?${new URLSearchParams(Object.entries({ vue: this.vue, du: this.du, consultation: '1' }).filter(([, v]) => v))}`, { nouvelleFenetre: true });
    });
    this.desabonner = ecouter('planning', () => {
      this.attente++;
      if (this.synchro === 'TEMPS_REEL') { clearTimeout(this.minuterie); this.minuterie = setTimeout(() => this.#charger(), 400); } else this.#majAttente();
    });
    appliquer();
  }

  #majAttente() {
    const b = this.conteneur.querySelector('[data-attente]');
    b.hidden = !this.attente || this.consultation;
    b.textContent = `⟳ ${this.attente} modification${this.attente > 1 ? 's' : ''}`;
  }

  /** Annuler / rétablir (lot 3) : opérations de la session, rejouées par l'API (versions relues). */
  #preparerHistorique() {
    const c = this.conteneur;
    c.querySelector('[data-annuler]').addEventListener('click', () => this.#annuler());
    c.querySelector('[data-retablir]').addEventListener('click', () => this.#retablir());
    this.clavier = (e) => {
      if (this.consultation || !this.conteneur.isConnected || e.target.closest?.('input, textarea, [contenteditable]')) return;
      const action = actionDe(e, 'planning');
      if (!action) return;
      e.preventDefault();
      const b = this.planning?.selection;
      if (action === 'annuler') this.#annuler();
      else if (action === 'retablir') this.#retablir();
      else if (action === 'actualiser') this.#charger();
      else if (action === 'supprimer' && b && confirm('Supprimer la tâche sélectionnée ?')) this.#supprimer(b.tache);
      else if (action === 'dupliquer' && b) this.#deplacer({ tache: b, debut: b.debut, fin: b.fin, ligne: b.ligne, copie: true });
    };
    document.addEventListener('keydown', this.clavier);
  }

  #memoriser(entree) {
    this.historique.push(entree);
    if (this.historique.length > 50) this.historique.shift();
    this.refaire = [];
    this.#majHistorique();
  }

  #majHistorique() {
    const c = this.conteneur;
    const a = this.historique.at(-1);
    const r = this.refaire.at(-1);
    c.querySelector('[data-annuler]').disabled = !a;
    c.querySelector('[data-annuler]').title = a ? `Annuler : ${a.libelle} (Ctrl+Z)` : 'Annuler (Ctrl+Z)';
    c.querySelector('[data-retablir]').disabled = !r;
    c.querySelector('[data-retablir]').title = r ? `Rétablir : ${r.libelle} (Ctrl+Y)` : 'Rétablir (Ctrl+Y)';
  }

  async #annuler() {
    const e = this.historique.pop();
    if (!e) return;
    await this.#apres(e.annuler(), `Annulé : ${e.libelle}`);
    this.refaire.push(e);
    this.#majHistorique();
  }

  async #retablir() {
    const e = this.refaire.pop();
    if (!e) return;
    await this.#apres(e.retablir(), `Rétabli : ${e.libelle}`);
    this.historique.push(e);
    this.#majHistorique();
  }

  /** Modification d'une tâche existante, mémorisée (état avant, état après). */
  async #modifierMemorise(id, libelle, operation) {
    const avant = await api.planning.tache(id).catch(() => null);
    const apres = await this.#apres(operation());
    if (!avant || !apres) return apres;
    const ref = { id: apres.id ?? id };
    if (apres.id && apres.id !== id) this.#memoriserCreation(apres, libelle);
    else this.#memoriser({ libelle, annuler: () => restaurer(ref.id, avant), retablir: () => restaurer(ref.id, apres) });
    return apres;
  }

  #memoriserCreation(t, libelle) {
    const ref = { id: t.id };
    this.#memoriser({ libelle, annuler: () => supprimerTache(ref.id), retablir: async () => { ref.id = (await api.planning.creer(saisieDe(t))).id; } });
  }

  async #supprimer(id) {
    const avant = await api.planning.tache(id).catch(() => null);
    const ok = await this.#apres(supprimerTache(id).then(() => true), 'Tâche supprimée');
    if (!ok || !avant) return;
    const ref = { id };
    this.#memoriser({ libelle: 'suppression', annuler: async () => { ref.id = (await api.planning.creer(saisieDe(avant))).id; }, retablir: () => supprimerTache(ref.id) });
    this.conteneur.querySelector('[data-panneau="tache"]').innerHTML = '';
  }

  #definition() {
    const d = this.vues.find((v) => v.code === this.vue)?.definition ?? { regroupement: 'RESSOURCE', echelle: 'JOUR', avant: 7, apres: 21 };
    this.definition = d;
    const jours = d.avant + d.apres + 1;
    const p = this.du ? { debut: versMinutes(this.du), fin: versMinutes(this.du) + jours * 1440 } : periodeFlottante(new Date().toISOString().slice(0, 10), d.avant, d.apres);
    this.periode = p;
    this.comboEchelle.definirValeur(d.echelle);
    this.planning.regroupement = d.regroupement;
    this.planning.regler({ debut: p.debut, fin: p.fin, echelle: d.echelle, largeurColonne: LARGEURS[d.echelle], hauteurAdaptee: d.hauteur_adaptee !== false });
  }

  #decaler(sens) {
    const jours = this.definition.avant + this.definition.apres + 1;
    this.du = depuisMinutes(this.periode.debut + sens * Math.max(7, Math.round(jours / 2)) * 1440).slice(0, 10);
    this.#definition();
    this.#charger();
  }

  async #charger() {
    this.attente = 0;
    this.#majAttente();
    this.app.routeur.remplacerUrl(this.urlCourante());
    const p = this.periode;
    this.conteneur.querySelector('[data-periode]').textContent = `${depuisMinutes(p.debut).slice(0, 10)} → ${depuisMinutes(p.fin - 1).slice(0, 10)}`;
    let d;
    try { d = await api.planning.donnees({ vue: this.vue, du: depuisMinutes(p.debut), au: depuisMinutes(p.fin), recherche: this.recherche }); } catch (e) { this.app.erreur(e); return; }
    this.lignes = d.lignes.map((l) => ({ ...l, ligneFixe: this.definition.regroupement !== 'RESSOURCE' ? false : l.ligne_fixe }));
    this.barres = d.barres.map((b) => ({ ...b, debut: versMinutes(b.debut), fin: versMinutes(b.fin), couleur: b.couleur || this.couleurs.get(b.srv_id) }));
    const charge = await api.planning.charge({ vue: this.vue, du: depuisMinutes(p.debut), au: depuisMinutes(p.fin) }).catch(() => null);
    this.planning.charge = new Map();
    for (const c of charge?.services ?? []) {
      if (!this.planning.charge.has(c.srv_id)) this.planning.charge.set(c.srv_id, []);
      this.planning.charge.get(c.srv_id).push(c);
    }
    this.planning.definirDonnees(this.lignes, this.barres);
    if (!this.consultation) this.#alertes();
    this.conteneur.querySelector('[data-etat]').textContent = `${this.lignes.length} lignes · ${new Set(this.barres.map((b) => b.tache)).size} tâches`;
    if (!this.centre) { this.centre = true; this.planning.allerA(versMinutes(new Date().toISOString().slice(0, 16))); }
  }

  #onglet(nom) {
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === nom));
    this.conteneur.querySelectorAll('[data-panneau]').forEach((p) => { p.hidden = p.dataset.panneau !== nom; });
  }

  async #apres(promesse, message) {
    try {
      const r = await promesse;
      if (message) this.app.message(message, 'succes');
      await this.#charger();
      await this.#aPlanifier();
      return r;
    } catch (e) {
      this.app.erreur(e);
      await this.#charger();
      return null;
    }
  }

  /** Glisser une barre : déplacement, redimensionnement (bord), changement de ressource, copie (Ctrl). */
  async #deplacer({ tache: b, debut, fin, ligne, copie }) {
    if (this.definition.regroupement !== 'RESSOURCE' && ligne !== b.ligne) { this.app.message('Changer de ligne n\'est possible que dans une vue par ressources', 'avertissement'); return false; }
    if (this.definition.regroupement === 'RESSOURCE' && ligne !== b.ligne && (b.theorique || ligne.startsWith('srv:'))) {
      this.app.message('Affecter une tâche théorique : depuis le détail de la tâche', 'avertissement');
      return false;
    }
    const mode = debut - b.debut === fin - b.fin ? 'deplacer' : debut !== b.debut ? 'debut' : 'fin';
    const operation = () => api.planning.deplacer(b.tache, { debut: depuisMinutes(debut), fin: depuisMinutes(fin), mode, de: b.ligne, vers: ligne, copie, version: b.version });
    if (copie) {
      const r = await this.#apres(operation(), 'Tâche copiée');
      if (r) this.#memoriserCreation(r, 'copie');
    } else await this.#modifierMemorise(b.tache, mode === 'deplacer' ? 'déplacement' : 'redimensionnement', operation);
    return false;
  }

  async #scinder({ tache: b, instant }) {
    if (instant <= b.debut || instant >= b.fin) return;
    const avant = await api.planning.tache(b.tache).catch(() => null);
    const r = await this.#apres(api.planning.scinder(b.tache, { instant: depuisMinutes(instant), version: b.version }), 'Tâche scindée');
    if (!r || !avant) return;
    const premiere = { id: r.premiere.id };
    const seconde = { id: r.seconde.id };
    this.#memoriser({
      libelle: 'scission',
      annuler: async () => { await supprimerTache(seconde.id); await restaurer(premiere.id, avant); },
      retablir: async () => {
        const cur = await api.planning.tache(premiere.id);
        seconde.id = (await api.planning.scinder(premiere.id, { instant: depuisMinutes(instant), version: cur.version })).seconde.id;
      },
    });
  }

  /** Dépôt d'un élément à planifier : tâche en mode 1 (au plus une semaine de 35 h, modifiable), sur la ressource ou le service. */
  async #deposer(e, { ligne, instant }) {
    const brut = e.dataTransfer.getData(TYPE_GLISSER);
    if (!brut || !ligne) return;
    const x = JSON.parse(brut);
    const ressource = ligne.cle.includes(':') && !ligne.cle.startsWith('srv:') && !ligne.cle.startsWith('chantier:') ? ligne.cle.split(':') : null;
    const srv = ligne.srv_id ?? x.srv_id;
    const r = await this.#apres(api.planning.creer({
      calcul: 1, debut: depuisMinutes(instant), heures: Math.max(15, Math.min(x.reste, 2100)), nb_ressources: 1, srv_id: srv, type_element: 'chantier', id_element: x.id,
      libelle: `${x.service ?? 'Travaux'}`, affectations: ressource ? [{ type: ressource[0], id: ressource[1] }] : [],
    }), 'Tâche planifiée');
    if (r) this.#memoriserCreation(r, 'planification');
  }

  async #aPlanifier() {
    const zone = this.conteneur.querySelector('[data-panneau="aplanifier"]');
    let l;
    try { l = await api.planning.aPlanifier({ services: (this.definition.services ?? []).join(',') }); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    zone.innerHTML = l.length ? `<p class="aide">Glisser une ligne sur une ressource (ou un service) : début au point de dépôt.</p>
      <table class="pleine-largeur"><thead><tr><th>Chantier</th><th>Service</th><th class="nombre">Budget</th><th class="nombre">Planifié</th><th class="nombre">Reste</th></tr></thead><tbody>
      ${l.map((x, i) => `<tr draggable="${x.reste > 0}" data-i="${i}" class="${x.reste > 0 ? 'glissable' : 'aide'}" title="${echapper(x.libelle)}"><td>${echapper(x.code)}</td><td>${echapper(x.service ?? '')}</td>
        <td class="nombre">${ecrireDuree(x.budget)}</td><td class="nombre">${ecrireDuree(x.planifie)}</td><td class="nombre ${x.reste < 0 ? 'erreur' : ''}">${ecrireDuree(Math.abs(x.reste))}${x.reste < 0 ? ' dépassé' : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucune heure à planifier (commandes validées des chantiers ouverts).</p>';
    zone.querySelectorAll('tr[draggable="true"]').forEach((tr) => tr.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(TYPE_GLISSER, JSON.stringify(l[Number(tr.dataset.i)]));
      e.dataTransfer.effectAllowed = 'copy';
    }));
  }

  /** Alertes calculées (lot 4) regroupées par type, avec actions : aller à la tâche, appliquer l'équipe, vue, traitée. */
  async #alertes() {
    const zone = this.conteneur.querySelector('[data-panneau="alertes"]');
    const p = this.periode;
    let l;
    try { l = await api.planning.notifications({ vue: this.vue, du: depuisMinutes(p.debut), au: depuisMinutes(p.fin) }); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const importantes = l.filter((n) => n.niveau !== 'INFO' && n.etat !== 'VUE').length;
    this.conteneur.querySelector('[data-nb-alertes]').textContent = importantes ? `(${importantes})` : '';
    const TYPES = { SUROCCUPATION: '⛔ Sur-occupation', HABILITATION: '🎓 Habilitations', MATERIEL: '🧱 Matériel', EQUIPE: '👥 Équipes', SOUSOCCUPATION: '💤 Sous-occupation' };
    zone.innerHTML = l.length ? Object.entries(TYPES).filter(([t]) => l.some((n) => n.type === t)).map(([t, titre]) => {
      const n = l.filter((x) => x.type === t);
      return `<details ${t === 'SOUSOCCUPATION' ? '' : 'open'}><summary><b>${titre}</b> (${n.length}) <button type="button" data-tout-traiter="${t}" title="Marquer toutes traitées">✔ tout</button></summary><ul class="alertes-planning">
        ${n.map((x) => `<li class="${x.etat === 'VUE' ? 'vue' : ''}" data-cle="${echapper(x.cle)}">${echapper(x.message)}<br>
          ${x.tache ? `<button type="button" data-aller="${x.tache}">Aller</button>` : ''}${x.action === 'APPLIQUER_EQUIPE' ? ` <button type="button" data-equipe="${x.tache}:${x.equipe}">Appliquer la composition</button>` : ''}
          ${x.etat === 'VUE' ? '' : ' <button type="button" data-vue>Vue</button>'} <button type="button" data-traitee>Traitée</button></li>`).join('')}</ul></details>`;
    }).join('') : '<p class="aide">Aucune alerte sur la période.</p>';
    const marquer = async (cles, etat) => { try { await api.planning.marquerNotifications({ cles, etat }); await this.#alertes(); } catch (e) { this.app.erreur(e); } };
    zone.querySelectorAll('li[data-cle]').forEach((li) => {
      li.querySelector('[data-vue]')?.addEventListener('click', () => marquer([li.dataset.cle], 'VUE'));
      li.querySelector('[data-traitee]').addEventListener('click', () => marquer([li.dataset.cle], 'TRAITEE'));
      li.querySelector('[data-aller]')?.addEventListener('click', (e) => {
        const b = this.barres.find((x) => String(x.tache) === e.target.dataset.aller);
        if (b) { this.planning.selection = b; this.planning.allerA(b.debut); this.planning.actualiser(); }
        this.#editer(Number(e.target.dataset.aller));
      });
      li.querySelector('[data-equipe]')?.addEventListener('click', async (e) => {
        const [tache, equipe] = e.target.dataset.equipe.split(':').map(Number);
        const cur = await api.planning.tache(tache);
        await this.#modifierMemorise(tache, 'composition d\'équipe', () => api.planning.appliquerEquipe(tache, equipe, cur.version));
      });
    });
    zone.querySelectorAll('[data-tout-traiter]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      marquer(l.filter((x) => x.type === b.dataset.toutTraiter).map((x) => x.cle), 'TRAITEE');
    }));
  }

  /** Détail d'une tâche (ou nouvelle tâche) dans le panneau : saisie, affectations, aperçu, enregistrement. */
  async #editer(id) {
    const zone = this.conteneur.querySelector('[data-panneau="tache"]');
    let t;
    if (id) {
      try { t = await api.planning.tache(id); } catch (e) { this.app.erreur(e); return; }
    } else {
      const debut = depuisMinutes(debutUnite(versMinutes(new Date().toISOString().slice(0, 10)), 'JOUR') + 1440 + 480);
      t = { id: null, calcul: 1, debut, fin: null, heures: 420, nb_ressources: 1, srv_id: null, type_element: 'chantier', id_element: null, libelle: '', memo: '', avancement: 0, couleur: null, etat: 'PREVUE', affectations: [] };
      this.#onglet('tache');
    }
    const elements = await api.planning.elements().catch(() => []);
    if (t.element && !elements.some((e) => e.id === t.id_element)) elements.unshift(t.element);
    zone.innerHTML = `<h3>${t.id ? `Tâche n° ${t.id}` : 'Nouvelle tâche'}</h3>
      <p><label>Libellé <input data-libelle size="30" value="${echapper(t.libelle)}"></label></p>
      <p class="ligne">Chantier <span data-element></span></p><p class="ligne">Service <span data-service></span></p>
      <p class="ligne">Calcul <span data-mode></span></p>
      <p><label>Début <input type="datetime-local" data-debut value="${versLocal(t.debut)}"></label></p>
      <p><label>Fin <input type="datetime-local" data-fin value="${versLocal(t.fin)}"></label></p>
      <p class="ligne"><label>Heures <input data-heures size="7" value="${ecrireDuree(t.heures)}"></label> <label>Ressources (charge) <input type="number" data-nb min="1" size="3" value="${t.nb_ressources}"></label></p>
      <p class="ligne">État <span data-etat-tache></span> <label>Couleur <input type="color" data-couleur value="${t.couleur ?? '#3b82f6'}"></label> <label><input type="checkbox" data-sans-couleur ${t.couleur ? '' : 'checked'}> par service</label></p>
      <p><label>Avancement <input type="number" data-avancement min="0" max="100" size="3" value="${t.avancement}"> %</label></p>
      <p><textarea data-memo rows="2" cols="34" placeholder="Mémo">${echapper(t.memo ?? '')}</textarea></p>
      <h4>Affectations</h4><ul data-affectations></ul>
      <p class="ligne"><input type="search" data-cherche-res placeholder="Chercher une ressource…" size="18"> <span data-ressource></span> <button type="button" data-ajouter-res>＋</button></p>
      <p class="ligne">Équipe <span data-equipe></span> <button type="button" data-ajouter-equipe>＋</button></p>
      <h4>Habilitations exigées</h4><p class="ligne" data-habilitations></p><p class="ligne"><span data-habilitation></span> <button type="button" data-ajouter-hab>＋</button></p>
      <p><button type="button" data-creneau title="Première plage libre de la première ressource affectée, sinon d'une ressource habilitée du service">🔎 Premier créneau libre</button> <span data-proposition class="aide"></span></p>
      <p><button type="button" data-apercu>Aperçu du calcul</button> <button type="button" data-enregistrer>Enregistrer</button>
        ${t.id ? '<button type="button" data-supprimer>Supprimer</button>' : ''}</p><div data-resultat class="aide"></div>
      ${t.maj_par ? `<p class="aide">Modifiée par ${echapper(t.maj_par)}</p>` : ''}`;
    const affs = t.affectations.map((a) => ({ ...a }));
    const habs = [...(t.habilitations ?? [])];
    const combo = (cle, opts, valeur, vide = true) => { const c = creerCombo({ options: opts, valeur: valeur ?? '', vide }); zone.querySelector(`[data-${cle}]`).append(c); return c; };
    const element = combo('element', elements.map((e) => ({ valeur: e.id, libelle: `${e.code} ${e.libelle}` })), t.id_element);
    const service = combo('service', this.ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle })), t.srv_id);
    const mode = combo('mode', options(MODES), String(t.calcul), false);
    const etat = combo('etat-tache', options(ETATS), t.etat, false);
    const equipe = combo('equipe', this.ref.equipes.map((e) => ({ valeur: e.id, libelle: e.libelle, detail: e.code })), '');
    let ressource = combo('ressource', [], '');
    const rendreAffs = () => {
      zone.querySelector('[data-affectations]').innerHTML = affs.length ? affs.map((a, i) => `<li>${echapper(a.libelle ?? `${a.type} ${a.id}`)}${a.heures ? ` <span class="aide">${ecrireDuree(a.heures)} h</span>` : ''}${a.equipe_id ? ' <small class="aide">équipe</small>' : ''}
        <button type="button" data-retirer="${i}" title="Retirer">✕</button></li>`).join('') : '<li class="aide">Aucune : tâche théorique (charge du service)</li>';
      zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { affs.splice(Number(b.dataset.retirer), 1); rendreAffs(); }));
    };
    rendreAffs();
    const comboHab = combo('habilitation', this.ref.habilitations.map((h) => ({ valeur: h.code, libelle: h.libelle, detail: h.code })), '');
    const rendreHabs = () => {
      zone.querySelector('[data-habilitations]').innerHTML = habs.length ? habs.map((h, i) => `<span class="badge-exception">${echapper(this.ref.habilitations.find((x) => x.code === h)?.libelle ?? h)} <button type="button" data-retirer-hab="${i}">✕</button></span>`).join(' ') : '<span class="aide">Aucune</span>';
      zone.querySelectorAll('[data-retirer-hab]').forEach((b) => b.addEventListener('click', () => { habs.splice(Number(b.dataset.retirerHab), 1); rendreHabs(); }));
    };
    rendreHabs();
    zone.querySelector('[data-ajouter-hab]').addEventListener('click', () => { if (comboHab.valeurCombo && !habs.includes(comboHab.valeurCombo)) { habs.push(comboHab.valeurCombo); rendreHabs(); } });
    zone.querySelector('[data-creneau]').addEventListener('click', async () => {
      const premiere = affs.find((a) => a.type !== 'EQUIPE' && a.capacite !== false);
      const heures = lireDuree(zone.querySelector('[data-heures]').value) || 60;
      try {
        const r = await api.planning.creneau({
          ressource: premiere ? `${premiere.type}:${premiere.id}` : null, service: premiere ? null : service.valeurCombo, heures,
          apres: zone.querySelector('[data-debut]').value || depuisMinutes(versMinutes(new Date().toISOString().slice(0, 16))), habilitations: habs.join(','),
        });
        const prop = zone.querySelector('[data-proposition]');
        if (!r) { prop.textContent = 'Aucun créneau sur l\'horizon (ressource habilitée et libre).'; return; }
        prop.innerHTML = `${echapper(r.libelle)} : ${r.debut.replace('T', ' ')} → ${r.fin.replace('T', ' ')} <button type="button" data-prendre>Prendre</button>`;
        prop.querySelector('[data-prendre]').addEventListener('click', () => {
          zone.querySelector('[data-debut]').value = r.debut;
          if (!premiere) { const [type, idr] = r.ressource.split(':'); affs.push({ type, id: idr, libelle: r.libelle }); rendreAffs(); }
        });
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-cherche-res]').addEventListener('change', async (e) => {
      const l = await api.planning.ressources({ recherche: e.target.value, services: '' }).catch(() => []);
      const nouveau = creerCombo({ options: l.slice(0, 200).map((r) => ({ valeur: `${r.type}:${r.id}`, libelle: r.libelle, detail: r.service ?? r.type })), valeur: '', vide: true });
      ressource.replaceWith(nouveau);
      ressource = nouveau;
      ressource.libelles = new Map(l.map((r) => [`${r.type}:${r.id}`, r.libelle]));
    });
    zone.querySelector('[data-ajouter-res]').addEventListener('click', () => {
      const v = ressource.valeurCombo;
      if (!v || affs.some((a) => `${a.type}:${a.id}` === v)) return;
      const [type, idr] = v.split(':');
      affs.push({ type, id: idr, libelle: ressource.libelles?.get(v) });
      rendreAffs();
    });
    zone.querySelector('[data-ajouter-equipe]').addEventListener('click', () => {
      if (!equipe.valeurCombo) return;
      affs.push({ type: 'EQUIPE', id: String(equipe.valeurCombo), libelle: `Équipe ${this.ref.equipes.find((e) => String(e.id) === String(equipe.valeurCombo))?.libelle ?? ''} (membres à la date)` });
      rendreAffs();
    });
    const saisie = () => {
      const v = (s) => zone.querySelector(s);
      const m = Number(mode.valeurCombo);
      return {
        calcul: m, debut: v('[data-debut]').value, fin: m === 1 ? null : v('[data-fin]').value || null, heures: m === 2 ? null : lireDuree(v('[data-heures]').value),
        nb_ressources: Number(v('[data-nb]').value) || 1, srv_id: service.valeurCombo ? Number(service.valeurCombo) : null, type_element: 'chantier',
        id_element: element.valeurCombo ? String(element.valeurCombo) : null, libelle: v('[data-libelle]').value, memo: v('[data-memo]').value || null,
        avancement: Number(v('[data-avancement]').value) || 0, couleur: v('[data-sans-couleur]').checked ? null : v('[data-couleur]').value, etat: etat.valeurCombo,
        affectations: affs.map((a) => ({ type: a.type, id: a.id, equipe_id: a.equipe_id ?? null, quantite: a.quantite ?? null })), version: t.version, habilitations: habs,
      };
    };
    zone.querySelector('[data-apercu]').addEventListener('click', async () => {
      try {
        const r = await api.planning.calculer(saisie());
        zone.querySelector('[data-resultat]').textContent = r.erreurs.length ? r.erreurs.join(', ')
          : `Fin ${r.fin?.replace('T', ' ')} · ${ecrireDuree(r.heures)} h${Object.keys(r.par_ressource).length ? ` · ${Object.entries(r.par_ressource).map(([k, m]) => `${affs.find((a) => `${a.type}:${a.id}` === k)?.libelle ?? k} ${ecrireDuree(m)}`).join(', ')}` : ''}`;
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      let r;
      if (t.id) r = await this.#modifierMemorise(t.id, 'modification', () => api.planning.modifier(t.id, saisie()));
      else {
        r = await this.#apres(api.planning.creer(saisie()), 'Tâche enregistrée');
        if (r) this.#memoriserCreation(r, 'nouvelle tâche');
      }
      if (r) this.#editer(r.id);
    });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (confirm('Supprimer cette tâche ?')) await this.#supprimer(t.id);
    });
  }
}
