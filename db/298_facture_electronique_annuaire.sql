-- =============================================================================
-- Cœur – facturation électronique, lot 20 (plans/facturation-electronique.md) : annuaire sur la fiche personne. Rejouable.
--
-- - personne : per_fe_suffixe (suffixe d'adressage de la ligne d'annuaire), per_fe_verifie_le (dernière vérification dans
--   l'annuaire de la plateforme), per_fe_dans_annuaire (NULL jamais vérifié, FALSE absent de l'annuaire, TRUE trouvé) ;
--   per_fe_adresse, per_fe_plateforme et per_fe_code_routage sont mis à jour par « Vérifier dans l'annuaire » ;
-- - facture_electronique_annuaire_option : vérification de nuit des tiers actifs, EN OPTION, désactivée par défaut
--   (une ligne ; fan_dernier_passage = jour du dernier passage de fond de la base).
-- =============================================================================

ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fe_suffixe VARCHAR(100);
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fe_verifie_le TIMESTAMPTZ;
ALTER TABLE personne ADD COLUMN IF NOT EXISTS per_fe_dans_annuaire BOOLEAN;

CREATE TABLE IF NOT EXISTS facture_electronique_annuaire_option (
    fan_id             SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (fan_id = 1),
    fan_nuit           BOOLEAN      NOT NULL DEFAULT FALSE,
    fan_dernier_passage DATE,
    fan_dernier_nombre INTEGER
);
COMMENT ON TABLE facture_electronique_annuaire_option IS 'Option de la vérification de nuit des tiers dans l''annuaire des plateformes (désactivée par défaut)';
INSERT INTO facture_electronique_annuaire_option (fan_id) VALUES (1) ON CONFLICT DO NOTHING;
