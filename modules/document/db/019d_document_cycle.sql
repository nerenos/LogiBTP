-- =============================================================================
-- Module Document – cycle de vie des documents (CONCEPTION-REGLES-DOCUMENTS.md, P1, P4, P17, P19, P21, P25) :
-- étapes datées (approbation interne facultative, envoi = validation de l'entreprise, validation du tiers), état de
-- paiement (posé par l'application : module Règlements), statut calculé par f_document_statut : le plus avancé de
-- PAYE, PAYE_PARTIEL, FACTURE, FACTURATION, SOLDE, VALIDE, ENVOYE, APPROUVE parmi les statuts du type (ANNULE et
-- REMPLACE posés explicitement, BROUILLON tant que le document n'est pas verrouillé). Facturation et solde (statuts
-- automatiques, règle STATUTS_AUTO) d'après les liens des lignes de prix vendues vers les documents validés non annulés.
-- Rejouable.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_approuve_le     TIMESTAMPTZ;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_envoye_le       TIMESTAMPTZ;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_valide_tiers_le TIMESTAMPTZ;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_etat_paiement   CHAR(1) CHECK (ent_etat_paiement IN ('P','T'));
-- Rejet (plateforme de facturation, tiers) : noté, le document reste ENVOYE jusqu'à l'avoir d'annulation (P25).
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_rejete_le       TIMESTAMPTZ;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_rejet_motif     VARCHAR(300);

ALTER TABLE document_historique DROP CONSTRAINT IF EXISTS document_historique_his_action_check;
ALTER TABLE document_historique ADD CONSTRAINT document_historique_his_action_check
    CHECK (his_action IN ('CREATION','MODIFICATION','VALIDATION','ANNULATION','APPROBATION','ENVOI','VALIDATION_TIERS',
                          'DEVALIDATION','FORCAGE','REJET'));

-- Droits du cycle de vie : consulter, approuver (validation interne), dévalider, forcer (mode root).
ALTER TABLE droit_document DROP CONSTRAINT IF EXISTS droit_document_drt_action_check;
ALTER TABLE droit_document ADD CONSTRAINT droit_document_drt_action_check
    CHECK (drt_action IN ('CONSULTER','CREER','MODIFIER','VALIDER','TRANSFORMER','SUPPRIMER','APPROUVER','DEVALIDER','FORCER'));

-- Valeur d'une règle des documents pour un type (type, famille, global) ; null si non paramétrée (défaut du catalogue).
CREATE OR REPLACE FUNCTION f_regle_document(p_code VARCHAR, p_tyd_id INT) RETURNS JSONB LANGUAGE sql STABLE AS $$
    SELECT r.rdo_valeur FROM regle_document r JOIN type_document t ON t.tyd_id = p_tyd_id
    WHERE r.rdo_code = p_code AND r.rdo_actif
      AND (r.rdo_tyd_id = t.tyd_id OR (r.rdo_tyd_id IS NULL AND (r.rdo_famille = t.tyd_famille OR r.rdo_famille IS NULL)))
    ORDER BY (r.rdo_tyd_id IS NOT NULL) DESC, (r.rdo_famille IS NOT NULL) DESC
    LIMIT 1
$$;

-- Statut calculé d'un document (écrit s'il change) ; renvoie son code.
CREATE OR REPLACE FUNCTION f_document_statut(p_ent_id BIGINT) RETURNS VARCHAR LANGUAGE plpgsql AS $$
DECLARE
    d document%ROWTYPE;
    actuel VARCHAR;
    auto BOOLEAN;
    nb INT := 0;
    facturees INT := 0;
    entamees INT := 0;
    soldees INT := 0;
    commande BOOLEAN;
    candidats VARCHAR[] := '{}';
    choisi INT;
    code VARCHAR;
BEGIN
    SELECT * INTO d FROM document WHERE ent_id = p_ent_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT std_code INTO actuel FROM statut_document WHERE std_id = d.ent_std_id;
    IF actuel IN ('ANNULE', 'REMPLACE') OR NOT d.ent_verrouille THEN RETURN actuel; END IF;

    auto := coalesce(f_regle_document('STATUTS_AUTO', d.ent_tyd_id) = 'true'::jsonb, false);
    IF auto THEN
        -- Lignes de prix vendues (hors composantes, options, variantes, pour mémoire, frais annexes) et ce qui en est
        -- repris par les documents validés non annulés, par étape (somme signée : avoirs et retours en moins), plus les
        -- quantités soldées ; facturé : étape FACTURATION ; livré (SOLDE) : étape RECEPTION.
        WITH lignes AS (
            SELECT l.lig_id, abs(coalesce(l.lig_qte_vendue, 0)) AS qte
            FROM document_ligne l
            LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
            WHERE l.lig_ent_id = p_ent_id AND l.lig_tyl_id IN (2, 3) AND coalesce(l.lig_type_prix, 'V') = 'V'
              AND (p.lig_id IS NULL OR p.lig_tyl_id <> 2) AND abs(coalesce(l.lig_qte_vendue, 0)) > 0),
        repris AS (
            SELECT x.lil_source_lig_id AS lig_id, x.lil_etape AS etape, sum(x.lil_qte) AS qte
            FROM document_ligne_lien x
            JOIN document_ligne c ON c.lig_id = x.lil_cible_lig_id
            JOIN document dc ON dc.ent_id = c.lig_ent_id
            JOIN statut_document sc ON sc.std_id = dc.ent_std_id
            WHERE x.lil_source_lig_id IN (SELECT lig_id FROM lignes) AND dc.ent_verrouille AND sc.std_code NOT IN ('ANNULE', 'REMPLACE')
            GROUP BY 1, 2
            UNION ALL
            SELECT s.lso_lig_id, s.lso_etape, sum(s.lso_qte) FROM document_ligne_solde s
            WHERE s.lso_lig_id IN (SELECT lig_id FROM lignes) GROUP BY 1, 2),
        etapes AS (SELECT lig_id, etape, sum(qte) AS qte FROM repris GROUP BY 1, 2)
        SELECT count(*),
               count(*) FILTER (WHERE coalesce((SELECT e.qte FROM etapes e WHERE e.lig_id = l.lig_id AND e.etape = 'FACTURATION'), 0) >= l.qte),
               count(*) FILTER (WHERE coalesce((SELECT e.qte FROM etapes e WHERE e.lig_id = l.lig_id AND e.etape = 'FACTURATION'), 0) > 0),
               count(*) FILTER (WHERE coalesce((SELECT e.qte FROM etapes e WHERE e.lig_id = l.lig_id AND e.etape = 'RECEPTION'), 0) >= l.qte)
        INTO nb, facturees, entamees, soldees
        FROM lignes l;
    END IF;
    -- SOLDE : documents livrés (étape RECEPTION) ; les devis restent VALIDE hors facturation directe (P4).
    commande := EXISTS (SELECT 1 FROM transformation_autorisee WHERE tra_source_tyd_id = d.ent_tyd_id AND tra_etape = 'RECEPTION');

    IF d.ent_etat_paiement = 'T' THEN candidats := candidats || 'PAYE'::VARCHAR; END IF;
    IF d.ent_etat_paiement IS NOT NULL THEN candidats := candidats || 'PAYE_PARTIEL'::VARCHAR; END IF;
    IF auto AND nb > 0 AND facturees = nb THEN candidats := candidats || 'FACTURE'::VARCHAR; END IF;
    IF auto AND entamees > 0 THEN candidats := candidats || 'FACTURATION'::VARCHAR; END IF;
    IF auto AND commande AND nb > 0 AND soldees = nb THEN candidats := candidats || 'SOLDE'::VARCHAR; END IF;
    IF d.ent_valide_tiers_le IS NOT NULL THEN candidats := candidats || 'VALIDE'::VARCHAR; END IF;
    IF d.ent_envoye_le IS NOT NULL THEN candidats := candidats || 'ENVOYE'::VARCHAR; END IF;
    IF d.ent_approuve_le IS NOT NULL THEN candidats := candidats || 'APPROUVE'::VARCHAR; END IF;
    candidats := candidats || 'VALIDE'::VARCHAR;  -- document verrouillé sans étape datée (données antérieures)

    FOREACH code IN ARRAY candidats LOOP
        SELECT std_id INTO choisi FROM statut_document WHERE std_tyd_id = d.ent_tyd_id AND std_code = code;
        IF FOUND THEN
            IF choisi <> d.ent_std_id THEN UPDATE document SET ent_std_id = choisi WHERE ent_id = p_ent_id; END IF;
            RETURN code;
        END IF;
    END LOOP;
    RETURN actuel;
END $$;
