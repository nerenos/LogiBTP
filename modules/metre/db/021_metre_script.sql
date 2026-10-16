-- =============================================================================
-- Module Métré – métré en script (modules/metre/CONCEPTION-SCRIPT.md).
-- mtr_script : texte du script (déclarations, instructions, « Renvoyer » = quantité). Les anciens métrés en lignes
-- (table metre_ligne) sont convertis au démarrage de l'API, qui supprime ensuite la table (ConversionMetresBases).
-- Variables non locales d'un script : une ligne de variable_definition par variable (var_mtr_id), produite par le
-- moteur à chaque calcul : var_formule = valeur par défaut déclarée, var_type, dernière valeur calculée
-- (var_valeur si numérique, var_valeur_texte si chaîne ou booléen).
-- Rejouable (IF NOT EXISTS).
-- =============================================================================

ALTER TABLE metre ADD COLUMN IF NOT EXISTS mtr_script TEXT;

ALTER TABLE variable_definition ADD COLUMN IF NOT EXISTS var_type CHAR(1) NOT NULL DEFAULT 'N'
    CHECK (var_type IN ('N','C','B'));                                -- numérique, chaîne, booléen
ALTER TABLE variable_definition ADD COLUMN IF NOT EXISTS var_valeur_texte TEXT;  -- dernière valeur (chaîne, booléen)
