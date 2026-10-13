import { FournisseurApi, FournisseurMemoire } from '@logibtp/liste';
import { ENTETES } from './api.js';
import { VUES_LISTE, THEMES_LISTE, sourcesFournisseur } from './vues-liste.js';
import { documentsDemo, salariesDemo, materielsDemo, ressourcesDemo } from './donnees-demo-liste.js';

// Branchement du module Liste dans le cœur : fournisseur (API ou démo hors ligne) et ouverture des fiches.

let donnees = null;

/** Données de démonstration hors ligne, partagées par les listes et les fiches (mêmes objets lignes). */
export function donneesDemo() {
  donnees ??= { salaries: salariesDemo(), materiels: materielsDemo() };
  return donnees;
}

export function creerFournisseurListe({ enLigne, demo, ged, elements = [], annuaire = null, structure = null }) {
  if (enLigne) return new FournisseurApi({ base: '/api/listes', entetes: ENTETES });
  const { salaries, materiels } = donneesDemo();
  const sources = sourcesFournisseur({
    documents: documentsDemo(demo), salaries, materiels, ressources: ressourcesDemo(salaries, materiels), elements,
    // Annuaire : mêmes lignes que les fiches (colonnes de liste dérivées par le fournisseur de l'annuaire).
    personnes: annuaire?.personnes ?? [], individus: annuaire?.individus ?? [],
  });
  // Documents de la GED : lignes recalculées à chaque lecture (comme la vue v_liste_ged).
  if (ged) Object.defineProperty(sources.ged, 'lignes', { get: () => ged.lignesListe() });
  // Structure des affaires : lignes recalculées à chaque lecture (comme les vues v_liste_projets…).
  if (structure) {
    for (const source of ['projets', 'affaires', 'chantiers', 'marches']) {
      Object.defineProperty(sources[source], 'lignes', { get: () => structure.lignesListe(source) });
    }
  }
  return new FournisseurMemoire({
    sources,
    vues: VUES_LISTE,
    themes: THEMES_LISTE,
    cleStockage: 'logibtp.listes.demo',
  });
}

/** Libellé d'un type d'élément sans écran de fiche. */
export const LIBELLES_ELEMENTS = {
  salarie: 'salarié', interim: 'intérimaire', materiel: 'matériel', equipe: 'équipe', sous_traitant: 'sous-traitant', document_ged: 'document', element: 'élément',
  personne: 'personne', individu: 'individu', projet: 'projet', affaire: 'affaire', chantier: 'chantier', marche: 'marché',
};

/** Les types d'éléments V_*, A_* et S_* sont des documents (code du type de document). */
export const estTypeDocument = (type) => /^[VAS]_/.test(String(type ?? ''));

/**
 * Simulation hors ligne d'une modification faite par un autre utilisateur : un matériel change d'état,
 * un autre est supprimé, un nouveau est créé. Le contrôle périodique de la liste doit le détecter.
 */
export function simulerModificationsAutres(fournisseur) {
  let message = '';
  fournisseur.modifierSource('materiels', (lignes) => {
    const m = lignes[Math.floor(Math.random() * Math.min(lignes.length, 60))];
    m.etat = m.etat === 'PANNE' ? 'DISPO' : 'PANNE';
    m.observations = m.etat === 'PANNE' ? 'Panne signalée par un autre utilisateur' : '';
    const supprime = lignes.splice(1 + Math.floor(Math.random() * 30), 1)[0];
    const id = Math.max(...lignes.map((l) => l.id)) + 1;
    lignes.push({ ...lignes[0], id, code: 'M00000', designation: `Nouveau matériel n° ${id}`, etat: 'DISPO', chantier: null, observations: 'Créé par un autre utilisateur' });
    message = `${m.code} passe ${m.etat === 'PANNE' ? 'en panne' : 'disponible'}, ${supprime.code} supprimé, M00000 créé`;
  });
  return message;
}
