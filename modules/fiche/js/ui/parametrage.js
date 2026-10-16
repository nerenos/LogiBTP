import { echapper, creerCombo } from '@logibtp/socle/ui';
import { FORMATS_PREDEFINIS, erreurRequete } from '../src/validation.js';

// Paramétrage d'un type de fiche (profil ADMIN) :
// - champs du logiciel : rendre obligatoire un champ facultatif, rendre confidentiel (RGPD : masqué, révélé à la
//   demande et journalisé) un champ qui ne l'est pas ;
// - champs supplémentaires : libellé, type (dont mot de passe chiffré en base), onglet et groupe (cadre titré), ordre
//   (↑ ↓), format, longueur, aide, liste de valeurs saisies ou requête SQL (exécutée par le serveur en lecture seule),
//   obligatoire, confidentiel, actif.
// Les valeurs des champs supplémentaires sont stockées dans la colonne JSONB du type (tyf_colonne_proprietes).

const TYPES = [['texte', 'Texte'], ['nombre', 'Numérique'], ['booleen', 'Oui / non'], ['date', 'Date'], ['liste', 'Liste de valeurs'],
  ['motdepasse', 'Mot de passe (chiffré)']];
/** Onglet Informations complémentaires (champ sans onglet de la définition). */
const SANS_ONGLET = '+supplementaires';
const LIBELLES_TYPES = Object.fromEntries([...TYPES, ['zone', 'Texte long'], ['html', 'Texte mis en forme'], ['json', 'Données liées']]);

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
    this.ouverts = new Set();
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
      this.p.supplementaires.push({ code: '', libelle: '', type: 'texte', actif: true, nouveau: true });
      this.#renumeroter();
      this.ouverts.add(this.p.supplementaires.length - 1);
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
    this.p.confidentiels ??= [];
    this.p.supplementaires ??= [];
    this.p.supplementaires.sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
    this.#renumeroter();
    this.rendre();
  }

  /** Ordre des champs supplémentaires = ordre de la liste (10, 20…). */
  #renumeroter() { this.p.supplementaires.forEach((c, i) => { c.ordre = (i + 1) * 10; }); }

  #onglets() {
    return [{ valeur: SANS_ONGLET, libelle: 'Informations complémentaires' }, ...(this.definition.sections ?? []).map((s) => ({ valeur: s.code, libelle: s.titre }))];
  }

  rendre() {
    const obligatoires = new Set(this.p.obligatoires);
    const confidentiels = new Set(this.p.confidentiels);
    const groupes = [...new Set(this.p.supplementaires.map((c) => c.groupe).filter(Boolean))];
    const onglets = this.#onglets();
    const libelleOnglet = (code) => onglets.find((o) => o.valeur === (code ?? SANS_ONGLET))?.libelle ?? '';
    const n = this.p.supplementaires.length;
    this.corps.innerHTML = `
      <h3>Champs du logiciel</h3>
      <p class="aide">* obligatoire pour le logiciel (non modifiable) ; cochez pour imposer la saisie d'un champ facultatif.
        RGPD : un champ confidentiel est masqué, affiché à la demande (droit CONFIDENTIEL) et chaque accès est journalisé.</p>
      <table class="fiche-param"><thead><tr><th>Champ</th><th>Type</th><th>Obligatoire</th><th title="Donnée personnelle : masquée et journalisée">RGPD 🔒</th></tr></thead><tbody>
        ${this.definition.champs.filter((c) => !c.gere).map((c) => {
          const duLogiciel = c.confidentiel && !c.confidentiel_parametre;
          return `<tr><td>${echapper(c.libelle)}</td><td>${echapper(LIBELLES_TYPES[c.type] ?? c.type)}</td>
          <td>${c.obligatoire ? '<span title="Obligatoire pour le logiciel">*</span>' : c.lecture_seule ? '' : `<input type="checkbox" data-obligatoire="${echapper(c.code)}" ${obligatoires.has(c.code) ? 'checked' : ''}>`}</td>
          <td>${duLogiciel ? '<span title="Confidentiel pour le logiciel">🔒</span>' : `<input type="checkbox" data-confidentiel="${echapper(c.code)}" ${confidentiels.has(c.code) ? 'checked' : ''}>`}</td></tr>`;
        }).join('')}
      </tbody></table>
      <h3>Champs supplémentaires</h3>
      <p class="aide">Ordre : ↑ ↓ ; onglet et groupe (cadre titré) : où le champ s'affiche dans la fiche. ▸ : format, longueur, aide, valeurs.</p>
      <table class="fiche-param fiche-param-supplementaires"><thead><tr><th></th><th>Code</th><th>Libellé</th><th>Type</th><th>Onglet</th><th>Groupe</th>
        <th title="Obligatoire">Oblig.</th><th title="Confidentiel (RGPD)">🔒</th><th>Actif</th><th></th></tr></thead><tbody>
        ${this.p.supplementaires.map((c, i) => `<tr data-i="${i}">
          <td class="fiche-param-ordre"><button type="button" data-monter title="Monter" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-descendre title="Descendre" ${i === n - 1 ? 'disabled' : ''}>↓</button></td>
          <td><input data-c="code" value="${echapper(c.code)}" ${c.nouveau ? '' : 'readonly'} size="12" placeholder="code"></td>
          <td><input data-c="libelle" value="${echapper(c.libelle)}" size="18"></td>
          <td data-combo="type"></td>
          <td data-combo="section" title="${echapper(libelleOnglet(c.section))}"></td>
          <td><input data-c="groupe" list="groupes-fiche" value="${echapper(c.groupe ?? '')}" size="14" placeholder="(sans groupe)"></td>
          <td><input type="checkbox" data-c="obligatoire" ${c.obligatoire ? 'checked' : ''}></td>
          <td><input type="checkbox" data-c="confidentiel" ${c.confidentiel ? 'checked' : ''}></td>
          <td><input type="checkbox" data-c="actif" ${c.actif !== false ? 'checked' : ''}></td>
          <td class="fiche-param-ordre"><button type="button" data-details title="Format, longueur, aide, valeurs">${this.ouverts.has(i) ? '▾' : '▸'}</button><button type="button" data-suppr title="Supprimer (les valeurs déjà saisies restent stockées)">✕</button></td></tr>
          ${this.ouverts.has(i) ? `<tr class="fiche-param-details" data-i="${i}"><td></td><td colspan="9"><div class="fiche-param-grille">
            <label>Format <input data-c="format" list="formats-fiche" value="${echapper(c.format ?? '')}" ${['texte', 'nombre', 'motdepasse'].includes(c.type) ? '' : 'disabled'}></label>
            <label>Longueur max. <input data-c="longueur" type="number" min="1" value="${c.longueur ?? ''}" ${['texte', 'motdepasse'].includes(c.type) ? '' : 'disabled'}></label>
            <label class="large">Aide (infobulle) <input data-c="aide" value="${echapper(c.aide ?? '')}" maxlength="200"></label>
            ${c.type === 'liste' ? `
            <label class="large">Valeurs (A = Libellé ; B = Libellé) <input data-c="options" value="${echapper(optionsVersTexte(c.options))}" ${c.requete ? 'disabled' : ''}></label>
            <label class="large">Ou requête SQL (1re colonne : valeur, 2e : libellé ; exécutée en lecture seule)
              <textarea data-c="requete" rows="2" spellcheck="false" placeholder="SELECT code, libelle FROM … ORDER BY libelle">${echapper(c.requete ?? '')}</textarea></label>` : ''}
            ${c.type === 'motdepasse' ? '<p class="aide large">Chiffré en base par la chaîne de l\'installation ; affiché à la demande (👁), chaque accès est journalisé. Jamais copié.</p>' : ''}
          </div></td></tr>` : ''}`).join('') || '<tr><td colspan="10" class="aide">Aucun champ supplémentaire</td></tr>'}
      </tbody></table>
      <datalist id="formats-fiche">${FORMATS_PREDEFINIS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}<option value="999.99">Masque numérique</option></datalist>
      <datalist id="groupes-fiche">${groupes.map((g) => `<option value="${echapper(g)}"></option>`).join('')}</datalist>`;

    this.corps.querySelectorAll('[data-obligatoire]').forEach((el) => el.addEventListener('change', () => {
      this.p.obligatoires = this.#basculer(this.p.obligatoires, el.dataset.obligatoire, el.checked);
    }));
    this.corps.querySelectorAll('[data-confidentiel]').forEach((el) => el.addEventListener('change', () => {
      this.p.confidentiels = this.#basculer(this.p.confidentiels, el.dataset.confidentiel, el.checked);
    }));
    this.corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const i = Number(tr.dataset.i);
      const c = this.p.supplementaires[i];
      tr.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.c;
        if (el.type === 'checkbox') c[k] = el.checked;
        else if (k === 'longueur') c[k] = el.value === '' ? null : Number(el.value);
        else if (k === 'options') c.options = texteVersOptions(el.value);
        else c[k] = el.value.trim() || null;
        if (k === 'requete') {
          const e = c.requete ? erreurRequete(c.requete) : null;
          this.#erreur(e ? `${c.libelle || c.code} : ${e}` : '');
          this.rendre();
        }
      }));
      const combo = (cle, options, surChange) => {
        const td = tr.querySelector(`[data-combo="${cle}"]`);
        if (!td) return;
        const el = creerCombo({ options, valeur: c[cle] ?? (cle === 'section' ? SANS_ONGLET : ''), vide: false });
        el.size = 14;
        el.addEventListener('change', () => surChange(el.valeurCombo));
        td.append(el);
      };
      combo('type', TYPES.map(([valeur, libelle]) => ({ valeur, libelle })), (v) => {
        c.type = v;
        if (v !== 'liste') { c.requete = null; c.options = null; }
        this.rendre();
      });
      combo('section', onglets, (v) => { c.section = v === SANS_ONGLET ? null : v; });
      tr.querySelector('[data-monter]')?.addEventListener('click', () => this.#deplacer(i, -1));
      tr.querySelector('[data-descendre]')?.addEventListener('click', () => this.#deplacer(i, 1));
      tr.querySelector('[data-details]')?.addEventListener('click', () => {
        if (this.ouverts.has(i)) this.ouverts.delete(i); else this.ouverts.add(i);
        this.rendre();
      });
      tr.querySelector('[data-suppr]')?.addEventListener('click', () => {
        this.p.supplementaires.splice(i, 1);
        this.ouverts = new Set([...this.ouverts].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
        this.#renumeroter();
        this.rendre();
      });
    });
  }

  #basculer(liste, code, actif) {
    const s = new Set(liste);
    if (actif) s.add(code); else s.delete(code);
    return [...s];
  }

  #deplacer(i, sens) {
    const l = this.p.supplementaires;
    const j = i + sens;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    const ouvertI = this.ouverts.has(i), ouvertJ = this.ouverts.has(j);
    this.ouverts.delete(i); this.ouverts.delete(j);
    if (ouvertI) this.ouverts.add(j);
    if (ouvertJ) this.ouverts.add(i);
    this.#renumeroter();
    this.rendre();
  }

  async enregistrer() {
    try {
      const p = {
        obligatoires: this.p.obligatoires,
        confidentiels: this.p.confidentiels,
        supplementaires: this.p.supplementaires.map(({ nouveau, ...c }) => c),
      };
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
