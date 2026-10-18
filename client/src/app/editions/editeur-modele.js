import { creerCombo, echapper } from '@logibtp/socle/ui';
import { verifierModele } from '@logibtp/edition';
import { api } from '../api.js';

/**
 * Éditeur du modèle dans l'aperçu (administrateur, `/edition?…&editer=1`) : contenu JSON du rapport, de ses blocs liés
 * et de ses sous-rapports, avec les données et les paramètres de l'aperçu en cours. « Appliquer » remplace le contenu
 * en mémoire et relance la mise en page du navigateur (rien n'est enregistré) ; « Vérifier » fait contrôler le modèle
 * par le moteur du serveur ; « Enregistrer » écrit le modèle (nouvelle version, impacts des blocs signalés).
 * En attendant le concepteur (lot 7).
 */
export class EditeurModeleApercu {
  /**
   * @param conteneur élément du panneau
   * @param page PageEdition (prep, rendre(), app)
   */
  constructor(conteneur, page) {
    this.conteneur = conteneur;
    this.page = page;
    this.origines = new Map(); // code → contenu d'origine (JSON) pour « Rétablir »
    this.modifies = new Set();
    this.courant = null;
  }

  /** Éléments modifiables : le rapport, ses blocs, ses sous-rapports (fermeture fournie par le serveur). */
  elements() {
    const p = this.page.prep;
    return [
      { code: p.modele.code, libelle: `Rapport ${p.modele.code}`, genre: 'RAPPORT', lire: () => p.modele.contenu, ecrire: (c) => { p.modele.contenu = c; } },
      ...Object.keys(p.blocs ?? {}).sort().map((code) => ({ code, libelle: `Bloc ${code}`, genre: 'BLOC', lire: () => p.blocs[code], ecrire: (c) => { p.blocs[code] = c; } })),
      ...Object.keys(p.rapports ?? {}).sort().map((code) => ({ code, libelle: `Sous-rapport ${code}`, genre: 'RAPPORT', lire: () => p.rapports[code], ecrire: (c) => { p.rapports[code] = c; } })),
    ];
  }

  /** Construit le panneau (après chaque préparation : un autre modèle peut avoir été choisi). */
  construire() {
    const elements = this.elements();
    for (const e of elements) if (!this.origines.has(e.code)) this.origines.set(e.code, JSON.stringify(e.lire()));
    if (!elements.some((e) => e.code === this.courant)) this.courant = elements[0]?.code ?? null;
    this.conteneur.innerHTML = `
      <div class="edition-editeur-barre">
        <strong>✎ Modèle</strong> <span data-combo="element"></span>
      </div>
      <textarea class="edition-editeur-texte" spellcheck="false" data-zone="texte"></textarea>
      <div class="edition-editeur-actions">
        <button data-action="appliquer" class="principal" title="Remplacer le contenu en mémoire et refaire l'aperçu (Ctrl+Entrée) ; rien n'est enregistré">▶ Appliquer</button>
        <button data-action="verifier" title="Contrôle du modèle par le moteur du serveur (formules, format)">✔ Vérifier</button>
        <button data-action="enregistrer" title="Enregistrer ce modèle en base (nouvelle version)">💾 Enregistrer</button>
        <button data-action="retablir" title="Revenir au contenu lu à l'ouverture">↺ Rétablir</button>
      </div>
      <div class="edition-editeur-message" data-zone="message"></div>
      <p class="aide">Données de l'aperçu : <code>${echapper(Object.keys(this.page.prep.donnees ?? {}).join(', '))}</code></p>`;
    const combo = creerCombo({ options: elements.map((e) => ({ valeur: e.code, libelle: `${this.modifies.has(e.code) ? '● ' : ''}${e.libelle}` })), valeur: this.courant, vide: false });
    combo.addEventListener('change', () => { this.courant = combo.valeurCombo; this.afficher(); });
    this.conteneur.querySelector('[data-combo="element"]').replaceChildren(combo);
    const texte = this.texte();
    texte.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.appliquer(); }
      // Tabulation : indentation dans la zone de saisie plutôt que changement de champ.
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const { selectionStart: d, selectionEnd: f, value } = texte;
        texte.value = `${value.slice(0, d)}  ${value.slice(f)}`;
        texte.selectionStart = texte.selectionEnd = d + 2;
      }
    });
    this.conteneur.querySelector('.edition-editeur-actions').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const action = { appliquer: () => this.appliquer(), verifier: () => this.verifier(), enregistrer: () => this.enregistrer(), retablir: () => this.retablir() }[b.dataset.action];
      Promise.resolve(action?.()).catch((x) => this.message(x.message, 'erreur'));
    });
    this.afficher();
  }

  texte() { return this.conteneur.querySelector('[data-zone="texte"]'); }

  element() { return this.elements().find((e) => e.code === this.courant); }

  afficher() {
    const e = this.element();
    this.texte().value = e ? JSON.stringify(e.lire(), null, 2) : '';
    this.message('');
  }

  message(texte, genre = 'info') {
    const z = this.conteneur.querySelector('[data-zone="message"]');
    z.className = `edition-editeur-message ${genre}`;
    z.innerHTML = texte;
  }

  /** Contenu saisi (JSON) ; erreur de syntaxe signalée avec sa position. */
  lire() {
    try {
      return JSON.parse(this.texte().value);
    } catch (x) {
      throw new Error(`JSON invalide : ${x.message}`);
    }
  }

  /** Contrôle local (moteur du navigateur) : liste des erreurs, vide si le modèle est correct. */
  static erreurs(contenu) {
    const r = verifierModele(contenu);
    return Array.isArray(r) ? r : (r?.erreurs ?? []);
  }

  async appliquer() {
    const contenu = this.lire();
    const e = this.element();
    const erreurs = EditeurModeleApercu.erreurs(contenu);
    e.ecrire(contenu);
    if (JSON.stringify(contenu) !== this.origines.get(e.code)) this.modifies.add(e.code); else this.modifies.delete(e.code);
    await this.page.rendre();
    this.message(erreurs.length ? `⚠ Appliqué avec ${erreurs.length} erreur(s) :${liste(erreurs)}` : `Appliqué (aperçu refait en ${this.page.$('[data-zone="pages"]').dataset.duree} ms) : non enregistré`, erreurs.length ? 'avertissement' : 'succes');
  }

  async verifier() {
    const r = await api.editions.verifier(this.lire());
    const erreurs = Array.isArray(r) ? r : (r?.erreurs ?? []);
    this.message(erreurs.length ? `⛔ ${erreurs.length} erreur(s) :${liste(erreurs)}` : '✔ Modèle correct (contrôle du serveur)', erreurs.length ? 'erreur' : 'succes');
  }

  async enregistrer() {
    const contenu = this.lire();
    const e = this.element();
    const m = await api.editions.modele(e.code);
    const impacts = e.genre === 'BLOC' || e.code !== this.page.prep.modele.code ? await api.editions.impacts(e.code).catch(() => []) : [];
    const avis = impacts.length ? `\n\nUtilisé aussi par : ${impacts.map((x) => x.libelle ?? x.code).join(', ')}.` : '';
    if (m.fourni && !globalThis.confirm?.(`${e.code} est un modèle fourni : l'enregistrer le marque modifié localement.${avis}\n\nEnregistrer ?`)) return;
    if (!m.fourni && avis && !globalThis.confirm?.(`Enregistrer ${e.code} ?${avis}`)) return;
    const r = await api.editions.enregistrerModele(e.code, {
      libelle: contenu.libelle ?? m.libelle, genre: m.genre, cible: m.cible, source: m.source, types: m.types, contenu,
      niveau_acces: m.niveau_acces, acces_profils: m.acces_profils, charte: m.charte, actif: m.actif, ordre: m.ordre,
    });
    e.ecrire(contenu);
    this.origines.set(e.code, JSON.stringify(contenu));
    this.modifies.delete(e.code);
    await this.page.rendre();
    this.message(`💾 ${echapper(e.code)} enregistré${r?.version ? ` (version ${r.version})` : ''}`, 'succes');
  }

  async retablir() {
    const e = this.element();
    const origine = this.origines.get(e.code);
    if (!origine) return;
    e.ecrire(JSON.parse(origine));
    this.modifies.delete(e.code);
    this.afficher();
    await this.page.rendre();
    this.message('Contenu d’origine rétabli', 'info');
  }
}

const liste = (erreurs) => `<ul>${erreurs.map((x) => `<li>${echapper(typeof x === 'string' ? x : `${x.chemin ?? x.code ?? ''} ${x.message ?? JSON.stringify(x)}`)}</li>`).join('')}</ul>`;
