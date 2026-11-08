-- =============================================================================
-- Cœur – module Relances, lot 5 (plans/relances.md, Q6, Q21). Rejouable.
--
-- Surcharge par tiers sur la fiche personne (onglet Facturation et règlement, groupe Relances) :
--   per_rel_regle           règle propre au tiers (JSONB snake_case : niveaux { rang, delai, mode, modele_courriel,
--                           modele_edition }, repeter, intervalle) ; NULL : règle de la nature ; invalide : ignorée ;
--   per_rel_ne_pas_relancer le tiers sort de la liste de travail ;
--   per_rel_contact_ind_id  contact de relance (individu de l'annuaire), destinataire des relances (lot 6) ;
--   per_rel_mode            mode préféré (jamais en remplacement d'un niveau en RECOMMANDE, Q13) ;
--   per_rel_commentaire     commentaire libre repris par la liste de travail.
-- Lues par Btp/SpecialisationRelanceBtp.RegleDuTiersAsync.
-- =============================================================================

ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_rel_regle JSONB;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_rel_ne_pas_relancer BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_rel_contact_ind_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_rel_mode VARCHAR(10);
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_rel_commentaire TEXT;
ALTER TABLE personne DROP CONSTRAINT IF EXISTS ck_per_rel_mode;
ALTER TABLE personne ADD CONSTRAINT ck_per_rel_mode CHECK (per_rel_mode IS NULL OR per_rel_mode IN ('COURRIEL', 'COURRIER', 'RECOMMANDE', 'TACHE'));
CREATE INDEX IF NOT EXISTS ix_per_rel_ne_pas_relancer ON personne (per_id) WHERE per_rel_ne_pas_relancer;

COMMENT ON COLUMN personne.per_rel_regle IS 'Relances : règle de niveaux propre au tiers (JSON), NULL = règle de la nature';
COMMENT ON COLUMN personne.per_rel_ne_pas_relancer IS 'Relances : tiers jamais relancé (sort de la liste de travail)';
COMMENT ON COLUMN personne.per_rel_contact_ind_id IS 'Relances : individu contact de relance';
COMMENT ON COLUMN personne.per_rel_mode IS 'Relances : mode préféré (COURRIEL, COURRIER, RECOMMANDE, TACHE)';
