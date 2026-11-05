-- Pièce comptable des inventaires du stock (rejouable) : à la validation d'un lot d'inventaire, le cœur crée une pièce
-- S_INVENTAIRE validée des écarts valorisés (Btp/InventaireComptableBtp.cs : une ligne par article, quantité = écart,
-- prix = valeur unitaire à la date du lot ; réévaluation « Appliquer au PMP » en ligne à part), exportée par le module
-- Comptabilité en opération diverse : compte de stock (clés de ventilation du type STOCK par nature, sinon compte par
-- défaut) au débit d'un boni, au crédit d'un mali, contrepartie en variation des stocks (tco_cpt_contrepartie).
-- Annulation du lot : pièce annulée si elle n'est pas transférée, sinon contre-passée par une seconde pièce.

INSERT INTO compte_comptable (cpt_code, cpt_libelle, cpt_type, cpt_sens) VALUES
 ('310000', 'Stocks de matières premières et fournitures', 'GENERAL', 'LES_DEUX'),
 ('321000', 'Stocks de matières consommables', 'GENERAL', 'LES_DEUX'),
 ('370000', 'Stocks de marchandises', 'GENERAL', 'LES_DEUX'),
 ('603100', 'Variation des stocks de matières premières et fournitures', 'GENERAL', 'LES_DEUX'),
 ('603200', 'Variation des stocks des autres approvisionnements', 'GENERAL', 'LES_DEUX'),
 ('603700', 'Variation des stocks de marchandises', 'GENERAL', 'LES_DEUX')
ON CONFLICT (cpt_code) DO NOTHING;

INSERT INTO type_comptable (tco_code, tco_libelle, tco_parent, tco_sens, tco_journal, tco_journal_libelle, tco_cpt_defaut, tco_cpt_contrepartie,
                            tco_cpt_ecart_debit, tco_cpt_ecart_credit, tco_ordre) VALUES
 ('STOCK', 'Stock (écarts d''inventaire)', NULL, 'ACHAT', 'OD', 'Opérations diverses', '321000', '603200', '658000', '758000', 40)
ON CONFLICT (tco_code) DO NOTHING;

UPDATE type_document SET tyd_tco_code = 'STOCK' WHERE tyd_code = 'S_INVENTAIRE' AND tyd_tco_code IS NULL;
UPDATE type_document SET tyd_libelle = 'Écarts d''inventaire' WHERE tyd_code = 'S_INVENTAIRE' AND tyd_libelle = 'Bordereau d''inventaire';

ALTER TABLE stk_lot_inventaire DROP CONSTRAINT IF EXISTS fk_lin_document;
ALTER TABLE stk_lot_inventaire ADD CONSTRAINT fk_lin_document FOREIGN KEY (lin_ent_id) REFERENCES document(ent_id) ON DELETE SET NULL;
ALTER TABLE stk_lot_inventaire DROP CONSTRAINT IF EXISTS fk_lin_extourne;
ALTER TABLE stk_lot_inventaire ADD CONSTRAINT fk_lin_extourne FOREIGN KEY (lin_extourne_ent_id) REFERENCES document(ent_id) ON DELETE SET NULL;
