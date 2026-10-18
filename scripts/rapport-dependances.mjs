// Rapport des dépendances par module (paquets npm et NuGet, polices et ressources livrées) :
// écrit documentation/DEPENDANCES.md. Lancer après tout ajout ou mise à jour : npm run rapport-dependances.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const lireJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const ignorer = new Set(['node_modules', 'bin', 'obj', '.git', 'dist']);

function fichiers(dossier, filtre, res = []) {
  for (const nom of readdirSync(dossier)) {
    if (ignorer.has(nom)) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) fichiers(chemin, filtre, res);
    else if (filtre(nom)) res.push(chemin);
  }
  return res;
}

// Module d'un fichier : socle, modules/<nom>, client, src (cœur serveur), tests.
function moduleDe(chemin) {
  const p = relative(racine, chemin).split(sep);
  if (p[0] === 'modules') return `modules/${p[1]}`;
  return { src: 'cœur (src)', tests: 'cœur (tests)' }[p[0]] ?? p[0];
}

const licenceNpm = (nom) => {
  const f = join(racine, 'node_modules', nom, 'package.json');
  if (!existsSync(f)) return { version: '?', licence: '?' };
  const p = lireJson(f);
  return { version: p.version, licence: typeof p.license === 'string' ? p.license : p.license?.type ?? '?' };
};

const licenceNuget = (id, version) => {
  const f = join(homedir(), '.nuget', 'packages', id.toLowerCase(), version, `${id.toLowerCase()}.nuspec`);
  if (!existsSync(f)) return '?';
  const x = readFileSync(f, 'utf8');
  return x.match(/<license[^>]*>([^<]+)<\/license>/)?.[1] ?? x.match(/<licenseUrl>([^<]+)<\/licenseUrl>/)?.[1] ?? '?';
};

const modules = new Map();
const ajouter = (module, ligne) => {
  if (!modules.has(module)) modules.set(module, []);
  modules.get(module).push(ligne);
};

// npm : paquets externes des espaces de travail (les paquets @logibtp/* sont des liens internes).
for (const ws of lireJson(join(racine, 'package.json')).workspaces) {
  const p = lireJson(join(racine, ws, 'package.json'));
  for (const [genre, deps] of [['exécution', p.dependencies], ['développement', p.devDependencies]]) {
    for (const nom of Object.keys(deps ?? {}).filter((n) => !n.startsWith('@logibtp/'))) {
      const { version, licence } = licenceNpm(nom);
      ajouter(moduleDe(join(racine, ws)), ['npm', nom, version, licence, `${genre} (${ws})`]);
    }
  }
}

// NuGet : PackageReference de chaque projet.
for (const csproj of fichiers(racine, (n) => n.endsWith('.csproj'))) {
  const x = readFileSync(csproj, 'utf8');
  for (const [, id, version] of x.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)) {
    const projet = relative(racine, csproj).split(sep).at(-1).replace('.csproj', '');
    ajouter(moduleDe(csproj), ['NuGet', id, version, licenceNuget(id, version), projet]);
  }
}

// Polices livrées : dossier polices/<famille>/ d'un module, licence dans le même dossier.
for (const police of fichiers(racine, (n) => /\.(ttf|otf)$/i.test(n))) {
  const dossier = dirname(police);
  const licence = readdirSync(dossier).find((n) => /^(OFL|LICENSE)/i.test(n));
  const texte = licence ? readFileSync(join(dossier, licence), 'utf8') : '';
  const type = /SIL OPEN FONT LICENSE/i.test(texte) ? 'OFL-1.1' : licence ?? '?';
  ajouter(moduleDe(police), ['police', relative(racine, police).split(sep).join('/'), '—', type, licence ?? 'licence absente']);
}

const ordre = (m) => (m === 'socle' ? '0' : m.startsWith('modules/') ? `1${m}` : `2${m}`);
let md = `# LogiBTP – dépendances par module

> Fichier généré par \`npm run rapport-dependances\` (\`scripts/rapport-dependances.mjs\`) : ne pas modifier à la main,
> relancer après tout ajout ou mise à jour d'une dépendance. Versions npm installées (\`node_modules\`), licences lues
> dans les paquets ; NuGet : licence du \`.nuspec\` du cache local (\`?\` si le paquet n'est pas restauré).
`;
for (const module of [...modules.keys()].sort((a, b) => ordre(a).localeCompare(ordre(b)))) {
  md += `\n## ${module}\n\n| Type | Dépendance | Version | Licence | Usage |\n|---|---|---|---|---|\n`;
  const lignes = modules.get(module).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  for (const l of lignes) md += `| ${l.join(' | ')} |\n`;
}
writeFileSync(join(racine, 'documentation', 'DEPENDANCES.md'), md);
console.log(`documentation/DEPENDANCES.md : ${[...modules.values()].flat().length} dépendances, ${modules.size} modules`);
