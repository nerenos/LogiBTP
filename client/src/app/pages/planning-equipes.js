import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { TYPES_RESSOURCE, choisirRessources } from '../planning/ressources-tache.js';
import { finsPeriodes, controlerEquipe, ajouterJours, periodeA, MESSAGES_EQUIPES, TYPES_CHEF } from '../ressources/equipes.js';

// Planning (cœur) : équipes et compositions. Une composition est datée par son seul début et vaut jusqu'à la veille de la
// suivante (ni trou ni chevauchement). Membres : salariés, intérimaires, matériels, sous-traitants et autres équipes
// (renfort : leurs membres comptent au planning et au pointage) ; un chef par composition (salarié ou intérimaire,
// contact des communications) ; commentaires d'aide-mémoire sur l'équipe et chaque composition. Compositions de la plus
// récente à la plus ancienne, par lots (historique). Consultation par défaut ; le premier changement prend le verrou
// (battement) après avoir vérifié que l'équipe affichée est celle de la base (sinon : rechargée, avertissement) ;
// l'enregistrement libère le verrou. Règles : ressources/equipes.js ↔ ReglesEquipes.cs ; écriture : /api/ressources/equipes.

const LOT = 10;
const BATTEMENT = 30000;
const TYPES_MEMBRE = { ...TYPES_RESSOURCE, EQUIPE: 'Équipe' };
const ICONES = { SALARIE: '👷', INTERIM: '🧑‍🔧', MATERIEL: '🚜', SOUS_TRAITANT: '🏢', EQUIPE: '👥' };
const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const jour = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const cle = (m) => `${m.type}:${m.id}`;
const heure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export class PageEquipes extends PageBase {
  icone = '👥';

  urlCourante() { return `/planning/equipes${this.id ? `?id=${this.id}` : ''}`; }

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    this.titre = 'Équipes';
    this.jeton = crypto.randomUUID();
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
    this.liberation = () => this.#liberer();
    window.addEventListener('pagehide', this.liberation);
    await this.#chargerListe();
    if (this.requete.id) await this.#choisir(Number(this.requete.id));
  }

  fermer() {
    this.#liberer();
    window.removeEventListener('pagehide', this.liberation);
  }

  // ------------------------------------------------------------------ liste

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
      ${l.map((e) => `<tr class="cliquable${e.id === this.id ? ' selection' : ''}${e.actif ? '' : ' aide'}" data-id="${e.id}" title="${echapper(e.commentaire ?? '')}"><td><b>${echapper(e.code)}</b> ${echapper(e.libelle)}
        ${e.sous_equipes ? `<small class="aide" title="Équipes en renfort">· 👥 ${e.sous_equipes}</small>` : ''}${e.commentaire ? ' <small title="Aide-mémoire">📝</small>' : ''}<br><small class="aide">${echapper(e.service ?? '')}</small></td>
        <td>${echapper(e.chef ?? '')}</td><td class="nombre">${e.effectif}</td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucune équipe.</p>';
    c.querySelectorAll('[data-liste] tr[data-id]').forEach((tr) => tr.addEventListener('click', () => this.#choisir(Number(tr.dataset.id))));
  }

  // ------------------------------------------------------------------ équipe, consultation et modification

  /** Ouvre une équipe (null : nouvelle, directement en modification) ; modification en cours : confirmation puis libération. */
  async #choisir(id) {
    if (this.modifie && !confirm('Abandonner les modifications de l\'équipe en cours ?')) return;
    await this.#liberer();
    if (id) {
      if (!(await this.#charger(id))) return;
      this.mode = 'consultation';
    } else {
      this.id = null;
      this.equipe = { id: null, code: '', libelle: '', srv_id: null, actif: true, commentaire: '', version: null };
      this.periodes = [{ du: aujourdhui(), commentaire: '', membres: [] }];
      this.plusAnciennes = false;
      this.depuis = null;
      this.mode = 'modification';
    }
    this.modifie = !id;
    this.app.routeur.remplacerUrl(this.urlCourante());
    this.#rendreListe();
    this.#rendre();
  }

  /** Équipe et premier lot de compositions lus en base. */
  async #charger(id) {
    let e;
    try { e = await api.ressources.compositionEquipe(id, '', LOT); } catch (err) { this.app.erreur(err); return false; }
    this.id = e.id;
    this.equipe = { id: e.id, code: e.code, libelle: e.libelle, srv_id: e.srv_id, actif: e.actif, commentaire: e.commentaire ?? '', version: e.version };
    this.periodes = e.periodes.map((p) => this.#periodeLue(p));
    this.plusAnciennes = e.plus_anciennes;
    this.depuis = this.#plusAncienne();
    return true;
  }

  #periodeLue(p) {
    for (const m of p.membres) this.libelles.set(cle(m), m.libelle);
    return { du: p.du, commentaire: p.commentaire ?? '', membres: p.membres.map(({ type, id, chef }) => ({ type, id, chef })) };
  }

  #plusAncienne() { return this.plusAnciennes ? this.periodes.map((p) => p.du).filter(Boolean).sort()[0] ?? null : null; }

  /** Lot suivant de l'historique (compositions plus anciennes), ajouté en bas. */
  async #historique() {
    const avant = this.periodes.map((p) => p.du).filter(Boolean).sort()[0];
    let e;
    try { e = await api.ressources.compositionEquipe(this.id, avant, LOT); } catch (err) { this.app.erreur(err); return; }
    this.periodes.push(...e.periodes.map((p) => this.#periodeLue(p)));
    this.plusAnciennes = e.plus_anciennes;
    this.depuis = this.#plusAncienne();
    this.#rendre();
  }

  /**
   * Passage en modification au premier changement : verrou pris (sinon : qui modifie, et retour à l'affichage), puis
   * version comparée à celle affichée (différente : équipe rechargée, avertissement, le changement n'est pas appliqué).
   */
  async #entrer() {
    if (this.mode === 'modification') return true;
    this.entree ??= (async () => {
      let r;
      try { r = await api.ressources.verrouillerEquipe(this.id, this.jeton); } catch (err) { this.app.erreur(err); return false; }
      if (!r.ok) {
        this.app.message(`${MESSAGES_EQUIPES.EQU_VERROU} (${r.verrou?.utilisateur ?? '?'} depuis ${r.verrou ? heure(r.verrou.depuis) : '?'})`, 'avertissement');
        this.#rendre();
        return false;
      }
      this.mode = 'modification';
      this.battement = setInterval(() => this.#battre(), BATTEMENT);
      this.#rendreEntete();
      if (r.version !== this.equipe.version) {
        await this.#charger(this.id);
        this.app.message('L\'équipe a été modifiée par ailleurs : la version de la base est rechargée, refaire la modification', 'avertissement');
        this.#rendre();
        return false;
      }
      return true;
    })();
    try { return await this.entree; } finally { this.entree = null; }
  }

  async #battre() {
    const r = await api.ressources.verrouillerEquipe(this.id, this.jeton).catch(() => null);
    if (r && !r.ok) {
      this.#arreter();
      this.app.message(`Verrou perdu : ${r.verrou?.utilisateur ?? 'un autre utilisateur'} modifie l'équipe ; elle est rechargée`, 'erreur');
      this.modifie = false;
      await this.#charger(this.id);
      this.mode = 'consultation';
      this.#rendre();
    }
  }

  #arreter() { clearInterval(this.battement); this.battement = null; }

  /** Verrou rendu (enregistrement, abandon, autre équipe, fermeture de la page). */
  async #liberer() {
    this.#arreter();
    if (this.id && this.mode === 'modification') await api.ressources.deverrouillerEquipe(this.id, this.jeton).catch(() => {});
    this.mode = 'consultation';
  }

  /** Changement de l'utilisateur : passage en modification si besoin, puis application et nouvel affichage. */
  async #modifier(f) {
    if (!(await this.#entrer())) return;
    f();
    this.modifie = true;
    this.#rendre();
  }

  async #abandonner() {
    if (this.modifie && !confirm('Abandonner les modifications ?')) return;
    if (!this.id) { this.modifie = false; this.#rendre(); this.conteneur.querySelector('[data-detail]').innerHTML = '<p class="aide">Choisir une équipe, ou ＋ pour en créer une.</p>'; return; }
    await this.#liberer();
    this.modifie = false;
    await this.#charger(this.id);
    this.#rendre();
  }

  // ------------------------------------------------------------------ affichage

  #rendre() {
    const zone = this.conteneur.querySelector('[data-detail]');
    if (!this.equipe) return;
    const e = this.equipe;
    // Ordre affiché : la plus récente d'abord ; fins déduites des débuts (la plus ancienne chargée : jusqu'à la suivante).
    const datees = finsPeriodes(this.periodes);
    const affichees = [...this.periodes].sort((a, b) => String(b.du ?? '9999').localeCompare(String(a.du ?? '9999')));
    const finDe = (p) => datees.find((d) => d.du === p.du && d.membres === p.membres)?.au ?? null;
    const erreurs = controlerEquipe({ ...e, periodes: this.periodes });
    const erreursDe = (p) => erreurs.filter((x) => x.periode === this.periodes.indexOf(p)).map((x) => MESSAGES_EQUIPES[x.code] ?? x.code);
    const date = aujourdhui();
    const courante = periodeA(datees, date);
    const enCours = (p) => courante && courante.du === p.du && courante.membres === p.membres;
    zone.innerHTML = `<div class="titre-actions" data-entete-equipe></div>
      <table class="tableau-compact largeur-contenu"><tbody>
        <tr><td>Code</td><td><input data-code size="10" value="${echapper(e.code)}"></td><td>Libellé</td><td><input data-libelle size="32" value="${echapper(e.libelle)}"></td></tr>
        <tr><td>Service</td><td colspan="2" data-service></td><td><label><input type="checkbox" data-actif ${e.actif ? 'checked' : ''}> Active</label></td></tr>
        <tr><td>Aide-mémoire</td><td colspan="3"><textarea data-commentaire rows="2" cols="60" placeholder="Compétences, contraintes, binômes à éviter, au moins un chauffeur…">${echapper(e.commentaire ?? '')}</textarea></td></tr>
      </tbody></table>
      ${erreurs.some((x) => x.periode === null) ? `<p class="erreur">${erreurs.filter((x) => x.periode === null).map((x) => echapper(MESSAGES_EQUIPES[x.code])).join(' · ')}</p>` : ''}
      <div class="titre-actions"><h2>Compositions</h2><span class="titre-actions-boutons">
        <input type="date" data-date-periode value="${date}" title="Début de la nouvelle composition"><button type="button" data-nouvelle-periode title="Nouvelle composition à partir de cette date (reprend les membres de la composition en cours à cette date)">＋ Composition</button></span></div>
      <p class="aide">Chaque composition commence à sa date et vaut jusqu'au début de la suivante. Une équipe en renfort compte avec ses propres membres au planning et au pointage.</p>
      <div class="periodes-equipe">${affichees.map((p) => {
        const i = this.periodes.indexOf(p);
        const au = finDe(p);
        return `<div class="periode-equipe${enCours(p) ? ' courante' : ''}" data-i="${i}">
        <div class="pe-entete"><span>Depuis le <input type="date" data-du value="${p.du ?? ''}"> <span class="aide">${au ? `jusqu'au ${jour(au)}` : 'sans fin'}</span></span>
          ${enCours(p) ? '<span class="badge-onglet pe-badge">en cours</span>' : ''}<span class="pe-resume aide">${p.membres.length} membre${p.membres.length > 1 ? 's' : ''}</span>
          <button type="button" class="bouton-icone" data-suppr-periode title="Supprimer la composition (la précédente continue jusqu'à la suivante)" aria-label="Supprimer la composition">✕</button></div>
        ${erreursDe(p).length ? `<p class="erreur">${erreursDe(p).map(echapper).join(' · ')}</p>` : ''}
        <textarea data-commentaire-periode rows="1" placeholder="Aide-mémoire de la composition (ex. : A ne porte pas de charge, B et C pas ensemble)">${echapper(p.commentaire ?? '')}</textarea>
        <ul class="liste-ressources-tache">${p.membres.map((m, k) => `<li class="ligne-ressource" data-k="${k}"><span class="lr-libelle">${ICONES[m.type] ?? '•'} ${echapper(this.libelles.get(cle(m)) ?? cle(m))}
            <small class="aide">${echapper(TYPES_MEMBRE[m.type] ?? m.type)}</small>${m.chef ? ' <b class="chef-equipe" title="Chef de l\'équipe : contact des communications">★ chef</b>' : ''}</span>
          <span class="lr-actions">${TYPES_CHEF.includes(m.type) ? `<button type="button" class="bouton-icone" data-chef title="${m.chef ? 'Ne plus être chef' : 'Désigner chef de l\'équipe'}" aria-label="Chef">${m.chef ? '☆' : '★'}</button>` : ''}
            <button type="button" class="bouton-icone" data-retirer title="Retirer de la composition" aria-label="Retirer">✕</button></span></li>`).join('') || '<li class="aide">Aucun membre (équipe arrêtée sur cette période)</li>'}</ul>
        <div class="ajout-ressource"><span data-ajout></span><button type="button" class="bouton-icone" data-choisir title="Choisir dans la liste des ressources (disponibilités sur la composition)" aria-label="Choisir">☰</button></div></div>`;
      }).join('') || '<p class="aide">Aucune composition : ＋ Composition pour composer l\'équipe.</p>'}</div>
      ${this.plusAnciennes ? `<p><button type="button" data-historique title="Compositions plus anciennes">⏬ ${LOT} compositions précédentes</button></p>` : ''}`;
    this.#brancher(zone);
  }

  /** Titre, mode (consultation / modification) et boutons : redessinés seuls au passage en modification (la saisie en cours reste). */
  #rendreEntete() {
    const z = this.conteneur.querySelector('[data-entete-equipe]');
    if (!z) return;
    const e = this.equipe;
    z.innerHTML = `<h2>${e.id ? `${echapper(e.code)} — ${echapper(e.libelle)}` : 'Nouvelle équipe'}</h2>
      <span class="titre-actions-boutons">${this.mode !== 'modification'
        ? '<span class="badge-mode" title="Le premier changement passe en modification (verrou)">👁 Consultation</span>'
        : `<span class="badge-mode modification" title="Verrou détenu : personne d'autre ne modifie l'équipe">✎ Modification${this.modifie ? ' ●' : ''}</span>
          <button type="button" data-enregistrer title="Enregistrer l'équipe et ses compositions, libérer le verrou">💾 Enregistrer</button>
          <button type="button" data-abandonner title="Abandonner les modifications et revenir en consultation">Abandonner</button>`}</span>`;
    z.querySelector('[data-enregistrer]')?.addEventListener('click', () => this.#enregistrer());
    z.querySelector('[data-abandonner]')?.addEventListener('click', () => this.#abandonner());
  }

  #brancher(zone) {
    const e = this.equipe;
    const v = (s) => zone.querySelector(s);
    this.#rendreEntete();
    // Saisie dans un champ : passage en modification dès la première frappe (hors recherche des combos).
    zone.addEventListener('input', (ev) => {
      if (this.mode !== 'modification' && !ev.target.classList.contains('combo')) this.#entrer();
    });
    const service = creerCombo({ options: (this.ref.services ?? []).map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle })), valeur: e.srv_id ?? '', vide: true, titre: 'Service de l\'équipe' });
    v('[data-service]').append(service);
    service.addEventListener('change', () => this.#modifier(() => { e.srv_id = service.valeurCombo === '' ? null : Number(service.valeurCombo); }));
    const champ = (sel, f) => v(sel).addEventListener('change', (ev) => this.#modifier(() => f(ev.target)));
    champ('[data-code]', (x) => { e.code = x.value.trim().toUpperCase(); });
    champ('[data-libelle]', (x) => { e.libelle = x.value; });
    champ('[data-actif]', (x) => { e.actif = x.checked; });
    champ('[data-commentaire]', (x) => { e.commentaire = x.value; });
    v('[data-historique]')?.addEventListener('click', () => this.#historique());
    v('[data-nouvelle-periode]').addEventListener('click', () => this.#nouvellePeriode(v('[data-date-periode]').value));
    // Membres proposés : ressources et autres équipes (jamais l'équipe elle-même).
    const options = [
      ...this.equipes.filter((x) => x.id !== e.id).map((x) => ({ valeur: `EQUIPE:${x.id}`, libelle: `${x.code} ${x.libelle}`, detail: 'Équipe', groupe: 'Équipes' })),
      ...this.ressources.map((r) => ({ valeur: `${r.type}:${r.id}`, libelle: r.libelle, detail: r.service ?? TYPES_MEMBRE[r.type], groupe: TYPES_MEMBRE[r.type] ?? r.type })),
    ];
    zone.querySelectorAll('.periode-equipe').forEach((div) => {
      const p = this.periodes[Number(div.dataset.i)];
      div.querySelector('[data-du]').addEventListener('change', (ev) => this.#modifier(() => {
        const du = ev.target.value || null;
        if (du && this.depuis && du < this.depuis) this.app.message(MESSAGES_EQUIPES.EQU_ORDRE, 'avertissement');
        p.du = du;
      }));
      div.querySelector('[data-commentaire-periode]').addEventListener('change', (ev) => this.#modifier(() => { p.commentaire = ev.target.value; }));
      div.querySelector('[data-suppr-periode]').addEventListener('click', () => {
        if (p.membres.length && !confirm(`Supprimer la composition du ${jour(p.du)} (${p.membres.length} membre(s)) ? La précédente continue jusqu'à la suivante.`)) return;
        this.#modifier(() => this.periodes.splice(this.periodes.indexOf(p), 1));
      });
      div.querySelectorAll('li[data-k]').forEach((li) => {
        const m = p.membres[Number(li.dataset.k)];
        li.querySelector('[data-retirer]').addEventListener('click', () => this.#modifier(() => p.membres.splice(p.membres.indexOf(m), 1)));
        li.querySelector('[data-chef]')?.addEventListener('click', () => this.#modifier(() => {
          const devenir = !m.chef;
          for (const x of p.membres) x.chef = false;
          m.chef = devenir;
        }));
      });
      // Une ressource à la fois (combo), ou la liste de sélection / désélection avec les disponibilités.
      const ajout = creerCombo({ options, valeur: '', vide: true, titre: 'Ajouter un membre : ressource ou équipe en renfort' });
      ajout.placeholder = 'Ajouter un membre…';
      div.querySelector('[data-ajout]').append(ajout);
      ajout.addEventListener('change', () => {
        const val = ajout.valeurCombo;
        ajout.definirValeur('');
        if (!val) return;
        if (p.membres.some((x) => cle(x) === val)) { this.app.message('Déjà membre de la composition', 'avertissement'); return; }
        const k = val.indexOf(':');
        this.#modifier(() => p.membres.push({ type: val.slice(0, k), id: val.slice(k + 1), chef: false }));
      });
      div.querySelector('[data-choisir]').addEventListener('click', () => this.#choisirRessources(p));
    });
  }

  /** Fenêtre des ressources sur la composition (début → veille de la suivante, sinon une semaine) : cocher ajoute, décocher retire. */
  async #choisirRessources(p) {
    if (!p.du) return;
    if (!(await this.#entrer())) return;
    const au = finsPeriodes(this.periodes).find((d) => d.du === p.du)?.au;
    const avant = new Set(p.membres.filter((m) => m.type !== 'EQUIPE').map(cle));
    const choix = await choisirRessources({ du: `${p.du}T00:00`, au: `${au ? ajouterJours(au, 1) : ajouterJours(p.du, 7)}T00:00`, exclure: null, selection: avant });
    if (!choix) return;
    this.#modifier(() => {
      p.membres = p.membres.filter((m) => m.type === 'EQUIPE' || choix.cles.has(cle(m)));
      for (const c of choix.cles) {
        if (avant.has(c)) continue;
        const k = c.indexOf(':');
        this.libelles.set(c, choix.libelles.get(c) ?? c);
        p.membres.push({ type: c.slice(0, k), id: c.slice(k + 1), chef: false });
      }
    });
  }

  /**
   * Nouvelle composition à une date : reprend les membres de la composition qui couvre la date (sinon de la plus proche
   * avant) ; la composition précédente s'arrête la veille.
   */
  #nouvellePeriode(date) {
    if (!date) return;
    if (this.periodes.some((p) => p.du === date)) { this.app.message('Une composition commence déjà à cette date', 'avertissement'); return; }
    if (this.depuis && date < this.depuis) { this.app.message(`${MESSAGES_EQUIPES.EQU_ORDRE} : charger les compositions précédentes`, 'avertissement'); return; }
    const avant = finsPeriodes(this.periodes).filter((p) => p.du < date).at(-1);
    const source = avant ? this.periodes.find((p) => p.du === avant.du) : null;
    this.#modifier(() => this.periodes.push({ du: date, commentaire: '', membres: (source?.membres ?? []).map((m) => ({ ...m })) }));
  }

  async #enregistrer() {
    const e = this.equipe;
    const erreurs = controlerEquipe({ ...e, periodes: this.periodes });
    if (erreurs.length) { this.app.message(MESSAGES_EQUIPES[erreurs[0].code] ?? erreurs[0].code, 'erreur'); return; }
    const saisie = {
      code: e.code, libelle: e.libelle, srv_id: e.srv_id, actif: e.actif, commentaire: e.commentaire || null, version: e.version, jeton: this.jeton, depuis: this.depuis,
      periodes: this.periodes.map((p) => ({ du: p.du, commentaire: p.commentaire || null, membres: p.membres })),
    };
    let r;
    try {
      r = e.id ? await api.ressources.modifierEquipe(e.id, saisie) : await api.ressources.creerEquipe(saisie);
    } catch (err) {
      this.app.erreur(err);
      if (err.code === 'EQU_VERSION' || err.code === 'EQU_VERROU') {
        await this.#liberer();
        this.modifie = false;
        await this.#charger(e.id);
        this.#rendre();
      }
      return;
    }
    // Le serveur a libéré le verrou : retour en consultation.
    this.#arreter();
    this.mode = 'consultation';
    this.modifie = false;
    this.app.message('Équipe enregistrée', 'succes');
    await this.#chargerListe();
    await this.#charger(r.id);
    this.app.routeur.remplacerUrl(this.urlCourante());
    this.#rendreListe();
    this.#rendre();
  }
}
