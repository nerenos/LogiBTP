import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, confirmer } from '@logibtp/socle/ui';
import { urlDocument } from '../codes.js';
import { api } from '../api.js';
import { isoDepuisLocal, dateHeureLocale } from './etat.js';

// Module Stock, lot 10 du plan Stock (plans/stock.md ; ANALYSE-MODULE-STOCK.md Q9) : clôture du stock à une date de fin d'exercice.
// Aperçu (valeur de chaque nature d'article au départ et à la fin, variation), création de la clôture (pièce d'opération diverse
// exportée avec la comptabilité), liste et annulation tant que la pièce n'est pas transférée. Administrateur (paramétrage).

export class PageClotures extends PageBase {
  icone = icone('stock_btp_cloture');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.clotures');
    this.conteneur.innerHTML = `<div class="page-parametres page-clotures"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_cloture')} ${texteHtml('stock_btp.routes.clotures')}</h1></div>
      <p class="aide">${texteHtml('stock_btp.clotures.aide')}</p>
      <p class="ligne"><label>${texteHtml('stock_btp.clotures.date')} <input type="datetime-local" data-date></label>
        <label>${texteHtml('stock_btp.clotures.debut')} <input type="datetime-local" data-debut title="${texteHtml('stock_btp.clotures.debut_titre')}"></label>
        <input data-libelle size="34" placeholder="${texteHtml('stock_btp.clotures.libelle')}">
        <button type="button" data-apercu>${iconeHtml('stock_btp_valorise')} ${texteHtml('stock_btp.clotures.apercu')}</button>
        <button type="button" data-cloturer disabled>${iconeHtml('stock_btp_cloture')} ${texteHtml('stock_btp.clotures.cloturer')}</button></p>
      <div data-apercu-zone></div><h2>${texteHtml('stock_btp.clotures.liste')}</h2><div data-liste></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    $('[data-apercu]').addEventListener('click', () => this.#apercu());
    $('[data-cloturer]').addEventListener('click', () => this.#cloturer());
    for (const c of ['[data-date]', '[data-debut]']) $(c).addEventListener('change', () => { $('[data-cloturer]').disabled = true; });
    await this.#liste();
  }

  #parametres() {
    const $ = (s) => this.conteneur.querySelector(s);
    return { date: isoDepuisLocal($('[data-date]').value), debut: isoDepuisLocal($('[data-debut]').value) };
  }

  async #apercu() {
    const p = this.#parametres();
    if (!p.date) { this.app.message(texte('stock_btp.clotures.date_obligatoire'), 'avertissement'); return; }
    try {
      const a = await api.stock.apercuCloture(p);
      const variation = (n) => Number(n.final) - Number(n.initial);
      this.conteneur.querySelector('[data-apercu-zone]').innerHTML = `<p class="aide">${texteHtml('stock_btp.clotures.apercu_aide', { debut: a.debut ? dateHeureLocale(a.debut) : texte('stock_btp.clotures.aucun_debut'), date: dateHeureLocale(a.date) })}</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('stock_btp.clotures.nature')}</th><th>${texteHtml('stock_btp.clotures.initial')}</th><th>${texteHtml('stock_btp.clotures.final')}</th><th>${texteHtml('stock_btp.clotures.variation')}</th><th>${texteHtml('stock_btp.clotures.provision_initiale')}</th><th>${texteHtml('stock_btp.clotures.provision_finale')}</th></tr></thead><tbody>
        ${a.natures.map((n) => `<tr><td>${echapper(n.libelle)}</td><td class="nombre">${formatNombre(n.initial, 2)}</td><td class="nombre">${formatNombre(n.final, 2)}</td><td class="nombre">${formatNombre(variation(n), 2)}</td><td class="nombre">${formatNombre(n.provision_initiale, 2)}</td><td class="nombre">${formatNombre(n.provision_finale, 2)}</td></tr>`).join('')}
        </tbody><tfoot><tr><th>${texteHtml('stock_btp.clotures.total')}</th><th class="nombre">${formatNombre(a.valeur_initiale, 2)}</th><th class="nombre">${formatNombre(a.valeur_finale, 2)}</th><th class="nombre">${formatNombre(Number(a.valeur_finale) - Number(a.valeur_initiale), 2)}</th><th class="nombre">${formatNombre(a.provision_initiale, 2)}</th><th class="nombre">${formatNombre(a.provision_finale, 2)}</th></tr></tfoot></table>
        ${a.avertissements.map((x) => `<p class="avertissement">${iconeHtml('avertissement')} ${echapper(x)}</p>`).join('')}`;
      this.conteneur.querySelector('[data-cloturer]').disabled = a.natures.every((n) => Number(n.initial) === Number(n.final) && Number(n.provision_initiale) === Number(n.provision_finale));
    } catch (e) { this.app.erreur(e); }
  }

  async #cloturer() {
    const p = this.#parametres();
    if (!await confirmer(texte('stock_btp.clotures.confirmer', { date: dateHeureLocale(p.date.slice(0, 16)) }))) return;
    try {
      await api.stock.cloturer({ ...p, libelle: this.conteneur.querySelector('[data-libelle]').value.trim() || null });
      this.app.message(texte('stock_btp.clotures.cloturee'));
      this.conteneur.querySelector('[data-cloturer]').disabled = true;
      await this.#liste();
    } catch (e) { this.app.erreur(e); }
  }

  async #liste() {
    const zone = this.conteneur.querySelector('[data-liste]');
    let l;
    try { l = await api.stock.clotures(); } catch (e) { this.app.erreur(e); return; }
    zone.innerHTML = l.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.clotures.date')}</th><th>${texteHtml('stock_btp.clotures.libelle_colonne')}</th><th>${texteHtml('stock_btp.clotures.initial')}</th>
      <th>${texteHtml('stock_btp.clotures.final')}</th><th>${texteHtml('stock_btp.clotures.piece')}</th><th>${texteHtml('stock_btp.clotures.etat')}</th><th></th></tr></thead><tbody>
      ${l.map((c) => `<tr class="${c.etat === 'ANNULEE' ? 'aide' : ''}"><td>${dateHeureLocale(c.date)}</td><td>${echapper(c.libelle)}</td><td class="nombre">${formatNombre(c.valeur_initiale, 2)}</td><td class="nombre">${formatNombre(c.valeur_finale, 2)}</td>
        <td>${c.piece ? `<a href="${urlDocument(c.piece)}" data-url>${echapper(c.numero ?? String(c.piece))}</a>` : ''}</td>
        <td>${texteHtml(`stock_btp.clotures.etats.${c.etat}`)}${c.etat_compta === 'T' ? ` · ${texteHtml('stock_btp.clotures.transferee')}` : ''}</td>
        <td>${c.etat === 'ACTIVE' && c.etat_compta !== 'T' ? `<button type="button" data-annuler="${c.id}">${texteHtml('stock_btp.clotures.annuler')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table>` : `<p class="aide">${texteHtml('stock_btp.clotures.aucune')}</p>`;
    zone.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmer(texte('stock_btp.clotures.annuler_confirmer'))) return;
      try { await api.stock.annulerCloture(b.dataset.annuler); this.app.message(texte('stock_btp.clotures.annulee')); await this.#liste(); } catch (e) { this.app.erreur(e); }
    }));
  }
}
