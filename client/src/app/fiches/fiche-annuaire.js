import { MODES } from '@logibtp/fiche';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { coordonneesParDefaut, erreursIdentifiants, compacter, principale, texteCoordonnee, formaterTelephone, siretValide } from '@logibtp/annuaire';
import { EditeurCoordonnees, EditeurRattachements, EditeurLiens, VueGraphe, choixRequis, demanderChoix, choisirPersonne, pastilles } from '@logibtp/annuaire/ui';
import { rechercherEntreprise } from '@logibtp/entreprises-fr/ui';
import { FicheLogiBTP } from './fiches.js';

// Fiches de l'annuaire (module Fiche + module Annuaire) : personne (niveau, hiérarchie, casquettes qui déverrouillent
// leurs groupes de champs, identifiants pour la facturation électronique, reprise depuis l'annuaire des entreprises
// françaises) et individu (rôles dans notre société, compte particulier). Coordonnées, contacts et liens sont des
// champs gérés : à l'enregistrement, chaque coordonnée partagée modifiée demande « modification » ou « autre information ».

const info = (libelle, valeur, alerte = false) => `<span class="info ${alerte ? 'alerte' : ''}"><small>${libelle}</small>${valeur}</span>`;
const ordre = (codes) => (a, b) => {
  const i = (s) => { const k = codes.indexOf(s.code); return k < 0 ? codes.length : k; };
  return i(a) - i(b);
};

/** Base des fiches de l'annuaire : référentiels, choix des coordonnées partagées à l'enregistrement, navigation. */
class FicheAnnuaire extends FicheLogiBTP {
  constructor(options) {
    super(options);
    this.services = options.services;
    this.ouvrirFiche = options.ouvrirFiche ?? (() => {});
    this.ouvrirUrl = options.ouvrirUrl ?? (() => {});
  }

  get annuaire() { return this.services.annuaire; }

  async ouvrir() {
    this.referentiels = await this.annuaire.referentiels();
    return super.ouvrir();
  }

  /** Paramètre de l'adresse de la page (création depuis une liste ou un menu : ?casquette=CLIENT, ?niveau=…). */
  parametre(nom) { return new URLSearchParams(globalThis.location?.search ?? '').get(nom); }

  /** Listes d'usages à contrôler avant l'enregistrement : coordonnées de la fiche et de chaque rattachement. */
  listesCoordonnees() {
    return [
      { usages: this.valeur('coordonnees'), contexte: null, appliquer: (u) => this.definirValeur('coordonnees', u) },
      ...(this.valeur('rattachements') ?? []).map((r, i) => ({
        usages: r.coordonnees, contexte: r.individu ?? r.personne,
        appliquer: (u) => this.definirValeur('rattachements', this.valeur('rattachements').map((x, j) => (j === i ? { ...x, coordonnees: u } : x))),
      })),
    ];
  }

  /** Avant l'enregistrement : choix pour chaque coordonnée partagée modifiée (modification ou autre information). */
  async enregistrer() {
    if (!this.estEnSaisie()) return false;
    const listes = this.listesCoordonnees();
    const requis = choixRequis(listes);
    if (requis.length) {
      const choix = await demanderChoix(requis.map(({ u, contexte }) => ({ u, contexte })));
      if (!choix) { this.message('Enregistrement annulé', 'avertissement'); return false; }
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
    const cible = f.type === 'rattachement' ? { type: 'individu', id: f.individu_id } : f;
    if (cible.id) this.ouvrirFiche(cible, evenement);
  }

  /** Onglet Graphe : relations autour de la fiche (recentrage sur place, plein écran dans sa page). */
  ongletGraphe(type) {
    return {
      code: 'graphe', titre: 'Graphe',
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = '<p class="aide">Enregistrez la fiche pour voir ses relations.</p>'; return; }
        corps.classList.add('graphe-hote');
        this.vueGraphe = new VueGraphe(corps, {
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
      code: 'coordonnees', titre: 'Coordonnées', champs: ['coordonnees'],
      rendre: (corps, { modifiable }) => new EditeurCoordonnees(corps, {
        valeur: () => this.valeur('coordonnees') ?? [], definir: (u) => this.definirValeur('coordonnees', u), modifiable, nom: 'fiche',
        proposer: this.id === null ? null : () => this.annuaire.coordonneesProposees(type, this.id),
        historique: (id) => this.annuaire.historiqueCoordonnee(id), ouvrirFiche: (f, e) => this.ouvrirLiee(f, e), message: this.message,
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
    const parts = [];
    if (v.societe_base) parts.push(info('Annuaire', '🏢 Société de cette base'));
    const tel = principale(coords, 'TELEPHONE');
    const mail = principale(coords, 'EMAIL');
    const adresse = principale(coords, 'ADRESSE');
    if (adresse) parts.push(info('Adresse', echapper(adresse)));
    if (tel) parts.push(info('Téléphone', `<a href="tel:${echapper(tel.replace(/[^0-9+]/g, ''))}">${echapper(formaterTelephone(tel))}</a>`));
    if (mail) parts.push(info('E-mail', `<a href="mailto:${echapper(mail)}">${echapper(mail)}</a>`));
    const contact = (v.rattachements ?? []).find((r) => r.principal && r.actif !== false) ?? (v.rattachements ?? []).find((r) => r.actif !== false);
    if (contact && this.morale) parts.push(info('Contact', echapper([contact.individu, contact.fonction].filter(Boolean).join(' – '))));
    if (v.etat_administratif === 'F') parts.push(info('État', 'Établissement fermé', true));
    if (v.siret && !siretValide(compacter(v.siret))) parts.push(info('SIRET', 'invalide', true));
    if (v.st_decennale_fin && (v.casquettes ?? []).includes('SOUS_TRAITANT') && String(v.st_decennale_fin) < new Date().toISOString().slice(0, 10)) parts.push(info('Décennale', 'expirée', true));
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
          if (g.code === 'entreprise' || g.code === 'facturation_electronique') return morale;
          if (s.code === 'casquettes') return deverrouilles.has(g.code);
          return true;
        });
        return { ...s, groupes, champs: groupes.flatMap((g) => g.champs) };
      })
      .filter((s) => s.code !== 'casquettes' || s.groupes.length)
      .sort(ordre(['identite', '+coordonnees', '+contacts', 'facturation', 'casquettes', '+liens', '+graphe', '+tarifs', '+supplementaires', '+pieces']));
  }

  validerMetier(v) {
    const erreurs = erreursIdentifiants(v).map(({ champ, message }) => ({ champ, message }));
    if (v.parent_id && this.id !== null && Number(v.parent_id) === Number(this.id)) erreurs.push({ champ: 'parent_id', message: 'Une personne ne peut pas être son propre niveau supérieur' });
    return erreurs;
  }

  actionsSupplementaires() {
    return [
      { libelle: '🇫🇷 Annuaire des entreprises', titre: 'Rechercher l\'entreprise (nom, SIREN, SIRET) et reprendre ses informations', action: () => this.importerEntreprise(), visible: this.estEnSaisie() && this.morale },
      { libelle: '＋ Établissement', titre: 'Créer un niveau inférieur (établissement, agence, dépôt…) de cette personne', action: () => this.ouvrirFiche({ type: 'personne', id: `nouveau?parent=${this.id}&niveau=ETABLISSEMENT` }), visible: !this.estEnSaisie() && this.id !== null && this.morale },
      ...super.actionsSupplementaires(),
    ];
  }

  rendreChamp(champ, valeur) {
    const lecture = !this.estEnSaisie();
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
        if (doublon && Number(doublon.id) !== Number(this.id)) this.message(`SIRET déjà enregistré : ${doublon.raison_sociale} (${doublon.code})`, 'avertissement');
      });
    }
    return el;
  }

  /** Rendu en conservant l'onglet courant (niveau ou casquettes changés : groupes affichés). */
  #rendreGarde() { this.rendre(); }

  #champParent(valeur, lecture) {
    const el = document.createElement('div');
    el.className = 'fiche-saisie-champ annuaire-parent';
    const libelle = this.libelleParent ?? (valeur ? `Personne ${valeur}` : '');
    el.innerHTML = valeur ? `<a href="/fiche/personne/${valeur}" data-ouvrir>${echapper(libelle)}</a>` : '<span class="aide">Aucun (racine)</span>';
    if (!lecture) el.insertAdjacentHTML('beforeend', ` <button type="button" data-choisir title="Choisir le niveau supérieur">…</button>${valeur ? ' <button type="button" data-vider title="Retirer">✕</button>' : ''}`);
    el.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => { e.preventDefault(); this.ouvrirFiche({ type: 'personne', id: valeur }, e); });
    el.querySelector('[data-choisir]')?.addEventListener('click', async () => {
      const p = await choisirPersonne({ annuaire: this.annuaire, titre: 'Niveau supérieur', exclure: this.id === null ? [] : [Number(this.id)] });
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
      this.ongletCoordonnees('personne'),
      {
        code: 'contacts', titre: this.morale ? 'Contacts' : 'Titulaire', champs: ['rattachements'],
        rendre: (corps, { modifiable }) => new EditeurRattachements(corps, {
          cote: 'personne', valeur: () => this.valeur('rattachements') ?? [], definir: (r) => this.definirValeur('rattachements', r), modifiable,
          annuaire: this.annuaire, niveaux: this.referentiels.niveaux, historique: (id) => this.annuaire.historiqueCoordonnee(id),
          ouvrirFiche: (f, e) => this.ouvrirLiee(f, e), message: this.message,
        }),
      },
      {
        code: 'liens', titre: 'Liens', champs: ['liens'],
        rendre: (corps, { modifiable }) => new EditeurLiens(corps, {
          valeur: () => this.valeur('liens') ?? [], definir: (l) => this.definirValeur('liens', l), modifiable, annuaire: this.annuaire,
          types: this.referentiels.types_lien, personneId: this.id, enfants: this.valeur('enfants') ?? [],
          parent: this.valeur('parent_id') ? { id: this.valeur('parent_id'), libelle: this.libelleParent ?? `Personne ${this.valeur('parent_id')}` } : null,
          ouvrirFiche: (f, e) => this.ouvrirFiche(f, e), message: this.message,
        }),
      },
      this.ongletGraphe('personne'),
      ...(fournisseur && this.id !== null && this.services.bibliotheque?.tarifsTiers ? [{ code: 'tarifs', titre: 'Tarifs', rendre: (corps) => this.#tarifs(corps).catch((e) => this.message(e.message, 'erreur')) }] : []),
    ];
  }

  async #tarifs(corps) {
    const tarifs = await this.services.bibliotheque.tarifsTiers(this.id);
    const date = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '…');
    corps.innerHTML = `<div class="annuaire-tarifs">${tarifs.length ? `<table class="coord-table"><thead><tr><th>Élément</th><th>Libellé</th><th>Réf. fournisseur</th><th>Libellé fournisseur</th>
      <th class="nombre">Prix</th><th>Validité</th><th></th></tr></thead><tbody>
      ${tarifs.map((t) => `<tr><td><a href="/fiche/element/${t.ele_id}" data-element="${t.ele_id}"><b>${echapper(t.bib_code ?? '')}:${echapper(t.code ?? '')}</b></a></td><td>${echapper(t.element ?? '')}</td>
        <td>${echapper(t.reference ?? '')}</td><td>${echapper(t.libelle ?? '')}</td><td class="nombre">${formatNombre(t.prix, 2)} € / ${echapper(t.unite)}</td>
        <td>${date(t.debut)} → ${date(t.fin)}</td><td>${t.principal ? '★' : ''}${t.lien ? ` <a href="${echapper(t.lien)}" target="_blank" rel="noopener" title="Tarif en ligne">🔗</a>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucun tarif de la bibliothèque n\'est relié à ce fournisseur.</p>'}
      <p class="aide">Tarifs saisis dans les fiches des éléments de la bibliothèque. Le module Tarifs fournisseurs (à venir) permettra leur import et leurs remises.</p></div>`;
    corps.querySelectorAll('[data-element]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.ouvrirFiche({ type: 'element', id: Number(a.dataset.element) }, e); }));
  }

  /** Reprise depuis l'annuaire des entreprises : identité, identifiants, adresse et dirigeants (contacts). */
  async importerEntreprise() {
    if (!this.services.entreprises) { this.message('Recherche d\'entreprises indisponible', 'avertissement'); return; }
    const r = await rechercherEntreprise({ fournisseur: this.services.entreprises, recherche: this.valeur('siret') || this.valeur('siren') || this.valeur('raison_sociale') || '' });
    if (!r) return;
    const e = r.entreprise;
    const doublon = e.siret ? await this.annuaire.parSiret(e.siret).catch(() => null) : null;
    if (doublon && Number(doublon.id) !== Number(this.id)) {
      if (confirm(`Cet établissement est déjà dans l'annuaire : ${doublon.raison_sociale} (${doublon.code}). L'ouvrir plutôt que de créer un doublon ?`)) {
        this.ouvrirFiche({ type: 'personne', id: doublon.id });
        return;
      }
      this.message('SIRET déjà enregistré : il ne pourra pas l\'être deux fois', 'avertissement');
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
      const existants = this.valeur('rattachements') ?? [];
      const nouveaux = r.dirigeants.map((d) => ({
        rat_id: null, nouvel_individu: { civilite: null, prenom: d.prenom, nom: d.nom }, individu: [d.prenom, d.nom].filter(Boolean).join(' '),
        fonction: d.qualite, principal: false, actif: true, titulaire: false, coordonnees: [],
      }));
      this.definirValeur('rattachements', [...existants, ...nouveaux]);
    }
    this.rendre();
    this.message(`Informations reprises de l'annuaire des entreprises${r.dirigeants.length ? `, ${r.dirigeants.length} dirigeant(s) ajouté(s) aux contacts` : ''}`, 'succes');
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
    const personnes = (v.rattachements ?? []).filter((r) => r.actif !== false).map((r) => r.personne).filter(Boolean);
    return [...roles, ...personnes].join(' · ');
  }

  rendreInformations(v) {
    if (!this.referentiels) return '';
    const parts = [];
    const pro = (v.rattachements ?? []).filter((r) => r.actif !== false).flatMap((r) => r.coordonnees ?? []);
    const perso = v.coordonnees ?? [];
    const tel = principale(pro.filter((u) => u.usage !== 'PORTABLE'), 'TELEPHONE') ?? principale(perso.filter((u) => u.usage !== 'PORTABLE'), 'TELEPHONE');
    const portable = principale(pro.filter((u) => u.usage === 'PORTABLE'), 'TELEPHONE') ?? principale(perso.filter((u) => u.usage === 'PORTABLE'), 'TELEPHONE');
    const mail = principale(pro, 'EMAIL') ?? principale(perso, 'EMAIL');
    if (portable) parts.push(info('Portable', `<a href="tel:${echapper(portable.replace(/[^0-9+]/g, ''))}">${echapper(formaterTelephone(portable))}</a>`));
    if (tel) parts.push(info('Téléphone', `<a href="tel:${echapper(tel.replace(/[^0-9+]/g, ''))}">${echapper(formaterTelephone(tel))}</a>`));
    if (mail) parts.push(info('E-mail', `<a href="mailto:${echapper(mail)}">${echapper(mail)}</a>`));
    const n = (v.rattachements ?? []).length;
    if (n > 1) parts.push(info('Rattachements', `${n} personnes`));
    if (v.salarie) parts.push(info('Salarié', `${echapper(v.salarie.matricule)} · ${echapper(v.salarie.poste ?? '')}${v.salarie.actif ? '' : ' (sorti)'}`));
    if (this.homonymes?.length && this.mode === MODES.CREATION) parts.push(info('Homonymes', echapper(this.homonymes.map((h) => h.nom_complet + (h.personnes ? ` (${h.personnes})` : '')).join(' · ')), true));
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
        if (this.homonymes.length) this.message(`Individu(s) déjà dans l'annuaire : ${this.homonymes.map((h) => h.nom_complet).join(', ')}`, 'avertissement');
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
        libelle: salarie ? `👷 Salarié ${salarie.matricule}` : '👷 Créer la fiche salarié',
        titre: salarie ? `Ouvrir la fiche salarié (${salarie.poste ?? ''}${salarie.agence ? `, ${salarie.agence}` : ''})` : 'Créer la fiche salarié à partir de cet individu (identité, agence, coordonnées professionnelles)',
        visible: !this.estEnSaisie() && this.id !== null && (!!salarie || roles.includes('SALARIE') || roles.includes('INTERIMAIRE')),
        action: () => this.ouvrirFiche({ type: 'salarie', id: salarie ? salarie.id : `nouveau?individu=${this.id}` }),
      },
      {
        libelle: particulier ? '🏠 Compte particulier' : '🏠 Créer le compte particulier',
        titre: particulier ? 'Ouvrir son compte particulier (client)' : 'Créer une personne « Particulier » dont il est titulaire, avec ses coordonnées personnelles partagées',
        visible: !this.estEnSaisie() && this.id !== null,
        action: async () => {
          if (particulier) { this.ouvrirFiche({ type: 'personne', id: particulier.per_id }); return; }
          const r = await this.annuaire.creerParticulier(this.id);
          this.message('Compte particulier créé : coordonnées personnelles partagées', 'succes');
          await this.recharger();
          this.rendre();
          this.ouvrirFiche({ type: 'personne', id: r.id });
        },
      },
      ...super.actionsSupplementaires(),
    ];
  }

  ongletsSpecifiques() {
    return [
      this.ongletCoordonnees('individu'),
      {
        code: 'rattachements', titre: 'Rattachements', champs: ['rattachements'],
        rendre: (corps, { modifiable }) => new EditeurRattachements(corps, {
          cote: 'individu', valeur: () => this.valeur('rattachements') ?? [], definir: (r) => this.definirValeur('rattachements', r), modifiable,
          annuaire: this.annuaire, niveaux: this.referentiels.niveaux, historique: (id) => this.annuaire.historiqueCoordonnee(id),
          ouvrirFiche: (f, e) => this.ouvrirLiee(f, e), message: this.message,
        }),
      },
      this.ongletGraphe('individu'),
    ];
  }
}
