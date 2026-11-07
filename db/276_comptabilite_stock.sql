-- Cœur – écritures de fin d'exercice du stock, lot 9 du plan Stock (plans/stock.md ; ANALYSE-MODULE-STOCK.md Q9) : deux types
-- comptables à côté de STOCK (db/269), sans compte (à saisir dans Paramètres › Comptabilité) : STOCK_VARIATION (variation des
-- stocks, un compte par nature d'article en clés de ventilation) et STOCK_PROVISION (provision pour dépréciation par nature,
-- dotation et reprise sur le type). Le compte de stock par nature reste celui des clés du type STOCK. Rejouable.

INSERT INTO type_comptable (tco_code, tco_libelle, tco_parent, tco_sens, tco_journal, tco_journal_libelle, tco_ordre) VALUES
 ('STOCK_VARIATION', 'Stock (variation de fin d''exercice)', NULL, 'ACHAT', 'OD', 'Opérations diverses', 41),
 ('STOCK_PROVISION', 'Stock (dépréciation)', NULL, 'ACHAT', 'OD', 'Opérations diverses', 42)
ON CONFLICT (tco_code) DO NOTHING;
