import { texte, texteHtml, iconeHtml, pairesParCode } from '@logibtp/socle/dictionnaire';
import { echapper, confirmer } from '@logibtp/socle/ui';

// Paramétrage de l'annuaire (classe mère) : niveaux de personne (morale ou particulier), relations (« casquettes » dans le
// code : client, fournisseur…, avec les groupes de champs
// de la fiche qu'elles déverrouillent), types de lien (libellé vu depuis la cible), rôles internes des individus.

const ONGLETS = pairesParCode('annuaire.referentiels.onglets', [['niveaux', 'niveaux'], ['casquettes', 'casquettes'], ['types-lien', 'types_lien'], ['roles', 'roles']]);
const CLE_REFERENTIELS = { niveaux: 'niveaux', casquettes: 'casquettes', 'types-lien': 'types_lien', roles: 'roles' };

export class GestionReferentielsAnnuaire {
  /** options : fournisseur (annuaire) ; groupes [{ code, titre }] (groupes de la fiche personne déverrouillables) ; admin ; message. */
  constructor(conteneur, { fournisseur, groupes = [], admin = false, message = () => {} }) {
    this.racine = conteneur;
    this.fournisseur = fournisseur;
    this.groupes = groupes;
    this.admin = admin;
    this.message = message;
    this.onglet = 'casquettes';
    this.racine.classList.add('annuaire-referentiels');
    this.racine.innerHTML = `<nav class="bib-onglets">${ONGLETS.map(([c, t]) => `<button type="button" data-onglet="${c}">${echapper(t)}</button>`).join('')}</nav>
      ${admin ? '' : `<p class="aide">${texteHtml('annuaire.referentiels.consultation')}</p>`}<div class="bib-zone"></div>`;
    this.racine.querySelector('.bib-onglets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-onglet]');
      if (b) { this.onglet = b.dataset.onglet; this.rendre().catch((x) => this.#erreur(x)); }
    });
  }

  #erreur(e) { console.error(e); this.message(e.message ?? String(e), 'erreur'); }

  async ouvrir() { await this.rendre(); }

  #colonnes() {
    const base = [{ code: 'code', libelle: texte('commun.code'), largeur: '9rem', creation: true }, { code: 'libelle', libelle: texte('commun.libelle') }];
    const icone = { code: 'icone', libelle: texte('annuaire.referentiels.colonnes.icone'), largeur: '3.5rem' };
    const fin = [{ code: 'ordre', libelle: texte('annuaire.referentiels.colonnes.ordre'), largeur: '4rem' }, { code: 'actif', libelle: texte('annuaire.referentiels.colonnes.actif'), type: 'case' }];
    return {
      niveaux: [...base, icone, { code: 'morale', libelle: texte('annuaire.referentiels.colonnes.morale'), type: 'case', aide: texte('annuaire.referentiels.colonnes.morale_aide') }, ...fin],
      casquettes: [...base, icone, { code: 'groupes', libelle: texte('annuaire.referentiels.colonnes.groupes'), type: 'groupes' }, ...fin],
      'types-lien': [...base, { code: 'libelle_inverse', libelle: texte('annuaire.referentiels.colonnes.libelle_inverse') }, ...fin],
      roles: [...base, icone, ...fin],
    }[this.onglet];
  }

  async rendre() {
    this.racine.querySelectorAll('[data-onglet]').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === this.onglet));
    const zone = this.racine.querySelector('.bib-zone');
    const lignes = (await this.fournisseur.referentiels())[CLE_REFERENTIELS[this.onglet]];
    const colonnes = this.#colonnes();
    const ro = !this.admin;
    const champ = (c, l) => {
      const v = l[c.code];
      if (c.type === 'case') return `<input type="checkbox" data-c="${c.code}" ${v ?? (c.code === 'actif' || c.code === 'morale') ? 'checked' : ''} ${ro ? 'disabled' : ''} title="${echapper(c.aide ?? '')}">`;
      if (c.type === 'groupes') {
        return `<span class="bib-cases" data-c="${c.code}" data-cases>${this.groupes.map((g) => `<label><input type="checkbox" value="${echapper(g.code)}" ${(v ?? []).includes(g.code) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${echapper(g.titre)}</label>`).join('')
          || `<span class="aide">${texteHtml('annuaire.referentiels.filtre_seulement')}</span>`}</span>`;
      }
      const lecture = ro || (c.creation && !l._nouveau);
      return `<input data-c="${c.code}" value="${echapper(v ?? '')}" ${c.largeur ? `style="width:${c.largeur}"` : ''} ${lecture ? 'readonly' : ''}>`;
    };
    zone.innerHTML = `<table class="bib-table tableau-compact largeur-contenu"><thead><tr>${colonnes.map((c) => `<th>${echapper(c.libelle)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${[...lignes, ...(ro ? [] : [{ _nouveau: true, ordre: (lignes.at(-1)?.ordre ?? 0) + 10 }])].map((l, i) => `<tr data-i="${i}" class="${l._nouveau ? 'ajout' : ''}">
        ${colonnes.map((c) => `<td>${champ(c, l)}</td>`).join('')}
        <td class="bib-actions">${ro ? '' : `<button type="button" data-action="enregistrer">${l._nouveau ? `${iconeHtml('ajouter')} ${texteHtml('commun.ajouter')}` : iconeHtml('annuaire_enregistrer')}</button>${l._nouveau ? '' : `<button type="button" data-action="supprimer" title="${texteHtml('annuaire.referentiels.supprimer_aide')}">${iconeHtml('supprimer')}</button>`}`}</td></tr>`).join('')}
      </tbody></table>
      ${this.onglet === 'casquettes' ? `<p class="aide">${texteHtml('annuaire.referentiels.aide_casquettes')}</p>` : ''}
      ${this.onglet === 'niveaux' ? `<p class="aide">${texteHtml('annuaire.referentiels.aide_niveaux')}</p>` : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const l = [...lignes, { _nouveau: true }][Number(tr.dataset.i)];
      const lire = () => {
        const r = { ...l };
        delete r._nouveau;
        tr.querySelectorAll('[data-c]').forEach((el) => {
          if (el.dataset.cases !== undefined) r[el.dataset.c] = [...el.querySelectorAll('input:checked')].map((x) => x.value);
          else if (el.type === 'checkbox') r[el.dataset.c] = el.checked;
          else r[el.dataset.c] = el.dataset.c === 'ordre' ? Number(el.value || 0) : el.value;
        });
        return r;
      };
      tr.querySelector('[data-action="enregistrer"]')?.addEventListener('click', async () => {
        try {
          await this.fournisseur.enregistrerReferentiel(this.onglet, lire());
          this.message(texte('annuaire.referentiels.enregistre'), 'succes');
          await this.rendre();
        } catch (e) { this.#erreur(e); }
      });
      tr.querySelector('[data-action="supprimer"]')?.addEventListener('click', async () => {
        if (!await confirmer(texte('annuaire.referentiels.supprimer_confirmer', { libelle: l.libelle }))) return;
        try {
          await this.fournisseur.supprimerReferentiel(this.onglet, l.code);
          await this.rendre();
        } catch (e) { this.#erreur(e); }
      });
    });
  }
}
