-- =============================================================================
-- Cœur LogiBTP – application de terrain (plan terrain-suites, lot 22 ; TS21 a, TS22 c) : facture brouillon depuis le
-- bon de SAV. Le temps de l'intervention est facturé au prix de l'article « Main-d'œuvre SAV » de la bibliothèque
-- désigné ici (prix, TVA, compte et nature de l'article) ; sans article désigné, le bouton « Facturer » est masqué.
-- Une ligne unique (psa_id = 1). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS parametre_sav (
    psa_id            SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (psa_id = 1),
    psa_ele_mo_id     BIGINT       REFERENCES element (ele_id) ON DELETE SET NULL,
    psa_maj_par       VARCHAR(50),
    psa_maj_le        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE parametre_sav IS 'Paramètres de la facturation des interventions SAV (une ligne)';
COMMENT ON COLUMN parametre_sav.psa_ele_mo_id IS 'Article « Main-d''œuvre SAV » : prix horaire, TVA et compte du temps facturé depuis le bon';

INSERT INTO parametre_sav (psa_id) VALUES (1) ON CONFLICT (psa_id) DO NOTHING;
