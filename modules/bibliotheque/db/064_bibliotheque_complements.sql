-- =============================================================================
-- Module Bibliothèque – compléments de l'élément (demandes du 25/10/2026, lot 7 : A18a, A18c, A18d, A18e, A18f).
-- Rejouable.
--
-- ele_mots_cles : mots de recherche séparés par des virgules (« domino, sucre, connecteur rapide ») ; pris par la
--   recherche de l'appel (F3) et par celle des listes.
-- ele_code_barre : code-barres global de l'élément (EAN…), unique dans sa bibliothèque ; un code saisi dans la colonne
--   Code d'un document qui ne désigne aucun code d'élément désigne l'élément de ce code-barres.
-- ele_description_html : description technique (HTML nettoyé par la fiche), variable des éditions.
-- ele_delai_livraison : délai de livraison global (jours) ; priorité avec le délai du tarif et du stock : lot 8.
-- Type TEXTE : texte réutilisable (libellé HTML seul, sans prix), inséré comme ligne de texte ou dans les textes de
--   l'édition (introduction, conclusion).
-- =============================================================================

ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_mots_cles VARCHAR(500);
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_code_barre VARCHAR(50);
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_description_html TEXT;
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_delai_livraison INT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ele_delai_livraison') THEN
        ALTER TABLE element ADD CONSTRAINT ck_ele_delai_livraison CHECK (ele_delai_livraison >= 0);
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ele_code_barre ON element (ele_bib_id, ele_code_barre) WHERE ele_code_barre IS NOT NULL;

ALTER TABLE element DROP CONSTRAINT IF EXISTS element_ele_type_check;
ALTER TABLE element ADD CONSTRAINT element_ele_type_check CHECK (ele_type IN ('ARTICLE','OUVRAGE','ENSEMBLE','POSTE_PIED','TEXTE'));
