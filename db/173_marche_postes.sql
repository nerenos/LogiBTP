-- =============================================================================
-- Postes de pied du marché (CONCEPTION-MARCHES-REGLEMENTS.md, Q5 à Q9, 11.3, 11.4).
-- Portée G (global) : postes après TVA (TTC) posés dans le pied global des factures du marché (paiement direct d'un
-- sous-traitant, autres retenues TTC) ; la retenue de garantie vient de mar_retenue_pct. Portée C (commandes) : modèle
-- de pied recopié dans chaque commande du marché à sa validation (compte prorata, remise… HT ou TTC).
-- Lignes système repérées par lig_proprietes.poste_marche ('R' : retenue de garantie, sinon mpo_id), mises à jour à la
-- validation de la pièce (la valeur d'un paiement direct se saisit sur la facture).
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS marche_poste (
    mpo_id       SERIAL        PRIMARY KEY,
    mpo_mar_id   INT           NOT NULL REFERENCES marche (mar_id) ON DELETE CASCADE,
    mpo_portee   CHAR(1)       NOT NULL DEFAULT 'G' CHECK (mpo_portee IN ('G','C')),
    mpo_type     VARCHAR(20)   NOT NULL DEFAULT 'AUTRE' CHECK (mpo_type IN ('PAIEMENT_DIRECT','PRORATA','REMISE','AUTRE')),
    mpo_libelle  VARCHAR(150)  NOT NULL,
    mpo_niveau   VARCHAR(3)    NOT NULL DEFAULT 'TTC' CHECK (mpo_niveau IN ('HT','TTC')),
    mpo_mode     CHAR(1)       NOT NULL DEFAULT 'P' CHECK (mpo_mode IN ('P','M')),
    mpo_valeur   NUMERIC(18,6) NOT NULL DEFAULT 0,
    mpo_sens     SMALLINT      NOT NULL DEFAULT -1 CHECK (mpo_sens IN (1,-1)),
    mpo_per_id   BIGINT,                                         -- sous-traitant (paiement direct)
    mpo_ordre    SMALLINT      NOT NULL DEFAULT 0,
    mpo_actif    BOOLEAN       NOT NULL DEFAULT true,
    -- Q6 : le pied global ne reçoit que des postes après TVA.
    CONSTRAINT marche_poste_global_ttc CHECK (mpo_portee = 'C' OR mpo_niveau = 'TTC')
);
CREATE INDEX IF NOT EXISTS ix_marche_poste_marche ON marche_poste (mpo_mar_id);

-- Q7 : date de réception des travaux (libération de la retenue de garantie : réception + 1 an).
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_date_reception DATE;
