// Facturation électronique, lot 22 : bandeau de la pièce de vente dans l'éditeur. Le serveur construit la facture électronique
// de la pièce enregistrée (Btp/EmissionFactureBtp.cs) et la contrôle (complétude du module, ReglesCompletude ; écarts de
// l'émission, ECART_EMISSION_FE) : GET /api/facture-electronique/documents/{id}/controle. Aucune règle répliquée ici :
// les modifications non enregistrées ne sont pas contrôlées.

import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { NIVEAU_COMPLETUDE } from '@logibtp/facture-electronique';

/** Bandeau affiché : module actif, droit de consulter, pièce enregistrée d'un type émis (référentiel d'émission, lot 21). */
export function completudeFeVisible({ moduleActif, peutConsulter, entId, code, types }) {
  return Boolean(moduleActif && peutConsulter && entId > 0 && types?.[code]);
}

/** Libellé d'un écart : règle de complétude du module, ou écart de l'émission du cœur. */
export function libelleEcartFe(e, emission = false) {
  return emission ? texte(`document_btp.page.completude_fe.ecarts.${e.regle}`) : texte(`facture_electronique.completude.regles.${e.regle}`);
}

function ecartHtml(e, emission) {
  const bloquant = e.niveau === NIVEAU_COMPLETUDE.BLOQUANT;
  const detail = [e.donnee ? texte('document_btp.page.completude_fe.donnee', { donnee: e.donnee }) : null,
    e.ligne ? texte('document_btp.page.completude_fe.ligne', { ligne: e.ligne }) : null].filter(Boolean).join(', ');
  return `<li data-ecart-fe="${echapper(e.regle)}" class="${bloquant ? 'bloquant' : 'avertissement'}" title="${texteHtml(`facture_electronique.completude.niveaux.${e.niveau}`)}">
    ${iconeHtml(bloquant ? 'erreur' : 'fe_avertissement')} <b>${echapper(e.regle)}</b> ${echapper(libelleEcartFe(e, emission))}${detail ? ` <span class="aide">(${echapper(detail)})</span>` : ''}</li>`;
}

/** Contenu du bandeau (vide : rien à afficher) ; classe « probleme » posée par l'appelant si un écart est bloquant. */
export function bandeauCompletudeFeHtml(controle, { ouvert = false } = {}) {
  if (!controle?.applicable) return '';
  const ecarts = [...(controle.completude ?? []).map((e) => [e, false]), ...(controle.emission ?? []).map((e) => [e, true])];
  const bloquants = ecarts.filter(([e]) => e.niveau === NIVEAU_COMPLETUDE.BLOQUANT).length;
  const avertissements = ecarts.length - bloquants;
  const entete = `<b>${texteHtml('document_btp.page.completude_fe.titre')}</b>
    <span class="aide">${texteHtml('document_btp.page.completude_fe.type_cadre', { type: controle.type_facture ?? '', cadre: controle.cadre ?? '' })}</span>`;
  if (ecarts.length === 0) {
    return `<div class="completude-fe" title="${texteHtml('document_btp.page.completude_fe.aide')}">${iconeHtml('fe_verifier')} ${entete}
      ${texteHtml('document_btp.page.completude_fe.complete')}</div>`;
  }
  const resume = [bloquants ? texteHtml('document_btp.page.completude_fe.bloquants', { nombre: bloquants }) : null,
    avertissements ? texteHtml('document_btp.page.completude_fe.avertissements', { nombre: avertissements }) : null].filter(Boolean).join(', ');
  return `<details class="completude-fe${bloquants ? ' probleme' : ''}"${ouvert ? ' open' : ''} title="${texteHtml('document_btp.page.completude_fe.aide')}">
    <summary>${iconeHtml(bloquants ? 'erreur' : 'fe_avertissement')} ${entete} ${resume}</summary>
    <ul>${ecarts.map(([e, emission]) => ecartHtml(e, emission)).join('')}</ul></details>`;
}

/**
 * Met à jour la zone du bandeau de la page document : contrôle relu à chaque version enregistrée de la pièce
 * (page.completudeFeCle), masqué hors des conditions de completudeFeVisible.
 */
export async function rendreCompletudeFe(page, { zone, moduleActif, peutConsulter, types, controler }) {
  if (!zone) return;
  const d = page.editeur?.saisie.document;
  const code = page.editeur?.definition.type?.tyd_code;
  if (!completudeFeVisible({ moduleActif, peutConsulter, entId: d?.ent_id, code, types })) {
    zone.hidden = true;
    zone.replaceChildren();
    page.completudeFeCle = null;
    return;
  }
  const cle = `${d.ent_id}-${d.ent_version}`;
  if (page.completudeFeCle === cle) return;
  page.completudeFeCle = cle;
  const ouvert = zone.querySelector('details')?.open ?? false;
  let html;
  try {
    html = bandeauCompletudeFeHtml(await controler(d.ent_id), { ouvert });
  } catch (x) {
    html = `<div class="completude-fe">${iconeHtml('fe_avertissement')} ${texteHtml('document_btp.page.completude_fe.indisponible', { erreur: x?.message ?? '' })}</div>`;
  }
  if (page.completudeFeCle !== cle) return;
  zone.innerHTML = html;
  zone.hidden = html === '';
}
