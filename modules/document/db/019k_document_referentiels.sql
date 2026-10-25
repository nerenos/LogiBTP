-- =============================================================================
-- Module Document – référentiels paramétrables (analyse des demandes du 25/10/2026, lot 2). Rejouable.
--   mode_reglement : modes de règlement (entête des pièces, tiers, échéances, règlements), à la place de la liste
--                    en dur MODES_REGLEMENT (mêmes codes).
--   unite.unt_synonymes : écritures reconnues d'une unité (M² = M2, m2, m²…) à la saisie et à l'import.
--   type_document.tyd_format_numero : format du numéro légal ({P} préfixe, {AAAA} ou {AA} exercice, {MM} mois,
--                    {N:5} rang sur 5 chiffres ; vide : {P}{AAAA}-{N:5}) ; tyd_raz_numero : rang remis à zéro chaque
--                    exercice (A) ou jamais (J : compteur unique d'exercice 0).
-- =============================================================================

CREATE TABLE IF NOT EXISTS mode_reglement (
    mre_code     VARCHAR(20)   PRIMARY KEY,
    mre_libelle  VARCHAR(80)   NOT NULL,
    mre_ordre    SMALLINT      NOT NULL DEFAULT 0,
    mre_actif    BOOLEAN       NOT NULL DEFAULT TRUE
);
INSERT INTO mode_reglement (mre_code, mre_libelle, mre_ordre) VALUES
 ('VIREMENT', 'Virement', 1), ('PRELEVEMENT', 'Prélèvement', 2), ('CHEQUE', 'Chèque', 3), ('LCR', 'LCR', 4),
 ('CB', 'Carte bancaire', 5), ('ESPECES', 'Espèces', 6)
ON CONFLICT (mre_code) DO NOTHING;

ALTER TABLE unite ADD COLUMN IF NOT EXISTS unt_synonymes TEXT[] NOT NULL DEFAULT '{}';
-- Synonymes de départ (repris de l'import OptimBTP), seulement là où rien n'est saisi.
UPDATE unite u SET unt_synonymes = s.syn
FROM (VALUES ('m2', ARRAY['m²', 'M2', 'mcarre', 'mq']), ('m3', ARRAY['m³', 'M3', 'mcube']), ('ml', ARRAY['mlin', 'metre lineaire']),
             ('u', ARRAY['unite', 'un', 'p', 'piece']), ('ft', ARRAY['forfait', 'ff', 'fft', 'forf']), ('ens', ARRAY['ensemble']),
             ('h', ARRAY['heure', 'hr']), ('j', ARRAY['jour', 'jr']), ('t', ARRAY['tonne', 'tn']), ('kg', ARRAY['kilo']),
             ('l', ARRAY['litre', 'lt']), ('pce', ARRAY['pc', 'pcs']), ('sem', ARRAY['semaine']), ('mois', ARRAY['ms'])) AS s(code, syn)
WHERE u.unt_code = s.code AND u.unt_synonymes = '{}';

ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_format_numero VARCHAR(40);
ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_raz_numero CHAR(1) NOT NULL DEFAULT 'A';
ALTER TABLE type_document DROP CONSTRAINT IF EXISTS ck_tyd_raz_numero;
ALTER TABLE type_document ADD CONSTRAINT ck_tyd_raz_numero CHECK (tyd_raz_numero IN ('A', 'J'));
