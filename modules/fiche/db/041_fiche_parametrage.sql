-- =============================================================================
-- Module Fiche – paramétrage étendu (rejouable, pour les bases créées avant ces colonnes ; 040 les contient déjà) :
-- champs du logiciel rendus confidentiels (RGPD), champs supplémentaires regroupés (onglet, cadre), liste de valeurs
-- par requête SQL, type mot de passe (valeur chiffrée en base par la clé d'installation).
-- =============================================================================

ALTER TABLE parametre_champ_fiche ADD COLUMN IF NOT EXISTS pcf_confidentiel BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE champ_supplementaire ADD COLUMN IF NOT EXISTS chs_requete TEXT;
ALTER TABLE champ_supplementaire ADD COLUMN IF NOT EXISTS chs_section VARCHAR(50);
ALTER TABLE champ_supplementaire ADD COLUMN IF NOT EXISTS chs_groupe  VARCHAR(100);

ALTER TABLE champ_supplementaire DROP CONSTRAINT IF EXISTS champ_supplementaire_chs_type_donnee_check;
ALTER TABLE champ_supplementaire ADD CONSTRAINT champ_supplementaire_chs_type_donnee_check
    CHECK (chs_type_donnee IN ('texte','nombre','booleen','date','liste','motdepasse'));
