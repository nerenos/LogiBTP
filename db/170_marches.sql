-- =============================================================================
-- Cœur LogiBTP – gestion des marchés, lot 3 (CONCEPTION-ACHATS-MARCHES.md, Q16 à Q19).
-- - marche_document : commandes du marché, la commande de base (BASE, rang 0) puis les avenants (AVENANT, rang 1, 2…),
--   écrites à la validation d'une commande client rattachée au marché (ou à son rattachement après validation).
-- - mar_montant_ht devient calculé : somme des commandes validées du marché (avenants en moins-value compris).
-- - Plus de transformation directe devis → situation ou facture d'avancement (un marché suppose une commande).
-- Rejouable (IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT).
-- =============================================================================

CREATE TABLE IF NOT EXISTS marche_document (
    mdo_id      SERIAL        PRIMARY KEY,
    mdo_mar_id  INT           NOT NULL REFERENCES marche(mar_id) ON DELETE CASCADE,
    mdo_ent_id  BIGINT        NOT NULL UNIQUE REFERENCES document(ent_id) ON DELETE CASCADE,
    mdo_role    VARCHAR(10)   NOT NULL CHECK (mdo_role IN ('BASE', 'AVENANT')),
    mdo_rang    SMALLINT      NOT NULL DEFAULT 0,                 -- 0 : commande de base ; avenants : 1, 2…
    mdo_date    DATE          NOT NULL DEFAULT current_date
);
CREATE INDEX IF NOT EXISTS ix_mdo_marche ON marche_document (mdo_mar_id, mdo_rang);

-- Montant du marché (commandes validées) et commande de base (mar_ent_id).
CREATE OR REPLACE FUNCTION f_marche_recalculer(p_mar INT) RETURNS VOID LANGUAGE sql AS $$
    UPDATE marche m SET
        mar_montant_ht = (SELECT coalesce(sum(d.ent_total_ht), 0) FROM marche_document x JOIN document d ON d.ent_id = x.mdo_ent_id
                          WHERE x.mdo_mar_id = m.mar_id AND d.ent_verrouille),
        mar_ent_id = coalesce((SELECT x.mdo_ent_id FROM marche_document x WHERE x.mdo_mar_id = m.mar_id AND x.mdo_role = 'BASE'), m.mar_ent_id)
    WHERE m.mar_id = p_mar;
$$;

-- Commande client validée : inscrite au marché de son rattachement (ent_marche_id), retirée d'un autre marché. La
-- première commande d'un marché est sa base (la commande d'origine mar_ent_id si elle y est), les suivantes des
-- avenants. Une commande intermédiaire (devis facturé directement) n'est pas suivie.
CREATE OR REPLACE FUNCTION f_marche_commande(p_ent BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_mar INT;
    v_ancien INT;
    v_suivie BOOLEAN;
BEGIN
    SELECT d.ent_marche_id, (t.tyd_code = 'V_COMMANDE' AND d.ent_verrouille AND NOT d.ent_intermediaire)
      INTO v_mar, v_suivie
      FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = p_ent;
    SELECT mdo_mar_id INTO v_ancien FROM marche_document WHERE mdo_ent_id = p_ent;
    IF v_ancien IS NOT NULL AND (v_ancien IS DISTINCT FROM v_mar OR NOT coalesce(v_suivie, FALSE)) THEN
        DELETE FROM marche_document WHERE mdo_ent_id = p_ent;
        PERFORM f_marche_recalculer(v_ancien);
    END IF;
    IF v_mar IS NULL OR NOT coalesce(v_suivie, FALSE) THEN RETURN; END IF;
    INSERT INTO marche_document (mdo_mar_id, mdo_ent_id, mdo_role, mdo_rang)
    SELECT v_mar, p_ent,
           CASE WHEN NOT EXISTS (SELECT 1 FROM marche_document WHERE mdo_mar_id = v_mar AND mdo_role = 'BASE')
                 AND (m.mar_ent_id IS NULL OR m.mar_ent_id = p_ent
                      OR NOT EXISTS (SELECT 1 FROM document WHERE ent_id = m.mar_ent_id AND ent_marche_id = v_mar))
                THEN 'BASE' ELSE 'AVENANT' END,
           coalesce((SELECT max(mdo_rang) + 1 FROM marche_document WHERE mdo_mar_id = v_mar), 0)
    FROM marche m WHERE m.mar_id = v_mar
    ON CONFLICT (mdo_ent_id) DO NOTHING;
    PERFORM f_marche_recalculer(v_mar);
END;
$$;

-- Reprise des marchés existants : commande d'origine puis commandes rattachées, dans l'ordre des identifiants.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT d.ent_id FROM document d JOIN marche m ON m.mar_id = d.ent_marche_id
             ORDER BY (d.ent_id = m.mar_ent_id) DESC, d.ent_id
    LOOP
        PERFORM f_marche_commande(r.ent_id);
    END LOOP;
END;
$$;

-- Q19 : un marché suppose une commande.
DELETE FROM transformation_autorisee t USING type_document s, type_document c
WHERE s.tyd_id = t.tra_source_tyd_id AND c.tyd_id = t.tra_cible_tyd_id
  AND s.tyd_code = 'V_DEVIS' AND c.tyd_code IN ('V_SITUATION', 'V_FACTURE_AVT');

-- Liste des marchés : nombre d'avenants (colonne ajoutée en fin de vue).
CREATE OR REPLACE VIEW v_liste_marches AS
SELECT m.mar_id AS id, 'marche'::text AS type_element, m.mar_code AS code, m.mar_libelle AS libelle,
       c.cha_code AS chantier, a.aff_code AS affaire, t.per_raison_sociale AS client, d.ent_numero AS commande,
       CASE m.mar_nature WHEN 'U' THEN 'Public' ELSE 'Privé' END AS nature, m.mar_montant_ht AS montant_ht, m.mar_statut AS statut, m.mar_date AS date_marche,
       f.facture_ht, m.mar_montant_ht - f.facture_ht AS reste_a_facturer,
       (SELECT count(*) FROM marche_document x WHERE x.mdo_mar_id = m.mar_id AND x.mdo_role = 'AVENANT') AS nb_avenants
FROM marche m
JOIN chantier c ON c.cha_id = m.mar_cha_id
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN personne t ON t.per_id = m.mar_tiers_id
LEFT JOIN document d ON d.ent_id = m.mar_ent_id
CROSS JOIN LATERAL (SELECT coalesce(sum(x.facture_ht), 0) AS facture_ht FROM v_facturation_document x WHERE x.ent_marche_id = m.mar_id) f;
