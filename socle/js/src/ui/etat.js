import { produceWithPatches, applyPatches, enablePatches, current, isDraft } from 'immer';

enablePatches();

/**
 * État de saisie du document, avec pile d'annulation par patchs (Immer) plutôt qu'instantanés complets.
 * Seules les saisies entrent dans la pile ; le calcul est relancé après chaque modification,
 * annulation ou rétablissement. Une action qui en entraîne d'autres forme une seule étape.
 */
export class Magasin {
  /** `identifiants(saisie, resultat)` : tous les ID temporaires possibles, pour prochainId. */
  constructor(saisie, { recalculer, identifiants, limite = 100 }) {
    this.saisie = saisie;
    this.recalculer = recalculer;
    this.identifiants = identifiants ?? (() => []);
    this.limite = limite;
    this.pile = [];
    this.pileRefaire = [];
    this.abonnes = new Set();
    // Lecture seule (document verrouillé par un autre utilisateur…) : toute modification est refusée, surRefus averti.
    this.lectureSeule = false;
    this.surRefus = null;
    this.resultat = recalculer(saisie);
  }

  abonner(f) {
    this.abonnes.add(f);
    return () => this.abonnes.delete(f);
  }

  #notifier() {
    this.resultat = this.recalculer(this.saisie);
    for (const f of this.abonnes) f(this);
  }

  /** Applique une recette Immer ; renvoie la valeur retournée par la recette. */
  modifier(recette, libelle = '') {
    if (this.lectureSeule) {
      this.surRefus?.(libelle);
      return undefined;
    }
    let retour;
    const [suivant, patches, inverses] = produceWithPatches(this.saisie, (brouillon) => {
      retour = recette(brouillon);
      if (isDraft(retour)) retour = current(retour);
    });
    if (patches.length === 0) return retour;
    this.saisie = suivant;
    this.pile.push({ patches, inverses, libelle });
    if (this.pile.length > this.limite) this.pile.shift();
    this.pileRefaire = [];
    this.#notifier();
    return retour;
  }

  annuler() {
    const e = this.pile.pop();
    if (!e) return false;
    this.saisie = applyPatches(this.saisie, e.inverses);
    this.pileRefaire.push(e);
    this.#notifier();
    return true;
  }

  retablir() {
    const e = this.pileRefaire.pop();
    if (!e) return false;
    this.saisie = applyPatches(this.saisie, e.patches);
    this.pile.push(e);
    this.#notifier();
    return true;
  }

  /** Remplacement hors pile (chargement d'un autre document). */
  charger(saisie) {
    this.saisie = saisie;
    this.pile = [];
    this.pileRefaire = [];
    this.#notifier();
  }

  /**
   * Après enregistrement : report des ID définitifs et des valeurs serveur sans passer par la pile,
   * qui est conservée (l'enregistrement n'est pas une étape).
   */
  appliquerServeur(recette) {
    const [suivant] = produceWithPatches(this.saisie, recette);
    this.saisie = suivant;
    this.#notifier();
  }

  /** Nouvel ID temporaire négatif, unique dans le document. */
  prochainId() {
    let min = 0;
    for (const id of this.identifiants(this.saisie, this.resultat)) if (id < min) min = id;
    return min - 1;
  }
}
