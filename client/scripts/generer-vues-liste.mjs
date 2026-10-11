// Génère db/121_listes_parametrage.sql (sources déclarées, thèmes et vues de liste par défaut) depuis
// src/app/vues-liste.js, et db/131_fiches_parametrage.sql (types de fiches, droits, paramétrage) depuis
// src/app/fiches/definitions.js : ces définitions servent aussi à la démo hors ligne (une seule source de vérité).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES_LISTE, VUES_LISTE, THEMES_LISTE } from '../src/app/vues-liste.js';
import { TYPES_FICHE, DROITS_FICHE, PARAMETRAGE_FICHE } from '../src/app/fiches/definitions.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const sources = Object.entries(SOURCES_LISTE).map(([code, s]) =>
  ` (${[code, s.libelle, s.vue, s.colonne_id, s.colonne_type, s.type_element].map(q).join(', ')}, ${s.modifiable ? 'TRUE' : 'FALSE'})`).join(',\n');
const themes = THEMES_LISTE.map((t) =>
  ` (${q(t.thl_code)}, ${q(t.thl_libelle)}, ${q(t.thl_icone)}, ${t.thl_ordre}, ${q(JSON.stringify(t.thl_types))}::jsonb)`).join(',\n');
const vues = VUES_LISTE.map((v) =>
  ` (${v.vli_id}, ${q(v.vli_nom)}, ${q(v.vli_contexte)}, ${q(v.definition.theme)}, ${q(v.vli_partage)}, ${q(v.vli_proprietaire)}, ${q(v.vli_groupe)}, ${q(JSON.stringify(v.definition))}::jsonb)`).join(',\n');

const sql = `-- =============================================================================
-- Cœur LogiBTP – sources de listes, thèmes et vues par défaut.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/vues-liste.js : ne pas modifier.
-- =============================================================================

INSERT INTO source_liste (sli_code, sli_libelle, sli_vue, sli_colonne_id, sli_colonne_type, sli_type_element, sli_modifiable) VALUES
${sources};

INSERT INTO theme_liste (thl_code, thl_libelle, thl_icone, thl_ordre, thl_types) VALUES
${themes};

INSERT INTO vue_liste (vli_id, vli_nom, vli_contexte, vli_theme, vli_partage, vli_proprietaire, vli_groupe, vli_definition) VALUES
${vues};

SELECT setval(pg_get_serial_sequence('vue_liste', 'vli_id'), (SELECT max(vli_id) FROM vue_liste));
`;
fs.writeFileSync(path.join(racine, 'db', '121_listes_parametrage.sql'), sql);
console.log('db/121_listes_parametrage.sql généré');

// ------------------------------------------------------------------ fiches
const types = Object.entries(TYPES_FICHE).map(([code, t]) =>
  ` (${[code, t.libelle, t.table, t.cle, t.colonne_proprietes].map(q).join(', ')}, ${q(JSON.stringify(t.definition))}::jsonb)`).join(',\n');
const droits = DROITS_FICHE.map((d) => ` (${[d.profil, d.type, d.action].map(q).join(', ')})`).join(',\n');
const obligatoires = Object.entries(PARAMETRAGE_FICHE).flatMap(([type, p]) => p.obligatoires.map((c) => ` (${q(type)}, ${q(c)}, TRUE)`)).join(',\n');
const supplementaires = Object.entries(PARAMETRAGE_FICHE).flatMap(([type, p]) => p.supplementaires.map((c) =>
  ` (${[type, c.code, c.libelle, c.type, c.format, c.longueur, c.obligatoire ?? false, c.confidentiel ?? false].map((v) => (typeof v === 'boolean' || typeof v === 'number' ? String(v) : q(v))).join(', ')}, `
  + `${c.options ? `${q(JSON.stringify(c.options))}::jsonb` : 'NULL'}, ${q(c.aide)}, ${c.ordre ?? 0}, ${c.actif !== false})`)).join(',\n');

const sqlFiches = `-- =============================================================================
-- Cœur LogiBTP – types de fiches (salarié, matériel), droits par profil et paramétrage de démonstration.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/fiches/definitions.js : ne pas modifier.
-- =============================================================================

INSERT INTO type_fiche (tyf_code, tyf_libelle, tyf_table, tyf_cle, tyf_colonne_proprietes, tyf_definition) VALUES
${types};

INSERT INTO droit_fiche (drf_profil, drf_type, drf_action) VALUES
${droits};

INSERT INTO parametre_champ_fiche (pcf_type, pcf_champ, pcf_obligatoire) VALUES
${obligatoires};

INSERT INTO champ_supplementaire (chs_type, chs_code, chs_libelle, chs_type_donnee, chs_format, chs_longueur, chs_obligatoire,
                                  chs_confidentiel, chs_options, chs_aide, chs_ordre, chs_actif) VALUES
${supplementaires};
`;
fs.writeFileSync(path.join(racine, 'db', '131_fiches_parametrage.sql'), sqlFiches);
console.log('db/131_fiches_parametrage.sql généré');
