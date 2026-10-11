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

// ------------------------------------------------------------------ bibliothèque de démonstration
const { BIBLIOTHEQUES, NATURES, FAMILLES, ELEMENTS, TARIFS } = await import('../src/app/bibliotheque/donnees.js');
const { calculerElement, entreeDepuisLigne } = await import('@logibtp/bibliotheque');
const { texteBrut } = await import('@logibtp/socle');
const { calculerOuvrage } = await import('../src/app/bibliotheque/bibliotheque.js');
const j = (v) => (v === null || v === undefined ? 'NULL' : `${q(JSON.stringify(v))}::jsonb`);
const n = (v) => (v === null || v === undefined || v === '' ? 'NULL' : String(v));
const b = (v) => (v ? 'TRUE' : 'FALSE');
const lignesElements = ELEMENTS.map((e) => {
  const p = e.type === 'OUVRAGE' ? calculerOuvrage(e.composition, e)
    : calculerElement(entreeDepuisLigne(e, TARIFS.filter((t) => t.ele_id === e.id)));
  return ` (${[e.id, e.bib_id, q(e.code), q(e.type), q(e.libelle_html), q(texteBrut(e.libelle_html)), n(e.fam_id), n(e.nat_id), q(e.gestion),
    q(e.unite_stock), q(e.unite_achat), q(e.unite_vente), j(e.unites), q(e.scenario_pa), j(e.scenarios), n(e.pa_fixe), n(e.dernier_pa), n(e.pmp),
    n(p.pa), n(e.coef_fg), n(p.pr), n(p.coef_benef ?? e.coef_benef), n(p.pv), b(e.pv_fixe), n(e.coef_remise), n(p.pv_net), j(e.composition), j(e.proprietes),
    b(e.actif), q('demo'), q('Données de démonstration')].join(', ')})`;
}).join(',\n');
const sqlBibliotheque = `-- =============================================================================
-- Cœur LogiBTP – bibliothèque de démonstration (référentiels, articles, ouvrage, tarifs fournisseurs).
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/bibliotheque/donnees.js : ne pas modifier.
-- Prix calculés à la génération (même calcul que l'API) ; l'historique des prix part de ces valeurs.
-- =============================================================================

INSERT INTO bibliotheque (bib_id, bib_code, bib_libelle, bib_defaut, bib_actif, bib_ordre) VALUES
${BIBLIOTHEQUES.map((x) => ` (${x.id}, ${q(x.code)}, ${q(x.libelle)}, ${b(x.defaut)}, ${b(x.actif)}, ${x.ordre})`).join(',\n')};

INSERT INTO famille_element (fam_id, fam_bib_id, fam_parent_id, fam_code, fam_libelle, fam_ordre) VALUES
${FAMILLES.map((x) => ` (${x.id}, ${x.bib_id}, ${n(x.parent_id)}, ${q(x.code)}, ${q(x.libelle)}, ${x.ordre})`).join(',\n')};

INSERT INTO nature_element (nat_id, nat_code, nat_libelle, nat_rgn_code, nat_axe_analytique, nat_compte_achat, nat_compte_vente, nat_actif) VALUES
${NATURES.map((x) => ` (${x.id}, ${q(x.code)}, ${q(x.libelle)}, ${q(x.regroupement)}, ${q(x.axe_analytique)}, ${q(x.compte_achat)}, ${q(x.compte_vente)}, ${b(x.actif)})`).join(',\n')};

INSERT INTO element (ele_id, ele_bib_id, ele_code, ele_type, ele_libelle_html, ele_libelle, ele_fam_id, ele_nat_id, ele_gestion, ele_unt_stock, ele_unt_achat,
  ele_unt_vente, ele_unites, ele_scenario_pa, ele_scenarios, ele_pa_fixe, ele_dernier_pa, ele_pmp, ele_pa, ele_coef_fg, ele_pr, ele_coef_benef, ele_pv,
  ele_pv_fixe, ele_coef_remise, ele_pv_net, ele_composition, ele_proprietes, ele_actif, ele_maj_par, ele_commentaire_prix) VALUES
${lignesElements};

INSERT INTO tarif_fournisseur (tfo_id, tfo_ele_id, tfo_fournisseur, tfo_reference, tfo_libelle, tfo_unt_code, tfo_prix, tfo_debut, tfo_fin, tfo_principal, tfo_lien, tfo_maj_par) VALUES
${TARIFS.map((t) => ` (${t.id}, ${t.ele_id}, ${q(t.fournisseur)}, ${q(t.reference)}, ${q(t.libelle)}, ${q(t.unite)}, ${t.prix}, ${q(t.debut)}, ${q(t.fin)}, ${b(t.principal)}, ${q(t.lien)}, 'demo')`).join(',\n')};

SELECT setval(pg_get_serial_sequence('bibliotheque', 'bib_id'), (SELECT max(bib_id) FROM bibliotheque));
SELECT setval(pg_get_serial_sequence('famille_element', 'fam_id'), (SELECT max(fam_id) FROM famille_element));
SELECT setval(pg_get_serial_sequence('nature_element', 'nat_id'), (SELECT max(nat_id) FROM nature_element));
SELECT setval(pg_get_serial_sequence('element', 'ele_id'), (SELECT max(ele_id) FROM element));
SELECT setval(pg_get_serial_sequence('tarif_fournisseur', 'tfo_id'), (SELECT max(tfo_id) FROM tarif_fournisseur));
`;
fs.writeFileSync(path.join(racine, 'db', '116_bibliotheque_demo.sql'), sqlBibliotheque);
console.log('db/116_bibliotheque_demo.sql généré');
