-- =============================================================================
-- Module Document – solde des lignes transformées (CONCEPTION-ACHATS-MARCHES.md, Q7 et Q8).
-- Une ligne d'un document issu d'une transformation (BL, facture…) peut solder la ligne de son parent : case
-- lig_solde, ou automatiquement quand le reste passe sous un seuil (en % de la quantité du parent ou en quantité,
-- par famille achats / ventes). Le solde est écrit à la validation dans document_ligne_solde, rattaché à la ligne
-- qui l'a demandé (lso_cible_lig_id) : il disparaît avec elle.
-- Rejouable (IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- =============================================================================

ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_solde BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE document_ligne_solde ADD COLUMN IF NOT EXISTS lso_cible_lig_id BIGINT
    REFERENCES document_ligne(lig_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_lso_cible ON document_ligne_solde (lso_cible_lig_id);

-- Paramètres globaux du module (clé → valeur JSON).
CREATE TABLE IF NOT EXISTS parametre_document (
    pdo_cle     VARCHAR(50)   PRIMARY KEY,
    pdo_valeur  JSONB         NOT NULL
);
-- Seuils de solde automatique : soldée si reste ≤ qte, ou reste ≤ quantité du parent × pct / 100 (0 : tout livré).
INSERT INTO parametre_document (pdo_cle, pdo_valeur) VALUES
 ('seuils_solde', '{"achat":{"pct":0,"qte":0},"vente":{"pct":0,"qte":0}}')
ON CONFLICT (pdo_cle) DO NOTHING;
