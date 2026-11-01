import { texte, texteHtml, textesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PROFIL } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, saisir, formatDateHeure } from '@logibtp/socle/ui';
import { ETATS_COMPTE } from '@logibtp/authentification';
import { api } from '../api.js';
import { pastilleCompte, rendreComptePersonne, dateCompte, jourCompte } from '../comptes/comptes.js';

// Événements du journal : icône ; libellé « authentification_btp.evenements.<CODE> ».
const ICONES_EVENEMENTS = {
  CONNEXION: 'authentification_btp_connexion',
  ECHEC: 'authentification_btp_echec',
  VERROUILLAGE: 'verrou',
  DECONNEXION: 'authentification_btp_deconnecter',
  MDP_CHANGE: 'authentification_btp_mdp',
  MDP_REINITIALISE: 'authentification_btp_mdp',
  EXPIRE: 'authentification_btp_expire',
  REFUS: 'authentification_btp_refus',
  DEVERROUILLAGE: 'authentification_btp_deverrouiller',
  COMPTE: 'authentification_btp_compte',
  DOUBLE_FACTEUR: 'authentification_btp_mdp',
  EXCLUSION_IP: 'authentification_btp_refus',
  VOL_PRESUME: 'authentification_btp_vol',
  MACHINE: 'authentification_btp_machine',
  SESSION_FERMEE: 'authentification_btp_deconnecter',
  JETON_API: 'authentification_btp_api',
  USURPATION: 'authentification_btp_usurpation',
  USURPATION_FIN: 'authentification_btp_usurpation',
  USURPATION_ACTION: 'authentification_btp_usurpation',
  MDP_OUBLI: 'courriel',
};
const LIBELLES_EVENEMENTS = textesParCode('authentification_btp.evenements', Object.keys(ICONES_EVENEMENTS));
const evenement = (code) => (ICONES_EVENEMENTS[code] ? `${icone(ICONES_EVENEMENTS[code])} ${LIBELLES_EVENEMENTS[code]}` : code);

/**
 * Comptes utilisateurs (module Authentification, lot 1 ; administrateur) : liste par état (actifs, provisoires,
 * verrouillés, expirés, désactivés, service), dernière connexion ; nouveau compte pour un salarié ou un intérimaire
 * cherché par son nom ; `?compte=<id>` : un compte, ses actions et son journal de connexion.
 */
export class PageParametresComptes extends PageBase {
  icone = icone('authentification_btp_comptes');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('authentification_btp.comptes.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('authentification_btp_comptes')} ${texteHtml('authentification_btp.comptes.titre')}</h1><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!app.estAdmin()) { corps.innerHTML = `<p class="aide">${texteHtml('authentification_btp.comptes.admin_seul')}</p>`; return; }
    if (this.requete.compte) await this.#rendreCompte(corps, Number(this.requete.compte));
    else await this.#rendreListe(corps);
  }

  /** Sessions ouvertes et machines connues d'un compte : fermeture à distance, machine oubliée. */
  #rendreSessionsCompte(zone, compte, sessions, machines, recharger) {
    zone.innerHTML = `<h2 class="titre-actions">${texteHtml('authentification_btp.comptes.sessions_machines')} <span>${sessions.length ? `<button type="button" data-fermer>${iconeHtml('authentification_btp_deconnecter')} ${texteHtml('authentification_btp.comptes.fermer_sessions')}</button>` : ''}</span></h2>
      ${sessions.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('authentification_btp.mon_compte.navigateur')}</th><th>${texteHtml('authentification_btp.mon_compte.adresse')}</th><th>${texteHtml('authentification_btp.mon_compte.ouverte')}</th><th>${texteHtml('authentification_btp.mon_compte.derniere_activite')}</th><th>${texteHtml('authentification_btp.mon_compte.expire')}</th></tr></thead><tbody>
        ${sessions.map((s) => `<tr><td>${echapper(s.navigateur ?? '')}${s.machine ? ` ${iconeHtml('authentification_btp_machine')}` : ''}${s.api ? ` ${texteHtml('authentification_btp.mon_compte.api')}` : ''}</td><td>${echapper(s.adresse ?? '')}</td><td>${formatDateHeure(s.cree_le)}</td>
          <td>${formatDateHeure(s.vu_le)}</td><td>${formatDateHeure(s.expire_le)}</td></tr>`).join('')}</tbody></table>` : `<p class="aide">${texteHtml('authentification_btp.comptes.aucune_session')}</p>`}
      ${machines.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('authentification_btp.comptes.machine_connue')}</th><th>${texteHtml('authentification_btp.mon_compte.adresse')}</th><th>${texteHtml('authentification_btp.comptes.depuis')}</th><th>${texteHtml('authentification_btp.compte.derniere_connexion')}</th><th></th></tr></thead><tbody>
        ${machines.map((m) => `<tr><td>${echapper(m.nom ?? '')}</td><td>${echapper(m.adresse ?? '')}</td><td>${formatDateHeure(m.cree_le)}</td><td>${formatDateHeure(m.vu_le)}</td>
          <td class="cellule-boutons"><button type="button" class="bouton-icone" data-oublier="${m.id}" title="${texteHtml('authentification_btp.comptes.oublier_machine')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>` : ''}`;
    zone.querySelector('[data-fermer]')?.addEventListener('click', () => api.auth.fermerSessionsCompte(compte.id).then(recharger).catch((e) => this.app.erreur(e)));
    zone.querySelectorAll('[data-oublier]').forEach((b) => b.addEventListener('click', () => api.auth.oublierMachineCompte(compte.id, b.dataset.oublier).then(recharger).catch((e) => this.app.erreur(e))));
  }

  urlCourante() { return this.requete.compte ? `/parametres/comptes?compte=${this.requete.compte}` : '/parametres/comptes'; }

  async #rendreListe(corps) {
    corps.innerHTML = `<p class="aide">${texteHtml('authentification_btp.comptes.intro')}</p>
      <section class="carte"><h2>${texteHtml('authentification_btp.comptes.nouveau')}</h2>
        <p><input type="search" data-personne placeholder="${texteHtml('authentification_btp.comptes.personne_indice')}" size="40"></p>
        <div data-personnes></div><div data-creation></div></section>
      <section class="carte"><h2>${texteHtml('authentification_btp.comptes.api_titre')}</h2>
        <p class="aide">${texteHtml('authentification_btp.comptes.api_aide_html')}</p>
        <p class="ligne"><input data-api-code placeholder="${texteHtml('authentification_btp.connexion.identifiant_indice')}" size="18"> <input data-api-libelle placeholder="${texteHtml('commun.libelle')}" size="24">
          <span data-api-profil></span> <input data-api-adresses placeholder="${texteHtml('authentification_btp.comptes.adresses_indice')}" size="34">
          <button type="button" data-api-creer>${iconeHtml('ajouter')} ${texteHtml('commun.creer')}</button></p><div data-api-secret></div></section>
      <section class="carte"><h2>${texteHtml('authentification_btp.comptes.exclusions')}</h2><p class="aide">${texteHtml('authentification_btp.comptes.exclusions_aide')}</p><div data-exclusions></div></section>
      <section class="carte"><h2>${texteHtml('authentification_btp.comptes.comptes')}</h2>
        <p class="ligne"><input type="search" data-recherche placeholder="${texteHtml('authentification_btp.comptes.recherche_indice')}" size="24">
          ${['', 'ACTIF', 'A_CHANGER', 'VERROUILLE', 'EXPIRE', 'INACTIF', 'SERVICE'].map((e) => `<label class="ligne"><input type="radio" name="etat" value="${e}" ${e === '' ? 'checked' : ''}> ${e ? echapper(ETATS_COMPTE[e]) : texteHtml('authentification_btp.comptes.tous')}</label>`).join(' ')}</p>
        <div data-liste></div></section>`;
    const liste = corps.querySelector('[data-liste]');
    const charger = async () => {
      const etat = corps.querySelector('[name="etat"]:checked').value;
      const comptes = await api.auth.comptes({ recherche: corps.querySelector('[data-recherche]').value, etat });
      liste.innerHTML = comptes.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('authentification_btp.connexion.identifiant')}</th><th>${texteHtml('authentification_btp.mon_compte.nom')}</th><th>${texteHtml('authentification_btp.compte.profil')}</th><th>${texteHtml('authentification_btp.comptes.etat')}</th><th>${texteHtml('authentification_btp.compte.fin_validite')}</th><th>${texteHtml('authentification_btp.compte.derniere_connexion')}</th><th class="nombre">${texteHtml('authentification_btp.comptes.sessions')}</th></tr></thead><tbody>
        ${comptes.map((c) => `<tr><td><a href="/parametres/comptes?compte=${c.id}">${echapper(c.code)}</a></td><td>${echapper(c.libelle ?? '')}</td><td>${echapper(c.profil)}</td>
          <td>${pastilleCompte(c)}</td><td>${jourCompte(c.valide_jusqu_au)}</td><td>${dateCompte(c.derniere_connexion)}</td><td class="nombre">${c.sessions_ouvertes || ''}</td></tr>`).join('')}
        </tbody></table>` : `<p class="aide">${texteHtml('authentification_btp.comptes.aucun')}</p>`;
    };
    let minuterie = null;
    corps.querySelector('[data-recherche]').addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(() => charger().catch((e) => this.app.erreur(e)), 250); });
    corps.querySelectorAll('[name="etat"]').forEach((r) => r.addEventListener('change', () => charger().catch((e) => this.app.erreur(e))));
    await charger();

    // Identifiants d'API : secret affiché une fois.
    const profils = (await api.auth.profils().catch(() => ({ profils: [] }))).profils;
    const comboProfil = creerCombo({ options: profils.map((p) => ({ valeur: p.code, libelle: p.libelle })), vide: false, valeur: profils.find((p) => p.code === 'SAISIE')?.code ?? '', titre: texte('authentification_btp.compte.profil') });
    corps.querySelector('[data-api-profil]').append(comboProfil);
    corps.querySelector('[data-api-creer]').addEventListener('click', async () => {
      try {
        const r = await api.auth.creerCompteApi({
          code: corps.querySelector('[data-api-code]').value, libelle: corps.querySelector('[data-api-libelle]').value, profil: comboProfil.valeurCombo,
          adresses: corps.querySelector('[data-api-adresses]').value.split(',').map((a) => a.trim()).filter(Boolean),
        });
        corps.querySelector('[data-api-secret]').innerHTML = `<div class="carte avertissement"><p>${iconeHtml('authentification_btp_api')} ${texteHtml('authentification_btp.comptes.api_secret_html', { code: r.compte.code })}
          <code class="mdp-provisoire">${echapper(r.mot_de_passe)}</code></p></div>`;
        await charger();
      } catch (e) { this.app.erreur(e); }
    });
    const exclusions = corps.querySelector('[data-exclusions]');
    const chargerExclusions = async () => {
      const l = await api.auth.exclusions();
      exclusions.innerHTML = l.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('authentification_btp.mon_compte.adresse')}</th><th class="nombre">${texteHtml('authentification_btp.comptes.echecs')}</th><th>${texteHtml('authentification_btp.comptes.du')}</th><th>${texteHtml('authentification_btp.comptes.au')}</th><th>${texteHtml('authentification_btp.comptes.levee')}</th><th></th></tr></thead><tbody>
        ${l.map((x) => `<tr><td>${echapper(x.prefixe)}</td><td class="nombre">${x.echecs}</td><td>${formatDateHeure(x.debut)}</td><td>${formatDateHeure(x.fin)}</td>
          <td>${x.levee_le ? texteHtml('authentification_btp.comptes.levee_par', { le: formatDateHeure(x.levee_le), par: x.levee_par ?? '' }) : ''}</td>
          <td class="cellule-boutons">${!x.levee_le && new Date(x.fin) > new Date() ? `<button type="button" class="bouton-icone" data-lever="${x.id}" title="${texteHtml('authentification_btp.comptes.lever')}">${iconeHtml('authentification_btp_deverrouiller')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('authentification_btp.comptes.aucune_exclusion')}</p>`;
      exclusions.querySelectorAll('[data-lever]').forEach((b) => b.addEventListener('click', () => api.auth.leverExclusion(b.dataset.lever).then(chargerExclusions).catch((e) => this.app.erreur(e))));
    };
    await chargerExclusions().catch((e) => this.app.erreur(e));

    const zone = corps.querySelector('[data-personnes]');
    let minuteriePersonne = null;
    corps.querySelector('[data-personne]').addEventListener('input', (e) => {
      clearTimeout(minuteriePersonne);
      minuteriePersonne = setTimeout(async () => {
        const personnes = await api.auth.personnes(e.target.value).catch((x) => { this.app.erreur(x); return []; });
        zone.innerHTML = personnes.length ? `<ul class="liste-simple">${personnes.map((p, i) => `<li><button type="button" data-i="${i}">${p.compte ? iconeHtml('authentification_btp_compte') : iconeHtml('ajouter')}</button>
          ${echapper(p.personne.libelle)} <small class="aide">${echapper(p.personne.statut ?? '')}</small>${p.compte ? ` — ${texteHtml('authentification_btp.comptes.compte_lien')} <a href="/parametres/comptes?compte=${p.compte.id}">${echapper(p.compte.code)}</a>` : ''}</li>`).join('')}</ul>`
          : e.target.value.trim().length >= 2 ? `<p class="aide">${texteHtml('authentification_btp.comptes.aucune_personne')}</p>` : '';
        zone.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
          const p = personnes[Number(b.dataset.i)].personne;
          rendreComptePersonne(corps.querySelector('[data-creation]'), { app: this.app, type: p.type, id: p.id, surChange: () => charger() }).catch((x) => this.app.erreur(x));
        }));
      }, 250);
    });
  }

  async #rendreCompte(corps, id) {
    const { compte, personne, journal, sessions, machines } = await api.auth.compte(id);
    this.titre = texte('authentification_btp.comptes.titre_compte', { code: compte.code });
    corps.innerHTML = `<p><a href="/parametres/comptes">${iconeHtml('precedent')} ${texteHtml('authentification_btp.comptes.tous_comptes')}</a></p>
      <section class="carte"><h2>${echapper(compte.code)} ${pastilleCompte(compte)}</h2><div data-compte></div></section>
      <section class="carte" data-sessions-compte></section>
      <section class="carte"><h2>${texteHtml('authentification_btp.comptes.journal')}</h2>
        ${journal.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('authentification_btp.comptes.quand')}</th><th>${texteHtml('authentification_btp.comptes.evenement')}</th><th>${texteHtml('authentification_btp.comptes.detail')}</th><th>${texteHtml('authentification_btp.comptes.par')}</th><th>${texteHtml('authentification_btp.mon_compte.adresse')}</th></tr></thead><tbody>
          ${journal.map((j) => `<tr><td>${dateCompte(j.le)}</td><td>${echapper(evenement(j.evenement))}</td><td>${echapper(j.detail ?? '')}</td>
            <td>${echapper(j.par ?? '')}</td><td title="${echapper(j.navigateur ?? '')}">${echapper(j.adresse ?? '')}</td></tr>`).join('')}</tbody></table>` : `<p class="aide">${texteHtml('authentification_btp.comptes.aucun_evenement')}</p>`}
      </section>`;
    this.#rendreSessionsCompte(corps.querySelector('[data-sessions-compte]'), compte, sessions ?? [], machines ?? [], () => this.#rendreCompte(corps, id));
    const zone = corps.querySelector('[data-compte]');
    if (personne) await rendreComptePersonne(zone, { app: this.app, type: compte.type_element, id: compte.id_element });
    else if (compte.type === 'API') {
      zone.innerHTML = `<p class="aide">${texteHtml('authentification_btp.comptes.api_compte')}</p>
        <dl class="definitions"><dt>${texteHtml('commun.libelle')}</dt><dd>${echapper(compte.libelle ?? '')}</dd><dt>${texteHtml('authentification_btp.compte.profil')}</dt><dd>${echapper(compte.profil)}</dd>
        <dt>${texteHtml('authentification_btp.comptes.dernier_jeton')}</dt><dd>${dateCompte(compte.derniere_connexion)}</dd></dl>
        <p class="ligne"><label>${texteHtml('authentification_btp.comptes.adresses')} <input data-adresses value="${echapper((compte.adresses ?? []).join(', '))}" size="40" placeholder="${texteHtml('authentification_btp.comptes.toutes')}"></label>
          <button type="button" data-enregistrer-adresses title="${texteHtml('commun.enregistrer')}">${iconeHtml('enregistrer')}</button></p>
        <p><button type="button" data-secret>${iconeHtml('authentification_btp_connexion')} ${texteHtml('authentification_btp.comptes.nouveau_secret')}</button> <button type="button" data-actif>${compte.actif ? `${iconeHtml('authentification_btp_refus')} ${texteHtml('authentification_btp.comptes.desactiver')}` : `${iconeHtml('authentification_btp_reactiver')} ${texteHtml('authentification_btp.comptes.reactiver')}`}</button></p><div data-secret-affiche></div>`;
      zone.querySelector('[data-enregistrer-adresses]').addEventListener('click', () => api.auth.adressesApi(compte.id,
        zone.querySelector('[data-adresses]').value.split(',').map((a) => a.trim()).filter(Boolean)).then(() => this.app.message(texte('authentification_btp.comptes.adresses_enregistrees'), 'succes')).catch((e) => this.app.erreur(e)));
      zone.querySelector('[data-secret]').addEventListener('click', async () => {
        if (!await confirmer(texte('authentification_btp.comptes.confirmer_secret'))) return;
        try {
          const r = await api.auth.secretApi(compte.id);
          zone.querySelector('[data-secret-affiche]').innerHTML = `<div class="carte avertissement"><p>${texteHtml('authentification_btp.comptes.secret_affiche')} <code class="mdp-provisoire">${echapper(r.mot_de_passe)}</code></p></div>`;
        } catch (e) { this.app.erreur(e); }
      });
      zone.querySelector('[data-actif]').addEventListener('click', () => api.auth.modifierCompte(compte.id, { actif: !compte.actif, valide_jusqu_au: compte.valide_jusqu_au })
        .then(() => this.#rendreCompte(corps, id)).catch((e) => this.app.erreur(e)));
    } else zone.innerHTML = `<p class="aide">${compte.type === 'SERVICE' ? texteHtml('authentification_btp.comptes.service') : texteHtml('authentification_btp.comptes.sans_personne')}</p>
      <dl class="definitions"><dt>${texteHtml('authentification_btp.mon_compte.nom')}</dt><dd>${echapper(compte.libelle ?? '')}</dd><dt>${texteHtml('authentification_btp.compte.profil')}</dt><dd>${echapper(compte.profil)}</dd>
      <dt>${texteHtml('authentification_btp.compte.derniere_connexion')}</dt><dd>${dateCompte(compte.derniere_connexion)}</dd></dl>
      ${compte.type === 'PERSONNE' ? `<div data-provisoire></div><p><button type="button" data-reinitialiser>${iconeHtml('authentification_btp_mdp')} ${texteHtml('authentification_btp.compte.reinitialiser')}</button>
        ${compte.etat === 'VERROUILLE' ? `<button type="button" data-deverrouiller>${iconeHtml('authentification_btp_deverrouiller')} ${texteHtml('authentification_btp.compte.deverrouiller')}</button>` : ''}</p>` : ''}`;
    // Usurpation (administrateur, jamais un compte administrateur) : tester les droits du compte, dépanner.
    if (compte.type === 'PERSONNE' && compte.code !== this.app.utilisateur() && compte.profil !== PROFIL.ADMIN) {
      zone.insertAdjacentHTML('beforeend', `<p><button type="button" data-usurper title="${texteHtml('authentification_btp.comptes.usurper_aide')}">${iconeHtml('authentification_btp_usurpation')} ${texteHtml('authentification_btp.comptes.usurper')}</button></p>`);
      zone.querySelector('[data-usurper]').addEventListener('click', async () => {
        const motif = await saisir(texte('authentification_btp.comptes.usurper_motif', { code: compte.code }));
        if (motif?.trim()) this.app.usurper(compte.code, motif.trim()).catch((e) => this.app.erreur(e));
      });
    }
    zone.querySelector('[data-reinitialiser]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('authentification_btp.compte.confirmer_reinitialiser', { code: compte.code }))) return;
      try {
        const r = await api.auth.reinitialiserCompte(compte.id);
        zone.querySelector('[data-provisoire]').innerHTML = `<div class="carte avertissement"><p>${iconeHtml('authentification_btp_mdp')} ${texteHtml('authentification_btp.comptes.provisoire_affiche')} <code class="mdp-provisoire">${echapper(r.mot_de_passe)}</code></p></div>`;
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-deverrouiller]')?.addEventListener('click', () => api.auth.deverrouillerCompte(compte.id).then(() => this.#rendreCompte(corps, id)).catch((e) => this.app.erreur(e)));
  }
}
