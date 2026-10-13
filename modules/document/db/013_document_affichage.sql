-- =============================================================================
-- Module Document – affichage de la saisie : étiquettes de lignes (couleur en début de ligne), couleurs des modes de
-- vente (seconde couleur, coupée en diagonale), modèles de saisie et vues de colonnes (globales ou par utilisateur,
-- par défaut par type et modèle de document, mode débogage).
-- =============================================================================

-- Étiquettes de lignes : liste globale ; un document peut en ajouter ou en personnaliser (document.ent_etiquettes).
CREATE TABLE etiquette_ligne (
    etl_code     VARCHAR(20)  PRIMARY KEY,
    etl_libelle  VARCHAR(60)  NOT NULL,
    etl_couleur  VARCHAR(9)   NOT NULL,                                  -- #rrggbb
    etl_ordre    INT          NOT NULL DEFAULT 0,
    etl_actif    BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO etiquette_ligne (etl_code, etl_libelle, etl_couleur, etl_ordre) VALUES
 ('A_CHIFFRER',    'À chiffrer',             '#ef4444', 10),
 ('A_VERIFIER',    'À vérifier',             '#f59e0b', 20),
 ('ATTENTE_PRIX',  'En attente de prix',     '#a855f7', 30),
 ('PRIX_CONFIRME', 'Prix confirmé',          '#22c55e', 40),
 ('VALIDE',        'Validé',                 '#2563eb', 50);

-- Seconde couleur du marqueur selon le mode de vente de la ligne (lig_type_prix) ; une ligne vendue n'en a pas.
CREATE TABLE couleur_type_prix (
    ctp_type     CHAR(1)      PRIMARY KEY CHECK (ctp_type IN ('O','M','A')),
    ctp_libelle  VARCHAR(40)  NOT NULL,
    ctp_couleur  VARCHAR(9)   NOT NULL
);

INSERT INTO couleur_type_prix (ctp_type, ctp_libelle, ctp_couleur) VALUES
 ('O', 'Option',        '#06b6d4'),
 ('M', 'Pour mémoire',  '#94a3b8'),
 ('A', 'Variante',      '#ec4899');

-- Modèles de saisie d'un document (document.ent_modele) : chacun peut avoir sa vue de colonnes par défaut.
CREATE TABLE modele_document (
    mod_code     VARCHAR(20)  PRIMARY KEY,
    mod_libelle  VARCHAR(60)  NOT NULL,
    mod_ordre    INT          NOT NULL DEFAULT 0,
    mod_actif    BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO modele_document (mod_code, mod_libelle, mod_ordre) VALUES
 ('COMPLET',   'Complet',              10),
 ('CHIFFRAGE', 'Chiffrage (déboursé)', 20),
 ('VOLEE',     'Document à la volée',  30);

-- Vues de colonnes de la grille des lignes : globales (vdo_proprietaire NULL) ou propres à un utilisateur ; une vue
-- globale peut être la vue par défaut d'un type et d'un modèle de document (NULL : tous). Définition :
-- { "colonnes": [{ "cle": "num" }, …] (ordre affiché), "debogage": false, "systeme": ["lig_id", …] (colonnes système
-- affichées en mode débogage) }.
CREATE TABLE vue_document (
    vdo_id            SERIAL       PRIMARY KEY,
    vdo_nom           VARCHAR(60)  NOT NULL,
    vdo_tyd_id        INT          REFERENCES type_document(tyd_id) ON DELETE CASCADE,
    vdo_mod_code      VARCHAR(20)  REFERENCES modele_document(mod_code) ON DELETE CASCADE,
    vdo_proprietaire  VARCHAR(50),
    vdo_par_defaut    BOOLEAN      NOT NULL DEFAULT FALSE,
    vdo_definition    JSONB        NOT NULL,
    vdo_modifie_le    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    vdo_modifie_par   VARCHAR(50)
);
CREATE UNIQUE INDEX ux_vdo_defaut ON vue_document (coalesce(vdo_tyd_id, 0), coalesce(vdo_mod_code, '')) WHERE vdo_par_defaut;
