import { defineConfig } from 'vitest/config';

// Dictionnaire du socle posé avant chaque fichier de test (textes réels à l'écran, module Personnalisation).
export default defineConfig({ test: { setupFiles: ['./test/preparation.js'] } });
