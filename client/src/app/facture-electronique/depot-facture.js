// Module Facturation électronique, lot 14 du cœur (plans/facturation-electronique.md) : réception hors plateforme. Un
// Factur-X (PDF) ou un XML CII / UBL glissé sur la liste « Factures reçues à traiter » ou sur la page d'une facture
// d'achat, ou une pièce jointe d'un courriel reçu (« Créer la facture »), passe par le même traitement qu'un flux reçu
// (flux de sens In, connecteur MANUEL : pièce en brouillon, doublon refusé) ; le flux est marqué hors plateforme, aucun
// statut n'est envoyé. Fichier reconnu par la règle du module (estFichierFacture ↔ ReglesReception.EstFichierFacture).
import { texte } from '@logibtp/socle/dictionnaire';
import { appelApi, ACTION_DROIT } from '@logibtp/socle';
import { estFichierFacture, EXTENSIONS_FACTURE, TYPES_MIME_FACTURE } from '@logibtp/facture-electronique';
import { modeles } from '@logibtp/facture-electronique/ui';
import { MODULE_FACULTATIF, TYPE_DOCUMENT, TYPE_ELEMENT_FE, urlDocument } from '../codes.js';
import { NOEUD_FE } from '../documents/chronologie-document.js';
import { apiFe } from './api-fe.js';

/** Pièces dont la page accepte une facture glissée : factures et avoirs d'achat, factures de sous-traitance. */
export const TYPES_DEPOT_FACTURE = Object.freeze([TYPE_DOCUMENT.A_FACTURE, TYPE_DOCUMENT.A_FACTURE_AVT, TYPE_DOCUMENT.A_AVOIR, TYPE_DOCUMENT.T_FACTURE_AVT]);

/** Source de la liste « Factures reçues à traiter » (vue 1014). */
export const SOURCE_FE_RECUES = 'fe_recues';

/** Classe posée sur la zone pendant le survol d'un fichier. */
export const CLASSE_CIBLE = 'fe-depot-cible';

/** Dépôt possible : module actif et droit Modifier du nœud de la facturation électronique. */
export const peutDeposerFacture = (app) => app.moduleActif(MODULE_FACULTATIF.FACTURE_ELECTRONIQUE) && app.peut(NOEUD_FE, ACTION_DROIT.MODIFIER);

/** Glissé de fichiers dont l'un peut être une facture (type MIME connu pendant le survol, vide accepté : nom lu au dépôt). */
export function glisseFacture(dataTransfer) {
  if (![...(dataTransfer?.types ?? [])].includes('Files')) return false;
  const items = [...(dataTransfer.items ?? [])].filter((i) => i.kind === 'file');
  return items.length === 0 || items.some((i) => !i.type || estFichierFacture('', i.type));
}

/** Fichiers d'un dépôt retenus comme factures (nom et type). */
export const fichiersFacture = (fichiers) => [...(fichiers ?? [])].filter((f) => estFichierFacture(f.name, f.type));

/**
 * Résultat d'une facture reçue hors plateforme (flux rendu par le module) : pièce créée ou rattachée (identifiant), sinon
 * facture à traiter (doublon refusé, pièce non créée) avec la dernière erreur ; clé du message et niveau.
 */
export function resultatDepot(flux, nom) {
  const piece = flux?.type_element === TYPE_ELEMENT_FE.DOCUMENT ? Number(flux.id_element) : null;
  return piece
    ? { piece, flux: flux.id, niveau: 'succes', cle: 'facture_electronique_btp.depot.creee', valeurs: { nom, numero: flux.numero ?? '' } }
    : { piece: null, flux: flux?.id ?? null, niveau: 'avertissement', cle: 'facture_electronique_btp.depot.a_traiter', valeurs: { nom, numero: flux?.numero ?? '', erreur: flux?.derniere_erreur ?? '' } };
}

/** Annonce les résultats ; une seule pièce créée : ouverte. */
function annoncer(app, resultats, { ouvrir = true } = {}) {
  for (const r of resultats) app.message(texte(r.cle, r.valeurs), r.niveau);
  const pieces = resultats.filter((r) => r.piece);
  if (ouvrir && resultats.length === 1 && pieces.length === 1) app.naviguer(urlDocument(pieces[0].piece));
  else if (ouvrir && resultats.length === 1 && resultats[0].flux) app.naviguer(`/facture-electronique?flux=${resultats[0].flux}`);
}

/** Envoie chaque fichier comme facture reçue hors plateforme (POST /api/facture-electronique/import, hors_plateforme). */
export async function importerFacturesRecues(app, fichiers, { ouvrir = true, importer = (corps) => apiFe.importer(corps) } = {}) {
  const resultats = [];
  for (const f of fichiers) {
    try {
      const flux = await importer({ nom: f.name, contenu: modeles.base64(await f.arrayBuffer()), hors_plateforme: true });
      resultats.push(resultatDepot(flux, f.name));
    } catch (e) { app.erreur(e, { libelle: texte('facture_electronique_btp.depot.erreur', { nom: f.name }) }); }
  }
  annoncer(app, resultats, { ouvrir });
  return resultats;
}

/** Pièce jointe d'un courriel reçu → facture (route du cœur POST /api/facture-electronique/courriels/{id}/facture). */
export async function factureDuCourriel(app, courriel, piece, { appel = appelApi } = {}) {
  try {
    const flux = await appel(`/api/facture-electronique/courriels/${courriel}/facture`, { methode: 'POST', corps: { reference: piece.reference } });
    const r = resultatDepot(flux, piece.nom);
    annoncer(app, [r]);
    return r;
  } catch (e) { app.erreur(e, { libelle: texte('facture_electronique_btp.depot.erreur', { nom: piece.nom }) }); return null; }
}

/** Choix d'un fichier par le sélecteur du navigateur (bouton « Importer une facture »), sans fenêtre propre. */
export function choisirFactures(app, options = {}) {
  const champ = document.createElement('input');
  champ.type = 'file';
  champ.multiple = true;
  champ.accept = [...EXTENSIONS_FACTURE, ...TYPES_MIME_FACTURE].join(',');
  champ.addEventListener('change', () => { const f = fichiersFacture(champ.files); if (f.length) importerFacturesRecues(app, f, options); });
  champ.click();
}

/**
 * Zone qui accepte une facture glissée : fichiers seuls (un autre glissé, ou un dépôt déjà pris par un composant
 * intérieur comme l'explorateur de la GED, est laissé), si `accepte()` et le droit le permettent. Rend la fonction qui
 * retire les écouteurs.
 */
export function activerDepotFactures(zone, { app, accepte = () => true, apres = () => {}, ouvrir = true } = {}) {
  const actif = (e) => !e.defaultPrevented && glisseFacture(e.dataTransfer) && peutDeposerFacture(app) && accepte();
  const survol = (e) => { if (!actif(e)) return; e.preventDefault(); zone.classList.add(CLASSE_CIBLE); };
  const quitter = (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove(CLASSE_CIBLE); };
  const depot = async (e) => {
    zone.classList.remove(CLASSE_CIBLE);
    if (!actif(e)) return;
    e.preventDefault();
    const fichiers = fichiersFacture(e.dataTransfer.files);
    if (!fichiers.length) { app.message(texte('facture_electronique_btp.depot.non_reconnu'), 'avertissement'); return; }
    const r = await importerFacturesRecues(app, fichiers, { ouvrir });
    await apres(r);
  };
  zone.addEventListener('dragover', survol);
  zone.addEventListener('dragleave', quitter);
  zone.addEventListener('drop', depot);
  return () => { zone.removeEventListener('dragover', survol); zone.removeEventListener('dragleave', quitter); zone.removeEventListener('drop', depot); };
}
