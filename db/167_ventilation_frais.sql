-- =============================================================================
-- Cœur LogiBTP – ventilation des frais annexes (CONCEPTION-VENTILATION-FRAIS.md).
-- Les frais annexes sont des tranches (titres) de type de prix F (modules/document/db/014), ventilées sur les lignes de
-- prix de leur tranche parente (portée, dans une section) par MoteurDevisBtp (JS / C#) :
--  * document.ent_fa_lignes : lignes hors vente qui reçoivent des frais (V aucune, OA options et variantes, OAM et pour
--    mémoire) ; ent_fa_mode : C au coefficient moyen des lignes vendues, B dans la base de répartition ;
--  * ventilation_frais : clés saisies (ligne, élément, nature ; % de la tranche ou montant). vfr_source_lig_id nul :
--    clé de nature valable pour toutes les tranches. Pas de clé étrangère vers les lignes : une clé dont la ligne a été
--    supprimée reste (orpheline, signalée) jusqu'à la validation, où les clés sont figées en clés de ligne ;
--  * ventilation_frais_ligne : détail calculé (part de chaque tranche reçue par chaque ligne), réécrit à chaque
--    enregistrement (traçabilité).
-- Rejouable (IF NOT EXISTS).
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_fa_lignes VARCHAR(3) NOT NULL DEFAULT 'V'
    CHECK (ent_fa_lignes IN ('V','OA','OAM'));
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_fa_mode   CHAR(1)    NOT NULL DEFAULT 'C'
    CHECK (ent_fa_mode IN ('C','B'));

CREATE TABLE IF NOT EXISTS ventilation_frais (
    vfr_id             BIGSERIAL     PRIMARY KEY,
    vfr_ent_id         BIGINT        NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    vfr_source_lig_id  BIGINT,                                           -- tranche F (nulle : nature globale)
    vfr_cible          VARCHAR(10)   NOT NULL CHECK (vfr_cible IN ('LIGNE','ELEMENT','NATURE')),
    vfr_lig_id         BIGINT,                                           -- LIGNE
    vfr_element        VARCHAR(400),                                     -- ELEMENT : « CODE|libellé » (cleElementVentilation)
    vfr_nat_id         INT,                                              -- NATURE
    vfr_mode           CHAR(1)       NOT NULL CHECK (vfr_mode IN ('P','M')),   -- % de la tranche, montant
    vfr_valeur         NUMERIC(18,6) NOT NULL,
    CHECK ((vfr_cible = 'LIGNE'   AND vfr_lig_id IS NOT NULL AND vfr_source_lig_id IS NOT NULL)
        OR (vfr_cible = 'ELEMENT' AND vfr_element IS NOT NULL AND vfr_source_lig_id IS NOT NULL)
        OR (vfr_cible = 'NATURE'  AND vfr_nat_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_vfr_ent ON ventilation_frais (vfr_ent_id);

CREATE TABLE IF NOT EXISTS ventilation_frais_ligne (
    vfl_id             BIGSERIAL     PRIMARY KEY,
    vfl_ent_id         BIGINT        NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    vfl_source_lig_id  BIGINT        NOT NULL REFERENCES document_ligne(lig_id) ON DELETE CASCADE,
    vfl_lig_id         BIGINT        NOT NULL REFERENCES document_ligne(lig_id) ON DELETE CASCADE,
    vfl_montant        NUMERIC(18,6) NOT NULL,
    vfl_vfr_id         BIGINT        REFERENCES ventilation_frais(vfr_id) ON DELETE SET NULL   -- clé appliquée (nulle : prorata)
);
CREATE INDEX IF NOT EXISTS ix_vfl_ent ON ventilation_frais_ligne (vfl_ent_id);
