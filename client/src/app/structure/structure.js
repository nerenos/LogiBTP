import { api } from '../api.js';
import { AFFAIRES, PROJETS, CHANTIERS, MARCHES, FONCTIONS_INTERVENANT, INTERVENANTS } from './donnees.js';

// Structure des affaires côté client : référentiels des listes de choix (projets, affaires, chantiers, marchés,
// commandes clients) et rattachement d'un document. En ligne : routes /api/structure ; hors ligne : mémoire sur les
// données de démonstration, partagées avec les fiches et les listes (lignes calculées comme les vues v_liste_*).

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
    if (!f) { erreurs.push(`Intervenant ${n} : fonction inconnue`); return; }
    if (f.portee !== 'T' && f.portee !== portee) erreurs.push(`Intervenant ${n} : fonction « ${f.libelle} » non proposée ici`);
    if (!x.per_id && !x.ind_id) erreurs.push(`Intervenant ${n} : tiers ou contact à choisir`);
    vues.set(f.code, (vues.get(f.code) ?? 0) + 1);
    if (f.unique && vues.get(f.code) === 2) erreurs.push(`Un seul intervenant « ${f.libelle} »`);
    if (x.paiement_direct && !f.paiement_direct) erreurs.push(`Intervenant ${n} : paiement direct réservé aux sous-traitants`);
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

export function creerFournisseurStructure({ enLigne, annuaire = null, documents = () => [] }) {
  if (enLigne) {
    return {
      referentiels: () => api.structureReferentiels(), rattacher: (id, r) => api.rattacherDocument(id, r),
      intervenants: (type, id) => api.structureIntervenants(type, id),
      documents: (perimetre) => api.structureDocuments(perimetre),
      descendants: (id) => api.structureDescendants(id),
      documentMarche: (marche, type) => api.documentMarche(marche, type),
      // Onglet Gestion du marché : lecture, facturation d'une situation, révision, annulation par avoir.
      gestion: (marche) => api.gestionMarche(marche),
      // Postes de pied du marché (pied global des factures, modèle de pied des commandes).
      postes: (marche) => api.postesMarche(marche),
      acomptes: (marche) => api.acomptesMarche(marche),
      modeAcomptes: () => api.modeAcomptes(),
      demanderAcompte: (marche, demande) => api.demanderAcompte(marche, demande),
      emettreAcompte: (id) => api.emettreAcompte(id),
      enregistrerPostes: (marche, postes) => api.enregistrerPostesMarche(marche, postes),
      facturerSituation: async (id) => {
        const cible = (await api.typesDocument()).find((t) => t.tyd_code === 'V_FACTURE_AVT');
        return api.transformer(id, { cible_tyd_id: cible.tyd_id, lignes: [] });
      },
      reviser: (id) => api.creerIndice(id),
      piecesAnnulation: (id) => api.piecesAnnulation(id),
      annuler: (id) => api.annulerParAvoir(id),
    };
  }
  return new FournisseurStructureMemoire({ annuaire, documents });
}

export class FournisseurStructureMemoire {
  /** annuaire : fournisseur mémoire (noms des clients) ; documents() : documents de démonstration (rattachements). */
  constructor({ annuaire = null, documents = () => [] } = {}) {
    this.affaires = structuredClone(AFFAIRES);
    this.projets = structuredClone(PROJETS);
    this.chantiers = structuredClone(CHANTIERS);
    this.marches = structuredClone(MARCHES);
    this.fonctions = structuredClone(FONCTIONS_INTERVENANT).map((f) => ({ ...f, actif: true }));
    this.lignesIntervenants = structuredClone(INTERVENANTS);
    this.annuaire = annuaire;
    this.lignesDocuments = documents;
  }

  async referentiels() {
    const p = (o, ...cles) => Object.fromEntries(['id', 'code', 'libelle', 'statut', ...cles].map((k) => [k, o[k] ?? null]));
    return {
      affaires: this.affaires.map((a) => p(a, 'nature', 'tiers_id')),
      projets: this.projets.map((x) => p(x, 'tiers_id', 'ville', 'montant_estime')),
      chantiers: this.chantiers.map((c) => p(c, 'aff_id', 'prj_id', 'tiers_id', 'ville')),
      marches: this.marches.map((m) => p(m, 'cha_id', 'ent_id', 'tiers_id', 'montant_ht')),
      commandes: [],
      marche_documents: [],
      fonctions: this.fonctions,
    };
  }

  /** Documents rattachés au périmètre (comme la route /structure/documents) : lignes de démonstration de la liste. */
  async documents({ projets = [], affaires = [], chantiers = [], marches = [] } = {}) {
    const dans = (l, v) => v !== null && v !== undefined && l.includes(Number(v));
    const documents = this.lignesDocuments().filter((d) => dans(projets, d.projet_id) || dans(affaires, d.affaire_id) || dans(chantiers, d.chantier_id) || dans(marches, d.marche_id))
      .map((d) => ({ id: d.id, numero: d.numero, type: d.type_element, type_libelle: d.type_document, famille: d.famille, statut: d.statut, objet: d.objet,
        total_ht: d.total_ht, projet_id: d.projet_id ?? null, affaire_id: d.affaire_id ?? null, chantier_id: d.chantier_id ?? null, marche_id: d.marche_id ?? null,
        groupe_id: d.id, reference: true, date: d.date ?? null }));
    return { documents, liens: [] };
  }

  /** Documents enfants d'un document (comme la route /structure/documents/{id}/descendants) : aucun lien hors ligne. */
  async descendants() { return { documents: [], liens: [] }; }

  /** Intervenants d'un objet, avec les noms de l'annuaire (comme Intervenants.Lire). */
  async intervenants(type, id) {
    const ind = (i) => this.annuaire?.individus?.find((x) => x.id === Number(i));
    return this.lignesIntervenants.filter((x) => x.objet === type && x.objet_id === Number(id)).map((x) => intervenantPropre({
      ...x, tiers: this.nomTiers(x.per_id), contact: ind(x.ind_id) ? [ind(x.ind_id).prenom, ind(x.ind_id).nom].filter(Boolean).join(' ') : null,
    }));
  }

  /** Champ géré « intervenants » des fiches hors ligne (lecture, contrôle, remplacement). */
  geres(type) {
    return {
      lire: async (l) => ({ intervenants: await this.intervenants(type, l.id) }),
      valider: async (_l, g) => {
        const erreurs = controlerIntervenants(g.intervenants ?? [], this.fonctions, 'S');
        if (erreurs.length) throw Object.assign(new Error('Intervenants incorrects'), { code: 'VALIDATION', details: erreurs.map((message) => ({ champ: 'intervenants', code: 'METIER', message })) });
      },
      ecrire: async (l, g) => {
        if (!('intervenants' in g)) return;
        this.lignesIntervenants = this.lignesIntervenants.filter((x) => !(x.objet === type && x.objet_id === Number(l.id)));
        let id = Math.max(0, ...this.lignesIntervenants.map((x) => x.id));
        for (const x of g.intervenants ?? []) this.lignesIntervenants.push({ ...intervenantPropre(x), id: ++id, objet: type, objet_id: Number(l.id) });
      },
    };
  }

  async rattacher(_entId, r) { return completerRattachement(r, this); }

  nomTiers(id) { return id ? this.annuaire?.personnes?.find((x) => x.id === Number(id))?.raison_sociale ?? null : null; }

  /** Lignes des listes (comme v_liste_projets, v_liste_affaires, v_liste_chantiers, v_liste_marches). */
  lignesListe(source) {
    const docs = this.lignesDocuments();
    const factures = (filtre) => docs.filter(filtre).reduce((s, d) => s + (['V_FACTURE', 'V_FACTURE_AVT'].includes(d.type_element) ? Number(d.total_ht ?? 0)
      : d.type_element === 'V_AVOIR' ? -Number(d.total_ht ?? 0) : 0), 0);
    const somme = (l) => l.reduce((s, m) => s + Number(m.montant_ht ?? 0), 0);
    const code = (liste, id) => liste.find((x) => x.id === Number(id))?.code ?? null;
    if (source === 'projets') {
      return this.projets.map((p) => ({
        ...p, type_element: 'projet', client: this.nomTiers(p.tiers_id),
        chantier: this.chantiers.filter((c) => c.prj_id === p.id).map((c) => c.code).join(', ') || null,
        nb_documents: docs.filter((d) => d.ent_projet_id === p.id).length,
      }));
    }
    if (source === 'affaires') {
      return this.affaires.map((a) => {
        const chantiers = this.chantiers.filter((c) => c.aff_id === a.id);
        const ids = new Set(chantiers.map((c) => c.id));
        return {
          ...a, type_element: 'affaire', nature: a.nature === 'G' ? 'Gestion' : 'Chantiers', client: this.nomTiers(a.tiers_id), nb_chantiers: chantiers.length,
          montant_marches: somme(this.marches.filter((m) => ids.has(m.cha_id))), facture_ht: factures((d) => d.ent_affaire_id === a.id || ids.has(d.ent_chantier_id)),
        };
      });
    }
    if (source === 'chantiers') {
      return this.chantiers.map((c) => {
        const marches = this.marches.filter((m) => m.cha_id === c.id);
        return {
          ...c, type_element: 'chantier', affaire: code(this.affaires, c.aff_id), projet: code(this.projets, c.prj_id), client: this.nomTiers(c.tiers_id),
          nb_marches: marches.length, montant_marches: somme(marches), facture_ht: factures((d) => d.ent_chantier_id === c.id),
        };
      });
    }
    return this.marches.map((m) => {
      const ch = this.chantiers.find((c) => c.id === m.cha_id);
      const facture = factures((d) => d.ent_marche_id === m.id);
      return {
        ...m, type_element: 'marche', chantier: ch?.code ?? null, affaire: code(this.affaires, ch?.aff_id), client: this.nomTiers(m.tiers_id), commande: null,
        nature: m.nature === 'U' ? 'Public' : 'Privé', date_marche: m.date, facture_ht: facture, reste_a_facturer: Number(m.montant_ht ?? 0) - facture,
      };
    });
  }
}
