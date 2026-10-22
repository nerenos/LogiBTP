import { echapper, lireNombre, creerCombo, ouvrirMenuContextuel } from '@logibtp/socle/ui';
import { ModeleVue, normaliserDefinition, vraiDonnee } from '../src/modele.js';
import { filtreActif, correspond, comparerValeurs, estNumerique } from '../src/filtres.js';
import { calculerLargeurs } from '../src/largeurs.js';
import { comptesSegment } from '../src/requete.js';
import { FormatsCellule, appliquerStyle, alignement } from './formats.js';
import { ouvrirMenuFiltre, fermerMenuFiltre } from './menu-filtre.js';
import { ConcepteurVue, libelleFiltreVue } from './concepteur.js';
import { GestionThemes } from './themes.js';

const LARGEUR_COIN = 30;
const DELAI_RECHERCHE = 350;
const DUREE_MARQUE = 4000;

/**
 * Liste de données (classe mère) : chargement par lots au défilement, recherche « contient » et segments
 * appliqués par la base, tri (lignes chargées ou toute la base), filtres de colonnes façon tableur sur les
 * lignes chargées, rafraîchissement ciblé et contrôle périodique des lignes ajoutées, modifiées ou supprimées.
 *
 * Options : fournisseur (FournisseurApi / FournisseurMemoire), contexte (vues proposées), ouvrir({ id, type, ligne, nouvelleFenetre }), surVue({ theme, vue }),
 * panneau({ vue, conteneur, liste }) : composant propre à la vue logé dans le panneau ancrable (arbres de filtres…),
 * message(texte, niveau), peutRequete (requête manuelle dans le concepteur), intervalleControle (ms, 0 = jamais),
 * formats (FormatsCellule ou dérivée), cleVue (clé localStorage des préférences d'affichage),
 * peutGererThemes (création et modification des thèmes, profil ADMIN), creation(vue) → { libelle, action } ou null
 * (bouton de création d'un élément, fourni par l'application selon la vue), actionsElements(vue) → { consulter(ligne, e),
 * copier(ligne), supprimer(lignes), autres: [{ code, libelle, icone, titre, max (1 par défaut), actif(lignes), action(lignes, e) }] } ou null (boutons sur la sélection : thème d'un seul type de fiche ou de documents),
 * actionsVue(vue) → [{ libelle, icone, titre, action(e) }] (boutons sur la vue entière : imprimer…), filtresVue(vue) → { colonne: [valeurs] | null }
 * (filtres externes propres à la vue, posés avant son premier chargement ; null retire le filtre de la colonne).
 *
 * Thèmes : les vues sont regroupées par thème (Devis, Factures, Salariés, Ressources…). Un thème déclare les
 * types d'élément qu'il couvre ; ses vues ne montrent que des lignes de ces types (aucun type = tous).
 */
export class ListeDonnees {
  constructor(racine, { fournisseur, contexte = null, ouvrir, message, peutRequete = false, peutGererThemes = false, intervalleControle = 30000, formats, cleVue, creation, surVue, panneau, glisser, filtresVue, actionsElements, actionsVue, groupeTheme } = {}) {
    this.racine = racine;
    // Regroupement des thèmes dans leur combo (l'application : menus du bandeau) : groupeTheme(theme) → { groupe, ordre } | null.
    this.groupeTheme = groupeTheme ?? null;
    // Lignes glissables vers une autre fenêtre : glisser({ ligne, definition }) → { type, valeur, texte, rang } | null ;
    // plusieurs lignes sélectionnées : tableau des valeurs, type de la ligne de plus haut rang.
    this.glisser = glisser ?? null;
    this.fournisseur = fournisseur;
    this.contexte = contexte;
    this.ouvrirExterne = ouvrir;
    // Thème ou vue changés (l'application reporte le choix dans l'URL de la page).
    this.surVue = surVue;
    // Panneau propre à une vue (arbres de familles…) et filtres qu'il pose sur des colonnes de la source.
    this.fabriquePanneau = panneau;
    this.panneauSpecifique = null;
    this.filtresExternes = new Map();
    this.filtresVue = filtresVue ?? null;
    this.message = message ?? (() => {});
    this.peutRequete = peutRequete;
    this.peutGererThemes = peutGererThemes;
    this.creation = creation;
    this.fabriqueActions = actionsElements ?? null;
    this.fabriqueActionsVue = actionsVue ?? null;
    this.actionsElements = null;
    this.themes = [];
    this.theme = null;             // code du thème affiché, null = toutes les vues
    this.formats = formats ?? new FormatsCellule();
    this.cleVue = cleVue ?? `logibtp.liste.${contexte ?? 'toutes'}`;
    this.vues = [];
    this.vue = null;               // vue courante : { vli_id, vli_nom, …, definition }
    this.nonEnregistree = false;   // définition appliquée depuis le concepteur, pas encore enregistrée
    this.modele = new ModeleVue({});
    this.recherche = '';
    this.segments = new Map();     // colonne → Set de valeurs (texte brut, null = vide)
    this.triBase = null;           // [{ colonne, sens }] envoyé au serveur, null = tri de la vue
    this.triLocal = null;          // { code, sens } sur les lignes chargées
    this.modeTriBase = false;      // bouton « Trier toute la base »
    this.filtres = new Map();      // code → filtre de colonne (lignes chargées)
    this.lignes = [];              // lignes chargées, dans l'ordre du serveur
    this.suite = null;             // curseur du lot suivant, null = tout est chargé
    this.enCours = false;
    this.generation = 0;
    this.marques = new Map();      // id → 'nouvelle' | 'modifiee'
    this.selection = null;         // ligne courante (Entrée, ↑↓, saisie)
    this.selections = new Set();   // lignes sélectionnées (Ctrl+clic, Maj+clic, Maj+↑↓) : glisser plusieurs lignes
    this.ancre = null;
    this.#construire();
    if (intervalleControle > 0) {
      this.minuterie = setInterval(() => { if (this.visible()) this.verifier().catch(() => {}); }, intervalleControle);
      this.surFocus = () => { if (this.visible()) this.verifier().catch(() => {}); };
      window.addEventListener('focus', this.surFocus);
    }
  }

  detruire() {
    this.panneauSpecifique?.detruire?.();
    clearInterval(this.minuterie);
    window.removeEventListener('focus', this.surFocus);
    this.observateur?.disconnect();
    this.redim?.disconnect();
  }

  visible() { return this.racine.offsetParent !== null && document.visibilityState === 'visible'; }

  get definition() { return this.modele.definition; }

  // ---------------------------------------------------------------- construction

  #construire() {
    const r = this.racine;
    r.classList.add('liste');
    r.innerHTML = `
      <div class="liste-barre">
        <span class="liste-themes"></span>
        <select class="liste-vues" title="Vue"></select>
        <button type="button" data-action="concevoir" title="Modifier la vue (mise en forme, colonnes, partage, enregistrer comme nouvelle vue)">✎</button>
        <span class="liste-elements">
          <button type="button" data-action="creer" class="principal" hidden></button>
          <button type="button" data-element="consulter" class="bouton-icone" title="Consulter — l'élément sélectionné (double-clic ; Ctrl : nouvelle fenêtre)" aria-label="Consulter" hidden>👁</button>
          <button type="button" data-element="copier" class="bouton-icone" title="Copier — créer un nouvel élément à partir de l'élément sélectionné" aria-label="Copier" hidden>⧉</button>
          <button type="button" data-element="supprimer" class="bouton-icone" title="Supprimer — les éléments sélectionnés" aria-label="Supprimer" hidden>🗑</button>
          <span class="liste-elements-autres"></span>
        </span>
        <input type="search" class="liste-recherche" placeholder="Rechercher…" title="Contient, sans casse ni accents, sur toute la base">
        <span class="liste-filtres-vue" hidden></span>
        <span class="liste-compteur"></span>
        <button type="button" data-action="effacer" class="bouton-icone" title="Effacer les filtres et le tri des colonnes" aria-label="Effacer les filtres" hidden>⨯</button>
        <button type="button" data-action="lignes" aria-pressed="false"></button>
        <button type="button" data-action="tout" aria-pressed="false">⇊</button>
        <button type="button" data-action="rafraichir" title="Recharger depuis la base">⟳</button>
        <span class="liste-actions-hote"></span>
        <button type="button" data-action="saisie" aria-pressed="false" hidden
          title="Saisie dans la liste : clic sur une cellule modifiable, Entrée ligne suivante, Tab colonne suivante, Échap annule">✎ Saisie</button>
      </div>
      <p class="liste-erreurs" hidden></p>
      <div class="liste-corps">
        <div class="liste-zone" tabindex="0">
          <table class="liste-table"><colgroup></colgroup><thead></thead><tbody></tbody></table>
          <div class="liste-suite"></div>
        </div>
        <div class="liste-separateur" title="Glisser pour redimensionner · double-clic pour réduire"></div>
        <aside class="liste-panneau">
          <header>
            <span class="liste-panneau-titre">Segments</span>
            <button type="button" data-dock="gauche" title="Ancrer à gauche">◧</button>
            <button type="button" data-dock="bas" title="Ancrer en bas">⬓</button>
            <button type="button" data-dock="droite" title="Ancrer à droite">◨</button>
            <button type="button" data-action="reduire">–</button>
          </header>
          <div class="liste-panneau-contenu">
            <div class="liste-panneau-specifique" hidden></div>
            <div class="liste-segments"></div>
          </div>
        </aside>
      </div>`;
    this.zone = r.querySelector('.liste-zone');
    this.corpsListe = r.querySelector('.liste-corps');
    this.prefs = this.#lirePreferences();
    this.modeTout = !!this.prefs.tout;
    r.querySelectorAll('[data-dock]').forEach((b) => b.addEventListener('click', () => {
      this.prefs.dock = b.dataset.dock;
      this.prefs.reduit = false;
      this.#ecrirePreferences();
      this.#appliquerDock();
    }));
    r.querySelector('.liste-panneau [data-action="reduire"]').addEventListener('click', () => this.#reduire(!this.prefs.reduit));
    this.#separateur(r.querySelector('.liste-separateur'));
    this.#appliquerDock();
    this.table = r.querySelector('.liste-table');
    this.corps = this.table.tBodies[0];
    this.basSuite = r.querySelector('.liste-suite');
    r.querySelector('.liste-vues').addEventListener('change', (e) => this.ouvrirVue(Number(e.target.value)).catch((x) => this.#erreur(x)));
    r.querySelector('[data-action="concevoir"]').addEventListener('click', () => this.concevoir(false));
    r.querySelectorAll('[data-element]').forEach((b) => b.addEventListener('click', (e) => this.#actionElement(b.dataset.element, e).catch((x) => this.#erreur(x))));
    r.querySelector('[data-action="rafraichir"]').addEventListener('click', () => this.recharger());
    r.querySelector('[data-action="saisie"]').addEventListener('click', () => this.basculerSaisie());
    r.querySelector('[data-action="creer"]').addEventListener('click', () => this.actionCreation?.action());
    r.querySelector('[data-action="tout"]').addEventListener('click', () => this.basculerTout());
    r.querySelector('[data-action="lignes"]').addEventListener('click', () => this.basculerLignes());
    r.querySelector('[data-action="effacer"]').addEventListener('click', () => {
      this.filtres.clear();
      this.triLocal = null;
      this.#rendreEntete();
      this.rendreCorps();
      this.#rendreSegments();
    });
    const recherche = r.querySelector('.liste-recherche');
    recherche.addEventListener('input', () => {
      clearTimeout(this.minuterieRecherche);
      this.minuterieRecherche = setTimeout(() => {
        this.recherche = recherche.value.trim();
        this.recharger();
        this.rafraichirSegments();
      }, DELAI_RECHERCHE);
    });
    this.corps.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const ctrl = e.ctrlKey || e.metaKey;
      // Ctrl ou Maj : sélection multiple (le second clic d'un double-clic ne rebascule pas la ligne).
      if (ctrl || e.shiftKey) {
        if (e.detail < 2) this.#selectionner(tr.dataset.id, { basculer: ctrl && !e.shiftKey, etendre: e.shiftKey });
        return;
      }
      this.#selectionner(tr.dataset.id);
      const td = e.target.closest('td.modifiable');
      if (td && !td.querySelector('.liste-editeur')) this.#commencerSaisie(tr.dataset.id, td.dataset.code);
    });
    this.corps.addEventListener('dragstart', (e) => {
      const tr = e.target.closest?.('tr[data-id]');
      const ligne = tr && this.lignes.find((l) => String(l._id) === tr.dataset.id);
      const g = ligne && this.glisser?.({ ligne, definition: this.definition });
      if (!g) { e.preventDefault(); return; }
      // Ligne glissée faisant partie de la sélection multiple : toutes les lignes sélectionnées, dans l'ordre affiché.
      let paquet = [g];
      if (this.selections.size > 1 && this.selections.has(tr.dataset.id)) {
        paquet = [...this.corps.rows].filter((x) => this.selections.has(x.dataset.id))
          .map((x) => this.lignes.find((l) => String(l._id) === x.dataset.id))
          .map((l) => l && this.glisser({ ligne: l, definition: this.definition })).filter(Boolean);
      } else this.#selectionner(tr.dataset.id);
      // Type annoncé : celui de la ligne de plus haut rang (le plus contraignant pour la cible du dépôt).
      const type = paquet.reduce((a, x) => ((x.rang ?? 0) > (a.rang ?? 0) ? x : a), paquet[0]).type;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(type, JSON.stringify(paquet.length > 1 ? paquet.map((x) => x.valeur) : g.valeur));
      e.dataTransfer.setData('text/plain', paquet.map((x) => x.texte ?? '').join('\n'));
    });
    this.corps.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      // En mode saisie, le double-clic sur une cellule modifiable ne doit pas ouvrir la fiche.
      if (tr && !e.target.closest('td.modifiable')) this.ouvrir(tr.dataset.id, e);
    });
    this.zone.addEventListener('keydown', (e) => this.#clavier(e));
    // Clic droit : menu court des actions sur la sélection, avec leurs raccourcis (aide-mémoire) ; tout reste accessible sans.
    this.corps.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr || (this.modeSaisie && e.target.closest('td.modifiable'))) return;
      if (!this.lignesSelectionnees().some((l) => String(l._id) === tr.dataset.id)) this.#selectionner(tr.dataset.id);
      this.#menuLigne(e, tr.dataset.id);
    });
    this.observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((x) => x.isIntersecting)) this.chargerSuite().catch((x) => this.#erreur(x));
    }, { root: this.zone, rootMargin: '300px' });
    this.observateur.observe(this.basSuite);
    this.redim = new ResizeObserver(() => this.#largeurs());
    this.redim.observe(this.zone);
  }

  #erreur(e) {
    console.error(e);
    this.message(e.message ?? String(e), 'erreur');
  }

  // ---------------------------------------------------------------- vues

  /** Charge les thèmes et les vues, puis ouvre la vue demandée, la dernière utilisée du thème ou la première. */
  async demarrer(vueId = null) {
    await this.chargerThemes();
    if (this.theme === null && this.prefs.theme && this.themes.some((t) => t.thl_code === this.prefs.theme)) this.theme = this.prefs.theme;
    this.#afficherTheme();
    await this.chargerVues();
    await this.#ouvrirDansTheme(vueId);
  }

  async chargerThemes() {
    this.themes = await this.fournisseur.themes?.() ?? [];
    if (this.theme && !this.themes.some((t) => t.thl_code === this.theme)) this.theme = null;
    // Combo des thèmes (« * » = toutes les vues), regroupés comme les menus de l'application quand elle le demande.
    const options = this.themes.map((t, i) => {
      const g = this.groupeTheme?.(t) ?? null;
      return { valeur: t.thl_code, libelle: `${t.thl_icone ?? ''} ${t.thl_libelle}`.trim(), detail: (t.thl_types ?? []).map((x) => x.libelle || x.code).join(', '),
        groupe: this.groupeTheme ? g?.groupe ?? 'Autres' : undefined, ordre: g?.ordre ?? 1e6 + i };
    }).sort((a, b) => a.ordre - b.ordre);
    const combo = creerCombo({ options: [{ valeur: '*', libelle: 'Toutes les vues' }, ...options], valeur: this.theme ?? '*', vide: false, titre: 'Thème : regroupement des vues' });
    combo.classList.add('liste-themes');
    combo.addEventListener('change', () => this.choisirTheme(combo.valeurCombo === '*' ? null : combo.valeurCombo).catch((x) => this.#erreur(x)));
    combo.hidden = !this.themes.length && !this.peutGererThemes;
    this.racine.querySelector('.liste-themes').replaceWith(combo);
    this.comboThemes = combo;
  }

  /** Thème courant affiché dans sa combo (sans événement). */
  #afficherTheme() { this.comboThemes?.definirValeur(this.theme ?? '*'); }

  /** Change de thème : vues du thème, puis la dernière ouverte dans ce thème. */
  async choisirTheme(code) {
    this.theme = code;
    this.prefs.theme = code;
    this.#ecrirePreferences();
    this.#afficherTheme();
    await this.chargerVues();
    await this.#ouvrirDansTheme(null);
  }

  async #ouvrirDansTheme(vueId) {
    let id = vueId ?? this.prefs.vueParTheme?.[this.theme ?? ''] ?? null;
    if (id === null && this.theme === null) { try { id = Number(localStorage.getItem(this.cleVue)) || null; } catch { id = null; } }
    if (!this.vues.some((v) => v.vli_id === id)) id = this.vues[0]?.vli_id ?? null;
    if (id !== null) { await this.ouvrirVue(id); return; }
    // Thème sans vue : liste vide, le concepteur (＋) en crée une.
    this.vue = null;
    this.appliquerVue({ vli_id: null, vli_nom: '', definition: { theme: this.theme } }, { nonEnregistree: false, vide: true });
    this.message('Aucune vue dans ce thème : ＋ pour en créer une');
    this.surVue?.({ theme: this.theme, vue: null });
  }

  gererThemes() {
    new GestionThemes({
      fournisseur: this.fournisseur,
      message: this.message,
      fermer: async () => {
        await this.chargerThemes();
        await this.chargerVues();
        if (!this.vues.some((v) => v.vli_id === this.vue?.vli_id)) await this.#ouvrirDansTheme(null);
      },
    });
  }

  async chargerVues() {
    this.vues = await this.fournisseur.vues(this.contexte, this.theme);
    const partage = { P: 'personnelle', G: 'groupe', T: 'tous' };
    this.racine.querySelector('.liste-vues').innerHTML = this.vues.map((v) =>
      `<option value="${v.vli_id}" title="Vue ${partage[v.vli_partage] ?? ''} de ${echapper(v.vli_proprietaire ?? '')}">${echapper(v.vli_nom)}</option>`).join('');
    if (this.vue?.vli_id) this.racine.querySelector('.liste-vues').value = String(this.vue.vli_id);
  }

  async ouvrirVue(id) {
    const vue = await this.fournisseur.vue(id);
    try { localStorage.setItem(this.cleVue, String(id)); } catch { /* préférence non conservée */ }
    this.prefs.vueParTheme = { ...this.prefs.vueParTheme, [this.theme ?? '']: id };
    this.#ecrirePreferences();
    this.racine.querySelector('.liste-vues').value = String(id);
    this.appliquerVue(vue, { nonEnregistree: false });
    this.surVue?.({ theme: this.theme, vue: id });
  }

  /** Applique une vue (enregistrée ou issue du concepteur) : en-têtes, segments, rechargement. */
  appliquerVue(vue, { nonEnregistree = false, vide = false } = {}) {
    this.vue = vide ? null : { ...vue, definition: normaliserDefinition(vue.definition) };
    this.nonEnregistree = nonEnregistree;
    this.modele = new ModeleVue(vue.definition);
    const codes = new Set(this.modele.colonnes.map((c) => c.code));
    for (const k of [...this.filtres.keys()]) if (!codes.has(k)) this.filtres.delete(k);
    const segs = new Set(this.definition.segments.map((s) => s.colonne));
    for (const k of [...this.segments.keys()]) if (!segs.has(k)) this.segments.delete(k);
    this.#creerPanneauSpecifique();
    // Filtres externes propres à la vue (application) : posés après le panneau (qui vide les filtres), avant le chargement.
    for (const [col, valeurs] of Object.entries(this.filtresVue?.(vide ? null : vue) ?? {})) {
      if (valeurs?.length) this.filtresExternes.set(col, [...valeurs]); else this.filtresExternes.delete(col);
    }
    this.triBase = null;
    this.triLocal = null;
    const erreurs = [...this.modele.erreurs].map(([code, m]) => `${this.modele.parCode.get(code)?.titre ?? code} : ${m}`);
    const zoneErreurs = this.racine.querySelector('.liste-erreurs');
    zoneErreurs.hidden = !erreurs.length;
    zoneErreurs.textContent = erreurs.join(' · ');
    this.#appliquerLignes();
    this.#colonnesModifiables().catch(() => {});
    this.actionCreation = this.vue ? this.creation?.(this.vue) ?? null : null;
    const creer = this.racine.querySelector('[data-action="creer"]');
    creer.hidden = !this.actionCreation;
    creer.textContent = this.actionCreation?.libelle ?? '';
    creer.title = this.actionCreation ? `Créer : ${this.actionCreation.libelle.replace('＋', '').trim()}` : '';
    this.actionsElements = this.vue ? this.fabriqueActions?.(this.vue) ?? null : null;
    // Actions supplémentaires de l'application (transformer…) : un bouton chacune.
    const autres = this.racine.querySelector('.liste-elements-autres');
    autres.innerHTML = (this.actionsElements?.autres ?? []).map((x, i) => `<button type="button" data-autre="${i}"${x.icone ? ' class="bouton-icone"' : ''} title="${echapper(x.icone ? [x.libelle, x.titre].filter(Boolean).join(' — ') : x.titre ?? '')}" aria-label="${echapper(x.libelle)}">${echapper(x.icone ?? x.libelle)}</button>`).join('');
    autres.querySelectorAll('[data-autre]').forEach((b) => b.addEventListener('click', (e) => {
      const x = this.actionsElements?.autres?.[Number(b.dataset.autre)];
      if (x) Promise.resolve(x.action(this.lignesSelectionnees(), e)).catch((err) => this.#erreur(err));
    }));
    this.#majActionsElements();
    // Actions de l'application sur la vue entière (imprimer…), indépendantes de la sélection.
    const hote = this.racine.querySelector('.liste-actions-hote');
    const actionsVue = this.vue ? this.fabriqueActionsVue?.(this.vue) ?? [] : [];
    hote.innerHTML = actionsVue.map((x, i) => `<button type="button" data-vue-action="${i}"${x.icone ? ' class="bouton-icone"' : ''} title="${echapper([x.libelle, x.titre].filter(Boolean).join(' — '))}" aria-label="${echapper(x.libelle)}">${echapper(x.icone ?? x.libelle)}</button>`).join('');
    hote.querySelectorAll('[data-vue-action]').forEach((b) => b.addEventListener('click', (e) => {
      Promise.resolve(actionsVue[Number(b.dataset.vueAction)].action(e)).catch((err) => this.#erreur(err));
    }));
    // Rappel des filtres fixes de la vue (appliqués par la base).
    const fv = this.racine.querySelector('.liste-filtres-vue');
    const libelles = this.definition.filtres.map((f) => libelleFiltreVue(f, this.modele.parCode.get(f.colonne)?.titre?.replace(/\s*\n\s*/g, ' ') ?? f.colonne));
    fv.hidden = !libelles.length;
    fv.textContent = `⚑ ${libelles.length === 1 ? libelles[0] : `${libelles.length} filtres de vue`}`;
    fv.title = `Filtres de la vue, appliqués par la base :\n${libelles.join('\n')}`;
    this.#rendreEntete();
    this.recharger();
    this.rafraichirSegments();
  }

  concevoir(nouvelle) {
    fermerMenuFiltre();
    const base = nouvelle || !this.vue
      ? { vli_id: null, vli_nom: 'Nouvelle vue', vli_contexte: this.contexte, vli_partage: 'P', vli_groupe: null,
        definition: { ...(nouvelle && this.vue ? structuredClone(this.vue.definition) : normaliserDefinition({})), theme: this.theme } }
      : structuredClone(this.vue);
    this.concepteur = new ConcepteurVue({
      fournisseur: this.fournisseur,
      vue: base,
      peutRequete: this.peutRequete,
      themes: this.themes,
      largeursAjustees: { ...this.#largeursAjustees() },
      ordreAjuste: this.prefs.ordres?.[this.#cleLargeurs()] ?? null,
      oublierLargeurs: () => {
        delete this.prefs.colonnes?.[this.#cleLargeurs()];
        delete this.prefs.ordres?.[this.#cleLargeurs()];
        this.#ecrirePreferences();
      },
      appliquer: (v) => this.appliquerVue(v, { nonEnregistree: true }),
      enregistrer: async (v) => {
        const enregistree = await this.fournisseur.enregistrerVue(v);
        // Vue rangée dans un autre thème : on suit la vue.
        const theme = enregistree.definition?.theme ?? null;
        if (this.theme !== null && theme !== this.theme) {
          this.theme = theme;
          this.prefs.theme = theme;
          this.#afficherTheme();
        }
        await this.chargerVues();
        try { localStorage.setItem(this.cleVue, String(enregistree.vli_id)); } catch { /* préférence non conservée */ }
        this.appliquerVue(enregistree, { nonEnregistree: false });
        this.racine.querySelector('.liste-vues').value = String(enregistree.vli_id);
        this.message(`Vue « ${enregistree.vli_nom} » enregistrée`, 'succes');
        return enregistree;
      },
      supprimer: async (v) => {
        await this.fournisseur.supprimerVue(v.vli_id);
        this.vue = null;
        await this.chargerVues();
        await this.#ouvrirDansTheme(null);
        this.message(`Vue « ${v.vli_nom} » supprimée`, 'succes');
      },
      message: this.message,
    });
  }

  /** Panneau propre à la vue (option panneau) : recréé à chaque vue appliquée ; ses filtres repartent de zéro. */
  #creerPanneauSpecifique() {
    this.panneauSpecifique?.detruire?.();
    this.panneauSpecifique = null;
    this.filtresExternes.clear();
    const zone = this.racine.querySelector('.liste-panneau-specifique');
    zone.replaceChildren();
    this.panneauSpecifique = this.vue && this.fabriquePanneau ? this.fabriquePanneau({ vue: this.vue, conteneur: zone, liste: this }) : null;
    zone.hidden = !this.panneauSpecifique;
    this.racine.querySelector('.liste-panneau-titre').textContent = this.panneauSpecifique ? 'Filtres' : 'Segments';
  }

  /**
   * Filtre posé par le panneau propre à la vue : valeurs retenues d'une colonne de la source (null = vide), appliqué par
   * la base comme un segment ; valeurs null ou vides : filtre retiré.
   */
  definirFiltreExterne(colonne, valeurs, { recharger = true } = {}) {
    if (valeurs?.length) this.filtresExternes.set(colonne, [...valeurs]);
    else this.filtresExternes.delete(colonne);
    if (recharger) { this.recharger(); this.rafraichirSegments().catch(() => {}); }
  }

  // ---------------------------------------------------------------- demandes au fournisseur

  demande() {
    const segments = {};
    for (const [col, valeurs] of this.filtresExternes) segments[col] = [...valeurs];
    for (const [col, valeurs] of this.segments) if (valeurs.size) segments[col] = [...valeurs];
    return {
      vue_id: this.vue?.vli_id ?? null,
      definition: this.nonEnregistree || !this.vue?.vli_id ? this.definition : null,
      recherche: this.recherche,
      segments,
      tri: this.triBase ?? this.definition.tri,
    };
  }

  /** Recharge la liste depuis le début (recherche, segments ou tri de la base modifiés). */
  recharger() {
    this.generation++;
    this.lignes = [];
    this.suite = null;
    this.fin = false;
    this.enCours = false;
    this.marques.clear();
    this.rendreCorps();
    if (!this.vue) return;
    this.chargerSuite().catch((e) => this.#erreur(e));
  }

  /**
   * Charge le lot suivant, puis enchaîne les lots tant que « Charger toutes les lignes » est actif ou que la
   * zone visible n'est pas encore remplie. Un rechargement (filtre, tri) interrompt la boucle en cours.
   */
  async chargerSuite() {
    if (!this.vue || this.enCours || this.fin) return;
    const gen = this.generation;
    do {
      await this.#chargerLot(gen);
    } while (gen === this.generation && !this.fin && !this.enCours && (this.modeTout || this.#zoneARemplir()));
  }

  #zoneARemplir() {
    return this.zone.clientHeight > 0 && this.zone.scrollHeight <= this.zone.clientHeight + 300;
  }

  async #chargerLot(gen) {
    this.enCours = true;
    this.#rendreSuite();
    try {
      const r = await this.fournisseur.lot({ ...this.demande(), apres: this.suite, taille: this.definition.taille_lot });
      if (gen !== this.generation) return;
      this.lignes.push(...r.lignes);
      this.suite = r.suite;
      this.fin = !r.suite;
      this.#ajouterAuCorps(r.lignes);
      if (this.#filtresColonnesActifs()) this.#rendreSegments();
    } finally {
      if (gen === this.generation) {
        this.enCours = false;
        this.#rendreSuite();
      }
    }
  }

  /**
   * Affichage des lignes : sur une seule ligne ou multiligne. Par défaut celui de la vue ; le bouton le force
   * pour cet utilisateur (préférence du navigateur, par vue).
   */
  get affichageLignes() {
    return this.prefs.lignes?.[String(this.vue?.vli_id ?? 'nouvelle')] ?? this.definition.lignes;
  }

  basculerLignes() {
    const suivant = this.affichageLignes === 'simple' ? 'multi' : 'simple';
    const cle = String(this.vue?.vli_id ?? 'nouvelle');
    this.prefs.lignes = { ...this.prefs.lignes, [cle]: suivant };
    if (suivant === this.definition.lignes) delete this.prefs.lignes[cle];
    this.#ecrirePreferences();
    this.#appliquerLignes();
    this.rendreCorps();
  }

  #appliquerLignes() {
    const simple = this.affichageLignes === 'simple';
    this.racine.classList.toggle('liste-simple', simple);
    const b = this.racine.querySelector('[data-action="lignes"]');
    b.textContent = simple ? '⇕' : '⇔';
    b.classList.toggle('actif', !!this.prefs.lignes?.[String(this.vue?.vli_id ?? 'nouvelle')]);
    b.setAttribute('aria-pressed', String(simple));
    b.title = simple ? 'Afficher les lignes en entier (multiligne)' : 'Afficher chaque ligne sur une seule ligne';
  }

  /** Interrupteur « Charger toutes les lignes » : conservé lors des rechargements (filtres, segments, tri). */
  basculerTout(actif = !this.modeTout) {
    this.modeTout = actif;
    this.#ecrirePreferences();
    this.#appliquerDock();
    if (actif) this.chargerSuite().catch((e) => this.#erreur(e));
  }

  /**
   * Contrôle des lignes chargées : lignes ajoutées, modifiées (empreinte) ou sorties du filtre depuis le
   * chargement, jusqu'au curseur du dernier lot. Les lignes concernées sont relues, l'ordre est celui de la base.
   */
  async verifier() {
    if (!this.vue || this.enCours) return null;
    const gen = this.generation;
    const etat = await this.fournisseur.controle(this.demande(), this.fin ? null : this.suite);
    if (gen !== this.generation) return null;
    const connues = new Map(this.lignes.map((l) => [String(l._id), l]));
    const presents = new Set(etat.map((x) => String(x.id)));
    const aLire = etat.filter((x) => connues.get(String(x.id))?._h !== x.h).map((x) => String(x.id));
    const supprimees = this.lignes.filter((l) => !presents.has(String(l._id))).length;
    if (!aLire.length && !supprimees) return { ajoutees: 0, modifiees: 0, supprimees: 0 };
    const relues = new Map();
    for (let i = 0; i < aLire.length; i += 500) {
      for (const l of await this.fournisseur.lignes(this.demande(), aLire.slice(i, i + 500))) relues.set(String(l._id), l);
    }
    if (gen !== this.generation) return null;
    let ajoutees = 0, modifiees = 0;
    for (const id of relues.keys()) {
      this.marques.set(id, connues.has(id) ? 'modifiee' : 'nouvelle');
      if (connues.has(id)) modifiees++; else ajoutees++;
    }
    this.lignes = etat.map((x) => relues.get(String(x.id)) ?? connues.get(String(x.id))).filter(Boolean);
    this.rendreCorps();
    this.#effacerMarques();
    return { ajoutees, modifiees, supprimees };
  }

  /** Rafraîchissement ciblé après une modification connue (enregistrement d'une fiche…). */
  async rafraichirLignes(ids) {
    if (!this.vue || !ids.length) return;
    const voulus = ids.map(String);
    const relues = new Map((await this.fournisseur.lignes(this.demande(), voulus)).map((l) => [String(l._id), l]));
    let inconnue = false;
    for (const id of voulus) {
      const i = this.lignes.findIndex((l) => String(l._id) === id);
      if (i < 0) { inconnue ||= relues.has(id); continue; }
      if (relues.has(id)) { this.lignes[i] = relues.get(id); this.marques.set(id, 'modifiee'); }
      else this.lignes.splice(i, 1);
    }
    this.rendreCorps();
    this.#effacerMarques();
    // Ligne nouvelle ou déplacée par le tri : sa place est donnée par le contrôle complet.
    if (inconnue) await this.verifier();
  }

  #effacerMarques() {
    clearTimeout(this.minuterieMarques);
    this.minuterieMarques = setTimeout(() => {
      this.marques.clear();
      this.corps.querySelectorAll('tr.nouvelle, tr.modifiee').forEach((tr) => tr.classList.remove('nouvelle', 'modifiee'));
    }, DUREE_MARQUE);
  }

  // ---------------------------------------------------------------- disposition (panneau des segments)

  #lirePreferences() {
    const defaut = { dock: 'droite', largeur: 260, hauteur: 160, reduit: false, tout: false };
    try {
      const p = { ...defaut, ...JSON.parse(localStorage.getItem(`${this.cleVue}.affichage`) ?? '{}') };
      if (!['gauche', 'droite', 'bas'].includes(p.dock)) p.dock = 'droite';
      return p;
    } catch {
      return defaut;
    }
  }

  #ecrirePreferences() {
    try { localStorage.setItem(`${this.cleVue}.affichage`, JSON.stringify({ ...this.prefs, tout: !!this.modeTout })); } catch { /* préférences non conservées */ }
  }

  #appliquerDock() {
    const c = this.corpsListe;
    for (const pos of ['gauche', 'droite', 'bas']) c.classList.toggle(`dock-${pos}`, this.prefs.dock === pos);
    c.classList.toggle('dock-reduit', !!this.prefs.reduit);
    c.style.setProperty('--panneau-largeur', `${this.prefs.largeur}px`);
    c.style.setProperty('--panneau-hauteur', `${this.prefs.hauteur}px`);
    this.racine.querySelectorAll('[data-dock]').forEach((b) => b.classList.toggle('actif', b.dataset.dock === this.prefs.dock));
    const b = this.racine.querySelector('.liste-panneau [data-action="reduire"]');
    b.textContent = this.prefs.reduit ? '▢' : '–';
    b.title = this.prefs.reduit ? 'Agrandir le panneau des segments' : 'Réduire le panneau des segments';
    const t = this.racine.querySelector('[data-action="tout"]');
    t.classList.toggle('actif', !!this.modeTout);
    t.setAttribute('aria-pressed', String(!!this.modeTout));
    t.title = this.modeTout
      ? 'Chargement de toutes les lignes : actif, y compris après un filtre (cliquer pour revenir au chargement par lots)'
      : 'Charger toutes les lignes (reste actif lors des rechargements)';
  }

  #reduire(reduit) {
    this.prefs.reduit = reduit;
    this.#ecrirePreferences();
    this.#appliquerDock();
  }

  /** Redimensionnement du panneau par glisser : largeur à gauche ou à droite, hauteur en bas. */
  #separateur(sep) {
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sep.setPointerCapture(e.pointerId);
      if (this.prefs.reduit) this.#reduire(false);
      const rect = this.corpsListe.getBoundingClientRect();
      const bouger = (ev) => {
        const p = this.prefs;
        if (p.dock === 'bas') p.hauteur = Math.round(Math.min(Math.max(rect.bottom - ev.clientY, 60), rect.height * 0.7));
        else if (p.dock === 'droite') p.largeur = Math.round(Math.min(Math.max(rect.right - ev.clientX, 160), rect.width * 0.6));
        else p.largeur = Math.round(Math.min(Math.max(ev.clientX - rect.left, 160), rect.width * 0.6));
        this.#appliquerDock();
      };
      const finir = () => {
        sep.removeEventListener('pointermove', bouger);
        sep.removeEventListener('pointerup', finir);
        sep.removeEventListener('pointercancel', finir);
        this.#ecrirePreferences();
      };
      sep.addEventListener('pointermove', bouger);
      sep.addEventListener('pointerup', finir);
      sep.addEventListener('pointercancel', finir);
    });
    sep.addEventListener('dblclick', () => this.#reduire(!this.prefs.reduit));
  }

  // ---------------------------------------------------------------- segments

  async rafraichirSegments() {
    const zone = this.racine.querySelector('.liste-segments');
    const segs = this.definition.segments;
    this.corpsListe.classList.toggle('sans-segments', !segs.length && !this.panneauSpecifique);
    this.panneauSpecifique?.rafraichir?.();
    if (!segs.length || !this.vue) { zone.replaceChildren(); return; }
    const gen = this.generation;
    const comptes = await Promise.all(segs.map((s) => this.fournisseur.segments(this.demande(), s.colonne).catch(() => [])));
    if (gen !== this.generation) return;
    this.comptesBase = comptes;
    this.#rendreSegments();
  }

  /**
   * Comptes affichés d'un segment. Sans filtre de colonne : ceux de la base (recherche, filtres de la vue, autres
   * segments). Avec un filtre de colonne (appliqué aux lignes chargées) : comptés sur les lignes chargées qui le
   * respectent ; dans un segment déjà filtré, les valeurs non retenues (lignes non chargées) gardent le compte de la
   * base, marqué « hors filtres de colonnes ».
   */
  #comptesSegment(s, base) {
    if (!this.#filtresColonnesActifs()) return { comptes: base, partiel: false };
    const lignes = this.lignesAffichees();
    if (lignes.length && !(s.colonne in lignes[0]) && !(s.colonne in (this.lignes[0] ?? {}))) return { comptes: base, partiel: false };
    const locaux = comptesSegment(lignes, s.colonne);
    const actives = this.segments.get(s.colonne);
    const comptes = locaux.map((c) => ({ ...c }));
    if (actives?.size) {
      for (const c of base) if (!actives.has(c.valeur) && !comptes.some((x) => x.valeur === c.valeur)) comptes.push({ ...c, horsFiltre: true });
    }
    return { comptes, partiel: !this.fin };
  }

  #filtresColonnesActifs() { return [...this.filtres.values()].some(filtreActif); }

  /** Rendu des segments à partir des derniers comptes de la base (rappelé quand les filtres de colonnes changent). */
  #rendreSegments() {
    const zone = this.racine.querySelector('.liste-segments');
    const segs = this.definition.segments;
    if (!segs.length || !this.vue || !this.comptesBase) return;
    const calcules = segs.map((s, i) => this.#comptesSegment(s, this.comptesBase[i] ?? []));
    const comptes = calcules.map((c) => c.comptes);
    const reduits = this.#segmentsReduits();
    zone.innerHTML = segs.map((s, i) => {
      const col = this.modele.parCode.get(s.colonne);
      const actives = this.segments.get(s.colonne) ?? new Set();
      const titre = s.titre || col?.titre || s.colonne;
      const reduit = reduits.has(s.colonne);
      // Titre : replie / déplie le segment ; réduit, il indique le nombre de valeurs filtrées.
      return `<div class="segment${reduit ? ' reduit' : ''}" data-segment="${echapper(s.colonne)}">
        <button type="button" class="segment-titre" data-replier aria-expanded="${!reduit}"
          title="${reduit ? 'Déplier' : 'Réduire'} ce segment (mémorisé pour cette vue)"><span class="segment-chevron">${reduit ? '▸' : '▾'}</span>${echapper(titre.replace(/\n/g, ' '))}${actives.size ? ` <small class="segment-filtre">(${actives.size})</small>` : ''}</button>
        <span class="segment-valeurs"${reduit ? ' hidden' : ''}><button type="button" data-tout class="${actives.size ? '' : 'actif'}">Tous</button>
        ${comptes[i].map((c) => {
          const libelle = c.valeur === null ? '(vide)' : col ? this.modele.texte(c.valeur, col) || c.valeur : c.valeur;
          const bulle = c.horsFiltre ? `${libelle} — nombre de la base, hors filtres de colonnes (lignes non chargées)`
            : calcules[i].partiel ? `${libelle} — compté sur les lignes chargées (filtres de colonnes)` : libelle;
          return `<button type="button" data-valeur="${c.valeur === null ? '' : echapper(c.valeur)}" data-vide="${c.valeur === null}"
            class="${actives.has(c.valeur) ? 'actif' : ''}${c.horsFiltre ? ' hors-filtre' : ''}" title="${echapper(bulle)}">${this.#imageSegment(col, c.valeur)}${echapper(libelle)} <small>${c.nombre}${calcules[i].partiel && !c.horsFiltre ? '+' : ''}</small></button>`;
        }).join('')}
        ${[...actives].filter((v) => !comptes[i].some((c) => c.valeur === v)).map((v) =>
          `<button type="button" class="actif" data-valeur="${echapper(v ?? '')}" data-vide="${v === null}">${echapper(v ?? '(vide)')} <small>0</small></button>`).join('')}
      </span></div>`;
    }).join('');
    zone.querySelectorAll('[data-segment]').forEach((div) => {
      const col = div.dataset.segment;
      div.querySelector('[data-replier]').addEventListener('click', () => this.#replierSegment(div, col));
      div.querySelector('[data-tout]').addEventListener('click', () => { this.segments.delete(col); this.#segmentsModifies(); });
      div.querySelectorAll('[data-valeur]').forEach((b) => b.addEventListener('click', (e) => {
        const v = b.dataset.vide === 'true' ? null : b.dataset.valeur;
        const actives = new Set(this.segments.get(col) ?? []);
        // Clic : sélection unique ; Ctrl/Maj + clic : sélection multiple.
        if (e.ctrlKey || e.metaKey || e.shiftKey) { if (actives.has(v)) actives.delete(v); else actives.add(v); }
        else if (actives.size === 1 && actives.has(v)) actives.clear();
        else { actives.clear(); actives.add(v); }
        this.segments.set(col, actives);
        this.#segmentsModifies();
      }));
    });
  }

  /** Segments réduits de la vue courante (préférence du navigateur ; par défaut, tous dépliés). */
  #segmentsReduits() {
    return new Set(this.prefs.segmentsReduits?.[String(this.vue?.vli_id ?? 'nouvelle')] ?? []);
  }

  /** Replie ou déplie un segment et mémorise le choix pour la vue (sans recharger la liste). */
  #replierSegment(div, col) {
    const cle = String(this.vue?.vli_id ?? 'nouvelle');
    const reduits = this.#segmentsReduits();
    const reduit = !reduits.has(col);
    if (reduit) reduits.add(col);
    else reduits.delete(col);
    this.prefs.segmentsReduits = { ...this.prefs.segmentsReduits, [cle]: [...reduits] };
    if (!reduits.size) delete this.prefs.segmentsReduits[cle];
    this.#ecrirePreferences();
    div.classList.toggle('reduit', reduit);
    div.querySelector('.segment-valeurs').hidden = reduit;
    const b = div.querySelector('[data-replier]');
    b.setAttribute('aria-expanded', String(!reduit));
    b.title = `${reduit ? 'Déplier' : 'Réduire'} ce segment (mémorisé pour cette vue)`;
    b.querySelector('.segment-chevron').textContent = reduit ? '▸' : '▾';
  }

  /** Image associée à une valeur de segment : image ou picto de l'option de la colonne, case pour un oui / non. */
  #imageSegment(col, valeur) {
    if (!col || valeur === null) return '';
    const o = (col.options ?? []).find((x) => String(x.valeur) === String(valeur));
    if (o?.image) return `<img class="segment-image" src="${echapper(o.image)}" alt="">`;
    if (o?.picto) return `<span class="segment-picto">${echapper(o.picto)}</span>`;
    if (col.format === 'coche') return `<span class="segment-picto">${String(valeur) === 'true' ? '☑' : '☐'}</span>`;
    return '';
  }

  #segmentsModifies() {
    this.recharger();
    this.rafraichirSegments();
  }

  // ---------------------------------------------------------------- en-têtes, tri, filtres

  #rendreEntete() {
    const visibles = this.#visibles();
    const thead = this.table.tHead;
    const tr = document.createElement('tr');
    const coin = document.createElement('th');
    coin.className = 'liste-coin';
    coin.innerHTML = `<button type="button" class="${this.modeTriBase ? 'actif' : ''}" title="${this.modeTriBase
      ? 'Tri sur toute la base : un clic sur un en-tête recharge la liste dans cet ordre'
      : 'Trier toute la base (sinon le tri porte sur les lignes chargées)'}">⇅</button>`;
    coin.querySelector('button').addEventListener('click', () => {
      this.modeTriBase = !this.modeTriBase;
      this.#rendreEntete();
      this.message(this.modeTriBase ? 'Tri sur toute la base' : 'Tri sur les lignes chargées');
    });
    tr.append(coin);
    for (const c of visibles) {
      const th = document.createElement('th');
      th.dataset.code = c.code;
      th.className = `aligne-${alignement(c)}`;
      if (c.bulle) th.title = c.bulle;
      const triB = (this.triBase ?? []).find((t) => t.colonne === c.code);
      const triL = this.triLocal?.code === c.code ? this.triLocal : null;
      const sens = triL?.sens ?? triB?.sens ?? null;
      const actif = filtreActif(this.filtres.get(c.code));
      th.innerHTML = `<div class="liste-th">
        <span class="liste-th-titre">${echapper(c.titre ?? c.code)}</span>
        <span class="liste-poignee" title="Glisser pour redimensionner · double-clic : largeur de la vue"></span>
        <span class="liste-th-boutons">
          <button type="button" data-tri class="${sens ? 'actif' : ''} ${triB ? 'base' : ''}" title="${triB ? 'Trié sur toute la base' : triL ? 'Trié sur les lignes chargées' : 'Trier'}">${sens === 'asc' ? '▲' : sens === 'desc' ? '▼' : '⇵'}</button>
          <button type="button" data-filtre class="${actif ? 'actif' : ''}" title="Filtrer les lignes chargées">${actif ? '⧩' : '▾'}</button>
        </span></div>`;
      th.querySelector('[data-tri]').addEventListener('click', () => this.#clicTri(c, sens));
      th.querySelector('[data-filtre]').addEventListener('click', (e) => this.#menu(c, e.currentTarget));
      this.#poignee(th.querySelector('.liste-poignee'), c.code);
      this.#deplacement(th, c.code);
      tr.append(th);
    }
    thead.replaceChildren(tr);
    const filtres = [...this.filtres.values()].some(filtreActif);
    this.racine.querySelector('[data-action="effacer"]').hidden = !filtres && !this.triLocal;
    this.#largeurs();
  }

  #clicTri(colonne, sens) {
    const suivant = sens === null ? 'asc' : sens === 'asc' ? 'desc' : null;
    if (this.modeTriBase) this.trier(colonne.code, suivant, true);
    else this.trier(colonne.code, suivant, false);
  }

  /** Tri d'une colonne : sur les lignes chargées, ou sur toute la base (rechargement). */
  trier(code, sens, base) {
    const c = this.modele.parCode.get(code);
    if (base && c?.calcul) {
      this.message('Colonne calculée : tri des lignes chargées uniquement', 'avertissement');
      base = false;
    }
    if (base) {
      this.triLocal = null;
      this.triBase = sens ? [{ colonne: code, sens }] : null;
      this.#rendreEntete();
      this.recharger();
      return;
    }
    this.triLocal = sens ? { code, sens } : null;
    this.#rendreEntete();
    this.rendreCorps();
  }

  #menu(colonne, ancre) {
    ouvrirMenuFiltre({
      ancre, colonne, modele: this.modele, lignes: this.lignes, filtre: this.filtres.get(colonne.code),
      appliquer: (f) => {
        if (f) this.filtres.set(colonne.code, f); else this.filtres.delete(colonne.code);
        this.#rendreEntete();
        this.rendreCorps();
        this.#rendreSegments();
      },
      trier: (sens, base) => this.trier(colonne.code, sens, base),
    });
  }

  // ---------------------------------------------------------------- corps

  #cellule(ligne, c) {
    return { valeur: this.modele.valeur(ligne, c.code), texte: this.modele.texteCellule(ligne, c), style: this.modele.style(ligne, c.code) };
  }

  /** Lignes affichées : lignes chargées filtrées par les filtres de colonnes, triées localement si demandé. */
  lignesAffichees(lignes = this.lignes) {
    const actifs = [...this.filtres].filter(([, f]) => filtreActif(f)).map(([code, f]) => [this.modele.parCode.get(code), f]).filter(([c]) => c);
    let res = actifs.length ? lignes.filter((l) => actifs.every(([c, f]) => correspond(f, this.#cellule(l, c), c))) : lignes;
    if (this.triLocal && lignes === this.lignes) {
      const c = this.modele.parCode.get(this.triLocal.code);
      if (c) {
        const s = this.triLocal.sens === 'desc' ? -1 : 1;
        const num = estNumerique(c);
        res = [...res].sort((a, b) => {
          const va = this.modele.valeur(a, c.code), vb = this.modele.valeur(b, c.code);
          const vide = (v) => v === null || v === undefined || v === '';
          if (vide(va) || vide(vb)) return comparerValeurs(va, vb, num); // vides en dernier
          return s * comparerValeurs(va, vb, num);
        });
      }
    }
    return res;
  }

  #ligneDom(ligne, visibles) {
    const tr = document.createElement('tr');
    const id = String(ligne._id);
    tr.dataset.id = id;
    const marque = this.marques.get(id);
    if (marque) tr.classList.add(marque);
    if (this.glisser?.({ ligne, definition: this.definition })) {
      tr.draggable = true;
      tr.classList.add('glissable');
      tr.title = "Glisser vers un document pour l'insérer";
    }
    if (this.selection === id || this.selections.has(id)) tr.classList.add('selectionnee');
    const coin = document.createElement('td');
    coin.className = 'liste-coin';
    tr.append(coin);
    for (const c of visibles) {
      const td = document.createElement('td');
      td.className = `aligne-${alignement(c)}`;
      td.dataset.code = c.code;
      if (this.modeSaisie && this.modifiables?.has(c.code)) td.classList.add('modifiable');
      const valeur = this.modele.valeur(ligne, c.code);
      const contenu = this.formats.contenu(valeur, c, this.modele);
      if (contenu instanceof Node) td.append(contenu); else td.textContent = contenu ?? '';
      appliquerStyle(td, this.modele.style(ligne, c.code));
      if (this.affichageLignes === 'simple' && typeof contenu === 'string' && contenu.length > 20) td.title = contenu;
      tr.append(td);
    }
    return tr;
  }

  rendreCorps() {
    const visibles = this.#visibles();
    const f = document.createDocumentFragment();
    const affichees = this.lignesAffichees();
    for (const l of affichees) f.append(this.#ligneDom(l, visibles));
    this.corps.replaceChildren(f);
    this.#compteur(affichees.length);
    this.#rendreSuite();
  }

  /** Nouveau lot : ajouté en fin de tableau, sauf tri local actif (le tableau est alors retrié). */
  #ajouterAuCorps(nouvelles) {
    if (this.triLocal) { this.rendreCorps(); return; }
    const visibles = this.#visibles();
    const f = document.createDocumentFragment();
    for (const l of this.lignesAffichees(nouvelles)) f.append(this.#ligneDom(l, visibles));
    this.corps.append(f);
    this.#compteur(this.corps.rows.length);
  }

  #compteur(affichees) {
    const charge = `${this.lignes.length}${this.fin ? '' : '+'}`;
    this.racine.querySelector('.liste-compteur').textContent = affichees === this.lignes.length
      ? `${charge} ligne${this.lignes.length > 1 ? 's' : ''}`
      : `${affichees} / ${charge} chargées`;
  }

  #rendreSuite() {
    const b = this.basSuite;
    if (!this.vue) { b.textContent = 'Aucune vue'; return; }
    if (this.enCours) b.innerHTML = '<span class="liste-attente">Chargement…</span>';
    else if (!this.fin) {
      b.innerHTML = '<button type="button">Charger la suite</button>';
      b.querySelector('button').addEventListener('click', () => this.chargerSuite().catch((e) => this.#erreur(e)));
    } else b.textContent = this.lignes.length ? `Fin de la liste · ${this.lignes.length} ligne${this.lignes.length > 1 ? 's' : ''}` : 'Aucune ligne';
  }

  /** Colonnes visibles, dans l'ordre choisi à la souris par l'utilisateur (sinon celui de la vue). */
  #visibles() {
    const visibles = this.modele.visibles;
    const ordre = this.prefs?.ordres?.[this.#cleLargeurs()];
    if (!ordre?.length) return visibles;
    const rang = new Map(ordre.map((code, i) => [code, i]));
    return [...visibles].sort((a, b) => (rang.get(a.code) ?? Infinity) - (rang.get(b.code) ?? Infinity));
  }

  /**
   * Déplacement d'une colonne : glisser l'en-tête (hors boutons et poignée) sur un autre en-tête, à gauche ou à
   * droite de sa moitié. L'ordre est une préférence du navigateur (le concepteur peut le reprendre dans la vue).
   */
  #deplacement(th, code) {
    th.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, .liste-poignee')) return;
      const x0 = e.clientX, y0 = e.clientY;
      let actif = false, cible = null;
      const marquer = (el, cote) => {
        this.table.tHead.querySelectorAll('th.depot-gauche, th.depot-droite').forEach((x) => x.classList.remove('depot-gauche', 'depot-droite'));
        if (el) el.classList.add(`depot-${cote}`);
      };
      const bouger = (ev) => {
        if (!actif && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        if (!actif) { actif = true; th.setPointerCapture(e.pointerId); th.classList.add('deplacee'); document.body.classList.add('deplacement-colonne'); }
        const sous = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('th[data-code]');
        if (!sous || !this.table.contains(sous)) { cible = null; marquer(null); return; }
        const r = sous.getBoundingClientRect();
        cible = { code: sous.dataset.code, apres: ev.clientX > r.left + r.width / 2 };
        marquer(sous, cible.apres ? 'droite' : 'gauche');
      };
      const finir = () => {
        th.removeEventListener('pointermove', bouger);
        th.removeEventListener('pointerup', finir);
        th.removeEventListener('pointercancel', finir);
        if (!actif) return;
        th.classList.remove('deplacee');
        document.body.classList.remove('deplacement-colonne');
        marquer(null);
        if (!cible || cible.code === code) return;
        const codes = this.#visibles().map((c) => c.code).filter((x) => x !== code);
        codes.splice(codes.indexOf(cible.code) + (cible.apres ? 1 : 0), 0, code);
        this.prefs.ordres = { ...this.prefs.ordres, [this.#cleLargeurs()]: codes };
        this.#ecrirePreferences();
        this.#rendreEntete();
        this.rendreCorps();
      };
      th.addEventListener('pointermove', bouger);
      th.addEventListener('pointerup', finir);
      th.addEventListener('pointercancel', finir);
    });
  }

  /** Largeurs ajustées à la souris pour la vue courante : préférence du navigateur, jamais en base. */
  #cleLargeurs() { return String(this.vue?.vli_id ?? 'nouvelle'); }

  #largeursAjustees() { return this.prefs.colonnes?.[this.#cleLargeurs()] ?? {}; }

  /** Redimensionnement d'une colonne par glisser sur le bord droit de l'en-tête ; double-clic : largeur de la vue. */
  #poignee(poignee, code) {
    poignee.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      poignee.setPointerCapture(e.pointerId);
      const i = this.#visibles().findIndex((c) => c.code === code);
      const col = this.table.querySelector('colgroup').children[i + 1];
      const depart = col.getBoundingClientRect().width;
      const x0 = e.clientX;
      let largeur = depart;
      document.body.classList.add('redimensionnement-colonne');
      const bouger = (ev) => {
        largeur = Math.round(Math.max(36, depart + ev.clientX - x0));
        const ancienne = parseFloat(col.style.width) || depart;
        col.style.width = `${largeur}px`;
        this.table.style.width = `${parseFloat(this.table.style.width) + largeur - ancienne}px`;
      };
      const finir = () => {
        poignee.removeEventListener('pointermove', bouger);
        poignee.removeEventListener('pointerup', finir);
        poignee.removeEventListener('pointercancel', finir);
        document.body.classList.remove('redimensionnement-colonne');
        if (largeur === depart) return;
        this.prefs.colonnes = { ...this.prefs.colonnes, [this.#cleLargeurs()]: { ...this.#largeursAjustees(), [code]: largeur } };
        this.#ecrirePreferences();
        this.#largeurs();
      };
      poignee.addEventListener('pointermove', bouger);
      poignee.addEventListener('pointerup', finir);
      poignee.addEventListener('pointercancel', finir);
    });
    poignee.addEventListener('click', (e) => e.stopPropagation());
    poignee.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const ajustees = { ...this.#largeursAjustees() };
      delete ajustees[code];
      this.prefs.colonnes = { ...this.prefs.colonnes, [this.#cleLargeurs()]: ajustees };
      this.#ecrirePreferences();
      this.#largeurs();
    });
  }

  #largeurs() {
    const ajustees = this.#largeursAjustees();
    // Une colonne ajustée à la souris devient fixe (pour cet utilisateur) ; les autres se partagent le reste.
    const visibles = this.#visibles().map((c) => (ajustees[c.code]
      ? { ...c, largeur: { mode: 'fixe', valeur: ajustees[c.code], min: 36, max: null } } : c));
    const dispo = Math.max(this.zone.clientWidth - LARGEUR_COIN - 2, 200);
    const largeurs = calculerLargeurs(visibles, dispo);
    const cg = this.table.querySelector('colgroup');
    cg.innerHTML = `<col style="width:${LARGEUR_COIN}px">${largeurs.map((l) => `<col style="width:${l}px">`).join('')}`;
    this.table.style.width = `${LARGEUR_COIN + largeurs.reduce((s, l) => s + l, 0)}px`;
  }

  // ---------------------------------------------------------------- sélection, ouverture

  /** Ligne courante ; Ctrl : ajoute ou retire de la sélection ; Maj : plage depuis l'ancre. */
  #selectionner(id, { basculer = false, etendre = false } = {}) {
    this.selection = id;
    if (etendre && this.ancre !== null) {
      // Plage depuis l'ancre, dans l'ordre affiché (filtres et tri compris).
      const ids = [...this.corps.rows].map((tr) => tr.dataset.id);
      const a = ids.indexOf(this.ancre), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) this.selections = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (basculer) {
      if (this.selections.size === 0 && this.ancre !== null) this.selections.add(this.ancre);
      if (this.selections.has(id)) this.selections.delete(id); else this.selections.add(id);
      this.ancre = id;
    } else {
      this.selections = new Set([id]);
      this.ancre = id;
    }
    for (const tr of this.corps.rows) {
      tr.classList.toggle('selectionnee', this.selections.has(tr.dataset.id));
      tr.classList.toggle('courante', tr.dataset.id === id);
    }
    this.corps.querySelector(`tr[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    this.#majActionsElements();
  }

  /** Boutons Consulter, Copier (une ligne) et Supprimer (une ou plusieurs) selon la vue et la sélection. */
  #majActionsElements() {
    const a = this.actionsElements;
    const n = this.lignesSelectionnees().length;
    for (const [code, min, max] of [['consulter', 1, 1], ['copier', 1, 1], ['supprimer', 1, Infinity]]) {
      const b = this.racine.querySelector(`[data-element="${code}"]`);
      if (!b) continue;
      b.hidden = !a?.[code];
      b.disabled = n < min || n > max;
    }
    const lignes = this.lignesSelectionnees();
    this.racine.querySelectorAll('[data-autre]').forEach((b) => {
      const x = a?.autres?.[Number(b.dataset.autre)];
      b.disabled = !x || n < 1 || n > (x.max ?? 1) || (x.actif ? !x.actif(lignes) : false);
    });
  }

  async #actionElement(code, evenement) {
    const lignes = this.lignesSelectionnees();
    const a = this.actionsElements;
    if (!a?.[code] || !lignes.length) return;
    if (code === 'consulter') { a.consulter(lignes[0], evenement); return; }
    if (code === 'copier') { await a.copier(lignes[0], evenement); return; }
    const libelle = lignes.length > 1 ? `${lignes.length} éléments` : `« ${lignes[0].numero ?? lignes[0].code ?? lignes[0].libelle ?? lignes[0].nom ?? lignes[0]._id} »`;
    if (!confirm(`Supprimer ${libelle} ? Cette suppression est définitive.`)) return;
    const refus = [];
    let supprimes = 0;
    for (const l of lignes) {
      try { await a.supprimer(l); supprimes++; } catch (e) { refus.push(`${l.numero ?? l.code ?? l._id} : ${e.message}`); }
    }
    if (supprimes) this.message(`${supprimes} élément(s) supprimé(s)`, 'succes');
    if (refus.length) this.message(`Suppression refusée — ${refus.join(' · ')}`, 'erreur');
    this.selections = new Set();
    this.selection = null;
    await this.verifier();
    this.#majActionsElements();
  }

  /** Menu contextuel d'une ligne : ouvrir, actions de la vue sur la sélection (mêmes règles que les boutons). */
  #menuLigne(e, id) {
    const a = this.actionsElements;
    const lignes = this.lignesSelectionnees();
    const n = lignes.length;
    const executer = (f) => () => Promise.resolve(f()).catch((x) => this.#erreur(x));
    ouvrirMenuContextuel(e, [
      { libelle: 'Ouvrir', raccourci: 'Entrée · double-clic', action: () => this.ouvrir(id), actif: n === 1 },
      { libelle: 'Ouvrir dans une nouvelle fenêtre', raccourci: 'Ctrl+Entrée · Ctrl+clic', action: () => this.ouvrir(id, { ctrlKey: true }), actif: n === 1 },
      { separateur: true },
      ...(a?.consulter ? [{ libelle: 'Consulter', action: executer(() => this.#actionElement('consulter')), actif: n === 1 }] : []),
      ...(a?.copier ? [{ libelle: 'Copier', action: executer(() => this.#actionElement('copier')), actif: n === 1 }] : []),
      ...(a?.supprimer ? [{ libelle: n > 1 ? `Supprimer (${n})` : 'Supprimer', action: executer(() => this.#actionElement('supprimer')), actif: n >= 1 }] : []),
      ...(a?.autres ?? []).map((x) => ({
        libelle: x.libelle, titre: x.titre, action: executer(() => x.action(lignes, e)),
        actif: n >= 1 && n <= (x.max ?? 1) && (x.actif ? x.actif(lignes) : true),
      })),
      { separateur: true },
      { libelle: 'Sélection multiple', raccourci: 'Ctrl+clic · Maj+clic · Maj+↑↓', actif: false },
    ]);
  }

  #clavier(e) {
    if (e.target !== this.zone) return;
    const lignes = [...this.corps.rows];
    const i = lignes.findIndex((tr) => tr.dataset.id === this.selection);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), lignes.length - 1);
      if (lignes[j]) this.#selectionner(lignes[j].dataset.id, { etendre: e.shiftKey });
    } else if (e.key === 'Enter' && this.selection) {
      e.preventDefault();
      this.ouvrir(this.selection, e);
    }
  }

  /** Lignes sélectionnées (données), dans l'ordre affiché ; sans sélection multiple, la ligne courante. */
  lignesSelectionnees() {
    const ids = this.selections.size ? this.selections
      : new Set(this.selection !== null && this.selection !== undefined ? [String(this.selection)] : []);
    return [...this.corps.rows].filter((tr) => ids.has(tr.dataset.id))
      .map((tr) => this.lignes.find((l) => String(l._id) === tr.dataset.id)).filter(Boolean);
  }

  // ---------------------------------------------------------------- saisie dans la liste

  /**
   * Colonnes saisissables de la vue : cochées « modifiable » dans la vue, modifiables dans la source (déclarée
   * modifiable par l'application, colonne modifiable dans la base), jamais calculées. Le serveur refait ces contrôles.
   */
  async #colonnesModifiables() {
    const vue = this.vue;
    this.modifiables = new Set();
    const bouton = this.racine.querySelector('[data-action="saisie"]');
    bouton.hidden = true;
    if (!vue || this.definition.source.mode !== 'vue' || !this.definition.colonnes.some((c) => c.modifiable && !c.calcul)) {
      if (this.modeSaisie) this.basculerSaisie(false);
      return;
    }
    this.sourcesConnues ??= await this.fournisseur.sources();
    if (vue !== this.vue) return;
    const s = this.sourcesConnues.find((x) => x.code === this.definition.source.vue);
    if (!s?.modifiable) return;
    const colonnes = new Map(s.colonnes.map((c) => [c.code, c]));
    this.modifiables = new Set(this.definition.colonnes.filter((c) => c.modifiable && !c.calcul && colonnes.get(c.code)?.modifiable).map((c) => c.code));
    bouton.hidden = this.modifiables.size === 0;
    if (this.modeSaisie) this.rendreCorps();
  }

  /** Mode saisie : un clic sur une cellule modifiable l'édite ; hors mode saisie, la liste reste en lecture. */
  basculerSaisie(actif = !this.modeSaisie) {
    this.modeSaisie = actif;
    const b = this.racine.querySelector('[data-action="saisie"]');
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-pressed', String(actif));
    this.racine.classList.toggle('liste-saisie', actif);
    this.rendreCorps();
    if (actif) this.message('Saisie : cliquez une cellule modifiable (fond hachuré) · Entrée : ligne suivante · Tab : colonne suivante · Échap : annuler');
  }

  #td(id, code) {
    return this.corps.querySelector(`tr[data-id="${CSS.escape(String(id))}"] td[data-code="${CSS.escape(code)}"]`);
  }

  #commencerSaisie(id, code) {
    const td = this.#td(id, code);
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    const c = this.modele.parCode.get(code);
    if (!td || !ligne || !c) return;
    const valeur = ligne[code];
    if (c.format === 'coche') { this.#enregistrer(id, code, !vraiDonnee(valeur)); return; }
    let ed;
    if (c.format === 'combo' || c.format === 'picto') {
      // Combo saisissable : la saisie filtre les options ou désigne directement l'option (libellé ou code).
      ed = creerCombo({
        options: c.options.map((o) => ({ valeur: String(o.valeur), libelle: `${o.picto ?? ''} ${o.libelle ?? o.valeur}`.trim() })),
        valeur: valeur === null || valeur === undefined ? '' : String(valeur),
      });
    } else if (c.format === 'date') {
      ed = document.createElement('input');
      ed.type = 'date';
      ed.value = String(valeur ?? '').slice(0, 10);
    } else if (c.format === 'texte' && (String(valeur ?? '').includes('\n') || this.affichageLignes === 'multi')) {
      ed = document.createElement('textarea');
      ed.value = valeur ?? '';
      ed.rows = Math.max(1, String(valeur ?? '').split('\n').length);
    } else {
      ed = document.createElement('input');
      ed.value = c.format === 'nombre' && valeur !== null && valeur !== undefined ? String(valeur).replace('.', ',') : valeur ?? '';
      if (c.format === 'nombre') ed.inputMode = 'decimal';
    }
    ed.classList.add('liste-editeur');
    td.replaceChildren(ed);
    td.classList.add('en-saisie');
    ed.focus();
    if (ed.select) ed.select();
    let fini = false;
    const terminer = async (mouvement) => {
      if (fini) return;
      fini = true;
      const saisie = ed.resoudre ? ed.resoudre() : ed.value;
      if (saisie === undefined) { this.message(`Valeur inconnue : ${ed.value}`, 'erreur'); fini = false; ed.focus(); return; }
      const ok = await this.#enregistrer(id, code, saisie, { texte: true });
      if (!ok) { fini = false; ed.focus(); return; }
      if (mouvement) this.#saisieSuivante(id, code, mouvement);
    };
    ed.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fini = true; this.#rendreLigne(id); this.zone.focus(); }
      else if (e.key === 'Enter' && !(ed.tagName === 'TEXTAREA' && (e.shiftKey || e.altKey))) { e.preventDefault(); terminer(e.shiftKey ? 'haut' : 'bas'); }
      else if (e.key === 'Tab') { e.preventDefault(); terminer(e.shiftKey ? 'gauche' : 'droite'); }
    });
    // Combo : un choix à la souris termine la saisie.
    if (ed.resoudre) ed.addEventListener('change', () => terminer(null));
    ed.addEventListener('blur', () => { if (!fini) terminer(null); });
  }

  /** Cellule suivante : même colonne sur la ligne suivante / précédente, ou colonne modifiable suivante / précédente. */
  #saisieSuivante(id, code, mouvement) {
    const lignes = [...this.corps.rows].map((tr) => tr.dataset.id);
    const colonnes = this.#visibles().map((c) => c.code).filter((x) => this.modifiables.has(x) && this.modele.parCode.get(x).format !== 'coche');
    let i = lignes.indexOf(String(id)), j = colonnes.indexOf(code);
    if (mouvement === 'bas') i++;
    else if (mouvement === 'haut') i--;
    else if (mouvement === 'droite') { j++; if (j >= colonnes.length) { j = 0; i++; } }
    else { j--; if (j < 0) { j = colonnes.length - 1; i--; } }
    if (i < 0 || i >= lignes.length || j < 0) return;
    this.#selectionner(lignes[i]);
    this.#commencerSaisie(lignes[i], colonnes[j]);
  }

  /**
   * Enregistre une valeur saisie : conversion selon le format, envoi au fournisseur avec l'empreinte de la ligne
   * (verrouillage optimiste), ligne relue en retour. Renvoie false si la saisie est invalide (l'éditeur reste ouvert).
   */
  async #enregistrer(id, code, saisie, { texte = false } = {}) {
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    const c = this.modele.parCode.get(code);
    let valeur = saisie;
    if (texte) {
      if (c.format === 'nombre') {
        valeur = lireNombre(saisie);
        if (valeur === undefined) { this.message(`Nombre invalide : ${saisie}`, 'erreur'); return false; }
      } else valeur = saisie === '' ? null : saisie;
    }
    const avant = ligne[code];
    const identique = (avant ?? null) === (valeur ?? null) || (c.format === 'nombre' && valeur !== null && avant !== null && Number(avant) === Number(valeur));
    if (identique) { this.#rendreLigne(id); return true; }
    const td = this.#td(id, code);
    td?.classList.add('enregistrement');
    try {
      const relue = await this.fournisseur.modifier(this.demande(), id, ligne._h, { [code]: valeur });
      this.#remplacerLigne(id, relue);
      return true;
    } catch (e) {
      if (e.code === 'LIGNE_MODIFIEE' && e.details) {
        this.#remplacerLigne(id, e.details);
        this.message(e.message, 'avertissement');
        return true;
      }
      this.message(e.message ?? String(e), 'erreur');
      this.#rendreLigne(id);
      return true;
    }
  }

  #remplacerLigne(id, nouvelle) {
    const i = this.lignes.findIndex((l) => String(l._id) === String(id));
    if (i < 0) return;
    this.modele.oublier(this.lignes[i]);
    this.lignes[i] = nouvelle;
    this.marques.set(String(id), 'modifiee');
    this.#rendreLigne(id);
    this.#effacerMarques();
  }

  #rendreLigne(id) {
    const tr = this.corps.querySelector(`tr[data-id="${CSS.escape(String(id))}"]`);
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    if (tr && ligne) tr.replaceWith(this.#ligneDom(ligne, this.#visibles()));
  }

  /** Ouvre la fiche de la ligne : l'ID et le type d'élément sont fournis par la source (Ctrl ou Maj : nouvelle fenêtre). */
  ouvrir(id, evenement = null) {
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    const nouvelleFenetre = Boolean(evenement?.ctrlKey || evenement?.shiftKey || evenement?.metaKey);
    if (ligne) this.ouvrirExterne?.({ id: ligne._id, type: ligne._type, ligne, nouvelleFenetre });
  }
}
