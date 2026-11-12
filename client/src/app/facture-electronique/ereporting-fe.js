// Facturation électronique, lot 28 (Q20) : onglet « E-reporting » de la page Facturation électronique. LogiBTP collecte les
// ventes B2C (particuliers, non-assujettis) et internationales et leurs encaissements, les extrait en flux 10 (10.1 à
// 10.4) et les transmet à la plateforme, en un envoi par sous-flux et par période ou en plusieurs envois par jour selon
// le découpage choisi dans les paramètres du module. Liste des périodes (préparée, envoyée, acceptée, rejetée), préparation
// d'une période (nature et jour), envoi, correction d'une période envoyée (transmissions rectificatives), relance d'une
// période rejetée, détail (envois, écarts du contrôle, chronologie des flux). Option de la société : régime de TVA
// (périodicité) et matricule de la plateforme, avec le droit de paramétrage. Le serveur calcule tout
// (Btp/EreportingBtp.cs) : l'écran n'affiche que ses montants. Fenêtres de confirmation du socle.

import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre, formatDate, creerCombo, activerDates } from '@logibtp/socle/ui';
import { REGIME_EREPORTING } from '@logibtp/facture-electronique';
import { Chronologie, libelleEtat } from '@logibtp/facture-electronique/ui';
import { NATURE_PERIODE_EREPORTING, TYPE_ELEMENT_FE } from '../codes.js';

const T = 'facture_electronique_btp.ereporting';

/** Clé de texte d'un sous-flux (« 10.3 » → « 10_3 » : le point sépare les niveaux du dictionnaire). */
export const cleSousFlux = (s) => String(s).replace('.', '_');

/** Libellé d'une période : « Transactions du 01/09/2026 au 30/09/2026 ». */
export function libellePeriode(p) {
  return texte(`${T}.periode`, { nature: texte(`${T}.natures.${p.nature}`), debut: formatDate(p.debut), fin: formatDate(p.fin) });
}

/** Résumé d'une préparation (pièces et montants, selon la nature). */
export function resumeEreportingTexte(p) {
  const r = p.resume ?? {};
  return p.nature === NATURE_PERIODE_EREPORTING.PAIEMENTS
    ? texte(`${T}.resume_paiements`, { b2c: r.encaissements_b2c ?? 0, international: r.encaissements_internationaux ?? 0, encaisse: formatNombre(r.total_encaisse ?? 0, 2) })
    : texte(`${T}.resume_transactions`, { b2c: r.ventes_b2c ?? 0, international: r.factures_internationales ?? 0, ht: formatNombre(r.total_ht ?? 0, 2), tva: formatNombre(r.total_tva ?? 0, 2) });
}

/** Pastille de l'état d'une période. */
export function pastillePeriodeHtml(etat) {
  return `<span class="pastille ereporting-etat" data-etat-periode="${echapper(etat)}">${iconeHtml(`facture_electronique_btp_ereporting_${String(etat).toLowerCase()}`)} ${texteHtml(`${T}.etats.${etat}`)}</span>`;
}

/** Actions proposées sur une période selon le serveur (envoyable, corrigeable, relançable) et le droit Modifier. */
export function actionsPeriode(p, peutModifier) {
  if (!peutModifier) return [];
  return [p.envoyable && 'envoyer', p.corrigeable && 'corriger', p.relancable && 'relancer'].filter(Boolean);
}

/** Tableau des périodes (vide : message). */
export function periodesEreportingHtml(periodes, { peutModifier = false } = {}) {
  if (!periodes?.length) return `<p class="aide" data-ereporting-vide>${texteHtml(`${T}.aucune`)}</p>`;
  const bouton = (p, a) => `<button type="button" data-action-periode="${a}" data-periode="${p.id}" title="${texteHtml(`${T}.actions.${a}_aide`)}">${iconeHtml(`facture_electronique_btp_ereporting_${a}`)} ${texteHtml(`${T}.actions.${a}`)}</button>`;
  const lignes = periodes.map((p) => `<tr data-periode-ligne="${p.id}">
      <td><a href="#" data-detail-periode="${p.id}">${echapper(libellePeriode(p))}</a></td>
      <td>${pastillePeriodeHtml(p.etat)}</td>
      <td class="nombre">${echapper(p.correction)}</td><td class="nombre">${echapper(p.envois?.length ?? 0)}</td>
      <td>${echapper(resumeEreportingTexte(p))}${p.ecarts?.length ? ` <span class="pastille" data-ecarts>${iconeHtml('facture_electronique_btp_ereporting_ecart')} ${texteHtml(`${T}.ecarts_nombre`, { nombre: p.ecarts.length })}</span>` : ''}</td>
      <td class="cellule-boutons">${actionsPeriode(p, peutModifier).map((a) => bouton(p, a)).join('')}</td></tr>`).join('');
  const t = (c) => `<th>${texteHtml(`${T}.colonnes.${c}`)}</th>`;
  return `<table class="tableau-compact" data-periodes><thead><tr>${['periode', 'etat', 'correction', 'envois', 'resume', 'actions'].map(t).join('')}</tr></thead><tbody>${lignes}</tbody></table>`;
}

/** Détail d'une période : écarts du contrôle, envois (tous les essais et corrections), pièces écartées. */
export function detailPeriodeHtml(p) {
  const ecarts = p.ecarts?.length
    ? `<h3>${texteHtml(`${T}.ecarts`)}</h3><table class="tableau-compact" data-ecarts-periode><thead><tr>${['sous_flux', 'jour', 'regle', 'donnee', 'rang'].map((c) => `<th>${texteHtml(`${T}.colonnes_ecarts.${c}`)}</th>`).join('')}</tr></thead>
      <tbody>${p.ecarts.map((e) => `<tr><td>${echapper(e.sous_flux)}</td><td>${echapper(formatDate(e.jour))}</td><td>${echapper(e.regle)}</td><td>${echapper(e.donnee)}</td><td class="nombre">${echapper(e.rang)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const envois = p.envois?.length
    ? `<table class="tableau-compact" data-envois-periode><thead><tr>${['sous_flux', 'jour', 'identifiant', 'type', 'elements', 'flux'].map((c) => `<th>${texteHtml(`${T}.colonnes_envois.${c}`)}</th>`).join('')}</tr></thead>
      <tbody>${p.envois.map((e) => `<tr data-envoi="${e.id}"><td>${echapper(texte(`${T}.sous_flux.${cleSousFlux(e.sous_flux)}`))}</td><td>${echapper(formatDate(e.jour))}</td><td>${echapper(e.identifiant)}</td>
        <td>${echapper(texte(`${T}.types.${e.type}`))}</td><td class="nombre">${echapper(e.elements)}</td>
        <td>${e.flux_id ? `<a href="#" data-ouvrir-flux="${e.flux_id}">${echapper(libelleEtat(e.etat_flux) || e.flux_id)}</a>` : texteHtml(`${T}.non_envoye`)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="aide">${texteHtml(`${T}.aucun_envoi`)}</p>`;
  const ignorees = p.resume?.ignorees?.length
    ? `<p class="aide" data-ignorees>${texteHtml(`${T}.ignorees`, { pieces: p.resume.ignorees.map((i) => i.numero ?? i.ent_id).join(', ') })}</p>`
    : '';
  return `<h2>${iconeHtml('facture_electronique_btp_ereporting')} ${echapper(libellePeriode(p))} ${pastillePeriodeHtml(p.etat)}</h2>
    <p class="aide">${echapper(resumeEreportingTexte(p))}</p>${ignorees}${ecarts}<h3>${texteHtml(`${T}.envois`)}</h3>${envois}
    <h3>${texteHtml(`${T}.chronologie`)}</h3><div data-chronologie-periode></div>`;
}

/**
 * Onglet « E-reporting ». options : { api: { option, definirOption, periodes, periode, preparer, envoyer, corriger, relancer },
 * apiFe (chronologie), peutModifier, parametrer, confirmer, message, erreur, ouvrirFlux, libelleElement }.
 */
export class ListeEreportingFe {
  constructor(zone, options) {
    this.zone = zone;
    this.options = options;
    this.periodes = [];
    this.option = null;
  }

  async charger() {
    try {
      [this.option, this.periodes] = await Promise.all([this.options.api.option(), this.options.api.periodes()]);
    } catch (x) {
      this.options.erreur(x);
      this.periodes = this.periodes ?? [];
    }
    this.afficher();
  }

  afficher() {
    const { peutModifier, parametrer } = this.options;
    const o = this.option ?? {};
    this.zone.innerHTML = `<p class="aide">${texteHtml(`${T}.aide`)}</p>
      <fieldset class="options-fe-btp" data-option-ereporting><legend>${iconeHtml('facture_electronique_btp_parametres')} ${texteHtml(`${T}.option.titre`)}</legend>
        <label>${texteHtml(`${T}.option.regime`)} <span data-combo-regime></span></label>
        <label title="${texteHtml(`${T}.option.matricule_aide`)}">${texteHtml(`${T}.option.matricule`)} <input type="text" size="6" maxlength="4" data-matricule value="${echapper(o.matricule ?? '')}"${parametrer ? '' : ' disabled'}></label>
        <span class="aide" data-decoupage>${texteHtml(`${T}.option.decoupage`, { decoupage: o.decoupage ? texte(`facture_electronique.decoupages.${o.decoupage}`) : '' })}</span>
        ${parametrer ? `<button type="button" data-enregistrer-option>${iconeHtml('facture_electronique_btp_ereporting_enregistrer')} ${texteHtml(`${T}.option.enregistrer`)}</button>` : ''}
      </fieldset>
      ${peutModifier ? `<div class="barre-outils" data-preparation><div class="groupe-outils">
        <span data-combo-nature></span><input type="date" data-jour title="${texteHtml(`${T}.jour_aide`)}">
        <button type="button" data-preparer title="${texteHtml(`${T}.actions.preparer_aide`)}">${iconeHtml('facture_electronique_btp_ereporting_preparer')} ${texteHtml(`${T}.actions.preparer`)}</button>
      </div></div>` : ''}
      ${periodesEreportingHtml(this.periodes, { peutModifier })}<section data-detail-periode-zone hidden></section>`;

    this.regime = creerCombo({
      options: Object.values(REGIME_EREPORTING).map((r) => ({ valeur: r, libelle: texte(`${T}.regimes.${r}`) })),
      valeur: o.regime ?? REGIME_EREPORTING.REEL_NORMAL_MENSUEL, vide: false, titre: texte(`${T}.option.regime_aide`),
    });
    this.regime.disabled = !parametrer;
    this.zone.querySelector('[data-combo-regime]').replaceWith(this.regime);
    this.zone.querySelector('[data-enregistrer-option]')?.addEventListener('click', () => this.enregistrerOption());
    if (peutModifier) {
      this.nature = creerCombo({
        options: Object.values(NATURE_PERIODE_EREPORTING).map((n) => ({ valeur: n, libelle: texte(`${T}.natures.${n}`) })),
        valeur: NATURE_PERIODE_EREPORTING.TRANSACTIONS, vide: false, titre: texte(`${T}.nature_aide`),
      });
      this.zone.querySelector('[data-combo-nature]').replaceWith(this.nature);
      activerDates(this.zone);
      this.zone.querySelector('[data-preparer]').addEventListener('click', () => this.preparer());
    }
    this.zone.querySelectorAll('[data-detail-periode]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.detail(Number(a.dataset.detailPeriode));
    }));
    this.zone.querySelectorAll('[data-action-periode]').forEach((b) => b.addEventListener('click', () => this.agir(b.dataset.actionPeriode, Number(b.dataset.periode))));
  }

  async enregistrerOption() {
    try {
      this.option = await this.options.api.definirOption({ regime: this.regime.valeurCombo, matricule: this.zone.querySelector('[data-matricule]').value || null });
      this.options.message(texte(`${T}.option.enregistre`), 'succes');
    } catch (x) {
      this.options.erreur(x);
    }
  }

  async preparer() {
    const jour = this.zone.querySelector('[data-jour]').value;
    if (!jour) {
      this.options.message(texte(`${T}.jour_absent`), 'avertissement');
      return;
    }
    await this.executer(() => this.options.api.preparer(this.nature.valeurCombo, jour), 'preparee');
  }

  async agir(action, id) {
    const p = this.periodes.find((x) => x.id === id);
    if (!p || !actionsPeriode(p, this.options.peutModifier).includes(action)) return;
    if (!await this.options.confirmer(texte(`${T}.actions.confirmer_${action}`, { periode: libellePeriode(p) }))) return;
    const appel = { envoyer: 'envoyer', corriger: 'corriger', relancer: 'relancer' }[action];
    await this.executer(() => this.options.api[appel](id), action);
  }

  async executer(appel, cle) {
    try {
      const p = await appel();
      this.options.message(texte(`${T}.resultats.${cle}`, { periode: libellePeriode(p) }), p.ecarts?.length ? 'avertissement' : 'succes');
      await this.charger();
      await this.detail(p.id);
    } catch (x) {
      this.options.erreur(x);
    }
  }

  async detail(id) {
    const zone = this.zone.querySelector('[data-detail-periode-zone]');
    let p;
    try {
      p = await this.options.api.periode(id);
    } catch (x) {
      this.options.erreur(x);
      return;
    }
    zone.hidden = false;
    zone.innerHTML = detailPeriodeHtml(p);
    zone.querySelectorAll('[data-ouvrir-flux]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.options.ouvrirFlux(Number(a.dataset.ouvrirFlux), e.ctrlKey || e.metaKey);
    }));
    const chronologie = new Chronologie(zone.querySelector('[data-chronologie-periode]'), {
      charger: () => this.options.apiFe.chronologieElement(TYPE_ELEMENT_FE.PERIODE_EREPORTING, String(id)),
      element: true, libelleElement: this.options.libelleElement, ouvrirFlux: this.options.ouvrirFlux, erreur: this.options.erreur,
    });
    await chronologie.charger();
  }
}

