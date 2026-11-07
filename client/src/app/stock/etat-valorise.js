import { texte, texteHtml, textesParCode, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo, telechargerCsv, celluleCsv } from '@logibtp/socle/ui';
import { METHODES_VALORISATION } from '@logibtp/stock';
import { api } from '../api.js';
import { isoDepuisLocal, dateHeureLocale } from './etat.js';

// Module Stock, lot 8 du plan Stock (plans/stock.md ; ANALYSE-MODULE-STOCK.md S5, S29, S30) : état du stock valorisé de tous
// les lieux (ou d'un seul) à une date-heure, rendu par `GET /api/stock/etat-valorise` (règle valoriserEtat, lot 7) :
// quantité et valeur de chaque article par lieu, valeur unitaire de la méthode retenue (repli signalé), valeur d'inventaire
// à part (prix saisi à l'inventaire, S30) et écart avec la valeur de la méthode ; totaux par lieu ; export CSV.

const SOURCES = textesParCode('stock_btp.sources', ['PMP', 'DERNIER_PA', 'REPLI']);
const nombre = (v) => (v === null || v === undefined ? 0 : Number(v));
const arrondi2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

export class PageEtatValorise extends PageBase {
  icone = icone('stock_btp_valorise');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.etat_valorise');
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    this.conteneur.innerHTML = `<div class="page-parametres page-etat-valorise"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_valorise')} ${texteHtml('stock_btp.routes.etat_valorise')}</h1>
      <span data-lieu></span>
      <label>${texteHtml('stock_btp.etat.date')} <input type="datetime-local" data-date title="${texteHtml('stock_btp.etat.date_titre')}"></label>
      <label><input type="checkbox" data-zeros> ${texteHtml('stock_btp.etat.zeros')}</label>
      <input type="search" data-recherche placeholder="${texteHtml('stock_btp.etat.recherche')}" size="24">
      <button type="button" data-csv title="${texteHtml('stock_btp.etat.csv_titre')}">${iconeHtml('stock_btp_csv')} ${texteHtml('stock_btp.etat.csv')}</button>
      <button type="button" data-pdf title="${texteHtml('stock_btp.valorise.pdf_titre')}">${iconeHtml('edition_btp_pdf')} ${texteHtml('stock_btp.valorise.pdf')}</button></div>
      <p class="aide" data-aide></p><div data-corps></div></div>`;
    this.lieux = await api.stock.lieux();
    this.lieu = Number(p.get('lieu')) || null;
    const combo = creerCombo({ options: this.lieux.map((l) => ({ valeur: l.id, libelle: `${icone(l.depot ? 'stock_btp_stock' : 'stock_btp_chantier')} ${l.code} – ${l.libelle}` })),
      valeur: this.lieu ?? '', vide: true, titre: texte('stock_btp.valorise.tous_lieux') });
    combo.placeholder = texte('stock_btp.valorise.tous_lieux');
    combo.addEventListener('change', () => { this.lieu = Number(combo.valeurCombo) || null; this.charger(); });
    this.conteneur.querySelector('[data-lieu]').append(combo);
    const date = this.conteneur.querySelector('[data-date]');
    if (p.get('date')) date.value = p.get('date');
    date.addEventListener('change', () => this.charger());
    this.conteneur.querySelector('[data-zeros]').addEventListener('change', () => this.charger());
    this.conteneur.querySelector('[data-recherche]').addEventListener('input', () => this.#rendre());
    this.conteneur.querySelector('[data-csv]').addEventListener('click', () => this.#exporter());
    this.conteneur.querySelector('[data-pdf]').addEventListener('click', () => this.#imprimer());
    await this.charger();
  }

  async charger() {
    try {
      this.etat = await api.stock.etatValorise({
        date: isoDepuisLocal(this.conteneur.querySelector('[data-date]').value), lieux: this.lieu ? [this.lieu] : [], zeros: this.conteneur.querySelector('[data-zeros]').checked,
      });
    } catch (e) { this.app.erreur(e); return; }
    this.#rendre();
  }

  #lignes() {
    const q = this.conteneur.querySelector('[data-recherche]').value.trim().toLowerCase();
    return (this.etat?.lignes ?? []).filter((l) => !q || `${l.code} ${l.libelle}`.toLowerCase().includes(q));
  }

  /** Écart entre la valeur d'inventaire et la valeur de la méthode (null sans prix d'inventaire). */
  static ecart(l) { return l.valeur_inventaire === null || l.valeur_inventaire === undefined ? null : arrondi2(nombre(l.valeur_inventaire) - nombre(l.valeur)); }

  #rendre() {
    const e = this.etat;
    if (!e) return;
    const codes = new Map(e.lieux.map((l) => [l.lieu, l.code]));
    this.conteneur.querySelector('[data-aide]').textContent = texte('stock_btp.valorise.aide', { date: dateHeureLocale(e.date), methode: METHODES_VALORISATION[e.methode] ?? e.methode });
    const lignes = this.#lignes();
    const total = arrondi2(lignes.reduce((s, l) => s + nombre(l.valeur), 0));
    const totalInv = arrondi2(lignes.reduce((s, l) => s + nombre(l.valeur_inventaire), 0));
    const totaux = e.lieux.length > 1 ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('stock_btp.valorise.lieu')}</th><th>${texteHtml('stock_btp.colonnes.valeur')}</th><th>${texteHtml('stock_btp.valorise.valeur_inventaire')}</th></tr></thead><tbody>
      ${e.lieux.map((l) => `<tr><td>${iconeHtml(l.depot ? 'stock_btp_stock' : 'stock_btp_chantier')} ${echapper(l.code)} ${echapper(l.libelle ?? '')}</td><td class="nombre">${formatNombre(l.valeur, 2)}</td><td class="nombre">${formatNombre(l.valeur_inventaire, 2)}</td></tr>`).join('')}
      </tbody></table>` : '';
    this.conteneur.querySelector('[data-corps]').innerHTML = totaux + (lignes.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.article')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.valorise.lieux')}</th>
      <th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.colonnes.unite_court')}</th><th>${texteHtml('stock_btp.colonnes.valeur_unitaire')}</th><th>${texteHtml('stock_btp.colonnes.source')}</th><th>${texteHtml('stock_btp.colonnes.valeur')}</th>
      <th>${texteHtml('stock_btp.valorise.prix_inventaire')}</th><th>${texteHtml('stock_btp.valorise.valeur_inventaire')}</th><th>${texteHtml('stock_btp.valorise.ecart')}</th></tr></thead><tbody>
      ${lignes.map((l) => {
        const ecart = PageEtatValorise.ecart(l);
        return `<tr class="${nombre(l.quantite) < 0 ? 'negatif' : ''}"><td><a href="${urlFiche(TYPE_FICHE.ELEMENT, l.ele_id)}" data-element="${l.ele_id}">${echapper(l.code)}</a></td>
        <td>${echapper(l.libelle)}</td><td>${l.lieux.map((x) => `${echapper(codes.get(x.lieu) ?? String(x.lieu))} : ${formatNombre(x.quantite, l.precision)}`).join('<br>')}</td>
        <td class="nombre${nombre(l.quantite) < 0 ? ' avertissement' : ''}">${formatNombre(l.quantite, l.precision)}</td><td>${echapper(l.unite)}</td>
        <td class="nombre">${formatNombre(l.valeur_unitaire, 4)}${l.provisoire ? ` <span title="${texteHtml('stock_btp.etat.provisoire')}">${iconeHtml('stock_btp_provisoire')}</span>` : ''}</td>
        <td class="${l.source === 'REPLI' ? 'avertissement' : ''}">${echapper(SOURCES[l.source] ?? '—')}</td><td class="nombre">${formatNombre(l.valeur, 2)}</td>
        <td class="nombre">${formatNombre(l.prix_inventaire, 4)}</td><td class="nombre">${formatNombre(l.valeur_inventaire, 2)}</td>
        <td class="nombre${ecart !== null && ecart < 0 ? ' avertissement' : ''}">${ecart === null ? '' : formatNombre(ecart, 2)}</td></tr>`;
      }).join('')}
      </tbody><tfoot><tr><th colspan="7">${texteHtml('stock_btp.etat.total', { articles: pluriel('stock_btp.etat.articles', lignes.length) })}</th><th class="nombre">${formatNombre(total, 2)}</th><th></th>
        <th class="nombre">${formatNombre(totalInv, 2)}</th><th></th></tr></tfoot></table>` : `<p class="aide">${texteHtml('stock_btp.etat.aucun')}</p>`);
    this.conteneur.querySelectorAll('[data-element]').forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.app.naviguer(urlFiche(TYPE_FICHE.ELEMENT, a.dataset.element), { nouvelleFenetre: ev.ctrlKey });
    }));
  }

  /** PDF (module Édition, modèle ETAT_STOCK_VALORISE) : même date, même lieu, mêmes articles à zéro que l'écran. */
  #imprimer() {
    const date = isoDepuisLocal(this.conteneur.querySelector('[data-date]').value) ?? this.etat?.date ?? '';
    const zeros = this.conteneur.querySelector('[data-zeros]').checked ? '1' : '0';
    this.app.naviguer(`/edition?source=liste&id=${encodeURIComponent(`stock_etat|${date}|${this.lieu ?? ''}|${zeros}`)}`, { nouvelleFenetre: true });
  }

  #exporter() {
    const cel = celluleCsv;
    const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const codes = new Map((this.etat?.lieux ?? []).map((l) => [l.lieu, l.code]));
    const entetes = ['stock_btp.colonnes.article', 'commun.libelle', 'stock_btp.valorise.lieux', 'stock_btp.colonnes.quantite', 'stock_btp.colonnes.unite', 'stock_btp.colonnes.valeur_unitaire',
      'stock_btp.colonnes.source', 'stock_btp.colonnes.valeur', 'stock_btp.valorise.prix_inventaire', 'stock_btp.valorise.valeur_inventaire', 'stock_btp.valorise.ecart'];
    const csv = [entetes.map((c) => cel(texte(c))).join(';'),
      ...this.#lignes().map((l) => [cel(l.code), cel(l.libelle), cel(l.lieux.map((x) => `${codes.get(x.lieu) ?? x.lieu} : ${x.quantite}`).join(' | ')), num(l.quantite), cel(l.unite), num(l.valeur_unitaire),
        cel(SOURCES[l.source] ?? ''), num(l.valeur), num(l.prix_inventaire), num(l.valeur_inventaire), num(PageEtatValorise.ecart(l))].join(';'))].join('\r\n');
    telechargerCsv(`stock-valorise-${(this.etat?.date ?? '').slice(0, 10)}.csv`, csv);
  }
}
