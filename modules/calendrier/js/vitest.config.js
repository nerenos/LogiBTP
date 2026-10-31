import { defineConfig } from 'vitest/config';

// Dictionnaire du socle et du module posé avant chaque fichier de test (module Personnalisation).
export default defineConfig({ test: { setupFiles: ['./test/preparation.js'] } });
