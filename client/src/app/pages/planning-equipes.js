import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { TYPES_RESSOURCE } from '../planning/ressources-tache.js';
import {
  periodesDepuisLignes, lignesDepuisPeriodes, controlerEquipe, ajouterJours, periodeA, MESSAGES_EQUIPES, TYPES_CHEF,
} from '../ressources/equipes.js';

// Planning (cœur) : équipes et compositions par périodes souples propres à chaque équipe (changement en pleine semaine,
// équipe fixe sur plusieurs mois…). Membres : salariés, intérimaires, matériels, sous-traitants et autres équipes (renfort :
// leurs membres comptent dans l'équipe au planning et au pointage) ; un chef par période (salarié ou intérimaire,
// contact des communications). Règles : ressources/equipes.js ↔ ReglesEquipes.cs ; écriture : /api/ressources/equipes.

const TYPES_MEMBRE = { ...TYPES_RESSOURCE, EQUIPE: 'Équipe' };
const ICONES = { SALARIE: '👷', INTERIM: '🧑‍🔧', MATERIEL: '🚜', SOUS_TRAITANT: '🏢', EQUIPE: '👥' };
const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const jour = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const cle = (m) => `${m.type}:${m.id}`;

export class PageEquipes extends PageBase {
  icone = '👥';

  urlCourante() { return `/planning/equipes${this.id ? `?id=${this.id}` : ''}`; }

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    this.titre = 'Équipes';
    this.conteneur.innerHTML = `<div class="page-parametres page-equipes"><div class="entete-page"><h1 class="page-titre">👥 Équipes et compositions</h1></div>
      <div class="equipes-corps"><aside class="equipes-liste"><div class="barre-aplanifier"><input type="search" data-filtre placeholder="Rechercher une équipe…">
          <label title="Afficher aussi les équipes inactives"><input type="checkbox" data-inactives> Inactives</label>
          <button type="button" class="bouton-icone" data-nouvelle title="Nouvelle équipe" aria-label="Nouvelle équipe">＋</button></div><div data-liste></div></aside>
        <section class="equipes-detail" data-detail><p class="aide">Choisir une équipe, ou ＋ pour en créer une.</p></section></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-detail]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const c = this.conteneur;
    [this.ressources, this.ref] = await Promise.all([api.planning.ressources({}).catch(() => []), api.planning.referentiels().catch(() => ({ services: [] }))]);
    this.libelles = new Map(this.ressources.map((r) => [`${r.type}:${r.id}`, r.libelle]));
    c.querySelector('[data-inactives]').checked = Boolean(lirePreferences().equipesInactives);
    c.querySelector('[data-filtre]').addEventListener('input', () => this.#rendreListe());
    c.querySelector('[data-inactives]').addEventListener('change', (e) => { ecrirePreferences({ equipesInactives: e.target.checked }); this.#rendreListe(); });
    c.querySelector('[data-nouvelle]').addEventListener('click', () => this.#choisir(null));
    await this.#chargerListe();
    if (this.requete.id) await this.#choisir(Number(this.requete.id));
  }

  async #chargerListe() {
    try { this.equipes = await api.ressources.listeEquipes(); } catch (e) { this.app.erreur(e); this.equipes = []; }
    for (const e of this.equipes) this.libelles.set(`EQUIPE:${e.id}`, e.libelle);
    this.#rendreListe();
  }

  #rendreListe() {
    const c = this.conteneur;
    const t = c.querySelector('[data-filtre]').value.trim().toLowerCase();
    const inactives = c.querySelector('[data-inactives]').checked;
    const l = this.equipes.filter((e) => (inactives || e.actif) && (!t || `${e.code} ${e.libelle} ${e.chef ?? ''} ${e.service ?? ''}`.toLowerCase().includes(t)));
    c.querySelector('[data-liste]').innerHTML = l.length ? `<table class="tableau-compact pleine-largeur"><thead><tr><th>Équipe</th><th>Chef</th><th class="nombre" title="Membres aujourd'hui, ceux des équipes en renfort compris">Eff.</th></tr></thead><tbody>
      ${l.map((e) => `<tr class="cliquable${e.id === this.id ? ' selection' : ''}${e.actif ? '' : ' aide'}" data-id="${e.id}"><td><b>${echapper(e.code)}</b> ${echapper(e.libelle)}
        ${e.sous_equipes ? `<small class="aide" title="Équipes en renfort">· 👥 ${e.sous_equipes}</small>` : ''}<br><small class="aide">${echapper(e.service ?? '')}</small></td>
        <td>${echapper(e.chef ?? '')}</td><td class="nombre">${e.effectif}</td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucune équipe.</p>';
    c.querySelectorAll('[data-liste] tr[data-id]').forEach((tr) => tr.addEventListener('click', () => this.#choisir(Number(tr.dataset.id))));
  }

  /** Ouvre une équipe (null : nouvelle) ; modifications non enregistrées : confirmation. */
  async #choisir(id) {
    if (this.modifie && !confirm('Abandonner les modifications de l\'équipe en cours ?')) return;
    let e;
    if (id) {
      try { e = await api.ressources.compositionEquipe(id); } catch (err) { this.app.erreur(err); return; }
      for (const l of e.lignes) this.libelles.set(cle(l), l.libelle);
    } else e = { id: null, code: '', libelle: '', srv_id: null, actif: true, lignes: [] };
    this.id = e.id;
    this.equipe = { id: e.id, code: e.code, libelle: e.libelle, srv_id: e.srv_id, actif: e.actif };
    this.periodes = periodesDepuisLignes(e.lignes);
    if (!id) this.periodes = [{ du: aujourdhui(), au: null, membres: [] }];
    this.modifie = !id;
    this.app.routeur.remplacerUrl(this.urlCourante());
    this.#rendreListe();
    this.#rendre();
  }

  #marquer() { this.modifie = true; this.conteneur.querySelector('[data-etat-equipe]').textContent = '● modifiée, non enregistrée'; }

  #rendre() {
    const zone = this.conteneur.querySelector('[data-detail]');
    const e = this.equipe;
    const erreurs = controlerEquipe({ ...e, periodes: this.periodes });
    const erreursDe = (i) => erreurs.filter((x) => x.periode === i).map((x) => MESSAGES_EQUIPES[x.code] ?? x.code);
    const date = aujourdhui();
    const courante = periodeA(this.periodes, date);
    zone.innerHTML = `<div class="titre-actions"><h2>${e.id ? `${echapper(e.code)} — ${echapper(e.libelle)}` : 'Nouvelle équipe'}</h2>
        <span class="titre-actions-boutons"><span class="aide" data-etat-equipe>${this.modifie ? '● modifiée, non enregistrée' : ''}</span>
        <button type="button" data-enregistrer title="Enregistrer l'équipe et ses compositions">💾 Enregistrer</button>
        ${e.id ? '<button type="button" class="bouton-icone" data-retablir title="Rétablir la version enregistrée" aria-label="Rétablir">↺</button>' : ''}</span></div>
      <table class="tableau-compact largeur-contenu"><tbody>
        <tr><td>Code</td><td><input data-code size="10" value="${echapper(e.code)}"></td><td>Libellé</td><td><input data-libelle size="32" value="${echapper(e.libelle)}"></td></tr>
        <tr><td>Service</td><td colspan="2" data-service></td><td><label><input type="checkbox" data-actif ${e.actif ? 'checked' : ''}> Active</label></td></tr>
      </tbody></table>
      ${erreursDe(null).length ? `<p class="erreur">${erreursDe(null).map(echapper).join(' · ')}</p>` : ''}
      <div class="titre-actions"><h2>Compositions</h2><span class="titre-actions-boutons">
        <input type="date" data-date-periode value="${date}" title="Début de la nouvelle période"><button type="button" data-nouvelle-periode title="Nouvelle période à partir de cette date (reprend les membres de la période en cours à cette date)">＋ Période</button></span></div>
      <p class="aide">Périodes propres à l'équipe : chacune a ses membres et son chef (contact des communications). Une équipe en renfort compte avec ses propres membres au planning et au pointage.</p>
      <div class="periodes-equipe">${this.periodes.map((p, i) => `<div class="periode-equipe${p === courante ? ' courante' : ''}" data-i="${i}">
        <div class="pe-entete"><span>Du <input type="date" data-du value="${p.du ?? ''}"> au <input type="date" data-au value="${p.au ?? ''}" title="Vide : sans fin"></span>
          ${p === courante ? '<span class="badge-onglet pe-badge">en cours</span>' : ''}<span class="pe-resume aide">${p.membres.length} membre${p.membres.length > 1 ? 's' : ''}</span>
          <button type="button" class="bouton-icone" data-suppr-periode title="Supprimer la période" aria-label="Supprimer la période">✕</button></div>
        ${erreursDe(i).length ? `<p class="erreur">${erreursDe(i).map(echapper).join(' · ')}</p>` : ''}
        <ul class="liste-ressources-tache">${p.membres.map((m, k) => `<li class="ligne-ressource" data-k="${k}"><span class="lr-libelle">${ICONES[m.type] ?? '•'} ${echapper(this.libelles.get(cle(m)) ?? cle(m))}
            <small class="aide">${echapper(TYPES_MEMBRE[m.type] ?? m.type)}</small>${m.chef ? ' <b class="chef-equipe" title="Chef de l\'équipe : contact des communications">★ chef</b>' : ''}</span>
          <span class="lr-actions">${TYPES_CHEF.includes(m.type) ? `<button type="button" class="bouton-icone" data-chef title="${m.chef ? 'Ne plus être chef' : 'Désigner chef de l\'équipe'}" aria-label="Chef">${m.chef ? '☆' : '★'}</button>` : ''}
            <button type="button" class="bouton-icone" data-retirer title="Retirer de la période" aria-label="Retirer">✕</button></span></li>`).join('') || '<li class="aide">Aucun membre</li>'}</ul>
        <div class="ajout-ressource"><span data-ajout></span></div></div>`).join('') || '<p class="aide">Aucune période : ＋ Période pour composer l\'équipe.</p>'}</div>`;
    const v = (s) => zone.querySelector(s);
    const service = creerCombo({ options: (this.ref.services ?? []).map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle })), valeur: e.srv_id ?? '', vide: true, titre: 'Service de l\'équipe' });
    v('[data-service]').append(service);
    service.addEventListener('change', () => { e.srv_id = service.valeurCombo === '' ? null : Number(service.valeurCombo); this.#marquer(); });
    v('[data-code]').addEventListener('change', (ev) => { e.code = ev.target.value.trim().toUpperCase(); ev.target.value = e.code; this.#marquer(); this.#rendre(); });
    v('[data-libelle]').addEventListener('change', (ev) => { e.libelle = ev.target.value; this.#marquer(); this.#rendre(); });
    v('[data-actif]').addEventListener('change', (ev) => { e.actif = ev.target.checked; this.#marquer(); });
    v('[data-enregistrer]').addEventListener('click', () => this.#enregistrer());
    v('[data-retablir]')?.addEventListener('click', () => { this.modifie = false; this.#choisir(e.id); });
    v('[data-nouvelle-periode]').addEventListener('click', () => this.#nouvellePeriode(v('[data-date-periode]').value));
    // Membres proposés : ressources et autres équipes (jamais l'équipe elle-même).
    const options = [
      ...this.equipes.filter((x) => x.id !== e.id).map((x) => ({ valeur: `EQUIPE:${x.id}`, libelle: `${x.code} ${x.libelle}`, detail: 'Équipe', groupe: 'Équipes' })),
      ...this.ressources.map((r) => ({ valeur: `${r.type}:${r.id}`, libelle: r.libelle, detail: r.service ?? TYPES_MEMBRE[r.type], groupe: TYPES_MEMBRE[r.type] ?? r.type })),
    ];
    zone.querySelectorAll('.periode-equipe').forEach((div) => {
      const p = this.periodes[Number(div.dataset.i)];
      div.querySelector('[data-du]').addEventListener('change', (ev) => { p.du = ev.target.value || null; this.#marquer(); this.#rendre(); });
      div.querySelector('[data-au]').addEventListener('change', (ev) => { p.au = ev.target.value || null; this.#marquer(); this.#rendre(); });
      div.querySelector('[data-suppr-periode]').addEventListener('click', () => {
        if (p.membres.length && !confirm(`Supprimer la période du ${jour(p.du)} et ses ${p.membres.length} membre(s) ?`)) return;
        this.periodes.splice(this.periodes.indexOf(p), 1);
        this.#marquer();
        this.#rendre();
      });
      div.querySelectorAll('li[data-k]').forEach((li) => {
        const m = p.membres[Number(li.dataset.k)];
        li.querySelector('[data-retirer]').addEventListener('click', () => { p.membres.splice(p.membres.indexOf(m), 1); this.#marquer(); this.#rendre(); });
        li.querySelector('[data-chef]')?.addEventListener('click', () => {
          const devenir = !m.chef;
          for (const x of p.membres) x.chef = false;
          m.chef = devenir;
          this.#marquer();
          this.#rendre();
        });
      });
      const ajout = creerCombo({ options, valeur: '', vide: true, titre: 'Ajouter un membre : ressource ou équipe en renfort' });
      ajout.placeholder = 'Ajouter un membre…';
      div.querySelector('[data-ajout]').append(ajout);
      ajout.addEventListener('change', () => {
        const val = ajout.valeurCombo;
        if (!val) return;
        const k = val.indexOf(':');
        if (p.membres.some((x) => cle(x) === val)) { this.app.message('Déjà membre de la période', 'avertissement'); ajout.definirValeur(''); return; }
        p.membres.push({ type: val.slice(0, k), id: val.slice(k + 1), chef: false });
        this.#marquer();
        this.#rendre();
      });
    });
  }

  /**
   * Nouvelle période à une date : coupe la période qui la couvre (la nouvelle reprend ses membres et sa fin), sinon
   * commence une période qui reprend les membres de la précédente et s'arrête avant la suivante.
   */
  #nouvellePeriode(date) {
    if (!date) return;
    const copie = (p) => (p ? p.membres.map((m) => ({ ...m })) : []);
    const p = periodeA(this.periodes, date);
    if (p && p.du === date) { this.app.message('Une période commence déjà à cette date', 'avertissement'); return; }
    if (p) {
      this.periodes.push({ du: date, au: p.au, membres: copie(p) });
      p.au = ajouterJours(date, -1);
    } else {
      const avant = this.periodes.filter((x) => x.du && x.du < date).sort((a, b) => b.du.localeCompare(a.du))[0];
      const apres = this.periodes.filter((x) => x.du && x.du > date).sort((a, b) => a.du.localeCompare(b.du))[0];
      this.periodes.push({ du: date, au: apres ? ajouterJours(apres.du, -1) : null, membres: copie(avant) });
    }
    this.periodes.sort((a, b) => String(a.du).localeCompare(String(b.du)));
    this.#marquer();
    this.#rendre();
  }

  async #enregistrer() {
    const e = this.equipe;
    const erreurs = controlerEquipe({ ...e, periodes: this.periodes });
    if (erreurs.length) { this.app.message(MESSAGES_EQUIPES[erreurs[0].code] ?? erreurs[0].code, 'erreur'); return; }
    // Périodes canoniques (fusion des périodes contiguës identiques), comme le serveur les relira.
    const periodes = periodesDepuisLignes(lignesDepuisPeriodes(this.periodes));
    const saisie = { code: e.code, libelle: e.libelle, srv_id: e.srv_id, actif: e.actif, periodes };
    try {
      const r = e.id ? await api.ressources.modifierEquipe(e.id, saisie) : await api.ressources.creerEquipe(saisie);
      this.modifie = false;
      this.app.message('Équipe enregistrée', 'succes');
      await this.#chargerListe();
      await this.#choisir(r.id);
    } catch (err) { this.app.erreur(err); }
  }
}
