-- Révision et actualisation des prix des marchés par index (CONCEPTION-REVISION-PRIX.md, décisions du 31/10/2026,
-- lot G1) : index (catalogue BT livré, valeurs mensuelles provisoires puis définitives saisies ou importées, historique
-- des corrections, raccordement d'une ancienne base), modèles de formules, paramètres du marché (type de prix, mois zéro,
-- formule, décalage, arrondi, début des travaux, actualisation à la baisse), mois zéro propre d'une commande du marché,
-- mois de révision d'une pièce, détail de la révision figé à la validation (une ligne par période révisée).
-- Lignes des pièces : postes de pied HT système repérés par lig_proprietes.poste_marche = V<commande> (révision de la
-- période, mode C coefficient sur le total HT de la section) et VR<commande> (régularisation des périodes précédentes,
-- montant ; ligne d'élément dans une facture simple de régularisation). Rejouable.

CREATE TABLE IF NOT EXISTS index_prix (
    ipx_id           SERIAL        PRIMARY KEY,
    ipx_code         VARCHAR(20)   NOT NULL UNIQUE,
    ipx_libelle      VARCHAR(150)  NOT NULL,
    ipx_base         VARCHAR(10),                     -- base courante de la série (2010…)
    ipx_serie_insee  VARCHAR(20),                     -- identifiant de la série à l'INSEE (information)
    ipx_actif        BOOLEAN       NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE index_prix IS 'Index de révision des prix (BT01…) : catalogue livré, modifiable';

-- Raccordement : valeur d'une ancienne base × coefficient = valeur dans la base courante.
CREATE TABLE IF NOT EXISTS index_raccordement (
    ira_ipx_id       INT           NOT NULL REFERENCES index_prix(ipx_id) ON DELETE CASCADE,
    ira_base         VARCHAR(10)   NOT NULL,
    ira_coefficient  NUMERIC(18,10) NOT NULL CHECK (ira_coefficient > 0),
    PRIMARY KEY (ira_ipx_id, ira_base)
);

CREATE TABLE IF NOT EXISTS index_valeur (
    ixv_ipx_id       INT           NOT NULL REFERENCES index_prix(ipx_id) ON DELETE CASCADE,
    ixv_mois         DATE          NOT NULL CHECK (ixv_mois = date_trunc('month', ixv_mois)::date),
    ixv_valeur       NUMERIC(14,4) NOT NULL CHECK (ixv_valeur > 0),
    ixv_provisoire   BOOLEAN       NOT NULL DEFAULT FALSE,
    ixv_base         VARCHAR(10),                     -- base de la valeur (vide : base courante)
    ixv_source       VARCHAR(10)   NOT NULL DEFAULT 'SAISIE' CHECK (ixv_source IN ('SAISIE', 'IMPORT')),
    ixv_maj_par      VARCHAR(100),
    ixv_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (ixv_ipx_id, ixv_mois)
);
COMMENT ON TABLE index_valeur IS 'Valeur mensuelle d''un index : provisoire puis définitive (corrections tracées dans index_valeur_historique)';

CREATE TABLE IF NOT EXISTS index_valeur_historique (
    ixh_id           BIGSERIAL     PRIMARY KEY,
    ixh_ipx_id       INT           NOT NULL,
    ixh_mois         DATE          NOT NULL,
    ixh_valeur       NUMERIC(14,4),
    ixh_provisoire   BOOLEAN,
    ixh_base         VARCHAR(10),
    ixh_source       VARCHAR(10),
    ixh_maj_par      VARCHAR(100),
    ixh_maj_le       TIMESTAMPTZ,
    ixh_remplace_le  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION f_index_valeur_historique() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR (OLD.ixv_valeur, OLD.ixv_provisoire, OLD.ixv_base) IS DISTINCT FROM (NEW.ixv_valeur, NEW.ixv_provisoire, NEW.ixv_base) THEN
        INSERT INTO index_valeur_historique (ixh_ipx_id, ixh_mois, ixh_valeur, ixh_provisoire, ixh_base, ixh_source, ixh_maj_par, ixh_maj_le)
        VALUES (OLD.ixv_ipx_id, OLD.ixv_mois, OLD.ixv_valeur, OLD.ixv_provisoire, OLD.ixv_base, OLD.ixv_source, OLD.ixv_maj_par, OLD.ixv_maj_le);
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS tr_index_valeur_historique ON index_valeur;
CREATE TRIGGER tr_index_valeur_historique BEFORE UPDATE OR DELETE ON index_valeur FOR EACH ROW EXECUTE FUNCTION f_index_valeur_historique();

-- Modèles de formules (recopiés dans le marché) : Cn = partie fixe + Σ poids × In / I0.
CREATE TABLE IF NOT EXISTS formule_revision (
    frv_id           SERIAL        PRIMARY KEY,
    frv_libelle      VARCHAR(150)  NOT NULL,
    frv_partie_fixe  NUMERIC(8,6)  NOT NULL DEFAULT 0.15,
    frv_termes       JSONB         NOT NULL DEFAULT '[]',     -- [{ index, poids }]
    frv_precision    SMALLINT      NOT NULL DEFAULT 3,
    frv_arrondi      VARCHAR(10)   NOT NULL DEFAULT 'PROCHE' CHECK (frv_arrondi IN ('PROCHE', 'SUPERIEUR')),
    frv_actif        BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Paramètres de révision d'un marché (une ligne par marché ; absente : prix ferme).
CREATE TABLE IF NOT EXISTS marche_revision (
    mre_mar_id       INT           PRIMARY KEY REFERENCES marche(mar_id) ON DELETE CASCADE,
    mre_type_prix    VARCHAR(12)   NOT NULL DEFAULT 'FERME' CHECK (mre_type_prix IN ('FERME', 'ACTUALISABLE', 'REVISABLE')),
    mre_mois_zero    DATE          CHECK (mre_mois_zero = date_trunc('month', mre_mois_zero)::date),
    mre_partie_fixe  NUMERIC(8,6)  NOT NULL DEFAULT 0.15,
    mre_termes       JSONB         NOT NULL DEFAULT '[]',
    mre_decalage     SMALLINT      NOT NULL DEFAULT 0 CHECK (mre_decalage BETWEEN 0 AND 12),
    mre_precision    SMALLINT      NOT NULL DEFAULT 3 CHECK (mre_precision BETWEEN 0 AND 6),
    mre_arrondi      VARCHAR(10)   NOT NULL DEFAULT 'PROCHE' CHECK (mre_arrondi IN ('PROCHE', 'SUPERIEUR')),
    mre_debut_travaux DATE,                              -- actualisation : vide = début réel, sinon prévu, du chantier
    mre_baisse       BOOLEAN       NOT NULL DEFAULT FALSE, -- actualisation appliquée aussi à la baisse
    mre_maj_par      VARCHAR(100),
    mre_maj_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE marche_revision IS 'Révision ou actualisation des prix d''un marché (CONCEPTION-REVISION-PRIX.md Q1, Q2, Q11)';

-- Mois zéro propre d'une commande du marché (prix nouveaux établis plus tard, Q3) ; vide : celui du marché.
ALTER TABLE marche_document ADD COLUMN IF NOT EXISTS mdo_mois_zero DATE CHECK (mdo_mois_zero = date_trunc('month', mdo_mois_zero)::date);

-- Mois des travaux d'une pièce (Q8) ; vide : mois de la date de la pièce.
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_mois_revision DATE CHECK (ent_mois_revision = date_trunc('month', ent_mois_revision)::date);

-- Détail de la révision d'une pièce validée (Q9) : une ligne par période révisée (la période de la pièce elle-même et les
-- périodes précédentes régularisées), par commande du marché.
CREATE TABLE IF NOT EXISTS document_revision (
    dre_id               BIGSERIAL     PRIMARY KEY,
    dre_ent_id           BIGINT        NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    dre_periode_ent_id   BIGINT        NOT NULL,          -- pièce d'avancement de la période révisée
    dre_commande_ent_id  BIGINT        NOT NULL,          -- commande du marché
    dre_mois_index       DATE,
    dre_base             NUMERIC(18,6) NOT NULL,          -- montant HT de la période pour la commande
    dre_coef             NUMERIC(12,6),                   -- coefficient connu à la validation (vide : index manquant)
    dre_provisoire       BOOLEAN       NOT NULL DEFAULT FALSE,
    dre_revision         NUMERIC(18,6) NOT NULL DEFAULT 0, -- révision due à la validation
    dre_montant          NUMERIC(18,6) NOT NULL DEFAULT 0  -- facturé par cette pièce
);
CREATE INDEX IF NOT EXISTS ix_dre_periode ON document_revision (dre_periode_ent_id, dre_commande_ent_id);
CREATE INDEX IF NOT EXISTS ix_dre_ent ON document_revision (dre_ent_id);

-- Catalogue des index BT (base 2010) : libellés modifiables dans /parametres/revision.
INSERT INTO index_prix (ipx_code, ipx_libelle, ipx_base) VALUES
    ('BT01', 'Tous corps d''état', '2010'),
    ('BT02', 'Terrassements', '2010'),
    ('BT03', 'Maçonnerie et canalisations en béton', '2010'),
    ('BT06', 'Ossature et ouvrages en béton armé', '2010'),
    ('BT07', 'Ossature et charpentes métalliques', '2010'),
    ('BT08', 'Plâtre et préfabriqués', '2010'),
    ('BT09', 'Carrelage et revêtement céramique', '2010'),
    ('BT16b', 'Charpente en bois', '2010'),
    ('BT18a', 'Menuiserie intérieure', '2010'),
    ('BT19b', 'Menuiserie extérieure', '2010'),
    ('BT30', 'Couverture en ardoises', '2010'),
    ('BT32', 'Couverture en tuiles de terre cuite', '2010'),
    ('BT38', 'Plomberie sanitaire', '2010'),
    ('BT40', 'Chauffage central', '2010'),
    ('BT41', 'Ventilation et conditionnement d''air', '2010'),
    ('BT42', 'Menuiserie en acier et serrurerie', '2010'),
    ('BT43', 'Menuiserie en alliage d''aluminium', '2010'),
    ('BT45', 'Vitrerie et miroiterie', '2010'),
    ('BT46', 'Peinture, tenture, revêtements muraux', '2010'),
    ('BT47', 'Électricité', '2010'),
    ('BT48', 'Ascenseurs', '2010'),
    ('BT50', 'Rénovation et entretien tous corps d''état', '2010'),
    ('BT53', 'Étanchéité', '2010')
ON CONFLICT (ipx_code) DO NOTHING;

INSERT INTO formule_revision (frv_libelle, frv_partie_fixe, frv_termes)
SELECT 'Tous corps d''état : 0,15 + 0,85 × BT01', 0.15, '[{"index": "BT01", "poids": 0.85}]'
WHERE NOT EXISTS (SELECT 1 FROM formule_revision);
