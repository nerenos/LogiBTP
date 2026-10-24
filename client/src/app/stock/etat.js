import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo } from '@logibtp/socle/ui';
import { METHODES_VALORISATION } from '@logibtp/stock';
import { api } from '../api.js';

// Module Stock, lot 1 (ANALYSE-MODULE-STOCK.md § 3.1, S4, S29, S31) : état du stock d'un dépôt (ou d'un chantier qui
// tient un stock) à une date-heure : quantité de chaque article (dernier comptage + mouvements postérieurs), valeur
// unitaire à cette date selon la méthode de la société (PMP ou dernier prix d'achat ; repli sur le PA de la
// bibliothèque signalé), valeur totale ; export CSV.

/** Date-heure locale du champ (« AAAA-MM-JJTHH:MM ») → ISO UTC, ou null. */
export const isoDepuisLocal = (v) => (v ? new Date(v).toISOString() : null);
/** Date-heure UTC à la minute renvoyée par le serveur (« AAAA-MM-JJTHH:MM ») → texte local. */
export const dateHeureLocale = (v) => (v ? new Date(`${v}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const SOURCES = { PMP: 'PMP', DERNIER_PA: 'Dernier PA', REPLI: 'PA de la bibliothèque (aucun achat)' };

export class PageStock extends PageBase {
  icone = '📦';

  async ouvrir() {
    this.titre = 'État du stock';
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    this.conteneur.innerHTML = `<div class="page-parametres page-stock"><div class="entete-page"><h1 class="page-titre">📦 État du stock</h1>
      <span data-lieu></span>
      <label>À la date <input type="datetime-local" data-date title="Vide : maintenant"></label>
      <label><input type="checkbox" data-zeros> Articles à zéro</label>
      <span data-marque></span>
      <input type="search" data-recherche placeholder="Rechercher un article…" size="24">
      <button type="button" data-csv title="Exporter le tableau (CSV)">⭳ CSV</button></div>
      <p class="aide" data-aide></p><div data-corps></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-corps]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const [lieux, marques, articles] = await Promise.all([api.stock.lieux(), api.stock.marques(), api.stock.articles()]);
    this.lieux = lieux;
    // Filtre par marque (lot 2) : marques des articles gérés en stock.
    this.marquesArticle = new Map(articles.map((a) => [a.id, a.marques]));
    const marque = creerCombo({ options: marques.filter((m) => m.actif).map((m) => ({ valeur: m.code, libelle: m.libelle, couleur: m.couleur })), valeur: '', titre: 'Toutes les marques' });
    marque.placeholder = 'Marque…';
    marque.addEventListener('change', () => { this.marque = marque.valeurCombo || null; this.#rendre(); });
    this.conteneur.querySelector('[data-marque]').append(marque);
    this.lieu = Number(p.get('lieu')) || this.lieux.find((l) => l.depot)?.id || this.lieux[0]?.id || null;
    const combo = creerCombo({ options: this.lieux.map((l) => ({ valeur: l.id, libelle: `${l.depot ? '📦' : '🏗'} ${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', vide: false });
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
    if (!this.lieu) { corps.innerHTML = '<p class="aide">Aucun dépôt : cochez « Dépôt de stock » dans la fiche d\'un chantier (affaire STOCK).</p>'; return; }
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
    this.conteneur.querySelector('[data-aide]').textContent = `Stock au ${dateHeureLocale(e.date)} : dernier inventaire et mouvements suivants. `
      + `Valorisation : ${METHODES_VALORISATION[e.methode] ?? e.methode} (paramètres du stock).`;
    const lignes = this.#lignes();
    const total = lignes.reduce((s, l) => s + Number(l.valeur ?? 0), 0);
    this.conteneur.querySelector('[data-corps]').innerHTML = lignes.length ? `<table class="tableau-compact"><thead><tr><th>Article</th><th>Libellé</th><th>Emplacements</th>
      <th>Quantité</th><th>U.</th><th>Valeur unitaire</th><th>Source</th><th>Valeur</th><th>Dernier mouvement</th></tr></thead><tbody>
      ${lignes.map((l) => `<tr class="${Number(l.quantite) < 0 ? 'negatif' : ''}"><td><a href="/fiche/element/${l.ele_id}" data-element="${l.ele_id}">${echapper(l.code)}</a></td>
        <td>${echapper(l.libelle)}</td><td>${echapper(l.emplacements.join(', '))}</td>
        <td class="nombre${Number(l.quantite) < 0 ? ' avertissement' : ''}">${formatNombre(l.quantite, l.precision)}</td><td>${echapper(l.unite)}</td>
        <td class="nombre">${l.valeur_unitaire === null ? '' : formatNombre(l.valeur_unitaire, 4)}${l.provisoire ? ' <span title="Prix de réception non encore facturé">⏳</span>' : ''}</td>
        <td class="${l.source === 'REPLI' ? 'avertissement' : ''}">${echapper(SOURCES[l.source] ?? '—')}</td>
        <td class="nombre">${l.valeur === null ? '' : formatNombre(l.valeur, 2)}</td><td>${dateHeureLocale(l.dernier_mouvement)}</td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="7">Total (${lignes.length} article${lignes.length > 1 ? 's' : ''})</th><th class="nombre">${formatNombre(total, 2)}</th><th></th></tr></tfoot></table>`
      : '<p class="aide">Aucun article en stock à cette date.</p>';
    this.conteneur.querySelectorAll('[data-element]').forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.app.naviguer(`/fiche/element/${a.dataset.element}`, { nouvelleFenetre: ev.ctrlKey });
    }));
  }

  #exporter() {
    const lignes = this.#lignes();
    const cel = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const csv = [['Article', 'Libellé', 'Emplacements', 'Quantité', 'Unité', 'Valeur unitaire', 'Source', 'Valeur'].map(cel).join(';'),
      ...lignes.map((l) => [cel(l.code), cel(l.libelle), cel(l.emplacements.join(', ')), num(l.quantite), cel(l.unite), num(l.valeur_unitaire), cel(SOURCES[l.source] ?? ''), num(l.valeur)].join(';'))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `stock-${this.lieux.find((l) => l.id === this.lieu)?.code ?? this.lieu}-${(this.etat?.date ?? '').slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

/** Mouvement ouvert depuis la liste : sa pièce d'origine, sinon la fiche de l'article. */
export class PageMouvementStock extends PageBase {
  icone = '🔁';

  async ouvrir() {
    this.titre = 'Mouvement de stock';
    const m = await api.stock.mouvement(this.params.id);
    this.app.naviguer(m.ent_id ? `/document/${m.ent_id}` : `/fiche/element/${m.ele_id}`);
  }
}
