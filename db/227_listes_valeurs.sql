-- =============================================================================
-- Cœur – listes de valeurs paramétrables (analyse des demandes du 25/10/2026, lot 2). Rejouable.
--
-- liste_valeur : valeurs d'une liste (lva_liste) à deux niveaux au plus (une valeur et ses sous-valeurs, lva_parent) :
--   TYPE_MATERIEL      types de matériel regroupés (EPI › chaussures, gants ; VL › fourgon, voiture…) ;
--   ACTIVITE           activités des personnes (TP › démolition, terrassement, VRD ; gros œuvre › génie civil…) ;
--   PRIORITE_PROJET    priorité d'un projet (basse, moyenne, haute) ;
--   EVALUATION_PROJET  évaluation d'un projet (froid, tiède, chaud).
-- Les fiches enregistrent le code (lva_code, unique dans la liste) ; une valeur retirée qui sert encore est désactivée.
-- =============================================================================

CREATE TABLE IF NOT EXISTS liste_valeur (
    lva_id       SERIAL        PRIMARY KEY,
    lva_liste    VARCHAR(30)   NOT NULL,
    lva_code     VARCHAR(30)   NOT NULL,
    lva_libelle  VARCHAR(100)  NOT NULL,
    lva_parent   VARCHAR(30),                                   -- code de la valeur parente (même liste)
    lva_couleur  VARCHAR(9),
    lva_ordre    INT           NOT NULL DEFAULT 0,
    lva_actif    BOOLEAN       NOT NULL DEFAULT TRUE,
    UNIQUE (lva_liste, lva_code)
);
CREATE INDEX IF NOT EXISTS ix_lva_liste ON liste_valeur (lva_liste, lva_ordre);

-- Deux niveaux : le parent existe dans la même liste et n'a pas lui-même de parent.
CREATE OR REPLACE FUNCTION f_liste_valeur_niveaux() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.lva_parent IS NOT NULL AND (NEW.lva_parent = NEW.lva_code OR NOT EXISTS (
        SELECT 1 FROM liste_valeur p WHERE p.lva_liste = NEW.lva_liste AND p.lva_code = NEW.lva_parent AND p.lva_parent IS NULL)) THEN
        RAISE EXCEPTION 'LISTE_NIVEAUX : deux niveaux au plus, parent de la même liste' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_liste_valeur_niveaux ON liste_valeur;
CREATE CONSTRAINT TRIGGER tr_liste_valeur_niveaux AFTER INSERT OR UPDATE ON liste_valeur DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION f_liste_valeur_niveaux();

-- Valeurs de départ (une seule fois par liste). Types de matériel : familles déjà employées comme regroupements.
INSERT INTO liste_valeur (lva_liste, lva_code, lva_libelle, lva_parent, lva_ordre)
SELECT 'TYPE_MATERIEL', v.code, v.libelle, v.parent, v.ordre
FROM (VALUES ('ENGINS', 'Engins', NULL, 10), ('PELLE', 'Pelle', 'ENGINS', 11), ('MINI_PELLE', 'Mini-pelle', 'ENGINS', 12), ('CHARGEUSE', 'Chargeuse', 'ENGINS', 13),
             ('LEVAGE', 'Levage', NULL, 20), ('GRUE', 'Grue', 'LEVAGE', 21), ('NACELLE', 'Nacelle', 'LEVAGE', 22), ('CHARIOT', 'Chariot élévateur', 'LEVAGE', 23),
             ('VEHICULES', 'Véhicules', NULL, 30), ('VL', 'Véhicule léger', 'VEHICULES', 31), ('FOURGON', 'Fourgon', 'VEHICULES', 32), ('PL', 'Poids lourd', 'VEHICULES', 33),
             ('OUTILLAGE', 'Outillage', NULL, 40), ('ELECTROPORTATIF', 'Électroportatif', 'OUTILLAGE', 41), ('PETIT_OUTILLAGE', 'Petit outillage', 'OUTILLAGE', 42),
             ('COFFRAGE', 'Coffrage', NULL, 50), ('BANCHE', 'Banche', 'COFFRAGE', 51), ('ETAI', 'Étai', 'COFFRAGE', 52),
             ('EPI', 'EPI', NULL, 60), ('CHAUSSURES', 'Chaussures', 'EPI', 61), ('GANTS', 'Gants', 'EPI', 62), ('CASQUE', 'Casque', 'EPI', 63), ('HARNAIS', 'Harnais', 'EPI', 64))
     AS v(code, libelle, parent, ordre)
WHERE NOT EXISTS (SELECT 1 FROM liste_valeur WHERE lva_liste = 'TYPE_MATERIEL');

INSERT INTO liste_valeur (lva_liste, lva_code, lva_libelle, lva_parent, lva_ordre)
SELECT 'ACTIVITE', v.code, v.libelle, v.parent, v.ordre
FROM (VALUES ('TP', 'Travaux publics', NULL, 10), ('DEMOLITION', 'Démolition', 'TP', 11), ('TERRASSEMENT', 'Terrassement', 'TP', 12), ('VRD', 'VRD', 'TP', 13),
             ('GROS_OEUVRE', 'Gros œuvre', NULL, 20), ('GENIE_CIVIL', 'Génie civil', 'GROS_OEUVRE', 21), ('MACONNERIE', 'Maçonnerie', 'GROS_OEUVRE', 22),
             ('SECOND_OEUVRE', 'Second œuvre', NULL, 30), ('MENUISERIE', 'Menuiserie', 'SECOND_OEUVRE', 31), ('PLATRERIE', 'Plâtrerie', 'SECOND_OEUVRE', 32),
             ('ELECTRICITE', 'Électricité', 'SECOND_OEUVRE', 33), ('PLOMBERIE', 'Plomberie', 'SECOND_OEUVRE', 34), ('PEINTURE', 'Peinture', 'SECOND_OEUVRE', 35),
             ('ENVELOPPE', 'Enveloppe', NULL, 40), ('CHARPENTE', 'Charpente', 'ENVELOPPE', 41), ('COUVERTURE', 'Couverture', 'ENVELOPPE', 42), ('FACADE', 'Façade', 'ENVELOPPE', 43))
     AS v(code, libelle, parent, ordre)
WHERE NOT EXISTS (SELECT 1 FROM liste_valeur WHERE lva_liste = 'ACTIVITE');

INSERT INTO liste_valeur (lva_liste, lva_code, lva_libelle, lva_couleur, lva_ordre)
SELECT v.liste, v.code, v.libelle, v.couleur, v.ordre
FROM (VALUES ('PRIORITE_PROJET', 'BASSE', 'Basse', '#64748b', 10), ('PRIORITE_PROJET', 'MOYENNE', 'Moyenne', '#2563eb', 20), ('PRIORITE_PROJET', 'HAUTE', 'Haute', '#ea580c', 30),
             ('PRIORITE_PROJET', 'URGENTE', 'Urgente', '#dc2626', 40),
             ('EVALUATION_PROJET', 'FROID', 'Froid', '#0ea5e9', 10), ('EVALUATION_PROJET', 'TIEDE', 'Tiède', '#f59e0b', 20), ('EVALUATION_PROJET', 'CHAUD', 'Chaud', '#dc2626', 30))
     AS v(liste, code, libelle, couleur, ordre)
WHERE NOT EXISTS (SELECT 1 FROM liste_valeur l WHERE l.lva_liste = v.liste);

-- Matériel : la famille devient le code du type de matériel (anciennes familles libres → regroupements de départ).
UPDATE materiel m SET mat_famille = l.lva_code
FROM liste_valeur l
WHERE l.lva_liste = 'TYPE_MATERIEL' AND m.mat_famille IS DISTINCT FROM l.lva_code
  AND (upper(m.mat_famille) = l.lva_code OR lower(m.mat_famille) = lower(l.lva_libelle))
  AND NOT EXISTS (SELECT 1 FROM liste_valeur x WHERE x.lva_liste = 'TYPE_MATERIEL' AND x.lva_code = m.mat_famille);

-- Listes : famille = libellé du type de matériel (lecture seule), famille_code = son code ; vue sur la seule table
-- materiel (sous-requête) : saisie dans la liste toujours possible. v_liste_ressources recréée comme en 226.
DROP VIEW IF EXISTS v_liste_ressources;
DROP VIEW IF EXISTS v_liste_materiels;
CREATE VIEW v_liste_materiels AS
SELECT m.mat_id AS id, m.mat_code AS code, m.mat_designation AS designation,
       coalesce((SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'TYPE_MATERIEL' AND l.lva_code = m.mat_famille), m.mat_famille)::text AS famille,
       m.mat_etat AS etat, m.mat_chantier AS chantier, m.mat_valeur_achat AS valeur_achat, m.mat_date_achat AS date_achat,
       m.mat_heures AS heures_utilisation, m.mat_heures_revision AS heures_revision, m.mat_controle_ok AS controle_ok,
       m.mat_observations AS observations, m.mat_famille AS famille_code
FROM materiel m;

CREATE VIEW v_liste_ressources AS
SELECT 'EQU-' || equ_id AS id, 'equipe' AS type_element, equ_code AS code, equ_libelle AS libelle, equ_categorie::text AS categorie,
       'Chef : ' || equ_chef AS statut, equ_active AS disponible, (equ_effectif * 42)::numeric AS cout_horaire,
       equ_chantier AS chantier, 'Effectif ' || equ_effectif AS observations
FROM equipe
UNION ALL
SELECT 'SAL-' || id, type_element, matricule, prenom || ' ' || nom, service, poste, actif,
       round(salaire_brut * 1.45 / 151.67, 2), NULL, commentaire
FROM v_liste_salaries
UNION ALL
SELECT 'MAT-' || id, 'materiel', code, designation, famille, etat, etat = 'DISPO', round(valeur_achat / 2000, 2), chantier, observations
FROM v_liste_materiels
UNION ALL
SELECT 'SST-' || p.per_id, 'sous_traitant', coalesce(p.per_proprietes ->> 'code_demo', 'ST' || p.per_id), p.per_raison_sociale, p.per_st_corps_etat,
       CASE WHEN coalesce((p.per_proprietes ->> 'agree')::boolean, TRUE) THEN 'Agréé' ELSE 'Agrément en cours' END,
       p.per_actif, (p.per_proprietes ->> 'taux_horaire')::numeric, NULL, p.per_proprietes ->> 'observations'
FROM personne p WHERE p.per_casquettes ? 'SOUS_TRAITANT';
