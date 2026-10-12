-- =============================================================================
-- Cœur LogiBTP – annuaire : champs déverrouillés par les casquettes (fiche personne), vues de liste des personnes et
-- des individus, catégories GED des pièces des tiers, liens des salariés et des tarifs fournisseurs vers l'annuaire.
-- Référentiels et données de démonstration : 141_annuaire_demo.sql (généré) ; individus des salariés : 142.
-- =============================================================================

ALTER TABLE personne
    ADD COLUMN per_cli_compte              VARCHAR(20),
    ADD COLUMN per_cli_categorie           VARCHAR(40),
    ADD COLUMN per_cli_encours_max         NUMERIC(14,2),
    ADD COLUMN per_cli_remise              NUMERIC(6,3),
    ADD COLUMN per_fou_compte              VARCHAR(20),
    ADD COLUMN per_fou_numero_client       VARCHAR(40),
    ADD COLUMN per_fou_franco              NUMERIC(14,2),
    ADD COLUMN per_fou_delai_livraison     INT,
    ADD COLUMN per_st_corps_etat           VARCHAR(100),
    ADD COLUMN per_st_qualifications       VARCHAR(200),
    ADD COLUMN per_st_autoliquidation      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN per_st_decennale_assureur   VARCHAR(100),
    ADD COLUMN per_st_decennale_police     VARCHAR(50),
    ADD COLUMN per_st_decennale_fin        DATE,
    ADD COLUMN per_int_garantie_financiere VARCHAR(100),
    ADD COLUMN per_int_coefficient         NUMERIC(8,4),
    ADD COLUMN per_arc_numero_ordre        VARCHAR(30),
    ADD COLUMN per_bc_agrement             VARCHAR(50),
    ADD COLUMN per_bc_missions             VARCHAR(100);

-- Salariés (module salariés du cœur) : individu de l'annuaire (identité, coordonnées, rattachement à l'agence).
ALTER TABLE demo_salarie ADD COLUMN sal_ind_id BIGINT UNIQUE REFERENCES individu(ind_id) ON DELETE SET NULL;

-- Tarifs fournisseurs de la bibliothèque : fournisseur de l'annuaire.
ALTER TABLE tarif_fournisseur ADD CONSTRAINT fk_tfo_tiers FOREIGN KEY (tfo_tiers_id) REFERENCES personne(per_id) ON DELETE SET NULL;
CREATE INDEX ix_tfo_tiers ON tarif_fournisseur (tfo_tiers_id);

-- Pièces des tiers (GED) : extrait Kbis, attestations, RIB.
UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"kbis","libelle":"Extrait Kbis"},{"code":"attestation_urssaf","libelle":"Attestation de vigilance URSSAF","coffre":true},{"code":"attestation_assurance","libelle":"Attestation d''assurance","coffre":true},{"code":"rib","libelle":"RIB"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"kbis"}]'::jsonb;

-- Listes (sources « personnes » et « individus ») : casquettes et rôles en tableaux de codes (segments multivalués).
CREATE VIEW v_liste_personnes AS
SELECT per_id AS id, 'personne'::text AS type_element, per_code AS code, per_raison_sociale AS raison_sociale, per_nom_commercial AS nom_commercial,
       per_niv_code AS niveau, ARRAY(SELECT jsonb_array_elements_text(per_casquettes)) AS casquettes, parent, chemin, per_siren AS siren,
       per_siret AS siret, per_tva_intra AS tva_intra, per_pays AS pays, adresse, code_postal, ville, telephone, email, contact,
       per_societe_base AS societe_base, per_actif AS actif, per_modifie_le AS modifie_le
FROM v_annuaire_personnes;

CREATE VIEW v_liste_individus AS
SELECT ind_id AS id, 'individu'::text AS type_element, ind_civilite AS civilite, ind_nom AS nom, ind_prenom AS prenom, nom_complet, personnes, fonction,
       ARRAY(SELECT jsonb_array_elements_text(ind_roles)) AS roles, telephone, portable, email, ville, ind_utilisateur AS utilisateur,
       ind_actif AS actif, ind_modifie_le AS modifie_le
FROM v_annuaire_individus;
