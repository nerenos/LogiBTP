// Facturation électronique, lot 26 (Q15) : liste à valider des statuts Encaissée (212), comme les relances. Une ligne par
// pointage d'un règlement reçu sur une facture émise de services sans TVA sur les débits, non encore déclaré ; montant
// pointé et montants encaissés par taux calculés par le serveur (Btp/StatutEncaisseeBtp.cs, règle répliquée
// calcul/encaissement-fe.js) ; annulation d'encaissement (règlement diminué ou supprimé après l'envoi, cas 34) signalée.
// Lignes cochées par défaut ; « Envoyer » pose les statuts (CDAR en file), « Écarter » les retire sans rien envoyer,
// après confirmation par une fenêtre du socle. GET /api/facture-electronique/encaissements, POST …/encaissements/validation.

import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre, formatDate } from '@logibtp/socle/ui';
import { urlDocument } from '../codes.js';

/** Montants par taux d'une proposition : « 20 % : 62,07 · 10 % : 37,93 ». */
export function ventilationEncaisseeTexte(encaissements) {
  if (!encaissements?.length) return texte('facture_electronique_btp.encaissements.sans_montant');
  return encaissements.map((e) => texte('facture_electronique_btp.encaissements.taux', { taux: formatNombre(e.taux, 2), montant: formatNombre(e.montant, 2) }))
    .join(texte('facture_electronique_btp.encaissements.separateur'));
}

/** Propositions retenues envoyées au serveur : clé et montant lus (le serveur refuse un montant changé). */
export function selectionEncaissees(propositions, cles) {
  const retenues = new Set(cles);
  return propositions.filter((p) => retenues.has(p.cle)).map((p) => ({ cle: p.cle, montant: p.montant }));
}

/** Tableau de la liste (vide : message). */
export function encaissementsFeHtml(propositions, { peutModifier = false } = {}) {
  if (!propositions?.length) return `<p class="aide" data-encaissements-vide>${texteHtml('facture_electronique_btp.encaissements.aucune')}</p>`;
  const lignes = propositions.map((p) => {
    const reglement = p.reglement_supprime
      ? texteHtml('facture_electronique_btp.encaissements.reglement_supprime')
      : echapper([formatDate(p.date_reglement), p.mode, p.reference].filter(Boolean).join(' · '));
    const nature = p.annulation
      ? `<span class="pastille" data-annulation title="${texteHtml('facture_electronique_btp.encaissements.annulation_aide')}">${iconeHtml('facture_electronique_btp_annulation_encaissement')} ${texteHtml('facture_electronique_btp.encaissements.annulation')}</span>`
      : '';
    const coche = peutModifier ? `<td><input type="checkbox" data-encaissement="${echapper(p.cle)}" checked></td>` : '';
    return `<tr data-cle="${echapper(p.cle)}">${coche}
      <td><a href="${echapper(urlDocument(p.ent_id))}" data-ouvrir-piece="${p.ent_id}">${echapper(p.numero ?? texte('facture_electronique_btp.element_document', { id: p.ent_id }))}</a></td>
      <td>${echapper(p.tiers ?? '')}</td><td>${reglement}</td>
      <td class="nombre">${formatNombre(p.montant, 2)}</td><td>${echapper(ventilationEncaisseeTexte(p.encaissements))} ${nature}</td></tr>`;
  }).join('');
  const t = (c) => `<th>${texteHtml(`facture_electronique_btp.encaissements.colonnes.${c}`)}</th>`;
  return `<table class="tableau-compact" data-encaissements><thead><tr>${peutModifier ? `<th><input type="checkbox" data-tout checked title="${texteHtml('facture_electronique_btp.encaissements.tout')}"></th>` : ''}
    ${['piece', 'tiers', 'reglement', 'montant', 'encaisse'].map(t).join('')}</tr></thead><tbody>${lignes}</tbody></table>`;
}

/**
 * Onglet « Encaissements » de la page Facturation électronique : liste, cases, « Envoyer » et « Écarter ».
 * options : { api: { lire, valider }, peutModifier, confirmer, message, erreur, ouvrirPiece }.
 */
export class ListeEncaissementsFe {
  constructor(zone, options) {
    this.zone = zone;
    this.options = options;
    this.propositions = [];
  }

  async charger() {
    try {
      this.propositions = (await this.options.api.lire()) ?? [];
    } catch (x) {
      this.options.erreur(x);
      this.propositions = [];
    }
    this.afficher();
  }

  cochees() {
    return [...this.zone.querySelectorAll('[data-encaissement]:checked')].map((c) => c.dataset.encaissement);
  }

  afficher() {
    const { peutModifier } = this.options;
    const boutons = peutModifier && this.propositions.length
      ? `<div class="barre-outils"><div class="groupe-outils">
          <button type="button" data-action="envoyer" title="${texteHtml('facture_electronique_btp.encaissements.envoyer_aide')}">${iconeHtml('facture_electronique_btp_envoyer_encaissee')} ${texteHtml('facture_electronique_btp.encaissements.envoyer')}</button>
          <button type="button" data-action="ecarter" title="${texteHtml('facture_electronique_btp.encaissements.ecarter_aide')}">${iconeHtml('facture_electronique_btp_ecarter_encaissee')} ${texteHtml('facture_electronique_btp.encaissements.ecarter')}</button>
        </div></div>`
      : '';
    this.zone.innerHTML = `<p class="aide">${texteHtml('facture_electronique_btp.encaissements.aide')}</p>${boutons}${encaissementsFeHtml(this.propositions, { peutModifier })}`;
    this.zone.querySelector('[data-tout]')?.addEventListener('change', (e) => {
      this.zone.querySelectorAll('[data-encaissement]').forEach((c) => { c.checked = e.target.checked; });
    });
    this.zone.querySelectorAll('[data-ouvrir-piece]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.options.ouvrirPiece(Number(a.dataset.ouvrirPiece), e.ctrlKey || e.metaKey);
    }));
    this.zone.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => this.valider(b.dataset.action === 'ecarter')));
  }

  async valider(ecarter) {
    const propositions = selectionEncaissees(this.propositions, this.cochees());
    if (!propositions.length) {
      this.options.message(texte('facture_electronique_btp.encaissements.aucune_cochee'), 'avertissement');
      return;
    }
    const cle = ecarter ? 'ecarter' : 'envoyer';
    if (!await this.options.confirmer(texte(`facture_electronique_btp.encaissements.confirmer_${cle}`, { nombre: propositions.length }))) return;
    try {
      const r = await this.options.api.valider(propositions, ecarter);
      this.options.message(texte('facture_electronique_btp.encaissements.resultat', { envoyes: r.envoyes, ecartes: r.ecartes }), 'succes');
      if (r.perimees?.length) this.options.message(texte('facture_electronique_btp.encaissements.perimees', { nombre: r.perimees.length }), 'avertissement');
      for (const e of r.erreurs ?? []) this.options.message(texte('facture_electronique_btp.encaissements.erreur', { message: e.message }), 'erreur');
    } catch (x) {
      this.options.erreur(x);
    }
    await this.charger();
  }
}
