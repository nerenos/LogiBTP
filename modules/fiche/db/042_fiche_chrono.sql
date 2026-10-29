-- =============================================================================
-- Module Fiche – chrono des codes (rejouable) : format paramétré par type de fiche (et par variante : sens d'un
-- marché…), compteur par exercice et par portée (bibliothèque d'un élément…), droit de modifier le code d'une fiche
-- déjà créée (MODIFIER_CODE). Le format par défaut est celui de la définition du type (tyf_definition.chrono).
-- =============================================================================

-- Format paramétré (Paramètres › Référentiels communs) ; sans ligne : celui de la définition du type.
CREATE TABLE IF NOT EXISTS chrono_fiche (
    chf_type      VARCHAR(50)  NOT NULL REFERENCES type_fiche(tyf_code) ON DELETE CASCADE,
    chf_variante  VARCHAR(30)  NOT NULL DEFAULT '',                   -- valeur du champ de variante ('' : toutes)
    chf_prefixe   VARCHAR(10),
    chf_format    VARCHAR(40),                                        -- {P}, {AAAA}, {AA}, {N}, {N:k}, {PARENT}
    chf_raz       CHAR(1)      NOT NULL DEFAULT 'J' CHECK (chf_raz IN ('A','J')),  -- remise à zéro : A chaque exercice, J jamais
    PRIMARY KEY (chf_type, chf_variante)
);

-- Dernier rang attribué (incrément dans la transaction de la création, pas de SEQUENCE) ; exercice 0 : jamais remis à zéro.
CREATE TABLE IF NOT EXISTS compteur_fiche (
    cpf_type      VARCHAR(50)  NOT NULL REFERENCES type_fiche(tyf_code) ON DELETE CASCADE,
    cpf_variante  VARCHAR(30)  NOT NULL DEFAULT '',
    cpf_portee    VARCHAR(50)  NOT NULL DEFAULT '',                   -- valeur du champ de portée ('' : toute la base)
    cpf_exercice  INT          NOT NULL,
    cpf_dernier   INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (cpf_type, cpf_variante, cpf_portee, cpf_exercice)
);

ALTER TABLE droit_fiche DROP CONSTRAINT IF EXISTS droit_fiche_drf_action_check;
ALTER TABLE droit_fiche ADD CONSTRAINT droit_fiche_drf_action_check
    CHECK (drf_action IN ('VOIR','MODIFIER','DEBLOQUER','CONFIDENTIEL','SUPPRIMER','MODIFIER_CODE'));
