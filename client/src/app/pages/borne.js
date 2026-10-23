import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { ecrireDuree, lireDuree } from '@logibtp/pointage';
import { api } from '../api.js';

// Borne d'atelier (Pointage lot 4, M8, § 6 « quatre touches ») : appareil enregistré par un administrateur (jeton gardé
// dans le navigateur de la borne, en-tête X-Borne-Jeton, aucune session) ; salarié (initiales) → PIN → chantier ou
// ordre (numéro ou QR code lu comme une saisie ; ⏭ directement aux pointages du jour) → type de main-d'œuvre →
// activité (filtrables ; un seul choix : pris d'office, écran passé) → liste des pointages de la journée (ajout,
// modification, retrait, commentaire, note de non-conformité, durées fréquentes appliquées au champ qui a le focus) →
// enregistrée, retour à l'accueil. Date de la journée et heures déjà saisies sur tous les écrans (jours passés pour un
// oubli ; journée validée : consultation) ; « Signaler un problème » = non-conformité avec motif ; saisie d'équipe par
// le chef ; saisie interrompue gardée dans le navigateur et reprise à l'identification suivante.

const CLE_JETON = 'logibtp.borne.jeton';
// Fenêtre d'essai d'un administrateur (/borne?test=) : jeton d'essai propre à la fenêtre (sessionStorage), sans
// remplacer le jeton d'une vraie borne gardé dans le navigateur.
const CLE_TEST = 'logibtp.borne.test';
const lireTest = () => { try { return sessionStorage.getItem(CLE_TEST); } catch { return null; } };
const lireJeton = () => { try { return lireTest() ?? localStorage.getItem(CLE_JETON); } catch { return null; } };

// Reprise d'une saisie interrompue (inactivité) : gardée dans le navigateur de la borne (fenêtre d'essai : sa session),
// proposée à la prochaine identification du même salarié pendant quatre heures ; perdue sans gravité si le cache est purgé.
const CLE_REPRISE = 'logibtp.borne.reprise';
const DUREE_REPRISE = 4 * 3600 * 1000;
const stockageReprise = () => (lireTest() ? sessionStorage : localStorage);
function lireReprise(appareil, salarie) {
  try {
    const r = JSON.parse(stockageReprise().getItem(CLE_REPRISE) ?? 'null');
    return r && r.appareil === appareil && r.salarie === salarie && Date.now() - r.le < DUREE_REPRISE ? r : null;
  } catch { return null; }
}
function ecrireReprise(r) {
  try {
    if (r) stockageReprise().setItem(CLE_REPRISE, JSON.stringify({ ...r, le: Date.now() }));
    else stockageReprise().removeItem(CLE_REPRISE);
  } catch { /* navigateur sans stockage : pas de reprise */ }
}

const dateLongue = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const decalerJour = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

class ErreurBorne extends Error {
  constructor(statut, code, message) { super(message); this.statut = statut; this.code = code; }
}

async function appel(methode, url, corps) {
  const r = await fetch(`/api/pointage/borne${url}`, {
    method: methode, headers: { 'Content-Type': 'application/json', 'X-Borne-Jeton': lireJeton() ?? '' }, body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const t = await r.text();
  const d = t ? JSON.parse(t) : null;
  if (!r.ok) throw new ErreurBorne(r.status, d?.code, d?.title ?? d?.message ?? `Erreur ${r.status}`);
  return d;
}

/**
 * Choix multiple : étiquettes des valeurs retenues (✕ pour retirer) et combo d'ajout des options restantes (jamais de
 * <select multiple>). `valeurs` : valeurs retenues, dans l'ordre d'ajout ; aucune : « tous ».
 */
function choixMultiple({ options, valeurs = [], titre = 'Ajouter' }) {
  const racine = document.createElement('div');
  racine.className = 'choix-multiple';
  let retenues = [...valeurs];
  const egal = (a, b) => String(a) === String(b);
  const rendre = () => {
    const restantes = options.filter((o) => !retenues.some((v) => egal(v, o.valeur)));
    racine.innerHTML = `${retenues.length ? retenues.map((v, i) => `<span class="etiquette-choix">${echapper(options.find((o) => egal(o.valeur, v))?.libelle ?? String(v))}<button type="button" data-retirer="${i}" title="Retirer" aria-label="Retirer">✕</button></span>`).join('')
      : '<span class="aide">tous</span>'}<span data-ajout></span>`;
    racine.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { retenues.splice(Number(b.dataset.retirer), 1); rendre(); }));
    if (!restantes.length) return;
    const combo = creerCombo({ options: restantes, valeur: '', vide: true, titre });
    combo.placeholder = `＋ ${titre.toLowerCase()}…`;
    combo.addEventListener('change', () => { if (combo.valeurCombo !== '' && !retenues.some((v) => egal(v, combo.valeurCombo))) { retenues.push(combo.valeurCombo); rendre(); racine.querySelector('[data-ajout] input')?.focus(); } });
    racine.querySelector('[data-ajout]').append(combo);
  };
  Object.defineProperty(racine, 'valeurs', { get: () => [...retenues] });
  rendre();
  return racine;
}

const initiales = (s) => `${s.prenom?.[0] ?? ''}${s.nom?.[0] ?? ''}`.toUpperCase();

export class PageBorne extends PageBase {
  icone = '🏭';

  async ouvrir() {
    this.titre = 'Borne de pointage';
    document.body.classList.add('mode-borne');
    this.conteneur.innerHTML = '<div class="borne" data-borne></div>';
    this.zone = this.conteneur.querySelector('[data-borne]');
    for (const ev of ['pointerdown', 'keydown', 'input']) this.zone.addEventListener(ev, () => { if (this.etat) this.#minuterie(); });
    if (this.requete.jeton) {
      try { localStorage.setItem(CLE_JETON, this.requete.jeton); } catch { /* navigateur sans stockage */ }
      this.app.routeur.remplacerUrl('/borne');
    }
    if (this.requete.test) {
      try { sessionStorage.setItem(CLE_TEST, this.requete.test); } catch { /* sans stockage */ }
      this.app.routeur.remplacerUrl('/borne');
    }
    if (!lireJeton()) { this.#enregistrement(); return; }
    try { this.donnees = await appel('GET', ''); } catch (e) {
      if (e.statut === 401) { this.#enregistrement(e.message); return; }
      this.zone.innerHTML = `<p class="borne-erreur">${echapper(e.message)}</p>`;
      return;
    }
    this.test = Boolean(this.donnees.appareil.test);
    this.titre = `${this.test ? '🧪 ' : ''}${this.donnees.appareil.libelle}`;
    this.#accueil();
  }

  fermer() { document.body.classList.remove('mode-borne'); clearTimeout(this.retour); }

  #enregistrement(message) {
    this.zone.innerHTML = `<h1>🏭 Borne de pointage</h1>${message ? `<p class="borne-erreur">${echapper(message)}</p>` : ''}
      <p>Cette borne n'est pas enregistrée. Un administrateur crée la borne (Paramètres › Pointage › Bornes) et colle ici le jeton remis.</p>
      <p><input data-jeton size="48" placeholder="Jeton de la borne"> <button type="button" class="borne-bouton" data-ok>Enregistrer</button></p>`;
    this.zone.querySelector('[data-ok]').addEventListener('click', () => {
      try { localStorage.setItem(CLE_JETON, this.zone.querySelector('[data-jeton]').value.trim()); } catch { /* sans stockage */ }
      this.ouvrir();
    });
  }

  /**
   * Retour automatique à l'accueil après une inactivité (une minute) ou une saisie ; une saisie en cours reste gardée
   * dans le navigateur et se reprend à la prochaine identification.
   */
  #minuterie(ms = 60000) {
    clearTimeout(this.retour);
    this.retour = setTimeout(() => this.#accueil(this.etat?.modifie || this.etat?.saisie ? 'Saisie interrompue : identifiez-vous pour la reprendre.' : undefined), ms);
  }

  #accueil(message) {
    clearTimeout(this.retour);
    this.etat = null;
    const d = this.donnees;
    this.zone.innerHTML = `<div class="borne-entete"><h1>🏭 ${echapper(d.appareil.libelle)}</h1><span>${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      ${this.test ? `<p class="borne-test">🧪 Mode essai (administrateur) : PIN facultatif, pointages contrôlés mais non enregistrés${d.appareil.actif ? '' : ' · borne désactivée'}.</p>` : ''}
      ${message ? `<p class="borne-succes">${echapper(message)}</p>` : ''}
      <p><input type="search" data-cherche placeholder="Chercher mon nom…" class="borne-champ"> ${d.equipes.length ? '<button type="button" class="borne-bouton" data-equipe>👥 Saisie d\'équipe (chef)</button>' : ''}</p>
      <div class="borne-grille" data-salaries></div>`;
    const rendre = (q = '') => {
      const l = d.salaries.filter((s) => !q || `${s.nom} ${s.prenom} ${s.matricule}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
      this.zone.querySelector('[data-salaries]').innerHTML = l.map((s) => `<button type="button" class="borne-carte" data-id="${s.id}"><span class="borne-avatar">${echapper(initiales(s))}</span>${echapper(s.prenom)} ${echapper(s.nom)}</button>`).join('')
        || '<p>Aucun salarié.</p>';
      this.zone.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => this.#identifier(Number(b.dataset.id), false)));
    };
    rendre();
    this.zone.querySelector('[data-cherche]').addEventListener('input', (e) => rendre(e.target.value));
    this.zone.querySelector('[data-equipe]')?.addEventListener('click', () => this.#choisirChef());
  }

  #choisirChef() {
    this.zone.innerHTML = `<h2>👥 Saisie d'équipe : qui êtes-vous (chef d'équipe) ?</h2><div class="borne-grille">${this.donnees.salaries.slice(0, 60).map((s) => `<button type="button" class="borne-carte" data-id="${s.id}"><span class="borne-avatar">${echapper(initiales(s))}</span>${echapper(s.prenom)} ${echapper(s.nom)}</button>`).join('')}</div>
      <p><button type="button" class="borne-bouton" data-annuler>Annuler</button></p>`;
    this.zone.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => this.#identifier(Number(b.dataset.id), true)));
    this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
    this.#minuterie();
  }

  /** PIN sur clavier numérique si la borne l'exige ou si le salarié en a un ; puis reprise proposée d'une saisie interrompue. */
  #identifier(id, equipe) {
    const s = this.donnees.salaries.find((x) => x.id === id);
    const sansPin = !this.donnees.appareil.pin_exige && !s.pin;
    const envoyer = async (pin) => {
      try {
        this.etat = { journee: await appel('POST', '/identifier', { salarie: id, pin }), equipe, membres: null, saisie: null };
        this.#chargerLignes();
        const r = lireReprise(this.donnees.appareil.pap_id, id);
        if (r && Boolean(r.equipe) === equipe) this.#proposerReprise(r);
        else if (equipe) this.#choisirEquipe(); else this.#journee();
      } catch (e) { this.#pin(s, envoyer, e.message); }
    };
    if (sansPin) envoyer(null); else this.#pin(s, envoyer);
  }

  #pin(s, envoyer, erreur) {
    let saisi = '';
    this.zone.innerHTML = `<h2>${echapper(s.prenom)} ${echapper(s.nom)} : code PIN</h2>${erreur ? `<p class="borne-erreur">${echapper(erreur)}</p>` : ''}
      <p class="borne-pin" data-affichage>····</p>
      <div class="borne-clavier">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✔'].map((k) => `<button type="button" class="borne-touche" data-k="${k}">${k}</button>`).join('')}</div>
      <p>${this.test ? '<button type="button" class="borne-bouton" data-passer title="Mode essai : identification sans PIN">Passer (essai)</button> ' : ''}<button type="button" class="borne-bouton" data-annuler>Annuler</button></p>`;
    this.zone.querySelector('[data-passer]')?.addEventListener('click', () => envoyer(null));
    const aff = this.zone.querySelector('[data-affichage]');
    this.zone.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === '⌫') saisi = saisi.slice(0, -1);
      else if (k === '✔') { envoyer(saisi); return; } else if (saisi.length < 8) saisi += k;
      aff.textContent = '•'.repeat(saisi.length) || '····';
    }));
    this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
    this.#minuterie();
  }

  #choisirEquipe() {
    const d = this.donnees;
    this.zone.innerHTML = `<h2>👥 Équipe</h2><div class="borne-grille">${d.equipes.map((e) => `<button type="button" class="borne-carte" data-e="${e.id}">${echapper(e.libelle)}<small>${e.membres.length} membre(s)</small></button>`).join('')}</div>
      <p><button type="button" class="borne-bouton" data-annuler>Annuler</button></p>`;
    this.zone.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => {
      const e = d.equipes.find((x) => String(x.id) === b.dataset.e);
      this.#membres(e);
    }));
    this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
    this.#minuterie();
  }

  #membres(e) {
    const nom = (id) => { const s = this.donnees.salaries.find((x) => x.id === id); return s ? `${s.prenom} ${s.nom}` : `Salarié ${id}`; };
    const choisis = new Set(e.membres);
    const rendre = () => {
      this.zone.innerHTML = `<h2>👥 ${echapper(e.libelle)} : présents</h2><div class="borne-grille">${e.membres.map((m) => `<button type="button" class="borne-carte ${choisis.has(m) ? 'choisi' : ''}" data-m="${m}">${choisis.has(m) ? '✔ ' : ''}${echapper(nom(m))}</button>`).join('')}</div>
        <p><button type="button" class="borne-bouton principal" data-suite ${choisis.size ? '' : 'disabled'}>Continuer (${choisis.size})</button> <button type="button" class="borne-bouton" data-annuler>Annuler</button></p>`;
      this.zone.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { const m = Number(b.dataset.m); if (choisis.has(m)) choisis.delete(m); else choisis.add(m); rendre(); }));
      this.zone.querySelector('[data-suite]').addEventListener('click', () => { this.etat.membres = [...choisis]; this.#memoriser(); this.#journee(); });
      this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
      this.#minuterie();
    };
    rendre();
  }

  /** Lignes de travail de la journée (copie des pointages saisis, modifiées jusqu'à l'enregistrement). */
  #chargerLignes() {
    this.etat.lignes = this.etat.journee.pointages.map((p) => ({ ...p }));
    this.etat.modifie = false;
  }

  /** Garde la saisie en cours dans le navigateur de la borne (reprise après une inactivité) ; rien à reprendre : effacée. */
  #memoriser() {
    const e = this.etat;
    if (!e?.journee) return;
    if (!e.modifie && !e.saisie) { ecrireReprise(null); return; }
    ecrireReprise({ appareil: this.donnees.appareil.pap_id, salarie: e.journee.salarie.id, date: e.journee.date, equipe: e.equipe, membres: e.membres, lignes: e.lignes, saisie: e.saisie });
  }

  #proposerReprise(r) {
    this.ecran = () => this.#proposerReprise(r);
    const n = r.lignes.filter((l) => l.nouveau || l.id === null).length;
    this.zone.innerHTML = `${this.#entete('Saisie interrompue')}
      <h2>Reprendre la saisie en cours ?</h2>
      <p>Journée du ${echapper(dateLongue(r.date))} : ${r.lignes.length} ligne(s)${n ? ` dont ${n} nouvelle(s)` : ''}, non enregistrée(s)${r.saisie ? ', une ligne en cours de choix' : ''}.</p>
      <p><button type="button" class="borne-bouton principal" data-reprendre>▶ Reprendre</button> <button type="button" class="borne-bouton" data-nouvelle>Nouvelle saisie</button></p>`;
    this.#brancherEntete();
    this.zone.querySelector('[data-nouvelle]').addEventListener('click', () => {
      ecrireReprise(null);
      if (this.etat.equipe) this.#choisirEquipe(); else this.#journee();
    });
    this.zone.querySelector('[data-reprendre]').addEventListener('click', async () => {
      try {
        if (r.date !== this.etat.journee.date) this.etat.journee = await appel('POST', '/journee', { jeton: this.etat.journee.jeton, date: r.date });
      } catch (e) { ecrireReprise(null); this.#erreur(e); this.#journee(); return; }
      Object.assign(this.etat, { lignes: r.lignes, saisie: r.saisie, membres: r.membres, modifie: true });
      if (!r.saisie) this.#liste();
      else if (r.saisie.type_mo == null) this.#typeMo();
      else this.#activite();
    });
    this.#minuterie();
  }

  #erreur(e) {
    alert(e.message);
    if (e.code === 'BORNE_JETON') this.#accueil('Identification expirée : identifiez-vous pour reprendre la saisie.');
  }

  #totalJour() { return this.etat.lignes.reduce((s, l) => s + (l.minutes > 0 ? l.minutes : 0), 0); }

  /**
   * Entête de tous les écrans après l'identification : salarié (équipe), écran, date de la journée (◀ ▶ dans la fenêtre
   * de rattrapage, retour à aujourd'hui) et heures déjà saisies du jour et de la semaine.
   */
  #entete(ecran) {
    const j = this.etat.journee;
    const m = this.etat.membres;
    return `<div class="borne-entete-saisie">
        <div><b>${echapper(j.salarie.prenom)} ${echapper(j.salarie.nom)}</b>${m ? ` — équipe de ${m.length}` : ''}<br><span class="aide">${this.test ? '🧪 essai · ' : ''}${echapper(ecran)}</span></div>
        <div class="borne-date"><button type="button" class="borne-touche" data-jour="-1" ${j.date <= j.premier_jour ? 'disabled' : ''} title="Jour précédent" aria-label="Jour précédent">◀</button>
          <span${j.date === j.aujourdhui ? '' : ' class="autre-jour"'}>${echapper(dateLongue(j.date))}</span>
          <button type="button" class="borne-touche" data-jour="1" ${j.date >= j.aujourdhui ? 'disabled' : ''} title="Jour suivant" aria-label="Jour suivant">▶</button>
          ${j.date === j.aujourdhui ? '' : '<button type="button" class="borne-bouton" data-jour="0">Aujourd\'hui</button>'}</div>
        <div class="borne-totaux">Déjà saisi : <b data-total-jour></b> ce jour<br><small data-total-semaine></small></div>
      </div>${j.bloque ? '<p class="borne-test">🔒 Journée validée : consultation seulement.</p>' : ''}`;
  }

  #majTotaux() {
    const j = this.etat.journee;
    const total = this.#totalJour();
    const tj = this.zone.querySelector('[data-total-jour]');
    if (tj) tj.textContent = `${ecrireDuree(total) || '0:00'} h`;
    const ts = this.zone.querySelector('[data-total-semaine]');
    if (ts) ts.textContent = `${ecrireDuree(j.total_semaine - j.total_jour + total) || '0:00'} h la semaine`;
  }

  #brancherEntete() {
    this.zone.querySelectorAll('[data-jour]').forEach((b) => b.addEventListener('click', () => this.#changerDate(Number(b.dataset.jour))));
    this.#majTotaux();
  }

  /** Autre journée (oubli de saisie) : relue par le serveur ; la ligne en cours de choix est gardée. */
  async #changerDate(delta) {
    const j = this.etat.journee;
    if (this.etat.modifie && !confirm('Les modifications non enregistrées de cette journée seront perdues. Changer de jour ?')) return;
    const date = delta === 0 ? j.aujourdhui : decalerJour(j.date, delta);
    try { this.etat.journee = await appel('POST', '/journee', { jeton: j.jeton, date }); } catch (e) { this.#erreur(e); return; }
    this.#chargerLignes();
    this.#memoriser();
    if (this.etat.journee.bloque) this.#liste(); else this.ecran();
  }

  /** Journée et choix du chantier (proposés : planning du jour, récents) ou de l'ordre (numéro / QR code). */
  #journee() {
    const j = this.etat.journee;
    if (j.bloque) { this.#liste(); return; }
    this.ecran = () => this.#journee();
    const n = this.etat.lignes.length;
    this.zone.innerHTML = `${this.#entete('Chantier ou ordre')}
      <p><input data-ordre class="borne-champ" placeholder="N° d'ordre ou QR code (OE2026-…)"> <button type="button" class="borne-bouton" data-lire>OK</button></p>
      <div class="borne-grille">${j.chantiers.map((c) => `<button type="button" class="borne-carte ${j.proposes.includes(c.id) ? 'propose' : ''}" data-c="${c.id}">${j.proposes.includes(c.id) ? '📅 ' : ''}<b>${echapper(c.code)}</b><small>${echapper(c.libelle)}</small></button>`).join('')}</div>
      <p><button type="button" class="borne-bouton principal" data-liste title="Aller directement à la liste des pointages de la journée">📋 Pointages du jour${n ? ` (${n})` : ''} ⏭</button>
        <button type="button" class="borne-bouton" data-terminer>Terminer</button></p>`;
    this.#brancherEntete();
    const choisir = (cha, ordre) => { this.etat.saisie = { cha_id: cha, ent_id: ordre ?? null }; this.#memoriser(); this.#typeMo(); };
    this.zone.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => choisir(Number(b.dataset.c))));
    const lire = async () => {
      const champ = this.zone.querySelector('[data-ordre]');
      const numero = champ.value.trim();
      if (!numero) return;
      try {
        const o = await appel('GET', `/ordre?numero=${encodeURIComponent(numero)}`);
        if (!j.chantiers.some((c) => c.id === o.cha_id)) j.chantiers.push({ id: o.cha_id, code: o.numero, libelle: o.objet ?? '' });
        if (!j.ordres.some((x) => x.id === o.id)) j.ordres.push(o);
        choisir(o.cha_id, o.id);
      } catch (e) { champ.value = ''; alert(e.message); }
    };
    this.zone.querySelector('[data-lire]').addEventListener('click', lire);
    this.zone.querySelector('[data-ordre]').addEventListener('keydown', (e) => { if (e.key === 'Enter') lire(); });
    this.zone.querySelector('[data-ordre]').focus();
    this.zone.querySelector('[data-liste]').addEventListener('click', () => { this.etat.saisie = null; this.#memoriser(); this.#liste(); });
    this.zone.querySelector('[data-terminer]').addEventListener('click', () => this.#terminer());
    this.#minuterie();
  }

  #terminer() {
    if (this.etat.modifie && !confirm('Abandonner les modifications non enregistrées de la journée ?')) return;
    ecrireReprise(null);
    this.#accueil();
  }

  /**
   * Grille de choix avec filtre (au-delà de `seuil` options) : `options` [{ cle, libelle, detail }], clic = `choisir(cle)`.
   */
  #grilleFiltree(conteneur, options, choisir, seuil = 6) {
    conteneur.innerHTML = `${options.length > seuil ?'<p><input type="search" data-filtre class="borne-champ" placeholder="Filtrer…"></p>' : ''}<div class="borne-grille" data-options></div>`;
    const rendre = (q = '') => {
      const t = q.trim().toLowerCase();
      const l = options.filter((o) => !t || `${o.libelle} ${o.detail ?? ''}`.toLowerCase().includes(t));
      conteneur.querySelector('[data-options]').innerHTML = l.map((o) => `<button type="button" class="borne-carte" data-o="${echapper(String(o.cle))}">${echapper(o.libelle)}${o.detail ? `<small>${echapper(o.detail)}</small>` : ''}</button>`).join('')
        || '<p>Aucun choix.</p>';
      conteneur.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => choisir(b.dataset.o)));
    };
    rendre();
    conteneur.querySelector('[data-filtre]')?.addEventListener('input', (e) => rendre(e.target.value));
  }

  /** Type de main-d'œuvre (un seul proposé : choisi d'office, écran passé). */
  #typeMo() {
    const s = this.etat.saisie;
    const types = this.donnees.referentiels.types_mo;
    if (types.length === 1) { s.type_mo = types[0].id; s.type_auto = true; this.#activite(); return; }
    s.type_auto = false;
    this.ecran = () => this.#typeMo();
    this.zone.innerHTML = `${this.#entete(`Type de main-d'œuvre${s.motif ? ` — ⚠ ${s.motif}` : ''}`)}<div data-grille></div>
      <p>${s.motif ? '' : '<button type="button" class="borne-bouton alerte" data-probleme>⚠ Signaler un problème</button> '}<button type="button" class="borne-bouton" data-retour>Retour</button></p>`;
    this.#brancherEntete();
    this.#grilleFiltree(this.zone.querySelector('[data-grille]'), types.map((t) => ({ cle: t.id, libelle: t.libelle, detail: t.code })), (cle) => {
      s.type_mo = Number(cle);
      this.#memoriser();
      this.#activite();
    });
    this.zone.querySelector('[data-probleme]')?.addEventListener('click', () => this.#probleme());
    this.zone.querySelector('[data-retour]').addEventListener('click', () => { if (s.motif) this.#probleme(); else { this.etat.saisie = null; this.#memoriser(); this.#journee(); } });
    this.#minuterie();
  }

  /** Activité (sous-type) filtrable ; une seule proposée ou non-conformité : choisie d'office, écran passé. */
  #activite() {
    const s = this.etat.saisie;
    const sousTypes = this.donnees.referentiels.sous_types;
    if (s.motif) { s.sous_type = sousTypes.find((x) => x.non_conformite)?.code ?? null; s.activite_auto = true; this.#ajouterLigne(); return; }
    const l = sousTypes.filter((x) => !x.non_conformite);
    if (l.length <= 1) { s.sous_type = l[0]?.code ?? null; s.activite_auto = true; this.#ajouterLigne(); return; }
    s.activite_auto = false;
    this.ecran = () => this.#activite();
    const type = this.donnees.referentiels.types_mo.find((t) => t.id === s.type_mo);
    this.zone.innerHTML = `${this.#entete(`Activité — ${type?.libelle ?? ''}`)}<div data-grille></div>
      <p><button type="button" class="borne-bouton alerte" data-probleme>⚠ Signaler un problème</button> <button type="button" class="borne-bouton" data-retour>Retour</button></p>`;
    this.#brancherEntete();
    this.#grilleFiltree(this.zone.querySelector('[data-grille]'), l.map((x) => ({ cle: x.code, libelle: x.libelle })), (cle) => { s.sous_type = cle; this.#ajouterLigne(); }, 3);
    this.zone.querySelector('[data-probleme]').addEventListener('click', () => this.#probleme());
    this.zone.querySelector('[data-retour]').addEventListener('click', () => { s.type_mo = null; this.#memoriser(); if (s.type_auto) { this.etat.saisie = null; this.#journee(); } else this.#typeMo(); });
    this.#minuterie();
  }

  /** Non-conformité : motif, puis type de travail (activité de non-conformité imposée) et heures perdues. */
  #probleme() {
    this.ecran = () => this.#probleme();
    this.zone.innerHTML = `${this.#entete('⚠ Quel problème ?')}<div class="borne-grille">${this.donnees.motifs.map((m) => `<button type="button" class="borne-carte" data-m="${echapper(m.libelle)}">${echapper(m.libelle)}</button>`).join('')}</div>
      <p><button type="button" class="borne-bouton" data-retour>Retour</button></p>`;
    this.#brancherEntete();
    this.zone.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      this.etat.saisie.motif = b.dataset.m;
      this.#memoriser();
      this.#typeMo();
    }));
    this.zone.querySelector('[data-retour]').addEventListener('click', () => { this.etat.saisie.motif = null; this.#typeMo(); });
    this.#minuterie();
  }

  /** Ligne choisie ajoutée à la liste du jour : durée proposée = reste d'une journée de 7 h (sinon 1 h). */
  #ajouterLigne() {
    const s = this.etat.saisie;
    const pas = this.donnees.referentiels.parametres.pas_minutes || 15;
    const reste = 420 - this.#totalJour();
    this.etat.lignes.push({
      id: null, cha_id: s.cha_id, ent_id: s.ent_id, type_mo: s.type_mo, sous_type: s.sous_type, minutes: reste >= pas ? reste : 60, motif: s.motif ?? null, commentaire: null,
      nouveau: true, en_cours: { ...s },
    });
    this.etat.saisie = null;
    this.etat.modifie = true;
    this.#memoriser();
    this.#liste(this.etat.lignes.length - 1);
  }

  /**
   * Pointages de la journée (dernier écran) : une ligne par pointage — chantier / ordre, main-d'œuvre, activité, durée
   * (− ＋, saisie libre), 💬 commentaire pour la synthèse MO, ⚠ note de non-conformité (renseignés : mis en évidence), ✕ —
   * ; barre en haut : durées fréquentes (appliquées au champ de durée qui a le focus), Enregistrer, Ajouter, Retour.
   * Journée validée : consultation. Équipe : seules les nouvelles lignes se saisissent (une par membre).
   */
  #liste(focus = null) {
    const j = this.etat.journee;
    const ref = this.donnees.referentiels;
    const lecture = j.bloque;
    const equipe = Boolean(this.etat.membres);
    const pas = ref.parametres.pas_minutes || 15;
    this.focus = focus ?? this.focus ?? null;
    if (this.focus !== null && !this.etat.lignes[this.focus]) this.focus = null;
    this.ecran = () => this.#liste(this.focus);
    const modifiable = (l) => !lecture && (!equipe || l.nouveau);
    const chantier = (id) => j.chantiers.find((c) => c.id === id);
    const ligne = (l, i) => {
      const c = chantier(l.cha_id);
      const o = l.ent_id ? j.ordres.find((x) => x.id === l.ent_id) : null;
      const t = ref.types_mo.find((x) => x.id === l.type_mo);
      const st = ref.sous_types.find((x) => x.code === l.sous_type);
      const m = modifiable(l);
      return `<div class="borne-ligne${l.nouveau ? ' nouvelle' : ''}" data-i="${i}">
        <div class="borne-ligne-detail"><b>${echapper(c?.code ?? `Chantier ${l.cha_id}`)}</b> ${echapper(c?.libelle ?? '')}${o ? `<br><small>Ordre ${echapper(o.numero ?? '')} ${echapper(o.objet ?? '')}</small>` : ''}
          <br><span>${echapper(t?.libelle ?? '')}${st ? ` · ${echapper(st.libelle)}` : ''}</span>${l.groupe ? ' <small class="aide">👥 équipe</small>' : ''}</div>
        <div class="borne-ligne-duree">${m ? `<button type="button" class="borne-touche" data-moins="${i}" aria-label="Moins">−</button><input class="borne-duree-champ" data-duree="${i}" value="${ecrireDuree(l.minutes)}" inputmode="decimal" aria-label="Durée"><button type="button" class="borne-touche" data-plus="${i}" aria-label="Plus">＋</button>`
          : `<span class="borne-duree-lecture">${ecrireDuree(l.minutes)} h</span>`}</div>
        <div class="borne-ligne-notes">
          <button type="button" class="borne-note${l.commentaire ? ' renseigne' : ''}" data-note="${i}" data-genre="commentaire" ${m || l.commentaire ? '' : 'disabled'} title="${l.commentaire ? echapper(l.commentaire) : 'Ajouter un commentaire pour la synthèse MO'}">💬 ${l.commentaire ? 'Commentaire' : 'Commenter'}</button>
          <button type="button" class="borne-note nc${l.motif ? ' renseigne' : ''}" data-note="${i}" data-genre="nc" ${m || l.motif ? '' : 'disabled'} title="${l.motif ? echapper(l.motif) : 'Ajouter une note de non-conformité'}">⚠ ${l.motif ? 'NC notée' : 'Note NC'}</button>
          ${m ? `<button type="button" class="borne-touche" data-retirer="${i}" title="Retirer la ligne" aria-label="Retirer la ligne">✕</button>` : ''}
        </div></div>`;
    };
    this.zone.innerHTML = `${this.#entete(lecture ? 'Pointages du jour (consultation)' : 'Pointages du jour')}
      <div class="borne-barre">${lecture ? '' : [60, 240, 420, 480].map((m) => `<button type="button" class="borne-bouton" data-rapide="${m}" title="Appliquer à la durée sélectionnée">${ecrireDuree(m)} h</button>`).join('')}
        <span class="borne-barre-espace"></span>
        ${lecture ? '' : '<button type="button" class="borne-bouton principal" data-enregistrer>✔ Enregistrer</button> <button type="button" class="borne-bouton" data-ajouter>＋ Ajouter</button>'}
        ${lecture ? '' : '<button type="button" class="borne-bouton" data-retour>Retour</button>'} <button type="button" class="borne-bouton" data-terminer>Terminer</button></div>
      <div class="borne-lignes">${this.etat.lignes.map(ligne).join('') || '<p>Aucun pointage ce jour.</p>'}</div>
      ${equipe ? '<p class="aide">Saisie d\'équipe : chaque nouvelle ligne est enregistrée pour chaque membre présent ; les lignes déjà saisies se modifient depuis la saisie de chacun.</p>' : ''}`;
    this.#brancherEntete();
    const changer = () => { this.etat.modifie = true; this.#memoriser(); this.#majTotaux(); };
    const champ = (i) => this.zone.querySelector(`[data-duree="${i}"]`);
    const ecrire = (i, minutes) => {
      this.etat.lignes[i].minutes = Math.max(0, Math.min(1440, minutes));
      const c = champ(i);
      if (c) { c.value = ecrireDuree(this.etat.lignes[i].minutes); c.classList.remove('invalide'); }
      changer();
    };
    this.zone.querySelectorAll('[data-duree]').forEach((c) => {
      const i = Number(c.dataset.duree);
      c.addEventListener('focus', () => { this.focus = i; this.zone.querySelectorAll('.borne-ligne').forEach((x) => x.classList.toggle('focus', x.dataset.i === String(i))); c.select(); });
      c.addEventListener('input', () => {
        const m = lireDuree(c.value);
        c.classList.toggle('invalide', m === null || m <= 0);
        this.etat.lignes[i].minutes = m ?? -1;
        changer();
      });
      c.addEventListener('change', () => { const m = lireDuree(c.value); if (m !== null && m > 0) c.value = ecrireDuree(m); });
    });
    this.zone.querySelectorAll('[data-moins]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.moins); ecrire(i, Math.max(pas, this.etat.lignes[i].minutes - pas)); }));
    this.zone.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.plus); ecrire(i, Math.max(0, this.etat.lignes[i].minutes) + pas); }));
    // Durées fréquentes : le champ de durée garde le focus (mousedown sans effet) et reçoit la valeur.
    this.zone.querySelectorAll('[data-rapide]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const i = this.focus ?? this.etat.lignes.findLastIndex((l) => modifiable(l));
        if (i < 0 || !modifiable(this.etat.lignes[i])) return;
        ecrire(i, Number(b.dataset.rapide));
        champ(i)?.focus();
      });
    });
    this.zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.retirer);
      this.etat.lignes.splice(i, 1);
      this.focus = null;
      changer();
      this.#liste();
    }));
    this.zone.querySelectorAll('[data-note]').forEach((b) => b.addEventListener('click', () => this.#note(Number(b.dataset.note), b.dataset.genre)));
    this.zone.querySelector('[data-enregistrer]')?.addEventListener('click', () => this.#enregistrer());
    this.zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      for (const l of this.etat.lignes) delete l.en_cours;
      this.#journee();
    });
    // Retour : la ligne qui vient d'être choisie est retirée, retour à son dernier écran de choix ; sinon, aux chantiers.
    this.zone.querySelector('[data-retour]')?.addEventListener('click', () => {
      const der = this.etat.lignes.at(-1);
      if (!der?.en_cours) { this.#journee(); return; }
      this.etat.lignes.pop();
      this.etat.saisie = { ...der.en_cours };
      this.etat.modifie = this.etat.lignes.some((l) => l.nouveau) || this.etat.modifie;
      this.#memoriser();
      if (!this.etat.saisie.activite_auto) this.#activite();
      else if (this.etat.saisie.motif) this.#typeMo();
      else if (!this.etat.saisie.type_auto) { this.etat.saisie.type_mo = null; this.#typeMo(); } else { this.etat.saisie = null; this.#journee(); }
    });
    this.zone.querySelector('[data-terminer]').addEventListener('click', () => this.#terminer());
    const f = this.focus !== null ? champ(this.focus) : null;
    if (f) f.focus();
    this.#minuterie();
  }

  /** Commentaire pour la synthèse MO ou note de non-conformité (motifs proposés) d'une ligne. */
  #note(i, genre) {
    const l = this.etat.lignes[i];
    const nc = genre === 'nc';
    const lecture = this.etat.journee.bloque || (this.etat.membres && !l.nouveau);
    const ref = this.donnees.referentiels;
    const c = this.etat.journee.chantiers.find((x) => x.id === l.cha_id);
    this.ecran = () => this.#note(i, genre);
    this.zone.innerHTML = `${this.#entete(nc ? '⚠ Note de non-conformité' : '💬 Commentaire pour la synthèse MO')}
      <p class="borne-journee"><b>${echapper(c?.code ?? '')}</b> ${echapper(c?.libelle ?? '')} · ${echapper(ref.types_mo.find((x) => x.id === l.type_mo)?.libelle ?? '')}
        · ${echapper(ref.sous_types.find((x) => x.code === l.sous_type)?.libelle ?? '')} · ${ecrireDuree(l.minutes)} h</p>
      ${nc && !lecture ? `<div class="borne-grille">${this.donnees.motifs.map((m) => `<button type="button" class="borne-carte" data-motif="${echapper(m.libelle)}">${echapper(m.libelle)}</button>`).join('')}</div>` : ''}
      <textarea class="borne-texte" data-texte rows="4" ${lecture ? 'readonly' : ''} placeholder="${nc ? 'Motif de la non-conformité…' : 'Commentaire…'}">${echapper((nc ? l.motif : l.commentaire) ?? '')}</textarea>
      <p>${lecture ? '' : '<button type="button" class="borne-bouton principal" data-ok>✔ OK</button> <button type="button" class="borne-bouton" data-effacer>Effacer</button> '}<button type="button" class="borne-bouton" data-retour>Retour</button></p>`;
    this.#brancherEntete();
    const texte = this.zone.querySelector('[data-texte]');
    this.zone.querySelectorAll('[data-motif]').forEach((b) => b.addEventListener('click', () => { texte.value = b.dataset.motif; texte.focus(); }));
    const fin = (valeur) => {
      if (valeur !== undefined) {
        l[nc ? 'motif' : 'commentaire'] = valeur.trim() || null;
        this.etat.modifie = true;
        this.#memoriser();
      }
      this.#liste(i);
    };
    this.zone.querySelector('[data-ok]')?.addEventListener('click', () => fin(texte.value));
    this.zone.querySelector('[data-effacer]')?.addEventListener('click', () => fin(''));
    this.zone.querySelector('[data-retour]').addEventListener('click', () => fin());
    if (!lecture) texte.focus();
    this.#minuterie();
  }

  /** Enregistre la journée (individuel : la liste remplace la journée ; équipe : chaque nouvelle ligne pour les membres). */
  async #enregistrer() {
    const j = this.etat.journee;
    const lignes = this.etat.lignes;
    if (lignes.some((l) => !(l.minutes > 0))) { alert('Durée invalide sur une ligne (exemples : 7:30, 7h30, 7,5).'); return; }
    const corps = (l) => ({ id: l.id ?? null, cha_id: l.cha_id, ent_id: l.ent_id ?? null, type_mo: l.type_mo, sous_type: l.sous_type ?? null, minutes: l.minutes, motif: l.motif ?? null, commentaire: l.commentaire ?? null });
    try {
      if (this.etat.membres) {
        for (const l of lignes.filter((x) => x.nouveau)) {
          await appel('POST', '/pointages', { jeton: j.jeton, date: j.date, ...corps(l), membres: this.etat.membres });
          l.nouveau = false;
          this.#memoriser();
        }
      } else {
        await appel('PUT', '/journee', { jeton: j.jeton, date: j.date, pointages: lignes.map(corps) });
      }
    } catch (e) { this.#erreur(e); return; }
    ecrireReprise(null);
    const total = this.#totalJour();
    const membres = this.etat.membres;
    this.#accueil(`✔ ${dateLongue(j.date)} : ${ecrireDuree(total) || '0:00'} h ${this.test ? 'contrôlées (essai : non enregistrées)' : 'enregistrées'}${membres ? ` pour ${membres.length} personnes` : ''}.`);
    this.#minuterie(8000);
  }
}

/** Administration des bornes (appareils enregistrés, jeton remis une fois) et des PIN des salariés. */
export class PageParametresBornes extends PageBase {
  icone = '🏭';

  async ouvrir() {
    this.titre = 'Bornes de pointage';
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><div class="entete-page"><h1 class="page-titre">🏭 Bornes de pointage</h1></div><div data-bornes></div>
      <div class="titre-actions"><h2>PIN des salariés</h2></div><div data-pins></div></div>`;
    if (!this.app.enLigne) return;
    this.ref = await api.pointage.referentiels();
    await this.#bornes();
    await this.#pins();
  }

  /**
   * Bornes : une ligne par borne (salariés proposés — services et fonctions —, types de main-d'œuvre, état) ; ✎ ouvre
   * son paramétrage sous la ligne (libellé, PIN exigé, services, fonctions = postes des salariés, types de MO ; vide :
   * tous), ⏸ / ⏵ la désactive ou la réactive, ▶ l'essaie dans une fenêtre séparée. Création : libellé et PIN exigé,
   * puis le paramétrage s'ouvre.
   */
  async #bornes(ouverte = null) {
    const zone = this.conteneur.querySelector('[data-bornes]');
    let l;
    try { l = await api.pointage.appareils(); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const admin = this.app.estAdmin();
    const ref = this.ref;
    const libelles = (ids, liste, champ = 'libelle') => ids.map((id) => liste.find((x) => x.id === id)?.[champ] ?? `#${id}`);
    const resume = (valeurs) => (valeurs.length ? echapper(valeurs.join(', ')) : '<span class="aide">tous</span>');
    zone.innerHTML = `<table class="tableau-compact largeur-contenu bornes"><thead><tr><th>Borne<br><small>état · vue le</small></th><th>PIN<br><small>exigé</small></th>
        <th>Services<br><small>fonctions</small></th><th>Types de main-d'œuvre</th><th></th></tr></thead><tbody>
      ${l.map((a) => `<tr data-borne="${a.id}"${a.actif ? '' : ' class="discret"'}><td>${echapper(a.libelle)}<br><small class="aide">${a.actif ? 'active' : 'désactivée'} · ${a.vu_le ? new Date(a.vu_le).toLocaleString('fr-FR') : 'jamais vue'}</small></td>
        <td>${a.pin_exige ? 'oui' : 'non'}</td>
        <td>${resume(libelles(a.services, ref.services))}<br><small class="aide">${a.fonctions.length ? echapper(a.fonctions.join(', ')) : 'toutes fonctions'}</small></td>
        <td>${resume(libelles(a.types_mo, ref.types_mo))}</td>
        <td class="cellule-boutons">${admin ? `<button type="button" class="bouton-icone" data-parametrer="${a.id}" title="Paramétrer la borne : salariés proposés (services, fonctions), types de main-d'œuvre" aria-label="Paramétrer la borne">✎</button>` : ''}
          <button type="button" class="bouton-icone" data-basculer="${a.id}" title="${a.actif ? 'Désactiver la borne' : 'Réactiver la borne'}" aria-label="${a.actif ? 'Désactiver la borne' : 'Réactiver la borne'}">${a.actif ? '⏸' : '⏵'}</button>
          ${admin ? `<button type="button" class="bouton-icone" data-tester="${a.id}" title="Tester : ouvrir la borne dans une fenêtre séparée (PIN facultatif, pointages non enregistrés)" aria-label="Tester la borne">▶</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? `<p class="ligne"><input data-libelle placeholder="Libellé (Atelier bois…)"> <label><input type="checkbox" data-pin checked> PIN exigé</label>
        <button type="button" class="bouton-icone" data-creer title="Enregistrer une nouvelle borne (jeton affiché une seule fois), puis la paramétrer" aria-label="Enregistrer une borne">＋</button></p>` : ''}<div data-jeton></div>`;
    const parametrer = (a) => {
      zone.querySelector('tr.parametrage-borne')?.remove();
      const tr = zone.querySelector(`tr[data-borne="${a.id}"]`);
      const ligne = document.createElement('tr');
      ligne.className = 'parametrage-borne';
      ligne.innerHTML = `<td colspan="5"><div class="formulaire parametrage-borne-champs">
          <label>Libellé <input data-p-libelle value="${echapper(a.libelle)}" maxlength="80"></label>
          <label class="fiche-option"><input type="checkbox" data-p-pin ${a.pin_exige ? 'checked' : ''}> PIN exigé</label>
          <div><b>Services</b> <small class="aide">service principal du salarié ou son service parent ; aucun : tous</small><div data-p-services></div></div>
          <div><b>Fonctions</b> <small class="aide">poste du salarié ; aucune : toutes</small><div data-p-fonctions></div></div>
          <div><b>Types de main-d'œuvre</b> <small class="aide">proposés à la borne ; aucun : tous</small><div data-p-types></div></div>
        </div><p class="ligne"><button type="button" class="principal" data-p-enregistrer title="Enregistrer le paramétrage de la borne">💾 Enregistrer</button>
          <button type="button" data-p-annuler>Annuler</button></p></td>`;
      tr.after(ligne);
      const services = choixMultiple({ options: ref.services.map((x) => ({ valeur: x.id, libelle: x.parent_id ? `↳ ${x.libelle}` : x.libelle, detail: x.code })), valeurs: a.services, titre: 'Ajouter un service' });
      const fonctions = choixMultiple({ options: (ref.fonctions ?? []).map((x) => ({ valeur: x, libelle: x })), valeurs: a.fonctions, titre: 'Ajouter une fonction' });
      const types = choixMultiple({ options: ref.types_mo.map((x) => ({ valeur: x.id, libelle: x.libelle, detail: x.code })), valeurs: a.types_mo, titre: 'Ajouter un type de main-d\'œuvre' });
      ligne.querySelector('[data-p-services]').append(services);
      ligne.querySelector('[data-p-fonctions]').append(fonctions);
      ligne.querySelector('[data-p-types]').append(types);
      ligne.querySelector('[data-p-annuler]').addEventListener('click', () => ligne.remove());
      ligne.querySelector('[data-p-enregistrer]').addEventListener('click', async () => {
        try {
          await api.pointage.modifierAppareil(a.id, {
            libelle: ligne.querySelector('[data-p-libelle]').value, pin_exige: ligne.querySelector('[data-p-pin]').checked, actif: a.actif,
            services: services.valeurs.map(Number), fonctions: fonctions.valeurs.map(String), types_mo: types.valeurs.map(Number),
          });
          this.app.message('Borne paramétrée', 'succes');
          await this.#bornes();
        } catch (e) { this.app.erreur(e); }
      });
    };
    zone.querySelectorAll('[data-parametrer]').forEach((bt) => bt.addEventListener('click', () => parametrer(l.find((x) => String(x.id) === bt.dataset.parametrer))));
    if (ouverte !== null) { const a = l.find((x) => x.id === ouverte); if (a) parametrer(a); }
    zone.querySelectorAll('[data-tester]').forEach((bt) => bt.addEventListener('click', async () => {
      try {
        const { jeton } = await api.pointage.testerAppareil(Number(bt.dataset.tester));
        this.app.naviguer(`/borne?test=${encodeURIComponent(jeton)}`, { nouvelleFenetre: true });
      } catch (e) { this.app.erreur(e); }
    }));
    zone.querySelectorAll('[data-basculer]').forEach((bt) => bt.addEventListener('click', async () => {
      const a = l.find((x) => String(x.id) === bt.dataset.basculer);
      // Seul l'état change : services, fonctions et types de MO non envoyés (inchangés).
      try { await api.pointage.modifierAppareil(a.id, { libelle: a.libelle, pin_exige: a.pin_exige, actif: !a.actif }); await this.#bornes(); } catch (e) { this.app.erreur(e); }
    }));
    zone.querySelector('[data-creer]')?.addEventListener('click', async () => {
      try {
        const r = await api.pointage.creerAppareil({ libelle: zone.querySelector('[data-libelle]').value, pin_exige: zone.querySelector('[data-pin]').checked });
        await this.#bornes(r.id);
        const lien = `${location.origin}/borne?jeton=${encodeURIComponent(r.jeton)}`;
        this.conteneur.querySelector('[data-jeton]').innerHTML = `<p class="avertissement">Jeton de la borne (affiché une seule fois) : <code>${echapper(r.jeton)}</code><br>
          Ouvrir sur la borne : <code>${echapper(lien)}</code> (le jeton est ensuite gardé par le navigateur de la borne).</p>`;
      } catch (e) { this.app.erreur(e); }
    });
  }

  async #pins() {
    const zone = this.conteneur.querySelector('[data-pins]');
    zone.innerHTML = '<p class="ligne"><span data-service></span></p><div data-liste></div>';
    const srv = creerCombo({ options: this.ref.services.map((s) => ({ valeur: s.id, libelle: s.libelle })), valeur: '', vide: true, titre: 'Service' });
    zone.querySelector('[data-service]').append(srv);
    const charger = async () => {
      if (!srv.valeurCombo) { zone.querySelector('[data-liste]').innerHTML = '<p class="aide">Choisissez un service.</p>'; return; }
      const l = await api.pointage.pins(srv.valeurCombo).catch((e) => { this.app.erreur(e); return []; });
      zone.querySelector('[data-liste]').innerHTML = `<div class="tableau-defilant largeur-contenu"><table class="tableau-compact"><thead><tr><th>Salarié<br><small>matricule</small></th><th>PIN</th><th>Nouveau PIN</th><th></th></tr></thead><tbody>${l.slice(0, 300).map((x) => `<tr><td class="synthese-nom">${echapper(x.salarie.nom)} ${echapper(x.salarie.prenom)}<br><small class="aide">${echapper(x.salarie.matricule)}</small></td><td>${x.pin ? `posé${x.bloque ? ' <span class="badge-exception">bloqué</span>' : ''}` : '<span class="aide">sans PIN</span>'}</td>
        <td><input data-pin="${x.salarie.id}" size="8" inputmode="numeric" placeholder="4 à 8 chiffres"></td><td class="cellule-boutons"><button type="button" class="bouton-icone" data-poser="${x.salarie.id}" title="Poser ce PIN (débloque le salarié)" aria-label="Poser le PIN">✔</button>${x.pin ? ` <button type="button" class="bouton-icone" data-retirer="${x.salarie.id}" title="Retirer le PIN" aria-label="Retirer le PIN">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      zone.querySelectorAll('[data-poser]').forEach((b) => b.addEventListener('click', async () => {
        try { await api.pointage.poserPin(b.dataset.poser, { pin: zone.querySelector(`[data-pin="${b.dataset.poser}"]`).value }); this.app.message('PIN enregistré', 'succes'); await charger(); } catch (e) { this.app.erreur(e); }
      }));
      zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', async () => {
        try { await api.pointage.poserPin(b.dataset.retirer, { pin: null }); await charger(); } catch (e) { this.app.erreur(e); }
      }));
    };
    srv.addEventListener('change', charger);
    await charger();
  }
}

/** Saisie d'équipe (M6) : pointages du groupe, membres sortis du groupe signalés, modification de ceux encore identiques. */
export class PageGroupePointage extends PageBase {
  icone = '👥';

  async ouvrir() {
    this.titre = 'Saisie d\'équipe';
    this.conteneur.innerHTML = '<div class="page-parametres page-pointage"><div class="entete-page"><h1 class="page-titre">👥 Saisie d\'équipe</h1></div><div data-groupe></div></div>';
    if (!this.app.enLigne) return;
    this.ref = await api.pointage.referentiels();
    await this.#charger();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-groupe]');
    let g;
    try { g = await api.pointage.groupe(this.requete.id); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const ref = g.pointages.find((p) => p.identique);
    zone.innerHTML = `${g.origine ? '<p class="aide">Équipe d\'origine : tous les pointages sont identiques.</p>' : '<p class="avertissement">L\'équipe n\'est plus celle d\'origine : des pointages ont été modifiés à part.</p>'}
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Salarié</th><th>Date</th><th class="nombre">Heures</th><th>Groupe</th></tr></thead><tbody>
      ${g.pointages.map((p) => `<tr><td>${echapper(p.salarie ? `${p.salarie.nom} ${p.salarie.prenom}` : '')}</td><td>${new Date(`${p.date}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</td><td class="nombre">${ecrireDuree(p.minutes)}</td><td>${p.identique ? '✔' : '<span class="badge-exception">à part</span>'}</td></tr>`).join('')}</tbody></table>
      <p class="ligne">Nouvelle durée pour les pointages du groupe : <input data-duree size="6" value="${ecrireDuree(ref?.minutes ?? 0)}"> <button type="button" data-appliquer title="Appliquer la durée à tous les pointages identiques du groupe">✔ Appliquer au groupe</button></p>`;
    zone.querySelector('[data-appliquer]').addEventListener('click', async () => {
      const minutes = lireDuree(zone.querySelector('[data-duree]').value);
      if (!minutes || !ref) return;
      try {
        await api.pointage.modifierGroupe(this.requete.id, { cha_id: ref.cha_id, ent_id: ref.ent_id, type_mo: ref.type_mo, sous_type: ref.sous_type, minutes, motif: ref.motif });
        this.app.message('Groupe modifié', 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
