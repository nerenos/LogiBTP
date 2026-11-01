// Greffon Vite du module Personnalisation (ANALYSE-MODULE-PERSONNALISATION.md § 5.2) :
// - développement : sert /personnalisation/* (fr.json, images/icones.json, images/emojis.json, theme.css, images) composés des couches,
//   page rechargée quand un de leurs fichiers change ;
// - construction : écrit ces fichiers dans dist/personnalisation/ (servis par l'API avec la surcharge de l'installation) ;
// - module virtuel « virtual:logibtp-personnalisation » : { libelles, icones, emojis } du programme, dictionnaire de secours
//   importé à la demande quand fr.json est injoignable (jamais de clés brutes à l'écran) ;
// - index.html : préchargement de fr.json et feuille theme.css bloquante (pas d'éclair de textes ni de couleurs).
import path from 'node:path';
import { composer, contenu, DICTIONNAIRE, ICONES, EMOJIS, THEME } from './composition.js';

export const MODULE_SECOURS = 'virtual:logibtp-personnalisation';
const RESOLU = `\0${MODULE_SECOURS}`;
const ADRESSE = '/personnalisation/';

/**
 * Balises posées dans l'entête d'index.html (sans script en ligne : politique de sécurité du contenu) : icône de la
 * page, feuille du thème (après les styles de l'application : l'installation peut aussi corriger une règle),
 * préchargement du dictionnaire, des catalogues des icônes et des emojis et des fichiers `precharger` (relatifs à /personnalisation/).
 */
export function balisesHtml(precharger = [], icone = null) {
  return [
    ...(icone ? [{ tag: 'link', attrs: { rel: 'icon', href: `${ADRESSE}${icone}`, type: icone.endsWith('.svg') ? 'image/svg+xml' : undefined }, injectTo: 'head' }] : []),
    ...[DICTIONNAIRE, ICONES, EMOJIS, ...precharger].map((f) => ({ tag: 'link', attrs: { rel: 'preload', href: `${ADRESSE}${f}`, as: 'fetch', crossorigin: '' }, injectTo: 'head' })),
    { tag: 'link', attrs: { rel: 'stylesheet', href: `${ADRESSE}${THEME}` }, injectTo: 'head' },
  ];
}

/**
 * @param {{ couches: string[], precharger?: string[], icone?: string, modules?: string[] }} options
 *   couches : dossiers « personnalisation/ » dans l'ordre socle → modules → cœur ;
 *   precharger : fichiers lus au démarrage (logo du bandeau…) ; icone : icône de la page (images/…) ;
 *   modules : modules importés après le chargement du dictionnaire (application), téléchargés dès la page
 *   (modulepreload : sans les exécuter) pour ne pas attendre le dictionnaire.
 */
export function personnalisation({ couches, precharger = [], icone = null, modules = [] }) {
  let composition = composer(couches);
  const recomposer = () => { composition = composer(couches); };
  return {
    name: 'logibtp-personnalisation',
    resolveId: (id) => (id === MODULE_SECOURS ? RESOLU : null),
    load(id) {
      if (id !== RESOLU) return null;
      recomposer();
      for (const f of composition.fichiers) this.addWatchFile(f);
      return `export default ${JSON.stringify({ libelles: composition.libelles, icones: composition.icones, emojis: composition.emojis })};`;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_, contexte) {
        const balises = balisesHtml(precharger, icone);
        const contient = (c, m) => (c.moduleIds ?? Object.keys(c.modules ?? {})).some((id) => id.replace(/\\/g, '/').endsWith(m));
        const chunks = Object.values(contexte.bundle ?? {}).filter((c) => c.type === 'chunk' && c.isDynamicEntry && modules.some((m) => contient(c, m)));
        for (const c of chunks) balises.push({ tag: 'link', attrs: { rel: 'modulepreload', href: `/${c.fileName}`, crossorigin: '' }, injectTo: 'head' });
        return balises;
      },
    },
    configureServer(serveur) {
      const dossiers = couches.map((c) => path.resolve(c) + path.sep);
      serveur.watcher.add(dossiers);
      serveur.watcher.on('all', (_, fichier) => {
        if (!dossiers.some((d) => path.resolve(fichier).startsWith(d))) return;
        recomposer();
        const m = serveur.moduleGraph.getModuleById(RESOLU);
        if (m) serveur.moduleGraph.invalidateModule(m);
        serveur.ws.send({ type: 'full-reload' });
      });
      serveur.middlewares.use((req, res, next) => {
        const chemin = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!chemin.startsWith(ADRESSE)) { next(); return; }
        const f = contenu(composition, chemin.slice(ADRESSE.length));
        if (!f) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', f.type);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(f.corps);
      });
    },
    generateBundle() {
      recomposer();
      const emettre = (relatif) => this.emitFile({ type: 'asset', fileName: `personnalisation/${relatif}`, source: contenu(composition, relatif).corps });
      emettre(DICTIONNAIRE);
      emettre(ICONES);
      emettre(EMOJIS);
      emettre(THEME);
      for (const r of composition.images.keys()) emettre(r);
    },
  };
}
