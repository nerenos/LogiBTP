import { MODES } from '@logibtp/fiche';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { FicheLogiBTP } from './fiches.js';
import { TableIntervenants } from '../structure/intervenants.js';
import { controlerIntervenants } from '../structure/structure.js';
import { champRattachement } from '../structure/selection.js';
import { VueGrapheStructure } from '../structure/graphe-structure.js';

// Fiches de la structure des affaires : projet, affaire, chantier, marché. Listes de choix des références (affaire,
// projet, chantier, commande d'origine, tiers de l'annuaire), code proposé (PRJ-2026-001…), préremplissage depuis un
// projet (?projet=) ou un chantier (?chantier=, ?commande=), liens vers les éléments rattachés. Un projet passé
// « Obtenu » propose d'ouvrir son chantier.

const PREFIXES = { projet: 'PRJ', affaire: 'AFF', chantier: 'CH', marche: 'M' };
const LISTES = { projet: 'projets', affaire: 'affaires', chantier: 'chantiers', marche: 'marches' };
const LIBELLES_STATUT = {
  EN_COURS: 'En cours', REMIS: 'Offre remise', OBTENU: 'Obtenu', PERDU: 'Perdu', ABANDONNE: 'Abandonné', OUVERTE: 'Ouverte', CLOSE: 'Close',
  OUVERT: 'Ouvert', TERMINE: 'Terminé', CLOS: 'Clos', SOLDE: 'Soldé', RESILIE: 'Résilié',
};
const parametre = (nom) => Number(new URLSearchParams(globalThis.location?.search ?? '').get(nom)) || null;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Raccourcis des fiches vers les listes (thème, libellé), filtrées par le code de la fiche (?projet=CODE…). */
const RACCOURCIS = {
  projet: [['documents', 'Documents'], ['devis', 'Devis'], ['chantiers', 'Chantiers']],
  affaire: [['documents', 'Documents'], ['chantiers', 'Chantiers'], ['marches', 'Marchés'], ['factures', 'Factures']],
  chantier: [['documents', 'Documents'], ['devis', 'Devis'], ['commandes', 'Commandes'], ['situations', 'Situations'], ['factures', 'Factures'],
    ['marches', 'Marchés'], ['achats_commandes', 'Commandes fournisseurs'], ['achats_factures', 'Factures fournisseurs']],
  marche: [['documents', 'Documents'], ['situations', 'Situations'], ['factures', 'Factures']],
};

/** Prochain code de l'année : PRJ-2026-006 (le plus grand numéro existant + 1). */
export function prochainCode(type, existants, annee = new Date().getFullYear()) {
  const prefixe = `${PREFIXES[type]}-${annee}-`;
  const max = Math.max(0, ...existants.filter((c) => c?.startsWith(prefixe)).map((c) => Number(c.slice(prefixe.length)) || 0));
  return `${prefixe}${String(max + 1).padStart(3, '0')}`;
}

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

  /** Copie : code suivant proposé (le code n'est pas copié). */
  async copier() {
    await super.copier();
    this.definirValeur('code', prochainCode(this.type, (this.refs[LISTES[this.type]] ?? []).map((x) => x.code)));
    this.rendre();
  }

  /** Recharge les référentiels (après une création liée). */
  async rechargerReferentiels() { this.refs = await this.services.structure.referentiels(); }

  valeursCreation() {
    const v = { ...super.valeursCreation(), code: prochainCode(this.type, (this.refs[LISTES[this.type]] ?? []).map((x) => x.code)) };
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
    if (champ.reference === 'commande') {
      const span = document.createElement('span');
      span.className = 'fiche-valeur';
      const c = (this.refs.commandes ?? []).find((x) => x.id === Number(valeur));
      span.innerHTML = valeur ? `<a href="/document/${Number(valeur)}">${echapper(c ? `${c.numero ?? ''} ${c.objet ?? ''}` : `Document ${valeur}`)}</a>` : '—';
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

  /** Tiers de l'annuaire : recherche par code ou raison sociale (liste proposée), l'ID est enregistré. */
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
      span.innerHTML = valeur ? `<a href="/fiche/personne/${Number(valeur)}">${echapper(nom || `Tiers ${valeur}`)}</a>` : '—';
      return span;
    }
    const id = `tiers-${champ.code}-${Math.random().toString(36).slice(2, 8)}`;
    span.innerHTML = `<input type="search" class="fiche-saisie-champ" list="${id}" value="${echapper(nom ?? (valeur ? `Tiers ${valeur}` : ''))}" placeholder="Rechercher un tiers (code, raison sociale)"><datalist id="${id}"></datalist>`;
    const input = span.querySelector('input');
    const liste = span.querySelector('datalist');
    let resultats = [];
    let minuterie = null;
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
    return span;
  }

  /** Liens vers les éléments rattachés et raccourcis vers les listes filtrées par le code de la fiche (en tête de fiche). */
  rendreInformations(v) {
    const liens = this.liens(v).filter((l) => l.elements.length);
    const raccourcis = this.id !== null && v.code ? RACCOURCIS[this.type] ?? [] : [];
    return liens.map((l) => `<div class="fiche-info"><span>${echapper(l.titre)}</span>
      <b>${l.elements.map((x) => `<a href="/fiche/${l.type}/${x.id}">${echapper(x.code)}</a> ${echapper(x.libelle ?? '')}${x.extra ? ` <small>${echapper(x.extra)}</small>` : ''}`).join(' · ')}</b></div>`).join('')
      + (raccourcis.length ? `<div class="fiche-info fiche-raccourcis"><span>Listes</span><b>${raccourcis.map(([theme, libelle]) =>
        `<a href="/liste/${theme}?${new URLSearchParams({ [this.type]: v.code })}" title="${echapper(`${libelle} filtrés sur ${v.code} (Ctrl : nouvelle fenêtre)`)}">${echapper(libelle)}</a>`).join(' · ')}</b></div>` : '');
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
    }];
  }
}

export class FicheProjet extends FicheStructure {
  liens() {
    return [{ titre: 'Chantier', type: 'chantier', elements: (this.refs.chantiers ?? []).filter((c) => c.prj_id === Number(this.id)) }];
  }

  /** Passage à « Obtenu » : proposer d'ouvrir le chantier (fiche de création préremplie depuis le projet). */
  async enregistrer() {
    const avant = this.fiche?.valeurs?.statut ?? null;
    const ok = await super.enregistrer();
    if (!ok) return ok;
    await this.rechargerReferentiels();
    const obtenu = this.valeur('statut') === 'OBTENU' && avant !== 'OBTENU';
    if (obtenu && !(this.refs.chantiers ?? []).some((c) => c.prj_id === Number(this.id))
      && globalThis.confirm?.(`Projet obtenu : ouvrir le chantier de « ${this.valeur('libelle')} » ?`)) {
      this.ouvrirUrl(`/fiche/chantier/nouveau?projet=${this.id}`);
    }
    this.rendre();
    return ok;
  }
}

export class FicheAffaire extends FicheStructure {
  liens() {
    return [{ titre: 'Chantiers', type: 'chantier', elements: (this.refs.chantiers ?? []).filter((c) => c.aff_id === Number(this.id)) }];
  }
}

export class FicheChantier extends FicheStructure {
  sourceIntervenants() { return parametre('projet') ? ['projet', parametre('projet')] : null; }

  /** Création depuis un projet obtenu (?projet=) : libellé, client et ville du projet. */
  valeursCreation() {
    const v = super.valeursCreation();
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

  liens(v) {
    const marches = (this.refs.marches ?? []).filter((m) => m.cha_id === Number(this.id))
      .map((m) => ({ ...m, extra: m.montant_ht !== null ? `${formatNombre(m.montant_ht, 2)} € HT` : '' }));
    return [
      { titre: 'Affaire', type: 'affaire', elements: (this.refs.affaires ?? []).filter((a) => a.id === Number(v.aff_id)) },
      { titre: 'Projet', type: 'projet', elements: (this.refs.projets ?? []).filter((p) => p.id === Number(v.prj_id)) },
      { titre: 'Marchés', type: 'marche', elements: marches },
    ];
  }
}

export class FicheMarche extends FicheStructure {
  sourceIntervenants() { return parametre('chantier') ? ['chantier', parametre('chantier')] : null; }

  /** Code du marché : M-<année>-<n° du chantier>-<rang> ; création depuis un chantier (?chantier=) ou une commande (?commande=). */
  valeursCreation() {
    const v = super.valeursCreation();
    const cha = (this.refs.chantiers ?? []).find((c) => c.id === parametre('chantier'));
    if (cha) Object.assign(v, { cha_id: cha.id, tiers_id: cha.tiers_id, code: codeMarche(cha, this.refs.marches ?? []) });
    const cde = (this.refs.commandes ?? []).find((c) => c.id === parametre('commande'));
    if (cde) Object.assign(v, { ent_id: cde.id, libelle: cde.objet, tiers_id: v.tiers_id ?? cde.tiers_id });
    return v;
  }

  choisirReference(code, id) {
    super.choisirReference(code, id);
    if (code !== 'cha_id' || !id || this.mode !== MODES.CREATION) return;
    const cha = (this.refs.chantiers ?? []).find((c) => c.id === id);
    if (cha) {
      this.definirValeur('code', codeMarche(cha, this.refs.marches ?? []));
      if (!this.valeur('tiers_id')) this.definirValeur('tiers_id', cha.tiers_id);
    }
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
    return [{ titre: 'Chantier', type: 'chantier', elements: (this.refs.chantiers ?? []).filter((c) => c.id === Number(v.cha_id)) }];
  }

  /** Documents créés depuis le marché (toutes ses commandes validées, une section et un pied par commande). */
  actionsSupplementaires() {
    const commandes = (this.refs.marche_documents ?? []).some((x) => x.mar_id === Number(this.id));
    const nouveau = (type, libelle) => async (e) => {
      const r = await this.services.structure.documentMarche(Number(this.id), type);
      this.message(`${libelle} ${r.document.ent_numero ?? ''} créé`, 'succes');
      this.ouvrirUrl(`/document/${r.document.ent_id}`, e);
    };
    return [{
      libelle: '🚚 Nouveau BL', titre: 'Bon de livraison des commandes du marché (reste à livrer de chaque commande)',
      action: nouveau('V_RECEPTION', 'Bon de livraison'), visible: this.id !== null && commandes && !this.estEnSaisie() && Boolean(this.services.structure.documentMarche),
    }];
  }

  /** Commandes du marché (db/170 : marche_document) : la commande de base puis les avenants, avec leur montant. */
  rendreInformations(v) {
    const commandes = (this.refs.marche_documents ?? []).filter((x) => x.mar_id === Number(this.id));
    if (!commandes.length) return super.rendreInformations(v);
    const ligne = (x) => `<a href="/document/${Number(x.ent_id)}">${echapper(x.numero ?? `Document ${x.ent_id}`)}</a> ${echapper(x.objet ?? '')}`
      + ` <small>${formatNombre(x.total_ht ?? 0, 2)} € HT</small>`;
    const base = commandes.filter((x) => x.role === 'BASE');
    const avenants = commandes.filter((x) => x.role === 'AVENANT');
    return super.rendreInformations(v)
      + (base.length ? `<div class="fiche-info"><span>Commande</span> <b>${base.map(ligne).join(' · ')}</b></div>` : '')
      + (avenants.length ? `<div class="fiche-info"><span>Avenants</span> <b>${avenants.map((x) => `n° ${x.rang} : ${ligne(x)}`).join(' · ')}</b></div>` : '');
  }
}

/** Code d'un marché du chantier : M-2026-002-1, M-2026-002-2… (d'après le code du chantier CH-2026-002). */
export function codeMarche(chantier, marches) {
  const base = `M-${String(chantier.code ?? chantier.id).replace(/^CH-/, '')}-`;
  const rang = Math.max(0, ...marches.filter((m) => m.code?.startsWith(base)).map((m) => Number(m.code.slice(base.length)) || 0)) + 1;
  return `${base}${rang}`;
}

export const CLASSES_STRUCTURE = { projet: FicheProjet, affaire: FicheAffaire, chantier: FicheChantier, marche: FicheMarche };
