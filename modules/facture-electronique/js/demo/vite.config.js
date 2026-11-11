import { defineConfig } from 'vite';

// Page de démonstration des écrans du module (npm run demo --workspace @logibtp/facture-electronique) : API simulée
// en mémoire, aucun serveur. Les fichiers du dépôt (socle, personnalisation) sont lus depuis la racine.
export default defineConfig({ root: import.meta.dirname, server: { port: 5181, fs: { allow: ['../../../..'] } } });
