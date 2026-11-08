// Module Relances, liste de travail (plans/relances.md, lot 3) : relances dues regroupées par tiers puis chargé, lot préparé
// (relances proposées cochées par défaut, mode modifiable, commentaire, validation après confirmation) et recommandés en
// attente de numéro. Composant sans métier : l'application fournit les appels, l'ouverture d'une pièce et les libellés.
import { texte, texteHtml, iconeHtml, messageErreur } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { formatNombre, formatDate, echapper, creerCombo, champDate, confirmer, alerter, saisir, ouvrirDialogue, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { modesAdmis, regrouperParTiers, proposees, selectionLot, basculerRelance, basculerGroupe, corpsValidation, nonRetenues, lotOuvert, attentesNumero, somme } from './modeles.js';

export const GROUPE_RACCOURCIS = 'relances';
declarerRaccourcis(GROUPE_RACCOURCIS, {
  libelle: texte('relance.raccourcis.groupe'),
  actions: {
    preparer: { libelle: texte('relance.raccourcis.preparer'), defaut: 'Ctrl+Shift+P' },
    valider: { libelle: texte('relance.raccourcis.valider'), defaut: 'Ctrl+Enter' },
    actualiser: { libelle: texte('relance.raccourcis.actualiser'), defaut: 'Ctrl+Shift+R' },
  },
});

const montant = (v) => formatNombre(v?.toString?.() ?? v, 2);

/**
 * Liste de travail des relances. options : { peut: { creer, valider }, api: { dues(date), preparer(date), lots(), lot(id),
 * valider(id, corps), annuler(id, corps), numero(relanceId, numero), noter(corps) } (promesses ; preparer rend le lot ou null
 * s'il n'y a rien), libelleTiers(id), libellePiece(id), ouvrirPiece(id, nouvelleFenetre), suspendre(pieceId) (facultatif),
 * apresEcriture(), erreur(e) }.
 */
export class ListeRelances {
  #zone;
  #o;
  #date = aujourdhui();
  #dues = [];
  #lots = [];
  #lot = null;
  #sel = new Map();
  #attentes = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, api: {}, libelleTiers: (id) => texte('relance.tiers_sans_nom', { id }), libellePiece: (id) => texte('relance.piece_sans_nom', { id }),
      ouvrirPiece: () => {}, apresEcriture: () => {}, erreur: (e) => alerter(e?.message ?? String(e)), ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('change', (e) => this.#changement(e));
    this.#zone.addEventListener('input', (e) => this.#saisie(e));
    this.#zone.addEventListener('keydown', (e) => this.#clavier(e));
  }

  /** Charge les relances dues, les lots ouverts et les recommandés en attente de numéro, puis affiche. */
  async charger() {
    try {
      const { api } = this.#o;
      const [dues, lots] = await Promise.all([api.dues(this.#date), api.lots()]);
      this.#dues = dues ?? [];
      this.#lots = lots ?? [];
      const ouvert = this.#lots.filter((l) => lotOuvert(l)).sort((a, b) => b.id - a.id);
      this.#lot = ouvert.length ? await api.lot((this.#lot && ouvert.find((l) => l.id === this.#lot.id) ? this.#lot : ouvert[0]).id) : null;
      this.#sel = selectionLot(this.#lot);
      const recents = [...this.#lots].sort((a, b) => b.id - a.id).slice(0, 20);
      this.#attentes = attentesNumero(await Promise.all(recents.map((l) => (this.#lot && l.id === this.#lot.id ? this.#lot : api.lot(l.id)))));
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #rendre() {
    const { peut } = this.#o;
    const lotsOuverts = this.#lots.filter((l) => lotOuvert(l));
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('relance_liste')} ${texteHtml('relance.liste.titre')}</h2>
      <p class="relance-barre"><label>${texteHtml('relance.liste.date')} <input type="date" data-date value="${echapper(this.#date)}"></label>
        <button type="button" data-actualiser title="${echapper(texte('relance.liste.actualiser_titre'))}">${iconeHtml('relance_actualiser')} ${texteHtml('relance.liste.actualiser')}</button>
        ${peut.creer ? `<button type="button" class="principal" data-preparer title="${echapper(texte('relance.liste.preparer_titre'))}">${iconeHtml('relance_preparer')} ${texteHtml('relance.liste.preparer')}</button>` : ''}</p>
      ${this.#htmlLot(lotsOuverts)}
      ${this.#htmlDues()}
      ${this.#htmlAttentes()}`;
    this.#zone.querySelectorAll('input[type="date"]').forEach(champDate);
    this.#zone.querySelectorAll('[data-combo-mode]').forEach((h) => {
      const g = this.#lot.groupes.find((x) => String(x.groupe) === h.dataset.comboMode);
      const c = creerCombo({ options: modesAdmis(g.nature).map((m) => ({ valeur: m, libelle: texte(`relance.modes.${m}`) })), valeur: this.#sel.get(g.groupe).mode, vide: false });
      c.dataset.mode = g.groupe;
      h.append(c);
    });
  }

  #htmlLot(lotsOuverts) {
    const lot = this.#lot;
    if (!lot) return `<p class="aide">${texteHtml('relance.liste.aucun_lot')}</p>`;
    const choix = lotsOuverts.length > 1 ? `<p class="aide">${echapper(texte('relance.liste.autres_lots', { nombre: lotsOuverts.length - 1 }))}</p>` : '';
    const groupes = lot.groupes.filter((g) => proposees(g).length).map((g) => {
      const s = this.#sel.get(g.groupe);
      const lignes = proposees(g).map((r) => `<tr><td><input type="checkbox" data-relance="${r.id}" data-groupe="${g.groupe}" ${s.retenues.has(r.id) ? 'checked' : ''}
          aria-label="${echapper(texte('relance.lot.retenir'))}"></td>
        <td>${echapper(this.#o.libellePiece(r.piece_id))}</td><td class="relance-niveau">${echapper(texte('relance.niveau_n', { niveau: r.niveau }))}</td>
        <td class="montant">${echapper(texte('relance.jours', { jours: r.jours }))}</td><td class="montant">${montant(r.montant)}</td></tr>`).join('');
      return `<section class="relance-groupe" data-groupe-bloc="${g.groupe}"><h3><label><input type="checkbox" data-groupe-coche="${g.groupe}" ${s.coche ? 'checked' : ''}>
          ${echapper(this.#o.libelleTiers(g.tiers_id))} <span class="relance-nature">${echapper(texte(`relance.natures.${g.nature}`))}</span>
          <span class="relance-niveau">${echapper(texte('relance.niveau_n', { niveau: g.niveau }))}</span></label></h3>
        <p class="relance-champs"><label>${texteHtml('relance.lot.mode')} <span data-combo-mode="${g.groupe}"></span></label>
          <label>${texteHtml('relance.lot.commentaire')} <input type="text" data-commentaire="${g.groupe}" value="${echapper(s.commentaire)}"></label></p>
        <table class="relance-table"><tbody>${lignes}</tbody></table></section>`;
    }).join('');
    const nb = [...this.#sel.values()].reduce((t, s) => t + s.retenues.size, 0);
    return `<section class="relance-lot"><h3>${echapper(texte('relance.lot.titre', { id: lot.id, date: formatDate(lot.date), etat: texte(`relance.etats_lot.${lot.etat}`) }))}</h3>
      ${choix}${groupes}
      <p class="relance-actions">${this.#o.peut.valider ? `<button type="button" class="principal" data-valider ${nb ? '' : 'disabled'}>${iconeHtml('relance_valider')} ${echapper(texte('relance.lot.valider', { nombre: nb }))}</button>` : ''}
        <button type="button" data-annuler-lot ${this.#o.peut.creer ? '' : 'hidden'}>${iconeHtml('relance_annuler')} ${texteHtml('relance.lot.annuler')}</button></p></section>`;
  }

  #htmlDues() {
    if (!this.#dues.length) return `<p class="aide">${texteHtml('relance.liste.aucune_due')}</p>`;
    const tiers = regrouperParTiers(this.#dues);
    const piece = (p) => `<tr><td>${echapper(p.numero ?? this.#o.libellePiece(p.id))}</td><td class="relance-niveau">${echapper(texte('relance.niveau_n', { niveau: p.niveau }))}</td>
      <td class="montant">${echapper(texte('relance.jours', { jours: p.jours }))}</td><td class="montant">${montant(p.montant)}</td>
      <td class="relance-boutons"><button type="button" data-ouvrir-piece="${p.id}" title="${echapper(texte('relance.liste.ouvrir_piece'))}">${iconeHtml('relance_ouvrir')}</button>
        ${this.#o.peut.creer ? `<button type="button" data-noter="${p.id}" data-nature="${echapper(this.#naturePiece(p.id))}" title="${echapper(texte('relance.liste.noter_titre'))}">${iconeHtml('relance_noter')}</button>` : ''}
        ${this.#o.suspendre ? `<button type="button" data-suspendre="${p.id}" title="${echapper(texte('relance.liste.suspendre_titre'))}">${iconeHtml('relance_suspendre')}</button>` : ''}</td></tr>`;
    return `<section class="relance-dues"><h3>${echapper(texte('relance.liste.dues', { nombre: this.#dues.reduce((t, g) => t + g.pieces.length, 0) }))}</h3>
      ${tiers.map((t) => `<details open><summary>${echapper(t.tiers ?? this.#o.libelleTiers(t.tiers_id))} <span class="montant">${montant(t.montant)}</span></summary>
        ${t.groupes.map((g) => `<table class="relance-table"><caption>${echapper(g.charge ?? texte('relance.liste.sans_charge'))} · ${echapper(texte(`relance.natures.${g.nature}`))} ·
          ${echapper(texte(`relance.modes.${g.mode}`))} · ${echapper(texte('relance.niveau_n', { niveau: g.niveau }))}</caption><tbody>${g.pieces.map(piece).join('')}</tbody></table>`).join('')}</details>`).join('')}</section>`;
  }

  #naturePiece(id) {
    return this.#dues.find((g) => g.pieces.some((p) => p.id === id))?.nature ?? '';
  }

  #htmlAttentes() {
    if (!this.#attentes.length) return '';
    return `<section class="relance-attentes"><h3>${iconeHtml('relance_recommande')} ${texteHtml('relance.attente.titre')}</h3>
      <table class="relance-table"><tbody>${this.#attentes.map((a) => `<tr><td>${echapper(this.#o.libelleTiers(a.tiers_id))}</td><td>${formatDate(a.date)}</td>
        <td>${echapper(texte('relance.attente.pieces', { nombre: a.relances.length }))}</td><td class="montant">${montant(a.montant)}</td>
        <td>${this.#o.peut.valider ? `<button type="button" data-numero="${a.relances[0].id}">${iconeHtml('relance_numero')} ${texteHtml('relance.attente.saisir')}</button>` : ''}</td></tr>`).join('')}</tbody></table></section>`;
  }

  /* ---------- événements ---------- */

  #changement(e) {
    const t = e.target;
    if (t.matches('[data-date]')) { this.#date = t.value || aujourdhui(); this.charger(); return; }
    if (t.dataset.mode !== undefined && this.#lot) { this.#sel.get(Number(t.dataset.mode)).mode = t.valeurCombo; return; }
    if (t.dataset.relance !== undefined) {
      const g = this.#lot.groupes.find((x) => String(x.groupe) === t.dataset.groupe);
      basculerRelance(g, this.#sel.get(g.groupe), Number(t.dataset.relance), t.checked);
      this.#rendre();
    } else if (t.dataset.groupeCoche !== undefined) {
      const g = this.#lot.groupes.find((x) => String(x.groupe) === t.dataset.groupeCoche);
      basculerGroupe(g, this.#sel.get(g.groupe), t.checked);
      this.#rendre();
    }
  }

  #saisie(e) {
    const t = e.target;
    if (t.dataset.commentaire !== undefined && this.#lot) this.#sel.get(Number(t.dataset.commentaire)).commentaire = t.value;
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-actualiser]')) this.charger();
    else if (b.matches('[data-preparer]')) this.preparer();
    else if (b.matches('[data-valider]')) this.valider();
    else if (b.matches('[data-annuler-lot]')) this.annulerNonRetenues();
    else if (b.dataset.ouvrirPiece) this.#o.ouvrirPiece(Number(b.dataset.ouvrirPiece), e.ctrlKey || e.metaKey);
    else if (b.dataset.noter) this.#noter(Number(b.dataset.noter), b.dataset.nature);
    else if (b.dataset.suspendre) this.#o.suspendre(Number(b.dataset.suspendre));
    else if (b.dataset.numero) this.#numero(Number(b.dataset.numero));
  }

  #clavier(e) {
    const action = actionDe(e, GROUPE_RACCOURCIS);
    if (!action) return;
    if (action === 'valider' && this.#o.peut.valider) this.valider();
    else if (action === 'preparer' && this.#o.peut.creer) this.preparer();
    else if (action === 'actualiser') this.charger();
    else return;
    e.preventDefault();
  }

  async #ecrire(action) {
    try {
      const r = await action();
      this.#o.apresEcriture();
      return r;
    } catch (e) {
      this.#o.erreur(e);
      return undefined;
    } finally {
      await this.charger();
    }
  }

  /** Prépare un lot avec les relances dues à la date (rien à préparer : message). */
  async preparer() {
    const lot = await this.#ecrire(() => this.#o.api.preparer(this.#date));
    if (lot === null) await alerter(texte('relance.liste.rien_a_preparer'));
  }

  /** Valide les groupes cochés après confirmation ; les échecs d'envoi restent proposés et sont signalés. */
  async valider() {
    if (!this.#lot) return;
    const corps = corpsValidation(this.#lot, this.#sel);
    const nb = corps.groupes.length;
    if (!nb) return;
    const total = somme(this.#lot.groupes.flatMap((g) => proposees(g).filter((r) => this.#sel.get(g.groupe)?.retenues.has(r.id)).map((r) => r.montant)));
    if (!await confirmer(texte('relance.lot.confirmer', { groupes: nb, montant: montant(total) }), { titre: texte('relance.lot.confirmer_titre'), ok: texte('relance.lot.envoyer') })) return;
    const id = this.#lot.id;
    const r = await this.#ecrire(() => this.#o.api.valider(id, corps));
    if (r?.echecs?.length) {
      await alerter('', { titre: texte('relance.lot.echecs_titre'),
        html: `<ul>${r.echecs.map((x) => `<li>${echapper(texte('relance.lot.echec', { groupe: x.groupe }))} ${echapper(messageErreur(x.code, x.message))}</li>`).join('')}</ul>` });
    }
  }

  /** Annule les relances proposées non cochées du lot affiché (elles seront recalculées au prochain lot). */
  async annulerNonRetenues() {
    const ids = nonRetenues(this.#lot, this.#sel);
    if (!ids.length) { await alerter(texte('relance.lot.rien_a_annuler')); return; }
    if (!await confirmer(texte('relance.lot.confirmer_annulation', { nombre: ids.length }))) return;
    await this.#ecrire(() => this.#o.api.annuler(this.#lot.id, { relances: ids }));
  }

  async #numero(relanceId) {
    const numero = await saisir(texte('relance.attente.question'), '', { titre: texte('relance.attente.titre'), obligatoire: true });
    if (numero === null) return;
    await this.#ecrire(() => this.#o.api.numero(relanceId, { numero }));
  }

  /** Relance faite hors du module, notée au niveau dû (Q22 b) : mode et date. */
  async #noter(pieceId, nature) {
    let combo;
    let date;
    const corps = await ouvrirDialogue({
      titre: texte('relance.noter.titre'), valeurAnnulation: null,
      html: `<label>${texteHtml('relance.noter.mode')} <span data-mode></span></label>
        <label>${texteHtml('relance.noter.date')} <input type="date" data-date-notee value="${echapper(aujourdhui())}"></label>
        <label>${texteHtml('relance.lot.commentaire')} <input type="text" data-commentaire-notee></label>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: null },
        { libelle: texte('commun.ok'), principal: true, valeur: (d) => ({ piece_id: pieceId, mode: combo.valeurCombo, date: date.value || null, commentaire: d.querySelector('[data-commentaire-notee]').value.trim() || null }) }],
      construire: (d) => {
        combo = creerCombo({ options: modesAdmis(nature).map((m) => ({ valeur: m, libelle: texte(`relance.modes.${m}`) })), valeur: modesAdmis(nature)[0], vide: false });
        d.querySelector('[data-mode]').append(combo);
        date = d.querySelector('[data-date-notee]');
        champDate(date);
      },
    });
    if (corps) await this.#ecrire(() => this.#o.api.noter(corps));
  }
}
