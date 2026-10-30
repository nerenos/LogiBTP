// Application de terrain (ANALYSE-TERRAIN.md) : règles sans interface de la page /terrain (testées par
// test/terrain.test.js) : partie mobile d'une tâche complétée par son chantier, lien d'itinéraire, liens saisis.
import { ajouterJours } from '@logibtp/socle';

/** Applications de navigation proposées (préférence `terrainNavigation` du navigateur, T11). */
export const NAVIGATIONS = Object.freeze({ AUTO: 'Selon l\'appareil', GOOGLE: 'Google Maps', WAZE: 'Waze', APPLE: 'Plans (Apple)' });

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
export function liensTexte(texte) {
  return (texte ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (/^https?:\/\/\S+$/i.test(l) ? { url: l, libelle: l.replace(/^https?:\/\//i, '') } : { texte: l }));
}

/** Numéro de téléphone pour un lien tel: (chiffres et + seulement), null s'il n'en reste rien. */
export function numeroTel(telephone) {
  const n = (telephone ?? '').replace(/[^\d+]/g, '');
  return n.length >= 4 ? n : null;
}
