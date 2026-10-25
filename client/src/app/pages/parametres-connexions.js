import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';

const ETATS = { A_CONNECTER: 'À connecter', OK: 'Connectée', A_RECONNECTER: 'À reconnecter', DESACTIVEE: 'Désactivée' };
const CLASSES_PASTILLE = { VERT: 'ok', ORANGE: 'attention', ROUGE: 'erreur' };
const date = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const jour = (d) => (d ? String(d).slice(0, 10) : '');
const liste = (texte) => String(texte ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Pastille d'une connexion (état et échéances) : rouge à reconnecter ou à moins de 7 jours, orange à moins de 30. */
/** Flux d'obtention des jetons : par la page du fournisseur (délégué) ou sans utilisateur. */
export const FLUX_OAUTH = [
  { valeur: 'CODE_PKCE', libelle: 'Délégué : connexion à la page du fournisseur' },
  { valeur: 'CLIENT', libelle: 'Application (client credentials, Microsoft)' },
  { valeur: 'COMPTE_SERVICE', libelle: 'Compte de service (Google Workspace)' },
];

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
  return `<span class="pastille-compte ${CLASSES_PASTILLE[c.pastille] ?? 'neutre'}" title="${echapper(c.derniere_erreur ?? '')}">${ETATS[c.etat] ?? c.etat}</span>`;
}

/**
 * Connexions externes OAuth 2.0 (module OAuth, ANALYSE-MODULE-OAUTH.md) : un administrateur crée la connexion et
 * enregistre le client du fournisseur (jamais relu) ; une personne autorisée (droits de la connexion) la connecte
 * ou la reconnecte dans une fenêtre séparée ouverte sur la page du fournisseur. Au retour, le fournisseur renvoie
 * cette page avec `oauth=ok|erreur` : dans la fenêtre d'autorisation, elle prévient les autres fenêtres et se ferme.
 */
export class PageParametresConnexions extends PageBase {
  icone = '🔐';

  urlCourante() { return `/parametres/connexions${this.selection ? `?id=${this.selection}` : ''}`; }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Connexions externes';
    const r = this.requete ?? {};
    // Retour du fournisseur dans la fenêtre d'autorisation : les autres fenêtres sont prévenues, celle-ci se ferme si le
    // navigateur le permet (le lien avec la fenêtre d'origine peut avoir été coupé par la page du fournisseur).
    if (r.oauth) {
      app.publier('oauth', { id: Number(r.id), ok: r.oauth === 'ok', message: r.message ?? '' });
      setTimeout(() => window.close(), 400);
    }
    this.selection = r.id ? Number(r.id) : null;
    this.conteneur.innerHTML = `<div class="page-parametres">
      <div class="entete-page"><h1 class="page-titre">🔐 Connexions externes (OAuth 2.0)</h1><span data-commandes></span></div>
      <p class="aide">Connexions de l'application à des services externes (boîtes Gmail du module Mail…). Les identifiants, les jetons et
        l'adresse du compte sont chiffrés en base ; l'application ne montre que le nom d'usage. Les personnes autorisées sont prévenues
        avant la fin de validité d'une autorisation et quand une connexion est à reconnecter.</p>
      <div data-liste></div><div data-detail></div><div data-parametres></div></div>`;
    if (!app.enLigne) { this.conteneur.querySelector('[data-liste]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    if (r.oauth) app.message(r.message ?? '', r.oauth === 'ok' ? 'succes' : 'erreur');
    this.admin = app.estAdmin();
    this.desabonner = app.abonner('oauth', async (m) => {
      this.app.message(m.message, m.ok ? 'succes' : 'erreur');
      if (!m.ok && /autre compte/.test(m.message) && await confirmer(`${m.message}.\nReconnecter avec le nouveau compte ?`)) this.connecter(m.id, true);
      this.charger();
    });
    [this.fournisseurs, this.parametres] = await Promise.all([api.oauth.fournisseurs(), api.oauth.parametres()]);
    if (this.admin) {
      const cmd = this.conteneur.querySelector('[data-commandes]');
      cmd.innerHTML = `<button type="button" data-nouvelle>＋ Connexion</button>
        <button type="button" data-passer title="Renouveler maintenant les jetons et émettre les rappels dus (tâche de fond)">⟳ Contrôler</button>`;
      cmd.querySelector('[data-nouvelle]').addEventListener('click', () => { this.selection = null; this.rendreDetail(null); });
      cmd.querySelector('[data-passer]').addEventListener('click', async () => {
        try { await api.oauth.passer(); await this.charger(); app.message('Contrôle effectué', 'succes'); } catch (e) { app.erreur(e); }
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
      zone.innerHTML = `<p class="aide">${this.admin ? 'Aucune connexion : ＋ Connexion.' : 'Aucune connexion que vous puissiez reconnecter.'}</p>`;
      return;
    }
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>État</th><th>Nom d'usage</th><th>Code</th><th>Fournisseur</th>
      <th>Autorisation jusqu'au</th><th>Secret du client jusqu'au</th><th>Utilisée par</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${this.connexions.map((c) => `<tr data-id="${c.id}"${c.id === this.selection ? ' class="selection"' : ''}>
        <td>${pastilleConnexion(c)}</td><td>${echapper(c.nom)}${c.mode_test ? ' <span class="aide" title="Application du fournisseur non vérifiée : autorisation courte">(test)</span>' : ''}</td>
        <td>${echapper(c.code)}</td><td>${echapper(c.fournisseur_libelle)}</td>
        <td>${date(c.rafraichissement_expire_le)}</td><td>${date(c.secret_expire_le)}</td>
        <td>${echapper(c.utilisations.join(', '))}</td>
        <td class="cellule-boutons">${c.peut_reconnecter && c.client_configure ? `<button type="button" data-connecter title="${c.flux === 'CODE_PKCE' ? 'Ouvrir la page du fournisseur' : 'Obtenir le jeton directement (sans utilisateur)'}">${c.connectee ? '🔁 Reconnecter' : '🔗 Se connecter'}</button>` : ''}
          ${c.etat === 'OK' ? '<button type="button" data-tester title="Renouveler le jeton maintenant">✓ Tester</button>' : ''}
          <button type="button" data-ouvrir title="Détail">✎</button></td></tr>`).join('')}
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
    try { await api.oauth.connecter(id); this.app.message('Connexion établie', 'succes'); } catch (e) { this.app.erreur(e); }
    await this.charger();
  }

  async tester(id) {
    try { await api.oauth.tester(id); this.app.message('Connexion opérationnelle : jeton renouvelé', 'succes'); } catch (e) { this.app.erreur(e); }
    await this.charger();
  }

  rendreDetail(c) {
    const zone = this.conteneur.querySelector('[data-detail]');
    const admin = this.admin;
    const dis = admin ? '' : 'disabled';
    const f = c ? this.fournisseurs.find((x) => x.code === c.fournisseur) : this.fournisseurs[0];
    zone.innerHTML = `<h2>${c ? `Connexion : ${echapper(c.nom)}` : 'Nouvelle connexion'}</h2>
      <table class="tableau-compact largeur-contenu"><tbody>
        <tr><th>Code</th><td><input data-c="code" value="${echapper(c?.code ?? '')}" size="16" maxlength="30" ${dis}></td></tr>
        <tr><th>Nom d'usage</th><td><input data-c="nom" value="${echapper(c?.nom ?? '')}" size="40" maxlength="100" ${dis} placeholder="ex. Gmail – Service commercial"></td></tr>
        <tr><th>Fournisseur</th><td><span data-fournisseur></span></td></tr>
        <tr><th>Flux</th><td><span data-flux></span></td></tr>
        <tr><th>Portées</th><td><input data-c="portees" value="${echapper(c?.portees ?? f?.portees ?? '')}" size="60" ${dis}></td></tr>
        <tr><th>Application en mode test</th><td><label class="ligne"><input type="checkbox" data-c="mode_test" ${c?.mode_test ?? true ? 'checked' : ''} ${dis}>
          non vérifiée par le fournisseur (Google : autorisation de ${f?.rafraichissement_test_jours ?? 7} jours, reconnexion régulière)</label></td></tr>
        <tr><th>Peuvent reconnecter</th><td><input data-c="droits" value="${echapper((c?.droits ?? []).join(', '))}" size="40" ${dis}
          title="Profils (ex. ADMIN) ou services (service:CODE), séparés par des virgules ; les administrateurs le peuvent toujours"></td></tr>
        <tr><th>Rappels (jours)</th><td><input data-c="rappels_jours" value="${echapper((c?.rappels_jours ?? []).join(', '))}" size="12" ${dis}
          placeholder="${echapper((this.parametres.rappels_jours ?? []).join(', '))}" title="Vide : délais globaux"></td></tr>
      </tbody></table>
      ${admin ? `<div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer</button>
        ${c ? '<button type="button" data-revoquer title="Révoquer chez le fournisseur et désactiver">⛔ Révoquer</button> <button type="button" data-supprimer>✕ Supprimer</button>' : ''}</div>` : ''}
      ${c ? `<h3>Client du fournisseur</h3>
        <p class="aide">${c.client_configure ? 'Client configuré (jamais réaffiché). Ressaisir pour le remplacer ; secret vide = inchangé.' : 'À renseigner avant la première connexion.'}
          Adresse de retour à déclarer chez le fournisseur : <code>${echapper(this.parametres.adresse_retour ?? '')}</code></p>
        ${admin ? `<table class="tableau-compact largeur-contenu"><tbody>
          ${c.flux === 'COMPTE_SERVICE' ? `
          <tr><th>Clé du compte de service</th><td><input type="file" data-f="cle" accept=".json,application/json"> <span class="aide">fichier JSON de la console Google</span></td></tr>
          <tr><th>Boîte déléguée</th><td><input data-k="sujet" size="40" placeholder="adresse de la boîte (délégation sur le domaine)"></td></tr>` : `
          <tr><th>Identifiant du client</th><td><input data-k="identifiant_client" size="50" autocomplete="off"></td></tr>
          <tr><th>Secret du client</th><td><input type="password" data-k="secret" size="30" autocomplete="new-password"></td></tr>
          ${c.flux === 'CLIENT' ? `<tr><th>ou certificat</th><td><input type="file" data-f="certificat" accept=".pfx,.p12"> <input type="password" data-k="mdp_certificat" size="16"
            placeholder="mot de passe" autocomplete="new-password"> <span class="aide">prioritaire sur le secret ; fin de validité lue dans le certificat</span></td></tr>` : ''}
          <tr><th>Locataire</th><td><input data-k="locataire" size="30" placeholder="Microsoft : identifiant de l'annuaire"></td></tr>
          <tr><th>Fin de validité du secret</th><td><input type="date" data-k="secret_expire_le" value="${jour(c.secret_expire_le)}"></td></tr>`}
          ${c.fournisseur === 'GENERIQUE' ? `
          <tr><th>Adresse d'autorisation</th><td><input data-k="url_autorisation" size="60" placeholder="https://…"></td></tr>
          <tr><th>Adresse de jeton</th><td><input data-k="url_jeton" size="60" placeholder="https://…"></td></tr>
          <tr><th>Adresse de révocation</th><td><input data-k="url_revocation" size="60" placeholder="facultative"></td></tr>` : ''}
        </tbody></table><div class="boutons"><button type="button" data-client>Enregistrer le client</button></div>
        <details><summary>Aide : déclarer l'application Google</summary><ol class="aide">
          <li>console.cloud.google.com : créer un projet, activer l'API Gmail ;</li>
          <li>écran de consentement OAuth : type « externe » (Gmail grand public), portée <code>https://mail.google.com/</code>, ajouter les boîtes en utilisateurs de test ;</li>
          <li>identifiants : « ID client OAuth », type « application Web », URI de redirection autorisé = l'adresse de retour ci-dessus ;</li>
          <li>recopier l'identifiant et le secret ici, puis 🔗 Se connecter avec le compte Gmail de la boîte.</li></ol></details>
        <details><summary>Aide : Microsoft 365 (Exchange Online)</summary><ol class="aide">
          <li>entra.microsoft.com : « Inscriptions d'applications », nouvelle application ; locataire = ID de l'annuaire ;</li>
          <li>délégué : URI de redirection Web = l'adresse de retour ci-dessus, autorisations IMAP.AccessAsUser.All et SMTP.Send (Office 365 Exchange Online) ;</li>
          <li>application : autorisations d'application IMAP.AccessAsApp et SMTP.SendAsApp avec consentement de l'administrateur, puis déclarer le principal
            de service dans Exchange (New-ServicePrincipal, Add-MailboxPermission) ; secret ou certificat (le certificat est conseillé) ;</li>
          <li>le compte du module Mail donne l'adresse de la boîte (une même application sert plusieurs boîtes).</li></ol></details>
        <p>${c.peut_modifier ? '<button type="button" data-compte>👁 Afficher le compte connecté</button> <span data-compte-valeur></span>' : ''}</p>` : ''}
        <h3>Journal</h3><div data-journal><p class="aide">…</p></div>` : ''}`;
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
        this.app.message('Connexion enregistrée', 'succes');
        await this.charger();
      } catch (e) { this.app.erreur(e); }
    });
    if (!c) return;
    zone.querySelector('[data-revoquer]')?.addEventListener('click', async () => {
      if (!await confirmer(`Révoquer « ${c.nom} » ? Les modules qui s'en servent ne pourront plus l'utiliser avant une nouvelle connexion.`)) return;
      try { await api.oauth.revoquer(c.id); await this.charger(); } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(`Supprimer « ${c.nom} » ?`)) return;
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
        this.app.message('Client enregistré', 'succes');
        await this.charger();
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-compte]')?.addEventListener('click', async () => {
      try { zone.querySelector('[data-compte-valeur]').textContent = (await api.oauth.compte(c.id)).compte ?? '(aucun)'; } catch (e) { this.app.erreur(e); }
    });
    api.oauth.journal(c.id).then((j) => {
      const z = zone.querySelector('[data-journal]');
      if (!z) return;
      z.innerHTML = j.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Le</th><th>Événement</th><th>Détail</th><th>Par</th></tr></thead><tbody>
        ${j.map((x) => `<tr><td>${date(x.le)}</td><td>${echapper(x.evenement)}</td><td>${echapper(x.detail ?? '')}</td><td>${echapper(x.utilisateur ?? '')}</td></tr>`).join('')}
        </tbody></table>` : '<p class="aide">Vide.</p>';
    }).catch(() => {});
  }

  rendreParametres() {
    if (!this.admin) return;
    const zone = this.conteneur.querySelector('[data-parametres]');
    zone.innerHTML = `<h2>Rappels avant échéance</h2><p class="aide">Délais (jours) avant la fin d'une autorisation ou d'un secret du client,
      pour toutes les connexions sans délais propres.</p>
      <p><input data-rappels value="${echapper((this.parametres.rappels_jours ?? []).join(', '))}" size="14"> <button type="button" data-enregistrer-rappels>Enregistrer</button></p>`;
    zone.querySelector('[data-enregistrer-rappels]').addEventListener('click', async () => {
      try {
        const r = await api.oauth.enregistrerParametres({ rappels_jours: liste(zone.querySelector('[data-rappels]').value).map(Number) });
        this.parametres.rappels_jours = r.rappels_jours;
        this.app.message('Délais enregistrés', 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }
}
