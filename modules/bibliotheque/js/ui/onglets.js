import { texte, texteHtml, textesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { echapper, formatNombre, formatLibre, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import { calculerElement, coefficientsEffectifs, prixNetTarif, SCENARIOS_PA } from '../src/calcul.js';
import { entreeDepuisLigne, DONNEES_TECHNIQUES } from '../src/fournisseurs.js';

// Onglets de la fiche d'un élément (classes mères utilisées par la fiche spécialisée de l'application). Contexte :
//   valeur(code), definir(code, valeur)      valeurs de la fiche (definir : saisie envoyée avec l'enregistrement)
//   valeurs()                                 ligne complète (valeurs et champs supplémentaires sous « proprietes »)
//   modifiable, id (null en création), fournisseur (FournisseurBibliotheque…), message(texte, niveau)
//   unites : [{ unt_code, unt_libelle }]      parametres : paramètres de la bibliothèque ; periodes : coefficients par période
//   donnees : [{ code, libelle }]             données techniques (champs supplémentaires) utilisables dans les formules

/** Prix affiché : 4 décimales sous 10 (2 sinon, ou `d` imposé), tiret si absent. */
export const formatPrix = (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : formatNombre(v, Math.abs(Number(v)) < 10 && d === 2 ? 4 : d));
const prix = formatPrix;
const json = (v, defaut) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return defaut; } })() : v ?? defaut);
const nombreSaisi = (s) => { const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? null : t; };
const MESSAGES_ALERTES = textesParCode('bibliotheque.prix.alertes', ['PA_INDISPONIBLE', 'UNITE', 'DONNEE', 'RATIO']);

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
  get ensemble() { return this.ctx.valeur('type') === 'ENSEMBLE'; }

  /** Coefficients effectifs : imposés par l'élément, sinon nature ou global en vigueur, sinon défaut. */
  effectifs() {
    return coefficientsEffectifs(this.ctx.valeurs(), this.ctx.periodes ?? [], aujourdhui(), this.ctx.parametres);
  }

  rendre() {
    const { valeur, modifiable, parametres } = this.ctx;
    const ro = modifiable ? '' : 'disabled';
    const autorises = json(valeur('scenarios'), null) ?? parametres.scenarios_autorises;
    const remise = valeur('coef_remise') === null || valeur('coef_remise') === undefined ? '' : formatLibre((1 - Number(valeur('coef_remise'))) * 100, 4);
    const eff = this.effectifs();
    const source = (s) => (['impose', 'nature', 'global', 'defaut'].includes(s.portee)
      ? texte(`bibliotheque.prix.sources.${s.portee}`, { debut: String(s.debut).split('-').reverse().join('/') }) : s.portee);
    // Coefficient : celui de la nature ou global en vigueur, ou imposé (case cochée : saisie libre).
    const coefChamp = (code, libelle) => {
      const impose = valeur(`${code}_impose`) === true || valeur(`${code}_impose`) === 'true';
      const v = impose ? valeur(code) : eff[code];
      return `<div class="bib-coef"><label>${echapper(libelle)}<input data-v="${code}" inputmode="decimal" value="${echapper(v === null || v === undefined ? '' : String(v).replace('.', ','))}" ${ro || !impose ? 'readonly' : ''}></label>
        <label class="bib-ligne"><input type="checkbox" data-impose="${code}" ${impose ? 'checked' : ''} ${ro}> ${texteHtml('bibliotheque.prix.impose')}</label>
        <small class="bib-source">${echapper(source(eff.sources[code]))}</small></div>`;
    };
    const champ = (code, libelle, aide = '') => `<label title="${echapper(aide)}">${echapper(libelle)}<input data-v="${code}" inputmode="decimal" value="${echapper(valeur(code) === null || valeur(code) === undefined ? '' : String(valeur(code)).replace('.', ','))}" ${ro}></label>`;
    this.corps.innerHTML = `<div class="bib-prix">
      <fieldset class="fiche-groupe"><legend>${texteHtml('bibliotheque.prix.achat')}</legend>
        ${this.ouvrage ? `<p class="aide">${texteHtml('bibliotheque.prix.ouvrage_aide')}</p>` : `
        <label>${texteHtml('bibliotheque.prix.scenario')} <select data-v="scenario_pa" ${ro}>${SCENARIOS_PA.filter(([c]) => autorises.includes(c) || c === valeur('scenario_pa')).map(([c, l]) => `<option value="${c}" ${c === valeur('scenario_pa') ? 'selected' : ''}>${echapper(l)}</option>`).join('')}</select></label>
        <div class="bib-grille">${champ('pa_fixe', texte('bibliotheque.scenarios.FIXE'), texte('bibliotheque.prix.pa_fixe_aide'))}${champ('dernier_pa', texte('bibliotheque.scenarios.DERNIER_PA'), texte('bibliotheque.prix.dernier_pa_aide'))}${champ('pmp', texte('bibliotheque.scenarios.PMP'), texte('bibliotheque.prix.pmp_aide'))}</div>
        <details><summary>${texteHtml('bibliotheque.prix.autorises')}</summary>${SCENARIOS_PA.map(([c, l]) => `<label class="bib-ligne"><input type="checkbox" data-scenario="${c}" ${autorises.includes(c) ? 'checked' : ''} ${ro}> ${echapper(l)}</label>`).join('')}</details>`}
      </fieldset>
      <fieldset class="fiche-groupe"><legend>${texteHtml('bibliotheque.prix.coefficients')}</legend>
        <div class="bib-grille">${coefChamp('coef_fg', texte('bibliotheque.prix.coef_fg'))}${coefChamp('coef_benef', texte('bibliotheque.prix.coef_benef'))}
          ${this.ensemble ? '' : `<label class="bib-ligne" title="${this.ouvrage ? texteHtml('bibliotheque.prix.pv_fixe_ouvrage') : ''}"><input type="checkbox" data-v="pv_fixe" ${valeur('pv_fixe') === true || valeur('pv_fixe') === 'true' ? 'checked' : ''} ${ro}> ${texteHtml('bibliotheque.prix.pv_fixe')}</label>
          ${champ('pv', texte('bibliotheque.prix.pv'))}`}
          <label title="${texteHtml('bibliotheque.prix.remise_aide')}">${texteHtml('bibliotheque.prix.remise')}<input data-remise inputmode="decimal" value="${echapper(remise)}" ${ro}></label></div>
      </fieldset>
      <fieldset class="fiche-groupe plein"><legend>${texteHtml('bibliotheque.prix.resultat', { unite: valeur('unite_stock') ?? '?' })}</legend><div class="bib-resultat"></div></fieldset>
      ${modifiable ? `<label class="plein">${texteHtml('bibliotheque.prix.commentaire')}<input data-v="commentaire_prix" value="${echapper(valeur('commentaire_prix') ?? '')}" placeholder="${texteHtml('bibliotheque.prix.commentaire_exemple')}"></label>` : ''}
      <fieldset class="fiche-groupe plein"><legend>${texteHtml('bibliotheque.prix.historique')}</legend><div class="bib-historique">${this.ctx.id === null ? `<p class="aide">${texteHtml('bibliotheque.prix.historique_apres')}</p>` : iconeHtml('bibliotheque_attente')}</div></fieldset>
    </div>`;
    this.corps.querySelectorAll('[data-v]').forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const code = el.dataset.v;
      this.ctx.definir(code, el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' || code === 'commentaire_prix' ? el.value : nombreSaisi(el.value));
      this.majResultat();
    }));
    this.corps.querySelectorAll('[data-impose]').forEach((el) => el.addEventListener('change', () => {
      const code = el.dataset.impose;
      this.ctx.definir(`${code}_impose`, el.checked);
      if (el.checked) this.ctx.definir(code, String(this.effectifs()[code] ?? 1));
      this.rendre();
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
      zone.innerHTML = `<table class="bib-table"><tr><th>${texteHtml('bibliotheque.prix.colonnes.pa')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pr')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pv')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pv_net')}</th></tr>
        <tr><td>${prix(l.pa)}</td><td>${prix(l.pr)}</td><td>${prix(l.pv)}</td><td><b>${prix(l.pv_net)}</b></td></tr></table>
        <p class="aide">${l.pv_fixe === true || l.pv_fixe === 'true' ? texteHtml('bibliotheque.prix.composition_pv_fixe') : texteHtml('bibliotheque.prix.composition')}</p>`;
      return;
    }
    const c = this.effectifs();
    Object.assign(l, { coef_fg: c.coef_fg, coef_benef: l.pv_fixe === true || l.pv_fixe === 'true' ? l.coef_benef : c.coef_benef });
    let r;
    try { r = calculerElement(entreeDepuisLigne(l, this.tarifs)); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    zone.innerHTML = `<table class="bib-table"><thead><tr><th>${texteHtml('bibliotheque.prix.colonnes.unite')}</th><th>${texteHtml('bibliotheque.prix.colonnes.quantite', { unite: l.unite_stock ?? '' })}</th><th>${texteHtml('bibliotheque.prix.colonnes.pa')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pr')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pv_net')}</th></tr></thead><tbody>
      ${r.prix_unites.map((p) => `<tr class="${p.unite === l.unite_stock ? 'stock' : ''}"><td>${echapper(p.unite)}${p.unite === l.unite_stock ? ` <small>${texteHtml('bibliotheque.prix.stock')}</small>` : ''}</td>
        <td class="nombre">${p.ratio === null ? `<span class="erreur">${echapper(p.erreur ?? '')}</span>` : formatLibre(p.ratio)}</td><td class="nombre">${prix(p.pa)}</td><td class="nombre">${prix(p.pr)}</td><td class="nombre"><b>${prix(p.pv_net)}</b></td></tr>`).join('')}
      </tbody></table>
      <p class="bib-synthese">${texteHtml('bibliotheque.prix.synthese_html', { pa: prix(r.pa), fg: formatLibre(l.coef_fg ?? 1), pr: prix(r.pr), benef: formatLibre(r.coef_benef), pv: prix(r.pv), remise: formatLibre((1 - Number(l.coef_remise ?? 1)) * 100, 4), fleche: icone('bibliotheque_resultat'), pv_net: prix(r.pv_net) })}</p>
      ${r.alertes.map((a) => `<p class="alerte">${iconeHtml('avertissement')} ${echapper(MESSAGES_ALERTES[a] ?? a)}</p>`).join('')}`;
  }

  async chargerHistorique() {
    const zone = this.corps.querySelector('.bib-historique');
    try {
      const h = await this.ctx.fournisseur.historique(this.ctx.id);
      const v = (x, k) => (x?.[k] ?? null);
      const cellule = (e, k, d) => {
        const change = e.avant && String(v(e.avant, k)) !== String(v(e.apres, k));
        return `<td class="nombre ${change ? 'change' : ''}" title="${change ? texteHtml('bibliotheque.prix.avant', { prix: prix(v(e.avant, k), d) }) : ''}">${prix(v(e.apres, k), d)}</td>`;
      };
      zone.innerHTML = h.length ? `<table class="bib-table"><thead><tr><th>${texteHtml('bibliotheque.prix.colonnes.date')}</th><th>${texteHtml('bibliotheque.prix.colonnes.auteur')}</th><th>${texteHtml('bibliotheque.prix.scenario')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pa')}</th><th>${texteHtml('bibliotheque.prix.colonnes.fg')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pr')}</th><th>${texteHtml('bibliotheque.prix.colonnes.benef')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pv')}</th><th>${texteHtml('bibliotheque.prix.colonnes.remise')}</th><th>${texteHtml('bibliotheque.prix.colonnes.pv_net')}</th><th>${texteHtml('bibliotheque.prix.colonnes.commentaire')}</th></tr></thead><tbody>
        ${h.map((e) => `<tr><td>${formatDateHeure(e.date)}</td><td>${echapper(e.auteur ?? '')}</td>
          <td>${echapper(SCENARIOS_PA.find(([c]) => c === e.apres.scenario)?.[1] ?? e.apres.scenario ?? '')}</td>
          ${cellule(e, 'pa')}${cellule(e, 'coef_fg', 4)}${cellule(e, 'pr')}${cellule(e, 'coef_benef', 4)}${cellule(e, 'pv')}${cellule(e, 'coef_remise', 4)}${cellule(e, 'pv_net')}
          <td>${echapper(e.commentaire ?? '')}</td></tr>`).join('')}</tbody></table>` : `<p class="aide">${texteHtml('bibliotheque.prix.aucune_modification')}</p>`;
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
      <fieldset class="fiche-groupe"><legend>${texteHtml('bibliotheque.unites.titre')}</legend><div class="bib-grille">
        <label>${texteHtml('bibliotheque.unites.stock')} <select data-v="unite_stock" ${ro}>${options(stock, !stock)}</select></label>
        <label>${texteHtml('bibliotheque.unites.achat')} <select data-v="unite_achat" ${ro}>${options(valeur('unite_achat'))}</select></label>
        <label>${texteHtml('bibliotheque.unites.vente')} <select data-v="unite_vente" ${ro}>${options(valeur('unite_vente'))}</select></label></div>
        <p class="aide">${texteHtml('bibliotheque.unites.aide')}</p>
      </fieldset>
      <fieldset class="fiche-groupe plein"><legend>${texteHtml('bibliotheque.unites.correspondances', { unite: stock ?? texte('bibliotheque.unites.unite_stock') })}</legend>
        <table class="bib-table"><thead><tr><th>${texteHtml('bibliotheque.prix.colonnes.unite')}</th><th>${texteHtml('bibliotheque.unites.formule')}</th><th>${texteHtml('bibliotheque.unites.exemple')}</th><th></th></tr></thead><tbody>
        ${conv.map((u, i) => `<tr data-i="${i}"><td><select data-c="unite" ${ro}>${options(u.unite)}</select></td>
          <td><input data-c="formule" value="${echapper(u.formule ?? '')}" placeholder="${texteHtml('bibliotheque.unites.formule_exemple', { poids_ml: '{{poids_ml}}' })}" ${ro}></td><td class="bib-exemple"></td>
          <td>${modifiable ? `<button type="button" data-supprimer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}
        </tbody></table>
        ${modifiable ? `<button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('bibliotheque.unites.ajouter')}</button>` : ''}
        <p class="aide">${texteHtml('bibliotheque.unites.donnees')} ${[...DONNEES_TECHNIQUES.map(([code, libelle]) => ({ code, libelle })), ...donnees].map((d) => `<code title="${echapper(d.libelle)}">{{${echapper(d.code)}}}</code>`).join(' ')}.
          ${texteHtml('bibliotheque.unites.exemples_html', { poids: '{{poids}}', hauteur: '{{hauteur}}', largeur: '{{largeur}}' })}</p>
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
      tr.querySelector('.bib-exemple').innerHTML = !u ? '' : p?.ratio ? `1 ${echapper(u)} = ${formatLibre(p.ratio)} ${echapper(l.unite_stock ?? '')}` : `<span class="erreur">${echapper(p?.erreur ?? texte('bibliotheque.unites.incomplete'))}</span>`;
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
    if (this.ctx.id === null) { this.corps.innerHTML = `<p class="aide">${texteHtml('bibliotheque.tarifs.enregistrer_avant')}</p>`; return; }
    this.rendre(await this.ctx.fournisseur.tarifs(this.ctx.id));
  }

  rendre(tarifs) {
    const { unites, modifiable } = this.ctx;
    const ro = modifiable ? '' : 'disabled';
    const options = (v) => unites.map((u) => `<option value="${echapper(u.unt_code)}" ${u.unt_code === v ? 'selected' : ''}>${echapper(u.unt_code)}</option>`).join('');
    const saisi = (v) => echapper(v === undefined || v === null ? '' : String(v).replace('.', ','));
    // Prix net : prix public remisé (lot 8) s'il est renseigné, sinon le prix saisi.
    const net = (t) => { try { return t.prix_public !== null && t.prix_public !== undefined && t.prix_public !== '' ? prix(String(prixNetTarif(t)), 4) : ''; } catch { return ''; } };
    const ligne = (t, i) => `<tr data-i="${i}" class="${t.id ? '' : 'ajout'}">
      <td><input type="radio" name="principal" data-c="principal" ${t.principal ? 'checked' : ''} ${ro} title="${texteHtml('bibliotheque.tarifs.principal')}"></td>
      <td><input data-c="fournisseur" value="${echapper(t.fournisseur ?? '')}" ${ro}></td><td><input data-c="reference" value="${echapper(t.reference ?? '')}" ${ro} style="width:7rem"></td>
      <td><input data-c="libelle" value="${echapper(t.libelle ?? '')}" ${ro}></td>
      <td><input data-c="prix_public" inputmode="decimal" value="${saisi(t.prix_public)}" ${ro} style="width:6rem" title="${texteHtml('bibliotheque.tarifs.prix_public_aide')}"></td>
      <td><input data-c="remise1" inputmode="decimal" value="${saisi(t.remise1)}" ${ro} style="width:3.5rem"></td>
      <td><input data-c="remise2" inputmode="decimal" value="${saisi(t.remise2)}" ${ro} style="width:3.5rem"></td>
      <td><input data-c="prix" inputmode="decimal" value="${saisi(t.prix)}" ${ro} style="width:6rem" title="${texteHtml('bibliotheque.tarifs.prix_aide')}">${net(t) ? `<small class="aide" data-net> = ${net(t)}</small>` : ''}</td>
      <td><select data-c="unite" ${ro}>${options(t.unite ?? this.ctx.valeur('unite_achat') ?? this.ctx.valeur('unite_stock'))}</select></td>
      <td><input data-c="delai" inputmode="numeric" value="${saisi(t.delai)}" ${ro} style="width:3.5rem" title="${texteHtml('bibliotheque.tarifs.delai_aide')}"></td>
      <td><input data-c="code_barre" value="${echapper(t.code_barre ?? '')}" ${ro} style="width:8rem"></td>
      <td><input type="date" data-c="debut" value="${echapper(t.debut ?? '')}" ${ro}></td><td><input type="date" data-c="fin" value="${echapper(t.fin ?? '')}" ${ro}></td>
      <td>${t.lien ? `<a href="${echapper(t.lien)}" target="_blank" rel="noopener" title="${echapper(t.lien)}">${iconeHtml('bibliotheque_lien')}</a>` : ''}<input data-c="lien" value="${echapper(t.lien ?? '')}" placeholder="https://…" ${ro} style="width:9rem"></td>
      <td class="bib-actions">${modifiable ? `<button type="button" data-action="enregistrer">${iconeHtml(t.id ? 'bibliotheque_enregistrer' : 'ajouter')}</button>${t.id ? `<button type="button" data-action="supprimer" title="${texteHtml('commun.supprimer')}">${iconeHtml('supprimer')}</button>` : ''}` : ''}</td></tr>`;
    const lignes = modifiable ? [...tarifs, {}] : tarifs;
    this.corps.innerHTML = `<div class="bib-tarifs"><table class="bib-table"><thead><tr><th title="${texteHtml('bibliotheque.tarifs.colonnes.principal')}">${iconeHtml('bibliotheque_principal')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.fournisseur')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.reference')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.prix_public')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.remise1')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.remise2')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.prix')}</th><th>${texteHtml('bibliotheque.prix.colonnes.unite')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.delai')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.code_barre')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.debut')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.fin')}</th><th>${texteHtml('bibliotheque.tarifs.colonnes.lien')}</th><th></th></tr></thead>
      <tbody>${lignes.map(ligne).join('') || `<tr><td colspan="15" class="aide">${texteHtml('bibliotheque.tarifs.aucun')}</td></tr>`}</tbody></table>
      <p class="aide">${texteHtml('bibliotheque.tarifs.aide', { principal: icone('bibliotheque_principal') })}</p></div>`;
    this.corps.querySelector('tbody').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const tr = b.closest('tr');
      const t = lignes[Number(tr.dataset.i)];
      const v = { ...t };
      tr.querySelectorAll('[data-c]').forEach((el) => { v[el.dataset.c] = el.type === 'radio' ? el.checked : el.value || null; });
      for (const c of ['prix', 'prix_public', 'remise1', 'remise2']) v[c] = nombreSaisi(v[c]);
      v.delai = v.delai === null ? null : Number(nombreSaisi(v.delai));
      if (v.prix === null && v.prix_public !== null) v.prix = '0';
      try {
        const r = b.dataset.action === 'supprimer'
          ? (await confirmer(texte('bibliotheque.tarifs.supprimer')) ? await this.ctx.fournisseur.supprimerTarif(this.ctx.id, t.id) : null)
          : await this.ctx.fournisseur.enregistrerTarif(this.ctx.id, v);
        if (!r) return;
        this.rendre(r.tarifs);
        this.ctx.surPrix?.(r.prix);
        this.ctx.message(texte('bibliotheque.tarifs.enregistres', { pa: prix(r.prix.pa), pv_net: prix(r.prix.pv_net) }), 'succes');
      } catch (x) { this.ctx.message(x.message, 'erreur'); }
    });
  }
}
