import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { zoneRiche } from '../crm/crm.js';

const HEBERGEURS = [
  { valeur: 'GMAIL', libelle: 'Gmail (grand public)' }, { valeur: 'OVH', libelle: 'Exchange hébergé OVH' }, { valeur: 'AUTRE', libelle: 'Autre hébergeur' },
];
const SECURITES = [{ valeur: 'SSL', libelle: 'SSL / TLS (connexion chiffrée)' }, { valeur: 'STARTTLS', libelle: 'STARTTLS' }];
const AUTHENTIFICATIONS = [{ valeur: 'MOT_DE_PASSE', libelle: 'Mot de passe' }, { valeur: 'OAUTH2', libelle: 'OAuth 2.0 (connexion externe)' }];
// Serveurs proposés à la création d'un compte selon l'hébergeur (champs vides seulement).
const PREREGLAGES = {
  GMAIL: { smtp: { hote: 'smtp.gmail.com', port: 465, securite: 'SSL' }, imap: { hote: 'imap.gmail.com', port: 993, securite: 'SSL' }, authentification: 'OAUTH2' },
  OVH: { smtp: { hote: '', port: 587, securite: 'STARTTLS' }, imap: { hote: '', port: 993, securite: 'SSL' }, authentification: 'MOT_DE_PASSE' },
  AUTRE: { smtp: { hote: '', port: 465, securite: 'SSL' }, imap: { hote: '', port: 993, securite: 'SSL' }, authentification: 'MOT_DE_PASSE' },
};
const LIMITES = [
  ['messages_par_minute', 'Messages par minute'], ['destinataires_par_message', 'Destinataires par courriel'], ['destinataires_par_heure', 'Destinataires par heure'],
  ['destinataires_par_jour', 'Destinataires par jour'], ['messages_par_heure_par_domaine', 'Messages par heure vers un domaine'], ['nouveaux_par_jour', 'Nouveaux destinataires par jour'],
];
const PARAMETRES = [
  ['seuil_envoi_groupe', 'Confirmation au-delà de (destinataires)'], ['seuil_quota_pct', 'Avertissement à (% du quota journalier)'],
  ['seuil_non_remise_pct', 'Suspension au-delà de (% de non-remises sur une heure)'], ['seuil_utilisateur_heure', 'Envois inhabituels : courriels par heure et par utilisateur'],
  ['reserve_prioritaire_pct', 'Réserve des envois prioritaires (% du quota)'], ['taille_max_mo', 'Pièces jointes par courriel (Mo)'], ['journal_mois', 'Conservation du journal (mois)'],
];
const ETATS = { A_VERIFIER: ['À vérifier', 'neutre'], OK: ['Opérationnel', 'ok'], ERREUR: ['En erreur', 'erreur'], SUSPENDU: ['Envois groupés suspendus', 'attention'] };
export const VARIABLES_MODELE = ['numero', 'type', 'document', 'objet', 'date', 'validite', 'montant_ht', 'montant_ttc', 'net_a_payer', 'tiers', 'contact', 'redacteur', 'utilisateur'];

export const pastilleCompteMail = (etat) => {
  const [l, c] = ETATS[etat] ?? [etat, 'neutre'];
  return `<span class="pastille-compte ${c}">${echapper(l)}</span>`;
};
const date = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

/**
 * Messagerie (module Mail, administrateur) : comptes système (adresse et connexion chiffrées, jamais réaffichées :
 * l'application ne montre que les alias), test de connexion, alias, alias par usage, modèles de courriels, limitations
 * et seuils d'avertissement des envois.
 */
export class PageParametresMail extends PageBase {
  icone = '📧';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Messagerie';
    this.conteneur.innerHTML = `<div class="page-parametres">
      <div class="entete-page"><h1 class="page-titre">📧 Messagerie</h1><span><button type="button" data-boite>📬 Suivi des envois</button></span></div>
      <p class="aide">Comptes de messagerie de l'application (adresses de service : commercial@, noreply@…). L'adresse, les serveurs et les
        identifiants sont chiffrés en base ; l'application désigne chaque compte par son alias.</p>
      <h2>Comptes</h2><div data-comptes></div><div data-compte></div>
      <h2>Expéditeur par usage</h2><div data-usages></div>
      <h2>Modèles de courriels</h2><div data-modeles></div>
      <h2>Limitations et avertissements</h2><div data-parametres></div></div>`;
    this.conteneur.querySelector('[data-boite]').addEventListener('click', () => app.naviguer('/mail?vue=envois'));
    if (!app.enLigne || !app.estAdmin()) {
      this.conteneur.querySelector('[data-comptes]').innerHTML = '<p class="aide">Réservé à un administrateur, en ligne.</p>';
      return;
    }
    [this.comptes, this.alias, this.usages, this.modeles, this.parametres, this.connexions] = await Promise.all([
      api.mail.comptes(), api.mail.alias(), api.mail.usages(), api.mail.modeles(), api.mail.parametres(), api.oauth.connexions().catch(() => []),
    ]);
    this.rendreComptes();
    this.rendreUsages();
    this.rendreModeles();
    this.rendreParametres();
  }

  async recharger() {
    [this.comptes, this.alias] = await Promise.all([api.mail.comptes(), api.mail.alias()]);
    this.rendreComptes();
    this.rendreUsages();
  }

  rendreComptes() {
    const zone = this.conteneur.querySelector('[data-comptes]');
    zone.innerHTML = `${this.comptes.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>État</th><th>Alias</th><th>Code</th><th>Envoi</th>
      <th>Réception</th><th>Authentification</th><th>Hébergeur</th><th>Vérifié le</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${this.comptes.map((c) => `<tr data-id="${c.id}"${c.actif ? '' : ' class="discret"'}><td title="${echapper(c.derniere_erreur ?? '')}">${pastilleCompteMail(c.etat)}</td>
        <td>${echapper(c.alias)}${c.autres_alias.length ? ` <span class="aide">(+ ${echapper(c.autres_alias.join(', '))})</span>` : ''}</td><td>${echapper(c.code)}</td>
        <td>${c.envoi ? '✓' : ''}</td><td>${c.reception ? '✓' : ''}</td><td>${c.authentification === 'OAUTH2' ? 'OAuth 2.0' : 'Mot de passe'}</td>
        <td>${echapper(HEBERGEURS.find((h) => h.valeur === c.hebergeur)?.libelle ?? c.hebergeur)}</td><td>${date(c.verifie_le)}</td>
        <td class="cellule-boutons"><button type="button" data-tester title="Se connecter aux serveurs du compte">🔌 Tester</button>
          ${c.etat === 'SUSPENDU' ? '<button type="button" data-reprendre title="Reprendre les envois groupés">▶ Reprendre</button>' : ''}
          <button type="button" data-modifier title="Modifier le compte">✎</button></td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun compte : les envois de courriels sont indisponibles.</p>'}
      <div class="boutons"><button type="button" data-nouveau>＋ Compte</button></div>`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => {
      const c = this.comptes.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-tester]').addEventListener('click', async () => {
        try {
          const r = await api.mail.tester(c.id);
          this.app.message(r.etat === 'ERREUR' ? `Échec : ${r.derniere_erreur}` : 'Connexion réussie', r.etat === 'ERREUR' ? 'erreur' : 'succes');
          await this.recharger();
        } catch (e) { this.app.erreur(e); }
      });
      tr.querySelector('[data-reprendre]')?.addEventListener('click', async () => {
        try { await api.mail.reprendre(c.id); await this.recharger(); } catch (e) { this.app.erreur(e); }
      });
      tr.querySelector('[data-modifier]').addEventListener('click', () => this.rendreCompte(c));
    });
    zone.querySelector('[data-nouveau]').addEventListener('click', () => this.rendreCompte(null));
  }

  rendreCompte(c) {
    const zone = this.conteneur.querySelector('[data-compte]');
    const p = PREREGLAGES[c?.hebergeur ?? 'GMAIL'];
    const smtp = c?.smtp ?? (c ? null : p.smtp);
    const imap = c?.imap ?? (c ? null : p.imap);
    const serveur = (cle, s, info) => `<tr><th>${cle.toUpperCase()}</th><td>
        <input data-${cle}="hote" value="${echapper(s?.hote ?? '')}" size="24" placeholder="hôte (vide : aucun)">
        <input data-${cle}="port" value="${s?.port ?? ''}" size="5" inputmode="numeric" placeholder="port"> <span data-securite-${cle}></span>
        <input data-${cle}="identifiant" size="22" autocomplete="off" placeholder="${info?.identifiant_configure ? 'identifiant inchangé' : 'identifiant (vide : l’adresse)'}">
        <input type="password" data-${cle}="mot_de_passe" size="16" autocomplete="new-password" placeholder="${info?.mot_de_passe_configure ? 'mot de passe inchangé' : 'mot de passe'}"></td></tr>`;
    zone.innerHTML = `<h3>${c ? `Compte ${echapper(c.alias)}` : 'Nouveau compte'}</h3><table><tbody>
      <tr><th>Code</th><td><input data-c="code" value="${echapper(c?.code ?? '')}" size="16" maxlength="30"></td></tr>
      <tr><th>Alias principal</th><td><input data-c="alias" value="${echapper(c?.alias ?? '')}" size="30" maxlength="80" placeholder="ex. Service commercial"></td></tr>
      <tr><th>Adresse</th><td><input data-c="adresse" size="34" autocomplete="off" placeholder="${c ? 'inchangée (jamais réaffichée)' : 'adresse@domaine.fr'}">
        ${c ? '<button type="button" data-afficher title="Afficher l’adresse (journalisé)">👁</button> <span data-adresse></span>' : ''}</td></tr>
      <tr><th>Nom affiché</th><td><input data-c="nom" size="30" placeholder="${c ? 'inchangé' : 'ex. Société Martin – Service commercial'}"></td></tr>
      <tr><th>Hébergeur</th><td><span data-hebergeur></span></td></tr>
      <tr><th>Usages</th><td><label class="ligne"><input type="checkbox" data-c="envoi" ${c?.envoi ?? true ? 'checked' : ''}> envoi (SMTP)</label>
        <label class="ligne"><input type="checkbox" data-c="reception" ${c?.reception ? 'checked' : ''}> réception (IMAP, lot de la relève)</label>
        <label class="ligne"><input type="checkbox" data-c="copie" ${c?.copie_envoyes ?? true ? 'checked' : ''}> copie des envois dans « Envoyés » (IMAP)</label></td></tr>
      <tr><th>Authentification</th><td><span data-auth></span> <span data-oauth></span></td></tr>
      ${serveur('smtp', smtp, c?.smtp)}${serveur('imap', imap, c?.imap)}
      <tr><th>Répondre à</th><td><span data-repondre></span> <span class="aide">indispensable pour un compte « noreply »</span></td></tr>
      <tr><th>Limitations</th><td>${LIMITES.map(([k, l]) => `<label class="ligne">${l} <input data-limite="${k}" size="5" inputmode="numeric"
        value="${c?.limites_saisies?.[k] || ''}" placeholder="${c?.limites?.[k] ?? ''}"></label>`).join(' ')}
        <p class="aide">Vide : valeur par défaut de l'hébergeur (prudente, à vérifier : les quotas des hébergeurs changent).</p></td></tr>
      <tr><th>Services qui voient la boîte</th><td><input data-c="services" value="${echapper((c?.services ?? []).join(', '))}" size="30" placeholder="codes des services (réception)"></td></tr>
      <tr><th>Signature</th><td data-signature></td></tr>
      <tr><th>Actif</th><td><input type="checkbox" data-c="actif" ${c?.actif ?? true ? 'checked' : ''}></td></tr>
    </tbody></table>
    <div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer le compte</button>
      ${c ? '<button type="button" data-supprimer>✕ Supprimer</button>' : ''} <button type="button" data-fermer>Fermer</button></div>
    ${c ? '<h3>Alias du compte</h3><div data-alias></div>' : ''}`;
    const val = (k) => zone.querySelector(`[data-c="${k}"]`);
    const hebergeur = creerCombo({ options: HEBERGEURS, valeur: c?.hebergeur ?? 'GMAIL' });
    zone.querySelector('[data-hebergeur]').replaceWith(hebergeur);
    const auth = creerCombo({ options: AUTHENTIFICATIONS, valeur: c?.authentification ?? p.authentification });
    zone.querySelector('[data-auth]').replaceWith(auth);
    const oauth = creerCombo({ options: this.connexions.map((x) => ({ valeur: x.id, libelle: x.nom, detail: x.etat })), valeur: c?.oco_id ?? '', vide: true });
    zone.querySelector('[data-oauth]').replaceWith(oauth);
    const securites = {};
    for (const cle of ['smtp', 'imap']) {
      securites[cle] = creerCombo({ options: SECURITES, valeur: (cle === 'smtp' ? smtp : imap)?.securite ?? 'SSL' });
      zone.querySelector(`[data-securite-${cle}]`).replaceWith(securites[cle]);
    }
    const repondre = creerCombo({ options: this.comptes.filter((x) => x.id !== c?.id).map((x) => ({ valeur: x.id, libelle: x.alias })), valeur: c?.repondre_a_id ?? '', vide: true });
    zone.querySelector('[data-repondre]').replaceWith(repondre);
    const signature = zoneRiche(c?.signature_html ?? '');
    zone.querySelector('[data-signature]').append(signature.element);
    const majOauth = () => { oauth.hidden = auth.valeurCombo !== 'OAUTH2'; zone.querySelectorAll('[data-smtp="mot_de_passe"], [data-imap="mot_de_passe"]').forEach((x) => { x.hidden = auth.valeurCombo === 'OAUTH2'; }); };
    auth.addEventListener('change', majOauth);
    majOauth();
    hebergeur.addEventListener('change', () => {
      if (c) return;
      const pr = PREREGLAGES[hebergeur.valeurCombo];
      if (!pr) return;
      for (const cle of ['smtp', 'imap']) {
        zone.querySelector(`[data-${cle}="hote"]`).value = pr[cle].hote;
        zone.querySelector(`[data-${cle}="port"]`).value = pr[cle].port;
        securites[cle].definirValeur(pr[cle].securite);
      }
      auth.definirValeur(pr.authentification);
      majOauth();
    });
    const lireServeur = (cle) => {
      const v = (k) => zone.querySelector(`[data-${cle}="${k}"]`).value.trim();
      return { hote: v('hote'), port: Number(v('port')) || 0, securite: securites[cle].valeurCombo, identifiant: v('identifiant') || null, mot_de_passe: v('mot_de_passe') || null };
    };
    zone.querySelector('[data-afficher]')?.addEventListener('click', async () => {
      try { const a = await api.mail.adresse(c.id); zone.querySelector('[data-adresse]').textContent = `${a.adresse}${a.nom_affiche ? ` (${a.nom_affiche})` : ''}`; } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-fermer]').addEventListener('click', () => { zone.innerHTML = ''; });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!confirm(`Supprimer le compte « ${c.alias} » ?`)) return;
      try { await api.mail.supprimerCompte(c.id); zone.innerHTML = ''; await this.recharger(); } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const limites = Object.fromEntries(LIMITES.map(([k]) => [k, Number(zone.querySelector(`[data-limite="${k}"]`).value) || 0]));
      const saisie = {
        code: val('code').value, adresse: val('adresse').value.trim() || null, nom_affiche: val('nom').value.trim() || null, envoi: val('envoi').checked,
        reception: val('reception').checked, authentification: auth.valeurCombo, oco_id: auth.valeurCombo === 'OAUTH2' ? Number(oauth.valeurCombo) || null : null,
        smtp: lireServeur('smtp'), imap: lireServeur('imap'), repondre_a_id: Number(repondre.valeurCombo) || null, signature_html: signature.valeur(),
        hebergeur: hebergeur.valeurCombo, limites, copie_envoyes: val('copie').checked,
        services: val('services').value.split(',').map((x) => x.trim()).filter(Boolean), actif: val('actif').checked, alias_principal: val('alias').value.trim() || null,
      };
      try {
        const r = c ? await api.mail.modifierCompte(c.id, saisie) : await api.mail.creerCompte(saisie);
        this.app.message('Compte enregistré : « 🔌 Tester » pour vérifier la connexion', 'succes');
        await this.recharger();
        this.rendreCompte(this.comptes.find((x) => x.id === r.id));
      } catch (e) { this.app.erreur(e); }
    });
    if (c) this.rendreAlias(c, zone.querySelector('[data-alias]'));
  }

  rendreAlias(c, zone) {
    const liste = this.alias.filter((a) => a.compte_id === c.id).map((a) => ({ ...a }));
    const rendre = () => {
      zone.innerHTML = `<p class="aide">Noms du compte dans l'application (expéditeur proposé à l'envoi) ; un principal.</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Nom</th><th>Principal</th><th>Actif</th><th class="cellule-boutons"></th></tr></thead><tbody>
        ${liste.map((a, i) => `<tr data-i="${i}"><td><input data-k="nom" value="${echapper(a.nom)}" size="30" maxlength="80"></td>
          <td><input type="radio" name="alias-principal" data-k="principal" ${a.principal ? 'checked' : ''}></td>
          <td><input type="checkbox" data-k="actif" ${a.actif ? 'checked' : ''}></td><td class="cellule-boutons"><button type="button" data-retirer>✕</button></td></tr>`).join('')}
        </tbody></table><div class="boutons"><button type="button" data-ajouter>＋ Alias</button> <button type="button" data-enregistrer-alias>Enregistrer les alias</button></div>`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const a = liste[Number(tr.dataset.i)];
        tr.querySelector('[data-k="nom"]').addEventListener('input', (e) => { a.nom = e.target.value; });
        tr.querySelector('[data-k="principal"]').addEventListener('change', () => liste.forEach((x) => { x.principal = x === a; }));
        tr.querySelector('[data-k="actif"]').addEventListener('change', (e) => { a.actif = e.target.checked; });
        tr.querySelector('[data-retirer]').addEventListener('click', () => { liste.splice(liste.indexOf(a), 1); rendre(); });
      });
      zone.querySelector('[data-ajouter]').addEventListener('click', () => { liste.push({ id: 0, nom: '', principal: liste.length === 0, actif: true, compte_id: c.id }); rendre(); });
      zone.querySelector('[data-enregistrer-alias]').addEventListener('click', async () => {
        try {
          await api.mail.enregistrerAlias(c.id, liste.map((a) => ({ id: a.id ?? 0, nom: a.nom, compte_id: c.id, principal: a.principal, actif: a.actif, envoi: true, compte_actif: true })));
          this.app.message('Alias enregistrés', 'succes');
          await this.recharger();
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  rendreUsages() {
    const zone = this.conteneur.querySelector('[data-usages]');
    const options = this.alias.filter((a) => a.actif && a.envoi).map((a) => ({ valeur: a.id, libelle: a.nom }));
    const lignes = this.usages.usages.map((u) => ({ ...u }));
    const rendre = () => {
      zone.innerHTML = `<p class="aide">Alias proposé comme expéditeur selon l'usage ; une portée « type:CODE » (type de document) précise l'usage.
        Sans alias pour un usage, l'alias de « Autres envois », sinon le premier alias principal.</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Usage</th><th>Portée</th><th>Alias</th><th class="cellule-boutons"></th></tr></thead><tbody>
        ${lignes.map((l, i) => `<tr data-i="${i}"><td><span data-usage></span></td><td><input data-portee value="${echapper(l.portee ?? '')}" size="16" placeholder="(défaut)"></td>
          <td><span data-alias></span></td><td class="cellule-boutons"><button type="button" data-retirer>✕</button></td></tr>`).join('')}
        </tbody></table><div class="boutons"><button type="button" data-ajouter>＋ Usage</button> <button type="button" data-enregistrer-usages>Enregistrer les usages</button></div>`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const l = lignes[Number(tr.dataset.i)];
        const u = creerCombo({ options: this.usages.connus.map((x) => ({ valeur: x.code, libelle: x.libelle })), valeur: l.usage });
        u.addEventListener('change', () => { l.usage = u.valeurCombo; });
        tr.querySelector('[data-usage]').replaceWith(u);
        const a = creerCombo({ options, valeur: l.alias_id ?? '' });
        a.addEventListener('change', () => { l.alias_id = Number(a.valeurCombo); });
        tr.querySelector('[data-alias]').replaceWith(a);
        tr.querySelector('[data-portee]').addEventListener('input', (e) => { l.portee = e.target.value.trim(); });
        tr.querySelector('[data-retirer]').addEventListener('click', () => { lignes.splice(lignes.indexOf(l), 1); rendre(); });
      });
      zone.querySelector('[data-ajouter]').addEventListener('click', () => { lignes.push({ usage: 'GENERAL', portee: '', alias_id: options[0]?.valeur }); rendre(); });
      zone.querySelector('[data-enregistrer-usages]').addEventListener('click', async () => {
        try { this.usages.usages = await api.mail.enregistrerUsages(lignes); this.app.message('Usages enregistrés', 'succes'); } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  rendreModeles(selection = null) {
    const zone = this.conteneur.querySelector('[data-modeles]');
    const libelleUsage = (code) => this.usages.connus.find((x) => x.code === code)?.libelle ?? code;
    zone.innerHTML = `<p class="aide">Objet et corps proposés à la rédaction selon l'usage et le type de document. Variables :
      ${VARIABLES_MODELE.map((v) => `<code>{{${v}}}</code>`).join(' ')}.</p>
      ${this.modeles.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Usage</th><th>Type</th><th>Défaut</th><th>Actif</th>
        <th class="cellule-boutons"></th></tr></thead><tbody>${this.modeles.map((m) => `<tr data-id="${m.id}"><td>${echapper(m.code)}</td><td>${echapper(m.libelle)}</td>
        <td>${echapper(libelleUsage(m.usage))}</td><td>${echapper(m.type || '(tous)')}</td><td>${m.defaut ? '✓' : ''}</td><td>${m.actif ? '✓' : ''}</td>
        <td class="cellule-boutons"><button type="button" data-modifier>✎</button></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="boutons"><button type="button" data-nouveau>＋ Modèle</button></div><div data-modele></div>`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => tr.querySelector('[data-modifier]').addEventListener('click', () =>
      this.rendreModele(this.modeles.find((m) => m.id === Number(tr.dataset.id)))));
    zone.querySelector('[data-nouveau]').addEventListener('click', () => this.rendreModele(null));
    if (selection) this.rendreModele(selection);
  }

  rendreModele(m) {
    const zone = this.conteneur.querySelector('[data-modele]');
    zone.innerHTML = `<table><tbody>
      <tr><th>Code</th><td><input data-m="code" value="${echapper(m?.code ?? '')}" size="16" maxlength="30"></td></tr>
      <tr><th>Libellé</th><td><input data-m="libelle" value="${echapper(m?.libelle ?? '')}" size="40"></td></tr>
      <tr><th>Usage</th><td><span data-usage></span></td></tr>
      <tr><th>Type de document</th><td><input data-m="type" value="${echapper(m?.type ?? '')}" size="16" placeholder="(tous) ex. V_DEVIS"></td></tr>
      <tr><th>Objet</th><td><input data-m="objet" value="${echapper(m?.objet ?? '')}" size="60" placeholder="{{type}} {{numero}} – {{objet}}"></td></tr>
      <tr><th>Corps</th><td data-corps></td></tr>
      <tr><th>Options</th><td><label class="ligne"><input type="checkbox" data-m="defaut" ${m?.defaut ? 'checked' : ''}> modèle par défaut</label>
        <label class="ligne"><input type="checkbox" data-m="actif" ${m?.actif ?? true ? 'checked' : ''}> actif</label></td></tr></tbody></table>
      <div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer le modèle</button>
        ${m ? '<button type="button" data-supprimer>✕ Supprimer</button>' : ''}</div>`;
    const usage = creerCombo({ options: this.usages.connus.map((x) => ({ valeur: x.code, libelle: x.libelle })), valeur: m?.usage ?? 'DOCUMENT_VENTE' });
    zone.querySelector('[data-usage]').replaceWith(usage);
    const corps = zoneRiche(m?.corps_html ?? '<p>Bonjour,</p><p>Veuillez trouver ci-joint {{document}}.</p><p>Cordialement,</p>');
    zone.querySelector('[data-corps]').append(corps.element);
    const v = (k) => zone.querySelector(`[data-m="${k}"]`);
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.modeles = await api.mail.enregistrerModele({
          id: m?.id ?? 0, code: v('code').value, libelle: v('libelle').value, usage: usage.valeurCombo, type: v('type').value.trim(), objet: v('objet').value,
          corps_html: corps.valeur() ?? '', defaut: v('defaut').checked, actif: v('actif').checked,
        });
        this.app.message('Modèle enregistré', 'succes');
        this.rendreModeles();
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!confirm(`Supprimer le modèle « ${m.libelle} » ?`)) return;
      try { this.modeles = await api.mail.supprimerModele(m.id); this.rendreModeles(); } catch (e) { this.app.erreur(e); }
    });
  }

  rendreParametres() {
    const zone = this.conteneur.querySelector('[data-parametres]');
    zone.innerHTML = `<p class="aide">Les limitations de chaque compte se règlent dans le compte ; une limite atteinte met les courriels en attente,
      jamais en échec. Au-delà des seuils, l'envoi demande une confirmation ou prévient les administrateurs.</p><table><tbody>
      ${PARAMETRES.map(([k, l]) => `<tr><th>${l}</th><td><input data-p="${k}" value="${this.parametres[k] ?? ''}" size="6" inputmode="numeric"></td></tr>`).join('')}
      </tbody></table><div class="boutons"><button type="button" data-enregistrer-parametres>Enregistrer</button></div>`;
    zone.querySelector('[data-enregistrer-parametres]').addEventListener('click', async () => {
      const p = Object.fromEntries(PARAMETRES.map(([k]) => [k, Number(zone.querySelector(`[data-p="${k}"]`).value) || 0]));
      try { this.parametres = await api.mail.enregistrerParametres(p); this.app.message('Paramètres enregistrés', 'succes'); } catch (e) { this.app.erreur(e); }
    });
  }
}
