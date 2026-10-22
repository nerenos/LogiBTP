import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, actionDe, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { ECHELLES, versMinutes, depuisMinutes, debutUnite, periodeFlottante, aujourdhui } from '@logibtp/planning';
import { VuePlanning } from '@logibtp/planning/ui';
import { ecrireDuree, lireDuree } from '@logibtp/pointage';
import { api } from '../api.js';
import { ecouter } from '../diffusion.js';

// Module Planning, lot 2 : page du planning (vue choisie, période flottante, échelle, zoom), panneau ancré à droite :
// tâches à planifier (budget − planifié par chantier et service, glissées sur une ligne) et détail de la tâche
// sélectionnée (saisie, affectations, aperçu du calcul). Calcul par le serveur (ReglesPlanning.cs ↔ calcul.js).

const ETATS = { OPTION: 'Option', PREVUE: 'Prévue', CONFIRMEE: 'Confirmée', EN_COURS: 'En cours', TERMINEE: 'Terminée' };
/** Couleur de la pastille de chaque état (combo du détail, barres). */
const COULEURS_ETAT = { OPTION: '#98a2b3', PREVUE: '#2563eb', CONFIRMEE: '#16a34a', EN_COURS: '#d97706', TERMINEE: '#475467' };
const pastilleEtat = (etat) => `<i class="pastille-etat-tache" style="background:${COULEURS_ETAT[etat] ?? '#98a2b3'}" title="${echapper(ETATS[etat] ?? etat)}"></i>`;
const LIGNES_TEXTE = [1, 2, 3, 4, 5, 6, 8, 10];
const JOURS_COURTS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const TRIS_APLANIFIER = { nom: 'Nom', service: 'Service', reste: 'Reste', date: 'Date prévisionnelle' };
/** Onglets du panneau du planning (icône en panneau réduit). */
const ONGLETS_PANNEAU = {
  aplanifier: { libelle: 'À planifier', icone: '📋' }, tache: { libelle: 'Tâche', icone: '✎' },
  alertes: { libelle: 'Alertes', icone: '⚠', compteur: true }, jalons: { libelle: 'Jalons', icone: '◆', compteur: true },
};
const ETATS_PANNEAU = ['normal', 'reduit', 'large', 'masque'];
const MODES = { 1: 'Début + heures → fin', 2: 'Début + fin → heures', 3: 'Charge (heures ventilées)' };
const LARGEURS = { HEURE: 40, DEMI_JOUR: 60, JOUR: 48, SEMAINE: 90 };
const TYPE_GLISSER = 'application/x-logibtp-planning';
const COULEURS_SERVICE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be185d', '#4d7c0f', '#dc2626'];
const versLocal = (s) => (s ? s.slice(0, 16) : '');
const TYPES_DEP = { FD: 'Fin → début', DD: 'Début → début' };
const UNITES_DEP = { CAL: 'jours calendaires', OUV: 'jours ouvrés' };
const MODES_DEP = { FIXE: 'Fixe (propagée)', ALERTE: 'Alerte' };
const FREQUENCES = { JOUR: 'Chaque jour', SEMAINE: 'Chaque semaine', MOIS: 'Chaque mois' };
const TYPES_JALON = { LIVRAISON: 'Livraison', FIN_CHANTIER: 'Fin de chantier', FIN_ORDRE: 'Fin d\'ordre', ALERTE: 'Alerte', INTERVENTION: 'Intervention', AUTRE: 'Autre' };
const CHAMPS_MOBILE = { adresse: 'Adresse', contact: 'Contact', commentaire: 'Commentaire', liens: 'Liens' };
const GROUPES_TACHE = { tache: 'Tâche', mobile: 'Mobile', ressource: 'Ressource', detail: 'Détail', dependance: 'Dépendance' };
const SYNCHRO = { TEMPS_REEL: 'Temps réel', 30: 'Toutes les 30 s', 60: 'Toutes les minutes', 300: 'Toutes les 5 min', PAUSE: 'En pause', MANUEL: 'Manuelle (⟳)' };

/** Saisie d'une tâche lue (pour la recréer ou la rétablir). */
const saisieDe = (t) => ({
  calcul: t.calcul, debut: t.debut, fin: t.fin, heures: t.heures, nb_ressources: t.nb_ressources, srv_id: t.srv_id, type_element: t.type_element,
  id_element: t.id_element, origine_type: t.origine_type, origine_id: t.origine_id, libelle: t.libelle, memo: t.memo, avancement: t.avancement,
  couleur: t.couleur, etat: t.etat, affectations: t.affectations.map((a) => ({ type: a.type, id: a.id, equipe_id: a.equipe_id, quantite: a.quantite })),
  habilitations: t.habilitations ?? [], parent_id: t.parent_id ?? null, mobile: t.mobile ?? {},
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
    return `${pastilleEtat(t.etat)}${code}${echapper(t.libelle)}${res}`;
  }

  classeBarre(t) { return `${t.theorique ? 'theorique' : ''} etat-${String(t.etat).toLowerCase()}`; }

  /** Capacité des services (lot 4) : un bloc par jour coloré par le rapport planifié / capacité ; jalons des chantiers (lot 5). */
  decorationsLigne(l) {
    if (l.cle.startsWith('chantier:')) {
      return (this.jalons ?? []).filter((j) => `chantier:${j.id_element}` === l.cle).map((j) => ({
        debut: versMinutes(j.quand) - 30 * this.minutesParPixel / 3, fin: versMinutes(j.quand) + 30 * this.minutesParPixel / 3, classe: `jalon jalon-${j.type.toLowerCase()}`,
        titre: `${TYPES_JALON[j.type] ?? j.type} : ${j.libelle} (${j.quand.replace('T', ' ')})`, texte: '◆',
      }));
    }
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

  /** Bulle structurée : état, chantier, libellé, période, heures, service, ressources, avancement, mémo. */
  bulleBarre(t) {
    const quand = (m) => { const d = new Date(m * 60000); return `${JOURS_COURTS[d.getUTCDay()]} ${depuisMinutes(m).slice(8, 10)}/${depuisMinutes(m).slice(5, 7)} ${depuisMinutes(m).slice(11, 16)}`; };
    const ligne = (libelle, valeur) => (valeur ? `<dt>${libelle}</dt><dd>${valeur}</dd>` : '');
    const service = this.services?.get(t.srv_id);
    const av = Number(t.avancement) || 0;
    return `<div class="bulle-tache" style="--bt-couleur:${t.couleur ?? '#3b82f6'}">
      <div class="bt-entete">${pastilleEtat(t.etat)}<span>${echapper(ETATS[t.etat] ?? t.etat)}</span>${t.theorique ? '<span class="bt-theorique">théorique</span>' : ''}</div>
      ${t.element ? `<div class="bt-chantier"><b>${echapper(t.element.code)}</b> ${echapper(t.element.libelle ?? '')}</div>` : ''}
      <div class="bt-libelle">${echapper(t.libelle)}</div>
      <dl>${ligne('Début', quand(t.debut))}${ligne('Fin', quand(t.fin))}${ligne('Heures', `${ecrireDuree(t.heures) || '0:00'} h`)}${ligne('Service', service ? echapper(service) : '')}
        ${ligne('Ressources', t.ressources?.length ? t.ressources.map((x) => echapper(x)).join('<br>') : '<span class="aide">aucune (charge du service)</span>')}
        ${ligne('Avancement', `<span class="bt-avancement"><i style="width:${Math.max(0, Math.min(100, av))}%"></i></span> ${av} %`)}</dl>
      ${t.memo ? `<div class="bt-memo">${echapper(t.memo)}</div>` : ''}</div>`;
  }

  titreBarre(t) {
    return `${t.element ? `${t.element.code} ${t.element.libelle}\n` : ''}${t.libelle} (${ETATS[t.etat] ?? t.etat})\n${depuisMinutes(t.debut).replace('T', ' ')} → ${depuisMinutes(t.fin).replace('T', ' ')}\n${ecrireDuree(t.heures)} h${t.ressources?.length ? `\n${t.ressources.join(', ')}` : ''}`;
  }
}

export class PagePlanning extends PageBase {
  icone = '📅';

  urlCourante() { return `/planning?${new URLSearchParams(Object.entries({ vue: this.vue, du: this.du, consultation: this.consultation ? '1' : '', panneau: this.panneauSeul ? '1' : '' }).filter(([, v]) => v))}`; }

  async ouvrir() {
    this.titre = 'Planning';
    this.conteneur.innerHTML = `<div class="page-planning"><div class="barre-planning ligne">
        <b>📅</b> <span data-vue></span>
        <button type="button" data-prec title="Période précédente">◀</button><button type="button" data-aujourdhui>Aujourd'hui</button><button type="button" data-suiv title="Période suivante">▶</button>
        <span data-periode class="aide"></span> <span data-echelle></span>
        <button type="button" data-zoom="0.8" title="Zoom arrière">－</button><button type="button" data-zoom="1.25" title="Zoom avant">＋</button> <span data-lignes-texte></span>
        <label title="Masquer les heures et les jours non travaillés par l'entreprise (Paramètres du planning)"><input type="checkbox" data-masquer> Masquer le temps non travaillé</label>
        <input type="search" data-recherche placeholder="Ressource…" size="14"> <button type="button" data-actualiser title="Actualiser">⟳</button>
        <button type="button" data-nouvelle>＋ Tâche</button> <button type="button" data-annuler title="Annuler (Ctrl+Z)" disabled>↶</button><button type="button" data-retablir title="Rétablir (Ctrl+Y)" disabled>↷</button>
        <span data-synchro></span> <button type="button" data-attente class="badge-exception" hidden title="Modifications des autres utilisateurs : actualiser"></button>
        <a data-lien-consultation title="Ouvrir la vue en consultation (lecture seule, actualisée en temps réel)">👁 Consultation</a> <button type="button" data-plein-ecran hidden>⛶ Plein écran</button>
        <button type="button" data-afficher-panneau hidden title="Afficher le panneau (à planifier, tâche, alertes, jalons)">▤ Panneau</button>
        <span class="aide" data-etat></span></div>
      <div class="planning-corps"><div class="zone-planning"><div data-planning></div></div>
        <div class="separateur-panneau-planning" data-separateur-panneau title="Glisser pour élargir le panneau"></div>
        <aside class="panneau-planning"><div class="entete-panneau"><div class="onglets ligne">${Object.entries(ONGLETS_PANNEAU).map(([cle, o]) => `<button type="button" data-onglet="${cle}" class="${cle === 'aplanifier' ? 'actif' : ''}" title="${o.libelle}"><span class="onglet-icone">${o.icone}</span><span class="onglet-libelle">${o.libelle}</span>${o.compteur ? ` <span data-nb-${cle}></span>` : ''}</button>`).join('')}
              <span class="commandes-panneau"><button type="button" class="bouton-icone" data-panneau-reduire title="Réduire le panneau">»</button><button type="button" class="bouton-icone" data-panneau-agrandir title="Agrandir le panneau">⤢</button><button type="button" class="bouton-icone" data-panneau-fenetre title="Ouvrir le panneau dans une autre fenêtre">⧉</button><button type="button" class="bouton-icone" data-panneau-rattacher hidden title="Remettre le panneau dans la fenêtre du planning">⇤</button><button type="button" class="bouton-icone" data-panneau-masquer title="Masquer le panneau">✕</button></span></div>
            <div data-actions-tache hidden></div></div>
          ${Object.keys(ONGLETS_PANNEAU).map((cle) => `<div data-panneau="${cle}"${cle === 'aplanifier' ? '' : ' hidden'}></div>`).join('')}</aside></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-planning]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const c = this.conteneur;
    this.consultation = this.requete.consultation === '1';
    this.panneauSeul = this.requete.panneau === '1';
    this.historique = [];
    this.refaire = [];
    this.attente = 0;
    [this.vues, this.ref, this.parametres] = await Promise.all([api.planning.vues(), api.planning.referentiels(), api.planning.parametres().catch(() => null)]);
    this.vue = this.requete.vue ?? this.vues[0]?.code;
    this.couleurs = new Map(this.ref.services.map((s, i) => [s.id, COULEURS_SERVICE[i % COULEURS_SERVICE.length]]));
    const comboVue = creerCombo({ options: this.vues.map((v) => ({ valeur: v.code, libelle: v.libelle })), valeur: this.vue, vide: false, titre: 'Vue' });
    c.querySelector('[data-vue]').append(comboVue);
    comboVue.addEventListener('change', () => { this.vue = comboVue.valeurCombo; this.du = null; this.#definition(); this.#charger(); });
    this.comboEchelle = creerCombo({ options: Object.entries(ECHELLES).map(([valeur, e]) => ({ valeur, libelle: e.libelle })), valeur: 'JOUR', vide: false, titre: 'Échelle' });
    c.querySelector('[data-echelle]').append(this.comboEchelle);
    this.comboEchelle.addEventListener('change', () => this.planning.regler({ echelle: this.comboEchelle.valeurCombo, largeurColonne: LARGEURS[this.comboEchelle.valeurCombo] }));
    c.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => this.planning.zoomer(Number(b.dataset.zoom))));
    // Zoom vertical : lignes de texte par barre (hauteur des lignes), préférence du navigateur.
    const lignesTexte = Number(lirePreferences().planningLignesTexte) || 1;
    const comboLignes = creerCombo({ options: LIGNES_TEXTE.map((n) => ({ valeur: String(n), libelle: `${n} ligne${n > 1 ? 's' : ''}` })), valeur: String(lignesTexte), vide: false, titre: 'Lignes de texte par barre (hauteur des lignes)' });
    comboLignes.size = 7;
    c.querySelector('[data-lignes-texte]').append(comboLignes);
    comboLignes.addEventListener('change', () => { ecrirePreferences({ planningLignesTexte: Number(comboLignes.valeurCombo) }); this.planning.regler({ lignesTexte: Number(comboLignes.valeurCombo) }); });
    c.querySelector('[data-prec]').addEventListener('click', () => this.#decaler(-1));
    c.querySelector('[data-suiv]').addEventListener('click', () => this.#decaler(1));
    c.querySelector('[data-aujourdhui]').addEventListener('click', () => { this.du = null; this.#definition(); this.#charger(); });
    c.querySelector('[data-actualiser]').addEventListener('click', () => this.#charger());
    c.querySelector('[data-recherche]').addEventListener('change', (e) => { this.recherche = e.target.value; this.#charger(); });
    c.querySelector('[data-nouvelle]').addEventListener('click', () => this.#afficherTache(null));
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
      debut: 0, fin: 1440, lecture: this.consultation, lignesTexte, masque: this.#masque(), actions: {
        deplacer: (p) => this.#deplacer(p),
        scinder: (p) => this.#scinder(p),
        selection: (t) => { if (t) this.#afficherTache(t.tache); },
        ouvrir: (t) => this.#afficherTache(t.tache),
        deposer: (e, p) => this.#deposer(e, p),
      },
    });
    const masquer = c.querySelector('[data-masquer]');
    masquer.checked = lirePreferences().planningMasquer !== false;
    masquer.addEventListener('change', () => { ecrirePreferences({ planningMasquer: masquer.checked }); this.planning.regler({ masque: this.#masque() }); });
    this.planning.services = new Map(this.ref.services.map((s) => [s.id, s.libelle]));
    if (!this.consultation) this.#preparerPanneau();
    this.du = this.requete.du ?? null;
    this.#definition();
    await this.#charger();
    await this.#aPlanifier();
  }

  /**
   * Temps non travaillé masqué (préférence `planningMasquer`, cochée par défaut) : heures hors de celles de l'entreprise
   * (échelle de l'heure) et jours masqués des paramètres globaux.
   */
  #masque() {
    const p = this.parametres;
    if (!p || lirePreferences().planningMasquer === false) return null;
    return { heures: p.heure_debut != null ? [p.heure_debut, p.heure_fin] : null, jours: [p.masquer_vendredi && 5, p.masquer_samedi && 6, p.masquer_dimanche && 0].filter((j) => typeof j === 'number') };
  }

  /**
   * Panneau à droite : réduit (onglets en icônes), normal, agrandi, masqué (préférence `planningPanneau`, largeur au
   * glisser `planningPanneauLargeur`) ou ouvert dans une autre fenêtre (`/planning?panneau=1` : panneau seul ; la
   * sélection d'une barre y est envoyée, « Aller » revient au planning, la fermeture rattache le panneau).
   */
  #preparerPanneau() {
    const c = this.conteneur;
    const prefs = lirePreferences();
    const aside = c.querySelector('.panneau-planning');
    if (prefs.planningPanneauLargeur) aside.style.setProperty('--largeur-panneau', `${prefs.planningPanneauLargeur}px`);
    this.etatPanneau = ETATS_PANNEAU.includes(prefs.planningPanneau) ? prefs.planningPanneau : 'normal';
    c.querySelector('[data-panneau-reduire]').addEventListener('click', () => this.#etatPanneau(this.etatPanneau === 'reduit' ? 'normal' : 'reduit'));
    c.querySelector('[data-panneau-agrandir]').addEventListener('click', () => this.#etatPanneau(this.etatPanneau === 'large' ? 'normal' : 'large'));
    c.querySelector('[data-panneau-masquer]').addEventListener('click', () => this.#etatPanneau('masque'));
    c.querySelector('[data-afficher-panneau]').addEventListener('click', () => this.#etatPanneau('normal'));
    c.querySelector('[data-panneau-fenetre]').addEventListener('click', () => {
      this.app.naviguer(`/planning?${new URLSearchParams(Object.entries({ vue: this.vue, du: this.du, panneau: '1' }).filter(([, v]) => v))}`, { nouvelleFenetre: true });
      this.panneauEnFenetre = true;
      this.#appliquerPanneau();
    });
    c.querySelector('[data-separateur-panneau]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const depart = e.clientX;
      const largeur = aside.getBoundingClientRect().width;
      const bouger = (m) => { aside.style.setProperty('--largeur-panneau', `${Math.max(260, Math.min(window.innerWidth - 360, largeur - (m.clientX - depart)))}px`); };
      const finir = () => {
        window.removeEventListener('pointermove', bouger);
        window.removeEventListener('pointerup', finir);
        if (this.etatPanneau !== 'normal') this.#etatPanneau('normal');
        ecrirePreferences({ planningPanneauLargeur: Math.round(aside.getBoundingClientRect().width) });
      };
      window.addEventListener('pointermove', bouger);
      window.addEventListener('pointerup', finir);
    });
    // Panneau réduit : un clic sur un onglet le rouvre.
    c.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { if (this.etatPanneau === 'reduit') this.#etatPanneau('normal'); }));
    if (this.panneauSeul) {
      c.querySelector('.page-planning').classList.add('panneau-seul');
      c.querySelector('[data-panneau-rattacher]').hidden = false;
      c.querySelector('[data-panneau-rattacher]').addEventListener('click', () => window.close());
      this.titre = 'Planning — panneau';
      this.desabonnements = [this.app.abonner('planning-selection', ({ tache }) => { this.#editer(tache); this.#onglet('tache'); })];
      this.app.publier('planning-panneau', { ouvert: true });
      this.quitterFenetre = () => this.app.publier('planning-panneau', { ouvert: false });
      window.addEventListener('pagehide', this.quitterFenetre);
    } else {
      this.desabonnements = [
        this.app.abonner('planning-panneau', ({ ouvert }) => { this.panneauEnFenetre = ouvert; this.#appliquerPanneau(); }),
        this.app.abonner('planning-aller', ({ tache }) => {
          const b = this.barres?.find((x) => x.tache === tache);
          if (b) { this.planning.selection = b; this.planning.montrer(b); }
        }),
      ];
    }
    this.#appliquerPanneau();
  }

  #etatPanneau(etat) {
    this.etatPanneau = etat;
    ecrirePreferences({ planningPanneau: etat });
    this.#appliquerPanneau();
  }

  #appliquerPanneau() {
    const c = this.conteneur;
    const aside = c.querySelector('.panneau-planning');
    const etat = this.panneauSeul ? 'normal' : this.panneauEnFenetre ? 'masque' : this.etatPanneau;
    for (const e of ETATS_PANNEAU) aside.classList.toggle(`panneau-${e}`, e === etat);
    aside.hidden = etat === 'masque';
    c.querySelector('[data-separateur-panneau]').hidden = etat === 'masque' || etat === 'reduit' || this.panneauSeul;
    const afficher = c.querySelector('[data-afficher-panneau]');
    afficher.hidden = this.panneauSeul || etat !== 'masque';
    afficher.textContent = this.panneauEnFenetre ? '⧉ Panneau dans une autre fenêtre' : '▤ Panneau';
    afficher.disabled = Boolean(this.panneauEnFenetre);
    c.querySelector('[data-panneau-reduire]').textContent = etat === 'reduit' ? '«' : '»';
    c.querySelector('[data-panneau-reduire]').title = etat === 'reduit' ? 'Déplier le panneau' : 'Réduire le panneau';
    c.querySelector('[data-panneau-agrandir]').title = etat === 'large' ? 'Taille normale' : 'Agrandir le panneau';
    for (const cle of ['reduire', 'agrandir', 'fenetre', 'masquer']) c.querySelector(`[data-panneau-${cle}]`).hidden = this.panneauSeul;
    this.planning?.actualiser();
  }

  /** Détail d'une tâche (null : nouvelle) : dans le panneau, ou dans la fenêtre du panneau s'il y est ouvert. */
  #afficherTache(id) {
    if (this.panneauEnFenetre) { this.app.publier('planning-selection', { tache: id }); return; }
    if (this.etatPanneau === 'masque' || this.etatPanneau === 'reduit') this.#etatPanneau('normal');
    this.#editer(id);
    this.#onglet('tache');
  }

  fermer() {
    for (const f of this.desabonnements ?? []) f();
    if (this.quitterFenetre) { this.quitterFenetre(); window.removeEventListener('pagehide', this.quitterFenetre); }
    this.planning?.detruire();
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
    this.conteneur.querySelector('[data-actions-tache]').innerHTML = '';
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
    this.planning.jalons = await api.planning.jalons(depuisMinutes(p.debut), depuisMinutes(p.fin)).catch(() => []);
    this.planning.definirDonnees(this.lignes, this.barres);
    if (!this.consultation) { this.#alertes(); this.#rendreJalons(); }
    this.conteneur.querySelector('[data-etat]').textContent = `${this.lignes.length} lignes · ${new Set(this.barres.map((b) => b.tache)).size} tâches`;
    // Centrage sur maintenant après la mise en page (largeur de la vue connue).
    if (!this.centre) { this.centre = true; const d = new Date(); requestAnimationFrame(() => this.planning.allerA(aujourdhui(d) + d.getHours() * 60 + d.getMinutes())); }
  }

  #onglet(nom) {
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === nom));
    this.conteneur.querySelectorAll('[data-panneau]').forEach((p) => { p.hidden = p.dataset.panneau !== nom; });
    this.conteneur.querySelector('[data-actions-tache]').hidden = nom !== 'tache';
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

  /**
   * Liste « À planifier » (budget − planifié par chantier et service) : recherche, tri (nom, service, reste, date
   * prévisionnelle — modifiable, enregistrée par élément et service), présentation en liste ou en tuiles (préférences
   * `planningAPlanifierTri`, `planningAPlanifierSens`, `planningAPlanifierTuiles`) ; lignes et tuiles glissées sur le planning.
   */
  async #aPlanifier() {
    const zone = this.conteneur.querySelector('[data-panneau="aplanifier"]');
    if (!zone.querySelector('[data-liste-aplanifier]')) {
      const prefs = lirePreferences();
      this.triAPlanifier = prefs.planningAPlanifierTri ?? 'reste';
      this.sensAPlanifier = prefs.planningAPlanifierSens ?? (this.triAPlanifier === 'reste' ? -1 : 1);
      this.tuilesAPlanifier = Boolean(prefs.planningAPlanifierTuiles);
      zone.innerHTML = `<div class="barre-aplanifier ligne"><input type="search" data-filtre-aplanifier placeholder="Rechercher (chantier, service)…">
          <span data-tri-aplanifier></span><button type="button" class="bouton-icone" data-sens-aplanifier></button>
          <button type="button" class="bouton-icone" data-presentation-aplanifier></button></div>
        <p class="aide">Glisser sur une ressource (ou un service) : début au point de dépôt.</p><div data-liste-aplanifier></div>`;
      const tri = creerCombo({ options: options(TRIS_APLANIFIER), valeur: this.triAPlanifier, vide: false, titre: 'Trier par' });
      tri.size = 10;
      zone.querySelector('[data-tri-aplanifier]').append(tri);
      tri.addEventListener('change', () => {
        this.triAPlanifier = tri.valeurCombo;
        this.sensAPlanifier = this.triAPlanifier === 'reste' ? -1 : 1;
        ecrirePreferences({ planningAPlanifierTri: this.triAPlanifier, planningAPlanifierSens: this.sensAPlanifier });
        this.#rendreAPlanifier();
      });
      zone.querySelector('[data-sens-aplanifier]').addEventListener('click', () => {
        this.sensAPlanifier = -this.sensAPlanifier;
        ecrirePreferences({ planningAPlanifierSens: this.sensAPlanifier });
        this.#rendreAPlanifier();
      });
      zone.querySelector('[data-presentation-aplanifier]').addEventListener('click', () => {
        this.tuilesAPlanifier = !this.tuilesAPlanifier;
        ecrirePreferences({ planningAPlanifierTuiles: this.tuilesAPlanifier });
        this.#rendreAPlanifier();
      });
      zone.querySelector('[data-filtre-aplanifier]').addEventListener('input', () => this.#rendreAPlanifier());
    }
    try { this.listeAPlanifier = await api.planning.aPlanifier({ services: (this.definition.services ?? []).join(',') }); } catch (e) {
      zone.querySelector('[data-liste-aplanifier]').innerHTML = `<p class="erreur">${echapper(e.message)}</p>`;
      return;
    }
    this.#rendreAPlanifier();
  }

  #rendreAPlanifier() {
    const zone = this.conteneur.querySelector('[data-panneau="aplanifier"]');
    const liste = zone.querySelector('[data-liste-aplanifier]');
    const sens = zone.querySelector('[data-sens-aplanifier]');
    sens.textContent = this.sensAPlanifier > 0 ? '↑' : '↓';
    sens.title = this.sensAPlanifier > 0 ? 'Ordre croissant' : 'Ordre décroissant';
    const pres = zone.querySelector('[data-presentation-aplanifier]');
    pres.textContent = this.tuilesAPlanifier ? '☰' : '▦';
    pres.title = this.tuilesAPlanifier ? 'Présenter en liste' : 'Présenter en tuiles';
    if (!this.listeAPlanifier?.length) { liste.innerHTML = '<p class="aide">Aucune heure à planifier (commandes validées des chantiers ouverts).</p>'; return; }
    const texte = zone.querySelector('[data-filtre-aplanifier]').value.trim().toLowerCase();
    const l = this.listeAPlanifier.filter((x) => !texte || `${x.code} ${x.libelle} ${x.service ?? ''}`.toLowerCase().includes(texte));
    const cles = { nom: (x) => `${x.code} ${x.libelle}`, service: (x) => x.service ?? '', reste: (x) => x.reste, date: (x) => x.date_prevue ?? '' };
    const cle = cles[this.triAPlanifier] ?? cles.reste;
    l.sort((a, b) => {
      const va = cle(a);
      const vb = cle(b);
      if (this.triAPlanifier === 'date' && Boolean(va) !== Boolean(vb)) return va ? -1 : 1; // sans date : toujours à la fin
      return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true })) * this.sensAPlanifier;
    });
    if (!l.length) { liste.innerHTML = '<p class="aide">Aucun élément ne correspond à la recherche.</p>'; return; }
    const reste = (x) => `<span class="${x.reste < 0 ? 'erreur' : ''}">${ecrireDuree(Math.abs(x.reste)) || '0:00'}${x.reste < 0 ? ' dépassé' : ''}</span>`;
    const date = (x) => `<input type="date" data-date-prevue value="${x.date_prevue ?? ''}" title="Date prévisionnelle (tri de la liste)">`;
    const index = (x) => this.listeAPlanifier.indexOf(x);
    const jauge = (x) => (x.budget ? Math.min(100, Math.round((x.planifie * 100) / x.budget)) : 0);
    liste.innerHTML = this.tuilesAPlanifier
      ? `<div class="tuiles-aplanifier">${l.map((x) => `<div class="tuile-aplanifier ${x.reste > 0 ? 'glissable' : 'soldee'}" draggable="${x.reste > 0}" data-i="${index(x)}" title="${echapper(`${x.code} ${x.libelle}`)}">
          <div class="ta-entete"><b>${echapper(x.code)}</b><span class="ta-reste">${reste(x)}</span></div><div class="ta-libelle">${echapper(x.libelle)}</div>
          <div class="ta-service" style="--ta-couleur:${this.couleurs.get(x.srv_id) ?? '#94a3b8'}">${echapper(x.service ?? '')}</div>
          <div class="ta-jauge" title="Planifié ${ecrireDuree(x.planifie) || '0:00'} h sur ${ecrireDuree(x.budget) || '0:00'} h"><i style="width:${jauge(x)}%"></i></div>
          <div>${date(x)}</div></div>`).join('')}</div>`
      : `<table class="tableau-compact pleine-largeur liste-aplanifier"><thead><tr><th>Chantier</th><th>Service</th><th class="nombre">Reste</th><th>Prévue le</th></tr></thead><tbody>
        ${l.map((x) => `<tr draggable="${x.reste > 0}" data-i="${index(x)}" class="${x.reste > 0 ? 'glissable' : 'aide'}" title="${echapper(`${x.libelle}
Budget ${ecrireDuree(x.budget) || '0:00'} h · planifié ${ecrireDuree(x.planifie) || '0:00'} h`)}">
          <td><b>${echapper(x.code)}</b><br><small>${echapper(x.libelle)}</small></td><td>${echapper(x.service ?? '')}</td><td class="nombre">${reste(x)}</td><td>${date(x)}</td></tr>`).join('')}</tbody></table>`;
    liste.querySelectorAll('[data-i]').forEach((el) => {
      const x = this.listeAPlanifier[Number(el.dataset.i)];
      el.addEventListener('dragstart', (e) => {
        if (e.target.closest?.('input')) { e.preventDefault(); return; }
        e.dataTransfer.setData(TYPE_GLISSER, JSON.stringify(x));
        e.dataTransfer.effectAllowed = 'copy';
      });
      el.querySelector('[data-date-prevue]').addEventListener('change', async (e) => {
        try {
          await api.planning.enregistrerPrevision({ type: x.type, id: x.id, srv_id: x.srv_id, date: e.target.value || null });
          x.date_prevue = e.target.value || null;
          if (this.triAPlanifier === 'date') this.#rendreAPlanifier();
        } catch (err) { this.app.erreur(err); e.target.value = x.date_prevue ?? ''; }
      });
    });
  }

  /** Alertes calculées (lot 4) regroupées par type, avec actions : aller à la tâche, appliquer l'équipe, vue, traitée. */
  async #alertes() {
    const zone = this.conteneur.querySelector('[data-panneau="alertes"]');
    const p = this.periode;
    let l;
    try { l = await api.planning.notifications({ vue: this.vue, du: depuisMinutes(p.debut), au: depuisMinutes(p.fin) }); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const importantes = l.filter((n) => n.niveau !== 'INFO' && n.etat !== 'VUE').length;
    this.conteneur.querySelector('[data-nb-alertes]').textContent = importantes ? `(${importantes})` : '';
    const TYPES = { DEPENDANCE: '🔗 Dépendances', LIEE: '📎 Tâches liées', SUROCCUPATION: '⛔ Sur-occupation', HABILITATION: '🎓 Habilitations', MATERIEL: '🧱 Matériel', EQUIPE: '👥 Équipes', SOUSOCCUPATION: '💤 Sous-occupation' };
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
        if (this.panneauSeul) this.app.publier('planning-aller', { tache: Number(e.target.dataset.aller) });
        else if (b) { this.planning.selection = b; this.planning.montrer(b); }
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

  /** Jalons de la période (saisis ou calculés) sous la liste « À planifier », saisie d'un jalon sur un chantier. */
  async #rendreJalons() {
    const zone = this.conteneur.querySelector('[data-panneau="jalons"]');
    const jalons = this.planning.jalons ?? [];
    this.conteneur.querySelector('[data-nb-jalons]').textContent = jalons.length ? `(${jalons.length})` : '';
    const elements = await api.planning.elements().catch(() => []);
    zone.innerHTML = `<ul class="alertes-planning">${jalons.map((j) => `<li>◆ ${j.quand.replace('T', ' ')} — ${echapper(TYPES_JALON[j.type] ?? j.type)} : ${echapper(j.libelle)}
        ${j.cle.startsWith('jalon:') ? `<button type="button" data-suppr-jalon="${j.cle.slice(6)}" title="Supprimer">✕</button>` : ''}</li>`).join('') || '<li class="aide">Aucun jalon sur la période</li>'}</ul>
      <p class="ligne"><input type="datetime-local" data-jalon-quand> <span data-jalon-type></span></p>
      <p class="ligne"><input data-jalon-libelle placeholder="Libellé du jalon" size="18"> <span data-jalon-chantier></span> <button type="button" data-ajouter-jalon>＋ Jalon</button></p>`;
    const type = creerCombo({ options: Object.entries(TYPES_JALON).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: 'LIVRAISON', vide: false });
    zone.querySelector('[data-jalon-type]').append(type);
    const chantier = creerCombo({ options: elements.map((e) => ({ valeur: e.id, libelle: `${e.code} ${e.libelle}` })), valeur: '', vide: true, titre: 'Chantier' });
    zone.querySelector('[data-jalon-chantier]').append(chantier);
    zone.querySelectorAll('[data-suppr-jalon]').forEach((b) => b.addEventListener('click', () => this.#apres(api.planning.supprimerJalon(b.dataset.supprJalon), 'Jalon supprimé')));
    zone.querySelector('[data-ajouter-jalon]').addEventListener('click', () => {
      const quand = zone.querySelector('[data-jalon-quand]').value;
      if (!quand) return;
      this.#apres(api.planning.creerJalon({ quand, type: type.valeurCombo, libelle: zone.querySelector('[data-jalon-libelle]').value, type_element: chantier.valeurCombo ? 'chantier' : null, id_element: chantier.valeurCombo ? String(chantier.valeurCombo) : null }), 'Jalon ajouté');
    });
  }

  /** Liens d'une tâche (lot 5) : tâche principale et tâche liée, dépendances entrantes (saisies) et sortantes, répétition. */
  async #rendreLiens(zone, t) {
    if (!t.id) { zone.innerHTML = '<p class="aide">Dépendances et répétition : après l\'enregistrement de la tâche.</p>'; return; }
    const deps = await api.planning.dependances(t.id).catch(() => ({ predecesseurs: [], successeurs: [] }));
    const entrantes = deps.predecesseurs.map((d) => ({ de: d.de, libelle: d.libelle, type: d.type, decalage: d.decalage, unite: d.unite, mode: d.mode }));
    const taches = [...new Map(this.barres.filter((b) => b.tache !== t.id).map((b) => [b.tache, b])).values()];
    const rendre = () => {
      zone.innerHTML = `<p>${t.parent_id ? `Tâche principale : <a href="#" data-aller-parent>${echapper(t.parent ?? `n° ${t.parent_id}`)}</a>` : '<span class="aide">Pas de tâche principale</span>'} <button type="button" data-liee>＋ Tâche liée</button></p>
        <p><b>Dépend de</b></p><ul class="alertes-planning">${entrantes.map((d, i) => `<li>${echapper(d.libelle ?? `n° ${d.de}`)} — ${TYPES_DEP[d.type]}, ${d.decalage} ${UNITES_DEP[d.unite]}, ${MODES_DEP[d.mode]} <button type="button" data-retirer-dep="${i}">✕</button></li>`).join('') || '<li class="aide">Aucune</li>'}</ul>
        <p class="ligne"><span data-dep-tache></span> <span data-dep-type></span> <input type="number" data-dep-decalage value="0" size="3"> <span data-dep-unite></span> <span data-dep-mode></span> <button type="button" data-ajouter-dep>＋</button></p>
        <p><button type="button" data-enregistrer-deps>Enregistrer les dépendances</button></p>
        ${deps.successeurs.length ? `<p><b>Tâches suivantes</b> : ${deps.successeurs.map((d) => echapper(d.libelle ?? `n° ${d.vers}`)).join(', ')}</p>` : ''}
        <h4>Répétition</h4><p class="ligne"><span data-frequence></span> <input type="number" data-nombre min="1" max="52" value="4" size="3"> fois <button type="button" data-repeter>Répéter</button>
          ${t.serie ? '<button type="button" data-suppr-serie title="Supprimer les tâches de la série qui commencent après celle-ci">Supprimer la suite de la série</button>' : ''}</p>`;
      const combo = (cle, opts, valeur, titre) => { const c = creerCombo({ options: opts, valeur, vide: false, titre }); zone.querySelector(`[data-${cle}]`).append(c); return c; };
      const opt = (o) => Object.entries(o).map(([valeur, libelle]) => ({ valeur, libelle }));
      const tache = combo('dep-tache', taches.map((b) => ({ valeur: b.tache, libelle: b.libelle, detail: b.element?.code ?? '' })), taches[0]?.tache ?? '', 'Tâche précédente');
      const type = combo('dep-type', opt(TYPES_DEP), 'FD');
      const unite = combo('dep-unite', opt(UNITES_DEP), 'CAL');
      const mode = combo('dep-mode', opt(MODES_DEP), 'FIXE');
      const frequence = combo('frequence', opt(FREQUENCES), 'SEMAINE');
      zone.querySelector('[data-aller-parent]')?.addEventListener('click', (e) => { e.preventDefault(); this.#editer(t.parent_id); });
      zone.querySelectorAll('[data-retirer-dep]').forEach((b) => b.addEventListener('click', () => { entrantes.splice(Number(b.dataset.retirerDep), 1); rendre(); }));
      zone.querySelector('[data-ajouter-dep]').addEventListener('click', () => {
        if (!tache.valeurCombo) return;
        entrantes.push({ de: Number(tache.valeurCombo), libelle: taches.find((b) => String(b.tache) === String(tache.valeurCombo))?.libelle, type: type.valeurCombo,
          decalage: Number(zone.querySelector('[data-dep-decalage]').value) || 0, unite: unite.valeurCombo, mode: mode.valeurCombo });
        rendre();
      });
      zone.querySelector('[data-enregistrer-deps]').addEventListener('click', async () => {
        const r = await this.#modifierMemorise(t.id, 'dépendances', () => api.planning.enregistrerDependances(t.id, entrantes.map(({ libelle, ...d }) => d)).then(() => api.planning.tache(t.id)));
        if (r) this.#editer(t.id);
      });
      zone.querySelector('[data-liee]').addEventListener('click', async () => {
        const r = await this.#apres(api.planning.creer({ ...saisieDe(t), libelle: `${t.libelle} (liée)`, parent_id: t.id, calcul: 2, fin: t.debut.slice(0, 11) + '12:00' > t.debut ? t.debut.slice(0, 11) + '12:00' : t.fin, heures: null, affectations: [] }), 'Tâche liée créée');
        if (r) { this.#memoriserCreation(r, 'tâche liée'); this.#editer(r.id); }
      });
      zone.querySelector('[data-repeter]').addEventListener('click', () => this.#apres(api.planning.repeter(t.id, { frequence: frequence.valeurCombo, nombre: Number(zone.querySelector('[data-nombre]').value) || 1 }), 'Tâches répétées'));
      zone.querySelector('[data-suppr-serie]')?.addEventListener('click', () => {
        if (confirm('Supprimer les tâches suivantes de la série ?')) this.#apres(api.planning.supprimerSerie(t.serie, depuisMinutes(versMinutes(t.debut) + 1)), 'Suite de la série supprimée');
      });
    };
    rendre();
  }

  /** Groupes repliés du détail de la tâche (préférence du navigateur). */
  #repliees() { return lirePreferences().planningGroupesReplies ?? []; }

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
    const mobile = t.mobile ?? {};
    const groupe = (cle, corps) => `<details class="groupe-tache" data-groupe="${cle}" ${this.#repliees().includes(cle) ? '' : 'open'}><summary><b>${GROUPES_TACHE[cle]}</b></summary>${corps}</details>`;
    // Boutons dans l'entête du panneau (avec les onglets), toujours visibles au défilement du détail.
    const barre = this.conteneur.querySelector('[data-actions-tache]');
    barre.innerHTML = `<p class="ligne"><button type="button" data-apercu>Aperçu du calcul</button> <button type="button" data-enregistrer>Enregistrer</button>
        ${t.id ? '<button type="button" data-supprimer>Supprimer</button>' : ''}</p><div data-resultat class="aide"></div>`;
    zone.innerHTML = `      ${groupe('tache', `<p><label>Libellé <input data-libelle size="30" value="${echapper(t.libelle)}"></label></p>
        <p class="ligne">Chantier <span data-element></span></p><p class="ligne">Service <span data-service></span></p>
        <p class="ligne">Calcul <span data-mode></span></p>
        <p><label>Début <input type="datetime-local" data-debut value="${versLocal(t.debut)}"></label></p>
        <p><label>Fin <input type="datetime-local" data-fin value="${versLocal(t.fin)}"></label></p>
        <p class="ligne"><label>Heures <input data-heures size="7" value="${ecrireDuree(t.heures)}"></label> <label>Ressources (charge) <input type="number" data-nb min="1" size="3" value="${t.nb_ressources}"></label></p>
        <p class="ligne">État <span data-etat-tache></span></p>
        <p class="ligne"><label>Couleur <input type="color" data-couleur value="${t.couleur ?? '#3b82f6'}"></label> <label><input type="checkbox" data-sans-couleur ${t.couleur ? '' : 'checked'}> par service</label></p>
        <p><label>Avancement <input type="number" data-avancement min="0" max="100" size="3" value="${t.avancement}"> %</label></p>
        <p><textarea data-memo rows="2" cols="34" placeholder="Mémo">${echapper(t.memo ?? '')}</textarea></p>`)}
      ${groupe('mobile', Object.entries(CHAMPS_MOBILE).map(([cle, libelle]) => `<p><label>${libelle}<br><textarea data-mobile="${cle}" rows="${cle === 'adresse' || cle === 'contact' ? 1 : 2}" cols="34">${echapper(mobile[cle] ?? '')}</textarea></label></p>`).join(''))}
      ${groupe('ressource', `<ul data-affectations></ul>
        <p class="ligne"><input type="search" data-cherche-res placeholder="Chercher une ressource…" size="18"> <span data-ressource></span> <button type="button" data-ajouter-res>＋</button></p>
        <p class="ligne">Équipe <span data-equipe></span> <button type="button" data-ajouter-equipe>＋</button></p>
        <p><b>Habilitations exigées</b></p><p class="ligne" data-habilitations></p><p class="ligne"><span data-habilitation></span> <button type="button" data-ajouter-hab>＋</button></p>
        <p><button type="button" data-creneau title="Première plage libre de la première ressource affectée, sinon d'une ressource habilitée du service">🔎 Premier créneau libre</button> <span data-proposition class="aide"></span></p>`)}
      ${groupe('detail', `<p><b>${t.id ? `Tâche n° ${t.id}` : 'Nouvelle tâche'}</b></p><p class="aide" data-realise></p>${t.maj_par ? `<p class="aide">Modifiée par ${echapper(t.maj_par)}</p>` : ''}`)}
      ${groupe('dependance', '<div data-liens></div>')}`;
    zone.querySelectorAll('details[data-groupe]').forEach((d) => d.addEventListener('toggle', () => {
      ecrirePreferences({ planningGroupesReplies: [...zone.querySelectorAll('details[data-groupe]:not([open])')].map((x) => x.dataset.groupe) });
    }));
    if (t.id && this.app.moduleActif('pointage')) {
      api.liaisons.realise(t.id).then((r) => { if (r.minutes != null) zone.querySelector('[data-realise]').textContent = `Réalisé (pointages) : ${ecrireDuree(r.minutes) || '0:00'} h sur ${ecrireDuree(t.heures) || '0:00'} h planifiées`; }).catch(() => {});
    }
    this.#rendreLiens(zone.querySelector('[data-liens]'), t);
    const affs = t.affectations.map((a) => ({ ...a }));
    const habs = [...(t.habilitations ?? [])];
    const combo = (cle, opts, valeur, vide = true) => { const c = creerCombo({ options: opts, valeur: valeur ?? '', vide }); zone.querySelector(`[data-${cle}]`).append(c); return c; };
    const element = combo('element', elements.map((e) => ({ valeur: e.id, libelle: `${e.code} ${e.libelle}` })), t.id_element);
    const service = combo('service', this.ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle })), t.srv_id);
    const mode = combo('mode', options(MODES), String(t.calcul), false);
    const etat = combo('etat-tache', options(ETATS).map((o) => ({ ...o, couleur: COULEURS_ETAT[o.valeur] })), t.etat, false);
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
        parent_id: t.parent_id ?? null, mobile: Object.fromEntries([...zone.querySelectorAll('[data-mobile]')].map((x) => [x.dataset.mobile, x.value])),
      };
    };
    barre.querySelector('[data-apercu]').addEventListener('click', async () => {
      try {
        const r = await api.planning.calculer(saisie());
        barre.querySelector('[data-resultat]').textContent = r.erreurs.length ? r.erreurs.join(', ')
          : `Fin ${r.fin?.replace('T', ' ')} · ${ecrireDuree(r.heures)} h${Object.keys(r.par_ressource).length ? ` · ${Object.entries(r.par_ressource).map(([k, m]) => `${affs.find((a) => `${a.type}:${a.id}` === k)?.libelle ?? k} ${ecrireDuree(m)}`).join(', ')}` : ''}`;
      } catch (e) { this.app.erreur(e); }
    });
    barre.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      let r;
      if (t.id) r = await this.#modifierMemorise(t.id, 'modification', () => api.planning.modifier(t.id, saisie()));
      else {
        r = await this.#apres(api.planning.creer(saisie()), 'Tâche enregistrée');
        if (r) this.#memoriserCreation(r, 'nouvelle tâche');
      }
      if (r) this.#editer(r.id);
    });
    barre.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (confirm('Supprimer cette tâche ?')) await this.#supprimer(t.id);
    });
  }
}

/** Heures entières proposées pour les heures travaillées (minutes depuis minuit). */
const HEURES_TRAVAIL = Array.from({ length: 25 }, (_, h) => ({ valeur: String(h * 60), libelle: `${String(h).padStart(2, '0')}:00` }));

/**
 * Paramètres du planning (globaux, administrateur) : affichage — heures travaillées par l'entreprise (masquées en
 * dehors à l'échelle de l'heure), vendredi, samedi et dimanche masqués —, seuil de sous-occupation, horizon du créneau.
 */
export class PageParametresPlanning extends PageBase {
  icone = '📅';

  async ouvrir() {
    this.titre = 'Paramètres du planning';
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">📅 Paramètres du planning</h1></div><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.app.enLigne) { corps.innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const admin = this.app.estAdmin();
    const ro = admin ? '' : 'disabled';
    const p = await api.planning.parametres();
    const jour = (cle, libelle, aide) => `<label title="${aide}"><input type="checkbox" data-${cle} ${p[`masquer_${cle}`] ? 'checked' : ''} ${ro}> ${libelle}</label>`;
    corps.innerHTML = `<div class="titre-actions"><h2>Affichage</h2>${admin ? '<span class="titre-actions-boutons"><button type="button" data-enregistrer title="Enregistrer les paramètres">💾 Enregistrer</button></span>' : ''}</div>
      <p class="aide">Masqués dans les vues quand l'option « Masquer le temps non travaillé » de la barre du planning est cochée.</p>
      <table class="tableau-compact largeur-contenu"><tbody>
      <tr><td>Début des heures travaillées<br><small class="aide">avant : masqué à l'échelle de l'heure</small></td><td data-debut></td></tr>
      <tr><td>Fin des heures travaillées<br><small class="aide">après : masqué à l'échelle de l'heure</small></td><td data-fin></td></tr>
      <tr><td>Jours masqués<br><small class="aide">à toutes les échelles sauf la semaine</small></td><td>${jour('vendredi', 'Vendredi', 'Un service qui ne travaille qu\'un vendredi sur deux l\'a en absence dans son calendrier')} ${jour('samedi', 'Samedi', '')} ${jour('dimanche', 'Dimanche', '')}</td></tr>
      </tbody></table>
      <h2>Charge et créneaux</h2>
      <table class="tableau-compact largeur-contenu"><tbody>
      <tr><td>Sous-occupation signalée au-delà de (% de la capacité disponible)</td><td><input type="number" data-sous min="0" max="100" size="4" value="${p.sous_occupation}" ${ro}></td></tr>
      <tr><td>Horizon du premier créneau libre (jours)</td><td><input type="number" data-horizon min="1" max="365" size="4" value="${p.horizon_creneau}" ${ro}></td></tr>
      </tbody></table>`;
    const combo = (cle, valeur) => {
      const c = creerCombo({ options: HEURES_TRAVAIL, valeur: String(valeur), vide: false });
      c.size = 6;
      c.readOnly = !admin;
      corps.querySelector(`[data-${cle}]`).append(c);
      return c;
    };
    const debut = combo('debut', p.heure_debut);
    const fin = combo('fin', p.heure_fin);
    corps.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      const v = (sel) => corps.querySelector(sel);
      try {
        await api.planning.enregistrerParametres({
          sous_occupation: Number(v('[data-sous]').value), horizon_creneau: Number(v('[data-horizon]').value),
          heure_debut: Number(debut.valeurCombo), heure_fin: Number(fin.valeurCombo),
          masquer_vendredi: v('[data-vendredi]').checked, masquer_samedi: v('[data-samedi]').checked, masquer_dimanche: v('[data-dimanche]').checked,
        });
        this.app.message('Paramètres enregistrés', 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }
}
