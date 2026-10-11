-- =============================================================================
-- Module Liste – thèmes de vues. Un thème regroupe des vues (Devis, Factures, Salariés, Ressources…) et
-- déclare les types d'élément qu'il couvre : ses vues ne montrent que des lignes de ces types (aucun = tous).
-- La liste des thèmes n'est pas figée : elle est complétée par les administrateurs.
-- =============================================================================

CREATE TABLE theme_liste (
    thl_code      VARCHAR(50)   PRIMARY KEY,
    thl_libelle   VARCHAR(100)  NOT NULL,
    thl_icone     VARCHAR(16),
    thl_ordre     INT           NOT NULL DEFAULT 0,
    thl_types     JSONB         NOT NULL DEFAULT '[]',      -- [{ "code": "V_DEVIS", "libelle": "Devis client" }]
    thl_actif     BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Thème de la vue (repris de vli_definition.theme à l'enregistrement, pour lister les vues par thème).
ALTER TABLE vue_liste ADD COLUMN vli_theme VARCHAR(50) REFERENCES theme_liste(thl_code) ON DELETE SET NULL;
CREATE INDEX ix_vli_theme ON vue_liste (vli_theme);
