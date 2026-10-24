import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { METHODES_VALORISATION } from '@logibtp/stock';
import { api } from '../api.js';

// Module Stock, lot 1 (ANALYSE-MODULE-STOCK.md S29, § 5.2) : méthode de valorisation de la société (PMP ou dernier
// prix d'achat, globale), emplacements de chaque dépôt (zone › allée › rack › étagère › case : code complet unique dans
// le dépôt, parent par son code) ; revalorisation complète. Droit : administrateur ou membre du service logistique.

const NIVEAUX = { ZONE: 'Zone', ALLEE: 'Allée', RACK: 'Rack', ETAGERE: 'Étagère', CASE: 'Case', AUTRE: 'Autre' };

export class PageParametresStock extends PageBase {
  icone = '📦';
  #modifie = false;

  get modifiee() { return this.#modifie; }

  async ouvrir() {
    this.titre = 'Paramètres du stock';
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">📦 Paramètres du stock</h1></div>
      <h2>Valorisation</h2><p class="ligne"><label>Méthode de la société <span data-methode></span></label>
        <button type="button" data-revaloriser title="Recalcule le PMP et le dernier prix d'achat de tous les articles">⟳ Tout revaloriser</button></p>
      <p class="aide">Le prix est recherché à la date demandée parmi les achats (date de réception, prix de la facture dès qu'elle est validée ;
        avant elle, prix provisoire de la réception). Sans achat : PA de la bibliothèque, signalé. Le PMP se corrige dans l'onglet Stock de l'article.</p>
      <h2>Emplacements</h2><p class="ligne"><label>Dépôt <span data-lieu></span></label></p>
      <p class="aide">Code complet unique dans le dépôt (ex. A, A-01, A-01-2) ; le parent se désigne par son code. Un dépôt est un chantier
        coché « Dépôt de stock » (affaire STOCK).</p><div data-emplacements></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-emplacements]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const [p, lieux] = await Promise.all([api.stock.parametres(), api.stock.lieux()]);
    const methode = creerCombo({ options: Object.entries(METHODES_VALORISATION).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: p.methode, vide: false });
    methode.addEventListener('change', async () => {
      try { await api.stock.enregistrerParametres({ methode: methode.valeurCombo }); this.app.message?.('Méthode enregistrée'); } catch (e) { this.app.erreur(e); }
    });
    this.conteneur.querySelector('[data-methode]').append(methode);
    this.conteneur.querySelector('[data-revaloriser]').addEventListener('click', async () => {
      try { const r = await api.stock.revaloriser(); this.app.message?.(`${r.articles} article(s) revalorisé(s)`); } catch (e) { this.app.erreur(e); }
    });
    const depots = lieux.filter((l) => l.depot);
    this.lieu = Number(new URLSearchParams(globalThis.location?.search ?? '').get('lieu')) || depots[0]?.id || null;
    const combo = creerCombo({ options: depots.map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', vide: false });
    combo.addEventListener('change', () => { this.lieu = Number(combo.valeurCombo); this.#charger(); });
    this.conteneur.querySelector('[data-lieu]').append(combo);
    await this.#charger();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-emplacements]');
    if (!this.lieu) { zone.innerHTML = '<p class="aide">Aucun dépôt.</p>'; return; }
    this.emplacements = await api.stock.emplacements(this.lieu);
    this.#modifie = false;
    this.#rendre();
  }

  #rendre() {
    const l = this.emplacements;
    const zone = this.conteneur.querySelector('[data-emplacements]');
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>Code</th><th>Libellé</th><th>Niveau</th><th>Parent</th><th>Actif</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${l.map((e, i) => `<tr data-i="${i}"><td><input data-c="code" size="12" value="${echapper(e.code)}"></td><td><input data-c="libelle" size="28" value="${echapper(e.libelle ?? '')}"></td>
        <td data-niveau></td><td data-parent></td><td><input type="checkbox" data-c="actif" ${e.actif ? 'checked' : ''}></td>
        <td class="cellule-boutons"><button type="button" data-retirer title="Retirer">✕</button></td></tr>`).join('')}</tbody></table>
      <p class="ligne"><button type="button" data-ajouter>＋ Emplacement</button> <button type="button" class="principal" data-enregistrer>Enregistrer</button></p>`;
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
        this.app.message?.('Emplacements enregistrés');
      } catch (x) { this.app.erreur(x); }
    });
  }
}
