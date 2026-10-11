-- =============================================================================
-- Module Document – verrou de modification d'un document.
-- Posé à l'ouverture du document par un utilisateur qui peut le modifier, levé à sa fermeture. Contrairement aux
-- fiches, il n'expire pas : un document resté ouvert (perte de connexion, navigateur fermé) reste bloqué et seul un
-- déverrouillage manuel (administrateur) le libère. Le même utilisateur reprend son propre verrou sans avertissement.
-- =============================================================================

CREATE TABLE verrou_document (
    vdo_ent_id       BIGINT       PRIMARY KEY REFERENCES document(ent_id) ON DELETE CASCADE,
    vdo_utilisateur  VARCHAR(50)  NOT NULL,
    vdo_jeton        UUID         NOT NULL,                 -- fenêtre qui détient le verrou
    vdo_depuis       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    vdo_vu           TIMESTAMPTZ  NOT NULL DEFAULT now()    -- dernière activité de la fenêtre (information)
);
