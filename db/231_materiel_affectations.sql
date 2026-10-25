-- =============================================================================
-- Cœur – affectations du matériel (analyse des demandes du 25/10/2026, lot 5b : A3, A7). Rejouable.
--
-- materiel_affectation : affectation datée d'un matériel (fin vide = en cours) à un salarié, un intérimaire (SALARIE,
-- INTERIM : salarie.sal_id), un sous-traitant (personne.per_id) ou un autre matériel porteur (MATERIEL : mat_id ;
-- petit outillage dans un camion : il suit le porteur). Une seule affectation à la fois par matériel ; règles :
-- ReglesAffectations.cs ↔ client/src/app/ressources/affectations.js (jeu tests/ressources/04_affectations.json).
-- =============================================================================

CREATE TABLE IF NOT EXISTS materiel_affectation (
    maf_id          SERIAL        PRIMARY KEY,
    maf_mat_id      INT           NOT NULL REFERENCES materiel(mat_id) ON DELETE CASCADE,
    maf_type        VARCHAR(15)   NOT NULL CHECK (maf_type IN ('SALARIE', 'INTERIM', 'SOUS_TRAITANT', 'MATERIEL')),
    maf_ressource   VARCHAR(40)   NOT NULL,
    maf_du          DATE          NOT NULL,
    maf_au          DATE,
    maf_commentaire VARCHAR(200),
    maf_maj_par     VARCHAR(50),
    maf_maj_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (maf_au IS NULL OR maf_au >= maf_du),
    CHECK (maf_type <> 'MATERIEL' OR maf_ressource <> maf_mat_id::text)
);
CREATE INDEX IF NOT EXISTS ix_maf_materiel ON materiel_affectation (maf_mat_id, maf_du);
CREATE INDEX IF NOT EXISTS ix_maf_ressource ON materiel_affectation (maf_type, maf_ressource);
