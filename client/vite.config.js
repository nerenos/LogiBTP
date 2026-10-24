import { defineConfig } from 'vite';

// Politique de sécurité du contenu (ANALYSE-MODULE-DROITS.md § 10.4, option C) : scripts du domaine seulement (aucun
// script en ligne : demarrage-theme.js, demarrage-apercu.js), styles en ligne permis. D'abord en mode rapport ; en
// production, le proxy pose le même en-tête en mode bloquant (Content-Security-Policy).
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "connect-src 'self' ws: wss:", "frame-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export default defineConfig({
  server: {
    port: 5173,
    headers: { 'Content-Security-Policy-Report-Only': CSP },
    proxy: {
      // Host conservé : l'API choisit la base de la société d'après le sous-domaine (demo.localhost:5173).
      // LOGIBTP_API : autre API (ex. instance de vérification sur un autre port).
      '/api': { target: process.env.LOGIBTP_API ?? 'http://localhost:5080', changeOrigin: false },
    },
  },
  preview: { headers: { 'Content-Security-Policy-Report-Only': CSP } },
  test: {
    include: ['test/**/*.test.js'],
  },
});
