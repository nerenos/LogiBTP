import { texte, icone } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { tailleMaxDepot } from '@logibtp/ged';
import { api } from '../api.js';
import { ETAT_RESERVE } from '../codes.js';
import { declarerOperation, ecrireOperation } from '../hors-ligne/operations.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { SUJET_ATTENTE } from '../hors-ligne/synchro.js';

// Application de terrain, lot 4 (ANALYSE-TERRAIN.md T9, T10) : saisies du terrain gardées sur l'appareil quand le
// serveur est injoignable, envoyées au retour du réseau par la file d'opérations (hors-ligne/operations.js). Les
// photos sont gardées déjà réduites (Blob dans l'IndexedDB).

/** Types d'opérations du terrain. */
export const OPERATION_TERRAIN = Object.freeze({
  JOURNEE: 'terrain-journee', AVANCEMENT: 'terrain-avancement', NON_CONFORMITE: 'terrain-nc', PHOTOS: 'terrain-photos',
  ETAPE: 'terrain-etape', REPAS: 'terrain-repas', RECEPTION: 'terrain-reception', DEMANDE: 'terrain-demande', SAV: 'terrain-sav',
  LIVRAISON: 'terrain-livraison', MATERIEL: 'terrain-materiel', LEVEE_RESERVE: 'terrain-levee-reserve',
  PV_LEVEE: 'terrain-pv-levee',
});

/** Clé du localStorage où l'appareil garde la limite de dépôt de la GED (terrain-suites lot 12). */
const CLE_LIMITE_PHOTOS = 'logibtp.terrainLimitePhotos';

/**
 * Limite de dépôt de la GED (octets, `taille_max_photo` de `GET /api/terrain`) gardée sur l'appareil, pour contrôler
 * les photos même sans réseau.
 */
export function memoriserLimitePhotos(octets) {
  if (!(Number(octets) > 0)) return;
  try { localStorage.setItem(CLE_LIMITE_PHOTOS, String(Number(octets))); } catch { /* stockage indisponible : limite par défaut */ }
}

/** Limite de dépôt gardée sur l'appareil, sinon celle par défaut de la GED. */
export function limitePhotos() {
  let gardee = null;
  try { gardee = localStorage.getItem(CLE_LIMITE_PHOTOS); } catch { /* stockage indisponible */ }
  return tailleMaxDepot({ taille_max_depot: gardee });
}

/**
 * Réception (ou PV de levée des réserves, lot 16) gardée sur l'appareil (terrain-suites lot 13, TS16 a) : heure de
 * signature de l'appareil jointe (`signee_le`, ISO), imprimée sur le PV avec l'heure de réception par le serveur.
 */
export const receptionGardee = (reception, maintenant = new Date()) => ({ ...reception, signee_le: maintenant.toISOString() });

/**
 * Formulaire de levée d'une réserve (terrain-suites lot 15) : commentaire, heure de l'appareil (`levee_le`, levée
 * gardée hors ligne seulement) et photo de la levée (la première choisie).
 */
export const formulaireLevee = ({ commentaire, levee_le: leveeLe, photos }) => {
  const f = new FormData();
  if (commentaire) f.append('commentaire', commentaire);
  if (leveeLe) f.append('levee_le', leveeLe);
  const photo = photos?.fichiers?.[0];
  if (photo) f.append('photo', photo, photo.name);
  return f;
};

/**
 * PV de levée des réserves à faire signer (terrain-suites lot 16) : signalé par le serveur, ou, sans réseau, quand
 * chaque réserve est levée ou gardée levée sur l'appareil, l'une au moins gardée.
 */
export const pvLeveeAttendu = (d) => Boolean(d?.pv_levee_attendu)
  || ((d?.reserves ?? []).length > 0 && d.reserves.every((r) => r.etat === ETAT_RESERVE.LEVEE || r.gardee) && d.reserves.some((r) => r.gardee));

/**
 * Articles des chantiers à garder hors ligne (bibliothèque simplifiée, terrain-suites lot 18) : adresses des articles
 * de chaque chantier des tâches lues (`GET /api/terrain`), sans doublon, gardées par le service worker.
 */
export function articlesAPrecharger(lectures) {
  const ids = new Set();
  for (const r of lectures ?? []) for (const t of r?.taches ?? []) if (t.chantier?.id) ids.add(t.chantier.id);
  return [...ids].map((id) => api.terrain.bibliotheque.urlChantier(id));
}

/** Formulaire d'envoi de photos gardées ({ fichiers: [File], commentaire }). */
export const formulairePhotos = ({ fichiers, commentaire }) => {
  const f = new FormData();
  for (const p of fichiers) f.append('fichiers', p, p.name);
  if (commentaire) f.append('commentaire', commentaire);
  return f;
};

// Journée envoyée puis relue : l'appareil garde la version du serveur (consultation hors ligne suivante).
declarerOperation(OPERATION_TERRAIN.JOURNEE, {
  envoyer: async (c) => { await api.terrain.enregistrerJournee(c); await api.terrain.journee(c.date).catch(() => {}); },
});
declarerOperation(OPERATION_TERRAIN.AVANCEMENT, { envoyer: (c) => api.terrain.enregistrerAvancement(c.tache, c.avancement) });
declarerOperation(OPERATION_TERRAIN.NON_CONFORMITE, {
  envoyer: async (c) => {
    await api.terrain.nonConformite(c.tache, c.nc);
    if (c.photos?.fichiers?.length) await api.terrain.photos(c.tache, formulairePhotos(c.photos));
  },
});
declarerOperation(OPERATION_TERRAIN.PHOTOS, { envoyer: (c) => api.terrain.photos(c.tache, formulairePhotos(c.photos)) });
// Réception signée hors ligne : signature gardée en image, heure de signature de l'appareil jointe (signee_le) ;
// horodatage du serveur à l'envoi, les deux imprimés sur le PV (terrain-suites lot 13).
declarerOperation(OPERATION_TERRAIN.RECEPTION, { envoyer: (c) => api.terrain.enregistrerReception(c.ordre, c.reception) });
// Levée d'une réserve gardée hors ligne : heure de l'appareil jointe (levee_le), photo gardée réduite ; une levée déjà
// reçue par le serveur n'est pas changée (envoi rejoué sans effet).
declarerOperation(OPERATION_TERRAIN.LEVEE_RESERVE, { envoyer: (c) => api.terrain.leverReserve(c.ordre, c.reserve, formulaireLevee(c)) });
// PV de levée signé hors ligne (terrain-suites lot 16) : envoyé après les levées gardées (file dans l'ordre de saisie),
// heure de signature de l'appareil jointe (signee_le, receptionGardee).
declarerOperation(OPERATION_TERRAIN.PV_LEVEE, { envoyer: (c) => api.terrain.signerPvLevee(c.ordre, c.pv) });
declarerOperation(OPERATION_TERRAIN.DEMANDE, {
  envoyer: async (c) => {
    await api.terrain.demande(c.demande);
    if (c.photos?.fichiers?.length && c.tache) await api.terrain.photos(c.tache, formulairePhotos(c.photos));
  },
});
declarerOperation(OPERATION_TERRAIN.SAV, {
  envoyer: async (c) => {
    if (c.photos?.fichiers?.length) await api.terrain.photosSav(c.ordre, formulairePhotos(c.photos));
    await api.terrain.enregistrerSav(c.ordre, c.compteRendu);
  },
});
declarerOperation(OPERATION_TERRAIN.LIVRAISON, {
  envoyer: async (c) => {
    await api.terrain.enregistrerLivraison(c.commande, c.livraison);
    if (c.photos?.fichiers?.length) await api.terrain.photos(c.tache, formulairePhotos(c.photos));
  },
});
declarerOperation(OPERATION_TERRAIN.MATERIEL, { envoyer: (c) => api.terrain.pointerMateriel(c.tache, c.saisie) });
declarerOperation(OPERATION_TERRAIN.ETAPE, { envoyer: (c) => api.terrain.validerEtape(c.ent_id, c.code) });
declarerOperation(OPERATION_TERRAIN.REPAS, { envoyer: (c) => api.pointage.enregistrerRepas(c.salarie, c.repas) });

/**
 * Envoie une saisie du terrain ; serveur injoignable (ou déjà perdu) : gardée sur l'appareil. Renvoie
 * { reponse } si elle est envoyée, { horsLigne: true } si elle est gardée ; un refus du serveur est levé.
 */
export async function envoyerOuGarder(app, { type, id, corps, libelle, url = '/terrain' }, envoyer) {
  if (!app.apiPerdue) {
    try {
      return { reponse: await envoyer() };
    } catch (e) {
      if (!estHorsLigne(e)) throw e;
    }
  }
  await ecrireOperation({ compte: app.utilisateur(), type, id, corps, libelle, url });
  app.publier(SUJET_ATTENTE, {});
  app.message(texte('terrain_btp.hors_ligne.garde', { libelle }), 'avertissement');
  return { horsLigne: true };
}

/**
 * Fournisseur de l'écran des étapes (EcranEtapesAtelier) : validation gardée sur l'appareil hors ligne ; l'étape est
 * alors marquée validée localement (« ⏳ sur l'appareil ») jusqu'à l'envoi.
 */
export function fournisseurEtapes(app, charger) {
  let ordres = [];
  return {
    charger: async () => { const r = await charger(); ordres = r.ordres ?? []; return r; },
    ordre: (numero) => api.terrain.ordreEtapes(numero),
    valider: async (entId, code) => {
      const o = ordres.find((x) => x.ent_id === entId);
      const etape = o?.etapes.find((e) => e.code === code);
      const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.ETAPE, id: `${entId}:${code}`, corps: { ent_id: entId, code },
        libelle: texte('terrain_btp.hors_ligne.etape', { etape: etape?.libelle ?? code, ordre: o?.numero ?? entId }), url: '/terrain?onglet=ordres' }, () => api.terrain.validerEtape(entId, code));
      if (r.reponse) return r.reponse;
      const etapes = (o?.etapes ?? []).map((e) => (e.code === code ? { ...e, valide_le: aujourdhui(), valide_par: `${icone('terrain_btp_attente')} ${texte('terrain_btp.hors_ligne.sur_appareil')}` } : e));
      return { etapes, en_cours: etapes.find((e) => !e.valide_le)?.code ?? null };
    },
  };
}
