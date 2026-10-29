import { echapper, lireStockage, ecrireStockage } from '@logibtp/socle/ui';

// Panneau des arbres d'une liste d'éléments (logé dans le panneau ancrable de la liste, option panneau) : familles par
// bibliothèque et natures par regroupement, en deux parties séparées par un délimiteur déplaçable. Sélection multiple ;
// cocher un parent retient tous ses enfants. Les filtres portent sur fam_id et nat_id (appliqués par la base) ; les
// comptes suivent la recherche et les autres filtres, et les branches vides peuvent être masquées.

const SANS = '∅'; // nœud « sans famille » / « sans nature » : valeur nulle

export class PanneauArbres {
  constructor({ conteneur, liste, fournisseur, cle = 'logibtp.bibliotheque.arbres' }) {
    this.conteneur = conteneur;
    this.liste = liste;
    this.fournisseur = fournisseur;
    this.cle = cle;
    this.prefs = { masquerVides: false, ratio: 0.6, ouverts: [], ...this.#lire() };
    this.ouverts = new Set(this.prefs.ouverts);
    this.selection = { fam: new Set(), nat: new Set() };
    this.comptes = { fam: new Map(), nat: new Map() };
    this.arbres = { fam: [], nat: [] };
    conteneur.classList.add('bib-arbres');
    conteneur.innerHTML = `
      <div class="bib-arbre-partie" data-partie="fam"><header><span>🌳 Familles</span><small data-resume></small>
        <button type="button" data-vides title="Masquer les familles et les natures sans élément pour la recherche et les filtres en cours">◌ Masquer vides</button>
        <button type="button" data-effacer title="Toutes les familles">✕</button></header><ul class="bib-arbre" role="tree"></ul></div>
      <div class="bib-arbre-separateur" title="Glisser pour répartir familles et natures"></div>
      <div class="bib-arbre-partie" data-partie="nat"><header><span>🏷️ Natures</span><small data-resume></small>
        <button type="button" data-effacer title="Toutes les natures">✕</button></header><ul class="bib-arbre" role="tree"></ul></div>`;
    this.#appliquerRatio();
    this.#separateur(conteneur.querySelector('.bib-arbre-separateur'));
    conteneur.addEventListener('click', (e) => this.#clic(e));
    conteneur.addEventListener('change', (e) => {
      const c = e.target.closest('input[data-k]');
      if (c) this.#cocher(c.closest('[data-partie]').dataset.partie, c.dataset.k, c.checked);
    });
    this.charger().catch((e) => console.error(e));
  }

  #lire() { return lireStockage(this.cle, {}); }
  #ecrire() { ecrireStockage(this.cle, { ...this.prefs, ouverts: [...this.ouverts] }); }

  /** Arbres : familles sous leur bibliothèque, natures sous leur regroupement ; nœuds « sans ». */
  async charger() {
    const [bibs, familles, natures, regroupements] = await Promise.all([
      this.fournisseur.bibliotheques(), this.fournisseur.familles(), this.fournisseur.natures(), this.fournisseur.regroupements()]);
    const sousFamilles = (bibId, parent) => familles.filter((f) => f.bib_id === bibId && (f.parent_id ?? null) === parent)
      .sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, 'fr'))
      .map((f) => ({ k: `f${f.id}`, valeur: String(f.id), libelle: f.libelle, enfants: sousFamilles(bibId, f.id) }));
    this.arbres.fam = [
      ...bibs.map((b) => ({ k: `b${b.id}`, libelle: `${b.code} – ${b.libelle}`, bibliotheque: true, enfants: sousFamilles(b.id, null) })),
      { k: 'f∅', valeur: null, libelle: '(sans famille)', enfants: [] },
    ];
    this.arbres.nat = [
      ...regroupements.map((r) => ({
        k: `r${r.code}`, libelle: r.libelle, enfants: natures.filter((n) => n.regroupement === r.code).map((n) => ({ k: `n${n.id}`, valeur: String(n.id), libelle: n.libelle, enfants: [] })),
      })).filter((r) => r.enfants.length),
      ...natures.filter((n) => !n.regroupement || !regroupements.some((r) => r.code === n.regroupement)).map((n) => ({ k: `n${n.id}`, valeur: String(n.id), libelle: n.libelle, enfants: [] })),
      { k: 'n∅', valeur: null, libelle: '(sans nature)', enfants: [] },
    ];
    if (!this.prefs.ouverts.length) for (const n of this.arbres.fam) this.ouverts.add(n.k);
    await this.rafraichir();
  }

  /** Comptes par famille et par nature pour la recherche et les autres filtres de la liste (sans leur propre filtre). */
  async rafraichir() {
    if (!this.arbres.fam.length) return;
    const d = this.liste.demande();
    const [fam, nat] = await Promise.all([this.liste.fournisseur.segments(d, 'fam_id').catch(() => []), this.liste.fournisseur.segments(d, 'nat_id').catch(() => [])]);
    this.comptes.fam = new Map(fam.map((c) => [c.valeur === null ? SANS : String(c.valeur), c.nombre]));
    this.comptes.nat = new Map(nat.map((c) => [c.valeur === null ? SANS : String(c.valeur), c.nombre]));
    this.rendre();
  }

  #total(partie, n) {
    const propre = n.valeur === undefined ? 0 : this.comptes[partie].get(n.valeur === null ? SANS : n.valeur) ?? 0;
    return propre + n.enfants.reduce((t, x) => t + this.#total(partie, x), 0);
  }

  /** Clés de valeur d'un nœud et de ses descendants. */
  #valeurs(n) { return [...(n.valeur !== undefined ? [n.k] : []), ...n.enfants.flatMap((x) => this.#valeurs(x))]; }

  #trouver(noeuds, k) {
    for (const n of noeuds) {
      if (n.k === k) return n;
      const x = this.#trouver(n.enfants, k);
      if (x) return x;
    }
    return null;
  }

  rendre() {
    for (const partie of ['fam', 'nat']) {
      const ul = this.conteneur.querySelector(`[data-partie="${partie}"] .bib-arbre`);
      ul.innerHTML = this.arbres[partie].map((n) => this.#noeud(partie, n)).join('') || '<li class="aide">Aucune entrée</li>';
      ul.querySelectorAll('input[data-indet="1"]').forEach((c) => { c.indeterminate = true; });
      const n = this.selection[partie].size;
      this.conteneur.querySelector(`[data-partie="${partie}"] [data-resume]`).textContent = n ? `${n} retenue${n > 1 ? 's' : ''}` : '';
    }
    this.conteneur.querySelector('[data-vides]').classList.toggle('actif', this.prefs.masquerVides);
  }

  #noeud(partie, n) {
    const total = this.#total(partie, n);
    if (this.prefs.masquerVides && total === 0 && !this.#valeurs(n).some((k) => this.selection[partie].has(k))) return '';
    const cles = this.#valeurs(n);
    const retenues = cles.filter((k) => this.selection[partie].has(k)).length;
    const coche = cles.length > 0 && retenues === cles.length;
    const partiel = retenues > 0 && !coche;
    const ouvert = this.ouverts.has(n.k);
    const enfants = n.enfants.map((x) => this.#noeud(partie, x)).join('');
    return `<li role="treeitem" aria-expanded="${n.enfants.length ? ouvert : ''}" class="${total === 0 ? 'vide' : ''}">
      <div class="bib-noeud"><span class="bib-ouvrir" data-ouvrir="${echapper(n.k)}">${n.enfants.length ? (ouvert ? '▾' : '▸') : ''}</span>
        <label><input type="checkbox" data-k="${echapper(n.k)}" ${coche ? 'checked' : ''} ${partiel ? 'data-indet="1"' : ''} ${cles.length ? '' : 'disabled'}>
        <span class="${n.bibliotheque ? 'bib-noeud-bib' : ''}">${echapper(n.libelle)}</span></label><small>${total}</small></div>
      ${n.enfants.length && ouvert ? `<ul>${enfants}</ul>` : ''}</li>`;
  }

  /** Cocher un nœud retient lui et tous ses descendants ; décocher les retire. */
  #cocher(partie, k, actif) {
    const n = this.#trouver(this.arbres[partie], k);
    if (!n) return;
    for (const v of this.#valeurs(n)) (actif ? this.selection[partie].add(v) : this.selection[partie].delete(v));
    this.#appliquer(partie);
  }

  #appliquer(partie) {
    const valeurs = [...this.selection[partie]].map((k) => this.#trouver(this.arbres[partie], k)?.valeur).filter((v) => v !== undefined);
    this.rendre();
    this.liste.definirFiltreExterne(partie === 'fam' ? 'fam_id' : 'nat_id', valeurs);
  }

  #clic(e) {
    const o = e.target.closest('[data-ouvrir]');
    if (o && o.textContent) {
      const k = o.dataset.ouvrir;
      if (this.ouverts.has(k)) this.ouverts.delete(k); else this.ouverts.add(k);
      this.#ecrire();
      this.rendre();
      return;
    }
    if (e.target.closest('[data-vides]')) {
      this.prefs.masquerVides = !this.prefs.masquerVides;
      this.#ecrire();
      this.rendre();
      return;
    }
    const effacer = e.target.closest('[data-effacer]');
    if (effacer) {
      const partie = effacer.closest('[data-partie]').dataset.partie;
      this.selection[partie].clear();
      this.#appliquer(partie);
    }
  }

  #appliquerRatio() {
    this.conteneur.style.setProperty('--bib-arbres-ratio', String(this.prefs.ratio));
  }

  /** Délimiteur entre familles et natures : vertical en panneau latéral, horizontal en panneau du bas. */
  #separateur(sep) {
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sep.setPointerCapture(e.pointerId);
      const rect = this.conteneur.getBoundingClientRect();
      const horizontal = getComputedStyle(this.conteneur).flexDirection === 'row';
      const bouger = (ev) => {
        const r = horizontal ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        this.prefs.ratio = Math.min(Math.max(r, 0.15), 0.85);
        this.#appliquerRatio();
      };
      const finir = () => {
        sep.removeEventListener('pointermove', bouger);
        sep.removeEventListener('pointerup', finir);
        this.#ecrire();
      };
      sep.addEventListener('pointermove', bouger);
      sep.addEventListener('pointerup', finir);
    });
  }

  detruire() { this.conteneur.replaceChildren(); }
}
