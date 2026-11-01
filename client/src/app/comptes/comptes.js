import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { pastille } from '../pastilles.js';
import { aujourdhui, PROFIL } from '@logibtp/socle';
import { echapper, creerCombo, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import { ETATS_COMPTE, MESSAGES_AUTH, controlerPseudo, controlerCompte, suggererPseudo } from '@logibtp/authentification';
import { api } from '../api.js';

// Gestion des comptes (module Authentification, lot 1) : compte d'une personne (onglet Compte de la fiche salarié,
// page des comptes), création avec pseudo proposé, modification, réinitialisation, déverrouillage.

const date = (d) => formatDateHeure(d, { vide: '—' });
const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

/** Pastille de l'état d'un compte. */
export function pastilleCompte(c) {
  const classe = { ACTIF: 'ok', A_CHANGER: 'attention', VERROUILLE: 'attention', SERVICE: 'neutre' }[c.etat] ?? 'erreur';
  const libelle = ETATS_COMPTE[c.etat] ?? c.etat;
  return pastille(libelle, classe, { titre: libelle });
}

let profilsCache = null;
/** Profils attribuables (`GET /api/auth/profils`). */
export async function profilsComptes() {
  profilsCache ??= api.auth.profils().catch(() => ({ profils: [{ code: PROFIL.ADMIN, libelle: texte('authentification_btp.compte.profil_admin') }, { code: 'SAISIE', libelle: texte('authentification_btp.compte.profil_saisie') }], defaut: 'SAISIE' }));
  return profilsCache;
}

/** Mot de passe provisoire montré une fois, avec copie. */
function afficherProvisoire(zone, code, mdp) {
  zone.innerHTML = `<div class="carte avertissement provisoire"><p>${iconeHtml('authentification_btp_mdp')} ${texteHtml('authentification_btp.compte.provisoire_html', { code })}</p>
    <p><code class="mdp-provisoire">${echapper(mdp)}</code> <button type="button" data-copier>${iconeHtml('authentification_btp_copier')} ${texteHtml('authentification_btp.compte.copier')}</button></p></div>`;
  zone.querySelector('[data-copier]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(mdp); zone.querySelector('[data-copier]').textContent = `${icone('authentification_btp_copie')} ${texte('authentification_btp.compte.copie')}`; } catch { /* sélection manuelle */ }
  });
}

/**
 * Compte d'une personne (type, id) : affichage et actions s'il existe, sinon formulaire de création (pseudo proposé
 * depuis le nom, profil, fin de validité obligatoire pour un intérimaire). `surChange` : après une écriture.
 */
export async function rendreComptePersonne(corps, { app, type, id, prenom = '', nom = '', surChange = () => {} }) {
  if (!app.estAdmin()) { corps.innerHTML = `<p class="aide">${texteHtml('authentification_btp.compte.admin_seul')}</p>`; return; }
  corps.innerHTML = `<p class="aide">${texteHtml('authentification_btp.compte.chargement')}</p>`;
  const [{ personne, compte }, { profils, defaut }, politique] = await Promise.all([api.auth.personne(type, id), profilsComptes(), api.auth.politique()]);
  const recharger = async () => { await rendreComptePersonne(corps, { app, type, id, prenom, nom, surChange }); surChange(); };
  const tete = `<p><b>${echapper(personne.libelle)}</b>${personne.statut ? ` · ${echapper(personne.statut)}` : ''}
    ${personne.autorisee ? '' : `<br><span class="erreur">${iconeHtml('avertissement')} ${echapper(MESSAGES_AUTH.PERSONNE_NON_AUTORISEE)}${personne.motif ? ` : ${echapper(personne.motif)}` : ''}</span>`}</p>`;
  if (compte) {
    corps.innerHTML = `<div class="compte-personne">${tete}<div data-provisoire></div>
      <dl class="definitions"><dt>${texteHtml('authentification_btp.compte.identifiant')}</dt><dd><b>${echapper(compte.code)}</b> ${pastilleCompte(compte)}</dd>
        <dt>${texteHtml('authentification_btp.compte.profil')}</dt><dd data-profil></dd><dt>${texteHtml('authentification_btp.compte.fin_validite')}</dt><dd><input type="date" data-validite value="${echapper(compte.valide_jusqu_au ?? '')}">${personne.fin_obligatoire ? ` <small class="aide">${texteHtml('authentification_btp.compte.fin_obligatoire')}</small>` : ''}</dd>
        <dt>${texteHtml('authentification_btp.compte.actif')}</dt><dd><input type="checkbox" data-actif ${compte.actif ? 'checked' : ''}></dd>
        <dt>${texteHtml('authentification_btp.compte.derniere_connexion')}</dt><dd>${date(compte.derniere_connexion)}</dd><dt>${texteHtml('authentification_btp.compte.sessions')}</dt><dd>${compte.sessions_ouvertes}</dd>
        ${compte.verrouille_jusqu_au && compte.etat === 'VERROUILLE' ? `<dt>${texteHtml('authentification_btp.compte.verrouille_jusqua')}</dt><dd>${date(compte.verrouille_jusqu_au)}</dd>` : ''}
        <dt>${texteHtml('authentification_btp.compte.cree')}</dt><dd>${texteHtml('authentification_btp.compte.cree_valeur', { par: compte.cree_par, le: date(compte.cree_le) })}</dd></dl>
      <p class="connexion-erreur" data-erreur hidden></p>
      <p><button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button>
        <button type="button" data-reinitialiser title="${texteHtml('authentification_btp.compte.reinitialiser_aide')}">${iconeHtml('authentification_btp_mdp')} ${texteHtml('authentification_btp.compte.reinitialiser')}</button>
        ${compte.etat === 'VERROUILLE' ? `<button type="button" data-deverrouiller>${iconeHtml('authentification_btp_deverrouiller')} ${texteHtml('authentification_btp.compte.deverrouiller')}</button>` : ''}
        <a href="/parametres/comptes?compte=${compte.id}">${texteHtml('authentification_btp.compte.journal')}</a></p></div>`;
    const profil = creerCombo({ options: profils.map((p) => ({ valeur: p.code, libelle: p.libelle, detail: p.code })), valeur: compte.profil, vide: false });
    corps.querySelector('[data-profil]').append(profil);
    const erreur = corps.querySelector('[data-erreur]');
    const echec = (e) => { erreur.textContent = e.message; erreur.hidden = false; };
    corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        await api.auth.modifierCompte(compte.id, { profil: profil.valeurCombo, valide_jusqu_au: corps.querySelector('[data-validite]').value || null, actif: corps.querySelector('[data-actif]').checked });
        app.message(texte('authentification_btp.compte.enregistre'), 'succes');
        await recharger();
      } catch (e) { echec(e); }
    });
    corps.querySelector('[data-reinitialiser]').addEventListener('click', async () => {
      if (!await confirmer(texte('authentification_btp.compte.confirmer_reinitialiser', { code: compte.code }))) return;
      try {
        const r = await api.auth.reinitialiserCompte(compte.id);
        afficherProvisoire(corps.querySelector('[data-provisoire]'), r.compte.code, r.mot_de_passe);
      } catch (e) { echec(e); }
    });
    corps.querySelector('[data-deverrouiller]')?.addEventListener('click', async () => {
      try { await api.auth.deverrouillerCompte(compte.id); await recharger(); } catch (e) { echec(e); }
    });
    return;
  }
  const propose = suggererPseudo(prenom || personne.libelle.split(' ')[0], nom || personne.libelle.split(' ').slice(1).join(' '));
  corps.innerHTML = `<div class="compte-personne">${tete}
    <p class="aide">${texteHtml('authentification_btp.compte.aucun_compte')}</p>
    ${personne.autorisee ? `<p><label>${texteHtml('authentification_btp.compte.pseudo')}<br><input data-code value="${echapper(propose)}" maxlength="50" spellcheck="false" autocapitalize="none"></label></p>
      <p><label>${texteHtml('authentification_btp.compte.profil')}<br><span data-profil></span></label></p>
      <p><label>${personne.fin_obligatoire ? texteHtml('authentification_btp.compte.fin_validite_obligatoire') : texteHtml('authentification_btp.compte.fin_validite_facultative')}<br><input type="date" data-validite min="${aujourdhui()}"></label></p>
      <p class="connexion-erreur" data-erreur hidden></p>
      <p><button type="button" class="principal" data-creer>${iconeHtml('ajouter')} ${texteHtml('authentification_btp.compte.creer')}</button></p>` : ''}
    <div data-provisoire></div></div>`;
  if (!personne.autorisee) return;
  const profil = creerCombo({ options: profils.filter((p) => !personne.profils_interdits.includes(p.code)).map((p) => ({ valeur: p.code, libelle: p.libelle, detail: p.code })), valeur: defaut, vide: false });
  corps.querySelector('[data-profil]').append(profil);
  const erreur = corps.querySelector('[data-erreur]');
  corps.querySelector('[data-creer]').addEventListener('click', async () => {
    const saisie = { code: corps.querySelector('[data-code]').value, type_element: type, id_element: String(id), profil: profil.valeurCombo, valide_jusqu_au: corps.querySelector('[data-validite]').value || null };
    const codes = [...controlerPseudo(saisie.code, politique.pseudos_reserves), ...controlerCompte(saisie, personne, profils.map((p) => p.code), aujourdhui())];
    if (codes.length) { erreur.textContent = codes.map((c) => MESSAGES_AUTH[c]).join(' · '); erreur.hidden = false; return; }
    try {
      const r = await api.auth.creerCompte(saisie);
      await rendreComptePersonne(corps, { app, type, id, prenom, nom, surChange });
      afficherProvisoire(corps.querySelector('[data-provisoire]'), r.compte.code, r.mot_de_passe);
      surChange();
    } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
  });
}

export { jour as jourCompte, date as dateCompte };
