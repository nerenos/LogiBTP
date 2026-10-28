import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, saisir, formatDateHeure } from '@logibtp/socle/ui';
import { ETATS_COMPTE } from '@logibtp/authentification';
import { api } from '../api.js';
import { pastilleCompte, rendreComptePersonne, dateCompte, jourCompte } from '../comptes/comptes.js';

const EVENEMENTS = {
  CONNEXION: '🔑 Connexion', ECHEC: '✖ Échec', VERROUILLAGE: '🔒 Verrouillage', DECONNEXION: '⏻ Déconnexion', MDP_CHANGE: '🔐 Mot de passe changé',
  MDP_REINITIALISE: '🔐 Mot de passe réinitialisé', EXPIRE: '⌛ Expiré', REFUS: '⛔ Refus', DEVERROUILLAGE: '🔓 Déverrouillage', COMPTE: '👤 Compte',
  DOUBLE_FACTEUR: '🔐 Double facteur', EXCLUSION_IP: '⛔ Adresse exclue', VOL_PRESUME: '🚨 Vol présumé', MACHINE: '💻 Machine',
  SESSION_FERMEE: '⏻ Session fermée', JETON_API: '🔌 Jeton d’API',
  USURPATION: '🎭 Usurpation', USURPATION_FIN: '🎭 Fin d’usurpation', USURPATION_ACTION: '🎭 Action pendant l’usurpation', MDP_OUBLI: '✉ Mot de passe oublié',
};

/**
 * Comptes utilisateurs (module Authentification, lot 1 ; administrateur) : liste par état (actifs, provisoires,
 * verrouillés, expirés, désactivés, service), dernière connexion ; nouveau compte pour un salarié ou un intérimaire
 * cherché par son nom ; `?compte=<id>` : un compte, ses actions et son journal de connexion.
 */
export class PageParametresComptes extends PageBase {
  icone = '👥';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Comptes utilisateurs';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">👥 Comptes utilisateurs</h1><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!app.estAdmin()) { corps.innerHTML = '<p class="aide">Réservé aux administrateurs.</p>'; return; }
    if (this.requete.compte) await this.#rendreCompte(corps, Number(this.requete.compte));
    else await this.#rendreListe(corps);
  }

  /** Sessions ouvertes et machines connues d'un compte : fermeture à distance, machine oubliée. */
  #rendreSessionsCompte(zone, compte, sessions, machines, recharger) {
    zone.innerHTML = `<h2 class="titre-actions">Sessions et machines <span>${sessions.length ? '<button type="button" data-fermer>⏻ Fermer toutes les sessions</button>' : ''}</span></h2>
      ${sessions.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Navigateur</th><th>Adresse</th><th>Ouverte</th><th>Dernière activité</th><th>Expire</th></tr></thead><tbody>
        ${sessions.map((s) => `<tr><td>${echapper(s.navigateur ?? '')}${s.machine ? ' 💻' : ''}${s.api ? ' API' : ''}</td><td>${echapper(s.adresse ?? '')}</td><td>${formatDateHeure(s.cree_le)}</td>
          <td>${formatDateHeure(s.vu_le)}</td><td>${formatDateHeure(s.expire_le)}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucune session ouverte.</p>'}
      ${machines.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Machine connue</th><th>Adresse</th><th>Depuis</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
        ${machines.map((m) => `<tr><td>${echapper(m.nom ?? '')}</td><td>${echapper(m.adresse ?? '')}</td><td>${formatDateHeure(m.cree_le)}</td><td>${formatDateHeure(m.vu_le)}</td>
          <td class="cellule-boutons"><button type="button" class="bouton-icone" data-oublier="${m.id}" title="Oublier cette machine">✕</button></td></tr>`).join('')}</tbody></table>` : ''}`;
    zone.querySelector('[data-fermer]')?.addEventListener('click', () => api.auth.fermerSessionsCompte(compte.id).then(recharger).catch((e) => this.app.erreur(e)));
    zone.querySelectorAll('[data-oublier]').forEach((b) => b.addEventListener('click', () => api.auth.oublierMachineCompte(compte.id, b.dataset.oublier).then(recharger).catch((e) => this.app.erreur(e))));
  }

  urlCourante() { return this.requete.compte ? `/parametres/comptes?compte=${this.requete.compte}` : '/parametres/comptes'; }

  async #rendreListe(corps) {
    corps.innerHTML = `<p class="aide">Un compte se crée pour un salarié ou un intérimaire actif (aucun par défaut) ; il est désactivé d'office à la sortie du salarié.
        Les comptes de service tracent les tâches de fond et ne se connectent jamais.</p>
      <section class="carte"><h2>Nouveau compte</h2>
        <p><input type="search" data-personne placeholder="Salarié ou intérimaire : nom, prénom ou matricule…" size="40"></p>
        <div data-personnes></div><div data-creation></div></section>
      <section class="carte"><h2>Identifiants d'API</h2>
        <p class="aide">Pour un logiciel tiers : jeton obtenu par <code>POST /api/auth/jeton</code> { identifiant, secret }, puis en-tête
          <code>Authorization: Bearer …</code> (15 minutes, renouvelé par <code>/api/auth/jeton/rafraichir</code>). Jamais de profil à tous les droits.</p>
        <p class="ligne"><input data-api-code placeholder="identifiant" size="18"> <input data-api-libelle placeholder="Libellé" size="24">
          <span data-api-profil></span> <input data-api-adresses placeholder="Adresses permises (CIDR, séparées par des virgules)" size="34">
          <button type="button" data-api-creer>＋ Créer</button></p><div data-api-secret></div></section>
      <section class="carte"><h2>Adresses exclues</h2><p class="aide">Trop d'échecs de connexion depuis une adresse : exclusion temporaire, croissante en cas de récidive ;
        une machine connue reste acceptée.</p><div data-exclusions></div></section>
      <section class="carte"><h2>Comptes</h2>
        <p class="ligne"><input type="search" data-recherche placeholder="Identifiant ou nom…" size="24">
          ${['', 'ACTIF', 'A_CHANGER', 'VERROUILLE', 'EXPIRE', 'INACTIF', 'SERVICE'].map((e) => `<label class="ligne"><input type="radio" name="etat" value="${e}" ${e === '' ? 'checked' : ''}> ${e ? echapper(ETATS_COMPTE[e]) : 'Tous'}</label>`).join(' ')}</p>
        <div data-liste></div></section>`;
    const liste = corps.querySelector('[data-liste]');
    const charger = async () => {
      const etat = corps.querySelector('[name="etat"]:checked').value;
      const comptes = await api.auth.comptes({ recherche: corps.querySelector('[data-recherche]').value, etat });
      liste.innerHTML = comptes.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Identifiant</th><th>Nom</th><th>Profil</th><th>État</th><th>Fin de validité</th><th>Dernière connexion</th><th class="nombre">Sessions</th></tr></thead><tbody>
        ${comptes.map((c) => `<tr><td><a href="/parametres/comptes?compte=${c.id}">${echapper(c.code)}</a></td><td>${echapper(c.libelle ?? '')}</td><td>${echapper(c.profil)}</td>
          <td>${pastilleCompte(c)}</td><td>${jourCompte(c.valide_jusqu_au)}</td><td>${dateCompte(c.derniere_connexion)}</td><td class="nombre">${c.sessions_ouvertes || ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="aide">Aucun compte.</p>';
    };
    let minuterie = null;
    corps.querySelector('[data-recherche]').addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(() => charger().catch((e) => this.app.erreur(e)), 250); });
    corps.querySelectorAll('[name="etat"]').forEach((r) => r.addEventListener('change', () => charger().catch((e) => this.app.erreur(e))));
    await charger();

    // Identifiants d'API : secret affiché une fois.
    const profils = (await api.auth.profils().catch(() => ({ profils: [] }))).profils;
    const comboProfil = creerCombo({ options: profils.map((p) => ({ valeur: p.code, libelle: p.libelle })), vide: false, valeur: profils.find((p) => p.code === 'SAISIE')?.code ?? '', titre: 'Profil' });
    corps.querySelector('[data-api-profil]').append(comboProfil);
    corps.querySelector('[data-api-creer]').addEventListener('click', async () => {
      try {
        const r = await api.auth.creerCompteApi({
          code: corps.querySelector('[data-api-code]').value, libelle: corps.querySelector('[data-api-libelle]').value, profil: comboProfil.valeurCombo,
          adresses: corps.querySelector('[data-api-adresses]').value.split(',').map((a) => a.trim()).filter(Boolean),
        });
        corps.querySelector('[data-api-secret]').innerHTML = `<div class="carte avertissement"><p>🔌 ${echapper(r.compte.code)} : secret affiché une fois, à recopier dans le logiciel tiers :
          <code class="mdp-provisoire">${echapper(r.mot_de_passe)}</code></p></div>`;
        await charger();
      } catch (e) { this.app.erreur(e); }
    });
    const exclusions = corps.querySelector('[data-exclusions]');
    const chargerExclusions = async () => {
      const l = await api.auth.exclusions();
      exclusions.innerHTML = l.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Adresse</th><th class="nombre">Échecs</th><th>Du</th><th>Au</th><th>Levée</th><th></th></tr></thead><tbody>
        ${l.map((x) => `<tr><td>${echapper(x.prefixe)}</td><td class="nombre">${x.echecs}</td><td>${formatDateHeure(x.debut)}</td><td>${formatDateHeure(x.fin)}</td>
          <td>${x.levee_le ? `${formatDateHeure(x.levee_le)} par ${echapper(x.levee_par ?? '')}` : ''}</td>
          <td class="cellule-boutons">${!x.levee_le && new Date(x.fin) > new Date() ? `<button type="button" class="bouton-icone" data-lever="${x.id}" title="Lever l'exclusion">🔓</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucune adresse exclue ces 7 derniers jours.</p>';
      exclusions.querySelectorAll('[data-lever]').forEach((b) => b.addEventListener('click', () => api.auth.leverExclusion(b.dataset.lever).then(chargerExclusions).catch((e) => this.app.erreur(e))));
    };
    await chargerExclusions().catch((e) => this.app.erreur(e));

    const zone = corps.querySelector('[data-personnes]');
    let minuteriePersonne = null;
    corps.querySelector('[data-personne]').addEventListener('input', (e) => {
      clearTimeout(minuteriePersonne);
      minuteriePersonne = setTimeout(async () => {
        const personnes = await api.auth.personnes(e.target.value).catch((x) => { this.app.erreur(x); return []; });
        zone.innerHTML = personnes.length ? `<ul class="liste-simple">${personnes.map((p, i) => `<li><button type="button" data-i="${i}">${p.compte ? '👤' : '＋'}</button>
          ${echapper(p.personne.libelle)} <small class="aide">${echapper(p.personne.statut ?? '')}</small>${p.compte ? ` — compte <a href="/parametres/comptes?compte=${p.compte.id}">${echapper(p.compte.code)}</a>` : ''}</li>`).join('')}</ul>`
          : e.target.value.trim().length >= 2 ? '<p class="aide">Aucun salarié ni intérimaire actif trouvé.</p>' : '';
        zone.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
          const p = personnes[Number(b.dataset.i)].personne;
          rendreComptePersonne(corps.querySelector('[data-creation]'), { app: this.app, type: p.type, id: p.id, surChange: () => charger() }).catch((x) => this.app.erreur(x));
        }));
      }, 250);
    });
  }

  async #rendreCompte(corps, id) {
    const { compte, personne, journal, sessions, machines } = await api.auth.compte(id);
    this.titre = `Compte ${compte.code}`;
    corps.innerHTML = `<p><a href="/parametres/comptes">← Tous les comptes</a></p>
      <section class="carte"><h2>${echapper(compte.code)} ${pastilleCompte(compte)}</h2><div data-compte></div></section>
      <section class="carte" data-sessions-compte></section>
      <section class="carte"><h2>Journal des connexions</h2>
        ${journal.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Quand</th><th>Événement</th><th>Détail</th><th>Par</th><th>Adresse</th></tr></thead><tbody>
          ${journal.map((j) => `<tr><td>${dateCompte(j.le)}</td><td>${echapper(EVENEMENTS[j.evenement] ?? j.evenement)}</td><td>${echapper(j.detail ?? '')}</td>
            <td>${echapper(j.par ?? '')}</td><td title="${echapper(j.navigateur ?? '')}">${echapper(j.adresse ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun événement.</p>'}
      </section>`;
    this.#rendreSessionsCompte(corps.querySelector('[data-sessions-compte]'), compte, sessions ?? [], machines ?? [], () => this.#rendreCompte(corps, id));
    const zone = corps.querySelector('[data-compte]');
    if (personne) await rendreComptePersonne(zone, { app: this.app, type: compte.type_element, id: compte.id_element });
    else if (compte.type === 'API') {
      zone.innerHTML = `<p class="aide">Identifiant d'API : jetons par identifiant et secret, sans interface.</p>
        <dl class="definitions"><dt>Libellé</dt><dd>${echapper(compte.libelle ?? '')}</dd><dt>Profil</dt><dd>${echapper(compte.profil)}</dd>
        <dt>Dernier jeton</dt><dd>${dateCompte(compte.derniere_connexion)}</dd></dl>
        <p class="ligne"><label>Adresses permises <input data-adresses value="${echapper((compte.adresses ?? []).join(', '))}" size="40" placeholder="toutes"></label>
          <button type="button" data-enregistrer-adresses>💾</button></p>
        <p><button type="button" data-secret>🔑 Nouveau secret</button> <button type="button" data-actif>${compte.actif ? '⛔ Désactiver' : '✔ Réactiver'}</button></p><div data-secret-affiche></div>`;
      zone.querySelector('[data-enregistrer-adresses]').addEventListener('click', () => api.auth.adressesApi(compte.id,
        zone.querySelector('[data-adresses]').value.split(',').map((a) => a.trim()).filter(Boolean)).then(() => this.app.message('Adresses enregistrées', 'succes')).catch((e) => this.app.erreur(e)));
      zone.querySelector('[data-secret]').addEventListener('click', async () => {
        if (!await confirmer('Nouveau secret : l\'ancien ne vaut plus et les jetons en cours sont fermés. Continuer ?')) return;
        try {
          const r = await api.auth.secretApi(compte.id);
          zone.querySelector('[data-secret-affiche]').innerHTML = `<div class="carte avertissement"><p>Secret affiché une fois : <code class="mdp-provisoire">${echapper(r.mot_de_passe)}</code></p></div>`;
        } catch (e) { this.app.erreur(e); }
      });
      zone.querySelector('[data-actif]').addEventListener('click', () => api.auth.modifierCompte(compte.id, { actif: !compte.actif, valide_jusqu_au: compte.valide_jusqu_au })
        .then(() => this.#rendreCompte(corps, id)).catch((e) => this.app.erreur(e)));
    } else zone.innerHTML = `<p class="aide">${compte.type === 'SERVICE' ? 'Compte de service : tâches de fond, sans connexion.' : 'Compte sans personne liée (administrateur de l\'installation) : réinitialisation par la commande serveur.'}</p>
      <dl class="definitions"><dt>Nom</dt><dd>${echapper(compte.libelle ?? '')}</dd><dt>Profil</dt><dd>${echapper(compte.profil)}</dd>
      <dt>Dernière connexion</dt><dd>${dateCompte(compte.derniere_connexion)}</dd></dl>
      ${compte.type === 'PERSONNE' ? `<div data-provisoire></div><p><button type="button" data-reinitialiser>🔐 Réinitialiser le mot de passe</button>
        ${compte.etat === 'VERROUILLE' ? '<button type="button" data-deverrouiller>🔓 Déverrouiller</button>' : ''}</p>` : ''}`;
    // Usurpation (administrateur, jamais un compte administrateur) : tester les droits du compte, dépanner.
    if (compte.type === 'PERSONNE' && compte.code !== this.app.utilisateur() && compte.profil !== 'ADMIN') {
      zone.insertAdjacentHTML('beforeend', `<p><button type="button" data-usurper title="Agir pour ce compte (une heure au plus, motif obligatoire, tracé au journal et notifié)">🎭 Agir à sa place…</button></p>`);
      zone.querySelector('[data-usurper]').addEventListener('click', async () => {
        const motif = await saisir(`Agir pour ${compte.code} : motif (test des droits, dépannage…)`);
        if (motif?.trim()) this.app.usurper(compte.code, motif.trim()).catch((e) => this.app.erreur(e));
      });
    }
    zone.querySelector('[data-reinitialiser]')?.addEventListener('click', async () => {
      if (!await confirmer(`Réinitialiser le mot de passe de ${compte.code} ? Ses sessions seront fermées.`)) return;
      try {
        const r = await api.auth.reinitialiserCompte(compte.id);
        zone.querySelector('[data-provisoire]').innerHTML = `<div class="carte avertissement"><p>🔐 Mot de passe provisoire, affiché une fois : <code class="mdp-provisoire">${echapper(r.mot_de_passe)}</code></p></div>`;
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-deverrouiller]')?.addEventListener('click', () => api.auth.deverrouillerCompte(compte.id).then(() => this.#rendreCompte(corps, id)).catch((e) => this.app.erreur(e)));
  }
}
