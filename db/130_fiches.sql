-- =============================================================================
-- Cœur LogiBTP – fiches salarié et matériel (démonstration) : colonnes complémentaires des tables et colonne JSONB
-- des champs supplémentaires. Types de fiches, droits et paramétrage : 131_fiches_parametrage.sql (généré depuis
-- client/src/app/fiches/definitions.js).
-- =============================================================================

ALTER TABLE salarie
    ADD COLUMN sal_date_naissance DATE,
    ADD COLUMN sal_num_secu       VARCHAR(25),
    ADD COLUMN sal_email          VARCHAR(100),
    ADD COLUMN sal_telephone      VARCHAR(20),
    ADD COLUMN sal_adresse        VARCHAR(200),
    ADD COLUMN sal_code_postal    VARCHAR(5),
    ADD COLUMN sal_ville          VARCHAR(60),
    ADD COLUMN sal_agence         VARCHAR(30),
    ADD COLUMN sal_type_mo        VARCHAR(10),
    ADD COLUMN sal_telephone_perso VARCHAR(20),
    ADD COLUMN sal_email_perso    VARCHAR(100),
    ADD COLUMN sal_contact_nom    VARCHAR(100),
    ADD COLUMN sal_contact_telephone VARCHAR(20),
    ADD COLUMN sal_note_perso     TEXT,
    ADD COLUMN sal_proprietes     JSONB NOT NULL DEFAULT '{}';

UPDATE salarie s SET
    sal_date_naissance = DATE '1962-01-01' + ((sal_id * 7919) % 15000),
    sal_email = lower(translate(sal_prenom, 'éèëêàâäïîôöùûüçÉÈÀœ', 'eeeeaaaiioouuuceeao')) || '.'
              || lower(translate(sal_nom, 'éèëêàâäïîôöùûüçÉÈÀœ', 'eeeeaaaiioouuuceeao')) || sal_id || '@exemple.fr',
    sal_telephone = '06 ' || lpad(((sal_id * 37) % 100)::text, 2, '0') || ' ' || lpad(((sal_id * 53) % 100)::text, 2, '0') || ' '
                  || lpad(((sal_id * 71) % 100)::text, 2, '0') || ' ' || lpad(((sal_id * 89) % 100)::text, 2, '0'),
    sal_adresse = (1 + sal_id % 120) || ' rue ' || (ARRAY['des Lilas','Victor-Hugo','de la République','Garibaldi','des Érables'])[1 + sal_id % 5],
    sal_code_postal = (ARRAY['69003','69100','69200','42000','38000','01000'])[1 + sal_id % 6],
    sal_ville = (ARRAY['Lyon','Villeurbanne','Vénissieux','Saint-Étienne','Grenoble','Bourg-en-Bresse'])[1 + sal_id % 6];
UPDATE salarie SET sal_num_secu = (CASE WHEN sal_id % 2 = 1 THEN '1' ELSE '2' END) || ' ' || to_char(sal_date_naissance, 'YY MM') || ' 69 '
    || lpad((100 + sal_id % 900)::text, 3, '0') || ' ' || lpad((sal_id % 1000)::text, 3, '0') || ' ' || lpad((10 + sal_id % 89)::text, 2, '0');
UPDATE salarie SET
    sal_agence = (ARRAY['Lyon','Lyon','Saint-Étienne','Grenoble','Bourg-en-Bresse'])[1 + sal_id % 5],
    sal_type_mo = CASE WHEN sal_service = 'Chantier' OR sal_service = 'Atelier' THEN 'OUVRIER' WHEN sal_poste IN ('Directeur','Conducteur de travaux') THEN 'CADRE' ELSE 'ETAM' END,
    sal_telephone_perso = '07 ' || lpad(((sal_id * 13) % 100)::text, 2, '0') || ' ' || lpad(((sal_id * 29) % 100)::text, 2, '0') || ' '
                        || lpad(((sal_id * 43) % 100)::text, 2, '0') || ' ' || lpad(((sal_id * 61) % 100)::text, 2, '0'),
    sal_contact_nom = CASE WHEN sal_id % 3 = 0 THEN NULL ELSE (ARRAY['Marie','Pierre','Sophie','Julien'])[1 + sal_id % 4] || ' ' || sal_nom || ' (' || (ARRAY['conjoint(e)','parent','frère / sœur'])[1 + sal_id % 3] || ')' END,
    sal_contact_telephone = CASE WHEN sal_id % 3 = 0 THEN NULL ELSE '06 ' || lpad(((sal_id * 17) % 100)::text, 2, '0') || ' 45 67 ' || lpad(((sal_id * 7) % 100)::text, 2, '0') END;
CREATE UNIQUE INDEX ux_sal_matricule_fiche ON salarie (sal_matricule);

ALTER TABLE materiel
    ADD COLUMN mat_marque       VARCHAR(60),
    ADD COLUMN mat_numero_serie VARCHAR(40),
    ADD COLUMN mat_proprietes   JSONB NOT NULL DEFAULT '{}';

UPDATE materiel SET
    mat_marque = (ARRAY['Kubota','Manitou','Liebherr','Bosch','Renault Trucks','JCB','Hilti'])[1 + mat_id % 7],
    mat_numero_serie = 'SN' || ((100000 + mat_id * 7919) % 999983);
