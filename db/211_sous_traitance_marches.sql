-- =============================================================================
-- Cœur – module Sous-traitance, lot 1 (ANALYSE-MODULE-SOUS-TRAITANCE.md § 4, ST1 à ST6, ST19, ST21) : types de la
-- famille T (appel d'offres, commande, facture d'avancement, avoir) recopiés de leurs équivalents d'achat (statuts,
-- droits, règles, propriétés), transformations (ordre de sous-traitance, commande et devis clients, demande d'achat →
-- appel d'offres ; appel d'offres → commande → facture d'avancement) ; marché à deux sens (`mar_sens` V vente, ST
-- sous-traitance : sous-traitant, marché de vente lié, montant agréé, garantie, autoliquidation, délais contractuels),
-- commande de sous-traitance inscrite à son marché comme une commande client ; liste des marchés de sous-traitance ;
-- sous-traitants de démonstration repris dans l'annuaire (casquette SOUS_TRAITANT), table de démonstration supprimée.
-- Rejouable.
-- =============================================================================

-- Types : (code, libellé, préfixe, type d'achat modèle).
INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler,
                           tyd_validite_jours, tyd_avancement, tyd_consultation)
SELECT x.code, x.libelle, 'T', m.tyd_sens, x.prefixe, FALSE, FALSE, m.tyd_handler, m.tyd_validite_jours, m.tyd_avancement, x.code = 'T_AO'
FROM (VALUES ('T_AO', 'Appel d''offres de sous-traitance', 'AOS', 'A_DEVIS'), ('T_COMMANDE', 'Commande de sous-traitance', 'CST', 'A_COMMANDE'),
             ('T_FACTURE_AVT', 'Facture d''avancement de sous-traitance', 'FST', 'A_FACTURE_AVT'), ('T_AVOIR', 'Avoir de sous-traitance', 'AVS', 'A_AVOIR'))
     AS x(code, libelle, prefixe, modele)
JOIN type_document m ON m.tyd_code = x.modele
WHERE NOT EXISTS (SELECT 1 FROM type_document t WHERE t.tyd_code = x.code);
-- Facture d'avancement à période négative → avoir de sous-traitance (ST21).
UPDATE type_document SET tyd_avoir_tyd_id = (SELECT tyd_id FROM type_document WHERE tyd_code = 'T_AVOIR')
WHERE tyd_code = 'T_FACTURE_AVT' AND tyd_avoir_tyd_id IS NULL;

DROP TABLE IF EXISTS _st_modeles;
CREATE TEMP TABLE _st_modeles (code VARCHAR, modele VARCHAR);
INSERT INTO _st_modeles VALUES ('T_AO', 'A_DEVIS'), ('T_COMMANDE', 'A_COMMANDE'), ('T_FACTURE_AVT', 'A_FACTURE_AVT'), ('T_AVOIR', 'A_AVOIR');

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.std_code, s.std_libelle, s.std_modifiable, s.std_terminal, s.std_ordre
FROM _st_modeles x JOIN type_document t ON t.tyd_code = x.code JOIN type_document m ON m.tyd_code = x.modele
JOIN statut_document s ON s.std_tyd_id = m.tyd_id
ON CONFLICT (std_tyd_id, std_code) DO NOTHING;

INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT d.drt_profil, t.tyd_id, d.drt_action
FROM _st_modeles x JOIN type_document t ON t.tyd_code = x.code JOIN type_document m ON m.tyd_code = x.modele
JOIN droit_document d ON d.drt_tyd_id = m.tyd_id
ON CONFLICT DO NOTHING;

INSERT INTO regle_document (rdo_code, rdo_tyd_id, rdo_valeur, rdo_actif)
SELECT r.rdo_code, t.tyd_id, r.rdo_valeur, r.rdo_actif
FROM _st_modeles x JOIN type_document t ON t.tyd_code = x.code JOIN type_document m ON m.tyd_code = x.modele
JOIN regle_document r ON r.rdo_tyd_id = m.tyd_id
WHERE NOT EXISTS (SELECT 1 FROM regle_document y WHERE y.rdo_code = r.rdo_code AND y.rdo_tyd_id = t.tyd_id);

INSERT INTO propriete_definition (prd_tyd_id, prd_niveau, prd_code, prd_libelle, prd_type_donnee, prd_obligatoire, prd_valeur_defaut)
SELECT t.tyd_id, p.prd_niveau, p.prd_code, p.prd_libelle, p.prd_type_donnee, p.prd_obligatoire, p.prd_valeur_defaut
FROM _st_modeles x JOIN type_document t ON t.tyd_code = x.code JOIN type_document m ON m.tyd_code = x.modele
JOIN propriete_definition p ON p.prd_tyd_id = m.tyd_id
WHERE NOT EXISTS (SELECT 1 FROM propriete_definition y WHERE y.prd_tyd_id = t.tyd_id AND y.prd_code = p.prd_code AND y.prd_niveau = p.prd_niveau);

DROP TABLE _st_modeles;

INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, x.etape, NULL
FROM (VALUES
    ('E_OST', 'T_AO', 'CONSULTATION'), ('E_OST', 'T_COMMANDE', 'COMMANDE'), ('E_DAC', 'T_AO', 'CONSULTATION'),
    ('V_COMMANDE', 'T_AO', 'CONSULTATION'), ('V_COMMANDE', 'T_COMMANDE', 'COMMANDE'), ('V_DEVIS', 'T_AO', 'CONSULTATION'),
    ('T_AO', 'T_COMMANDE', 'COMMANDE'), ('T_COMMANDE', 'T_FACTURE_AVT', 'FACTURATION')
) AS x(source, cible, etape)
JOIN type_document s ON s.tyd_code = x.source
JOIN type_document c ON c.tyd_code = x.cible
WHERE NOT EXISTS (SELECT 1 FROM transformation_autorisee a WHERE a.tra_source_tyd_id = s.tyd_id AND a.tra_cible_tyd_id = c.tyd_id);

-- Marché à deux sens (ST2) : vente (client) ou sous-traitance (sous-traitant, marché de vente lié facultatif, ST5) ; un
-- marché de sous-traitance = un axe de facturation (ST4) ; nature publique ou privée : garantie (ST14).
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_sens VARCHAR(2) NOT NULL DEFAULT 'V';
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_marche_vente_id INT REFERENCES marche(mar_id) ON DELETE SET NULL;
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_montant_agree NUMERIC(18,2);
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_garantie VARCHAR(20);
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_autoliquidation BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_debut_contractuel DATE;
ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_fin_contractuelle DATE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mar_sens') THEN
        ALTER TABLE marche ADD CONSTRAINT ck_mar_sens CHECK (mar_sens IN ('V', 'ST'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mar_garantie') THEN
        ALTER TABLE marche ADD CONSTRAINT ck_mar_garantie CHECK (mar_garantie IS NULL OR mar_garantie IN ('PAIEMENT_DIRECT', 'DELEGATION', 'CAUTION', 'AUCUNE'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_mar_vente ON marche (mar_marche_vente_id) WHERE mar_marche_vente_id IS NOT NULL;

-- Commande validée (client ou de sous-traitance) inscrite au marché de son rattachement (reprise de 170).
CREATE OR REPLACE FUNCTION f_marche_commande(p_ent BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_mar INT;
    v_ancien INT;
    v_suivie BOOLEAN;
BEGIN
    SELECT d.ent_marche_id, (t.tyd_code IN ('V_COMMANDE', 'T_COMMANDE') AND d.ent_verrouille AND NOT d.ent_intermediaire)
      INTO v_mar, v_suivie
      FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = p_ent;
    SELECT mdo_mar_id INTO v_ancien FROM marche_document WHERE mdo_ent_id = p_ent;
    IF v_ancien IS NOT NULL AND (v_ancien IS DISTINCT FROM v_mar OR NOT coalesce(v_suivie, FALSE)) THEN
        DELETE FROM marche_document WHERE mdo_ent_id = p_ent;
        PERFORM f_marche_recalculer(v_ancien);
    END IF;
    IF v_mar IS NULL OR NOT coalesce(v_suivie, FALSE) THEN RETURN; END IF;
    INSERT INTO marche_document (mdo_mar_id, mdo_ent_id, mdo_role, mdo_rang)
    SELECT v_mar, p_ent,
           CASE WHEN NOT EXISTS (SELECT 1 FROM marche_document WHERE mdo_mar_id = v_mar AND mdo_role = 'BASE')
                 AND (m.mar_ent_id IS NULL OR m.mar_ent_id = p_ent
                      OR NOT EXISTS (SELECT 1 FROM document WHERE ent_id = m.mar_ent_id AND ent_marche_id = v_mar))
                THEN 'BASE' ELSE 'AVENANT' END,
           coalesce((SELECT max(mdo_rang) + 1 FROM marche_document WHERE mdo_mar_id = v_mar), 0)
    FROM marche m WHERE m.mar_id = v_mar
    ON CONFLICT (mdo_ent_id) DO NOTHING;
    PERFORM f_marche_recalculer(v_mar);
END;
$$;

-- Marchés de vente (reprise de 170) : les marchés de sous-traitance ont leur propre liste.
CREATE OR REPLACE VIEW v_liste_marches AS
SELECT m.mar_id AS id, 'marche'::text AS type_element, m.mar_code AS code, m.mar_libelle AS libelle,
       c.cha_code AS chantier, a.aff_code AS affaire, t.per_raison_sociale AS client, d.ent_numero AS commande,
       CASE m.mar_nature WHEN 'U' THEN 'Public' ELSE 'Privé' END AS nature, m.mar_montant_ht AS montant_ht, m.mar_statut AS statut, m.mar_date AS date_marche,
       f.facture_ht, m.mar_montant_ht - f.facture_ht AS reste_a_facturer,
       (SELECT count(*) FROM marche_document x WHERE x.mdo_mar_id = m.mar_id AND x.mdo_role = 'AVENANT') AS nb_avenants
FROM marche m
JOIN chantier c ON c.cha_id = m.mar_cha_id
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN personne t ON t.per_id = m.mar_tiers_id
LEFT JOIN document d ON d.ent_id = m.mar_ent_id
CROSS JOIN LATERAL (SELECT coalesce(sum(x.facture_ht), 0) AS facture_ht FROM v_facturation_document x WHERE x.ent_marche_id = m.mar_id) f
WHERE m.mar_sens = 'V';

-- Marchés de sous-traitance : sous-traitant, chantier, marché de vente lié, montants (commandé, agréé, facturé :
-- factures d'avancement de sous-traitance validées non annulées moins les avoirs), garantie. Masqués si le module est
-- désactivé.
CREATE OR REPLACE VIEW v_liste_marches_st AS
SELECT m.mar_id AS id, 'marche'::text AS type_element, m.mar_code AS code, m.mar_libelle AS libelle,
       c.cha_code AS chantier, a.aff_code AS affaire, t.per_raison_sociale AS sous_traitant, v.mar_code AS marche_vente,
       CASE m.mar_nature WHEN 'U' THEN 'Public' ELSE 'Privé' END AS nature,
       CASE m.mar_garantie WHEN 'PAIEMENT_DIRECT' THEN 'Paiement direct' WHEN 'DELEGATION' THEN 'Délégation de paiement'
            WHEN 'CAUTION' THEN 'Caution' WHEN 'AUCUNE' THEN 'Aucune' END AS garantie,
       m.mar_montant_ht AS montant_ht, m.mar_montant_agree AS montant_agree, f.facture_ht, m.mar_montant_ht - f.facture_ht AS reste_a_facturer,
       m.mar_statut AS statut, m.mar_date AS date_marche, m.mar_fin_contractuelle AS fin_contractuelle,
       (SELECT count(*) FROM marche_document x WHERE x.mdo_mar_id = m.mar_id AND x.mdo_role = 'AVENANT') AS nb_avenants,
       c.cha_id AS chantier_id, m.mar_tiers_id AS tiers_id
FROM marche m
JOIN chantier c ON c.cha_id = m.mar_cha_id
LEFT JOIN affaire a ON a.aff_id = c.cha_aff_id
LEFT JOIN personne t ON t.per_id = m.mar_tiers_id
LEFT JOIN marche v ON v.mar_id = m.mar_marche_vente_id
CROSS JOIN LATERAL (
    SELECT coalesce(sum(CASE WHEN ty.tyd_code = 'T_AVOIR' THEN -d.ent_total_ht ELSE d.ent_total_ht END), 0) AS facture_ht
    FROM document d JOIN type_document ty ON ty.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
    WHERE d.ent_marche_id = m.mar_id AND ty.tyd_code IN ('T_FACTURE_AVT', 'T_AVOIR') AND d.ent_verrouille AND d.ent_is_reference
      AND s.std_code NOT IN ('ANNULE', 'REMPLACE')) f
WHERE m.mar_sens = 'ST' AND f_module_actif('sous_traitance');

-- Sous-traitants de démonstration (ST19) : personnes de l'annuaire à la casquette SOUS_TRAITANT (corps d'état, taux
-- horaire et agrément dans les propriétés), puis la table de démonstration disparaît (ressources : vue reprise de 120).
DO $$
BEGIN
    IF to_regclass('demo_sous_traitant') IS NOT NULL THEN
        INSERT INTO personne (per_niv_code, per_raison_sociale, per_casquettes, per_st_corps_etat, per_proprietes)
        SELECT 'SOCIETE', s.sst_raison, '["SOUS_TRAITANT"]'::jsonb, s.sst_metier,
               jsonb_build_object('taux_horaire', s.sst_taux_horaire, 'agree', s.sst_agree, 'observations', s.sst_observations, 'code_demo', s.sst_code)
        FROM demo_sous_traitant s
        WHERE NOT EXISTS (SELECT 1 FROM personne p WHERE p.per_proprietes ->> 'code_demo' = s.sst_code);
        -- Affectations et équipes : identifiant du sous-traitant de démonstration → personne.
        UPDATE pla_affectation a SET aff_res_id = p.per_id::text
        FROM demo_sous_traitant s JOIN personne p ON p.per_proprietes ->> 'code_demo' = s.sst_code
        WHERE a.aff_res_type = 'SOUS_TRAITANT' AND a.aff_res_id = s.sst_id::text;
        UPDATE equipe_composition e SET eqc_ressource = p.per_id::text
        FROM demo_sous_traitant s JOIN personne p ON p.per_proprietes ->> 'code_demo' = s.sst_code
        WHERE e.eqc_type = 'SOUS_TRAITANT' AND e.eqc_ressource = s.sst_id::text;
        DROP VIEW IF EXISTS v_liste_ressources;
        DROP TABLE demo_sous_traitant;
    END IF;
END $$;

CREATE OR REPLACE VIEW v_liste_ressources AS
SELECT 'EQU-' || equ_id AS id, 'equipe' AS type_element, equ_code AS code, equ_libelle AS libelle, equ_categorie AS categorie,
       'Chef : ' || equ_chef AS statut, equ_active AS disponible, (equ_effectif * 42)::numeric AS cout_horaire,
       equ_chantier AS chantier, 'Effectif ' || equ_effectif AS observations
FROM equipe
UNION ALL
SELECT 'SAL-' || id, type_element, matricule, prenom || ' ' || nom, service, poste, actif,
       round(salaire_brut * 1.45 / 151.67, 2), NULL, commentaire
FROM v_liste_salaries
UNION ALL
SELECT 'MAT-' || id, 'materiel', code, designation, famille, etat, etat = 'DISPO', round(valeur_achat / 2000, 2), chantier, observations
FROM v_liste_materiels
UNION ALL
SELECT 'SST-' || p.per_id, 'sous_traitant', coalesce(p.per_proprietes ->> 'code_demo', 'ST' || p.per_id), p.per_raison_sociale, p.per_st_corps_etat,
       CASE WHEN coalesce((p.per_proprietes ->> 'agree')::boolean, TRUE) THEN 'Agréé' ELSE 'Agrément en cours' END,
       p.per_actif, (p.per_proprietes ->> 'taux_horaire')::numeric, NULL, p.per_proprietes ->> 'observations'
FROM personne p WHERE p.per_casquettes ? 'SOUS_TRAITANT';

-- Marché de sous-traitance lié à un marché de vente (ST2) : le sous-traitant devient intervenant SOUS_TRAITANT du
-- marché de vente (paiement direct selon la garantie) s'il n'y est pas déjà.
CREATE OR REPLACE FUNCTION f_marche_st_intervenant() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.mar_sens = 'ST' AND NEW.mar_marche_vente_id IS NOT NULL AND NEW.mar_tiers_id IS NOT NULL THEN
        UPDATE intervenant SET itv_paiement_direct = (NEW.mar_garantie = 'PAIEMENT_DIRECT')
        WHERE itv_mar_id = NEW.mar_marche_vente_id AND itv_fin_code = 'SOUS_TRAITANT' AND itv_per_id = NEW.mar_tiers_id;
        IF NOT FOUND THEN
            INSERT INTO intervenant (itv_mar_id, itv_fin_code, itv_per_id, itv_paiement_direct, itv_commentaire, itv_ordre)
            VALUES (NEW.mar_marche_vente_id, 'SOUS_TRAITANT', NEW.mar_tiers_id, NEW.mar_garantie = 'PAIEMENT_DIRECT', 'Marché de sous-traitance ' || NEW.mar_code,
                    coalesce((SELECT max(itv_ordre) + 1 FROM intervenant WHERE itv_mar_id = NEW.mar_marche_vente_id), 0));
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_marche_st_intervenant ON marche;
CREATE TRIGGER tr_marche_st_intervenant AFTER INSERT OR UPDATE OF mar_marche_vente_id, mar_tiers_id, mar_garantie ON marche
    FOR EACH ROW EXECUTE FUNCTION f_marche_st_intervenant();
