import { echapper } from './format.js';

const normaliser = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Liste de choix attachée à un champ texte : la saisie reste libre, la liste propose les valeurs
 * existantes filtrées sur le texte déjà tapé (code ou libellé, sans tenir compte des accents).
 * ↑ / ↓ : parcourir · Entrée ou Tab : retenir la proposition active · Échap : fermer la liste.
 * La liste est placée dans <body> pour ne pas être rognée par le défilement de la grille.
 *
 * Mode strict (combo, `{ strict: true, courante }`) : le champ montre le libellé, la valeur retenue est celle de
 * l'option (identifiant) ; la saisie filtre la liste et la première proposition est active ; `resoudre()` donne la
 * valeur choisie ou reconnue dans le texte (libellé ou code exact, ou seule option restante), sinon undefined.
 */
export class ListeDeroulante {
  constructor(champ, options, { strict = false, courante = null } = {}) {
    this.champ = champ;
    this.options = options; // [{ valeur, libelle, detail? }]
    this.strict = strict;
    this.valeurChoisie = strict ? courante : undefined;
    this.initiale = champ.value;
    this.actif = -1;
    this.filtrees = [];
    this.popup = document.createElement('div');
    this.popup.className = 'liste-deroulante';
    this.popup.setAttribute('role', 'listbox');
    // Dans une fenêtre modale (couche supérieure), la liste y est rattachée pour s'afficher au-dessus d'elle.
    (champ.closest?.('dialog[open]') ?? document.body).appendChild(this.popup);
    this.popup.addEventListener('mousedown', (e) => {
      e.preventDefault(); // garde le focus dans le champ
      const li = e.target.closest('[data-index]');
      if (li) this.choisir(Number(li.dataset.index), true);
    });
    champ.addEventListener('input', () => {
      if (this.strict) this.valeurChoisie = undefined; // texte modifié : la valeur est à reconnaître
      this.filtrer(champ.value);
    });
    this.surChoix = null;
    // Clic dans le champ, même en saisie : liste fermée → toute la liste (valeur courante en évidence) ; liste ouverte
    // et clic sur la flèche (bord droit) → fermée. Évite de quitter le champ pour rouvrir la liste après un choix.
    this.surClic = (e) => {
      const fleche = e.clientX > champ.getBoundingClientRect().right - 24;
      if (this.ouverte) { if (fleche) this.fermer(); return; }
      this.filtrer('', { courante: this.strict ? this.valeurChoisie ?? null : champ.value });
    };
    champ.addEventListener('click', this.surClic);
    // Valeur d'origine sélectionnée : toute la liste est proposée, la valeur courante en évidence.
    this.filtrer('', { courante: strict ? courante : champ.value });
  }

  /** Mode strict : valeur choisie, ou reconnue dans le texte saisi ; undefined si le texte ne désigne aucune option. */
  resoudre() {
    if (this.valeurChoisie !== undefined) return this.valeurChoisie;
    const t = normaliser(this.champ.value).trim();
    const vide = this.options.find((o) => o.valeur === '' || o.valeur === null);
    if (!t) return vide ? vide.valeur : undefined;
    const code = (o) => normaliser(String(o.libelle).split(' – ')[0]);
    const exacte = this.options.find((o) => normaliser(o.libelle) === t || code(o) === t || normaliser(o.valeur) === t);
    if (exacte) return exacte.valeur;
    const restantes = this.options.filter((o) => o !== vide && normaliser(o.libelle).includes(t));
    return restantes.length === 1 ? restantes[0].valeur : undefined;
  }

  get ouverte() {
    return !this.popup.hidden && this.filtrees.length > 0;
  }

  filtrer(texte, { courante = null } = {}) {
    const t = normaliser(texte);
    const rang = (o) => {
      if (this.strict) {
        const l = normaliser(o.libelle);
        if (!t) return 3;
        return l === t ? 0 : l.startsWith(t) ? 1 : l.includes(t) ? 2 : -1;
      }
      const code = normaliser(o.valeur);
      if (!t) return 3;
      if (code === t) return 0;
      if (code.startsWith(t)) return 1;
      if (code.includes(t) || normaliser(o.libelle).includes(t)) return 2;
      return -1;
    };
    // Options regroupées (propriété `groupe`) : les groupes gardent leur ordre, le rang trie à l'intérieur.
    const groupes = new Map();
    for (const o of this.options) if (!groupes.has(o.groupe ?? '')) groupes.set(o.groupe ?? '', groupes.size);
    this.filtrees = this.options
      .map((o, i) => ({ o, r: rang(o), i, g: groupes.get(o.groupe ?? '') }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.g - b.g || a.r - b.r || a.i - b.i)
      .map((x) => x.o);
    // Proposition active seulement si le code commence par la saisie : une saisie libre
    // qui ne correspond qu'à un libellé n'est pas remplacée par Entrée.
    if (courante !== null) this.actif = this.filtrees.findIndex((o) => o.valeur === courante);
    else if (this.strict) this.actif = t && this.filtrees.length ? 0 : -1;
    else this.actif = t && this.filtrees.length && normaliser(this.filtrees[0].valeur).startsWith(t) ? 0 : -1;
    this.rendre();
  }

  rendre() {
    if (this.filtrees.length === 0) { this.popup.hidden = true; return; }
    this.popup.hidden = false;
    // Titre de groupe avant la première option de chaque groupe (options regroupées : propriété `groupe`).
    const titres = this.filtrees.map((o, i) => (o.groupe && o.groupe !== this.filtrees[i - 1]?.groupe ? `<p class="groupe">${echapper(o.groupe)}</p>` : ''));
    this.popup.innerHTML = this.filtrees.map((o, i) => `${titres[i]}
      <div role="option" data-index="${i}" class="${i === this.actif ? 'active' : ''}" aria-selected="${i === this.actif}">
        ${this.strict ? '' : `<strong>${echapper(o.valeur)}</strong>`}<span>${o.couleur ? `<i class="pastille-option" style="background:${echapper(o.couleur)}"></i>` : ''}${echapper(o.libelle)}</span>${o.detail ? `<em>${echapper(o.detail)}</em>` : ''}
      </div>`).join('');
    this.positionner();
    this.popup.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  positionner() {
    const r = this.champ.getBoundingClientRect();
    const hauteur = Math.min(this.popup.scrollHeight, 260);
    const enDessous = window.innerHeight - r.bottom > hauteur + 8 || r.top < hauteur + 8;
    this.popup.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 260))}px`;
    this.popup.style.top = enDessous ? `${r.bottom + 2}px` : `${r.top - hauteur - 2}px`;
    this.popup.style.minWidth = `${Math.max(r.width, 220)}px`;
  }

  deplacer(sens) {
    if (!this.filtrees.length) return;
    this.popup.hidden = false;
    this.actif = (this.actif + sens + this.filtrees.length) % this.filtrees.length;
    this.rendre();
  }

  /** Reporte la proposition dans le champ ; `valider` : le choix à la souris valide la cellule. */
  choisir(index, valider = false) {
    const o = this.filtrees[index];
    if (!o) return false;
    if (this.strict) {
      this.champ.value = o.valeur === '' || o.valeur === null ? '' : o.libelle;
      this.valeurChoisie = o.valeur;
    } else this.champ.value = o.valeur;
    this.fermer();
    if (valider) this.surChoix?.();
    return true;
  }

  /** Gestion du clavier ; renvoie vrai si l'événement a été consommé par la liste. */
  clavier(e) {
    if (e.key === 'F4' || (e.key === 'ArrowDown' && e.altKey)) {
      if (this.ouverte) this.fermer(); else this.filtrer('', { courante: this.strict ? this.valeurChoisie ?? null : this.champ.value });
      return true;
    }
    if (e.key === 'ArrowDown') { this.deplacer(1); return true; }
    if (e.key === 'ArrowUp') { this.deplacer(-1); return true; }
    if ((e.key === 'Enter' || e.key === 'Tab') && this.ouverte && this.actif >= 0) { this.choisir(this.actif); return false; }
    if (e.key === 'Escape' && this.ouverte) { this.fermer(); return true; }
    return false;
  }

  fermer() {
    this.popup.hidden = true;
  }

  detruire() {
    this.champ.removeEventListener('click', this.surClic);
    this.popup.remove();
  }
}

/**
 * Assistant de saisie d'une formule : `{{` (ou Ctrl+Espace) ouvre la liste des variables et données
 * utilisables, filtrée sur le texte tapé après `{{` ; le choix insère la référence à la place.
 */
export class AssistantFormule {
  constructor(champ, options) {
    this.champ = champ;
    this.options = options;
    this.actif = -1;
    this.filtrees = [];
    this.debut = -1;
    this.popup = document.createElement('div');
    this.popup.className = 'liste-deroulante';
    this.popup.setAttribute('role', 'listbox');
    this.popup.hidden = true;
    // Dans une fenêtre modale (couche supérieure), la liste y est rattachée pour s'afficher au-dessus d'elle.
    (champ.closest?.('dialog[open]') ?? document.body).appendChild(this.popup);
    this.popup.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const li = e.target.closest('[data-index]');
      if (li) this.choisir(Number(li.dataset.index));
    });
    champ.addEventListener('input', () => this.analyser(false));
  }

  get ouverte() {
    return !this.popup.hidden;
  }

  /** Cherche un `{{` non refermé avant le curseur ; `forcer` : ouvre la liste même sans `{{`. */
  analyser(forcer) {
    const avant = this.champ.value.slice(0, this.champ.selectionStart ?? this.champ.value.length);
    const m = /\{\{([^{}]*)$/.exec(avant);
    if (!m && !forcer) { this.fermer(); return; }
    this.debut = m ? m.index : avant.length;
    const t = normaliser(m ? m[1] : '');
    this.filtrees = this.options.filter((o) => !t || normaliser(o.valeur).includes(t) || normaliser(o.libelle).includes(t));
    this.actif = this.filtrees.length ? 0 : -1;
    this.rendre();
  }

  rendre() {
    if (!this.filtrees.length) { this.fermer(); return; }
    this.popup.hidden = false;
    let groupe = null;
    this.popup.innerHTML = this.filtrees.map((o, i) => {
      const titre = o.groupe && o.groupe !== groupe ? `<p class="groupe">${echapper(o.groupe)}</p>` : '';
      groupe = o.groupe;
      return `${titre}<div role="option" data-index="${i}" class="${i === this.actif ? 'active' : ''}">
        <strong>${echapper(o.valeur)}</strong><span>${echapper(o.libelle)}</span><em>${echapper(String(o.detail ?? ''))}</em></div>`;
    }).join('');
    ListeDeroulante.prototype.positionner.call(this);
    this.popup.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  choisir(index) {
    const o = this.filtrees[index];
    if (!o) return false;
    const fin = this.champ.selectionStart ?? this.champ.value.length;
    this.champ.value = this.champ.value.slice(0, this.debut) + o.valeur + this.champ.value.slice(fin);
    const pos = this.debut + o.valeur.length;
    this.champ.setSelectionRange(pos, pos);
    this.fermer();
    return true;
  }

  /** Insère une référence au curseur (clic dans le dictionnaire). */
  inserer(ref) {
    const d = this.champ.selectionStart ?? this.champ.value.length;
    const f = this.champ.selectionEnd ?? d;
    this.champ.value = this.champ.value.slice(0, d) + ref + this.champ.value.slice(f);
    this.champ.setSelectionRange(d + ref.length, d + ref.length);
    this.champ.focus();
  }

  clavier(e) {
    if (e.key === ' ' && e.ctrlKey) { this.analyser(true); return true; }
    if (!this.ouverte) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = this.filtrees.length;
      this.actif = (this.actif + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.rendre();
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && this.actif >= 0) { this.choisir(this.actif); return true; }
    if (e.key === 'Escape') { this.fermer(); return true; }
    return false;
  }

  fermer() {
    this.popup.hidden = true;
  }

  detruire() {
    this.popup.remove();
  }
}
