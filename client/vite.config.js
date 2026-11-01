import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import { personnalisation } from '@logibtp/personnalisation/vite';
import { COUCHES, PRECHARGES } from './personnalisation/couches.js';

/**
 * Service worker (application installable, mode hors ligne) : sw.js produit à la construction depuis src/pwa/sw.js,
 * complété des règles de src/pwa/regles.js (sans les export), de la liste des fichiers de l'application (gardés à
 * l'installation) et d'une version (empreinte de cette liste : un nouveau client remplace le cache précédent).
 */
function serviceWorker() {
  const lire = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  return {
    name: 'logibtp-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const publics = readdirSync(new URL('./public', import.meta.url));
      const fichiers = [...new Set(['/index.html', ...publics.map((f) => `/${f}`), ...Object.keys(bundle).map((f) => `/${f}`)])]
        .filter((f) => f !== '/sw.js' && !f.endsWith('.map') && !f.startsWith('/.vite/')).sort();
      const version = createHash('sha256').update(fichiers.join('\n')).digest('hex').slice(0, 12);
      const source = lire('./src/pwa/sw.js')
        .replace('/* REGLES */', lire('./src/pwa/regles.js').replace(/^export /gm, ''))
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__FICHIERS__', JSON.stringify(fichiers));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Politique de sécurité du contenu (ANALYSE-MODULE-DROITS.md § 10.4, option C) : scripts du domaine seulement (aucun
// script en ligne : demarrage-theme.js, demarrage-apercu.js), styles en ligne permis. D'abord en mode rapport ; en
// production, le proxy pose le même en-tête en mode bloquant (Content-Security-Policy).
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "connect-src 'self' ws: wss:", "frame-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

// Host conservé : l'API choisit la base de la société d'après le sous-domaine (demo.localhost:5173).
// LOGIBTP_API : autre API (ex. instance de vérification sur un autre port).
const proxy = { '/api': { target: process.env.LOGIBTP_API ?? 'http://localhost:5080', changeOrigin: false } };

export default defineConfig({
  // Textes, thème et images (module Personnalisation) : /personnalisation/* servis en développement, écrits dans
  // dist/personnalisation/ à la construction, préchargés par index.html.
  plugins: [personnalisation({
    couches: COUCHES, precharger: PRECHARGES, icone: 'images/icone.svg', modules: ['src/app/application.js'],
  }), serviceWorker()],
  server: {
    port: 5173,
    headers: { 'Content-Security-Policy-Report-Only': CSP },
    proxy,
  },
  // Aperçu du client construit (npm run apercu) : service worker et mode hors ligne comme en production.
  preview: { port: 4173, headers: { 'Content-Security-Policy-Report-Only': CSP }, proxy },
  test: {
    include: ['test/**/*.test.js'],
    // Dictionnaire composé des couches posé avant chaque fichier de test (vrais textes).
    setupFiles: ['./test/preparation.js'],
  },
});
