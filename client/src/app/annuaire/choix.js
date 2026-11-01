import { texte, icone } from '@logibtp/socle/dictionnaire';
import { choisirDansListe } from '@logibtp/liste/ui';
import { definirChoixAnnuaire } from '@logibtp/annuaire/ui';
import { CASQUETTES } from './donnees.js';
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
