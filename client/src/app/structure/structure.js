import { api } from '../api.js';
import { AFFAIRES, PROJETS, CHANTIERS, MARCHES } from './donnees.js';

// Structure des affaires côté client : référentiels des listes de choix (projets, affaires, chantiers, marchés,
// commandes clients) et rattachement d'un document. En ligne : routes /api/structure ; hors ligne : mémoire sur les
// données de démonstration, partagées avec les fiches et les listes (lignes calculées comme les vues v_liste_*).

/** Rattachement complété : un marché donne son chantier, un chantier son affaire. */
export function completerRattachement(r, { chantiers, marches }) {
  const res = { ent_projet_id: r.ent_projet_id ?? null, ent_affaire_id: r.ent_affaire_id ?? null, ent_chantier_id: r.ent_chantier_id ?? null, ent_marche_id: r.ent_marche_id ?? null };
  if (res.ent_marche_id) res.ent_chantier_id = marches.find((m) => m.id === Number(res.ent_marche_id))?.cha_id ?? res.ent_chantier_id;
  if (res.ent_chantier_id) res.ent_affaire_id = chantiers.find((c) => c.id === Number(res.ent_chantier_id))?.aff_id ?? res.ent_affaire_id;
  return res;
}

export function creerFournisseurStructure({ enLigne, annuaire = null, documents = () => [] }) {
  if (enLigne) return { referentiels: () => api.structureReferentiels(), rattacher: (id, r) => api.rattacherDocument(id, r) };
  return new FournisseurStructureMemoire({ annuaire, documents });
}

export class FournisseurStructureMemoire {
  /** annuaire : fournisseur mémoire (noms des clients) ; documents() : documents de démonstration (rattachements). */
  constructor({ annuaire = null, documents = () => [] } = {}) {
    this.affaires = structuredClone(AFFAIRES);
    this.projets = structuredClone(PROJETS);
    this.chantiers = structuredClone(CHANTIERS);
    this.marches = structuredClone(MARCHES);
    this.annuaire = annuaire;
    this.documents = documents;
  }

  async referentiels() {
    const p = (o, ...cles) => Object.fromEntries(['id', 'code', 'libelle', 'statut', ...cles].map((k) => [k, o[k] ?? null]));
    return {
      affaires: this.affaires.map((a) => p(a, 'nature', 'tiers_id')),
      projets: this.projets.map((x) => p(x, 'tiers_id', 'ville', 'montant_estime')),
      chantiers: this.chantiers.map((c) => p(c, 'aff_id', 'prj_id', 'tiers_id', 'ville')),
      marches: this.marches.map((m) => p(m, 'cha_id', 'ent_id', 'tiers_id', 'montant_ht')),
      commandes: [],
    };
  }

  async rattacher(_entId, r) { return completerRattachement(r, this); }

  nomTiers(id) { return id ? this.annuaire?.personnes?.find((x) => x.id === Number(id))?.raison_sociale ?? null : null; }

  /** Lignes des listes (comme v_liste_projets, v_liste_affaires, v_liste_chantiers, v_liste_marches). */
  lignesListe(source) {
    const docs = this.documents();
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
