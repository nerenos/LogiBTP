import { actionDe } from './raccourcis.js';
import { ListeDeroulante, AssistantFormule } from './liste-deroulante.js';

/**
 * Grille arborescente partagée par les lignes du document et les lignes de métré :
 * même saisie en cascade, mêmes raccourcis, même glisser-déposer.
 *
 * Deux modes, comme un tableur : mode ligne (sélection) et mode édition (saisie dans une cellule).
 * F2 ou Entrée passe en édition, Échap revient en mode ligne. En édition, Entrée valide et passe à la
 * cellule utile suivante ; après la dernière, une nouvelle ligne est créée au même niveau.
 *
 * options :
 *  cle                     nom de la colonne identifiant
 *  colonnes                [{ cle, titre, classe, valeur(ligne) → texte|{html}, editable(ligne), editeur, options(ligne), lire(ligne), champ(ligne),
 *                            classeCellule(ligne) et titreCellule(ligne) facultatifs : classe et bulle propres à la cellule }]
 *  lignes()                [{ item, calcule, profondeur, aEnfants }] dans l'ordre d'affichage
 *  actions                 { modifier, inserer, deplacer, indenter, desindenter, decaler, supprimer, dupliquer,
 *                            copier, coller, ouvrirMetre, rechercher (F3), annuler, retablir, depotAutorise, classeLigne, titreLigne, selection,
 *                            marqueur(ligne) → { fond, titre } | null (pastille colorée de la poignée), choisirMarqueur(id, element),
 *                            entetePoignee(th) (contenu de l'entête de la colonne des poignées),
 *                            libelleDepot(cibleId, position) → texte du badge pendant un glisser (avant, après, composant…),
 *                            depotExterne : { types, autorise(cibleId, position, types), deposer(cibleId, position, dataTransfer) }
 *                            (dépôt glissé depuis une autre fenêtre, ex. la bibliothèque) }
 *
 * Les colonnes affichées se remplacent par definirColonnes (vues de colonnes).
 */
export class GrilleArbre {
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.o = options;
    this.selection = [];
    this.ancre = null;
    this.courant = null;
    this.colonne = 0;
    this.edition = null;
    this.replies = new Set();

    conteneur.classList.add('grille');
    conteneur.tabIndex = 0;
    conteneur.innerHTML = '<table><thead></thead><tbody></tbody></table>';
    this.thead = conteneur.querySelector('thead');
    this.tbody = conteneur.querySelector('tbody');
    this.#entete();

    conteneur.addEventListener('keydown', (e) => this.#clavier(e));
    this.tbody.addEventListener('mousedown', (e) => this.#clic(e));
    this.tbody.addEventListener('pointerdown', (e) => this.#debutGlisser(e));
    // Dépôt glissé depuis une autre fenêtre (HTML5 drag and drop).
    conteneur.addEventListener('dragover', (e) => this.#survolExterne(e));
    conteneur.addEventListener('dragleave', (e) => { if (!conteneur.contains(e.relatedTarget)) this.#finDepot(); });
    conteneur.addEventListener('drop', (e) => this.#depotExterne(e));
    conteneur.addEventListener('scroll', () => this.liste?.positionner());
  }

  #entete() {
    const tr = document.createElement('tr');
    tr.innerHTML = '<th class="poignee"></th>';
    // Entête de la colonne des poignées (ex. filtre par pastille).
    this.o.actions.entetePoignee?.(tr.firstElementChild);
    for (const c of this.o.colonnes) {
      const th = document.createElement('th');
      th.className = c.classe ?? '';
      th.append(c.titre);
      // Bouton d'entête de colonne (ex. libellés sur une ligne / en entier).
      if (c.enteteBouton) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'entete-bouton';
        b.textContent = c.enteteBouton.texte();
        b.title = c.enteteBouton.titre();
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { c.enteteBouton.clic(); this.#entete(); this.rendre(); this.focus(); });
        th.append(' ', b);
      }
      tr.appendChild(th);
    }
    this.thead.replaceChildren(tr);
  }

  /** Colonnes affichées remplacées (vue de colonnes) : entête redessiné, colonne courante conservée si possible. */
  definirColonnes(colonnes) {
    const cle = this.o.colonnes[this.colonne]?.cle;
    this.edition = null;
    this.o.colonnes = colonnes;
    const i = colonnes.findIndex((c) => c.cle === cle);
    this.colonne = i >= 0 ? i : 0;
    this.#entete();
    this.rendre();
  }

  get lignesAffichees() {
    return this.o.lignes(this.replies);
  }

  rendre() {
    const lignes = this.lignesAffichees;
    this.index = new Map(lignes.map((r, i) => [r.item[this.o.cle], i]));
    if (this.courant !== null && !this.index.has(this.courant)) this.courant = lignes[0]?.item[this.o.cle] ?? null;
    if (this.courant === null && lignes.length) this.courant = lignes[0].item[this.o.cle];
    this.selection = this.selection.filter((id) => this.index.has(id));
    if (this.selection.length === 0 && this.courant !== null) this.selection = [this.courant];

    const frag = document.createDocumentFragment();
    for (const r of lignes) {
      const id = r.item[this.o.cle];
      const tr = document.createElement('tr');
      tr.dataset.id = id;
      tr.className = [
        this.o.actions.classeLigne?.(r) ?? '',
        this.selection.includes(id) ? 'selectionnee' : '',
        id === this.courant ? 'courante' : '',
      ].join(' ');
      const titre = this.o.actions.titreLigne?.(r);
      if (titre) tr.title = titre;
      const poignee = document.createElement('td');
      poignee.className = 'poignee';
      // Pastille colorée (étiquette, mode de vente…) : un clic ouvre le choix de l'hôte.
      const m = this.o.actions.marqueur?.(r);
      if (m) {
        const pastille = document.createElement('span');
        pastille.className = 'marqueur';
        pastille.style.background = m.fond;
        if (m.titre) pastille.title = m.titre;
        pastille.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
        pastille.addEventListener('mousedown', (ev) => ev.stopPropagation());
        pastille.addEventListener('click', (ev) => { ev.stopPropagation(); this.o.actions.choisirMarqueur?.(id, pastille); });
        poignee.appendChild(pastille);
      }
      poignee.append('⋮⋮');
      tr.appendChild(poignee);
      this.o.colonnes.forEach((c, i) => {
        const td = document.createElement('td');
        td.dataset.col = i;
        td.className = [c.classe ?? '', c.classeCellule?.(r) ?? '', c.editable?.(r.item) ? 'editable' : '', id === this.courant && i === this.colonne ? 'cellule' : ''].join(' ');
        const bulle = c.titreCellule?.(r);
        if (bulle) td.title = bulle;
        if (i === 0) td.style.paddingLeft = `${0.4 + r.profondeur * 1.1}rem`;
        if (c.arbre) {
          const b = document.createElement('span');
          b.className = 'repli';
          b.textContent = r.aEnfants ? (this.replies.has(id) ? '▸' : '▾') : '';
          b.addEventListener('mousedown', (ev) => { ev.stopPropagation(); this.basculer(id); });
          td.appendChild(b);
        }
        const v = c.valeur(r);
        if (v && typeof v === 'object' && 'html' in v) {
          const s = document.createElement('span');
          s.innerHTML = v.html;
          if (v.titre) td.title = v.titre;
          td.appendChild(s);
        } else if (v instanceof Node) td.appendChild(v);
        else td.appendChild(document.createTextNode(v ?? ''));
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    }
    this.tbody.replaceChildren(frag);
    this.o.actions.selection?.(this.courant, this.selection);
    if (this.edition) this.#monterEditeur();
    else this.#libererColonnes();
  }

  /**
   * Fige la largeur des colonnes pendant la saisie : l'éditeur ne doit pas redimensionner le tableau
   * (effet stroboscopique en passant d'une cellule à l'autre). Relâché au retour en mode ligne.
   */
  #figerColonnes() {
    const table = this.tbody.parentElement;
    if (table.classList.contains('figee')) return;
    const largeurs = [...this.thead.querySelectorAll('th')].map((th) => th.getBoundingClientRect().width);
    const colgroup = document.createElement('colgroup');
    for (const l of largeurs) {
      const col = document.createElement('col');
      col.style.width = `${l}px`;
      colgroup.appendChild(col);
    }
    table.style.width = `${largeurs.reduce((a, b) => a + b, 0)}px`;
    table.prepend(colgroup);
    table.classList.add('figee');
  }

  #libererColonnes() {
    const table = this.tbody.parentElement;
    if (!table.classList.contains('figee')) return;
    table.querySelector('colgroup')?.remove();
    table.style.width = '';
    table.classList.remove('figee');
  }

  /** Insère une référence dans la cellule en cours de saisie (ou démarre la saisie de la colonne indiquée). */
  insererReference(ref, colonneParDefaut) {
    const demarree = !this.edition && colonneParDefaut !== undefined;
    if (demarree) this.editer(colonneParDefaut);
    const champ = this.edition?.champ;
    if (!champ) return false;
    // Saisie tout juste démarrée : le texte existant est sélectionné, on insère à la fin sans le remplacer.
    if (demarree && champ.setSelectionRange) champ.setSelectionRange(champ.value.length, champ.value.length);
    if (this.liste?.inserer) this.liste.inserer(ref);
    else { champ.value += ref; champ.focus(); }
    return true;
  }

  ligneCourante() {
    const i = this.index?.get(this.courant);
    return i === undefined ? null : this.lignesAffichees[i];
  }

  selectionner(id, { etendre = false, colonne = null } = {}) {
    if (!this.index?.has(id)) return;
    if (etendre) {
      const lignes = this.lignesAffichees;
      const a = this.index.get(this.ancre ?? this.courant);
      const b = this.index.get(id);
      this.selection = lignes.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.item[this.o.cle]);
    } else {
      this.selection = [id];
      this.ancre = id;
    }
    this.courant = id;
    if (colonne !== null) this.colonne = colonne;
    this.rendre();
    this.tbody.querySelector(`tr[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  basculer(id) {
    if (this.replies.has(id)) this.replies.delete(id);
    else this.replies.add(id);
    this.rendre();
  }

  focus() {
    this.conteneur.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- édition

  colonnesEditables(item) {
    return this.o.colonnes.map((c, i) => (c.editable?.(item) ? i : -1)).filter((i) => i >= 0);
  }

  editer(colonne = this.colonne, texteInitial = null, { riche = false } = {}) {
    const r = this.ligneCourante();
    if (!r) return;
    const editables = this.colonnesEditables(r.item);
    if (editables.length === 0) return;
    this.colonne = editables.includes(colonne) ? colonne : editables.find((i) => i >= colonne) ?? editables[0];
    const c = this.o.colonnes[this.colonne];
    // Éditeur de mise en forme : au double-clic, ou si le contenu est déjà mis en forme.
    // La frappe directe d'un caractère remplace le contenu, comme dans un tableur.
    if (c.riche && texteInitial === null && (riche || c.riche.auto(r.item))) {
      this.#editerRiche(c, r);
      return;
    }
    this.edition = { id: this.courant, colonne: this.colonne, texteInitial };
    this.rendre();
  }

  async #editerRiche(c, r) {
    this.edition = null;
    this.rendre();
    const id = this.courant;
    const valeur = await c.riche.ouvrir(r.item);
    if (valeur !== undefined) this.o.actions.modifierRiche(id, c.champ(r.item), valeur);
    this.focus();
    // Validé : la saisie en cascade continue sur la cellule suivante.
    if (valeur !== undefined && this.courant === id) this.#celluleSuivante();
  }

  #monterEditeur() {
    const { id, colonne, texteInitial } = this.edition;
    const td = this.tbody.querySelector(`tr[data-id="${id}"] td[data-col="${colonne}"]`);
    const r = this.ligneCourante();
    if (!td || !r) { this.edition = null; return; }
    const c = this.o.colonnes[colonne];
    this.#figerColonnes();
    let champ;
    // Liste de choix (combo) : saisie qui filtre la liste ou désigne directement l'option (libellé ou code).
    const options = c.editeur === 'select' ? c.options(r.item).map((o) => ({ valeur: String(o.valeur ?? ''), libelle: String(o.libelle ?? '') })) : null;
    const courante = String(c.lire(r.item) ?? '');
    if (options) {
      champ = document.createElement('input');
      champ.autocomplete = 'off';
      champ.value = texteInitial ?? (courante === '' ? '' : options.find((o) => o.valeur === courante)?.libelle ?? '');
    } else {
      champ = document.createElement('input');
      champ.value = texteInitial ?? String(c.lire(r.item) ?? '');
      if (c.editeur === 'nombre') champ.inputMode = 'decimal';
      if (c.editeur === 'liste' || c.editeur === 'formule') champ.autocomplete = 'off';
      if (c.editeur === 'formule') champ.spellcheck = false;
    }
    champ.className = 'editeur';
    td.replaceChildren(champ);
    champ.focus();
    if (texteInitial === null && champ.select) champ.select();
    this.#fermerListe();
    if (options) {
      this.liste = new ListeDeroulante(champ, options, { strict: true, courante: texteInitial === null ? courante : null });
      if (texteInitial !== null) this.liste.filtrer(texteInitial);
      this.liste.surChoix = () => this.#valider(champ, 'suivante');
    }
    if (c.editeur === 'liste') {
      // Saisie libre avec liste de choix filtrée sur le texte déjà tapé.
      this.liste = new ListeDeroulante(champ, c.suggestions(r.item));
      if (texteInitial !== null) this.liste.filtrer(texteInitial);
      this.liste.surChoix = () => this.#valider(champ, 'suivante');
    }
    if (c.editeur === 'formule') this.liste = new AssistantFormule(champ, c.suggestions(r.item));
    champ.addEventListener('keydown', (e) => this.#clavierEdition(e, champ));
    champ.addEventListener('blur', () => { if (this.edition?.champ === champ) this.#valider(champ, null); });
    this.edition.champ = champ;
  }

  /** La saisie dans une cellule forme une seule étape, enregistrée à la sortie de la cellule. */
  #fermerListe() {
    this.liste?.detruire();
    this.liste = null;
  }

  #valider(champ, suite) {
    const { id, colonne } = this.edition;
    const c = this.o.colonnes[colonne];
    const r = this.ligneCourante();
    const avant = String(c.lire(r.item) ?? '');
    // Combo : la valeur est l'option reconnue ; un texte qui n'en désigne aucune reste en saisie (invalide).
    const valeur = c.editeur === 'select' ? this.liste?.resoudre() : champ.value;
    this.#fermerListe();
    if (valeur === undefined) {
      this.edition = { id, colonne, texteInitial: champ.value };
      this.rendre();
      this.edition.champ?.classList.add('invalide');
      return;
    }
    this.edition = null;
    if (valeur !== avant) {
      const ok = this.o.actions.modifier(id, c.champ(r.item), valeur, c);
      if (ok === false) {
        this.edition = { id, colonne, texteInitial: champ.value };
        this.rendre();
        this.edition.champ?.classList.add('invalide');
        return;
      }
    }
    if (suite === 'suivante') this.#celluleSuivante();
    else if (suite === 'precedente') this.#cellulePrecedente();
    else this.rendre();
    if (suite && !this.edition) this.focus();
  }

  #celluleSuivante() {
    const r = this.ligneCourante();
    const editables = this.colonnesEditables(r.item);
    const suivante = editables.find((i) => i > this.colonne);
    if (suivante !== undefined) {
      this.editer(suivante);
      return;
    }
    // Après la dernière cellule : nouvelle ligne au même niveau, avec le type de la ligne précédente.
    const id = this.o.actions.inserer('apres', this.courant, { memeType: true });
    if (id !== undefined && id !== null) {
      this.courant = id;
      this.selection = [id];
      this.rendre();
      this.editer(this.colonnesEditables(this.ligneCourante().item)[0]);
    }
  }

  #cellulePrecedente() {
    const r = this.ligneCourante();
    const precedente = this.colonnesEditables(r.item).reverse().find((i) => i < this.colonne);
    if (precedente !== undefined) this.editer(precedente);
    else this.rendre();
  }

  #clavierEdition(e, champ) {
    if (this.liste?.clavier(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); this.#valider(champ, 'suivante'); }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); this.#valider(champ, e.shiftKey ? 'precedente' : 'suivante'); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.#fermerListe(); this.edition = null; this.rendre(); this.focus(); }
    else if (e.key === 'F4') { e.preventDefault(); e.stopPropagation(); this.#valider(champ, null); this.o.actions.ouvrirMetre?.(this.courant); }
    else if (e.key === 'F3') { e.preventDefault(); e.stopPropagation(); this.#valider(champ, null); this.o.actions.rechercher?.(this.courant); }
    else e.stopPropagation();
  }

  // ---------------------------------------------------------------- clavier (mode ligne)

  #deplacerSelection(sens, etendre) {
    const lignes = this.lignesAffichees;
    const i = this.index.get(this.courant) ?? 0;
    const j = Math.max(0, Math.min(lignes.length - 1, i + sens));
    if (!etendre) this.ancre = null;
    else this.ancre ??= this.courant;
    this.selectionner(lignes[j].item[this.o.cle], { etendre });
  }

  #clavier(e) {
    if (this.edition) return;
    const a = this.o.actions;
    const action = actionDe(e);
    const executer = (f) => { e.preventDefault(); f(); };
    switch (action) {
      case 'insererApres': return executer(() => this.#apresInsertion(a.inserer('apres', this.courant)));
      case 'insererAvant': return executer(() => this.#apresInsertion(a.inserer('avant', this.courant)));
      case 'insererEnfant': return executer(() => this.#apresInsertion(a.inserer('enfant', this.courant)));
      case 'monter': return executer(() => a.decaler(this.courant, -1));
      case 'descendre': return executer(() => a.decaler(this.courant, 1));
      case 'indenter': return executer(() => a.indenter(this.selection));
      case 'desindenter': return executer(() => a.desindenter(this.selection));
      case 'etendreHaut': return executer(() => this.#deplacerSelection(-1, true));
      case 'etendreBas': return executer(() => this.#deplacerSelection(1, true));
      case 'couper': return executer(() => a.copier?.(this.selection, true));
      case 'copier': return executer(() => a.copier?.(this.selection, false));
      case 'coller': return executer(() => a.coller?.(this.courant));
      case 'dupliquer': return executer(() => a.dupliquer(this.selection));
      case 'supprimer': return executer(() => a.supprimer(this.selection));
      case 'annuler': return executer(() => a.annuler());
      case 'retablir': return executer(() => a.retablir());
      case 'ouvrirMetre': return executer(() => a.ouvrirMetre?.(this.courant));
      case 'rechercher': return executer(() => a.rechercher?.(this.courant));
      case 'replier': return executer(() => { this.replies.add(this.courant); this.rendre(); });
      case 'deplier': return executer(() => { this.replies.delete(this.courant); this.rendre(); });
      default: break;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowDown': return executer(() => this.#deplacerSelection(1, false));
      case 'ArrowUp': return executer(() => this.#deplacerSelection(-1, false));
      case 'ArrowRight': return executer(() => { this.colonne = Math.min(this.o.colonnes.length - 1, this.colonne + 1); this.rendre(); });
      case 'ArrowLeft': return executer(() => { this.colonne = Math.max(0, this.colonne - 1); this.rendre(); });
      case 'Home': return executer(() => this.selectionner(this.lignesAffichees[0]?.item[this.o.cle]));
      case 'End': return executer(() => this.selectionner(this.lignesAffichees.at(-1)?.item[this.o.cle]));
      case 'F2':
      case 'Enter': return executer(() => this.editer());
      default:
        // Frappe directe : démarre l'édition de la cellule avec le caractère saisi, comme un tableur.
        if (e.key.length === 1) executer(() => this.editer(this.colonne, e.key));
    }
  }

  #apresInsertion(id) {
    if (id === undefined || id === null) return;
    this.courant = id;
    this.selection = [id];
    this.rendre();
    this.editer(this.colonnesEditables(this.ligneCourante()?.item ?? {})[0] ?? 0);
  }

  #clic(e) {
    const tr = e.target.closest('tr[data-id]');
    if (!tr || e.target.closest('.editeur')) return;
    const id = Number(tr.dataset.id);
    const td = e.target.closest('td[data-col]');
    const colonne = td ? Number(td.dataset.col) : null;
    if (this.edition) this.edition.champ?.blur();
    // Double-clic, ou clic sur la cellule déjà active : passage en édition. Le premier clic redessine la
    // grille, le navigateur ne peut donc pas s'appuyer sur l'événement dblclick.
    const celluleActive = id === this.courant && colonne !== null && colonne === this.colonne && this.selection.length === 1;
    if (!e.ctrlKey && !e.shiftKey && colonne !== null && (e.detail >= 2 ? id === this.courant : celluleActive)) {
      e.preventDefault();
      this.colonne = colonne;
      this.editer(colonne, null, { riche: e.detail >= 2 });
      return;
    }
    if (e.ctrlKey) {
      this.selection = this.selection.includes(id) ? this.selection.filter((x) => x !== id) : [...this.selection, id];
      this.courant = id;
      this.rendre();
    } else {
      this.selectionner(id, { etendre: e.shiftKey, colonne: td ? Number(td.dataset.col) : null });
    }
    setTimeout(() => this.focus());
  }

  // ---------------------------------------------------------------- glisser-déposer (Pointer Events)

  /** Cible de dépôt sous le pointeur : ligne et position (tiers haut avant, tiers bas après, milieu enfant). */
  #cibleSous(x, y) {
    const tr = document.elementFromPoint(x, y)?.closest?.('tr[data-id]');
    if (!tr || !this.tbody.contains(tr)) return null;
    const r = tr.getBoundingClientRect();
    const t = (y - r.top) / r.height;
    return { tr, cibleId: Number(tr.dataset.id), position: t < 1 / 3 ? 'avant' : t > 2 / 3 ? 'apres' : 'enfant' };
  }

  /** Marque la ligne cible et affiche le badge près du pointeur (comment la ligne sera intégrée). */
  #indiquerDepot(cible, autorise, x, y) {
    this.tbody.querySelectorAll('.depot-avant,.depot-apres,.depot-enfant,.depot-interdit')
      .forEach((t) => t.classList.remove('depot-avant', 'depot-apres', 'depot-enfant', 'depot-interdit'));
    if (!cible) { this.badge?.remove(); this.badge = null; return; }
    cible.tr.classList.add(autorise ? `depot-${cible.position}` : 'depot-interdit');
    if (!this.badge) {
      this.badge = document.createElement('div');
      this.badge.className = 'badge-depot';
      document.body.append(this.badge);
    }
    this.badge.classList.toggle('interdit', !autorise);
    this.badge.textContent = autorise ? (this.o.actions.libelleDepot?.(cible.cibleId, cible.position) ?? cible.position) : 'Dépôt impossible ici';
    this.badge.style.left = `${x + 14}px`;
    this.badge.style.top = `${y + 16}px`;
  }

  #finDepot() {
    this.#indiquerDepot(null);
    this.conteneur.classList.remove('glissement-externe');
  }

  #survolExterne(e) {
    const ext = this.o.actions.depotExterne;
    const types = [...(e.dataTransfer?.types ?? [])];
    if (!ext || !types.some((t) => ext.types.includes(t))) return;
    const cible = this.#cibleSous(e.clientX, e.clientY);
    const autorise = Boolean(cible) && ext.autorise(cible.cibleId, cible.position, types);
    this.conteneur.classList.add('glissement-externe');
    this.#indiquerDepot(cible, autorise, e.clientX, e.clientY);
    // Défilement automatique près des bords.
    const rect = this.conteneur.getBoundingClientRect();
    if (e.clientY < rect.top + 40) this.conteneur.scrollTop -= 12;
    else if (e.clientY > rect.bottom - 40) this.conteneur.scrollTop += 12;
    if (autorise) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  }

  #depotExterne(e) {
    const ext = this.o.actions.depotExterne;
    const cible = this.#cibleSous(e.clientX, e.clientY);
    const types = [...(e.dataTransfer?.types ?? [])];
    this.#finDepot();
    if (!ext || !cible || !types.some((t) => ext.types.includes(t)) || !ext.autorise(cible.cibleId, cible.position, types)) return;
    e.preventDefault();
    ext.deposer(cible.cibleId, cible.position, e.dataTransfer);
    this.focus();
  }

  #debutGlisser(e) {
    const poignee = e.target.closest('td.poignee');
    if (!poignee || e.button !== 0) return;
    const tr = poignee.closest('tr[data-id]');
    const id = Number(tr.dataset.id);
    if (!this.selection.includes(id)) this.selectionner(id);
    e.preventDefault();
    const ids = [...this.selection];
    const conteneur = this.conteneur;
    let cible = null;
    let defilement = 0;
    let rafId = 0;
    conteneur.classList.add('glissement');

    const nettoyer = () => this.tbody.querySelectorAll('.depot-avant,.depot-apres,.depot-enfant,.depot-interdit')
      .forEach((x) => x.classList.remove('depot-avant', 'depot-apres', 'depot-enfant', 'depot-interdit'));

    const defiler = () => {
      if (defilement !== 0) conteneur.scrollTop += defilement;
      rafId = requestAnimationFrame(defiler);
    };
    rafId = requestAnimationFrame(defiler);

    const bouger = (ev) => {
      const rect = conteneur.getBoundingClientRect();
      // Défilement automatique près des bords de la grille.
      defilement = ev.clientY < rect.top + 40 ? -12 : ev.clientY > rect.bottom - 40 ? 12 : 0;
      nettoyer();
      // Tiers haut = avant, tiers bas = après, milieu = enfant ; badge : comment la ligne sera intégrée.
      const c = this.#cibleSous(ev.clientX, ev.clientY);
      const autorise = Boolean(c) && this.o.actions.depotAutorise(ids, c.cibleId, c.position);
      this.#indiquerDepot(c, autorise, ev.clientX, ev.clientY);
      cible = autorise ? { cibleId: c.cibleId, position: c.position } : null;
    };

    const finir = () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('pointermove', bouger);
      document.removeEventListener('pointerup', finir);
      document.removeEventListener('pointercancel', finir);
      conteneur.classList.remove('glissement');
      nettoyer();
      this.#indiquerDepot(null);
      if (cible) this.o.actions.deplacer(ids, cible.cibleId, cible.position);
      this.focus();
    };
    document.addEventListener('pointermove', bouger);
    document.addEventListener('pointerup', finir);
    document.addEventListener('pointercancel', finir);
  }
}
