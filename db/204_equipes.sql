-- =============================================================================
-- Cœur – équipes du référentiel des ressources (db/195) : membres de tout type (salariés, intérimaires, matériels,
-- sous-traitants, autres équipes en renfort) par périodes souples propres à chaque équipe, chef de l'équipe par période
-- (salarié ou intérimaire : contact des communications). Une ligne par membre et par période continue ; la colonne
-- eqc_sal_id reste renseignée pour les salariés et intérimaires (lectures existantes, suppression en cascade).
-- Rejouable.
-- =============================================================================

ALTER TABLE equipe_composition ADD COLUMN IF NOT EXISTS eqc_type VARCHAR(20);
ALTER TABLE equipe_composition ADD COLUMN IF NOT EXISTS eqc_ressource VARCHAR(40);
UPDATE equipe_composition c
SET eqc_type = CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' ELSE 'SALARIE' END, eqc_ressource = c.eqc_sal_id::text
FROM salarie s
WHERE s.sal_id = c.eqc_sal_id AND c.eqc_type IS NULL;
ALTER TABLE equipe_composition ALTER COLUMN eqc_type SET NOT NULL;
ALTER TABLE equipe_composition ALTER COLUMN eqc_ressource SET NOT NULL;
ALTER TABLE equipe_composition ALTER COLUMN eqc_sal_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_eqc_type') THEN
        ALTER TABLE equipe_composition ADD CONSTRAINT ck_eqc_type CHECK (eqc_type IN ('SALARIE', 'INTERIM', 'MATERIEL', 'SOUS_TRAITANT', 'EQUIPE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_eqc_salarie') THEN
        ALTER TABLE equipe_composition ADD CONSTRAINT ck_eqc_salarie CHECK ((eqc_type IN ('SALARIE', 'INTERIM')) = (eqc_sal_id IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_eqc_chef') THEN
        ALTER TABLE equipe_composition ADD CONSTRAINT ck_eqc_chef CHECK (NOT eqc_chef OR eqc_type IN ('SALARIE', 'INTERIM'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_eqc_soi') THEN
        ALTER TABLE equipe_composition ADD CONSTRAINT ck_eqc_soi CHECK (eqc_type <> 'EQUIPE' OR eqc_ressource <> eqc_equ_id::text);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_eqc_ressource ON equipe_composition (eqc_type, eqc_ressource);
COMMENT ON COLUMN equipe_composition.eqc_type IS 'Type du membre : SALARIE, INTERIM, MATERIEL, SOUS_TRAITANT ou EQUIPE (équipe en renfort, ses membres datés comptent dans l''équipe)';
COMMENT ON COLUMN equipe_composition.eqc_ressource IS 'Identifiant du membre dans sa table (salarie, materiel, sous-traitant, equipe)';
COMMENT ON COLUMN equipe_composition.eqc_chef IS 'Chef de l''équipe sur la période (salarié ou intérimaire, un au plus) : contact des communications';

-- Équipe créée depuis la page des équipes : colonnes de la démonstration d'origine facultatives, tenues à jour à l'enregistrement.
ALTER TABLE equipe ALTER COLUMN equ_categorie SET DEFAULT '';
ALTER TABLE equipe ALTER COLUMN equ_chef SET DEFAULT '';
ALTER TABLE equipe ALTER COLUMN equ_effectif SET DEFAULT 0;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_equipe_code') AND NOT EXISTS (SELECT 1 FROM equipe GROUP BY equ_code HAVING count(*) > 1) THEN
        CREATE UNIQUE INDEX ux_equipe_code ON equipe (equ_code);
    END IF;
END $$;

-- Membres d'une équipe à une date, sous-équipes développées à toute profondeur (sans boucle), chef de l'équipe d'abord.
CREATE OR REPLACE FUNCTION f_membres_equipe(p_equipe INT, p_date DATE)
RETURNS TABLE (type VARCHAR, ressource VARCHAR, chef BOOLEAN, niveau INT)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE m AS (
        SELECT c.eqc_type AS type, c.eqc_ressource AS ressource, c.eqc_chef AS chef, 0 AS niveau, ARRAY[p_equipe] AS chemin
        FROM equipe_composition c
        WHERE c.eqc_equ_id = p_equipe AND c.eqc_du <= p_date AND (c.eqc_au IS NULL OR c.eqc_au >= p_date)
        UNION ALL
        SELECT c.eqc_type, c.eqc_ressource, FALSE, m.niveau + 1, m.chemin || c.eqc_equ_id
        FROM m JOIN equipe_composition c ON m.type = 'EQUIPE' AND c.eqc_equ_id = (CASE WHEN m.type = 'EQUIPE' THEN m.ressource::int END)
             AND c.eqc_du <= p_date AND (c.eqc_au IS NULL OR c.eqc_au >= p_date)
        WHERE NOT (c.eqc_equ_id = ANY(m.chemin)) AND m.niveau < 10
    )
    SELECT DISTINCT ON (type, ressource) type, ressource, chef, niveau
    FROM m WHERE type <> 'EQUIPE'
    ORDER BY type, ressource, chef DESC, niveau;
$$;
COMMENT ON FUNCTION f_membres_equipe(INT, DATE) IS 'Membres (hors équipes) d''une équipe à une date, sous-équipes développées : planning, pointage d''équipe';

-- Équipes contenues (directement ou non) dans une équipe, toutes dates : changements de composition, contrôle des boucles.
CREATE OR REPLACE FUNCTION f_sous_equipes(p_equipe INT)
RETURNS TABLE (equipe INT)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE s AS (
        SELECT p_equipe AS equipe, ARRAY[p_equipe] AS chemin
        UNION ALL
        SELECT c.eqc_ressource::int, s.chemin || c.eqc_ressource::int
        FROM s JOIN equipe_composition c ON c.eqc_equ_id = s.equipe AND c.eqc_type = 'EQUIPE'
        WHERE NOT (c.eqc_ressource::int = ANY(s.chemin))
    )
    SELECT DISTINCT equipe FROM s;
$$;
