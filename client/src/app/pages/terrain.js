import { aujourdhui, ajouterJours } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, lirePreferences, ecrirePreferences, formatDate } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ETATS_TACHE, COULEURS_ETAT } from '../planning/etats.js';
import { NAVIGATIONS, lundiDe, mobileAffiche, lienItineraire, liensTexte, numeroTel } from '../terrain/terrain.js';

// Application de terrain, lot 1 (ANALYSE-TERRAIN.md) : page personnelle pour tablette et smartphone. Tâches du planning
// de la personne connectée (aujourd'hui ou la semaine), partie mobile (adresse, contact, consignes, liens) complétée par
// le chantier, itinéraire, pièces de la GED diffusées sur le terrain. Lecture seule ; pointage et ordres : lots suivants.

const ONGLETS = { jour: 'Aujourd\'hui', semaine: 'Semaine' };
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const jourDe = (instant) => instant.slice(0, 10);
const heureDe = (instant) => instant.slice(11, 16);
const nomJour = (jour) => { const [a, m, j] = jour.split('-').map(Number); return `${JOURS[new Date(Date.UTC(a, m - 1, j)).getUTCDay()]} ${formatDate(jour)}`; };
const taille = (o) => (o == null ? '' : o < 1048576 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1048576).toFixed(1).replace('.', ',')} Mo`);

export class PageTerrain extends PageBase {
  icone = '📱';

  async ouvrir() {
    this.titre = 'Mon terrain';
    this.onglet = ONGLETS[this.requete.onglet] ? this.requete.onglet : 'jour';
    this.jour = /^\d{4}-\d{2}-\d{2}$/.test(this.requete.jour ?? '') ? this.requete.jour : aujourdhui();
    this.conteneur.innerHTML = `<div class="page-terrain">
      <div class="terrain-entete"><h1 class="page-titre">📱 Mon terrain</h1><span class="aide" data-personne></span></div>
      <nav class="terrain-onglets" role="tablist">${Object.entries(ONGLETS).map(([cle, l]) => `<button type="button" role="tab" data-onglet="${cle}">${l}</button>`).join('')}</nav>
      <div class="terrain-periode"><button type="button" data-decaler="-1" aria-label="Période précédente">◀</button><b data-periode></b>
        <button type="button" data-decaler="1" aria-label="Période suivante">▶</button><button type="button" data-aujourdhui>Aujourd'hui</button></div>
      <div class="terrain-liste" data-liste></div>
      <details class="terrain-reglages"><summary>⚙ Itinéraire</summary><p class="ligne">Application de navigation <span data-navigation></span></p>
        <p class="aide">L'itinéraire s'ouvre dans l'application choisie ; aucune position n'est enregistrée.</p></details>
    </div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { this.onglet = b.dataset.onglet; this.#charger(); }));
    this.conteneur.querySelectorAll('[data-decaler]').forEach((b) => b.addEventListener('click', () => {
      this.jour = ajouterJours(this.jour, Number(b.dataset.decaler) * (this.onglet === 'semaine' ? 7 : 1));
      this.#charger();
    }));
    $('[data-aujourdhui]').addEventListener('click', () => { this.jour = aujourdhui(); this.#charger(); });
    const nav = creerCombo({ options: Object.entries(NAVIGATIONS).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: this.#navigation(), vide: false });
    nav.addEventListener('change', () => { ecrirePreferences({ terrainNavigation: nav.valeurCombo }); this.#rendre(); });
    $('[data-navigation]').append(nav);
    await this.#charger();
  }

  urlCourante() { return `/terrain?onglet=${this.onglet}&jour=${this.jour}`; }

  #navigation() { const n = lirePreferences().terrainNavigation; return NAVIGATIONS[n] ? n : 'AUTO'; }

  #periode() {
    if (this.onglet === 'jour') return { du: this.jour, au: this.jour };
    const du = lundiDe(this.jour);
    return { du, au: ajouterJours(du, 6) };
  }

  async #charger() {
    const { du, au } = this.#periode();
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.onglet === this.onglet)));
    this.conteneur.querySelector('[data-periode]').textContent = du === au ? nomJour(du) : `du ${formatDate(du)} au ${formatDate(au)}`;
    this.app.routeur?.remplacerUrl(this.urlCourante());
    try {
      this.donnees = await api.terrain.taches(du, au);
    } catch (e) { this.app.erreur(e); return; }
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
