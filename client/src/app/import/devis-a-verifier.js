import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlDocument, SUJET_FENETRE } from '../codes.js';
import { STATUT_DOCUMENT } from '@logibtp/document';
import { aujourdhui } from '@logibtp/socle';
import { echapper, formatNombre, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { VERSION_MOTEUR } from '../../calcul/index.js';
import { individusSociete } from '../panneaux-btp.js';
import { lireImport, retirerImport } from './depot-import.js';
import { formatImport } from './formats.js';
import { saisieDevisImporte, ecartsImport } from './devis-importe.js';
import { tableNonRepris, rapportImport, messagesCorrespondances } from './rapport-import.js';

// Devis importé à vérifier (/document/import?jeton=…) : ouvert dans une nouvelle fenêtre par la page d'import, il se
// modifie comme un brouillon sans exister dans la base. « Créer le devis » l'enregistre, conserve le fichier source
// dans la GED du devis et enregistre l'origine (traçabilité). Le rapport des champs non repris n'est affiché qu'en
// mode débogage (vue de colonnes).

/** Chargement du devis importé dans la page document (page : PageDocument). */
export async function ouvrirImport(page, jeton) {
  const entree = jeton ? await lireImport(jeton) : null;
  if (!entree) throw new Error(texte('import_btp.verification.introuvable'));
  const format = formatImport(entree.format);
  const devis = await format.lire(await entree.fichier.arrayBuffer());
  const type = page.types.find((t) => t.tyd_code === format.type);
  const definition = await api.definition(format.type);
  const redacteurs = page.servicesAnnuaire ? await individusSociete(page.servicesAnnuaire) : [];
  const saisie = saisieDevisImporte(devis, { definition, natures: page.natures, redacteurs });
  const brouillon = definition.statuts?.find((s) => s.std_code === STATUT_DOCUMENT.BROUILLON) ?? definition.statuts?.[0];
  const document = {
    ent_id: 0, ent_tyd_id: type.tyd_id, ent_numero: null, ent_std_id: brouillon?.std_id ?? 1, ent_version: 1, ent_indice: null,
    ent_tiers_id: null, ent_precision_montant: 2, ent_modele: null, ent_bib_id: null, ent_intervenants: [],
    ...saisie.document,
    ent_date: saisie.document.ent_date ?? aujourdhui(),
  };
  page.importEnCours = { jeton, entree, format, devis, saisie };
  await page.charger(definition, { document, lignes: saisie.lignes });
  page.disposition.onglet('lignes');
}

/** Bandeau du devis importé : état, contrôle des montants, rapprochements ; rapport détaillé en mode débogage. */
export function rendreBandeauImport(page) {
  const zone = page.$('.document-import');
  const imp = page.importEnCours;
  zone.hidden = !imp;
  if (!imp) { zone.replaceChildren(); return; }
  const ed = page.editeur;
  const e = ecartsImport(ed.resultat, imp.saisie.controles, imp.devis.entete.controle.total_ht);
  const messages = [...imp.devis.avertissements, ...messagesCorrespondances(imp.saisie.correspondances)];
  const debogage = Boolean(ed.vue?.debogage);
  const ouvert = zone.querySelector('details')?.open ?? false;
  zone.innerHTML = `<div class="import-etat">${iconeHtml('import_btp_import')} ${texteHtml('import_btp.verification.etat_html', { format: imp.format.libelle, fichier: imp.entree.nom_fichier })}
      <span class="${e.ecart_total ? 'erreur' : 'succes'}">${e.ecart_total ? texteHtml('import_btp.verification.total_ecart', { total: formatNombre(e.total_calcule, 2), ecart: formatNombre(e.ecart_total, 2), format: imp.format.libelle, lignes: e.lignes.length }) : texteHtml('import_btp.verification.total_identique', { total: formatNombre(e.total_calcule, 2), format: imp.format.libelle })}</span>
      <button type="button" class="principal" data-import="creer">${texteHtml('import_btp.verification.creer')}</button>
      <button type="button" data-import="abandonner">${texteHtml('import_btp.verification.abandonner')}</button></div>
    ${messages.length ? `<ul class="import-avertissements">${messages.map((m) => `<li>${iconeHtml('avertissement')} ${echapper(m)}</li>`).join('')}</ul>` : ''}
    ${debogage ? `<details class="import-debogage"${ouvert ? ' open' : ''}><summary>${iconeHtml('import_btp_debogage')} ${texteHtml('import_btp.verification.non_repris', { nombre: imp.devis.non_repris.length })}${e.lignes.length ? ` ${texteHtml('import_btp.verification.ecarts', { nombre: e.lignes.length })}` : ''}</summary>
      ${e.lignes.length ? `<table class="table-analyse"><thead><tr><th>${texteHtml('import_btp.verification.ligne')}</th><th>${echapper(imp.format.libelle)}</th><th>${texteHtml('import_btp.verification.logibtp')}</th><th>${texteHtml('import_btp.verification.ecart')}</th></tr></thead><tbody>${e.lignes.map((l) => `<tr><td>${echapper(l.numero ?? '')}</td><td class="nombre">${formatNombre(l.origine, 2)}</td><td class="nombre">${formatNombre(l.calcule, 2)}</td><td class="nombre">${formatNombre(l.ecart, 2)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${tableNonRepris(imp.devis.non_repris)}</details>` : ''}`;
  zone.querySelector('[data-import="creer"]').addEventListener('click', (ev) => {
    ev.target.disabled = true;
    creerDepuisImport(page).catch((x) => { ev.target.disabled = false; page.app.erreur(x); });
  });
  zone.querySelector('[data-import="abandonner"]').addEventListener('click', async () => {
    if (!await confirmer(texte('import_btp.verification.confirmer_abandon'))) return;
    await retirerImport(imp.jeton).catch(() => {});
    page.importEnCours = null;
    if (window.opener) window.close();
    else page.app.naviguer(imp.format.page);
  });
}

/** Onglet Traçabilité du devis importé (pas encore créé) : origine prévue et, en mode débogage, le rapport. */
export function tracabiliteImport(page, zone) {
  const imp = page.importEnCours;
  const debogage = Boolean(page.editeur.vue?.debogage);
  zone.innerHTML = `<div class="tracabilite"><section class="trac-bloc"><h3>${texteHtml('import_btp.verification.origine')}</h3>
    <p>${iconeHtml('import_btp_import')} ${texteHtml('import_btp.verification.origine_html', { format: imp.format.libelle, fichier: imp.entree.nom_fichier })}${imp.devis.entete.reference ? texteHtml('import_btp.verification.reference_html', { reference: imp.devis.entete.reference }) : ''}.</p>
    <p class="aide">${texteHtml('import_btp.verification.aide_origine')}</p>
    ${debogage ? `<details class="trac-rapport" open><summary>${texteHtml('import_btp.verification.rapport')}</summary>${tableNonRepris(imp.devis.non_repris)}</details>` : ''}</section></div>`;
}

/**
 * Création du devis vérifié : entête et lignes (recalculées par le moteur), fichier source dans la GED du devis,
 * origine (format, fichier, référence, rapport). Création et contenu en une transaction : un refus ne crée rien.
 */
export async function creerDepuisImport(page) {
  const imp = page.importEnCours;
  const ed = page.editeur;
  const saisieDoc = ed.saisie.document;
  const r = ed.calculer(ed.entree(ed.saisie));
  // Création et contenu en un seul appel, dans une transaction : un refus n'a rien créé.
  let cree;
  try {
    cree = (await api.creerAvecContenu({
      ent_tyd_id: saisieDoc.ent_tyd_id, ent_tiers_id: saisieDoc.ent_tiers_id ?? null, ent_objet: saisieDoc.ent_objet, ent_date: saisieDoc.ent_date,
      ent_num_format: saisieDoc.ent_num_format, ent_notre_reference: saisieDoc.ent_notre_reference ?? null,
      ent_reference_externe: saisieDoc.ent_reference_externe ?? null, ent_validite_jours: saisieDoc.ent_validite_jours ?? null,
    }, {
      document: r.document, lignes: r.lignes, metres: r.metres ?? ed.saisie.metres,
      variables: r.variables ?? ed.saisie.variables, version_moteur_client: VERSION_MOTEUR,
    })).document;
  } catch (e) {
    throw new Error(texte('import_btp.verification.creation_refusee', { message: [e.message, ...(e.details ?? []).map((x) => x.message)].filter(Boolean).join(' — ') }));
  }
  const id = cree.document.ent_id;
  // Fichier source conservé dans la GED du devis (pièces), puis origine : la traçabilité pointe sur ce fichier.
  let fichierId = null;
  if (page.servicesGed) {
    try {
      const g = await page.servicesGed.deposer({
        fichier: imp.entree.fichier, nom_fichier: imp.entree.nom_fichier,
        meta: {
          titre: texte('import_btp.verification.ged_titre', { format: imp.format.libelle, fichier: imp.entree.nom_fichier }), categorie: 'import', type_element: ed.definition.type.tyd_code,
          id_element: String(cree.document.ent_groupe_id ?? id), date_document: aujourdhui(),
          notes: imp.devis.entete.reference ? texte('import_btp.verification.ged_notes_reference', { format: imp.format.libelle, reference: imp.devis.entete.reference }) : texte('import_btp.verification.ged_notes', { format: imp.format.libelle }),
        },
      });
      fichierId = g.id;
    } catch (e) {
      page.app.message(texte('import_btp.verification.ged_echec', { message: e.message }), 'avertissement');
    }
  }
  const ecarts = ecartsImport(r, imp.saisie.controles, imp.devis.entete.controle.total_ht);
  await api.enregistrerOrigine(id, {
    format: imp.format.libelle, fichier_id: fichierId, nom_fichier: imp.entree.nom_fichier, reference: imp.devis.entete.reference ?? null,
    rapport: rapportImport(imp.devis, imp.saisie.correspondances, ecarts),
  });
  await retirerImport(imp.jeton).catch(() => {});
  page.importEnCours = null;
  page.app.routeur.remplacerUrl(urlDocument(id));
  await page.chargerDocument(id);
  page.app.publier(SUJET_FENETRE.ENREGISTRE, { type: ed.definition.type.tyd_code, ids: [id], cree: true });
  page.app.message(texte('import_btp.verification.cree', { type: ed.definition.type.tyd_libelle, numero: cree.document.ent_numero ?? '', format: imp.format.libelle }), 'succes');
}
