-- =============================================================================
-- Cœur LogiBTP – application de terrain (plan terrain-suites, lot 13 ; TS13 a, TS16 a) : heure de signature sur
-- l'appareil d'une réception gardée hors ligne, en plus de l'heure de réception par le serveur (sig_le, rec_cree_le),
-- les deux imprimées sur le PV. Réception signée en ligne : colonne vide (une seule heure). Rejouable.
-- =============================================================================

ALTER TABLE reception_pose ADD COLUMN IF NOT EXISTS rec_signee_appareil_le TIMESTAMPTZ;
COMMENT ON COLUMN reception_pose.rec_signee_appareil_le IS 'Heure de signature sur l''appareil (réception gardée hors ligne, envoyée plus tard) ; vide si signée en ligne';
