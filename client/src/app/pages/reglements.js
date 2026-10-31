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
  icone = '💳';

  async ouvrir() {
    // Modes de règlement paramétrables (module Document), sinon la liste du module.
    this.modes = await api.modesReglement().then((l) => l.map((m) => [m.code, m.libelle, m.actif])).catch(() => MODES_REGLEMENT);
    const app = this.app;
    this.perimetre = this.requete.chantier ? { type: TYPE_FICHE.CHANTIER, id: Number(this.requete.chantier) }
      : this.requete.marche ? { type: TYPE_FICHE.MARCHE, id: Number(this.requete.marche) } : null;
    if (this.perimetre) { await this.#ouvrirPerimetre(); return; }
    this.sens = this.requete.sens === 'D' ? 'D' : 'E';
    this.titre = this.sens === 'D' ? 'Règlements fournisseurs' : 'Règlements clients';
    this.conteneur.innerHTML = `<div class="page-parametres page-reglements"><h1 class="page-titre">💳 ${echapper(this.titre)}</h1>
      <p>Tiers <span data-tiers></span> <label class="fiche-option"><input type="checkbox" data-toutes> Échéances réglées aussi</label></p>
      <div data-corps><p class="aide">Choisissez un tiers.</p></div></div>`;
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
    const libelle = type === TYPE_FICHE.CHANTIER ? 'chantier' : 'marché';
    this.titre = `Échéances du ${libelle}`;
    this.conteneur.innerHTML = `<div class="page-parametres page-reglements"><div class="entete-page"><h1 class="page-titre">💳 ${echapper(this.titre)} <a href="${urlFiche(type, id)}" data-element></a></h1>
      <label class="fiche-option"><input type="checkbox" data-toutes> Échéances réglées aussi</label></div><div data-corps></div></div>`;
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
      if (!lignes.length) return `<h2>${titre}</h2><p class="aide">Aucune échéance${this.toutes ? '' : ' ouverte'}.</p>`;
      const total = (cle) => lignes.reduce((t, e) => t.plus(Dz(e[cle])), Dz(0)).toString();
      return `<h2>${titre}</h2><table class="tableau-compact largeur-contenu"><thead><tr><th>Tiers</th><th>Pièce</th><th>Type</th><th>Échéance</th>
        <th class="nombre">Montant</th><th class="nombre">Pointé</th><th class="nombre">Reste</th></tr></thead><tbody>
        ${lignes.map((e) => `<tr${e.reglee ? ' class="discret"' : ''}><td><a href="/reglements?sens=${sens}&tiers=${Number(e.tiers_id)}" title="Pointer les règlements de ce tiers">${echapper(e.tiers ?? '')}</a></td>
          <td><a href="${urlDocument(Number(e.piece_id))}">${echapper(e.piece ?? `#${e.piece_id}`)}</a></td><td>${echapper(e.type)}</td>
          <td>${e.nature === 'RETENUE' ? `Retenue de garantie${e.date ? ` · ${echapper(e.date)}` : ''}` : echapper(e.date ?? '')}</td>
          <td class="nombre">${f(e.montant)}</td><td class="nombre">${f(e.pointe)}</td><td class="nombre">${f(e.reste)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4">Total</th><th class="nombre">${f(total('montant'))}</th><th class="nombre">${f(total('pointe'))}</th><th class="nombre">${f(total('reste'))}</th></tr></tfoot></table>`;
    };
    corps.innerHTML = bloc('E', 'Clients : encaissements') + bloc('D', 'Fournisseurs et sous-traitants : décaissements');
  }

  urlCourante() {
    if (this.perimetre) return `/reglements?${this.perimetre.type}=${this.perimetre.id}`;
    return `/reglements?sens=${this.sens}${this.tiers ? `&tiers=${this.tiers}` : ''}`;
  }

  async rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.tiers) { corps.innerHTML = '<p class="aide">Choisissez un tiers.</p>'; return; }
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
      return [id, m ? `${m.code}${m.libelle ? ` – ${m.libelle}` : ''}` : `Marché #${id}`];
    }));
    const echeances = this.toutes ? toutes : toutes.filter((e) => !e.reglee);
    const NATURE_RETENUE = 'RETENUE';
    // Échéance proposée à la répartition : normale (son reste), ou part cautionnée d'une retenue (datée de la pièce).
    const aRepartir = (e) => (e.nature !== NATURE_RETENUE ? { id: e.id, date: e.date, reste: e.reste }
      : !Dz(e.exigible_caution ?? 0).isZero() ? { id: e.id, date: e.date ?? e.date_piece, reste: e.exigible_caution }
        : e.date ? { id: e.id, date: e.date, reste: e.reste } : null);
    const lien = (e) => `<a href="${urlDocument(Number(e.piece_id))}">${echapper(e.piece ?? `#${e.piece_id}`)}</a>`;
    corps.innerHTML = `
      <h2>Échéances</h2>
      ${echeances.length ? `<table><thead><tr><th>Pièce</th><th>Type</th><th>Échéance</th><th class="nombre">Montant</th><th class="nombre" title="Retenue de garantie : part couverte par une caution, exigible avec la pièce">Dont cautionné</th>
        <th class="nombre">Pointé</th><th class="nombre">Reste</th><th class="nombre">À pointer</th></tr></thead><tbody>${echeances.map((e) => `<tr${e.reglee ? ' class="discret"' : ''}>
        <td>${lien(e)}</td><td>${echapper(e.type)}</td><td>${e.nature === 'RETENUE' ? `Retenue de garantie${e.date ? ` · ${echapper(e.date)}` : ''}` : echapper(e.date ?? '')}</td>
        <td class="nombre">${f(e.montant)}</td><td class="nombre">${Dz(e.cautionne ?? 0).isZero() ? '' : f(e.cautionne)}</td>
        <td class="nombre">${f(e.pointe)}</td><td class="nombre">${f(e.reste)}</td>
        <td class="nombre"><input data-pointer="${e.id}" size="10" inputmode="decimal" ${e.reglee ? 'disabled' : ''}></td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucune échéance ouverte.</p>'}
      <h2>Nouveau règlement</h2>
      <div class="formulaire">
        <label>Date <input type="date" data-r="date" value="${aujourdhui()}"></label>
        <label>Mode <span data-r="mode"></span></label>
        <label>Montant <input data-r="montant" size="12" inputmode="decimal"></label>
        <label>Référence <input data-r="reference" maxlength="100"></label>
        <button type="button" data-repartir title="Répartit le montant sur les échéances, de la plus ancienne à la plus récente">Répartir</button>
        <button type="button" class="principal" data-enregistrer>Enregistrer le règlement</button>
      </div>
      <h2>Règlements</h2>
      ${reglements.length ? `<table><thead><tr><th>Date</th><th>Mode</th><th>Référence</th><th class="nombre">Montant</th><th class="nombre">Non pointé</th><th>Pièces</th><th></th></tr></thead>
        <tbody>${reglements.map((r) => `<tr><td>${echapper(r.date)}</td><td>${r.mode === MODE_REGLEMENT_SYSTEME.IMPUTATION ? 'Imputation d\'avoir' : echapper(this.modes.find(([c]) => c === r.mode)?.[1] ?? r.mode)}</td>
        <td>${echapper(r.reference ?? '')}</td><td class="nombre">${f(r.montant)}</td><td class="nombre">${f(r.non_pointe)}</td>
        <td>${r.pointages.map((p) => echapper(parId.get(p.echeance_id)?.piece ?? `échéance ${p.echeance_id}`)).join(', ')}</td>
        <td><button type="button" data-supprimer="${r.id}" title="Supprimer le règlement et ses pointages">✕</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucun règlement.</p>'}
      <h2>Cautions</h2>
      ${cautions.length ? `<table><thead><tr><th>Organisme</th><th>Référence</th><th>Date</th><th>Fin</th><th>Mainlevée</th><th class="nombre">Montant</th>
        <th class="nombre">Consommé</th><th class="nombre">Disponible</th><th>Portée</th><th>Pièces couvertes</th><th></th></tr></thead><tbody>${cautions.map((c) => `<tr><td>${echapper(c.organisme)}</td><td>${echapper(c.reference ?? '')}</td>
        <td>${echapper(c.date)}</td><td>${echapper(c.date_fin ?? '')}</td><td>${echapper(c.mainlevee ?? '')}</td><td class="nombre">${f(c.montant)}</td>
        <td class="nombre">${f(c.consomme)}</td><td class="nombre">${f(c.non_pointe)}</td><td>${c.objet_id ? echapper(marches.get(c.objet_id) ?? `Marché #${c.objet_id}`) : 'Toutes les retenues'}</td>
        <td>${c.pointages.map((p) => `${echapper(parId.get(p.echeance_id)?.piece ?? `échéance ${p.echeance_id}`)} (${f(p.montant)})`).join(', ')}</td>
        <td><button type="button" data-supprimer-caution="${c.id}" title="Supprimer la caution">✕</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucune caution.</p>'}
      <p class="aide">Une caution remplace la retenue de garantie : la part cautionnée est exigible avec la pièce ; elle se consomme sur les retenues les plus anciennes, la retenue non couverte reste due à la libération.</p>
      <div class="formulaire">
        <label>Organisme <input data-c="organisme" maxlength="150"></label>
        <label>Montant <input data-c="montant" size="12" inputmode="decimal"></label>
        <label>Date <input type="date" data-c="date" value="${aujourdhui()}"></label>
        <label>Fin <input type="date" data-c="date_fin"></label>
        <label>Mainlevée <input type="date" data-c="mainlevee"></label>
        <label>Référence <input data-c="reference" maxlength="100"></label>
        <label>Portée <span data-c-portee></span></label>
        <button type="button" data-caution title="Couvre les retenues de garantie de la portée, de la plus ancienne à la plus récente">＋ Caution</button>
      </div>`;
    const mode = creerCombo({ options: this.modes.filter(([, , actif]) => actif !== false).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: this.modes[0]?.[0] ?? 'VIREMENT', vide: false });
    corps.querySelector('[data-r="mode"]').replaceWith(mode);
    const portee = creerCombo({ options: [{ valeur: '', libelle: 'Toutes les retenues du tiers' }, ...[...marches].map(([valeur, libelle]) => ({ valeur, libelle }))],
      valeur: marches.size === 1 ? [...marches.keys()][0] : '', vide: false });
    corps.querySelector('[data-c-portee]').replaceWith(portee);
    const champ = (cle) => corps.querySelector(`[data-r="${cle}"]`);
    const pointages = () => [...corps.querySelectorAll('[data-pointer]')].map((el) => ({ echeance_id: Number(el.dataset.pointer), montant: lireNombre(el.value) }))
      .filter((p) => p.montant !== null && p.montant !== undefined && !Dz(p.montant).isZero());
    corps.querySelector('[data-repartir]').addEventListener('click', () => {
      const montant = lireNombre(champ('montant').value);
      if (montant === null || montant === undefined) { this.app.message('Montant du règlement à saisir', 'avertissement'); return; }
      const proposes = new Map(proposerPointage(montant, echeances.filter((e) => !e.reglee).map(aRepartir).filter(Boolean))
        .map((p) => [p.id, p.montant]));
      corps.querySelectorAll('[data-pointer]').forEach((el) => { el.value = proposes.has(Number(el.dataset.pointer)) ? formatNombre(proposes.get(Number(el.dataset.pointer)), 2) : ''; });
      const reste = nonPointe(montant, [...proposes.values()].map((m) => ({ montant: m })));
      if (!Dz(reste).isZero()) this.app.message(`Non pointé : ${formatNombre(reste, 2)} (trop-perçu)`, 'avertissement');
    });
    corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const montant = lireNombre(champ('montant').value);
      if (montant === null || montant === undefined || Dz(montant).isZero()) { this.app.message('Montant du règlement à saisir', 'avertissement'); return; }
      try {
        await api.enregistrerReglement({
          tiers_id: this.tiers, sens: this.sens, date: champ('date').value, mode: mode.valeurCombo, montant,
          reference: champ('reference').value.trim() || null, commentaire: null, pointages: pointages(),
        });
        this.app.message('Règlement enregistré', 'succes');
        await this.rendre();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
    corps.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmer('Supprimer ce règlement et ses pointages ?'))) return;
      try { await api.supprimerReglement(Number(b.dataset.supprimer)); await this.rendre(); } catch (e) { this.app.message(e.message, 'erreur'); }
    }));
    corps.querySelectorAll('[data-supprimer-caution]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmer('Supprimer cette caution ? Les retenues qu\'elle couvrait redeviennent dues à la libération.'))) return;
      try { await api.supprimerCaution(Number(b.dataset.supprimerCaution)); await this.rendre(); } catch (e) { this.app.message(e.message, 'erreur'); }
    }));
    corps.querySelector('[data-caution]').addEventListener('click', async () => {
      const c = (cle) => corps.querySelector(`[data-c="${cle}"]`).value.trim();
      const montant = lireNombre(c('montant'));
      if (!c('organisme') || montant === null || montant === undefined || Dz(montant).lte(0)) { this.app.message('Organisme et montant de la caution à saisir', 'avertissement'); return; }
      // La consommation sur les retenues est calculée par le serveur (aucun pointage).
      const objet = portee.valeurCombo === '' ? null : Number(portee.valeurCombo);
      try {
        await api.enregistrerCaution({
          tiers_id: this.tiers, objet: objet ? 'marche' : null, objet_id: objet, organisme: c('organisme'), montant, date: c('date'),
          date_fin: c('date_fin') || null, reference: c('reference') || null, mainlevee: c('mainlevee') || null,
        });
        this.app.message('Caution enregistrée', 'succes');
        await this.rendre();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }
}
