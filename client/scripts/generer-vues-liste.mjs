// Génère db/121_listes_parametrage.sql (sources déclarées et vues de liste par défaut) depuis
// src/app/vues-liste.js, utilisé aussi par la démo hors ligne : une seule source de vérité.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES_LISTE, VUES_LISTE, THEMES_LISTE } from '../src/app/vues-liste.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const sources = Object.entries(SOURCES_LISTE).map(([code, s]) =>
  ` (${[code, s.libelle, s.vue, s.colonne_id, s.colonne_type, s.type_element].map(q).join(', ')})`).join(',\n');
const themes = THEMES_LISTE.map((t) =>
  ` (${q(t.thl_code)}, ${q(t.thl_libelle)}, ${q(t.thl_icone)}, ${t.thl_ordre}, ${q(JSON.stringify(t.thl_types))}::jsonb)`).join(',\n');
const vues = VUES_LISTE.map((v) =>
  ` (${v.vli_id}, ${q(v.vli_nom)}, ${q(v.vli_contexte)}, ${q(v.definition.theme)}, ${q(v.vli_partage)}, ${q(v.vli_proprietaire)}, ${q(v.vli_groupe)}, ${q(JSON.stringify(v.definition))}::jsonb)`).join(',\n');

const sql = `-- =============================================================================
-- Cœur LogiBTP – sources de listes, thèmes et vues par défaut.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/vues-liste.js : ne pas modifier.
-- =============================================================================

INSERT INTO source_liste (sli_code, sli_libelle, sli_vue, sli_colonne_id, sli_colonne_type, sli_type_element) VALUES
${sources};

INSERT INTO theme_liste (thl_code, thl_libelle, thl_icone, thl_ordre, thl_types) VALUES
${themes};

INSERT INTO vue_liste (vli_id, vli_nom, vli_contexte, vli_theme, vli_partage, vli_proprietaire, vli_groupe, vli_definition) VALUES
${vues};

SELECT setval(pg_get_serial_sequence('vue_liste', 'vli_id'), (SELECT max(vli_id) FROM vue_liste));
`;
fs.writeFileSync(path.join(racine, 'db', '121_listes_parametrage.sql'), sql);
console.log('db/121_listes_parametrage.sql généré');
