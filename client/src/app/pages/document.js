import { PageBase } from '@logibtp/navigation';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { ArborescenceBtp } from '../ged/arborescence.js';
import { echapper, formatNombre, actionDe, basculerAideMemoire, fermerAideMemoire } from '@logibtp/socle/ui';
import { D } from '@logibtp/socle';
import { ONGLETS_DOCUMENT } from '../raccourcis.js';
import { Disposition, GestionVuesDocument, FournisseurVuesMemoire, PlanDocument, RechercheLignes } from '@logibtp/document/ui';
import { PanneauMetre, NotificationsMetre } from '@logibtp/metre/ui';
import { VERSION_MOTEUR } from '../../calcul/index.js';
import { api } from '../api.js';
import { VUES_DOCUMENT } from '../vues-document.js';
import { EditeurDevisBtp, DictionnaireBtp } from '../editeur-btp.js';
import { PanneauxBtp, individusSociete } from '../panneaux-btp.js';
import { AnalyseCoefficients } from '../analyse-coefs.js';
import { messagesFrais } from '../frais-annexes.js';
import { EnvoiBibliotheque } from '../bibliotheque/envoi.js';
import { AppelBibliotheque } from '../bibliotheque/appel.js';
import { completerRattachement } from '../structure/structure.js';
import { proposerMarche } from '../structure/marche-commande.js';
import { transformerDocument } from '../documents/transformation.js';
import { confirmerAvertissements } from '../documents/avertissements.js';
import { choisirSources } from '../documents/sources.js';

/** Types alimentés par d'autres documents (ajout de sources en brouillon) ; types créés depuis un marché. */
const TYPES_SOURCES = /_(RECEPTION|FACTURE|FACTURE_AVT|SITUATION|AVOIR)$/;
const MARCHE_TYPES = ['V_RECEPTION', 'V_SITUATION', 'V_FACTURE_AVT'];
import { afficherTracabilite } from '../documents/tracabilite.js';
import { ouvrirImport, creerDepuisImport, rendreBandeauImport, tracabiliteImport } from '../import/devis-a-verifier.js';
import { formatImport } from '../import/formats.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';

// Document (devis, facture…) dans l'éditeur du cœur, toujours lu dans la base : /document/<id>,
// /document/nouveau?type=<code>, /document/import?jeton=<jeton> (devis importé à vérifier avant sa création, ouvert
// par la page d'import). Sans l'API (hors ligne), aucun document ne s'ouvre.

const GABARIT = `
  <div class="document-barre">
    <nav class="onglets" role="tablist">
      <button role="tab" data-onglet-vue="entete" title="Alt+1">Entête</button>
      <button role="tab" data-onglet-vue="lignes" title="Alt+2">Lignes</button>
      <button role="tab" data-onglet-vue="analyse" title="Alt+3 : coefficients par nature ou par tranche">Analyse</button>
      <button role="tab" data-onglet-vue="pieces" title="Alt+4 : documents de la GED liés au document, pièces jointes à envoyer">Pièces</button>
      <button role="tab" data-onglet-vue="tracabilite" title="Alt+5 : origine (import), documents liés, historique des versions">Traçabilité</button>
      <button role="tab" data-onglet-vue="suivi" title="Alt+6 : notes, tâches et courriels du document (module CRM)" hidden>Suivi</button>
    </nav>
    <div class="groupe">
      <button data-action="annuler" title="Annuler (Ctrl+Z)">↶</button>
      <button data-action="retablir" title="Rétablir (Ctrl+Y)">↷</button>
      <button data-action="enregistrer" class="principal" title="Enregistrer (Ctrl+S)">Enregistrer</button>
      <button data-action="valider" title="Valider et bloquer le document">Valider</button>
      <button data-action="envoyer" title="Envoyer le document approuvé (validation de l'entreprise)" hidden>Envoyer</button>
      <button data-action="valider-tiers" title="Document accepté par le client ou le fournisseur (devis accepté, situation visée, facture acceptée…)" hidden>Validé par le tiers</button>
      <button data-action="rejeter" title="Document rejeté par le tiers ou la plateforme : le motif est noté, la pièce s'annule ensuite par un avoir" hidden>Rejeté…</button>
      <button data-action="numero" title="Changer le numéro du document (brouillon ; un document validé se dévalide d'abord) : tous les indices sont renommés, le compteur repart du premier numéro libre" hidden>N°…</button>
      <button data-action="devalider" title="Dévalider : l'indice suivant devient la référence, en brouillon ; cette version est remplacée (droit de haut niveau, motif tracé)" hidden>Dévalider…</button>
      <button data-action="transformer" title="Transformer le reliquat en un autre document">Transformer…</button>
      <button data-action="annuler-avoir" title="Annuler cette pièce par un avoir (dans un marché : aussi les pièces d'avancement suivantes)" hidden>Annuler par avoir…</button>
      <button data-action="sources" title="Ajouter des documents sources : BL et commandes en attente, avenants du marché (une section par document)" hidden>＋ Documents</button>
      <button data-action="bibliotheque" title="Bibliothèque dans une autre fenêtre (pour insérer un élément : F3 dans la grille, son code dans la colonne Code, ou glisser-déposer)">📚 Bib</button>
      <button data-action="apercu" title="Aperçu et impression (modèle d'édition du type, présentation des lignes) dans une autre fenêtre">🖨 Aperçu</button>
    </div>
    <span class="groupe" data-vues></span>
    <span class="groupe"><button data-basculer-dock="plan" title="Afficher ou masquer le plan du document (tranches)">☰ Plan</button>
      <button data-basculer-dock="notifications" class="compteur-metres" title="Erreurs et avertissements des métrés (sans blocage de l'enregistrement)">⚠ 0</button>
      <button data-action="rechercher" title="Rechercher dans les lignes sans filtrer (Ctrl+F)">🔍</button></span>
  </div>
  <div class="document-verrou" hidden></div>
  <div class="document-import" hidden></div>
  <main class="document-zone">
    <section id="vue-entete" class="vue vue-entete" role="tabpanel">
      <div id="entete" class="panneau entete"></div>
      <section id="totaux-entete" class="panneau totaux-entete"></section>
    </section>
    <section id="vue-analyse" class="vue vue-analyse" role="tabpanel"></section>
    <section id="vue-pieces" class="vue vue-pieces" role="tabpanel"></section>
    <section id="vue-tracabilite" class="vue vue-tracabilite" role="tabpanel"></section>
    <section id="vue-suivi" class="vue vue-suivi" role="tabpanel"></section>
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
          <span class="aide aide-raccourcis" data-aide-raccourcis role="button" tabindex="0" title="Cliquer : liste de tous les raccourcis · Entrée, F2 ou double-clic : saisir · Échap : mode ligne · Ctrl+Entrée : insérer après · Ctrl+Maj+Entrée : avant · Alt+Entrée : composante · Ctrl+→ / Ctrl+← (ou Tab / Maj+Tab) : niveau · Ctrl+↑↓ (ou Alt+↑↓) : ordre · Ctrl+D : dupliquer · Suppr · Ctrl+X/C/V · F4 : métré · + / − : déplier / replier · glisser par ⋮⋮">Raccourcis ⓘ</span>
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
      <aside class="dock" data-dock-id="notifications">
        <header class="dock-entete">
          <span class="dock-titre">Métrés : erreurs et avertissements</span>
          <div class="dock-boutons">
            <button data-dock="gauche" title="Ancrer à gauche">◧</button>
            <button data-dock="bas" title="Ancrer en bas">⬓</button>
            <button data-dock="droite" title="Ancrer à droite">◨</button>
            <button data-action="reduire" title="Réduire">–</button>
            <button data-action="fermer" title="Fermer (bouton ⚠ de la barre pour le rouvrir)">✕</button>
          </div>
        </header>
        <div class="dock-contenu"><section id="notifications-metre"></section></div>
      </aside>
    </section>
  </main>
  <aside id="metre" class="tiroir" hidden></aside>`;

/** Contenu de saisie à partir d'un document complet renvoyé par l'API. */
const versSaisie = (d) => ({
  document: d.document, lignes: d.lignes, metres: d.metres ?? [], variables: d.variables ?? [], ventilations: d.ventilations ?? [],
  // Échéancier enregistré et règlement du tiers (lecture seule, section Règlement de l'entête).
  echeances: d.echeances ?? [], reglement_tiers: d.reglement_tiers ?? null,
});

export class PageDocument extends PageBase {
  icone = '📝';

  $(s) { return this.conteneur.querySelector(s); }

  async ouvrir() {
    const app = this.app;
    this.conteneur.innerHTML = GABARIT;
    this.conteneur.classList.add('page-document');
    this.disposition = new Disposition({
      racine: this.conteneur,
      // Notifications des métrés : en bas, ouvertes par le compteur ⚠ de la barre.
      docks: { notifications: { position: 'bas', reduit: false, visible: false } },
      surOnglet: (o) => {
        if (o === 'lignes') this.editeur?.grille.focus();
        if (o === 'analyse') this.analyse?.rendre();
        if (o === 'pieces') this.afficherPieces();
        if (o === 'tracabilite') this.afficherTracabilite();
        if (o === 'suivi') this.afficherSuivi();
      },
      // Plan fermé : le filtre d'affichage qu'il a posé est retiré.
      surDock: (id, visible) => { if (id === 'plan' && !visible && this.editeur?.filtre !== null) this.editeur?.filtrer(null); },
    });
    const actions = {
      enregistrer: () => this.enregistrer(), valider: () => this.valider(), transformer: () => this.transformer(),
      envoyer: () => this.etapeCycle((id) => api.envoyer(id), 'Document envoyé'),
      'valider-tiers': () => this.etapeCycle((id) => api.validerTiers(id), 'Document validé par le tiers'),
      devalider: async () => {
        const motif = globalThis.prompt?.('Dévalider : une nouvelle version (indice suivant) remplace celle-ci, sans retour en arrière.\nMotif (tracé dans l\'historique) :');
        if (!motif?.trim()) return;
        try {
          const nouveau = await api.devalider(this.editeur.saisie.document.ent_id, motif.trim());
          this.app.publier('enregistre', { ids: [this.editeur.saisie.document.ent_id, nouveau.document.ent_id] });
          this.app.message(`Nouvelle version (indice ${nouveau.document.ent_indice}) en brouillon`, 'succes');
          await this.app.naviguer(`/document/${nouveau.document.ent_id}`);
        } catch (e) { this.app.erreur(e); }
      },
      numero: () => this.changerNumero(),
      rejeter: () => {
        const motif = globalThis.prompt?.('Motif du rejet (plateforme de facturation, client, fournisseur) :');
        if (motif?.trim()) this.etapeCycle((id) => api.rejeter(id, motif.trim()), 'Rejet noté : annulez la pièce par un avoir');
      },
      sources: () => this.ajouterSources(),
      'annuler-avoir': () => this.annulerParAvoir(),
      annuler: () => this.editeur?.magasin.annuler(), retablir: () => this.editeur?.magasin.retablir(),
      // Bibliothèque dans une autre fenêtre (liste de tous les éléments) ; l'insertion reste par F3 ou par code.
      bibliotheque: () => app.naviguer('/liste/bibliotheque?vue=14', { nouvelleFenetre: true }),
      rechercher: () => { this.disposition.onglet('lignes'); this.recherche?.ouvrir(); },
      // Aperçu : l'édition lit le document enregistré (les modifications en cours n'y sont pas).
      apercu: () => {
        const id = this.editeur?.saisie.document.ent_id;
        if (!id || id < 0) { app.message('Enregistrez le document avant de l’éditer', 'avertissement'); return; }
        if (this.modifiee) app.message('Modifications non enregistrées : l’aperçu montre la dernière version enregistrée', 'avertissement');
        app.naviguer(`/edition?source=document&id=${id}`, { nouvelleFenetre: true });
      },
    };
    // Raccourcis ⓘ : bulle au survol, aide-mémoire complet (fenêtre déplaçable) au clic.
    const aide = this.conteneur.querySelector('[data-aide-raccourcis]');
    aide.addEventListener('click', () => this.aideRaccourcis());
    aide.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.aideRaccourcis(); } });
    this.conteneur.querySelector('.document-barre').addEventListener('click', (e) => {
      const plan = e.target.closest('[data-basculer-dock]');
      if (plan) { this.disposition.afficher(plan.dataset.basculerDock); return; }
      const b = e.target.closest('button[data-action]');
      if (b && actions[b.dataset.action]) Promise.resolve(actions[b.dataset.action]()).catch((x) => app.erreur(x));
    });
    // Raccourcis de la page (groupe document, personnalisables) : Alt+1… onglets, Ctrl+F recherche dans les lignes
    // (sans filtre, à la place de celle du navigateur ; onglet Analyse : dans la liste des éléments), fonctions de la barre.
    this.clavier = (e) => {
      if (e.defaultPrevented) return;
      const action = actionDe(e, 'document');
      if (!action) return;
      if (ONGLETS_DOCUMENT[action]) { e.preventDefault(); this.disposition.onglet(ONGLETS_DOCUMENT[action]); return; }
      if (action === 'rechercher') {
        if (!this.recherche) return;
        e.preventDefault();
        if (this.disposition.p.onglet === 'analyse') { this.analyse?.ouvrirRecherche(); return; }
        this.disposition.onglet('lignes');
        this.recherche.ouvrir();
        return;
      }
      if (actions[action]) { e.preventDefault(); Promise.resolve(actions[action]()).catch((x) => app.erreur(x)); }
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
    this.comptes = app.enLigne ? await api.comptesComptables().catch(() => []) : [];
    this.appel = new AppelBibliotheque({
      fournisseur: s.bibliotheque, editeur: () => this.editeur, message: (t, n) => app.message(t, n),
      bibliotheque: () => this.bibliotheques.find((b) => b.id === Number(this.editeur?.saisie.document.ent_bib_id))?.code ?? null,
    });

    const { id } = this.params;
    if (!app.enLigne) throw new Error('Hors ligne : les documents s\'ouvrent depuis la base, l\'API est indisponible');
    this.types = await api.typesDocument();
    // Création depuis les listes : /document/nouveau?type=<code> ; depuis un marché : &marche=<id> (rattachement).
    if (id === 'nouveau') {
      await this.nouveau(this.requete.type ?? 'V_DEVIS');
      if (this.requete.marche) await this.rattacher({ ...this.editeur.saisie.document, ent_marche_id: Number(this.requete.marche) });
    } else if (id === 'import') {
      await ouvrirImport(this, this.requete.jeton);
    } else await this.chargerDocument(Number(id));
  }

  async chargerDocument(id) {
    await this.liberer();
    this.importEnCours = null;
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

  /**
   * Compte du tiers du document (compte client, ou fournisseur pour un achat : fiche personne) : compte hérité des
   * lignes sans compte ni nature qui en porte un. Relu quand le tiers change.
   */
  suivreCompteTiers() {
    const ed = this.editeur;
    const tiers = ed?.saisie.document.ent_tiers_id ?? null;
    if (!ed || tiers === this.tiersCompte) return;
    this.tiersCompte = tiers;
    ed.compteTiers = null;
    if (!tiers || !this.servicesFiche) return;
    const champ = ed.definition.type?.tyd_famille === 'A' ? 'fou_compte' : 'cli_compte';
    this.servicesFiche.charger('personne', tiers).then((f) => {
      if (this.editeur !== ed || this.tiersCompte !== tiers) return;
      ed.compteTiers = f?.valeurs?.[champ] || null;
      if (ed.compteTiers) { ed.grille.rendre(); this.panneaux?.rendreDetail(this.$('#detail'), this.selection); }
    }).catch(() => {});
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
      // Ordres (famille E, module Exécution actif) : panneau Exécution de l'entête, répartition du détail.
      execution: this.app.enLigne && this.app.moduleActif('execution') ? { app: this.app, individus: () => individusSociete(this.servicesAnnuaire) } : null,
    });
    this.plan = new PlanDocument(this.$('#plan'), { editeur: this.editeur });
    this.recherche = new RechercheLignes(this.$('#recherche-lignes'), { editeur: this.editeur });
    // Éléments glissés depuis la fenêtre de la bibliothèque.
    this.editeur.surDepotExterne = (donnees, cibleId, position) => this.appel.deposer(donnees, cibleId, position);
    this.analyse = new AnalyseCoefficients(this.$('#vue-analyse'), { editeur: this.editeur, natures: this.natures, message: (t, n) => this.app.message(t, n), appel: this.appel });
    this.editeur.coefsDefaut = this.coefsDefaut;
    this.editeur.natures = this.natures;
    this.editeur.comptes = this.comptes;
    this.tiersCompte = undefined;
    this.suivreCompteTiers();
    this.editeur.surFiltre = () => this.afficherFiltre();
    // Mode débogage de la vue : rapport d'import (bandeau, traçabilité).
    this.editeur.surVue = () => {
      rendreBandeauImport(this);
      if (this.disposition.p.onglet === 'tracabilite') this.afficherTracabilite();
    };
    this.afficherFiltre();
    // Vues de colonnes : vue mémorisée (navigateur) ou vue par défaut du type et du modèle du document.
    this.vues = new GestionVuesDocument(this.$('[data-vues]'), {
      editeur: this.editeur, fournisseur: this.fournisseurVues(), admin: () => this.app.estAdmin(), message: (t) => this.app.message(t),
    });
    this.modeleAffiche = this.editeur.saisie.document.ent_modele ?? null;
    await this.vues.charger();
    await this.chargerRestes();
    await this.chargerAvancement();
    this.metre = new PanneauMetre(this.$('#metre'), this.editeur, {
      fermer: (ligId) => { this.editeur.grille.selectionner(ligId, { colonne: 3 }); this.editeur.grille.focus(); },
      message: (t) => this.app.message(t),
      dictionnaire: new DictionnaireBtp(this.editeur),
    });
    this.notifications = new NotificationsMetre(this.$('#notifications-metre'), this.editeur, {
      ouvrir: (ligId, mtrId, position) => {
        this.disposition.onglet('lignes');
        this.editeur.grille.selectionner(ligId, { colonne: 3 });
        this.metre.ouvrir(ligId, mtrId, position);
      },
      surCompte: ({ erreurs, avertissements }) => {
        const b = this.$('.compteur-metres');
        b.textContent = `${erreurs ? '⛔' : '⚠'} ${erreurs + avertissements}`;
        b.classList.toggle('avec-erreurs', erreurs > 0);
        b.classList.toggle('avec-avertissements', !erreurs && avertissements > 0);
      },
    });
    this.editeur.magasin.abonner(() => { this.suivreCompteTiers(); this.rafraichir(); });
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
    this.rendreAvancement(this.$('#totaux-entete'));
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
    this.$('[data-action="enregistrer"]').textContent = this.importEnCours ? 'Créer le devis' : 'Enregistrer';
    this.$('[data-action="valider"]').disabled = !enLigne || !modifiable || Boolean(this.importEnCours);
    // Cycle de vie (CONCEPTION-REGLES-DOCUMENTS.md, P17) : approbation interne si la règle l'active, envoi, validation du tiers.
    this.$('[data-action="valider"]').textContent = ed.definition.regles?.APPROBATION ? 'Approuver' : 'Valider';
    const enCours = statut?.std_code !== 'ANNULE' && statut?.std_code !== 'REMPLACE';
    this.$('[data-action="envoyer"]').hidden = !enLigne || !doc.ent_approuve_le || Boolean(doc.ent_envoye_le) || !enCours;
    this.$('[data-action="valider-tiers"]').hidden = !enLigne || !doc.ent_envoye_le || Boolean(doc.ent_valide_tiers_le) || !enCours;
    this.$('[data-action="rejeter"]').hidden = this.$('[data-action="valider-tiers"]').hidden;
    const droits = ed.definition.droits ?? [];
    this.$('[data-action="devalider"]').hidden = !enLigne || !doc.ent_verrouille || !enCours || !(droits.includes('DEVALIDER') || droits.includes('FORCER'));
    // Changement de numéro : droit de déverrouillage (administrateur), et FORCER en numérotation continue (contrôlés par le serveur).
    this.$('[data-action="numero"]').hidden = !enLigne || !modifiable || !this.app.estAdmin() || Boolean(this.importEnCours)
      || (ed.definition.type?.tyd_numerotation_continue && !droits.includes('FORCER'));
    this.$('[data-action="transformer"]').disabled = !enLigne || !(ed.definition.transformations?.length) || Boolean(this.importEnCours);
    // Documents alimentés par d'autres (BL, factures, situations) : ajout de sources tant qu'ils sont en brouillon.
    // Pièce comptable validée (facture, avoir) non annulée : annulation par avoir.
    this.$('[data-action="annuler-avoir"]').hidden = !enLigne || !doc.ent_verrouille || statut?.std_code === 'ANNULE'
      || !ed.definition.type?.tyd_numerotation_continue || doc.ent_nature_avoir === 'ANNULATION';
    this.$('[data-action="sources"]').hidden = !enLigne || !modifiable || !TYPES_SOURCES.test(ed.definition.type?.tyd_code ?? '');
    rendreBandeauImport(this);
    document.body.classList.toggle('lecture-seule', !modifiable);
    if (this.disposition?.p.onglet === 'pieces') this.afficherPieces();
    if (this.disposition?.p.onglet === 'tracabilite' && this.tracabiliteCle !== this.cleTracabilite()) this.afficherTracabilite();
    // Onglet Suivi (module CRM actif, document enregistré) : notes du groupe d'indices.
    this.$('[data-onglet-vue="suivi"]').hidden = !enLigne || !this.app.moduleActif('crm') || !doc.ent_id;
    // Ordres (module Exécution) : coefficients par nature et marge dans l'ordre d'exécution seulement (E3, E17).
    const typeDoc = this.editeur.definition.type;
    this.$('[data-onglet-vue="analyse"]').hidden = typeDoc?.tyd_famille === 'E' && typeDoc.tyd_code !== 'E_OE';
    if (this.disposition?.p.onglet === 'suivi') this.afficherSuivi();
    this.app.majPage();
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
    if (this.importEnCours) { await creerDepuisImport(this); return; }
    const ed = this.editeur;
    const r = ed.resultat;
    const envoi = {
      document: r.document, lignes: r.lignes, metres: r.metres, variables: r.variables, ventilations: r.ventilations ?? [],
      ventilations_lignes: r.ventilations_lignes ?? [], version_moteur_client: VERSION_MOTEUR,
    };
    const saisieEnvoyee = structuredClone(ed.entree(ed.saisie));
    const rep = await api.enregistrer(ed.saisie.document.ent_id, envoi);
    const map = (table, id) => (id === null || id === undefined ? id : table[id] ?? id);
    // Correspondances des compléments du module Métré, par table (réponse générique du module Document).
    const cl = rep.correspondance_lignes;
    const { metres: cm = {}, variables: cv = {}, ventilations: cf = {} } = rep.correspondances ?? {};
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
      for (const v of d.variables) { v.var_id = map(cv, v.var_id); v.var_lig_id = map(cl, v.var_lig_id); v.var_mtr_id = map(cm, v.var_mtr_id); }
      for (const k of d.ventilations ?? []) {
        k.vfr_id = map(cf, k.vfr_id);
        k.vfr_source_lig_id = map(cl, k.vfr_source_lig_id);
        k.vfr_lig_id = map(cl, k.vfr_lig_id);
        k.vfr_ent_id = d.document.ent_id;
      }
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
  /** Clé de l'onglet Traçabilité : document et version (rafraîchi après un enregistrement ou une validation). */
  cleTracabilite() {
    const d = this.editeur?.saisie.document;
    return d ? `${d.ent_id}-${d.ent_version}-${this.importEnCours ? 'import' : ''}-${this.editeur.vue?.debogage ? 'dbg' : ''}` : null;
  }

  afficherTracabilite() {
    const zone = this.$('#vue-tracabilite');
    const d = this.editeur?.saisie.document;
    if (!d) return;
    this.tracabiliteCle = this.cleTracabilite();
    if (this.importEnCours) { tracabiliteImport(this, zone); return; }
    if (!this.app.enLigne || !d.ent_id) { zone.innerHTML = '<p class="aide">Traçabilité disponible pour les documents enregistrés.</p>'; return; }
    afficherTracabilite(zone, {
      entId: d.ent_id, ged: this.servicesGed, debogage: Boolean(this.editeur.vue?.debogage),
      naviguer: (url, e) => this.app.naviguer(url, { nouvelleFenetre: Boolean(e?.ctrlKey || e?.shiftKey) }),
      // Réutilisation du fichier source conservé : nouvelle vérification dans une autre fenêtre.
      reimporter: (o) => this.app.naviguer(`${formatImport(o.dor_format).page}?ged=${o.dor_fichier_id}`, { nouvelleFenetre: true }),
    }).catch((x) => { zone.innerHTML = `<p class="erreur">${echapper(x.message)}</p>`; });
  }

  /** Onglet Suivi (module CRM) : notes, tâches et courriels du document, tous indices confondus (groupe d'indices). */
  afficherSuivi() {
    const zone = this.$('#vue-suivi');
    const d = this.editeur?.saisie.document;
    if (!d?.ent_id) { zone.innerHTML = '<p class="aide">Suivi disponible pour les documents enregistrés.</p>'; return; }
    const id = String(d.ent_groupe_id ?? d.ent_id);
    if (this.suivi && this.suiviId === id) return;
    this.suivi?.fermer();
    this.suiviId = id;
    zone.replaceChildren();
    this.suivi = new PanneauSuivi(zone, { app: this.app, type: 'document', id, libelle: d.ent_numero ?? '' });
    this.suivi.ouvrir().catch((x) => { zone.innerHTML = `<p class="erreur">${echapper(x.message)}</p>`; });
  }

  afficherPieces() {
    const zone = this.$('#vue-pieces');
    const d = this.editeur?.saisie.document;
    if (!d) return;
    if (this.importEnCours) { zone.innerHTML = '<p class="aide">Le fichier importé sera conservé dans les pièces du devis à sa création.</p>'; return; }
    const cle = `${d.ent_tyd_id}-${d.ent_groupe_id ?? d.ent_id}`;
    if (this.ged && this.gedCle === cle) return;
    this.ged?.detruire?.();
    zone.replaceChildren();
    if (!this.servicesGed) { zone.innerHTML = '<p class="aide">La GED n\'est pas branchée.</p>'; return; }
    const type = this.editeur.definition.type;
    this.gedCle = cle;
    // Arborescence : le document est la racine, ses documents enfants (transformations, copies) sont des dossiers.
    const contexte = { type_element: type?.tyd_code ?? 'document', id_element: String(d.ent_groupe_id ?? d.ent_id), libelle: `${type?.tyd_libelle ?? 'Document'} ${d.ent_numero ?? ''}`.trim(), icone: '📄' };
    this.ged = new ExplorateurGed(zone, {
      fournisseur: this.servicesGed, envoi: true, modifiable: true, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(), contexte,
      arborescence: this.servicesStructure ? new ArborescenceBtp(contexte, { structure: this.servicesStructure, entId: d.ent_id }) : null,
      ouvrirUrl: (url) => this.app.naviguer(url, { nouvelleFenetre: true }),
      message: (t, n) => this.app.message(t, n),
    });
  }

  async valider() {
    const ed = this.editeur;
    if (this.modifiee && !confirm('Le document doit d\'abord être enregistré. Enregistrer puis valider ?')) return;
    // Commande client : marché obligatoire (sauf commande intermédiaire d'un devis facturé directement).
    const d = ed.saisie.document;
    if (ed.definition.type?.tyd_code === 'V_COMMANDE' && !d.ent_marche_id && !d.ent_intermediaire && !(await this.choisirMarche())) return;
    // Frais annexes : à la validation, la ventilation est figée en clés de ligne ; les clés orphelines sont supprimées.
    const orphelines = messagesFrais(ed.resultat).filter((m) => m.code === 'FA_CLE_ORPHELINE' || m.code === 'FA_CLE_BLOQUEE');
    if (orphelines.length && !confirm(`La validation fige la ventilation des frais annexes et supprime ${orphelines.length} clé(s) inutilisée(s) :\n\n`
      + `${orphelines.map((m) => `• ${m.message}`).join('\n')}\n\nValider ?`)) return;
    if (this.modifiee) await this.enregistrer();
    // Contrôles de gestion (lot 6 des règles) : avertissements non bloquants, l'utilisateur choisit.
    if (!(await confirmerAvertissements(ed.saisie.document.ent_id, 'VALIDER', 'Valider'))) return;
    const rep = await api.valider(ed.saisie.document.ent_id, ed.saisie.document.ent_version);
    await this.chargerDocument(rep.document.document.ent_id);
    this.app.publier('enregistre', { ids: [rep.document.document.ent_id] });
    this.app.message(`Document validé : ${rep.document.document.ent_numero}`, 'succes');
  }

  /** Étape du cycle de vie (envoi, validation du tiers, rejet) puis rechargement du document. */
  /**
   * Nouveau numéro au format du type ; numérotation continue : motif obligatoire. Un numéro déjà pris est remplacé par
   * le prochain libre (avertissement du serveur).
   */
  async changerNumero() {
    if (this.modifiee) { this.app.message('Enregistrez le document avant de changer son numéro', 'avertissement'); return; }
    const doc = this.editeur.saisie.document;
    const type = this.editeur.definition.type ?? {};
    const exemple = `${type.tyd_prefixe_numero ?? ''}${String(doc.ent_date ?? '').slice(0, 4) || new Date().getFullYear()}-00001`;
    const numero = globalThis.prompt?.(`Nouveau numéro (format ${exemple}) :`, doc.ent_numero ?? exemple);
    if (!numero?.trim() || numero.trim() === doc.ent_numero) return;
    let motif = null;
    if (type.tyd_numerotation_continue) {
      motif = globalThis.prompt?.('Numérotation continue : motif du changement (tracé dans l\'historique) :');
      if (!motif?.trim()) return;
    }
    try {
      const rep = await api.changerNumero(doc.ent_id, numero.trim(), motif?.trim() ?? null);
      await this.chargerDocument(doc.ent_id);
      this.app.publier('enregistre', { ids: [doc.ent_id] });
      this.app.message(rep.avertissement ?? `Numéro ${rep.numero} attribué`, rep.avertissement ? 'avertissement' : 'succes');
    } catch (e) { this.app.erreur(e); }
  }

  async etapeCycle(appel, message) {
    try {
      const rep = await appel(this.editeur.saisie.document.ent_id);
      await this.chargerDocument(rep.document.document.ent_id);
      this.app.publier('enregistre', { ids: [rep.document.document.ent_id] });
      this.app.message(message, 'succes');
    } catch (e) { this.app.erreur(e); }
  }

  /**
   * Document issu d'une transformation (BL, facture, avoir…) : restes à solder des lignes liées à leur parent
   * (colonnes Qté parent, Reste, Soldé de la grille).
   */
  async chargerRestes() {
    const ed = this.editeur;
    // Documents d'avancement : l'avancement remplace le reste à solder.
    if (!this.app.enLigne || ed.saisie.document.ent_avt_presentation || !ed.saisie.lignes.some((l) => l.lig_origine_id)) return;
    try {
      ed.definirRestes(await api.restes(ed.saisie.document.ent_id));
    } catch (e) {
      this.app.message(`Restes à solder indisponibles : ${e.message}`, 'avertissement');
    }
  }

  /**
   * Annulation par avoir (Q30, 13.12 bis) : la pièce et, dans un marché, toutes les pièces d'avancement suivantes sont
   * annulées par avoir après confirmation ; la dernière situation concernée est remise en cours (nouvel indice).
   */
  async annulerParAvoir() {
    const d = this.editeur.saisie.document;
    const pieces = await api.piecesAnnulation(d.ent_id);
    if (!pieces.length) { this.app.message('Rien à annuler', 'avertissement'); return; }
    const liste = pieces.map((x) => `• ${x.rang ? `n° ${x.rang} · ` : ''}${x.type} ${x.numero ?? ''} (${formatNombre(x.total_ht, 2)} € HT)`).join('\n');
    if (!confirm(`${pieces.length > 1 ? `Les ${pieces.length} pièces suivantes seront annulées` : 'La pièce suivante sera annulée'} par avoir (pièces comptables : un avoir chacune) :\n\n${liste}\n\nAnnuler ?`)) return;
    const r = await api.annulerParAvoir(d.ent_id);
    this.app.publier('enregistre', { ids: [d.ent_id, ...r.avoirs] });
    await this.chargerDocument(d.ent_id);
    this.app.message(`${r.avoirs.length} avoir(s) d'annulation créé(s)${r.situation ? ' ; dernière situation remise en cours (nouvel indice)' : ''}`, 'succes');
    if (r.situation && confirm('Ouvrir la situation remise en cours ?')) await this.app.naviguer(`/document/${r.situation}`, { nouvelleFenetre: true });
  }

  /** Document d'avancement d'un marché : numéro de situation et documents précédents (bloc de déduction, 13.7). */
  async chargerAvancement() {
    const d = this.editeur.saisie.document;
    this.avancement = null;
    if (!this.app.enLigne || !d.ent_avt_presentation || !d.ent_marche_id) return;
    try { this.avancement = await api.avancementDocument(d.ent_id); } catch { this.avancement = null; }
    this.rendreAvancement(this.$('#totaux-entete'));
  }

  /**
   * Bloc de déduction sous les totaux : cumul HT = documents précédents + ce document ; facture d'avancement : chaque
   * document précédent (numéro de situation, numéro, HT) est déduit du cumul, le reste est la période facturée.
   */
  rendreAvancement(zone) {
    const a = this.avancement;
    const d = this.editeur?.resultat?.document;
    if (!zone || !a || !d) return;
    zone.querySelector('.bloc-avancement')?.remove();
    const pm = this.editeur.saisie.document.ent_precision_montant ?? 2;
    const precedents = a.precedents ?? [];
    const periode = this.editeur.saisie.document.ent_avt_presentation === 'P';
    const deduit = precedents.reduce((s, x) => s.plus(D(x.total_ht ?? 0)), D(0));
    const cumul = periode ? deduit.plus(D(d.ent_total_ht ?? 0)) : D(d.ent_total_ht ?? 0);
    const f = (v) => formatNombre(v, pm);
    const bloc = document.createElement('section');
    bloc.className = 'bloc-avancement';
    bloc.innerHTML = `<h4>Avancement${a.rang ? ` — situation n° ${a.rang}` : ''}</h4>
      <table><tbody>
        <tr><th>Cumul HT</th><td class="nombre">${f(cumul)}</td></tr>
        ${periode ? `${precedents.map((x) => `<tr><td>À déduire : ${x.rang ? `n° ${x.rang} · ` : ''}${echapper(x.type ?? '')} ${echapper(x.numero ?? '')}</td><td class="nombre">−${f(x.total_ht)}</td></tr>`).join('')}
        <tr><th>Période HT (ce document)</th><td class="nombre">${f(d.ent_total_ht)}</td></tr>` : `<tr><td colspan="2"><small>Situation : état cumulé, non comptable${precedents.length ? ` ; déjà facturé ${f(deduit)} HT` : ''}</small></td></tr>`}
      </tbody></table>
      ${(a.annules ?? []).length ? `<label class="coche"><input type="checkbox" data-annules ${this.voirAnnules ? 'checked' : ''}> Afficher les pièces annulées (${a.annules.length})</label>
        ${this.voirAnnules ? `<table class="annules"><tbody>${a.annules.map((x) => `<tr><td>${x.rang ? `n° ${x.rang} · ` : ''}${echapper(x.type ?? '')} ${echapper(x.numero ?? '')}${x.nature === 'ANNULATION' ? ' (avoir d\'annulation)' : ''}</td><td class="nombre">${f(x.total_ht)}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}`;
    bloc.querySelector('[data-annules]')?.addEventListener('change', (e) => { this.voirAnnules = e.target.checked; this.rendreAvancement(zone); });
    zone.append(bloc);
  }

  /**
   * Commande client à valider sans marché : chantier (existant ou nouveau, pré-rempli) puis création du marché, ou
   * rattachement comme avenant d'un marché en cours. Renvoie vrai si la commande est rattachée (validation à suivre).
   */
  async choisirMarche() {
    if (!this.servicesStructure || !this.servicesFiche) { this.app.message('Marché obligatoire : structure des affaires indisponible', 'avertissement'); return false; }
    this.structure = await this.servicesStructure.referentiels();
    const doc = this.editeur.saisie.document;
    const r = await proposerMarche({
      refs: this.structure, doc, totalHt: this.editeur.resultat.document?.ent_total_ht ?? null,
      creerChantier: async (valeurs) => this.servicesFiche.creer('chantier', { valeurs, proprietes: {} }),
      // Le marché reprend les intervenants du chantier.
      creerMarche: async (valeurs) => this.servicesFiche.creer('marche', {
        valeurs: { ...valeurs, intervenants: await this.servicesStructure.intervenants('chantier', valeurs.cha_id).catch(() => []) }, proprietes: {},
      }),
    });
    if (!r) return false;
    this.structure = await this.servicesStructure.referentiels();
    this.panneaux.structure = this.structure;
    await this.rattacher({ ...doc, ent_marche_id: r.ent_marche_id });
    this.app.message(r.cree ? 'Marché créé et commande rattachée' : 'Commande rattachée comme avenant du marché', 'succes');
    return true;
  }

  /**
   * Ajoute des documents sources au brouillon (CONCEPTION-ACHATS-MARCHES.md Q10, Q18) : document d'un marché, les
   * commandes (avenants) du marché pas encore reprises ; sinon les documents validés en attente du même tiers. Chaque
   * document devient une section avec son pied ; le document est rechargé.
   */
  async ajouterSources() {
    const ed = this.editeur;
    const d = ed.saisie.document;
    if (this.modifiee) await this.enregistrer();
    let sources;
    if (d.ent_marche_id && MARCHE_TYPES.includes(ed.definition.type?.tyd_code)) {
      const ids = await api.commandesMarche(d.ent_id);
      if (!ids.length) { this.app.message('Toutes les commandes validées du marché sont déjà reprises', 'avertissement'); return; }
      if (!confirm(`${ids.length} commande(s) du marché (avenants) pas encore reprise(s) : les ajouter ?`)) return;
      sources = ids;
    } else {
      const attente = await api.documentsEnAttente(d.ent_tyd_id, d.ent_tiers_id ?? null);
      sources = await choisirSources({ documents: attente, titre: `Documents à reprendre dans ${ed.definition.type?.tyd_libelle ?? 'le document'}` });
      if (!sources?.length) return;
    }
    await api.ajouterSources(d.ent_id, sources);
    await this.chargerDocument(d.ent_id);
    this.app.publier('enregistre', { ids: [d.ent_id] });
    this.app.message(`${sources.length} document(s) repris`, 'succes');
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

  /** Aide-mémoire des raccourcis des lignes (touches effectives, personnalisées comprises) et de la page. */
  aideRaccourcis() {
    basculerAideMemoire({
      titre: 'Raccourcis des lignes',
      groupes: ['grille', 'document', 'application'],
      notes: [
        ['Entrée, F2, double-clic', 'Saisir dans la cellule'],
        ['Échap', 'Revenir au mode ligne'],
        ['Entrée en saisie', 'Ligne du dessous, même colonne'],
        ['Tab en saisie', 'Cellule suivante (Maj+Tab : précédente)'],
        ['↑ ↓ ← →', 'Changer de ligne ou de colonne'],
        ['Ctrl+clic, Maj+clic', 'Sélection multiple'],
        ['Glisser ⋮⋮', 'Déplacer les lignes sélectionnées'],
        ['Glisser l’entête','Déplacer la colonne (bordure droite : largeur)'],
        ['Clic droit', 'Menu de la ligne'],
      ],
    });
  }

  fermer() {
    fermerAideMemoire();
    this.suivi?.fermer();
    this.liberer();
    document.removeEventListener('keydown', this.clavier);
    document.body.classList.remove('avec-document', 'lecture-seule');
  }
}
