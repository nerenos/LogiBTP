import { urlDocument, urlFiche, TYPE_FICHE, TYPE_POSTE_MARCHE, TYPE_DOCUMENT, MODULE_FACULTATIF } from '../codes.js';
import { MODES } from '@logibtp/fiche';
import { echapper, formatDate, formatNombre, formatLibre, lireNombre, creerCombo, lirePreferences, ecrirePreferences, confirmer } from '@logibtp/socle/ui';
import { rendrePieces } from '../sous-traitance/pieces.js';
import { rendrePaiements, rendreRetenue } from '../sous-traitance/paiements.js';
import { rendreRevision } from '../structure/revision-marche.js';
import { D, Dz, aujourdhui } from '@logibtp/socle';
import { FicheLogiBTP } from './fiches.js';
import { api } from '../api.js';
import { TableIntervenants } from '../structure/intervenants.js';
import { controlerIntervenants } from '../structure/structure.js';
import { champRattachement } from '../structure/selection.js';
import { VueGrapheStructure } from '../structure/graphe-structure.js';
import { individusStructure } from '../panneaux-btp.js';
import { creerTiersProvisoire } from '@logibtp/annuaire/ui';
import { choisirTiers } from '../annuaire/choix.js';

// Fiches de la structure des affaires : projet, affaire, chantier, marché. Listes de choix des références (affaire,
// projet, chantier, commande d'origine, tiers de l'annuaire), code prévisionnel du chrono (module Fiche), préremplissage depuis un
// projet (?projet=) ou un chantier (?chantier=, ?commande=), liens vers les éléments rattachés. Un projet passé
// « Obtenu » propose d'ouvrir son chantier.

const LIBELLES_STATUT = {
  EN_COURS: 'En cours', REMIS: 'Offre remise', OBTENU: 'Obtenu', PERDU: 'Perdu', ABANDONNE: 'Abandonné', OUVERTE: 'Ouverte', CLOSE: 'Close',
  OUVERT: 'Ouvert', TERMINE: 'Terminé', CLOS: 'Clos', SOLDE: 'Soldé', RESILIE: 'Résilié',
};
const parametre = (nom) => Number(new URLSearchParams(globalThis.location?.search ?? '').get(nom)) || null;

/** Raccourcis des fiches vers les listes (thème, libellé), filtrées par le code de la fiche (?projet=CODE…). */
const RACCOURCIS = {
  projet: [['documents', 'Documents'], ['devis', 'Devis'], ['chantiers', 'Chantiers']],
  affaire: [['documents', 'Documents'], ['chantiers', 'Chantiers'], ['marches', 'Marchés'], ['factures', 'Factures']],
  chantier: [['documents', 'Documents'], ['devis', 'Devis'], ['commandes', 'Commandes'], ['situations', 'Situations'], ['factures', 'Factures'],
    ['marches', 'Marchés'], ['achats_commandes', 'Commandes fournisseurs'], ['achats_factures', 'Factures fournisseurs']],
  marche: [['documents', 'Documents'], ['situations', 'Situations'], ['factures', 'Factures']],
};

export class FicheStructure extends FicheLogiBTP {
  constructor(options) {
    super(options);
    this.services = options.services;
    this.ouvrirUrl = options.ouvrirUrl ?? (() => {});
    this.tiersNoms = new Map();
  }

  async ouvrir() {
    this.refs = await this.services.structure.referentiels();
    // Création depuis un projet ou un chantier : ses intervenants sont repris (fonctions proposées ici).
    const source = this.mode === MODES.CREATION ? this.sourceIntervenants() : null;
    this.intervenantsRepris = source ? await this.services.structure.intervenants(...source).catch(() => []) : [];
    await super.ouvrir();
  }

  /** [type, id] de l'objet dont la création reprend les intervenants (null : aucun). */
  sourceIntervenants() { return null; }

  /** Intervenants contrôlés comme côté serveur (Intervenants.Controler). */
  validerMetier(v) {
    return controlerIntervenants(v.intervenants ?? [], this.refs.fonctions ?? [], 'S').map((message) => ({ champ: 'intervenants', message }));
  }

  /** Recharge les référentiels (après une création liée). */
  async rechargerReferentiels() { this.refs = await this.services.structure.referentiels(); }

  valeursCreation() {
    const v = super.valeursCreation();
    if (this.intervenantsRepris?.length) v.intervenants = this.intervenantsRepris;
    for (const c of this.definition.champs) if (c.type === 'date' && c.obligatoire && !v[c.code]) v[c.code] = aujourdhui();
    return v;
  }

  sousTitre(v) {
    const statut = LIBELLES_STATUT[v.statut] ?? v.statut ?? '';
    return [super.sousTitre(v), statut].filter(Boolean).join(' · ');
  }

  /** Libellé d'une référence (code – libellé). */
  libelleRef(liste, id) {
    const x = (this.refs[liste] ?? []).find((y) => y.id === Number(id));
    return x ? `${x.code ?? x.numero} – ${x.libelle ?? x.objet ?? ''}` : '';
  }

  rendreChamp(champ, valeur) {
    if (champ.code === 'intervenants') {
      return new TableIntervenants({
        annuaire: this.services.annuaire, fonctions: this.refs.fonctions ?? [], portee: 'S', lecture: !this.estEnSaisie(),
        surChange: (liste) => this.definirValeur('intervenants', liste),
      }).rendre(valeur ?? []);
    }
    if (!champ.reference) return super.rendreChamp(champ, valeur);
    const lecture = !this.estEnSaisie() || champ.lecture_seule;
    if (champ.reference === 'tiers') return this.#champTiers(champ, valeur, lecture);
    if (champ.reference === 'individu') return this.#champIndividu(champ, valeur, lecture);
    if (champ.reference === 'individu_societe') return this.#champIndividuSociete(champ, valeur, lecture);
    if (champ.reference === 'commande') {
      const span = document.createElement('span');
      span.className = 'fiche-valeur';
      const c = (this.refs.commandes ?? []).find((x) => x.id === Number(valeur));
      span.innerHTML = valeur ? `<a href="${urlDocument(Number(valeur))}">${echapper(c ? `${c.numero ?? ''} ${c.objet ?? ''}` : `Document ${valeur}`)}</a>` : '—';
      return span;
    }
    // Zone de code, libellé en lien vers la fiche, double-clic ou F4 : liste de choix.
    return champRattachement({
      type: champ.reference, refs: this.refs, valeur, lecture, filtre: this.filtreReference(champ),
      choisir: (id) => { this.choisirReference(champ.code, id); this.rendre(); },
    });
  }

  /** Restriction proposée dans la liste de choix d'une référence (aucune par défaut). */
  filtreReference(_champ) { return null; }

  /** Choix d'une référence : une spécialisation complète les champs liés (parents, client du projet…). */
  choisirReference(code, id) { this.definirValeur(code, id); }

  /** Relations proposées par défaut dans la liste des tiers (I1) : client ou prospect ; sous-traitant d'un marché ST. */
  relationsTiers() {
    return this.type === TYPE_FICHE.MARCHE && this.valeur('sens') === 'ST' ? ['SOUS_TRAITANT'] : ['CLIENT', 'PROSPECT'];
  }

  /**
   * Tiers de l'annuaire : recherche par code ou raison sociale (liste proposée), ou liste complète des tiers (🔍, F4,
   * double-clic) filtrée selon la fiche ; l'ID est enregistré.
   */
  #champTiers(champ, valeur, lecture) {
    const annuaire = this.services.annuaire;
    const span = document.createElement('span');
    span.className = 'champ-tiers';
    const nom = this.tiersNoms.get(Number(valeur));
    if (valeur && nom === undefined) {
      this.tiersNoms.set(Number(valeur), null);
      annuaire.personne(Number(valeur)).then((p) => {
        this.tiersNoms.set(Number(valeur), `${p.code ?? p.valeurs?.code ?? ''} – ${p.raison_sociale ?? p.valeurs?.raison_sociale ?? ''}`);
        this.rendre();
      }).catch(() => {});
    }
    if (lecture) {
      span.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.PERSONNE, Number(valeur))}">${echapper(nom || `Tiers ${valeur}`)}</a>` : '—';
      return span;
    }
    const id = `tiers-${champ.code}-${Math.random().toString(36).slice(2, 8)}`;
    span.innerHTML = `<input type="search" class="fiche-saisie-champ" list="${id}" value="${echapper(nom ?? (valeur ? `Tiers ${valeur}` : ''))}" placeholder="Rechercher un tiers (code, raison sociale ; F4 : liste)"><datalist id="${id}"></datalist>
      <button type="button" class="bouton-icone" data-liste-tiers title="Choisir dans la liste des tiers (F4 ou double-clic dans le champ)">🔍</button>`;
    const input = span.querySelector('input');
    const liste = span.querySelector('datalist');
    let resultats = [];
    let minuterie = null;
    const ouvrirListe = async () => {
      const p = await choisirTiers({ relations: this.relationsTiers(champ), titre: champ.libelle ?? 'Tiers', recherche: valeur ? '' : input.value.trim() });
      if (!p) return;
      this.tiersNoms.set(p.id, `${p.code ?? ''} – ${p.raison_sociale ?? ''}`);
      this.definirValeur(champ.code, p.id);
      this.rendre();
    };
    span.querySelector('[data-liste-tiers]').addEventListener('click', ouvrirListe);
    input.addEventListener('keydown', (e) => { if (e.key === 'F4') { e.preventDefault(); ouvrirListe(); } });
    input.addEventListener('dblclick', ouvrirListe);
    input.addEventListener('input', () => {
      clearTimeout(minuterie);
      const choisi = resultats.find((p) => `${p.code} – ${p.raison_sociale}` === input.value);
      if (choisi) { this.tiersNoms.set(choisi.id, input.value); this.definirValeur(champ.code, choisi.id); return; }
      if (input.value === '') { this.definirValeur(champ.code, null); return; }
      minuterie = setTimeout(async () => {
        resultats = await annuaire.rechercherPersonnes({ recherche: input.value, limite: 20 }).catch(() => []);
        liste.innerHTML = resultats.map((p) => `<option value="${echapper(`${p.code} – ${p.raison_sociale}`)}"></option>`).join('');
      }, 250);
    });
    // Prospect (lot 6, A25) : nouveau tiers provisoire de l'annuaire, doublons proposés avant la création.
    if (this.prospectAutorise(champ)) {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'bouton-icone';
      bouton.textContent = '＋';
      bouton.title = 'Nouveau prospect : tiers provisoire de l\'annuaire (doublons proposés)';
      bouton.addEventListener('click', async () => {
        const saisi = resultats.some((p) => `${p.code} – ${p.raison_sociale}` === input.value) ? '' : input.value.trim();
        const p = await creerTiersProvisoire({ annuaire, raison_sociale: saisi, casquettes: ['CLIENT'], titre: 'Nouveau prospect (tiers provisoire)' });
        if (!p) return;
        this.tiersNoms.set(Number(p.id), `${p.code ?? ''} – ${p.raison_sociale ?? ''}`);
        this.definirValeur(champ.code, Number(p.id));
        this.rendre();
      });
      span.append(bouton);
    }
    return span;
  }

  /**
   * Individu de notre structure (conducteur de travaux) : combo des individus rattachés à notre société et à ses
   * agences (`individusStructure`, lue une fois par fiche), l'ID est enregistré ; contrôlé par le serveur.
   */
  #champIndividuSociete(champ, valeur, lecture) {
    const span = document.createElement('span');
    span.className = 'champ-tiers';
    if (!this.individusSociete) {
      this.individusSociete = individusStructure(this.services.annuaire).catch(() => []);
    }
    this.individusSociete.then((liste) => {
      const choisi = liste.find((x) => Number(x.valeur) === Number(valeur));
      if (lecture) {
        span.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.INDIVIDU, Number(valeur))}">${echapper(choisi?.libelle ?? `Individu ${valeur}`)}</a>` : '—';
        return;
      }
      const combo = creerCombo({ valeur: valeur ?? '', options: liste.map((x) => ({ valeur: x.valeur, libelle: x.libelle, detail: x.detail })), titre: champ.aide ?? '' });
      combo.classList.add('fiche-saisie-champ');
      combo.addEventListener('change', () => { const v = combo.resoudre(); this.definirValeur(champ.code, v === '' || v === null ? null : Number(v)); });
      span.replaceChildren(combo);
    });
    return span;
  }

  /** Individu de l'annuaire (contact sur place…) : recherche par nom, l'ID est enregistré. */
  #champIndividu(champ, valeur, lecture) {
    const annuaire = this.services.annuaire;
    const span = document.createElement('span');
    span.className = 'champ-tiers';
    this.individusNoms ??= new Map();
    const nom = this.individusNoms.get(Number(valeur));
    if (valeur && nom === undefined) {
      this.individusNoms.set(Number(valeur), null);
      annuaire.individu(Number(valeur)).then((i) => {
        this.individusNoms.set(Number(valeur), i.nom_complet ?? [i.prenom ?? i.valeurs?.prenom, i.nom ?? i.valeurs?.nom].filter(Boolean).join(' '));
        this.rendre();
      }).catch(() => {});
    }
    if (lecture) {
      span.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.INDIVIDU, Number(valeur))}">${echapper(nom || `Individu ${valeur}`)}</a>` : '—';
      return span;
    }
    const id = `individu-${champ.code}-${Math.random().toString(36).slice(2, 8)}`;
    span.innerHTML = `<input type="search" class="fiche-saisie-champ" list="${id}" value="${echapper(nom ?? (valeur ? `Individu ${valeur}` : ''))}" placeholder="Rechercher un individu (nom)"><datalist id="${id}"></datalist>`;
    const input = span.querySelector('input');
    const liste = span.querySelector('datalist');
    const libelle = (i) => `${i.nom_complet}${i.personnes ? ` (${i.personnes})` : ''}`;
    let resultats = [];
    let minuterie = null;
    input.addEventListener('input', () => {
      clearTimeout(minuterie);
      const choisi = resultats.find((i) => libelle(i) === input.value);
      if (choisi) { this.individusNoms.set(choisi.id, choisi.nom_complet); this.definirValeur(champ.code, choisi.id); return; }
      if (input.value === '') { this.definirValeur(champ.code, null); return; }
      minuterie = setTimeout(async () => {
        resultats = await annuaire.rechercherIndividus({ recherche: input.value, limite: 20 }).catch(() => []);
        liste.innerHTML = resultats.map((i) => `<option value="${echapper(libelle(i))}"></option>`).join('');
      }, 250);
    });
    return span;
  }

  /** Liens vers les éléments rattachés et raccourcis vers les listes filtrées par le code de la fiche (en tête de fiche). */
  rendreInformations(v) {
    const liens = this.liens(v).filter((l) => l.elements.length);
    const raccourcis = this.id !== null && v.code ? [...(RACCOURCIS[this.type] ?? []), ...this.raccourcisModules()] : [];
    return liens.map((l) => `<div class="fiche-info"><span>${echapper(l.titre)}</span>
      <b>${l.elements.map((x) => `<a href="${urlFiche(l.type, x.id)}">${echapper(x.code)}</a> ${echapper(x.libelle ?? '')}${x.extra ? ` <small>${echapper(x.extra)}</small>` : ''}`).join(' · ')}</b></div>`).join('')
      + (raccourcis.length ? `<div class="fiche-info fiche-raccourcis"><span>Listes</span><b>${raccourcis.map(([theme, libelle]) =>
        `<a href="/liste/${theme}?${new URLSearchParams({ [this.type]: v.code })}" title="${echapper(`${libelle} filtrés sur ${v.code} (Ctrl : nouvelle fenêtre)`)}">${echapper(libelle)}</a>`).join(' · ')}</b></div>` : '')
      + (this.id !== null && ['chantier', 'marche'].includes(this.type) && this.moduleActif(MODULE_FACULTATIF.REGLEMENT)
        ? `<div class="fiche-info"><span>Règlements</span><b><a href="/reglements?${this.type}=${Number(this.id)}" title="Échéances des pièces validées du ${this.type === TYPE_FICHE.CHANTIER ? 'chantier' : 'marché'}, pointé et reste, tous tiers">Échéances et règlements</a></b></div>` : '');
  }

  /** Champ tiers qui propose un nouveau prospect (tiers provisoire) : aucun par défaut. */
  prospectAutorise(_champ) { return false; }

  /** Raccourcis vers les listes des modules facultatifs actifs (thème, libellé). */
  raccourcisModules() {
    if (this.type !== TYPE_FICHE.CHANTIER || !this.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE)) return [];
    return [['marches_st', 'Marchés de sous-traitance'], ['st_commandes', 'Commandes de sous-traitance'], ['st_factures', 'Factures de sous-traitance']];
  }

  liens() { return []; }

  /** Onglet Graphe : liens de la structure et documents rattachés (module Graphe). */
  ongletsSpecifiques() {
    return [{
      code: 'graphe', titre: 'Graphe',
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = '<p class="aide">Enregistrez la fiche pour voir ses liens et ses documents.</p>'; return; }
        corps.classList.add('graphe-hote');
        this.vueGraphe = new VueGrapheStructure(corps, {
          structure: this.services.structure, depart: { type: this.type, id: Number(this.id) }, message: this.message,
          naviguer: (url, e) => this.ouvrirUrl(url, e),
        });
      },
    }, ...this.ongletsSuivi(), ...this.ongletsFil()];
  }

  /** Onglet Fil (affaires et chantiers, module CRM) : fil d'actualité de l'élément, chantiers compris pour une affaire. */
  ongletsFil() {
    if (!this.fil || !['affaire', 'chantier'].includes(this.type)) return [];
    return [{
      code: 'fil', titre: 'Fil',
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = '<p class="aide">Enregistrez la fiche pour voir son fil d\'actualité.</p>'; return; }
        this.filCrm?.fermer();
        const v = this.fiche?.valeurs ?? {};
        this.filCrm = this.fil(corps, { type: this.type, id: this.id, libelle: [v.code, v.libelle].filter(Boolean).join(' ') });
      },
    }];
  }
}

export class FicheProjet extends FicheStructure {
  /** Client du projet : un prospect se crée en tiers provisoire (lot 6, A25). */
  prospectAutorise(champ) { return champ.code === 'tiers_id'; }

  liens() {
    return [{ titre: 'Chantier', type: TYPE_FICHE.CHANTIER, elements: (this.refs.chantiers ?? []).filter((c) => c.prj_id === Number(this.id)) }];
  }

  /** Passage à « Obtenu » : proposer d'ouvrir le chantier (fiche de création préremplie depuis le projet). */
  async enregistrer() {
    const avant = this.fiche?.valeurs?.statut ?? null;
    const ok = await super.enregistrer();
    if (!ok) return ok;
    await this.rechargerReferentiels();
    const obtenu = this.valeur('statut') === 'OBTENU' && avant !== 'OBTENU';
    if (obtenu && !(this.refs.chantiers ?? []).some((c) => c.prj_id === Number(this.id))
      && await confirmer(`Projet obtenu : ouvrir le chantier de « ${this.valeur('libelle')} » ?`)) {
      this.ouvrirUrl(`/fiche/chantier/nouveau?projet=${this.id}`);
    }
    this.rendre();
    return ok;
  }
}

export class FicheAffaire extends FicheStructure {
  liens() {
    return [{ titre: 'Chantiers', type: TYPE_FICHE.CHANTIER, elements: (this.refs.chantiers ?? []).filter((c) => c.aff_id === Number(this.id)) }];
  }
}

export class FicheChantier extends FicheStructure {
  sourceIntervenants() { return parametre('projet') ? ['projet', parametre('projet')] : null; }

  /** Création depuis un projet obtenu (?projet=) : libellé, client et ville du projet. */
  valeursCreation() {
    const v = super.valeursCreation();
    if (new URLSearchParams(globalThis.location?.search ?? '').get('sens') === 'ST') v.sens = 'ST';
    const prj = (this.refs.projets ?? []).find((p) => p.id === parametre('projet'));
    if (prj) Object.assign(v, { prj_id: prj.id, libelle: prj.libelle, tiers_id: prj.tiers_id, ville: prj.ville });
    return v;
  }

  /** Projet choisi : client et ville repris s'ils sont vides. */
  choisirReference(code, id) {
    super.choisirReference(code, id);
    if (code !== 'prj_id' || !id) return;
    const prj = (this.refs.projets ?? []).find((p) => p.id === id);
    if (prj && !this.valeur('tiers_id')) this.definirValeur('tiers_id', prj.tiers_id);
    if (prj && !this.valeur('ville')) this.definirValeur('ville', prj.ville);
  }

  /** Zones de déplacement du Pointage (par agence, lot 6 : A26), lues une fois par fiche. */
  rendreInformations(v) {
    if (this.id !== null && this.zones === undefined && this.moduleActif(MODULE_FACULTATIF.POINTAGE)) {
      this.zones = null;
      api.pointage.zones(Number(this.id)).then((l) => { this.zones = l; this.rendre(); }).catch(() => { this.zones = []; });
    }
    return super.rendreInformations(v) + (this.zones?.length
      ? `<div class="fiche-info"><span>Zones de déplacement</span><b>${this.zones.map((z) => `${echapper(z.agence)} : zone ${z.zone}`).join(' · ')}</b></div>` : '');
  }

  liens(v) {
    const marches = (this.refs.marches ?? []).filter((m) => m.cha_id === Number(this.id))
      .map((m) => ({ ...m, extra: m.montant_ht !== null ? `${formatNombre(m.montant_ht, 2)} € HT` : '' }));
    return [
      { titre: 'Affaire', type: TYPE_FICHE.AFFAIRE, elements: (this.refs.affaires ?? []).filter((a) => a.id === Number(v.aff_id)) },
      { titre: 'Projet', type: TYPE_FICHE.PROJET, elements: (this.refs.projets ?? []).filter((p) => p.id === Number(v.prj_id)) },
      { titre: 'Marchés', type: TYPE_FICHE.MARCHE, elements: marches },
    ];
  }
}

export class FicheMarche extends FicheStructure {
  sourceIntervenants() { return parametre('chantier') ? ['chantier', parametre('chantier')] : null; }

  /** Marché de sous-traitance (ST2) : groupe Sous-traitance ; marché de vente : pas ce groupe. */
  groupeVisible(g) { return g.titre !== 'Sous-traitance' || this.valeur('sens') === 'ST'; }

  /** Marché de vente lié : marchés de vente du même chantier. */
  filtreReference(champ) {
    if (champ.code !== 'marche_vente_id') return null;
    const cha = this.valeur('cha_id');
    return { libelle: 'Marchés de vente du chantier', test: (x) => (x.sens ?? 'V') === 'V' && (!cha || x.cha_id === Number(cha)) };
  }

  /** Création depuis un chantier (?chantier=) ou une commande (?commande=) ; le code prévisionnel suit le chantier (chrono à {PARENT}). */
  valeursCreation() {
    const v = super.valeursCreation();
    const cha = (this.refs.chantiers ?? []).find((c) => c.id === parametre('chantier'));
    if (cha) Object.assign(v, { cha_id: cha.id, tiers_id: v.sens === 'ST' ? null : cha.tiers_id });
    const cde = (this.refs.commandes ?? []).find((c) => c.id === parametre('commande'));
    if (cde) Object.assign(v, { ent_id: cde.id, libelle: cde.objet, tiers_id: v.tiers_id ?? cde.tiers_id });
    return v;
  }

  choisirReference(code, id) {
    super.choisirReference(code, id);
    if (code !== 'cha_id' || !id || this.mode !== MODES.CREATION) return;
    const cha = (this.refs.chantiers ?? []).find((c) => c.id === id);
    if (cha && !this.valeur('tiers_id') && this.valeur('sens') !== 'ST') this.definirValeur('tiers_id', cha.tiers_id);
  }

  /** Marché créé depuis une commande : la commande lui est rattachée (et donc à son chantier et à son affaire). */
  async enregistrer() {
    const cree = this.mode === MODES.CREATION || this.mode === MODES.COPIE;
    const ok = await super.enregistrer();
    if (ok && cree && this.valeur('ent_id')) {
      await this.services.structure.rattacher(Number(this.valeur('ent_id')), { ent_marche_id: Number(this.id) }).catch((e) => this.message(e.message, 'erreur'));
    }
    if (ok) { await this.rechargerReferentiels(); this.rendre(); }
    return ok;
  }

  liens(v) {
    return [{ titre: 'Chantier', type: TYPE_FICHE.CHANTIER, elements: (this.refs.chantiers ?? []).filter((c) => c.id === Number(v.cha_id)) }];
  }

  /**
   * Sous-traitance, lot 5 (ST30) : engagé (commandes de sous-traitance validées) et réalisé (factures validées) des
   * marchés de sous-traitance liés, paiement direct accepté, comparés au déboursé de sous-traitance prévu (lignes de
   * nature ST des commandes du marché).
   */
  async rendreEngage(zone) {
    if (!zone) return;
    let e;
    try { e = await api.engageSousTraitance(Number(this.id)); } catch (x) { zone.innerHTML = `<p class="erreur">${echapper(x.message)}</p>`; return; }
    const f = (v) => formatNombre(v, 2);
    const ecart = Dz(e.prevu).minus(Dz(e.engage));
    zone.innerHTML = `<p class="ligne">Déboursé de sous-traitance prévu <strong>${f(e.prevu)}</strong> · Engagé <strong>${f(e.engage)}</strong>
        · Réalisé <strong>${f(e.facture)}</strong> · ${ecart.isNegative() ? `<span class="erreur">Dépassement ${f(ecart.abs().toString())}</span>` : `Reste prévu non engagé ${f(ecart.toString())}`}</p>
      ${e.marches.length ? `<table class="tableau-gestion"><thead><tr><th>Marché</th><th>Sous-traitant</th><th>Garantie</th><th class="nombre">Agréé</th>
        <th class="nombre">Engagé HT</th><th class="nombre">Réalisé HT</th><th class="nombre">Reste à facturer</th><th class="nombre">Paiement direct</th><th>Prestations</th></tr></thead><tbody>
        ${e.marches.map((m) => `<tr><td><a href="${urlFiche(TYPE_FICHE.MARCHE, m.marche_id)}">${echapper(m.code)}</a> <small class="aide">${echapper(m.libelle ?? '')}</small></td>
          <td>${echapper(m.sous_traitant ?? '')}</td><td>${echapper(m.garantie ?? '')}</td><td class="nombre">${f(m.montant_agree)}</td><td class="nombre">${f(m.engage)}</td>
          <td class="nombre">${f(m.facture)}</td><td class="nombre">${f(Dz(m.engage).minus(Dz(m.facture)).toString())}</td><td class="nombre">${f(m.paiement_direct)}</td>
          <td><a href="/liste/st_commandes?${new URLSearchParams({ marche: m.code })}">Commandes</a> · <a href="/liste/st_factures?${new URLSearchParams({ marche: m.code })}">Factures</a></td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucun marché de sous-traitance lié à ce marché (ou sur son chantier).</p>'}`;
  }

  /** Onglet Gestion (CONCEPTION-MARCHES-REGLEMENTS.md, Q1 à Q4) avant le graphe. */
  ongletsSpecifiques() {
    // Marché de sous-traitance (module Sous-traitance, lot 2) : pièces du sous-traitant et du marché.
    const pieces = this.valeur('sens') === 'ST' && this.id !== null && this.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE) && this.services.structure.gestion
      ? [{
        code: 'pieces', titre: 'Pièces',
        rendre: (corps) => rendrePieces(corps, {
          element: { type: TYPE_FICHE.MARCHE, id: Number(this.id), tiers: this.valeur('tiers_id') }, ged: this.services.ged, message: this.message,
          demander: () => this.ouvrirUrl(`/mail/nouveau?type=st_pieces&id=marche:${this.id}`, { ctrlKey: true }),
        }).catch((e) => this.message(e.message, 'erreur')),
      }, {
        // Lot 4 : paiement direct ou délégation, réception et retenue de garantie.
        code: 'paiements', titre: 'Paiements',
        rendre: (corps) => rendrePaiements(corps, { marche: Number(this.id), message: this.message }).catch((e) => this.message(e.message, 'erreur')),
      }]
      : [];
    // Marché de vente : réception et retenue de garantie (en ligne).
    const retenue = this.valeur('sens') !== 'ST' && this.id !== null && this.services.structure.gestion
      ? [{ code: 'retenue', titre: 'Retenue', rendre: (corps) => rendreRetenue(corps, { marche: Number(this.id), message: this.message }).catch((e) => this.message(e.message, 'erreur')) }]
      : [];
    // Révision des prix (lots G1 et G3) : paramètres du marché et périodes révisées, vente et sous-traitance.
    const revision = this.id !== null && this.services.structure.gestion
      ? [{ code: 'revision', titre: 'Révision', rendre: (corps) => rendreRevision(corps, {
        marche: Number(this.id), message: this.message, ouvrir: (url, e) => this.ouvrirUrl(url, e),
      }).catch((e) => this.message(e.message, 'erreur')) }]
      : [];
    return [{ code: 'gestion', titre: 'Gestion', rendre: (corps) => this.rendreGestion(corps) }, ...pieces, ...retenue, ...revision, ...super.ongletsSpecifiques()];
  }

  /**
   * Gestion du marché : regroupements repliables (état gardé dans le navigateur), chacun avec ses boutons de création :
   * récapitulatif par commande (marché, TS : HT net, TTC net, travaux, situé, facturé, reste ; totaux), situations de
   * référence (avancement sur le total du marché et des avenants), factures et avoirs d'avancement (HT net, TTC net,
   * net à payer, annulés masqués et réaffichables ; totaux), factures des sous-traitants en paiement direct (facture du
   * marché liée ; totaux), acomptes, postes de pied.
   */
  /** Avancement réel des tâches du chantier (terrain, T12) comparé à l'avancement situé, sous le récapitulatif. */
  async rendreAvancementReel(corps, situe) {
    let a;
    try { a = await this.services.structure.avancementReel(Number(this.id)); } catch { return; }
    if (!a.taches.length) return;
    const bloc = document.createElement('details');
    bloc.className = 'groupe-gestion';
    const n = (v) => (v == null ? '–' : `${formatNombre(v, 1).replace(/,0$/, '')} %`);
    bloc.innerHTML = `<summary><h3>Avancement réel et situations</h3></summary>
      <p>Réel sur le chantier : <b>${n(a.reel)}</b>${a.dernier ? ` (dernier relevé le ${formatDate(a.dernier)})` : ''} · situé : <b>${situe || '–'}</b>
        <span class="aide">Réel = moyenne des tâches pondérée par leurs heures ; un chantier à plusieurs marchés compte toutes ses tâches.</span></p>
      <table class="tableau-gestion"><thead><tr><th>Tâche</th><th class="nombre">Heures</th><th class="nombre">Réel</th><th>Relevé</th></tr></thead>
      <tbody>${a.taches.map((t) => `<tr><td>${echapper(t.libelle)}</td><td class="nombre">${formatNombre(t.heures, 1)}</td><td class="nombre">${n(t.pourcent)}</td><td>${t.le ? formatDate(t.le) : ''}</td></tr>`).join('')}</tbody></table>`;
    corps.querySelector('[data-groupe="recapitulatif"]')?.after(bloc);
  }

  async rendreGestion(corps) {
    if (this.id === null) { corps.innerHTML = '<p class="aide">Enregistrez la fiche pour gérer le marché.</p>'; return; }
    if (!this.services.structure.gestion) { corps.innerHTML = '<p class="aide">Gestion du marché disponible en ligne seulement.</p>'; return; }
    corps.innerHTML = '<p class="aide">Chargement…</p>';
    let g;
    try { g = await this.services.structure.gestion(Number(this.id)); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const f = (v) => formatNombre(v, 2);
    // Pourcentage sous sa forme la plus simple (deux décimales au plus : 30 %, 85,26 %).
    const pct = (n, d) => {
      if (Dz(d).isZero() || n === null || n === undefined) return '';
      const s = formatNombre(D(n).div(D(d)).times(100).toDecimalPlaces(2).toString(), 2);
      return `${s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s} %`;
    };
    const lien = (x) => `<a href="${urlDocument(Number(x.ent_id))}" title="Ouvrir (Ctrl : nouvelle fenêtre)">${echapper(x.numero ?? `#${x.ent_id}`)}</a>`;
    const somme = (liste, cle) => liste.reduce((s, x) => s.plus(Dz(x[cle])), D(0)).toString();
    const total = (cle) => somme(g.commandes, cle);
    const prevu = total('prevu_ht');
    const factures = g.factures.filter((x) => this.voirAnnulees || !x.annule);
    const facturesComptees = factures.filter((x) => !x.annule);
    const nbAnnulees = g.factures.filter((x) => x.annule).length;
    const sousTraitants = (g.sous_traitants ?? []).filter((x) => this.voirAnnulees || !x.annule);
    const stComptees = sousTraitants.filter((x) => !x.annule);
    // Module Règlements (facultatif, 11.5) : réglé et reste à payer des pièces validées ; sans lui, pas de colonnes.
    const etats = new Map();
    if (this.services.structure.etatPieces && factures.some((x) => x.valide)) {
      const liste = await this.services.structure.etatPieces(factures.filter((x) => x.valide).map((x) => Number(x.ent_id))).catch(() => null);
      for (const e of liste ?? []) etats.set(Number(e.piece_id), e);
    }
    const reglements = etats.size > 0;
    const etat = (x, cle) => (etats.has(Number(x.ent_id)) ? etats.get(Number(x.ent_id))[cle] : null);
    const regle = (x) => (reglements ? `<td class="nombre">${f(etat(x, 'pointe'))}</td><td class="nombre">${f(etat(x, 'reste'))}</td>` : '');
    const totalRegle = (cle) => facturesComptees.reduce((s, x) => s.plus(Dz(etat(x, cle))), D(0)).toString();

    // Regroupement repliable : titre, boutons de création (sans replier), contenu.
    const reduits = new Set(lirePreferences().gestionMarcheReduits ?? []);
    const groupe = (code, titre, boutons, contenu) => `<details class="groupe-gestion" data-groupe="${code}" ${reduits.has(code) ? '' : 'open'}>
      <summary><h3>${titre}</h3><span class="groupe-gestion-boutons">${boutons.map((x) => `<button type="button" data-creer="${x.type}" title="${echapper(x.titre)}">${x.libelle}</button>`).join('')}</span></summary>
      ${contenu}</details>`;
    const creation = this.creationPossible();
    const B = (type) => (creation ? [CREATIONS_MARCHE[type]] : []);

    corps.innerHTML = `<div class="gestion-marche">
      ${groupe('recapitulatif', 'Récapitulatif du marché et des avenants', [...B(TYPE_DOCUMENT.V_RECEPTION), ...(this.moduleActif(MODULE_FACULTATIF.EXECUTION) ? B(TYPE_DOCUMENT.E_OE) : [])], `
      <table class="tableau-gestion"><thead><tr><th>Commande</th><th>N°</th><th>Objet</th><th class="nombre">HT net</th><th class="nombre">TTC net</th>
        <th class="nombre">Travaux HT</th><th class="nombre">Situé</th><th class="nombre">Avancement</th><th class="nombre">Facturé HT</th><th class="nombre">Reste à facturer</th></tr></thead>
      <tbody>${g.commandes.map((c) => `<tr><td>${c.role === 'BASE' ? 'Marché' : `TS ${c.rang}`}</td><td>${lien(c)}</td><td>${echapper(c.objet ?? '')}</td>
        <td class="nombre">${f(c.prevu_ht)}</td><td class="nombre">${f(c.prevu_ttc)}</td><td class="nombre">${f(c.travaux_ht)}</td><td class="nombre">${f(c.situe_ht)}</td>
        <td class="nombre">${pct(c.situe_ht, c.travaux_ht)}</td><td class="nombre">${f(c.facture_ht)}</td>
        <td class="nombre">${f(Dz(c.travaux_ht).minus(Dz(c.facture_ht)).toString())}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="3">Total</th><th class="nombre">${f(prevu)}</th><th class="nombre">${f(total('prevu_ttc'))}</th><th class="nombre">${f(total('travaux_ht'))}</th>
        <th class="nombre">${f(total('situe_ht'))}</th><th class="nombre">${pct(total('situe_ht'), total('travaux_ht'))}</th>
        <th class="nombre">${f(g.facture_ht)}</th><th class="nombre">${f(Dz(g.montant_ht).minus(Dz(g.facture_ht)).toString())}</th></tr></tfoot></table>
      <p class="aide">Situé : dernière situation de référence ; facturé par commande : factures et avoirs d'avancement non annulés (travaux) ;
        facturé du marché : toutes ses factures et avoirs validés. Reste du marché = montant du marché − facturé.</p>`)}

      ${groupe('situations', 'Situations', B(TYPE_DOCUMENT.V_SITUATION), g.situations.length ? `<table class="tableau-gestion"><thead><tr><th>N° de situation</th><th>Document</th><th>Indice</th><th>Date</th><th>Statut</th>
        <th class="nombre">Cumul HT</th><th class="nombre" title="Cumul de la situation sur le total HT net du marché et de ses avenants">Avancement du marché</th><th></th></tr></thead><tbody>${g.situations.map((x) => `<tr><td>${x.rang ?? ''}</td><td>${lien(x)}</td>
        <td>${echapper(x.indice ?? '')}${x.indices > 1 ? ` <small>(${x.indices} indices)</small>` : ''}</td><td>${echapper(x.date ?? '')}</td>
        <td>${echapper(x.statut ?? '')}${x.facturee ? ' · facturée' : ''}</td><td class="nombre">${f(x.total_ht)}</td><td class="nombre">${pct(x.total_ht, prevu)}</td>
        <td>${x.valide && !x.facturee ? `<button type="button" data-facturer="${x.ent_id}">Facturer</button> <button type="button" data-reviser="${x.ent_id}">Réviser</button>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="aide">Aucune situation.</p>')}

      ${groupe('factures', "Factures et avoirs d'avancement", [...B(TYPE_DOCUMENT.V_FACTURE_AVT), ...B(TYPE_DOCUMENT.V_REPRISE_AVT)], `
      ${nbAnnulees ? `<label class="fiche-option"><input type="checkbox" data-annulees ${this.voirAnnulees ? 'checked' : ''}> Afficher les pièces annulées (${nbAnnulees})</label>` : ''}
      ${factures.length ? `<table class="tableau-gestion"><thead><tr><th>N° de situation</th><th>Pièce</th><th>Type</th><th>Date</th><th>Statut</th>
        <th class="nombre">HT net</th><th class="nombre">TTC net</th><th class="nombre">Net à payer</th>${reglements ? '<th class="nombre">Réglé</th><th class="nombre">Reste à payer</th>' : ''}<th></th></tr></thead><tbody>${factures.map((x) => `<tr class="${x.annule ? 'annulee' : ''}">
        <td>${x.rang ?? ''}</td><td>${lien(x)}</td><td>${echapper(x.type)}${x.nature === 'ANNULATION' ? ' (annulation)' : x.nature === 'AVANCEMENT' ? " (d'avancement)" : ''}</td>
        <td>${echapper(x.date ?? '')}</td><td>${echapper(x.statut ?? '')}</td><td class="nombre">${f(x.total_ht)}</td><td class="nombre">${f(x.total_ttc)}</td>
        <td class="nombre">${f(x.net_a_payer)}</td>${regle(x)}<td>${x.valide && !x.annule ? `<button type="button" data-annuler="${x.ent_id}">Annuler par avoir…</button>` : ''}</td></tr>`).join('')}
        </tbody><tfoot><tr><th colspan="5">Total${nbAnnulees && this.voirAnnulees ? ' (hors pièces annulées)' : ''}</th><th class="nombre">${f(somme(facturesComptees, 'total_ht'))}</th>
        <th class="nombre">${f(somme(facturesComptees, 'total_ttc'))}</th><th class="nombre">${f(somme(facturesComptees, 'net_a_payer'))}</th>
        ${reglements ? `<th class="nombre">${f(totalRegle('pointe'))}</th><th class="nombre">${f(totalRegle('reste'))}</th>` : ''}<th></th></tr></tfoot></table>`
        : '<p class="aide">Aucune facture d\'avancement.</p>'}`)}

      ${groupe('sous_traitants', 'Factures sous-traitants avec paiement direct', creation ? [CREATIONS_MARCHE.A_FACTURE] : [], sousTraitants.length ? `<table class="tableau-gestion"><thead><tr><th>Pièce</th><th>Réf. sous-traitant</th>
        <th>Sous-traitant</th><th>Type</th><th>Date</th><th>Statut</th><th class="nombre">HT net</th><th class="nombre">TTC net</th><th>Facture liée</th></tr></thead>
        <tbody>${sousTraitants.map((x) => `<tr class="${x.annule ? 'annulee' : ''}"><td>${lien(x)}</td><td>${echapper(x.reference ?? '')}</td><td>${echapper(x.tiers ?? '')}</td>
        <td>${echapper(x.type)}</td><td>${echapper(x.date ?? '')}</td><td>${echapper(x.statut ?? '')}</td><td class="nombre">${f(x.total_ht)}</td>
        <td class="nombre">${f(x.total_ttc)}</td><td>${x.liee ? lien(x.liee) : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="6">Total</th><th class="nombre">${f(somme(stComptees, 'total_ht'))}</th><th class="nombre">${f(somme(stComptees, 'total_ttc'))}</th><th></th></tr></tfoot></table>
        <p class="aide">Sous-traitants : postes « Paiement direct » du marché et intervenants marqués paiement direct (marché, chantier). Facture liée : facture
          du marché dont le paiement direct du sous-traitant est égal au TTC de la pièce, sinon la première à sa date ou après.</p>`
        : '<p class="aide">Aucune facture de sous-traitant en paiement direct (postes « Paiement direct » du marché, intervenants marqués paiement direct).</p>')}

      ${this.valeur('sens') !== 'ST' && this.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE) ? groupe('sous_traitance', 'Sous-traitance : engagé et réalisé', [], '<div data-engage></div>') : ''}
      ${groupe('acomptes', 'Acomptes', [], '<div data-acomptes></div>')}
      ${groupe('postes', 'Postes de pied', [], '<div data-postes></div>')}
    </div>`;
    corps.querySelectorAll('details.groupe-gestion').forEach((d) => d.addEventListener('toggle', () => {
      const r = new Set(lirePreferences().gestionMarcheReduits ?? []);
      if (d.open) r.delete(d.dataset.groupe); else r.add(d.dataset.groupe);
      ecrirePreferences({ gestionMarcheReduits: [...r] });
    }));
    corps.querySelectorAll('[data-creer]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault(); // bouton dans le titre : ne replie pas le regroupement
      this.creerDocumentMarche(b.dataset.creer, e).catch((x) => this.message(x.message, 'erreur'));
    }));
    this.rendreEngage(corps.querySelector('[data-engage]'));
    this.rendreAcomptes(corps.querySelector('[data-acomptes]'), corps);
    this.rendrePostes(corps.querySelector('[data-postes]'));
    const recharger = () => this.rendreGestion(corps);
    if (this.moduleActif(MODULE_FACULTATIF.PLANNING)) this.rendreAvancementReel(corps, pct(total('situe_ht'), total('travaux_ht')));
    const action = (fn) => async (e) => {
      try { await fn(Number(e.currentTarget.dataset.facturer ?? e.currentTarget.dataset.reviser ?? e.currentTarget.dataset.annuler), e); await recharger(); } catch (x) { this.message(x.message, 'erreur'); }
    };
    corps.querySelector('[data-annulees]')?.addEventListener('change', (e) => { this.voirAnnulees = e.target.checked; recharger(); });
    corps.querySelectorAll('[data-facturer]').forEach((b) => b.addEventListener('click', action(async (id, e) => {
      const r = await this.services.structure.facturerSituation(id);
      this.message(`Facture d'avancement créée depuis la situation`, 'succes');
      this.ouvrirUrl(urlDocument(r.document.ent_id), e);
    })));
    corps.querySelectorAll('[data-reviser]').forEach((b) => b.addEventListener('click', action(async (id, e) => {
      const r = await this.services.structure.reviser(id);
      this.message(`Révision créée (indice ${r.document.ent_indice})`, 'succes');
      this.ouvrirUrl(urlDocument(r.document.ent_id), e);
    })));
    corps.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', action(async (id) => {
      const pieces = await this.services.structure.piecesAnnulation(id);
      const liste = pieces.map((x) => `• ${x.rang ? `n° ${x.rang} · ` : ''}${x.type} ${x.numero ?? ''}`).join('\n');
      if (!(await confirmer(`Pièces annulées par avoir :\n\n${liste}\n\nAnnuler ?`, { titre: 'Annulation par avoir', danger: true }))) return;
      const r = await this.services.structure.annuler(id);
      this.message(`${r.avoirs.length} avoir(s) d'annulation créé(s)${r.situation ? ' ; dernière situation remise en cours' : ''}`, 'succes');
    })));
  }

  /**
   * Acomptes du marché (CONCEPTION-MARCHES-REGLEMENTS.md, Q10 à Q13, 11.1, 11.2) : demande (% du marché HT ou montant,
   * mode de déduction), facture (mode chiffre d'affaires) ou reçu (avance de trésorerie) émis depuis la demande validée,
   * déduit par les factures d'avancement validées (non annulées) et reste à déduire.
   */
  async rendreAcomptes(zone, corps) {
    if (!zone || !this.services.structure.acomptes) return;
    let acomptes;
    let mode;
    try {
      [acomptes, mode] = await Promise.all([this.services.structure.acomptes(Number(this.id)), this.services.structure.modeAcomptes()]);
    } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const ca = mode.mode === 'CA';
    const DEDUCTIONS = [['LINEAIRE', 'Linéaire (au prorata de l\'avancement)'], ['PREMIERE', 'Première facture'], ['DERNIERE', 'Dernière facture']];
    const f = (v) => formatNombre(v ?? 0, 2);
    const lien = (x) => (x ? `<a href="${urlDocument(Number(x.ent_id))}">${echapper(x.numero ?? `#${x.ent_id}`)}</a> <small>${echapper(x.statut ?? '')}</small>` : '');
    zone.innerHTML = `<p class="aide">Mode de la société : ${ca ? 'chiffre d\'affaires (facture d\'acompte avec TVA, déduction HT par commande)'
      : 'avance de trésorerie (reçu sans TVA, déduction TTC au pied global)'} ; montants ${ca ? 'HT' : 'TTC'}. La déduction est calculée à la validation
      de chaque facture d'avancement, une fois la facture ou le reçu de l'acompte validé.</p>
      ${acomptes.length ? `<table class="tableau-gestion"><thead><tr><th>N°</th><th>Libellé</th><th class="nombre">Montant</th><th>Déduction</th>
        <th>Demande</th><th>${ca ? 'Facture' : 'Reçu'}</th><th class="nombre">Déduit</th><th class="nombre">Reste à déduire</th><th></th></tr></thead>
        <tbody>${acomptes.map((a) => `<tr><td>${a.rang}</td><td>${echapper(a.libelle)}</td><td class="nombre">${f(a.montant)}</td>
          <td>${echapper(DEDUCTIONS.find(([c]) => c === a.deduction)?.[1] ?? a.deduction)}</td><td>${lien(a.demande)}</td><td>${lien(a.piece)}</td>
          <td class="nombre">${f(a.deduit)}</td><td class="nombre">${f(Dz(a.montant).minus(Dz(a.deduit)).toString())}</td>
          <td>${!a.piece || a.piece.annule ? `<button type="button" data-emettre="${a.id}" title="Valide la demande si besoin, puis crée la pièce">${ca ? 'Facturer' : 'Reçu'}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucun acompte.</p>'}
      <div class="formulaire acompte-nouveau">
        <label>Acompte <input data-a="valeur" size="10" inputmode="decimal" placeholder="10"></label>
        <label>En <span data-a="saisie"></span></label>
        <label>Déduction <span data-a="deduction"></span></label>
        <label class="large">Libellé <input data-a="libelle" maxlength="150" placeholder="Acompte n° ${acomptes.length + 1}"></label>
        <button type="button" data-demander>＋ Demande d'acompte</button>
      </div>`;
    const saisie = creerCombo({ options: [{ valeur: 'P', libelle: '% du marché HT' }, { valeur: 'M', libelle: `Montant ${ca ? 'HT' : 'TTC'}` }], valeur: 'P', vide: false });
    const deduction = creerCombo({ options: DEDUCTIONS.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: 'LINEAIRE', vide: false });
    zone.querySelector('[data-a="saisie"]').replaceWith(saisie);
    zone.querySelector('[data-a="deduction"]').replaceWith(deduction);
    zone.querySelector('[data-demander]').addEventListener('click', async (e) => {
      const valeur = lireNombre(zone.querySelector('[data-a="valeur"]').value);
      if (valeur === null || valeur === undefined || Dz(valeur).lte(0)) { this.message('Acompte : valeur positive', 'avertissement'); return; }
      try {
        const r = await this.services.structure.demanderAcompte(Number(this.id), {
          libelle: zone.querySelector('[data-a="libelle"]').value.trim() || null, saisie: saisie.valeurCombo, valeur, deduction: deduction.valeurCombo,
        });
        this.message(`Demande d'acompte créée : ${r.document.ent_numero ?? ''}`, 'succes');
        this.ouvrirUrl(urlDocument(r.document.ent_id), e);
        this.rendreGestion(corps);
      } catch (x) { this.message(x.message, 'erreur'); }
    });
    zone.querySelectorAll('[data-emettre]').forEach((b) => b.addEventListener('click', async (e) => {
      try {
        const r = await this.services.structure.emettreAcompte(Number(b.dataset.emettre));
        this.message(`${ca ? 'Facture' : 'Reçu'} d'acompte créé : à valider`, 'succes');
        this.ouvrirUrl(urlDocument(r.document.ent_id), e);
        this.rendreGestion(corps);
      } catch (x) { this.message(x.message, 'erreur'); }
    }));
  }

  /**
   * Postes de pied du marché (CONCEPTION-MARCHES-REGLEMENTS.md, Q5 à Q9, 11.3, 11.4) : factures (pied global, après TVA :
   * paiement direct d'un sous-traitant, autres retenues ; la retenue de garantie vient du % des conditions) et modèle de
   * pied des commandes (compte prorata, remise… HT ou TTC). Lignes système des pièces, mises à jour à leur validation.
   */
  async rendrePostes(zone) {
    if (!zone || !this.services.structure.postes) return;
    let postes = await this.services.structure.postes(Number(this.id)).catch((e) => { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return null; });
    if (!postes) return;
    const TYPES = [[TYPE_POSTE_MARCHE.PAIEMENT_DIRECT, 'Paiement direct'], [TYPE_POSTE_MARCHE.PRORATA, 'Compte prorata'], [TYPE_POSTE_MARCHE.REMISE, 'Remise'], [TYPE_POSTE_MARCHE.AUTRE, 'Autre']];
    const PORTEES = [['G', 'Factures (pied global)'], ['C', 'Commandes (modèle)']];
    const MODES = [['P', '%'], ['M', 'Montant']];
    const SENS = [[-1, 'Déduction'], [1, 'Ajout']];
    // Sous-traitants du paiement direct : tiers des intervenants du marché.
    const tiers = new Map();
    for (const x of this.valeur('intervenants') ?? []) if (x.per_id) tiers.set(Number(x.per_id), x.tiers ?? x.raison_sociale ?? `#${x.per_id}`);
    const rendre = () => {
      zone.innerHTML = `<p class="aide">Retenue de garantie : % des conditions du marché (${formatLibre(this.valeur('retenue_pct') ?? 0)} %), sur le TTC de chaque facture.
        Le pied global des factures ne reçoit que des postes après TVA (TTC) ; un paiement direct se chiffre sur chaque facture.</p>
        ${postes.length ? `<table class="tableau-gestion"><thead><tr><th>Pièces</th><th>Type</th><th>Libellé</th><th>Niveau</th><th>Mode</th>
          <th class="nombre">Valeur</th><th>Sens</th><th>Sous-traitant</th><th>Actif</th><th></th></tr></thead><tbody>${postes.map((p, i) => `<tr data-i="${i}">
          <td data-combo="portee"></td><td data-combo="type"></td><td><input data-c="libelle" size="26" maxlength="150" value="${echapper(p.libelle)}"></td>
          <td data-combo="niveau"></td><td data-combo="mode"></td><td><input data-c="valeur" size="8" inputmode="decimal" value="${formatLibre(p.valeur)}"></td>
          <td data-combo="sens"></td><td data-combo="per_id"></td><td><input type="checkbox" data-c="actif" ${p.actif ? 'checked' : ''}></td>
          <td><button type="button" data-retirer title="Retirer le poste">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun poste.</p>'}
        <div class="boutons"><button type="button" data-ajouter>＋ Poste</button> <button type="button" class="principal" data-enregistrer>Enregistrer les postes</button></div>`;
      zone.querySelectorAll('tbody tr').forEach((tr) => {
        const p = postes[Number(tr.dataset.i)];
        const combo = (cle, liste, vide = false) => {
          const c = creerCombo({ options: liste.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: p[cle] ?? '', vide });
          c.addEventListener('change', () => {
            p[cle] = c.valeurCombo === '' ? null : c.valeurCombo;
            if (cle === 'portee' && p.portee === 'G') { p.niveau = 'TTC'; rendre(); }
          });
          tr.querySelector(`[data-combo="${cle}"]`).append(c);
        };
        combo('portee', PORTEES);
        combo('type', TYPES);
        combo('niveau', p.portee === 'G' ? [['TTC', 'Après TVA']] : [['HT', 'Avant TVA'], ['TTC', 'Après TVA']]);
        combo('mode', MODES);
        combo('sens', SENS);
        combo('per_id', [...tiers].map(([id, nom]) => [id, nom]), true);
      });
      zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { lire(); postes.splice(Number(b.closest('tr').dataset.i), 1); rendre(); }));
      zone.querySelector('[data-ajouter]').addEventListener('click', () => {
        lire();
        postes.push({ id: null, portee: 'G', type: 'PAIEMENT_DIRECT', libelle: 'Paiement direct', niveau: 'TTC', mode: 'M', valeur: 0, sens: -1, per_id: null, ordre: postes.length + 1, actif: true });
        rendre();
      });
      zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
        if (!lire()) return;
        try {
          postes = await this.services.structure.enregistrerPostes(Number(this.id), postes);
          this.message('Postes du marché enregistrés : appliqués aux factures et commandes à leur validation', 'succes');
          rendre();
        } catch (e) { this.message(e.message, 'erreur'); }
      });
    };
    // Saisie relue dans la liste ; faux si une valeur est invalide.
    const lire = () => {
      for (const tr of zone.querySelectorAll('tbody tr')) {
        const p = postes[Number(tr.dataset.i)];
        p.libelle = tr.querySelector('[data-c="libelle"]').value.trim();
        p.actif = tr.querySelector('[data-c="actif"]').checked;
        const v = lireNombre(tr.querySelector('[data-c="valeur"]').value);
        if (v === null || v === undefined) { this.message(`${p.libelle || 'Poste'} : valeur invalide`, 'avertissement'); return false; }
        p.valeur = v;
        p.sens = Number(p.sens);
        p.per_id = p.per_id === null || p.per_id === '' ? null : Number(p.per_id);
      }
      return true;
    };
    rendre();
  }

  /** Création de documents du marché possible : fiche enregistrée, hors saisie, au moins une commande validée. */
  creationPossible() {
    const commandes = (this.refs.marche_documents ?? []).some((c) => c.mar_id === Number(this.id));
    return this.id !== null && commandes && !this.estEnSaisie() && Boolean(this.services.structure.documentMarche);
  }

  /**
   * Document créé depuis un regroupement de l'onglet Gestion : BL, situation, facture d'avancement, reprise (toutes les
   * commandes validées, une section et un pied par commande) ; facture de sous-traitant : nouvelle facture fournisseur
   * rattachée au marché.
   */
  async creerDocumentMarche(type, e) {
    const c = CREATIONS_MARCHE[type];
    if (type === TYPE_DOCUMENT.A_FACTURE) { this.ouvrirUrl(`/document/nouveau?type=A_FACTURE&marche=${Number(this.id)}`, e); return; }
    const r = await this.services.structure.documentMarche(Number(this.id), type);
    this.message(`${c.nom} ${r.document.ent_numero ?? ''} créé`, 'succes');
    this.ouvrirUrl(urlDocument(r.document.ent_id), e);
  }

  /** Commandes du marché (db/170 : marche_document) : la commande de base puis les avenants, avec leur montant. */
  rendreInformations(v) {
    const commandes = (this.refs.marche_documents ?? []).filter((x) => x.mar_id === Number(this.id));
    if (!commandes.length) return super.rendreInformations(v);
    const ligne = (x) => `<a href="${urlDocument(Number(x.ent_id))}">${echapper(x.numero ?? `Document ${x.ent_id}`)}</a> ${echapper(x.objet ?? '')}`
      + ` <small>${formatNombre(x.total_ht ?? 0, 2)} € HT</small>`;
    const base = commandes.filter((x) => x.role === 'BASE');
    const avenants = commandes.filter((x) => x.role === 'AVENANT');
    return super.rendreInformations(v)
      + (base.length ? `<div class="fiche-info"><span>Commande</span> <b>${base.map(ligne).join(' · ')}</b></div>` : '')
      + (avenants.length ? `<div class="fiche-info"><span>Avenants</span> <b>${avenants.map((x) => `n° ${x.rang} : ${ligne(x)}`).join(' · ')}</b></div>` : '');
  }
}

/** Boutons de création des regroupements de l'onglet Gestion du marché. */
const CREATIONS_MARCHE = {
  V_RECEPTION: { type: TYPE_DOCUMENT.V_RECEPTION, libelle: '🚚 Nouveau BL', nom: 'Bon de livraison', titre: 'Bon de livraison des commandes du marché (reste à livrer de chaque commande)' },
  E_OE: { type: TYPE_DOCUMENT.E_OE, libelle: "▶ Ordre d'exécution", nom: "Ordre d'exécution", titre: "Lancer l'exécution : ordre d'exécution repris des commandes du marché (une section par commande ; module Exécution)" },
  V_SITUATION: { type: TYPE_DOCUMENT.V_SITUATION, libelle: '📈 Nouvelle situation', nom: 'Situation', titre: 'Situation de travaux : avancement cumulé des commandes du marché (non comptable)' },
  V_FACTURE_AVT: { type: TYPE_DOCUMENT.V_FACTURE_AVT, libelle: "📊 Nouvelle facture d'avancement", nom: "Facture d'avancement", titre: "Facture d'avancement : avancement cumulé, facture de la période" },
  V_REPRISE_AVT: { type: TYPE_DOCUMENT.V_REPRISE_AVT, libelle: '↺ Reprise', nom: "Reprise d'avancement", titre: "Reprise d'avancement : cumul déjà facturé dans un autre logiciel (non comptable, déduit des factures suivantes)" },
  A_FACTURE: { type: TYPE_DOCUMENT.A_FACTURE, libelle: '＋ Facture sous-traitant', nom: 'Facture fournisseur', titre: 'Facture fournisseur rattachée au marché (choisir le sous-traitant dans l’annuaire du document)' },
};

export const CLASSES_STRUCTURE = { projet: FicheProjet, affaire: FicheAffaire, chantier: FicheChantier, marche: FicheMarche };
