-- =============================================================================
-- Cœur – chantiers d'une pièce (lot 0 du module Rentabilité, R5 et A2 de ANALYSE-MODULE-ANALYSE.md). Rejouable.
--
-- document_chantier : chantier de l'entête (dch_entete) et chantiers des lignes (lig_cha_id, achats), tenue par
-- triggers sur document (ent_chantier_id) et document_ligne (lig_cha_id, par instruction avec tables de transition :
-- un enregistrement de document réécrit ses lignes en une instruction). Sert à trouver vite les pièces d'un chantier
-- (une facture de plusieurs chantiers garde l'entête vide) ; la répartition des montants entre chantiers reste
-- calculée par v_document_chantiers_part (HT des lignes vendues, db/255).
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_chantier (
    dch_ent_id  BIGINT  NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    dch_cha_id  INT     NOT NULL REFERENCES chantier (cha_id) ON DELETE CASCADE,
    dch_entete  BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (dch_ent_id, dch_cha_id)
);
CREATE INDEX IF NOT EXISTS ix_document_chantier_cha ON document_chantier (dch_cha_id);

COMMENT ON TABLE document_chantier IS 'Chantiers d''une pièce : entête (dch_entete) et lignes (lig_cha_id) ; tenue par triggers';

-- Chantiers des pièces données, recalculés.
CREATE OR REPLACE FUNCTION f_document_chantier_maj(p_ents BIGINT[]) RETURNS VOID LANGUAGE sql AS $$
    DELETE FROM document_chantier WHERE dch_ent_id = ANY(p_ents);
    INSERT INTO document_chantier (dch_ent_id, dch_cha_id, dch_entete)
    SELECT x.ent_id, x.cha_id, bool_or(x.entete)
    FROM (SELECT d.ent_id, d.ent_chantier_id AS cha_id, TRUE AS entete FROM document d
          WHERE d.ent_id = ANY(p_ents) AND d.ent_chantier_id IS NOT NULL
          UNION ALL
          SELECT l.lig_ent_id, l.lig_cha_id, FALSE FROM document_ligne l
          WHERE l.lig_ent_id = ANY(p_ents) AND l.lig_cha_id IS NOT NULL) x
    WHERE EXISTS (SELECT 1 FROM document d WHERE d.ent_id = x.ent_id)
    GROUP BY x.ent_id, x.cha_id;
$$;

CREATE OR REPLACE FUNCTION trg_document_chantier_entete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM f_document_chantier_maj(ARRAY[NEW.ent_id]);
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS document_chantier_entete ON document;
CREATE TRIGGER document_chantier_entete AFTER INSERT OR UPDATE OF ent_chantier_id ON document
    FOR EACH ROW EXECUTE FUNCTION trg_document_chantier_entete();

CREATE OR REPLACE FUNCTION trg_document_chantier_lignes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_ents BIGINT[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_ents := ARRAY(SELECT DISTINCT lig_ent_id FROM nouvelles WHERE lig_cha_id IS NOT NULL);
    ELSIF TG_OP = 'DELETE' THEN
        v_ents := ARRAY(SELECT DISTINCT lig_ent_id FROM anciennes WHERE lig_cha_id IS NOT NULL);
    ELSE
        v_ents := ARRAY(SELECT n.lig_ent_id FROM nouvelles n JOIN anciennes o ON o.lig_id = n.lig_id
                        WHERE n.lig_cha_id IS DISTINCT FROM o.lig_cha_id OR n.lig_ent_id <> o.lig_ent_id
                        UNION SELECT o.lig_ent_id FROM nouvelles n JOIN anciennes o ON o.lig_id = n.lig_id
                        WHERE n.lig_cha_id IS DISTINCT FROM o.lig_cha_id OR n.lig_ent_id <> o.lig_ent_id);
    END IF;
    IF cardinality(v_ents) > 0 THEN PERFORM f_document_chantier_maj(v_ents); END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS document_chantier_lignes_ins ON document_ligne;
DROP TRIGGER IF EXISTS document_chantier_lignes_maj ON document_ligne;
DROP TRIGGER IF EXISTS document_chantier_lignes_sup ON document_ligne;
CREATE TRIGGER document_chantier_lignes_ins AFTER INSERT ON document_ligne
    REFERENCING NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION trg_document_chantier_lignes();
CREATE TRIGGER document_chantier_lignes_maj AFTER UPDATE ON document_ligne
    REFERENCING OLD TABLE AS anciennes NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION trg_document_chantier_lignes();
CREATE TRIGGER document_chantier_lignes_sup AFTER DELETE ON document_ligne
    REFERENCING OLD TABLE AS anciennes FOR EACH STATEMENT EXECUTE FUNCTION trg_document_chantier_lignes();

-- Reprise de l'existant (rejouable : tout est recalculé).
SELECT f_document_chantier_maj(ARRAY(SELECT ent_id FROM document));
