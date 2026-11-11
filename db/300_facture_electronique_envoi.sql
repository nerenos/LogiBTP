-- =============================================================================
-- Cœur – facturation électronique, lot 24 (plans/facturation-electronique.md) : émission à la validation. Rejouable.
--
-- - document.ent_fe_differe : option « Envoyer plus tard » de la pièce (Q23) : validée sans être émise, émise ensuite par
--   le bouton « Émettre » de la pièce ;
-- - facture_electronique_emission_option : émission automatique à la validation (Q23, une ligne, active par défaut) ;
--   désactivée : toute pièce validée attend le bouton « Émettre » ;
-- - document_fe_emission : suivi de l'émission d'une pièce de vente d'un type émis (tyd_fe_type_facture), inscrit dans la
--   transaction de la validation (module actif), traité par la tâche de fond (Btp/EnvoiFactureBtp.cs) : A_EMETTRE,
--   DIFFEREE (envoyer plus tard ou émission manuelle), EMISE (flux en file, dfe_flux_id), ECHEC (production impossible,
--   dfe_erreur), HORS_FLUX (tiers particulier, international ou absent de l'annuaire : envoi habituel, aucun flux 2) ;
--   dfe_statut = statut du cycle de vie affiché du flux (mis à jour à chaque statut reçu) ;
-- - v_liste_documents (reprise de 287, colonnes inchangées) reçoit en fin de liste statut_fe : statut affiché du flux,
--   sinon EN_FILE (flux en file ou déposé sans statut), ERREUR (flux en erreur ou échec), ou l'état de l'émission ;
--   NULL hors facturation électronique. Toute nouvelle reprise de v_liste_documents part de ce script.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_fe_differe BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN document.ent_fe_differe IS 'Facture électronique : envoyer plus tard (pièce validée sans être émise, bouton « Émettre »)';

CREATE TABLE IF NOT EXISTS facture_electronique_emission_option (
    feo_id          SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (feo_id = 1),
    feo_automatique BOOLEAN      NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE facture_electronique_emission_option IS 'Émission des factures électroniques à la validation (automatique par défaut)';
INSERT INTO facture_electronique_emission_option (feo_id) VALUES (1) ON CONFLICT (feo_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS document_fe_emission (
    dfe_ent_id      BIGINT       PRIMARY KEY REFERENCES document (ent_id) ON DELETE CASCADE,
    dfe_etat        VARCHAR(20)  NOT NULL DEFAULT 'A_EMETTRE',
    dfe_motif       VARCHAR(30),
    dfe_syntaxe     VARCHAR(20),
    dfe_flux_id     BIGINT       REFERENCES fe_flux (ffl_id) ON DELETE SET NULL,
    dfe_statut      VARCHAR(10),
    dfe_essais      SMALLINT     NOT NULL DEFAULT 0,
    dfe_erreur      TEXT,
    dfe_demande_par VARCHAR(50)  NOT NULL DEFAULT '',
    dfe_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    dfe_traite_le   TIMESTAMPTZ
);
ALTER TABLE document_fe_emission DROP CONSTRAINT IF EXISTS document_fe_emission_etat_check;
ALTER TABLE document_fe_emission ADD CONSTRAINT document_fe_emission_etat_check
    CHECK (dfe_etat IN ('A_EMETTRE', 'DIFFEREE', 'EMISE', 'ECHEC', 'HORS_FLUX'));
CREATE INDEX IF NOT EXISTS ix_dfe_a_emettre ON document_fe_emission (dfe_cree_le) WHERE dfe_etat = 'A_EMETTRE';
CREATE INDEX IF NOT EXISTS ix_dfe_flux ON document_fe_emission (dfe_flux_id);
COMMENT ON TABLE document_fe_emission IS 'Émission en facture électronique d''une pièce de vente validée (lot 24)';

CREATE OR REPLACE VIEW v_liste_documents AS
SELECT d.ent_id                                   AS id,
       t.tyd_code                                 AS type_element,
       t.tyd_libelle                              AS type_document,
       t.tyd_famille                              AS famille,
       d.ent_numero                               AS numero,
       d.ent_indice                               AS indice,
       d.ent_date                                 AS date_document,
       d.ent_objet                                AS objet,
       coalesce(ch.cha_code || ' – ' || ch.cha_libelle, d.ent_proprietes ->> 'chantier') AS chantier,
       s.std_libelle                              AS statut,
       d.ent_tiers_id                             AS tiers,
       d.ent_total_ht                             AS total_ht,
       d.ent_total_ttc                            AS total_ttc,
       d.ent_net_a_payer                          AS net_a_payer,
       d.ent_is_reference                         AS reference,
       d.ent_verrouille                           AS verrouille,
       coalesce(d.ent_modifie_le, d.ent_cree_le)  AS modifie_le,
       pe.per_raison_sociale                      AS client,
       pr.prj_code                                AS projet,
       af.aff_code                                AS affaire,
       ma.mar_code                                AS marche,
       pr.prj_id                                  AS projet_id,
       af.aff_id                                  AS affaire_id,
       ch.cha_id                                  AS chantier_id,
       ma.mar_id                                  AS marche_id,
       CASE
         WHEN s.std_code IN ('ANNULE', 'REMPLACE') THEN NULL
         WHEN d.ent_rejete_le IS NOT NULL THEN 'Rejeté, à annuler' || coalesce(' : ' || d.ent_rejet_motif, '')
         WHEN d.ent_date_validite < current_date AND s.std_code IN ('APPROUVE', 'ENVOYE')
              AND coalesce(f_regle_document('VALIDITE_ALERTE', t.tyd_id) = 'true'::jsonb, false) THEN 'Validité dépassée'
       END                                        AS alerte,
       d.ent_rang_avancement                      AS numero_situation,
       (SELECT string_agg(x.ent_numero, ', ' ORDER BY x.ent_numero)
          FROM document_lien l
          JOIN document x ON x.ent_id = CASE WHEN t.tyd_avancement = 'S' THEN l.lie_cible_ent_id ELSE l.lie_source_ent_id END
          JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id
          JOIN statut_document sx ON sx.std_id = x.ent_std_id
         WHERE l.lie_type = 'TRANSFORMATION' AND sx.std_code NOT IN ('ANNULE', 'REMPLACE')
           AND ((t.tyd_avancement = 'S' AND l.lie_source_ent_id = d.ent_id AND tx.tyd_avancement = 'F')
             OR (t.tyd_avancement = 'F' AND l.lie_cible_ent_id = d.ent_id AND tx.tyd_avancement = 'S'))) AS facture,
       -- Chantiers du document (filtre par chantier) : celui de l'entête ; sans entête, ceux des lignes (achats) et des
       -- documents sources (facture de plusieurs livraisons…).
       CASE WHEN d.ent_chantier_id IS NOT NULL THEN ARRAY[d.ent_chantier_id]
            ELSE (SELECT array_agg(DISTINCT c.cha_id ORDER BY c.cha_id) FROM (
                    SELECT l.lig_cha_id AS cha_id FROM document_ligne l WHERE l.lig_ent_id = d.ent_id AND l.lig_cha_id IS NOT NULL
                    UNION SELECT x.ent_chantier_id FROM document_lien k JOIN document x ON x.ent_id = k.lie_source_ent_id
                     WHERE k.lie_cible_ent_id = d.ent_id AND k.lie_type = 'TRANSFORMATION' AND x.ent_chantier_id IS NOT NULL) c)
       END                                        AS chantiers,
       s.std_code                                 AS statut_code,
       -- État affiché (pastille) : refusé si rejeté ou non retenu, expiré si la validité est dépassée (comme l'alerte),
       -- sinon le code du statut. Jamais de changement de statut (Q3).
       CASE
         WHEN s.std_code IN ('ANNULE', 'REMPLACE') THEN s.std_code
         WHEN d.ent_rejete_le IS NOT NULL OR s.std_code = 'NON_RETENU' THEN 'REFUSE'
         WHEN d.ent_date_validite < current_date AND s.std_code IN ('APPROUVE', 'ENVOYE')
              AND coalesce(f_regle_document('VALIDITE_ALERTE', t.tyd_id) = 'true'::jsonb, false) THEN 'EXPIRE'
         ELSE s.std_code
       END::text                                  AS etat,
       -- Indicateurs des listes (L4) : âge du document en jours ; jours depuis l'envoi d'un document envoyé sans réponse,
       -- ou depuis sa dernière relance notée au CRM (Q5 : une note de type Relance remet le délai à zéro).
       (current_date - d.ent_date)                AS age_jours,
       CASE WHEN s.std_code = 'ENVOYE' THEN current_date - greatest(coalesce(d.ent_envoye_le::date, d.ent_date),
            (SELECT max(n.not_cree_le)::date FROM crm_note n JOIN crm_type_note tn ON tn.tno_id = n.not_tno_id AND tn.tno_code = 'RELANCE'
               JOIN crm_note_lien l ON l.nli_not_id = n.not_id AND l.nli_type_element = 'document'
              WHERE l.nli_id_element = coalesce(d.ent_groupe_id, d.ent_id)::text AND n.not_etat <> 'ANNULEE')) END AS jours_envoye,
       -- Colonne « Dernière relance » des listes de devis et de factures (module Relances, lot 8) : date de la dernière relance
       -- du journal (ENVOYEE ou ATTENTE_NUMERO) de la pièce ou d'un indice de son groupe ; NULL sans relance.
       (SELECT max(r.rel_date) FROM relance r
         WHERE r.rel_etat IN ('ENVOYEE', 'ATTENTE_NUMERO')
           AND (r.rel_ent_id = d.ent_id OR (d.ent_groupe_id IS NOT NULL AND r.rel_ent_groupe_id = d.ent_groupe_id))) AS derniere_relance,
       -- Colonne « Facture électronique » des listes de factures (lot 24) : statut du cycle de vie affiché, sinon état.
       (SELECT CASE WHEN e.dfe_statut IS NOT NULL THEN e.dfe_statut
                    WHEN e.dfe_etat = 'ECHEC' OR f.ffl_etat = 'ERREUR' THEN 'ERREUR'
                    WHEN e.dfe_etat = 'EMISE' THEN 'EN_FILE'
                    ELSE e.dfe_etat END
          FROM document_fe_emission e LEFT JOIN fe_flux f ON f.ffl_id = e.dfe_flux_id
         WHERE e.dfe_ent_id = d.ent_id)::text      AS statut_fe
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN personne pe ON pe.per_id = d.ent_tiers_id
LEFT JOIN projet pr ON pr.prj_id = coalesce(d.ent_projet_id, (SELECT cha_prj_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN affaire af ON af.aff_id = coalesce(d.ent_affaire_id, (SELECT cha_aff_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN chantier ch ON ch.cha_id = d.ent_chantier_id
LEFT JOIN marche ma ON ma.mar_id = d.ent_marche_id
WHERE f_type_visible(t.tyd_famille, t.tyd_actif);
