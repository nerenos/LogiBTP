-- =============================================================================
-- Cœur LogiBTP – module Mail (modules/mail/db/007) relié au module OAuth (modules/oauth/db/004) : connexion OAuth
-- d'un compte de messagerie, compte de service de l'envoi de fond (traces GED, suivi). Rejouable.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mco_oauth') THEN
    ALTER TABLE mail_compte ADD CONSTRAINT fk_mco_oauth FOREIGN KEY (mco_oco_id) REFERENCES oauth_connexion(oco_id) ON DELETE RESTRICT;
  END IF;
END $$;

INSERT INTO compte (cpt_code, cpt_type, cpt_libelle, cpt_profil, cpt_cree_par) VALUES
 ('mail_fond', 'SERVICE', 'Envoi et relève des courriels', 'SERVICE', 'installation')
ON CONFLICT DO NOTHING;
