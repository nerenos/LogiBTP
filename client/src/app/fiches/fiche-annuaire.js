import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE, MODULE_FACULTATIF, AVERTISSEMENT_ANNUAIRE_FE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { MODES } from '@logibtp/fiche';
import { echapper, formatNombre, confirmer } from '@logibtp/socle/ui';
import { coordonneesParDefaut, erreursIdentifiants, compacter, principale, texteCoordonnee, formaterTelephone, siretValide } from '@logibtp/annuaire';
import { EditeurCoordonnees, EditeurRattachements, EditeurLiens, VueGrapheAnnuaire, choixRequis, demanderChoix, choisirPersonne, pastilles, fusionnerTiers } from '@logibtp/annuaire/ui';
import { rechercherEntreprise } from '@logibtp/entreprises-fr/ui';
import { FicheLogiBTP } from './fiches.js';
import { rendrePieces } from '../sous-traitance/pieces.js';
import { rendrePhoto, urlImage, vignette } from '../annuaire/photo.js';
import { choixMultiple } from '../choix-multiple.js';
import { api } from '../api.js';
import { pastilleRelancesTiers } from '../relances/journal-relances.js';
import { rendreTarifsFournisseur } from '../annuaire/tarifs-fournisseur.js';

// Fiches de l'annuaire (module Fiche + module Annuaire) : personne (niveau, hiérarchie, casquettes qui déverrouillent
// leurs groupes de champs, identifiants pour la facturation électronique, reprise depuis l'annuaire des entreprises
// françaises) et individu (rôles dans notre société, compte particulier). Coordonnées, contacts et liens sont des
// champs gérés : à l'enregistrement, chaque coordonnée partagée modifiée demande « modification » ou « autre information ».

const info = (libelle, valeur, alerte = false) => `<span class="info ${alerte ? 'alerte' : ''}"><small>${libelle}</small>${valeur}</span>`;
const ordre = (codes) => (a, b) => {
  const i = (s) => { const k = codes.indexOf(s.code); return k < 0 ? codes.length : k; };
  return i(a) - i(b);
};

/** Activités (liste ACTIVITE, db/227), lues une fois : options « regroupement › activité ». */
const ActivitesCache = {
  promesse: null,
  lire() {
    this.promesse ??= api.listesValeurs.lire('ACTIVITE').then((l) => {
      const parCode = new Map(l.map((v) => [v.code, v]));
      return l.filter((v) => v.actif).map((v) => ({ valeur: v.code, libelle: v.parent ? `${parCode.get(v.parent)?.libelle ?? v.parent} › ${v.libelle}` : v.libelle }));
    }).catch(() => []);
    return this.promesse;
  },
};

/** Base des fiches de l'annuaire : référentiels, choix des coordonnées partagées à l'enregistrement, navigation. */
class FicheAnnuaire extends FicheLogiBTP {
  constructor(options) {
    super(options);
    this.services = options.services;
    this.ouvrirFiche = options.ouvrirFiche ?? (() => {});
    this.ouvrirUrl = options.ouvrirUrl ?? (() => {});
    this.utilisateur = options.utilisateur ?? 'demo';
  }

  get annuaire() { return this.services.annuaire; }

  async ouvrir() {
    this.referentiels = await this.annuaire.referentiels();
    return super.ouvrir();
  }

  /** Photo (individu) ou logo (personne) : image de la GED choisie (champ image_ged), en vignette de l'encart. */
  apresChargement() {
    super.apresChargement?.();
    this.#chargerImage();
  }

  async #chargerImage() {
    this.urlImage = await urlImage(this.services.ged, this.valeur('image_ged'));
    this.#majInformations();
  }

  /** Onglet Photo / Logo (image de la GED de la fiche). */
  ongletPhoto(type, titre) {
    return {
      code: 'photo', titre, champs: ['image_ged'],
      rendre: (corps, { modifiable }) => rendrePhoto(corps, {
        ged: this.services.ged, typeElement: type, id: this.id, valeur: () => this.valeur('image_ged'), titre,
        definir: (id) => { this.definirValeur('image_ged', id); this.#chargerImage(); },
        modifiable, utilisateur: this.utilisateur, message: this.message,
      }).catch((e) => this.message(e.message, 'erreur')),
    };
  }

  /** Paramètre de l'adresse de la page (création depuis une liste ou un menu : ?casquette=CLIENT, ?niveau=…). */
  parametre(nom) { return new URLSearchParams(globalThis.location?.search ?? '').get(nom); }

  /** Listes d'usages à contrôler avant l'enregistrement : coordonnées de la fiche et de chaque rattachement. */
  listesCoordonnees() {
    return [
      { usages: this.valeur('coordonnees'), contexte: null, appliquer: (u) => this.definirValeur('coordonnees', u) },
      ...this.modificationsRattachements().map((r, i) => ({
        usages: r.coordonnees, contexte: r.individu ?? r.personne,
        appliquer: (u) => this.definirValeur('rattachements', this.modificationsRattachements().map((x, j) => (j === i ? { ...x, coordonnees: u } : x))),
      })),
    ];
  }

  /**
   * Rattachements saisis : seulement les modifiés, ajoutés ou retirés (les autres, lus par page, restent inchangés).
   * Les rattachements lus avec la fiche (première page) sont dans fiche.valeurs.rattachements.
   */
  modificationsRattachements() { return 'rattachements' in this.saisie.valeurs ? this.saisie.valeurs.rattachements ?? [] : []; }

  /** Rattachements de la première page (lus avec la fiche). */
  get rattachementsLus() { return this.fiche?.valeurs?.rattachements ?? []; }

  /** Onglet des rattachements : contacts d'une personne ou personnes d'un individu, par page. */
  ongletRattachements(type, code, titre) {
    return {
      code, titre, champs: ['rattachements'],
      rendre: (corps, { modifiable }) => new EditeurRattachements(corps, {
        cote: type, premierePage: this.rattachementsLus, total: this.fiche?.valeurs?.nb_rattachements ?? this.rattachementsLus.length,
        charger: this.id === null ? null : (o) => this.annuaire.pageRattachements(type, this.id, o),
        modifications: () => this.modificationsRattachements(), definir: (r) => this.definirValeur('rattachements', r), modifiable,
        annuaire: this.annuaire, niveaux: this.referentiels.niveaux, historique: (id) => this.annuaire.historiqueCoordonnee(id),
        ouvrirFiche: (f, e) => this.ouvrirLiee(f, e), message: this.message,
      }),
    };
  }

  /** Avant l'enregistrement : choix pour chaque coordonnée partagée modifiée (modification ou autre information). */
  async enregistrer() {
    if (!this.estEnSaisie()) return false;
    const listes = this.listesCoordonnees();
    const requis = choixRequis(listes);
    if (requis.length) {
      const choix = await demanderChoix(requis.map(({ u, contexte }) => ({ u, contexte })));
      if (!choix) { this.message(texte('fiches_btp.annuaire.enregistrement_annule'), 'avertissement'); return false; }
      requis.forEach((r, k) => {
        const l = listes[r.liste];
        l.usages = l.usages.map((u, j) => (j === r.index ? { ...u, choix: choix[k] } : u));
      });
      for (const l of new Set(requis.map((r) => r.liste))) listes[l].appliquer(listes[l].usages);
    }
    return super.enregistrer();
  }

  /** Ouverture d'une fiche liée (Ctrl / Maj : nouvelle fenêtre) ; un rattachement ouvre l'individu. */
  ouvrirLiee(f, evenement) {
    const cible = f.type === 'rattachement' ? { type: TYPE_FICHE.INDIVIDU, id: f.individu_id } : f;
    if (cible.id) this.ouvrirFiche(cible, evenement);
  }

  /** Onglet Graphe : relations autour de la fiche (recentrage sur place, plein écran dans sa page). */
  ongletGraphe(type) {
    return {
      code: 'graphe', titre: texte('fiches_btp.annuaire.onglets.graphe'),
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.annuaire.graphe_nouvelle')}</p>`; return; }
        corps.classList.add('graphe-hote');
        this.vueGraphe = new VueGrapheAnnuaire(corps, {
          annuaire: this.annuaire, depart: { type, id: Number(this.id) }, referentiels: this.referentiels, message: this.message,
          ouvrirFiche: (f, e) => this.ouvrirFiche(f, e),
          pleinEcran: (d, r, e) => this.ouvrirUrl(`/annuaire/graphe?${new URLSearchParams({ type: d.type, id: String(d.id), profondeur: String(r.profondeur),
            contacts: r.contacts ? '1' : '0', liens: r.liens ? '1' : '0', max: String(r.max_contacts) })}`, e),
        });
      },
    };
  }

  ongletCoordonnees(type) {
    return {
      code: 'coordonnees', titre: texte('fiches_btp.annuaire.onglets.coordonnees'), champs: ['coordonnees'],
      rendre: (corps, { modifiable }) => new EditeurCoordonnees(corps, {
        valeur: () => this.valeur('coordonnees') ?? [], definir: (u) => this.definirValeur('coordonnees', u), modifiable, nom: 'fiche',
        proposer: this.id === null ? null : () => this.annuaire.coordonneesProposees(type, this.id),
        historique: (id) => this.annuaire.historiqueCoordonnee(id), effacerNonRemise: (id) => this.annuaire.effacerNonRemise(id),
        ouvrirFiche: (f, e) => this.ouvrirLiee(f, e), message: this.message,
      }),
    };
  }

  #majInformations() {
    const zone = this.conteneur.querySelector('.fiche-informations');
    const html = this.rendreInformations(this.valeurs());
    zone.hidden = !html;
    zone.innerHTML = html;
  }

  definirValeur(code, valeur) {
    super.definirValeur(code, valeur);
    if (code === 'coordonnees' || code === 'rattachements') this.#majInformations();
  }
}

export class FichePersonne extends FicheAnnuaire {
  #niveau(v = this.valeurs()) { return this.referentiels.niveaux.find((n) => n.code === v.niveau) ?? null; }
  #casquettes(v = this.valeurs()) { return this.referentiels.casquettes.filter((c) => (v.casquettes ?? []).includes(c.code)); }
  get morale() { return this.#niveau()?.morale !== false; }

  /** Statut provisoire (résumé de l'annuaire, hors définition de la fiche). */
  async ouvrir() {
    this.provisoire = this.id !== null && (await this.annuaire.personne(this.id).catch(() => null))?.provisoire === true;
    // Pastille « relancé N » (module Relances actif, droit de lecture) : relances faites au tiers ces derniers jours.
    this.pastilleRelances = this.id !== null && this.moduleActif(MODULE_FACULTATIF.RELANCE) && this.acces('relances') ? await pastilleRelancesTiers(this.id, aujourdhui()) : '';
    return super.ouvrir();
  }

  /** Libellés des colonnes de la table personne (et « +code » des champs supplémentaires) : choix d'une fusion. */
  libellesFusion() {
    const l = {};
    // La définition servie par l'API ne donne pas toujours la colonne : per_ + code (le niveau : per_niv_code).
    for (const c of this.definition.champs ?? []) if (!c.gere) l[c.colonne ?? (c.code === 'niveau' ? 'per_niv_code' : `per_${c.code}`)] = c.libelle;
    for (const c of this.definition.supplementaires ?? []) l[`+${c.code}`] = c.libelle;
    return l;
  }

  async validerProvisoire() {
    await this.annuaire.validerProvisoire(this.id);
    this.provisoire = false;
    this.message(texte('fiches_btp.annuaire.tiers_valide'), 'succes');
    this.rendre();
  }

  async fusionnerProvisoire(e) {
    const r = await fusionnerTiers({ annuaire: this.annuaire, id: Number(this.id), libelles: this.libellesFusion() });
    if (!r) return;
    const n = Object.values(r.reports ?? {}).reduce((s, x) => s + x, 0);
    this.message(n ? pluriel('fiches_btp.annuaire.tiers_fusionne_reports', n) : texte('fiches_btp.annuaire.tiers_fusionne'), 'succes');
    this.ouvrirFiche({ type: TYPE_FICHE.PERSONNE, id: r.cible_id }, e);
  }

  valeursCreation() {
    const niveau = this.parametre('niveau') ?? 'SOCIETE';
    const casquette = this.parametre('casquette');
    const parent = Number(this.parametre('parent')) || null;
    return {
      ...super.valeursCreation(), niveau, casquettes: casquette ? [casquette] : [], parent_id: parent, societe_base: this.parametre('societe') === '1', coordonnees: coordonneesParDefaut({ telephone: niveau === 'PARTICULIER' ? 'PORTABLE' : 'STANDARD', email: niveau === 'PARTICULIER' ? 'PERSO' : 'PRO' }),
      rattachements: [], liens: [], enfants: [],
    };
  }

  sousTitre(v) {
    const n = this.#niveau(v);
    return [n && `${n.icone ?? ''} ${n.libelle}`, v.code, this.#casquettes(v).map((c) => c.libelle).join(', ')].filter(Boolean).join(' · ');
  }

  rendreInformations(v) {
    if (!this.referentiels) return '';
    const coords = v.coordonnees ?? [];
    const parts = [vignette(this.urlImage)];
    if (v.societe_base) parts.push(info(texteHtml('fiches_btp.infos.annuaire'), `${iconeHtml('fiches_btp_societe_base')} ${texteHtml('fiches_btp.annuaire.societe_base')}`));
    if (this.provisoire) parts.push(info(texteHtml('fiches_btp.infos.annuaire'), `${iconeHtml('fiches_btp_provisoire')} ${texteHtml('fiches_btp.annuaire.provisoire')}`, true));
    if (this.pastilleRelances) parts.push(info(texteHtml('fiches_btp.infos.relances'), this.pastilleRelances));
    const tel = principale(coords, 'TELEPHONE');
    const mail = principale(coords, 'EMAIL');
    const adresse = principale(coords, 'ADRESSE');
    if (adresse) parts.push(info(texteHtml('fiches_btp.infos.adresse'), echapper(adresse)));
    if (tel) parts.push(info(texteHtml('fiches_btp.infos.telephone'), `<a href="tel:${echapper(tel.replace(/[^0-9+]/g, ''))}">${echapper(formaterTelephone(tel))}</a>`));
    if (mail) parts.push(info(texteHtml('fiches_btp.infos.email'), `<a href="mailto:${echapper(mail)}">${echapper(mail)}</a>`));
    const contact = this.rattachementsLus.find((r) => r.principal && r.actif !== false) ?? this.rattachementsLus.find((r) => r.actif !== false);
    if (contact && this.morale) parts.push(info(texteHtml('fiches_btp.infos.contact'), echapper([contact.individu, contact.fonction].filter(Boolean).join(' – '))));
    if (v.etat_administratif === 'F') parts.push(info(texteHtml('fiches_btp.infos.etat'), texteHtml('fiches_btp.annuaire.ferme'), true));
    if (v.siret && !siretValide(compacter(v.siret))) parts.push(info(texteHtml('fiches_btp.infos.siret'), texteHtml('fiches_btp.annuaire.invalide'), true));
    if (v.st_decennale_fin && (v.casquettes ?? []).includes('SOUS_TRAITANT') && String(v.st_decennale_fin) < aujourdhui()) parts.push(info(texteHtml('fiches_btp.infos.decennale'), texteHtml('fiches_btp.annuaire.expiree'), true));
    return parts.join('');
  }

  /** Groupes visibles : entreprise et facturation électronique pour une personne morale ; relations de la personne (casquettes). */
  sections() {
    const morale = this.morale;
    const deverrouilles = new Set(this.#casquettes().flatMap((c) => c.groupes ?? []));
    return super.sections()
      .map((s) => {
        if (!s.groupes) return s;
        const groupes = s.groupes.filter((g) => {
          if (g.supplementaire) return true;
          if (g.code === 'entreprise' || g.code === 'facturation_electronique') return morale;
          if (s.code === 'casquettes') return deverrouilles.has(g.code);
          return true;
        });
        return { ...s, groupes, champs: groupes.filter((g) => !g.supplementaire).flatMap((g) => g.champs) };
      })
      .filter((s) => s.code !== 'casquettes' || s.groupes.some((g) => !g.supplementaire))
      .sort(ordre(['identite', '+coordonnees', '+contacts', 'facturation', 'casquettes', '+liens', '+graphe', '+tarifs', '+supplementaires', '+pieces']));
  }

  validerMetier(v) {
    const erreurs = erreursIdentifiants(v).map(({ champ, message }) => ({ champ, message }));
    if (v.parent_id && this.id !== null && Number(v.parent_id) === Number(this.id)) erreurs.push({ champ: 'parent_id', message: texte('fiches_btp.annuaire.erreurs.propre_parent') });
    return erreurs;
  }

  actionsSupplementaires() {
    return [
      { libelle: `${icone('fiches_btp_entreprises')} ${texte('fiches_btp.annuaire.entreprises')}`, titre: texte('fiches_btp.annuaire.entreprises_aide'), action: () => this.importerEntreprise(), visible: this.estEnSaisie() && this.morale },
      { libelle: `${icone('fiches_btp_annuaire_fe')} ${texte('fiches_btp.annuaire.verifier_fe')}`, titre: texte('fiches_btp.annuaire.verifier_fe_aide'),
        action: () => this.verifierAnnuaireFe().catch((x) => this.message(x.message, 'erreur')),
        visible: !this.estEnSaisie() && this.id !== null && this.morale && this.moduleActif(MODULE_FACULTATIF.FACTURE_ELECTRONIQUE) && this.acces('facture_electronique') },
      { libelle: `${icone('fiches_btp_valider')} ${texte('fiches_btp.annuaire.valider')}`, titre: texte('fiches_btp.annuaire.valider_aide'), action: () => this.validerProvisoire().catch((x) => this.message(x.message, 'erreur')), visible: !this.estEnSaisie() && this.provisoire },
      { libelle: `${icone('fiches_btp_fusionner')} ${texte('fiches_btp.annuaire.fusionner')}`, titre: texte('fiches_btp.annuaire.fusionner_aide'), action: (e) => this.fusionnerProvisoire(e).catch((x) => this.message(x.message, 'erreur')), visible: !this.estEnSaisie() && this.provisoire },
      { libelle: `${icone('ajouter')} ${texte('fiches_btp.annuaire.etablissement')}`, titre: texte('fiches_btp.annuaire.etablissement_aide'), action: () => this.ouvrirFiche({ type: TYPE_FICHE.PERSONNE, id: `nouveau?parent=${this.id}&niveau=ETABLISSEMENT` }), visible: !this.estEnSaisie() && this.id !== null && this.morale },
      { libelle: `${icone('relance_suspendre')} ${texte('fiches_btp.annuaire.suspendre_relances')}`, titre: texte('fiches_btp.annuaire.suspendre_relances_aide'),
        action: (e) => this.ouvrirUrl(`/relances?suspendre=${Number(this.id)}`, e),
        visible: !this.estEnSaisie() && this.id !== null && this.moduleActif(MODULE_FACULTATIF.RELANCE) && this.acces('relances') },
      ...super.actionsSupplementaires(),
    ];
  }

  /**
   * Activités de la personne (plusieurs, liste ACTIVITE à deux niveaux des référentiels communs) : étiquettes et combo
   * d'ajout « regroupement › activité » ; en consultation, étiquettes seules.
   */
  #champActivites(valeur, lecture) {
    const zone = document.createElement('div');
    zone.className = 'fiche-saisie-champ';
    const codes = Array.isArray(valeur) ? valeur : [];
    ActivitesCache.lire().then((options) => {
      if (lecture) {
        zone.innerHTML = codes.map((c) => `<span class="etiquette-choix">${echapper(options.find((o) => o.valeur === c)?.libelle ?? c)}</span>`).join(' ')
          || `<span class="aide">${texteHtml('fiches_btp.annuaire.aucune_activite')}</span>`;
        return;
      }
      zone.replaceChildren(choixMultiple({ options, valeurs: codes, titre: texte('fiches_btp.annuaire.ajouter_activite'), aucun: texte('fiches_btp.annuaire.aucune_activite'), changer: (v) => this.definirValeur('activites', v) }));
    });
    return zone;
  }

  rendreChamp(champ, valeur) {
    const lecture = !this.estEnSaisie();
    if (champ.code === 'activites') return this.#champActivites(valeur, lecture);
    if (champ.code === 'casquettes') {
      return pastilles({ options: this.referentiels.casquettes, valeur, modifiable: !lecture, surChange: (codes) => { this.definirValeur('casquettes', codes); this.#rendreGarde(); } });
    }
    if (champ.code === 'niveau') {
      const el = document.createElement('select');
      el.className = 'fiche-saisie-champ';
      el.innerHTML = this.referentiels.niveaux.filter((n) => n.actif !== false || n.code === valeur).map((n) => `<option value="${n.code}" ${n.code === valeur ? 'selected' : ''}>${echapper(`${n.icone ?? ''} ${n.libelle}`)}</option>`).join('');
      el.disabled = lecture;
      el.addEventListener('change', () => { this.definirValeur('niveau', el.value); this.#rendreGarde(); });
      return el;
    }
    if (champ.code === 'parent_id') return this.#champParent(valeur, lecture);
    const el = super.rendreChamp(champ, valeur);
    // SIRET saisi : doublon signalé (le SIRET est unique dans l'annuaire).
    if (champ.code === 'siret' && !lecture) {
      el.addEventListener('change', async () => {
        const s = compacter(el.value);
        if (!siretValide(s)) return;
        const doublon = await this.annuaire.parSiret(s).catch(() => null);
        if (doublon && Number(doublon.id) !== Number(this.id)) this.message(texte('fiches_btp.annuaire.siret_doublon', { nom: doublon.raison_sociale, code: doublon.code }), 'avertissement');
      });
    }
    return el;
  }

  /** Rendu en conservant l'onglet courant (niveau ou casquettes changés : groupes affichés). */
  #rendreGarde() { this.rendre(); }

  #champParent(valeur, lecture) {
    const el = document.createElement('div');
    el.className = 'fiche-saisie-champ annuaire-parent';
    const libelle = this.libelleParent ?? (valeur ? texte('fiches_btp.annuaire.personne', { id: valeur }) : '');
    el.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.PERSONNE, valeur)}" data-ouvrir>${echapper(libelle)}</a>` : `<span class="aide">${texteHtml('fiches_btp.annuaire.racine')}</span>`;
    if (!lecture) el.insertAdjacentHTML('beforeend', ` <button type="button" data-choisir title="${texteHtml('fiches_btp.annuaire.choisir_parent')}">…</button>${valeur ? ` <button type="button" data-vider title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}`);
    el.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => { e.preventDefault(); this.ouvrirFiche({ type: TYPE_FICHE.PERSONNE, id: valeur }, e); });
    el.querySelector('[data-choisir]')?.addEventListener('click', async () => {
      const p = await choisirPersonne({ annuaire: this.annuaire, titre: texte('fiches_btp.annuaire.parent'), exclure: this.id === null ? [] : [Number(this.id)] });
      if (!p) return;
      this.libelleParent = p.raison_sociale;
      this.definirValeur('parent_id', p.id);
      this.rendre();
    });
    el.querySelector('[data-vider]')?.addEventListener('click', () => { this.definirValeur('parent_id', null); this.rendre(); });
    if (valeur && !this.libelleParent) {
      this.annuaire.personne(valeur).then((p) => { this.libelleParent = p.chemin || p.raison_sociale; const a = el.querySelector('[data-ouvrir]'); if (a) a.textContent = this.libelleParent; }).catch(() => {});
    }
    return el;
  }

  ongletsSpecifiques() {
    const fournisseur = (this.valeur('casquettes') ?? []).some((c) => c === 'FOURNISSEUR' || c === 'LOUEUR');
    return [
      this.ongletCoordonnees(TYPE_FICHE.PERSONNE),
      this.ongletRattachements(TYPE_FICHE.PERSONNE, 'contacts', this.morale ? texte('fiches_btp.annuaire.onglets.contacts') : texte('fiches_btp.annuaire.onglets.titulaire')),
      {
        code: 'liens', titre: texte('fiches_btp.annuaire.onglets.liens'), champs: ['liens'],
        rendre: (corps, { modifiable }) => new EditeurLiens(corps, {
          valeur: () => this.valeur('liens') ?? [], definir: (l) => this.definirValeur('liens', l), modifiable, annuaire: this.annuaire,
          types: this.referentiels.types_lien, personneId: this.id, enfants: this.valeur('enfants') ?? [],
          parent: this.valeur('parent_id') ? { id: this.valeur('parent_id'), libelle: this.libelleParent ?? texte('fiches_btp.annuaire.personne', { id: this.valeur('parent_id') }) } : null,
          ouvrirFiche: (f, e) => this.ouvrirFiche(f, e), message: this.message,
        }),
      },
      this.ongletGraphe(TYPE_FICHE.PERSONNE),
      this.ongletPhoto(TYPE_FICHE.PERSONNE, texte('fiches_btp.annuaire.onglets.logo')),
      ...(fournisseur && this.id !== null && this.services.bibliotheque?.tarifsTiers ? [{ code: 'tarifs', titre: texte('fiches_btp.annuaire.onglets.tarifs'), rendre: (corps) => this.#tarifs(corps).catch((e) => this.message(e.message, 'erreur')) }] : []),
      // Sous-traitant (module Sous-traitance, lot 2) : pièces annexes valables pour tous ses marchés.
      ...((this.valeur('casquettes') ?? []).includes('SOUS_TRAITANT') && this.id !== null && this.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE) && this.services.ged
        ? [{
          code: 'pieces-st', titre: texte('fiches_btp.annuaire.onglets.pieces'),
          rendre: (corps) => rendrePieces(corps, {
            element: { type: TYPE_FICHE.PERSONNE, id: Number(this.id), tiers: Number(this.id) }, ged: this.services.ged, message: this.message,
            demander: () => this.ouvrirUrl(`/mail/nouveau?type=st_pieces&id=personne:${this.id}`, { ctrlKey: true }),
          }).catch((e) => this.message(e.message, 'erreur')),
        }]
        : []),
      ...this.ongletsSuivi(),
    ];
  }

  /** Onglet Tarifs (lot 8) : saisie des tarifs du fournisseur et import CSV (annuaire/tarifs-fournisseur.js). */
  async #tarifs(corps) {
    await rendreTarifsFournisseur(corps, {
      bibliotheque: this.services.bibliotheque, tiers: { id: Number(this.id), nom: this.valeur('raison_sociale') || this.valeur('code') || `Tiers ${this.id}` },
      message: (t, n) => this.message(t, n), ouvrir: (type, id, e) => this.ouvrirFiche({ type, id }, e),
    });
  }

  /** Vérifie le tiers dans l'annuaire des plateformes (lot 20) : adresse, plateforme, code de routage et suffixe repris de la ligne trouvée. */
  async verifierAnnuaireFe() {
    const r = await api.annuaireFe.verifier(Number(this.id));
    await this.recharger();
    this.rendre();
    if (r.trouve) this.message(texte('fiches_btp.annuaire.verifie_fe', { adresse: r.adresse, plateforme: r.plateforme }), 'succes');
    else this.message(texte(r.avertissement === AVERTISSEMENT_ANNUAIRE_FE.HORS_ANNUAIRE ? 'fiches_btp.annuaire.hors_annuaire_fe' : 'fiches_btp.annuaire.absent_fe'), 'avertissement');
  }

  /** Reprise depuis l'annuaire des entreprises : identité, identifiants, adresse et dirigeants (contacts). */
  async importerEntreprise() {
    if (!this.services.entreprises) { this.message(texte('fiches_btp.annuaire.entreprises_indisponible'), 'avertissement'); return; }
    const r = await rechercherEntreprise({ fournisseur: this.services.entreprises, recherche: this.valeur('siret') || this.valeur('siren') || this.valeur('raison_sociale') || '' });
    if (!r) return;
    const e = r.entreprise;
    const doublon = e.siret ? await this.annuaire.parSiret(e.siret).catch(() => null) : null;
    if (doublon && Number(doublon.id) !== Number(this.id)) {
      if (await confirmer(texte('fiches_btp.annuaire.confirmer_doublon', { nom: doublon.raison_sociale, code: doublon.code }))) {
        this.ouvrirFiche({ type: TYPE_FICHE.PERSONNE, id: doublon.id });
        return;
      }
      this.message(texte('fiches_btp.annuaire.siret_deux_fois'), 'avertissement');
    }
    const valeurs = {
      raison_sociale: e.raison_sociale, nom_commercial: e.nom_commercial, sigle: e.sigle, pays: 'FR', siren: e.siren, siret: e.siret, tva_intra: e.tva_intra,
      naf: e.naf, forme_juridique: e.forme_juridique, forme_libelle: e.forme_libelle, date_creation: e.date_creation, effectif: e.effectif,
      etat_administratif: e.etat_administratif, siege: e.siege, service_public: e.service_public,
    };
    for (const [k, v] of Object.entries(valeurs)) if (v !== null && v !== undefined && v !== '') this.definirValeur(k, v);
    if (e.service_public) this.definirValeur('fe_plateforme', 'Chorus Pro');
    if (!this.valeur('fe_adresse') && e.siren) this.definirValeur('fe_adresse', e.siren);
    if (e.adresse) {
      const coords = [...(this.valeur('coordonnees') ?? [])];
      const adresse = { uco_id: null, coo_id: null, nature: 'ADRESSE', usage: e.siege ? 'SIEGE' : 'PRINCIPALE', ...e.adresse };
      const deja = coords.some((u) => u.nature === 'ADRESSE' && texteCoordonnee(u).toUpperCase() === texteCoordonnee(adresse).toUpperCase());
      const vide = coords.findIndex((u) => u.nature === 'ADRESSE' && !texteCoordonnee(u) && !u.uco_id);
      if (!deja) {
        if (vide >= 0) coords[vide] = { ...adresse, principal: coords[vide].principal };
        else coords.push({ ...adresse, principal: !coords.some((u) => u.nature === 'ADRESSE') });
        this.definirValeur('coordonnees', coords);
      }
    }
    if (r.dirigeants.length) {
      const existants = this.modificationsRattachements();
      const nouveaux = r.dirigeants.map((d) => ({
        rat_id: null, nouvel_individu: { civilite: null, prenom: d.prenom, nom: d.nom }, individu: [d.prenom, d.nom].filter(Boolean).join(' '),
        fonction: d.qualite, principal: false, actif: true, titulaire: false, coordonnees: [],
      }));
      this.definirValeur('rattachements', [...existants, ...nouveaux]);
    }
    this.rendre();
    this.message(r.dirigeants.length ? pluriel('fiches_btp.annuaire.reprises_dirigeants', r.dirigeants.length) : texte('fiches_btp.annuaire.reprises'), 'succes');
  }

  /** Identifiants enregistrés sans espaces (SIREN, SIRET, TVA, IBAN, BIC) et pays en majuscules. */
  async enregistrer() {
    if (this.estEnSaisie()) {
      for (const k of ['siren', 'siret', 'tva_intra', 'iban', 'bic']) {
        const v = this.valeur(k);
        if (v && compacter(v) !== v) this.definirValeur(k, compacter(v));
      }
      const pays = this.valeur('pays');
      if (pays && pays !== pays.toUpperCase()) this.definirValeur('pays', pays.toUpperCase());
    }
    return super.enregistrer();
  }
}

export class FicheIndividu extends FicheAnnuaire {
  valeursCreation() {
    return { ...super.valeursCreation(), roles: [], coordonnees: coordonneesParDefaut({ telephone: 'PORTABLE', email: 'PERSO', adresse: 'PERSONNELLE' }), rattachements: [] };
  }

  sousTitre(v) {
    const roles = this.referentiels.roles.filter((r) => (v.roles ?? []).includes(r.code)).map((r) => r.libelle);
    const personnes = this.rattachementsLus.filter((r) => r.actif !== false).map((r) => r.personne).filter(Boolean);
    return [...roles, ...personnes].join(' · ');
  }

  rendreInformations(v) {
    if (!this.referentiels) return '';
    const parts = [vignette(this.urlImage)];
    const pro = this.rattachementsLus.filter((r) => r.actif !== false).flatMap((r) => r.coordonnees ?? []);
    const perso = v.coordonnees ?? [];
    const tel = principale(pro.filter((u) => u.usage !== 'PORTABLE'), 'TELEPHONE') ?? principale(perso.filter((u) => u.usage !== 'PORTABLE'), 'TELEPHONE');
    const portable = principale(pro.filter((u) => u.usage === 'PORTABLE'), 'TELEPHONE') ?? principale(perso.filter((u) => u.usage === 'PORTABLE'), 'TELEPHONE');
    const mail = principale(pro, 'EMAIL') ?? principale(perso, 'EMAIL');
    if (portable) parts.push(info(texteHtml('fiches_btp.infos.portable'), `<a href="tel:${echapper(portable.replace(/[^0-9+]/g, ''))}">${echapper(formaterTelephone(portable))}</a>`));
    if (tel) parts.push(info(texteHtml('fiches_btp.infos.telephone'), `<a href="tel:${echapper(tel.replace(/[^0-9+]/g, ''))}">${echapper(formaterTelephone(tel))}</a>`));
    if (mail) parts.push(info(texteHtml('fiches_btp.infos.email'), `<a href="mailto:${echapper(mail)}">${echapper(mail)}</a>`));
    const n = v.nb_rattachements ?? this.rattachementsLus.length;
    if (n > 1) parts.push(info(texteHtml('fiches_btp.infos.rattachements'), pluriel('fiches_btp.annuaire.personnes', n)));
    if (v.salarie) parts.push(info(texteHtml('fiches_btp.infos.salarie'), `${echapper(v.salarie.code ?? '')} · ${echapper(v.salarie.poste ?? '')}${v.salarie.actif ? '' : ` ${texteHtml('fiches_btp.annuaire.sorti')}`}`));
    if (this.homonymes?.length && this.mode === MODES.CREATION) parts.push(info(texteHtml('fiches_btp.infos.homonymes'), echapper(this.homonymes.map((h) => h.nom_complet + (h.personnes ? ` (${h.personnes})` : '')).join(' · ')), true));
    return parts.join('');
  }

  sections() {
    return super.sections().sort(ordre(['identite', '+coordonnees', '+rattachements', '+graphe', '+supplementaires', '+pieces']));
  }

  rendreChamp(champ, valeur) {
    if (champ.code === 'roles') {
      return pastilles({ options: this.referentiels.roles, valeur, modifiable: this.estEnSaisie(), surChange: (codes) => this.definirValeur('roles', codes) });
    }
    const el = super.rendreChamp(champ, valeur);
    // Création : homonymes signalés (un individu ne doit exister qu'une fois, rattaché à plusieurs personnes).
    if (champ.code === 'nom' && this.mode === MODES.CREATION) {
      el.addEventListener('change', async () => {
        const nom = String(el.value ?? '').trim();
        this.homonymes = nom.length >= 2 ? await this.annuaire.rechercherIndividus({ recherche: `${nom} ${this.valeur('prenom') ?? ''}`.trim(), limite: 5 }).catch(() => []) : [];
        if (this.homonymes.length) this.message(texte('fiches_btp.annuaire.homonymes', { noms: this.homonymes.map((h) => h.nom_complet).join(', ') }), 'avertissement');
        const zone = this.conteneur.querySelector('.fiche-informations');
        const html = this.rendreInformations(this.valeurs());
        zone.hidden = !html;
        zone.innerHTML = html;
      });
    }
    return el;
  }

  actionsSupplementaires() {
    const particulier = (this.fiche?.valeurs?.rattachements ?? []).find((r) => r.titulaire && r.niveau === 'PARTICULIER');
    const salarie = this.fiche?.valeurs?.salarie ?? null;
    const roles = this.fiche?.valeurs?.roles ?? [];
    return [
      {
        libelle: `${icone('fiches_btp_salarie')} ${salarie ? texte('fiches_btp.annuaire.salarie', { matricule: salarie.code ?? '' }) : texte('fiches_btp.annuaire.creer_salarie')}`,
        titre: salarie ? texte('fiches_btp.annuaire.ouvrir_salarie', { poste: [salarie.poste ?? '', salarie.agence].filter(Boolean).join(', ') }) : texte('fiches_btp.annuaire.creer_salarie_aide'),
        visible: !this.estEnSaisie() && this.id !== null && (!!salarie || roles.includes('SALARIE') || roles.includes('INTERIMAIRE')),
        action: () => this.ouvrirFiche({ type: TYPE_FICHE.SALARIE, id: salarie ? salarie.id : `nouveau?individu=${this.id}` }),
      },
      {
        libelle: `${icone('fiches_btp_particulier')} ${particulier ? texte('fiches_btp.annuaire.particulier') : texte('fiches_btp.annuaire.creer_particulier')}`,
        titre: particulier ? texte('fiches_btp.annuaire.ouvrir_particulier') : texte('fiches_btp.annuaire.creer_particulier_aide'),
        visible: !this.estEnSaisie() && this.id !== null,
        action: async () => {
          if (particulier) { this.ouvrirFiche({ type: TYPE_FICHE.PERSONNE, id: particulier.per_id }); return; }
          const r = await this.annuaire.creerParticulier(this.id);
          this.message(texte('fiches_btp.annuaire.particulier_cree'), 'succes');
          await this.recharger();
          this.rendre();
          this.ouvrirFiche({ type: TYPE_FICHE.PERSONNE, id: r.id });
        },
      },
      ...super.actionsSupplementaires(),
    ];
  }

  ongletsSpecifiques() {
    return [
      this.ongletCoordonnees(TYPE_FICHE.INDIVIDU),
      this.ongletRattachements(TYPE_FICHE.INDIVIDU, 'rattachements', texte('fiches_btp.infos.rattachements')),
      this.ongletGraphe(TYPE_FICHE.INDIVIDU),
      this.ongletPhoto(TYPE_FICHE.INDIVIDU, texte('fiches_btp.annuaire.onglets.photo')),
      ...this.ongletsSuivi(),
    ];
  }
}
