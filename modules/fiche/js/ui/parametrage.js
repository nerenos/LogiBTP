import { echapper } from '@logibtp/socle/ui';
import { FORMATS_PREDEFINIS } from '../src/validation.js';

// Paramétrage d'un type de fiche (profil ADMIN) : rendre obligatoires des champs facultatifs du programme et
// définir des champs supplémentaires (libellé, type, format, longueur, liste de valeurs, obligatoire, confidentiel).
// Les valeurs des champs supplémentaires sont stockées dans la colonne JSONB du type (tyf_colonne_proprietes).

const TYPES = [['texte', 'Texte'], ['nombre', 'Numérique'], ['booleen', 'Oui / non'], ['date', 'Date'], ['liste', 'Liste de valeurs']];
const opt = (v, l, c) => `<option value="${echapper(v)}" ${String(c ?? '') === String(v) ? 'selected' : ''}>${echapper(l)}</option>`;

/** « A = Libellé ; B » ⇄ [{ valeur, libelle }]. */
const optionsVersTexte = (o) => (o ?? []).map((x) => (x.libelle && x.libelle !== x.valeur ? `${x.valeur} = ${x.libelle}` : x.valeur)).join(' ; ');
const texteVersOptions = (t) => String(t ?? '').split(';').map((x) => x.trim()).filter(Boolean)
  .map((x) => { const [v, ...l] = x.split('='); return { valeur: v.trim(), libelle: l.join('=').trim() || v.trim() }; });

export class ParametrageFiche {
  constructor({ fournisseur, type, definition, message, fermer }) {
    this.fournisseur = fournisseur;
    this.type = type;
    this.definition = definition;
    this.message = message ?? (() => {});
    this.surFermer = fermer;
    this.modifie = false;
    this.fond = document.createElement('div');
    this.fond.className = 'fiche-dialogue-fond';
    this.fond.innerHTML = `
      <div class="fiche-dialogue" role="dialog" aria-label="Paramétrage de la fiche">
        <header><strong>Paramétrage des fiches ${echapper(definition.libelle)}</strong>
          <button type="button" data-action="fermer" title="Fermer (Échap)">✕</button></header>
        <div class="fiche-dialogue-corps"></div>
        <footer><span class="fiche-dialogue-message"></span>
          <button type="button" data-action="ajouter">Ajouter un champ supplémentaire</button>
          <button type="button" class="principal" data-action="enregistrer">Enregistrer</button></footer>
      </div>`;
    document.body.append(this.fond);
    this.corps = this.fond.querySelector('.fiche-dialogue-corps');
    this.fond.querySelector('[data-action="fermer"]').addEventListener('click', () => this.fermer());
    this.fond.querySelector('[data-action="ajouter"]').addEventListener('click', () => {
      this.p.supplementaires.push({ code: '', libelle: '', type: 'texte', ordre: (this.p.supplementaires.length + 1) * 10, actif: true, nouveau: true });
      this.rendre();
    });
    this.fond.querySelector('[data-action="enregistrer"]').addEventListener('click', () => this.enregistrer());
    this.clavier = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.fermer(); } };
    document.addEventListener('keydown', this.clavier, true);
    this.charger().catch((e) => this.#erreur(e.message));
  }

  #erreur(t) {
    const m = this.fond.querySelector('.fiche-dialogue-message');
    m.textContent = t ?? '';
    m.classList.toggle('erreur', !!t);
  }

  async charger() {
    this.p = await this.fournisseur.parametrage(this.type);
    this.p.obligatoires ??= [];
    this.p.supplementaires ??= [];
    this.rendre();
  }

  rendre() {
    const obligatoires = new Set(this.p.obligatoires);
    this.corps.innerHTML = `
      <h3>Champs du programme</h3>
      <p class="aide">* obligatoire pour le programme (non modifiable) ; cochez pour imposer la saisie d'un champ facultatif.</p>
      <table class="fiche-param"><thead><tr><th>Champ</th><th>Type</th><th>Obligatoire</th></tr></thead><tbody>
        ${this.definition.champs.filter((c) => !c.lecture_seule).map((c) => `<tr><td>${echapper(c.libelle)}${c.confidentiel ? ' 🔒' : ''}</td><td>${echapper(c.type)}</td>
          <td>${c.obligatoire ? '<span title="Obligatoire pour le programme">*</span>' : `<input type="checkbox" data-obligatoire="${echapper(c.code)}" ${obligatoires.has(c.code) ? 'checked' : ''}>`}</td></tr>`).join('')}
      </tbody></table>
      <h3>Champs supplémentaires</h3>
      <p class="aide">Format : e-mail, téléphone, code postal, masque numérique (999.99 : 3 chiffres entiers, 2 décimales) ou regex:… ;
        liste : « A = Libellé ; B = Libellé ».</p>
      <table class="fiche-param"><thead><tr><th>Code</th><th>Libellé</th><th>Type</th><th>Format</th><th>Long.</th><th>Valeurs (liste)</th>
        <th title="Obligatoire">Oblig.</th><th title="Confidentiel">🔒</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
        ${this.p.supplementaires.map((c, i) => `<tr data-i="${i}">
          <td><input data-c="code" value="${echapper(c.code)}" ${c.nouveau ? '' : 'readonly'} size="10" placeholder="code"></td>
          <td><input data-c="libelle" value="${echapper(c.libelle)}"></td>
          <td><select data-c="type">${TYPES.map(([v, l]) => opt(v, l, c.type)).join('')}</select></td>
          <td><input data-c="format" list="formats-fiche" value="${echapper(c.format ?? '')}" size="10"></td>
          <td><input data-c="longueur" type="number" min="1" value="${c.longueur ?? ''}" style="width:4.5rem"></td>
          <td><input data-c="options" value="${echapper(optionsVersTexte(c.options))}" ${c.type === 'liste' ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-c="obligatoire" ${c.obligatoire ? 'checked' : ''}></td>
          <td><input type="checkbox" data-c="confidentiel" ${c.confidentiel ? 'checked' : ''}></td>
          <td><input data-c="ordre" type="number" value="${c.ordre ?? 0}" style="width:4rem"></td>
          <td><input type="checkbox" data-c="actif" ${c.actif !== false ? 'checked' : ''}></td>
          <td><button type="button" data-suppr title="Supprimer (les valeurs déjà saisies restent stockées)">✕</button></td></tr>`).join('') || '<tr><td colspan="11" class="aide">Aucun champ supplémentaire</td></tr>'}
      </tbody></table>
      <datalist id="formats-fiche">${FORMATS_PREDEFINIS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}<option value="999.99">Masque numérique</option></datalist>`;
    this.corps.querySelectorAll('[data-obligatoire]').forEach((el) => el.addEventListener('change', () => {
      const s = new Set(this.p.obligatoires);
      if (el.checked) s.add(el.dataset.obligatoire); else s.delete(el.dataset.obligatoire);
      this.p.obligatoires = [...s];
    }));
    this.corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const c = this.p.supplementaires[Number(tr.dataset.i)];
      tr.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.c;
        if (el.type === 'checkbox') c[k] = el.checked;
        else if (k === 'longueur' || k === 'ordre') c[k] = el.value === '' ? null : Number(el.value);
        else if (k === 'options') c.options = texteVersOptions(el.value);
        else c[k] = el.value.trim() || null;
        if (k === 'type') this.rendre();
      }));
      tr.querySelector('[data-suppr]').addEventListener('click', () => { this.p.supplementaires.splice(Number(tr.dataset.i), 1); this.rendre(); });
    });
  }

  async enregistrer() {
    try {
      const p = { obligatoires: this.p.obligatoires, supplementaires: this.p.supplementaires.map(({ nouveau, ...c }) => c) };
      this.p = await this.fournisseur.enregistrerParametrage(this.type, p);
      this.modifie = true;
      this.#erreur('');
      this.message('Paramétrage enregistré', 'succes');
      this.fermer();
    } catch (e) {
      this.#erreur(e.message);
    }
  }

  fermer() {
    document.removeEventListener('keydown', this.clavier, true);
    this.fond.remove();
    this.surFermer?.(this.modifie);
  }
}
