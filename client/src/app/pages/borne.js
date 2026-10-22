import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { ecrireDuree, lireDuree } from '@logibtp/pointage';
import { api } from '../api.js';

// Borne d'atelier (Pointage lot 4, M8, § 6 « quatre touches ») : appareil enregistré par un administrateur (jeton gardé
// dans le navigateur de la borne, en-tête X-Borne-Jeton, aucune session) ; salarié (initiales) → PIN → chantier ou
// ordre (numéro ou QR code lu comme une saisie) → type et sous-type de main-d'œuvre → heures (± au pas, 4 h / 7 h / 8 h)
// → enregistré, retour à l'accueil ; « Signaler un problème » = non-conformité avec motif ; saisie d'équipe par le chef.

const CLE_JETON = 'logibtp.borne.jeton';
// Fenêtre d'essai d'un administrateur (/borne?test=) : jeton d'essai propre à la fenêtre (sessionStorage), sans
// remplacer le jeton d'une vraie borne gardé dans le navigateur.
const CLE_TEST = 'logibtp.borne.test';
const lireTest = () => { try { return sessionStorage.getItem(CLE_TEST); } catch { return null; } };
const lireJeton = () => { try { return lireTest() ?? localStorage.getItem(CLE_JETON); } catch { return null; } };

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

const initiales = (s) => `${s.prenom?.[0] ?? ''}${s.nom?.[0] ?? ''}`.toUpperCase();

export class PageBorne extends PageBase {
  icone = '🏭';

  async ouvrir() {
    this.titre = 'Borne de pointage';
    document.body.classList.add('mode-borne');
    this.conteneur.innerHTML = '<div class="borne" data-borne></div>';
    this.zone = this.conteneur.querySelector('[data-borne]');
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

  /** Retour automatique à l'accueil après une inactivité (une minute) ou une saisie. */
  #minuterie(ms = 60000) { clearTimeout(this.retour); this.retour = setTimeout(() => this.#accueil(), ms); }

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

  /** PIN sur clavier numérique si la borne l'exige ou si le salarié en a un. */
  #identifier(id, equipe) {
    const s = this.donnees.salaries.find((x) => x.id === id);
    const sansPin = !this.donnees.appareil.pin_exige && !s.pin;
    const envoyer = async (pin) => {
      try {
        this.etat = { journee: await appel('POST', '/identifier', { salarie: id, pin }), equipe, membres: null };
        if (equipe) this.#choisirEquipe(); else this.#journee();
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
      this.#minuterie();
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
      this.zone.querySelector('[data-suite]').addEventListener('click', () => { this.etat.membres = [...choisis]; this.#journee(); });
      this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
      this.#minuterie();
    };
    rendre();
  }

  /** Journée du salarié et choix du chantier (proposés : planning du jour, récents) ou de l'ordre (numéro / QR code). */
  #journee() {
    const j = this.etat.journee;
    const ref = this.donnees.referentiels;
    const chantier = (id) => j.chantiers.find((c) => c.id === id);
    const type = (id) => ref.types_mo.find((t) => t.id === id);
    this.zone.innerHTML = `<h2>${echapper(j.salarie.prenom)} ${echapper(j.salarie.nom)}${this.etat.membres ? ` — équipe de ${this.etat.membres.length}` : ''}</h2>
      ${j.pointages.length ? `<div class="borne-journee"><b>Aujourd'hui :</b> ${j.pointages.map((p) => `${echapper(chantier(p.cha_id)?.code ?? '')} ${echapper(type(p.type_mo)?.libelle ?? '')} ${ecrireDuree(p.minutes)} h${p.motif ? ' ⚠' : ''}`).join(' · ')}
        (total ${ecrireDuree(j.pointages.reduce((s, p) => s + p.minutes, 0))} h)</div>` : ''}
      <h3>Chantier ou ordre</h3>
      <p><input data-ordre class="borne-champ" placeholder="N° d'ordre ou QR code (OE2026-…)"> <button type="button" class="borne-bouton" data-lire>OK</button></p>
      <div class="borne-grille">${j.chantiers.map((c) => `<button type="button" class="borne-carte ${j.proposes.includes(c.id) ? 'propose' : ''}" data-c="${c.id}">${j.proposes.includes(c.id) ? '📅 ' : ''}<b>${echapper(c.code)}</b><small>${echapper(c.libelle)}</small></button>`).join('')}</div>
      <p><button type="button" class="borne-bouton" data-annuler>Terminer</button></p>`;
    const choisir = (cha, ordre) => { this.etat.saisie = { cha_id: cha, ent_id: ordre ?? null }; this.#type(); };
    this.zone.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => choisir(Number(b.dataset.c))));
    const lire = async () => {
      const n = this.zone.querySelector('[data-ordre]').value.trim();
      if (!n) return;
      try {
        const o = await appel('GET', `/ordre?numero=${encodeURIComponent(n)}`);
        if (!j.chantiers.some((c) => c.id === o.cha_id)) j.chantiers.push({ id: o.cha_id, code: o.numero, libelle: o.objet ?? '' });
        choisir(o.cha_id, o.id);
      } catch (e) { this.zone.querySelector('[data-ordre]').value = ''; alert(e.message); }
    };
    this.zone.querySelector('[data-lire]').addEventListener('click', lire);
    this.zone.querySelector('[data-ordre]').addEventListener('keydown', (e) => { if (e.key === 'Enter') lire(); });
    this.zone.querySelector('[data-ordre]').focus();
    this.zone.querySelector('[data-annuler]').addEventListener('click', () => this.#accueil());
    this.#minuterie();
  }

  #type() {
    const ref = this.donnees.referentiels;
    this.zone.innerHTML = `<h2>Type de travail</h2><div class="borne-grille">${ref.types_mo.map((t) => `<button type="button" class="borne-carte" data-t="${t.id}">${echapper(t.libelle)}</button>`).join('')}</div>
      <h3>Activité</h3><div class="borne-grille" data-sous-types>${ref.sous_types.filter((s) => !s.non_conformite).map((s) => `<button type="button" class="borne-carte ${s.code === 'PRODUCTION' ? 'choisi' : ''}" data-s="${s.code}">${echapper(s.libelle)}</button>`).join('')}</div>
      <p><button type="button" class="borne-bouton alerte" data-probleme>⚠ Signaler un problème</button> <button type="button" class="borne-bouton" data-retour>Retour</button></p>`;
    this.etat.saisie.sous_type = 'PRODUCTION';
    this.zone.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
      this.etat.saisie.sous_type = b.dataset.s;
      this.zone.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('choisi', x === b));
    }));
    this.zone.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { this.etat.saisie.type_mo = Number(b.dataset.t); this.#heures(); }));
    this.zone.querySelector('[data-probleme]').addEventListener('click', () => this.#probleme());
    this.zone.querySelector('[data-retour]').addEventListener('click', () => this.#journee());
    this.#minuterie();
  }

  /** Non-conformité : motif, puis type de travail et heures perdues. */
  #probleme() {
    const nc = this.donnees.referentiels.sous_types.find((s) => s.non_conformite);
    this.zone.innerHTML = `<h2>⚠ Quel problème ?</h2><div class="borne-grille">${this.donnees.motifs.map((m) => `<button type="button" class="borne-carte" data-m="${echapper(m.libelle)}">${echapper(m.libelle)}</button>`).join('')}</div>
      <p><button type="button" class="borne-bouton" data-retour>Retour</button></p>`;
    this.zone.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      this.etat.saisie.sous_type = nc?.code ?? null;
      this.etat.saisie.motif = b.dataset.m;
      const ref = this.donnees.referentiels;
      this.zone.innerHTML = `<h2>Type de travail</h2><div class="borne-grille">${ref.types_mo.map((t) => `<button type="button" class="borne-carte" data-t="${t.id}">${echapper(t.libelle)}</button>`).join('')}</div>`;
      this.zone.querySelectorAll('[data-t]').forEach((x) => x.addEventListener('click', () => { this.etat.saisie.type_mo = Number(x.dataset.t); this.#heures(); }));
    }));
    this.zone.querySelector('[data-retour]').addEventListener('click', () => this.#type());
    this.#minuterie();
  }

  /** Heures au pas de la société (boutons ±, valeurs fréquentes), puis enregistrement et retour à l'accueil. */
  #heures() {
    const pas = this.donnees.referentiels.parametres.pas_minutes || 15;
    let minutes = 420;
    const rendre = () => {
      this.zone.innerHTML = `<h2>Durée${this.etat.saisie.motif ? ` — ⚠ ${echapper(this.etat.saisie.motif)}` : ''}</h2>
        <p class="borne-duree"><button type="button" class="borne-touche" data-moins>−</button> <span>${ecrireDuree(minutes) || '0:00'}</span> <button type="button" class="borne-touche" data-plus>＋</button></p>
        <p>${[60, 240, 420, 480].map((m) => `<button type="button" class="borne-bouton" data-m="${m}">${ecrireDuree(m)} h</button>`).join(' ')}</p>
        <p><button type="button" class="borne-bouton principal" data-valider>✔ Enregistrer</button> <button type="button" class="borne-bouton" data-retour>Retour</button></p>`;
      this.zone.querySelector('[data-moins]').addEventListener('click', () => { minutes = Math.max(pas, minutes - pas); rendre(); });
      this.zone.querySelector('[data-plus]').addEventListener('click', () => { minutes = Math.min(1440, minutes + pas); rendre(); });
      this.zone.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { minutes = Number(b.dataset.m); rendre(); }));
      this.zone.querySelector('[data-retour]').addEventListener('click', () => this.#type());
      this.zone.querySelector('[data-valider]').addEventListener('click', async () => {
        const s = this.etat.saisie;
        try {
          await appel('POST', '/pointages', {
            jeton: this.etat.journee.jeton, date: this.etat.journee.date, cha_id: s.cha_id, ent_id: s.ent_id, type_mo: s.type_mo, sous_type: s.sous_type, minutes, motif: s.motif ?? null,
            membres: this.etat.membres,
          });
          this.#accueil(`✔ ${ecrireDuree(minutes)} h ${this.test ? 'contrôlées (essai : non enregistrées)' : 'enregistrées'}${this.etat.membres ? ` pour ${this.etat.membres.length} personnes` : ''}.`);
          this.#minuterie(8000);
        } catch (e) { alert(e.message); if (e.code === 'BORNE_JETON') this.#accueil(); }
      });
      this.#minuterie();
    };
    rendre();
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

  async #bornes() {
    const zone = this.conteneur.querySelector('[data-bornes]');
    let l;
    try { l = await api.pointage.appareils(); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const service = (id) => this.ref.services.find((s) => s.id === id)?.libelle ?? 'Tous';
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>Borne<br><small>service</small></th><th>PIN exigé</th><th>État<br><small>vue le</small></th><th></th></tr></thead><tbody>
      ${l.map((a) => `<tr${a.actif ? '' : ' class="discret"'}><td>${echapper(a.libelle)}<br><small class="aide">${echapper(service(a.service))}</small></td><td>${a.pin_exige ? 'oui' : 'non'}</td>
        <td>${a.actif ? 'active' : 'désactivée'}<br><small class="aide">${a.vu_le ? new Date(a.vu_le).toLocaleString('fr-FR') : 'jamais vue'}</small></td>
        <td><button type="button" class="bouton-icone" data-basculer="${a.id}" title="${a.actif ? 'Désactiver la borne' : 'Réactiver la borne'}" aria-label="${a.actif ? 'Désactiver la borne' : 'Réactiver la borne'}">${a.actif ? '⏸' : '⏵'}</button>
          ${this.app.estAdmin() ? `<button type="button" class="bouton-icone" data-tester="${a.id}" title="Tester : ouvrir la borne dans une fenêtre séparée (PIN facultatif, pointages non enregistrés)" aria-label="Tester la borne">▶</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <p class="ligne"><input data-libelle placeholder="Libellé (Atelier bois…)"> <label><input type="checkbox" data-pin checked> PIN exigé</label>
        <span data-service></span> <button type="button" class="bouton-icone" data-creer title="Enregistrer une nouvelle borne (jeton affiché une seule fois)" aria-label="Enregistrer une borne">＋</button></p><div data-jeton></div>`;
    const srv = creerCombo({ options: this.ref.services.map((s) => ({ valeur: s.id, libelle: s.libelle })), valeur: '', vide: true, titre: 'Service de la borne' });
    zone.querySelector('[data-service]').append(srv);
    zone.querySelectorAll('[data-tester]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const { jeton } = await api.pointage.testerAppareil(Number(b.dataset.tester));
        this.app.naviguer(`/borne?test=${encodeURIComponent(jeton)}`, { nouvelleFenetre: true });
      } catch (e) { this.app.erreur(e); }
    }));
    zone.querySelectorAll('[data-basculer]').forEach((b) => b.addEventListener('click', async () => {
      const a = l.find((x) => String(x.id) === b.dataset.basculer);
      try { await api.pointage.modifierAppareil(a.id, { libelle: a.libelle, service: a.service, pin_exige: a.pin_exige, actif: !a.actif }); await this.#bornes(); } catch (e) { this.app.erreur(e); }
    }));
    zone.querySelector('[data-creer]').addEventListener('click', async () => {
      try {
        const r = await api.pointage.creerAppareil({ libelle: zone.querySelector('[data-libelle]').value, service: srv.valeurCombo ? Number(srv.valeurCombo) : null, pin_exige: zone.querySelector('[data-pin]').checked });
        await this.#bornes();
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
