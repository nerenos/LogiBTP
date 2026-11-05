import { texte, texteHtml, pairesParCode, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo, nombreSaisi, confirmer } from '@logibtp/socle/ui';
import { controlerLot, MESSAGES_INVENTAIRE } from '@logibtp/stock';
import { api } from '../api.js';
import { urlDocument } from '../codes.js';
import { choixMultiple } from '../choix-multiple.js';
import { isoDepuisLocal, dateHeureLocale } from './etat.js';

// Module Stock, lot 2 (ANALYSE-MODULE-STOCK.md § 5.3, S5 à S8, S30) : lots d'inventaire d'un lieu à une date-heure
// unique (bordereaux générés par emplacement, famille, marque ou articles du lieu, ou saisis), saisie des quantités
// comptées (vide = non compté : l'article garde son calcul), prix d'inventaire et « Appliquer au PMP », contrôle partagé
// (controlerLot : cumul, doublon d'emplacement, prix), rapport d'écarts valorisé, validation, annulation, impression.

// États d'un lot (icône et libellé) et modes de génération des bordereaux (module Personnalisation).
const ICONES_ETATS = { BROUILLON: 'stock_btp_brouillon', VALIDE: 'stock_btp_valide', ANNULE: 'stock_btp_annule' };
const etatLot = (etat) => (ICONES_ETATS[etat] ? `${iconeHtml(ICONES_ETATS[etat])} ${texteHtml(`stock_btp.inventaire.etats.${etat}`)}` : echapper(etat));
const GENERATIONS = pairesParCode('stock_btp.inventaire.generations', ['STOCK', 'EMPLACEMENT', 'FAMILLE', 'MARQUE']).map(([valeur, libelle]) => ({ valeur, libelle }));

/** Liste des lots d'inventaire : /stock/inventaires?lieu= ; nouveau lot (lieu, date-heure, libellé). */
export class PageInventaires extends PageBase {
  icone = icone('stock_btp_inventaire');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.inventaires');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_inventaire')} ${texteHtml('stock_btp.routes.inventaires')}</h1>
      <span data-lieu></span><button type="button" data-nouveau>${iconeHtml('ajouter')} ${texteHtml('stock_btp.inventaire.nouveau')}</button></div>
      <p class="aide">${texteHtml('stock_btp.inventaire.aide')}</p>
      <div data-creation hidden></div><div data-corps></div></div>`;
    this.lieux = await api.stock.lieux();
    this.lieu = Number(new URLSearchParams(globalThis.location?.search ?? '').get('lieu')) || null;
    const combo = creerCombo({ options: this.lieux.map((l) => ({ valeur: l.id, libelle: `${icone(l.depot ? 'stock_btp_stock' : 'stock_btp_chantier')} ${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', titre: texte('stock_btp.inventaire.tous_lieux') });
    combo.addEventListener('change', () => { this.lieu = combo.valeurCombo === '' ? null : Number(combo.valeurCombo); this.#charger(); });
    this.conteneur.querySelector('[data-lieu]').append(combo);
    this.conteneur.querySelector('[data-nouveau]').addEventListener('click', () => this.#creation());
    await this.#charger();
  }

  async #charger() {
    const lots = await api.stock.inventaires(this.lieu);
    this.conteneur.querySelector('[data-corps]').innerHTML = lots.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.inventaire.date_comptage')}</th><th>${texteHtml('stock_btp.colonnes.lieu')}</th><th>${texteHtml('commun.libelle')}</th>
      <th>${texteHtml('stock_btp.inventaire.etat')}</th><th>${texteHtml('stock_btp.inventaire.bordereaux')}</th><th>${texteHtml('stock_btp.inventaire.comptees')}</th><th>${texteHtml('stock_btp.inventaire.cree_par')}</th><th>${texteHtml('stock_btp.inventaire.valide')}</th></tr></thead><tbody>
      ${lots.map((l) => `<tr class="cliquable" data-id="${l.id}"><td>${dateHeureLocale(l.date)}</td><td>${echapper(l.lieu_code ?? '')}</td>
        <td><a href="/stock/inventaire/${l.id}">${echapper(l.libelle)}</a>${l.micro ? ` <small>${texteHtml('stock_btp.inventaire.correction')}</small>` : ''}</td><td>${etatLot(l.etat)}</td>
        <td class="nombre">${l.bordereaux}</td><td class="nombre">${l.comptees} / ${l.lignes}</td><td>${echapper(l.cree_par)}</td>
        <td>${l.valide_le ? `${dateHeureLocale(l.valide_le)} ${echapper(l.valide_par ?? '')}` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<p class="aide">${texteHtml('stock_btp.inventaire.aucun')}</p>`;
    this.conteneur.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
      e.preventDefault();
      this.app.naviguer(`/stock/inventaire/${tr.dataset.id}`, { nouvelleFenetre: e.ctrlKey });
    }));
  }

  #creation() {
    const zone = this.conteneur.querySelector('[data-creation]');
    zone.hidden = false;
    const depots = this.lieux.filter((l) => l.depot);
    zone.innerHTML = `<p class="ligne"><label>${texteHtml('stock_btp.colonnes.lieu')} <span data-l></span></label> <label>${texteHtml('stock_btp.inventaire.comptage_le')} <input type="datetime-local" data-date title="${texteHtml('stock_btp.etat.date_titre')}"></label>
      <label>${texteHtml('commun.libelle')} <input data-libelle size="30"></label> <button type="button" class="principal" data-creer>${texteHtml('stock_btp.inventaire.creer')}</button></p>`;
    const lieu = creerCombo({ options: this.lieux.map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: this.lieu ?? depots[0]?.id ?? '', vide: false });
    zone.querySelector('[data-l]').append(lieu);
    zone.querySelector('[data-creer]').addEventListener('click', async () => {
      try {
        const d = await api.stock.creerInventaire({ lieu: Number(lieu.valeurCombo), date: isoDepuisLocal(zone.querySelector('[data-date]').value), libelle: zone.querySelector('[data-libelle]').value });
        this.app.naviguer(`/stock/inventaire/${d.lot.id}`);
      } catch (e) { this.app.erreur(e); }
    });
  }
}

/** Lot d'inventaire : /stock/inventaire/:id. */
export class PageInventaire extends PageBase {
  icone = icone('stock_btp_inventaire');
  #modifies = new Set();

  get modifiee() { return this.#modifies.size > 0; }

  async ouvrir() {
    this.titre = texte('stock_btp.routes.inventaire');
    this.conteneur.innerHTML = '<div class="page-parametres page-inventaire"></div>';
    const [articles, marques] = await Promise.all([api.stock.articles(), api.stock.marques()]);
    this.articles = new Map(articles.map((a) => [a.id, a]));
    this.marques = marques;
    this.theoriques = true;
    this.onglet = 'bordereaux';
    await this.#charger();
  }

  async #charger(detail = null) {
    this.detail = detail ?? await api.stock.inventaire(this.params.id);
    this.#modifies.clear();
    this.titre = this.detail.lot.libelle;
    if (!this.emplacements || this.emplacementsLieu !== this.detail.lot.lieu) {
      this.emplacements = await api.stock.emplacements(this.detail.lot.lieu);
      this.emplacementsLieu = this.detail.lot.lieu;
    }
    this.#rendre();
  }

  get brouillon() { return this.detail.lot.etat === 'BROUILLON'; }

  #rendre() {
    const { lot } = this.detail;
    const z = this.conteneur.querySelector('.page-inventaire');
    const local = new Date(`${lot.date}Z`);
    const valeurLocale = new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    z.innerHTML = `<div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_inventaire')} ${echapper(lot.libelle)}</h1><span>${etatLot(lot.etat)}</span>
        <span class="aide">${echapper(lot.lieu_code ?? '')} · ${texteHtml('stock_btp.inventaire.comptage_du', { date: dateHeureLocale(lot.date) })}</span>
        ${lot.piece ? `<a href="${urlDocument(lot.piece)}" data-piece="${lot.piece}" class="sans-impression" title="${texteHtml('stock_btp.inventaire.piece_titre')}">${iconeHtml('stock_btp_piece_comptable')} ${texteHtml('stock_btp.inventaire.piece')}</a>` : ''}
        ${lot.extourne ? `<a href="${urlDocument(lot.extourne)}" data-piece="${lot.extourne}" class="sans-impression" title="${texteHtml('stock_btp.inventaire.extourne_titre')}">${iconeHtml('stock_btp_piece_comptable')} ${texteHtml('stock_btp.inventaire.extourne')}</a>` : ''}
        ${this.brouillon ? `<button type="button" class="principal" data-valider title="${texteHtml('stock_btp.inventaire.valider_titre')}">${iconeHtml('stock_btp_valide')} ${texteHtml('stock_btp.inventaire.valider')}</button><button type="button" data-supprimer>${iconeHtml('supprimer')} ${texteHtml('commun.supprimer')}</button>` : ''}
        ${lot.etat === 'VALIDE' ? `<button type="button" data-annuler title="${texteHtml('stock_btp.inventaire.annuler_titre')}">${iconeHtml('stock_btp_retour')} ${texteHtml('stock_btp.inventaire.annuler')}</button>` : ''}
        <button type="button" data-imprimer title="${texteHtml('stock_btp.inventaire.imprimer_titre')}">${iconeHtml('stock_btp_imprimer')} ${texteHtml('stock_btp.inventaire.imprimer')}</button>
        <label class="sans-impression"><input type="checkbox" data-theoriques ${this.theoriques ? 'checked' : ''}> ${texteHtml('stock_btp.inventaire.theoriques')}</label></div>
      ${this.brouillon ? `<p class="ligne sans-impression"><label>${texteHtml('commun.libelle')} <input data-libelle size="30" value="${echapper(lot.libelle)}"></label>
        <label>${texteHtml('stock_btp.inventaire.comptage_le')} <input type="datetime-local" data-date value="${valeurLocale}"></label> <button type="button" data-entete>${texteHtml('commun.enregistrer')}</button></p>` : ''}
      <div data-controle class="sans-impression"></div>
      ${this.brouillon ? `<fieldset class="sans-impression"><legend>${texteHtml('stock_btp.inventaire.generer_titre')}</legend><p class="ligne"><span data-par></span><span data-valeurs></span>
        <label><input type="checkbox" data-separer checked> ${texteHtml('stock_btp.inventaire.separer')}</label> <button type="button" data-generer>${texteHtml('stock_btp.inventaire.generer')}</button>
        <button type="button" data-vide>${iconeHtml('ajouter')} ${texteHtml('stock_btp.inventaire.vide')}</button></p></fieldset>` : ''}
      <div class="onglets sans-impression"><button type="button" data-onglet="bordereaux" class="${this.onglet === 'bordereaux' ? 'actif' : ''}">${texteHtml('stock_btp.inventaire.onglet_bordereaux', { nombre: this.detail.bordereaux.length })}</button>
        <button type="button" data-onglet="ecarts" class="${this.onglet === 'ecarts' ? 'actif' : ''}">${texteHtml('stock_btp.inventaire.ecarts')}</button></div>
      <div data-contenu></div>`;
    this.#controle();
    z.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { this.onglet = b.dataset.onglet; this.#rendre(); }));
    z.querySelector('[data-theoriques]').addEventListener('change', (e) => { this.theoriques = e.target.checked; z.classList.toggle('sans-theoriques', !this.theoriques); });
    z.classList.toggle('sans-theoriques', !this.theoriques);
    z.querySelector('[data-imprimer]').addEventListener('click', () => { if (this.onglet !== 'bordereaux') { this.onglet = 'bordereaux'; this.#rendre(); } globalThis.print(); });
    z.querySelectorAll('[data-piece]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(urlDocument(a.dataset.piece), { nouvelleFenetre: e.ctrlKey }); }));
    const action = (sel, f) => z.querySelector(sel)?.addEventListener('click', async () => { try { await f(); } catch (e) { this.app.erreur(e); } });
    action('[data-valider]', async () => {
      if (this.modifiee) { this.app.message(texte('stock_btp.inventaire.enregistrer_dabord'), 'avertissement'); return; }
      await this.#charger(await api.stock.validerInventaire(lot.id));
      this.app.message(texte('stock_btp.inventaire.valide_message'), 'succes');
    });
    action('[data-supprimer]', async () => {
      if (!(await confirmer(texte('stock_btp.inventaire.confirmer_suppression')))) return;
      await api.stock.supprimerInventaire(lot.id);
      this.#modifies.clear();
      this.app.naviguer(`/stock/inventaires?lieu=${lot.lieu}`);
    });
    action('[data-annuler]', async () => {
      if (!(await confirmer(texte('stock_btp.inventaire.confirmer_annulation')))) return;
      await this.#charger(await api.stock.annulerInventaire(lot.id));
    });
    action('[data-entete]', async () => {
      await this.#charger(await api.stock.modifierInventaire(lot.id, { libelle: z.querySelector('[data-libelle]').value, date: isoDepuisLocal(z.querySelector('[data-date]').value) }));
    });
    if (this.brouillon) this.#generation(z, action);
    if (this.onglet === 'ecarts') this.#ecarts(z.querySelector('[data-contenu]')).catch((e) => this.app.erreur(e));
    else this.#bordereaux(z.querySelector('[data-contenu]'));
  }

  /** Contrôle en direct des bordereaux affichés (erreurs refusées à la validation, avertissements signalés). */
  #controle() {
    const lignes = this.detail.bordereaux.flatMap((b) => b.lignes.map((l) => ({ bordereau: b.id, ele: l.ele, emp: l.emp, quantite: l.quantite, prix: l.prix, appliquer_pmp: l.appliquer_pmp, commentaire: l.commentaire })));
    const c = controlerLot({ lignes });
    this.doublons = new Set(c.avertissements.map((x) => `${x.ele}|${x.emp}`));
    const nom = (ele) => { const a = this.articles.get(ele); return a ? `${a.code} – ${a.libelle}` : texte('stock_btp.inventaire.article_n', { id: ele }); };
    const emp = (id) => this.emplacements.find((e) => e.id === id)?.code ?? id;
    const zone = this.conteneur.querySelector('[data-controle]');
    zone.innerHTML = `<p class="aide">${texteHtml('stock_btp.inventaire.controle', { articles: pluriel('stock_btp.inventaire.articles_comptes', c.comptages.length), lignes: pluriel('stock_btp.appro.lignes', lignes.length) })}</p>
      ${c.erreurs.map((x) => `<p class="erreur">${iconeHtml('erreur')} ${echapper(nom(x.ele))} : ${echapper(MESSAGES_INVENTAIRE[x.code] ?? x.code)}</p>`).join('')}
      ${c.avertissements.map((x) => `<p class="avertissement">${iconeHtml('avertissement')} ${echapper(nom(x.ele))} : ${texteHtml('stock_btp.inventaire.doublon', { nombre: x.nombre, emplacement: String(emp(x.emp)), message: MESSAGES_INVENTAIRE[x.code] })}</p>`).join('')}`;
  }

  #generation(z, action) {
    const par = creerCombo({ options: GENERATIONS, valeur: this.parGeneration ?? 'STOCK', vide: false });
    z.querySelector('[data-par]').append(par);
    const valeurs = async () => {
      const p = par.valeurCombo;
      this.parGeneration = p;
      const zone = z.querySelector('[data-valeurs]');
      zone.innerHTML = '';
      let options = [];
      if (p === 'EMPLACEMENT') options = this.emplacements.filter((e) => e.actif).map((e) => ({ valeur: String(e.id), libelle: `${e.code}${e.libelle ? ` – ${e.libelle}` : ''}` }));
      if (p === 'FAMILLE') options = (this.familles ??= await api.stock.familles()).map((f) => ({ valeur: String(f.id), libelle: f.chemin }));
      if (p === 'MARQUE') options = this.marques.filter((m) => m.actif).map((m) => ({ valeur: m.code, libelle: m.libelle }));
      this.choix = p === 'STOCK' ? null : choixMultiple({ options, titre: texte('commun.ajouter'), aucun: texte('stock_btp.inventaire.choisir') });
      if (this.choix) zone.append(this.choix);
    };
    par.addEventListener('change', valeurs);
    valeurs();
    action('[data-generer]', async () => {
      const v = this.choix?.valeurs ?? [];
      if (this.choix && !v.length) { this.app.message(texte('stock_btp.inventaire.choisir_valeur'), 'avertissement'); return; }
      await this.#charger(await api.stock.generer(this.detail.lot.id, { par: par.valeurCombo, valeurs: v, separer: z.querySelector('[data-separer]').checked }));
    });
    action('[data-vide]', async () => { await this.#charger(await api.stock.ajouterBordereau(this.detail.lot.id, { libelle: texte('stock_btp.inventaire.bordereau_n', { numero: this.detail.bordereaux.length + 1 }) })); });
  }

  #bordereaux(zone) {
    const lecture = !this.brouillon;
    zone.innerHTML = this.detail.bordereaux.map((b) => `<section class="bordereau" data-bor="${b.id}">
      <h2 class="titre-actions">${lecture ? echapper(b.libelle) : `<input data-b="libelle" size="40" value="${echapper(b.libelle)}">`}
        <small>${texteHtml('stock_btp.inventaire.compte_par')} ${lecture ? echapper(b.compteur ?? '—') : `<input data-b="compteur" size="16" value="${echapper(b.compteur ?? '')}">`}</small>
        ${lecture ? '' : `<span class="sans-impression"><button type="button" data-enr>${texteHtml('commun.enregistrer')}</button> <button type="button" data-suppr title="${texteHtml('stock_btp.inventaire.suppr_bordereau')}">${iconeHtml('supprimer')}</button></span>`}</h2>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.article')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.inventaire.emplacement')}</th><th class="theorique">${texteHtml('stock_btp.inventaire.theorique')}</th><th>${texteHtml('stock_btp.inventaire.compte')}</th><th>${texteHtml('stock_btp.colonnes.unite_court')}</th>
        <th>${texteHtml('stock_btp.inventaire.prix_inventaire')}</th><th title="${texteHtml('stock_btp.inventaire.pmp_titre')}">${texteHtml('stock_btp.colonnes.pmp')}</th><th>${texteHtml('stock_btp.article.commentaire')}</th><th class="cellule-boutons sans-impression"></th></tr></thead>
      <tbody>${b.lignes.map((l, i) => this.#ligne(b, l, i, lecture)).join('')}</tbody></table>
      ${lecture ? '' : '<p class="ligne sans-impression"><span data-ajout></span></p>'}</section>`).join('') || `<p class="aide">${texteHtml('stock_btp.inventaire.aucun_bordereau')}</p>`;
    zone.querySelectorAll('section[data-bor]').forEach((sec) => this.#lierBordereau(sec, lecture));
  }

  #ligne(b, l, i, lecture) {
    const a = this.articles.get(l.ele);
    const doublon = l.emp && this.doublons.has(`${l.ele}|${l.emp}`);
    const champ = (c, v, taille) => (lecture ? echapper(v ?? '') : `<input data-c="${c}" size="${taille}" value="${echapper(v ?? '')}">`);
    return `<tr data-i="${i}" class="${doublon ? 'avertissement' : ''}"><td>${echapper(l.code ?? a?.code ?? '')}</td><td>${echapper(l.libelle ?? a?.libelle ?? '')}</td>
      <td data-emp>${lecture ? echapper(l.emp_code ?? '') : ''}</td><td class="nombre theorique">${formatNombre(l.theorique, l.precision)}</td>
      <td class="nombre">${champ('quantite', formatNombre(l.quantite, l.precision), 8)}</td><td>${echapper(l.unite ?? a?.unite ?? '')}</td>
      <td class="nombre">${champ('prix', l.prix === null ? '' : String(l.prix).replace('.', ','), 8)}</td>
      <td><input type="checkbox" data-c="appliquer_pmp" ${l.appliquer_pmp ? 'checked' : ''} ${lecture ? 'disabled' : ''}></td>
      <td>${champ('commentaire', l.commentaire, 18)}</td><td class="cellule-boutons sans-impression">${lecture ? '' : `<button type="button" data-retirer title="${texteHtml('stock_btp.inventaire.retirer_ligne')}">${iconeHtml('retirer')}</button>`}</td></tr>`;
  }

  #lierBordereau(sec, lecture) {
    const b = this.detail.bordereaux.find((x) => x.id === Number(sec.dataset.bor));
    if (lecture) return;
    const modifier = () => { this.#modifies.add(b.id); this.#controle(); };
    const optionsEmp = this.emplacements.filter((e) => e.actif).map((e) => ({ valeur: e.id, libelle: e.code }));
    sec.querySelectorAll('tr[data-i]').forEach((tr) => {
      const l = b.lignes[Number(tr.dataset.i)];
      const emp = creerCombo({ options: optionsEmp, valeur: l.emp ?? '' });
      emp.size = 8;
      emp.addEventListener('change', () => { l.emp = emp.valeurCombo === '' ? null : Number(emp.valeurCombo); modifier(); });
      tr.querySelector('[data-emp]').append(emp);
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        const c = x.dataset.c;
        l[c] = x.type === 'checkbox' ? x.checked : c === 'commentaire' ? x.value : nombreSaisi(x.value);
        modifier();
      }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { b.lignes.splice(b.lignes.indexOf(l), 1); modifier(); this.#bordereaux(this.conteneur.querySelector('[data-contenu]')); });
    });
    sec.querySelectorAll('[data-b]').forEach((x) => x.addEventListener('change', () => { b[x.dataset.b] = x.value; this.#modifies.add(b.id); }));
    // Ajout d'une ligne : article géré en stock (code ou libellé), emplacement habituel repris ensuite à la saisie.
    const ajout = creerCombo({ options: [...this.articles.values()].map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}` })), valeur: '', titre: texte('stock_btp.appro.ajouter_article') });
    ajout.placeholder = `${icone('ajouter')} ${texte('stock_btp.inventaire.article_aide')}`;
    ajout.size = 40;
    ajout.addEventListener('change', () => {
      const a = this.articles.get(Number(ajout.valeurCombo));
      if (!a) return;
      b.lignes.push({ id: null, ele: a.id, code: a.code, libelle: a.libelle, unite: a.unite, precision: a.precision, emp: null, emp_code: null, quantite: null, theorique: null,
        prix: null, appliquer_pmp: false, commentaire: null });
      modifier();
      this.#bordereaux(this.conteneur.querySelector('[data-contenu]'));
      this.conteneur.querySelector(`section[data-bor="${b.id}"] tr:last-child [data-c="quantite"]`)?.focus();
    });
    sec.querySelector('[data-ajout]').append(ajout);
    sec.querySelector('[data-enr]').addEventListener('click', async () => {
      try { await this.#charger(await api.stock.enregistrerBordereau(b.id, { libelle: b.libelle, compteur: b.compteur, lignes: b.lignes })); this.app.message(texte('stock_btp.inventaire.bordereau_enregistre'), 'succes'); } catch (e) { this.app.erreur(e); }
    });
    sec.querySelector('[data-suppr]').addEventListener('click', async () => {
      if (!(await confirmer(texte('stock_btp.inventaire.confirmer_bordereau', { libelle: b.libelle })))) return;
      try { await this.#charger(await api.stock.supprimerBordereau(b.id)); } catch (e) { this.app.erreur(e); }
    });
  }

  async #ecarts(zone) {
    zone.innerHTML = `<p class="aide">${texteHtml('stock_btp.inventaire.calcul')}</p>`;
    const e = await api.stock.ecarts(this.detail.lot.id);
    zone.innerHTML = e.articles.length ? `<p class="aide">${texteHtml('stock_btp.inventaire.aide_ecarts', { methode: e.methode === 'PMP' ? texte('stock_btp.colonnes.pmp') : texte('stock_btp.inventaire.dernier_pa') })}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.article')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.inventaire.theorique')}</th><th>${texteHtml('stock_btp.inventaire.compte')}</th><th>${texteHtml('stock_btp.inventaire.ecart')}</th><th>${texteHtml('stock_btp.colonnes.unite_court')}</th><th>${texteHtml('stock_btp.colonnes.valeur_unitaire')}</th>
        <th>${texteHtml('stock_btp.inventaire.valeur_ecart')}</th><th>${texteHtml('stock_btp.inventaire.prix_saisi')}</th><th>${texteHtml('stock_btp.article.valeur_inventaire')}</th><th>${texteHtml('stock_btp.article.commentaire')}</th></tr></thead><tbody>
      ${e.articles.map((a) => `<tr><td>${echapper(a.code)}</td><td>${echapper(a.libelle)}</td><td class="nombre">${formatNombre(a.theorique, a.precision)}</td>
        <td class="nombre">${formatNombre(a.compte, a.precision)}</td><td class="nombre ${Number(a.ecart) ? 'avertissement' : ''}">${Number(a.ecart) > 0 ? '+' : ''}${formatNombre(a.ecart, a.precision)}</td>
        <td>${echapper(a.unite)}</td><td class="nombre">${formatNombre(a.valeur_unitaire, 4)}${a.source === 'REPLI' ? ` <span title="${texteHtml('stock_btp.inventaire.repli')}">${iconeHtml('avertissement')}</span>` : ''}</td>
        <td class="nombre">${formatNombre(a.valeur_ecart, 2)}</td><td class="nombre">${formatNombre(a.prix, 4)}${a.appliquer_pmp ? ` ${texteHtml('stock_btp.inventaire.vers_pmp')}` : ''}</td>
        <td class="nombre">${formatNombre(a.valeur_inventaire, 2)}</td><td>${echapper(a.commentaire ?? '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="7">${texteHtml('commun.total')}</th><th class="nombre">${formatNombre(e.valeur_ecarts, 2)}</th><th></th><th class="nombre">${formatNombre(e.valeur_inventaire, 2)}</th><th></th></tr></tfoot></table>`
      : `<p class="aide">${texteHtml('stock_btp.inventaire.aucune_quantite')}</p>`;
  }
}
