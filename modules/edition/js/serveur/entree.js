// Point d'entrée du moteur d'édition exécuté côté serveur dans Jint (LogiBTP.Editions.MoteurEditionJs).
// Paquet unique construit par `npm run construire --workspace modules/edition/js` (esbuild, format IIFE) ; échanges
// en JSON (chaînes) et en octets (Uint8Array) ; aucune entrée-sortie ici : tout vient du serveur.
import { editer, produirePdf, Polices, verifierModele, dependances, lireImage, base64VersOctets, normaliserModele } from '../src/index.js';

// Jint n'a pas de minuterie : pdf-lib ne s'en sert que pour céder la main entre deux étapes.
if (typeof globalThis.setTimeout !== 'function') {
  globalThis.setTimeout = (f) => { Promise.resolve().then(f); return 0; };
  globalThis.clearTimeout = () => {};
}

let polices = null;

function ressourcesDe(json) {
  const res = {};
  for (const [code, r] of Object.entries(json ?? {})) {
    res[code] = { ...r, octets: r.base64 ? base64VersOctets(r.base64) : null };
    delete res[code].base64;
  }
  return res;
}

function editerJson(modeleJson, donneesJson, envJson) {
  if (!polices) throw new Error('Moteur d’édition non initialisé (polices)');
  const env = JSON.parse(envJson || '{}');
  const ressources = ressourcesDe(env.ressources);
  const resultat = editer(JSON.parse(modeleJson), JSON.parse(donneesJson || '{}'), { ...env, ressources, polices });
  return { resultat, env, ressources };
}

globalThis.LogiBTPEdition = {
  /** faces : [{ famille, graisse, italique, octets (Uint8Array) }] */
  initialiser(faces) {
    polices = new Polices();
    for (const f of faces) polices.ajouter(f.famille, { graisse: f.graisse, italique: !!f.italique }, f.octets);
    return polices.familles().join(',');
  },
  /** Arbre de pages (JSON) : { pages, alertes, page }. */
  pages(modeleJson, donneesJson, envJson) {
    const { resultat } = editerJson(modeleJson, donneesJson, envJson);
    return JSON.stringify(resultat);
  },
  /** PDF (Uint8Array) ; alertes de la dernière édition dans `derniereAlertes` (JSON). */
  async pdf(modeleJson, donneesJson, envJson) {
    const t0 = Date.now();
    const { resultat, env, ressources } = editerJson(modeleJson, donneesJson, envJson);
    const chronos = { mise_en_page: Date.now() - t0 };
    this.derniereAlertes = JSON.stringify(resultat.alertes);
    this.dernieresPages = resultat.pages.length;
    // Compression par l'hôte (.NET) si elle est fournie : pako est lent dans Jint.
    const deflate = typeof globalThis.__deflate === 'function' && env.pdf?.compresser !== false ? globalThis.__deflate : undefined;
    const pdf = await produirePdf(resultat, polices, { ...(env.pdf ?? {}), ressources, chronos, deflate });
    this.derniersChronos = JSON.stringify(chronos);
    return pdf;
  },
  derniereAlertes: '[]',
  derniersChronos: '{}',
  dernieresPages: 0,
  verifierModele: (json) => JSON.stringify(verifierModele(JSON.parse(json))),
  dependances: (json) => JSON.stringify(dependances(normaliserModele(JSON.parse(json)))),
  lireImage: (octets) => JSON.stringify(lireImage(octets)),
};
