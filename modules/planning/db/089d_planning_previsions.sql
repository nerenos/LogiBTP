-- =============================================================================
-- Module Planning : date prévisionnelle des éléments à planifier (budget d'un élément pour un service), saisie dans
-- la liste « À planifier » pour la trier ; sans clé étrangère (élément désigné par type et identifiant). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pla_prevision (
    ppr_type_element  VARCHAR(30)  NOT NULL,
    ppr_id_element    VARCHAR(40)  NOT NULL,
    ppr_srv_id        INTEGER      NOT NULL,
    ppr_date          DATE         NOT NULL,
    ppr_maj_par       VARCHAR(50)  NOT NULL DEFAULT '',
    ppr_maj_le        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (ppr_type_element, ppr_id_element, ppr_srv_id)
);
COMMENT ON TABLE pla_prevision IS 'Date prévisionnelle d''un élément à planifier (élément et service) : tri de la liste « À planifier »';
