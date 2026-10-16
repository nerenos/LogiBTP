import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Host conservé : l'API choisit la base de la société d'après le sous-domaine (demo.localhost:5173).
      // LOGIBTP_API : autre API (ex. instance de vérification sur un autre port).
      '/api': { target: process.env.LOGIBTP_API ?? 'http://localhost:5080', changeOrigin: false },
    },
  },
  test: {
    include: ['test/**/*.test.js'],
  },
});
