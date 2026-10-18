// Construit le paquet du moteur exécuté côté serveur (Jint) : modules/edition/dotnet/LogiBTP.Editions/moteur/.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const ici = (p) => fileURLToPath(new URL(p, import.meta.url));
await build({
  entryPoints: [ici('../serveur/entree.js')],
  outfile: ici('../../dotnet/LogiBTP.Editions/moteur/moteur-edition.js'),
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2020',
  minify: true,
  legalComments: 'eof',
  banner: { js: '// Fichier généré par `npm run construire --workspace modules/edition/js` : ne pas modifier.' },
  logLevel: 'warning',
});
console.log('moteur-edition.js construit');
