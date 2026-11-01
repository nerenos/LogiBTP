import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, urlDocument, TYPE_FICHE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, lireNombre, creerCombo, confirmer } from '@logibtp/socle/ui';
import { Dz, aujourdhui } from '@logibtp/socle';
import { MODES_REGLEMENT } from '@logibtp/document';
import { proposerPointage, nonPointe, MODE_REGLEMENT_SYSTEME } from '@logibtp/reglement';
import { api } from '../api.js';

/** Date du jour (locale) au format ISO. */

/**
 * Règlements d'un tiers (module Règlements, CONCEPTION-MARCHES-REGLEMENTS.md, Q15 à Q18) : `/reglements?sens=E|D&tiers=`.
 * Échéances ouvertes des pièces validées (reste à payer), saisie d'un règlement avec pointage (répartition proposée :
 * plus ancienne d'abord), règlements du tiers (non pointé), cautions de retenue de garantie (lot F : la caution remplace la
 * retenue ; sa consommation, calculée par le serveur, rend la part cautionnée exigible avec la pièce et proposée à la
 * répartition à la date de la pièce ; la retenue non couverte reste due à la libération).
 * Périmètre d'un chantier ou d'un marché (lot 6 : A27) : `/reglements?chantier=` ou `?marche=` : échéances de ses pièces
 * validées, tous tiers, clients puis fournisseurs, avec le pointé et le reste ; le tiers ouvre sa page de pointage.
 */
export class PageReglements extends PageBase {
  icone = icone('reglements_btp_page');

  async ouvrir() {
    // Modes de règlement paramétrables (module Document), sinon la liste du module.
    this.modes = await api.modesReglement().then((l) => l.map((m) => [m.code, m.libelle, m.actif])).catch(() => MODES_REGLEMENT);
    const app = this.app;
    this.perimetre = this.requete.chantier ? { type: TYPE_FICHE.CHANTIER, id: Number(this.requete.chantier) }
      : this.requete.marche ? { type: TYPE_FICHE.MARCHE, id: Number(this.requete.marche) } : null;
    if (this.perimetre) { await this.#ouvrirPerimetre(); return; }
    this.sens = this.requete.sens === 'D' ? 'D' : 'E';
    this.titre = texte(this.sens === 'D' ? 'reglements_btp.titres.fournisseurs' : 'reglements_btp.titres.clients');
    this.conteneur.innerHTML = `<div class="page-parametres page-reglements"><h1 class="page-titre">${iconeHtml('reglements_btp_page')} ${echapper(this.titre)}</h1>
      <p>${texteHtml('reglements_btp.tiers')} <span data-tiers></span> <label class="fiche-option"><input type="checkbox" data-toutes> ${texteHtml('reglements_btp.toutes')}</label></p>
      <div data-corps><p class="aide">${texteHtml('reglements_btp.choisir_tiers')}</p></div></div>`;
    let tiers = [];
    try { tiers = (await api.tiersReglements()).filter((t) => t.sens === this.sens); } catch (e) { app.message(e.message, 'erreur'); }
    const combo = creerCombo({ options: tiers.map((t) => ({ valeur: t.id, libelle: t.nom })), valeur: this.requete.tiers ? Number(this.requete.tiers) : '' });
    combo.addEventListener('change', () => { this.tiers = combo.valeurCombo === '' ? null : Number(combo.valeurCombo); this.rendre(); });
    this.conteneur.querySelector('[data-tiers]').replaceWith(combo);
    this.conteneur.querySelector('[data-toutes]').addEventListener('change', (e) => { this.toutes = e.target.checked; this.rendre(); });
    this.tiers = this.requete.tiers ? Number(this.requete.tiers) : null;
    if (this.tiers) await this.rendre();
  }

  /** Échéances d'un chantier ou d'un marché, tous tiers (lecture ; pointage dans la page du tiers). */
  async #ouvrirPerimetre() {
    const { type, id } = this.perimetre;
    this.titre = texte(type === TYPE_FICHE.CHANTIER ? 'reglements_btp.titres.chantier' : 'reglements_btp.titres.marche');
    this.conteneur.innerHTML = `<div class="page-parametres page-reglements"><div class="entete-page"><h1 class="page-titre">${iconeHtml('reglements_btp_page')} ${echapper(this.titre)} <a href="${urlFiche(type, id)}" data-element></a></h1>
      <label class="fiche-option"><input type="checkbox" data-toutes> ${texteHtml('reglements_btp.toutes')}</label></div><div data-corps></div></div>`;
    this.conteneur.querySelector('[data-toutes]').addEventListener('change', (e) => { this.toutes = e.target.checked; this.#rendrePerimetre(); });
    const { structure } = await this.app.services();
    const refs = await structure.referentiels().catch(() => ({}));
    const el = (refs[type === TYPE_FICHE.CHANTIER ? 'chantiers' : 'marches'] ?? []).find((x) => x.id === id);
    if (el) this.conteneur.querySelector('[data-element]').textContent = `${el.code} – ${el.libelle ?? ''}`;
    await this.#rendrePerimetre();
  }

  async #rendrePerimetre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    let l;
    try { l = await api.echeancesStructure(this.perimetre.type, this.perimetre.id, false); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const f = (v) => formatNombre(v ?? 0, 2);
    const visibles = this.toutes ? l : l.filter((e) => !e.reglee);
    const bloc = (sens, titre) => {
      const lignes = visibles.filter((e) => e.sens === sens);
      if (!lignes.length) return `<h2>${titre}</h2><p class="aide">${texteHtml(this.toutes ? 'reglements_btp.aucune_echeance' : 'reglements_btp.aucune_echeance_ouverte')}</p>`;
      const total = (cle) => lignes.reduce((t, e) => t.plus(Dz(e[cle])), Dz(0)).toString();
      return `<h2>${titre}</h2><table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('reglements_btp.colonnes.tiers')}</th><th>${texteHtml('reglements_btp.colonnes.piece')}</th><th>${texteHtml('reglements_btp.colonnes.type')}</th><th>${texteHtml('reglements_btp.colonnes.echeance')}</th>
        <th class="nombre">${texteHtml('reglements_btp.colonnes.montant')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.pointe')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.reste')}</th></tr></thead><tbody>
        ${lignes.map((e) => `<tr${e.reglee ? ' class="discret"' : ''}><td><a href="/reglements?sens=${sens}&tiers=${Number(e.tiers_id)}" title="${texteHtml('reglements_btp.pointer_tiers')}">${echapper(e.tiers ?? '')}</a></td>
          <td><a href="${urlDocument(Number(e.piece_id))}">${echapper(e.piece ?? `#${e.piece_id}`)}</a></td><td>${echapper(e.type)}</td>
          <td>${e.nature === 'RETENUE' ? `${texteHtml('reglements_btp.retenue')}${e.date ? ` · ${echapper(e.date)}` : ''}` : echapper(e.date ?? '')}</td>
          <td class="nombre">${f(e.montant)}</td><td class="nombre">${f(e.pointe)}</td><td class="nombre">${f(e.reste)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4">${texteHtml('commun.total')}</th><th class="nombre">${f(total('montant'))}</th><th class="nombre">${f(total('pointe'))}</th><th class="nombre">${f(total('reste'))}</th></tr></tfoot></table>`;
    };
    corps.innerHTML = bloc('E', texteHtml('reglements_btp.blocs.E')) + bloc('D', texteHtml('reglements_btp.blocs.D'));
  }

  urlCourante() {
    if (this.perimetre) return `/reglements?${this.perimetre.type}=${this.perimetre.id}`;
    return `/reglements?sens=${this.sens}${this.tiers ? `&tiers=${this.tiers}` : ''}`;
  }

  async rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.tiers) { corps.innerHTML = `<p class="aide">${texteHtml('reglements_btp.choisir_tiers')}</p>`; return; }
    let toutes; let reglements; let cautions;
    try {
      [toutes, reglements, cautions] = await Promise.all([
        api.echeancesReglement({ tiers: this.tiers, sens: this.sens }),
        api.reglements({ tiers: this.tiers, sens: this.sens }),
        api.cautions({ tiers: this.tiers }),
      ]);
    } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const f = (v) => formatNombre(v ?? 0, 2);
    // Toutes les échéances du tiers (pièces des règlements), affichées ouvertes seulement sauf demande.
    const parId = new Map(toutes.map((e) => [e.id, e]));
    // Marchés des retenues du tiers (portée d'une caution), libellés par les référentiels de la structure.
    const idsMarches = [...new Set(toutes.filter((e) => e.nature === 'RETENUE' && e.objet_id).map((e) => Number(e.objet_id)))];
    const refs = idsMarches.length ? await this.app.services().then(({ structure }) => structure.referentiels()).catch(() => ({})) : {};
    const marches = new Map(idsMarches.map((id) => {
      const m = (refs.marches ?? []).find((x) => x.id === id);
      return [id, m ? `${m.code}${m.libelle ? ` – ${m.libelle}` : ''}` : texte('reglements_btp.marche_id', { id })];
    }));
    const echeances = this.toutes ? toutes : toutes.filter((e) => !e.reglee);
    const NATURE_RETENUE = 'RETENUE';
    // Échéance proposée à la répartition : normale (son reste), ou part cautionnée d'une retenue (datée de la pièce).
    const aRepartir = (e) => (e.nature !== NATURE_RETENUE ? { id: e.id, date: e.date, reste: e.reste }
      : !Dz(e.exigible_caution ?? 0).isZero() ? { id: e.id, date: e.date ?? e.date_piece, reste: e.exigible_caution }
        : e.date ? { id: e.id, date: e.date, reste: e.reste } : null);
    const lien = (e) => `<a href="${urlDocument(Number(e.piece_id))}">${echapper(e.piece ?? `#${e.piece_id}`)}</a>`;
    corps.innerHTML = `
      <h2>${texteHtml('reglements_btp.echeances')}</h2>
      ${echeances.length ? `<table><thead><tr><th>${texteHtml('reglements_btp.colonnes.piece')}</th><th>${texteHtml('reglements_btp.colonnes.type')}</th><th>${texteHtml('reglements_btp.colonnes.echeance')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.montant')}</th><th class="nombre" title="${texteHtml('reglements_btp.colonnes.cautionne_aide')}">${texteHtml('reglements_btp.colonnes.cautionne')}</th>
        <th class="nombre">${texteHtml('reglements_btp.colonnes.pointe')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.reste')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.a_pointer')}</th></tr></thead><tbody>${echeances.map((e) => `<tr${e.reglee ? ' class="discret"' : ''}>
        <td>${lien(e)}</td><td>${echapper(e.type)}</td><td>${e.nature === 'RETENUE' ? `${texteHtml('reglements_btp.retenue')}${e.date ? ` · ${echapper(e.date)}` : ''}` : echapper(e.date ?? '')}</td>
        <td class="nombre">${f(e.montant)}</td><td class="nombre">${Dz(e.cautionne ?? 0).isZero() ? '' : f(e.cautionne)}</td>
        <td class="nombre">${f(e.pointe)}</td><td class="nombre">${f(e.reste)}</td>
        <td class="nombre"><input data-pointer="${e.id}" size="10" inputmode="decimal" ${e.reglee ? 'disabled' : ''}></td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('reglements_btp.aucune_echeance_ouverte')}</p>`}
      <h2>${texteHtml('reglements_btp.nouveau')}</h2>
      <div class="formulaire">
        <label>${texteHtml('reglements_btp.champs.date')} <input type="date" data-r="date" value="${aujourdhui()}"></label>
        <label>${texteHtml('reglements_btp.champs.mode')} <span data-r="mode"></span></label>
        <label>${texteHtml('reglements_btp.champs.montant')} <input data-r="montant" size="12" inputmode="decimal"></label>
        <label>${texteHtml('reglements_btp.champs.reference')} <input data-r="reference" maxlength="100"></label>
        <button type="button" data-repartir title="${texteHtml('reglements_btp.repartir_aide')}">${texteHtml('reglements_btp.repartir')}</button>
        <button type="button" class="principal" data-enregistrer>${texteHtml('reglements_btp.enregistrer')}</button>
      </div>
      <h2>${texteHtml('reglements_btp.reglements')}</h2>
      ${reglements.length ? `<table><thead><tr><th>${texteHtml('reglements_btp.colonnes.date')}</th><th>${texteHtml('reglements_btp.colonnes.mode')}</th><th>${texteHtml('reglements_btp.colonnes.reference')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.montant')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.non_pointe')}</th><th>${texteHtml('reglements_btp.colonnes.pieces')}</th><th></th></tr></thead>
        <tbody>${reglements.map((r) => `<tr><td>${echapper(r.date)}</td><td>${r.mode === MODE_REGLEMENT_SYSTEME.IMPUTATION ? texteHtml('reglements_btp.imputation') : echapper(this.modes.find(([c]) => c === r.mode)?.[1] ?? r.mode)}</td>
        <td>${echapper(r.reference ?? '')}</td><td class="nombre">${f(r.montant)}</td><td class="nombre">${f(r.non_pointe)}</td>
        <td>${r.pointages.map((p) => echapper(parId.get(p.echeance_id)?.piece ?? texte('reglements_btp.echeance_id', { id: p.echeance_id }))).join(', ')}</td>
        <td><button type="button" data-supprimer="${r.id}" title="${texteHtml('reglements_btp.supprimer_aide')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('reglements_btp.aucun')}</p>`}
      <h2>${texteHtml('reglements_btp.cautions.titre')}</h2>
      ${cautions.length ? `<table><thead><tr><th>${texteHtml('reglements_btp.colonnes.organisme')}</th><th>${texteHtml('reglements_btp.colonnes.reference')}</th><th>${texteHtml('reglements_btp.colonnes.date')}</th><th>${texteHtml('reglements_btp.colonnes.fin')}</th><th>${texteHtml('reglements_btp.colonnes.mainlevee')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.montant')}</th>
        <th class="nombre">${texteHtml('reglements_btp.colonnes.consomme')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.disponible')}</th><th>${texteHtml('reglements_btp.colonnes.portee')}</th><th>${texteHtml('reglements_btp.colonnes.couvertes')}</th><th></th></tr></thead><tbody>${cautions.map((c) => `<tr><td>${echapper(c.organisme)}</td><td>${echapper(c.reference ?? '')}</td>
        <td>${echapper(c.date)}</td><td>${echapper(c.date_fin ?? '')}</td><td>${echapper(c.mainlevee ?? '')}</td><td class="nombre">${f(c.montant)}</td>
        <td class="nombre">${f(c.consomme)}</td><td class="nombre">${f(c.non_pointe)}</td><td>${c.objet_id ? echapper(marches.get(c.objet_id) ?? texte('reglements_btp.marche_id', { id: c.objet_id })) : texteHtml('reglements_btp.cautions.toutes')}</td>
        <td>${c.pointages.map((p) => `${echapper(parId.get(p.echeance_id)?.piece ?? texte('reglements_btp.echeance_id', { id: p.echeance_id }))} (${f(p.montant)})`).join(', ')}</td>
        <td><button type="button" data-supprimer-caution="${c.id}" title="${texteHtml('reglements_btp.cautions.supprimer_aide')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('reglements_btp.cautions.aucune')}</p>`}
      <p class="aide">${texteHtml('reglements_btp.cautions.aide')}</p>
      <div class="formulaire">
        <label>${texteHtml('reglements_btp.colonnes.organisme')} <input data-c="organisme" maxlength="150"></label>
        <label>${texteHtml('reglements_btp.champs.montant')} <input data-c="montant" size="12" inputmode="decimal"></label>
        <label>${texteHtml('reglements_btp.champs.date')} <input type="date" data-c="date" value="${aujourdhui()}"></label>
        <label>${texteHtml('reglements_btp.colonnes.fin')} <input type="date" data-c="date_fin"></label>
        <label>${texteHtml('reglements_btp.colonnes.mainlevee')} <input type="date" data-c="mainlevee"></label>
        <label>${texteHtml('reglements_btp.champs.reference')} <input data-c="reference" maxlength="100"></label>
        <label>${texteHtml('reglements_btp.colonnes.portee')} <span data-c-portee></span></label>
        <button type="button" data-caution title="${texteHtml('reglements_btp.cautions.ajouter_aide')}">${iconeHtml('ajouter')} ${texteHtml('reglements_btp.cautions.ajouter')}</button>
      </div>`;
    const mode = creerCombo({ options: this.modes.filter(([, , actif]) => actif !== false).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: this.modes[0]?.[0] ?? 'VIREMENT', vide: false });
    corps.querySelector('[data-r="mode"]').replaceWith(mode);
    const portee = creerCombo({ options: [{ valeur: '', libelle: texte('reglements_btp.cautions.toutes_tiers') }, ...[...marches].map(([valeur, libelle]) => ({ valeur, libelle }))],
      valeur: marches.size === 1 ? [...marches.keys()][0] : '', vide: false });
    corps.querySelector('[data-c-portee]').replaceWith(portee);
    const champ = (cle) => corps.querySelector(`[data-r="${cle}"]`);
    const pointages = () => [...corps.querySelectorAll('[data-pointer]')].map((el) => ({ echeance_id: Number(el.dataset.pointer), montant: lireNombre(el.value) }))
      .filter((p) => p.montant !== null && p.montant !== undefined && !Dz(p.montant).isZero());
    corps.querySelector('[data-repartir]').addEventListener('click', () => {
      const montant = lireNombre(champ('montant').value);
      if (montant === null || montant === undefined) { this.app.message(texte('reglements_btp.messages.montant'), 'avertissement'); return; }
      const proposes = new Map(proposerPointage(montant, echeances.filter((e) => !e.reglee).map(aRepartir).filter(Boolean))
        .map((p) => [p.id, p.montant]));
      corps.querySelectorAll('[data-pointer]').forEach((el) => { el.value = proposes.has(Number(el.dataset.pointer)) ? formatNombre(proposes.get(Number(el.dataset.pointer)), 2) : ''; });
      const reste = nonPointe(montant, [...proposes.values()].map((m) => ({ montant: m })));
      if (!Dz(reste).isZero()) this.app.message(texte('reglements_btp.messages.trop_percu', { montant: formatNombre(reste, 2) }), 'avertissement');
    });
    corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const montant = lireNombre(champ('montant').value);
      if (montant === null || montant === undefined || Dz(montant).isZero()) { this.app.message(texte('reglements_btp.messages.montant'), 'avertissement'); return; }
      try {
        await api.enregistrerReglement({
          tiers_id: this.tiers, sens: this.sens, date: champ('date').value, mode: mode.valeurCombo, montant,
          reference: champ('reference').value.trim() || null, commentaire: null, pointages: pointages(),
        });
        this.app.message(texte('reglements_btp.messages.enregistre'), 'succes');
        await this.rendre();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
    corps.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmer(texte('reglements_btp.messages.supprimer')))) return;
      try { await api.supprimerReglement(Number(b.dataset.supprimer)); await this.rendre(); } catch (e) { this.app.message(e.message, 'erreur'); }
    }));
    corps.querySelectorAll('[data-supprimer-caution]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmer(texte('reglements_btp.messages.supprimer_caution')))) return;
      try { await api.supprimerCaution(Number(b.dataset.supprimerCaution)); await this.rendre(); } catch (e) { this.app.message(e.message, 'erreur'); }
    }));
    corps.querySelector('[data-caution]').addEventListener('click', async () => {
      const c = (cle) => corps.querySelector(`[data-c="${cle}"]`).value.trim();
      const montant = lireNombre(c('montant'));
      if (!c('organisme') || montant === null || montant === undefined || Dz(montant).lte(0)) { this.app.message(texte('reglements_btp.messages.caution_incomplete'), 'avertissement'); return; }
      // La consommation sur les retenues est calculée par le serveur (aucun pointage).
      const objet = portee.valeurCombo === '' ? null : Number(portee.valeurCombo);
      try {
        await api.enregistrerCaution({
          tiers_id: this.tiers, objet: objet ? 'marche' : null, objet_id: objet, organisme: c('organisme'), montant, date: c('date'),
          date_fin: c('date_fin') || null, reference: c('reference') || null, mainlevee: c('mainlevee') || null,
        });
        this.app.message(texte('reglements_btp.messages.caution_enregistree'), 'succes');
        await this.rendre();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }
}
