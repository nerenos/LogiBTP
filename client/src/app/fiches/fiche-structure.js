import { texte, texteHtml, pluriel, icone, iconeHtml, textesParCode, pairesParCode } from '@logibtp/socle/dictionnaire';
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
import { controlerIntervenants, facturesMarche, peutAnnulerParAvoir } from '../structure/structure.js';
import { champRattachement } from '../structure/selection.js';
import { VueGrapheStructure } from '../structure/graphe-structure.js';
import { individusStructure } from '../panneaux-btp.js';
import { creerTiersProvisoire } from '@logibtp/annuaire/ui';
import { choisirTiers } from '../annuaire/choix.js';

// Fiches de la structure des affaires : projet, affaire, chantier, marché. Listes de choix des références (affaire,
// projet, chantier, commande d'origine, tiers de l'annuaire), code prévisionnel du chrono (module Fiche), préremplissage depuis un
// projet (?projet=) ou un chantier (?chantier=, ?commande=), liens vers les éléments rattachés. Un projet passé
// « Obtenu » propose d'ouvrir son chantier.

const LIBELLES_STATUT = textesParCode('fiches_btp.structure.statuts', ['EN_COURS', 'REMIS', 'OBTENU', 'PERDU', 'ABANDONNE', 'OUVERTE', 'CLOSE', 'OUVERT', 'TERMINE', 'CLOS', 'SOLDE', 'RESILIE']);
const parametre = (nom) => Number(new URLSearchParams(globalThis.location?.search ?? '').get(nom)) || null;

/** Raccourcis des fiches vers les listes (thème, libellé), filtrées par le code de la fiche (?projet=CODE…). */
const RACCOURCIS = {
  projet: [...pairesParCode('fiches_btp.structure.listes', ['documents', 'devis', 'chantiers'])],
  affaire: [...pairesParCode('fiches_btp.structure.listes', ['documents', 'chantiers', 'marches', 'factures'])],
  chantier: [...pairesParCode('fiches_btp.structure.listes', ['documents', 'devis', 'commandes', 'situations', 'factures', 'marches', 'achats_commandes', 'achats_factures'])],
  marche: [...pairesParCode('fiches_btp.structure.listes', ['documents', 'situations', 'factures'])],
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
      span.innerHTML = valeur ? `<a href="${urlDocument(Number(valeur))}">${echapper(c ? `${c.numero ?? ''} ${c.objet ?? ''}` : texte('fiches_btp.structure.document', { id: valeur }))}</a>` : '—';
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
      span.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.PERSONNE, Number(valeur))}">${echapper(nom || texte('fiches_btp.structure.tiers', { id: valeur }))}</a>` : '—';
      return span;
    }
    const id = `tiers-${champ.code}-${Math.random().toString(36).slice(2, 8)}`;
    span.innerHTML = `<input type="search" class="fiche-saisie-champ" list="${id}" value="${echapper(nom ?? (valeur ? texte('fiches_btp.structure.tiers', { id: valeur }) : ''))}" placeholder="${texteHtml('fiches_btp.structure.rechercher_tiers')}"><datalist id="${id}"></datalist>
      <button type="button" class="bouton-icone" data-liste-tiers title="${texteHtml('fiches_btp.structure.choisir_tiers')}">${iconeHtml('rechercher')}</button>`;
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
      bouton.innerHTML = iconeHtml('ajouter');
      bouton.title = texte('fiches_btp.structure.prospect_aide');
      bouton.addEventListener('click', async () => {
        const saisi = resultats.some((p) => `${p.code} – ${p.raison_sociale}` === input.value) ? '' : input.value.trim();
        const p = await creerTiersProvisoire({ annuaire, raison_sociale: saisi, casquettes: ['CLIENT'], titre: texte('fiches_btp.structure.prospect') });
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
        span.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.INDIVIDU, Number(valeur))}">${echapper(choisi?.libelle ?? texte('fiches_btp.structure.individu', { id: valeur }))}</a>` : '—';
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
      span.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.INDIVIDU, Number(valeur))}">${echapper(nom || texte('fiches_btp.structure.individu', { id: valeur }))}</a>` : '—';
      return span;
    }
    const id = `individu-${champ.code}-${Math.random().toString(36).slice(2, 8)}`;
    span.innerHTML = `<input type="search" class="fiche-saisie-champ" list="${id}" value="${echapper(nom ?? (valeur ? texte('fiches_btp.structure.individu', { id: valeur }) : ''))}" placeholder="${texteHtml('fiches_btp.structure.rechercher_individu')}"><datalist id="${id}"></datalist>`;
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
      + (raccourcis.length ? `<div class="fiche-info fiche-raccourcis"><span>${texteHtml('fiches_btp.structure.listes_titre')}</span><b>${raccourcis.map(([theme, libelle]) =>
        `<a href="/liste/${theme}?${new URLSearchParams({ [this.type]: v.code })}" title="${texteHtml('fiches_btp.structure.liste_filtree', { libelle, code: v.code })}">${echapper(libelle)}</a>`).join(' · ')}</b></div>` : '')
      + (this.id !== null && ['chantier', 'marche'].includes(this.type) && this.moduleActif(MODULE_FACULTATIF.REGLEMENT)
        ? `<div class="fiche-info"><span>${texteHtml('fiches_btp.structure.reglements')}</span><b><a href="/reglements?${this.type}=${Number(this.id)}" title="${texteHtml(this.type === TYPE_FICHE.CHANTIER ? 'fiches_btp.reglements_aide_chantier' : 'fiches_btp.reglements_aide_marche')}">${texteHtml('fiches_btp.structure.echeances')}</a></b></div>` : '')
      + (this.id !== null && this.type === TYPE_FICHE.CHANTIER && this.moduleActif(MODULE_FACULTATIF.SAV) && this.acces('sav')
        ? `<div class="fiche-info"><span>${texteHtml('sav_btp.equipement.chantier_raccourci')}</span><b><a href="/sav/equipement/nouveau?lieu=${Number(this.id)}">${iconeHtml('sav_btp_equipement')} ${texteHtml('sav_btp.equipement.nouveau_chantier')}</a></b></div>` : '')
      + (this.id !== null && this.type === TYPE_FICHE.CHANTIER && this.moduleActif(MODULE_FACULTATIF.RENTABILITE) && this.acces('rentabilite')
        ? `<div class="fiche-info"><span>${texteHtml('fiches_btp.structure.rentabilite')}</span><b><a href="/rentabilite/chantier/${Number(this.id)}" title="${texteHtml('fiches_btp.structure.rentabilite_aide')}">${iconeHtml('rentabilite_detail')} ${texteHtml('fiches_btp.structure.rentabilite_detail')}</a></b></div>` : '');
  }

  /** Champ tiers qui propose un nouveau prospect (tiers provisoire) : aucun par défaut. */
  prospectAutorise(_champ) { return false; }

  /** Raccourcis vers les listes des modules facultatifs actifs (thème, libellé). */
  raccourcisModules() {
    if (this.type !== TYPE_FICHE.CHANTIER) return [];
    return [
      ...(this.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE) ? pairesParCode('fiches_btp.structure.listes', ['marches_st', 'st_commandes', 'st_factures']) : []),
      // Lots sortis vers le chantier (S24-c, colonne chantier de v_liste_stk_lots).
      ...(this.moduleActif(MODULE_FACULTATIF.STOCK) ? pairesParCode('fiches_btp.structure.listes', ['stk_lots']) : []),
      // Équipements installés chez le client du chantier (module SAV, colonne chantier de v_liste_equipements).
      ...(this.moduleActif(MODULE_FACULTATIF.SAV) && this.acces('sav') ? pairesParCode('fiches_btp.structure.listes', ['sav_equipements']) : []),
    ];
  }

  liens() { return []; }

  /** Onglet Graphe : liens de la structure et documents rattachés (module Graphe). */
  ongletsSpecifiques() {
    return [{
      code: 'graphe', titre: texte('fiches_btp.structure.onglets.graphe'),
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.structure.graphe_nouvelle')}</p>`; return; }
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
      code: 'fil', titre: texte('fiches_btp.structure.onglets.fil'),
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.structure.fil_nouvelle')}</p>`; return; }
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
    return [{ titre: texte('fiches_btp.structure.liens.chantier'), type: TYPE_FICHE.CHANTIER, elements: (this.refs.chantiers ?? []).filter((c) => c.prj_id === Number(this.id)) }];
  }

  /** Passage à « Obtenu » : proposer d'ouvrir le chantier (fiche de création préremplie depuis le projet). */
  async enregistrer() {
    const avant = this.fiche?.valeurs?.statut ?? null;
    const ok = await super.enregistrer();
    if (!ok) return ok;
    await this.rechargerReferentiels();
    const obtenu = this.valeur('statut') === 'OBTENU' && avant !== 'OBTENU';
    if (obtenu && !(this.refs.chantiers ?? []).some((c) => c.prj_id === Number(this.id))
      && await confirmer(texte('fiches_btp.structure.projet_obtenu', { libelle: this.valeur('libelle') }))) {
      this.ouvrirUrl(`/fiche/chantier/nouveau?projet=${this.id}`);
    }
    this.rendre();
    return ok;
  }
}

export class FicheAffaire extends FicheStructure {
  liens() {
    return [{ titre: texte('fiches_btp.structure.liens.chantiers'), type: TYPE_FICHE.CHANTIER, elements: (this.refs.chantiers ?? []).filter((c) => c.aff_id === Number(this.id)) }];
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
      ? `<div class="fiche-info"><span>${texteHtml('fiches_btp.structure.zones')}</span><b>${this.zones.map((z) => texteHtml('fiches_btp.structure.zone', { agence: z.agence, zone: z.zone })).join(' · ')}</b></div>` : '');
  }

  liens(v) {
    const marches = (this.refs.marches ?? []).filter((m) => m.cha_id === Number(this.id))
      .map((m) => ({ ...m, extra: m.montant_ht !== null ? texte('fiches_btp.structure.montant_ht', { montant: formatNombre(m.montant_ht, 2) }) : '' }));
    return [
      { titre: texte('fiches_btp.structure.liens.affaire'), type: TYPE_FICHE.AFFAIRE, elements: (this.refs.affaires ?? []).filter((a) => a.id === Number(v.aff_id)) },
      { titre: texte('fiches_btp.structure.liens.projet'), type: TYPE_FICHE.PROJET, elements: (this.refs.projets ?? []).filter((p) => p.id === Number(v.prj_id)) },
      { titre: texte('fiches_btp.structure.liens.marches'), type: TYPE_FICHE.MARCHE, elements: marches },
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
    return { libelle: texte('fiches_btp.structure.marches_vente'), test: (x) => (x.sens ?? 'V') === 'V' && (!cha || x.cha_id === Number(cha)) };
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
    return [{ titre: texte('fiches_btp.structure.liens.chantier'), type: TYPE_FICHE.CHANTIER, elements: (this.refs.chantiers ?? []).filter((c) => c.id === Number(v.cha_id)) }];
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
    zone.innerHTML = `<p class="ligne">${texteHtml('fiches_btp.structure.engage.resume_html', { prevu: f(e.prevu), engage: f(e.engage), facture: f(e.facture) })} · ${ecart.isNegative() ? `<span class="erreur">${texteHtml('fiches_btp.structure.engage.depassement', { montant: f(ecart.abs().toString()) })}</span>` : texteHtml('fiches_btp.structure.engage.reste', { montant: f(ecart.toString()) })}</p>
      ${e.marches.length ? `<table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.marche')}</th><th>${texteHtml('fiches_btp.structure.colonnes.sous_traitant')}</th><th>${texteHtml('fiches_btp.structure.colonnes.garantie')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.agree')}</th>
        <th class="nombre">${texteHtml('fiches_btp.structure.colonnes.engage_ht')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.realise_ht')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.reste_a_facturer')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.paiement_direct')}</th><th>${texteHtml('fiches_btp.structure.colonnes.prestations')}</th></tr></thead><tbody>
        ${e.marches.map((m) => `<tr><td><a href="${urlFiche(TYPE_FICHE.MARCHE, m.marche_id)}">${echapper(m.code)}</a> <small class="aide">${echapper(m.libelle ?? '')}</small></td>
          <td>${echapper(m.sous_traitant ?? '')}</td><td>${echapper(m.garantie ?? '')}</td><td class="nombre">${f(m.montant_agree)}</td><td class="nombre">${f(m.engage)}</td>
          <td class="nombre">${f(m.facture)}</td><td class="nombre">${f(Dz(m.engage).minus(Dz(m.facture)).toString())}</td><td class="nombre">${f(m.paiement_direct)}</td>
          <td><a href="/liste/st_commandes?${new URLSearchParams({ marche: m.code })}">${texteHtml('fiches_btp.structure.listes.commandes')}</a> · <a href="/liste/st_factures?${new URLSearchParams({ marche: m.code })}">${texteHtml('fiches_btp.structure.listes.factures')}</a></td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('fiches_btp.structure.engage.aucun')}</p>`}`;
  }

  /** Onglet Gestion (CONCEPTION-MARCHES-REGLEMENTS.md, Q1 à Q4) avant le graphe. */
  ongletsSpecifiques() {
    // Marché de sous-traitance (module Sous-traitance, lot 2) : pièces du sous-traitant et du marché.
    const pieces = this.valeur('sens') === 'ST' && this.id !== null && this.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE) && this.services.structure.gestion
      ? [{
        code: 'pieces', titre: texte('fiches_btp.structure.onglets.pieces'),
        rendre: (corps) => rendrePieces(corps, {
          element: { type: TYPE_FICHE.MARCHE, id: Number(this.id), tiers: this.valeur('tiers_id') }, ged: this.services.ged, message: this.message,
          demander: () => this.ouvrirUrl(`/mail/nouveau?type=st_pieces&id=marche:${this.id}`, { ctrlKey: true }),
        }).catch((e) => this.message(e.message, 'erreur')),
      }, {
        // Lot 4 : paiement direct ou délégation, réception et retenue de garantie.
        code: 'paiements', titre: texte('fiches_btp.structure.onglets.paiements'),
        rendre: (corps) => rendrePaiements(corps, { marche: Number(this.id), message: this.message }).catch((e) => this.message(e.message, 'erreur')),
      }]
      : [];
    // Marché de vente : réception et retenue de garantie (en ligne).
    const retenue = this.valeur('sens') !== 'ST' && this.id !== null && this.services.structure.gestion
      ? [{ code: 'retenue', titre: texte('fiches_btp.structure.onglets.retenue'), rendre: (corps) => rendreRetenue(corps, { marche: Number(this.id), message: this.message }).catch((e) => this.message(e.message, 'erreur')) }]
      : [];
    // Révision des prix (lots G1 et G3) : paramètres du marché et périodes révisées, vente et sous-traitance.
    const revision = this.id !== null && this.services.structure.gestion
      ? [{ code: 'revision', get titre() { return texte('fiches_btp.structure.onglets.revision'); }, rendre: (corps) => rendreRevision(corps, {
        marche: Number(this.id), message: this.message, ouvrir: (url, e) => this.ouvrirUrl(url, e),
      }).catch((e) => this.message(e.message, 'erreur')) }]
      : [];
    return [{ code: 'gestion', titre: texte('fiches_btp.structure.onglets.gestion'), rendre: (corps) => this.rendreGestion(corps) }, ...pieces, ...retenue, ...revision, ...super.ongletsSpecifiques()];
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
    bloc.innerHTML = `<summary><h3>${texteHtml('fiches_btp.structure.avancement.titre')}</h3></summary>
      <p>${texteHtml('fiches_btp.structure.avancement.reel_html', { reel: n(a.reel) })}${a.dernier ? ` ${texteHtml('fiches_btp.structure.avancement.dernier', { date: formatDate(a.dernier) })}` : ''} · ${texteHtml('fiches_btp.structure.avancement.situe_html', { situe: situe || '–' })}
        <span class="aide">${texteHtml('fiches_btp.structure.avancement.aide')}</span></p>
      <table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.tache')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.heures')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.reel')}</th><th>${texteHtml('fiches_btp.structure.colonnes.releve')}</th></tr></thead>
      <tbody>${a.taches.map((t) => `<tr><td>${echapper(t.libelle)}</td><td class="nombre">${formatNombre(t.heures, 1)}</td><td class="nombre">${n(t.pourcent)}</td><td>${t.le ? formatDate(t.le) : ''}</td></tr>`).join('')}</tbody></table>`;
    corps.querySelector('[data-groupe="recapitulatif"]')?.after(bloc);
  }

  async rendreGestion(corps) {
    if (this.id === null) { corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.structure.gestion.nouvelle')}</p>`; return; }
    if (!this.services.structure.gestion) { corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.structure.gestion.en_ligne')}</p>`; return; }
    corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.structure.gestion.chargement')}</p>`;
    let g;
    try { g = await this.services.structure.gestion(Number(this.id)); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const f = (v) => formatNombre(v, 2);
    // Pourcentage sous sa forme la plus simple (deux décimales au plus : 30 %, 85,26 %).
    const pct = (n, d) => {
      if (Dz(d).isZero() || n === null || n === undefined) return '';
      const s = formatNombre(D(n).div(D(d)).times(100).toDecimalPlaces(2).toString(), 2);
      return `${s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s} %`;
    };
    const lien = (x) => `<a href="${urlDocument(Number(x.ent_id))}" title="${texteHtml('fiches_btp.structure.gestion.ouvrir')}">${echapper(x.numero ?? `#${x.ent_id}`)}</a>`;
    const somme = (liste, cle) => liste.reduce((s, x) => s.plus(Dz(x[cle])), D(0)).toString();
    const total = (cle) => somme(g.commandes, cle);
    const prevu = total('prevu_ht');
    const { affichees: factures, comptees: facturesComptees } = facturesMarche(g.factures, this.voirAnnulees);
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
      <summary><h3>${titre}</h3><span class="groupe-gestion-boutons">${boutons.map((x) => `<button type="button" data-creer="${x.type}" title="${echapper(x.titre)}">${echapper(x.libelle)}</button>`).join('')}</span></summary>
      ${contenu}</details>`;
    const creation = this.creationPossible();
    const B = (type) => (creation ? [CREATIONS_MARCHE[type]] : []);

    corps.innerHTML = `<div class="gestion-marche">
      ${groupe('recapitulatif', texteHtml('fiches_btp.structure.gestion.recapitulatif'), [...B(TYPE_DOCUMENT.V_RECEPTION), ...(this.moduleActif(MODULE_FACULTATIF.EXECUTION) ? B(TYPE_DOCUMENT.E_OE) : [])], `
      <table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.commande')}</th><th>${texteHtml('fiches_btp.structure.colonnes.numero')}</th><th>${texteHtml('fiches_btp.structure.colonnes.objet')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.ht_net')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.ttc_net')}</th>
        <th class="nombre">${texteHtml('fiches_btp.structure.colonnes.travaux_ht')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.situe')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.avancement')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.facture_ht')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.reste_a_facturer')}</th></tr></thead>
      <tbody>${g.commandes.map((c) => `<tr><td>${c.role === 'BASE' ? texteHtml('fiches_btp.structure.gestion.marche') : texteHtml('fiches_btp.structure.gestion.ts', { rang: c.rang })}</td><td>${lien(c)}</td><td>${echapper(c.objet ?? '')}</td>
        <td class="nombre">${f(c.prevu_ht)}</td><td class="nombre">${f(c.prevu_ttc)}</td><td class="nombre">${f(c.travaux_ht)}</td><td class="nombre">${f(c.situe_ht)}</td>
        <td class="nombre">${pct(c.situe_ht, c.travaux_ht)}</td><td class="nombre">${f(c.facture_ht)}</td>
        <td class="nombre">${f(Dz(c.travaux_ht).minus(Dz(c.facture_ht)).toString())}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="3">${texteHtml('commun.total')}</th><th class="nombre">${f(prevu)}</th><th class="nombre">${f(total('prevu_ttc'))}</th><th class="nombre">${f(total('travaux_ht'))}</th>
        <th class="nombre">${f(total('situe_ht'))}</th><th class="nombre">${pct(total('situe_ht'), total('travaux_ht'))}</th>
        <th class="nombre">${f(g.facture_ht)}</th><th class="nombre">${f(Dz(g.montant_ht).minus(Dz(g.facture_ht)).toString())}</th></tr></tfoot></table>
      <p class="aide">${texteHtml('fiches_btp.structure.gestion.recapitulatif_aide')}</p>`)}

      ${groupe('situations', texteHtml('fiches_btp.structure.gestion.situations'), [...B(TYPE_DOCUMENT.V_SITUATION), ...B(TYPE_DOCUMENT.V_PRODUCTION)], g.situations.length ? `<table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.n_de_situation')}</th><th>${texteHtml('fiches_btp.structure.colonnes.document')}</th><th>${texteHtml('fiches_btp.structure.colonnes.indice')}</th><th>${texteHtml('fiches_btp.structure.colonnes.date')}</th><th>${texteHtml('fiches_btp.structure.colonnes.statut')}</th>
        <th class="nombre">${texteHtml('fiches_btp.structure.colonnes.cumul_ht')}</th><th class="nombre" title="${texteHtml('fiches_btp.structure.colonnes.avancement_marche_aide')}">${texteHtml('fiches_btp.structure.colonnes.avancement_du_marche')}</th><th></th></tr></thead><tbody>${g.situations.map((x) => `<tr><td>${x.rang ?? ''}</td><td>${lien(x)}</td>
        <td>${echapper(x.indice ?? '')}${x.indices > 1 ? ` <small>${texteHtml('fiches_btp.structure.gestion.indices', { nombre: x.indices })}</small>` : ''}</td><td>${echapper(x.date ?? '')}</td>
        <td>${echapper(x.statut ?? '')}${x.facturee ? ` · ${texteHtml('fiches_btp.structure.gestion.facturee')}` : ''}</td><td class="nombre">${f(x.total_ht)}</td><td class="nombre">${pct(x.total_ht, prevu)}</td>
        <td>${x.valide && !x.facturee ? `<button type="button" data-facturer="${x.ent_id}">${texteHtml('fiches_btp.structure.gestion.facturer')}</button> <button type="button" data-reviser="${x.ent_id}">${texteHtml('fiches_btp.structure.gestion.reviser')}</button>` : ''}</td></tr>`).join('')}
        </tbody></table>` : `<p class="aide">${texteHtml('fiches_btp.structure.gestion.aucune_situation')}</p>`)}

      ${groupe('factures', texteHtml('fiches_btp.structure.gestion.factures'), [...B(TYPE_DOCUMENT.V_FACTURE_AVT), ...B(TYPE_DOCUMENT.V_REPRISE_AVT)], `
      ${nbAnnulees ? `<label class="fiche-option"><input type="checkbox" data-annulees ${this.voirAnnulees ? 'checked' : ''}> ${texteHtml('fiches_btp.structure.gestion.voir_annulees', { nombre: nbAnnulees })}</label>` : ''}
      ${factures.length ? `<table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.n_de_situation')}</th><th>${texteHtml('fiches_btp.structure.colonnes.piece')}</th><th>${texteHtml('fiches_btp.structure.colonnes.type')}</th><th>${texteHtml('fiches_btp.structure.colonnes.date')}</th><th>${texteHtml('fiches_btp.structure.colonnes.statut')}</th>
        <th class="nombre">${texteHtml('fiches_btp.structure.colonnes.ht_net')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.ttc_net')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.net_a_payer')}</th>${reglements ? `<th class="nombre">${texteHtml('fiches_btp.structure.colonnes.regle')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.reste_a_payer')}</th>` : ''}<th></th></tr></thead><tbody>${factures.map((x) => `<tr class="${x.annule ? 'annulee' : ''}">
        <td>${x.rang ?? ''}</td><td>${lien(x)}</td><td>${echapper(x.type)}${x.nature === 'ANNULATION' ? ` ${texteHtml('fiches_btp.structure.gestion.nature_annulation')}` : x.nature === 'AVANCEMENT' ? ` ${texteHtml('fiches_btp.structure.gestion.nature_avancement')}` : ''}</td>
        <td>${echapper(x.date ?? '')}</td><td>${echapper(x.statut ?? '')}</td><td class="nombre">${f(x.total_ht)}</td><td class="nombre">${f(x.total_ttc)}</td>
        <td class="nombre">${f(x.net_a_payer)}</td>${regle(x)}<td>${peutAnnulerParAvoir(x) ? `<button type="button" data-annuler="${x.ent_id}">${texteHtml('fiches_btp.structure.gestion.annuler')}</button>` : ''}</td></tr>`).join('')}
        </tbody><tfoot><tr><th colspan="5">${texteHtml('commun.total')}${nbAnnulees && this.voirAnnulees ? ` ${texteHtml('fiches_btp.structure.gestion.hors_annulees')}` : ''}</th><th class="nombre">${f(somme(facturesComptees, 'total_ht'))}</th>
        <th class="nombre">${f(somme(facturesComptees, 'total_ttc'))}</th><th class="nombre">${f(somme(facturesComptees, 'net_a_payer'))}</th>
        ${reglements ? `<th class="nombre">${f(totalRegle('pointe'))}</th><th class="nombre">${f(totalRegle('reste'))}</th>` : ''}<th></th></tr></tfoot></table>`
        : `<p class="aide">${texteHtml('fiches_btp.structure.gestion.aucune_facture')}</p>`}`)}

      ${groupe('sous_traitants', texteHtml('fiches_btp.structure.gestion.sous_traitants'), creation ? [CREATIONS_MARCHE.A_FACTURE] : [], sousTraitants.length ? `<table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.piece')}</th><th>${texteHtml('fiches_btp.structure.colonnes.ref_sous_traitant')}</th>
        <th>${texteHtml('fiches_btp.structure.colonnes.sous_traitant')}</th><th>${texteHtml('fiches_btp.structure.colonnes.type')}</th><th>${texteHtml('fiches_btp.structure.colonnes.date')}</th><th>${texteHtml('fiches_btp.structure.colonnes.statut')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.ht_net')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.ttc_net')}</th><th>${texteHtml('fiches_btp.structure.colonnes.facture_liee')}</th></tr></thead>
        <tbody>${sousTraitants.map((x) => `<tr class="${x.annule ? 'annulee' : ''}"><td>${lien(x)}</td><td>${echapper(x.reference ?? '')}</td><td>${echapper(x.tiers ?? '')}</td>
        <td>${echapper(x.type)}</td><td>${echapper(x.date ?? '')}</td><td>${echapper(x.statut ?? '')}</td><td class="nombre">${f(x.total_ht)}</td>
        <td class="nombre">${f(x.total_ttc)}</td><td>${x.liee ? lien(x.liee) : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="6">${texteHtml('commun.total')}</th><th class="nombre">${f(somme(stComptees, 'total_ht'))}</th><th class="nombre">${f(somme(stComptees, 'total_ttc'))}</th><th></th></tr></tfoot></table>
        <p class="aide">${texteHtml('fiches_btp.structure.gestion.sous_traitants_aide')}</p>`
        : `<p class="aide">${texteHtml('fiches_btp.structure.gestion.aucun_sous_traitant')}</p>`)}

      ${this.valeur('sens') !== 'ST' && this.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE) ? groupe('sous_traitance', texteHtml('fiches_btp.structure.gestion.sous_traitance'), [], '<div data-engage></div>') : ''}
      ${groupe('acomptes', texteHtml('fiches_btp.structure.gestion.acomptes'), [], '<div data-acomptes></div>')}
      ${groupe('postes', texteHtml('fiches_btp.structure.gestion.postes'), [], '<div data-postes></div>')}
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
      this.message(texte('fiches_btp.structure.gestion.facture_creee'), 'succes');
      this.ouvrirUrl(urlDocument(r.document.ent_id), e);
    })));
    corps.querySelectorAll('[data-reviser]').forEach((b) => b.addEventListener('click', action(async (id, e) => {
      const r = await this.services.structure.reviser(id);
      this.message(texte('fiches_btp.structure.gestion.revision_creee', { indice: r.document.ent_indice }), 'succes');
      this.ouvrirUrl(urlDocument(r.document.ent_id), e);
    })));
    corps.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', action(async (id) => {
      const pieces = await this.services.structure.piecesAnnulation(id);
      const liste = pieces.map((x) => `• ${x.rang ? `${texte('fiches_btp.structure.numero_rang', { rang: x.rang })} · ` : ''}${x.type} ${x.numero ?? ''}`).join('\n');
      if (!(await confirmer(texte('fiches_btp.structure.gestion.confirmer_annulation', { liste }), { titre: texte('fiches_btp.structure.gestion.annulation'), danger: true }))) return;
      const r = await this.services.structure.annuler(id);
      this.message(`${pluriel('fiches_btp.structure.gestion.avoirs_crees', r.avoirs.length)}${r.situation ? ` ; ${texte('fiches_btp.structure.gestion.situation_remise')}` : ''}`, 'succes');
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
    const DEDUCTIONS = pairesParCode('fiches_btp.structure.acomptes.deductions', ['LINEAIRE', 'PREMIERE', 'DERNIERE']);
    const f = (v) => formatNombre(v ?? 0, 2);
    const lien = (x) => (x ? `<a href="${urlDocument(Number(x.ent_id))}">${echapper(x.numero ?? `#${x.ent_id}`)}</a> <small>${echapper(x.statut ?? '')}</small>` : '');
    zone.innerHTML = `<p class="aide">${texteHtml(ca ? 'fiches_btp.acomptes.mode_ca' : 'fiches_btp.acomptes.mode_tresorerie')}</p>
      ${acomptes.length ? `<table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.numero')}</th><th>${texteHtml('fiches_btp.structure.colonnes.libelle')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.montant')}</th><th>${texteHtml('fiches_btp.structure.colonnes.deduction')}</th>
        <th>${texteHtml('fiches_btp.structure.colonnes.demande')}</th><th>${texteHtml(ca ? 'fiches_btp.colonnes.facture' : 'fiches_btp.colonnes.recu')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.deduit')}</th><th class="nombre">${texteHtml('fiches_btp.structure.colonnes.reste_a_deduire')}</th><th></th></tr></thead>
        <tbody>${acomptes.map((a) => `<tr><td>${a.rang}</td><td>${echapper(a.libelle)}</td><td class="nombre">${f(a.montant)}</td>
          <td>${echapper(DEDUCTIONS.find(([c]) => c === a.deduction)?.[1] ?? a.deduction)}</td><td>${lien(a.demande)}</td><td>${lien(a.piece)}</td>
          <td class="nombre">${f(a.deduit)}</td><td class="nombre">${f(Dz(a.montant).minus(Dz(a.deduit)).toString())}</td>
          <td>${!a.piece || a.piece.annule ? `<button type="button" data-emettre="${a.id}" title="${texteHtml('fiches_btp.structure.acomptes.emettre_aide')}">${texteHtml(ca ? 'fiches_btp.acomptes.facturer' : 'fiches_btp.acomptes.recu')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('fiches_btp.structure.acomptes.aucun')}</p>`}
      <div class="formulaire acompte-nouveau">
        <label>${texteHtml('fiches_btp.structure.acomptes.acompte')} <input data-a="valeur" size="10" inputmode="decimal" placeholder="10"></label>
        <label>${texteHtml('fiches_btp.structure.acomptes.en')} <span data-a="saisie"></span></label>
        <label>${texteHtml('fiches_btp.structure.acomptes.deduction')} <span data-a="deduction"></span></label>
        <label class="large">${texteHtml('fiches_btp.structure.acomptes.libelle')} <input data-a="libelle" maxlength="150" placeholder="${texteHtml('fiches_btp.structure.acomptes.libelle_defaut', { rang: acomptes.length + 1 })}"></label>
        <button type="button" data-demander>${iconeHtml('ajouter')} ${texteHtml('fiches_btp.structure.acomptes.demander')}</button>
      </div>`;
    const saisie = creerCombo({ options: [{ valeur: 'P', libelle: texte('fiches_btp.structure.acomptes.pourcentage') }, { valeur: 'M', libelle: texte(ca ? 'fiches_btp.acomptes.montant_ht' : 'fiches_btp.acomptes.montant_ttc') }], valeur: 'P', vide: false });
    const deduction = creerCombo({ options: DEDUCTIONS.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: 'LINEAIRE', vide: false });
    zone.querySelector('[data-a="saisie"]').replaceWith(saisie);
    zone.querySelector('[data-a="deduction"]').replaceWith(deduction);
    zone.querySelector('[data-demander]').addEventListener('click', async (e) => {
      const valeur = lireNombre(zone.querySelector('[data-a="valeur"]').value);
      if (valeur === null || valeur === undefined || Dz(valeur).lte(0)) { this.message(texte('fiches_btp.structure.acomptes.valeur_positive'), 'avertissement'); return; }
      try {
        const r = await this.services.structure.demanderAcompte(Number(this.id), {
          libelle: zone.querySelector('[data-a="libelle"]').value.trim() || null, saisie: saisie.valeurCombo, valeur, deduction: deduction.valeurCombo,
        });
        this.message(texte('fiches_btp.structure.acomptes.demande_creee', { numero: r.document.ent_numero ?? '' }), 'succes');
        this.ouvrirUrl(urlDocument(r.document.ent_id), e);
        this.rendreGestion(corps);
      } catch (x) { this.message(x.message, 'erreur'); }
    });
    zone.querySelectorAll('[data-emettre]').forEach((b) => b.addEventListener('click', async (e) => {
      try {
        const r = await this.services.structure.emettreAcompte(Number(b.dataset.emettre));
        this.message(texte(ca ? 'fiches_btp.acomptes.facture_creee' : 'fiches_btp.acomptes.recu_cree'), 'succes');
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
    const TYPES = pairesParCode('fiches_btp.structure.postes.types', [TYPE_POSTE_MARCHE.PAIEMENT_DIRECT, TYPE_POSTE_MARCHE.PRORATA, TYPE_POSTE_MARCHE.REMISE, TYPE_POSTE_MARCHE.AUTRE]);
    const PORTEES = pairesParCode('fiches_btp.structure.postes.portees', ['G', 'C']);
    const MODES = pairesParCode('fiches_btp.structure.postes.modes', ['P', 'M']);
    const SENS = pairesParCode('fiches_btp.structure.postes.sens', [[-1, 'deduction'], [1, 'ajout']]);
    // Sous-traitants du paiement direct : tiers des intervenants du marché.
    const tiers = new Map();
    for (const x of this.valeur('intervenants') ?? []) if (x.per_id) tiers.set(Number(x.per_id), x.tiers ?? x.raison_sociale ?? `#${x.per_id}`);
    const rendre = () => {
      zone.innerHTML = `<p class="aide">${texteHtml('fiches_btp.structure.postes.aide', { pct: formatLibre(this.valeur('retenue_pct') ?? 0) })}</p>
        ${postes.length ? `<table class="tableau-gestion"><thead><tr><th>${texteHtml('fiches_btp.structure.colonnes.pieces')}</th><th>${texteHtml('fiches_btp.structure.colonnes.type')}</th><th>${texteHtml('fiches_btp.structure.colonnes.libelle')}</th><th>${texteHtml('fiches_btp.structure.colonnes.niveau')}</th><th>${texteHtml('fiches_btp.structure.colonnes.mode')}</th>
          <th class="nombre">${texteHtml('fiches_btp.structure.colonnes.valeur')}</th><th>${texteHtml('fiches_btp.structure.colonnes.sens')}</th><th>${texteHtml('fiches_btp.structure.colonnes.sous_traitant')}</th><th>${texteHtml('fiches_btp.structure.colonnes.actif')}</th><th></th></tr></thead><tbody>${postes.map((p, i) => `<tr data-i="${i}">
          <td data-combo="portee"></td><td data-combo="type"></td><td><input data-c="libelle" size="26" maxlength="150" value="${echapper(p.libelle)}"></td>
          <td data-combo="niveau"></td><td data-combo="mode"></td><td><input data-c="valeur" size="8" inputmode="decimal" value="${formatLibre(p.valeur)}"></td>
          <td data-combo="sens"></td><td data-combo="per_id"></td><td><input type="checkbox" data-c="actif" ${p.actif ? 'checked' : ''}></td>
          <td><button type="button" data-retirer title="${texteHtml('fiches_btp.structure.postes.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="aide">${texteHtml('fiches_btp.structure.postes.aucun')}</p>`}
        <div class="boutons"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('fiches_btp.structure.postes.ajouter')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('fiches_btp.structure.postes.enregistrer')}</button></div>`;
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
        combo('niveau', pairesParCode('fiches_btp.structure.postes.niveaux', p.portee === 'G' ? ['TTC'] : ['HT', 'TTC']));
        combo('mode', MODES);
        combo('sens', SENS);
        combo('per_id', [...tiers].map(([id, nom]) => [id, nom]), true);
      });
      zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { lire(); postes.splice(Number(b.closest('tr').dataset.i), 1); rendre(); }));
      zone.querySelector('[data-ajouter]').addEventListener('click', () => {
        lire();
        postes.push({ id: null, portee: 'G', type: 'PAIEMENT_DIRECT', libelle: texte('fiches_btp.structure.postes.types.PAIEMENT_DIRECT'), niveau: 'TTC', mode: 'M', valeur: 0, sens: -1, per_id: null, ordre: postes.length + 1, actif: true });
        rendre();
      });
      zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
        if (!lire()) return;
        try {
          postes = await this.services.structure.enregistrerPostes(Number(this.id), postes);
          this.message(texte('fiches_btp.structure.postes.enregistres'), 'succes');
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
        if (v === null || v === undefined) { this.message(texte('fiches_btp.structure.postes.valeur_invalide', { libelle: p.libelle || texte('fiches_btp.structure.postes.poste') }), 'avertissement'); return false; }
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
    this.message(texte('fiches_btp.structure.document_cree', { nom: c.nom, numero: r.document.ent_numero ?? '' }), 'succes');
    this.ouvrirUrl(urlDocument(r.document.ent_id), e);
  }

  /** Commandes du marché (db/170 : marche_document) : la commande de base puis les avenants, avec leur montant. */
  rendreInformations(v) {
    const commandes = (this.refs.marche_documents ?? []).filter((x) => x.mar_id === Number(this.id));
    if (!commandes.length) return super.rendreInformations(v);
    const ligne = (x) => `<a href="${urlDocument(Number(x.ent_id))}">${echapper(x.numero ?? texte('fiches_btp.structure.document', { id: x.ent_id }))}</a> ${echapper(x.objet ?? '')}`
      + ` <small>${texteHtml('fiches_btp.structure.montant_ht', { montant: formatNombre(x.total_ht ?? 0, 2) })}</small>`;
    const base = commandes.filter((x) => x.role === 'BASE');
    const avenants = commandes.filter((x) => x.role === 'AVENANT');
    return super.rendreInformations(v)
      + (base.length ? `<div class="fiche-info"><span>${texteHtml('fiches_btp.structure.commande')}</span> <b>${base.map(ligne).join(' · ')}</b></div>` : '')
      + (avenants.length ? `<div class="fiche-info"><span>${texteHtml('fiches_btp.structure.avenants')}</span> <b>${avenants.map((x) => `${texteHtml('fiches_btp.structure.numero_rang', { rang: x.rang })} : ${ligne(x)}`).join(' · ')}</b></div>` : '');
  }
}

/** Boutons de création des regroupements de l'onglet Gestion du marché. */
const CREATIONS_MARCHE = {
  V_RECEPTION: { type: TYPE_DOCUMENT.V_RECEPTION, get libelle() { return `${icone('fiches_btp_bl')} ${texte('fiches_btp.structure.creations.V_RECEPTION.libelle')}`; }, get nom() { return texte('fiches_btp.structure.creations.V_RECEPTION.nom'); }, get titre() { return texte('fiches_btp.structure.creations.V_RECEPTION.titre'); } },
  E_OE: { type: TYPE_DOCUMENT.E_OE, get libelle() { return `${icone('fiches_btp_ordre')} ${texte('fiches_btp.structure.creations.E_OE.libelle')}`; }, get nom() { return texte('fiches_btp.structure.creations.E_OE.nom'); }, get titre() { return texte('fiches_btp.structure.creations.E_OE.titre'); } },
  V_SITUATION: { type: TYPE_DOCUMENT.V_SITUATION, get libelle() { return `${icone('fiches_btp_situation')} ${texte('fiches_btp.structure.creations.V_SITUATION.libelle')}`; }, get nom() { return texte('fiches_btp.structure.creations.V_SITUATION.nom'); }, get titre() { return texte('fiches_btp.structure.creations.V_SITUATION.titre'); } },
  V_PRODUCTION: { type: TYPE_DOCUMENT.V_PRODUCTION, get libelle() { return `${icone('fiches_btp_production')} ${texte('fiches_btp.structure.creations.V_PRODUCTION.libelle')}`; }, get nom() { return texte('fiches_btp.structure.creations.V_PRODUCTION.nom'); }, get titre() { return texte('fiches_btp.structure.creations.V_PRODUCTION.titre'); } },
  V_FACTURE_AVT: { type: TYPE_DOCUMENT.V_FACTURE_AVT, get libelle() { return `${icone('fiches_btp_facture_avt')} ${texte('fiches_btp.structure.creations.V_FACTURE_AVT.libelle')}`; }, get nom() { return texte('fiches_btp.structure.creations.V_FACTURE_AVT.nom'); }, get titre() { return texte('fiches_btp.structure.creations.V_FACTURE_AVT.titre'); } },
  V_REPRISE_AVT: { type: TYPE_DOCUMENT.V_REPRISE_AVT, get libelle() { return `${icone('fiches_btp_reprise')} ${texte('fiches_btp.structure.creations.V_REPRISE_AVT.libelle')}`; }, get nom() { return texte('fiches_btp.structure.creations.V_REPRISE_AVT.nom'); }, get titre() { return texte('fiches_btp.structure.creations.V_REPRISE_AVT.titre'); } },
  A_FACTURE: { type: TYPE_DOCUMENT.A_FACTURE, get libelle() { return `${icone('ajouter')} ${texte('fiches_btp.structure.creations.A_FACTURE.libelle')}`; }, get nom() { return texte('fiches_btp.structure.creations.A_FACTURE.nom'); }, get titre() { return texte('fiches_btp.structure.creations.A_FACTURE.titre'); } },
};

export const CLASSES_STRUCTURE = { projet: FicheProjet, affaire: FicheAffaire, chantier: FicheChantier, marche: FicheMarche };
