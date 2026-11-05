import { MODULE_FACULTATIF } from '../codes.js';
import { ajouterJours } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, formatNombre, alerter, confirmer, saisir, formatDate, formatDateHeure, PadSignature } from '@logibtp/socle/ui';
import { ecrireDuree, lireDuree, ERREUR_POINTAGE } from '@logibtp/pointage';
import { EcranEtapesAtelier } from '@logibtp/execution/ui';
import { texte, texteHtml, icone, iconeHtml, langue, messageErreur } from '@logibtp/socle/dictionnaire';
import { api } from '../api.js';
import { choixMultiple } from '../choix-multiple.js';
import { tuilesChoix, filtrerChoix, tuileExacte } from '../pointage/choix-borne.js';
import { distanceRestaurant, chantierDuJour } from '../pointage/repas.js';

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

const dateLongue = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(langue(), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

class ErreurBorne extends Error {
  constructor(statut, code, message) { super(messageErreur(code, message)); this.statut = statut; this.code = code; }
}

async function appel(methode, url, corps) {
  const r = await fetch(`/api/pointage/borne${url}`, {
    method: methode, headers: { 'Content-Type': 'application/json', 'X-Borne-Jeton': lireJeton() ?? '' }, body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const t = await r.text();
  const d = t ? JSON.parse(t) : null;
  if (!r.ok) throw new ErreurBorne(r.status, d?.code, d?.title ?? d?.message ?? texte('pointage.borne.erreur', { statut: r.status }));
  return d;
}

/** Bouton « Signaler un problème » (non-conformité) des écrans de choix. */
const BOUTON_PROBLEME = `<button type="button" class="borne-bouton alerte" data-probleme>${iconeHtml('avertissement')} ${texteHtml('pointage.borne.signaler')}</button>`;
/** Affichage du PIN encore vide (points du catalogue des icônes). */
const PIN_VIDE = icone('pointage_pin_vide');

const initiales = (s) => `${s.prenom?.[0] ?? ''}${s.nom?.[0] ?? ''}`.toUpperCase();

export class PageBorne extends PageBase {
  icone = icone('pointage_borne');

  async ouvrir() {
    this.titre = texte('pointage.borne.titre');
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
    this.titre = `${this.test ? `${icone('pointage_essai')} ` : ''}${this.donnees.appareil.libelle}`;
    this.#accueil();
  }

  fermer() { document.body.classList.remove('mode-borne'); clearTimeout(this.retour); }

  #enregistrement(message) {
    this.zone.innerHTML = `<h1>${iconeHtml('pointage_borne')} ${texteHtml('pointage.borne.titre')}</h1>${message ? `<p class="borne-erreur">${echapper(message)}</p>` : ''}
      <p>${texteHtml('pointage.borne.non_enregistree')}</p>
      <p><input data-jeton size="48" placeholder="${texteHtml('pointage.borne.jeton')}"> <button type="button" class="borne-bouton" data-ok>${texteHtml('commun.enregistrer')}</button></p>`;
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
    this.retour = setTimeout(() => this.#accueil(this.etat?.modifie || this.etat?.saisie ? texte('pointage.borne.interrompue') : undefined), ms);
  }

  #accueil(message) {
    clearTimeout(this.retour);
    this.etat = null;
    const d = this.donnees;
    this.zone.innerHTML = `<div class="borne-entete"><h1>${iconeHtml('pointage_borne')} ${echapper(d.appareil.libelle)}</h1><span>${new Date().toLocaleDateString(langue(), { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      ${this.test ? `<p class="borne-test">${iconeHtml('pointage_essai')} ${texteHtml('pointage.borne.mode_essai')}${d.appareil.actif ? '' : ` · ${texteHtml('pointage.borne.desactivee')}`}.</p>` : ''}
      ${message ? `<p class="borne-succes">${echapper(message)}</p>` : ''}
      <p><input type="search" data-cherche placeholder="${texteHtml('pointage.borne.chercher_nom')}" class="borne-champ"> ${d.equipes.length ? `<button type="button" class="borne-bouton" data-equipe>${iconeHtml('pointage_equipe')} ${texteHtml('pointage.borne.saisie_equipe')}</button>` : ''}</p>
      <div class="borne-grille" data-salaries></div>`;
    const rendre = (q = '') => {
      const l = d.salaries.filter((s) => !q || `${s.nom} ${s.prenom} ${s.matricule}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
      this.zone.querySelector('[data-salaries]').innerHTML = l.map((s) => `<button type="button" class="borne-carte" data-id="${s.id}"><span class="borne-avatar">${echapper(initiales(s))}</span>${echapper(s.prenom)} ${echapper(s.nom)}</button>`).join('')
        || `<p>${texteHtml('pointage.saisie.aucun')}</p>`;
      this.zone.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => this.#identifier(Number(b.dataset.id), false)));
    };
    rendre();
    this.zone.querySelector('[data-cherche]').addEventListener('input', (e) => rendre(e.target.value));
    this.zone.querySelector('[data-equipe]')?.addEventListener('click', () => this.#choisirChef());
  }

  #choisirChef() {
    this.zone.innerHTML = `<h2>${iconeHtml('pointage_equipe')} ${texteHtml('pointage.borne.qui_chef')}</h2><div class="borne-grille">${this.donnees.salaries.slice(0, 60).map((s) => `<button type="button" class="borne-carte" data-id="${s.id}"><span class="borne-avatar">${echapper(initiales(s))}</span>${echapper(s.prenom)} ${echapper(s.nom)}</button>`).join('')}</div>
      <p><button type="button" class="borne-bouton" data-annuler>${texteHtml('commun.annuler')}</button></p>`;
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
    this.zone.innerHTML = `<h2>${texteHtml('pointage.borne.code_pin', { nom: `${s.prenom} ${s.nom}` })}</h2>${erreur ? `<p class="borne-erreur">${echapper(erreur)}</p>` : ''}
      <p class="borne-pin" data-affichage>${PIN_VIDE}</p>
      <div class="borne-clavier">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'effacer', 0, 'ok'].map((k) => `<button type="button" class="borne-touche" data-k="${k}">${typeof k === 'number' ? k : iconeHtml(`pointage_pin_${k}`)}</button>`).join('')}</div>
      <p>${this.test ? `<button type="button" class="borne-bouton" data-passer title="${texteHtml('pointage.borne.passer_aide')}">${texteHtml('pointage.borne.passer')}</button> ` : ''}<button type="button" class="borne-bouton" data-annuler>${texteHtml('commun.annuler')}</button></p>`;
    this.zone.querySelector('[data-passer]')?.addEventListener('click', () => envoyer(null));
    const aff = this.zone.querySelector('[data-affichage]');
    this.zone.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'effacer') saisi = saisi.slice(0, -1);
      else if (k === 'ok') { envoyer(saisi); return; } else if (saisi.length < 8) saisi += k;
      aff.textContent = icone('pointage_pin_chiffre').repeat(saisi.length) || PIN_VIDE;
    }));
    this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
    this.#minuterie();
  }

  #choisirEquipe() {
    const d = this.donnees;
    this.zone.innerHTML = `<h2>${iconeHtml('pointage_equipe')} ${texteHtml('pointage.borne.equipe')}</h2><div class="borne-grille">${d.equipes.map((e) => `<button type="button" class="borne-carte" data-e="${e.id}">${echapper(e.libelle)}<small>${texteHtml('pointage.borne.membres', { nombre: e.membres.length })}</small></button>`).join('')}</div>
      <p><button type="button" class="borne-bouton" data-annuler>${texteHtml('commun.annuler')}</button></p>`;
    this.zone.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => {
      const e = d.equipes.find((x) => String(x.id) === b.dataset.e);
      this.#membres(e);
    }));
    this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
    this.#minuterie();
  }

  #membres(e) {
    const nom = (id) => { const s = this.donnees.salaries.find((x) => x.id === id); return s ? `${s.prenom} ${s.nom}` : texte('pointage.synthese.salarie', { id }); };
    const choisis = new Set(e.membres);
    const rendre = () => {
      this.zone.innerHTML = `<h2>${iconeHtml('pointage_equipe')} ${texteHtml('pointage.borne.presents', { equipe: e.libelle })}</h2><div class="borne-grille">${e.membres.map((m) => `<button type="button" class="borne-carte ${choisis.has(m) ? 'choisi' : ''}" data-m="${m}">${choisis.has(m) ? `${iconeHtml('pointage_ok')} ` : ''}${echapper(nom(m))}</button>`).join('')}</div>
        <p><button type="button" class="borne-bouton principal" data-suite ${choisis.size ? '' : 'disabled'}>${texteHtml('pointage.borne.continuer', { nombre: choisis.size })}</button> <button type="button" class="borne-bouton" data-annuler>${texteHtml('commun.annuler')}</button></p>`;
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
    this.zone.innerHTML = `${this.#entete(texte('pointage.borne.ecran_interrompue'))}
      <h2>${texteHtml('pointage.borne.reprendre_question')}</h2>
      <p>${texteHtml('pointage.borne.reprise', { date: dateLongue(r.date), lignes: r.lignes.length })}${n ? ` ${texteHtml('pointage.borne.reprise_nouvelles', { nombre: n })}` : ''}${texteHtml('pointage.borne.reprise_non_enregistrees')}${r.saisie ? texteHtml('pointage.borne.reprise_en_cours') : ''}.</p>
      <p><button type="button" class="borne-bouton principal" data-reprendre>${iconeHtml('suivant')} ${texteHtml('pointage.borne.reprendre')}</button> <button type="button" class="borne-bouton" data-nouvelle>${texteHtml('pointage.borne.nouvelle_saisie')}</button></p>`;
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

  async #erreur(e) {
    await alerter(e.message);
    if (e.code === ERREUR_POINTAGE.BORNE_JETON) this.#accueil(texte('pointage.borne.identification_expiree'));
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
        <div><b>${echapper(j.salarie.prenom)} ${echapper(j.salarie.nom)}</b>${m ? ` — ${texteHtml('pointage.borne.equipe_de', { nombre: m.length })}` : ''}<br><span class="aide">${this.test ? `${iconeHtml('pointage_essai')} ${texteHtml('pointage.borne.essai')} · ` : ''}${echapper(ecran)}</span></div>
        <div class="borne-date"><button type="button" class="borne-touche" data-jour="-1" ${j.date <= j.premier_jour ? 'disabled' : ''} title="${texteHtml('pointage.borne.jour_precedent')}" aria-label="${texteHtml('pointage.borne.jour_precedent')}">${iconeHtml('precedent')}</button>
          <span${j.date === j.aujourdhui ? '' : ' class="autre-jour"'}>${echapper(dateLongue(j.date))}</span>
          <button type="button" class="borne-touche" data-jour="1" ${j.date >= j.aujourdhui ? 'disabled' : ''} title="${texteHtml('pointage.borne.jour_suivant')}" aria-label="${texteHtml('pointage.borne.jour_suivant')}">${iconeHtml('suivant')}</button>
          ${j.date === j.aujourdhui ? '' : `<button type="button" class="borne-bouton" data-jour="0">${texteHtml('pointage.borne.aujourdhui')}</button>`}</div>
        <div class="borne-totaux">${texteHtml('pointage.borne.deja_saisi_html')}<br><small data-total-semaine></small></div>
      </div>${j.bloque ? `<p class="borne-test">${iconeHtml('verrou')} ${texteHtml('pointage.borne.journee_validee')}</p>` : ''}`;
  }

  #majTotaux() {
    const j = this.etat.journee;
    const total = this.#totalJour();
    const tj = this.zone.querySelector('[data-total-jour]');
    if (tj) tj.textContent = texte('pointage.borne.heures', { duree: ecrireDuree(total) || '0:00' });
    const ts = this.zone.querySelector('[data-total-semaine]');
    if (ts) ts.textContent = texte('pointage.borne.heures_semaine', { duree: ecrireDuree(j.total_semaine - j.total_jour + total) || '0:00' });
  }

  #brancherEntete() {
    this.zone.querySelectorAll('[data-jour]').forEach((b) => b.addEventListener('click', () => this.#changerDate(Number(b.dataset.jour))));
    this.#majTotaux();
  }

  /** Autre journée (oubli de saisie) : relue par le serveur ; la ligne en cours de choix est gardée. */
  async #changerDate(delta) {
    const j = this.etat.journee;
    if (this.etat.modifie && !await confirmer(texte('pointage.borne.changer_jour'))) return;
    const date = delta === 0 ? j.aujourdhui : ajouterJours(j.date, delta);
    try { this.etat.journee = await appel('POST', '/journee', { jeton: j.jeton, date }); } catch (e) { this.#erreur(e); return; }
    this.#chargerLignes();
    this.#memoriser();
    if (this.etat.journee.bloque) this.#liste(); else this.ecran();
  }

  /**
   * Journée et choix du chantier (proposés : planning du jour, récents ; « 🔎 Tous » : tous les chantiers et les ordres en
   * cours, A30) ou de l'ordre ; le champ filtre les tuiles en direct (code, libellé, ville, client, numéro d'ordre) et,
   * à l'Entrée, prend la tuile désignée exactement ou la seule restante, sinon cherche le numéro d'ordre (QR code).
   */
  #journee() {
    const j = this.etat.journee;
    if (j.bloque) { this.#liste(); return; }
    this.ecran = () => this.#journee();
    const n = this.etat.lignes.length;
    this.zone.innerHTML = `${this.#entete(texte('pointage.borne.ecran_chantier'))}
      <p><input data-ordre class="borne-champ" placeholder="${texteHtml('pointage.borne.chercher_chantier')}" autocomplete="off"> <button type="button" class="borne-bouton" data-lire>${texteHtml('commun.ok')}</button>
        <button type="button" class="borne-bouton ${this.etat.tous ? 'principal' : ''}" data-tous title="${texteHtml('pointage.borne.tous_aide')}">${iconeHtml('pointage_tous')} ${texteHtml('pointage.borne.tous')}</button></p>
      <div class="borne-grille" data-tuiles></div>
      <p><button type="button" class="borne-bouton principal" data-liste title="${texteHtml('pointage.borne.pointages_jour_aide')}">${iconeHtml('pointage_liste')} ${texteHtml('pointage.borne.pointages_jour')}${n ? ` (${n})` : ''} ${iconeHtml('pointage_passer')}</button>
        <button type="button" class="borne-bouton" data-etapes title="${texteHtml('pointage.borne.etapes_aide')}">${iconeHtml('pointage_ordre')} ${texteHtml('pointage.borne.etapes')}</button>
        <button type="button" class="borne-bouton" data-stock title="${texteHtml('pointage.borne.stock_aide')}">${iconeHtml('pointage_stock')} ${texteHtml('pointage.borne.stock')}</button>
        <button type="button" class="borne-bouton" data-terminer>${texteHtml('pointage.borne.terminer')}</button></p>`;
    this.#brancherEntete();
    this.zone.querySelector('[data-etapes]').addEventListener('click', () => this.#etapes());
    this.zone.querySelector('[data-stock]').addEventListener('click', () => this.#stock());
    const choisir = (cha, ordre) => { this.etat.saisie = { cha_id: cha, ent_id: ordre ?? null }; this.#memoriser(); this.#typeMo(); };
    const champ = this.zone.querySelector('[data-ordre]');
    const grille = this.zone.querySelector('[data-tuiles]');
    // « Tous » : chantiers de la journée (proposés, récents, même clos) puis tous les chantiers ouverts, et leurs ordres en cours.
    const tuiles = () => (this.etat.tous
      ? tuilesChoix([...j.chantiers, ...this.etat.tous.chantiers.filter((c) => !j.chantiers.some((x) => x.id === c.id))], this.etat.tous.ordres)
      : tuilesChoix(j.chantiers));
    // Tuile choisie : chantier et ordre ajoutés à la journée s'ils viennent de la liste complète (libellés de la liste des pointages).
    const prendre = (t) => {
      const c = this.etat.tous?.chantiers.find((x) => x.id === t.cha_id);
      if (c && !j.chantiers.some((x) => x.id === c.id)) j.chantiers.push(c);
      const o = t.ent_id ? this.etat.tous?.ordres.find((x) => x.id === t.ent_id) : null;
      if (o && !j.ordres.some((x) => x.id === o.id)) j.ordres.push(o);
      choisir(t.cha_id, t.ent_id);
    };
    const afficher = () => {
      const liste = filtrerChoix(tuiles(), champ.value);
      grille.innerHTML = liste.slice(0, 200).map((t) => {
        const propose = t.genre === 'chantier' && j.proposes.includes(t.cha_id);
        return `<button type="button" class="borne-carte ${propose ? 'propose' : ''}" data-t="${t.id}">${propose ? `${iconeHtml('pointage_planning')} ` : t.genre === 'ordre' ? `${iconeHtml('pointage_ordre')} ` : ''}<b>${echapper(t.code)}</b>
          <small>${echapper(t.libelle)}</small>${t.detail ? `<small>${echapper(t.detail)}</small>` : ''}</button>`;
      }).join('') + (liste.length > 200 ? `<p class="aide">${texteHtml('pointage.borne.autres', { nombre: liste.length - 200 })}</p>` : '')
        + (!liste.length ? `<p class="aide">${texteHtml(this.etat.tous ? 'pointage.borne.aucun_tous' : 'pointage.borne.aucun_chantier', { tous: `${icone('pointage_tous')} ${texte('pointage.borne.tous')}` })}</p>` : '');
      grille.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => prendre(liste.find((t) => String(t.id) === b.dataset.t))));
    };
    champ.addEventListener('input', afficher);
    this.zone.querySelector('[data-tous]').addEventListener('click', async (e) => {
      if (this.etat.tous) { this.etat.tous = null; e.target.classList.remove('principal'); afficher(); return; }
      try { this.etat.tous = await appel('GET', `/chantiers?jeton=${encodeURIComponent(j.jeton)}`); } catch (x) { await alerter(x.message); return; }
      e.target.classList.add('principal');
      afficher();
      champ.focus();
    });
    afficher();
    const lire = async () => {
      const numero = champ.value.trim();
      if (!numero) return;
      const visibles = filtrerChoix(tuiles(), numero);
      const t = tuileExacte(tuiles(), numero) ?? (visibles.length === 1 ? visibles[0] : null);
      if (t) { prendre(t); return; }
      try {
        const o = await appel('GET', `/ordre?numero=${encodeURIComponent(numero)}`);
        if (!j.chantiers.some((c) => c.id === o.cha_id)) j.chantiers.push({ id: o.cha_id, code: o.numero, libelle: o.objet ?? '' });
        if (!j.ordres.some((x) => x.id === o.id)) j.ordres.push(o);
        choisir(o.cha_id, o.id);
      } catch (e) { champ.value = ''; await alerter(e.message); }
    };
    this.zone.querySelector('[data-lire]').addEventListener('click', lire);
    champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') lire(); });
    champ.focus();
    this.zone.querySelector('[data-liste]').addEventListener('click', () => { this.etat.saisie = null; this.#memoriser(); this.#liste(); });
    this.zone.querySelector('[data-terminer]').addEventListener('click', () => this.#terminer());
    this.#minuterie();
  }

  /**
   * Étapes des ordres (Exécution, lot 2e, E51 à E53) : écran du module Exécution avec les ordres proposés au salarié (ou
   * ceux d'une liste : fin de pointage) ; validation par la borne, jamais de contrôle du N+1. `apres` : écran suivant.
   */
  async #etapes({ ordres = null, titre = texte('pointage.borne.etapes_titre'), apres = () => this.#journee() } = {}) {
    const j = this.etat.journee;
    this.ecran = () => this.#etapes({ ordres, titre, apres });
    this.zone.innerHTML = `${this.#entete(titre)}<div data-atelier></div>
      <p><button type="button" class="borne-bouton principal" data-suite>${texteHtml(ordres ? 'pointage.borne.non_terminer' : 'pointage.borne.retour')}</button></p>`;
    this.#brancherEntete();
    const fournisseur = {
      charger: async () => {
        if (!ordres) return appel('GET', `/etapes?jeton=${encodeURIComponent(j.jeton)}`);
        const res = [];
        for (const id of ordres) res.push(...(await appel('GET', `/etapes?jeton=${encodeURIComponent(j.jeton)}&ordre=${id}`)).ordres);
        return { ordres: res };
      },
      valider: (entId, code) => appel('POST', '/etapes', { jeton: j.jeton, ent_id: entId, code }),
      ordre: async (numero) => (await appel('GET', `/etapes?jeton=${encodeURIComponent(j.jeton)}&numero=${encodeURIComponent(numero)}`)).ordres[0] ?? null,
    };
    const ecran = new EcranEtapesAtelier(this.zone.querySelector('[data-atelier]'), fournisseur, {
      titre: '', message: (t, n) => (n === 'erreur' ? alerter(t) : this.app?.message?.(t, n)),
      aide: this.test ? texte('pointage.borne.essai_etapes') : '',
    });
    this.zone.querySelector('[data-suite]').addEventListener('click', () => apres());
    try { await ecran.ouvrir(); } catch (e) { this.#erreur(e); }
    this.#minuterie();
  }

  /**
   * Stock (module Stock, lot 5, S17) : sortie ou retour d'articles au dépôt de la borne, vers un chantier du jour ou en
   * dotation personnelle (EPI, outillage) ; articles en tuiles filtrées par marque et recherche ; la saisie compte aussitôt
   * dans le stock et attend la validation du chef de service ou du magasin. Essai : rien n'est enregistré.
   */
  async #stock(etat = null) {
    const j = this.etat.journee;
    let d;
    try { d = await appel('GET', `/stock?jeton=${encodeURIComponent(j.jeton)}`); } catch (e) { this.#erreur(e); return; }
    if (!d.depot) { await alerter(texte('pointage.borne.sans_depot')); return; }
    const s = etat ?? { mode: 'SORTIE', dotation: true, chantier: null, marque: null, recherche: '', lignes: [] };
    this.ecran = () => this.#stock(s);
    const dotes = new Map(d.dotations.map((x) => [x.ele, Number(x.quantite)]));
    const articles = d.articles.filter((a) => (!s.marque || a.marques.includes(s.marque)) && (!s.recherche || `${a.code} ${a.libelle}`.toLowerCase().includes(s.recherche.toLowerCase()))
      && (s.mode === 'SORTIE' || !s.dotation || dotes.has(a.id)));
    const marques = [...new Set(d.articles.flatMap((a) => a.marques))];
    this.zone.innerHTML = `${this.#entete(texte('pointage.borne.ecran_stock', { depot: d.depot.code }))}
      <p><button type="button" class="borne-bouton ${s.mode === 'SORTIE' ? 'principal' : ''}" data-mode="SORTIE">${iconeHtml('pointage_export')} ${texteHtml('pointage.borne.je_prends')}</button>
        <button type="button" class="borne-bouton ${s.mode === 'RETOUR' ? 'principal' : ''}" data-mode="RETOUR">${iconeHtml('telecharger')} ${texteHtml('pointage.borne.je_rends')}</button>
        <button type="button" class="borne-bouton ${s.dotation ? 'principal' : ''}" data-dotation>${iconeHtml('pointage_dotation')} ${texteHtml('pointage.borne.pour_moi')}</button>
        ${j.chantiers.map((c) => `<button type="button" class="borne-bouton ${!s.dotation && s.chantier === c.id ? 'principal' : ''}" data-chantier="${c.id}">${echapper(c.code)}</button>`).join('')}</p>
      <p>${marques.map((m) => `<button type="button" class="borne-bouton ${s.marque === m ? 'principal' : ''}" data-marque="${echapper(m)}">${echapper(m)}</button>`).join('')}
        <input data-recherche class="borne-champ" placeholder="${texteHtml('pointage.borne.rechercher_article')}" value="${echapper(s.recherche)}"></p>
      <div class="borne-grille">${articles.slice(0, 60).map((a) => `<button type="button" class="borne-carte" data-article="${a.id}"><b>${echapper(a.code)}</b><small>${echapper(a.libelle)}</small>
        ${dotes.has(a.id) ? `<small>${texteHtml('pointage.borne.dote', { quantite: formatNombre(dotes.get(a.id), a.precision) })}</small>` : ''}</button>`).join('') || `<p class="aide">${texteHtml('pointage.borne.aucun_article')}</p>`}</div>
      ${s.lignes.length ? `<table class="borne-liste"><tbody>${s.lignes.map((l, i) => `<tr><td><b>${echapper(l.code)}</b> ${echapper(l.libelle)}</td>
        <td><button type="button" class="borne-touche" data-moins="${i}">${iconeHtml('moins')}</button> <b>${formatNombre(l.quantite, 2)}</b> ${echapper(l.unite)} <button type="button" class="borne-touche" data-plus="${i}">${iconeHtml('ajouter')}</button></td>
        ${s.mode === 'RETOUR' ? `<td><label><input type="checkbox" data-rebut="${i}" ${l.rebut ? 'checked' : ''}> ${texteHtml('pointage.borne.hors_usage')}</label></td>` : ''}</tr>`).join('')}</tbody></table>` : ''}
      <p><button type="button" class="borne-bouton principal" data-enregistrer ${s.lignes.length ? '' : 'disabled'}>${iconeHtml('pointage_ok')} ${texteHtml('commun.enregistrer')}</button>
        <button type="button" class="borne-bouton" data-fiche>${iconeHtml('pointage_signature')} ${texteHtml('pointage.borne.fiche_dotation')}</button>
        <button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button></p>`;
    this.#brancherEntete();
    const z = this.zone;
    z.querySelector('[data-fiche]').addEventListener('click', () => this.#ficheDotation(s));
    z.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { s.mode = b.dataset.mode; s.lignes = []; this.#stock(s); }));
    z.querySelector('[data-dotation]').addEventListener('click', () => { s.dotation = true; s.chantier = null; this.#stock(s); });
    z.querySelectorAll('[data-chantier]').forEach((b) => b.addEventListener('click', () => { s.dotation = false; s.chantier = Number(b.dataset.chantier); this.#stock(s); }));
    z.querySelectorAll('[data-marque]').forEach((b) => b.addEventListener('click', () => { s.marque = s.marque === b.dataset.marque ? null : b.dataset.marque; this.#stock(s); }));
    z.querySelector('[data-recherche]').addEventListener('change', (e) => { s.recherche = e.target.value; this.#stock(s); });
    z.querySelectorAll('[data-article]').forEach((b) => b.addEventListener('click', () => {
      const a = d.articles.find((x) => x.id === Number(b.dataset.article));
      const l = s.lignes.find((x) => x.ele === a.id);
      if (l) l.quantite += 1; else s.lignes.push({ ele: a.id, code: a.code, libelle: a.libelle, unite: a.unite, quantite: 1, rebut: false });
      this.#stock(s);
    }));
    z.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => { s.lignes[Number(b.dataset.plus)].quantite += 1; this.#stock(s); }));
    z.querySelectorAll('[data-moins]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.moins);
      s.lignes[i].quantite -= 1;
      if (s.lignes[i].quantite <= 0) s.lignes.splice(i, 1);
      this.#stock(s);
    }));
    z.querySelectorAll('[data-rebut]').forEach((c) => c.addEventListener('change', () => { s.lignes[Number(c.dataset.rebut)].rebut = c.checked; }));
    z.querySelector('[data-retour]').addEventListener('click', () => this.#journee());
    z.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      if (!s.dotation && !s.chantier) { await alerter(texte('pointage.borne.choisir_chantier')); return; }
      try {
        const r = await appel('POST', '/stock', { jeton: j.jeton, mode: s.mode, dotation: s.dotation, chantier: s.chantier,
          lignes: s.lignes.map((l) => ({ ele: l.ele, quantite: l.quantite, rebut: s.mode === 'RETOUR' && l.rebut })) });
        await alerter(r.essai ? texte('pointage.borne.essai_rien') : texte('pointage.borne.stock_enregistre', { pieces: r.pieces.map((x) => x.numero).join(', ') }));
        this.#journee();
      } catch (e) { await alerter(e.message); }
    });
    this.#minuterie();
  }

  /**
   * Fiche de dotation (module Stock, S26) : remises et retours de dotation depuis la fiche signée précédente, signés par
   * le salarié sur l'écran ; le serveur édite la fiche (modèle FICHE_DOTATION) et la range dans la GED du salarié.
   */
  async #ficheDotation(etatStock) {
    const j = this.etat.journee;
    let f;
    try { f = await appel('GET', `/stock/fiche?jeton=${encodeURIComponent(j.jeton)}`); } catch (e) { this.#erreur(e); return; }
    if (!f.mouvements.length) { await alerter(texte('pointage.borne.fiche_vide')); return; }
    this.ecran = () => this.#ficheDotation(etatStock);
    const q = (x) => (x === null || x === undefined ? '' : formatNombre(x, 2));
    this.zone.innerHTML = `${this.#entete(texte('pointage.borne.fiche_titre', { du: formatDate(f.du), au: formatDate(f.au) }))}
      <table class="borne-liste"><thead><tr><th>${texteHtml('pointage.borne.fiche_date')}</th><th>${texteHtml('pointage.borne.fiche_article')}</th>
        <th>${texteHtml('pointage.borne.fiche_remis')}</th><th>${texteHtml('pointage.borne.fiche_rendu')}</th></tr></thead><tbody>
      ${f.mouvements.map((m) => `<tr><td>${formatDate(m.date)}</td><td><b>${echapper(m.code)}</b> ${echapper(m.libelle)}</td>
        <td>${q(m.remis)} ${m.remis ? echapper(m.unite ?? '') : ''}</td><td>${q(m.rendu ?? m.rebut)} ${m.rendu || m.rebut ? echapper(m.unite ?? '') : ''}</td></tr>`).join('')}</tbody></table>
      <p>${texteHtml('pointage.borne.fiche_engagement')}</p><div data-signature></div>
      <p><button type="button" class="borne-bouton principal" data-signer disabled>${iconeHtml('pointage_signature')} ${texteHtml('pointage.borne.fiche_signer')}</button>
        <button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button></p>`;
    this.#brancherEntete();
    const signer = this.zone.querySelector('[data-signer]');
    const pad = new PadSignature(this.zone.querySelector('[data-signature]'), { changer: (vide) => { signer.disabled = vide; this.#minuterie(); } });
    this.zone.querySelector('[data-retour]').addEventListener('click', () => this.#stock(etatStock));
    signer.addEventListener('click', async () => {
      signer.disabled = true;
      try {
        const r = await appel('POST', '/stock/fiche', { jeton: j.jeton, signature: pad.enPng() });
        await alerter(r.essai ? texte('pointage.borne.essai_rien')
          : [texte('pointage.borne.fiche_signee'), ...(r.avertissements ?? [])].join(' '));
        this.#journee();
      } catch (e) { signer.disabled = false; await alerter(e.message); }
    });
    this.#minuterie();
  }

  /** Ordres pointés de la journée dont une étape reste à valider (E52 : « Étape terminée ? » à la fin d'un pointage). */
  async #ordresAEtape() {
    const j = this.etat.journee;
    const ids = [...new Set(this.etat.lignes.filter((l) => l.nouveau !== false && l.ent_id).map((l) => l.ent_id))];
    const res = [];
    for (const id of ids) {
      try {
        const r = await appel('GET', `/etapes?jeton=${encodeURIComponent(j.jeton)}&ordre=${id}`);
        if (r.ordres.some((o) => o.etapes.some((e) => !e.valide_le))) res.push(id);
      } catch { /* module Exécution inactif ou ordre sans droit : rien à proposer */ }
    }
    return res;
  }

  async #terminer() {
    if (this.etat.modifie && !await confirmer(texte('pointage.borne.abandonner'))) return;
    ecrireReprise(null);
    this.#accueil();
  }

  /**
   * Grille de choix avec filtre (au-delà de `seuil` options) : `options` [{ cle, libelle, detail }], clic = `choisir(cle)`.
   */
  #grilleFiltree(conteneur, options, choisir, seuil = 6) {
    conteneur.innerHTML = `${options.length > seuil ?`<p><input type="search" data-filtre class="borne-champ" placeholder="${texteHtml('pointage.borne.filtrer')}"></p>` : ''}<div class="borne-grille" data-options></div>`;
    const rendre = (q = '') => {
      const t = q.trim().toLowerCase();
      const l = options.filter((o) => !t || `${o.libelle} ${o.detail ?? ''}`.toLowerCase().includes(t));
      conteneur.querySelector('[data-options]').innerHTML = l.map((o) => `<button type="button" class="borne-carte" data-o="${echapper(String(o.cle))}">${echapper(o.libelle)}${o.detail ? `<small>${echapper(o.detail)}</small>` : ''}</button>`).join('')
        || `<p>${texteHtml('pointage.borne.aucun_choix')}</p>`;
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
    this.zone.innerHTML = `${this.#entete(`${texte('pointage.grille.type_main_oeuvre')}${s.motif ? ` — ${icone('avertissement')} ${s.motif}` : ''}`)}<div data-grille></div>
      <p>${s.motif ? '' : `${BOUTON_PROBLEME} `}<button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button></p>`;
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
    this.zone.innerHTML = `${this.#entete(texte('pointage.borne.ecran_activite', { type: type?.libelle ?? '' }))}<div data-grille></div>
      <p>${BOUTON_PROBLEME} <button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button></p>`;
    this.#brancherEntete();
    this.#grilleFiltree(this.zone.querySelector('[data-grille]'), l.map((x) => ({ cle: x.code, libelle: x.libelle })), (cle) => { s.sous_type = cle; this.#ajouterLigne(); }, 3);
    this.zone.querySelector('[data-probleme]').addEventListener('click', () => this.#probleme());
    this.zone.querySelector('[data-retour]').addEventListener('click', () => { s.type_mo = null; this.#memoriser(); if (s.type_auto) { this.etat.saisie = null; this.#journee(); } else this.#typeMo(); });
    this.#minuterie();
  }

  /** Non-conformité : motif, puis type de travail (activité de non-conformité imposée) et heures perdues. */
  #probleme() {
    this.ecran = () => this.#probleme();
    // Motifs proposés (paramètres des ressources), plus « Autre… » : toute autre raison, saisie librement.
    this.zone.innerHTML = `${this.#entete(`${icone('avertissement')} ${texte('pointage.borne.quel_probleme')}`)}<div class="borne-grille">${this.donnees.motifs.map((m) => `<button type="button" class="borne-carte" data-m="${echapper(m.libelle)}">${echapper(m.libelle)}</button>`).join('')}
        <button type="button" class="borne-carte" data-autre>${iconeHtml('pointage_autre')} ${texteHtml('pointage.borne.autre')}</button></div>
      <p><button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button></p>`;
    this.#brancherEntete();
    this.zone.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      this.etat.saisie.motif = b.dataset.m;
      this.#memoriser();
      this.#typeMo();
    }));
    this.zone.querySelector('[data-autre]').addEventListener('click', async () => {
      const motif = (await saisir(texte('pointage.borne.decrire_probleme'), '', { titre: texte('pointage.borne.autre_probleme'), obligatoire: true }))?.trim();
      if (!motif) return;
      this.etat.saisie.motif = motif.slice(0, 200);
      this.#memoriser();
      this.#typeMo();
    });
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
   * Repas au restaurant du jour (lot 10, A29) : restaurants les plus proches du chantier principal de la journée (le plus
   * d'heures saisies, sinon le premier proposé), recherche, « non trouvé » (nom et ville : restaurant provisoire), « pas
   * de repas » ; enregistré aussitôt (essai : rien d'écrit), retour aux pointages du jour.
   */
  async #repas() {
    const j = this.etat.journee;
    this.ecran = () => this.#repas();
    const chantier = chantierDuJour(this.etat.lignes.map((l) => ({ ...l, date: j.date })), String(j.date).slice(0, 10)) ?? j.proposes[0] ?? null;
    this.zone.innerHTML = `${this.#entete(texte('pointage.saisie.repas'))}
      <p><input data-recherche class="borne-champ" placeholder="${texteHtml('pointage.repas.rechercher')}" autocomplete="off">
        <button type="button" class="borne-bouton" data-non-trouve>${texteHtml('pointage.repas.non_trouve')}</button>
        ${j.repas ? `<button type="button" class="borne-bouton" data-aucun>${texteHtml('pointage.repas.aucun')}</button>` : ''}
        <button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button></p>
      ${j.repas ? `<p>${texteHtml('pointage.repas.note_html', { restaurant: j.repas.restaurant })}</p>` : ''}
      <div class="borne-grille" data-restaurants><p class="aide">${texteHtml('pointage.repas.recherche_proches')}</p></div>`;
    this.#brancherEntete();
    const grille = this.zone.querySelector('[data-restaurants]');
    const enregistrer = async (r) => {
      try {
        const l = await appel('POST', '/repas', { jeton: j.jeton, repas: { date: j.date, cha_id: chantier, ...r } });
        j.repas = l.find((x) => String(x.date).slice(0, 10) === String(j.date).slice(0, 10)) ?? null;
        if (this.test) await alerter(texte('pointage.borne.essai_rien'));
        this.#liste();
      } catch (e) { await alerter(e.message); }
    };
    const charger = async () => {
      const q = this.zone.querySelector('[data-recherche]')?.value.trim() ?? '';
      let l;
      try { l = await appel('GET', `/restaurants?${new URLSearchParams(Object.entries({ jeton: j.jeton, chantier, recherche: q }).filter(([, v]) => v !== '' && v != null))}`); }
      catch (e) { grille.innerHTML = `<p class="aide">${echapper(e.message)}</p>`; return; }
      grille.innerHTML = l.slice(0, 60).map((r) => `<button type="button" class="borne-carte ${j.repas?.restaurant_id === r.id ? 'choisi' : ''}" data-r="${r.id}"><b>${echapper(r.nom)}</b>
        <small>${echapper([r.ville, distanceRestaurant(r)].filter(Boolean).join(' · '))}</small></button>`).join('')
        || `<p class="aide">${texteHtml('pointage.repas.aucun_trouve')}</p>`;
      grille.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => enregistrer({ restaurant_id: Number(b.dataset.r) })));
    };
    let minuterie = null;
    this.zone.querySelector('[data-recherche]').addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(charger, 300); });
    this.zone.querySelector('[data-non-trouve]').addEventListener('click', async () => {
      const nom = await saisir(texte('pointage.repas.nom'), this.zone.querySelector('[data-recherche]').value.trim(), { obligatoire: true });
      if (!nom?.trim()) return;
      const ville = await saisir(texte('pointage.repas.ville'), '');
      if (ville === null) return;
      enregistrer({ nouveau: nom.trim(), ville: ville.trim() || null });
    });
    this.zone.querySelector('[data-aucun]')?.addEventListener('click', () => enregistrer({ restaurant_id: null }));
    this.zone.querySelector('[data-retour]').addEventListener('click', () => this.#liste());
    charger();
    this.#minuterie();
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
        <div class="borne-ligne-detail"><b>${echapper(c?.code ?? texte('pointage.borne.chantier', { id: l.cha_id }))}</b> ${echapper(c?.libelle ?? '')}${o ? `<br><small>${texteHtml('pointage.borne.ordre', { numero: o.numero ?? '', objet: o.objet ?? '' })}</small>` : ''}
          <br><span>${echapper(t?.libelle ?? '')}${st ? ` · ${echapper(st.libelle)}` : ''}</span>${l.groupe ? ` <small class="aide">${iconeHtml('pointage_equipe')} ${texteHtml('pointage.borne.equipe_court')}</small>` : ''}</div>
        <div class="borne-ligne-duree">${m ? `<button type="button" class="borne-touche" data-moins="${i}" aria-label="${texteHtml('pointage.borne.moins')}">${iconeHtml('moins')}</button><input class="borne-duree-champ" data-duree="${i}" value="${ecrireDuree(l.minutes)}" inputmode="decimal" aria-label="${texteHtml('pointage.borne.duree')}"><button type="button" class="borne-touche" data-plus="${i}" aria-label="${texteHtml('pointage.borne.plus')}">${iconeHtml('ajouter')}</button>`
          : `<span class="borne-duree-lecture">${texteHtml('pointage.borne.heures', { duree: ecrireDuree(l.minutes) })}</span>`}</div>
        <div class="borne-ligne-notes">
          <button type="button" class="borne-note${l.commentaire ? ' renseigne' : ''}" data-note="${i}" data-genre="commentaire" ${m || l.commentaire ? '' : 'disabled'} title="${l.commentaire ? echapper(l.commentaire) : texteHtml('pointage.borne.commenter_aide')}">${iconeHtml('pointage_commentaire')} ${texteHtml(l.commentaire ? 'pointage.borne.commentaire' : 'pointage.borne.commenter')}</button>
          <button type="button" class="borne-note nc${l.motif ? ' renseigne' : ''}" data-note="${i}" data-genre="nc" ${m || l.motif ? '' : 'disabled'} title="${l.motif ? echapper(l.motif) : texteHtml('pointage.borne.nc_aide')}">${iconeHtml('avertissement')} ${texteHtml(l.motif ? 'pointage.borne.nc_notee' : 'pointage.borne.nc')}</button>
          ${m ? `<button type="button" class="borne-touche" data-retirer="${i}" title="${texteHtml('pointage.borne.retirer')}" aria-label="${texteHtml('pointage.borne.retirer')}">${iconeHtml('retirer')}</button>` : ''}
        </div></div>`;
    };
    this.zone.innerHTML = `${this.#entete(texte(lecture ? 'pointage.borne.ecran_liste_lecture' : 'pointage.borne.pointages_jour'))}
      <div class="borne-barre">${lecture ? '' : [60, 240, 420, 480].map((m) => `<button type="button" class="borne-bouton" data-rapide="${m}" title="${texteHtml('pointage.borne.rapide_aide')}">${texteHtml('pointage.borne.heures', { duree: ecrireDuree(m) })}</button>`).join('')}
        <span class="borne-barre-espace"></span>
        ${lecture ? '' : `<button type="button" class="borne-bouton principal" data-enregistrer>${iconeHtml('pointage_ok')} ${texteHtml('commun.enregistrer')}</button> <button type="button" class="borne-bouton" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('commun.ajouter')}</button>`}
        ${lecture || equipe ? '' : `<button type="button" class="borne-bouton" data-repas title="${texteHtml('pointage.borne.repas_aide')}">${iconeHtml('pointage_repas')} ${j.repas ? echapper(j.repas.restaurant) : texteHtml('pointage.borne.repas')}</button>`}
        ${lecture ? '' : `<button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button>`} <button type="button" class="borne-bouton" data-terminer>${texteHtml('pointage.borne.terminer')}</button></div>
      <div class="borne-lignes">${this.etat.lignes.map(ligne).join('') || `<p>${texteHtml('pointage.borne.aucun_pointage')}</p>`}</div>
      ${equipe ? `<p class="aide">${texteHtml('pointage.borne.equipe_aide')}</p>` : ''}`;
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
    // Repas : écran à part, les pointages en cours restent dans la saisie (retour à cet écran).
    this.zone.querySelector('[data-repas]')?.addEventListener('click', () => this.#repas());
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
    this.zone.innerHTML = `${this.#entete(nc ? `${icone('avertissement')} ${texte('pointage.borne.ecran_nc')}` : `${icone('pointage_commentaire')} ${texte('pointage.borne.ecran_commentaire')}`)}
      <p class="borne-journee"><b>${echapper(c?.code ?? '')}</b> ${echapper(c?.libelle ?? '')} · ${echapper(ref.types_mo.find((x) => x.id === l.type_mo)?.libelle ?? '')}
        · ${echapper(ref.sous_types.find((x) => x.code === l.sous_type)?.libelle ?? '')} · ${texteHtml('pointage.borne.heures', { duree: ecrireDuree(l.minutes) })}</p>
      ${nc && !lecture ? `<div class="borne-grille">${this.donnees.motifs.map((m) => `<button type="button" class="borne-carte" data-motif="${echapper(m.libelle)}">${echapper(m.libelle)}</button>`).join('')}</div>` : ''}
      <textarea class="borne-texte" data-texte rows="4" ${lecture ? 'readonly' : ''} placeholder="${texteHtml(nc ? 'pointage.borne.motif_nc' : 'pointage.borne.commentaire_vide')}">${echapper((nc ? l.motif : l.commentaire) ?? '')}</textarea>
      <p>${lecture ? '' : `<button type="button" class="borne-bouton principal" data-ok>${iconeHtml('pointage_ok')} ${texteHtml('commun.ok')}</button> <button type="button" class="borne-bouton" data-effacer>${texteHtml('pointage.borne.effacer')}</button> `}<button type="button" class="borne-bouton" data-retour>${texteHtml('pointage.borne.retour')}</button></p>`;
    this.#brancherEntete();
    const champTexte = this.zone.querySelector('[data-texte]');
    this.zone.querySelectorAll('[data-motif]').forEach((b) => b.addEventListener('click', () => { champTexte.value = b.dataset.motif; champTexte.focus(); }));
    const fin = (valeur) => {
      if (valeur !== undefined) {
        l[nc ? 'motif' : 'commentaire'] = valeur.trim() || null;
        this.etat.modifie = true;
        this.#memoriser();
      }
      this.#liste(i);
    };
    this.zone.querySelector('[data-ok]')?.addEventListener('click', () => fin(champTexte.value));
    this.zone.querySelector('[data-effacer]')?.addEventListener('click', () => fin(''));
    this.zone.querySelector('[data-retour]').addEventListener('click', () => fin());
    if (!lecture) champTexte.focus();
    this.#minuterie();
  }

  /** Enregistre la journée (individuel : la liste remplace la journée ; équipe : chaque nouvelle ligne pour les membres). */
  async #enregistrer() {
    const j = this.etat.journee;
    const lignes = this.etat.lignes;
    if (lignes.some((l) => !(l.minutes > 0))) { await alerter(texte('pointage.borne.duree_invalide')); return; }
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
    const fin = () => {
      this.#accueil(`${icone('pointage_ok')} ${texte(this.test ? 'pointage.borne.fin_essai' : 'pointage.borne.fin', { date: dateLongue(j.date), duree: ecrireDuree(total) || '0:00' })}${membres ? ` ${texte('pointage.borne.fin_equipe', { nombre: membres.length })}` : ''}.`);
      this.#minuterie(8000);
    };
    // Pointage sur un ordre : son étape en cours est proposée (E52), sinon retour à l'accueil.
    const ordres = membres ? [] : await this.#ordresAEtape();
    if (ordres.length) { await this.#etapes({ ordres, titre: texte('pointage.borne.etape_terminee'), apres: fin }); return; }
    fin();
  }
}

/** Administration des bornes (appareils enregistrés, jeton remis une fois) et des PIN des salariés. */
export class PageParametresBornes extends PageBase {
  icone = icone('pointage_borne');

  async ouvrir() {
    this.titre = texte('pointage.bornes.titre');
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><div class="entete-page"><h1 class="page-titre">${iconeHtml('pointage_borne')} ${texteHtml('pointage.bornes.titre')}</h1></div><div data-bornes></div>
      <div class="titre-actions"><h2>${texteHtml('pointage.bornes.pins')}</h2></div><div data-pins></div></div>`;
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
    const resume = (valeurs) => (valeurs.length ? echapper(valeurs.join(', ')) : `<span class="aide">${texteHtml('pointage.bornes.tous')}</span>`);
    const bouton = (attribut, nom, libelle, aide = libelle) => `<button type="button" class="bouton-icone" ${attribut} title="${texteHtml(aide)}" aria-label="${texteHtml(libelle)}">${iconeHtml(nom)}</button>`;
    const deux = (a, b) => `<th>${texteHtml(`pointage.bornes.${a}`)}<br><small>${texteHtml(`pointage.bornes.${b}`)}</small></th>`;
    zone.innerHTML = `<table class="tableau-compact largeur-contenu bornes"><thead><tr>${deux('borne', 'etat_vue')}${deux('pin', 'exige')}
        ${deux('services', 'fonctions')}<th>${texteHtml('pointage.bornes.types_mo')}</th><th></th></tr></thead><tbody>
      ${l.map((a) => `<tr data-borne="${a.id}"${a.actif ? '' : ' class="discret"'}><td>${echapper(a.libelle)}<br><small class="aide">${texteHtml(a.actif ? 'pointage.bornes.active' : 'pointage.bornes.desactivee')} · ${a.vu_le ? formatDateHeure(a.vu_le) : texteHtml('pointage.bornes.jamais_vue')}</small></td>
        <td>${texteHtml(a.pin_exige ? 'commun.oui' : 'commun.non')}</td>
        <td>${resume(libelles(a.services, ref.services))}<br><small class="aide">${a.fonctions.length ? echapper(a.fonctions.join(', ')) : texteHtml('pointage.bornes.toutes_fonctions')}</small></td>
        <td>${resume(libelles(a.types_mo, ref.types_mo))}</td>
        <td class="cellule-boutons">${admin ? bouton(`data-parametrer="${a.id}"`, 'pointage_parametrer', 'pointage.bornes.parametrer', 'pointage.bornes.parametrer_aide') : ''}
          ${bouton(`data-basculer="${a.id}"`, a.actif ? 'pointage_pause' : 'pointage_reprise', a.actif ? 'pointage.bornes.desactiver' : 'pointage.bornes.reactiver')}
          ${admin ? bouton(`data-tester="${a.id}"`, 'suivant', 'pointage.bornes.tester', 'pointage.bornes.tester_aide') : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? `<p class="ligne"><input data-libelle placeholder="${texteHtml('pointage.bornes.libelle_aide')}"> <label><input type="checkbox" data-pin checked> ${texteHtml('pointage.bornes.pin_exige')}</label>
        ${bouton('data-creer', 'ajouter', 'pointage.bornes.creer', 'pointage.bornes.creer_aide')}</p>` : ''}<div data-jeton></div>`;
    const parametrer = (a) => {
      zone.querySelector('tr.parametrage-borne')?.remove();
      const tr = zone.querySelector(`tr[data-borne="${a.id}"]`);
      const ligne = document.createElement('tr');
      ligne.className = 'parametrage-borne';
      ligne.innerHTML = `<td colspan="5"><div class="formulaire parametrage-borne-champs">
          <label>${texteHtml('commun.libelle')} <input data-p-libelle value="${echapper(a.libelle)}" maxlength="80"></label>
          <label class="fiche-option"><input type="checkbox" data-p-pin ${a.pin_exige ? 'checked' : ''}> ${texteHtml('pointage.bornes.pin_exige')}</label>
          ${['services', 'fonctions', 'types'].map((k) => `<div><b>${texteHtml(`pointage.bornes.p_${k}`)}</b> <small class="aide">${texteHtml(`pointage.bornes.p_${k}_aide`)}</small><div data-p-${k}></div></div>`).join('')}
          ${this.app.moduleActif(MODULE_FACULTATIF.STOCK) ? `<div><b>${texteHtml('pointage.bornes.p_depot')}</b> <small class="aide">${texteHtml('pointage.bornes.p_depot_aide', { stock: `${icone('pointage_stock')} ${texte('pointage.borne.stock')}` })}</small><div data-p-depot></div></div>` : ''}
        </div><p class="ligne"><button type="button" class="principal" data-p-enregistrer title="${texteHtml('pointage.bornes.enregistrer_aide')}">${iconeHtml('enregistrer')} ${texteHtml('commun.enregistrer')}</button>
          <button type="button" data-p-annuler>${texteHtml('commun.annuler')}</button></p></td>`;
      tr.after(ligne);
      const services = choixMultiple({ options: ref.services.map((x) => ({ valeur: x.id, libelle: x.parent_id ? `${icone('sous_niveau')} ${x.libelle}` : x.libelle, detail: x.code })), valeurs: a.services, titre: texte('pointage.bornes.ajouter_service') });
      const fonctions = choixMultiple({ options: (ref.fonctions ?? []).map((x) => ({ valeur: x, libelle: x })), valeurs: a.fonctions, titre: texte('pointage.bornes.ajouter_fonction') });
      const types = choixMultiple({ options: ref.types_mo.map((x) => ({ valeur: x.id, libelle: x.libelle, detail: x.code })), valeurs: a.types_mo, titre: texte('pointage.bornes.ajouter_type') });
      ligne.querySelector('[data-p-services]').append(services);
      ligne.querySelector('[data-p-fonctions]').append(fonctions);
      ligne.querySelector('[data-p-types]').append(types);
      // Module Stock : dépôt de la borne (liaison Pointage → Stock, lu et écrit par le cœur).
      let depot = null;
      if (this.app.moduleActif(MODULE_FACULTATIF.STOCK)) {
        Promise.all([api.stock.lieux(), api.stock.depotBorne(a.id)]).then(([lieux, d]) => {
          depot = creerCombo({ options: lieux.filter((x) => x.depot).map((x) => ({ valeur: x.id, libelle: `${x.code} – ${x.libelle}` })), valeur: d.lieu ?? '' });
          ligne.querySelector('[data-p-depot]')?.append(depot);
        }).catch(() => {});
      }
      ligne.querySelector('[data-p-annuler]').addEventListener('click', () => ligne.remove());
      ligne.querySelector('[data-p-enregistrer]').addEventListener('click', async () => {
        try {
          await api.pointage.modifierAppareil(a.id, {
            libelle: ligne.querySelector('[data-p-libelle]').value, pin_exige: ligne.querySelector('[data-p-pin]').checked, actif: a.actif,
            services: services.valeurs.map(Number), fonctions: fonctions.valeurs.map(String), types_mo: types.valeurs.map(Number),
          });
          if (depot) await api.stock.definirDepotBorne(a.id, depot.valeurCombo === '' ? null : Number(depot.valeurCombo));
          this.app.message(texte('pointage.bornes.parametree'), 'succes');
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
        this.conteneur.querySelector('[data-jeton]').innerHTML = `<p class="avertissement">${texteHtml('pointage.bornes.jeton_html', { jeton: r.jeton, lien })}</p>`;
      } catch (e) { this.app.erreur(e); }
    });
  }

  async #pins() {
    const zone = this.conteneur.querySelector('[data-pins]');
    zone.innerHTML = '<p class="ligne"><span data-service></span></p><div data-liste></div>';
    const srv = creerCombo({ options: this.ref.services.map((s) => ({ valeur: s.id, libelle: s.libelle })), valeur: '', vide: true, titre: texte('pointage.barre.service') });
    zone.querySelector('[data-service]').append(srv);
    const charger = async () => {
      if (!srv.valeurCombo) { zone.querySelector('[data-liste]').innerHTML = `<p class="aide">${texteHtml('pointage.bornes.choisir_service')}</p>`; return; }
      const l = await api.pointage.pins(srv.valeurCombo).catch((e) => { this.app.erreur(e); return []; });
      zone.querySelector('[data-liste]').innerHTML = `<div class="tableau-defilant largeur-contenu"><table class="tableau-compact"><thead><tr><th>${texteHtml('pointage.panneau.salarie')}<br><small>${texteHtml('pointage.panneau.matricule')}</small></th><th>${texteHtml('pointage.bornes.pin')}</th><th>${texteHtml('pointage.bornes.nouveau_pin')}</th><th></th></tr></thead><tbody>${l.slice(0, 300).map((x) => `<tr><td class="synthese-nom">${echapper(x.salarie.nom)} ${echapper(x.salarie.prenom)}<br><small class="aide">${echapper(x.salarie.matricule)}</small></td><td>${x.pin ? `${texteHtml('pointage.bornes.pose')}${x.bloque ? ` <span class="badge-exception">${texteHtml('pointage.bornes.bloque')}</span>` : ''}` : `<span class="aide">${texteHtml('pointage.bornes.sans_pin')}</span>`}</td>
        <td><input data-pin="${x.salarie.id}" size="8" inputmode="numeric" placeholder="${texteHtml('pointage.bornes.pin_aide')}"></td><td class="cellule-boutons"><button type="button" class="bouton-icone" data-poser="${x.salarie.id}" title="${texteHtml('pointage.bornes.poser_aide')}" aria-label="${texteHtml('pointage.bornes.poser')}">${iconeHtml('pointage_ok')}</button>${x.pin ? ` <button type="button" class="bouton-icone" data-retirer="${x.salarie.id}" title="${texteHtml('pointage.bornes.retirer_pin')}" aria-label="${texteHtml('pointage.bornes.retirer_pin')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      zone.querySelectorAll('[data-poser]').forEach((b) => b.addEventListener('click', async () => {
        try { await api.pointage.poserPin(b.dataset.poser, { pin: zone.querySelector(`[data-pin="${b.dataset.poser}"]`).value }); this.app.message(texte('pointage.bornes.pin_enregistre'), 'succes'); await charger(); } catch (e) { this.app.erreur(e); }
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
  icone = icone('pointage_equipe');

  async ouvrir() {
    this.titre = texte('pointage.groupe.titre');
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><div class="entete-page"><h1 class="page-titre">${iconeHtml('pointage_equipe')} ${texteHtml('pointage.groupe.titre')}</h1></div><div data-groupe></div></div>`;
    this.ref = await api.pointage.referentiels();
    await this.#charger();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-groupe]');
    let g;
    try { g = await api.pointage.groupe(this.requete.id); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const ref = g.pointages.find((p) => p.identique);
    zone.innerHTML = `${g.origine ? `<p class="aide">${texteHtml('pointage.groupe.origine')}</p>` : `<p class="avertissement">${texteHtml('pointage.groupe.modifiee')}</p>`}
      <table class="tableau-compact largeur-contenu"><thead><tr>${['salarie', 'date', 'heures', 'groupe'].map((k) => `<th${k === 'heures' ? ' class="nombre"' : ''}>${texteHtml(`pointage.groupe.${k}`)}</th>`).join('')}</tr></thead><tbody>
      ${g.pointages.map((p) => `<tr><td>${echapper(p.salarie ? `${p.salarie.nom} ${p.salarie.prenom}` : '')}</td><td>${new Date(`${p.date}T00:00:00Z`).toLocaleDateString(langue(), { timeZone: 'UTC' })}</td><td class="nombre">${ecrireDuree(p.minutes)}</td><td>${p.identique ? iconeHtml('pointage_ok') : `<span class="badge-exception">${texteHtml('pointage.groupe.a_part')}</span>`}</td></tr>`).join('')}</tbody></table>
      <p class="ligne">${texteHtml('pointage.groupe.nouvelle_duree')} <input data-duree size="6" value="${ecrireDuree(ref?.minutes ?? 0)}"> <button type="button" data-appliquer title="${texteHtml('pointage.groupe.appliquer_aide')}">${iconeHtml('pointage_ok')} ${texteHtml('pointage.groupe.appliquer')}</button></p>`;
    zone.querySelector('[data-appliquer]').addEventListener('click', async () => {
      const minutes = lireDuree(zone.querySelector('[data-duree]').value);
      if (!minutes || !ref) return;
      try {
        await api.pointage.modifierGroupe(this.requete.id, { cha_id: ref.cha_id, ent_id: ref.ent_id, type_mo: ref.type_mo, sous_type: ref.sous_type, minutes, motif: ref.motif });
        this.app.message(texte('pointage.groupe.modifie'), 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
