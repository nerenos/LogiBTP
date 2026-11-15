-- =============================================================================
-- Cœur – règlements : signe des échéances d'un avoir (décision du 12/11/2026). Rejouable.
--
-- Un avoir garde des totaux positifs (pièce, éditions, export comptable : signe porté par le type) ; son échéancier
-- (document_echeance) aussi. Le module Règlements attend au contraire un montant signé, négatif pour un avoir (reste,
-- pointage, compensation et imputation sur une facture). f_signe_reglement(ent_id) donne ce signe : −1 pour une pièce
-- d'un type d'avoir (type d'avoir d'un autre type, tyd_avoir_tyd_id, ou cible d'une transformation d'étape AVOIR) dont le
-- net à payer est positif ; 1 sinon (facture, avoir d'avancement déjà négatif). Lu par Btp/SpecialisationReglementBtp.cs
-- (échéances, état de paiement), l'encours du client (Btp/SpecialisationBtp.cs) et le reste à payer des éditions.
-- =============================================================================

CREATE OR REPLACE FUNCTION f_type_avoir(p_tyd_id INT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM type_document x WHERE x.tyd_avoir_tyd_id = p_tyd_id)
        OR EXISTS (SELECT 1 FROM transformation_autorisee a WHERE a.tra_cible_tyd_id = p_tyd_id AND a.tra_etape = 'AVOIR')
$$;

CREATE OR REPLACE FUNCTION f_signe_reglement(p_ent_id BIGINT) RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN f_type_avoir(d.ent_tyd_id) AND coalesce(d.ent_net_a_payer, 0) > 0 THEN -1 ELSE 1 END
    FROM document d WHERE d.ent_id = p_ent_id
$$;

COMMENT ON FUNCTION f_signe_reglement(BIGINT) IS 'Signe des échéances d''une pièce pour le module Règlements : −1 pour un avoir à net positif, 1 sinon (db/306)';
