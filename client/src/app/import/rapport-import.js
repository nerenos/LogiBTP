import { texte, texteHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';

// Rapport d'un import : champs du fichier non repris (avec leur valeur), regroupés par zone. Affiché en mode débogage
// (devis importé à vérifier, onglet Traçabilité).

/** Table HTML des champs non repris : [{ zone, champ, motif, valeurs, nombre, lignes }]. */
export function tableNonRepris(liste) {
  if (!liste.length) return `<p class="aide">${texteHtml('import_btp.rapport.tout_repris')}</p>`;
  const zones = [...new Set(liste.map((x) => x.zone))];
  return zones.map((z) => `<h4>${echapper(z)}</h4><table class="table-analyse table-import"><thead><tr><th>${texteHtml('import_btp.rapport.champ')}</th><th>${texteHtml('import_btp.rapport.signification')}</th><th>${texteHtml('import_btp.rapport.valeurs')}</th><th>${texteHtml('import_btp.rapport.lignes')}</th></tr></thead><tbody>
    ${liste.filter((x) => x.zone === z).map((x) => `<tr><td><code>${echapper(x.champ)}</code></td><td>${echapper(x.motif)}</td>
      <td>${x.valeurs.map((v) => echapper(v)).join('<br>')}</td><td class="nombre">${x.lignes ? x.nombre : ''}</td></tr>`).join('')}</tbody></table>`).join('');
}

/** Compte rendu d'un import de cartes carburant : pleins écrits, doublons, cartes non rapprochées, lignes en erreur (rangs). */
export function rapportCarburant(r) {
  const liste = (titre, rangs) => (rangs.length ? `<h4>${texteHtml(titre)}</h4><p>${rangs.map((x) => echapper(String(x))).join(', ')}</p>` : '');
  return `<table class="table-analyse table-import"><tbody>
    <tr><th>${texteHtml('import_btp.carburant.lus')}</th><td class="nombre">${r.lus}</td></tr>
    <tr><th>${texteHtml('import_btp.carburant.ecrits')}</th><td class="nombre">${r.ecrits}</td></tr>
    <tr><th>${texteHtml('import_btp.carburant.doublons')}</th><td class="nombre">${r.doublons.length}</td></tr>
    <tr><th>${texteHtml('import_btp.carburant.non_rapproches')}</th><td class="nombre">${r.non_rapproches.length}</td></tr>
    <tr><th>${texteHtml('import_btp.carburant.erreurs')}</th><td class="nombre">${r.erreurs.length}</td></tr></tbody></table>
    ${liste('import_btp.carburant.rangs_doublons', r.doublons)}${liste('import_btp.carburant.rangs_non_rapproches', r.non_rapproches)}
    ${r.erreurs.length ? `<h4>${texteHtml('import_btp.carburant.rangs_erreurs')}</h4><ul class="import-avertissements">${r.erreurs.map((e) => `<li>${texteHtml('import_btp.carburant.ligne_erreur', { rang: e.rang, message: e.message })}</li>`).join('')}</ul>` : ''}`;
}

/** Rapport conservé avec l'origine du document : non repris, avertissements, rapprochements, écarts de calcul. */
export function rapportImport(devis, correspondances, ecarts = null) {
  return { non_repris: devis.non_repris, avertissements: [...devis.avertissements, ...messagesCorrespondances(correspondances)], ecarts };
}

/** Rapprochements incomplets (unités, natures, mode de règlement, rédacteur, étiquettes, chantier) en messages. */
export function messagesCorrespondances(c) {
  return [
    ...c.unites_inconnues.map((u) => texte('import_btp.rapport.unite', { unite: u.unite, nombre: u.nombre })),
    ...c.natures_absentes.map((n) => texte('import_btp.rapport.nature', { nature: n.nature, nombre: n.nombre })),
    ...(c.mode_reglement && !c.mode_reglement.code ? [texte('import_btp.rapport.mode_reglement', { mode: c.mode_reglement.source.libelle ?? c.mode_reglement.source.code })] : []),
    ...(c.redacteur && !c.redacteur.id ? [texte('import_btp.rapport.redacteur', { nom: c.redacteur.nom })] : []),
    ...(c.etiquettes_ajoutees ?? []).map((e) => texte('import_btp.rapport.couleur', { libelle: e.libelle })),
    ...(c.chantier_par_defaut ? [texte('import_btp.rapport.chantier', { chantier: c.chantier_par_defaut })] : []),
  ];
}
