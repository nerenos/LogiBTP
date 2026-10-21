-- =============================================================================
-- Cœur – module Exécution, lot 1 (ANALYSE-MODULE-EXECUTION.md : E1 à E4, E14, E16, E17, E21, E24) : ordres = documents
-- de la famille E (module Document 019h), un chantier par ordre ; types ordre d'exécution (OE), ordre de pose (PO),
-- demande d'approvisionnement (DAP) ; S_DEMANDE renommé « Demande de stock » ; transformations depuis les commandes du
-- marché ; état d'exécution, motif, service, responsable et dates prévues de l'ordre ; heures de main-d'œuvre des lignes ;
-- budget planifié de l'OE (instantané à chaque validation, le premier est le budget de référence) ; liste des ordres ;
-- module désactivé : ordres absents des listes. Rejouable.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_ordre) VALUES
 ('execution', 'Exécution', 'Ordres d''exécution, de pose, demandes d''approvisionnement ; parcours des services, états et synthèse par chantier', 30)
ON CONFLICT (mod_code) DO NOTHING;

-- Module actif pour la société (inconnu : actif) ; lu par les vues de liste (règle commune E24).
CREATE OR REPLACE FUNCTION f_module_actif(p_code TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT coalesce((SELECT mod_actif FROM module_societe WHERE mod_code = p_code), TRUE)
$$;

UPDATE type_document SET tyd_libelle = 'Demande de stock' WHERE tyd_code = 'S_DEMANDE' AND tyd_libelle = 'Demande d''approvisionnement';

-- Types d'ordres (sens 4 : exécution) : numérotés à la création, non comptables, sans TVA ni pied par défaut.
INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler)
SELECT x.code, x.libelle, 'E', 4, x.prefixe, FALSE, FALSE, NULL
FROM (VALUES ('E_OE', 'Ordre d''exécution', 'OE'), ('E_PO', 'Ordre de pose', 'PO'), ('E_DAP', 'Demande d''approvisionnement', 'DAP')) AS x(code, libelle, prefixe)
WHERE NOT EXISTS (SELECT 1 FROM type_document t WHERE t.tyd_code = x.code);

-- Statuts : comme les documents de stock ; « Envoyé » = transmis au service, « Validé » = pris en charge.
INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, s.modifiable, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES
    ('BROUILLON', 'Brouillon', TRUE, FALSE, 1), ('APPROUVE', 'Approuvé', FALSE, FALSE, 2), ('ENVOYE', 'Transmis', FALSE, FALSE, 3),
    ('VALIDE', 'Pris en charge', FALSE, FALSE, 4), ('SOLDE', 'Soldé', FALSE, FALSE, 6), ('ANNULE', 'Annulé', FALSE, TRUE, 11),
    ('REMPLACE', 'Remplacé', FALSE, TRUE, 12)
) AS s(code, libelle, modifiable, terminal, ordre)
WHERE t.tyd_famille = 'E'
ON CONFLICT (std_tyd_id, std_code) DO NOTHING;

-- Droits : comme les ventes (ADMIN tout ; SAISIE crée, modifie, transforme).
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'ADMIN', t.tyd_id, a.action FROM type_document t
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('VALIDER'), ('TRANSFORMER'), ('SUPPRIMER'), ('APPROUVER'), ('DEVALIDER'), ('FORCER')) AS a(action)
WHERE t.tyd_famille = 'E'
ON CONFLICT DO NOTHING;
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'SAISIE', t.tyd_id, a.action FROM type_document t CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('TRANSFORMER')) AS a(action)
WHERE t.tyd_famille = 'E'
ON CONFLICT DO NOTHING;

-- Transformations : commandes du marché → OE ; OE → PO, DAP ; PO → DAP ; DAP → demande de prix, commande fournisseur,
-- demande de stock, réservation (E21). Chaque étape a son propre reste à répartir.
INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, x.etape, NULL
FROM (VALUES
    ('V_COMMANDE', 'E_OE', 'EXECUTION'), ('E_OE', 'E_PO', 'POSE'), ('E_OE', 'E_DAP', 'APPRO'), ('E_PO', 'E_DAP', 'APPRO'),
    ('E_DAP', 'A_DEVIS', 'CONSULTATION'), ('E_DAP', 'A_COMMANDE', 'COMMANDE'), ('E_DAP', 'S_DEMANDE', 'STOCK'), ('E_DAP', 'S_RESERVATION', 'RESERVATION')
) AS x(source, cible, etape)
JOIN type_document s ON s.tyd_code = x.source
JOIN type_document c ON c.tyd_code = x.cible
WHERE NOT EXISTS (SELECT 1 FROM transformation_autorisee a WHERE a.tra_source_tyd_id = s.tyd_id AND a.tra_cible_tyd_id = c.tyd_id);

-- Exécution de l'ordre : état propre (en plus du statut documentaire), motif de blocage (référentiel des motifs, db/195),
-- service porteur, responsable, dates prévues ; modifiables même sur un ordre validé (route de l'exécution).
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_exe_etat VARCHAR(10);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_exe_motif_id INT REFERENCES motif(mot_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_exe_commentaire TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_srv_id INT REFERENCES service(srv_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_responsable_id BIGINT REFERENCES individu(ind_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_debut_prevu DATE;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_fin_prevue DATE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ent_exe_etat') THEN
        ALTER TABLE document ADD CONSTRAINT ck_ent_exe_etat CHECK (ent_exe_etat IS NULL OR ent_exe_etat IN ('A_FAIRE', 'EN_ATTENTE', 'EN_COURS', 'BLOQUE', 'TERMINE'));
    END IF;
END $$;
-- Heures réalisées saisies sur une ligne d'ordre (sans le module Pointage : E9).
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_heures_realisees NUMERIC(18,6);

-- Historique de l'exécution d'un ordre (états, motifs, commentaires, affectation).
CREATE TABLE IF NOT EXISTS ordre_execution_historique (
    oeh_id           BIGSERIAL     PRIMARY KEY,
    oeh_ent_id       BIGINT        NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    oeh_etat         VARCHAR(10),
    oeh_motif_id     INT           REFERENCES motif(mot_id) ON DELETE SET NULL,
    oeh_commentaire  TEXT,
    oeh_detail       VARCHAR(300),
    oeh_par          VARCHAR(50)   NOT NULL,
    oeh_le           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_oeh_ordre ON ordre_execution_historique (oeh_ent_id, oeh_le DESC);

-- Budget planifié de l'OE (E16) : instantané des lignes valorisées à chaque validation ; le premier du groupe d'indices
-- est le budget de référence (dérives mesurées contre lui).
CREATE TABLE IF NOT EXISTS ordre_budget (
    obu_id         BIGSERIAL     PRIMARY KEY,
    obu_ent_id     BIGINT        NOT NULL REFERENCES document(ent_id) ON DELETE CASCADE,
    obu_groupe_id  BIGINT        NOT NULL,
    obu_reference  BOOLEAN       NOT NULL DEFAULT FALSE,
    obu_total_pr   NUMERIC(18,6),
    obu_total_ht   NUMERIC(18,6),
    obu_heures     NUMERIC(18,6),
    obu_lignes     JSONB         NOT NULL DEFAULT '[]',
    obu_par        VARCHAR(50)   NOT NULL,
    obu_le         TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_obu_groupe ON ordre_budget (obu_groupe_id, obu_le);
CREATE UNIQUE INDEX IF NOT EXISTS ux_obu_reference ON ordre_budget (obu_groupe_id) WHERE obu_reference;

-- Heures de main-d'œuvre d'une ligne : éléments de nature du regroupement MO en heures (quantité totale, composantes
-- comprises), hors options, variantes, pour mémoire et frais annexes (type de prix d'un ancêtre compris) ; service de la
-- nature (db/195).
CREATE OR REPLACE VIEW v_heures_lignes AS
SELECT l.lig_id, l.lig_ent_id AS ent_id, l.lig_parent_id, n.nat_srv_id AS srv_id, coalesce(l.lig_qte_totale, l.lig_qte_vendue, 0) AS heures
FROM document_ligne l
JOIN nature_element n ON n.nat_id = l.lig_nat_id AND n.nat_rgn_code = 'MO'
WHERE l.lig_tyl_id = 3 AND lower(coalesce(l.lig_unt_code, '')) IN ('h', 'heure', 'heures')
  AND NOT EXISTS (SELECT 1 FROM document_ligne a WHERE a.lig_ent_id = l.lig_ent_id AND a.lig_chemin @> l.lig_chemin AND coalesce(a.lig_type_prix, 'V') <> 'V');

-- Heures budget d'un chantier par service : commandes clients validées (référence, ni annulées ni remplacées).
CREATE OR REPLACE VIEW v_heures_budget_chantier AS
SELECT d.ent_chantier_id AS chantier_id, h.srv_id, sum(h.heures) AS heures
FROM v_heures_lignes h
JOIN document d ON d.ent_id = h.ent_id
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id
WHERE t.tyd_code = 'V_COMMANDE' AND d.ent_verrouille AND d.ent_is_reference AND s.std_code NOT IN ('ANNULE', 'REMPLACE') AND d.ent_chantier_id IS NOT NULL
GROUP BY 1, 2;

-- Liste des documents (reprise de 185) : les ordres disparaissent quand le module Exécution est désactivé (E24).
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
             OR (t.tyd_avancement = 'F' AND l.lie_cible_ent_id = d.ent_id AND tx.tyd_avancement = 'S'))) AS facture
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN personne pe ON pe.per_id = d.ent_tiers_id
LEFT JOIN projet pr ON pr.prj_id = coalesce(d.ent_projet_id, (SELECT cha_prj_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN affaire af ON af.aff_id = coalesce(d.ent_affaire_id, (SELECT cha_aff_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN chantier ch ON ch.cha_id = d.ent_chantier_id
LEFT JOIN marche ma ON ma.mar_id = d.ent_marche_id
WHERE t.tyd_famille <> 'E' OR f_module_actif('execution');

-- Liste des ordres : colonnes des documents + exécution (état, motif, service, responsable, dates, heures).
CREATE OR REPLACE VIEW v_liste_ordres AS
SELECT v.*, d.ent_exe_etat AS etat_execution, m.mot_libelle AS motif, sv.srv_libelle AS service, sv.srv_id AS service_id,
       concat_ws(' ', r.ind_prenom, r.ind_nom) AS responsable, d.ent_debut_prevu AS debut_prevu, d.ent_fin_prevue AS fin_prevue,
       (SELECT sum(h.heures) FROM v_heures_lignes h WHERE h.ent_id = d.ent_id) AS heures_budget,
       CASE WHEN d.ent_fin_prevue < current_date AND coalesce(d.ent_exe_etat, '') <> 'TERMINE' AND s.std_code NOT IN ('ANNULE', 'REMPLACE', 'SOLDE')
            THEN TRUE ELSE FALSE END AS en_retard
FROM v_liste_documents v
JOIN document d ON d.ent_id = v.id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN motif m ON m.mot_id = d.ent_exe_motif_id
LEFT JOIN service sv ON sv.srv_id = d.ent_srv_id
LEFT JOIN individu r ON r.ind_id = d.ent_responsable_id
WHERE v.famille = 'E';
