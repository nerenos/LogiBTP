import { echapper } from '@logibtp/socle/ui';
import { SCENARIOS_PA } from '../src/calcul.js';

// Paramétrage de la bibliothèque (classe mère) : bibliothèques (code d'appel, bibliothèque par défaut), familles en
// arborescence par bibliothèque, natures (regroupement, axe analytique, comptes), regroupements personnalisables,
// scénarios de prix d'achat (défaut à la création, scénarios autorisés) et coefficients par défaut.

const ONGLETS = [['bibliotheques', 'Bibliothèques'], ['familles', 'Familles'], ['natures', 'Natures'], ['regroupements', 'Regroupements'], ['prix', 'Prix d\'achat']];

export class GestionReferentiels {
  constructor(conteneur, { fournisseur, message = () => {}, admin = false }) {
    this.racine = conteneur;
    this.fournisseur = fournisseur;
    this.message = message;
    this.admin = admin;
    this.onglet = 'bibliotheques';
    this.bibId = null;
    this.racine.classList.add('bib-referentiels');
    this.racine.innerHTML = `<nav class="bib-onglets">${ONGLETS.map(([c, t]) => `<button type="button" data-onglet="${c}">${t}</button>`).join('')}</nav>
      ${admin ? '' : '<p class="aide">Consultation : le paramétrage est réservé à un administrateur.</p>'}<div class="bib-zone"></div>`;
    this.racine.querySelector('.bib-onglets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-onglet]');
      if (b) { this.onglet = b.dataset.onglet; this.rendre().catch((x) => this.#erreur(x)); }
    });
  }

  #erreur(e) { console.error(e); this.message(e.message ?? String(e), 'erreur'); }

  async ouvrir() { await this.rendre(); }

  async rendre() {
    this.racine.querySelectorAll('[data-onglet]').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === this.onglet));
    const zone = this.racine.querySelector('.bib-zone');
    const rendus = { bibliotheques: () => this.#bibliotheques(zone), familles: () => this.#familles(zone), natures: () => this.#natures(zone), regroupements: () => this.#regroupements(zone), prix: () => this.#prix(zone) };
    await rendus[this.onglet]();
  }

  /** Tableau éditable : une ligne par élément + une ligne d'ajout ; enregistrer(ligne) et supprimer(ligne) appellent le fournisseur. */
  #tableau(zone, { colonnes, lignes, cle, enregistrer, supprimer, vide = {} }) {
    const ro = !this.admin;
    const champ = (c, v) => {
      if (c.type === 'case') return `<input type="checkbox" data-c="${c.code}" ${v ? 'checked' : ''} ${ro ? 'disabled' : ''}>`;
      if (c.options) return `<select data-c="${c.code}" ${ro ? 'disabled' : ''}><option value=""></option>${c.options.map((o) => `<option value="${echapper(o.valeur)}" ${String(o.valeur) === String(v ?? '') ? 'selected' : ''}>${echapper(o.libelle)}</option>`).join('')}</select>`;
      return `<input data-c="${c.code}" value="${echapper(v ?? '')}" ${c.largeur ? `style="width:${c.largeur}"` : ''} ${ro ? 'readonly' : ''}>`;
    };
    zone.innerHTML = `<table class="bib-table"><thead><tr>${colonnes.map((c) => `<th>${echapper(c.libelle)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${[...lignes, ...(ro ? [] : [{ ...vide, _nouveau: true }])].map((l, i) => `<tr data-i="${i}" class="${l._nouveau ? 'ajout' : ''}">${colonnes.map((c) => `<td>${c.lecture ? echapper(c.lecture(l)) : champ(c, l[c.code])}</td>`).join('')}
        <td class="bib-actions">${ro ? '' : `<button type="button" data-action="enregistrer" title="Enregistrer">${l._nouveau ? '＋ Ajouter' : '✓'}</button>${l._nouveau || !supprimer ? '' : '<button type="button" data-action="supprimer" title="Supprimer">🗑</button>'}`}</td></tr>`).join('')}
      </tbody></table>`;
    const toutes = [...lignes, { ...vide, _nouveau: true }];
    zone.querySelector('tbody').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const tr = b.closest('tr');
      const l = toutes[Number(tr.dataset.i)];
      const v = { ...l };
      tr.querySelectorAll('[data-c]').forEach((el) => {
        const c = colonnes.find((x) => x.code === el.dataset.c);
        v[el.dataset.c] = el.type === 'checkbox' ? el.checked : c.nombre ? (el.value === '' ? (c.nul ? null : 0) : Number(el.value)) : el.value || null;
      });
      delete v._nouveau;
      try {
        if (b.dataset.action === 'supprimer') {
          if (!confirm(`Supprimer « ${l[cle] ?? ''} » ?`)) return;
          await supprimer(l);
        } else await enregistrer(v);
        this.message(b.dataset.action === 'supprimer' ? 'Supprimé' : 'Enregistré', 'succes');
        await this.rendre();
      } catch (x) { this.#erreur(x); }
    });
  }

  async #bibliotheques(zone) {
    const bibs = await this.fournisseur.bibliotheques();
    zone.innerHTML = '<p class="aide">Le code sert de préfixe d\'appel hors de la bibliothèque (BIB:CODE). La bibliothèque par défaut est proposée à la création des éléments.</p><div></div>';
    this.#tableau(zone.lastElementChild, {
      cle: 'code', lignes: bibs, vide: { id: 0, actif: true, defaut: false, ordre: 0 },
      colonnes: [{ code: 'code', libelle: 'Code', largeur: '7rem' }, { code: 'libelle', libelle: 'Libellé', largeur: '18rem' }, { code: 'defaut', libelle: 'Par défaut', type: 'case' },
        { code: 'actif', libelle: 'Active', type: 'case' }, { code: 'ordre', libelle: 'Ordre', nombre: true, largeur: '4rem' }],
      enregistrer: (v) => this.fournisseur.enregistrerBibliotheque(v), supprimer: (l) => this.fournisseur.supprimerBibliotheque(l.id),
    });
  }

  async #familles(zone) {
    const bibs = await this.fournisseur.bibliotheques();
    this.bibId ??= bibs.find((b) => b.defaut)?.id ?? bibs[0]?.id ?? null;
    const familles = this.bibId ? await this.fournisseur.familles(this.bibId) : [];
    zone.innerHTML = `<label class="bib-ligne">Bibliothèque <select data-bib>${bibs.map((b) => `<option value="${b.id}" ${b.id === this.bibId ? 'selected' : ''}>${echapper(`${b.code} – ${b.libelle}`)}</option>`).join('')}</select></label>
      <p class="aide">Arborescence de profondeur libre : choisissez la famille parente pour créer une sous-famille.</p><div></div>`;
    zone.querySelector('[data-bib]').addEventListener('change', (e) => { this.bibId = Number(e.target.value); this.rendre().catch((x) => this.#erreur(x)); });
    const parents = familles.map((f) => ({ valeur: f.id, libelle: f.chemin }));
    this.#tableau(zone.lastElementChild, {
      cle: 'libelle', lignes: familles, vide: { id: 0, bib_id: this.bibId, parent_id: null, ordre: 0 },
      colonnes: [
        { code: 'chemin', libelle: 'Arborescence', lecture: (l) => (l._nouveau ? '(nouvelle)' : `${'   '.repeat(Math.max(0, (l.niveau ?? 1) - 1))}${l.chemin}`) },
        { code: 'code', libelle: 'Code', largeur: '8rem' }, { code: 'libelle', libelle: 'Libellé', largeur: '14rem' },
        { code: 'parent_id', libelle: 'Famille parente', options: parents, nombre: true, nul: true }, { code: 'ordre', libelle: 'Ordre', nombre: true, largeur: '4rem' },
      ],
      enregistrer: (v) => this.fournisseur.enregistrerFamille({ ...v, bib_id: this.bibId }), supprimer: (l) => this.fournisseur.supprimerFamille(l.id),
    });
  }

  async #natures(zone) {
    const [natures, regroupements] = await Promise.all([this.fournisseur.natures(), this.fournisseur.regroupements()]);
    zone.innerHTML = '<p class="aide">Axe analytique et comptes de rattachement : repris par le futur module Comptabilité.</p><div></div>';
    this.#tableau(zone.lastElementChild, {
      cle: 'code', lignes: natures, vide: { id: 0, actif: true },
      colonnes: [{ code: 'code', libelle: 'Code', largeur: '7rem' }, { code: 'libelle', libelle: 'Libellé', largeur: '14rem' },
        { code: 'regroupement', libelle: 'Regroupement', options: regroupements.map((r) => ({ valeur: r.code, libelle: r.libelle })) },
        { code: 'axe_analytique', libelle: 'Axe analytique', largeur: '8rem' }, { code: 'compte_achat', libelle: 'Compte d\'achat', largeur: '7rem' },
        { code: 'compte_vente', libelle: 'Compte de vente', largeur: '7rem' }, { code: 'actif', libelle: 'Active', type: 'case' }],
      enregistrer: (v) => this.fournisseur.enregistrerNature(v), supprimer: (l) => this.fournisseur.supprimerNature(l.id),
    });
  }

  async #regroupements(zone) {
    const regroupements = await this.fournisseur.regroupements();
    zone.innerHTML = '<p class="aide">Regroupements personnalisables des natures (main-d\'œuvre, matériaux, engins, sous-traitance, prestations, vente…).</p><div></div>';
    this.#tableau(zone.lastElementChild, {
      cle: 'code', lignes: regroupements, vide: { ordre: 0 },
      colonnes: [{ code: 'code', libelle: 'Code', largeur: '10rem' }, { code: 'libelle', libelle: 'Libellé', largeur: '16rem' }, { code: 'ordre', libelle: 'Ordre', nombre: true, largeur: '4rem' }],
      enregistrer: (v) => this.fournisseur.enregistrerRegroupement(v), supprimer: (l) => this.fournisseur.supprimerRegroupement(l.code),
    });
  }

  async #prix(zone) {
    const p = await this.fournisseur.parametres();
    const ro = this.admin ? '' : 'disabled';
    zone.innerHTML = `<div class="bib-formulaire">
      <fieldset><legend>Scénarios de prix d'achat autorisés</legend>${SCENARIOS_PA.map(([c, l]) => `<label class="bib-ligne"><input type="checkbox" data-scenario="${c}" ${p.scenarios_autorises.includes(c) ? 'checked' : ''} ${ro}> ${echapper(l)}</label>`).join('')}</fieldset>
      <label>Scénario par défaut à la création <select data-defaut ${ro}>${SCENARIOS_PA.map(([c, l]) => `<option value="${c}" ${c === p.scenario_defaut ? 'selected' : ''}>${echapper(l)}</option>`).join('')}</select></label>
      <label>Coefficient de frais généraux par défaut <input data-fg value="${echapper(String(p.coef_fg_defaut))}" ${ro}></label>
      <label>Coefficient de bénéfice par défaut <input data-benef value="${echapper(String(p.coef_benef_defaut))}" ${ro}></label>
      <p class="aide">Chaque élément peut restreindre ses scénarios autorisés et choisir le sien dans l'onglet Prix de sa fiche.</p>
      ${this.admin ? '<button type="button" class="principal" data-enregistrer>Enregistrer</button>' : ''}</div>`;
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        await this.fournisseur.enregistrerParametres({
          scenario_defaut: zone.querySelector('[data-defaut]').value,
          scenarios_autorises: [...zone.querySelectorAll('[data-scenario]:checked')].map((x) => x.dataset.scenario),
          coef_fg_defaut: Number(zone.querySelector('[data-fg]').value.replace(',', '.')),
          coef_benef_defaut: Number(zone.querySelector('[data-benef]').value.replace(',', '.')),
        });
        this.message('Paramètres de prix enregistrés', 'succes');
      } catch (x) { this.#erreur(x); }
    });
  }
}
