-- =============================================================================
-- Module Liste – saisie dans les listes. L'application déclare les sources modifiables ; seules les colonnes que
-- PostgreSQL déclare modifiables (information_schema.columns.is_updatable : vue simple sur une table, colonne
-- non calculée) et cochées « modifiable » dans la vue sont saisissables. Écriture par UPDATE sur la vue, ligne
-- verrouillée et empreinte contrôlée (une modification faite par ailleurs n'est jamais écrasée).
-- =============================================================================

ALTER TABLE source_liste ADD COLUMN sli_modifiable BOOLEAN NOT NULL DEFAULT FALSE;
