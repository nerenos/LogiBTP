-- =============================================================================
-- Module SAV, équipements installés (ANALYSE-MODULE-STOCK.md § 11, S24.8 ; plans/stock.md, lot 2) : un numéro de série
-- posé chez un client (article, lot du stock, lieu et tiers fournis par l'application, date de pose, garantie en mois
-- ou fin saisie), créé par un mouvement de stock ou à la main, retiré (retour, dépose) ou remplacé par un autre
-- équipement. Articles, lots, lieux, tiers et pièces sont des identifiants de l'application (clés étrangères posées par
-- le cœur). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS equipement_installe (
    eqi_id              BIGSERIAL     PRIMARY KEY,
    eqi_numero          VARCHAR(60)   NOT NULL CHECK (btrim(eqi_numero) <> ''),
    eqi_ele_id          BIGINT        NOT NULL,                          -- article de la bibliothèque
    eqi_lot_id          BIGINT,                                          -- lot (numéro de série) du stock, sinon null
    eqi_libelle         VARCHAR(200),                                    -- désignation propre (emplacement chez le client…)
    eqi_lieu_id         BIGINT,                                          -- lieu d'installation (chantier)
    eqi_tiers_id        BIGINT,                                          -- client
    eqi_pose            DATE,
    eqi_garantie_mois   INT           CHECK (eqi_garantie_mois IS NULL OR eqi_garantie_mois BETWEEN 0 AND 600),
    eqi_fin_garantie    DATE,                                            -- fin saisie (prioritaire sur pose + durée)
    eqi_etat            VARCHAR(10)   NOT NULL DEFAULT 'INSTALLE' CHECK (eqi_etat IN ('INSTALLE', 'RETIRE', 'REMPLACE')),
    eqi_retire_le       DATE,
    eqi_origine         VARCHAR(10)   NOT NULL DEFAULT 'MANUEL' CHECK (eqi_origine IN ('MOUVEMENT', 'MANUEL')),
    eqi_ent_id          BIGINT,                                          -- pièce d'origine (mouvement)
    eqi_lig_id          BIGINT,
    eqi_mvt_id          BIGINT,
    eqi_retire_ent_id   BIGINT,                                          -- pièce qui a retiré l'équipement (retour, transfert)
    eqi_remplace_id     BIGINT        REFERENCES equipement_installe(eqi_id) ON DELETE SET NULL,
    eqi_commentaire     TEXT,
    eqi_cree_par        VARCHAR(50)   NOT NULL,
    eqi_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    eqi_maj_par         VARCHAR(50),
    eqi_maj_le          TIMESTAMPTZ,
    CHECK (eqi_fin_garantie IS NULL OR eqi_pose IS NULL OR eqi_fin_garantie >= eqi_pose),
    CHECK ((eqi_etat = 'INSTALLE') = (eqi_retire_le IS NULL))
);
COMMENT ON TABLE equipement_installe IS 'Équipement installé chez un client : numéro de série posé, garantie, retrait ou remplacement (module SAV)';
COMMENT ON COLUMN equipement_installe.eqi_remplace_id IS 'Équipement que celui-ci remplace (l''ancien passe à REMPLACE)';

-- Un numéro de série n'est installé qu'une fois par article ; retiré ou remplacé, il peut être reposé.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eqi_numero_installe ON equipement_installe (eqi_ele_id, upper(eqi_numero)) WHERE eqi_etat = 'INSTALLE';
CREATE INDEX IF NOT EXISTS ix_eqi_numero ON equipement_installe (upper(eqi_numero));
CREATE INDEX IF NOT EXISTS ix_eqi_lieu ON equipement_installe (eqi_lieu_id) WHERE eqi_lieu_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_eqi_tiers ON equipement_installe (eqi_tiers_id) WHERE eqi_tiers_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_eqi_mvt ON equipement_installe (eqi_mvt_id) WHERE eqi_mvt_id IS NOT NULL;
ALTER TABLE equipement_installe ADD COLUMN IF NOT EXISTS eqi_retire_ent_id BIGINT;
