import { texte, texteHtml, pluriel, pairesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { CONFIDENTIALITES } from '../src/acces.js';

// Paramétrage des règles de la GED (administrateur) : rétention (durée active avant archivage, durée de conservation,
// action de fin) et classification automatique au dépôt (critères → catégorie, confidentialité, mots-clés). Chaque
// liste est remplacée en bloc (fournisseur.remplacerReglesRetention / remplacerReglesClassification) : le serveur ou
// le fournisseur mémoire contrôle et normalise ; les règles elles-mêmes (retention.js, classification.js) ne changent pas.

const ACTIONS_FIN = pairesParCode('ged.regles.actions_fin', ['REVOIR', 'DETRUIRE']);

/** Liste saisie « a, b ; c » → ['a', 'b', 'c'] (sans vides ni doublons). */
export const listeDepuisTexte = (t) => [...new Set(String(t ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];

/** Entier saisi, ou null si vide (durée non renseignée). */
export const entierOuNul = (t) => (String(t ?? '').trim() === '' ? null : Number.parseInt(t, 10));

const NOUVELLE_RETENTION = () => ({ id: 0, libelle: texte('ged.regles.nouvelle'), categorie: null, type_element: null, duree_active_mois: 24, duree_conservation_mois: null, action_fin: 'REVOIR', priorite: 100, actif: true });
const NOUVELLE_CLASSIFICATION = () => ({ id: 0, libelle: texte('ged.regles.nouvelle'), priorite: 100, actif: true, extensions: [], types_mime: [], mots: [], expediteur: null, type_element: null, categorie: null, confidentialite: null, mots_cles: [] });

/**
 * Écran de paramétrage des règles de rétention et de classification.
 * Options : fournisseur (regles, parametres, echeances, remplacerReglesRetention, remplacerReglesClassification),
 * admin (sinon lecture seule), message(texte, niveau). `modifie` : modifications non enregistrées.
 */
export class ParametrageReglesGed {
  constructor(conteneur, { fournisseur, admin = false, message = () => {} }) {
    this.conteneur = conteneur;
    this.fournisseur = fournisseur;
    this.admin = admin;
    this.message = message;
    this.modifies = { retention: false, classification: false };
  }

  get modifie() { return this.modifies.retention || this.modifies.classification; }

  async ouvrir() {
    const [regles, parametres] = await Promise.all([this.fournisseur.regles(), this.fournisseur.parametres()]);
    this.retention = regles.retention;
    this.classification = regles.classification;
    this.categories = (parametres.categories ?? []).map((c) => ({ valeur: c.code, libelle: c.libelle, detail: c.code }));
    await this.compterEcheances();
    this.rendre();
  }

  /** Documents échus selon les règles enregistrées (archivage ou fin de conservation atteints). */
  async compterEcheances() {
    try { this.echeances = (await this.fournisseur.echeances()).length; } catch { this.echeances = null; }
  }

  rendre() {
    const ro = this.admin ? '' : 'disabled';
    const boutons = (cle, ajout) => (this.admin ? `<div class="boutons">
      <button type="button" data-ajout="${cle}">${iconeHtml('ajouter')} ${ajout}</button>
      <button type="button" data-annuler="${cle}" ${this.modifies[cle] ? '' : 'disabled'}>${texteHtml('ged.regles.annuler_modifs')}</button>
      <button type="button" class="principal" data-enreg="${cle}">${this.#libelleEnregistrer(cle)}</button></div>` : '');
    const ligne = (cle, i, cellules) => `<tr data-liste="${cle}" data-i="${i}">${cellules}
      <td class="ged-regles-actions"><button type="button" data-haut ${ro || (i === 0 ? 'disabled' : '')} title="${texteHtml('ged.regles.monter')}">${iconeHtml('ged_monter')}</button><button type="button" data-bas ${ro || (i === this[cle].length - 1 ? 'disabled' : '')} title="${texteHtml('ged.regles.descendre')}">${iconeHtml('ged_descendre')}</button><button type="button" data-suppr ${ro} title="${texteHtml('commun.supprimer')}">${iconeHtml('retirer')}</button></td></tr>`;
    const champ = (c, v, attrs = '') => `<input data-c="${c}" value="${echapper(v ?? '')}" ${attrs} ${ro}>`;
    const nombre = (c, v, placeholder) => `<input data-c="${c}" type="number" min="0" step="1" value="${v ?? ''}" placeholder="${placeholder}" ${ro}>`;
    const liste = (c, v) => champ(c, (v ?? []).join(', '), 'data-liste-texte');
    const actif = (v) => `<input data-c="actif" type="checkbox" ${v !== false ? 'checked' : ''} ${ro}>`;

    this.conteneur.innerHTML = `<div class="ged-regles">
      ${this.admin ? '' : `<p class="aide">${texteHtml('ged.regles.lecture_seule')}</p>`}
      <section class="panneau">
        <h2>${iconeHtml('ged_retention')} ${texteHtml('ged.regles.retention')}</h2>
        <p class="aide">${texteHtml('ged.regles.retention_aide', { icone: icone('ged_retention') })}</p>
        ${this.echeances === null || this.echeances === undefined ? '' : `<p class="aide">${this.echeances ? pluriel('ged.regles.echus_html', this.echeances) : texteHtml('ged.regles.aucun_echu')}</p>`}
        <div class="ged-regles-defilement"><table class="table-parametres tableau-compact largeur-contenu">
          <thead><tr><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('ged.champs.categorie')}</th><th>${texteHtml('ged.regles.type_element')}</th><th>${texteHtml('ged.regles.active_mois')}</th><th>${texteHtml('ged.regles.conservation_mois')}</th><th>${texteHtml('ged.regles.fin')}</th><th>${texteHtml('ged.regles.priorite')}</th><th>${texteHtml('ged.regles.active')}</th><th></th></tr></thead>
          <tbody>${this.retention.map((r, i) => ligne('retention', i, `
            <td>${champ('libelle', r.libelle, 'size="18"')}</td>
            <td data-combo="categorie"></td>
            <td>${champ('type_element', r.type_element, `size="10" placeholder="${texteHtml('ged.regles.tous')}"`)}</td>
            <td>${nombre('duree_active_mois', r.duree_active_mois, texteHtml('ged.regles.jamais'))}</td>
            <td>${nombre('duree_conservation_mois', r.duree_conservation_mois, texteHtml('ged.regles.illimitee'))}</td>
            <td data-combo="action_fin"></td>
            <td>${nombre('priorite', r.priorite, '100')}</td>
            <td>${actif(r.actif)}</td>`)).join('')}</tbody>
        </table></div>
        ${boutons('retention', texteHtml('ged.regles.ajouter_retention'))}
      </section>
      <section class="panneau">
        <h2>${iconeHtml('ged_classification')} ${texteHtml('ged.regles.classification')}</h2>
        <p class="aide">${texteHtml('ged.regles.classification_aide')}</p>
        <div class="ged-regles-defilement"><table class="table-parametres tableau-compact largeur-contenu">
          <thead><tr><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('ged.regles.priorite')}</th><th>${texteHtml('ged.regles.extensions')}</th><th>${texteHtml('ged.regles.types_mime')}</th><th>${texteHtml('ged.regles.mots')}</th><th>${texteHtml('ged.regles.expediteur')}</th><th>${texteHtml('ged.regles.type_element')}</th><th>${texteHtml('ged.regles.vers_categorie')}</th><th>${texteHtml('ged.regles.vers_confidentialite')}</th><th>${texteHtml('ged.regles.vers_mots_cles')}</th><th>${texteHtml('ged.regles.active')}</th><th></th></tr></thead>
          <tbody>${this.classification.map((r, i) => ligne('classification', i, `
            <td>${champ('libelle', r.libelle, 'size="16"')}</td>
            <td>${nombre('priorite', r.priorite, '100')}</td>
            <td>${liste('extensions', r.extensions)}</td>
            <td>${liste('types_mime', r.types_mime)}</td>
            <td>${liste('mots', r.mots)}</td>
            <td>${champ('expediteur', r.expediteur, 'size="12"')}</td>
            <td>${champ('type_element', r.type_element, 'size="10"')}</td>
            <td data-combo="categorie"></td>
            <td data-combo="confidentialite"></td>
            <td>${liste('mots_cles', r.mots_cles)}</td>
            <td>${actif(r.actif)}</td>`)).join('')}</tbody>
        </table></div>
        ${boutons('classification', texteHtml('ged.regles.ajouter_classification'))}
      </section></div>`;

    const z = this.conteneur;
    // Combos du socle (jamais de <select>) : catégorie (vide = toutes ou aucune), action de fin, confidentialité.
    const optionsCombo = {
      categorie: { options: this.categories, vide: true },
      action_fin: { options: ACTIONS_FIN.map(([valeur, libelle]) => ({ valeur, libelle })), vide: false },
      confidentialite: { options: CONFIDENTIALITES.map(([valeur, libelle]) => ({ valeur, libelle })), vide: true },
    };
    z.querySelectorAll('[data-combo]').forEach((td) => {
      const tr = td.closest('tr');
      const r = this[tr.dataset.liste][Number(tr.dataset.i)];
      const c = td.dataset.combo;
      const combo = creerCombo({ ...optionsCombo[c], valeur: r[c] ?? '' });
      combo.dataset.c = c;
      combo.size = 14;
      if (!this.admin) combo.readOnly = true;
      td.append(combo);
    });
    if (!this.admin) return;

    z.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => {
      const tr = el.closest('tr');
      const r = this[tr.dataset.liste][Number(tr.dataset.i)];
      const c = el.dataset.c;
      if (el.type === 'checkbox') r[c] = el.checked;
      else if (el.classList.contains('combo')) r[c] = el.valeurCombo === '' ? null : el.valeurCombo;
      else if (el.type === 'number') r[c] = c === 'priorite' ? (entierOuNul(el.value) ?? 100) : entierOuNul(el.value);
      // Extensions comme le serveur (sans point, en minuscules), sans doublon.
      else if (el.hasAttribute('data-liste-texte')) r[c] = listeDepuisTexte(c === 'extensions' ? el.value.toLowerCase().replace(/(^|[,;\s])\.+/g, '$1') : el.value);
      else r[c] = c === 'libelle' ? el.value : (el.value.trim() || null);
      this.marquer(tr.dataset.liste);
    }));
    z.querySelectorAll('[data-haut], [data-bas], [data-suppr]').forEach((b) => b.addEventListener('click', () => {
      const tr = b.closest('tr');
      const liste = this[tr.dataset.liste];
      const i = Number(tr.dataset.i);
      if (b.dataset.suppr !== undefined) liste.splice(i, 1);
      else {
        const j = b.dataset.haut !== undefined ? i - 1 : i + 1;
        [liste[i], liste[j]] = [liste[j], liste[i]];
        // Monter ou descendre échange aussi les priorités : l'ordre affiché reste celui de l'application des règles.
        [liste[i].priorite, liste[j].priorite] = [liste[j].priorite, liste[i].priorite];
        if (liste[i].priorite === liste[j].priorite) liste[Math.min(i, j)].priorite -= 1;
      }
      this.marquer(tr.dataset.liste, true);
    }));
    z.querySelectorAll('[data-ajout]').forEach((b) => b.addEventListener('click', () => {
      const cle = b.dataset.ajout;
      this[cle].push(cle === 'retention' ? NOUVELLE_RETENTION() : NOUVELLE_CLASSIFICATION());
      this.marquer(cle, true);
      z.querySelector(`tr[data-liste="${cle}"]:last-of-type [data-c="libelle"]`)?.select();
    }));
    z.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', async () => {
      const regles = await this.fournisseur.regles();
      this[b.dataset.annuler] = regles[b.dataset.annuler];
      this.modifies[b.dataset.annuler] = false;
      this.rendre();
    }));
    z.querySelectorAll('[data-enreg]').forEach((b) => b.addEventListener('click', () => this.enregistrer(b.dataset.enreg)));
  }

  /** Libellé du bouton Enregistrer, marqué quand la liste a des modifications non enregistrées. */
  #libelleEnregistrer(cle) { return this.modifies[cle] ? texte('ged.regles.enregistrer_modifie', { marque: icone('ged_modifie') }) : texte('commun.enregistrer'); }

  /** Liste modifiée : le bouton Enregistrer l'indique ; `rerendre` pour les changements de structure (ordre, ajout). */
  marquer(cle, rerendre = false) {
    this.modifies[cle] = true;
    if (rerendre) { this.rendre(); return; }
    // Saisie dans un champ : pas de nouveau rendu (le focus passe au champ suivant).
    this.conteneur.querySelector(`[data-annuler="${cle}"]`).disabled = false;
    this.conteneur.querySelector(`[data-enreg="${cle}"]`).textContent = this.#libelleEnregistrer(cle);
  }

  async enregistrer(cle) {
    try {
      const regles = cle === 'retention'
        ? await this.fournisseur.remplacerReglesRetention(this.retention)
        : await this.fournisseur.remplacerReglesClassification(this.classification);
      this.retention = regles.retention;
      this.classification = regles.classification;
      this.modifies[cle] = false;
      if (cle === 'retention') await this.compterEcheances();
      this.rendre();
      this.message(cle === 'retention' ? texte('ged.regles.retention_enregistrees') : texte('ged.regles.classification_enregistrees'));
    } catch (e) { this.message(e.message, 'erreur'); }
  }
}
