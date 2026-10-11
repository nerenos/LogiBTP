-- =============================================================================
-- Module Bibliothèque – éléments (articles et ouvrages) : plusieurs bibliothèques, familles hiérarchiques, natures
-- (axe analytique, comptes, regroupement personnalisable), types de gestion, prix (PA, FG, PR, bénéfice, PV, remise
-- sur PV) avec scénarios de prix d'achat, multi-unité (unité de stock et conversions par formule sur des données
-- techniques), tarifs fournisseurs, historique des prix, composition des ouvrages (lignes et métrés).
-- Identification : ID interne unique, code unique dans sa bibliothèque (appel « BIB:CODE » hors de la bibliothèque).
-- =============================================================================

CREATE TABLE bibliotheque (
    bib_id       SERIAL        PRIMARY KEY,
    bib_code     VARCHAR(10)   NOT NULL UNIQUE,              -- préfixe d'appel (BIB:CODE)
    bib_libelle  VARCHAR(100)  NOT NULL,
    bib_defaut   BOOLEAN       NOT NULL DEFAULT FALSE,
    bib_actif    BOOLEAN       NOT NULL DEFAULT TRUE,
    bib_ordre    INT           NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_bib_defaut ON bibliotheque (bib_defaut) WHERE bib_defaut;

-- Familles : arborescence de profondeur libre, propre à chaque bibliothèque.
CREATE TABLE famille_element (
    fam_id         SERIAL        PRIMARY KEY,
    fam_bib_id     INT           NOT NULL REFERENCES bibliotheque(bib_id) ON DELETE CASCADE,
    fam_parent_id  INT           REFERENCES famille_element(fam_id) ON DELETE CASCADE,
    fam_code       VARCHAR(30)   NOT NULL,
    fam_libelle    VARCHAR(100)  NOT NULL,
    fam_ordre      INT           NOT NULL DEFAULT 0,
    UNIQUE (fam_bib_id, fam_code)
);

-- Regroupements de natures, personnalisables (main-d'œuvre, matériaux, engins, sous-traitance…).
CREATE TABLE regroupement_nature (
    rgn_code     VARCHAR(20)   PRIMARY KEY,
    rgn_libelle  VARCHAR(60)   NOT NULL,
    rgn_ordre    INT           NOT NULL DEFAULT 0
);
INSERT INTO regroupement_nature (rgn_code, rgn_libelle, rgn_ordre) VALUES
 ('MO', 'Main-d''œuvre', 10), ('MATERIAUX', 'Matériaux', 20), ('ENGIN', 'Engins', 30),
 ('SOUS_TRAITANCE', 'Sous-traitance', 40), ('PRESTATION', 'Prestations', 50), ('VENTE', 'Vente', 60);

-- Natures : axe analytique et comptes de rattachement (exploités par le futur module Comptabilité).
CREATE TABLE nature_element (
    nat_id              SERIAL        PRIMARY KEY,
    nat_code            VARCHAR(20)   NOT NULL UNIQUE,
    nat_libelle         VARCHAR(100)  NOT NULL,
    nat_rgn_code        VARCHAR(20)   REFERENCES regroupement_nature(rgn_code),
    nat_axe_analytique  VARCHAR(30),
    nat_compte_achat    VARCHAR(20),
    nat_compte_vente    VARCHAR(20),
    nat_actif           BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE element (
    ele_id               BIGSERIAL     PRIMARY KEY,
    ele_bib_id           INT           NOT NULL REFERENCES bibliotheque(bib_id),
    ele_code             VARCHAR(30)   NOT NULL,
    ele_type             VARCHAR(10)   NOT NULL DEFAULT 'ARTICLE' CHECK (ele_type IN ('ARTICLE','OUVRAGE')),
    ele_libelle_html     TEXT          NOT NULL,                 -- libellé mis en forme
    ele_libelle          TEXT,                                   -- libellé brut (recherche, listes)
    ele_fam_id           INT           REFERENCES famille_element(fam_id) ON DELETE SET NULL,
    ele_nat_id           INT           REFERENCES nature_element(nat_id) ON DELETE SET NULL,
    ele_gestion          VARCHAR(15)   NOT NULL DEFAULT 'NON_GERE' CHECK (ele_gestion IN ('STOCK','ACHAT','SOUS_TRAITANCE','NON_GERE')),
    -- Unités : unité de stock (valorisation, obligatoire), unités d'achat et de vente par défaut, conversions
    -- [{ unite, formule }] : quantité en unité de stock pour 1 unité (formule sur les données techniques, ex. 1000 / {{poids_ml}}).
    ele_unt_stock        VARCHAR(10)   NOT NULL,
    ele_unt_achat        VARCHAR(10),
    ele_unt_vente        VARCHAR(10),
    ele_unites           JSONB         NOT NULL DEFAULT '[]',
    -- Prix (par unité de stock, 6 décimales) : scénario de PA, PA fixe saisi, dernier PA et PMP (alimentés plus tard
    -- par les modules Achats et Stock), PA retenu, coefficients, PR, PV (fixe ou calculé), remise sur PV, PV net.
    ele_scenario_pa      VARCHAR(25)   NOT NULL DEFAULT 'FIXE',
    ele_scenarios        JSONB,                                  -- scénarios autorisés (null : tous)
    ele_pa_fixe          NUMERIC(18,6),
    ele_dernier_pa       NUMERIC(18,6),
    ele_pmp              NUMERIC(18,6),
    ele_pa               NUMERIC(18,6),
    ele_coef_fg          NUMERIC(12,6) NOT NULL DEFAULT 1,
    ele_pr               NUMERIC(18,6),
    ele_coef_benef       NUMERIC(12,6) NOT NULL DEFAULT 1,
    ele_pv               NUMERIC(18,6),
    ele_pv_fixe          BOOLEAN       NOT NULL DEFAULT FALSE,
    ele_coef_remise      NUMERIC(12,6) NOT NULL DEFAULT 1,
    ele_pv_net           NUMERIC(18,6),
    ele_composition      JSONB,                                  -- ouvrage : { mode, lignes, metres, metre_lignes, variables }
    ele_image_ged        BIGINT,                                 -- document image de la GED (module GED, sans clé étrangère)
    ele_proprietes       JSONB         NOT NULL DEFAULT '{}',    -- champs supplémentaires (données techniques)
    ele_actif            BOOLEAN       NOT NULL DEFAULT TRUE,
    ele_commentaire_prix TEXT,                                   -- commentaire de la modification de prix (vidé par le trigger)
    ele_maj_par          VARCHAR(50),
    ele_cree_le          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ele_modifie_le       TIMESTAMPTZ,
    UNIQUE (ele_bib_id, ele_code)
);
CREATE INDEX ix_ele_famille ON element (ele_fam_id);

-- Tarifs fournisseurs : plusieurs par article, d'un ou plusieurs fournisseurs (géré plus finement plus tard).
CREATE TABLE tarif_fournisseur (
    tfo_id          BIGSERIAL     PRIMARY KEY,
    tfo_ele_id      BIGINT        NOT NULL REFERENCES element(ele_id) ON DELETE CASCADE,
    tfo_fournisseur VARCHAR(100)  NOT NULL,
    tfo_tiers_id    BIGINT,                                      -- futur lien vers les tiers
    tfo_reference   VARCHAR(60),
    tfo_libelle     VARCHAR(200),
    tfo_unt_code    VARCHAR(10)   NOT NULL,
    tfo_prix        NUMERIC(18,6) NOT NULL CHECK (tfo_prix >= 0),
    tfo_debut       DATE,
    tfo_fin         DATE,
    tfo_principal   BOOLEAN       NOT NULL DEFAULT FALSE,
    tfo_lien        VARCHAR(500),
    tfo_maj_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    tfo_maj_par     VARCHAR(50)
);
CREATE INDEX ix_tfo_element ON tarif_fournisseur (tfo_ele_id);
CREATE UNIQUE INDEX ux_tfo_principal ON tarif_fournisseur (tfo_ele_id) WHERE tfo_principal;

-- Historique des prix : chaque changement de PA, PR, PV, coefficient, remise ou scénario, daté, avec auteur et commentaire.
CREATE TABLE historique_prix_element (
    hpe_id          BIGSERIAL     PRIMARY KEY,
    hpe_ele_id      BIGINT        NOT NULL REFERENCES element(ele_id) ON DELETE CASCADE,
    hpe_date        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    hpe_auteur      VARCHAR(50),
    hpe_commentaire TEXT,
    hpe_avant       JSONB,
    hpe_apres       JSONB         NOT NULL
);
CREATE INDEX ix_hpe_element ON historique_prix_element (hpe_ele_id, hpe_date DESC);

CREATE FUNCTION fn_prix_element(e element) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('scenario', e.ele_scenario_pa, 'pa', e.ele_pa, 'coef_fg', e.ele_coef_fg, 'pr', e.ele_pr,
        'coef_benef', e.ele_coef_benef, 'pv', e.ele_pv, 'pv_fixe', e.ele_pv_fixe, 'coef_remise', e.ele_coef_remise, 'pv_net', e.ele_pv_net)
$$;

-- Modification : historique si un prix change, commentaire consommé (il ne vaut que pour cette modification).
CREATE FUNCTION fn_historique_prix_maj() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF fn_prix_element(NEW) IS DISTINCT FROM fn_prix_element(OLD) THEN
        INSERT INTO historique_prix_element (hpe_ele_id, hpe_auteur, hpe_commentaire, hpe_avant, hpe_apres)
        VALUES (NEW.ele_id, NEW.ele_maj_par, NEW.ele_commentaire_prix, fn_prix_element(OLD), fn_prix_element(NEW));
    END IF;
    NEW.ele_commentaire_prix := NULL;
    -- Mise à jour faite par le trigger de création (commentaire consommé) : pas une modification.
    IF pg_trigger_depth() = 1 THEN NEW.ele_modifie_le := now(); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tr_historique_prix_maj BEFORE UPDATE ON element FOR EACH ROW EXECUTE FUNCTION fn_historique_prix_maj();

-- Création : premier état des prix.
CREATE FUNCTION fn_historique_prix_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO historique_prix_element (hpe_ele_id, hpe_auteur, hpe_commentaire, hpe_avant, hpe_apres)
    VALUES (NEW.ele_id, NEW.ele_maj_par, coalesce(NEW.ele_commentaire_prix, 'Création'), NULL, fn_prix_element(NEW));
    UPDATE element SET ele_commentaire_prix = NULL WHERE ele_id = NEW.ele_id AND ele_commentaire_prix IS NOT NULL;
    RETURN NULL;
END $$;
CREATE TRIGGER tr_historique_prix_creation AFTER INSERT ON element FOR EACH ROW EXECUTE FUNCTION fn_historique_prix_creation();

-- Paramètres : scénario de PA par défaut à la création, scénarios autorisés par défaut, coefficients par défaut.
CREATE TABLE parametre_bibliotheque (
    pbi_cle     VARCHAR(50)   PRIMARY KEY,
    pbi_valeur  JSONB         NOT NULL
);
INSERT INTO parametre_bibliotheque (pbi_cle, pbi_valeur) VALUES
 ('scenario_defaut', '"FIXE"'),
 ('scenarios_autorises', '["FIXE","FOURNISSEUR_PRINCIPAL","DERNIER_PA","MEILLEUR_MIN","MEILLEUR_MAX","PMP"]'),
 ('coef_fg_defaut', '1.1'),
 ('coef_benef_defaut', '1.2');

-- Familles avec leur chemin complet (« Gros œuvre › Béton › Armatures »), pour les listes et les sélecteurs.
CREATE VIEW v_famille_element AS
WITH RECURSIVE arbre AS (
    SELECT fam_id, fam_bib_id, fam_parent_id, fam_code, fam_libelle, fam_ordre, fam_libelle::text AS chemin, 1 AS niveau
    FROM famille_element WHERE fam_parent_id IS NULL
    UNION ALL
    SELECT f.fam_id, f.fam_bib_id, f.fam_parent_id, f.fam_code, f.fam_libelle, f.fam_ordre, a.chemin || ' › ' || f.fam_libelle, a.niveau + 1
    FROM famille_element f JOIN arbre a ON f.fam_parent_id = a.fam_id
)
SELECT * FROM arbre;
