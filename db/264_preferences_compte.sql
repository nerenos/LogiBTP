-- Préférences d'un compte gardées en base (rejouable) : réglages qui suivent l'utilisateur d'un poste à l'autre, à la
-- différence des préférences d'affichage du navigateur (localStorage). Première clé : « accueil » (raccourcis et
-- widgets de la page d'accueil). Une valeur JSON par compte et par clé, lue et écrite par le seul compte connecté
-- (routes /api/preferences, Btp/PreferencesCompte.cs).
-- Le compte est désigné par son code en minuscules (comme l'index ux_cpt_code de la table compte) : les comptes de
-- test du développement et le mode EnTetes n'ont pas toujours de ligne dans « compte ».

CREATE TABLE IF NOT EXISTS preference_compte (
    prc_compte   VARCHAR(50)   NOT NULL,
    prc_cle      VARCHAR(60)   NOT NULL,
    prc_valeur   JSONB         NOT NULL,
    prc_maj_le   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_preference_compte PRIMARY KEY (prc_compte, prc_cle),
    CONSTRAINT ck_prc_compte CHECK (prc_compte = lower(prc_compte))
);

COMMENT ON TABLE preference_compte IS 'Préférences d''un compte qui le suivent d''un poste à l''autre (accueil : raccourcis et widgets)';
