-- =============================================================================
-- Cœur – calendriers des services et des ressources (module Calendrier, modules/calendrier/db/006 ; Planning P12, P13,
-- P22 ; ANALYSE-MODULES-TRANSVERSE.md § 4.3) : calendrier d'un service, surchargé par salarié ou par matériel ; à défaut,
-- le calendrier par défaut. Fermetures propres à un service : jours fermés de portée « service:<srv_id> » (fermeture de démonstration de
-- l'atelier : 196b_calendriers_demo.sql). Rejouable.
-- =============================================================================

ALTER TABLE service ADD COLUMN IF NOT EXISTS srv_cal_id INT REFERENCES calendrier(cal_id) ON DELETE SET NULL;
ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_cal_id INT REFERENCES calendrier(cal_id) ON DELETE SET NULL;
ALTER TABLE materiel ADD COLUMN IF NOT EXISTS mat_cal_id INT REFERENCES calendrier(cal_id) ON DELETE SET NULL;

-- Démonstration : bureaux en 35 h, chantier et atelier en 39 h (une fois : services sans calendrier).
UPDATE service s SET srv_cal_id = c.cal_id
FROM calendrier c
WHERE s.srv_cal_id IS NULL
  AND c.cal_code = CASE WHEN s.srv_nature IN ('ADMINISTRATIF', 'ETUDE') THEN 'BUREAU' ELSE 'STANDARD' END;
