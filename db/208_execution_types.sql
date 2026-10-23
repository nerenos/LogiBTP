-- =============================================================================
-- Cœur – module Exécution, lot 2b (ANALYSE-MODULE-EXECUTION.md § 13, E25, E38, E39) : types d'ordres manquants
-- (bureau d'études, méthodes, fabrication, colisage, livraison, intervention SAV, sous-traitance, demande d'achat) avec
-- statuts, droits et transformations du § 3.3 ; service par défaut d'un type d'ordre (`tyd_srv_id`, repris à la création
-- d'un ordre sans service) ; visibilité des types dans les listes (`f_type_visible` : module actif, type d'ordre actif).
-- Rejouable.
-- =============================================================================

INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler)
SELECT x.code, x.libelle, 'E', 4, x.prefixe, FALSE, FALSE, NULL
FROM (VALUES
    ('E_BE', 'Ordre du bureau d''études', 'BE'), ('E_BM', 'Ordre du bureau des méthodes', 'BM'), ('E_OF', 'Ordre de fabrication', 'OF'),
    ('E_CO', 'Ordre de colisage', 'CO'), ('E_LI', 'Ordre de livraison', 'LI'), ('E_SAV', 'Intervention SAV', 'SAV'),
    ('E_OST', 'Ordre de sous-traitance', 'OST'), ('E_DAC', 'Demande d''achat', 'DAC')
) AS x(code, libelle, prefixe)
WHERE NOT EXISTS (SELECT 1 FROM type_document t WHERE t.tyd_code = x.code);

-- Statuts, droits : comme les types du lot 1 (db/197), pour tous les types de la famille E.
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

INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'ADMIN', t.tyd_id, a.action FROM type_document t
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('VALIDER'), ('TRANSFORMER'), ('SUPPRIMER'), ('APPROUVER'), ('DEVALIDER'), ('FORCER')) AS a(action)
WHERE t.tyd_famille = 'E'
ON CONFLICT DO NOTHING;
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'SAISIE', t.tyd_id, a.action FROM type_document t CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('TRANSFORMER')) AS a(action)
WHERE t.tyd_famille = 'E'
ON CONFLICT DO NOTHING;

-- Transformations (§ 3.3) : l'OE vers tous les ordres ; BE et BM vers l'aval ; OF vers colisage et livraison ; colisage
-- vers livraison (avec les commandes et réceptions d'achat du même chantier) ; SAV vers la facture ; sous-traitance vers
-- demande de prix et commande ; DAP et DAC vers les achats, la réservation, la sous-traitance ; tout ordre vers la DAP.
INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, x.etape, NULL
FROM (VALUES
    ('V_COMMANDE', 'E_SAV', 'SAV'),
    ('E_OE', 'E_BE', 'ETUDES'), ('E_OE', 'E_BM', 'METHODES'), ('E_OE', 'E_OF', 'FABRICATION'), ('E_OE', 'E_CO', 'COLISAGE'),
    ('E_OE', 'E_LI', 'LIVRAISON'), ('E_OE', 'E_SAV', 'SAV'), ('E_OE', 'E_OST', 'SOUS_TRAITANCE'), ('E_OE', 'E_DAC', 'ACHAT'),
    ('E_BE', 'E_BM', 'METHODES'), ('E_BE', 'E_OF', 'FABRICATION'), ('E_BE', 'E_CO', 'COLISAGE'), ('E_BE', 'E_PO', 'POSE'),
    ('E_BE', 'E_OST', 'SOUS_TRAITANCE'), ('E_BE', 'E_DAP', 'APPRO'), ('E_BE', 'E_DAC', 'ACHAT'), ('E_BE', 'S_RESERVATION', 'RESERVATION'),
    ('E_BM', 'E_OF', 'FABRICATION'), ('E_BM', 'E_CO', 'COLISAGE'), ('E_BM', 'E_PO', 'POSE'), ('E_BM', 'E_OST', 'SOUS_TRAITANCE'),
    ('E_BM', 'E_DAP', 'APPRO'), ('E_BM', 'E_DAC', 'ACHAT'), ('E_BM', 'S_RESERVATION', 'RESERVATION'),
    ('E_OF', 'E_CO', 'COLISAGE'), ('E_OF', 'E_LI', 'LIVRAISON'), ('E_OF', 'E_DAP', 'APPRO'),
    ('E_CO', 'E_LI', 'LIVRAISON'), ('A_COMMANDE', 'E_CO', 'COLISAGE'), ('A_RECEPTION', 'E_CO', 'COLISAGE'),
    ('A_COMMANDE', 'E_LI', 'LIVRAISON'), ('A_RECEPTION', 'E_LI', 'LIVRAISON'),
    ('E_LI', 'E_PO', 'POSE'), ('E_SAV', 'V_FACTURE', 'FACTURATION'), ('E_SAV', 'E_DAP', 'APPRO'),
    ('E_OST', 'A_DEVIS', 'CONSULTATION'), ('E_OST', 'A_COMMANDE', 'COMMANDE'),
    ('E_DAP', 'E_DAC', 'ACHAT'), ('E_DAP', 'E_OST', 'SOUS_TRAITANCE'), ('E_DAP', 'E_LI', 'LIVRAISON'),
    ('E_DAC', 'A_DEVIS', 'CONSULTATION'), ('E_DAC', 'A_COMMANDE', 'COMMANDE'), ('E_DAC', 'S_RESERVATION', 'RESERVATION'), ('E_DAC', 'E_OST', 'SOUS_TRAITANCE')
) AS x(source, cible, etape)
JOIN type_document s ON s.tyd_code = x.source
JOIN type_document c ON c.tyd_code = x.cible
WHERE NOT EXISTS (SELECT 1 FROM transformation_autorisee a WHERE a.tra_source_tyd_id = s.tyd_id AND a.tra_cible_tyd_id = c.tyd_id);

-- Service par défaut d'un type d'ordre (E25) : repris par un ordre créé sans service.
ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_srv_id INT REFERENCES service(srv_id) ON DELETE SET NULL;
UPDATE type_document t SET tyd_srv_id = s.srv_id
FROM (VALUES ('E_BE', 'BE'), ('E_BM', 'BM'), ('E_OF', 'ATELIER'), ('E_CO', 'LOGISTIQUE'), ('E_LI', 'LOGISTIQUE'), ('E_PO', 'POSE'), ('E_SAV', 'POSE'))
     AS x(type, service)
JOIN service s ON s.srv_code = x.service
WHERE t.tyd_code = x.type AND t.tyd_srv_id IS NULL;

CREATE OR REPLACE FUNCTION f_document_service_defaut() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.ent_srv_id IS NULL THEN
        SELECT t.tyd_srv_id INTO NEW.ent_srv_id FROM type_document t WHERE t.tyd_id = NEW.ent_tyd_id AND t.tyd_famille = 'E';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_document_service_defaut ON document;
CREATE TRIGGER tr_document_service_defaut BEFORE INSERT ON document FOR EACH ROW EXECUTE FUNCTION f_document_service_defaut();

-- Type visible dans les listes (E24, E39) : ordres masqués si le module Exécution est désactivé ou le type inactif.
CREATE OR REPLACE FUNCTION f_type_visible(p_famille VARCHAR, p_actif BOOLEAN) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_famille <> 'E' OR (p_actif AND f_module_actif('execution'))
$$;

-- Liste des documents (reprise de 197) : visibilité par f_type_visible.
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
WHERE f_type_visible(t.tyd_famille, t.tyd_actif);
