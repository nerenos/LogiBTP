import { defineConfig } from 'vitest/config';

// Dictionnaire du socle et de la navigation posé avant chaque fichier de test (module Personnalisation).
export default defineConfig({ test: { setupFiles: ['./test/preparation.js'] } });
