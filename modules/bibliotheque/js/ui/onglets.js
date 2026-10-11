import { echapper, formatNombre, formatLibre } from '@logibtp/socle/ui';
import { calculerElement, SCENARIOS_PA } from '../src/calcul.js';
import { entreeDepuisLigne } from '../src/fournisseurs.js';

// Onglets de la fiche d'un élément (classes mères utilisées par la fiche spécialisée de l'application). Contexte :
//   valeur(code), definir(code, valeur)      valeurs de la fiche (definir : saisie envoyée avec l'enregistrement)
//   valeurs()                                 ligne complète (valeurs et champs supplémentaires sous « proprietes »)
//   modifiable, id (null en création), fournisseur (FournisseurBibliotheque…), message(texte, niveau)
//   unites : [{ unt_code, unt_libelle }]      parametres : paramètres de la bibliothèque
//   donnees : [{ code, libelle }]             données techniques (champs supplémentaires) utilisables dans les formules

const prix = (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : formatNombre(v, Math.abs(Number(v)) < 10 && d === 2 ? 4 : d));
const json = (v, defaut) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return defaut; } })() : v ?? defaut);
const nombreSaisi = (s) => { const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? null : t; };
const MESSAGES_ALERTES = {
  PA_INDISPONIBLE: "Prix d'achat indisponible pour ce scénario (tarif principal, dernier PA ou PMP absent)",
  UNITE: 'Une unité de tarif n\'a pas de correspondance avec l\'unité de stock',
  DONNEE: 'Une donnée technique utilisée par une formule d\'unité n\'est pas renseignée',
  RATIO: 'Une correspondance d\'unité est nulle ou négative',
};

/** Onglet Prix : scénario de PA, coefficients, PV fixe, remise, résultat (par unité) et historique des prix. */
export class OngletPrix {
  constructor(corps, ctx) {
    this.corps = corps;
    this.ctx = ctx;
    this.tarifs = [];
    this.rendre();
    if (ctx.id !== null) {
      ctx.fournisseur.tarifs(ctx.id).then((t) => { this.tarifs = t; this.majResultat(); }).catch(() => {});
      this.chargerHistorique();
    }
  }

  get ouvrage() { return this.ctx.valeur('type') === 'OUVRAGE'; }

  rendre() {
    const { valeur, modifiable, parametres } = this.ctx;
    const ro = modifiable ? '' : 'disabled';
    const autorises = json(valeur('scenarios'), null) ?? parametres.scenarios_autorises;
    const remise = valeur('coef_remise') === null || valeur('coef_remise') === undefined ? '' : formatLibre((1 - Number(valeur('coef_remise'))) * 100, 4);
    const champ = (code, libelle, aide = '') => `<label title="${echapper(aide)}">${echapper(libelle)}<input data-v="${code}" inputmode="decimal" value="${echapper(valeur(code) === null || valeur(code) === undefined ? '' : String(valeur(code)).replace('.', ','))}" ${ro}></label>`;
    this.corps.innerHTML = `<div class="bib-prix">
      <fieldset class="fiche-groupe"><legend>Prix d'achat</legend>
        ${this.ouvrage ? '<p class="aide">Ouvrage : le prix d\'achat est la somme des composantes (onglet Composition).</p>' : `
        <label>Scénario <select data-v="scenario_pa" ${ro}>${SCENARIOS_PA.filter(([c]) => autorises.includes(c) || c === valeur('scenario_pa')).map(([c, l]) => `<option value="${c}" ${c === valeur('scenario_pa') ? 'selected' : ''}>${echapper(l)}</option>`).join('')}</select></label>
        <div class="bib-grille">${champ('pa_fixe', 'Prix fixe', 'Scénario « Prix fixe »')}${champ('dernier_pa', 'Dernier prix d\'achat', 'Alimenté par le futur module Achats')}${champ('pmp', 'Prix moyen pondéré', 'Alimenté par le futur module Stock')}</div>
        <details><summary>Scénarios autorisés pour cet élément</summary>${SCENARIOS_PA.map(([c, l]) => `<label class="bib-ligne"><input type="checkbox" data-scenario="${c}" ${autorises.includes(c) ? 'checked' : ''} ${ro}> ${echapper(l)}</label>`).join('')}</details>`}
      </fieldset>
      <fieldset class="fiche-groupe"><legend>Coefficients et vente</legend>
        <div class="bib-grille">${champ('coef_fg', 'Coef. frais généraux')}${champ('coef_benef', 'Coef. bénéfice', 'Déduit du PV quand le PV est fixe')}
          <label class="bib-ligne"><input type="checkbox" data-v="pv_fixe" ${valeur('pv_fixe') === true || valeur('pv_fixe') === 'true' ? 'checked' : ''} ${ro}> PV fixe</label>
          ${champ('pv', 'PV (si fixe)')}
          <label title="Remise sur le PV (coefficient de remise = 1 − remise)">Remise sur PV (%)<input data-remise inputmode="decimal" value="${echapper(remise)}" ${ro}></label></div>
      </fieldset>
      <fieldset class="fiche-groupe plein"><legend>Résultat (par unité de stock : ${echapper(valeur('unite_stock') ?? '?')})</legend><div class="bib-resultat"></div></fieldset>
      ${modifiable ? `<label class="plein">Commentaire de la modification de prix (historique)<input data-v="commentaire_prix" value="${echapper(valeur('commentaire_prix') ?? '')}" placeholder="Ex. hausse fournisseur au 1er octobre"></label>` : ''}
      <fieldset class="fiche-groupe plein"><legend>Historique des prix</legend><div class="bib-historique">${this.ctx.id === null ? '<p class="aide">Disponible après l\'enregistrement.</p>' : '⏳'}</div></fieldset>
    </div>`;
    this.corps.querySelectorAll('[data-v]').forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const code = el.dataset.v;
      this.ctx.definir(code, el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' || code === 'commentaire_prix' ? el.value : nombreSaisi(el.value));
      this.majResultat();
    }));
    this.corps.querySelector('[data-remise]')?.addEventListener('input', (e) => {
      const r = nombreSaisi(e.target.value);
      this.ctx.definir('coef_remise', r === null ? '1' : String(1 - Number(r) / 100));
      this.majResultat();
    });
    this.corps.querySelectorAll('[data-scenario]').forEach((el) => el.addEventListener('change', () => {
      this.ctx.definir('scenarios', [...this.corps.querySelectorAll('[data-scenario]:checked')].map((x) => x.dataset.scenario));
    }));
    this.majResultat();
  }

  /** Résultat recalculé localement (même calcul que le serveur, qui fait foi à l'enregistrement). */
  majResultat() {
    const zone = this.corps.querySelector('.bib-resultat');
    if (!zone) return;
    const l = this.ctx.valeurs();
    if (this.ouvrage) {
      zone.innerHTML = `<table class="bib-table"><tr><th>PA</th><th>PR</th><th>PV</th><th>PV net</th></tr>
        <tr><td>${prix(l.pa)}</td><td>${prix(l.pr)}</td><td>${prix(l.pv)}</td><td><b>${prix(l.pv_net)}</b></td></tr></table>
        <p class="aide">Prix issus du calcul de la composition, mis à jour à l'enregistrement.</p>`;
      return;
    }
    let r;
    try { r = calculerElement(entreeDepuisLigne(l, this.tarifs)); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    zone.innerHTML = `<table class="bib-table"><thead><tr><th>Unité</th><th>Quantité en ${echapper(l.unite_stock ?? '')}</th><th>PA</th><th>PR</th><th>PV net</th></tr></thead><tbody>
      ${r.prix_unites.map((p) => `<tr class="${p.unite === l.unite_stock ? 'stock' : ''}"><td>${echapper(p.unite)}${p.unite === l.unite_stock ? ' <small>(stock)</small>' : ''}</td>
        <td class="nombre">${p.ratio === null ? `<span class="erreur">${echapper(p.erreur ?? '')}</span>` : formatLibre(p.ratio)}</td><td class="nombre">${prix(p.pa)}</td><td class="nombre">${prix(p.pr)}</td><td class="nombre"><b>${prix(p.pv_net)}</b></td></tr>`).join('')}
      </tbody></table>
      <p class="bib-synthese">PA ${prix(r.pa)} × FG ${formatLibre(l.coef_fg ?? 1)} = PR ${prix(r.pr)} · × bénéfice ${formatLibre(r.coef_benef)} = PV ${prix(r.pv)} · remise ${formatLibre((1 - Number(l.coef_remise ?? 1)) * 100, 4)} % → <b>PV net ${prix(r.pv_net)}</b></p>
      ${r.alertes.map((a) => `<p class="alerte">⚠ ${echapper(MESSAGES_ALERTES[a] ?? a)}</p>`).join('')}`;
  }

  async chargerHistorique() {
    const zone = this.corps.querySelector('.bib-historique');
    try {
      const h = await this.ctx.fournisseur.historique(this.ctx.id);
      const v = (x, k) => (x?.[k] ?? null);
      const cellule = (e, k, d) => {
        const change = e.avant && String(v(e.avant, k)) !== String(v(e.apres, k));
        return `<td class="nombre ${change ? 'change' : ''}" title="${change ? `Avant : ${prix(v(e.avant, k), d)}` : ''}">${prix(v(e.apres, k), d)}</td>`;
      };
      zone.innerHTML = h.length ? `<table class="bib-table"><thead><tr><th>Date</th><th>Auteur</th><th>Scénario</th><th>PA</th><th>FG</th><th>PR</th><th>Bénéf.</th><th>PV</th><th>Remise</th><th>PV net</th><th>Commentaire</th></tr></thead><tbody>
        ${h.map((e) => `<tr><td>${new Date(e.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${echapper(e.auteur ?? '')}</td>
          <td>${echapper(SCENARIOS_PA.find(([c]) => c === e.apres.scenario)?.[1] ?? e.apres.scenario ?? '')}</td>
          ${cellule(e, 'pa')}${cellule(e, 'coef_fg', 4)}${cellule(e, 'pr')}${cellule(e, 'coef_benef', 4)}${cellule(e, 'pv')}${cellule(e, 'coef_remise', 4)}${cellule(e, 'pv_net')}
          <td>${echapper(e.commentaire ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucune modification de prix.</p>';
    } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; }
  }
}

/**
 * Onglet Unités : unité de stock (valorisation, obligatoire), unités d'achat et de vente par défaut, correspondances
 * par formule sur les données techniques (quantité en unité de stock pour 1 unité).
 */
export class OngletUnites {
  constructor(corps, ctx) {
    this.corps = corps;
    this.ctx = ctx;
    this.rendre();
  }

  #unites() { return json(this.ctx.valeur('unites'), []); }

  rendre() {
    const { valeur, modifiable, unites, donnees } = this.ctx;
    const ro = modifiable ? '' : 'disabled';
    const options = (v, vide = true) => `${vide ? '<option value=""></option>' : ''}${unites.map((u) => `<option value="${echapper(u.unt_code)}" ${u.unt_code === v ? 'selected' : ''}>${echapper(`${u.unt_code} – ${u.unt_libelle}`)}</option>`).join('')}`;
    const conv = this.#unites();
    const stock = valeur('unite_stock');
    this.corps.innerHTML = `<div class="bib-unites">
      <fieldset class="fiche-groupe"><legend>Unités</legend><div class="bib-grille">
        <label>Unité de stock * <select data-v="unite_stock" ${ro}>${options(stock, !stock)}</select></label>
        <label>Unité d'achat <select data-v="unite_achat" ${ro}>${options(valeur('unite_achat'))}</select></label>
        <label>Unité de vente <select data-v="unite_vente" ${ro}>${options(valeur('unite_vente'))}</select></label></div>
        <p class="aide">Les prix sont valorisés dans l'unité de stock ; les autres unités s'y convertissent par les correspondances ci-dessous.</p>
      </fieldset>
      <fieldset class="fiche-groupe plein"><legend>Correspondances (quantité en ${echapper(stock ?? 'unité de stock')} pour 1 unité)</legend>
        <table class="bib-table"><thead><tr><th>Unité</th><th>Formule</th><th>Exemple</th><th></th></tr></thead><tbody>
        ${conv.map((u, i) => `<tr data-i="${i}"><td><select data-c="unite" ${ro}>${options(u.unite)}</select></td>
          <td><input data-c="formule" value="${echapper(u.formule ?? '')}" placeholder="ex. 1000 / {{poids_ml}}" ${ro}></td><td class="bib-exemple"></td>
          <td>${modifiable ? '<button type="button" data-supprimer title="Retirer">✕</button>' : ''}</td></tr>`).join('')}
        </tbody></table>
        ${modifiable ? '<button type="button" data-ajouter>＋ Ajouter une unité</button>' : ''}
        <p class="aide">Données techniques utilisables (champs supplémentaires) : ${donnees.length ? donnees.map((d) => `<code title="${echapper(d.libelle)}">{{${echapper(d.code)}}}</code>`).join(' ') : 'aucune (créez-en dans ⚙ Paramétrer la fiche)'}.
          Exemple : acier stocké au ml, poids au ml dans la fiche ; kg → <code>1 / {{poids_ml}}</code>, t → <code>1000 / {{poids_ml}}</code>.</p>
      </fieldset></div>`;
    this.corps.querySelectorAll('[data-v]').forEach((el) => el.addEventListener('change', () => { this.ctx.definir(el.dataset.v, el.value || null); if (el.dataset.v === 'unite_stock') this.rendre(); }));
    this.corps.querySelectorAll('tr[data-i] [data-c]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => this.#enregistrer()));
    this.corps.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.closest('tr').dataset.i);
      this.ctx.definir('unites', this.#unites().filter((_, k) => k !== i));
      this.rendre();
    }));
    this.corps.querySelector('[data-ajouter]')?.addEventListener('click', () => { this.ctx.definir('unites', [...this.#unites(), { unite: '', formule: '' }]); this.rendre(); });
    this.#exemples();
  }

  #enregistrer() {
    const lignes = [...this.corps.querySelectorAll('tr[data-i]')].map((tr) => ({ unite: tr.querySelector('[data-c="unite"]').value, formule: tr.querySelector('[data-c="formule"]').value }));
    this.ctx.definir('unites', lignes);
    this.#exemples();
  }

  #exemples() {
    const l = this.ctx.valeurs();
    const e = entreeDepuisLigne(l);
    let r;
    try { r = calculerElement({ ...e, scenario: 'FIXE', pa_fixe: '1' }); } catch { r = null; }
    this.corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const u = tr.querySelector('[data-c="unite"]').value;
      const p = r?.prix_unites.find((x) => x.unite === u);
      tr.querySelector('.bib-exemple').innerHTML = !u ? '' : p?.ratio ? `1 ${echapper(u)} = ${formatLibre(p.ratio)} ${echapper(l.unite_stock ?? '')}` : `<span class="erreur">${echapper(p?.erreur ?? 'formule incomplète')}</span>`;
    });
  }
}

/** Onglet Tarifs fournisseurs : tableau avec liens (module Tarifs fournisseurs à venir), enregistré ligne à ligne. */
export class OngletTarifs {
  constructor(corps, ctx) {
    this.corps = corps;
    this.ctx = ctx;
    this.charger().catch((e) => ctx.message(e.message, 'erreur'));
  }

  async charger() {
    if (this.ctx.id === null) { this.corps.innerHTML = '<p class="aide">Enregistrez l\'élément pour saisir ses tarifs fournisseurs.</p>'; return; }
    this.rendre(await this.ctx.fournisseur.tarifs(this.ctx.id));
  }

  rendre(tarifs) {
    const { unites, modifiable } = this.ctx;
    const ro = modifiable ? '' : 'disabled';
    const options = (v) => unites.map((u) => `<option value="${echapper(u.unt_code)}" ${u.unt_code === v ? 'selected' : ''}>${echapper(u.unt_code)}</option>`).join('');
    const ligne = (t, i) => `<tr data-i="${i}" class="${t.id ? '' : 'ajout'}">
      <td><input type="radio" name="principal" data-c="principal" ${t.principal ? 'checked' : ''} ${ro} title="Fournisseur principal"></td>
      <td><input data-c="fournisseur" value="${echapper(t.fournisseur ?? '')}" ${ro}></td><td><input data-c="reference" value="${echapper(t.reference ?? '')}" ${ro} style="width:7rem"></td>
      <td><input data-c="libelle" value="${echapper(t.libelle ?? '')}" ${ro}></td>
      <td><input data-c="prix" inputmode="decimal" value="${echapper(t.prix === undefined || t.prix === null ? '' : String(t.prix).replace('.', ','))}" ${ro} style="width:6rem"></td>
      <td><select data-c="unite" ${ro}>${options(t.unite ?? this.ctx.valeur('unite_achat') ?? this.ctx.valeur('unite_stock'))}</select></td>
      <td><input type="date" data-c="debut" value="${echapper(t.debut ?? '')}" ${ro}></td><td><input type="date" data-c="fin" value="${echapper(t.fin ?? '')}" ${ro}></td>
      <td>${t.lien ? `<a href="${echapper(t.lien)}" target="_blank" rel="noopener" title="${echapper(t.lien)}">🔗</a>` : ''}<input data-c="lien" value="${echapper(t.lien ?? '')}" placeholder="https://…" ${ro} style="width:9rem"></td>
      <td class="bib-actions">${modifiable ? `<button type="button" data-action="enregistrer">${t.id ? '✓' : '＋'}</button>${t.id ? '<button type="button" data-action="supprimer">🗑</button>' : ''}` : ''}</td></tr>`;
    const lignes = modifiable ? [...tarifs, {}] : tarifs;
    this.corps.innerHTML = `<div class="bib-tarifs"><table class="bib-table"><thead><tr><th title="Principal">★</th><th>Fournisseur</th><th>Référence</th><th>Libellé</th><th>Prix</th><th>Unité</th><th>Début</th><th>Fin</th><th>Lien</th><th></th></tr></thead>
      <tbody>${lignes.map(ligne).join('') || '<tr><td colspan="10" class="aide">Aucun tarif.</td></tr>'}</tbody></table>
      <p class="aide">Plusieurs tarifs possibles, d'un ou de plusieurs fournisseurs (y compris plusieurs tarifs d'un même fournisseur). Le tarif principal ★ et les tarifs en vigueur
        alimentent les scénarios « fournisseur principal » et « meilleur prix » ; l'enregistrement recalcule le prix de l'élément et l'inscrit dans l'historique.</p></div>`;
    this.corps.querySelector('tbody').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const tr = b.closest('tr');
      const t = lignes[Number(tr.dataset.i)];
      const v = { ...t };
      tr.querySelectorAll('[data-c]').forEach((el) => { v[el.dataset.c] = el.type === 'radio' ? el.checked : el.value || null; });
      v.prix = nombreSaisi(v.prix);
      try {
        const r = b.dataset.action === 'supprimer'
          ? (confirm('Supprimer ce tarif ?') ? await this.ctx.fournisseur.supprimerTarif(this.ctx.id, t.id) : null)
          : await this.ctx.fournisseur.enregistrerTarif(this.ctx.id, v);
        if (!r) return;
        this.rendre(r.tarifs);
        this.ctx.surPrix?.(r.prix);
        this.ctx.message(`Tarifs enregistrés · PA ${prix(r.prix.pa)} · PV net ${prix(r.prix.pv_net)}`, 'succes');
      } catch (x) { this.ctx.message(x.message, 'erreur'); }
    });
  }
}
