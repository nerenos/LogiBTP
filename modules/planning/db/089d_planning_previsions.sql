-- =============================================================================
-- Module Planning : ressources et liste à planifier — date prévisionnelle des éléments à planifier (budget d'un élément pour un service), saisie dans
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

-- Copies des compositions d'équipes appliquées à une tâche (équipe → { date, membres }) : des membres peuvent être
-- retirés de la tâche sans toucher à l'équipe ; un changement de composition pendant la tâche est proposé à l'utilisateur.
ALTER TABLE pla_tache ADD COLUMN IF NOT EXISTS tac_equipes JSONB NOT NULL DEFAULT '{}';
COMMENT ON COLUMN pla_tache.tac_equipes IS 'Compositions d''équipes appliquées : { "<equ_id>": { "date": "AAAA-MM-JJ", "membres": ["SALARIE:12", …] } }';

-- État d'une tâche facultatif : vide par défaut (aucune pastille), sinon OPTION, PREVUE, CONFIRMEE, EN_COURS, TERMINEE.
ALTER TABLE pla_tache ALTER COLUMN tac_etat DROP NOT NULL;
ALTER TABLE pla_tache ALTER COLUMN tac_etat DROP DEFAULT;
