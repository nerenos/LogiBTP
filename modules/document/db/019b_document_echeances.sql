-- =============================================================================
-- Module Document – conditions de paiement et échéancier des pièces (CONCEPTION-MARCHES-REGLEMENTS.md, Q19 à Q22).
-- Condition : lignes { pct, delai, base NET | FIN_MOIS | JOUR, jour, mode } (règle : echeances.js ↔ Echeances.cs).
-- Choix : condition du document, sinon celle du tiers (spécialisation), sinon la condition par défaut (ventes / achats).
-- Échéancier écrit à la validation des pièces à numérotation continue (factures, avoirs) ; retenue de garantie (poste
-- de pied lig_pied_retenue) : échéance RETENUE sans date, datée à la libération.
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS condition_paiement (
    cpa_code     VARCHAR(20)   PRIMARY KEY,
    cpa_libelle  VARCHAR(100)  NOT NULL,
    cpa_lignes   JSONB         NOT NULL DEFAULT '[]',
    cpa_ordre    SMALLINT      NOT NULL DEFAULT 0,
    cpa_actif    BOOLEAN       NOT NULL DEFAULT true
);

-- Mêmes codes que le délai de paiement des tiers (per_delai_paiement de l'annuaire).
INSERT INTO condition_paiement (cpa_code, cpa_libelle, cpa_lignes, cpa_ordre) VALUES
 ('COMPTANT', 'Comptant',               '[]', 1),
 ('30J',      '30 jours',               '[{"pct":100,"delai":30,"base":"NET"}]', 2),
 ('30JFM',    '30 jours fin de mois',   '[{"pct":100,"delai":30,"base":"FIN_MOIS"}]', 3),
 ('45JFM',    '45 jours fin de mois',   '[{"pct":100,"delai":45,"base":"FIN_MOIS"}]', 4),
 ('60J',      '60 jours',               '[{"pct":100,"delai":60,"base":"NET"}]', 5),
 ('30_70',    '30 % comptant, 70 % à 30 jours', '[{"pct":30,"delai":0,"base":"NET"},{"pct":70,"delai":30,"base":"NET"}]', 6)
ON CONFLICT (cpa_code) DO NOTHING;

INSERT INTO parametre_document (pdo_cle, pdo_valeur) VALUES
 ('conditions_paiement', '{"vente":"30J","achat":"30JFM"}')
ON CONFLICT (pdo_cle) DO NOTHING;

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_cpa_code VARCHAR(20) REFERENCES condition_paiement (cpa_code);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_mode_reglement VARCHAR(20);
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_pied_retenue BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS document_echeance (
    ech_id       BIGSERIAL     PRIMARY KEY,
    ech_ent_id   BIGINT        NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    ech_rang     SMALLINT      NOT NULL,
    ech_date     DATE,
    ech_montant  NUMERIC(18,6) NOT NULL,
    ech_mode     VARCHAR(20),
    ech_nature   VARCHAR(10)   NOT NULL DEFAULT 'NORMALE' CHECK (ech_nature IN ('NORMALE','RETENUE')),
    ech_manuel   BOOLEAN       NOT NULL DEFAULT false,
    UNIQUE (ech_ent_id, ech_rang)
);
