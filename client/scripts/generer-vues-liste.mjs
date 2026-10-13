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
const { BIBLIOTHEQUES, NATURES, FAMILLES, ELEMENTS, TARIFS, REGROUPEMENTS, PERIODES_COEFFICIENTS, PARAMETRES_BIBLIOTHEQUE } = await import('../src/app/bibliotheque/donnees.js');
const { calculerElement, entreeDepuisLigne, coefficientsEffectifs } = await import('@logibtp/bibliotheque');
const { texteBrut } = await import('@logibtp/socle');
const { calculerOuvrage } = await import('../src/app/bibliotheque/bibliotheque.js');
const j = (v) => (v === null || v === undefined ? 'NULL' : `${q(JSON.stringify(v))}::jsonb`);
const n = (v) => (v === null || v === undefined || v === '' ? 'NULL' : String(v));
const b = (v) => (v ? 'TRUE' : 'FALSE');
const lignesElements = ELEMENTS.map((e0) => {
  // Coefficients effectifs (imposés, nature, global) à la génération, comme l'API.
  const c = coefficientsEffectifs(e0, PERIODES_COEFFICIENTS, new Date().toISOString().slice(0, 10), PARAMETRES_BIBLIOTHEQUE);
  const e = { ...e0, coef_fg: c.coef_fg, coef_benef: e0.pv_fixe ? e0.coef_benef : c.coef_benef };
  const p = e.type === 'OUVRAGE' || e.type === 'ENSEMBLE' ? calculerOuvrage(e.composition, e)
    : calculerElement(entreeDepuisLigne(e, TARIFS.filter((t) => t.ele_id === e.id)));
  return ` (${[e.id, e.bib_id, q(e.code), q(e.type), q(e.libelle_html), q(texteBrut(e.libelle_html)), n(e.fam_id), n(e.nat_id), q(e.gestion),
    q(e.unite_stock), q(e.unite_achat), q(e.unite_vente), j(e.unites), q(e.scenario_pa), j(e.scenarios), n(e.pa_fixe), n(e.dernier_pa), n(e.pmp),
    n(p.pa), n(e.coef_fg), n(p.pr), n(p.coef_benef ?? e.coef_benef), n(p.pv), b(e.pv_fixe), n(e.coef_remise), n(p.pv_net), j(e.composition), j(e.proprietes),
    b(e.actif), q('demo'), q('Données de démonstration'),
    ...['poids', 'surface', 'surface_peinture', 'volume', 'hauteur', 'largeur', 'epaisseur', 'isolant_r', 'isolant_lambda', 'isolant_u'].map((k) => n(e[k])),
    b(e.coef_fg_impose), b(e.coef_benef_impose)].join(', ')})`;
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

INSERT INTO regroupement_nature (rgn_code, rgn_libelle, rgn_ordre) VALUES
${REGROUPEMENTS.map((r) => ` (${q(r.code)}, ${q(r.libelle)}, ${r.ordre})`).join(',\n')}
ON CONFLICT (rgn_code) DO UPDATE SET rgn_libelle = EXCLUDED.rgn_libelle, rgn_ordre = EXCLUDED.rgn_ordre;

INSERT INTO nature_element (nat_id, nat_code, nat_libelle, nat_rgn_code, nat_axe_analytique, nat_compte_achat, nat_compte_vente, nat_actif, nat_isolant, nat_types) VALUES
${NATURES.map((x) => ` (${x.id}, ${q(x.code)}, ${q(x.libelle)}, ${q(x.regroupement)}, ${q(x.axe_analytique)}, ${q(x.compte_achat)}, ${q(x.compte_vente)}, ${b(x.actif)}, ${b(x.isolant)}, ${j(x.types)})`).join(',\n')};

INSERT INTO coefficient_periode (cop_id, cop_nat_id, cop_debut, cop_coef_fg, cop_coef_benef, cop_commentaire, cop_cree_le, cop_cree_par) VALUES
${PERIODES_COEFFICIENTS.map((x) => ` (${x.id}, ${n(x.nat_id)}, ${q(x.debut)}, ${n(x.coef_fg)}, ${n(x.coef_benef)}, ${q(x.commentaire)}, ${q(x.cree_le)}, ${q(x.cree_par)})`).join(',\n')};

INSERT INTO element (ele_id, ele_bib_id, ele_code, ele_type, ele_libelle_html, ele_libelle, ele_fam_id, ele_nat_id, ele_gestion, ele_unt_stock, ele_unt_achat,
  ele_unt_vente, ele_unites, ele_scenario_pa, ele_scenarios, ele_pa_fixe, ele_dernier_pa, ele_pmp, ele_pa, ele_coef_fg, ele_pr, ele_coef_benef, ele_pv,
  ele_pv_fixe, ele_coef_remise, ele_pv_net, ele_composition, ele_proprietes, ele_actif, ele_maj_par, ele_commentaire_prix,
  ele_poids, ele_surface, ele_surface_peinture, ele_volume, ele_hauteur, ele_largeur, ele_epaisseur, ele_isolant_r, ele_isolant_lambda, ele_isolant_u,
  ele_coef_fg_impose, ele_coef_benef_impose) VALUES
${lignesElements};

INSERT INTO tarif_fournisseur (tfo_id, tfo_ele_id, tfo_fournisseur, tfo_reference, tfo_libelle, tfo_unt_code, tfo_prix, tfo_debut, tfo_fin, tfo_principal, tfo_lien, tfo_maj_par) VALUES
${TARIFS.map((t) => ` (${t.id}, ${t.ele_id}, ${q(t.fournisseur)}, ${q(t.reference)}, ${q(t.libelle)}, ${q(t.unite)}, ${t.prix}, ${q(t.debut)}, ${q(t.fin)}, ${b(t.principal)}, ${q(t.lien)}, 'demo')`).join(',\n')};

SELECT setval(pg_get_serial_sequence('bibliotheque', 'bib_id'), (SELECT max(bib_id) FROM bibliotheque));
SELECT setval(pg_get_serial_sequence('famille_element', 'fam_id'), (SELECT max(fam_id) FROM famille_element));
SELECT setval(pg_get_serial_sequence('nature_element', 'nat_id'), (SELECT max(nat_id) FROM nature_element));
SELECT setval(pg_get_serial_sequence('element', 'ele_id'), (SELECT max(ele_id) FROM element));
SELECT setval(pg_get_serial_sequence('tarif_fournisseur', 'tfo_id'), (SELECT max(tfo_id) FROM tarif_fournisseur));
SELECT setval(pg_get_serial_sequence('coefficient_periode', 'cop_id'), (SELECT max(cop_id) FROM coefficient_periode));
`;
fs.writeFileSync(path.join(racine, 'db', '116_bibliotheque_demo.sql'), sqlBibliotheque);
console.log('db/116_bibliotheque_demo.sql généré');

// ------------------------------------------------------------------ annuaire : référentiels et démonstration
const A = await import('../src/app/annuaire/donnees.js');
const champsTable = (type) => TYPES_FICHE[type].definition.champs.filter((c) => c.colonne && !c.gere);
const valeurSql = (c, v) => {
  if (v === null || v === undefined || v === '') return c.type === 'json' ? `'[]'::jsonb` : 'NULL';
  if (c.type === 'json') return j(v);
  if (c.type === 'booleen') return b(v);
  if (c.type === 'nombre') return String(v);
  return q(v);
};
const lignesTable = (type, lignes, cle) => {
  const champs = champsTable(type).filter((c) => lignes.some((l) => l[c.code] !== undefined));
  return {
    colonnes: [cle, ...champs.map((c) => c.colonne)].join(', '),
    valeurs: lignes.map((l) => ` (${[l.id, ...champs.map((c) => valeurSql(c, l[c.code]))].join(', ')})`).join(',\n'),
  };
};
// Parents insérés avant leurs niveaux inférieurs (profondeur dans la hiérarchie, puis identifiant).
const profondeur = (p) => { let n = 0; for (let x = p; x?.parent_id; x = A.PERSONNES.find((y) => y.id === x.parent_id)) n++; return n; };
const per = lignesTable('personne', [...A.PERSONNES].sort((a, b2) => profondeur(a) - profondeur(b2) || a.id - b2.id), 'per_id');
const ind = lignesTable('individu', A.INDIVIDUS, 'ind_id');
const sqlAnnuaire = `-- =============================================================================
-- Cœur LogiBTP – annuaire : référentiels (niveaux, casquettes, types de lien, rôles) et données de démonstration
-- (personnes, individus, rattachements, liens, coordonnées partagées, tarifs reliés aux fournisseurs).
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/annuaire/donnees.js : ne pas modifier.
-- =============================================================================

INSERT INTO niveau_personne (niv_code, niv_libelle, niv_icone, niv_morale, niv_ordre, niv_actif) VALUES
${A.NIVEAUX.map((x) => ` (${q(x.code)}, ${q(x.libelle)}, ${q(x.icone)}, ${b(x.morale)}, ${x.ordre}, ${b(x.actif)})`).join(',\n')};

INSERT INTO casquette (cas_code, cas_libelle, cas_icone, cas_groupes, cas_ordre, cas_actif) VALUES
${A.CASQUETTES.map((x) => ` (${q(x.code)}, ${q(x.libelle)}, ${q(x.icone)}, ${j(x.groupes)}, ${x.ordre}, ${b(x.actif)})`).join(',\n')};

INSERT INTO type_lien (tli_code, tli_libelle, tli_libelle_inverse, tli_ordre, tli_actif) VALUES
${A.TYPES_LIEN.map((x) => ` (${q(x.code)}, ${q(x.libelle)}, ${q(x.libelle_inverse)}, ${x.ordre}, ${b(x.actif)})`).join(',\n')};

INSERT INTO role_individu (rol_code, rol_libelle, rol_icone, rol_ordre, rol_actif) VALUES
${A.ROLES.map((x) => ` (${q(x.code)}, ${q(x.libelle)}, ${q(x.icone)}, ${x.ordre}, ${b(x.actif)})`).join(',\n')};

-- Personnes : parents insérés avant leurs niveaux inférieurs.
INSERT INTO personne (${per.colonnes}) VALUES
${per.valeurs};

INSERT INTO individu (${ind.colonnes}) VALUES
${ind.valeurs};

INSERT INTO rattachement (rat_id, rat_ind_id, rat_per_id, rat_fonction, rat_service, rat_principal, rat_titulaire, rat_debut, rat_fin, rat_actif, rat_commentaire) VALUES
${A.RATTACHEMENTS.map((r) => ` (${r.id}, ${r.ind_id}, ${r.per_id}, ${q(r.fonction)}, ${q(r.service)}, ${b(r.principal)}, ${b(r.titulaire)}, ${q(r.debut)}, ${q(r.fin)}, ${b(r.actif)}, ${q(r.commentaire)})`).join(',\n')};

INSERT INTO lien_personne (lpe_id, lpe_per_id, lpe_cible_id, lpe_tli_code, lpe_commentaire, lpe_debut, lpe_fin) VALUES
${A.LIENS.map((l) => ` (${l.id}, ${l.per_id}, ${l.cible_id}, ${q(l.tli_code)}, ${q(l.commentaire)}, ${q(l.debut)}, ${q(l.fin)})`).join(',\n')};

INSERT INTO coordonnee (coo_id, coo_nature, coo_valeur, coo_ligne1, coo_ligne2, coo_ligne3, coo_code_postal, coo_ville, coo_pays, coo_reseau, coo_modifie_le, coo_modifie_par) VALUES
${A.COORDONNEES.map((c) => ` (${c.id}, ${q(c.nature)}, ${q(c.valeur)}, ${q(c.ligne1)}, ${q(c.ligne2)}, ${q(c.ligne3)}, ${q(c.code_postal)}, ${q(c.ville)}, ${q(c.pays)}, ${q(c.reseau)}, ${q(c.modifie_le)}, ${q(c.modifie_par)})`).join(',\n')};

INSERT INTO usage_coordonnee (uco_id, uco_coo_id, uco_per_id, uco_ind_id, uco_rat_id, uco_usage, uco_libelle, uco_principal, uco_ordre) VALUES
${A.USAGES.map((u) => ` (${u.id}, ${u.coo_id}, ${n(u.per_id)}, ${n(u.ind_id)}, ${n(u.rat_id)}, ${q(u.usage)}, ${q(u.libelle)}, ${b(u.principal)}, ${u.ordre})`).join(',\n')};

-- Tarifs de la bibliothèque de démonstration reliés à leurs fournisseurs.
${Object.entries(A.TIERS_TARIFS).map(([nom, id]) => `UPDATE tarif_fournisseur SET tfo_tiers_id = ${id} WHERE tfo_fournisseur = ${q(nom)};`).join('\n')}

SELECT setval(pg_get_serial_sequence('personne', 'per_id'), (SELECT max(per_id) FROM personne));
SELECT setval(pg_get_serial_sequence('individu', 'ind_id'), (SELECT max(ind_id) FROM individu));
SELECT setval(pg_get_serial_sequence('rattachement', 'rat_id'), (SELECT max(rat_id) FROM rattachement));
SELECT setval(pg_get_serial_sequence('lien_personne', 'lpe_id'), (SELECT max(lpe_id) FROM lien_personne));
SELECT setval(pg_get_serial_sequence('coordonnee', 'coo_id'), (SELECT max(coo_id) FROM coordonnee));
SELECT setval(pg_get_serial_sequence('usage_coordonnee', 'uco_id'), (SELECT max(uco_id) FROM usage_coordonnee));
`;
fs.writeFileSync(path.join(racine, 'db', '141_annuaire_demo.sql'), sqlAnnuaire);
console.log('db/141_annuaire_demo.sql généré');

// ------------------------------------------------------------------ vues de colonnes des documents
const { VUES_DOCUMENT } = await import('../src/app/vues-document.js');
const sqlVuesDocument = `-- =============================================================================
-- Cœur LogiBTP – vues de colonnes de la grille des lignes : vue par défaut par modèle de saisie, vue de débogage.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/vues-document.js : ne pas modifier.
-- =============================================================================

INSERT INTO vue_document (vdo_id, vdo_nom, vdo_tyd_id, vdo_mod_code, vdo_proprietaire, vdo_par_defaut, vdo_definition, vdo_modifie_par) VALUES
${VUES_DOCUMENT.map((v) => ` (${v.id}, ${q(v.nom)}, ${n(v.tyd_id)}, ${q(v.mod_code)}, ${q(v.proprietaire)}, ${b(v.par_defaut)}, ${j(v.definition)}, 'systeme')`).join(',\n')}
ON CONFLICT (vdo_id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('vue_document', 'vdo_id'), (SELECT max(vdo_id) FROM vue_document));
`;
fs.writeFileSync(path.join(racine, 'db', '150_documents_vues.sql'), sqlVuesDocument);
console.log('db/150_documents_vues.sql généré');

// ------------------------------------------------------------------ structure des affaires de démonstration
const S = await import('../src/app/structure/donnees.js');
const sqlStructure = `-- =============================================================================
-- Cœur LogiBTP – structure des affaires de démonstration : affaires, projets, chantiers, marchés ; rattachement
-- des devis de démonstration.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/structure/donnees.js : ne pas modifier.
-- =============================================================================

INSERT INTO affaire (aff_id, aff_code, aff_libelle, aff_nature, aff_tiers_id, aff_responsable, aff_statut, aff_date_ouverture, aff_commentaire) VALUES
${S.AFFAIRES.map((a) => ` (${a.id}, ${q(a.code)}, ${q(a.libelle)}, ${q(a.nature)}, ${n(a.tiers_id)}, ${q(a.responsable)}, ${q(a.statut)}, ${q(a.date_ouverture)}, ${q(a.commentaire)})`).join(',\n')};

INSERT INTO projet (prj_id, prj_code, prj_libelle, prj_tiers_id, prj_statut, prj_date_remise, prj_date_decision, prj_montant_estime, prj_responsable, prj_ville) VALUES
${S.PROJETS.map((p) => ` (${p.id}, ${q(p.code)}, ${q(p.libelle)}, ${n(p.tiers_id)}, ${q(p.statut)}, ${q(p.date_remise)}, ${q(p.date_decision)}, ${n(p.montant_estime)}, ${q(p.responsable)}, ${q(p.ville)})`).join(',\n')};

INSERT INTO chantier (cha_id, cha_code, cha_libelle, cha_aff_id, cha_prj_id, cha_tiers_id, cha_adresse, cha_code_postal, cha_ville, cha_statut, cha_date_ouverture, cha_date_fin_prevue, cha_conducteur) VALUES
${S.CHANTIERS.map((c) => ` (${c.id}, ${q(c.code)}, ${q(c.libelle)}, ${n(c.aff_id)}, ${n(c.prj_id)}, ${n(c.tiers_id)}, ${q(c.adresse)}, ${q(c.code_postal)}, ${q(c.ville)}, ${q(c.statut)}, ${q(c.date_ouverture)}, ${q(c.date_fin_prevue)}, ${q(c.conducteur)})`).join(',\n')};

INSERT INTO marche (mar_id, mar_code, mar_libelle, mar_cha_id, mar_tiers_id, mar_nature, mar_montant_ht, mar_retenue_pct, mar_date, mar_statut) VALUES
${S.MARCHES.map((m) => ` (${m.id}, ${q(m.code)}, ${q(m.libelle)}, ${m.cha_id}, ${n(m.tiers_id)}, ${q(m.nature)}, ${n(m.montant_ht)}, ${n(m.retenue_pct)}, ${q(m.date)}, ${q(m.statut)})`).join(',\n')};

SELECT setval(pg_get_serial_sequence('affaire', 'aff_id'), (SELECT max(aff_id) FROM affaire));
SELECT setval(pg_get_serial_sequence('projet', 'prj_id'), (SELECT max(prj_id) FROM projet));
SELECT setval(pg_get_serial_sequence('chantier', 'cha_id'), (SELECT max(cha_id) FROM chantier));
SELECT setval(pg_get_serial_sequence('marche', 'mar_id'), (SELECT max(mar_id) FROM marche));

-- Devis de démonstration (créé au premier lancement) : rattaché ici s'il existe déjà.
UPDATE document SET ent_projet_id = ${S.RATTACHEMENT_DEVIS_DEMO.ent_projet_id}, ent_chantier_id = ${S.RATTACHEMENT_DEVIS_DEMO.ent_chantier_id}
WHERE ent_objet = 'Extension maison individuelle' AND ent_chantier_id IS NULL;
`;
fs.writeFileSync(path.join(racine, 'db', '161_structure_demo.sql'), sqlStructure);
console.log('db/161_structure_demo.sql généré');

// ------------------------------------------------------------------ intervenants de démonstration
const colonneObjet = { projet: 'itv_prj_id', affaire: 'itv_aff_id', chantier: 'itv_cha_id', marche: 'itv_mar_id' };
const sqlIntervenants = `-- =============================================================================
-- Cœur LogiBTP – intervenants de démonstration des projets, affaires, chantiers et marchés ; annuaire du devis de
-- démonstration.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/structure/donnees.js : ne pas modifier.
-- =============================================================================

${S.INTERVENANTS.map((i) => `INSERT INTO intervenant (itv_id, ${colonneObjet[i.objet]}, itv_fin_code, itv_per_id, itv_ind_id, itv_principal, itv_paiement_direct, itv_commentaire, itv_ordre)
VALUES (${i.id}, ${i.objet_id}, ${q(i.fonction)}, ${n(i.per_id)}, ${n(i.ind_id)}, ${b(i.principal)}, ${b(i.paiement_direct)}, ${q(i.commentaire)}, ${i.id});`).join('\n')}

SELECT setval(pg_get_serial_sequence('intervenant', 'itv_id'), (SELECT max(itv_id) FROM intervenant));

-- Devis de démonstration (créé au premier lancement) : annuaire repris ici s'il existe déjà.
UPDATE document SET ent_intervenants = ${j(S.INTERVENANTS_DEVIS_DEMO)}, ent_tiers_id = ${S.INTERVENANTS_DEVIS_DEMO[0].per_id}
WHERE ent_objet = 'Extension maison individuelle' AND ent_intervenants IS NULL;
`;
fs.writeFileSync(path.join(racine, 'db', '163_intervenants_demo.sql'), sqlIntervenants);
console.log('db/163_intervenants_demo.sql généré');
