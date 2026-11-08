import { texte, icone, iconeHtml, texteHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { choisirDansListe } from '@logibtp/liste/ui';
import { definirChoixAnnuaire } from '@logibtp/annuaire/ui';
import { CASQUETTES, ROLES } from './donnees.js';

export { POSTE } from './donnees.js';
import { creerFournisseurListe } from '../listes.js';
import { VUES_CHOIX } from '../vues-liste.js';

// Choix des tiers et des contacts dans une vraie liste (ergonomie I1) : vues des thèmes Tiers et Contacts du module
// Liste (celles de l'utilisateur comprises), filtre par défaut selon l'appel (relation, fonction de l'intervenant)
// retirable ; branché dans le module Annuaire par injection (choisirPersonne / choisirIndividu), dans les
// intervenants et les champs tiers des fiches de la structure.

const THEME_TIERS = 'tiers';
const THEME_CONTACTS = 'contacts';

/** Relations proposées par défaut pour une fonction d'intervenant : la relation de même code, ou ses voisines. */
const RELATIONS_FONCTION = Object.freeze({
  CLIENT: ['CLIENT', 'PROSPECT'], MOA_DELEGUE: ['MOA'], FOURNISSEUR: ['FOURNISSEUR', 'LOUEUR'], MANDATAIRE: ['COTRAITANT'],
  PAYEUR: ['CLIENT'],
});

/** Relations de l'annuaire (codes) proposées pour une fonction d'intervenant (aucune : pas de filtre). */
export function relationsFonction(fonction) {
  if (RELATIONS_FONCTION[fonction]) return [...RELATIONS_FONCTION[fonction]];
  return CASQUETTES.some((c) => c.code === fonction) ? [fonction] : [];
}

const libelleRelations = (codes) => codes.map((c) => CASQUETTES.find((x) => x.code === c)?.libelle ?? c).join(texte('annuaire_btp.choix.ou'));

/**
 * Tiers choisi dans la liste : résumé { id, code, raison_sociale, ville… }, { creer: recherche } si `creer` (libellé du
 * bouton) est donné et choisi, ou null. Options : relations (filtre par défaut), titre, exclure (ids), recherche.
 */
export async function choisirTiers({ relations = [], titre = texte('annuaire_btp.choix.tiers'), exclure = [], recherche = '', creer = null } = {}) {
  const exclus = new Set(exclure.map(Number));
  const r = await choisirDansListe({
    fournisseur: creerFournisseurListe(), theme: THEME_TIERS, vue: VUES_CHOIX.tiers, titre, recherche, creer,
    filtres: relations.length ? { casquettes: relations } : {},
    libellesFiltres: { casquettes: texte('annuaire_btp.choix.relation', { relations: libelleRelations(relations) }) },
    accepter: (l) => (exclus.has(Number(l._id)) ? texte('annuaire_btp.choix.tiers_deja') : null),
  });
  if (!r || 'creer' in r) return r;
  return { ...r, id: Number(r._id) };
}

/** Contact (individu) choisi dans la liste : résumé { id, nom_complet, personnes… }, { creer: recherche } ou null. */
export async function choisirContact({ titre = texte('annuaire_btp.choix.contact'), exclure = [], recherche = '', creer = null } = {}) {
  const exclus = new Set(exclure.map(Number));
  const r = await choisirDansListe({
    fournisseur: creerFournisseurListe(), theme: THEME_CONTACTS, vue: VUES_CHOIX.contacts, titre, recherche, creer,
    accepter: (l) => (exclus.has(Number(l._id)) ? texte('annuaire_btp.choix.contact_deja') : null),
  });
  if (!r || 'creer' in r) return r;
  return { ...r, id: Number(r._id) };
}

/**
 * Contact choisi parmi ceux d'un tiers (contexte `choix:contact_tiers`, intervenants) : vue « Tous les contacts »,
 * recherche initiale sur le nom du tiers, contacts refusés s'ils ne sont pas rattachés au tiers (`idsContacts`, ids des
 * individus rattachés). Résumé { id, nom_complet… } ou null ; sans tiers, aucun choix (null).
 */
export async function choisirContactTiers({ tiers = '', idsContacts = [], titre = null, exclure = [] } = {}) {
  if (!tiers) return null;
  const rattaches = new Set(idsContacts.map(Number));
  const exclus = new Set(exclure.map(Number));
  const r = await choisirDansListe({
    fournisseur: creerFournisseurListe(), theme: THEME_CONTACTS, vue: VUES_CHOIX.contacts, cleVue: 'logibtp.choix.contact_tiers',
    titre: titre ?? texte('annuaire_btp.choix.contact_tiers', { tiers }), recherche: tiers,
    accepter: (l) => {
      if (exclus.has(Number(l._id))) return texte('annuaire_btp.choix.contact_deja');
      return rattaches.has(Number(l._id)) ? null : texte('annuaire_btp.choix.contact_hors_tiers');
    },
  });
  if (!r || 'creer' in r) return null;
  return { ...r, id: Number(r._id) };
}

/**
 * Destinataires d'un courriel choisis en une fois dans la liste des contacts (sélection multiple, Ctrl / Maj + clic) :
 * tableau de { id, nom, adresse } (contacts sans adresse de courriel refusés) ; Échap ou rien de choisi : tableau vide.
 */
export async function choisirDestinataires({ titre = texte('annuaire_btp.choix.destinataires'), exclure = [] } = {}) {
  const exclus = new Set(exclure.map(Number));
  const r = await choisirDansListe({
    fournisseur: creerFournisseurListe(), theme: THEME_CONTACTS, vue: VUES_CHOIX.contacts, cleVue: 'logibtp.choix.destinataires', titre, multiple: true,
    accepter: (l) => {
      if (exclus.has(Number(l._id))) return texte('annuaire_btp.choix.contact_deja');
      return String(l.email ?? '').trim() ? null : texte('annuaire_btp.choix.sans_courriel');
    },
  });
  if (!Array.isArray(r)) return [];
  return r.map((l) => ({ id: Number(l._id), nom: l.nom_complet ?? null, adresse: String(l.email ?? '').trim() })).filter((d) => d.adresse);
}

/** Ajoute des destinataires choisis ({ nom, adresse }) à la zone d'adresses, sans doublon d'adresse. */
export function ajouterDestinataires(valeur, choisis) {
  const presentes = new Set((valeur.match(/[^\s,;<>"]+@[^\s,;<>"]+/g) ?? []).map((x) => x.toLowerCase()));
  const nouveaux = choisis.filter((d) => !presentes.has(d.adresse.toLowerCase()) && presentes.add(d.adresse.toLowerCase()))
    .map((d) => (d.nom ? `${d.nom} <${d.adresse}>` : d.adresse));
  return [valeur.trim(), ...nouveaux].filter(Boolean).join(', ');
}

/** Rôles de l'annuaire proposés par défaut pour un poste (rédacteur ou poste inconnu : aucun filtre, tous les individus de la société). */
export function rolesPoste(poste) {
  return ROLES.some((r) => r.code === poste) ? [poste] : [];
}

/**
 * Individu de notre société choisi dans la liste (vue « Notre société »), filtré par défaut sur le poste (pastille
 * retirable) : résumé { id, nom_complet… } ou null. Options : poste, titre, exclure (ids), recherche.
 */
export async function choisirIndividuPoste({ poste = null, titre = texte('annuaire_btp.choix.individu_societe'), exclure = [], recherche = '' } = {}) {
  const exclus = new Set(exclure.map(Number));
  const roles = rolesPoste(poste);
  const r = await choisirDansListe({
    fournisseur: creerFournisseurListe(), theme: THEME_CONTACTS, vue: VUES_CHOIX.societe, titre, recherche,
    filtres: roles.length ? { roles } : {},
    libellesFiltres: { roles: texte('annuaire_btp.choix.poste', { poste: roles.map((c) => ROLES.find((x) => x.code === c)?.libelle ?? c).join(texte('annuaire_btp.choix.ou')) }) },
    accepter: (l) => (exclus.has(Number(l._id)) ? texte('annuaire_btp.choix.contact_deja') : null),
  });
  if (!r || 'creer' in r) return null;
  return { ...r, id: Number(r._id) };
}

/**
 * Champ d'un individu de notre société par poste : saisie directe du nom (Entrée, F4, double-clic ou bouton ouvrent la
 * liste de choix, le texte saisi en recherche) ; vider le champ efface l'individu. `surChoix(id | null, ligne)` est
 * appelé à chaque changement. Retourne un <span> (propriété `valeurIndividu`).
 */
export function champIndividuPoste({ poste = null, valeur = null, libelle = '', titre = '', surChoix = () => {}, lectureSeule = false } = {}) {
  const span = document.createElement('span');
  span.className = 'champ-tiers';
  span.valeurIndividu = valeur ?? null;
  span.innerHTML = `<input type="search" class="fiche-saisie-champ" value="${echapper(libelle)}" placeholder="${texteHtml('annuaire_btp.choix.rechercher_individu')}" title="${echapper(titre)}" ${lectureSeule ? 'readonly' : ''}>
    <button type="button" class="bouton-icone" data-liste-individu ${lectureSeule ? 'disabled' : ''} title="${texteHtml('annuaire_btp.choix.individu_societe')}">${iconeHtml('rechercher')}</button>`;
  const input = span.querySelector('input');
  const ouvrir = async () => {
    const choisi = await choisirIndividuPoste({ poste, recherche: span.valeurIndividu ? '' : input.value.trim() });
    if (!choisi) return;
    span.valeurIndividu = choisi.id;
    input.value = choisi.nom_complet ?? '';
    surChoix(choisi.id, choisi);
  };
  span.querySelector('[data-liste-individu]').addEventListener('click', ouvrir);
  input.addEventListener('keydown', (e) => { if (e.key === 'F4' || e.key === 'Enter') { e.preventDefault(); ouvrir(); } });
  input.addEventListener('dblclick', ouvrir);
  input.addEventListener('input', () => { if (input.value === '' && span.valeurIndividu !== null) { span.valeurIndividu = null; surChoix(null, null); } });
  return span;
}

/** Choix de l'annuaire (personnes, individus) remplacés par les listes ; appelé au démarrage de l'application. */
export function brancherChoixAnnuaire() {
  definirChoixAnnuaire({
    personne: async ({ casquette, titre, exclure }) => {
      const r = await choisirTiers({ relations: casquette ? [casquette] : [], titre, exclure });
      return r && !('creer' in r) ? r : null;
    },
    individu: async ({ titre, exclure, nom }) => {
      const r = await choisirContact({ titre, exclure, recherche: nom, creer: `${icone('ajouter')} ${texte('annuaire_btp.choix.nouvel_individu')}` });
      if (!r) return null;
      return 'creer' in r ? r : { individu: r };
    },
  });
}
