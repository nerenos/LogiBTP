-- Cœur – clôture du stock, lots 10 et 11 du plan Stock (plans/stock.md ; ANALYSE-MODULE-STOCK.md Q9) : une clôture est datée
-- (fin d'exercice), compare l'état valorisé de tous les lieux à cette date à celui de la date de départ (la clôture précédente
-- par défaut), garde la valeur de chaque nature d'article au début et à la fin (provision pour dépréciation : lot 11) et porte
-- la pièce d'opération diverse qui l'exporte (S_INVENTAIRE, Btp/ClotureStockBtp.cs ; écriture par ReglesStockCompta). Annulée
-- tant que sa pièce n'est pas transférée en comptabilité. Rejouable.

CREATE TABLE IF NOT EXISTS stk_cloture (
    clo_id              BIGSERIAL     PRIMARY KEY,
    clo_date            TIMESTAMPTZ   NOT NULL,
    clo_debut           TIMESTAMPTZ,
    clo_libelle         VARCHAR(200)  NOT NULL,
    clo_methode         VARCHAR(12)   NOT NULL,
    clo_etat            VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE' CHECK (clo_etat IN ('ACTIVE', 'ANNULEE')),
    clo_ent_id          BIGINT        REFERENCES document (ent_id) ON DELETE SET NULL,
    clo_valeur_initiale NUMERIC(18,2) NOT NULL DEFAULT 0,
    clo_valeur_finale   NUMERIC(18,2) NOT NULL DEFAULT 0,
    clo_cree_par        VARCHAR(50)   NOT NULL,
    clo_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    clo_annule_par      VARCHAR(50),
    clo_annule_le       TIMESTAMPTZ
);
COMMENT ON TABLE stk_cloture IS 'Clôture du stock à une date : valeurs de début et de fin par nature d''article, pièce d''opération diverse de variation';
CREATE UNIQUE INDEX IF NOT EXISTS ux_clo_date_active ON stk_cloture (clo_date) WHERE clo_etat = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_clo_ent ON stk_cloture (clo_ent_id) WHERE clo_ent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stk_cloture_nature (
    cln_id                   BIGSERIAL     PRIMARY KEY,
    cln_clo_id               BIGINT        NOT NULL REFERENCES stk_cloture (clo_id) ON DELETE CASCADE,
    cln_nat_id               INT           REFERENCES nature_element (nat_id) ON DELETE SET NULL,   -- null : articles sans nature
    cln_initial              NUMERIC(18,2) NOT NULL DEFAULT 0,
    cln_final                NUMERIC(18,2) NOT NULL DEFAULT 0,
    cln_provision_initiale   NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cln_provision_initiale >= 0),
    cln_provision_finale     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cln_provision_finale >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cln_nature ON stk_cloture_nature (cln_clo_id, coalesce(cln_nat_id, 0));
