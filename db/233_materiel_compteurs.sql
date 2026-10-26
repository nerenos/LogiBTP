-- =============================================================================
-- Cœur – compteurs et événements du matériel (analyse des demandes du 25/10/2026, lot 5c-2 : A9, carburant M8 ;
-- ANALYSE-DEMANDES-2026-10.md § 6). Rejouable.
--
-- materiel.mat_compteurs : unités suivies (H, KM, H_KM, AUCUN ; deux au plus, M7) ; mat_heures (existant) et
--   mat_kilometres tenus par trigger = dernier relevé de l'unité (lecture seule dans la fiche).
-- materiel_releve : relevé daté (unité, valeur, remise à zéro, source SAISIE / CARBURANT / ORDRE / BORNE / REPRISE,
--   ordre lié, événement lié) ; contrôles ReglesCompteurs.cs ↔ client/src/app/ressources/compteurs.js (jeu
--   tests/ressources/05_compteurs.json).
-- materiel_evenement : panne, sinistre, accident, immobilisation, contrôle, entretien, plein de carburant, autre ;
--   date, fin, libellé, description, ordre lié, coût (informatif, sauf le carburant : porté dans les coûts), litres.
-- v_cout_chantier (reprise de db/232) : nature CARBURANT = pleins du matériel sur son chantier de suivi.
-- =============================================================================

ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_compteurs VARCHAR(10) NOT NULL DEFAULT 'H';
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_kilometres INT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mat_compteurs') THEN
        ALTER TABLE materiel ADD CONSTRAINT ck_mat_compteurs CHECK (mat_compteurs IN ('H', 'KM', 'H_KM', 'AUCUN'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS materiel_evenement (
    mev_id           SERIAL        PRIMARY KEY,
    mev_mat_id       INT           NOT NULL REFERENCES materiel(mat_id) ON DELETE CASCADE,
    mev_type         VARCHAR(20)   NOT NULL CHECK (mev_type IN ('PANNE', 'SINISTRE', 'ACCIDENT', 'IMMOBILISATION', 'CONTROLE', 'ENTRETIEN', 'CARBURANT', 'AUTRE')),
    mev_date         DATE          NOT NULL,
    mev_fin          DATE,
    mev_libelle      VARCHAR(150),
    mev_description  TEXT,
    mev_ent_id       BIGINT        REFERENCES document(ent_id) ON DELETE SET NULL,
    mev_cout         NUMERIC(18,2),
    mev_litres       NUMERIC(12,2),
    mev_maj_par      VARCHAR(50),
    mev_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (mev_fin IS NULL OR mev_fin >= mev_date)
);
CREATE INDEX IF NOT EXISTS ix_mev_materiel ON materiel_evenement (mev_mat_id, mev_date);

CREATE TABLE IF NOT EXISTS materiel_releve (
    mre_id           SERIAL        PRIMARY KEY,
    mre_mat_id       INT           NOT NULL REFERENCES materiel(mat_id) ON DELETE CASCADE,
    mre_date         DATE          NOT NULL,
    mre_unite        VARCHAR(2)    NOT NULL CHECK (mre_unite IN ('H', 'KM')),
    mre_valeur       NUMERIC(12,1) NOT NULL CHECK (mre_valeur >= 0),
    mre_remise       BOOLEAN       NOT NULL DEFAULT FALSE,
    mre_source       VARCHAR(10)   NOT NULL DEFAULT 'SAISIE' CHECK (mre_source IN ('SAISIE', 'CARBURANT', 'ORDRE', 'BORNE', 'REPRISE')),
    mre_ent_id       BIGINT        REFERENCES document(ent_id) ON DELETE SET NULL,
    mre_mev_id       INT           REFERENCES materiel_evenement(mev_id) ON DELETE CASCADE,
    mre_commentaire  VARCHAR(200),
    mre_maj_par      VARCHAR(50),
    mre_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mre_materiel ON materiel_releve (mre_mat_id, mre_unite, mre_date, mre_id);

-- Compteurs de la fiche = dernier relevé de chaque unité (date, puis ordre de saisie).
CREATE OR REPLACE FUNCTION f_materiel_compteurs(p_mat INT) RETURNS void LANGUAGE sql AS $$
    UPDATE materiel m SET
        mat_heures = coalesce((SELECT round(r.mre_valeur)::int FROM materiel_releve r WHERE r.mre_mat_id = p_mat AND r.mre_unite = 'H' ORDER BY r.mre_date DESC, r.mre_id DESC LIMIT 1), 0),
        mat_kilometres = (SELECT round(r.mre_valeur)::int FROM materiel_releve r WHERE r.mre_mat_id = p_mat AND r.mre_unite = 'KM' ORDER BY r.mre_date DESC, r.mre_id DESC LIMIT 1)
    WHERE m.mat_id = p_mat
$$;
CREATE OR REPLACE FUNCTION f_materiel_releve_compteurs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN PERFORM f_materiel_compteurs(OLD.mre_mat_id); END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.mre_mat_id <> OLD.mre_mat_id) THEN PERFORM f_materiel_compteurs(NEW.mre_mat_id); END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tr_materiel_releve_compteurs ON materiel_releve;
CREATE TRIGGER tr_materiel_releve_compteurs AFTER INSERT OR UPDATE OR DELETE ON materiel_releve
    FOR EACH ROW EXECUTE FUNCTION f_materiel_releve_compteurs();

-- Reprise : heures d'utilisation déjà saisies → relevé initial (une seule fois, matériel sans relevé).
INSERT INTO materiel_releve (mre_mat_id, mre_date, mre_unite, mre_valeur, mre_source, mre_commentaire, mre_maj_par)
SELECT m.mat_id, coalesce(m.mat_date_entree, current_date), 'H', m.mat_heures, 'REPRISE', 'Heures d''utilisation de la fiche', 'reprise'
FROM materiel m
WHERE m.mat_heures > 0 AND NOT EXISTS (SELECT 1 FROM materiel_releve r WHERE r.mre_mat_id = m.mat_id);

CREATE OR REPLACE VIEW v_cout_chantier AS
SELECT p.poi_cha_id AS chantier_id, date_trunc('month', p.poi_date)::date AS mois, 'MO'::varchar(20) AS nature,
       round(sum(coalesce(p.poi_cout, 0)), 2) AS montant, sum(p.poi_minutes)::numeric AS minutes,
       count(*) FILTER (WHERE p.poi_cout IS NULL) AS non_valorises
FROM poi_pointage p
WHERE p.poi_couche = CASE WHEN EXISTS (SELECT 1 FROM poi_semaine s WHERE s.psm_sal_id = p.poi_sal_id AND s.psm_lundi = date_trunc('week', p.poi_date)::date)
                          THEN 'VALIDE' ELSE 'SAISIE' END
GROUP BY p.poi_cha_id, date_trunc('month', p.poi_date)
UNION ALL
SELECT d.ent_chantier_id, date_trunc('month', m.mvt_date)::date, 'STOCK',
       round(-sum(m.mvt_quantite * coalesce(m.mvt_prix, m.mvt_pmp, 0)), 2), NULL, count(*) FILTER (WHERE coalesce(m.mvt_prix, m.mvt_pmp) IS NULL)
FROM stk_mouvement m
JOIN document d ON d.ent_id = m.mvt_ent_id
JOIN type_document t ON t.tyd_id = d.ent_tyd_id AND t.tyd_famille = 'S'
WHERE d.ent_chantier_id IS NOT NULL AND m.mvt_lieu_id <> d.ent_chantier_id
GROUP BY d.ent_chantier_id, date_trunc('month', m.mvt_date)
UNION ALL
SELECT d.ent_chantier_id, date_trunc('month', coalesce(d.ent_date_externe, d.ent_date))::date,
       CASE WHEN t.tyd_famille = 'T' THEN 'SOUS_TRAITANCE' ELSE 'ACHAT' END,
       round(sum(CASE WHEN t.tyd_code IN ('A_AVOIR', 'T_AVOIR') AND d.ent_nature_avoir IS DISTINCT FROM 'AVANCEMENT' THEN -d.ent_total_ht
                      ELSE d.ent_total_ht END), 2), NULL, 0
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
WHERE d.ent_verrouille AND d.ent_chantier_id IS NOT NULL
  AND t.tyd_code IN ('A_FACTURE', 'A_FACTURE_AVT', 'A_AVOIR', 'T_FACTURE_AVT', 'T_AVOIR')
GROUP BY d.ent_chantier_id, date_trunc('month', coalesce(d.ent_date_externe, d.ent_date)), CASE WHEN t.tyd_famille = 'T' THEN 'SOUS_TRAITANCE' ELSE 'ACHAT' END
UNION ALL
SELECT m.mat_cha_id, date_trunc('month', e.mev_date)::date, 'CARBURANT', round(sum(coalesce(e.mev_cout, 0)), 2), NULL, count(*) FILTER (WHERE e.mev_cout IS NULL)
FROM materiel_evenement e
JOIN materiel m ON m.mat_id = e.mev_mat_id
WHERE e.mev_type = 'CARBURANT' AND m.mat_cha_id IS NOT NULL
GROUP BY m.mat_cha_id, date_trunc('month', e.mev_date);

COMMENT ON VIEW v_cout_chantier IS 'Coûts d''un chantier par mois et nature (MO, STOCK, ACHAT, SOUS_TRAITANCE, CARBURANT) : chantier de suivi du matériel (lots 5c-1, 5c-2)';
