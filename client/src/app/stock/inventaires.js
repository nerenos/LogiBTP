import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo, nombreSaisi, confirmer } from '@logibtp/socle/ui';
import { controlerLot, MESSAGES_INVENTAIRE } from '@logibtp/stock';
import { api } from '../api.js';
import { choixMultiple } from '../choix-multiple.js';
import { isoDepuisLocal, dateHeureLocale } from './etat.js';

// Module Stock, lot 2 (ANALYSE-MODULE-STOCK.md § 5.3, S5 à S8, S30) : lots d'inventaire d'un lieu à une date-heure
// unique (bordereaux générés par emplacement, famille, marque ou articles du lieu, ou saisis), saisie des quantités
// comptées (vide = non compté : l'article garde son calcul), prix d'inventaire et « Appliquer au PMP », contrôle partagé
// (controlerLot : cumul, doublon d'emplacement, prix), rapport d'écarts valorisé, validation, annulation, impression.

const ETATS = { BROUILLON: '✏️ Brouillon', VALIDE: '✅ Validé', ANNULE: '⛔ Annulé' };
const GENERATIONS = [
  { valeur: 'STOCK', libelle: 'Articles du lieu (stock ou mouvement)' }, { valeur: 'EMPLACEMENT', libelle: 'Par emplacement (zone)' },
  { valeur: 'FAMILLE', libelle: 'Par famille d\'articles' }, { valeur: 'MARQUE', libelle: 'Par marque' },
];

/** Liste des lots d'inventaire : /stock/inventaires?lieu= ; nouveau lot (lieu, date-heure, libellé). */
export class PageInventaires extends PageBase {
  icone = '📋';

  async ouvrir() {
    this.titre = 'Inventaires';
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">📋 Inventaires</h1>
      <span data-lieu></span><button type="button" data-nouveau>＋ Nouveau lot</button></div>
      <p class="aide">Un lot regroupe les bordereaux d'un dépôt comptés à la même date-heure ; il ne bloque rien : les mouvements datés avant le
        comptage n'y changent rien, ceux d'après partent de la quantité comptée. Un article non saisi garde son calcul.</p>
      <div data-creation hidden></div><div data-corps></div></div>`;
    this.lieux = await api.stock.lieux();
    this.lieu = Number(new URLSearchParams(globalThis.location?.search ?? '').get('lieu')) || null;
    const combo = creerCombo({ options: this.lieux.map((l) => ({ valeur: l.id, libelle: `${l.depot ? '📦' : '🏗'} ${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', titre: 'Tous les lieux' });
    combo.addEventListener('change', () => { this.lieu = combo.valeurCombo === '' ? null : Number(combo.valeurCombo); this.#charger(); });
    this.conteneur.querySelector('[data-lieu]').append(combo);
    this.conteneur.querySelector('[data-nouveau]').addEventListener('click', () => this.#creation());
    await this.#charger();
  }

  async #charger() {
    const lots = await api.stock.inventaires(this.lieu);
    this.conteneur.querySelector('[data-corps]').innerHTML = lots.length ? `<table class="tableau-compact"><thead><tr><th>Date du comptage</th><th>Lieu</th><th>Libellé</th>
      <th>État</th><th>Bordereaux</th><th>Comptées / lignes</th><th>Créé par</th><th>Validé</th></tr></thead><tbody>
      ${lots.map((l) => `<tr class="cliquable" data-id="${l.id}"><td>${dateHeureLocale(l.date)}</td><td>${echapper(l.lieu_code ?? '')}</td>
        <td><a href="/stock/inventaire/${l.id}">${echapper(l.libelle)}</a>${l.micro ? ' <small>(correction)</small>' : ''}</td><td>${ETATS[l.etat] ?? l.etat}</td>
        <td class="nombre">${l.bordereaux}</td><td class="nombre">${l.comptees} / ${l.lignes}</td><td>${echapper(l.cree_par)}</td>
        <td>${l.valide_le ? `${dateHeureLocale(l.valide_le)} ${echapper(l.valide_par ?? '')}` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucun lot d\'inventaire.</p>';
    this.conteneur.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
      e.preventDefault();
      this.app.naviguer(`/stock/inventaire/${tr.dataset.id}`, { nouvelleFenetre: e.ctrlKey });
    }));
  }

  #creation() {
    const zone = this.conteneur.querySelector('[data-creation]');
    zone.hidden = false;
    const depots = this.lieux.filter((l) => l.depot);
    zone.innerHTML = `<p class="ligne"><label>Lieu <span data-l></span></label> <label>Comptage le <input type="datetime-local" data-date title="Vide : maintenant"></label>
      <label>Libellé <input data-libelle size="30"></label> <button type="button" class="principal" data-creer>Créer le lot</button></p>`;
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
  icone = '📋';
  #modifies = new Set();

  get modifiee() { return this.#modifies.size > 0; }

  async ouvrir() {
    this.titre = 'Inventaire';
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
    z.innerHTML = `<div class="entete-page"><h1 class="page-titre">📋 ${echapper(lot.libelle)}</h1><span>${ETATS[lot.etat] ?? lot.etat}</span>
        <span class="aide">${echapper(lot.lieu_code ?? '')} · comptage du ${dateHeureLocale(lot.date)}</span>
        ${this.brouillon ? '<button type="button" class="principal" data-valider title="Crée un comptage par article (cumul des bordereaux)">✅ Valider le lot</button><button type="button" data-supprimer>🗑 Supprimer</button>' : ''}
        ${lot.etat === 'VALIDE' ? '<button type="button" data-annuler title="Retire les comptages du lot : le stock se recalcule sans lui">↩ Annuler le lot</button>' : ''}
        <button type="button" data-imprimer title="Imprime les bordereaux (quantités théoriques selon la case)">🖨 Imprimer</button>
        <label class="sans-impression"><input type="checkbox" data-theoriques ${this.theoriques ? 'checked' : ''}> Quantités théoriques</label></div>
      ${this.brouillon ? `<p class="ligne sans-impression"><label>Libellé <input data-libelle size="30" value="${echapper(lot.libelle)}"></label>
        <label>Comptage le <input type="datetime-local" data-date value="${valeurLocale}"></label> <button type="button" data-entete>Enregistrer</button></p>` : ''}
      <div data-controle class="sans-impression"></div>
      ${this.brouillon ? `<fieldset class="sans-impression"><legend>Générer des bordereaux</legend><p class="ligne"><span data-par></span><span data-valeurs></span>
        <label><input type="checkbox" data-separer checked> Un bordereau par valeur</label> <button type="button" data-generer>Générer</button>
        <button type="button" data-vide>＋ Bordereau vide</button></p></fieldset>` : ''}
      <div class="onglets sans-impression"><button type="button" data-onglet="bordereaux" class="${this.onglet === 'bordereaux' ? 'actif' : ''}">Bordereaux (${this.detail.bordereaux.length})</button>
        <button type="button" data-onglet="ecarts" class="${this.onglet === 'ecarts' ? 'actif' : ''}">Écarts</button></div>
      <div data-contenu></div>`;
    this.#controle();
    z.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { this.onglet = b.dataset.onglet; this.#rendre(); }));
    z.querySelector('[data-theoriques]').addEventListener('change', (e) => { this.theoriques = e.target.checked; z.classList.toggle('sans-theoriques', !this.theoriques); });
    z.classList.toggle('sans-theoriques', !this.theoriques);
    z.querySelector('[data-imprimer]').addEventListener('click', () => { if (this.onglet !== 'bordereaux') { this.onglet = 'bordereaux'; this.#rendre(); } globalThis.print(); });
    const action = (sel, f) => z.querySelector(sel)?.addEventListener('click', async () => { try { await f(); } catch (e) { this.app.erreur(e); } });
    action('[data-valider]', async () => {
      if (this.modifiee) { this.app.message('Enregistrez d\'abord les bordereaux modifiés', 'avertissement'); return; }
      await this.#charger(await api.stock.validerInventaire(lot.id));
      this.app.message('Lot validé : comptages enregistrés', 'succes');
    });
    action('[data-supprimer]', async () => {
      if (!(await confirmer('Supprimer ce lot et ses bordereaux ?'))) return;
      await api.stock.supprimerInventaire(lot.id);
      this.#modifies.clear();
      this.app.naviguer(`/stock/inventaires?lieu=${lot.lieu}`);
    });
    action('[data-annuler]', async () => {
      if (!(await confirmer('Annuler ce lot ? Ses comptages sont retirés et le stock se recalcule sans eux.'))) return;
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
    const nom = (ele) => { const a = this.articles.get(ele); return a ? `${a.code} – ${a.libelle}` : `article ${ele}`; };
    const emp = (id) => this.emplacements.find((e) => e.id === id)?.code ?? id;
    const zone = this.conteneur.querySelector('[data-controle]');
    zone.innerHTML = `<p class="aide">${c.comptages.length} article(s) compté(s) sur ${lignes.length} ligne(s) ; les lignes sans quantité ne sont pas comptées.</p>
      ${c.erreurs.map((x) => `<p class="erreur">⛔ ${echapper(nom(x.ele))} : ${echapper(MESSAGES_INVENTAIRE[x.code] ?? x.code)}</p>`).join('')}
      ${c.avertissements.map((x) => `<p class="avertissement">⚠ ${echapper(nom(x.ele))} : ${x.nombre} lignes à l'emplacement ${echapper(String(emp(x.emp)))} — ${echapper(MESSAGES_INVENTAIRE[x.code])}</p>`).join('')}`;
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
      this.choix = p === 'STOCK' ? null : choixMultiple({ options, titre: 'Ajouter', aucun: 'choisir…' });
      if (this.choix) zone.append(this.choix);
    };
    par.addEventListener('change', valeurs);
    valeurs();
    action('[data-generer]', async () => {
      const v = this.choix?.valeurs ?? [];
      if (this.choix && !v.length) { this.app.message('Choisissez au moins une valeur', 'avertissement'); return; }
      await this.#charger(await api.stock.generer(this.detail.lot.id, { par: par.valeurCombo, valeurs: v, separer: z.querySelector('[data-separer]').checked }));
    });
    action('[data-vide]', async () => { await this.#charger(await api.stock.ajouterBordereau(this.detail.lot.id, { libelle: `Bordereau ${this.detail.bordereaux.length + 1}` })); });
  }

  #bordereaux(zone) {
    const lecture = !this.brouillon;
    zone.innerHTML = this.detail.bordereaux.map((b) => `<section class="bordereau" data-bor="${b.id}">
      <h2 class="titre-actions">${lecture ? echapper(b.libelle) : `<input data-b="libelle" size="40" value="${echapper(b.libelle)}">`}
        <small>Compté par ${lecture ? echapper(b.compteur ?? '—') : `<input data-b="compteur" size="16" value="${echapper(b.compteur ?? '')}">`}</small>
        ${lecture ? '' : '<span class="sans-impression"><button type="button" data-enr>Enregistrer</button> <button type="button" data-suppr title="Supprimer le bordereau">🗑</button></span>'}</h2>
      <table class="tableau-compact"><thead><tr><th>Article</th><th>Libellé</th><th>Emplacement</th><th class="theorique">Théorique</th><th>Compté</th><th>U.</th>
        <th>Prix d'inventaire</th><th title="Appliquer le prix au PMP">PMP</th><th>Commentaire</th><th class="cellule-boutons sans-impression"></th></tr></thead>
      <tbody>${b.lignes.map((l, i) => this.#ligne(b, l, i, lecture)).join('')}</tbody></table>
      ${lecture ? '' : '<p class="ligne sans-impression"><span data-ajout></span></p>'}</section>`).join('') || '<p class="aide">Aucun bordereau : générez-en ou ajoutez un bordereau vide.</p>';
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
      <td>${champ('commentaire', l.commentaire, 18)}</td><td class="cellule-boutons sans-impression">${lecture ? '' : '<button type="button" data-retirer title="Retirer la ligne">✕</button>'}</td></tr>`;
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
    const ajout = creerCombo({ options: [...this.articles.values()].map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}` })), valeur: '', titre: 'Ajouter un article' });
    ajout.placeholder = '＋ article (code ou libellé)…';
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
      try { await this.#charger(await api.stock.enregistrerBordereau(b.id, { libelle: b.libelle, compteur: b.compteur, lignes: b.lignes })); this.app.message('Bordereau enregistré', 'succes'); } catch (e) { this.app.erreur(e); }
    });
    sec.querySelector('[data-suppr]').addEventListener('click', async () => {
      if (!(await confirmer(`Supprimer le bordereau « ${b.libelle} » ?`))) return;
      try { await this.#charger(await api.stock.supprimerBordereau(b.id)); } catch (e) { this.app.erreur(e); }
    });
  }

  async #ecarts(zone) {
    zone.innerHTML = '<p class="aide">Calcul…</p>';
    const e = await api.stock.ecarts(this.detail.lot.id);
    zone.innerHTML = e.articles.length ? `<p class="aide">Écart = compté − stock calculé juste avant le comptage ; valeur à la date du comptage (${echapper(e.methode === 'PMP' ? 'PMP' : 'dernier prix d\'achat')}).
      Valeur d'inventaire : quantité comptée au prix saisi, sinon à la valeur unitaire.</p>
      <table class="tableau-compact"><thead><tr><th>Article</th><th>Libellé</th><th>Théorique</th><th>Compté</th><th>Écart</th><th>U.</th><th>Valeur unitaire</th>
        <th>Valeur de l'écart</th><th>Prix saisi</th><th>Valeur d'inventaire</th><th>Commentaire</th></tr></thead><tbody>
      ${e.articles.map((a) => `<tr><td>${echapper(a.code)}</td><td>${echapper(a.libelle)}</td><td class="nombre">${formatNombre(a.theorique, a.precision)}</td>
        <td class="nombre">${formatNombre(a.compte, a.precision)}</td><td class="nombre ${Number(a.ecart) ? 'avertissement' : ''}">${Number(a.ecart) > 0 ? '+' : ''}${formatNombre(a.ecart, a.precision)}</td>
        <td>${echapper(a.unite)}</td><td class="nombre">${formatNombre(a.valeur_unitaire, 4)}${a.source === 'REPLI' ? ' <span title="Aucun achat : PA de la bibliothèque">⚠</span>' : ''}</td>
        <td class="nombre">${formatNombre(a.valeur_ecart, 2)}</td><td class="nombre">${formatNombre(a.prix, 4)}${a.appliquer_pmp ? ' → PMP' : ''}</td>
        <td class="nombre">${formatNombre(a.valeur_inventaire, 2)}</td><td>${echapper(a.commentaire ?? '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="7">Total</th><th class="nombre">${formatNombre(e.valeur_ecarts, 2)}</th><th></th><th class="nombre">${formatNombre(e.valeur_inventaire, 2)}</th><th></th></tr></tfoot></table>`
      : '<p class="aide">Aucune quantité comptée.</p>';
  }
}
