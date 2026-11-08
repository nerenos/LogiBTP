// Application de terrain (ANALYSE-TERRAIN.md) : règles sans interface de la page /terrain (testées par
// test/terrain.test.js) : partie mobile d'une tâche complétée par son chantier, lien d'itinéraire, liens saisis.
import { textesParCode, texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { ajouterJours } from '@logibtp/socle';

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

/** Côté le plus long d'une photo réduite par défaut (T17 : « qualité d'origine » au choix). */
export const PHOTO_COTE_MAX = 2000;

/** Dimensions d'une image réduite pour que son plus grand côté ne dépasse pas `max` (jamais agrandie). */
export function dimensionsReduites(largeur, hauteur, max = PHOTO_COTE_MAX) {
  const r = Math.min(1, max / Math.max(largeur, hauteur));
  return { largeur: Math.round(largeur * r), hauteur: Math.round(hauteur * r), reduite: r < 1 };
}

/**
 * Photo prête à envoyer : réduite en JPEG (qualité 0,85) si elle dépasse `max`, sinon le fichier d'origine ; en cas
 * d'échec de lecture (format non affichable par le navigateur, HEIC…) : le fichier d'origine.
 */
export async function preparerPhoto(fichier, { origine = false, max = PHOTO_COTE_MAX } = {}) {
  if (origine || typeof createImageBitmap !== 'function') return fichier;
  try {
    const image = await createImageBitmap(fichier);
    const d = dimensionsReduites(image.width, image.height, max);
    if (!d.reduite) { image.close?.(); return fichier; }
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
 * pointage, ordres et étapes. Adresses identiques à celles de la page (le service worker garde les réponses par adresse).
 */
export function adressesAPrecharger(jour, salarie = null, { demandes = false } = {}) {
  const lundi = lundiDe(jour);
  const jours = Array.from({ length: 14 }, (_, i) => ajouterJours(lundi, i));
  const params = (o) => new URLSearchParams(o).toString();
  return [
    ...jours.map((d) => `/api/terrain?${params({ du: d, au: d })}`),
    ...[lundi, ajouterJours(lundi, 7)].map((d) => `/api/terrain?${params({ du: d, au: ajouterJours(d, 6) })}`),
    ...jours.slice(0, 7).map((d) => `/api/terrain/journee?date=${d}`),
    ...(salarie ? jours.slice(0, 7).map((d) => `/api/pointage/repas/${salarie}?du=${d}&au=${d}`) : []),
    '/api/pointage/referentiels', '/api/terrain/etapes',
    ...(demandes ? ['/api/terrain/demandes'] : []),
  ];
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
