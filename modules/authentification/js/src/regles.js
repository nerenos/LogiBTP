// Règles des comptes, répliquées dans ReglesCompte.cs (jeux modules/authentification/tests/cas) : pseudo, mot de passe,
// état d'un compte (connexion possible ou non), contrôle d'un compte saisi pour sa personne liée.
import { sansAccent } from '@logibtp/socle';

export const TYPES_COMPTE = ['PERSONNE', 'SERVICE'];

/** État d'un compte, du plus bloquant au plus permissif ; A_CHANGER se connecte mais doit changer son mot de passe. */
export const ETATS_COMPTE = {
  SERVICE: 'Compte de service (sans connexion)',
  INACTIF: 'Désactivé',
  EXPIRE: 'Expiré',
  SANS_MOT_DE_PASSE: 'Sans mot de passe',
  VERROUILLE: 'Verrouillé temporairement',
  A_CHANGER: 'Mot de passe provisoire',
  ACTIF: 'Actif',
};

export const LONGUEUR_PSEUDO = { min: 3, max: 50 };
export const LONGUEUR_MDP_MAX = 128;
export const POLITIQUE_DEFAUT = { longueur_min: 12, courants: [] };

export const MESSAGES_AUTH = {
  PSEUDO_VIDE: 'Identifiant obligatoire',
  PSEUDO_LONGUEUR: `Identifiant de ${LONGUEUR_PSEUDO.min} à ${LONGUEUR_PSEUDO.max} caractères`,
  PSEUDO_FORMAT: 'Identifiant : lettres minuscules sans accents, chiffres, point, tiret ou souligné ; commence par une lettre ou un chiffre',
  PSEUDO_RESERVE: 'Identifiant réservé : choisissez-en un autre',
  MDP_VIDE: 'Mot de passe obligatoire',
  MDP_COURT: 'Mot de passe trop court',
  MDP_LONG: `Mot de passe de ${LONGUEUR_MDP_MAX} caractères au plus`,
  MDP_COURANT: 'Mot de passe trop courant : choisissez-en un autre',
  MDP_PSEUDO: "Le mot de passe ne doit pas contenir l'identifiant",
  PERSONNE_NON_AUTORISEE: "Cette personne ne peut pas avoir de compte (salarié ou intérimaire actif seulement)",
  PROFIL_INCONNU: 'Profil inconnu',
  PROFIL_INTERDIT: 'Profil interdit pour cette personne',
  VALIDITE_OBLIGATOIRE: 'Date de fin de validité obligatoire (fin de mission)',
  VALIDITE_PASSEE: 'Date de fin de validité déjà passée',
};

/** Pseudo comparé et enregistré en minuscules, sans espaces autour. */
export function normaliserPseudo(code) {
  return String(code ?? '').trim().toLowerCase();
}

/** Contrôle d'un pseudo de compte de personne : codes d'erreur triés (vide = valide). */
export function controlerPseudo(code, reserves = []) {
  const c = normaliserPseudo(code);
  if (!c) return ['PSEUDO_VIDE'];
  const erreurs = [];
  if (c.length < LONGUEUR_PSEUDO.min || c.length > LONGUEUR_PSEUDO.max) erreurs.push('PSEUDO_LONGUEUR');
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(c)) erreurs.push('PSEUDO_FORMAT');
  if (reserves.some((r) => normaliserPseudo(r) === c)) erreurs.push('PSEUDO_RESERVE');
  return erreurs.sort();
}

/** Contrôle d'un nouveau mot de passe selon la politique de la société ; le pseudo ne doit pas y figurer. */
export function controlerMotDePasse(mdp, politique = POLITIQUE_DEFAUT, pseudo = null) {
  const m = String(mdp ?? '');
  if (!m) return ['MDP_VIDE'];
  const erreurs = [];
  const min = politique?.longueur_min ?? POLITIQUE_DEFAUT.longueur_min;
  if ([...m].length < min) erreurs.push('MDP_COURT');
  if ([...m].length > LONGUEUR_MDP_MAX) erreurs.push('MDP_LONG');
  const bas = m.toLowerCase();
  if ((politique?.courants ?? []).some((c) => String(c).toLowerCase() === bas)) erreurs.push('MDP_COURANT');
  const p = normaliserPseudo(pseudo);
  if (p.length >= LONGUEUR_PSEUDO.min && bas.includes(p)) erreurs.push('MDP_PSEUDO');
  return erreurs.sort();
}

/** Date du jour (UTC) d'un instant ISO, au format AAAA-MM-JJ. */
const jour = (instant) => new Date(instant).toISOString().slice(0, 10);

/**
 * État d'un compte à un instant : { etat, connexion } ; `connexion` dit si un mot de passe juste ouvre une session.
 * Ordre : service, désactivé, expiré (le lendemain de la fin de validité), sans mot de passe, verrouillé, provisoire.
 */
export function etatCompte(compte, maintenant) {
  const etat = (() => {
    if (compte.type === 'SERVICE') return 'SERVICE';
    if (!compte.actif) return 'INACTIF';
    if (compte.valide_jusqu_au && compte.valide_jusqu_au < jour(maintenant)) return 'EXPIRE';
    if (!compte.a_mot_de_passe) return 'SANS_MOT_DE_PASSE';
    if (compte.verrouille_jusqu_au && new Date(compte.verrouille_jusqu_au) > new Date(maintenant)) return 'VERROUILLE';
    if (compte.mdp_provisoire) return 'A_CHANGER';
    return 'ACTIF';
  })();
  return { etat, connexion: etat === 'ACTIF' || etat === 'A_CHANGER' };
}

/**
 * Contrôle d'un compte de personne saisi par un administrateur : profil connu et permis pour la personne, fin de
 * validité obligatoire pour une personne qui l'exige (intérimaire : fin de mission) et pas passée.
 * `personne` : { autorisee, fin_obligatoire, profils_interdits } fournis par l'application ; `aujourdhui` AAAA-MM-JJ.
 */
export function controlerCompte(saisie, personne, profils, aujourdhui) {
  const erreurs = [];
  if (personne && !personne.autorisee) erreurs.push('PERSONNE_NON_AUTORISEE');
  if (!profils.includes(saisie.profil)) erreurs.push('PROFIL_INCONNU');
  else if ((personne?.profils_interdits ?? []).includes(saisie.profil)) erreurs.push('PROFIL_INTERDIT');
  if (!saisie.valide_jusqu_au && personne?.fin_obligatoire) erreurs.push('VALIDITE_OBLIGATOIRE');
  if (saisie.valide_jusqu_au && saisie.valide_jusqu_au < aujourdhui) erreurs.push('VALIDITE_PASSEE');
  return erreurs.sort();
}

/** Pseudo proposé à la création (modifiable) : initiale du prénom, point, nom ; sans accents ni espaces. */
export function suggererPseudo(prenom, nom) {
  const net = (t) => sansAccent(t).replace(/[^a-z0-9]+/g, '');
  const p = net(prenom);
  const n = net(nom);
  return [p.slice(0, 1), n].filter(Boolean).join('.').slice(0, LONGUEUR_PSEUDO.max);
}
