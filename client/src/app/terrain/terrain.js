// Application de terrain (ANALYSE-TERRAIN.md) : règles sans interface de la page /terrain (testées par
// test/terrain.test.js) : partie mobile d'une tâche complétée par son chantier, lien d'itinéraire, liens saisis.
import { textesParCode, texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { ajouterJours } from '@logibtp/socle';
import { ETAT_ATTENTE } from '../hors-ligne/attente.js';
import { ERREUR_TERRAIN } from '../codes.js';

/** Applications de navigation proposées (préférence `terrainNavigation` du navigateur, T11). */
export const NAVIGATIONS = textesParCode('terrain_btp.navigations', ['AUTO', 'GOOGLE', 'WAZE', 'APPLE']);

/** Lundi de la semaine d'une date « AAAA-MM-JJ ». */
export function lundiDe(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  const rang = (new Date(Date.UTC(a, m - 1, j)).getUTCDay() + 6) % 7;
  return ajouterJours(jour, -rang);
}

/**
 * Partie mobile affichée d'une tâche : valeurs saisies au planning, sinon celles du chantier (adresse des travaux,
 * contact sur place et son téléphone), marquées `herite`.
 */
export function mobileAffiche(tache, defauts = {}) {
  const m = tache.mobile ?? {};
  const d = (tache.chantier && defauts[String(tache.chantier.id)]) || {};
  const champ = (cle) => (m[cle]?.trim() ? { valeur: m[cle].trim(), herite: false } : d[cle] ? { valeur: d[cle], herite: true } : null);
  return { adresse: champ('adresse'), contact: champ('contact'), telephone: champ('telephone'), commentaire: m.commentaire?.trim() || null, liens: m.liens?.trim() || null };
}

/** Adresse d'itinéraire vers une adresse postale (aucune position enregistrée : décision M15 du Pointage). */
export function lienItineraire(adresse, mode = 'AUTO', agent = '') {
  const a = encodeURIComponent(adresse);
  const choisi = mode !== 'AUTO' ? mode : /iPad|iPhone|iPod|Macintosh/.test(agent) && /Mobile|iPad|iPhone/.test(agent) ? 'APPLE'
    : /Android/.test(agent) ? 'GEO' : 'GOOGLE';
  switch (choisi) {
    case 'WAZE': return `https://waze.com/ul?q=${a}&navigate=yes`;
    case 'APPLE': return `https://maps.apple.com/?daddr=${a}`;
    case 'GEO': return `geo:0,0?q=${a}`;
    default: return `https://www.google.com/maps/dir/?api=1&destination=${a}`;
  }
}

/** Liens saisis (un par ligne) : adresses http(s) cliquables, le reste en texte. */
export function liensTexte(saisie) {
  return (saisie ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (/^https?:\/\/\S+$/i.test(l) ? { url: l, libelle: l.replace(/^https?:\/\//i, '') } : { texte: l }));
}

/** Numéro de téléphone pour un lien tel: (chiffres et + seulement), null s'il n'en reste rien. */
export function numeroTel(telephone) {
  const n = (telephone ?? '').replace(/[^\d+]/g, '');
  return n.length >= 4 ? n : null;
}

/**
 * « Compléter la journée » (T7) : les minutes prévues au calendrier moins celles déjà saisies sont réparties entre les
 * lignes sans durée, au prorata de leur poids (heures planifiées de la tâche ce jour ; aucune n'en a : parts égales), au pas
 * de saisie ; le reste d'arrondi va à la ligne la plus lourde. Renvoie les minutes de chaque ligne (null : inchangée).
 */
export function completerJournee(lignes, minutesPrevues, pas = 0) {
  const vides = lignes.map((l, i) => ({ i, poids: Number(l.poids) > 0 ? Number(l.poids) : 0 })).filter(({ i }) => !(lignes[i].minutes > 0));
  const resultat = lignes.map(() => null);
  const reste = minutesPrevues - lignes.reduce((s, l) => s + (l.minutes > 0 ? l.minutes : 0), 0);
  if (!vides.length || reste <= 0) return resultat;
  if (vides.every((v) => v.poids === 0)) vides.forEach((v) => { v.poids = 1; });
  // Une ligne sans heures planifiées (saisie libre) reste vide quand d'autres en ont.
  const servies = vides.filter((v) => v.poids > 0);
  const total = servies.reduce((s, v) => s + v.poids, 0);
  const p = pas > 0 ? pas : 1;
  for (const v of servies) resultat[v.i] = Math.floor((reste * v.poids) / total / p) * p;
  const lourde = servies.reduce((a, b) => (b.poids > a.poids ? b : a));
  resultat[lourde.i] += reste - servies.reduce((s, v) => s + resultat[v.i], 0);
  return resultat;
}

/**
 * Présaisie (T7, lot 7) : une ligne par tâche du jour, les heures du calendrier réparties au prorata des heures planifiées.
 * Tâches : [{ id, cha_id, ent_id, type_mo, chef, membres, poids }] ; rien à proposer sans tâche ou sans heures prévues.
 */
export function presaisirJournee(taches, minutesPrevues, pas = 0) {
  if (!taches.length || !(minutesPrevues > 0)) return [];
  const minutes = completerJournee(taches.map((t) => ({ minutes: null, poids: t.poids })), minutesPrevues, pas);
  return taches.map((t, i) => ({ id: null, tac_id: t.id, cha_id: t.cha_id, ent_id: t.ent_id, type_mo: t.type_mo, sous_type: null, minutes: minutes[i], motif: null, commentaire: null,
    membres: t.chef ? t.membres.map((m) => m.id) : [], groupe: null, nb_groupe: 0, equipe: false }));
}

/**
 * Libellé de la ligne d'ordre d'un pointage (terrain-suites lot 7, TS5 a) : celle enregistrée, sinon celle de la tâche
 * d'origine ligne tant que le pointage reste sur le document de la ligne (règle du serveur, `LigneDuPointage`).
 */
export function ligneDuPointage(ligne, tache) {
  if (ligne.ligne) return ligne.ligne;
  return tache?.lig_id && tache.ent_id != null && tache.ent_id === ligne.ent_id ? tache.ligne ?? null : null;
}

/** Ajoute à `liste` les éléments de `autres` absents (même `id`), sans modifier les listes reçues. */
const unir = (liste = [], autres = []) => [...liste, ...autres.filter((a) => !liste.some((x) => x.id === a.id))];

/**
 * Journée complétée sans réseau (terrain-suites lot 9, TS10 b) par les chantiers et ordres ouverts gardés sur l'appareil
 * (`GET /api/terrain/journee/chantiers`) : saisie libre et recherche d'un ordre sur un chantier jamais ouvert.
 */
export function completerReferentiel(journee, gardes) {
  if (!gardes?.chantiers?.length) return journee;
  return { ...journee, chantiers: unir(journee.chantiers, gardes.chantiers), ordres: unir(journee.ordres, gardes.ordres) };
}

/**
 * Journée jamais lue sur l'appareil, sans réseau (lot 9) : aucune tâche ni pointage connus, saisie libre seulement sur
 * les chantiers gardés ; `connus` vide à l'envoi, donc aucun pointage du serveur retiré. Null sans droit de saisie libre.
 */
export function journeeSansReseau(jour, gardes) {
  if (!gardes?.personne || !gardes.libre) return null;
  return { personne: gardes.personne, date: jour, minutes_prevues: 0, valide: false, taches: [], pointages: [], libre: gardes.libre, equipiers: [],
    chantiers: gardes.chantiers ?? [], ordres: gardes.ordres ?? [], motifs: [], sansReseau: true };
}

/** État d'un numéro d'ordre saisi sans réseau, inconnu de l'appareil (terrain-suites lot 10, TS11 a). */
export const ETAT_NUMERO = Object.freeze({ A_VERIFIER: 'A_VERIFIER', REFUSE: 'REFUSE' });

/**
 * État du numéro d'une ligne de saisie libre : aucun (ordre choisi ou pas de numéro), « à vérifier » (résolu par le
 * serveur à l'envoi), refusé (journée gardée refusée à l'envoi pour un ordre inconnu, `ERREUR_TERRAIN.ORDRE_INCONNU`).
 */
export function etatNumero(ligne, operation = null) {
  if (!ligne?.numero || ligne.ent_id) return null;
  return operation?.etat === ETAT_ATTENTE.ERREUR && operation.code === ERREUR_TERRAIN.ORDRE_INCONNU ? ETAT_NUMERO.REFUSE : ETAT_NUMERO.A_VERIFIER;
}

/** Numéro d'ordre comparé sans casse ni espaces. */
const numeroNormalise = (n) => String(n ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Ordre cherché par son numéro parmi les ordres connus de l'appareil (lot 9, TS11 b) : numéro exact (sans casse ni
 * espaces), sinon le seul ordre dont le numéro contient la saisie ; null si aucun ou plusieurs.
 */
export function chercherOrdre(numero, ordres = []) {
  const n = numeroNormalise(numero);
  if (!n) return null;
  const exact = ordres.find((o) => numeroNormalise(o.numero) === n);
  if (exact) return exact;
  const proches = ordres.filter((o) => o.numero && numeroNormalise(o.numero).includes(n));
  return proches.length === 1 ? proches[0] : null;
}

/** Côté le plus long d'une photo réduite par défaut (T17 : « qualité d'origine » au choix). */
export const PHOTO_COTE_MAX = 2000;

/** Dimensions d'une image réduite pour que son plus grand côté ne dépasse pas `max` (jamais agrandie). */
export function dimensionsReduites(largeur, hauteur, max = PHOTO_COTE_MAX) {
  const r = Math.min(1, max / Math.max(largeur, hauteur));
  return { largeur: Math.round(largeur * r), hauteur: Math.round(hauteur * r), reduite: r < 1 };
}

/**
 * Types acceptés par les champs photo du terrain (terrain-suites lot 8, TS8 a) : sans `image/heic` ni `image/*`,
 * Safari sur iPhone transcode la photo (appareil ou galerie) en JPEG avant de la donner à la page.
 */
export const TYPES_PHOTOS = 'image/jpeg,image/png';

/** Photo HEIC ou HEIF (type ou extension) : reçue malgré tout (navigateur qui ne transcode pas). */
export const estHeic = (fichier) => /^image\/hei[cf]/i.test(fichier?.type ?? '') || /\.hei[cf]$/i.test(fichier?.name ?? '');

/** Champs de la prise de vue et du lot de la galerie, case « qualité d'origine » (sélecteur de `actions-tache.js`). */
export function champsPhotosHtml() {
  return `<div class="terrain-actions">
      <label class="terrain-bouton">${iconeHtml('terrain_btp_photo')} ${texteHtml('terrain_btp.actions.photos.prendre')}<input type="file" accept="${TYPES_PHOTOS}" capture="environment" hidden data-prise></label>
      <label class="terrain-bouton">${iconeHtml('terrain_btp_galerie')} ${texteHtml('terrain_btp.actions.photos.galerie')}<input type="file" accept="${TYPES_PHOTOS}" multiple hidden data-galerie></label></div>
    <p class="aide" data-choisies>${texteHtml('terrain_btp.actions.photos.aucune')}</p>
    <label class="coche"><input type="checkbox" data-origine> ${texteHtml('terrain_btp.actions.photos.origine')}</label>`;
}

/** Suite donnée à une photo préparée selon la limite de dépôt de la GED (terrain-suites lot 12, TS12). */
export const DECISION_PHOTO = Object.freeze({ GARDER: 'GARDER', REDUIRE: 'REDUIRE', REFUSER: 'REFUSER' });

/**
 * Photo de `taille` octets face à la limite de dépôt (`limite`, octets ; absente : aucune) : gardée si elle tient,
 * sinon réduite de force, ou refusée tout de suite en « qualité d'origine » (jamais réduite).
 */
export function decisionPhoto(taille, limite, { origine = false } = {}) {
  if (!(limite > 0) || !(taille > limite)) return DECISION_PHOTO.GARDER;
  return origine ? DECISION_PHOTO.REFUSER : DECISION_PHOTO.REDUIRE;
}

/** Limite de dépôt en Mo affichée (une décimale au plus). */
export const limiteEnMo = (limite) => Math.round((limite / 1024 / 1024) * 10) / 10;

/** Photo refusée avant d'être gardée ou envoyée : trop lourde pour la GED, même réduite (message avec la limite en Mo). */
export class PhotoTropLourde extends Error {
  constructor(nom, limite, { origine = false } = {}) {
    super(texte(origine ? 'terrain_btp.actions.photos.trop_lourde_origine' : 'terrain_btp.actions.photos.trop_lourde', { nom, mo: limiteEnMo(limite) }));
    this.name = 'PhotoTropLourde';
  }
}

/** JPEG de `fichier` dont le plus grand côté ne dépasse pas `cote` ; null si le navigateur ne sait pas le lire. */
async function encoderJpeg(fichier, cote, qualite) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const image = await createImageBitmap(fichier);
    const d = dimensionsReduites(image.width, image.height, cote);
    const canvas = document.createElement('canvas');
    canvas.width = d.largeur;
    canvas.height = d.hauteur;
    canvas.getContext('2d').drawImage(image, 0, 0, d.largeur, d.hauteur);
    image.close?.();
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', qualite));
    return blob ? new File([blob], fichier.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : null;
  } catch {
    return null;
  }
}

/**
 * Photo prête à envoyer : réduite en JPEG (qualité 0,85) si elle dépasse `max`, sinon le fichier d'origine ; HEIC
 * reçu malgré tout : converti en JPEG (pleine taille en « qualité d'origine », TS9 b) quand le navigateur sait le
 * lire ; en cas d'échec de lecture (format non affichable par le navigateur) : le fichier d'origine, envoyé tel quel.
 * Limite de dépôt de la GED (`limite`, octets, lot 12) : photo trop lourde réduite de force (côté et qualité
 * diminués) ; « qualité d'origine » trop lourde, ou photo qui ne tient pas même réduite : `PhotoTropLourde`.
 */
export async function preparerPhoto(fichier, { origine = false, max = PHOTO_COTE_MAX, limite = null } = {}) {
  const prete = await reduirePhoto(fichier, { origine, max });
  const decision = decisionPhoto(prete.size, limite, { origine });
  if (decision === DECISION_PHOTO.GARDER) return prete;
  if (decision === DECISION_PHOTO.REFUSER) throw new PhotoTropLourde(fichier.name, limite, { origine: true });
  for (let cote = Math.round(max * 0.75), qualite = 0.8; cote >= 480; cote = Math.round(cote * 0.75), qualite = Math.max(0.6, qualite - 0.1)) {
    const r = await encoderJpeg(fichier, cote, qualite);
    if (!r) break;
    if (r.size <= limite) return r;
  }
  throw new PhotoTropLourde(fichier.name, limite);
}

/** Réduction par défaut d'une photo (côté `max`, HEIC converti), sans limite de poids. */
async function reduirePhoto(fichier, { origine, max }) {
  const heic = estHeic(fichier);
  if ((origine && !heic) || typeof createImageBitmap !== 'function') return fichier;
  try {
    const image = await createImageBitmap(fichier);
    const d = dimensionsReduites(image.width, image.height, origine ? Infinity : max);
    if (!d.reduite && !heic) { image.close?.(); return fichier; }
    const canvas = document.createElement('canvas');
    canvas.width = d.largeur;
    canvas.height = d.hauteur;
    canvas.getContext('2d').drawImage(image, 0, 0, d.largeur, d.hauteur);
    image.close?.();
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    return blob ? new File([blob], fichier.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : fichier;
  } catch {
    return fichier;
  }
}

/**
 * Lectures à garder sur l'appareil pour le hors ligne (T10) : tâches de chaque jour et de chaque semaine, de la
 * semaine en cours et de la suivante ; journées de pointage et repas de la semaine en cours ; référentiels du
 * pointage, ordres et étapes ; chantiers et ordres ouverts de la saisie libre sans réseau (terrain-suites lot 9) ; interventions SAV et leurs choix de création (lot 23). Adresses identiques à celles de la page (le service worker garde les réponses par adresse).
 */
export function adressesAPrecharger(jour, salarie = null, { demandes = false, sav = false } = {}) {
  const lundi = lundiDe(jour);
  const jours = Array.from({ length: 14 }, (_, i) => ajouterJours(lundi, i));
  const params = (o) => new URLSearchParams(o).toString();
  return [
    ...jours.map((d) => `/api/terrain?${params({ du: d, au: d })}`),
    ...[lundi, ajouterJours(lundi, 7)].map((d) => `/api/terrain?${params({ du: d, au: ajouterJours(d, 6) })}`),
    ...jours.slice(0, 7).map((d) => `/api/terrain/journee?date=${d}`),
    ...(salarie ? jours.slice(0, 7).map((d) => `/api/pointage/repas/${salarie}?du=${d}&au=${d}`) : []),
    '/api/pointage/referentiels', '/api/terrain/etapes', '/api/terrain/journee/chantiers',
    ...(demandes ? ['/api/terrain/demandes'] : []),
    // SAV : interventions ouvertes et chantiers ou clients proposés à la création hors ligne (terrain-suites lot 23).
    ...(sav ? ['/api/terrain/sav', '/api/terrain/sav/choix'] : []),
  ];
}

/**
 * Fichiers des plans cochés « Terrain » à précharger (plan terrain-suites, lot 4) depuis les lectures de
 * `GET /api/terrain` : identifiants sans doublon, dans l'ordre de lecture ; les plans non cochés ne sont gardés que
 * s'ils ont été ouverts en ligne (budget à part du service worker, `BUDGET_PLANS`).
 */
export function plansAPrecharger(lectures) {
  const ids = new Set();
  for (const r of lectures) for (const liste of Object.values(r?.plans ?? {})) for (const p of liste) if (p.terrain) for (const f of p.fichiers ?? []) ids.add(f.id);
  return [...ids];
}

/** Actions proposées sur la carte d'une tâche, dans l'ordre d'affichage, selon les droits et le contexte. */
export const ACTIONS_TACHE = Object.freeze(['pointage', 'avancement', 'photos', 'nc', 'demande', 'materiel', 'livraison', 'reception', 'fil']);

/**
 * Actions d'une tâche : `droits` { pointage, avancement, demande, materiel, livraison, fil } (booléens), `pose` : la tâche
 * vient d'un ordre de pose (réception signée). Sans chantier : aucune action (tout se rattache au chantier).
 */
export function actionsTache(tache, droits = {}, { pose = false } = {}) {
  if (!tache.chantier) return [];
  const permis = { photos: true, nc: true, reception: pose };
  return ACTIONS_TACHE.filter((a) => (a in permis ? permis[a] : Boolean(droits[a])));
}

/** Minutes pointées par la personne sur la tâche ce jour (0 : rien), d'après `tache.pointages` [{ date, minutes }]. */
export function minutesPointees(tache, jour) {
  return (tache.pointages ?? []).filter((p) => p.date === jour).reduce((s, p) => s + (Number(p.minutes) || 0), 0);
}

/**
 * Tâches dont une journée gardée sur l'appareil (pas encore envoyée) contient une ligne : clés « jour|tâche ».
 * `operations` : opérations du terrain de type journée ({ id: jour, corps: { lignes: [{ tac_id, minutes }] } }).
 */
export function tachesGardees(operations) {
  const cles = new Set();
  for (const o of operations ?? []) for (const l of o.corps?.lignes ?? []) if (l.tac_id && l.minutes > 0) cles.add(`${o.id}|${l.tac_id}`);
  return cles;
}

/** Jour où pointer une tâche depuis sa carte : le jour affiché s'il est dans la tâche, sinon son premier jour (jamais à venir). */
export function jourPointage(tache, jourAffiche, aujourdhui) {
  const debut = tache.debut.slice(0, 10);
  const fin = tache.fin.endsWith('T00:00') ? ajouterJours(tache.fin.slice(0, 10), -1) : tache.fin.slice(0, 10);
  const jour = jourAffiche >= debut && jourAffiche <= fin ? jourAffiche : debut;
  return jour > aujourdhui ? aujourdhui : jour;
}

/**
 * Plans en vigueur d'une tâche (plan terrain-suites, lot 3 ; TS2 b), lus dans `plans` de `GET /api/terrain` (clé :
 * identifiant de la tâche) : cochés « Terrain » en tête, les autres plans validés derrière « Voir tous les plans ».
 */
export function plansTache(tache, plans = {}) {
  const liste = plans?.[tache?.id] ?? [];
  return { entete: liste.filter((p) => p.terrain), autres: liste.filter((p) => !p.terrain) };
}

/** Indice affiché d'un plan : l'indice vide est le premier (avant A). */
const libelleIndice = (i) => (i ? texte('terrain_btp.page.plan_indice', { indice: i }) : texte('terrain_btp.page.plan_premier_indice'));

/**
 * Bloc des plans d'une tâche (vide sans plan) : un lien par fichier de l'indice en vigueur ; plans non cochés repliés
 * sous « Voir tous les plans ». `url(id)` : adresse du fichier, `taille(octets)` : taille affichée.
 */
export function plansTacheHtml({ entete, autres }, { url, taille = () => '' }) {
  if (!entete.length && !autres.length) return '';
  const liens = (liste) => liste.flatMap((p) => p.fichiers.map((f) => `<a class="terrain-piece terrain-plan" href="${echapper(url(f.id))}" target="_blank" rel="noopener">
        ${iconeHtml('terrain_btp_plan')} <span>${echapper(`${p.repere} – ${p.nom}`)}</span><small class="aide">${echapper([libelleIndice(p.indice), p.fichiers.length > 1 ? f.titre : null, f.nom_fichier, taille(f.taille)].filter(Boolean).join(' · '))}</small></a>`)).join('');
  return `<div class="terrain-pieces terrain-plans" title="${texteHtml('terrain_btp.page.plans_titre')}"><b>${texteHtml('terrain_btp.page.plans')}</b>${liens(entete)}${autres.length
    ? `<details class="terrain-plans-autres"><summary>${echapper(pluriel('terrain_btp.page.plans_autres', autres.length))}</summary>${liens(autres)}</details>` : ''}</div>`;
}
