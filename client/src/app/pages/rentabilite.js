import { texte, texteHtml, icone, iconeHtml, pluriel } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, champDate, formatNombre, formatDate, formatDateHeure, lireStockage, ecrireStockage, confirmer, saisir, ouvrirDialogue, telechargerCsv } from '@logibtp/socle/ui';
import { aujourdhui, Dz, ACTION_DROIT } from '@logibtp/socle';
import { COUT, COLONNES_DETAIL, COLONNES_PREVISION, INDICATEUR, COLONNES_LISTE, NIVEAU_LISTE, RACCOURCI_PERIODE, BORNE_PERIODE, ERREUR_PERIODE, lirePeriode, controlerPeriode, raccourciPeriode } from '@logibtp/rentabilite';
import { TableauDetail, TableauFaits, TableauListe, TableauResultats, PanneauPrevisions, PanneauFacturation, TableauFacturationListe, GraphiquesEvolution } from '@logibtp/rentabilite/ui';
import { choisirPersonne } from '@logibtp/annuaire/ui';
import { TYPE_FICHE, ROLE_RENTABILITE, urlFiche, urlDocument } from '../codes.js';
import { api } from '../api.js';
import { champRattachement } from '../structure/selection.js';

// Module Rentabilité, lot 1 (ANALYSE-MODULE-ANALYSE.md § 7, § 8, § 10) : choix d'un chantier, Détail d'un chantier et de
// ses ordres (natures, total en haut, montants anormaux en rouge), faits d'un chiffre (double-clic, Ctrl : nouvelle
// fenêtre), rapprochement des pièces et des faits, paramètres (rôle des types, taux horaires, frais généraux).

const CLE_COUT = 'rentabiliteCout';
const CLE_HEURES = 'rentabiliteHeures';
const CLE_PREVU = 'rentabilitePrevu';
const NOEUD_PREVISIONS = 'rentabilite/previsions';
const NOEUD_FACTURATION = 'rentabilite/facturation';
const montant = (v) => formatNombre(v, 2);

/** Adresse de la page des faits d'un chiffre. */
export function urlFaits(chantier, f) {
  const p = new URLSearchParams({ chantier });
  if (f.indicateurs?.length) p.set('indicateur', f.indicateurs.join(','));
  if (f.natures?.length) p.set('nature', f.natures.join(','));
  if (f.composante) p.set('composante', f.composante);
  if (f.ordre !== undefined && f.ordre !== null && f.ordre !== '') p.set('ordre', f.ordre);
  if (f.du) p.set('du', f.du);
  if (f.au) p.set('au', f.au);
  if (f.colonne) p.set('colonne', f.colonne);
  if (f.ligne) p.set('ligne', f.ligne);
  return `/rentabilite/faits?${p}`;
}

/** Fraîcheur des chiffres : dernier calcul, attente dans la file, erreur. */
function fraicheurHtml(f) {
  const d = f.dernier;
  const parts = [];
  if (d) {
    parts.push(texteHtml('rentabilite_btp.fraicheur.calcule', { date: formatDateHeure(d.fin ?? d.debut), declencheur: texte(`rentabilite_btp.declencheurs.${d.declencheur}`) }));
    if (d.etat === 'ERREUR') parts.push(`<span class="rentabilite-anomalie">${iconeHtml('rentabilite_anomalie')} ${texteHtml('rentabilite_btp.fraicheur.erreur', { message: d.message ?? '' })}</span>`);
    if (d.version !== f.version_regles) parts.push(texteHtml('rentabilite_btp.fraicheur.version'));
  } else parts.push(texteHtml('rentabilite_btp.fraicheur.jamais'));
  if (f.en_attente) parts.push(`${iconeHtml('rentabilite_btp_attente')} ${texteHtml('rentabilite_btp.fraicheur.attente', { raison: f.raison ?? '' })}`);
  if (f.erreur) parts.push(`<span class="rentabilite-anomalie">${echapper(f.erreur)}</span>`);
  return parts.join(' · ');
}

const CLE_LISTE = 'rentabiliteListe';
const PAR_DEFAUT = Object.freeze({ du: null, au: null, raccourci: null, niveau: NIVEAU_LISTE.AFFAIRE, cout: COUT.PR, decimales: 2, exclus: false, clos: false });

/** Paramètres d'une vue rendus utilisables : un raccourci de période est recalculé au jour de l'ouverture. */
function parametresVue(p) {
  const v = { ...PAR_DEFAUT, ...(p ?? {}) };
  if (v.raccourci) Object.assign(v, raccourciPeriode(v.raccourci) ?? {});
  v.decimales = Number(v.decimales) === 0 ? 0 : 2;
  return v;
}

/** Saisie d'une borne de période (« 2026 », « 10/2026 », date abrégée) : date ISO, null si vide, undefined si erronée. */
function lireBorne(champ, borne) {
  const r = lirePeriode(champ.value, borne);
  champ.classList.toggle('invalide', !!r.erreur);
  if (r.erreur) return undefined;
  champ.value = r.date ? formatDate(r.date) : '';
  return r.date;
}

/**
 * Liste de la rentabilité (§ 6) : chantiers visibles par chargé d'affaires ou par affaire, puis ordres ; période du… au
 * (raccourcis), PA / PR, arrondi, exclus et clos, vues enregistrées (personnelles ou globales), fraîcheur et changements
 * depuis le contrôle de chacun, « ✓ Contrôlé » sur la sélection, export CSV ; choix direct d'un chantier.
 */
export class PageRentabilite extends PageBase {
  icone = icone('rentabilite_detail');

  urlCourante() { return '/rentabilite'; }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.accueil');
    this.selection = new Set();
    let enregistre = null;
    try { enregistre = JSON.parse(lireStockage(CLE_LISTE, 'null')); } catch { enregistre = null; }
    try { this.vues = await api.rentabilite.vues(); } catch (e) { this.app.erreur(e); this.vues = []; }
    const defaut = this.vues.find((v) => v.defaut && v.proprietaire) ?? this.vues.find((v) => v.defaut);
    this.vue = enregistre?.vue ? this.vues.find((v) => v.id === enregistre.vue) ?? null : defaut ?? null;
    this.p = parametresVue(enregistre?.parametres ?? this.vue?.parametres);
    const admin = this.app.estAdmin();
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_detail')} ${texteHtml('rentabilite_btp.routes.accueil')}</h1>
        <div class="barre-outils">
          <div class="groupe-outils"><span data-vue></span>
            <button type="button" data-enregistrer-vue title="${texteHtml('rentabilite_btp.liste.vue_enregistrer_titre')}">${iconeHtml('rentabilite_btp_vue_enregistrer')}</button>
            <button type="button" data-supprimer-vue title="${texteHtml('rentabilite_btp.liste.vue_supprimer')}">${iconeHtml('rentabilite_btp_vue_supprimer')}</button></div>
          <div class="groupe-outils">
            <button type="button" data-deplier title="${texteHtml('rentabilite_btp.liste.deplier_titre')}">${iconeHtml('rentabilite_deplier')} ${texteHtml('rentabilite_btp.liste.deplier')}</button>
            <button type="button" data-replier title="${texteHtml('rentabilite_btp.liste.replier_titre')}">${iconeHtml('rentabilite_replier')}</button></div>
          <div class="groupe-outils">
            <button type="button" data-controle title="${texteHtml('rentabilite_btp.liste.controle_titre')}" disabled>${iconeHtml('rentabilite_btp_controle')} ${texteHtml('rentabilite_btp.liste.controle')}</button>
            <button type="button" data-csv title="${texteHtml('rentabilite_btp.liste.csv_titre')}">${iconeHtml('rentabilite_btp_csv')}</button>
            <a class="bouton" href="/rentabilite/facturation" title="${texteHtml('rentabilite_btp.facturation.lien_titre')}">${iconeHtml('rentabilite_facturation')} ${texteHtml('rentabilite_btp.facturation.lien')}</a>
            ${admin ? `<button type="button" data-tout title="${texteHtml('rentabilite_btp.accueil.tout_titre')}">${iconeHtml('rentabilite_btp_recalculer')} ${texteHtml('rentabilite_btp.accueil.tout')}</button>` : ''}</div>
        </div></div>
      <p class="ligne">
        <label title="${texteHtml('rentabilite_btp.liste.periode_titre')}">${texteHtml('rentabilite_btp.liste.du')} <input type="text" size="10" data-du></label>
        <label title="${texteHtml('rentabilite_btp.liste.periode_titre')}">${texteHtml('rentabilite_btp.liste.au')} <input type="text" size="10" data-au></label>
        ${Object.values(RACCOURCI_PERIODE).map((r) => `<button type="button" class="lien" data-raccourci="${r}">${texteHtml(`rentabilite_btp.liste.raccourcis.${r}`)}</button>`).join(' ')}
      </p>
      <p class="ligne">
        <label>${texteHtml('rentabilite_btp.liste.niveau')} <span data-niveau></span></label>
        <label data-zone-cout hidden>${texteHtml('rentabilite_btp.chantier.cout')} <span data-cout></span></label>
        <label>${texteHtml('rentabilite_btp.liste.arrondi')} <span data-arrondi></span></label>
        <label title="${texteHtml('rentabilite_btp.liste.exclus_titre')}"><input type="checkbox" data-exclus> ${texteHtml('rentabilite_btp.liste.exclus')}</label>
        <label><input type="checkbox" data-clos> ${texteHtml('rentabilite_btp.liste.clos')}</label>
        <span data-choix title="${texteHtml('rentabilite_btp.liste.choix_titre')}"></span>
      </p>
      <p class="aide" data-file></p>
      <div class="rentabilite-zone-liste" data-liste></div>
      <p class="aide">${texteHtml('rentabilite_btp.liste.aide')}</p></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    this.#rendreVues();
    const niveau = creerCombo({ options: Object.values(NIVEAU_LISTE).map((n) => ({ valeur: n, libelle: texte(`rentabilite_btp.liste.niveaux.${n}`) })), valeur: this.p.niveau, vide: false });
    $('[data-niveau]').append(niveau);
    niveau.addEventListener('change', () => { this.p.niveau = niveau.valeurCombo; this.#modifie(false); });
    const cout = creerCombo({ options: [{ valeur: COUT.PR, libelle: texte('rentabilite_btp.chantier.cout_pr') }, { valeur: COUT.PA, libelle: texte('rentabilite_btp.chantier.cout_pa') }], valeur: this.p.cout, vide: false });
    $('[data-cout]').append(cout);
    cout.addEventListener('change', () => { this.p.cout = cout.valeurCombo; this.#modifie(false); });
    const arrondi = creerCombo({ options: [{ valeur: '2', libelle: texte('rentabilite_btp.liste.arrondi_2') }, { valeur: '0', libelle: texte('rentabilite_btp.liste.arrondi_0') }], valeur: String(this.p.decimales), vide: false });
    $('[data-arrondi]').append(arrondi);
    arrondi.addEventListener('change', () => { this.p.decimales = Number(arrondi.valeurCombo); this.#modifie(false); });
    const du = $('[data-du]');
    const au = $('[data-au]');
    this.champs = { du, au, niveau, cout, arrondi, exclus: $('[data-exclus]'), clos: $('[data-clos]') };
    this.#afficherParametres();
    const borne = (champ, cle, b) => champ.addEventListener('change', () => {
      const d = lireBorne(champ, b);
      if (d === undefined) { this.app.message(texte(`rentabilite.periodes.${ERREUR_PERIODE.DATE}`), 'erreur'); return; }
      this.p[cle] = d;
      this.p.raccourci = null;
      if (controlerPeriode(this.p.du, this.p.au)) { this.app.message(texte(`rentabilite.periodes.${ERREUR_PERIODE.ORDRE}`), 'erreur'); return; }
      this.#modifie(true);
    });
    borne(du, 'du', BORNE_PERIODE.DEBUT);
    borne(au, 'au', BORNE_PERIODE.FIN);
    this.conteneur.querySelectorAll('[data-raccourci]').forEach((b) => b.addEventListener('click', () => {
      Object.assign(this.p, raccourciPeriode(b.dataset.raccourci), { raccourci: b.dataset.raccourci === RACCOURCI_PERIODE.ORIGINE ? null : b.dataset.raccourci });
      this.#afficherParametres();
      this.#modifie(true);
    }));
    this.champs.exclus.addEventListener('change', (e) => { this.p.exclus = e.target.checked; this.#modifie(true); });
    this.champs.clos.addEventListener('change', (e) => { this.p.clos = e.target.checked; this.#modifie(true); });
    const refs = await api.structureReferentiels();
    $('[data-choix]').append(champRattachement({
      type: TYPE_FICHE.CHANTIER, refs, valeur: null, titre: texte('rentabilite_btp.accueil.chantier'),
      choisir: (id) => { if (id) this.app.naviguer(`/rentabilite/chantier/${id}`); },
    }));
    this.tableau = new TableauListe($('[data-liste]'), {
      selection: this.selection,
      ouvrirDetail: (id, nouvelle) => this.app.naviguer(this.#urlDetail(id), { nouvelleFenetre: nouvelle }),
      ouvrirChangements: (id, nouvelle) => this.app.naviguer(`/rentabilite/changements/${id}`, { nouvelleFenetre: nouvelle }),
      ouvrirFaits: (f, nouvelle) => {
        const enPeriode = COLONNES_LISTE.find((c) => c.code === f.colonne)?.periode;
        this.app.naviguer(urlFaits(f.chantier, { ...f, du: enPeriode ? this.p.du : null, au: this.p.au }), { nouvelleFenetre: nouvelle });
      },
      selectionModifiee: (s) => { $('[data-controle]').disabled = !s.size; },
    });
    $('[data-deplier]').addEventListener('click', () => this.tableau.ouvrirJusqua('chantier'));
    $('[data-replier]').addEventListener('click', () => this.tableau.ouvrirJusqua(null));
    $('[data-controle]').addEventListener('click', async () => {
      try {
        const r = await api.rentabilite.controler([...this.selection]);
        this.app.message(pluriel('rentabilite_btp.liste.controle_fait', r.chantiers, { nombre: r.chantiers }), 'succes');
        this.selection.clear();
        $('[data-controle]').disabled = true;
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    });
    $('[data-csv]').addEventListener('click', () => telechargerCsv(`${texte('rentabilite.liste.csv.nom')}-${aujourdhui()}.csv`, this.tableau.lignesCsv()));
    $('[data-enregistrer-vue]').addEventListener('click', () => this.#enregistrerVue());
    $('[data-supprimer-vue]').addEventListener('click', () => this.#supprimerVue());
    $('[data-tout]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('rentabilite_btp.accueil.tout_confirmer'))) return;
      try {
        const r = await api.rentabilite.recalculerTout();
        this.app.message(pluriel('rentabilite_btp.accueil.tout_fait', r.chantiers, { nombre: r.chantiers }), 'succes');
        await this.#file();
      } catch (e) { this.app.erreur(e); }
    });
    await this.#charger();
  }

  reprendre() { this.#charger(); }

  #urlDetail(id) {
    const p = new URLSearchParams(Object.entries({ du: this.p.du, au: this.p.au }).filter(([, v]) => v));
    return `/rentabilite/chantier/${id}${p.size ? `?${p}` : ''}`;
  }

  #afficherParametres() {
    const c = this.champs;
    c.du.value = this.p.du ? formatDate(this.p.du) : '';
    c.au.value = this.p.au ? formatDate(this.p.au) : '';
    c.exclus.checked = !!this.p.exclus;
    c.clos.checked = !!this.p.clos;
    this.conteneur.querySelectorAll('[data-raccourci]').forEach((b) => b.classList.toggle('actif', b.dataset.raccourci === (this.p.raccourci ?? (this.p.du || this.p.au ? '' : RACCOURCI_PERIODE.ORIGINE))));
  }

  /** Paramètre modifié : gardé dans le navigateur ; `recharger` = nouvelle demande au serveur (période, exclus, clos). */
  #modifie(recharger) {
    ecrireStockage(CLE_LISTE, JSON.stringify({ vue: this.vue?.id ?? null, parametres: this.p }));
    this.#afficherParametres();
    if (recharger) this.#charger(); else this.#rendre();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-liste]');
    try {
      this.donnees = await api.rentabilite.liste({ du: this.p.du, au: this.p.au, exclus: this.p.exclus, clos: this.p.clos });
    } catch (e) { this.app.erreur(e); zone.innerHTML = ''; return; }
    this.conteneur.querySelector('[data-zone-cout]').hidden = !this.donnees.voir_couts;
    this.#rendre();
    await this.#file();
  }

  #rendre() {
    if (!this.donnees) return;
    const d = this.donnees;
    this.tableau.rendre(d, {
      niveau: this.p.niveau, cout: d.voir_couts ? this.p.cout : COUT.PR, decimales: this.p.decimales, periode: !!this.p.du,
      etats: new Map((d.etats ?? []).map((e) => [e.cha_id, e])),
    });
  }

  async #file() {
    const zone = this.conteneur.querySelector('[data-file]');
    try {
      const f = await api.rentabilite.file();
      zone.innerHTML = f.attente
        ? `${iconeHtml('rentabilite_btp_attente')} ${echapper(pluriel('rentabilite_btp.accueil.attente', f.attente, { nombre: f.attente }))}${f.erreurs ? ` · <span class="rentabilite-anomalie">${echapper(pluriel('rentabilite_btp.accueil.erreurs', f.erreurs, { nombre: f.erreurs }))}</span>` : ''}`
        : texteHtml('rentabilite_btp.accueil.file_vide');
    } catch (e) { this.app.erreur(e); }
  }

  #rendreVues() {
    const zone = this.conteneur.querySelector('[data-vue]');
    zone.innerHTML = '';
    const combo = creerCombo({
      options: this.vues.map((v) => ({ valeur: String(v.id), libelle: `${v.defaut ? `${icone('rentabilite_btp_vue_defaut')} ` : ''}${v.nom}`,
        detail: texte(v.proprietaire ? 'rentabilite_btp.liste.vue_personnelle' : 'rentabilite_btp.liste.vue_globale') })),
      valeur: this.vue ? String(this.vue.id) : '', vide: true, titre: texte('rentabilite_btp.liste.vue_titre'),
    });
    zone.append(combo);
    combo.addEventListener('change', () => {
      this.vue = this.vues.find((v) => String(v.id) === combo.valeurCombo) ?? null;
      this.p = parametresVue(this.vue?.parametres);
      const c = this.champs;
      c.niveau.definirValeur?.(this.p.niveau);
      c.cout.definirValeur?.(this.p.cout);
      c.arrondi.definirValeur?.(String(this.p.decimales));
      this.#modifie(true);
    });
    this.conteneur.querySelector('[data-supprimer-vue]').disabled = !this.vue || (!this.vue.proprietaire && !this.app.estAdmin());
  }

  async #enregistrerVue() {
    const admin = this.app.estAdmin();
    const r = await ouvrirDialogue({
      titre: texte('rentabilite_btp.liste.vue_enregistrer'), focus: '[name="nom"]',
      html: `<p><label>${texteHtml('rentabilite_btp.liste.vue_nom')} <input type="text" name="nom" size="30" value="${echapper(this.vue?.nom ?? '')}"></label></p>
        <p><label><input type="checkbox" name="defaut"${this.vue?.defaut ? ' checked' : ''}> ${texteHtml('rentabilite_btp.liste.vue_defaut')}</label></p>
        ${admin ? `<p><label><input type="checkbox" name="globale"${this.vue && !this.vue.proprietaire ? ' checked' : ''}> ${texteHtml('rentabilite_btp.liste.vue_globale_case')}</label></p>` : ''}
        ${this.vue ? `<p><label><input type="checkbox" name="nouvelle"> ${texteHtml('rentabilite_btp.liste.vue_nouvelle')}</label></p>` : ''}`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: null }, {
        libelle: texte('commun.enregistrer'), principal: true,
        valeur: (d) => ({ nom: d.querySelector('[name="nom"]').value.trim(), defaut: d.querySelector('[name="defaut"]').checked,
          globale: !!d.querySelector('[name="globale"]')?.checked, nouvelle: !!d.querySelector('[name="nouvelle"]')?.checked }),
      }],
    });
    if (!r) return;
    try {
      const v = await api.rentabilite.enregistrerVue({ id: this.vue && !r.nouvelle ? this.vue.id : null, nom: r.nom, globale: r.globale, defaut: r.defaut, parametres: this.p });
      this.vues = await api.rentabilite.vues();
      this.vue = this.vues.find((x) => x.id === v.id) ?? null;
      this.#rendreVues();
      this.#modifie(false);
      this.app.message(texte('rentabilite_btp.liste.vue_enregistree', { nom: v.nom }), 'succes');
    } catch (e) { this.app.erreur(e); }
  }

  async #supprimerVue() {
    if (!this.vue || !await confirmer(texte('rentabilite_btp.liste.vue_supprimer_confirmer', { nom: this.vue.nom }))) return;
    try {
      await api.rentabilite.supprimerVue(this.vue.id);
      this.vues = this.vues.filter((v) => v.id !== this.vue.id);
      this.vue = null;
      this.#rendreVues();
      this.#modifie(false);
    } catch (e) { this.app.erreur(e); }
  }
}

/**
 * Détail d'un chantier (§ 7) : ordre (tout, sans ordre, un ordre), coût PA ou PR, période du… au, comparaison au dernier
 * contrôle ou à une photo (écarts sous les chiffres), « ✓ Contrôlé », changements depuis le contrôle, 📷 photo, acomptes
 * en trésorerie, contrôles.
 */
export class PageRentabiliteChantier extends PageBase {
  icone = icone('rentabilite_detail');

  urlCourante() {
    const f = this.filtre ?? {};
    const p = new URLSearchParams(Object.entries({ ordre: f.ordre, du: f.du, au: f.au, reference: f.reference }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return `/rentabilite/chantier/${encodeURIComponent(this.params.id)}${p.size ? `?${p}` : ''}`;
  }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.chantier');
    this.filtre = { ordre: this.requete.ordre ?? '', du: this.requete.du ?? '', au: this.requete.au ?? '', reference: this.requete.reference ?? '',
      cout: lireStockage(CLE_COUT, COUT.PR) === COUT.PA ? COUT.PA : COUT.PR, heures: lireStockage(CLE_HEURES, '0') === '1',
      previsions: lireStockage(CLE_PREVU, '1') === '1' };
    this.conteneur.innerHTML = '<div class="page-parametres page-rentabilite" data-corps></div>';
    await this.#charger();
  }

  reprendre() { this.#charger(); }

  async #charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    let d;
    try { d = await api.rentabilite.chantier(this.params.id, this.filtre.au, { du: this.filtre.du, reference: this.filtre.reference }); } catch (e) { this.app.erreur(e); corps.innerHTML = `<p class="aide">${texteHtml('rentabilite_btp.chantier.introuvable')}</p>`; return; }
    this.donnees = d;
    const c = d.chantier;
    this.titre = texte('rentabilite_btp.chantier.titre', { code: c.code });
    if (!d.voir_couts) this.filtre.cout = COUT.PR;
    corps.innerHTML = `<div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_detail')} <a href="${urlFiche(TYPE_FICHE.CHANTIER, c.id)}">${echapper(c.code)}</a> ${echapper(c.libelle ?? '')}</h1>
        <div class="barre-outils"><div class="groupe-outils">
          <button type="button" data-recalculer title="${texteHtml('rentabilite_btp.chantier.recalculer_titre')}">${iconeHtml('rentabilite_btp_recalculer')} ${texteHtml('rentabilite_btp.chantier.recalculer')}</button>
          <a class="bouton" href="/rentabilite/rapprochement/${Number(c.id)}" title="${texteHtml('rentabilite_btp.chantier.rapprochement_titre')}">${iconeHtml('rentabilite_btp_rapprochement')} ${texteHtml('rentabilite_btp.chantier.rapprochement')}</a>
        </div><div class="groupe-outils">
          <button type="button" data-controle title="${texteHtml('rentabilite_btp.chantier.controle_titre')}">${iconeHtml('rentabilite_btp_controle')} ${texteHtml('rentabilite_btp.liste.controle')}</button>
          <button type="button" data-photo title="${texteHtml('rentabilite_btp.chantier.photo_titre')}">${iconeHtml('rentabilite_btp_photo')} ${texteHtml('rentabilite_btp.chantier.photo')}</button>
        </div></div></div>
      <p class="aide">${[c.affaire ? texteHtml('rentabilite_btp.chantier.affaire', { affaire: c.affaire }) : '', c.charge ? texteHtml('rentabilite_btp.chantier.charge', { nom: c.charge }) : ''].filter(Boolean).join(' · ')}</p>
      <p class="aide" data-fraicheur>${fraicheurHtml(d.fraicheur)}</p>
      <p class="aide" data-controle-etat>${this.#controleHtml(d)}</p>
      <p class="ligne"><label>${texteHtml('rentabilite_btp.chantier.ordre')} <span data-ordre></span></label>
        ${d.voir_couts ? `<label>${texteHtml('rentabilite_btp.chantier.cout')} <span data-cout></span></label>` : ''}
        <label title="${texteHtml('rentabilite_btp.liste.periode_titre')}">${texteHtml('rentabilite_btp.liste.du')} <input type="text" size="10" data-du value="${this.filtre.du ? formatDate(this.filtre.du) : ''}"></label>
        <label title="${texteHtml('rentabilite_btp.chantier.au_titre')}">${texteHtml('rentabilite_btp.chantier.au')} <input type="text" size="10" data-au value="${this.filtre.au ? formatDate(this.filtre.au) : ''}"></label>
        <label title="${texteHtml('rentabilite_btp.chantier.comparer_titre')}">${texteHtml('rentabilite_btp.chantier.comparer')} <span data-reference></span></label>
        <label title="${texteHtml('rentabilite_btp.chantier.heures_titre')}"><input type="checkbox" data-heures${this.filtre.heures ? ' checked' : ''}> ${texteHtml('rentabilite_btp.chantier.heures')}</label>
        <label title="${texteHtml('rentabilite_btp.chantier.previsions_titre')}"><input type="checkbox" data-previsions-colonnes${this.filtre.previsions ? ' checked' : ''}> ${texteHtml('rentabilite_btp.chantier.previsions')}</label></p>
      ${d.du ? `<p class="aide">${texteHtml('rentabilite_btp.chantier.periode_aide')}</p>` : ''}
      <div data-detail></div>
      <div data-resultats></div>
      <div data-graphiques></div>
      <div data-previsions></div>
      <div data-facturation></div>
      <div data-acomptes></div>
      <div data-photos></div>
      <div data-controles></div>
      <p class="aide">${texteHtml('rentabilite.detail.ouvrir_faits')}</p>`;
    const ordres = creerCombo({
      options: [{ valeur: '0', libelle: texte('rentabilite_btp.chantier.sans_ordre') },
        ...d.ordres.map((o) => ({ valeur: String(o.id), libelle: `${o.numero ?? `#${o.id}`} ${o.libelle ?? ''}`.trim(), detail: o.statut }))],
      valeur: this.filtre.ordre, vide: true, titre: texte('rentabilite_btp.chantier.ordre_titre'),
    });
    corps.querySelector('[data-ordre]').append(ordres);
    ordres.addEventListener('change', () => { this.filtre.ordre = ordres.valeurCombo ?? ''; this.#memoriser(); this.#rendreDetail(); });
    if (d.voir_couts) {
      const cout = creerCombo({ options: [{ valeur: COUT.PR, libelle: texte('rentabilite_btp.chantier.cout_pr') }, { valeur: COUT.PA, libelle: texte('rentabilite_btp.chantier.cout_pa') }], valeur: this.filtre.cout, vide: false });
      corps.querySelector('[data-cout]').append(cout);
      cout.addEventListener('change', () => { this.filtre.cout = cout.valeurCombo; ecrireStockage(CLE_COUT, this.filtre.cout); this.#rendreDetail(); });
    }
    const borne = (champ, cle, b) => champ.addEventListener('change', () => {
      const v = lireBorne(champ, b);
      if (v === undefined) { this.app.message(texte(`rentabilite.periodes.${ERREUR_PERIODE.DATE}`), 'erreur'); return; }
      const autre = { ...this.filtre, [cle]: v ?? '' };
      if (controlerPeriode(autre.du || null, autre.au || null)) { this.app.message(texte(`rentabilite.periodes.${ERREUR_PERIODE.ORDRE}`), 'erreur'); return; }
      this.filtre[cle] = v ?? '';
      this.#memoriser();
      this.#charger();
    });
    borne(corps.querySelector('[data-du]'), 'du', BORNE_PERIODE.DEBUT);
    borne(corps.querySelector('[data-au]'), 'au', BORNE_PERIODE.FIN);
    const reference = creerCombo({
      options: [
        ...(d.controle ? [{ valeur: 'controle', libelle: texte('rentabilite_btp.chantier.reference_controle', { date: formatDateHeure(d.controle.le) }) }] : []),
        ...d.photos.map((ph) => ({ valeur: `photo:${ph.id}`, libelle: texte('rentabilite_btp.chantier.reference_photo', { date: formatDate(ph.date), libelle: ph.libelle ?? texte(`rentabilite_btp.photos.types.${ph.type}`) }) })),
      ],
      valeur: this.filtre.reference, vide: true, titre: texte('rentabilite_btp.chantier.comparer_titre'),
    });
    corps.querySelector('[data-reference]').append(reference);
    reference.addEventListener('change', () => { this.filtre.reference = reference.valeurCombo ?? ''; this.#memoriser(); this.#charger(); });
    corps.querySelector('[data-heures]').addEventListener('change', (e) => {
      this.filtre.heures = e.target.checked;
      ecrireStockage(CLE_HEURES, this.filtre.heures ? '1' : '0');
      this.#rendreDetail();
    });
    corps.querySelector('[data-previsions-colonnes]').addEventListener('change', (e) => {
      this.filtre.previsions = e.target.checked;
      ecrireStockage(CLE_PREVU, this.filtre.previsions ? '1' : '0');
      this.#rendreDetail();
    });
    this.resultats = new TableauResultats(corps.querySelector('[data-resultats]'));
    corps.querySelector('[data-controle]').addEventListener('click', async () => {
      try {
        await api.rentabilite.controler([c.id]);
        this.app.message(texte('rentabilite_btp.chantier.controle_fait'), 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    });
    corps.querySelector('[data-photo]').addEventListener('click', async () => {
      const libelle = await saisir(texte('rentabilite_btp.chantier.photo_libelle'), '', { titre: texte('rentabilite_btp.chantier.photo') });
      if (libelle === null) return;
      try {
        await api.rentabilite.photographier(c.id, { date: this.filtre.au || null, libelle: libelle.trim() || null });
        this.app.message(texte('rentabilite_btp.chantier.photo_faite'), 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    });
    corps.querySelector('[data-recalculer]').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await api.rentabilite.recalculer(c.id);
        this.app.message(texte('rentabilite_btp.chantier.recalcule', { ajouts: r.ajouts, retraits: r.retraits, modifies: r.modifies }), r.etat === 'ERREUR' ? 'erreur' : 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); ev.target.disabled = false; }
    });
    this.tableau = new TableauDetail(corps.querySelector('[data-detail]'), {
      ouvrirFaits: (f, nouvelle) => {
        const enPeriode = [...COLONNES_DETAIL, ...COLONNES_PREVISION].find((x) => x.code === f.colonne)?.periode;
        this.app.naviguer(urlFaits(c.id, { ...f, du: enPeriode ? this.filtre.du : null, au: this.filtre.au }), { nouvelleFenetre: nouvelle });
      },
    });
    this.#rendreDetail();
    this.graphiques = new GraphiquesEvolution(corps.querySelector('[data-graphiques]'));
    this.evolution = null;
    this.#chargerEvolution();
    this.#rendrePrevisions(corps.querySelector('[data-previsions]'));
    this.#rendreFacturation(corps.querySelector('[data-facturation]'));
    this.#rendreAcomptes(corps.querySelector('[data-acomptes]'));
    this.#rendrePhotos(corps.querySelector('[data-photos]'));
    this.#rendreControles(corps.querySelector('[data-controles]'));
  }

  /** Dernier contrôle de l'utilisateur et changements nets depuis (lien vers la page des changements). */
  #controleHtml(d) {
    if (!d.controle) return texteHtml('rentabilite.liste.jamais_controle');
    const lien = d.controle.changements
      ? ` · <a href="/rentabilite/changements/${Number(d.chantier.id)}">${echapper(pluriel('rentabilite_btp.chantier.changements', d.controle.changements, { nombre: d.controle.changements }))}</a>`
      : ` · ${texteHtml('rentabilite_btp.chantier.aucun_changement')}`;
    return `${texteHtml('rentabilite_btp.chantier.controle_par', { date: formatDateHeure(d.controle.le), par: d.controle.par })}${lien}`;
  }

  /**
   * Saisies prévisionnelles du chantier (lot 6, § 10.1) : liste, saisie, solde (pièce proposée ou motif), journal ;
   * chaque écriture recalcule le chantier côté serveur, la page est relue.
   */
  async #rendrePrevisions(zone) {
    const id = this.donnees.chantier.id;
    let d;
    try { d = await api.rentabilite.previsions(id); } catch (e) { this.app.erreur(e); zone.innerHTML = ''; return; }
    const peut = (a) => this.app.peut(NOEUD_PREVISIONS, a);
    const panneau = new PanneauPrevisions(zone, {
      peut: { creer: peut(ACTION_DROIT.CREER), modifier: peut(ACTION_DROIT.MODIFIER), supprimer: peut(ACTION_DROIT.SUPPRIMER) },
      actions: {
        creer: (s) => api.rentabilite.creerPrevision(id, s),
        modifier: (p, s) => api.rentabilite.modifierPrevision(p, s),
        solder: (p, r) => api.rentabilite.solderPrevision(p, r),
        rouvrir: (p) => api.rentabilite.rouvrirPrevision(p),
        supprimer: (p) => api.rentabilite.supprimerPrevision(p),
        journal: (p) => api.rentabilite.journalPrevision(p),
      },
      choisirTiers: async () => {
        const { annuaire } = await this.app.services();
        const p = await choisirPersonne({ annuaire, titre: texte('rentabilite_btp.chantier.previsions_tiers') });
        return p ? { id: p.id, libelle: p.nom_commercial || p.raison_sociale } : null;
      },
      ouvrirPiece: (ent, nouvelle) => this.app.naviguer(urlDocument(ent), { nouvelleFenetre: nouvelle }),
      apresEcriture: async (succes) => {
        this.app.message(texte(`rentabilite.previsions.succes.${succes}`), 'succes');
        await this.#charger();
      },
      erreur: (e) => this.app.erreur(e),
    });
    panneau.rendre(d);
  }

  /** Graphiques d'évolution (lot 8, § 10.3) : photos du chantier puis aujourd'hui ; redessinés au changement PA / PR. */
  async #chargerEvolution() {
    try { this.evolution = await api.rentabilite.evolution(this.donnees.chantier.id); } catch (e) { this.app.erreur(e); return; }
    this.graphiques.rendre(this.evolution, { cout: this.filtre.cout });
  }

  /** Prévisionnel de facturation du chantier (lot 7, § 10.2) : facturé et prévu par mois, versions, saisie. */
  async #rendreFacturation(zone) {
    const id = this.donnees.chantier.id;
    let d;
    try { d = await api.rentabilite.facturation(id); } catch (e) { this.app.erreur(e); zone.innerHTML = ''; return; }
    new PanneauFacturation(zone, {
      peutModifier: this.app.peut(NOEUD_FACTURATION, ACTION_DROIT.MODIFIER),
      enregistrer: (s) => api.rentabilite.enregistrerFacturation(id, s),
      apresEnregistrement: () => this.app.message(texte('rentabilite_btp.facturation.enregistree'), 'succes'),
      erreur: (e) => this.app.erreur(e),
    }).rendre(d);
  }

  /** Acomptes en trésorerie du chantier (R6) : payé, utilisé, reste ; double-clic : faits. */
  #rendreAcomptes(zone) {
    const somme = (i) => this.donnees.agregats.filter((a) => a.indicateur === i).reduce((s, a) => s.plus(Dz(a.pv)), Dz(0));
    const paye = somme(INDICATEUR.ACOMPTE_PAYE);
    const utilise = somme(INDICATEUR.ACOMPTE_UTILISE);
    if (paye.isZero() && utilise.isZero()) { zone.innerHTML = ''; return; }
    const reste = paye.minus(utilise);
    const cellule = (v, indicateurs) => `<td class="montant${v.isNegative() ? ' rentabilite-anomalie' : ''}" data-faits="${indicateurs.join(',')}" title="${texteHtml('rentabilite.detail.ouvrir_faits')}">${montant(v.toString())}</td>`;
    zone.innerHTML = `<h2>${texteHtml('rentabilite_btp.chantier.acomptes')}</h2>
      <table class="tableau-compact rentabilite-acomptes"><thead><tr><th class="montant">${texteHtml('rentabilite.colonnes.acompte_paye.libelle')}</th>
        <th class="montant">${texteHtml('rentabilite.colonnes.acompte_utilise.libelle')}</th><th class="montant">${texteHtml('rentabilite.colonnes.acompte_reste.libelle')}</th></tr></thead>
      <tbody><tr>${cellule(paye, [INDICATEUR.ACOMPTE_PAYE])}${cellule(utilise, [INDICATEUR.ACOMPTE_UTILISE])}${cellule(reste, [INDICATEUR.ACOMPTE_PAYE, INDICATEUR.ACOMPTE_UTILISE])}</tr></tbody></table>
      <p class="aide">${texteHtml('rentabilite_btp.chantier.acomptes_aide')}</p>`;
    zone.querySelector('table').addEventListener('dblclick', (ev) => {
      const td = ev.target.closest('[data-faits]');
      if (td) this.app.naviguer(urlFaits(this.donnees.chantier.id, { indicateurs: td.dataset.faits.split(','), au: this.filtre.au }), { nouvelleFenetre: ev.ctrlKey || ev.metaKey });
    });
  }

  /** Photos du chantier (mensuelles et à la demande) : comparer, supprimer une photo manuelle. */
  #rendrePhotos(zone) {
    const l = this.donnees.photos ?? [];
    if (!l.length) { zone.innerHTML = ''; return; }
    zone.innerHTML = `<details><summary>${echapper(pluriel('rentabilite_btp.photos.titre', l.length, { nombre: l.length }))}</summary>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.photos.date')}</th><th>${texteHtml('rentabilite_btp.photos.type')}</th>
        <th>${texteHtml('rentabilite_btp.photos.libelle')}</th><th>${texteHtml('rentabilite_btp.photos.par')}</th><th class="cellule-boutons"></th></tr></thead>
      <tbody>${l.map((ph) => `<tr><td>${formatDate(ph.date)}</td><td>${texteHtml(`rentabilite_btp.photos.types.${ph.type}`)}</td><td>${echapper(ph.libelle ?? '')}</td>
        <td>${echapper(ph.par ?? '')} ${formatDateHeure(ph.le)}</td>
        <td class="cellule-boutons"><button type="button" data-comparer="${ph.id}" title="${texteHtml('rentabilite_btp.photos.comparer')}">${iconeHtml('rentabilite_btp_rapprochement')}</button>
        ${ph.type === 'MANUEL' ? `<button type="button" data-supprimer="${ph.id}" title="${texteHtml('rentabilite_btp.photos.supprimer')}">${iconeHtml('rentabilite_btp_vue_supprimer')}</button>` : ''}</td></tr>`).join('')}</tbody></table></details>`;
    zone.querySelectorAll('[data-comparer]').forEach((b) => b.addEventListener('click', () => {
      this.filtre.reference = `photo:${b.dataset.comparer}`;
      this.#memoriser();
      this.#charger();
    }));
    zone.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmer(texte('rentabilite_btp.photos.supprimer_confirmer'))) return;
      try {
        await api.rentabilite.supprimerPhoto(Number(b.dataset.supprimer));
        if (this.filtre.reference === `photo:${b.dataset.supprimer}`) this.filtre.reference = '';
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    }));
  }

  #memoriser() { this.app.routeur?.remplacerUrl?.(this.urlCourante()); }

  #rendreDetail() {
    const r = this.donnees.reference;
    const libelle = r ? (r.code === 'controle' ? texte('rentabilite_btp.chantier.reference_controle', { date: formatDateHeure(r.le) })
      : texte('rentabilite_btp.chantier.reference_photo', { date: formatDate(r.au), libelle: '' }).trim()) : null;
    const ordre = this.filtre.ordre === '' ? undefined : this.filtre.ordre;
    this.tableau.rendre(this.donnees, { cout: this.filtre.cout, ordre, periode: !!this.donnees.du, heures: this.filtre.heures, previsions: this.filtre.previsions,
      reference: r ? { libelle, agregats: r.agregats } : null });
    this.resultats.rendre(this.donnees, { ordre, periode: !!this.donnees.du, voirCouts: this.donnees.voir_couts });
    if (this.evolution) this.graphiques.rendre(this.evolution, { cout: this.filtre.cout });
  }

  /** Contrôles (§ 10) : pointages non valorisés, valorisés au taux du service, sorties sans prix, tâches sans taux. */
  #rendreControles(zone) {
    const l = this.donnees.controles ?? [];
    if (!l.length) { zone.innerHTML = ''; return; }
    zone.innerHTML = `<h2>${iconeHtml('rentabilite_anomalie')} ${texteHtml('rentabilite_btp.controles.titre')}</h2>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.controles.regle')}</th><th class="montant">${texteHtml('rentabilite_btp.controles.nombre')}</th>
        <th class="montant">${texteHtml('rentabilite_btp.controles.heures')}</th>${this.donnees.voir_couts ? `<th class="montant">${texteHtml('rentabilite_btp.controles.montant')}</th>` : ''}</tr></thead>
      <tbody>${l.map((x) => `<tr><td><a href="${urlFaits(this.donnees.chantier.id, { au: this.filtre.au })}&regle=${encodeURIComponent(x.regle)}">${texteHtml(`rentabilite_btp.regles.${x.regle}`)}</a></td>
        <td class="montant">${x.nb}</td><td class="montant">${x.heures === null ? '' : montant(x.heures)}</td>${this.donnees.voir_couts ? `<td class="montant">${montant(x.pa)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
}

/**
 * Prévisionnel de facturation de tous les chantiers visibles (lot 7, § 10.2) : chantiers × mois, prévu de la dernière
 * version et facturé du mois ; période du… au (mois), exclus et clos ; un chantier ouvre son Détail.
 */
export class PageRentabiliteFacturation extends PageBase {
  icone = icone('rentabilite_facturation');

  urlCourante() {
    const f = this.filtre ?? {};
    const p = new URLSearchParams(Object.entries({ du: f.du, au: f.au, exclus: f.exclus ? '1' : '', clos: f.clos ? '1' : '' }).filter(([, v]) => v));
    return `/rentabilite/facturation${p.size ? `?${p}` : ''}`;
  }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.facturation');
    this.filtre = { du: this.requete.du ?? '', au: this.requete.au ?? '', exclus: this.requete.exclus === '1', clos: this.requete.clos === '1' };
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_facturation')} ${texteHtml('rentabilite_btp.routes.facturation')}</h1>
        <div class="barre-outils"><div class="groupe-outils"><a class="bouton" href="/rentabilite">${iconeHtml('rentabilite_detail')} ${texteHtml('rentabilite_btp.routes.accueil')}</a></div></div></div>
      <p class="ligne">
        <label title="${texteHtml('rentabilite_btp.facturation.periode_titre')}">${texteHtml('rentabilite_btp.liste.du')} <input type="text" size="10" data-du value="${this.filtre.du ? formatDate(this.filtre.du) : ''}"></label>
        <label title="${texteHtml('rentabilite_btp.facturation.periode_titre')}">${texteHtml('rentabilite_btp.liste.au')} <input type="text" size="10" data-au value="${this.filtre.au ? formatDate(this.filtre.au) : ''}"></label>
        <label title="${texteHtml('rentabilite_btp.liste.exclus_titre')}"><input type="checkbox" data-exclus${this.filtre.exclus ? ' checked' : ''}> ${texteHtml('rentabilite_btp.liste.exclus')}</label>
        <label><input type="checkbox" data-clos${this.filtre.clos ? ' checked' : ''}> ${texteHtml('rentabilite_btp.liste.clos')}</label></p>
      <div class="rentabilite-zone-liste" data-liste></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    this.tableau = new TableauFacturationListe($('[data-liste]'), {
      ouvrirDetail: (c, nouvelle) => this.app.naviguer(`/rentabilite/chantier/${c}`, { nouvelleFenetre: nouvelle }),
    });
    const borne = (champ, cle, b) => champ.addEventListener('change', () => {
      const v = lireBorne(champ, b);
      if (v === undefined) { this.app.message(texte(`rentabilite.periodes.${ERREUR_PERIODE.DATE}`), 'erreur'); return; }
      const autre = { ...this.filtre, [cle]: v ?? '' };
      if (controlerPeriode(autre.du || null, autre.au || null)) { this.app.message(texte(`rentabilite.periodes.${ERREUR_PERIODE.ORDRE}`), 'erreur'); return; }
      this.filtre[cle] = v ?? '';
      this.#charger();
    });
    borne($('[data-du]'), 'du', BORNE_PERIODE.DEBUT);
    borne($('[data-au]'), 'au', BORNE_PERIODE.FIN);
    for (const cle of ['exclus', 'clos']) $(`[data-${cle}]`).addEventListener('change', (e) => { this.filtre[cle] = e.target.checked; this.#charger(); });
    await this.#charger();
  }

  reprendre() { this.#charger(); }

  async #charger() {
    this.app.routeur?.remplacerUrl?.(this.urlCourante());
    try {
      this.tableau.rendre(await api.rentabilite.facturationListe({ du: this.filtre.du, au: this.filtre.au, exclus: this.filtre.exclus, clos: this.filtre.clos }));
    } catch (e) { this.app.erreur(e); }
  }
}

/** Faits d'un chiffre (§ 8) : regroupés par pièce, pièces annulées masquées par défaut, ⧉ nouvelle fenêtre. */
export class PageRentabiliteFaits extends PageBase {
  icone = icone('rentabilite_faits');

  urlCourante() {
    const p = new URLSearchParams(Object.entries(this.requete).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return `/rentabilite/faits?${p}`;
  }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.faits');
    const r = this.requete;
    this.annulees = false;
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre" data-titre>${iconeHtml('rentabilite_faits')} ${texteHtml('rentabilite_btp.routes.faits')}</h1>
        <div class="barre-outils"><div class="groupe-outils"><button type="button" data-fenetre title="${texteHtml('rentabilite_btp.faits.fenetre')}">${iconeHtml('rentabilite_nouvelle_fenetre')}</button></div></div></div>
      <p class="aide" data-filtre></p>
      <p class="ligne"><label><input type="checkbox" data-annulees> ${texteHtml('rentabilite.faits.annulees')}</label></p>
      <div data-faits></div></div>`;
    this.conteneur.querySelector('[data-fenetre]').addEventListener('click', () => this.app.naviguer(this.urlCourante(), { nouvelleFenetre: true }));
    this.conteneur.querySelector('[data-annulees]').addEventListener('change', (e) => { this.annulees = e.target.checked; this.#rendre(); });
    try {
      this.donnees = await api.rentabilite.faits(r.chantier, { indicateur: r.indicateur, nature: r.nature, ordre: r.ordre, composante: r.composante, piece: r.piece, du: r.du, au: r.au });
    } catch (e) { this.app.erreur(e); return; }
    const d = this.donnees;
    if (r.regle) d.faits = d.faits.filter((f) => f.afa_regle === r.regle);
    const c = d.chantier;
    this.titre = texte('rentabilite_btp.faits.titre', { code: c.code });
    this.conteneur.querySelector('[data-titre]').innerHTML = `${iconeHtml('rentabilite_faits')} ${texteHtml('rentabilite_btp.faits.titre', { code: c.code })}`;
    const colonne = r.colonne ? texte(`rentabilite.colonnes.${r.colonne}.libelle`) : (r.indicateur ?? '').split(',').filter(Boolean).map((i) => texte(`rentabilite.indicateurs.${i}`)).join(', ');
    this.conteneur.querySelector('[data-filtre]').innerHTML = [
      `<a href="/rentabilite/chantier/${Number(c.id)}">${iconeHtml('rentabilite_detail')} ${echapper(c.code)} ${echapper(c.libelle ?? '')}</a>`,
      colonne ? echapper(colonne) : '', r.ligne ? echapper(r.ligne) : '', r.regle ? texteHtml(`rentabilite_btp.regles.${r.regle}`) : '',
      r.du ? texteHtml('rentabilite_btp.faits.depuis', { date: formatDate(r.du) }) : '',
      r.au ? texteHtml('rentabilite_btp.faits.jusquau', { date: formatDate(r.au) }) : '',
    ].filter(Boolean).join(' · ');
    this.#rendre();
  }

  #rendre() {
    const d = this.donnees;
    if (!d) return;
    const natures = new Map(d.natures.map((n) => [n.id, `${n.code} – ${n.libelle}`]));
    const ordres = new Map(d.ordres.map((o) => [o.id, o.numero ?? `#${o.id}`]));
    new TableauFaits(this.conteneur.querySelector('[data-faits]'), {
      annulees: this.annulees, voirCouts: d.voir_couts,
      libelleRegle: (code) => texte(`rentabilite_btp.regles.${code}`),
      libelleNature: (id) => (id === null || id === undefined ? texte('rentabilite.detail.non_ventile') : natures.get(id) ?? ''),
      libelleOrdre: (id) => (id === null || id === undefined ? '' : ordres.get(id) ?? ''),
      ouvrirPiece: (id, nouvelle) => this.app.naviguer(urlDocument(id), { nouvelleFenetre: nouvelle }),
    }).rendre(d);
  }
}

/**
 * Ce qui a changé (§ 10.4) depuis le dernier contrôle de l'utilisateur (ou un calcul donné) : faits ajoutés ou modifiés,
 * faits retirés, regroupés par pièce ; « ✓ Contrôlé » marque le chantier contrôlé au dernier calcul.
 */
export class PageRentabiliteChangements extends PageBase {
  icone = icone('rentabilite_faits');

  urlCourante() { return `/rentabilite/changements/${encodeURIComponent(this.params.id)}${this.requete.calcul ? `?calcul=${encodeURIComponent(this.requete.calcul)}` : ''}`; }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.changements');
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre" data-titre>${iconeHtml('rentabilite_faits')} ${texteHtml('rentabilite_btp.routes.changements')}</h1>
        <div class="barre-outils"><div class="groupe-outils"><button type="button" data-controle title="${texteHtml('rentabilite_btp.chantier.controle_titre')}">${iconeHtml('rentabilite_btp_controle')} ${texteHtml('rentabilite_btp.liste.controle')}</button></div></div></div>
      <p class="aide" data-depuis></p>
      <h2 data-titre-ajoutes></h2><div data-ajoutes></div>
      <h2 data-titre-retires></h2><div data-retires></div></div>`;
    let d;
    try { d = await api.rentabilite.changements(this.params.id, this.requete.calcul); } catch (e) { this.app.erreur(e); return; }
    const c = d.chantier;
    this.titre = texte('rentabilite_btp.changements.titre', { code: c.code });
    const $ = (s) => this.conteneur.querySelector(s);
    $('[data-titre]').innerHTML = `${iconeHtml('rentabilite_faits')} ${texteHtml('rentabilite_btp.changements.titre', { code: c.code })}`;
    $('[data-depuis]').innerHTML = `<a href="/rentabilite/chantier/${Number(c.id)}?reference=controle">${iconeHtml('rentabilite_detail')} ${echapper(c.code)} ${echapper(c.libelle ?? '')}</a> · ${
      texteHtml('rentabilite_btp.changements.depuis', { date: d.depuis_le ? formatDateHeure(d.depuis_le) : '' })}`;
    $('[data-titre-ajoutes]').textContent = pluriel('rentabilite_btp.changements.ajoutes', d.ajoutes.length, { nombre: d.ajoutes.length });
    $('[data-titre-retires]').textContent = pluriel('rentabilite_btp.changements.retires', d.retires.length, { nombre: d.retires.length });
    const natures = new Map(d.natures.map((n) => [n.id, `${n.code} – ${n.libelle}`]));
    const ordres = new Map(d.ordres.map((o) => [o.id, o.numero ?? `#${o.id}`]));
    const options = {
      annulees: true, voirCouts: d.voir_couts,
      libelleRegle: (code) => texte(`rentabilite_btp.regles.${code}`),
      libelleNature: (id) => (id === null || id === undefined ? texte('rentabilite.detail.non_ventile') : natures.get(id) ?? ''),
      libelleOrdre: (id) => (id === null || id === undefined ? '' : ordres.get(id) ?? ''),
      ouvrirPiece: (id, nouvelle) => this.app.naviguer(urlDocument(id), { nouvelleFenetre: nouvelle }),
    };
    new TableauFaits($('[data-ajoutes]'), options).rendre({ faits: d.ajoutes, pieces: d.pieces });
    new TableauFaits($('[data-retires]'), options).rendre({ faits: d.retires, pieces: d.pieces });
    $('[data-controle]').addEventListener('click', async () => {
      try {
        await api.rentabilite.controler([c.id]);
        this.app.message(texte('rentabilite_btp.chantier.controle_fait'), 'succes');
        this.app.naviguer(`/rentabilite/chantier/${Number(c.id)}`);
      } catch (e) { this.app.erreur(e); }
    });
  }
}

/** Rapprochement (§ 8) : total de chaque pièce ou source et somme de ses faits ; écart non nul en rouge. */
export class PageRentabiliteRapprochement extends PageBase {
  icone = icone('rentabilite_btp_rapprochement');

  urlCourante() { return `/rentabilite/rapprochement/${encodeURIComponent(this.params.id)}`; }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.rapprochement');
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_btp_rapprochement')} ${texteHtml('rentabilite_btp.routes.rapprochement')}</h1></div>
      <p class="aide">${texteHtml('rentabilite_btp.rapprochement.aide')}</p>
      <p class="ligne"><label><input type="checkbox" data-ecarts checked> ${texteHtml('rentabilite_btp.rapprochement.ecarts_seuls')}</label>
        <a href="/rentabilite/chantier/${Number(this.params.id)}">${iconeHtml('rentabilite_detail')} ${texteHtml('rentabilite_btp.rapprochement.retour')}</a></p>
      <div data-lignes></div></div>`;
    try { this.lignes = await api.rentabilite.rapprochement(this.params.id); } catch (e) { this.app.erreur(e); return; }
    const ecarts = this.conteneur.querySelector('[data-ecarts]');
    ecarts.addEventListener('change', () => this.#rendre(ecarts.checked));
    this.#rendre(ecarts.checked);
  }

  #rendre(ecartsSeuls) {
    const zone = this.conteneur.querySelector('[data-lignes]');
    const nonNul = (v) => Number(v) !== 0;
    const lignes = ecartsSeuls ? this.lignes.filter((l) => nonNul(l.ecart)) : this.lignes;
    if (!lignes.length) {
      zone.innerHTML = `<p class="aide">${texteHtml(ecartsSeuls ? 'rentabilite_btp.rapprochement.aucun_ecart' : 'rentabilite_btp.rapprochement.aucune')}</p>`;
      return;
    }
    const piece = (l) => (l.piece ? `<a href="${urlDocument(l.ent_id)}">${echapper(`${l.piece.type_libelle ?? l.piece.type} ${l.piece.numero ?? ''}`)}</a>` : echapper(l.libelle));
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.rapprochement.piece')}</th><th>${texteHtml('rentabilite_btp.rapprochement.indicateur')}</th>
        <th>${texteHtml('rentabilite_btp.rapprochement.champ')}</th><th class="montant">${texteHtml('rentabilite_btp.rapprochement.attendu')}</th>
        <th class="montant">${texteHtml('rentabilite_btp.rapprochement.faits')}</th><th class="montant">${texteHtml('rentabilite_btp.rapprochement.ecart')}</th></tr></thead>
      <tbody>${lignes.map((l) => `<tr><td>${piece(l)}</td><td>${texteHtml(`rentabilite.indicateurs.${l.indicateur}`)}</td><td>${echapper(l.champ)}</td>
        <td class="montant">${montant(l.attendu)}</td>
        <td class="montant"><a href="${urlFaits(this.params.id, { indicateurs: [l.indicateur] })}${l.ent_id ? `&piece=${Number(l.ent_id)}` : ''}">${montant(l.faits)}</a></td>
        <td class="montant${nonNul(l.ecart) ? ' rentabilite-anomalie' : ''}"${nonNul(l.ecart) ? ` title="${texteHtml('rentabilite_btp.rapprochement.ecart_titre')}"` : ''}>${montant(l.ecart)}</td></tr>`).join('')}</tbody></table>`;
  }
}

/** Paramètres (administrateur) : rôle de chaque type de pièce, taux horaire par service, coût du matériel, coefficients de frais généraux. */
export class PageParametresRentabilite extends PageBase {
  icone = icone('rentabilite_detail');
  #modifie = false;

  get modifiee() { return this.#modifie; }

  urlCourante() { return '/parametres/rentabilite'; }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.parametres');
    const admin = this.app.estAdmin();
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_detail')} ${texteHtml('rentabilite_btp.routes.parametres')}</h1></div>
      <h2>${texteHtml('rentabilite_btp.parametres.roles')}</h2><p class="aide">${texteHtml('rentabilite_btp.parametres.roles_aide')}</p><div data-roles></div>
      <h2>${texteHtml('rentabilite_btp.parametres.taux')}</h2><p class="aide">${texteHtml('rentabilite_btp.parametres.taux_aide')}</p><div data-taux></div>
      <h2>${texteHtml('rentabilite_btp.parametres.materiel')}</h2><p class="aide">${texteHtml('rentabilite_btp.parametres.materiel_aide')}</p><div data-materiel></div>
      <h2>${texteHtml('rentabilite_btp.parametres.coefs')}</h2><p class="aide">${texteHtml('rentabilite_btp.parametres.coefs_aide')}</p><div data-coefs></div>
      ${admin ? `<p class="aide">${texteHtml('rentabilite_btp.parametres.recalcul')}</p>` : `<p class="aide">${texteHtml('rentabilite_btp.parametres.lecture')}</p>`}</div>`;
    let p;
    try { p = await api.rentabilite.parametres(); } catch (e) { this.app.erreur(e); return; }
    this.#roles(p.roles, admin);
    this.#taux(p.taux, admin);
    this.#materiel(p.materiel, p.natures, admin);
    this.#coefs(p.coefs, p.natures, admin);
  }

  #bouton(zone, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texte('commun.enregistrer');
    b.addEventListener('click', async () => {
      try { await action(); this.#modifie = false; this.app.message(texte('rentabilite_btp.parametres.enregistre'), 'succes'); } catch (e) { this.app.erreur(e); }
    });
    const p = document.createElement('p');
    p.append(b);
    zone.append(p);
  }

  #roles(roles, admin) {
    const zone = this.conteneur.querySelector('[data-roles]');
    const options = Object.values(ROLE_RENTABILITE).map((r) => ({ valeur: r, libelle: texte(`rentabilite_btp.roles.${r}`), detail: r }));
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.parametres.type')}</th><th>${texteHtml('rentabilite_btp.parametres.famille')}</th>
      <th>${texteHtml('rentabilite_btp.parametres.role')}</th></tr></thead><tbody>${roles.map((r, i) => `<tr data-i="${i}"><td>${echapper(r.libelle)} <small>${echapper(r.type)}</small></td>
      <td>${echapper(r.famille)}</td><td data-role></td></tr>`).join('')}</tbody></table>`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const r = roles[Number(tr.dataset.i)];
      if (!admin) { tr.querySelector('[data-role]').textContent = r.role ? texte(`rentabilite_btp.roles.${r.role}`) : '—'; return; }
      const c = creerCombo({ options, valeur: r.role ?? '', vide: true });
      c.addEventListener('change', () => { r.role = c.valeurCombo || null; this.#modifie = true; });
      tr.querySelector('[data-role]').append(c);
    });
    if (admin) this.#bouton(zone, () => api.rentabilite.enregistrerRoles(roles));
  }

  #taux(taux, admin) {
    const zone = this.conteneur.querySelector('[data-taux]');
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.parametres.service')}</th><th class="montant">${texteHtml('rentabilite_btp.parametres.taux_horaire')}</th></tr></thead>
      <tbody>${taux.map((t, i) => `<tr><td>${echapper(t.service)}</td><td><input data-i="${i}" size="8" inputmode="decimal" class="montant" value="${t.taux === null ? '' : echapper(formatNombre(t.taux, 2))}" ${admin ? '' : 'readonly'}></td></tr>`).join('')}</tbody></table>`;
    zone.querySelectorAll('input[data-i]').forEach((input) => input.addEventListener('change', () => {
      const v = input.value.trim().replace(/\s/g, '').replace(',', '.');
      taux[Number(input.dataset.i)].taux = v === '' ? null : v;
      this.#modifie = true;
    }));
    if (admin) this.#bouton(zone, () => api.rentabilite.enregistrerTaux(taux));
  }

  /** Coût horaire par type de matériel (sous-types en retrait) et nature des heures de matériel. */
  #materiel(materiel, natures, admin) {
    const zone = this.conteneur.querySelector('[data-materiel]');
    const options = natures.map((n) => ({ valeur: String(n.id), libelle: `${n.code} – ${n.libelle}`, detail: n.code }));
    zone.innerHTML = `<p class="ligne"><label>${texteHtml('rentabilite_btp.parametres.nature_materiel')} <span data-nature></span></label></p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.parametres.type_materiel')}</th><th class="montant">${texteHtml('rentabilite_btp.parametres.cout_horaire')}</th></tr></thead>
      <tbody>${materiel.couts.map((c, i) => `<tr><td${c.parent ? ' class="rentabilite-sous-type"' : ''}>${echapper(c.libelle)}</td>
        <td><input data-i="${i}" size="8" inputmode="decimal" class="montant" value="${c.cout === null ? '' : echapper(formatNombre(c.cout, 2))}" ${admin ? '' : 'readonly'}></td></tr>`).join('')}</tbody></table>`;
    const nature = creerCombo({ options, valeur: materiel.nature === null ? '' : String(materiel.nature), vide: true });
    nature.placeholder = texte('rentabilite_btp.parametres.nature_materiel_vide');
    if (!admin) nature.readOnly = true;
    nature.addEventListener('change', () => { materiel.nature = nature.valeurCombo ? Number(nature.valeurCombo) : null; this.#modifie = true; });
    zone.querySelector('[data-nature]').append(nature);
    zone.querySelectorAll('input[data-i]').forEach((input) => input.addEventListener('change', () => {
      const v = input.value.trim().replace(/\s/g, '').replace(',', '.');
      materiel.couts[Number(input.dataset.i)].cout = v === '' ? null : v;
      this.#modifie = true;
    }));
    if (admin) this.#bouton(zone, () => api.rentabilite.enregistrerMateriel(materiel));
  }

  #coefs(coefs, natures, admin) {
    const zone = this.conteneur.querySelector('[data-coefs]');
    const options = natures.map((n) => ({ valeur: String(n.id), libelle: `${n.code} – ${n.libelle}`, detail: n.code }));
    const rendre = () => {
      zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.parametres.nature')}</th><th>${texteHtml('rentabilite_btp.parametres.depuis')}</th>
        <th class="montant">${texteHtml('rentabilite_btp.parametres.coef')}</th>${admin ? '<th class="cellule-boutons"></th>' : ''}</tr></thead>
        <tbody>${coefs.map((c, i) => `<tr data-i="${i}"><td data-nature></td><td><input type="date" data-depuis value="${echapper(c.depuis ?? '')}" ${admin ? '' : 'readonly'}></td>
          <td><input data-coef size="8" inputmode="decimal" class="montant" value="${echapper(formatNombre(c.coef, 4))}" ${admin ? '' : 'readonly'}></td>
          ${admin ? `<td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('rentabilite_btp.parametres.retirer')}">${iconeHtml('retirer')}</button></td>` : ''}</tr>`).join('')}</tbody></table>
        ${admin ? `<p><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('rentabilite_btp.parametres.ajouter')}</button></p>` : ''}`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const c = coefs[Number(tr.dataset.i)];
        const nature = creerCombo({ options, valeur: c.nat_id === null ? '' : String(c.nat_id), vide: true, titre: texte('rentabilite_btp.parametres.toutes') });
        if (!admin) nature.readOnly = true;
        nature.placeholder = texte('rentabilite_btp.parametres.toutes');
        nature.addEventListener('change', () => { c.nat_id = nature.valeurCombo ? Number(nature.valeurCombo) : null; this.#modifie = true; });
        tr.querySelector('[data-nature]').append(nature);
        const depuis = champDate(tr.querySelector('[data-depuis]'));
        depuis.addEventListener('change', () => { c.depuis = depuis.value; this.#modifie = true; });
        tr.querySelector('[data-coef]').addEventListener('change', (e) => { c.coef = e.target.value.trim().replace(/\s/g, '').replace(',', '.'); this.#modifie = true; });
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { coefs.splice(Number(tr.dataset.i), 1); this.#modifie = true; rendre(); });
      });
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
        coefs.push({ nat_id: null, depuis: aujourdhui(), coef: '1' });
        this.#modifie = true;
        rendre();
      });
      if (admin) this.#bouton(zone, () => api.rentabilite.enregistrerCoefs(coefs));
    };
    rendre();
  }
}
