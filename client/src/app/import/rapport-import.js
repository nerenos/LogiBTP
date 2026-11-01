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
