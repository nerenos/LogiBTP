-- =============================================================================
-- Module Comptabilité (base, lot 2 ; décision du 31/10/2026) : clés de ventilation enregistrées par l'identifiant de la
-- nature et du taux de TVA fournis par l'application (`vco_nat_id`, `vco_ttv_id`), saisies et affichées par leur code :
-- un code renommé ne laisse plus de clé orpheline. Les anciennes colonnes de code (`vco_nature`, `vco_taux`) sont
-- converties puis retirées par l'application, qui connaît les natures et les taux (cœur : `db/247`), ainsi que la
-- contrainte « nature ou taux » et l'unicité sur les nouvelles colonnes. Rejouable.
-- =============================================================================

ALTER TABLE ventilation_compte ADD COLUMN IF NOT EXISTS vco_nat_id INT;
ALTER TABLE ventilation_compte ADD COLUMN IF NOT EXISTS vco_ttv_id INT;

-- Contrainte et unicité sur les codes : remplacées après la conversion (une clé saisie par identifiant n'a plus de code).
ALTER TABLE ventilation_compte DROP CONSTRAINT IF EXISTS ventilation_compte_check;
DROP INDEX IF EXISTS ux_ventilation_compte;
