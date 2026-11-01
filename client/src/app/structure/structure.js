import { texte } from '@logibtp/socle/dictionnaire';
import { TYPE_DOCUMENT } from '../codes.js';
import { api } from '../api.js';
import { ERREUR_FICHE } from '@logibtp/fiche';
import { confirmer } from '@logibtp/socle/ui';

// Structure des affaires côté client : référentiels des listes de choix (projets, affaires, chantiers, marchés,
// commandes clients) et rattachement d'un document par les routes /api/structure.

/** Rattachement complété (les parents suivent l'enfant) : un marché donne son chantier, un chantier son affaire et son projet. */
export function completerRattachement(r, { chantiers, marches }) {
  const res = { ent_projet_id: r.ent_projet_id ?? null, ent_affaire_id: r.ent_affaire_id ?? null, ent_chantier_id: r.ent_chantier_id ?? null, ent_marche_id: r.ent_marche_id ?? null };
  if (res.ent_marche_id) res.ent_chantier_id = marches.find((m) => m.id === Number(res.ent_marche_id))?.cha_id ?? res.ent_chantier_id;
  const chantier = res.ent_chantier_id ? chantiers.find((c) => c.id === Number(res.ent_chantier_id)) : null;
  if (chantier) {
    res.ent_affaire_id = chantier.aff_id ?? res.ent_affaire_id;
    res.ent_projet_id = chantier.prj_id ?? res.ent_projet_id;
  }
  return res;
}

/**
 * Contrôles des intervenants (réplique d'Intervenants.Controler, src/LogiBTP.Api/Btp/Intervenants.cs) : fonction
 * connue, active et de la portée (S structure, D document) ; tiers ou contact ; une seule occurrence d'une fonction
 * unique ; paiement direct réservé aux fonctions qui l'admettent (information). Retourne les messages d'erreur.
 */
export function controlerIntervenants(liste, fonctions, portee) {
  const erreurs = [];
  const vues = new Map();
  (liste ?? []).forEach((x, i) => {
    const n = i + 1;
    const f = fonctions.find((y) => y.code === x.fonction);
    if (!f) { erreurs.push(texte('structure_btp.intervenants.erreurs.fonction_inconnue', { n })); return; }
    if (f.portee !== 'T' && f.portee !== portee) erreurs.push(texte('structure_btp.intervenants.erreurs.fonction_portee', { n, fonction: f.libelle }));
    if (!x.per_id && !x.ind_id) erreurs.push(texte('structure_btp.intervenants.erreurs.tiers', { n }));
    vues.set(f.code, (vues.get(f.code) ?? 0) + 1);
    if (f.unique && vues.get(f.code) === 2) erreurs.push(texte('structure_btp.intervenants.erreurs.unique', { fonction: f.libelle }));
    if (x.paiement_direct && !f.paiement_direct) erreurs.push(texte('structure_btp.intervenants.erreurs.paiement_direct', { n }));
  });
  return erreurs;
}

/** Intervenant saisi réduit à ses champs (ordre de la saisie). */
export function intervenantPropre(x) {
  return {
    fonction: x.fonction ?? null, per_id: x.per_id ? Number(x.per_id) : null, tiers: x.tiers ?? null, ind_id: x.ind_id ? Number(x.ind_id) : null,
    contact: x.contact ?? null, principal: !!x.principal, paiement_direct: !!x.paiement_direct,
    commentaire: x.commentaire || null,
  };
}

/**
 * Changement d'un niveau du rattachement (cle : ent_projet_id, ent_affaire_id, ent_chantier_id, ent_marche_id) : les
 * parents suivent l'enfant (completerRattachement) ; un enfant devenu incohérent avec le nouveau parent est retiré.
 */
export function changerNiveau(r, cle, id, refs) {
  const res = { ent_projet_id: r.ent_projet_id ?? null, ent_affaire_id: r.ent_affaire_id ?? null, ent_chantier_id: r.ent_chantier_id ?? null, ent_marche_id: r.ent_marche_id ?? null };
  res[cle] = id;
  const chantier = (cid) => refs.chantiers?.find((c) => c.id === cid);
  if (cle === 'ent_affaire_id' && res.ent_chantier_id && chantier(res.ent_chantier_id)?.aff_id !== id) { res.ent_chantier_id = null; res.ent_marche_id = null; }
  if (cle === 'ent_projet_id' && res.ent_chantier_id && chantier(res.ent_chantier_id)?.prj_id && chantier(res.ent_chantier_id)?.prj_id !== id) {
    res.ent_chantier_id = null; res.ent_marche_id = null;
  }
  if (cle === 'ent_chantier_id' && res.ent_marche_id && refs.marches?.find((x) => x.id === res.ent_marche_id)?.cha_id !== id) res.ent_marche_id = null;
  return completerRattachement(res, { chantiers: refs.chantiers ?? [], marches: refs.marches ?? [] });
}

/**
 * Création d'une fiche à chrono hors de la fiche (fenêtres de la validation d'une commande) : code vide = calculé par le
 * serveur ; code saisi déjà pris = prochain code libre proposé, puis création avec lui si l'utilisateur l'accepte.
 */
export async function creerFicheCodeLibre(fournisseur, type, corps) {
  try {
    return await fournisseur.creer(type, corps);
  } catch (e) {
    const { code, propose } = e.details ?? {};
    if (e.code !== ERREUR_FICHE.CODE_PRIS || !propose || !await confirmer(texte('structure_btp.code_pris', { code, propose }), { ok: texte('structure_btp.code_pris_ok', { propose }) })) throw e;
    return fournisseur.creer(type, { ...corps, valeurs: { ...corps.valeurs, code: propose } });
  }
}

/** Code prévisionnel d'une fiche à créer (texte indicatif), ou '' s'il ne peut pas encore être calculé. */
export async function codePrevisionnel(fournisseur, type, valeurs = {}) {
  try { return (await fournisseur.code(type, { valeurs })).previsionnel ?? ''; } catch { return ''; }
}

export function creerFournisseurStructure() {
  return {
    referentiels: () => api.structureReferentiels(), rattacher: (id, r) => api.rattacherDocument(id, r),
    intervenants: (type, id) => api.structureIntervenants(type, id),
    documents: (perimetre) => api.structureDocuments(perimetre),
    descendants: (id) => api.structureDescendants(id),
    documentMarche: (marche, type) => api.documentMarche(marche, type),
    // Onglet Gestion du marché : lecture, facturation d'une situation, révision, annulation par avoir.
    gestion: (marche) => api.gestionMarche(marche),
    avancementReel: (marche) => api.liaisons.avancementMarche(marche),
    // Postes de pied du marché (pied global des factures, modèle de pied des commandes).
    postes: (marche) => api.postesMarche(marche),
    acomptes: (marche) => api.acomptesMarche(marche),
    etatPieces: (pieces) => api.etatPieces(pieces),
    modeAcomptes: () => api.modeAcomptes(),
    demanderAcompte: (marche, demande) => api.demanderAcompte(marche, demande),
    emettreAcompte: (id) => api.emettreAcompte(id),
    enregistrerPostes: (marche, postes) => api.enregistrerPostesMarche(marche, postes),
    facturerSituation: async (id) => {
      const cible = (await api.typesDocument()).find((t) => t.tyd_code === TYPE_DOCUMENT.V_FACTURE_AVT);
      return api.transformer(id, { cible_tyd_id: cible.tyd_id, lignes: [] });
    },
    reviser: (id) => api.creerIndice(id),
    piecesAnnulation: (id) => api.piecesAnnulation(id),
    annuler: (id) => api.annulerParAvoir(id),
  };
}
