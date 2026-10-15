import { echapper } from '@logibtp/socle/ui';

// Rapport d'un import : champs du fichier non repris (avec leur valeur), regroupés par zone. Affiché en mode débogage
// (devis importé à vérifier, onglet Traçabilité).

/** Table HTML des champs non repris : [{ zone, champ, motif, valeurs, nombre, lignes }]. */
export function tableNonRepris(liste) {
  if (!liste.length) return '<p class="aide">Tous les champs renseignés du fichier sont repris.</p>';
  const zones = [...new Set(liste.map((x) => x.zone))];
  return zones.map((z) => `<h4>${echapper(z)}</h4><table class="table-analyse table-import"><thead><tr><th>Champ</th><th>Signification</th><th>Valeur(s)</th><th>Lignes</th></tr></thead><tbody>
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
    ...c.unites_inconnues.map((u) => `Unité « ${u.unite} » inconnue (${u.nombre} ligne(s)) : laissée vide`),
    ...c.natures_absentes.map((n) => `Nature « ${n.nature} » sans correspondance (${n.nombre} ligne(s)) : à compléter`),
    ...(c.mode_reglement && !c.mode_reglement.code ? [`Mode de règlement « ${c.mode_reglement.source.libelle ?? c.mode_reglement.source.code} » sans correspondance`] : []),
    ...(c.redacteur && !c.redacteur.id ? [`Rédacteur « ${c.redacteur.nom} » absent de l'annuaire de notre société : à choisir`] : []),
    ...(c.etiquettes_ajoutees ?? []).map((e) => `Couleur « ${e.libelle} » sans étiquette correspondante : ajoutée aux étiquettes du document`),
    ...(c.chantier_par_defaut ? [`Chantier absent du fichier : « ${c.chantier_par_defaut} » par défaut, à corriger dans l'entête`] : []),
  ];
}
