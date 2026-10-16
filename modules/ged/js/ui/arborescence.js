// Arborescence de l'explorateur de la GED (classe mère, méthode patron). Un nœud :
//   { cle, libelle, icone, element: { type_element, id_element } | null, groupe, lien, url }
//   - element : élément lié dont le nœud montre les documents (null avec groupe faux : documents sans élément) ;
//   - groupe : regroupement sans documents propres (ex. « Projets ») ;
//   - lien : { cle, chemin, libelle } dossier « lien symbolique » (affiché dans la liste du dossier, jamais dans
//     l'arbre) ; chemin : clés successives depuis le dossier courant ou l'un de ses ancêtres (défaut [cle]) ;
//     url : page à ouvrir à la place (lien sans nœud cible dans l'arborescence) ; sous_titre : texte secondaire.
// Les répertoires créés par les utilisateurs s'ajoutent sous chaque nœud lié à un élément (ou sans élément) : c'est
// l'explorateur qui les lit (fournisseur.repertoires). L'application dérive cette classe pour ses propres nœuds
// automatiques (structure des affaires, documents enfants…) : racine(), enfants(noeud).

export class ArborescenceGed {
  /** contexte : { type_element, id_element, libelle, icone } ou null (GED globale). */
  constructor(contexte = null) {
    this.contexte = contexte;
  }

  /** Nœud racine : l'élément ouvert (fiche, document), ou les documents sans élément de la GED globale. */
  async racine() {
    const c = this.contexte;
    if (!c) return { cle: 'racine', libelle: 'Documents', icone: '🗂', element: null };
    return { cle: `${c.type_element}:${c.id_element}`, libelle: c.libelle ?? `${c.type_element} ${c.id_element}`, icone: c.icone ?? '📁',
      element: { type_element: c.type_element, id_element: String(c.id_element) } };
  }

  /** Nœuds automatiques sous un nœud (dossiers, regroupements, liens) : aucun par défaut. */
  async enfants(_noeud) { return []; }
}
