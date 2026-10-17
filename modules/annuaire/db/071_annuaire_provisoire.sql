-- =============================================================================
-- Module Annuaire – tiers provisoires (rejouable).
-- Un tiers saisi depuis un document ou une fiche, après contrôle des doublons (SIRET, nom), est créé provisoire :
-- utilisable tout de suite (documents, intervenants), il attend qu'un utilisateur habilité valide sa création ou le
-- fusionne avec une fiche existante (valeurs choisies champ par champ ; contacts, coordonnées, liens et références de
-- l'application reportés sur la fiche conservée, puis le provisoire supprimé). Journal des fusions : fusion_personne.
-- =============================================================================

ALTER TABLE personne
    ADD COLUMN IF NOT EXISTS per_provisoire      BOOLEAN       NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS per_provisoire_par  VARCHAR(50),
    ADD COLUMN IF NOT EXISTS per_provisoire_le   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS per_valide_par      VARCHAR(50),
    ADD COLUMN IF NOT EXISTS per_valide_le       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_per_provisoire ON personne (per_provisoire) WHERE per_provisoire;

-- Fusions réalisées : la fiche fusionnée n'existe plus (pas de clé étrangère), son code et son libellé sont gardés.
CREATE TABLE IF NOT EXISTS fusion_personne (
    fpe_id              BIGSERIAL     PRIMARY KEY,
    fpe_source_id       BIGINT        NOT NULL,
    fpe_source_code     VARCHAR(20),
    fpe_source_libelle  VARCHAR(200)  NOT NULL,
    fpe_cible_id        BIGINT        NOT NULL REFERENCES personne (per_id) ON DELETE CASCADE,
    fpe_choix           JSONB         NOT NULL DEFAULT '{}',      -- { colonne | +clé : source | cible }
    fpe_valeurs         JSONB         NOT NULL DEFAULT '{}',      -- valeurs écrites sur la cible
    fpe_reports         JSONB         NOT NULL DEFAULT '{}',      -- { quoi : nombre } (contacts, documents…)
    fpe_par             VARCHAR(50)   NOT NULL,
    fpe_le              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fpe_cible ON fusion_personne (fpe_cible_id);

-- Vue des personnes : statut provisoire en dernière colonne (remplacement compatible avec les vues qui en dépendent).
CREATE OR REPLACE VIEW v_annuaire_personnes AS
WITH adr AS (SELECT DISTINCT ON (per_id) per_id, coo_ville, coo_code_postal, texte FROM v_annuaire_usages
             WHERE per_id IS NOT NULL AND coo_nature = 'ADRESSE' ORDER BY per_id, uco_principal DESC, uco_ordre, uco_id),
     tel AS (SELECT DISTINCT ON (per_id) per_id, texte FROM v_annuaire_usages
             WHERE per_id IS NOT NULL AND coo_nature = 'TELEPHONE' ORDER BY per_id, uco_principal DESC, uco_ordre, uco_id),
     mel AS (SELECT DISTINCT ON (per_id) per_id, texte FROM v_annuaire_usages
             WHERE per_id IS NOT NULL AND coo_nature = 'EMAIL' ORDER BY per_id, uco_principal DESC, uco_ordre, uco_id),
     contact AS (SELECT DISTINCT ON (r.rat_per_id) r.rat_per_id AS per_id, concat_ws(' ', i.ind_civilite, i.ind_prenom, i.ind_nom) AS libelle
                 FROM rattachement r JOIN individu i ON i.ind_id = r.rat_ind_id WHERE r.rat_actif
                 ORDER BY r.rat_per_id, r.rat_principal DESC, r.rat_id)
SELECT p.per_id, p.per_code, p.per_niv_code, n.niv_libelle, n.niv_icone, n.niv_morale, p.per_raison_sociale, p.per_nom_commercial,
       p.per_parent_id, par.per_raison_sociale AS parent, h.chemin, p.per_casquettes, p.per_pays, p.per_siren, p.per_siret,
       p.per_tva_intra, p.per_societe_base, p.per_actif, p.per_modifie_le,
       adr.coo_ville AS ville, adr.coo_code_postal AS code_postal, adr.texte AS adresse, tel.texte AS telephone, mel.texte AS email, contact.libelle AS contact,
       p.per_provisoire
FROM personne p
JOIN niveau_personne n ON n.niv_code = p.per_niv_code
LEFT JOIN personne par ON par.per_id = p.per_parent_id
LEFT JOIN v_personne_chemin h ON h.per_id = p.per_id
LEFT JOIN adr ON adr.per_id = p.per_id
LEFT JOIN tel ON tel.per_id = p.per_id
LEFT JOIN mel ON mel.per_id = p.per_id
LEFT JOIN contact ON contact.per_id = p.per_id;
