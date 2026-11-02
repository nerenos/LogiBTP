// Prévisionnel de facturation (ANALYSE-MODULE-ANALYSE.md § 10.2, lot 7) : panneau du Détail d'un chantier (facturé,
// prévu de la dernière version, écart, comparaison à une version passée, atterrissage ; saisie d'une nouvelle version
// en montant ou en % du budget PV) et tableau chantiers × mois de la Liste. Composants sans métier : l'application
// fournit les appels et l'ouverture du Détail.
import { texte, texteHtml, iconeHtml, langue } from '@logibtp/socle/dictionnaire';
import { Dz, ajouterMois } from '@logibtp/socle';
import { formatNombre, formatDateHeure, echapper, creerCombo, lireNombre, saisir } from '@logibtp/socle/ui';
import { MODE_FACTURATION } from '../src/codes.js';
import { comparerFacturation, controlerFacturation, montantPrevu, moisEntre } from '../src/facturation.js';

const montant = (v) => (v === null || v === undefined ? '' : formatNombre(v.toString(), 2));
let formatMois = null;
/** Libellé court d'un mois « AAAA-MM-01 » (langue du dictionnaire). */
export const libelleMois = (m) => (formatMois ??= new Intl.DateTimeFormat(langue(), { month: 'short', year: 'numeric' })).format(new Date(`${m}T00:00:00`));
const saisieValeur = (v) => (v === null || v === undefined ? '' : formatNombre(v, 2).replace(/[\s  ]/g, ''));

/**
 * Panneau du prévisionnel de facturation d'un chantier. options : { peutModifier, enregistrer({ commentaire, derniere,
 * lignes }) → Promise<donnees>, apresEnregistrement(donnees), erreur(e) }.
 */
export class PanneauFacturation {
  #zone;
  #o;
  #d = null;
  #reference = '';
  #edition = null;
  #jusqua = null;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peutModifier: false, enregistrer: async () => null, apresEnregistrement: () => {}, erreur: () => {}, ...options };
  }

  /** donnees : { budget_pv, versions: [{ version, mois }], facture: [{ mois, pv }] } du serveur. */
  rendre(donnees) {
    this.#d = donnees;
    this.#edition = null;
    this.#dessiner();
  }

  #dessiner() {
    const d = this.#d;
    const [courante, ...anciennes] = d.versions ?? [];
    const ref = anciennes.find((v) => String(v.version.id) === this.#reference) ?? null;
    const prevu = this.#edition ? this.#prevuEdition() : (courante?.mois ?? []);
    const r = comparerFacturation({ facture: d.facture, prevu, reference: ref?.mois ?? null, jusqua: this.#jusqua });
    const ed = this.#edition;
    const enTete = `<h2 class="titre-actions">${iconeHtml('rentabilite_facturation')} ${texteHtml('rentabilite.facturation.titre')}
      ${this.#o.peutModifier && !ed ? `<button type="button" data-modifier>${iconeHtml('rentabilite_modifier')} ${texteHtml('rentabilite.facturation.modifier')}</button>` : ''}
      ${ed ? `<button type="button" class="principal" data-enregistrer>${texteHtml('rentabilite.facturation.enregistrer')}</button>
        <button type="button" data-annuler>${texteHtml('commun.annuler')}</button>
        <button type="button" data-plus title="${echapper(texte('rentabilite.facturation.plus_titre'))}">${texteHtml('rentabilite.facturation.plus')}</button>` : ''}</h2>
      <p class="aide">${courante
    ? echapper(texte('rentabilite.facturation.version', { le: formatDateHeure(courante.version.le), par: courante.version.par, nombre: d.versions.length }))
      + (courante.version.commentaire ? ` · ${echapper(courante.version.commentaire)}` : '')
    : texteHtml('rentabilite.facturation.aucune')} · ${echapper(texte('rentabilite.facturation.budget', { montant: montant(Dz(d.budget_pv)) }))}
      ${anciennes.length ? ` · <label>${texteHtml('rentabilite.facturation.comparer')} <span data-reference></span></label>` : ''}</p>`;
    const th = (cle) => `<th class="montant" title="${echapper(texte(`rentabilite.facturation.colonnes.${cle}.info`))}">${texteHtml(`rentabilite.facturation.colonnes.${cle}.libelle`)}</th>`;
    const ligne = (l) => {
      const saisie = ed?.get(l.mois);
      const prevuCellule = ed
        ? `<td class="montant"><input type="text" size="10" class="montant" data-mois="${l.mois}" value="${saisieValeur(saisie?.valeur)}">
            <button type="button" class="lien" data-mode="${l.mois}" title="${echapper(texte('rentabilite.facturation.mode_titre'))}">${texteHtml(`rentabilite.facturation.modes.${saisie?.mode ?? MODE_FACTURATION.MONTANT}`)}</button></td>`
        : `<td class="montant">${montant(l.prevu)}</td>`;
      const ecartRouge = l.ecart && l.passe && l.ecart.isNegative() && !l.ecart.isZero() ? ' rentabilite-anomalie' : '';
      return `<tr class="${l.courant ? 'rentabilite-mois-courant' : l.passe ? 'rentabilite-mois-passe' : ''}">
        <th scope="row">${echapper(libelleMois(l.mois))}</th>
        <td class="montant">${l.facture.isZero() ? '' : montant(l.facture)}</td>${prevuCellule}
        <td class="montant${ecartRouge}">${l.passe || l.courant ? montant(l.ecart) : ''}</td>
        ${ref ? `<td class="montant">${montant(l.reference)}</td>` : ''}
        <td class="montant">${montant(l.cumul_facture)}</td><td class="montant">${montant(l.cumul_prevu)}</td><td class="montant rentabilite-net">${montant(l.atterrissage)}</td></tr>`;
    };
    this.#zone.innerHTML = `${enTete}
      <table class="tableau-compact rentabilite-facturation"><thead><tr><th>${texteHtml('rentabilite.facturation.colonnes.mois.libelle')}</th>
        ${th('facture')}${th('prevu')}${th('ecart')}${ref ? `<th class="montant">${echapper(texte('rentabilite.facturation.prevu_le', { le: formatDateHeure(ref.version.le) }))}</th>` : ''}
        ${th('cumul_facture')}${th('cumul_prevu')}${th('atterrissage')}</tr></thead>
      <tbody>${r.lignes.map(ligne).join('')}</tbody>
      <tfoot><tr class="rentabilite-ligne-total"><th scope="row">${texteHtml('rentabilite.facturation.total')}</th>
        <td class="montant">${montant(r.total.facture)}</td><td class="montant">${montant(r.total.prevu)}</td><td></td>${ref ? '<td></td>' : ''}
        <td></td><td></td><td class="montant rentabilite-net">${montant(r.total.atterrissage)}</td></tr></tfoot></table>
      <p class="aide">${texteHtml(ed ? 'rentabilite.facturation.aide_saisie' : 'rentabilite.facturation.aide')}</p>
      <p class="rentabilite-anomalie" data-erreur></p>`;
    this.#brancher(anciennes, r);
  }

  /** Prévu affiché pendant la saisie : montants calculés des valeurs saisies valables. */
  #prevuEdition() {
    const budget = this.#d.budget_pv;
    return [...this.#edition.entries()].filter(([, s]) => lireNombre(s.texte) !== undefined && lireNombre(s.texte) !== null)
      .map(([mois, s]) => ({ mois, montant: montantPrevu(s.mode, lireNombre(s.texte), budget).toString() }));
  }

  #brancher(anciennes, r) {
    const z = this.#zone;
    if (anciennes.length) {
      const c = creerCombo({ options: anciennes.map((v) => ({ valeur: String(v.version.id), libelle: texte('rentabilite.facturation.prevu_le', { le: formatDateHeure(v.version.le) }), detail: v.version.par })),
        valeur: this.#reference, titre: texte('rentabilite.facturation.comparer_titre') });
      z.querySelector('[data-reference]').append(c);
      c.addEventListener('change', () => { this.#reference = c.valeurCombo ?? ''; this.#dessiner(); });
    }
    z.querySelector('[data-modifier]')?.addEventListener('click', () => {
      const courante = this.#d.versions?.[0];
      this.#edition = new Map((courante?.mois ?? []).map((m) => [m.mois, { mode: m.mode, valeur: m.valeur, texte: saisieValeur(m.valeur) }]));
      this.#dessiner();
      z.querySelector('input[data-mois]')?.focus();
    });
    z.querySelector('[data-annuler]')?.addEventListener('click', () => { this.#edition = null; this.#dessiner(); });
    z.querySelector('[data-plus]')?.addEventListener('click', () => {
      this.#jusqua = ajouterMois(r.lignes.at(-1).mois, 6);
      this.#dessiner();
    });
    z.querySelectorAll('input[data-mois]').forEach((i) => i.addEventListener('change', () => {
      const s = this.#edition.get(i.dataset.mois) ?? { mode: MODE_FACTURATION.MONTANT };
      const v = lireNombre(i.value);
      i.classList.toggle('invalide', v === undefined);
      if (v === null) this.#edition.delete(i.dataset.mois);
      else this.#edition.set(i.dataset.mois, { ...s, texte: i.value, valeur: v ?? s.valeur });
      // Redessiné après le déplacement du focus (Tab, Entrée) : le champ qui l'a reçu le garde.
      if (v !== undefined) setTimeout(() => this.#redessinerEnGardantLeFocus());
    }));
    z.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      const s = this.#edition.get(b.dataset.mode) ?? { texte: '', valeur: null };
      this.#edition.set(b.dataset.mode, { ...s, mode: s.mode === MODE_FACTURATION.POURCENT ? MODE_FACTURATION.MONTANT : MODE_FACTURATION.POURCENT });
      this.#dessiner();
    }));
    z.querySelector('[data-enregistrer]')?.addEventListener('click', () => this.#enregistrer());
  }

  #redessinerEnGardantLeFocus() {
    const mois = this.#zone.contains(document.activeElement) ? document.activeElement.dataset?.mois : null;
    this.#dessiner();
    if (mois) this.#zone.querySelector(`input[data-mois="${mois}"]`)?.select();
  }

  async #enregistrer() {
    const lignes = [...this.#edition.entries()].filter(([, s]) => String(s.texte ?? '').trim() !== '')
      .map(([mois, s]) => ({ mois, mode: s.mode ?? MODE_FACTURATION.MONTANT, valeur: lireNombre(s.texte) ?? String(s.texte) }))
      .sort((a, b) => a.mois.localeCompare(b.mois));
    const erreurs = controlerFacturation(lignes, this.#d.budget_pv);
    if (erreurs.length) {
      this.#zone.querySelector('[data-erreur]').textContent = erreurs.map((e) => `${libelleMois(e.mois)} : ${texte(`rentabilite.facturation.erreurs.${e.code}`)}`).join(' ; ');
      return;
    }
    const commentaire = await saisir(texte('rentabilite.facturation.commentaire'), '', { titre: texte('rentabilite.facturation.enregistrer') });
    if (commentaire === null) return;
    try {
      const d = await this.#o.enregistrer({ commentaire: commentaire.trim() || null, derniere: this.#d.versions?.[0]?.version.id ?? null, lignes });
      this.#reference = '';
      this.rendre(d);
      this.#o.apresEnregistrement(d);
    } catch (e) { this.#o.erreur(e); }
  }
}

/**
 * Tableau chantiers × mois du prévisionnel de facturation (§ 10.2) : prévu (dernière version) et facturé sous lui,
 * totaux par chantier et par mois. options : { ouvrirDetail(chantier, nouvelleFenetre) }.
 */
export class TableauFacturationListe {
  #zone;
  #o;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { ouvrirDetail: () => {}, ...options };
  }

  /** donnees : { du, au, chantiers, prevu: [{ cha_id, mois, montant }], facture: [{ cha_id, mois, pv }], versions } du serveur. */
  rendre(donnees) {
    const mois = moisEntre(donnees.du, donnees.au);
    const cle = (c, m) => `${c}|${m}`;
    const somme = (l, champ) => {
      const s = new Map();
      for (const x of l) s.set(cle(x.cha_id, x.mois), (s.get(cle(x.cha_id, x.mois)) ?? Dz(0)).plus(Dz(x[champ])));
      return s;
    };
    const p = somme(donnees.prevu ?? [], 'montant');
    const f = somme(donnees.facture ?? [], 'pv');
    const versions = new Map((donnees.versions ?? []).map((v) => [v.cha_id, v]));
    const chantiers = (donnees.chantiers ?? []).filter((c) => versions.has(c.id) || mois.some((m) => f.has(cle(c.id, m))));
    if (!chantiers.length) { this.#zone.innerHTML = `<p class="aide">${texteHtml('rentabilite.facturation.liste_aucun')}</p>`; return; }
    const total = (ids, liste) => {
      const t = { prevu: Dz(0), facture: Dz(0) };
      for (const id of ids) for (const m of liste) { t.prevu = t.prevu.plus(p.get(cle(id, m)) ?? Dz(0)); t.facture = t.facture.plus(f.get(cle(id, m)) ?? Dz(0)); }
      return t;
    };
    const cellule = (t) => `<td class="montant">${t.prevu.isZero() ? '' : montant(t.prevu)}${t.facture.isZero() ? '' : `<small class="rentabilite-facture-sous">${echapper(montant(t.facture))}</small>`}</td>`;
    const ids = chantiers.map((c) => c.id);
    this.#zone.innerHTML = `<table class="tableau-compact rentabilite-facturation-liste">
      <thead><tr><th>${texteHtml('rentabilite.facturation.chantier')}</th>${mois.map((m) => `<th class="montant">${echapper(libelleMois(m))}</th>`).join('')}<th class="montant">${texteHtml('rentabilite.facturation.total')}</th></tr></thead>
      <tbody>${chantiers.map((c) => {
        const v = versions.get(c.id);
        return `<tr><th scope="row"><a href="#" data-detail="${c.id}" title="${echapper(v ? texte('rentabilite.facturation.version', { le: formatDateHeure(v.le), par: v.par, nombre: '' }) : texte('rentabilite.facturation.aucune'))}">${echapper([c.code, c.libelle].filter(Boolean).join(' – '))}</a></th>
          ${mois.map((m) => cellule(total([c.id], [m]))).join('')}${cellule(total([c.id], mois))}</tr>`;
      }).join('')}</tbody>
      <tfoot><tr class="rentabilite-ligne-total"><th scope="row">${texteHtml('rentabilite.facturation.total')}</th>${mois.map((m) => cellule(total(ids, [m]))).join('')}${cellule(total(ids, mois))}</tr></tfoot></table>
      <p class="aide">${texteHtml('rentabilite.facturation.liste_aide')}</p>`;
    this.#zone.querySelectorAll('a[data-detail]').forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.#o.ouvrirDetail(Number(a.dataset.detail), ev.ctrlKey || ev.metaKey);
    }));
  }
}
