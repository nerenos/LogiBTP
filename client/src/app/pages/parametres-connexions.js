import { texte, texteHtml, textesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { pastille } from '../pastilles.js';
import { SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';

const ETATS = textesParCode('oauth_btp.etats', ['A_CONNECTER', 'OK', 'A_RECONNECTER', 'DESACTIVEE']);
const CLASSES_PASTILLE = { VERT: 'ok', ORANGE: 'attention', ROUGE: 'erreur' };
const jour = (d) => (d ? String(d).slice(0, 10) : '');
const liste = (saisie) => String(saisie ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Pastille d'une connexion (état et échéances) : rouge à reconnecter ou à moins de 7 jours, orange à moins de 30. */
/** Flux d'obtention des jetons : par la page du fournisseur (délégué) ou sans utilisateur. */
export const FLUX_OAUTH = ['CODE_PKCE', 'CLIENT', 'COMPTE_SERVICE'].map((valeur) => ({ valeur, get libelle() { return texte(`oauth_btp.flux.${valeur}`); } }));

/** Lit un fichier choisi en base64 (certificat .pfx) ou en texte (clé JSON). */
function lireFichier(input, base64) {
  const f = input?.files?.[0];
  if (!f) return Promise.resolve(null);
  return new Promise((ok, ko) => {
    const l = new FileReader();
    l.onerror = () => ko(l.error);
    l.onload = () => ok(base64 ? String(l.result).replace(/^data:[^,]*,/, '') : String(l.result));
    if (base64) l.readAsDataURL(f); else l.readAsText(f);
  });
}

export function pastilleConnexion(c) {
  return pastille(ETATS[c.etat] ?? c.etat, CLASSES_PASTILLE[c.pastille] ?? 'neutre', { titre: c.derniere_erreur });
}

/**
 * Connexions externes OAuth 2.0 (module OAuth, ANALYSE-MODULE-OAUTH.md) : un administrateur crée la connexion et
 * enregistre le client du fournisseur (jamais relu) ; une personne autorisée (droits de la connexion) la connecte
 * ou la reconnecte dans une fenêtre séparée ouverte sur la page du fournisseur. Au retour, le fournisseur renvoie
 * cette page avec `oauth=ok|erreur` : dans la fenêtre d'autorisation, elle prévient les autres fenêtres et se ferme.
 */
export class PageParametresConnexions extends PageBase {
  icone = icone('oauth_btp_connexions');

  urlCourante() { return `/parametres/connexions${this.selection ? `?id=${this.selection}` : ''}`; }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('oauth_btp.connexions.titre');
    const r = this.requete ?? {};
    // Retour du fournisseur dans la fenêtre d'autorisation : les autres fenêtres sont prévenues, celle-ci se ferme si le
    // navigateur le permet (le lien avec la fenêtre d'origine peut avoir été coupé par la page du fournisseur).
    if (r.oauth) {
      app.publier(SUJET_FENETRE.OAUTH, { id: Number(r.id), ok: r.oauth === 'ok', message: r.message ?? '' });
      setTimeout(() => window.close(), 400);
    }
    this.selection = r.id ? Number(r.id) : null;
    this.conteneur.innerHTML = `<div class="page-parametres">
      <div class="entete-page"><h1 class="page-titre">${iconeHtml('oauth_btp_connexions')} ${texteHtml('oauth_btp.connexions.titre_page')}</h1><span data-commandes></span></div>
      <p class="aide">${texteHtml('oauth_btp.connexions.intro')}</p>
      <div data-liste></div><div data-detail></div><div data-parametres></div></div>`;
    if (r.oauth) app.message(r.message ?? '', r.oauth === 'ok' ? 'succes' : 'erreur');
    this.admin = app.estAdmin();
    this.desabonner = app.abonner(SUJET_FENETRE.OAUTH, async (m) => {
      this.app.message(m.message, m.ok ? 'succes' : 'erreur');
      if (!m.ok && /autre compte/.test(m.message) && await confirmer(texte('oauth_btp.connexions.reconnecter_autre', { message: m.message }))) this.connecter(m.id, true);
      this.charger();
    });
    [this.fournisseurs, this.parametres] = await Promise.all([api.oauth.fournisseurs(), api.oauth.parametres()]);
    if (this.admin) {
      const cmd = this.conteneur.querySelector('[data-commandes]');
      cmd.innerHTML = `<button type="button" data-nouvelle>${iconeHtml('ajouter')} ${texteHtml('oauth_btp.connexions.nouvelle')}</button>
        <button type="button" data-passer title="${texteHtml('oauth_btp.connexions.passer_aide')}">${iconeHtml('oauth_btp_controler')} ${texteHtml('oauth_btp.connexions.passer')}</button>`;
      cmd.querySelector('[data-nouvelle]').addEventListener('click', () => { this.selection = null; this.rendreDetail(null); });
      cmd.querySelector('[data-passer]').addEventListener('click', async () => {
        try { await api.oauth.passer(); await this.charger(); app.message(texte('oauth_btp.connexions.controle'), 'succes'); } catch (e) { app.erreur(e); }
      });
    }
    await this.charger();
    this.rendreParametres();
  }

  fermer() { this.desabonner?.(); }

  async charger() {
    this.connexions = await api.oauth.connexions();
    this.rendreListe();
    const c = this.connexions.find((x) => x.id === this.selection);
    if (c) this.rendreDetail(c);
  }

  rendreListe() {
    const zone = this.conteneur.querySelector('[data-liste]');
    if (!this.connexions.length) {
      zone.innerHTML = `<p class="aide">${this.admin ? texteHtml('oauth_btp.connexions.aucune_admin') : texteHtml('oauth_btp.connexions.aucune')}</p>`;
      return;
    }
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('oauth_btp.connexions.etat')}</th><th>${texteHtml('oauth_btp.connexions.nom')}</th><th>${texteHtml('commun.code')}</th><th>${texteHtml('oauth_btp.connexions.fournisseur')}</th>
      <th>${texteHtml('oauth_btp.connexions.autorisation_jusquau')}</th><th>${texteHtml('oauth_btp.connexions.secret_jusquau')}</th><th>${texteHtml('oauth_btp.connexions.utilisee_par')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${this.connexions.map((c) => `<tr data-id="${c.id}"${c.id === this.selection ? ' class="selection"' : ''}>
        <td>${pastilleConnexion(c)}</td><td>${echapper(c.nom)}${c.mode_test ? ` <span class="aide" title="${texteHtml('oauth_btp.connexions.test_aide')}">${texteHtml('oauth_btp.connexions.test')}</span>` : ''}</td>
        <td>${echapper(c.code)}</td><td>${echapper(c.fournisseur_libelle)}</td>
        <td>${formatDateHeure(c.rafraichissement_expire_le)}</td><td>${formatDateHeure(c.secret_expire_le)}</td>
        <td>${echapper(c.utilisations.join(', '))}</td>
        <td class="cellule-boutons">${c.peut_reconnecter && c.client_configure ? `<button type="button" data-connecter title="${c.flux === 'CODE_PKCE' ? texteHtml('oauth_btp.connexions.ouvrir_fournisseur') : texteHtml('oauth_btp.connexions.jeton_direct')}">${c.connectee ? `${iconeHtml('oauth_btp_reconnecter')} ${texteHtml('oauth_btp.connexions.reconnecter')}` : `${iconeHtml('oauth_btp_connecter')} ${texteHtml('oauth_btp.connexions.connecter')}`}</button>` : ''}
          ${c.etat === 'OK' ? `<button type="button" data-tester title="${texteHtml('oauth_btp.connexions.tester_aide')}">${iconeHtml('oauth_btp_tester')} ${texteHtml('oauth_btp.connexions.tester')}</button>` : ''}
          <button type="button" data-ouvrir title="${texteHtml('oauth_btp.connexions.detail')}">${iconeHtml('oauth_btp_modifier')}</button></td></tr>`).join('')}
      </tbody></table>`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => {
      const c = this.connexions.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-connecter]')?.addEventListener('click', () => (c.flux === 'CODE_PKCE' ? this.connecter(c.id) : this.connecterDirect(c.id)));
      tr.querySelector('[data-tester]')?.addEventListener('click', () => this.tester(c.id));
      tr.querySelector('[data-ouvrir]').addEventListener('click', () => { this.selection = c.id; this.rendreListe(); this.rendreDetail(c); });
    });
  }

  /** Ouvre la page d'autorisation du fournisseur dans une fenêtre séparée ; le retour prévient cette page (sujet `oauth`). */
  async connecter(id, autreCompte = false) {
    const fenetre = window.open('', `oauth-${id}`, 'width=520,height=680');
    try {
      const { url } = await api.oauth.autoriser(id, autreCompte);
      if (fenetre) fenetre.location.href = url;
      else window.location.href = url;
    } catch (e) {
      fenetre?.close();
      this.app.erreur(e);
    }
  }

  /** Flux sans utilisateur (application, compte de service) : jeton obtenu directement par le serveur. */
  async connecterDirect(id) {
    try { await api.oauth.connecter(id); this.app.message(texte('oauth_btp.connexions.etablie'), 'succes'); } catch (e) { this.app.erreur(e); }
    await this.charger();
  }

  async tester(id) {
    try { await api.oauth.tester(id); this.app.message(texte('oauth_btp.connexions.operationnelle'), 'succes'); } catch (e) { this.app.erreur(e); }
    await this.charger();
  }

  rendreDetail(c) {
    const zone = this.conteneur.querySelector('[data-detail]');
    const admin = this.admin;
    const dis = admin ? '' : 'disabled';
    const f = c ? this.fournisseurs.find((x) => x.code === c.fournisseur) : this.fournisseurs[0];
    zone.innerHTML = `<h2>${c ? texteHtml('oauth_btp.connexions.titre_detail', { nom: c.nom }) : texteHtml('oauth_btp.connexions.nouvelle_titre')}</h2>
      <table class="tableau-compact largeur-contenu"><tbody>
        <tr><th>${texteHtml('commun.code')}</th><td><input data-c="code" value="${echapper(c?.code ?? '')}" size="16" maxlength="30" ${dis}></td></tr>
        <tr><th>${texteHtml('oauth_btp.connexions.nom')}</th><td><input data-c="nom" value="${echapper(c?.nom ?? '')}" size="40" maxlength="100" ${dis} placeholder="${texteHtml('oauth_btp.connexions.nom_indice')}"></td></tr>
        <tr><th>${texteHtml('oauth_btp.connexions.fournisseur')}</th><td><span data-fournisseur></span></td></tr>
        <tr><th>${texteHtml('oauth_btp.connexions.flux')}</th><td><span data-flux></span></td></tr>
        <tr><th>${texteHtml('oauth_btp.connexions.portees')}</th><td><input data-c="portees" value="${echapper(c?.portees ?? f?.portees ?? '')}" size="60" ${dis}></td></tr>
        <tr><th>${texteHtml('oauth_btp.connexions.mode_test')}</th><td><label class="ligne"><input type="checkbox" data-c="mode_test" ${c?.mode_test ?? true ? 'checked' : ''} ${dis}>
          ${texteHtml('oauth_btp.connexions.mode_test_aide', { jours: f?.rafraichissement_test_jours ?? 7 })}</label></td></tr>
        <tr><th>${texteHtml('oauth_btp.connexions.droits')}</th><td><input data-c="droits" value="${echapper((c?.droits ?? []).join(', '))}" size="40" ${dis}
          title="${texteHtml('oauth_btp.connexions.droits_aide')}"></td></tr>
        <tr><th>${texteHtml('oauth_btp.connexions.rappels')}</th><td><input data-c="rappels_jours" value="${echapper((c?.rappels_jours ?? []).join(', '))}" size="12" ${dis}
          placeholder="${echapper((this.parametres.rappels_jours ?? []).join(', '))}" title="${texteHtml('oauth_btp.connexions.rappels_vide')}"></td></tr>
      </tbody></table>
      ${admin ? `<div class="boutons"><button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button>
        ${c ? `<button type="button" data-revoquer title="${texteHtml('oauth_btp.connexions.revoquer_aide')}">${iconeHtml('oauth_btp_revoquer')} ${texteHtml('oauth_btp.connexions.revoquer')}</button> <button type="button" data-supprimer>${iconeHtml('retirer')} ${texteHtml('commun.supprimer')}</button>` : ''}</div>` : ''}
      ${c ? `<h3>${texteHtml('oauth_btp.connexions.client')}</h3>
        <p class="aide">${c.client_configure ? texteHtml('oauth_btp.connexions.client_configure') : texteHtml('oauth_btp.connexions.client_a_renseigner')}
          ${texteHtml('oauth_btp.connexions.client_adresse_html', { adresse: this.parametres.adresse_retour ?? '' })}</p>
        ${admin ? `<table class="tableau-compact largeur-contenu"><tbody>
          ${c.flux === 'COMPTE_SERVICE' ? `
          <tr><th>${texteHtml('oauth_btp.connexions.cle')}</th><td><input type="file" data-f="cle" accept=".json,application/json"> <span class="aide">${texteHtml('oauth_btp.connexions.cle_aide')}</span></td></tr>
          <tr><th>${texteHtml('oauth_btp.connexions.sujet')}</th><td><input data-k="sujet" size="40" placeholder="${texteHtml('oauth_btp.connexions.sujet_indice')}"></td></tr>` : `
          <tr><th>${texteHtml('oauth_btp.connexions.identifiant_client')}</th><td><input data-k="identifiant_client" size="50" autocomplete="off"></td></tr>
          <tr><th>${texteHtml('oauth_btp.connexions.secret')}</th><td><input type="password" data-k="secret" size="30" autocomplete="new-password"></td></tr>
          ${c.flux === 'CLIENT' ? `<tr><th>${texteHtml('oauth_btp.connexions.certificat')}</th><td><input type="file" data-f="certificat" accept=".pfx,.p12"> <input type="password" data-k="mdp_certificat" size="16"
            placeholder="${texteHtml('oauth_btp.connexions.mdp_indice')}" autocomplete="new-password"> <span class="aide">${texteHtml('oauth_btp.connexions.certificat_aide')}</span></td></tr>` : ''}
          <tr><th>${texteHtml('oauth_btp.connexions.locataire')}</th><td><input data-k="locataire" size="30" placeholder="${texteHtml('oauth_btp.connexions.locataire_indice')}"></td></tr>
          <tr><th>${texteHtml('oauth_btp.connexions.secret_expire')}</th><td><input type="date" data-k="secret_expire_le" value="${jour(c.secret_expire_le)}"></td></tr>`}
          ${c.fournisseur === 'GENERIQUE' ? `
          <tr><th>${texteHtml('oauth_btp.connexions.url_autorisation')}</th><td><input data-k="url_autorisation" size="60" placeholder="https://…"></td></tr>
          <tr><th>${texteHtml('oauth_btp.connexions.url_jeton')}</th><td><input data-k="url_jeton" size="60" placeholder="https://…"></td></tr>
          <tr><th>${texteHtml('oauth_btp.connexions.url_revocation')}</th><td><input data-k="url_revocation" size="60" placeholder="${texteHtml('oauth_btp.connexions.facultative')}"></td></tr>` : ''}
        </tbody></table><div class="boutons"><button type="button" data-client>${texteHtml('oauth_btp.connexions.enregistrer_client')}</button></div>
        <details><summary>${texteHtml('oauth_btp.connexions.aide_google')}</summary><ol class="aide">${texteHtml('oauth_btp.connexions.aide_google_html')}</ol></details>
        <details><summary>${texteHtml('oauth_btp.connexions.aide_microsoft')}</summary><ol class="aide">${texteHtml('oauth_btp.connexions.aide_microsoft_html')}</ol></details>
        <p>${c.peut_modifier ? `<button type="button" data-compte>${iconeHtml('oauth_btp_afficher')} ${texteHtml('oauth_btp.connexions.afficher_compte')}</button> <span data-compte-valeur></span>` : ''}</p>` : ''}
        <h3>${texteHtml('oauth_btp.connexions.journal')}</h3><div data-journal><p class="aide">…</p></div>` : ''}`;
    const combo = creerCombo({ options: this.fournisseurs.map((x) => ({ valeur: x.code, libelle: x.libelle })), valeur: c?.fournisseur ?? f?.code ?? '' });
    combo.readOnly = !admin;
    zone.querySelector('[data-fournisseur]').replaceWith(combo);
    combo.addEventListener('change', () => {
      const p = this.fournisseurs.find((x) => x.code === combo.valeurCombo);
      if (p && !c) zone.querySelector('[data-c="portees"]').value = p.portees;
    });
    const flux = creerCombo({ options: FLUX_OAUTH, valeur: c?.flux ?? 'CODE_PKCE' });
    flux.readOnly = !admin;
    zone.querySelector('[data-flux]').replaceWith(flux);
    // Sans utilisateur : portées par défaut du serveur (Microsoft : .default d'Exchange Online).
    flux.addEventListener('change', () => {
      const p = this.fournisseurs.find((x) => x.code === combo.valeurCombo);
      if (!c) zone.querySelector('[data-c="portees"]').value = flux.valeurCombo === 'CODE_PKCE' ? (p?.portees ?? '') : '';
    });
    const val = (k) => zone.querySelector(`[data-c="${k}"]`);
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      const saisie = {
        code: val('code').value, nom: val('nom').value, fournisseur: combo.valeurCombo, flux: flux.valeurCombo || 'CODE_PKCE',
        portees: val('portees').value, mode_test: val('mode_test').checked,
        droits: liste(val('droits').value), rappels_jours: liste(val('rappels_jours').value).map(Number).filter((n) => n > 0),
      };
      try {
        const r = c ? await api.oauth.modifier(c.id, saisie) : await api.oauth.creer(saisie);
        this.selection = r.id;
        this.app.message(texte('oauth_btp.connexions.enregistree'), 'succes');
        await this.charger();
      } catch (e) { this.app.erreur(e); }
    });
    if (!c) return;
    zone.querySelector('[data-revoquer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('oauth_btp.connexions.confirmer_revoquer', { nom: c.nom }))) return;
      try { await api.oauth.revoquer(c.id); await this.charger(); } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('oauth_btp.connexions.confirmer_supprimer', { nom: c.nom }))) return;
      try { await api.oauth.supprimer(c.id); this.selection = null; zone.innerHTML = ''; await this.charger(); } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-client]')?.addEventListener('click', async () => {
      const k = (n) => zone.querySelector(`[data-k="${n}"]`)?.value.trim() || null;
      try {
        await api.oauth.client(c.id, {
          identifiant_client: k('identifiant_client') ?? '', secret: k('secret'), locataire: k('locataire'),
          secret_expire_le: k('secret_expire_le') ? new Date(`${k('secret_expire_le')}T00:00:00`).toISOString() : null,
          certificat: await lireFichier(zone.querySelector('[data-f="certificat"]'), true), mot_de_passe_certificat: k('mdp_certificat'),
          cle_compte_service: await lireFichier(zone.querySelector('[data-f="cle"]'), false), sujet: k('sujet'),
          url_autorisation: k('url_autorisation'), url_jeton: k('url_jeton'), url_revocation: k('url_revocation'),
        });
        this.app.message(texte('oauth_btp.connexions.client_enregistre'), 'succes');
        await this.charger();
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-compte]')?.addEventListener('click', async () => {
      try { zone.querySelector('[data-compte-valeur]').textContent = (await api.oauth.compte(c.id)).compte ?? texte('oauth_btp.connexions.aucun_compte'); } catch (e) { this.app.erreur(e); }
    });
    api.oauth.journal(c.id).then((j) => {
      const z = zone.querySelector('[data-journal]');
      if (!z) return;
      z.innerHTML = j.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('oauth_btp.connexions.le')}</th><th>${texteHtml('authentification_btp.comptes.evenement')}</th><th>${texteHtml('authentification_btp.comptes.detail')}</th><th>${texteHtml('authentification_btp.comptes.par')}</th></tr></thead><tbody>
        ${j.map((x) => `<tr><td>${formatDateHeure(x.le)}</td><td>${echapper(x.evenement)}</td><td>${echapper(x.detail ?? '')}</td><td>${echapper(x.utilisateur ?? '')}</td></tr>`).join('')}
        </tbody></table>` : `<p class="aide">${texteHtml('oauth_btp.connexions.journal_vide')}</p>`;
    }).catch(() => {});
  }

  rendreParametres() {
    if (!this.admin) return;
    const zone = this.conteneur.querySelector('[data-parametres]');
    zone.innerHTML = `<h2>${texteHtml('oauth_btp.connexions.rappels_titre')}</h2><p class="aide">${texteHtml('oauth_btp.connexions.rappels_aide')}</p>
      <p><input data-rappels value="${echapper((this.parametres.rappels_jours ?? []).join(', '))}" size="14"> <button type="button" data-enregistrer-rappels>${texteHtml('commun.enregistrer')}</button></p>`;
    zone.querySelector('[data-enregistrer-rappels]').addEventListener('click', async () => {
      try {
        const r = await api.oauth.enregistrerParametres({ rappels_jours: liste(zone.querySelector('[data-rappels]').value).map(Number) });
        this.parametres.rappels_jours = r.rappels_jours;
        this.app.message(texte('oauth_btp.connexions.delais'), 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }
}
