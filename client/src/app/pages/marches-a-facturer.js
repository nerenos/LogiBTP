import { urlFiche, urlDocument, TYPE_FICHE, TYPE_DOCUMENT } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, saisir, confirmer } from '@logibtp/socle/ui';
import { Dz, aujourdhui } from '@logibtp/socle';
import { api } from '../api.js';

/** Mois courant au format AAAA-MM. */
const moisCourant = () => aujourdhui().slice(0, 7);

/** Libellé d'un mois AAAA-MM (« octobre 2026 »). */
const libelleMois = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

const NOMS = { [TYPE_DOCUMENT.V_SITUATION]: 'Situation', [TYPE_DOCUMENT.V_FACTURE_AVT]: "Facture d'avancement" };

const date = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR') : '');

/**
 * Marchés à facturer pour un mois civil (CONCEPTION-ACHATS-MARCHES.md 13.9, lot E) : `/marches/a-facturer?mois=AAAA-MM`.
 * Marchés de vente en cours non soldés sans pièce d'avancement validée dans le mois ; pour chacun : créer la pièce d'un
 * clic (situation, ou facture d'avancement si c'est la dernière pièce du marché ; datée d'aujourd'hui ou du dernier jour
 * d'un mois passé), ouvrir le brouillon en cours, ou indiquer « pas d'avancement » (aucune pièce, aucun numéro de
 * situation consommé ; mémorisé par marché et par mois, masqué sauf « Afficher aussi… »). Création groupée des cochés.
 */
export class PageMarchesAFacturer extends PageBase {
  icone = '🧾';
  titre = 'Marchés à facturer';

  async ouvrir() {
    this.mois = /^\d{4}-\d{2}$/.test(this.requete.mois ?? '') ? this.requete.mois : moisCourant();
    this.conteneur.innerHTML = `<div class="page-parametres page-marches-a-facturer">
      <div class="entete-page"><h1 class="page-titre">🧾 Marchés à facturer</h1>
        <label>Mois <input type="month" data-mois value="${this.mois}" max="${moisCourant()}"></label>
        <label class="fiche-option"><input type="checkbox" data-sans> Afficher aussi les marchés sans avancement</label>
        <button type="button" class="principal" data-creer-coches disabled>📈 Créer les pièces cochées</button></div>
      <p class="aide">Marchés de vente en cours, non soldés, sans situation ni facture d'avancement validée dans le mois. « Pas d'avancement » écarte le marché pour ce mois sans créer de pièce ni consommer de numéro de situation.</p>
      <div data-corps></div></div>`;
    const q = (s) => this.conteneur.querySelector(s);
    q('[data-mois]').addEventListener('change', (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { this.mois = e.target.value; this.charger(); } });
    q('[data-sans]').addEventListener('change', (e) => { this.voirSans = e.target.checked; this.rendre(); });
    q('[data-creer-coches]').addEventListener('click', () => this.creerCoches());
    await this.charger();
  }

  urlCourante() { return `/marches/a-facturer?mois=${this.mois}`; }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    try {
      this.marches = await api.marchesAFacturer(this.mois);
    } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    this.coches = new Set();
    this.rendre();
  }

  rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    const visibles = (this.marches ?? []).filter((m) => this.voirSans || !m.sans_avancement);
    const masques = (this.marches ?? []).length - visibles.length;
    this.#majBouton();
    if (!visibles.length) {
      corps.innerHTML = `<p class="aide">Aucun marché à facturer en ${echapper(libelleMois(this.mois))}${masques ? ` (${masques} sans avancement masqué${masques > 1 ? 's' : ''})` : ''}.</p>`;
      return;
    }
    const m2 = (v) => (v === null || v === undefined ? '' : formatNombre(v, 2));
    corps.innerHTML = `<table class="tableau-compact"><thead><tr><th><input type="checkbox" data-tout title="Tout cocher"></th>
        <th>Chantier</th><th>Marché</th><th>Client</th><th class="nombre">Montant HT</th><th class="nombre">Facturé HT</th><th class="nombre">Reste HT</th>
        <th>Dernière pièce</th><th>État du mois</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${visibles.map((m) => {
        const reste = m.montant_ht === null ? null : Dz(m.montant_ht).minus(Dz(m.facture_ht)).toString();
        const d = m.derniere;
        const cochable = !m.brouillon && !m.sans_avancement;
        const etat = m.sans_avancement
          ? `<span title="${echapper(`${m.sans_avancement.par}${m.sans_avancement.commentaire ? ` : ${m.sans_avancement.commentaire}` : ''}`)}">∅ Pas d'avancement</span>`
          : m.brouillon ? `<a href="${urlDocument(m.brouillon.ent_id)}" data-ouvrir="${m.brouillon.ent_id}">✎ ${echapper(NOMS[m.brouillon.type] ?? 'Pièce')} en cours ${echapper(m.brouillon.numero ?? '')}</a>`
          : 'À facturer';
        return `<tr data-mar="${m.mar_id}">
          <td>${cochable ? `<input type="checkbox" data-coche="${m.mar_id}" ${this.coches.has(m.mar_id) ? 'checked' : ''}>` : ''}</td>
          <td title="${echapper(m.chantier_libelle ?? '')}">${echapper(m.chantier ?? '')}</td>
          <td><a href="${urlFiche(TYPE_FICHE.MARCHE, m.mar_id)}">${echapper(m.code)}</a> ${echapper(m.libelle ?? '')}</td>
          <td>${echapper(m.client ?? '')}</td>
          <td class="nombre">${m2(m.montant_ht)}</td><td class="nombre">${m2(m.facture_ht)}</td><td class="nombre">${m2(reste)}</td>
          <td>${d ? `<a href="${urlDocument(d.ent_id)}">${echapper(d.numero ?? '')}</a> ${d.rang ? `n° ${d.rang} ` : ''}du ${date(d.date)}` : '<span class="aide">aucune</span>'}</td>
          <td>${etat}</td>
          <td class="cellule-boutons">${m.sans_avancement
            ? `<button type="button" data-retablir="${m.mar_id}" title="Retirer « pas d'avancement » pour ce mois">↺</button>`
            : `${m.brouillon ? '' : `<button type="button" data-creer="${m.mar_id}" title="Créer : ${echapper(NOMS[m.type] ?? 'pièce')} du marché, datée du mois">📈</button>`}
               <button type="button" data-sans-avancement="${m.mar_id}" title="Pas d'avancement ce mois-ci">∅</button>`}</td></tr>`;
      }).join('')}</tbody></table>
      ${masques ? `<p class="aide">${masques} marché${masques > 1 ? 's' : ''} sans avancement masqué${masques > 1 ? 's' : ''}.</p>` : ''}`;
    const parId = (id) => this.marches.find((m) => m.mar_id === Number(id));
    corps.querySelector('[data-tout]')?.addEventListener('change', (e) => {
      for (const c of corps.querySelectorAll('[data-coche]')) { c.checked = e.target.checked; this.#cocher(Number(c.dataset.coche), c.checked); }
    });
    corps.querySelectorAll('[data-coche]').forEach((c) => c.addEventListener('change', () => this.#cocher(Number(c.dataset.coche), c.checked)));
    corps.querySelectorAll('[data-creer]').forEach((b) => b.addEventListener('click', (e) => this.creer([parId(b.dataset.creer)], e)));
    corps.querySelectorAll('[data-sans-avancement]').forEach((b) => b.addEventListener('click', () => this.sansAvancement(parId(b.dataset.sansAvancement), true)));
    corps.querySelectorAll('[data-retablir]').forEach((b) => b.addEventListener('click', () => this.sansAvancement(parId(b.dataset.retablir), false)));
    corps.querySelectorAll('[data-ouvrir]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.app.naviguer(urlDocument(Number(a.dataset.ouvrir)), { nouvelleFenetre: e.ctrlKey || e.metaKey || e.shiftKey });
    }));
  }

  #cocher(id, oui) { if (oui) this.coches.add(id); else this.coches.delete(id); this.#majBouton(); }

  #majBouton() {
    const b = this.conteneur.querySelector('[data-creer-coches]');
    b.disabled = !this.coches?.size;
    b.textContent = this.coches?.size ? `📈 Créer les pièces cochées (${this.coches.size})` : '📈 Créer les pièces cochées';
  }

  async creerCoches() {
    const marches = this.marches.filter((m) => this.coches.has(m.mar_id));
    if (!marches.length) return;
    if (!await confirmer(`Créer ${marches.length} pièce${marches.length > 1 ? 's' : ''} d'avancement pour ${libelleMois(this.mois)} ? Elles restent en brouillon à compléter.`)) return;
    await this.creer(marches);
  }

  /** Crée la pièce d'avancement de chaque marché (brouillon) ; une seule : elle s'ouvre. */
  async creer(marches, e) {
    const crees = [];
    const erreurs = [];
    for (const m of marches) {
      try {
        const r = await api.documentMarche(m.mar_id, m.type, this.mois);
        crees.push(r.document);
      } catch (x) { erreurs.push(`${m.code} : ${x.message}`); }
    }
    if (erreurs.length) this.app.message(`Pièces non créées : ${erreurs.join(' ; ')}`, 'erreur');
    if (crees.length === 1 && marches.length === 1) {
      this.app.naviguer(urlDocument(crees[0].ent_id), { nouvelleFenetre: Boolean(e?.ctrlKey || e?.shiftKey) });
      return;
    }
    if (crees.length) this.app.message(`${crees.length} pièce${crees.length > 1 ? 's' : ''} créée${crees.length > 1 ? 's' : ''} en brouillon`, 'succes');
    await this.charger();
  }

  async sansAvancement(m, sans) {
    let commentaire = null;
    if (sans) {
      commentaire = await saisir(`Pas d'avancement en ${libelleMois(this.mois)} pour le marché ${m.code} : commentaire facultatif`, '', { titre: "Pas d'avancement" });
      if (commentaire === null) return;
    }
    try {
      await api.sansAvancementMarche(m.mar_id, { mois: `${this.mois}-01`, sans, commentaire });
    } catch (x) { this.app.message(x.message, 'erreur'); return; }
    await this.charger();
  }
}
