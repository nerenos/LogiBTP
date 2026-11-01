import { texte, texteHtml, pluriel, icone, iconeHtml, textesParCode, langue } from '@logibtp/socle/dictionnaire';
import { urlFiche, urlDocument, TYPE_FICHE, TYPE_DOCUMENT } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, saisir, confirmer } from '@logibtp/socle/ui';
import { Dz, aujourdhui } from '@logibtp/socle';
import { api } from '../api.js';

/** Mois courant au format AAAA-MM. */
const moisCourant = () => aujourdhui().slice(0, 7);

/** Libellé d'un mois AAAA-MM (« octobre 2026 »). */
const libelleMois = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString(langue(), { month: 'long', year: 'numeric' });

const NOMS = textesParCode('structure_btp.a_facturer.noms', [TYPE_DOCUMENT.V_SITUATION, TYPE_DOCUMENT.V_FACTURE_AVT]);

const date = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(langue()) : '');

/**
 * Marchés à facturer pour un mois civil (CONCEPTION-ACHATS-MARCHES.md 13.9, lot E) : `/marches/a-facturer?mois=AAAA-MM`.
 * Marchés de vente en cours non soldés sans pièce d'avancement validée dans le mois ; pour chacun : créer la pièce d'un
 * clic (situation, ou facture d'avancement si c'est la dernière pièce du marché ; datée d'aujourd'hui ou du dernier jour
 * d'un mois passé), ouvrir le brouillon en cours, ou indiquer « pas d'avancement » (aucune pièce, aucun numéro de
 * situation consommé ; mémorisé par marché et par mois, masqué sauf « Afficher aussi… »). Création groupée des cochés.
 */
export class PageMarchesAFacturer extends PageBase {
  icone = icone('structure_btp_a_facturer');
  titre = texte('structure_btp.routes.marches_a_facturer');

  async ouvrir() {
    this.mois = /^\d{4}-\d{2}$/.test(this.requete.mois ?? '') ? this.requete.mois : moisCourant();
    this.conteneur.innerHTML = `<div class="page-parametres page-marches-a-facturer">
      <div class="entete-page"><h1 class="page-titre">${iconeHtml('structure_btp_a_facturer')} ${texteHtml('structure_btp.routes.marches_a_facturer')}</h1>
        <label>${texteHtml('structure_btp.a_facturer.mois')} <input type="month" data-mois value="${this.mois}" max="${moisCourant()}"></label>
        <label class="fiche-option"><input type="checkbox" data-sans> ${texteHtml('structure_btp.a_facturer.voir_sans')}</label>
        <button type="button" class="principal" data-creer-coches disabled>${iconeHtml('structure_btp_creer_avancement')} ${texteHtml('structure_btp.a_facturer.creer_coches')}</button></div>
      <p class="aide">${texteHtml('structure_btp.a_facturer.aide')}</p>
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
      corps.innerHTML = `<p class="aide">${texteHtml('structure_btp.a_facturer.aucun', { mois: libelleMois(this.mois), masques: masques ? ` (${pluriel('structure_btp.a_facturer.masques_court', masques)})` : '' })}</p>`;
      return;
    }
    const m2 = (v) => (v === null || v === undefined ? '' : formatNombre(v, 2));
    corps.innerHTML = `<table class="tableau-compact"><thead><tr><th><input type="checkbox" data-tout title="${texteHtml('structure_btp.a_facturer.tout')}"></th>
        <th>${texteHtml('structure_btp.a_facturer.col.chantier')}</th><th>${texteHtml('structure_btp.a_facturer.col.marche')}</th><th>${texteHtml('structure_btp.a_facturer.col.client')}</th><th class="nombre">${texteHtml('structure_btp.a_facturer.col.montant')}</th><th class="nombre">${texteHtml('structure_btp.a_facturer.col.facture')}</th><th class="nombre">${texteHtml('structure_btp.a_facturer.col.reste')}</th>
        <th>${texteHtml('structure_btp.a_facturer.col.derniere')}</th><th>${texteHtml('structure_btp.a_facturer.col.etat')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${visibles.map((m) => {
        const reste = m.montant_ht === null ? null : Dz(m.montant_ht).minus(Dz(m.facture_ht)).toString();
        const d = m.derniere;
        const cochable = !m.brouillon && !m.sans_avancement;
        const etat = m.sans_avancement
          ? `<span title="${echapper(`${m.sans_avancement.par}${m.sans_avancement.commentaire ? ` : ${m.sans_avancement.commentaire}` : ''}`)}">${iconeHtml('structure_btp_sans_avancement')} ${texteHtml('structure_btp.a_facturer.pas_avancement')}</span>`
          : m.brouillon ? `<a href="${urlDocument(m.brouillon.ent_id)}" data-ouvrir="${m.brouillon.ent_id}">${iconeHtml('structure_btp_en_cours')} ${texteHtml('structure_btp.a_facturer.en_cours', { piece: NOMS[m.brouillon.type] ?? texte('structure_btp.a_facturer.piece'), numero: m.brouillon.numero ?? '' })}</a>`
          : texteHtml('structure_btp.a_facturer.a_facturer');
        return `<tr data-mar="${m.mar_id}">
          <td>${cochable ? `<input type="checkbox" data-coche="${m.mar_id}" ${this.coches.has(m.mar_id) ? 'checked' : ''}>` : ''}</td>
          <td title="${echapper(m.chantier_libelle ?? '')}">${echapper(m.chantier ?? '')}</td>
          <td><a href="${urlFiche(TYPE_FICHE.MARCHE, m.mar_id)}">${echapper(m.code)}</a> ${echapper(m.libelle ?? '')}</td>
          <td>${echapper(m.client ?? '')}</td>
          <td class="nombre">${m2(m.montant_ht)}</td><td class="nombre">${m2(m.facture_ht)}</td><td class="nombre">${m2(reste)}</td>
          <td>${d ? `<a href="${urlDocument(d.ent_id)}">${echapper(d.numero ?? '')}</a> ${d.rang ? `${texteHtml('structure_btp.a_facturer.rang', { rang: d.rang })} ` : ''}${texteHtml('structure_btp.a_facturer.du', { date: date(d.date) })}` : `<span class="aide">${texteHtml('structure_btp.a_facturer.aucune')}</span>`}</td>
          <td>${etat}</td>
          <td class="cellule-boutons">${m.sans_avancement
            ? `<button type="button" data-retablir="${m.mar_id}" title="${texteHtml('structure_btp.a_facturer.retablir')}">${iconeHtml('structure_btp_retablir')}</button>`
            : `${m.brouillon ? '' : `<button type="button" data-creer="${m.mar_id}" title="${texteHtml('structure_btp.a_facturer.creer', { piece: NOMS[m.type] ?? texte('structure_btp.a_facturer.piece_min') })}">${iconeHtml('structure_btp_creer_avancement')}</button>`}
               <button type="button" data-sans-avancement="${m.mar_id}" title="${texteHtml('structure_btp.a_facturer.sans_titre')}">${iconeHtml('structure_btp_sans_avancement')}</button>`}</td></tr>`;
      }).join('')}</tbody></table>
      ${masques ? `<p class="aide">${pluriel('structure_btp.a_facturer.masques', masques)}</p>` : ''}`;
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
    b.textContent = `${icone('structure_btp_creer_avancement')} ${this.coches?.size ? texte('structure_btp.a_facturer.creer_coches_n', { nombre: this.coches.size }) : texte('structure_btp.a_facturer.creer_coches')}`;
  }

  async creerCoches() {
    const marches = this.marches.filter((m) => this.coches.has(m.mar_id));
    if (!marches.length) return;
    if (!await confirmer(pluriel('structure_btp.a_facturer.confirmer', marches.length, { mois: libelleMois(this.mois) }))) return;
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
    if (erreurs.length) this.app.message(texte('structure_btp.a_facturer.non_creees', { erreurs: erreurs.join(' ; ') }), 'erreur');
    if (crees.length === 1 && marches.length === 1) {
      this.app.naviguer(urlDocument(crees[0].ent_id), { nouvelleFenetre: Boolean(e?.ctrlKey || e?.shiftKey) });
      return;
    }
    if (crees.length) this.app.message(pluriel('structure_btp.a_facturer.creees', crees.length), 'succes');
    await this.charger();
  }

  async sansAvancement(m, sans) {
    let commentaire = null;
    if (sans) {
      commentaire = await saisir(texte('structure_btp.a_facturer.commentaire', { mois: libelleMois(this.mois), code: m.code }), '', { titre: texte('structure_btp.a_facturer.pas_avancement') });
      if (commentaire === null) return;
    }
    try {
      await api.sansAvancementMarche(m.mar_id, { mois: `${this.mois}-01`, sans, commentaire });
    } catch (x) { this.app.message(x.message, 'erreur'); return; }
    await this.charger();
  }
}
