import { echapper, confirmer } from '@logibtp/socle/ui';
import { SCENARIOS_PA, TYPES_NATURE, coefficientsEffectifs } from '../src/calcul.js';

// Paramétrage de la bibliothèque (classe mère) : bibliothèques (code d'appel, bibliothèque par défaut), familles éditées
// en arbre (ajout d'une racine, ou d'une sous-famille sous la famille sélectionnée), natures (types, regroupement, axe
// analytique, comptes), regroupements personnalisables, coefficients de frais généraux et de bénéfice par période
// (globaux ou par nature, historique), scénarios de prix d'achat.

const ONGLETS = [['bibliotheques', 'Bibliothèques'], ['familles', 'Familles'], ['natures', 'Natures'], ['regroupements', 'Regroupements'],
  ['coefficients', 'Coefficients'], ['prix', 'Prix d\'achat']];
const date = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const coef = (v) => (v === null || v === undefined || v === '' ? '—' : String(v).replace('.', ','));

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
    const rendus = {
      bibliotheques: () => this.#bibliotheques(zone), familles: () => this.#familles(zone), natures: () => this.#natures(zone),
      regroupements: () => this.#regroupements(zone), coefficients: () => this.#coefficients(zone), prix: () => this.#prix(zone),
    };
    await rendus[this.onglet]();
  }

  /** Tableau éditable : une ligne par élément + une ligne d'ajout ; enregistrer(ligne) et supprimer(ligne) appellent le fournisseur. */
  #tableau(zone, { colonnes, lignes, cle, enregistrer, supprimer, vide = {} }) {
    const ro = !this.admin;
    const champ = (c, v) => {
      if (c.type === 'case') return `<input type="checkbox" data-c="${c.code}" ${v ? 'checked' : ''} ${ro ? 'disabled' : ''}>`;
      if (c.type === 'cases') {
        return `<span class="bib-cases" data-c="${c.code}" data-cases>${c.options.map((o) => `<label title="${echapper(o.libelle)}"><input type="checkbox" value="${echapper(o.valeur)}"
          ${(v ?? []).includes(o.valeur) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${echapper(o.court ?? o.libelle)}</label>`).join('')}</span>`;
      }
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
        if (el.dataset.cases !== undefined) { v[el.dataset.c] = [...el.querySelectorAll('input:checked')].map((x) => x.value); return; }
        v[el.dataset.c] = el.type === 'checkbox' ? el.checked : c.nombre ? (el.value === '' ? (c.nul ? null : 0) : Number(el.value)) : el.value || null;
      });
      delete v._nouveau;
      try {
        if (b.dataset.action === 'supprimer') {
          if (!await confirmer(`Supprimer « ${l[cle] ?? ''} » ?`)) return;
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

  /** Familles en arbre : sélection d'un nœud, ＋ crée une racine (rien de sélectionné) ou une sous-famille du nœud sélectionné. */
  async #familles(zone) {
    const bibs = await this.fournisseur.bibliotheques();
    this.bibId ??= bibs.find((b) => b.defaut)?.id ?? bibs[0]?.id ?? null;
    const familles = this.bibId ? await this.fournisseur.familles(this.bibId) : [];
    if (!familles.some((f) => f.id === this.familleChoisie)) this.familleChoisie = null;
    this.famillesOuvertes ??= new Set();
    const choisie = familles.find((f) => f.id === this.familleChoisie) ?? null;
    const enfants = (parent) => familles.filter((f) => (f.parent_id ?? null) === parent).sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, 'fr'));
    const descendants = (id) => enfants(id).flatMap((f) => [f.id, ...descendants(f.id)]);
    const noeud = (f) => {
      const sous = enfants(f.id);
      const ouvert = this.famillesOuvertes.has(f.id) || descendants(f.id).includes(this.familleChoisie);
      return `<li><div class="bib-famille ${f.id === this.familleChoisie ? 'choisie' : ''}" data-famille="${f.id}">
        <span class="bib-ouvrir" data-ouvrir="${f.id}">${sous.length ? (ouvert ? '▾' : '▸') : ''}</span>
        <span class="bib-famille-libelle">${echapper(f.libelle)}</span><small>${echapper(f.code)}</small></div>
        ${sous.length && ouvert ? `<ul>${sous.map(noeud).join('')}</ul>` : ''}</li>`;
    };
    const exclus = choisie ? new Set([choisie.id, ...descendants(choisie.id)]) : new Set();
    zone.innerHTML = `<label class="bib-ligne">Bibliothèque <select data-bib>${bibs.map((b) => `<option value="${b.id}" ${b.id === this.bibId ? 'selected' : ''}>${echapper(`${b.code} – ${b.libelle}`)}</option>`).join('')}</select></label>
      <div class="bib-familles">
        <div class="bib-familles-arbre">
          ${this.admin ? `<div class="bib-familles-outils"><button type="button" class="principal" data-ajouter>＋ ${choisie ? `Sous-famille de « ${echapper(choisie.libelle)} »` : 'Famille racine'}</button>
            ${choisie ? '<button type="button" data-deselectionner title="Pour ajouter une famille racine">Désélectionner</button>' : ''}</div>` : ''}
          <ul class="bib-arbre-familles">${enfants(null).map(noeud).join('') || '<li class="aide">Aucune famille : ＋ pour en créer une.</li>'}</ul>
        </div>
        <div class="bib-familles-edition">${choisie ? `
          <h3>${echapper(choisie.chemin)}</h3>
          <div class="bib-formulaire">
            <label>Code <input data-f="code" value="${echapper(choisie.code)}" ${this.admin ? '' : 'readonly'}></label>
            <label>Libellé <input data-f="libelle" value="${echapper(choisie.libelle)}" ${this.admin ? '' : 'readonly'}></label>
            <label>Ordre <input data-f="ordre" type="number" value="${choisie.ordre ?? 0}" ${this.admin ? '' : 'readonly'}></label>
            <label>Famille parente <select data-f="parent_id" ${this.admin ? '' : 'disabled'}><option value="">(racine)</option>
              ${familles.filter((f) => !exclus.has(f.id)).map((f) => `<option value="${f.id}" ${f.id === choisie.parent_id ? 'selected' : ''}>${echapper(f.chemin)}</option>`).join('')}</select></label>
            ${this.admin ? '<p><button type="button" class="principal" data-enregistrer>Enregistrer</button> <button type="button" class="danger" data-supprimer>Supprimer</button></p>' : ''}
          </div>` : '<p class="aide">Sélectionnez une famille pour la modifier, ou ＋ pour créer une famille racine (ajoutée en fin de liste). Avec une famille sélectionnée, ＋ crée une sous-famille.</p>'}
        </div>
      </div>`;
    zone.querySelector('[data-bib]').addEventListener('change', (e) => { this.bibId = Number(e.target.value); this.familleChoisie = null; this.rendre().catch((x) => this.#erreur(x)); });
    zone.querySelector('.bib-arbre-familles').addEventListener('click', (e) => {
      const o = e.target.closest('[data-ouvrir]');
      if (o && o.textContent) {
        const id = Number(o.dataset.ouvrir);
        if (this.famillesOuvertes.has(id)) this.famillesOuvertes.delete(id); else this.famillesOuvertes.add(id);
        this.rendre().catch((x) => this.#erreur(x));
        return;
      }
      const n = e.target.closest('[data-famille]');
      if (n) { this.familleChoisie = Number(n.dataset.famille) === this.familleChoisie ? null : Number(n.dataset.famille); this.rendre().catch((x) => this.#erreur(x)); }
    });
    zone.querySelector('[data-deselectionner]')?.addEventListener('click', () => { this.familleChoisie = null; this.rendre().catch((x) => this.#erreur(x)); });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', async () => {
      // Nouvelle famille en fin de liste (racine, ou sous la famille sélectionnée), code provisoire unique, à renommer.
      const parent = choisie?.id ?? null;
      let n = 1;
      while (familles.some((f) => f.code === `NOUV${n}`)) n++;
      try {
        const liste = await this.fournisseur.enregistrerFamille({ bib_id: this.bibId, parent_id: parent, code: `NOUV${n}`, libelle: 'Nouvelle famille',
          ordre: Math.max(0, ...enfants(parent).map((f) => f.ordre ?? 0)) + 1 });
        const creee = liste.find((f) => f.code === `NOUV${n}`);
        if (parent) this.famillesOuvertes.add(parent);
        this.familleChoisie = creee?.id ?? null;
        await this.rendre();
        zone.querySelector('[data-f="libelle"]')?.select();
        this.message('Famille créée : renseignez son code et son libellé', 'succes');
      } catch (x) { this.#erreur(x); }
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      const f = (c) => zone.querySelector(`[data-f="${c}"]`).value;
      try {
        await this.fournisseur.enregistrerFamille({ id: choisie.id, bib_id: this.bibId, code: f('code'), libelle: f('libelle'), ordre: Number(f('ordre')) || 0, parent_id: f('parent_id') ? Number(f('parent_id')) : null });
        this.message('Famille enregistrée', 'succes');
        await this.rendre();
      } catch (x) { this.#erreur(x); }
    });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(`Supprimer la famille « ${choisie.chemin} » ? Les éléments rattachés n'auront plus de famille.`)) return;
      try {
        await this.fournisseur.supprimerFamille(choisie.id);
        this.familleChoisie = choisie.parent_id ?? null;
        this.message('Famille supprimée', 'succes');
        await this.rendre();
      } catch (x) { this.#erreur(x); }
    });
  }

  async #natures(zone) {
    const [natures, regroupements] = await Promise.all([this.fournisseur.natures(), this.fournisseur.regroupements()]);
    zone.innerHTML = '<p class="aide">Types (main-d\'œuvre, engin, matériaux, sous-traitance, frais, facturation interne, amortissement, divers) : plusieurs possibles. Le regroupement reste libre (ex. « Fabrication » : natures de main-d\'œuvre et de sous-traitance). Axe analytique et comptes de rattachement : repris par le futur module Comptabilité. Une nature « isolant » affiche les caractéristiques d\'isolation (R, λ, U) dans la fiche.</p><div></div>';
    this.#tableau(zone.lastElementChild, {
      cle: 'code', lignes: natures, vide: { id: 0, actif: true, isolant: false, types: [] },
      colonnes: [{ code: 'code', libelle: 'Code', largeur: '7rem' }, { code: 'libelle', libelle: 'Libellé', largeur: '14rem' },
        { code: 'types', libelle: 'Types', type: 'cases', options: TYPES_NATURE.map(([valeur, libelle]) => ({ valeur, libelle, court: { MO: 'MO', ENGIN: 'Engin', MATERIAUX: 'Mat.', SOUS_TRAITANCE: 'ST', FRAIS: 'Frais', FACTURATION_INTERNE: 'Fact. int.', AMORTISSEMENT: 'Amort.', DIVERS: 'Div.' }[valeur] })) },
        { code: 'regroupement', libelle: 'Regroupement', options: regroupements.map((r) => ({ valeur: r.code, libelle: r.libelle })) },
        { code: 'axe_analytique', libelle: 'Axe analytique', largeur: '8rem' }, { code: 'compte_achat', libelle: 'Compte d\'achat', largeur: '7rem' },
        { code: 'compte_vente', libelle: 'Compte de vente', largeur: '7rem' }, { code: 'isolant', libelle: 'Isolant', type: 'case' }, { code: 'actif', libelle: 'Active', type: 'case' }],
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

  /** Coefficients par période : globaux ou par nature ; une période commencée est conservée (historique). */
  async #coefficients(zone) {
    const [periodes, natures, p] = await Promise.all([this.fournisseur.periodes(), this.fournisseur.natures(), this.fournisseur.parametres()]);
    this.portee ??= '';
    const nat = this.portee === '' ? null : Number(this.portee);
    const liste = periodes.filter((x) => (x.nat_id ?? null) === nat).sort((a, b) => String(b.debut).localeCompare(String(a.debut)));
    const jour = aujourdhui();
    const enVigueur = { coef_fg: liste.find((x) => x.debut <= jour && x.coef_fg !== null)?.id, coef_benef: liste.find((x) => x.debut <= jour && x.coef_benef !== null)?.id };
    const effectifs = coefficientsEffectifs({ nat_id: nat }, periodes, jour, p);
    const source = (s) => ({ nature: `nature, depuis le ${date(s.debut)}`, global: `global, depuis le ${date(s.debut)}`, defaut: 'par défaut (paramètres)' }[s.portee] ?? s.portee);
    zone.innerHTML = `<div class="bib-coefficients">
      <label class="bib-ligne">Portée <select data-portee><option value="">Global (toutes natures)</option>
        ${natures.map((n) => `<option value="${n.id}" ${String(n.id) === this.portee ? 'selected' : ''}>${echapper(n.libelle)}</option>`).join('')}</select></label>
      <p class="bib-vigueur">En vigueur aujourd'hui : frais généraux <b>${coef(effectifs.coef_fg)}</b> <small>(${source(effectifs.sources.coef_fg)})</small> ·
        bénéfice <b>${coef(effectifs.coef_benef)}</b> <small>(${source(effectifs.sources.coef_benef)})</small></p>
      <table class="bib-table"><thead><tr><th>Début</th><th>Frais généraux</th><th>Bénéfice</th><th>Commentaire</th><th>Créée</th><th>État</th><th></th></tr></thead><tbody>
        ${liste.map((x) => {
          const etat = x.debut > jour ? 'à venir' : (x.id === enVigueur.coef_fg || x.id === enVigueur.coef_benef ? 'en vigueur' : 'passée');
          return `<tr class="periode-${etat.replace(' ', '-')}"><td>${date(x.debut)}</td><td class="nombre">${coef(x.coef_fg)}</td><td class="nombre">${coef(x.coef_benef)}</td>
            <td>${echapper(x.commentaire ?? '')}</td><td><small>${echapper(x.cree_par ?? '')} ${x.cree_le ? new Date(x.cree_le).toLocaleDateString('fr-FR') : ''}</small></td><td>${etat}</td>
            <td>${this.admin && etat === 'à venir' ? `<button type="button" data-supprimer-periode="${x.id}" title="Supprimer (pas encore commencée)">🗑</button>` : ''}</td></tr>`;
        }).join('') || `<tr><td colspan="7" class="aide">Aucune période${nat === null ? ` : coefficients de repli ${coef(p.coef_fg_defaut)} et ${coef(p.coef_benef_defaut)}, créez une période globale` : ' : les coefficients globaux s\'appliquent'}.</td></tr>`}
      </tbody></table>
      ${this.admin ? `<fieldset class="fiche-groupe"><legend>Nouvelle période</legend><div class="bib-grille">
        <label>Début <input type="date" data-p="debut" value="${jour}"></label>
        <label>Frais généraux <input data-p="coef_fg" inputmode="decimal" placeholder="${nat === null ? '' : 'repris du global'}"></label>
        <label>Bénéfice <input data-p="coef_benef" inputmode="decimal" placeholder="${nat === null ? '' : 'repris du global'}"></label>
        <label class="large">Commentaire <input data-p="commentaire"></label></div>
        <p><button type="button" class="principal" data-ajouter-periode>＋ Créer la période</button>
          <span class="aide">Une période commencée n'est plus modifiable : pour changer un coefficient, créez une nouvelle période (l'historique est conservé).
          Les éléments qui suivent ces coefficients (non imposés) sont recalculés.</span></p></fieldset>` : ''}
    </div>`;
    zone.querySelector('[data-portee]').addEventListener('change', (e) => { this.portee = e.target.value; this.rendre().catch((x) => this.#erreur(x)); });
    zone.querySelector('[data-ajouter-periode]')?.addEventListener('click', async () => {
      const v = (c) => zone.querySelector(`[data-p="${c}"]`).value.trim().replace(',', '.');
      try {
        const r = await this.fournisseur.enregistrerPeriode({ nat_id: nat, debut: v('debut'), coef_fg: v('coef_fg') || null, coef_benef: v('coef_benef') || null, commentaire: zone.querySelector('[data-p="commentaire"]').value || null });
        this.message(`Période enregistrée · ${r.elements_recalcules} élément(s) recalculé(s)`, 'succes');
        await this.rendre();
      } catch (x) { this.#erreur(x); }
    });
    zone.querySelectorAll('[data-supprimer-periode]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmer('Supprimer cette période à venir ?')) return;
      try { await this.fournisseur.supprimerPeriode(Number(b.dataset.supprimerPeriode)); await this.rendre(); } catch (x) { this.#erreur(x); }
    }));
  }

  async #prix(zone) {
    const p = await this.fournisseur.parametres();
    const ro = this.admin ? '' : 'disabled';
    zone.innerHTML = `<div class="bib-formulaire">
      <fieldset><legend>Scénarios de prix d'achat autorisés</legend>${SCENARIOS_PA.map(([c, l]) => `<label class="bib-ligne"><input type="checkbox" data-scenario="${c}" ${p.scenarios_autorises.includes(c) ? 'checked' : ''} ${ro}> ${echapper(l)}</label>`).join('')}</fieldset>
      <label>Scénario par défaut à la création <select data-defaut ${ro}>${SCENARIOS_PA.map(([c, l]) => `<option value="${c}" ${c === p.scenario_defaut ? 'selected' : ''}>${echapper(l)}</option>`).join('')}</select></label>
      <p class="aide">Chaque élément peut restreindre ses scénarios autorisés et choisir le sien dans l'onglet Prix de sa fiche.</p>
      ${this.admin ? '<button type="button" class="principal" data-enregistrer>Enregistrer</button>' : ''}</div>`;
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        await this.fournisseur.enregistrerParametres({
          scenario_defaut: zone.querySelector('[data-defaut]').value,
          scenarios_autorises: [...zone.querySelectorAll('[data-scenario]:checked')].map((x) => x.dataset.scenario),
          // Coefficients : gérés par période (onglet Coefficients) ; les valeurs de repli des paramètres sont conservées.
          coef_fg_defaut: p.coef_fg_defaut, coef_benef_defaut: p.coef_benef_defaut,
        });
        this.message('Paramètres de prix enregistrés', 'succes');
      } catch (x) { this.#erreur(x); }
    });
  }
}
