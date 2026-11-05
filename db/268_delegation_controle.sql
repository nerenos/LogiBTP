-- Délégation du contrôle N+1 des étapes d'ordres (module Exécution, E30 ; rejouable).
-- Le N+1 d'un ordre est le responsable de son service porteur, sinon celui du service parent, ou un administrateur.
-- Le responsable (ou un administrateur) peut déléguer ce contrôle à un membre du service, pour une période ou sans
-- fin : le délégué contrôle comme le responsable, reçoit la tâche du CRM et les rappels du contrôle en attente.
-- Une délégation d'un service vaut pour ses sous-services (comme la responsabilité).
-- Le module Droits peut aussi accorder le contrôle par profil : nœud « execution/controle », action VALIDER, portée
-- SERVICE (ordres des services dont on est membre) ou TOUT (Btp/SpecialisationExecutionBtp.cs).

CREATE TABLE IF NOT EXISTS delegation_controle (
    dlc_id           SERIAL        PRIMARY KEY,
    dlc_srv_id       INT           NOT NULL REFERENCES service(srv_id) ON DELETE CASCADE,
    dlc_ind_id       BIGINT        NOT NULL REFERENCES individu(ind_id) ON DELETE CASCADE,
    dlc_du           DATE,
    dlc_au           DATE,
    dlc_commentaire  VARCHAR(200),
    dlc_par          VARCHAR(50),
    dlc_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_dlc_periode CHECK (dlc_du IS NULL OR dlc_au IS NULL OR dlc_au >= dlc_du)
);

CREATE INDEX IF NOT EXISTS ix_dlc_srv ON delegation_controle (dlc_srv_id);

COMMENT ON TABLE delegation_controle IS 'Délégations du contrôle N+1 des étapes d''ordres à un membre du service (période facultative)';

-- Contrôleurs d'un service à une date : responsable du service ou de son parent, puis délégués en vigueur du service
-- ou de son parent (délégué = TRUE).
CREATE OR REPLACE FUNCTION f_controleurs_service(p_srv INT, p_jour DATE)
RETURNS TABLE (ind_id BIGINT, delegue BOOLEAN)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (x.ind_id) x.ind_id, x.delegue FROM (
        SELECT r.ind_id, FALSE AS delegue
        FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id,
             LATERAL (VALUES (s.srv_responsable_id), (p.srv_responsable_id)) AS r(ind_id)
        WHERE s.srv_id = p_srv AND r.ind_id IS NOT NULL
        UNION ALL
        SELECT d.dlc_ind_id, TRUE
        FROM service s JOIN delegation_controle d ON d.dlc_srv_id IN (s.srv_id, s.srv_parent_id)
        JOIN individu i ON i.ind_id = d.dlc_ind_id AND i.ind_actif
        WHERE s.srv_id = p_srv AND (d.dlc_du IS NULL OR d.dlc_du <= p_jour) AND (d.dlc_au IS NULL OR d.dlc_au >= p_jour)
    ) x ORDER BY x.ind_id, x.delegue
$$;
