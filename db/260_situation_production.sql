-- =============================================================================
-- Cœur – situation de production (ANALYSE-MODULE-ANALYSE.md § 4.12, R7, R8 ; module Rentabilité, lot 4). Rejouable.
--
-- Type V_PRODUCTION, double de la situation de travaux (V_SITUATION) qui dit l'avancement réel du chantier : avancement
-- D du module Document (019q), présentation en cumul, créée depuis la commande du marché (étape PRODUCTION, sans effet
-- sur les restes à livrer, situer ou facturer), non comptable, jamais transformée en facture. Une par marché et par
-- mois (contrôle PRODUCTION_MOIS de la validation). Droits, modèle d'édition et rôle PRODUCTION de la Rentabilité
-- recopiés de la situation de travaux.
-- =============================================================================

INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock,
                           tyd_handler, tyd_avancement, tyd_raz_numero)
SELECT 'V_PRODUCTION', 'Situation de production', 'V', 1, 'SP', FALSE, FALSE, NULL, 'D', 'A'
WHERE NOT EXISTS (SELECT 1 FROM type_document WHERE tyd_code = 'V_PRODUCTION');

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, s.modifiable, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES ('BROUILLON', 'Brouillon', TRUE, FALSE, 1), ('VALIDE', 'Validé', FALSE, FALSE, 2),
                   ('ANNULE', 'Annulé', FALSE, TRUE, 3)) AS s(code, libelle, modifiable, terminal, ordre)
WHERE t.tyd_code = 'V_PRODUCTION'
  AND NOT EXISTS (SELECT 1 FROM statut_document x WHERE x.std_tyd_id = t.tyd_id);

-- Depuis la commande du marché, à une étape propre (aucun reste d'une autre étape n'est touché).
INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, 'PRODUCTION', '{}'::varchar(20)[]
FROM type_document s JOIN type_document c ON c.tyd_code = 'V_PRODUCTION'
WHERE s.tyd_code = 'V_COMMANDE'
ON CONFLICT DO NOTHING;

-- Droits : ceux de la situation de travaux (droits historiques et arbre du module Droits).
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT d.drt_profil, p.tyd_id, d.drt_action
FROM droit_document d
JOIN type_document s ON s.tyd_id = d.drt_tyd_id AND s.tyd_code = 'V_SITUATION'
JOIN type_document p ON p.tyd_code = 'V_PRODUCTION'
ON CONFLICT DO NOTHING;

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT dpr_pro_id, 'documents/V/V_PRODUCTION', dpr_actions FROM droit_profil WHERE dpr_noeud = 'documents/V/V_SITUATION'
ON CONFLICT DO NOTHING;

-- Thème de liste des situations (db/121 régénéré, repris ici pour une base existante).
UPDATE theme_liste SET thl_libelle = 'Situations', thl_types = thl_types || '[{"code":"V_PRODUCTION","libelle":"Situation de production"}]'::jsonb
WHERE thl_code = 'situations' AND NOT thl_types @> '[{"code":"V_PRODUCTION"}]'::jsonb;

-- Édition : le modèle de la situation de travaux.
INSERT INTO modele_edition_defaut (mdd_cible, mdd_type, mdd_med_id)
SELECT 'DOCUMENT', 'V_PRODUCTION', m.med_id FROM modele_edition m WHERE m.med_code = 'SITUATION'
ON CONFLICT DO NOTHING;

-- Rentabilité : production (PCA / FAE, ligne Production du bloc de résultats).
INSERT INTO rentabilite_role_type (rrt_tyd_code, rrt_role)
SELECT 'V_PRODUCTION', 'PRODUCTION' WHERE EXISTS (SELECT 1 FROM type_document WHERE tyd_code = 'V_PRODUCTION')
ON CONFLICT (rrt_tyd_code) DO NOTHING;

-- Règles de la Rentabilité en version 4 (production) : recalcul de tous les chantiers ouverts.
SELECT f_rentabilite_signaler(ARRAY(SELECT cha_id FROM chantier WHERE cha_statut = 'OUVERT'), 'Règles de calcul en version 4 (production)');
