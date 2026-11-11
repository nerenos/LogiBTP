// Facturation électronique, lot 24 : pastille de l'émission de la pièce de vente validée et bouton « Émettre » (pièce
// validée avant l'activation du module, envoi différé, échec ou hors flux). Le serveur décide (Btp/EnvoiFactureBtp.cs) :
// GET /api/facture-electronique/documents/{id}/envoi (état), POST …/envoi (émission). Statut affiché = statut du cycle de
// vie du flux (libellés du module), sinon état de l'émission ; mêmes codes que la colonne « Facture électronique » des listes.

import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { PASTILLES_EMISSION_FE_LISTE, PASTILLE_EMISSION_FE } from '../codes.js';

const ETATS_PASTILLE = new Set(Object.values(PASTILLE_EMISSION_FE));

/** Zone affichée : module actif, droit de consulter, pièce enregistrée et verrouillée (validée) d'un type émis. */
export function envoiFeVisible({ moduleActif, peutConsulter, document, code, types }) {
  return Boolean(moduleActif && peutConsulter && document?.ent_id > 0 && document.ent_verrouille && types?.[code]);
}

/** Libellé d'une pastille : état de l'émission (textes du cœur) ou statut du cycle de vie (textes du module). */
export function libellePastilleFe(code) {
  return ETATS_PASTILLE.has(code) ? texte(`document_btp.page.envoi_fe.pastilles.${code}`) : texte(`facture_electronique.statuts.${code}`);
}

/** Teinte d'une pastille (mêmes teintes que la colonne des listes). */
export function teintePastilleFe(code) {
  return PASTILLES_EMISSION_FE_LISTE.find((o) => o.valeur === code)?.teinte ?? 'neutre';
}

/** Contenu de la zone (vide : rien à afficher). */
export function envoiFeHtml(etat, { peutModifier = false } = {}) {
  if (!etat?.applicable) return '';
  const pastille = etat.pastille
    ? `<span class="liste-pastille teinte-${echapper(teintePastilleFe(etat.pastille))}" data-pastille-fe="${echapper(etat.pastille)}">${echapper(libellePastilleFe(etat.pastille))}</span>`
    : `<span class="aide">${texteHtml('document_btp.page.envoi_fe.non_emise')}</span>`;
  const motif = etat.motif ? ` <span class="aide">${texteHtml(`document_btp.page.envoi_fe.motifs.${etat.motif}`)}</span>` : '';
  const syntaxe = etat.syntaxe ? ` <span class="aide">${texteHtml('document_btp.page.envoi_fe.syntaxe', { syntaxe: etat.syntaxe })}</span>` : '';
  const erreur = etat.erreur ? ` <span class="aide" data-erreur-fe>${texteHtml('document_btp.page.envoi_fe.erreur', { erreur: etat.erreur })}</span>` : '';
  const bouton = etat.emettable && peutModifier
    ? ` <button type="button" data-action-fe="emettre" title="${texteHtml('document_btp.page.envoi_fe.emettre_aide')}">${iconeHtml('facture_electronique_btp_emettre')} ${texteHtml('document_btp.page.envoi_fe.emettre')}</button>`
    : '';
  return `<div class="envoi-fe" title="${texteHtml('document_btp.page.envoi_fe.aide')}">${iconeHtml('facture_electronique_btp_page')}
    <b>${texteHtml('document_btp.page.envoi_fe.titre')}</b> ${pastille}${motif}${syntaxe}${erreur}${bouton}</div>`;
}

/**
 * Met à jour la zone de l'émission de la page document (relue à chaque version enregistrée de la pièce) ; « Émettre »
 * demande confirmation (fenêtre du socle fournie par l'appelant) puis relit l'état.
 */
export async function rendreEnvoiFe(page, { zone, moduleActif, peutConsulter, peutModifier, types, lire, emettre, confirmer, erreur }) {
  if (!zone) return;
  const d = page.editeur?.saisie.document;
  const code = page.editeur?.definition.type?.tyd_code;
  if (!envoiFeVisible({ moduleActif, peutConsulter, document: d, code, types })) {
    zone.hidden = true;
    zone.replaceChildren();
    page.envoiFeCle = null;
    return;
  }
  const cle = `${d.ent_id}-${d.ent_version}`;
  if (page.envoiFeCle === cle) return;
  page.envoiFeCle = cle;
  let etat;
  try {
    etat = await lire(d.ent_id);
  } catch (x) {
    zone.innerHTML = `<div class="envoi-fe">${iconeHtml('fe_avertissement')} ${texteHtml('document_btp.page.envoi_fe.indisponible', { erreur: x?.message ?? '' })}</div>`;
    zone.hidden = false;
    return;
  }
  if (page.envoiFeCle !== cle) return;
  const html = envoiFeHtml(etat, { peutModifier });
  zone.innerHTML = html;
  zone.hidden = html === '';
  zone.querySelector('[data-action-fe="emettre"]')?.addEventListener('click', async () => {
    if (!await confirmer(texte('document_btp.page.envoi_fe.confirmer'))) return;
    try {
      await emettre(d.ent_id);
    } catch (x) {
      erreur(x);
    }
    page.envoiFeCle = null;
    await rendreEnvoiFe(page, { zone, moduleActif, peutConsulter, peutModifier, types, lire, emettre, confirmer, erreur });
  });
}
