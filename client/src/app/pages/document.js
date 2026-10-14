import { PageBase } from '@logibtp/navigation';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { Disposition, GestionVuesDocument, FournisseurVuesMemoire, PlanDocument, RechercheLignes } from '@logibtp/document/ui';
import { PanneauMetre } from '@logibtp/metre/ui';
import { VERSION_MOTEUR } from '../../calcul/index.js';
import { api } from '../api.js';
import { DEFINITION_DEMO, DOCUMENT_DEMO } from '../demo.js';
import { VUES_DOCUMENT } from '../vues-document.js';
import { EditeurDevisBtp, PressePapiersBtp, DictionnaireBtp } from '../editeur-btp.js';
import { PanneauxBtp } from '../panneaux-btp.js';
import { AnalyseCoefficients } from '../analyse-coefs.js';
import { EnvoiBibliotheque } from '../bibliotheque/envoi.js';
import { AppelBibliotheque } from '../bibliotheque/appel.js';
import { completerRattachement } from '../structure/structure.js';
import { proposerMarche } from '../structure/marche-commande.js';
import { transformerDocument } from '../documents/transformation.js';

// Document (devis, facture…) dans l'éditeur du cœur : /document/<id>, /document/demo (devis de démonstration :
// local hors ligne, créé dans la base au premier lancement en ligne), /document/nouveau?type=<code>.

const GABARIT = `
  <div class="document-barre">
    <nav class="onglets" role="tablist">
      <button role="tab" data-onglet-vue="entete" title="Alt+1">Entête</button>
      <button role="tab" data-onglet-vue="lignes" title="Alt+2">Lignes</button>
      <button role="tab" data-onglet-vue="analyse" title="Alt+3 : coefficients par nature ou par tranche">Analyse</button>
      <button role="tab" data-onglet-vue="pieces" title="Alt+4 : documents de la GED liés au document, pièces jointes à envoyer">Pièces</button>
    </nav>
    <div class="groupe">
      <button data-action="annuler" title="Annuler (Ctrl+Z)">↶</button>
      <button data-action="retablir" title="Rétablir (Ctrl+Y)">↷</button>
      <button data-action="enregistrer" class="principal" title="Enregistrer (Ctrl+S)">Enregistrer</button>
      <button data-action="valider" title="Valider et bloquer le document">Valider</button>
      <button data-action="transformer" title="Transformer le reliquat en un autre document">Transformer…</button>
      <button data-action="bibliotheque" title="Bibliothèque dans une autre fenêtre (pour insérer un élément : F3 dans la grille, son code dans la colonne Code, ou glisser-déposer)">📚 Bib</button>
    </div>
    <span class="groupe" data-vues></span>
    <span class="groupe"><button data-basculer-dock="plan" title="Afficher ou masquer le plan du document (tranches)">☰ Plan</button>
      <button data-action="rechercher" title="Rechercher dans les lignes sans filtrer (Ctrl+F)">🔍</button></span>
  </div>
  <div class="document-verrou" hidden></div>
  <main class="document-zone">
    <section id="vue-entete" class="vue vue-entete" role="tabpanel">
      <div id="entete" class="panneau entete"></div>
      <section id="totaux-entete" class="panneau totaux-entete"></section>
    </section>
    <section id="vue-analyse" class="vue vue-analyse" role="tabpanel"></section>
    <section id="vue-pieces" class="vue vue-pieces" role="tabpanel"></section>
    <section id="vue-lignes" class="vue vue-lignes" role="tabpanel">
      <div class="zone-dock" data-zone="gauche"></div>
      <div class="separateur" data-sep="gauche" title="Glisser pour redimensionner · double-clic pour réduire"></div>
      <div class="zone-lignes">
        <section id="ecarts" class="panneau ecarts" hidden></section>
        <div class="barre-filtre" hidden></div>
        <div id="recherche-lignes" hidden></div>
        <div id="grille"></div>
        <footer class="pied-lignes">
          <div id="totaux" class="totaux-compacts"></div>
          <span class="aide" title="Entrée, F2 ou double-clic : saisir · Échap : mode ligne · Ctrl+Entrée : insérer après · Ctrl+Maj+Entrée : avant · Alt+Entrée : composante · Ctrl+→ / Ctrl+← (ou Tab / Maj+Tab) : niveau · Ctrl+↑↓ (ou Alt+↑↓) : ordre · Ctrl+D : dupliquer · Suppr · Ctrl+X/C/V · F4 : métré · + / − : déplier / replier · glisser par ⋮⋮">Raccourcis ⓘ</span>
        </footer>
      </div>
      <div class="separateur" data-sep="droite" title="Glisser pour redimensionner · double-clic pour réduire"></div>
      <div class="zone-dock" data-zone="droite"></div>
      <div class="separateur" data-sep="bas" title="Glisser pour redimensionner · double-clic pour réduire"></div>
      <div class="zone-dock" data-zone="bas"></div>
      <aside class="dock" data-dock-id="plan">
        <header class="dock-entete">
          <span class="dock-titre">Plan du document</span>
          <div class="dock-boutons">
            <button data-dock="gauche" title="Ancrer à gauche">◧</button>
            <button data-dock="bas" title="Ancrer en bas">⬓</button>
            <button data-dock="droite" title="Ancrer à droite">◨</button>
            <button data-action="reduire" title="Réduire">–</button>
            <button data-action="fermer" title="Fermer le plan (bouton Plan de la barre pour le rouvrir)">✕</button>
          </div>
        </header>
        <div class="dock-contenu"><section id="plan"></section></div>
      </aside>
      <aside class="dock" data-dock-id="detail">
        <header class="dock-entete">
          <span class="dock-titre">Détail de la ligne</span>
          <div class="dock-boutons">
            <button data-dock="gauche" title="Ancrer à gauche">◧</button>
            <button data-dock="bas" title="Ancrer en bas">⬓</button>
            <button data-dock="droite" title="Ancrer à droite">◨</button>
            <button data-action="reduire" title="Réduire">–</button>
          </div>
        </header>
        <div class="dock-contenu">
          <section id="detail" class="detail"></section>
          <section id="controles" class="controles" hidden></section>
        </div>
      </aside>
    </section>
  </main>
  <aside id="metre" class="tiroir" hidden></aside>`;

/** Contenu de saisie à partir d'un document complet renvoyé par l'API. */
const versSaisie = (d) => ({ document: d.document, lignes: d.lignes, metres: d.metres ?? [], metre_lignes: d.metre_lignes ?? [], variables: d.variables ?? [] });

export class PageDocument extends PageBase {
  icone = '📝';

  $(s) { return this.conteneur.querySelector(s); }

  async ouvrir() {
    const app = this.app;
    this.conteneur.innerHTML = GABARIT;
    this.conteneur.classList.add('page-document');
    this.disposition = new Disposition({
      racine: this.conteneur,
      surOnglet: (o) => {
        if (o === 'lignes') this.editeur?.grille.focus();
        if (o === 'analyse') this.analyse?.rendre();
        if (o === 'pieces') this.afficherPieces();
      },
      // Plan fermé : le filtre d'affichage qu'il a posé est retiré.
      surDock: (id, visible) => { if (id === 'plan' && !visible && this.editeur?.filtre !== null) this.editeur?.filtrer(null); },
    });
    const actions = {
      enregistrer: () => this.enregistrer(), valider: () => this.valider(), transformer: () => this.transformer(),
      annuler: () => this.editeur?.magasin.annuler(), retablir: () => this.editeur?.magasin.retablir(),
      // Bibliothèque dans une autre fenêtre (liste de tous les éléments) ; l'insertion reste par F3 ou par code.
      bibliotheque: () => app.naviguer('/liste/bibliotheque?vue=14', { nouvelleFenetre: true }),
      rechercher: () => { this.disposition.onglet('lignes'); this.recherche?.ouvrir(); },
    };
    this.conteneur.querySelector('.document-barre').addEventListener('click', (e) => {
      const plan = e.target.closest('[data-basculer-dock]');
      if (plan) { this.disposition.afficher(plan.dataset.basculerDock); return; }
      const b = e.target.closest('button[data-action]');
      if (b && actions[b.dataset.action]) Promise.resolve(actions[b.dataset.action]()).catch((x) => app.erreur(x));
    });
    this.clavier = (e) => {
      // Alt+1 / Alt+2 : onglets Entête et Lignes.
      const onglet = e.altKey && !e.ctrlKey ? { Digit1: 'entete', Digit2: 'lignes', Digit3: 'analyse', Digit4: 'pieces' }[e.code] : null;
      if (onglet) { e.preventDefault(); this.disposition.onglet(onglet); }
      // Ctrl+F : recherche dans les lignes (sans filtre), à la place de la recherche du navigateur.
      // Onglet Analyse : recherche dans la liste des éléments.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyF' && this.recherche) {
        e.preventDefault();
        if (this.disposition.p.onglet === 'analyse') { this.analyse?.ouvrirRecherche(); return; }
        this.disposition.onglet('lignes');
        this.recherche.ouvrir();
      }
    };
    document.addEventListener('keydown', this.clavier);
    document.body.classList.add('avec-document');
    // Bibliothèque : appel par code (colonne Code), F3, bibliothèque du document (entête).
    const s = await app.services();
    this.bibliotheques = await s.bibliotheque.bibliotheques().catch(() => []);
    // Structure des affaires : listes de choix du rattachement (entête) et marché proposé à la validation d'une commande.
    this.servicesStructure = s.structure;
    this.servicesFiche = s.fiche;
    this.servicesAnnuaire = s.annuaire;
    this.servicesGed = s.ged;
    this.structure = await s.structure?.referentiels().catch(() => null) ?? null;
    // Mise à jour ou création d'éléments de la bibliothèque depuis les lignes du document.
    this.envoi = new EnvoiBibliotheque({
      fiche: s.fiche, bibliotheque: s.bibliotheque, editeur: () => this.editeur, bibDocument: () => this.appel.bibDocument(),
      message: (t, n) => app.message(t, n),
    });
    // Coefficients par défaut (bibliothèque) : couleur des coefficients des lignes.
    const params = await s.bibliotheque.parametres?.().catch(() => null);
    this.coefsDefaut = { fg: params?.coef_fg_defaut ?? 1, benef: params?.coef_benef_defaut ?? 1 };
    this.natures = await s.bibliotheque.natures?.().catch(() => []) ?? [];
    this.appel = new AppelBibliotheque({
      fournisseur: s.bibliotheque, editeur: () => this.editeur, message: (t, n) => app.message(t, n),
      bibliotheque: () => this.bibliotheques.find((b) => b.id === Number(this.editeur?.saisie.document.ent_bib_id))?.code ?? null,
    });

    const { id } = this.params;
    if (!app.enLigne) {
      if (id !== 'demo' && Number(id) !== DOCUMENT_DEMO.document.ent_id) throw new Error("Démo hors ligne : seul le devis de démonstration s'ouvre (/document/demo)");
      await this.charger(DEFINITION_DEMO, DOCUMENT_DEMO);
      return;
    }
    this.types = await api.typesDocument();
    // Création depuis les listes : /document/nouveau?type=<code>.
    if (id === 'nouveau') {
      await this.nouveau(this.requete.type ?? 'V_DEVIS');
    } else if (id === 'demo') {
      // Premier lancement : le devis de démonstration est créé dans la base.
      const docs = await api.documents();
      const demo = docs.find((d) => d.ent_objet === DOCUMENT_DEMO.document.ent_objet) ?? null;
      const docId = demo?.ent_id ?? await this.creerDemo();
      app.routeur.remplacerUrl(`/document/${docId}`);
      await this.chargerDocument(docId);
    } else await this.chargerDocument(Number(id));
  }

  async chargerDocument(id) {
    await this.liberer();
    const complet = await api.document(id);
    const type = this.types.find((t) => t.tyd_id === complet.document.ent_tyd_id);
    const definition = await api.definition(type.tyd_code);
    await this.charger(definition, complet);
    await this.prendreVerrou();
  }

  // ---------------------------------------------------------------- verrou de modification (en ligne)

  /** Document modifiable par cet utilisateur (statut, validation, droit) : il est alors verrouillé à l'ouverture. */
  #modifiable() {
    const ed = this.editeur;
    const doc = ed.saisie.document;
    const statut = ed.definition.statuts?.find((s) => s.std_id === doc.ent_std_id);
    return statut?.std_modifiable !== false && !doc.ent_verrouille && (ed.definition.droits ?? []).includes('MODIFIER');
  }

  /**
   * Prise (ou renouvellement) du verrou. Pris par un autre utilisateur : lecture seule et bandeau. Le verrou n'expire
   * pas : seul un administrateur peut lever celui d'une fenêtre fermée ou d'une connexion perdue. Le même utilisateur
   * reprend son propre verrou sans avertissement.
   */
  async prendreVerrou() {
    if (!this.app.enLigne || !this.editeur || !this.#modifiable()) { this.#etatVerrou(null); return; }
    this.jeton ??= crypto.randomUUID();
    const id = this.editeur.saisie.document.ent_id;
    const r = await api.verrouillerDocument(id, this.jeton);
    this.verrouDetenu = r.ok ? id : null;
    this.#etatVerrou(r.ok ? null : r.verrou);
    clearInterval(this.battement);
    // Battement : dernière activité (information pour l'administrateur) ; détecte un déverrouillage forcé.
    this.battement = setInterval(() => {
      if (!this.verrouDetenu) return;
      api.verrouillerDocument(this.verrouDetenu, this.jeton).then((x) => {
        if (!x.ok) { this.verrouDetenu = null; this.#etatVerrou(x.verrou); this.app.message(`Document repris en modification par ${x.verrou?.utilisateur}`, 'erreur'); }
      }).catch(() => {});
    }, 30000);
  }

  #etatVerrou(verrou) {
    this.bloque = verrou;
    const zone = this.$('.document-verrou');
    const magasin = this.editeur?.magasin;
    if (magasin) {
      magasin.lectureSeule = Boolean(verrou);
      magasin.surRefus = () => this.app.message(`Lecture seule : document ouvert en modification par ${verrou?.utilisateur}`, 'avertissement');
    }
    zone.hidden = !verrou;
    if (verrou) {
      const h = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      zone.innerHTML = `🔒 Document ouvert en modification par <b>${echapper(verrou.utilisateur)}</b> depuis le ${h(verrou.depuis)}
        <span class="aide">(dernière activité ${h(verrou.vu)}) : lecture seule.</span>
        <button type="button" data-verrou="reessayer">Réessayer</button>
        ${this.app.estAdmin() ? '<button type="button" data-verrou="forcer" class="danger" title="Fenêtre fermée, connexion perdue… : le verrou n’expire pas tout seul">Déverrouiller</button>' : ''}`;
      zone.querySelector('[data-verrou="reessayer"]').addEventListener('click', () => this.prendreVerrou().catch((e) => this.app.erreur(e)));
      zone.querySelector('[data-verrou="forcer"]')?.addEventListener('click', async () => {
        if (!confirm(`Déverrouiller le document ? Les modifications non enregistrées de ${verrou.utilisateur} seront perdues.`)) return;
        try {
          await api.forcerDeverrouillageDocument(this.editeur.saisie.document.ent_id);
          await this.prendreVerrou();
          this.app.message('Document déverrouillé', 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    }
    this.rafraichir();
  }

  /** Libération du verrou (changement de document, page quittée, onglet fermé : requête keepalive). */
  async liberer() {
    clearInterval(this.battement);
    const id = this.verrouDetenu;
    this.verrouDetenu = null;
    if (id !== null && id !== undefined) await api.deverrouillerDocument(id, this.jeton).catch(() => {});
  }

  async charger(definition, complet) {
    const zone = this.$('#grille');
    this.panneaux = null;
    zone.replaceChildren();
    this.selection = null;
    this.editeur = new EditeurDevisBtp(zone, {
      definition,
      saisie: versSaisie(complet),
      surSelection: (id) => {
        this.selection = id;
        this.plan?.rendre();
        this.panneaux?.rendreDetail(this.$('#detail'), id);
        this.metre?.suivre(id); // le métré ouvert suit la ligne sélectionnée
      },
      surMessage: (t) => this.app.message(t),
      ouvrirMetre: (ligId, mtrId) => this.metre.ouvrir(ligId, mtrId),
      appelerCode: (ligId, code) => this.appel.appeler(ligId, code),
      rechercher: (ligId) => this.appel.rechercher(ligId),
    });
    this.panneaux = new PanneauxBtp(this.editeur, {
      bibliotheques: this.bibliotheques, structure: this.structure, rattacher: (r) => this.rattacher(r).catch((x) => this.app.erreur(x)),
      // Bibliothèque depuis le détail de la ligne (lignes sélectionnées, ou la ligne du détail).
      actualiserPrix: (ids) => this.appel?.actualiser(ids), versBibliotheque: (ids) => this.envoi?.ouvrir(ids),
      annuaire: this.servicesAnnuaire, intervenants: (type, id) => this.servicesStructure.intervenants(type, id),
    });
    this.plan = new PlanDocument(this.$('#plan'), { editeur: this.editeur });
    this.recherche = new RechercheLignes(this.$('#recherche-lignes'), { editeur: this.editeur });
    // Éléments glissés depuis la fenêtre de la bibliothèque.
    this.editeur.surDepotExterne = (donnees, cibleId, position) => this.appel.deposer(donnees, cibleId, position);
    this.analyse = new AnalyseCoefficients(this.$('#vue-analyse'), { editeur: this.editeur, natures: this.natures, message: (t) => this.app.message(t) });
    this.editeur.coefsDefaut = this.coefsDefaut;
    this.editeur.natures = this.natures;
    this.editeur.surFiltre = () => this.afficherFiltre();
    this.afficherFiltre();
    // Vues de colonnes : vue mémorisée (navigateur) ou vue par défaut du type et du modèle du document.
    this.vues = new GestionVuesDocument(this.$('[data-vues]'), {
      editeur: this.editeur, fournisseur: this.fournisseurVues(), admin: () => this.app.estAdmin(), message: (t) => this.app.message(t),
    });
    this.modeleAffiche = this.editeur.saisie.document.ent_modele ?? null;
    await this.vues.charger();
    this.metre = new PanneauMetre(this.$('#metre'), this.editeur, {
      fermer: (ligId) => { this.editeur.grille.selectionner(ligId, { colonne: 3 }); this.editeur.grille.focus(); },
      message: (t) => this.app.message(t),
      dictionnaire: new DictionnaireBtp(this.editeur),
    });
    this.editeur.magasin.abonner(() => this.rafraichir());
    this.marque = this.editeur.magasin.pile.at(-1);
    this.ecarts = null;
    this.rafraichir();
    if (this.disposition.p.onglet === 'lignes') this.editeur.grille.focus();
  }

  /** Modifications non enregistrées : la pile d'annulation a changé depuis l'ouverture ou le dernier enregistrement. */
  get modifiee() { return Boolean(this.editeur) && this.editeur.magasin.pile.at(-1) !== this.marque; }

  /** Bandeau au-dessus de la grille quand l'affichage est filtré sur une tranche. */
  afficherFiltre() {
    const barre = this.$('.barre-filtre');
    const ed = this.editeur;
    const description = ed.descriptionFiltres();
    barre.hidden = description === null;
    barre.replaceChildren();
    if (description !== null) {
      barre.innerHTML = `<span>Affichage filtré : <strong>${echapper(description)}</strong> (saisie et totaux sur tout le document)</span><button type="button">✕ Tout afficher</button>`;
      barre.querySelector('button').addEventListener('click', () => { ed.retirerFiltres(); ed.grille.focus(); });
    }
    this.plan?.rendre();
  }

  /** Vues de colonnes : API en ligne, mémoire (vues du cœur) hors ligne, partagée par les documents ouverts. */
  fournisseurVues() {
    if (this.app.enLigne) {
      return { vues: (type) => api.vuesDocument(type), enregistrer: (v) => api.enregistrerVueDocument(v), supprimer: (id) => api.supprimerVueDocument(id) };
    }
    PageDocument.vuesDemo ??= new FournisseurVuesMemoire({ vues: VUES_DOCUMENT, utilisateur: () => this.app.utilisateur(), admin: () => this.app.estAdmin() });
    return PageDocument.vuesDemo;
  }

  rafraichir() {
    const ed = this.editeur;
    if (!ed) return;
    // Modèle du document changé : vue mémorisée ou par défaut de ce modèle.
    const modele = ed.saisie.document.ent_modele ?? null;
    if (this.vues && modele !== this.modeleAffiche) {
      this.modeleAffiche = modele;
      this.vues.changerModele().catch((x) => this.app.erreur(x));
    }
    const p = this.panneaux;
    const enLigne = this.app.enLigne;
    p.rendreEntete(this.$('#entete'));
    this.plan?.rendre();
    if (this.disposition.p.onglet === 'analyse') this.analyse?.rendre();
    p.rendreDetail(this.$('#detail'), this.selection);
    p.rendreTotaux(this.$('#totaux'), { compact: true });
    p.rendreTotaux(this.$('#totaux-entete'));
    const doc = ed.saisie.document;
    const d = ed.resultat.document;
    this.titre = `${ed.definition.type?.tyd_libelle ?? 'Document'} ${doc.ent_numero ?? ''}`.trim();
    // Le net à payer est affiché dans les totaux sous la grille.
    p.rendreMessages(this.$('#controles'), (id) => ed.grille.selectionner(id));
    p.rendreEcarts(this.$('#ecarts'), this.ecarts, (decision, commentaire) => this.arbitrer(decision, commentaire).catch((x) => this.app.erreur(x)));
    this.$('[data-action="annuler"]').disabled = ed.magasin.pile.length === 0;
    this.$('[data-action="retablir"]').disabled = ed.magasin.pileRefaire.length === 0;
    const statut = ed.definition.statuts?.find((s) => s.std_id === doc.ent_std_id);
    const modifiable = statut?.std_modifiable !== false && !doc.ent_verrouille && !this.bloque;
    this.$('[data-action="enregistrer"]').disabled = !enLigne || !modifiable;
    this.$('[data-action="valider"]').disabled = !enLigne || !modifiable;
    this.$('[data-action="transformer"]').disabled = !enLigne || !(ed.definition.transformations?.length);
    document.body.classList.toggle('lecture-seule', !modifiable);
    if (this.disposition?.p.onglet === 'pieces') this.afficherPieces();
    this.app.majPage();
  }

  /** Premier lancement en ligne : crée le devis de démonstration dans la base. */
  async creerDemo() {
    const devis = this.types.find((t) => t.tyd_code === 'V_DEVIS');
    const cree = await api.creer({ ent_tyd_id: devis.tyd_id, ent_tiers_id: DOCUMENT_DEMO.document.ent_tiers_id, ent_objet: DOCUMENT_DEMO.document.ent_objet, ent_num_format: DOCUMENT_DEMO.document.ent_num_format });
    const contenu = new PressePapiersBtp().renumeroter({ racines: [], ...DOCUMENT_DEMO }, -1);
    for (const l of contenu.lignes) l.lig_origine_id = null;
    const definition = await api.definition('V_DEVIS');
    const ed = new EditeurDevisBtp(document.createElement('div'), {
      definition, saisie: { document: { ...cree.document, ent_proprietes: DOCUMENT_DEMO.document.ent_proprietes }, ...contenu },
    });
    const r = ed.resultat;
    await api.enregistrer(cree.document.ent_id, {
      document: r.document, lignes: r.lignes, metres: r.metres, metre_lignes: r.metre_lignes, variables: r.variables, version_moteur_client: VERSION_MOTEUR,
    });
    return cree.document.ent_id;
  }

  async nouveau(code) {
    const type = this.types.find((t) => t.tyd_code === code);
    if (!type) throw new Error(`Type de document inconnu : ${code}`);
    // Tiers choisi ensuite dans l'annuaire du document (obligatoire à la validation).
    const cree = await api.creer({ ent_tyd_id: type.tyd_id, ent_tiers_id: null, ent_objet: `Nouveau ${type.tyd_libelle.toLowerCase()}` });
    this.app.routeur.remplacerUrl(`/document/${cree.document.ent_id}`);
    await this.chargerDocument(cree.document.ent_id);
    this.disposition.onglet('entete');
    this.app.publier('enregistre', { type: code, ids: [cree.document.ent_id], cree: true });
    this.app.message(`${type.tyd_libelle} ${cree.document.ent_numero ?? ''} créé`);
  }

  /**
   * Enregistrement en un seul appel : le client envoie ses résultats, le serveur recalcule, compare,
   * renvoie les ID définitifs et les écarts. La pile d'annulation est conservée.
   */
  async enregistrer() {
    if (this.$('[data-action="enregistrer"]').disabled) return;
    const ed = this.editeur;
    const r = ed.resultat;
    const envoi = { document: r.document, lignes: r.lignes, metres: r.metres, metre_lignes: r.metre_lignes, variables: r.variables, version_moteur_client: VERSION_MOTEUR };
    const saisieEnvoyee = structuredClone(ed.entree(ed.saisie));
    const rep = await api.enregistrer(ed.saisie.document.ent_id, envoi);
    const map = (table, id) => (id === null || id === undefined ? id : table[id] ?? id);
    // Correspondances des compléments du module Métré, par table (réponse générique du module Document).
    const cl = rep.correspondance_lignes;
    const { metres: cm = {}, metre_lignes: cml = {}, variables: cv = {} } = rep.correspondances ?? {};
    ed.magasin.appliquerServeur((d) => {
      d.document = rep.document.document;
      for (const l of d.lignes) {
        l.lig_id = map(cl, l.lig_id);
        l.lig_parent_id = map(cl, l.lig_parent_id);
        l.lig_st_depuis_id = map(cl, l.lig_st_depuis_id);
        l.lig_variante_de_id = map(cl, l.lig_variante_de_id);
        l.lig_pied_base_id = map(cl, l.lig_pied_base_id);
        l.lig_mtr_id = map(cm, l.lig_mtr_id);
        l.lig_ent_id = d.document.ent_id;
      }
      for (const m of d.metres) { m.mtr_id = map(cm, m.mtr_id); m.mtr_lig_id = map(cl, m.mtr_lig_id); }
      for (const x of d.metre_lignes) {
        x.mli_id = map(cml, x.mli_id); x.mli_mtr_id = map(cm, x.mli_mtr_id);
        x.mli_parent_id = map(cml, x.mli_parent_id); x.mli_st_depuis_id = map(cml, x.mli_st_depuis_id);
      }
      for (const v of d.variables) { v.var_id = map(cv, v.var_id); v.var_lig_id = map(cl, v.var_lig_id); v.var_mtr_id = map(cm, v.var_mtr_id); }
    });
    if (this.selection !== null) this.selection = map(cl, this.selection);
    ed.grille.courant = map(cl, ed.grille.courant);
    ed.grille.selection = ed.grille.selection.map((id) => map(cl, id));
    this.ecarts = rep.ecarts.length ? rep.ecarts : null;
    this.dernierEnvoi = { entree: saisieEnvoyee, client: envoi, serveur: rep.document };
    this.marque = ed.magasin.pile.at(-1);
    this.rafraichir();
    // Rafraîchissement ciblé de la ligne du document dans les listes (cette fenêtre et les autres).
    this.app.publier('enregistre', { type: rep.document.document.ent_tyd_id, ids: [rep.document.document.ent_id] });
    this.app.message(rep.ecarts.length ? `Enregistré avec ${rep.ecarts.length} écart(s) de calcul à arbitrer` : `Enregistré (version ${rep.document.document.ent_version})`,
      rep.ecarts.length ? 'avertissement' : 'succes');
  }

  async arbitrer(decision, commentaire) {
    const e = this.dernierEnvoi;
    const rep = await api.casTest({
      ent_id: this.editeur.saisie.document.ent_id, cas_decision: decision, cas_commentaire: commentaire || null,
      version_client: VERSION_MOTEUR, document_entree: e.entree, resultat_client: e.client, resultat_serveur: e.serveur, ecarts: this.ecarts,
    });
    this.ecarts = null;
    this.rafraichir();
    this.app.message(`Cas de test n° ${rep.cas_id} enregistré (${decision === 'S' ? 'serveur validé' : 'anomalie'})`, 'succes');
  }

  /**
   * Rattachement à la structure (marché → chantier → affaire complétés). Document modifiable : modification de la
   * saisie (enregistrée avec le document) ; validé : classement direct, sans toucher au contenu.
   */
  async rattacher(r) {
    const ed = this.editeur;
    const complet = completerRattachement(r, this.structure ?? { chantiers: [], marches: [] });
    if (!this.app.enLigne || (this.#modifiable() && !this.bloque && !ed.magasin.lectureSeule)) {
      ed.magasin.modifier((b) => { Object.assign(b.document, complet); }, 'Rattachement');
      // Annuaire encore vide (tiers seul) : intervenants du marché ou du chantier repris d'office.
      if (this.panneaux.intervenantsDocument().length <= 1) {
        const n = await this.panneaux.reprendreIntervenants();
        if (n) this.app.message(`${n} intervenant(s) repris du rattachement`);
      }
      return;
    }
    const doc = ed.saisie.document;
    Object.assign(doc, await this.servicesStructure.rattacher(doc.ent_id, complet));
    this.app.publier('enregistre', { ids: [doc.ent_id] });
    this.app.message('Rattachement enregistré', 'succes');
    this.rafraichir();
  }

  /**
   * Onglet Pièces : documents de la GED liés au document (type du document, groupe des indices : les pièces suivent
   * les nouveaux indices), marquage des pièces jointes à envoyer (module Mail). Recréé quand le document change.
   */
  afficherPieces() {
    const zone = this.$('#vue-pieces');
    const d = this.editeur?.saisie.document;
    if (!d) return;
    const cle = `${d.ent_tyd_id}-${d.ent_groupe_id ?? d.ent_id}`;
    if (this.ged && this.gedCle === cle) return;
    this.ged?.detruire?.();
    zone.replaceChildren();
    if (!this.servicesGed) { zone.innerHTML = '<p class="aide">La GED n\'est pas branchée.</p>'; return; }
    const type = this.editeur.definition.type;
    this.gedCle = cle;
    this.ged = new ExplorateurGed(zone, {
      fournisseur: this.servicesGed, envoi: true, modifiable: true, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(),
      contexte: { type_element: type?.tyd_code ?? 'document', id_element: String(d.ent_groupe_id ?? d.ent_id), libelle: `${type?.tyd_libelle ?? 'Document'} ${d.ent_numero ?? ''}`.trim() },
      message: (t, n) => this.app.message(t, n),
    });
  }

  async valider() {
    const ed = this.editeur;
    if (this.modifiee && !confirm('Le document doit d\'abord être enregistré. Enregistrer puis valider ?')) return;
    if (this.modifiee) await this.enregistrer();
    const rep = await api.valider(ed.saisie.document.ent_id, ed.saisie.document.ent_version);
    await this.chargerDocument(rep.document.document.ent_id);
    this.app.publier('enregistre', { ids: [rep.document.document.ent_id] });
    this.app.message(`Document validé : ${rep.document.document.ent_numero}`, 'succes');
    if (this.editeur.definition.type?.tyd_code === 'V_COMMANDE' && !this.editeur.saisie.document.ent_marche_id) await this.proposerMarche();
  }

  /** Commande client validée sans marché : création du marché sur un chantier, ou rattachement à un marché existant. */
  async proposerMarche() {
    if (!this.servicesStructure || !this.servicesFiche) return;
    this.structure = await this.servicesStructure.referentiels();
    const doc = this.editeur.saisie.document;
    const r = await proposerMarche({
      refs: this.structure, doc, totalHt: this.editeur.resultat.document?.ent_total_ht ?? null,
      // Le marché reprend les intervenants du chantier.
      creerMarche: async (valeurs) => this.servicesFiche.creer('marche', {
        valeurs: { ...valeurs, intervenants: await this.servicesStructure.intervenants('chantier', valeurs.cha_id).catch(() => []) }, proprietes: {},
      }),
    });
    if (!r) return;
    this.structure = await this.servicesStructure.referentiels();
    this.panneaux.structure = this.structure;
    await this.rattacher({ ...doc, ent_marche_id: r.ent_marche_id });
    if (r.cree) this.app.message('Marché créé et commande rattachée', 'succes');
  }

  async transformer() {
    const ed = this.editeur;
    const d = ed.saisie.document;
    if (this.modifiee) { this.app.message('Enregistrez le document avant de le transformer', 'avertissement'); return; }
    const cree = await transformerDocument({
      entId: d.ent_id, typeCode: ed.definition.type.tyd_code, numero: d.ent_numero, objet: d.ent_objet, types: this.types,
      definition: ed.definition, message: (t, n) => this.app.message(t, n),
    });
    if (!cree) return;
    this.app.publier('enregistre', { ids: [cree.ent_id], cree: true });
    this.app.message(`${cree.libelle} ${cree.ent_numero ?? ''} créé`, 'succes');
    // Le nouveau document s'ouvre comme une nouvelle page (le document d'origine reste dans l'historique).
    await this.app.naviguer(`/document/${cree.ent_id}`);
  }

  fermer() {
    this.liberer();
    document.removeEventListener('keydown', this.clavier);
    document.body.classList.remove('avec-document', 'lecture-seule');
  }
}
