-- =============================================================================
-- Cœur LogiBTP – module Comptabilité, décisions du 31/10/2026 (TODO, Comptabilité) :
--  * clés de ventilation par identifiant (module `094d`) : codes de nature et de taux convertis en identifiants
--    (`nature_element.nat_id`, `taux_tva.ttv_id`), clés orphelines retirées, colonnes de code supprimées ; clé
--    étrangère, contrainte « nature ou taux » et unicité sur les identifiants ;
--  * comptes des natures (`nat_compte_vente`, `nat_compte_achat`) retirés : repris en clés « nature » par `db/224`, la
--    ventilation est le seul endroit (C7) ;
--  * compte de produit ou de charge du tiers, un par relation, distinct du compte auxiliaire (411 / 401) : client
--    (produit), fournisseur (charge), sous-traitant (charge ; vide : celui du fournisseur) ; règle du compte d'une
--    ligne : ligne > tiers > clés > défaut du type (`ventilation.js` ↔ `ReglesVentilation.cs`) ;
--  * genre des postes de pied de démonstration (module Bibliothèque `066`).
-- Rejouable.
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'ventilation_compte' AND column_name = 'vco_nature') THEN
        UPDATE ventilation_compte v SET vco_nat_id = n.nat_id
        FROM nature_element n WHERE v.vco_nat_id IS NULL AND v.vco_nature IS NOT NULL AND n.nat_code = v.vco_nature;
        UPDATE ventilation_compte v SET vco_ttv_id = t.ttv_id
        FROM taux_tva t WHERE v.vco_ttv_id IS NULL AND v.vco_taux IS NOT NULL AND t.ttv_code = v.vco_taux;
        -- Clé dont la nature ou le taux n'existe plus (code renommé avant cette conversion) : sans objet.
        DELETE FROM ventilation_compte
        WHERE (vco_nature IS NOT NULL AND vco_nat_id IS NULL) OR (vco_taux IS NOT NULL AND vco_ttv_id IS NULL);
        ALTER TABLE ventilation_compte DROP COLUMN vco_nature, DROP COLUMN vco_taux;
    END IF;
END $$;

DELETE FROM ventilation_compte WHERE vco_nat_id IS NULL AND vco_ttv_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vco_nature') THEN
        ALTER TABLE ventilation_compte ADD CONSTRAINT fk_vco_nature FOREIGN KEY (vco_nat_id) REFERENCES nature_element(nat_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vco_taux') THEN
        ALTER TABLE ventilation_compte ADD CONSTRAINT fk_vco_taux FOREIGN KEY (vco_ttv_id) REFERENCES taux_tva(ttv_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_vco_cle') THEN
        ALTER TABLE ventilation_compte ADD CONSTRAINT ck_vco_cle CHECK (vco_nat_id IS NOT NULL OR vco_ttv_id IS NOT NULL);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ventilation_compte_cle ON ventilation_compte (vco_tco_code, coalesce(vco_nat_id, 0), coalesce(vco_ttv_id, 0));

ALTER TABLE nature_element DROP COLUMN IF EXISTS nat_compte_vente;
ALTER TABLE nature_element DROP COLUMN IF EXISTS nat_compte_achat;

ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_cli_compte_produit VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fou_compte_charge  VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_st_compte_charge   VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;

UPDATE element SET ele_pied_genre = x.genre
FROM (VALUES ('RG5', 'RETENUE'), ('PRORATA', 'PRORATA'), ('REMISE5', 'REMISE'), ('FRAISDOS', 'AUTRE')) x(code, genre)
WHERE ele_type = 'POSTE_PIED' AND ele_code = x.code AND ele_pied_genre IS NULL;
