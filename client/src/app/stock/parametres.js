import { texte, texteHtml, textesParCode, pluriel, icone, iconeHtml, couleurTheme } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { METHODES_VALORISATION } from '@logibtp/stock';
import { api } from '../api.js';

// Module Stock, lot 1 (ANALYSE-MODULE-STOCK.md S29, § 5.2) : méthode de valorisation de la société (PMP ou dernier
// prix d'achat, globale), emplacements de chaque dépôt (zone › allée › rack › étagère › case : code complet unique dans
// le dépôt, parent par son code) ; revalorisation complète ; lot 2 : marques des articles (listes rapides des
// inventaires, du magasin et de la borne : code, libellé, couleur ; une marque retirée encore portée est désactivée). Droit : administrateur ou membre du service logistique.

const NIVEAUX = textesParCode('stock_btp.niveaux', ['ZONE', 'ALLEE', 'RACK', 'ETAGERE', 'CASE', 'AUTRE']);

export class PageParametresStock extends PageBase {
  icone = icone('stock_btp_stock');
  #modifie = false;

  get modifiee() { return this.#modifie; }

  async ouvrir() {
    this.titre = texte('stock_btp.routes.parametres');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_stock')} ${texteHtml('stock_btp.routes.parametres')}</h1></div>
      <h2>${texteHtml('stock_btp.parametres.valorisation')}</h2><p class="ligne"><label>${texteHtml('stock_btp.parametres.methode')} <span data-methode></span></label>
        <button type="button" data-revaloriser title="${texteHtml('stock_btp.parametres.revaloriser_titre')}">${iconeHtml('stock_btp_actualiser')} ${texteHtml('stock_btp.parametres.revaloriser')}</button></p>
      <p class="aide">${texteHtml('stock_btp.parametres.aide_valorisation')}</p>
      <h2>${texteHtml('stock_btp.parametres.marques')}</h2><p class="aide">${texteHtml('stock_btp.parametres.aide_marques', { icone: icone('stock_btp_marque') })}</p><div data-marques></div>
      <h2>${texteHtml('stock_btp.parametres.emplacements')}</h2><p class="ligne"><label>${texteHtml('stock_btp.parametres.depot')} <span data-lieu></span></label></p>
      <p class="aide">${texteHtml('stock_btp.parametres.aide_emplacements')}</p><div data-emplacements></div></div>`;
    const [p, lieux] = await Promise.all([api.stock.parametres(), api.stock.lieux()]);
    const methode = creerCombo({ options: Object.entries(METHODES_VALORISATION).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: p.methode, vide: false });
    methode.addEventListener('change', async () => {
      try { await api.stock.enregistrerParametres({ methode: methode.valeurCombo }); this.app.message?.(texte('stock_btp.parametres.methode_enregistree')); } catch (e) { this.app.erreur(e); }
    });
    this.conteneur.querySelector('[data-methode]').append(methode);
    this.conteneur.querySelector('[data-revaloriser]').addEventListener('click', async () => {
      try { const r = await api.stock.revaloriser(); this.app.message?.(pluriel('stock_btp.parametres.revalorises', r.articles)); } catch (e) { this.app.erreur(e); }
    });
    this.marques = await api.stock.marques();
    this.#rendreMarques();
    const depots = lieux.filter((l) => l.depot);
    this.lieu = Number(new URLSearchParams(globalThis.location?.search ?? '').get('lieu')) || depots[0]?.id || null;
    const combo = creerCombo({ options: depots.map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', vide: false });
    combo.addEventListener('change', () => { this.lieu = Number(combo.valeurCombo); this.#charger(); });
    this.conteneur.querySelector('[data-lieu]').append(combo);
    await this.#charger();
  }

  #rendreMarques() {
    const l = this.marques;
    const zone = this.conteneur.querySelector('[data-marques]');
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.parametres.couleur')}</th><th>${texteHtml('stock_btp.parametres.active')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${l.map((m, i) => `<tr data-i="${i}"><td><input data-c="code" size="12" value="${echapper(m.code)}" ${m._existe ? 'readonly' : ''}></td>
        <td><input data-c="libelle" size="32" value="${echapper(m.libelle)}"></td><td><input type="color" data-c="couleur" value="${echapper(m.couleur ?? couleurTheme('--stock-marque-defaut', '#98a2b3'))}"></td>
        <td><input type="checkbox" data-c="actif" ${m.actif ? 'checked' : ''}></td><td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}
      </tbody></table><p class="ligne"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('stock_btp.parametres.marque')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('stock_btp.parametres.enregistrer_marques')}</button></p>`;
    l.forEach((m) => { m._existe ??= Boolean(m.code); });
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const m = l[Number(tr.dataset.i)];
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        m[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.dataset.c === 'code' ? x.value.trim().toUpperCase() : x.value;
        this.#modifie = true;
      }));
      tr.querySelector('[data-retirer]').addEventListener('click', () => { l.splice(l.indexOf(m), 1); this.#modifie = true; this.#rendreMarques(); });
    });
    zone.querySelector('[data-ajouter]').addEventListener('click', () => { l.push({ code: '', libelle: '', couleur: null, ordre: l.length, actif: true, _existe: false }); this.#rendreMarques(); });
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.marques = await api.stock.enregistrerMarques(l.map(({ _existe, ...m }, i) => ({ ...m, ordre: i })));
        this.#modifie = false;
        this.#rendreMarques();
        this.app.message?.(texte('stock_btp.parametres.marques_enregistrees'));
      } catch (e) { this.app.erreur(e); }
    });
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-emplacements]');
    if (!this.lieu) { zone.innerHTML = `<p class="aide">${texteHtml('stock_btp.parametres.aucun_depot')}</p>`; return; }
    this.emplacements = await api.stock.emplacements(this.lieu);
    this.#modifie = false;
    this.#rendre();
  }

  #rendre() {
    const l = this.emplacements;
    const zone = this.conteneur.querySelector('[data-emplacements]');
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.parametres.niveau')}</th><th>${texteHtml('stock_btp.parametres.parent')}</th><th>${texteHtml('stock_btp.parametres.actif')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${l.map((e, i) => `<tr data-i="${i}"><td><input data-c="code" size="12" value="${echapper(e.code)}"></td><td><input data-c="libelle" size="28" value="${echapper(e.libelle ?? '')}"></td>
        <td data-niveau></td><td data-parent></td><td><input type="checkbox" data-c="actif" ${e.actif ? 'checked' : ''}></td>
        <td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>
      <p class="ligne"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('stock_btp.parametres.emplacement')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button></p>`;
    const changer = () => { this.#modifie = true; };
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const e = l[Number(tr.dataset.i)];
      const niveau = creerCombo({ options: Object.entries(NIVEAUX).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: e.niveau, vide: false });
      niveau.addEventListener('change', () => { e.niveau = niveau.valeurCombo; changer(); });
      tr.querySelector('[data-niveau]').append(niveau);
      const parent = creerCombo({ options: l.filter((x) => x !== e && x.code).map((x) => ({ valeur: x.code, libelle: `${x.code}${x.libelle ? ` – ${x.libelle}` : ''}` })), valeur: e.parent ?? '' });
      parent.addEventListener('change', () => { e.parent = parent.valeurCombo || null; changer(); });
      tr.querySelector('[data-parent]').append(parent);
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        e[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.dataset.c === 'code' ? x.value.trim().toUpperCase() : x.value;
        changer();
        if (x.dataset.c === 'code') this.#rendre();
      }));
      tr.querySelector('[data-retirer]').addEventListener('click', () => { l.splice(l.indexOf(e), 1); changer(); this.#rendre(); });
    });
    zone.querySelector('[data-ajouter]').addEventListener('click', () => {
      const dernier = l.at(-1);
      l.push({ id: null, code: '', libelle: '', niveau: dernier?.niveau ?? 'ZONE', parent: dernier?.parent ?? null, ordre: l.length, actif: true });
      changer();
      this.#rendre();
      zone.querySelector('tr:last-child [data-c="code"]')?.focus();
    });
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.emplacements = await api.stock.enregistrerEmplacements(this.lieu, l.map((e, i) => ({ ...e, ordre: i })));
        this.#modifie = false;
        this.#rendre();
        this.app.message?.(texte('stock_btp.parametres.emplacements_enregistres'));
      } catch (x) { this.app.erreur(x); }
    });
  }
}
