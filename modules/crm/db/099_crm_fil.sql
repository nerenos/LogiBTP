-- Module CRM LogiBTP – fil d'actualité (ANALYSE-MODULE-CRM.md, lot 5 : § 2.6, C12, C13, C17, C23) : le fil ne stocke pas
-- ses propres données (notes cochées « Dans le fil », documents et photos de la GED fournis par l'application) ; seuls
-- les événements des modules (bordereau, visa reçu, indice, demande transformée…) sont publiés ici. Rejouable.

CREATE TABLE IF NOT EXISTS crm_evenement (
    eve_id            BIGSERIAL     PRIMARY KEY,
    eve_type          VARCHAR(30)   NOT NULL,                        -- DIFFUSION, VISA, INDICE, DEMANDE_TRANSFORMEE…
    eve_type_element  VARCHAR(30)   NOT NULL,
    eve_id_element    VARCHAR(50)   NOT NULL,
    eve_libelle       VARCHAR(300)  NOT NULL,
    eve_url           VARCHAR(200),
    eve_module        VARCHAR(30)   NOT NULL DEFAULT 'crm',
    eve_quand         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    eve_par           VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS ix_eve_element ON crm_evenement (eve_type_element, eve_id_element, eve_quand DESC);
CREATE INDEX IF NOT EXISTS ix_eve_quand ON crm_evenement (eve_quand DESC);
