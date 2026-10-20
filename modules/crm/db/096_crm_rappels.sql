-- Module CRM LogiBTP – rappels des notes et paramètres du module (ANALYSE-MODULE-CRM.md, lot 2 : C6, C19, C26).
-- Rejouable.

-- Paramètres du module (clé → valeur JSON) : seuils_rappel { orange, rouge } en jours avant l'échéance.
CREATE TABLE IF NOT EXISTS crm_parametre (
    cpa_cle     VARCHAR(40)   PRIMARY KEY,
    cpa_valeur  JSONB         NOT NULL,
    cpa_maj_le  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    cpa_maj_par VARCHAR(50)
);
INSERT INTO crm_parametre (cpa_cle, cpa_valeur) VALUES ('seuils_rappel', '{"orange": 7, "rouge": 1}') ON CONFLICT DO NOTHING;

-- Rappel : DATE (rap_quand) ou AVANT (rap_delai_jours avant l'échéance de la note ; nul = seuil orange), pour un
-- individu (nul : pour son auteur, sans individu), traité ou non.
CREATE TABLE IF NOT EXISTS crm_rappel (
    rap_id          BIGSERIAL     PRIMARY KEY,
    rap_not_id      BIGINT        NOT NULL REFERENCES crm_note(not_id) ON DELETE CASCADE,
    rap_type        VARCHAR(5)    NOT NULL CHECK (rap_type IN ('DATE', 'AVANT')),
    rap_quand       TIMESTAMPTZ,
    rap_delai_jours INT           CHECK (rap_delai_jours IS NULL OR rap_delai_jours >= 0),
    rap_ind_id      BIGINT,
    rap_cree_par    VARCHAR(50)   NOT NULL,
    rap_cree_le     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    rap_traite_le   TIMESTAMPTZ,
    CHECK (rap_type <> 'DATE' OR rap_quand IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_rap_note ON crm_rappel (rap_not_id);
CREATE INDEX IF NOT EXISTS ix_rap_ind ON crm_rappel (rap_ind_id) WHERE rap_traite_le IS NULL;
CREATE INDEX IF NOT EXISTS ix_rap_cree_par ON crm_rappel (rap_cree_par) WHERE rap_traite_le IS NULL;
