-- =============================================================================
-- Cœur – codes des salariés (rejouable) : code court (recherche, homonymes) et matricule de paie (logiciel de paie,
-- exporté à la place du matricule quand il est renseigné). Colonnes ajoutées en fin de v_liste_salaries.
-- =============================================================================

ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_code           VARCHAR(20);
ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_matricule_paie VARCHAR(30);
CREATE INDEX IF NOT EXISTS ix_sal_code ON salarie (sal_code);
CREATE INDEX IF NOT EXISTS ix_sal_matricule_paie ON salarie (sal_matricule_paie);

CREATE OR REPLACE VIEW v_liste_salaries AS
SELECT sal_id AS id, CASE WHEN sal_statut = 'INTERIM' THEN 'interim' ELSE 'salarie' END AS type_element, sal_matricule AS matricule, sal_nom AS nom, sal_prenom AS prenom, sal_service AS service, sal_poste AS poste,
       sal_statut AS statut, sal_date_entree AS date_entree, sal_salaire AS salaire_brut, sal_heures_mois AS heures_mois,
       sal_actif AS actif, sal_commentaire AS commentaire, sal_code AS code, sal_matricule_paie AS matricule_paie
FROM salarie;

-- Données de démonstration (salariés générés par 120) : code = initiale du prénom + trois lettres du nom + numéro,
-- matricule de paie = « P » + numéro sur six chiffres ; seulement là où rien n'est saisi.
UPDATE salarie SET sal_code = upper(left(translate(sal_prenom, 'ÉÈÊËÀÂÄÎÏÔÖÙÛÜÇéèêëàâäîïôöùûüç', 'EEEEAAAIIOOUUUCeeeeaaaiioouuuc'), 1)
                               || left(translate(sal_nom, 'ÉÈÊËÀÂÄÎÏÔÖÙÛÜÇéèêëàâäîïôöùûüç ''-', 'EEEEAAAIIOOUUUCeeeeaaaiioouuuc'), 3)) || sal_id
 WHERE sal_code IS NULL;
UPDATE salarie SET sal_matricule_paie = 'P' || lpad(sal_id::text, 6, '0') WHERE sal_matricule_paie IS NULL;

-- Vues de liste par défaut des salariés déjà en base (2 et 4) : colonnes Code et Matricule de paie après le matricule,
-- si la vue ne les a pas (une base neuve les reçoit de 121).
UPDATE vue_liste v
   SET vli_definition = jsonb_set(v.vli_definition, '{colonnes}',
       (SELECT jsonb_agg(x.c ORDER BY x.o, x.s)
          FROM (SELECT c, o, 0 AS s FROM jsonb_array_elements(v.vli_definition->'colonnes') WITH ORDINALITY AS t(c, o)
                UNION ALL
                SELECT n.c, coalesce((SELECT o FROM jsonb_array_elements(v.vli_definition->'colonnes') WITH ORDINALITY AS t(c, o) WHERE c->>'code' = 'matricule'), 0), n.s
                  FROM (VALUES ('{"code":"code","titre":"Code","modifiable":true,"largeur":{"mode":"fixe","valeur":80},"bulle":"Code court du salarié (recherche, homonymes)"}'::jsonb, 1),
                               ('{"code":"matricule_paie","titre":"Matricule\nde paie","modifiable":true,"largeur":{"mode":"fixe","valeur":96}}'::jsonb, 2)) AS n(c, s)) x))
 WHERE v.vli_id IN (2, 4)
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v.vli_definition->'colonnes') c WHERE c->>'code' IN ('code', 'matricule_paie'));
