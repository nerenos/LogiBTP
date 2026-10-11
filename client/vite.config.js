import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Host conservé : l'API choisit la base de la société d'après le sous-domaine (demo.localhost:5173).
      '/api': { target: 'http://localhost:5080', changeOrigin: false },
    },
  },
  test: {
    include: ['test/**/*.test.js'],
  },
});
