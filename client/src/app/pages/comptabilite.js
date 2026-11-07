import { texte, texteHtml, textesParCode, pairesParCode, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE, urlDocument } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, alerter, formatNombre, formatDateHeure } from '@logibtp/socle/ui';
import { normaliserCompte, normaliserCompteTiers, MESSAGES_COMPTES, compteVentilation, ORIGINES_VENTILATION } from '@logibtp/comptabilite';
import { api } from '../api.js';

// Module Comptabilité, base, lot 1 (ANALYSE-MODULE-COMPTABILITE.md § 4.1 à 4.3) : plan comptable (`/comptabilite/plan`),
// tiers indexés par compte (`/comptabilite/tiers`), paramètres, collectifs, catégories et taux de TVA
// (`/parametres/comptabilite`) ; lot 2 : types comptables et types de documents (`/parametres/comptabilite`), ventilation
// natures × taux de TVA (`/comptabilite/ventilation`) ; lot 3 : export des écritures (`/comptabilite/export`). Droit : nœud
// `comptabilite` (modifier pour écrire).

// Tables de libellés lues dans le dictionnaire (module Personnalisation).
const options = (prefixe, codes) => pairesParCode(prefixe, codes).map(([valeur, libelle]) => ({ valeur, libelle }));
const CLASSES = textesParCode('comptabilite_btp.classes', ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
const TYPES_COMPTE = options('comptabilite_btp.types_compte', ['GENERAL', 'COLLECTIF', 'TVA', 'TRESORERIE']);
const SENS_COMPTE = options('comptabilite_btp.sens_compte', ['VENTE', 'ACHAT', 'LES_DEUX', 'AUCUN']);
/** Types de comptes de tiers (SpecialisationComptabiliteBtp). */
export const TYPES_COMPTE_TIERS = textesParCode('comptabilite_btp.types_tiers', ['CLIENT', 'FOURNISSEUR', 'SOUS_TRAITANT']);
const COMPORTEMENTS_TVA = options('comptabilite_btp.comportements_tva', ['N', 'A', 'I', 'E']);
const EXIGIBILITES = options('comptabilite_btp.exigibilites', ['E', 'D']);

const libelleOption = (liste, v) => liste.find((o) => o.valeur === v)?.libelle ?? v ?? '';
const optionsComptes = (comptes, filtre = () => true) => comptes.filter((c) => c.actif && filtre(c)).map((c) => ({ valeur: c.code, libelle: `${c.code} – ${c.libelle}` }));
const peutModifier = (app) => app.peut?.('comptabilite', 'MODIFIER') !== false;

/** Combo posée dans l'élément `sel` de `racine`, en lecture seule sans droit ; `ecrire(valeur)` à chaque changement. */
function poserCombo(racine, sel, { options, valeur, vide = true, lecture = false, titre = '' }, ecrire) {
  const c = creerCombo({ options, valeur: valeur ?? '', vide, titre });
  c.readOnly = lecture;
  c.addEventListener('change', () => ecrire(c.valeurCombo === '' ? null : c.valeurCombo));
  racine.querySelector(sel).append(c);
  return c;
}

/** Plan comptable : recherche, filtre par classe, comptes hors de la longueur paramétrée, saisie dans le tableau. */
export class PagePlanComptable extends PageBase {
  icone = icone('comptabilite_btp_plan');

  async ouvrir() {
    this.titre = texte('comptabilite_btp.routes.plan');
    this.recherche = this.requete.recherche ?? '';
    this.classe = this.requete.classe ? Number(this.requete.classe) : null;
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('comptabilite_btp_plan')} ${texteHtml('comptabilite_btp.routes.plan')}</h1>
      <span class="ligne"><input type="search" data-recherche placeholder="${texteHtml('comptabilite_btp.plan.recherche')}" size="24" value="${echapper(this.recherche)}">
      <span data-classe></span><label class="fiche-option"><input type="checkbox" data-non-conformes> ${texteHtml('comptabilite_btp.plan.hors_longueur')}</label>
      <label class="fiche-option"><input type="checkbox" data-inactifs> ${texteHtml('comptabilite_btp.plan.inactifs')}</label>
      ${peutModifier(this.app) ? `<button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('comptabilite_btp.plan.compte')}</button>` : ''}</span></div>
      <p class="aide" data-regle></p><div data-corps></div></div>`;
    const q = (s) => this.conteneur.querySelector(s);
    poserCombo(this.conteneur, '[data-classe]', { options: Object.entries(CLASSES).map(([k, v]) => ({ valeur: Number(k), libelle: `${k} – ${v}` })), valeur: this.classe, titre: texte('comptabilite_btp.plan.classe') },
      (v) => { this.classe = v === null ? null : Number(v); this.#rendre(); });
    q('[data-recherche]').addEventListener('input', (e) => { this.recherche = e.target.value; this.#rendre(); });
    q('[data-non-conformes]').addEventListener('change', (e) => { this.nonConformes = e.target.checked; this.#rendre(); });
    q('[data-inactifs]').addEventListener('change', (e) => { this.inactifs = e.target.checked; this.#rendre(); });
    q('[data-ajouter]')?.addEventListener('click', () => { this.nouveau = { code: '', libelle: '', type: 'GENERAL', sens: 'AUCUN', libelle_court: '', lettrable: false, actif: true }; this.#rendre(); });
    try {
      [this.parametres, this.comptes] = await Promise.all([api.comptabilite.parametres(), api.comptabilite.plan()]);
    } catch (e) { q('[data-corps]').innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const p = this.parametres;
    q('[data-regle]').innerHTML = `${p.longueur_comptes_generaux ? (p.completer_zeros ? texteHtml('comptabilite_btp.plan.regle_exacte', { longueur: p.longueur_comptes_generaux }) : texteHtml('comptabilite_btp.plan.regle_max', { longueur: p.longueur_comptes_generaux })) : texteHtml('comptabilite_btp.plan.regle_libre')}
      · <a href="/parametres/comptabilite">${texteHtml('comptabilite_btp.plan.parametres')}</a> · <a href="/comptabilite/tiers">${texteHtml('comptabilite_btp.routes.tiers')}</a>`;
    this.#rendre();
  }

  urlCourante() {
    const p = new URLSearchParams();
    if (this.recherche) p.set('recherche', this.recherche);
    if (this.classe) p.set('classe', this.classe);
    return `/comptabilite/plan${p.size ? `?${p}` : ''}`;
  }

  #visibles() {
    const r = this.recherche.trim().toLowerCase();
    return this.comptes.filter((c) => (!this.classe || c.classe === this.classe) && (this.inactifs || c.actif) && (!this.nonConformes || !c.conforme)
      && (!r || c.code.startsWith(r) || c.libelle.toLowerCase().includes(r)));
  }

  #rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.comptes) return;
    const ecrire = peutModifier(this.app);
    const ro = ecrire ? '' : 'readonly';
    const lignes = this.#visibles();
    const n = this.nouveau;
    corps.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.plan.compte')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('comptabilite_btp.plan.type')}</th><th>${texteHtml('comptabilite_btp.plan.sens')}</th><th>${texteHtml('comptabilite_btp.plan.libelle_court')}</th>
      <th>${texteHtml('comptabilite_btp.plan.lettrable')}</th><th>${texteHtml('comptabilite_btp.plan.actif')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${n ? `<tr data-nouveau><td><input data-c="code" size="10" value="${echapper(n.code)}" placeholder="${texteHtml('commun.code')}"><div class="aide" data-apercu></div></td>
        <td><input data-c="libelle" size="40" value="${echapper(n.libelle)}"></td><td data-type></td><td data-sens></td>
        <td><input data-c="libelle_court" size="20" maxlength="35" value="${echapper(n.libelle_court)}"></td>
        <td><input type="checkbox" data-c="lettrable" ${n.lettrable ? 'checked' : ''}></td><td><input type="checkbox" data-c="actif" checked></td>
        <td class="cellule-boutons"><button type="button" data-creer title="${texteHtml('comptabilite_btp.plan.creer')}">${iconeHtml('comptabilite_btp_creer')}</button><button type="button" data-abandon title="${texteHtml('comptabilite_btp.plan.abandonner')}">${iconeHtml('retirer')}</button></td></tr>` : ''}
      ${lignes.map((c) => `<tr data-code="${echapper(c.code)}"${c.actif ? '' : ' class="discret"'}>
        <td title="${c.conforme ? '' : texteHtml('comptabilite_btp.plan.hors_longueur_titre')}">${echapper(c.code)}${c.conforme ? '' : ` ${iconeHtml('comptabilite_btp_hors_longueur')}`}</td>
        <td><input data-c="libelle" size="40" value="${echapper(c.libelle)}" ${ro}></td><td data-type></td><td data-sens></td>
        <td><input data-c="libelle_court" size="20" maxlength="35" value="${echapper(c.libelle_court ?? '')}" ${ro}></td>
        <td><input type="checkbox" data-c="lettrable" ${c.lettrable ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>
        <td><input type="checkbox" data-c="actif" ${c.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${ecrire ? `<button type="button" data-supprimer title="${texteHtml('comptabilite_btp.plan.supprimer')}">${iconeHtml('supprimer')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table><p class="aide">${echapper(pluriel('comptabilite_btp.plan.nombre', lignes.length, { total: this.comptes.length }))}</p>`;
    if (n) this.#brancherNouveau(corps.querySelector('tr[data-nouveau]'), n);
    corps.querySelectorAll('tr[data-code]').forEach((tr) => {
      const c = this.comptes.find((x) => x.code === tr.dataset.code);
      const enregistrer = async () => {
        try {
          const r = await api.comptabilite.modifierCompte(c.code, c);
          Object.assign(c, r);
          tr.classList.toggle('discret', !c.actif);
        } catch (e) { this.app.message(e.message, 'erreur'); }
      };
      poserCombo(tr, '[data-type]', { options: TYPES_COMPTE, valeur: c.type, vide: false, lecture: !ecrire }, (v) => { c.type = v; enregistrer(); });
      poserCombo(tr, '[data-sens]', { options: SENS_COMPTE, valeur: c.sens, vide: false, lecture: !ecrire }, (v) => { c.sens = v; enregistrer(); });
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        c[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.value;
        enregistrer();
      }));
      tr.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        if (!await confirmer(texte('comptabilite_btp.plan.confirmer', { compte: `${c.code} – ${c.libelle}` }))) return;
        try {
          await api.comptabilite.supprimerCompte(c.code);
          this.comptes.splice(this.comptes.indexOf(c), 1);
          this.#rendre();
        } catch (e) { await alerter(e.message, { titre: texte('comptabilite_btp.plan.impossible') }); }
      });
    });
  }

  #brancherNouveau(tr, n) {
    const apercu = () => {
      const p = this.parametres;
      const r = normaliserCompte(n.code, { longueur: p.longueur_comptes_generaux, completerZeros: p.completer_zeros });
      tr.querySelector('[data-apercu]').textContent = !n.code.trim() ? '' : r.erreur ? MESSAGES_COMPTES[r.erreur] : r.code !== n.code.trim() ? `${icone('comptabilite_btp_vers')} ${r.code}` : '';
      return r;
    };
    poserCombo(tr, '[data-type]', { options: TYPES_COMPTE, valeur: n.type, vide: false }, (v) => { n.type = v; });
    poserCombo(tr, '[data-sens]', { options: SENS_COMPTE, valeur: n.sens, vide: false }, (v) => { n.sens = v; });
    tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener(x.type === 'checkbox' ? 'change' : 'input', () => {
      n[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.value;
      if (x.dataset.c === 'code') {
        apercu();
        // Sens proposé selon la classe : 6 achat, 7 vente.
        const s = { 6: 'ACHAT', 7: 'VENTE' }[n.code.trim()[0]];
        if (s && n.sens === 'AUCUN') { n.sens = s; tr.querySelector('[data-sens] input').definirValeur(s); }
      }
    }));
    tr.querySelector('[data-c="code"]').focus();
    tr.querySelector('[data-abandon]').addEventListener('click', () => { this.nouveau = null; this.#rendre(); });
    tr.querySelector('[data-creer]').addEventListener('click', async () => {
      if (apercu().erreur) return;
      try {
        const c = await api.comptabilite.creerCompte(n);
        this.comptes.push(c);
        this.comptes.sort((a, b) => a.code.localeCompare(b.code));
        this.nouveau = null;
        this.app.message(texte('comptabilite_btp.plan.cree', { code: c.code }), 'succes');
        this.#rendre();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }
}

/**
 * Tiers indexés par compte : une ligne par type de compte (client, fournisseur, sous-traitant), triées par compte ;
 * compte auxiliaire et collectif saisissables (vide = hérité ou collectif du type), comptes manquants générés.
 */
export class PageTiersComptables extends PageBase {
  icone = icone('comptabilite_btp_tiers');
  #modifies = new Map();

  get modifiee() { return this.#modifies.size > 0; }

  async ouvrir() {
    this.titre = texte('comptabilite_btp.routes.tiers');
    this.recherche = this.requete.recherche ?? '';
    this.type = this.requete.type ?? null;
    this.segment = this.requete.segment ?? 'TOUS';
    const ecrire = peutModifier(this.app);
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('comptabilite_btp_tiers')} ${texteHtml('comptabilite_btp.routes.tiers')}</h1>
      <span class="ligne"><input type="search" data-recherche placeholder="${texteHtml('comptabilite_btp.tiers.recherche')}" size="24" value="${echapper(this.recherche)}">
      <span data-type></span><span data-segment></span>
      ${ecrire ? `<button type="button" data-generer title="${texteHtml('comptabilite_btp.tiers.generer_titre')}">${iconeHtml('comptabilite_btp_generer')} ${texteHtml('comptabilite_btp.tiers.generer')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button>` : ''}
      </span></div>
      <p class="aide">${texteHtml('comptabilite_btp.tiers.aide')} · <a href="/comptabilite/plan">${texteHtml('comptabilite_btp.routes.plan')}</a> ·
      <a href="/parametres/comptabilite">${texteHtml('comptabilite_btp.plan.parametres')}</a></p><div data-corps></div></div>`;
    const q = (s) => this.conteneur.querySelector(s);
    poserCombo(this.conteneur, '[data-type]', { options: Object.entries(TYPES_COMPTE_TIERS).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: this.type, titre: texte('comptabilite_btp.tiers.type') },
      (v) => { this.type = v; this.#rendre(); });
    poserCombo(this.conteneur, '[data-segment]', {
      options: options('comptabilite_btp.tiers.segments', ['TOUS', 'SANS', 'DOUBLONS', 'SURCHARGES']),
      valeur: this.segment, vide: false,
    }, (v) => { this.segment = v; this.#rendre(); });
    q('[data-recherche]').addEventListener('input', (e) => { this.recherche = e.target.value; this.#rendre(); });
    q('[data-enregistrer]')?.addEventListener('click', () => this.enregistrer());
    q('[data-generer]')?.addEventListener('click', () => this.#generer());
    await this.#charger();
  }

  urlCourante() {
    const p = new URLSearchParams();
    if (this.recherche) p.set('recherche', this.recherche);
    if (this.type) p.set('type', this.type);
    if (this.segment !== 'TOUS') p.set('segment', this.segment);
    return `/comptabilite/tiers${p.size ? `?${p}` : ''}`;
  }

  async #charger() {
    try {
      [this.parametres, this.plan, this.collectifs, this.tiers] = await Promise.all([
        api.comptabilite.parametres(), api.comptabilite.plan(), api.comptabilite.collectifs(), api.comptabilite.tiers()]);
      this.#modifies.clear();
      this.#rendre();
    } catch (e) { this.conteneur.querySelector('[data-corps]').innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; }
  }

  async enregistrer() {
    if (!this.#modifies.size) return true;
    try {
      this.tiers = await api.comptabilite.enregistrerTiers([...this.#modifies.values()]);
      this.#modifies.clear();
      this.app.message(texte('comptabilite_btp.tiers.enregistres'), 'succes');
      this.#rendre();
      return true;
    } catch (e) { this.app.message(e.message, 'erreur'); return false; }
  }

  async #generer() {
    if (this.#modifies.size && !await this.enregistrer()) return;
    const sans = this.tiers.filter((t) => !t.compte && t.actif && (!this.type || t.type_compte === this.type)).length;
    if (!sans) { this.app.message(texte('comptabilite_btp.tiers.aucun_sans'), 'info'); return; }
    if (!await confirmer(texte('comptabilite_btp.tiers.confirmer_generer', { lignes: pluriel('comptabilite_btp.tiers.sans', sans), type: this.type ? ` (${TYPES_COMPTE_TIERS[this.type]})` : '' }))) return;
    try {
      const r = await api.comptabilite.genererTiers(this.type);
      await this.#charger();
      if (r.refus.length) await alerter(texte('comptabilite_btp.tiers.non_crees', { crees: pluriel('comptabilite_btp.tiers.crees', r.crees) }), { titre: texte('comptabilite_btp.tiers.comptes'), html: `<ul>${r.refus.map((x) => `<li>${echapper(x)}</li>`).join('')}</ul>` });
      else this.app.message(pluriel('comptabilite_btp.tiers.crees', r.crees), 'succes');
    } catch (e) { this.app.message(e.message, 'erreur'); }
  }

  #visibles() {
    const r = this.recherche.trim().toLowerCase();
    return this.tiers.filter((t) => (!this.type || t.type_compte === this.type)
      && (this.segment !== 'SANS' || !t.compte) && (this.segment !== 'DOUBLONS' || t.doublon) && (this.segment !== 'SURCHARGES' || t.collectif_surcharge)
      && (!r || [t.compte, t.raison_sociale, t.code_tiers, t.siret, t.tva_intra].some((x) => String(x ?? '').toLowerCase().includes(r))));
  }

  #rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.tiers) return;
    const ecrire = peutModifier(this.app);
    const collectifsType = new Map(this.collectifs.map((c) => [c.code, c]));
    const optionsCollectifs = optionsComptes(this.plan, (c) => c.type === 'COLLECTIF');
    const lignes = this.#visibles();
    const cle = (t) => `${t.tiers_id}:${t.type_compte}`;
    corps.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.plan.compte')}</th><th>${texteHtml('comptabilite_btp.plan.type')}</th><th>${texteHtml('comptabilite_btp.tiers.tiers')}</th><th>${texteHtml('commun.code')}</th><th>${texteHtml('comptabilite_btp.tiers.pro')}</th>
      <th>${texteHtml('comptabilite_btp.tiers.collectif')}</th><th>${texteHtml('comptabilite_btp.tiers.siret')}</th><th>${texteHtml('comptabilite_btp.tiers.tva')}</th></tr></thead><tbody>
      ${lignes.map((t) => {
        const herite = t.compte_herite;
        const col = collectifsType.get(t.collectif);
        return `<tr data-cle="${cle(t)}"${t.actif ? '' : ' class="discret"'}>
          <td><input data-compte size="14" value="${herite ? '' : echapper(t.compte ?? '')}" placeholder="${herite ? echapper(t.compte) : ''}" ${ecrire ? '' : 'readonly'}
            ${herite ? `title="${texteHtml('comptabilite_btp.tiers.herite')}" class="herite"` : ''}>${t.doublon ? ` <span title="${texteHtml('comptabilite_btp.tiers.doublon')}">${iconeHtml('comptabilite_btp_hors_longueur')}</span>` : ''}</td>
          <td>${echapper(TYPES_COMPTE_TIERS[t.type_compte] ?? t.type_compte)}</td>
          <td><a href="${urlFiche(TYPE_FICHE.PERSONNE, Number(t.tiers_id))}">${echapper(t.raison_sociale)}</a></td><td>${echapper(t.code_tiers ?? '')}</td>
          <td>${t.type_compte === 'CLIENT' ? (t.particulier ? texteHtml('comptabilite_btp.tiers.particulier') : texteHtml('comptabilite_btp.tiers.professionnel')) : ''}</td>
          <td data-collectif title="${col ? texteHtml('comptabilite_btp.tiers.defaut', { libelle: col.libelle, compte: col.compte ?? texte('comptabilite_btp.tiers.sans_compte') }) : ''}"></td>
          <td>${echapper(t.siret ?? '')}</td><td>${echapper(t.tva_intra ?? '')}</td></tr>`;
      }).join('')}
      </tbody></table><p class="aide">${echapper(pluriel('comptabilite_btp.tiers.nombre', lignes.length, { total: this.tiers.length }))}</p>`;
    corps.querySelectorAll('tr[data-cle]').forEach((tr) => {
      const t = lignes.find((x) => cle(x) === tr.dataset.cle);
      const saisie = () => {
        if (!this.#modifies.has(tr.dataset.cle)) {
          this.#modifies.set(tr.dataset.cle, { tiers_id: t.tiers_id, type_compte: t.type_compte, compte: t.compte_herite ? null : t.compte,
            collectif: t.collectif_surcharge ? t.collectif_compte : null });
        }
        return this.#modifies.get(tr.dataset.cle);
      };
      const col = collectifsType.get(t.collectif);
      const combo = poserCombo(tr, '[data-collectif]', { options: optionsCollectifs, valeur: t.collectif_surcharge ? t.collectif_compte : '', lecture: !ecrire },
        (v) => { saisie().collectif = v; });
      if (col?.compte) combo.placeholder = texte('comptabilite_btp.tiers.placeholder', { compte: col.compte });
      const champ = tr.querySelector('[data-compte]');
      champ.addEventListener('change', () => {
        const r = champ.value.trim() ? normaliserCompteTiers(champ.value, { longueur: this.parametres.longueur_comptes_tiers }) : { code: null };
        if (r.erreur) { this.app.message(`${champ.value} : ${MESSAGES_COMPTES[r.erreur]}`, 'erreur'); champ.focus(); return; }
        champ.value = r.code ?? '';
        saisie().compte = r.code;
      });
    });
  }
}

/** Boutons ↑ ↓ d'une ligne d'une liste ordonnée par sa position (ordre enregistré par le serveur). */
const boutonsOrdre = (i, n) => `<button type="button" data-monter title="${texteHtml('comptabilite_btp.ordre.monter')}" ${i ? '' : 'disabled'}>${iconeHtml('comptabilite_btp_monter')}</button>`
  + `<button type="button" data-descendre title="${texteHtml('comptabilite_btp.ordre.descendre')}" ${i < n - 1 ? '' : 'disabled'}>${iconeHtml('comptabilite_btp_descendre')}</button>`;

function lierOrdre(tr, liste, x, rendre) {
  const deplacer = (d) => { const i = liste.indexOf(x); liste.splice(i + d, 0, ...liste.splice(i, 1)); rendre(); };
  tr.querySelector('[data-monter]')?.addEventListener('click', () => deplacer(-1));
  tr.querySelector('[data-descendre]')?.addEventListener('click', () => deplacer(1));
}

/** Bouton Enregistrer d'une section de paramètres. */
const boutonEnregistrer = () => `<span><button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button></span>`;

/** Paramètres de la comptabilité, collectifs par type de tiers, catégories de TVA et comptes des taux (ordre, taux par défaut). */
export class PageParametresComptabilite extends PageBase {
  icone = icone('comptabilite_btp_plan');

  async ouvrir() {
    this.titre = texte('comptabilite_btp.routes.parametres');
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('comptabilite_btp_plan')} ${texteHtml('comptabilite_btp.routes.parametres')}</h1>
      <span class="ligne"><a href="/comptabilite/plan">${texteHtml('comptabilite_btp.routes.plan')}</a> · <a href="/comptabilite/tiers">${texteHtml('comptabilite_btp.routes.tiers')}</a></span></div>
      <section data-parametres></section><section data-collectifs></section><section data-types></section><section data-documents></section>
      <section data-categories></section><section data-taux></section></div>`;
    try {
      [this.parametres, this.plan, this.collectifs, this.categories, this.taux, this.types, this.documents] = await Promise.all([
        api.comptabilite.parametres(), api.comptabilite.plan(), api.comptabilite.collectifs(), api.comptabilite.categoriesTva(), api.comptabilite.tauxTva(),
        api.comptabilite.typesComptables(), api.comptabilite.typesDocuments()]);
    } catch (e) { this.conteneur.querySelector('[data-parametres]').innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    this.#rendreParametres();
    this.#rendreCollectifs();
    this.#rendreTypes();
    this.#rendreDocuments();
    this.#rendreCategories();
    this.#rendreTaux();
  }

  #section(sel) { return this.conteneur.querySelector(sel); }

  #rendreParametres() {
    const p = this.parametres;
    const ecrire = peutModifier(this.app);
    const ro = ecrire ? '' : 'readonly';
    const z = this.#section('[data-parametres]');
    z.innerHTML = `<h2 class="titre-actions">${texteHtml('comptabilite_btp.parametres.comptes')} ${ecrire ? boutonEnregistrer() : ''}</h2>
      <table><tbody>
      <tr><th>${texteHtml('comptabilite_btp.parametres.longueur_generaux')}</th><td><input data-c="longueur_comptes_generaux" size="3" value="${p.longueur_comptes_generaux ?? ''}" ${ro}> ${texteHtml('comptabilite_btp.parametres.chiffres')}</td></tr>
      <tr><th>${texteHtml('comptabilite_btp.parametres.zeros')}</th><td><label><input type="checkbox" data-c="completer_zeros" ${p.completer_zeros ? 'checked' : ''} ${ecrire ? '' : 'disabled'}>
        ${texteHtml('comptabilite_btp.parametres.zeros_aide')}</label></td></tr>
      <tr><th>${texteHtml('comptabilite_btp.parametres.longueur_tiers')}</th><td><input data-c="longueur_comptes_tiers" size="3" value="${p.longueur_comptes_tiers ?? ''}" ${ro}> ${texteHtml('comptabilite_btp.parametres.caracteres')}</td></tr>
      ${Object.entries(TYPES_COMPTE_TIERS).map(([t, l]) => `<tr><th>${texteHtml('comptabilite_btp.parametres.prefixe', { type: l.toLowerCase() })}</th>
        <td><input data-prefixe="${t}" size="5" maxlength="5" value="${echapper(p.prefixes_tiers?.[t] ?? '')}" ${ro}> ${texteHtml('comptabilite_btp.parametres.prefixe_aide', { prefixe: p.prefixes_tiers?.[t] ?? '' })}</td></tr>`).join('')}
      <tr><th>${texteHtml('comptabilite_btp.parametres.debits')}</th><td><label><input type="checkbox" data-c="tva_sur_debits" ${p.tva_sur_debits ? 'checked' : ''} ${ecrire ? '' : 'disabled'}>
        ${texteHtml('comptabilite_btp.parametres.debits_aide')}</label></td></tr>
      </tbody></table>`;
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      const entier = (c) => { const v = z.querySelector(`[data-c="${c}"]`).value.trim(); return v ? Number(v) : null; };
      const coche = (c) => z.querySelector(`[data-c="${c}"]`).checked;
      const prefixes = Object.fromEntries([...z.querySelectorAll('[data-prefixe]')].map((x) => [x.dataset.prefixe, x.value.trim().toUpperCase()]));
      try {
        this.parametres = await api.comptabilite.enregistrerParametres({
          longueur_comptes_generaux: entier('longueur_comptes_generaux'), longueur_comptes_tiers: entier('longueur_comptes_tiers'),
          completer_zeros: coche('completer_zeros'), prefixes_tiers: prefixes, tva_sur_debits: coche('tva_sur_debits'),
        });
        this.app.message(texte('comptabilite_btp.parametres.enregistres'), 'succes');
        this.#rendreParametres();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  #rendreCollectifs() {
    const ecrire = peutModifier(this.app);
    const z = this.#section('[data-collectifs]');
    z.innerHTML = `<h2 class="titre-actions">${texteHtml('comptabilite_btp.parametres.collectifs')} ${ecrire ? boutonEnregistrer() : ''}</h2>
      <p class="aide">${texteHtml('comptabilite_btp.parametres.collectifs_aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.plan.type')}</th><th>${texteHtml('comptabilite_btp.parametres.collectif')}</th></tr></thead><tbody>
      ${this.collectifs.map((c, i) => `<tr data-i="${i}"><td>${echapper(c.libelle)}</td><td data-compte></td></tr>`).join('')}</tbody></table>`;
    const options = optionsComptes(this.plan, (c) => c.type === 'COLLECTIF');
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const c = this.collectifs[Number(tr.dataset.i)];
      poserCombo(tr, '[data-compte]', { options, valeur: c.compte, lecture: !ecrire }, (v) => { c.compte = v; });
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.collectifs = await api.comptabilite.enregistrerCollectifs(this.collectifs);
        this.app.message(texte('comptabilite_btp.parametres.collectifs_ok'), 'succes');
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  /** Types comptables en colonnes, une ligne par réglage (journal, comptes par défaut et des postes). */
  #rendreTypes() {
    const ecrire = peutModifier(this.app);
    const ro = ecrire ? '' : 'readonly';
    const z = this.#section('[data-types]');
    const t = this.types;
    const comptes = ['compte_defaut', 'compte_remise', 'compte_retenue', 'compte_acompte', 'compte_paiement_direct', 'compte_prorata', 'compte_ecart_debit', 'compte_ecart_credit', 'compte_contrepartie', 'compte_dotation', 'compte_reprise']
      .map((c) => [c, texte(`comptabilite_btp.postes.${c}`), c === 'compte_defaut' ? texte('comptabilite_btp.parametres.defaut_aide') : null]);
    z.innerHTML = `<h2 class="titre-actions">${texteHtml('comptabilite_btp.parametres.types')} ${ecrire ? boutonEnregistrer() : ''}</h2>
      <p class="aide">${texteHtml('comptabilite_btp.parametres.types_aide')}
      · <a href="/comptabilite/ventilation">${texteHtml('comptabilite_btp.parametres.ventilation')}</a></p>
      <table class="tableau-compact"><thead><tr><th></th>${t.map((x) => `<th>${echapper(x.code)}</th>`).join('')}</tr></thead><tbody>
      <tr><th>${texteHtml('commun.libelle')}</th>${t.map((x, i) => `<td><input data-i="${i}" data-c="libelle" size="18" value="${echapper(x.libelle)}" ${ro}></td>`).join('')}</tr>
      <tr><th>${texteHtml('comptabilite_btp.parametres.parent')}</th>${t.map((x, i) => `<td data-i="${i}" data-combo="parent"></td>`).join('')}</tr>
      <tr><th>${texteHtml('comptabilite_btp.parametres.sens')}</th>${t.map((x, i) => `<td data-i="${i}" data-combo="sens"></td>`).join('')}</tr>
      <tr><th>${texteHtml('comptabilite_btp.parametres.journal')}</th>${t.map((x, i) => `<td><input data-i="${i}" data-c="journal" size="4" maxlength="10" value="${echapper(x.journal ?? '')}" ${ro}>
        <input data-i="${i}" data-c="journal_libelle" size="14" value="${echapper(x.journal_libelle ?? '')}" ${ro}></td>`).join('')}</tr>
      ${comptes.map(([c, l, aide]) => `<tr><th${aide ? ` title="${echapper(aide)}"` : ''}>${echapper(l)}</th>${t.map((x, i) => `<td data-i="${i}" data-combo="${c}">${c === 'compte_retenue'
        ? `<label class="fiche-option" title="${texteHtml('comptabilite_btp.parametres.retenue_tiers_titre')}"><input type="checkbox" data-i="${i}" data-c="retenue_compte_tiers" ${x.retenue_compte_tiers ? 'checked' : ''} ${ecrire ? '' : 'disabled'}> ${texteHtml('comptabilite_btp.parametres.retenue_tiers')}</label>` : ''}</td>`).join('')}</tr>`).join('')}
      <tr><th>${texteHtml('comptabilite_btp.plan.actif')}</th>${t.map((x, i) => `<td><input type="checkbox" data-i="${i}" data-c="actif" ${x.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>`).join('')}</tr>
      </tbody></table>`;
    z.querySelectorAll('[data-combo]').forEach((td) => {
      const x = t[Number(td.dataset.i)];
      const c = td.dataset.combo;
      const sel = `[data-i="${td.dataset.i}"][data-combo="${c}"]`;
      const tr = td.parentElement;
      if (c === 'parent') poserCombo(tr, sel, { options: t.filter((y) => y !== x).map((y) => ({ valeur: y.code, libelle: y.libelle })), valeur: x.parent, lecture: !ecrire }, (v) => { x.parent = v; });
      else if (c === 'sens') poserCombo(tr, sel, { options: SENS_COMPTE.slice(0, 2), valeur: x.sens, vide: false, lecture: !ecrire }, (v) => { x.sens = v; });
      else {
        const options = optionsComptes(this.plan, (cp) => ['LES_DEUX', 'AUCUN', x.sens].includes(cp.sens) || cp.type === 'COLLECTIF');
        const combo = poserCombo(tr, sel, { options, valeur: x[c], lecture: !ecrire }, (v) => { x[c] = v; });
        td.prepend(combo);
      }
    });
    z.querySelectorAll('[data-c]').forEach((e) => e.addEventListener('change', () => { t[Number(e.dataset.i)][e.dataset.c] = e.type === 'checkbox' ? e.checked : e.value; }));
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.types = await api.comptabilite.enregistrerTypesComptables(t);
        this.app.message(texte('comptabilite_btp.parametres.types_ok'), 'succes');
        this.#rendreTypes();
        this.#rendreDocuments();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  /** Type comptable de chaque type de document : vide = celui de sa famille. */
  #rendreDocuments() {
    const ecrire = peutModifier(this.app);
    const z = this.#section('[data-documents]');
    const l = this.documents;
    const familles = textesParCode('comptabilite_btp.familles', ['V', 'A', 'T', 'S', 'E']);
    const options = this.types.map((x) => ({ valeur: x.code, libelle: x.libelle }));
    z.innerHTML = `<h2 class="titre-actions">${texteHtml('comptabilite_btp.parametres.documents')} ${ecrire ? boutonEnregistrer() : ''}</h2>
      <p class="aide">${texteHtml('comptabilite_btp.parametres.documents_aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.parametres.famille')}</th><th>${texteHtml('commun.code')}</th><th>${texteHtml('comptabilite_btp.parametres.type_document')}</th><th>${texteHtml('comptabilite_btp.parametres.piece')}</th><th>${texteHtml('comptabilite_btp.parametres.type_comptable')}</th></tr></thead><tbody>
      ${l.map((d, i) => `<tr data-i="${i}"${d.piece_comptable ? '' : ' class="discret"'}><td>${echapper(familles[d.famille] ?? d.famille)}</td><td>${echapper(d.code)}</td>
        <td>${echapper(d.libelle)}</td><td>${d.piece_comptable ? iconeHtml('comptabilite_btp_piece') : ''}</td><td data-type></td></tr>`).join('')}</tbody></table>`;
    const modifies = new Map();
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const d = l[Number(tr.dataset.i)];
      const combo = poserCombo(tr, '[data-type]', { options, valeur: d.type_comptable, lecture: !ecrire }, (v) => { modifies.set(d.code, { code: d.code, type_comptable: v }); });
      const famille = d.type_comptable ? null : this.types.find((x) => x.code === d.type_effectif);
      if (famille) combo.placeholder = texte('comptabilite_btp.parametres.par_famille', { type: famille.libelle });
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      if (!modifies.size) return;
      try {
        this.documents = await api.comptabilite.enregistrerTypesDocuments([...modifies.values()]);
        this.app.message(texte('comptabilite_btp.parametres.documents_ok'), 'succes');
        this.#rendreDocuments();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  #rendreCategories() {
    const ecrire = peutModifier(this.app);
    const ro = ecrire ? '' : 'readonly';
    const l = this.categories;
    const z = this.#section('[data-categories]');
    z.innerHTML = `<h2 class="titre-actions">${texteHtml('comptabilite_btp.parametres.categories')} ${ecrire ? `<span><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('comptabilite_btp.parametres.categorie')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button></span>` : ''}</h2>
      <p class="aide">${texteHtml('comptabilite_btp.parametres.categories_aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('comptabilite_btp.parametres.comportement')}</th><th>${texteHtml('comptabilite_btp.parametres.mention')}</th><th>${texteHtml('comptabilite_btp.parametres.exigibilite')}</th><th>${texteHtml('comptabilite_btp.plan.actif')}</th>
      <th class="cellule-boutons"></th></tr></thead><tbody>
      ${l.map((c, i) => `<tr data-i="${i}"><td><input data-c="code" size="16" value="${echapper(c.code)}" ${ecrire && !c._existant ? '' : 'readonly'}></td>
        <td><input data-c="libelle" size="30" value="${echapper(c.libelle)}" ${ro}></td><td data-comportement></td>
        <td><textarea data-c="mention" rows="2" cols="50" ${ro}>${echapper(c.mention ?? '')}</textarea></td><td data-exigibilite></td>
        <td><input type="checkbox" data-c="actif" ${c.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${ecrire ? `${boutonsOrdre(i, l.length)}<button type="button" data-retirer title="${texteHtml('comptabilite_btp.parametres.retirer_categorie')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const c = l[Number(tr.dataset.i)];
      poserCombo(tr, '[data-comportement]', { options: COMPORTEMENTS_TVA, valeur: c.comportement, vide: false, lecture: !ecrire }, (v) => { c.comportement = v; });
      poserCombo(tr, '[data-exigibilite]', { options: EXIGIBILITES, valeur: c.exigibilite, lecture: !ecrire, titre: texte('comptabilite_btp.parametres.exigibilite_vide') }, (v) => { c.exigibilite = v; });
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => { c[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.value; }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { l.splice(l.indexOf(c), 1); this.#rendreCategories(); });
      lierOrdre(tr, l, c, () => this.#rendreCategories());
    });
    z.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      l.push({ code: '', libelle: '', comportement: 'N', mention: '', exigibilite: null, ordre: 0, actif: true });
      this.#rendreCategories();
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.categories = (await api.comptabilite.enregistrerCategoriesTva(l.map(({ _existant, ...c }) => c))).map((c) => ({ ...c, _existant: true }));
        this.app.message(texte('comptabilite_btp.parametres.categories_ok'), 'succes');
        this.#rendreCategories();
        this.#rendreTaux();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
    l.forEach((c) => { if (c.code) c._existant ??= true; });
  }

  #rendreTaux() {
    const ecrire = peutModifier(this.app);
    const ro = ecrire ? '' : 'readonly';
    const z = this.#section('[data-taux]');
    const comptesTva = optionsComptes(this.plan, (c) => c.type === 'TVA');
    const categories = this.categories.filter((c) => c.actif).map((c) => ({ valeur: c.code, libelle: c.libelle }));
    z.innerHTML = `<h2 class="titre-actions">${texteHtml('comptabilite_btp.parametres.taux')} ${ecrire ? boutonEnregistrer() : ''}</h2>
      <p class="aide">${texteHtml('comptabilite_btp.parametres.taux_aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.parametres.defaut')}</th><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th class="nombre">${texteHtml('comptabilite_btp.parametres.taux_col')}</th><th>${texteHtml('comptabilite_btp.parametres.categorie')}</th><th>${texteHtml('comptabilite_btp.parametres.comportement')}</th><th>${texteHtml('comptabilite_btp.parametres.mention_col')}</th>
      <th>${texteHtml('comptabilite_btp.parametres.collectee')}</th><th>${texteHtml('comptabilite_btp.parametres.a_encaisser')}</th><th>${texteHtml('comptabilite_btp.parametres.deductible')}</th><th>${texteHtml('comptabilite_btp.parametres.autoliquidee')}</th><th>${texteHtml('comptabilite_btp.plan.actif')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${this.taux.map((t, i) => `<tr data-i="${i}"${t.actif ? '' : ' class="discret"'}>
        <td><input type="radio" name="taux-defaut" data-defaut title="${texteHtml('comptabilite_btp.parametres.taux_defaut')}" ${t.defaut ? 'checked' : ''} ${ecrire && t.actif ? '' : 'disabled'}></td><td>${echapper(t.code)}</td><td>${echapper(t.libelle)}</td>
        <td class="nombre">${echapper(String(t.taux).replace('.', ','))} %</td><td data-categorie></td><td data-comportement>${echapper(libelleOption(COMPORTEMENTS_TVA, t.comportement))}</td>
        <td><textarea data-c="mention" rows="2" cols="40" ${ro}>${echapper(t.mention ?? '')}</textarea></td>
        <td data-compte="compte_collectee"></td><td data-compte="compte_collectee_encaissement"></td><td data-compte="compte_deductible"></td><td data-compte="compte_autoliquidee"></td>
        <td><input type="checkbox" data-c="actif" ${t.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${ecrire ? boutonsOrdre(i, this.taux.length) : ''}</td></tr>`).join('')}
      </tbody></table>`;
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = this.taux[Number(tr.dataset.i)];
      tr.querySelector('[data-defaut]').addEventListener('change', () => { for (const x of this.taux) x.defaut = x === t; });
      lierOrdre(tr, this.taux, t, () => this.#rendreTaux());
      poserCombo(tr, '[data-categorie]', { options: categories, valeur: t.categorie, lecture: !ecrire }, (v) => {
        t.categorie = v;
        const c = this.categories.find((x) => x.code === v);
        if (!c) return;
        t.comportement = c.comportement;
        tr.querySelector('[data-comportement]').textContent = libelleOption(COMPORTEMENTS_TVA, c.comportement);
        // Mention de la catégorie proposée quand le taux n'en a pas.
        const m = tr.querySelector('[data-c="mention"]');
        if (!m.value.trim() && c.mention) { m.value = c.mention; t.mention = c.mention; }
      });
      tr.querySelectorAll('[data-compte]').forEach((td) => {
        const cle = td.dataset.compte;
        poserCombo(tr, `[data-compte="${cle}"]`, { options: comptesTva, valeur: t[cle], lecture: !ecrire }, (v) => { t[cle] = v; });
      });
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        t[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.value;
        // Un taux inactif ne peut pas être le taux par défaut.
        if (x.dataset.c === 'actif') { if (!t.actif) t.defaut = false; this.#rendreTaux(); }
      }));
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.taux = await api.comptabilite.enregistrerTauxTva(this.taux);
        this.app.message(texte('comptabilite_btp.parametres.taux_ok'), 'succes');
        this.#rendreTaux();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }
}

/**
 * Ventilation : un onglet par type comptable, natures en lignes et taux de TVA en colonnes (« tous taux » = clé de la
 * nature, ligne « toutes natures » = clé du taux) ; case vide : compte hérité affiché atténué (règle `compteVentilation`
 * sur les clés en cours de saisie de tous les types), avec l'étape qui a répondu en bulle.
 */
export class PageVentilation extends PageBase {
  icone = icone('comptabilite_btp_ventilation');
  #modifies = new Set();

  get modifiee() { return this.#modifies.size > 0; }

  async ouvrir() {
    this.titre = texte('comptabilite_btp.routes.ventilation');
    this.type = this.requete.type ?? 'VENTE';
    this.tousComptes = false;
    const ecrire = peutModifier(this.app);
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('comptabilite_btp_ventilation')} ${texteHtml('comptabilite_btp.routes.ventilation')}</h1>
      <span class="ligne"><span data-onglets></span><label class="fiche-option"><input type="checkbox" data-tous> ${texteHtml('comptabilite_btp.ventilation.tous')}</label>
      <label class="fiche-option"><input type="checkbox" data-inactives> ${texteHtml('comptabilite_btp.ventilation.inactives')}</label>
      ${ecrire ? `<button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button>` : ''}</span></div>
      <p class="aide">${texteHtml('comptabilite_btp.ventilation.aide')}
      · <a href="/parametres/comptabilite">${texteHtml('comptabilite_btp.parametres.types')}</a> · <a href="/comptabilite/plan">${texteHtml('comptabilite_btp.routes.plan')}</a></p><div data-corps></div></div>`;
    const q = (s) => this.conteneur.querySelector(s);
    try {
      [this.plan, this.types, this.cles, this.natures, this.taux] = await Promise.all([api.comptabilite.plan(), api.comptabilite.typesComptables(),
        api.comptabilite.ventilation(), api.comptabilite.natures(), api.comptabilite.tauxTva()]);
    } catch (e) { q('[data-corps]').innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!this.types.some((t) => t.code === this.type)) this.type = this.types[0]?.code;
    q('[data-tous]').addEventListener('change', (e) => { this.tousComptes = e.target.checked; this.#rendre(); });
    q('[data-inactives]').addEventListener('change', (e) => { this.inactives = e.target.checked; this.#rendre(); });
    q('[data-enregistrer]')?.addEventListener('click', () => this.enregistrer());
    this.#rendre();
  }

  urlCourante() { return `/comptabilite/ventilation?type=${encodeURIComponent(this.type ?? '')}`; }

  async enregistrer() {
    try {
      for (const type of this.#modifies) this.cles = await api.comptabilite.enregistrerVentilation(type, this.cles.filter((c) => c.type === type && c.compte));
      this.#modifies.clear();
      this.app.message(texte('comptabilite_btp.ventilation.enregistree'), 'succes');
      this.#rendre();
      return true;
    } catch (e) { this.app.message(e.message, 'erreur'); return false; }
  }

  #rendre() {
    const onglets = this.conteneur.querySelector('[data-onglets]');
    onglets.innerHTML = this.types.filter((t) => t.actif).map((t) => `<button type="button" data-type="${echapper(t.code)}" class="${t.code === this.type ? 'principal' : ''}">${echapper(t.libelle)}${this.#modifies.has(t.code) ? ` ${iconeHtml('comptabilite_btp_modifie')}` : ''}</button>`).join(' ');
    onglets.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { this.type = b.dataset.type; this.#rendre(); }));
    const corps = this.conteneur.querySelector('[data-corps]');
    const type = this.types.find((t) => t.code === this.type);
    if (!type) { corps.innerHTML = `<p class="aide">${texteHtml('comptabilite_btp.ventilation.aucun_type')}</p>`; return; }
    const ecrire = peutModifier(this.app);
    const natures = this.natures.filter((n) => n.actif || this.inactives || this.cles.some((c) => c.type === type.code && c.nature === n.code));
    const taux = this.taux.filter((t) => t.actif);
    const options = optionsComptes(this.plan, (c) => this.tousComptes || ['LES_DEUX', type.sens].includes(c.sens));
    const regle = { types: this.types.filter((t) => t.actif).map((t) => ({ code: t.code, parent: t.parent, compte_defaut: t.compte_defaut })), cles: this.cles };
    const colonnes = [...taux.map((t) => t.code), null];
    const cellule = (n, x) => `<td data-nature="${echapper(n ?? '')}" data-taux="${echapper(x ?? '')}"></td>`;
    corps.innerHTML = `<p class="aide">${texteHtml('comptabilite_btp.ventilation.defaut', { type: type.libelle, compte: type.compte_defaut ?? (type.parent ? texte('comptabilite_btp.ventilation.celui_de', { type: type.parent }) : texte('comptabilite_btp.ventilation.aucun')) })}${type.parent ? ` · ${texteHtml('comptabilite_btp.ventilation.herite', { type: type.parent })}` : ''}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.ventilation.nature')}</th>${taux.map((t) => `<th title="${echapper(t.libelle)}">${echapper(t.code)}</th>`).join('')}<th>${texteHtml('comptabilite_btp.ventilation.tous_taux')}</th></tr></thead><tbody>
      ${natures.map((n) => `<tr${n.actif ? '' : ' class="discret"'}><th title="${echapper(n.libelle)}">${echapper(n.code)} <small>${echapper(n.libelle)}</small></th>${colonnes.map((x) => cellule(n.code, x)).join('')}</tr>`).join('')}
      <tr><th>${texteHtml('comptabilite_btp.ventilation.toutes_natures')}</th>${taux.map((t) => cellule(null, t.code)).join('')}<td></td></tr></tbody></table>`;
    corps.querySelectorAll('td[data-nature]').forEach((td) => {
      const nature = td.dataset.nature || null;
      const tx = td.dataset.taux || null;
      const cle = this.cles.find((c) => c.type === type.code && (c.nature ?? null) === nature && (c.taux ?? null) === tx);
      const combo = creerCombo({ options, valeur: cle?.compte ?? '' });
      combo.readOnly = !ecrire;
      combo.size = 8;
      const herite = () => {
        const r = compteVentilation({ compte: null, nature, taux: tx, type: type.code }, { ...regle, cles: this.cles.filter((c) => c !== cle || !cle.compte) });
        combo.placeholder = r.compte ?? '';
        combo.title = r.compte ? texte('comptabilite_btp.ventilation.herite_de', { origine: `${ORIGINES_VENTILATION[r.origine]}${r.type && r.type !== type.code ? ` (${r.type})` : ''}` }) : texte('comptabilite_btp.ventilation.aucun_compte');
      };
      herite();
      combo.addEventListener('change', () => {
        const v = combo.valeurCombo || null;
        const existante = this.cles.find((c) => c.type === type.code && (c.nature ?? null) === nature && (c.taux ?? null) === tx);
        if (existante) existante.compte = v;
        else if (v) this.cles.push({ type: type.code, nature, taux: tx, compte: v });
        this.#modifies.add(type.code);
        this.#rendre();
      });
      td.append(combo);
    });
  }
}

const montant = (v) => formatNombre(v ?? 0, 2);
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

/**
 * Export des écritures (lot 3) : période (date comptable), types comptables, aperçu des pièces à transférer (écriture
 * dépliable, erreurs : pièce exclue de l'export), pièces transférées modifiées depuis leur export, modèle du fichier
 * (Sage 100 par défaut), lots d'export (téléchargement, annulation : pièces remises à transférer).
 */
export class PageExportComptable extends PageBase {
  icone = icone('comptabilite_btp_export');

  async ouvrir() {
    this.titre = texte('comptabilite_btp.routes.export');
    this.du = this.requete.du ?? '';
    this.au = this.requete.au ?? '';
    const ecrire = peutModifier(this.app);
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('comptabilite_btp_export')} ${texteHtml('comptabilite_btp.routes.export')}</h1>
      <span class="ligne">${texteHtml('comptabilite_btp.export.du')} <input type="date" data-du value="${echapper(this.du)}"> ${texteHtml('comptabilite_btp.export.au')} <input type="date" data-au value="${echapper(this.au)}">
      <span data-types></span> <button type="button" data-apercu>${iconeHtml('comptabilite_btp_apercu')} ${texteHtml('comptabilite_btp.export.apercu')}</button>
      ${ecrire ? `<button type="button" class="principal" data-exporter disabled>${iconeHtml('comptabilite_btp_export')} ${texteHtml('comptabilite_btp.export.exporter')}</button>` : ''}</span></div>
      <p class="aide">${texteHtml('comptabilite_btp.export.aide')} <span data-modele></span>
      · <a href="/comptabilite/ventilation">${texteHtml('comptabilite_btp.export.ventilation')}</a> · <a href="/parametres/comptabilite">${texteHtml('comptabilite_btp.plan.parametres')}</a></p>
      <div data-apercu-zone></div><h2>${texteHtml('comptabilite_btp.export.lots')}</h2><div data-lots></div></div>`;
    const q = (s) => this.conteneur.querySelector(s);
    try {
      [this.types, this.modeles, this.modele] = await Promise.all([api.comptabilite.typesComptables(), api.comptabilite.modelesExport(), api.comptabilite.modeleExport()]);
    } catch (e) { q('[data-apercu-zone]').innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    this.choisis = new Set(this.types.filter((t) => t.actif).map((t) => t.code));
    q('[data-types]').innerHTML = this.types.filter((t) => t.actif).map((t) => `<label class="fiche-option"><input type="checkbox" data-type="${echapper(t.code)}" checked> ${echapper(t.libelle)}</label>`).join(' ');
    q('[data-types]').querySelectorAll('[data-type]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) this.choisis.add(c.dataset.type); else this.choisis.delete(c.dataset.type);
    }));
    poserCombo(this.conteneur, '[data-modele]', { options: this.modeles.map((m) => ({ valeur: m.code, libelle: m.libelle })), valeur: this.modele.code, vide: false, lecture: !ecrire },
      async (v) => {
        try {
          this.modele = await api.comptabilite.enregistrerModeleExport(this.modeles.find((m) => m.code === v));
          this.app.message(texte('comptabilite_btp.export.modele', { modele: this.modele.libelle }), 'succes');
        } catch (e) { this.app.message(e.message, 'erreur'); }
      });
    q('[data-du]').addEventListener('change', (e) => { this.du = e.target.value; });
    q('[data-au]').addEventListener('change', (e) => { this.au = e.target.value; });
    q('[data-apercu]').addEventListener('click', () => this.#apercu());
    q('[data-exporter]')?.addEventListener('click', () => this.#exporter());
    await this.#lots();
  }

  urlCourante() {
    const p = new URLSearchParams();
    if (this.du) p.set('du', this.du);
    if (this.au) p.set('au', this.au);
    return `/comptabilite/export${p.size ? `?${p}` : ''}`;
  }

  #demande() { return { du: this.du || null, au: this.au || null, types: [...this.choisis] }; }

  #tablePieces(pieces) {
    return `<table class="tableau-compact"><thead><tr><th></th><th>${texteHtml('comptabilite_btp.export.piece')}</th><th>${texteHtml('comptabilite_btp.plan.type')}</th><th>${texteHtml('comptabilite_btp.parametres.journal')}</th><th>${texteHtml('comptabilite_btp.export.date')}</th><th>${texteHtml('comptabilite_btp.tiers.tiers')}</th><th class="nombre">${texteHtml('comptabilite_btp.export.ttc')}</th>
      <th>${texteHtml('comptabilite_btp.export.controle')}</th></tr></thead><tbody>${pieces.map((p, i) => `<tr data-i="${i}"><td><button type="button" data-deplier title="${texteHtml('comptabilite_btp.export.ecriture')}">${iconeHtml('comptabilite_btp_replie')}</button></td>
      <td><a href="${urlDocument(Number(p.id))}">${echapper(p.numero)}</a></td><td>${echapper(p.type_document)}</td><td>${echapper(p.journal)}</td><td>${dateFr(p.date)}</td>
      <td>${echapper(p.tiers ?? '')}</td><td class="nombre">${montant(p.total_ttc)}</td>
      <td>${p.erreurs.length ? `<span class="erreur">${iconeHtml('comptabilite_btp_hors_longueur')} ${echapper(p.erreurs.join(' · '))}</span>` : iconeHtml('comptabilite_btp_piece')}</td></tr>
      <tr data-ecriture="${i}" hidden><td></td><td colspan="7"><table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.plan.compte')}</th><th>${texteHtml('comptabilite_btp.tiers.tiers')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('comptabilite_btp.export.echeance')}</th>
      <th class="nombre">${texteHtml('comptabilite_btp.export.debit')}</th><th class="nombre">${texteHtml('comptabilite_btp.export.credit')}</th></tr></thead><tbody>${p.lignes.map((l) => `<tr><td>${echapper(l.compte)}</td><td>${echapper(l.auxiliaire ?? '')}</td>
      <td>${echapper(l.libelle)}</td><td>${dateFr(l.echeance)}</td><td class="nombre">${l.debit ? montant(l.debit) : ''}</td><td class="nombre">${l.credit ? montant(l.credit) : ''}</td></tr>`).join('')}
      </tbody></table></td></tr>`).join('')}</tbody></table>`;
  }

  #brancherDeplier(zone) {
    zone.querySelectorAll('[data-deplier]').forEach((b) => b.addEventListener('click', () => {
      const tr = b.closest('tr');
      const detail = tr.parentElement.querySelector(`tr[data-ecriture="${tr.dataset.i}"]`);
      detail.hidden = !detail.hidden;
      b.textContent = icone(detail.hidden ? 'comptabilite_btp_replie' : 'comptabilite_btp_deplie');
    }));
  }

  async #apercu() {
    const zone = this.conteneur.querySelector('[data-apercu-zone]');
    zone.innerHTML = `<p class="aide">${texteHtml('comptabilite_btp.export.calcul')}</p>`;
    try {
      const a = await api.comptabilite.apercuExport(this.#demande());
      this.apercu = a;
      const erreurs = a.pieces.length - a.valides;
      zone.innerHTML = `<h2>${texteHtml('comptabilite_btp.export.a_transferer', { pieces: pluriel('comptabilite_btp.export.pieces', a.pieces.length) })}</h2>
        <p>${texteHtml('comptabilite_btp.export.exportables_total', { exportables: pluriel('comptabilite_btp.export.exportables', a.valides), total: montant(a.total_debit) })}${erreurs ? ` · <span class="erreur">${texteHtml('comptabilite_btp.export.en_erreur', { nombre: erreurs })}</span>` : ''}</p>
        ${a.pieces.length ? `<div data-a>${this.#tablePieces(a.pieces)}</div>` : `<p class="aide">${texteHtml('comptabilite_btp.export.aucune')}</p>`}
        ${a.modifiees.length ? `<h2>${texteHtml('comptabilite_btp.export.modifiees', { nombre: a.modifiees.length })}</h2><p class="aide">${texteHtml('comptabilite_btp.export.modifiees_aide')}</p>
          <div data-m>${this.#tablePieces(a.modifiees)}</div>` : ''}`;
      this.#brancherDeplier(zone);
      const b = this.conteneur.querySelector('[data-exporter]');
      if (b) { b.disabled = !a.valides; b.textContent = `${icone('comptabilite_btp_export')} ${pluriel('comptabilite_btp.export.exporter_n', a.valides)}`; }
    } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; }
  }

  async #exporter() {
    if (!await confirmer(texte('comptabilite_btp.export.confirmer', { modele: this.modele.libelle }))) return;
    try {
      const r = await api.comptabilite.exporter(this.#demande());
      if (r.lot) {
        this.app.message(pluriel('comptabilite_btp.export.exportees', r.lot.nb_pieces), 'succes');
        window.location.assign(`/api/comptabilite/export/${r.lot.id}/fichier`);
      } else this.app.message(texte('comptabilite_btp.export.aucune_exportable'), 'avertissement');
      if (r.exclues.length) await alerter(pluriel('comptabilite_btp.export.exclues', r.exclues.length), { titre: texte('comptabilite_btp.export.titre_export'), html: `<ul>${r.exclues.map((p) => `<li>${echapper(p.numero)} : ${echapper(p.erreurs.join(' · '))}</li>`).join('')}</ul>` });
      await this.#apercu();
      await this.#lots();
    } catch (e) { this.app.message(e.message, 'erreur'); }
  }

  async #lots() {
    const zone = this.conteneur.querySelector('[data-lots]');
    try {
      const lots = await api.comptabilite.lotsExport();
      const ecrire = peutModifier(this.app);
      zone.innerHTML = lots.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('comptabilite_btp.export.lot')}</th><th>${texteHtml('comptabilite_btp.export.le')}</th><th>${texteHtml('comptabilite_btp.export.par')}</th><th>${texteHtml('comptabilite_btp.export.periode')}</th><th>${texteHtml('comptabilite_btp.export.types')}</th><th>${texteHtml('comptabilite_btp.export.modele_col')}</th>
        <th class="nombre">${texteHtml('comptabilite_btp.export.pieces_col')}</th><th class="nombre">${texteHtml('comptabilite_btp.export.lignes')}</th><th class="nombre">${texteHtml('commun.total')}</th><th>${texteHtml('comptabilite_btp.export.fichier')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
        ${lots.map((l) => `<tr data-id="${l.id}"${l.annule_le ? ' class="discret"' : ''}><td>${l.id}</td><td>${echapper(formatDateHeure(l.le))}</td><td>${echapper(l.par)}</td>
          <td>${dateFr(l.du) || '…'} – ${dateFr(l.au) || '…'}</td><td>${echapper(l.types.join(', '))}</td><td>${echapper(l.modele)}</td>
          <td class="nombre">${l.nb_pieces}</td><td class="nombre">${l.nb_lignes}</td><td class="nombre">${montant(l.total)}</td>
          <td><a href="/api/comptabilite/export/${l.id}/fichier" download>${iconeHtml('comptabilite_btp_telecharger')} ${echapper(l.nom_fichier)}</a></td>
          <td class="cellule-boutons">${l.annule_le ? texteHtml('comptabilite_btp.export.annule', { date: dateFr(String(l.annule_le).slice(0, 10)) }) : ecrire ? `<button type="button" data-annuler title="${texteHtml('comptabilite_btp.export.annuler_titre')}">${iconeHtml('comptabilite_btp_annuler')}</button>` : ''}</td></tr>`).join('')}
        </tbody></table>` : `<p class="aide">${texteHtml('comptabilite_btp.export.aucun_lot')}</p>`;
      zone.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', async () => {
        const id = Number(b.closest('tr').dataset.id);
        if (!await confirmer(texte('comptabilite_btp.export.confirmer_annulation', { id }))) return;
        try {
          await api.comptabilite.annulerExport(id);
          this.app.message(texte('comptabilite_btp.export.lot_annule', { id }), 'succes');
          await this.#lots();
        } catch (e) { this.app.message(e.message, 'erreur'); }
      }));
    } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; }
  }
}
