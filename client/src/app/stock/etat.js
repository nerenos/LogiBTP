import { texte, texteHtml, textesParCode, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE, urlDocument } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo, formatDateHeure, telechargerCsv, celluleCsv } from '@logibtp/socle/ui';
import { METHODES_VALORISATION } from '@logibtp/stock';
import { api } from '../api.js';

// Module Stock, lot 1 (ANALYSE-MODULE-STOCK.md § 3.1, S4, S29, S31) : état du stock d'un dépôt (ou d'un chantier qui
// tient un stock) à une date-heure : quantité de chaque article (dernier comptage + mouvements postérieurs), valeur
// unitaire à cette date selon la méthode de la société (PMP ou dernier prix d'achat ; repli sur le PA de la
// bibliothèque signalé), valeur totale ; export CSV.

/** Date-heure locale du champ (« AAAA-MM-JJTHH:MM ») → ISO UTC, ou null. */
export const isoDepuisLocal = (v) => (v ? new Date(v).toISOString() : null);
/** Date-heure UTC à la minute renvoyée par le serveur (« AAAA-MM-JJTHH:MM ») → texte local. */
export const dateHeureLocale = (v) => (v ? formatDateHeure(`${v}Z`) : '');

/** Source de la valeur unitaire, par code (module Personnalisation). */
const SOURCES = textesParCode('stock_btp.sources', ['PMP', 'DERNIER_PA', 'REPLI']);

export class PageStock extends PageBase {
  icone = icone('stock_btp_stock');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.stock');
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    this.conteneur.innerHTML = `<div class="page-parametres page-stock"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_stock')} ${texteHtml('stock_btp.routes.stock')}</h1>
      <span data-lieu></span>
      <label>${texteHtml('stock_btp.etat.date')} <input type="datetime-local" data-date title="${texteHtml('stock_btp.etat.date_titre')}"></label>
      <label><input type="checkbox" data-zeros> ${texteHtml('stock_btp.etat.zeros')}</label>
      <span data-marque></span>
      <input type="search" data-recherche placeholder="${texteHtml('stock_btp.etat.recherche')}" size="24">
      <button type="button" data-csv title="${texteHtml('stock_btp.etat.csv_titre')}">${iconeHtml('stock_btp_csv')} ${texteHtml('stock_btp.etat.csv')}</button></div>
      <p class="aide" data-aide></p><div data-corps></div></div>`;
    const [lieux, marques, articles] = await Promise.all([api.stock.lieux(), api.stock.marques(), api.stock.articles()]);
    this.lieux = lieux;
    // Filtre par marque (lot 2) : marques des articles gérés en stock.
    this.marquesArticle = new Map(articles.map((a) => [a.id, a.marques]));
    const marque = creerCombo({ options: marques.filter((m) => m.actif).map((m) => ({ valeur: m.code, libelle: m.libelle, couleur: m.couleur })), valeur: '', titre: texte('stock_btp.etat.marques') });
    marque.placeholder = texte('stock_btp.etat.marque');
    marque.addEventListener('change', () => { this.marque = marque.valeurCombo || null; this.#rendre(); });
    this.conteneur.querySelector('[data-marque]').append(marque);
    this.lieu = Number(p.get('lieu')) || this.lieux.find((l) => l.depot)?.id || this.lieux[0]?.id || null;
    const combo = creerCombo({ options: this.lieux.map((l) => ({ valeur: l.id, libelle: `${icone(l.depot ? 'stock_btp_stock' : 'stock_btp_chantier')} ${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', vide: false });
    combo.addEventListener('change', () => { this.lieu = Number(combo.valeurCombo); this.charger(); });
    this.conteneur.querySelector('[data-lieu]').append(combo);
    const date = this.conteneur.querySelector('[data-date]');
    if (p.get('date')) date.value = p.get('date');
    date.addEventListener('change', () => this.charger());
    this.conteneur.querySelector('[data-zeros]').addEventListener('change', () => this.charger());
    this.conteneur.querySelector('[data-recherche]').addEventListener('input', () => this.#rendre());
    this.conteneur.querySelector('[data-csv]').addEventListener('click', () => this.#exporter());
    await this.charger();
  }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.lieu) { corps.innerHTML = `<p class="aide">${texteHtml('stock_btp.etat.aucun_depot')}</p>`; return; }
    try {
      this.etat = await api.stock.etat(this.lieu, {
        date: isoDepuisLocal(this.conteneur.querySelector('[data-date]').value), zeros: this.conteneur.querySelector('[data-zeros]').checked,
      });
    } catch (e) { this.app.erreur(e); return; }
    this.#rendre();
  }

  #lignes() {
    const q = this.conteneur.querySelector('[data-recherche]').value.trim().toLowerCase();
    return (this.etat?.lignes ?? []).filter((l) => (!q || `${l.code} ${l.libelle} ${l.emplacements.join(' ')}`.toLowerCase().includes(q))
      && (!this.marque || (this.marquesArticle?.get(l.ele_id) ?? []).includes(this.marque)));
  }

  #rendre() {
    const e = this.etat;
    if (!e) return;
    this.conteneur.querySelector('[data-aide]').textContent = texte('stock_btp.etat.aide', { date: dateHeureLocale(e.date), methode: METHODES_VALORISATION[e.methode] ?? e.methode });
    const lignes = this.#lignes();
    const total = lignes.reduce((s, l) => s + Number(l.valeur ?? 0), 0);
    this.conteneur.querySelector('[data-corps]').innerHTML = lignes.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.article')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.colonnes.emplacements')}</th>
      <th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.colonnes.unite_court')}</th><th>${texteHtml('stock_btp.colonnes.valeur_unitaire')}</th><th>${texteHtml('stock_btp.colonnes.source')}</th><th>${texteHtml('stock_btp.colonnes.valeur')}</th><th>${texteHtml('stock_btp.colonnes.dernier_mouvement')}</th></tr></thead><tbody>
      ${lignes.map((l) => `<tr class="${Number(l.quantite) < 0 ? 'negatif' : ''}"><td><a href="${urlFiche(TYPE_FICHE.ELEMENT, l.ele_id)}" data-element="${l.ele_id}">${echapper(l.code)}</a></td>
        <td>${echapper(l.libelle)}</td><td>${echapper(l.emplacements.join(', '))}</td>
        <td class="nombre${Number(l.quantite) < 0 ? ' avertissement' : ''}">${formatNombre(l.quantite, l.precision)}</td><td>${echapper(l.unite)}</td>
        <td class="nombre">${formatNombre(l.valeur_unitaire, 4)}${l.provisoire ? ` <span title="${texteHtml('stock_btp.etat.provisoire')}">${iconeHtml('stock_btp_provisoire')}</span>` : ''}</td>
        <td class="${l.source === 'REPLI' ? 'avertissement' : ''}">${echapper(SOURCES[l.source] ?? '—')}</td>
        <td class="nombre">${formatNombre(l.valeur, 2)}</td><td>${dateHeureLocale(l.dernier_mouvement)}</td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="7">${texteHtml('stock_btp.etat.total', { articles: pluriel('stock_btp.etat.articles', lignes.length) })}</th><th class="nombre">${formatNombre(total, 2)}</th><th></th></tr></tfoot></table>`
      : `<p class="aide">${texteHtml('stock_btp.etat.aucun')}</p>`;
    this.conteneur.querySelectorAll('[data-element]').forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.app.naviguer(urlFiche(TYPE_FICHE.ELEMENT, a.dataset.element), { nouvelleFenetre: ev.ctrlKey });
    }));
  }

  #exporter() {
    const lignes = this.#lignes();
    const cel = celluleCsv;
    const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const csv = [[texte('stock_btp.colonnes.article'), texte('commun.libelle'), texte('stock_btp.colonnes.emplacements'), texte('stock_btp.colonnes.quantite'), texte('stock_btp.colonnes.unite'), texte('stock_btp.colonnes.valeur_unitaire'), texte('stock_btp.colonnes.source'), texte('stock_btp.colonnes.valeur')].map(cel).join(';'),
      ...lignes.map((l) => [cel(l.code), cel(l.libelle), cel(l.emplacements.join(', ')), num(l.quantite), cel(l.unite), num(l.valeur_unitaire), cel(SOURCES[l.source] ?? ''), num(l.valeur)].join(';'))].join('\r\n');
    telechargerCsv(`stock-${this.lieux.find((l) => l.id === this.lieu)?.code ?? this.lieu}-${(this.etat?.date ?? '').slice(0, 10)}.csv`, csv);
  }
}

/** Mouvement ouvert depuis la liste : sa pièce d'origine, sinon la fiche de l'article. */
export class PageMouvementStock extends PageBase {
  icone = icone('stock_btp_mouvement');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.mouvement');
    const m = await api.stock.mouvement(this.params.id);
    this.app.naviguer(m.ent_id ? urlDocument(m.ent_id) : urlFiche(TYPE_FICHE.ELEMENT, m.ele_id));
  }
}
