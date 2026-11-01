import { texte, texteHtml, icone, iconeHtml, pairesParCode } from '@logibtp/socle/dictionnaire';
import { pastilleTable } from '../pastilles.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { zoneRiche } from '../crm/crm.js';
import { reconnaitre, NATURES, ACTIONS, ZONES } from '@logibtp/mail';

const HEBERGEURS = pairesParCode('mail_btp.hebergeurs', ['GMAIL', 'OVH', 'AUTRE']).map(([valeur, libelle]) => ({ valeur, libelle }));
const SECURITES = pairesParCode('mail_btp.securites', ['SSL', 'STARTTLS']).map(([valeur, libelle]) => ({ valeur, libelle }));
const AUTHENTIFICATIONS = pairesParCode('mail_btp.authentifications', ['MOT_DE_PASSE', 'OAUTH2']).map(([valeur, libelle]) => ({ valeur, libelle }));
// Serveurs proposés à la création d'un compte selon l'hébergeur (champs vides seulement).
const PREREGLAGES = {
  GMAIL: { smtp: { hote: 'smtp.gmail.com', port: 465, securite: 'SSL' }, imap: { hote: 'imap.gmail.com', port: 993, securite: 'SSL' }, authentification: 'OAUTH2' },
  OVH: { smtp: { hote: '', port: 587, securite: 'STARTTLS' }, imap: { hote: '', port: 993, securite: 'SSL' }, authentification: 'MOT_DE_PASSE' },
  AUTRE: { smtp: { hote: '', port: 465, securite: 'SSL' }, imap: { hote: '', port: 993, securite: 'SSL' }, authentification: 'MOT_DE_PASSE' },
};
const LIMITES = pairesParCode('mail_btp.limites', ['messages_par_minute', 'destinataires_par_message', 'destinataires_par_heure', 'destinataires_par_jour', 'messages_par_heure_par_domaine', 'nouveaux_par_jour']);
const PARAMETRES = pairesParCode('mail_btp.reglages', [
  'seuil_envoi_groupe', 'seuil_quota_pct', 'seuil_non_remise_pct', 'seuil_utilisateur_heure', 'reserve_prioritaire_pct', 'taille_max_mo', 'journal_mois', 'conservation_non_rapproches_jours', 'premiere_releve_jours', 'taille_reception_mo', 'seuil_haut', 'seuil_bas',
]);
const APRES_RATTACHEMENT = pairesParCode('mail_btp.apres_rattachement', ['RIEN', 'DEPLACER', 'RETIRER_DRAPEAU']).map(([valeur, libelle]) => ({ valeur, libelle }));
const CLASSES_ETATS = { A_VERIFIER: 'neutre', OK: 'ok', ERREUR: 'erreur', SUSPENDU: 'attention' };
const ETATS = Object.fromEntries(pairesParCode('mail_btp.etats_compte', Object.keys(CLASSES_ETATS)).map(([code, libelle]) => [code, [libelle, CLASSES_ETATS[code]]]));
export const VARIABLES_MODELE = ['numero', 'type', 'document', 'objet', 'date', 'validite', 'montant_ht', 'montant_ttc', 'net_a_payer', 'tiers', 'contact', 'redacteur', 'utilisateur',
  'pieces_manquantes', 'pieces_a_renouveler'];

export const pastilleCompteMail = (etat) => pastilleTable(ETATS, etat);

/**
 * Messagerie (module Mail, administrateur) : comptes système (adresse et connexion chiffrées, jamais réaffichées :
 * l'application ne montre que les alias), test de connexion, alias, alias par usage, modèles de courriels, limitations
 * et seuils d'avertissement des envois.
 */
export class PageParametresMail extends PageBase {
  icone = icone('mail_btp_parametres_page');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('mail_btp.routes.parametres');
    this.conteneur.innerHTML = `<div class="page-parametres">
      <div class="entete-page"><h1 class="page-titre">${iconeHtml('mail_btp_parametres_page')} ${texteHtml('mail_btp.routes.parametres')}</h1><span><button type="button" data-boite>${iconeHtml('mail_btp_boite')} ${texteHtml('mail_btp.vues.envois')}</button></span></div>
      <p class="aide">${texteHtml('mail_btp.parametres.aide')}</p>
      <h2>${texteHtml('mail_btp.suivi.comptes')}</h2><div data-comptes></div><div data-compte></div>
      <h2>${texteHtml('mail_btp.parametres.usages')}</h2><div data-usages></div>
      <h2>${texteHtml('mail_btp.parametres.modeles')}</h2><div data-modeles></div>
      <h2>${texteHtml('mail_btp.parametres.reconnaissance')}</h2><div data-regles></div>
      <h2>${texteHtml('mail_btp.parametres.limitations')}</h2><div data-parametres></div></div>`;
    this.conteneur.querySelector('[data-boite]').addEventListener('click', () => app.naviguer('/mail?vue=envois'));
    if (!app.estAdmin()) {
      this.conteneur.querySelector('[data-comptes]').innerHTML = `<p class="aide">${texteHtml('mail_btp.parametres.reserve')}</p>`;
      return;
    }
    [this.comptes, this.alias, this.usages, this.modeles, this.parametres, this.connexions] = await Promise.all([
      api.mail.comptes(), api.mail.alias(), api.mail.usages(), api.mail.modeles(), api.mail.parametres(), api.oauth.connexions().catch(() => []),
    ]);
    this.rendreComptes();
    this.rendreUsages();
    this.rendreModeles();
    this.rendreParametres();
    this.regles = await api.mail.regles();
    this.rendreRegles();
  }

  /**
   * Règles de reconnaissance (nature, mots, zones, expéditeur, service, action, ordre) et essai sur un texte saisi par la
   * même règle que le serveur (`reconnaitre` de @logibtp/mail : nature et décision, sans candidats).
   */
  rendreRegles() {
    const zone = this.conteneur.querySelector('[data-regles]');
    const l = this.regles.map((r) => ({ ...r }));
    const rendre = () => {
      zone.innerHTML = `<p class="aide">${texteHtml('mail_btp.parametres.regles_aide')}</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('mail_btp.parametres.ordre')}</th><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('mail_btp.parametres.nature')}</th><th>${texteHtml('mail_btp.parametres.mots')}</th><th>${texteHtml('mail_btp.parametres.zones')}</th>
          <th>${texteHtml('mail_btp.parametres.expediteur')}</th><th>${texteHtml('mail_btp.parametres.service')}</th><th>${texteHtml('mail_btp.parametres.action')}</th><th>${texteHtml('mail_btp.parametres.actif')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
        ${l.map((r, i) => `<tr data-i="${i}"><td><input data-r="ordre" value="${r.ordre}" size="3"></td><td><input data-r="code" value="${echapper(r.code)}" size="8"></td>
          <td><input data-r="libelle" value="${echapper(r.libelle)}" size="20"></td><td><span data-nature></span></td>
          <td><input data-r="mots" value="${echapper(r.mots.join('; '))}" size="32"></td><td><input data-r="dans" value="${echapper(r.dans.join(', '))}" size="12" placeholder="${texteHtml('mail_btp.parametres.zones_toutes')}"></td>
          <td><input data-r="expediteur" value="${echapper(r.expediteur ?? '')}" size="16"></td><td><input data-r="service" value="${echapper(r.service ?? '')}" size="8"></td>
          <td><span data-action></span></td><td><input type="checkbox" data-r="actif" ${r.actif ? 'checked' : ''}></td>
          <td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>
        <div class="boutons"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('mail_btp.parametres.regle')}</button> <button type="button" class="principal" data-enregistrer-regles>${texteHtml('mail_btp.parametres.enregistrer_regles')}</button></div>
        <h3>${texteHtml('mail_btp.parametres.essai')}</h3><p class="ligne"><input data-essai="de" size="24" placeholder="${texteHtml('mail_btp.parametres.essai_de')}"> <input data-essai="objet" size="40" placeholder="${texteHtml('mail_btp.parametres.essai_objet')}">
          <input data-essai="texte" size="40" placeholder="${texteHtml('mail_btp.parametres.essai_texte')}"> <button type="button" data-essayer>${texteHtml('mail_btp.parametres.essayer')}</button> <span data-resultat-essai></span></p>`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const r = l[Number(tr.dataset.i)];
        const nature = creerCombo({ options: NATURES.map((n) => ({ valeur: n, libelle: n })), valeur: r.nature });
        nature.addEventListener('change', () => { r.nature = nature.valeurCombo; });
        tr.querySelector('[data-nature]').replaceWith(nature);
        const action = creerCombo({ options: ACTIONS.map((a) => ({ valeur: a, libelle: a })), valeur: r.action });
        action.addEventListener('change', () => { r.action = action.valeurCombo; });
        tr.querySelector('[data-action]').replaceWith(action);
        tr.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('change', () => {
          const k = x.dataset.r;
          if (k === 'actif') r.actif = x.checked;
          else if (k === 'ordre') r.ordre = Number(x.value) || 0;
          else if (k === 'mots') r.mots = x.value.split(';').map((m) => m.trim()).filter(Boolean);
          else if (k === 'dans') r.dans = x.value.split(',').map((m) => m.trim().toLowerCase()).filter((m) => ZONES.includes(m));
          else r[k] = x.value.trim() || null;
        }));
        tr.querySelector('[data-retirer]').addEventListener('click', () => { l.splice(l.indexOf(r), 1); rendre(); });
      });
      zone.querySelector('[data-ajouter]').addEventListener('click', () => {
        l.push({ id: 0, code: '', libelle: '', nature: 'AUTRE', mots: [], dans: [], expediteur: null, service: null, compte: null, action: 'ALERTER', ordre: (l.length + 1) * 10, actif: true });
        rendre();
      });
      zone.querySelector('[data-enregistrer-regles]').addEventListener('click', async () => {
        try { this.regles = await api.mail.enregistrerRegles(l); this.app.message(texte('mail_btp.parametres.regles_enregistrees'), 'succes'); this.rendreRegles(); } catch (e) { this.app.erreur(e); }
      });
      zone.querySelector('[data-essayer]').addEventListener('click', () => {
        const e = (k) => zone.querySelector(`[data-essai="${k}"]`).value;
        const r = reconnaitre({ objet: e('objet'), texte: e('texte'), pieces: [], texte_pieces: '', de: e('de'), fil: [], candidats: [], expediteur_tiers: [], tiers: [], automatique: false },
          l.filter((x) => x.actif), { haut: this.parametres.seuil_haut ?? 80, bas: this.parametres.seuil_bas ?? 40 });
        zone.querySelector('[data-resultat-essai]').textContent = r.regle ? [
          texte('mail_btp.parametres.essai_regle', { regle: r.regle, nature: r.nature }),
          ...(r.service ? [texte('mail_btp.parametres.essai_service', { service: r.service })] : []),
          ...(r.decision === 'IGNORE' ? [texte('mail_btp.parametres.essai_ignore')] : []),
        ].join(', ') : texte('mail_btp.parametres.essai_aucune');
      });
    };
    rendre();
  }

  async recharger() {
    [this.comptes, this.alias] = await Promise.all([api.mail.comptes(), api.mail.alias()]);
    this.rendreComptes();
    this.rendreUsages();
  }

  rendreComptes() {
    const zone = this.conteneur.querySelector('[data-comptes]');
    zone.innerHTML = `${this.comptes.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('mail_btp.champs.etat')}</th><th>${texteHtml('mail_btp.parametres.alias')}</th><th>${texteHtml('commun.code')}</th><th>${texteHtml('mail_btp.parametres.envoi')}</th>
      <th>${texteHtml('mail_btp.parametres.reception')}</th><th>${texteHtml('mail_btp.parametres.authentification')}</th><th>${texteHtml('mail_btp.parametres.hebergeur')}</th><th>${texteHtml('mail_btp.parametres.verifie_le')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${this.comptes.map((c) => `<tr data-id="${c.id}"${c.actif ? '' : ' class="discret"'}><td title="${echapper(c.derniere_erreur ?? '')}">${pastilleCompteMail(c.etat)}</td>
        <td>${echapper(c.alias)}${c.autres_alias.length ? ` <span class="aide">(+ ${echapper(c.autres_alias.join(', '))})</span>` : ''}</td><td>${echapper(c.code)}</td>
        <td>${c.envoi ? iconeHtml('mail_btp_valider') : ''}</td><td>${c.reception ? iconeHtml('mail_btp_valider') : ''}</td><td>${c.authentification === 'OAUTH2' ? texteHtml('mail_btp.parametres.oauth') : texteHtml('mail_btp.authentifications.MOT_DE_PASSE')}</td>
        <td>${echapper(HEBERGEURS.find((h) => h.valeur === c.hebergeur)?.libelle ?? c.hebergeur)}</td><td>${formatDateHeure(c.verifie_le)}</td>
        <td class="cellule-boutons"><button type="button" data-tester title="${texteHtml('mail_btp.parametres.tester_titre')}">${iconeHtml('mail_btp_tester')} ${texteHtml('mail_btp.parametres.tester')}</button>
          ${c.etat === 'SUSPENDU' ? `<button type="button" data-reprendre title="${texteHtml('mail_btp.parametres.reprendre_titre')}">${iconeHtml('mail_btp_reprendre')} ${texteHtml('mail_btp.suivi.reprendre')}</button>` : ''}
          <button type="button" data-modifier title="${texteHtml('mail_btp.parametres.modifier_compte')}">${iconeHtml('mail_btp_modifier')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="aide">${texteHtml('mail_btp.parametres.aucun_compte')}</p>`}
      <div class="boutons"><button type="button" data-nouveau>${iconeHtml('ajouter')} ${texteHtml('mail_btp.suivi.compte')}</button></div>`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => {
      const c = this.comptes.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-tester]').addEventListener('click', async () => {
        try {
          const r = await api.mail.tester(c.id);
          this.app.message(r.etat === 'ERREUR' ? texte('mail_btp.parametres.echec', { erreur: r.derniere_erreur }) : texte('mail_btp.parametres.connexion_ok'), r.etat === 'ERREUR' ? 'erreur' : 'succes');
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
        <input data-${cle}="hote" value="${echapper(s?.hote ?? '')}" size="24" placeholder="${texteHtml('mail_btp.parametres.hote')}">
        <input data-${cle}="port" value="${s?.port ?? ''}" size="5" inputmode="numeric" placeholder="${texteHtml('mail_btp.parametres.port')}"> <span data-securite-${cle}></span>
        <input data-${cle}="identifiant" size="22" autocomplete="off" placeholder="${info?.identifiant_configure ? texteHtml('mail_btp.parametres.identifiant_inchange') : texteHtml('mail_btp.parametres.identifiant')}">
        <input type="password" data-${cle}="mot_de_passe" size="16" autocomplete="new-password" placeholder="${info?.mot_de_passe_configure ? texteHtml('mail_btp.parametres.mdp_inchange') : texteHtml('mail_btp.parametres.mdp')}"></td></tr>`;
    zone.innerHTML = `<h3>${c ? texteHtml('mail_btp.parametres.compte_titre', { alias: c.alias }) : texteHtml('mail_btp.parametres.nouveau_compte')}</h3><table class="tableau-compact largeur-contenu"><tbody>
      <tr><th>${texteHtml('commun.code')}</th><td><input data-c="code" value="${echapper(c?.code ?? '')}" size="16" maxlength="30"></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.alias_principal')}</th><td><input data-c="alias" value="${echapper(c?.alias ?? '')}" size="30" maxlength="80" placeholder="${texteHtml('mail_btp.parametres.alias_aide')}"></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.adresse')}</th><td><input data-c="adresse" size="34" autocomplete="off" placeholder="${c ? texteHtml('mail_btp.parametres.adresse_inchangee') : texteHtml('mail_btp.parametres.adresse_aide')}">
        ${c ? `<button type="button" data-afficher title="${texteHtml('mail_btp.parametres.afficher_adresse')}">${iconeHtml('mail_btp_afficher')}</button> <span data-adresse></span>` : ''}</td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.nom_affiche')}</th><td><input data-c="nom" size="30" placeholder="${c ? texteHtml('mail_btp.parametres.inchange') : texteHtml('mail_btp.parametres.nom_aide')}"></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.hebergeur')}</th><td><span data-hebergeur></span></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.usages_compte')}</th><td><label class="ligne"><input type="checkbox" data-c="envoi" ${c?.envoi ?? true ? 'checked' : ''}> ${texteHtml('mail_btp.parametres.envoi_smtp')}</label>
        <label class="ligne"><input type="checkbox" data-c="reception" ${c?.reception ? 'checked' : ''}> ${texteHtml('mail_btp.parametres.reception_imap')}</label>
        <label class="ligne"><input type="checkbox" data-c="copie" ${c?.copie_envoyes ?? true ? 'checked' : ''}> ${texteHtml('mail_btp.parametres.copie_envoyes')}</label></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.authentification')}</th><td><span data-auth></span> <span data-oauth></span></td></tr>
      ${serveur('smtp', smtp, c?.smtp)}${serveur('imap', imap, c?.imap)}
      <tr><th>${texteHtml('mail_btp.parametres.repondre_a')}</th><td><span data-repondre></span> <span class="aide">${texteHtml('mail_btp.parametres.repondre_aide')}</span></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.limites')}</th><td>${LIMITES.map(([k, l]) => `<label class="ligne">${echapper(l)} <input data-limite="${k}" size="5" inputmode="numeric"
        value="${c?.limites_saisies?.[k] || ''}" placeholder="${c?.limites?.[k] ?? ''}"></label>`).join(' ')}
        <p class="aide">${texteHtml('mail_btp.parametres.limites_aide')}</p></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.reception')}</th><td>
        <label class="ligne">${texteHtml('mail_btp.parametres.releve')} <input data-o="intervalle_minutes" size="4" inputmode="numeric" value="${c?.options?.intervalle_minutes ?? 60}"> ${texteHtml('mail_btp.parametres.minutes')}</label>
        <label class="ligne"><input type="checkbox" data-o="marquer_lus" ${c?.options?.marquer_lus ? 'checked' : ''}> ${texteHtml('mail_btp.parametres.marquer_lus')}</label>
        <label class="ligne"><input type="checkbox" data-o="drapeau_a_suivre" ${c?.options?.drapeau_a_suivre ? 'checked' : ''}> ${texteHtml('mail_btp.parametres.drapeau')}</label><br>
        <label class="ligne">${texteHtml('mail_btp.parametres.apres')} <span data-apres></span></label>
        <label class="ligne">${texteHtml('mail_btp.parametres.dossier')} <input data-o="dossier_traites" size="20" value="${echapper(c?.options?.dossier_traites ?? 'LogiBTP/Traités')}"></label><br>
        <label class="ligne">${texteHtml('mail_btp.parametres.dossiers')} <input data-dossiers size="50" value="${echapper((c?.dossiers ?? [{ nom: 'INBOX', role: 'RECEPTION' }]).map((d) => `${d.nom}=${d.role}`).join('; '))}"></label>
        <p class="aide">${texteHtml('mail_btp.parametres.dossiers_aide')}
          ${c?.releve_le ? `${texteHtml('mail_btp.parametres.derniere_releve', { date: formatDateHeure(c.releve_le) })}${c.releve_erreur ? ` — <span class="erreur">${echapper(c.releve_erreur)}</span>` : ''}` : ''}</p></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.services')}</th><td><input data-c="services" value="${echapper((c?.services ?? []).join(', '))}" size="30" placeholder="${texteHtml('mail_btp.parametres.services_aide')}"></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.signature')}</th><td data-signature></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.actif')}</th><td><input type="checkbox" data-c="actif" ${c?.actif ?? true ? 'checked' : ''}></td></tr>
    </tbody></table>
    <div class="boutons"><button type="button" class="principal" data-enregistrer>${texteHtml('mail_btp.parametres.enregistrer_compte')}</button>
      ${c ? `<button type="button" data-supprimer>${iconeHtml('retirer')} ${texteHtml('commun.supprimer')}</button>` : ''} <button type="button" data-fermer>${texteHtml('commun.fermer')}</button></div>
    ${c ? `<h3>${texteHtml('mail_btp.parametres.alias_compte')}</h3><div data-alias></div>` : ''}`;
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
    const apres = creerCombo({ options: APRES_RATTACHEMENT, valeur: c?.options?.apres_rattachement ?? 'RIEN' });
    zone.querySelector('[data-apres]').replaceWith(apres);
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
      try { const a = await api.mail.adresse(c.id); zone.querySelector('[data-adresse]').textContent = a.nom_affiche ? texte('mail_btp.parametres.adresse_nom', { adresse: a.adresse, nom: a.nom_affiche }) : a.adresse; } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-fermer]').addEventListener('click', () => { zone.innerHTML = ''; });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('mail_btp.parametres.supprimer_compte', { alias: c.alias }))) return;
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
        options: {
          intervalle_minutes: Number(zone.querySelector('[data-o="intervalle_minutes"]').value) || 60, marquer_lus: zone.querySelector('[data-o="marquer_lus"]').checked,
          drapeau_a_suivre: zone.querySelector('[data-o="drapeau_a_suivre"]').checked, apres_rattachement: apres.valeurCombo,
          dossier_traites: zone.querySelector('[data-o="dossier_traites"]').value.trim() || null,
        },
        dossiers: zone.querySelector('[data-dossiers]').value.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
          const [nom, role] = x.split('=').map((y) => y.trim());
          return { nom, role: (role || 'RECEPTION').toUpperCase() };
        }),
      };
      try {
        const r = c ? await api.mail.modifierCompte(c.id, saisie) : await api.mail.creerCompte(saisie);
        this.app.message(texte('mail_btp.parametres.compte_enregistre'), 'succes');
        await this.recharger();
        this.rendreCompte(this.comptes.find((x) => x.id === r.id));
      } catch (e) { this.app.erreur(e); }
    });
    if (c) this.rendreAlias(c, zone.querySelector('[data-alias]'));
  }

  rendreAlias(c, zone) {
    const liste = this.alias.filter((a) => a.compte_id === c.id).map((a) => ({ ...a }));
    const rendre = () => {
      zone.innerHTML = `<p class="aide">${texteHtml('mail_btp.parametres.alias_aide_liste')}</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('mail_btp.parametres.nom')}</th><th>${texteHtml('mail_btp.parametres.principal')}</th><th>${texteHtml('mail_btp.parametres.actif')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
        ${liste.map((a, i) => `<tr data-i="${i}"><td><input data-k="nom" value="${echapper(a.nom)}" size="30" maxlength="80"></td>
          <td><input type="radio" name="alias-principal" data-k="principal" ${a.principal ? 'checked' : ''}></td>
          <td><input type="checkbox" data-k="actif" ${a.actif ? 'checked' : ''}></td><td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}
        </tbody></table><div class="boutons"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('mail_btp.parametres.alias')}</button> <button type="button" data-enregistrer-alias>${texteHtml('mail_btp.parametres.enregistrer_alias')}</button></div>`;
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
          this.app.message(texte('mail_btp.parametres.alias_enregistres'), 'succes');
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
      zone.innerHTML = `<p class="aide">${texteHtml('mail_btp.parametres.usages_aide')}</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('mail_btp.parametres.usage')}</th><th>${texteHtml('mail_btp.parametres.portee')}</th><th>${texteHtml('mail_btp.parametres.alias')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
        ${lignes.map((l, i) => `<tr data-i="${i}"><td><span data-usage></span></td><td><input data-portee value="${echapper(l.portee ?? '')}" size="16" placeholder="${texteHtml('mail_btp.parametres.defaut')}"></td>
          <td><span data-alias></span></td><td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}
        </tbody></table><div class="boutons"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('mail_btp.parametres.usage')}</button> <button type="button" data-enregistrer-usages>${texteHtml('mail_btp.parametres.enregistrer_usages')}</button></div>`;
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
        try { this.usages.usages = await api.mail.enregistrerUsages(lignes); this.app.message(texte('mail_btp.parametres.usages_enregistres'), 'succes'); } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  rendreModeles(selection = null) {
    const zone = this.conteneur.querySelector('[data-modeles]');
    const libelleUsage = (code) => this.usages.connus.find((x) => x.code === code)?.libelle ?? code;
    zone.innerHTML = `<p class="aide">${texteHtml('mail_btp.parametres.modeles_aide')}
      ${VARIABLES_MODELE.map((v) => `<code>{{${v}}}</code>`).join(' ')}.</p>
      ${this.modeles.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('mail_btp.parametres.usage')}</th><th>${texteHtml('mail_btp.parametres.type')}</th><th>${texteHtml('mail_btp.parametres.defaut_colonne')}</th><th>${texteHtml('mail_btp.parametres.actif')}</th>
        <th class="cellule-boutons"></th></tr></thead><tbody>${this.modeles.map((m) => `<tr data-id="${m.id}"><td>${echapper(m.code)}</td><td>${echapper(m.libelle)}</td>
        <td>${echapper(libelleUsage(m.usage))}</td><td>${m.type ? echapper(m.type) : texteHtml('mail_btp.parametres.tous')}</td><td>${m.defaut ? iconeHtml('mail_btp_valider') : ''}</td><td>${m.actif ? iconeHtml('mail_btp_valider') : ''}</td>
        <td class="cellule-boutons"><button type="button" data-modifier title="${texteHtml('commun.modifier')}">${iconeHtml('mail_btp_modifier')}</button></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="boutons"><button type="button" data-nouveau>${iconeHtml('ajouter')} ${texteHtml('mail_btp.parametres.modele')}</button></div><div data-modele></div>`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => tr.querySelector('[data-modifier]').addEventListener('click', () =>
      this.rendreModele(this.modeles.find((m) => m.id === Number(tr.dataset.id)))));
    zone.querySelector('[data-nouveau]').addEventListener('click', () => this.rendreModele(null));
    if (selection) this.rendreModele(selection);
  }

  rendreModele(m) {
    const zone = this.conteneur.querySelector('[data-modele]');
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><tbody>
      <tr><th>${texteHtml('commun.code')}</th><td><input data-m="code" value="${echapper(m?.code ?? '')}" size="16" maxlength="30"></td></tr>
      <tr><th>${texteHtml('commun.libelle')}</th><td><input data-m="libelle" value="${echapper(m?.libelle ?? '')}" size="40"></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.usage')}</th><td><span data-usage></span></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.type_document')}</th><td><input data-m="type" value="${echapper(m?.type ?? '')}" size="16" placeholder="${texteHtml('mail_btp.parametres.type_aide')}"></td></tr>
      <tr><th>${texteHtml('mail_btp.champs.objet')}</th><td><input data-m="objet" value="${echapper(m?.objet ?? '')}" size="60" placeholder="${texteHtml('mail_btp.parametres.objet_aide', { type: '{{type}}', numero: '{{numero}}', objet: '{{objet}}' })}"></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.corps')}</th><td data-corps></td></tr>
      <tr><th>${texteHtml('mail_btp.parametres.options')}</th><td><label class="ligne"><input type="checkbox" data-m="defaut" ${m?.defaut ? 'checked' : ''}> ${texteHtml('mail_btp.parametres.modele_defaut')}</label>
        <label class="ligne"><input type="checkbox" data-m="actif" ${m?.actif ?? true ? 'checked' : ''}> ${texteHtml('mail_btp.parametres.actif_minuscule')}</label></td></tr></tbody></table>
      <div class="boutons"><button type="button" class="principal" data-enregistrer>${texteHtml('mail_btp.parametres.enregistrer_modele')}</button>
        ${m ? `<button type="button" data-supprimer>${iconeHtml('retirer')} ${texteHtml('commun.supprimer')}</button>` : ''}</div>`;
    const usage = creerCombo({ options: this.usages.connus.map((x) => ({ valeur: x.code, libelle: x.libelle })), valeur: m?.usage ?? 'DOCUMENT_VENTE' });
    zone.querySelector('[data-usage]').replaceWith(usage);
    const corps = zoneRiche(m?.corps_html ?? texte('mail_btp.parametres.corps_defaut_html', { document: '{{document}}' }));
    zone.querySelector('[data-corps]').append(corps.element);
    const v = (k) => zone.querySelector(`[data-m="${k}"]`);
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.modeles = await api.mail.enregistrerModele({
          id: m?.id ?? 0, code: v('code').value, libelle: v('libelle').value, usage: usage.valeurCombo, type: v('type').value.trim(), objet: v('objet').value,
          corps_html: corps.valeur() ?? '', defaut: v('defaut').checked, actif: v('actif').checked,
        });
        this.app.message(texte('mail_btp.parametres.modele_enregistre'), 'succes');
        this.rendreModeles();
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('mail_btp.parametres.supprimer_modele', { libelle: m.libelle }))) return;
      try { this.modeles = await api.mail.supprimerModele(m.id); this.rendreModeles(); } catch (e) { this.app.erreur(e); }
    });
  }

  rendreParametres() {
    const zone = this.conteneur.querySelector('[data-parametres]');
    zone.innerHTML = `<p class="aide">${texteHtml('mail_btp.parametres.reglages_aide')}</p><table class="tableau-compact largeur-contenu"><tbody>
      ${PARAMETRES.map(([k, l]) => `<tr><th>${echapper(l)}</th><td><input data-p="${k}" value="${this.parametres[k] ?? ''}" size="6" inputmode="numeric"></td></tr>`).join('')}
      </tbody></table><div class="boutons"><button type="button" data-enregistrer-parametres>${texteHtml('commun.enregistrer')}</button></div>`;
    zone.querySelector('[data-enregistrer-parametres]').addEventListener('click', async () => {
      const p = Object.fromEntries(PARAMETRES.map(([k]) => [k, Number(zone.querySelector(`[data-p="${k}"]`).value) || 0]));
      try { this.parametres = await api.mail.enregistrerParametres(p); this.app.message(texte('mail_btp.parametres.reglages_enregistres'), 'succes'); } catch (e) { this.app.erreur(e); }
    });
  }
}
