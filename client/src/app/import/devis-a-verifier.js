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

/** Champs d'entête attribués par le serveur à la création (le reste vient de la saisie vérifiée). */
const CHAMPS_SERVEUR = ['ent_id', 'ent_tyd_id', 'ent_numero', 'ent_version', 'ent_groupe_id', 'ent_std_id', 'ent_indice', 'ent_is_reference',
  'ent_verrouille', 'ent_cree_le', 'ent_cree_par', 'ent_modifie_le', 'ent_modifie_par', 'ent_version_calcul', 'ent_date_validite'];

/** Chargement du devis importé dans la page document (page : PageDocument). */
export async function ouvrirImport(page, jeton) {
  const entree = jeton ? await lireImport(jeton) : null;
  if (!entree) throw new Error('Import introuvable ou déjà créé : relancez l\'import depuis le menu');
  const format = formatImport(entree.format);
  const devis = await format.lire(await entree.fichier.arrayBuffer());
  const type = page.types.find((t) => t.tyd_code === format.type);
  const definition = await api.definition(format.type);
  const redacteurs = page.servicesAnnuaire ? await individusSociete(page.servicesAnnuaire) : [];
  const saisie = saisieDevisImporte(devis, { definition, natures: page.natures, redacteurs });
  const brouillon = definition.statuts?.find((s) => s.std_code === 'BROUILLON') ?? definition.statuts?.[0];
  const document = {
    ent_id: 0, ent_tyd_id: type.tyd_id, ent_numero: null, ent_std_id: brouillon?.std_id ?? 1, ent_version: 1, ent_indice: null,
    ent_tiers_id: null, ent_precision_montant: 2, ent_modele: null, ent_bib_id: null, ent_intervenants: [],
    ...saisie.document,
    ent_date: saisie.document.ent_date ?? new Date().toISOString().slice(0, 10),
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
  zone.innerHTML = `<div class="import-etat">📥 <b>Devis importé de ${echapper(imp.format.libelle)}</b> (${echapper(imp.entree.nom_fichier)}) — non enregistré : vérifiez-le, puis créez-le.
      <span class="${e.ecart_total ? 'erreur' : 'succes'}">Total ${formatNombre(e.total_calcule, 2)} € HT ${e.ecart_total ? `(écart ${formatNombre(e.ecart_total, 2)} € avec ${echapper(imp.format.libelle)}, ${e.lignes.length} ligne(s))` : `identique à ${echapper(imp.format.libelle)}`}</span>
      <button type="button" class="principal" data-import="creer">Créer le devis</button>
      <button type="button" data-import="abandonner">Abandonner</button></div>
    ${messages.length ? `<ul class="import-avertissements">${messages.map((m) => `<li>⚠ ${echapper(m)}</li>`).join('')}</ul>` : ''}
    ${debogage ? `<details class="import-debogage"${ouvert ? ' open' : ''}><summary>🐞 Champs non repris (${imp.devis.non_repris.length})${e.lignes.length ? ` · écarts par ligne (${e.lignes.length})` : ''}</summary>
      ${e.lignes.length ? `<table class="table-analyse"><thead><tr><th>Ligne</th><th>${echapper(imp.format.libelle)}</th><th>LogiBTP</th><th>Écart</th></tr></thead><tbody>${e.lignes.map((l) => `<tr><td>${echapper(l.numero ?? '')}</td><td class="nombre">${formatNombre(l.origine, 2)}</td><td class="nombre">${formatNombre(l.calcule, 2)}</td><td class="nombre">${formatNombre(l.ecart, 2)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${tableNonRepris(imp.devis.non_repris)}</details>` : ''}`;
  zone.querySelector('[data-import="creer"]').addEventListener('click', (ev) => {
    ev.target.disabled = true;
    creerDepuisImport(page).catch((x) => { ev.target.disabled = false; page.app.erreur(x); });
  });
  zone.querySelector('[data-import="abandonner"]').addEventListener('click', async () => {
    if (!await confirmer('Abandonner ce devis importé ? Rien n\'a été enregistré.')) return;
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
  zone.innerHTML = `<div class="tracabilite"><section class="trac-bloc"><h3>Origine</h3>
    <p>📥 Import <b>${echapper(imp.format.libelle)}</b> du fichier ${echapper(imp.entree.nom_fichier)}${imp.devis.entete.reference ? ` — référence d'origine <b>${echapper(imp.devis.entete.reference)}</b>` : ''}.</p>
    <p class="aide">À la création, le fichier est conservé dans les pièces du devis et l'origine enregistrée : l'import pourra être réutilisé.</p>
    ${debogage ? `<details class="trac-rapport" open><summary>Rapport d'import (mode débogage)</summary>${tableNonRepris(imp.devis.non_repris)}</details>` : ''}</section></div>`;
}

/**
 * Création du devis vérifié : entête et lignes (recalculées par le moteur), fichier source dans la GED du devis,
 * origine (format, fichier, référence, rapport). Un échec d'enregistrement supprime le devis vide créé.
 */
export async function creerDepuisImport(page) {
  const imp = page.importEnCours;
  const ed = page.editeur;
  const saisieDoc = ed.saisie.document;
  const cree = await api.creer({
    ent_tyd_id: saisieDoc.ent_tyd_id, ent_tiers_id: saisieDoc.ent_tiers_id ?? null, ent_objet: saisieDoc.ent_objet, ent_date: saisieDoc.ent_date,
    ent_num_format: saisieDoc.ent_num_format, ent_notre_reference: saisieDoc.ent_notre_reference ?? null,
    ent_reference_externe: saisieDoc.ent_reference_externe ?? null, ent_validite_jours: saisieDoc.ent_validite_jours ?? null,
  });
  const id = cree.document.ent_id;
  const document = { ...saisieDoc, ...Object.fromEntries(CHAMPS_SERVEUR.map((k) => [k, cree.document[k]])) };
  const r = ed.calculer(ed.entree({ ...ed.saisie, document }));
  try {
    await api.enregistrer(id, {
      document: r.document, lignes: r.lignes, metres: r.metres ?? ed.saisie.metres,
      variables: r.variables ?? ed.saisie.variables, version_moteur_client: VERSION_MOTEUR,
    });
  } catch (e) {
    await api.supprimerDocument(id).catch(() => {});
    throw new Error(`Création refusée : ${[e.message, ...(e.details ?? []).map((x) => x.message)].filter(Boolean).join(' — ')}`);
  }
  // Fichier source conservé dans la GED du devis (pièces), puis origine : la traçabilité pointe sur ce fichier.
  let fichierId = null;
  if (page.servicesGed) {
    try {
      const g = await page.servicesGed.deposer({
        fichier: imp.entree.fichier, nom_fichier: imp.entree.nom_fichier,
        meta: {
          titre: `Import ${imp.format.libelle} – ${imp.entree.nom_fichier}`, categorie: 'import', type_element: ed.definition.type.tyd_code,
          id_element: String(cree.document.ent_groupe_id ?? id), date_document: new Date().toISOString().slice(0, 10),
          notes: `Fichier source de l'import (${imp.format.libelle}${imp.devis.entete.reference ? `, référence ${imp.devis.entete.reference}` : ''})`,
        },
      });
      fichierId = g.id;
    } catch (e) {
      page.app.message(`Fichier source non conservé dans la GED : ${e.message}`, 'avertissement');
    }
  }
  const ecarts = ecartsImport(r, imp.saisie.controles, imp.devis.entete.controle.total_ht);
  await api.enregistrerOrigine(id, {
    format: imp.format.libelle, fichier_id: fichierId, nom_fichier: imp.entree.nom_fichier, reference: imp.devis.entete.reference ?? null,
    rapport: rapportImport(imp.devis, imp.saisie.correspondances, ecarts),
  });
  await retirerImport(imp.jeton).catch(() => {});
  page.importEnCours = null;
  page.app.routeur.remplacerUrl(`/document/${id}`);
  await page.chargerDocument(id);
  page.app.publier('enregistre', { type: ed.definition.type.tyd_code, ids: [id], cree: true });
  page.app.message(`${ed.definition.type.tyd_libelle} ${cree.document.ent_numero ?? ''} créé depuis ${imp.format.libelle}`, 'succes');
}
