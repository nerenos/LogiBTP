import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, alerter } from '@logibtp/socle/ui';
import { normaliserCompte, normaliserCompteTiers, MESSAGES_COMPTES, compteVentilation, ORIGINES_VENTILATION } from '@logibtp/comptabilite';
import { api } from '../api.js';

// Module Comptabilité, base, lot 1 (ANALYSE-MODULE-COMPTABILITE.md § 4.1 à 4.3) : plan comptable (`/comptabilite/plan`),
// tiers indexés par compte (`/comptabilite/tiers`), paramètres, collectifs, catégories et taux de TVA
// (`/parametres/comptabilite`) ; lot 2 : types comptables et types de documents (`/parametres/comptabilite`), ventilation
// natures × taux de TVA (`/comptabilite/ventilation`). Droit : nœud `comptabilite` (modifier pour écrire).

const CLASSES = {
  1: 'Capitaux', 2: 'Immobilisations', 3: 'Stocks', 4: 'Tiers', 5: 'Financiers', 6: 'Charges', 7: 'Produits', 8: 'Spéciaux', 9: 'Analytique',
};
const TYPES_COMPTE = [
  { valeur: 'GENERAL', libelle: 'Général' }, { valeur: 'COLLECTIF', libelle: 'Collectif' }, { valeur: 'TVA', libelle: 'TVA' },
  { valeur: 'TRESORERIE', libelle: 'Trésorerie' },
];
const SENS_COMPTE = [
  { valeur: 'VENTE', libelle: 'Vente' }, { valeur: 'ACHAT', libelle: 'Achat' }, { valeur: 'LES_DEUX', libelle: 'Vente et achat' },
  { valeur: 'AUCUN', libelle: '—' },
];
/** Types de comptes de tiers (SpecialisationComptabiliteBtp). */
export const TYPES_COMPTE_TIERS = { CLIENT: 'Client', FOURNISSEUR: 'Fournisseur', SOUS_TRAITANT: 'Sous-traitant' };
const COMPORTEMENTS_TVA = [
  { valeur: 'N', libelle: 'Normale' }, { valeur: 'A', libelle: 'Autoliquidation' }, { valeur: 'I', libelle: 'Intracommunautaire' },
  { valeur: 'E', libelle: 'Exonérée' },
];
const EXIGIBILITES = [{ valeur: 'E', libelle: 'Encaissements' }, { valeur: 'D', libelle: 'Débits' }];

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
  icone = '📒';

  async ouvrir() {
    this.titre = 'Plan comptable';
    this.recherche = this.requete.recherche ?? '';
    this.classe = this.requete.classe ? Number(this.requete.classe) : null;
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">📒 Plan comptable</h1>
      <span class="ligne"><input type="search" data-recherche placeholder="Rechercher un compte…" size="24" value="${echapper(this.recherche)}">
      <span data-classe></span><label class="fiche-option"><input type="checkbox" data-non-conformes> Hors longueur</label>
      <label class="fiche-option"><input type="checkbox" data-inactifs> Inactifs</label>
      ${peutModifier(this.app) ? '<button type="button" data-ajouter>＋ Compte</button>' : ''}</span></div>
      <p class="aide" data-regle></p><div data-corps></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-corps]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const q = (s) => this.conteneur.querySelector(s);
    poserCombo(this.conteneur, '[data-classe]', { options: Object.entries(CLASSES).map(([k, v]) => ({ valeur: Number(k), libelle: `${k} – ${v}` })), valeur: this.classe, titre: 'Classe' },
      (v) => { this.classe = v === null ? null : Number(v); this.#rendre(); });
    q('[data-recherche]').addEventListener('input', (e) => { this.recherche = e.target.value; this.#rendre(); });
    q('[data-non-conformes]').addEventListener('change', (e) => { this.nonConformes = e.target.checked; this.#rendre(); });
    q('[data-inactifs]').addEventListener('change', (e) => { this.inactifs = e.target.checked; this.#rendre(); });
    q('[data-ajouter]')?.addEventListener('click', () => { this.nouveau = { code: '', libelle: '', type: 'GENERAL', sens: 'AUCUN', libelle_court: '', lettrable: false, actif: true }; this.#rendre(); });
    try {
      [this.parametres, this.comptes] = await Promise.all([api.comptabilite.parametres(), api.comptabilite.plan()]);
    } catch (e) { q('[data-corps]').innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const p = this.parametres;
    q('[data-regle]').innerHTML = `Comptes généraux : ${p.longueur_comptes_generaux ? `${p.longueur_comptes_generaux} chiffres ${p.completer_zeros ? 'exactement (complétés par des zéros à droite)' : 'au plus'}` : 'longueur libre'}
      · <a href="/parametres/comptabilite">Paramètres</a> · <a href="/comptabilite/tiers">Tiers par compte</a>`;
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
    corps.innerHTML = `<table class="tableau-compact"><thead><tr><th>Compte</th><th>Libellé</th><th>Type</th><th>Sens d'usage</th><th>Libellé court (export)</th>
      <th>Lettrable</th><th>Actif</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${n ? `<tr data-nouveau><td><input data-c="code" size="10" value="${echapper(n.code)}" placeholder="Code"><div class="aide" data-apercu></div></td>
        <td><input data-c="libelle" size="40" value="${echapper(n.libelle)}"></td><td data-type></td><td data-sens></td>
        <td><input data-c="libelle_court" size="20" maxlength="35" value="${echapper(n.libelle_court)}"></td>
        <td><input type="checkbox" data-c="lettrable" ${n.lettrable ? 'checked' : ''}></td><td><input type="checkbox" data-c="actif" checked></td>
        <td class="cellule-boutons"><button type="button" data-creer title="Créer le compte">✓</button><button type="button" data-abandon title="Abandonner">✕</button></td></tr>` : ''}
      ${lignes.map((c) => `<tr data-code="${echapper(c.code)}"${c.actif ? '' : ' class="discret"'}>
        <td title="${c.conforme ? '' : 'Hors de la longueur paramétrée'}">${echapper(c.code)}${c.conforme ? '' : ' ⚠'}</td>
        <td><input data-c="libelle" size="40" value="${echapper(c.libelle)}" ${ro}></td><td data-type></td><td data-sens></td>
        <td><input data-c="libelle_court" size="20" maxlength="35" value="${echapper(c.libelle_court ?? '')}" ${ro}></td>
        <td><input type="checkbox" data-c="lettrable" ${c.lettrable ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>
        <td><input type="checkbox" data-c="actif" ${c.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${ecrire ? '<button type="button" data-supprimer title="Supprimer (compte jamais utilisé)">🗑</button>' : ''}</td></tr>`).join('')}
      </tbody></table><p class="aide">${lignes.length} compte(s) sur ${this.comptes.length}</p>`;
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
        if (!await confirmer(`Supprimer le compte ${c.code} – ${c.libelle} ?`)) return;
        try {
          await api.comptabilite.supprimerCompte(c.code);
          this.comptes.splice(this.comptes.indexOf(c), 1);
          this.#rendre();
        } catch (e) { await alerter(e.message, { titre: 'Suppression impossible' }); }
      });
    });
  }

  #brancherNouveau(tr, n) {
    const apercu = () => {
      const p = this.parametres;
      const r = normaliserCompte(n.code, { longueur: p.longueur_comptes_generaux, completerZeros: p.completer_zeros });
      tr.querySelector('[data-apercu]').textContent = !n.code.trim() ? '' : r.erreur ? MESSAGES_COMPTES[r.erreur] : r.code !== n.code.trim() ? `→ ${r.code}` : '';
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
        this.app.message(`Compte ${c.code} créé`, 'succes');
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
  icone = '🗂';
  #modifies = new Map();

  get modifiee() { return this.#modifies.size > 0; }

  async ouvrir() {
    this.titre = 'Tiers par compte';
    this.recherche = this.requete.recherche ?? '';
    this.type = this.requete.type ?? null;
    this.segment = this.requete.segment ?? 'TOUS';
    const ecrire = peutModifier(this.app);
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">🗂 Tiers par compte</h1>
      <span class="ligne"><input type="search" data-recherche placeholder="Compte, tiers, SIRET…" size="24" value="${echapper(this.recherche)}">
      <span data-type></span><span data-segment></span>
      ${ecrire ? '<button type="button" data-generer title="Comptes proposés : préfixe du type + code du tiers">⚙ Générer les comptes manquants</button> <button type="button" class="principal" data-enregistrer>Enregistrer</button>' : ''}
      </span></div>
      <p class="aide">Collectif vide : celui du type (client professionnel ou particulier selon le niveau du tiers, fournisseur, sous-traitant).
      Un sous-traitant sans compte propre prend son compte fournisseur (en italique). · <a href="/comptabilite/plan">Plan comptable</a> ·
      <a href="/parametres/comptabilite">Paramètres</a></p><div data-corps></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-corps]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const q = (s) => this.conteneur.querySelector(s);
    poserCombo(this.conteneur, '[data-type]', { options: Object.entries(TYPES_COMPTE_TIERS).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: this.type, titre: 'Type de compte' },
      (v) => { this.type = v; this.#rendre(); });
    poserCombo(this.conteneur, '[data-segment]', {
      options: [{ valeur: 'TOUS', libelle: 'Tous' }, { valeur: 'SANS', libelle: 'Sans compte' }, { valeur: 'DOUBLONS', libelle: 'Comptes en double' },
        { valeur: 'SURCHARGES', libelle: 'Collectif surchargé' }],
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
      this.app.message('Comptes des tiers enregistrés', 'succes');
      this.#rendre();
      return true;
    } catch (e) { this.app.message(e.message, 'erreur'); return false; }
  }

  async #generer() {
    if (this.#modifies.size && !await this.enregistrer()) return;
    const sans = this.tiers.filter((t) => !t.compte && t.actif && (!this.type || t.type_compte === this.type)).length;
    if (!sans) { this.app.message('Aucun tiers actif sans compte', 'info'); return; }
    if (!await confirmer(`Proposer et enregistrer un compte pour ${sans} ligne(s) sans compte${this.type ? ` (${TYPES_COMPTE_TIERS[this.type]})` : ''} ?`)) return;
    try {
      const r = await api.comptabilite.genererTiers(this.type);
      await this.#charger();
      if (r.refus.length) await alerter(`${r.crees} compte(s) créé(s). Non créés :`, { titre: 'Comptes des tiers', html: `<ul>${r.refus.map((x) => `<li>${echapper(x)}</li>`).join('')}</ul>` });
      else this.app.message(`${r.crees} compte(s) créé(s)`, 'succes');
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
    corps.innerHTML = `<table class="tableau-compact"><thead><tr><th>Compte</th><th>Type</th><th>Tiers</th><th>Code</th><th>Pro / particulier</th>
      <th>Collectif</th><th>SIRET</th><th>TVA intracom.</th></tr></thead><tbody>
      ${lignes.map((t) => {
        const herite = t.compte_herite;
        const col = collectifsType.get(t.collectif);
        return `<tr data-cle="${cle(t)}"${t.actif ? '' : ' class="discret"'}>
          <td><input data-compte size="14" value="${herite ? '' : echapper(t.compte ?? '')}" placeholder="${herite ? echapper(t.compte) : ''}" ${ecrire ? '' : 'readonly'}
            ${herite ? 'title="Compte fournisseur (hérité)" class="herite"' : ''}>${t.doublon ? ' <span title="Compte porté par plusieurs tiers">⚠</span>' : ''}</td>
          <td>${echapper(TYPES_COMPTE_TIERS[t.type_compte] ?? t.type_compte)}</td>
          <td><a href="/fiche/personne/${Number(t.tiers_id)}">${echapper(t.raison_sociale)}</a></td><td>${echapper(t.code_tiers ?? '')}</td>
          <td>${t.type_compte === 'CLIENT' ? (t.particulier ? 'Particulier' : 'Professionnel') : ''}</td>
          <td data-collectif title="${echapper(col ? `Par défaut : ${col.libelle} (${col.compte ?? 'sans compte'})` : '')}"></td>
          <td>${echapper(t.siret ?? '')}</td><td>${echapper(t.tva_intra ?? '')}</td></tr>`;
      }).join('')}
      </tbody></table><p class="aide">${lignes.length} ligne(s) sur ${this.tiers.length}</p>`;
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
      if (col?.compte) combo.placeholder = `${col.compte} (défaut)`;
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

/** Paramètres de la comptabilité, collectifs par type de tiers, catégories de TVA et comptes des taux. */
export class PageParametresComptabilite extends PageBase {
  icone = '📒';

  async ouvrir() {
    this.titre = 'Paramètres de la comptabilité';
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">📒 Paramètres de la comptabilité</h1>
      <span class="ligne"><a href="/comptabilite/plan">Plan comptable</a> · <a href="/comptabilite/tiers">Tiers par compte</a></span></div>
      <section data-parametres></section><section data-collectifs></section><section data-types></section><section data-documents></section>
      <section data-categories></section><section data-taux></section></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-parametres]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
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
    z.innerHTML = `<h2 class="titre-actions">Comptes ${ecrire ? '<span><button type="button" class="principal" data-enregistrer>Enregistrer</button></span>' : ''}</h2>
      <table><tbody>
      <tr><th>Longueur des comptes généraux</th><td><input data-c="longueur_comptes_generaux" size="3" value="${p.longueur_comptes_generaux ?? ''}" ${ro}> chiffres (vide : libre)</td></tr>
      <tr><th>Complétion par des zéros</th><td><label><input type="checkbox" data-c="completer_zeros" ${p.completer_zeros ? 'checked' : ''} ${ecrire ? '' : 'disabled'}>
        704 devient 704000 ; sinon la longueur est un maximum (logiciels qui n'acceptent qu'une longueur maximale)</label></td></tr>
      <tr><th>Longueur des comptes de tiers</th><td><input data-c="longueur_comptes_tiers" size="3" value="${p.longueur_comptes_tiers ?? ''}" ${ro}> caractères au plus (vide : 17)</td></tr>
      ${Object.entries(TYPES_COMPTE_TIERS).map(([t, l]) => `<tr><th>Préfixe des comptes ${echapper(l.toLowerCase())}</th>
        <td><input data-prefixe="${t}" size="5" maxlength="5" value="${echapper(p.prefixes_tiers?.[t] ?? '')}" ${ro}> + code du tiers sans ses lettres (T000123 → ${echapper(p.prefixes_tiers?.[t] ?? '')}000123)</td></tr>`).join('')}
      <tr><th>TVA sur les débits</th><td><label><input type="checkbox" data-c="tva_sur_debits" ${p.tva_sur_debits ? 'checked' : ''} ${ecrire ? '' : 'disabled'}>
        option de la société ; sinon la TVA des travaux est exigible à l'encaissement</label></td></tr>
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
        this.app.message('Paramètres enregistrés', 'succes');
        this.#rendreParametres();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  #rendreCollectifs() {
    const ecrire = peutModifier(this.app);
    const z = this.#section('[data-collectifs]');
    z.innerHTML = `<h2 class="titre-actions">Collectifs par type de tiers ${ecrire ? '<span><button type="button" class="principal" data-enregistrer>Enregistrer</button></span>' : ''}</h2>
      <p class="aide">Surchargeables dans la fiche du tiers (groupe de chaque relation).</p>
      <table class="tableau-compact"><thead><tr><th>Type</th><th>Compte collectif</th></tr></thead><tbody>
      ${this.collectifs.map((c, i) => `<tr data-i="${i}"><td>${echapper(c.libelle)}</td><td data-compte></td></tr>`).join('')}</tbody></table>`;
    const options = optionsComptes(this.plan, (c) => c.type === 'COLLECTIF');
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const c = this.collectifs[Number(tr.dataset.i)];
      poserCombo(tr, '[data-compte]', { options, valeur: c.compte, lecture: !ecrire }, (v) => { c.compte = v; });
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.collectifs = await api.comptabilite.enregistrerCollectifs(this.collectifs);
        this.app.message('Collectifs enregistrés', 'succes');
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  /** Types comptables en colonnes, une ligne par réglage (journal, comptes par défaut et des postes). */
  #rendreTypes() {
    const ecrire = peutModifier(this.app);
    const ro = ecrire ? '' : 'readonly';
    const z = this.#section('[data-types]');
    const t = this.types;
    const comptes = [
      ['compte_defaut', 'Compte par défaut', 'Sans clé de ventilation (étape 5)'], ['compte_remise', 'Remise de pied'],
      ['compte_retenue', 'Retenue de garantie'], ['compte_acompte', 'Acompte déduit'], ['compte_paiement_direct', 'Paiement direct'],
      ['compte_prorata', 'Prorata'], ['compte_ecart_debit', 'Écart d\'arrondi (débit)'], ['compte_ecart_credit', 'Écart d\'arrondi (crédit)'],
    ];
    z.innerHTML = `<h2 class="titre-actions">Types comptables ${ecrire ? '<span><button type="button" class="principal" data-enregistrer>Enregistrer</button></span>' : ''}</h2>
      <p class="aide">Un type hérite de la ventilation et des comptes de son parent (sous-traitance → achats). Comptes proposés selon le sens du type.
      · <a href="/comptabilite/ventilation">Ventilation natures × TVA</a></p>
      <table class="tableau-compact"><thead><tr><th></th>${t.map((x) => `<th>${echapper(x.code)}</th>`).join('')}</tr></thead><tbody>
      <tr><th>Libellé</th>${t.map((x, i) => `<td><input data-i="${i}" data-c="libelle" size="18" value="${echapper(x.libelle)}" ${ro}></td>`).join('')}</tr>
      <tr><th>Type parent</th>${t.map((x, i) => `<td data-i="${i}" data-combo="parent"></td>`).join('')}</tr>
      <tr><th>Sens des comptes</th>${t.map((x, i) => `<td data-i="${i}" data-combo="sens"></td>`).join('')}</tr>
      <tr><th>Journal</th>${t.map((x, i) => `<td><input data-i="${i}" data-c="journal" size="4" maxlength="10" value="${echapper(x.journal ?? '')}" ${ro}>
        <input data-i="${i}" data-c="journal_libelle" size="14" value="${echapper(x.journal_libelle ?? '')}" ${ro}></td>`).join('')}</tr>
      ${comptes.map(([c, l, aide]) => `<tr><th${aide ? ` title="${echapper(aide)}"` : ''}>${echapper(l)}</th>${t.map((x, i) => `<td data-i="${i}" data-combo="${c}">${c === 'compte_retenue'
        ? `<label class="fiche-option" title="Retenue portée au compte du tiers (C12)"><input type="checkbox" data-i="${i}" data-c="retenue_compte_tiers" ${x.retenue_compte_tiers ? 'checked' : ''} ${ecrire ? '' : 'disabled'}> compte du tiers</label>` : ''}</td>`).join('')}</tr>`).join('')}
      <tr><th>Actif</th>${t.map((x, i) => `<td><input type="checkbox" data-i="${i}" data-c="actif" ${x.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>`).join('')}</tr>
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
        this.app.message('Types comptables enregistrés', 'succes');
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
    const familles = { V: 'Ventes', A: 'Achats', T: 'Sous-traitance', S: 'Stock', E: 'Exécution' };
    const options = this.types.map((x) => ({ valeur: x.code, libelle: x.libelle }));
    z.innerHTML = `<h2 class="titre-actions">Types de documents ${ecrire ? '<span><button type="button" class="principal" data-enregistrer>Enregistrer</button></span>' : ''}</h2>
      <p class="aide">Type comptable vide : celui de la famille (ventes, achats, sous-traitance) ; seules les pièces comptables sont transférées.</p>
      <table class="tableau-compact"><thead><tr><th>Famille</th><th>Code</th><th>Type de document</th><th>Pièce comptable</th><th>Type comptable</th></tr></thead><tbody>
      ${l.map((d, i) => `<tr data-i="${i}"${d.piece_comptable ? '' : ' class="discret"'}><td>${echapper(familles[d.famille] ?? d.famille)}</td><td>${echapper(d.code)}</td>
        <td>${echapper(d.libelle)}</td><td>${d.piece_comptable ? '✓' : ''}</td><td data-type></td></tr>`).join('')}</tbody></table>`;
    const modifies = new Map();
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const d = l[Number(tr.dataset.i)];
      const combo = poserCombo(tr, '[data-type]', { options, valeur: d.type_comptable, lecture: !ecrire }, (v) => { modifies.set(d.code, { code: d.code, type_comptable: v }); });
      const famille = d.type_comptable ? null : this.types.find((x) => x.code === d.type_effectif);
      if (famille) combo.placeholder = `${famille.libelle} (famille)`;
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      if (!modifies.size) return;
      try {
        this.documents = await api.comptabilite.enregistrerTypesDocuments([...modifies.values()]);
        this.app.message('Types de documents enregistrés', 'succes');
        this.#rendreDocuments();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  #rendreCategories() {
    const ecrire = peutModifier(this.app);
    const ro = ecrire ? '' : 'readonly';
    const l = this.categories;
    const z = this.#section('[data-categories]');
    z.innerHTML = `<h2 class="titre-actions">Catégories de TVA ${ecrire ? '<span><button type="button" data-ajouter>＋ Catégorie</button> <button type="button" class="principal" data-enregistrer>Enregistrer</button></span>' : ''}</h2>
      <p class="aide">Le comportement est celui du calcul des pièces ; la mention réglementaire est proposée aux taux de la catégorie (imprimée sur les pièces). Textes à faire relire par l'expert-comptable.</p>
      <table class="tableau-compact"><thead><tr><th>Code</th><th>Libellé</th><th>Comportement</th><th>Mention réglementaire</th><th>Exigibilité</th><th>Actif</th>
      <th class="cellule-boutons"></th></tr></thead><tbody>
      ${l.map((c, i) => `<tr data-i="${i}"><td><input data-c="code" size="16" value="${echapper(c.code)}" ${ecrire && !c._existant ? '' : 'readonly'}></td>
        <td><input data-c="libelle" size="30" value="${echapper(c.libelle)}" ${ro}></td><td data-comportement></td>
        <td><textarea data-c="mention" rows="2" cols="50" ${ro}>${echapper(c.mention ?? '')}</textarea></td><td data-exigibilite></td>
        <td><input type="checkbox" data-c="actif" ${c.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${ecrire ? '<button type="button" data-retirer title="Retirer (catégorie sans taux)">✕</button>' : ''}</td></tr>`).join('')}
      </tbody></table>`;
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const c = l[Number(tr.dataset.i)];
      poserCombo(tr, '[data-comportement]', { options: COMPORTEMENTS_TVA, valeur: c.comportement, vide: false, lecture: !ecrire }, (v) => { c.comportement = v; });
      poserCombo(tr, '[data-exigibilite]', { options: EXIGIBILITES, valeur: c.exigibilite, lecture: !ecrire, titre: 'Vide : selon le paramètre de la société' }, (v) => { c.exigibilite = v; });
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => { c[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.value; }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { l.splice(l.indexOf(c), 1); this.#rendreCategories(); });
    });
    z.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      l.push({ code: '', libelle: '', comportement: 'N', mention: '', exigibilite: null, ordre: 0, actif: true });
      this.#rendreCategories();
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.categories = (await api.comptabilite.enregistrerCategoriesTva(l.map(({ _existant, ...c }) => c))).map((c) => ({ ...c, _existant: true }));
        this.app.message('Catégories de TVA enregistrées', 'succes');
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
    z.innerHTML = `<h2 class="titre-actions">Taux de TVA ${ecrire ? '<span><button type="button" class="principal" data-enregistrer>Enregistrer</button></span>' : ''}</h2>
      <p class="aide">Collectée : TVA sur les débits ; à encaisser : TVA exigible à l'encaissement (travaux) ; autoliquidée : TVA due par le preneur (achats en autoliquidation, intracommunautaire).</p>
      <table class="tableau-compact"><thead><tr><th>Code</th><th>Libellé</th><th class="nombre">Taux</th><th>Catégorie</th><th>Comportement</th><th>Mention</th>
      <th>Collectée</th><th>À encaisser</th><th>Déductible</th><th>Autoliquidée</th><th>Actif</th></tr></thead><tbody>
      ${this.taux.map((t, i) => `<tr data-i="${i}"${t.actif ? '' : ' class="discret"'}><td>${echapper(t.code)}</td><td>${echapper(t.libelle)}</td>
        <td class="nombre">${echapper(String(t.taux).replace('.', ','))} %</td><td data-categorie></td><td data-comportement>${echapper(libelleOption(COMPORTEMENTS_TVA, t.comportement))}</td>
        <td><textarea data-c="mention" rows="2" cols="40" ${ro}>${echapper(t.mention ?? '')}</textarea></td>
        <td data-compte="compte_collectee"></td><td data-compte="compte_collectee_encaissement"></td><td data-compte="compte_deductible"></td><td data-compte="compte_autoliquidee"></td>
        <td><input type="checkbox" data-c="actif" ${t.actif ? 'checked' : ''} ${ecrire ? '' : 'disabled'}></td></tr>`).join('')}
      </tbody></table>`;
    z.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = this.taux[Number(tr.dataset.i)];
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
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => { t[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.value; }));
    });
    z.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.taux = await api.comptabilite.enregistrerTauxTva(this.taux);
        this.app.message('Taux de TVA enregistrés', 'succes');
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
  icone = '🧮';
  #modifies = new Set();

  get modifiee() { return this.#modifies.size > 0; }

  async ouvrir() {
    this.titre = 'Ventilation comptable';
    this.type = this.requete.type ?? 'VENTE';
    this.tousComptes = false;
    const ecrire = peutModifier(this.app);
    this.conteneur.innerHTML = `<div class="page-parametres page-comptabilite"><div class="entete-page"><h1 class="page-titre">🧮 Ventilation comptable</h1>
      <span class="ligne"><span data-onglets></span><label class="fiche-option"><input type="checkbox" data-tous> Tous les comptes</label>
      <label class="fiche-option"><input type="checkbox" data-inactives> Natures inactives</label>
      ${ecrire ? '<button type="button" class="principal" data-enregistrer>Enregistrer</button>' : ''}</span></div>
      <p class="aide">Compte d'une ligne sans compte saisi : nature et taux, sinon nature (colonne « Tous taux »), sinon taux (ligne « Toutes natures »),
      sinon compte par défaut du type comptable ; un type hérite des clés de son parent. Case vide : compte hérité, en gris.
      · <a href="/parametres/comptabilite">Types comptables</a> · <a href="/comptabilite/plan">Plan comptable</a></p><div data-corps></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-corps]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
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
      this.app.message('Ventilation enregistrée', 'succes');
      this.#rendre();
      return true;
    } catch (e) { this.app.message(e.message, 'erreur'); return false; }
  }

  #rendre() {
    const onglets = this.conteneur.querySelector('[data-onglets]');
    onglets.innerHTML = this.types.filter((t) => t.actif).map((t) => `<button type="button" data-type="${echapper(t.code)}" class="${t.code === this.type ? 'principal' : ''}">${echapper(t.libelle)}${this.#modifies.has(t.code) ? ' ●' : ''}</button>`).join(' ');
    onglets.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { this.type = b.dataset.type; this.#rendre(); }));
    const corps = this.conteneur.querySelector('[data-corps]');
    const type = this.types.find((t) => t.code === this.type);
    if (!type) { corps.innerHTML = '<p class="aide">Aucun type comptable.</p>'; return; }
    const ecrire = peutModifier(this.app);
    const natures = this.natures.filter((n) => n.actif || this.inactives || this.cles.some((c) => c.type === type.code && c.nature === n.code));
    const taux = this.taux.filter((t) => t.actif);
    const options = optionsComptes(this.plan, (c) => this.tousComptes || ['LES_DEUX', type.sens].includes(c.sens));
    const regle = { types: this.types.filter((t) => t.actif).map((t) => ({ code: t.code, parent: t.parent, compte_defaut: t.compte_defaut })), cles: this.cles };
    const colonnes = [...taux.map((t) => t.code), null];
    const cellule = (n, x) => `<td data-nature="${echapper(n ?? '')}" data-taux="${echapper(x ?? '')}"></td>`;
    corps.innerHTML = `<p class="aide">Compte par défaut de « ${echapper(type.libelle)} » : ${echapper(type.compte_defaut ?? (type.parent ? `celui de ${type.parent}` : 'aucun'))}${type.parent ? ` · hérite de ${echapper(type.parent)}` : ''}</p>
      <table class="tableau-compact"><thead><tr><th>Nature</th>${taux.map((t) => `<th title="${echapper(t.libelle)}">${echapper(t.code)}</th>`).join('')}<th>Tous taux</th></tr></thead><tbody>
      ${natures.map((n) => `<tr${n.actif ? '' : ' class="discret"'}><th title="${echapper(n.libelle)}">${echapper(n.code)} <small>${echapper(n.libelle)}</small></th>${colonnes.map((x) => cellule(n.code, x)).join('')}</tr>`).join('')}
      <tr><th>Toutes natures</th>${taux.map((t) => cellule(null, t.code)).join('')}<td></td></tr></tbody></table>`;
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
        combo.title = r.compte ? `Hérité : ${ORIGINES_VENTILATION[r.origine]}${r.type && r.type !== type.code ? ` (${r.type})` : ''}` : 'Aucun compte';
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
