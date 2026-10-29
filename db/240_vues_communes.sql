-- =============================================================================
-- Cœur – vues communes aux requêtes du serveur (revue du code, lot F). Rejouable.
--   v_salarie_calendrier : calendrier et service effectifs d'un salarié (service principal, sinon le premier) ;
--   v_ressource          : ressources affectables (salarié, intérimaire, matériel, sous-traitant, équipe), libellé unique ;
--   v_ordres_ouverts     : ordres de référence de la famille E ni annulés, ni remplacés, ni soldés, ni terminés.
-- Chaque vue ne porte que ses clés et ses colonnes calculées : les requêtes rejoignent la table pour le reste.
-- =============================================================================

-- Calendrier : celui du salarié, sinon celui de son service (principal d'abord, puis par ordre des services).
CREATE OR REPLACE VIEW v_salarie_calendrier AS
SELECT s.sal_id, coalesce(s.sal_cal_id, v.srv_cal_id) AS cal_id, v.srv_id
FROM salarie s
LEFT JOIN LATERAL (SELECT sv.srv_id, sv.srv_cal_id FROM service_membre m JOIN service sv ON sv.srv_id = m.sme_srv_id
                   WHERE m.sme_ind_id = s.sal_ind_id ORDER BY m.sme_principal DESC, sv.srv_ordre LIMIT 1) v ON TRUE;

-- Ressources : type (SALARIE, INTERIM, MATERIEL, SOUS_TRAITANT, EQUIPE), identifiant texte, libellé « nom prénom » pour
-- une personne, actif (salarié actif, matériel en service, tiers actif, équipe active), service et service parent,
-- capacité (personnes seulement) et quantité (matériel géré par nombre).
CREATE OR REPLACE VIEW v_ressource AS
SELECT CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' ELSE 'SALARIE' END AS type, s.sal_id::text AS id,
       s.sal_nom || ' ' || s.sal_prenom AS libelle, s.sal_code AS code, s.sal_actif AS actif,
       sv.srv_id, sv.srv_parent_id AS srv_parent_id, TRUE AS capacite, NULL::numeric AS quantite
FROM salarie s
LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
UNION ALL
SELECT 'MATERIEL', m.mat_id::text, m.mat_code || ' ' || m.mat_designation, m.mat_code, m.mat_usage = 'A',
       sv.srv_id, sv.srv_parent_id, FALSE, CASE WHEN m.mat_mode = 'NOMBRE' THEN m.mat_quantite END
FROM materiel m LEFT JOIN service sv ON sv.srv_id = m.mat_srv_id
UNION ALL
SELECT 'SOUS_TRAITANT', t.per_id::text, t.per_raison_sociale || coalesce(' (' || t.per_st_corps_etat || ')', ''), NULL, t.per_actif,
       NULL::int, NULL::int, FALSE, NULL::numeric
FROM personne t WHERE t.per_casquettes ? 'SOUS_TRAITANT'
UNION ALL
SELECT 'EQUIPE', e.equ_id::text, e.equ_libelle, e.equ_code, e.equ_active, e.equ_srv_id, NULL::int, FALSE, NULL::numeric
FROM equipe e;

CREATE OR REPLACE VIEW v_ordres_ouverts AS
SELECT d.ent_id
FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document st ON st.std_id = d.ent_std_id
WHERE t.tyd_famille = 'E' AND d.ent_is_reference AND st.std_code NOT IN ('ANNULE', 'REMPLACE', 'SOLDE')
  AND coalesce(d.ent_exe_etat, '') <> 'TERMINE';
