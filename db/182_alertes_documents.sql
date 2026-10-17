-- =============================================================================
-- Cœur LogiBTP – contrôles de gestion des documents (CONCEPTION-REGLES-DOCUMENTS.md, lot 6) : colonne « alerte » de la
-- liste des documents (document rejeté à annuler : P25 ; fin de validité dépassée : R3, règle VALIDITE_ALERTE),
-- chronologie des achats (R7 : date du fournisseur pas dans le futur). Rejouable.
-- =============================================================================

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
       pr.prj_id                                  AS projet_id,   -- identifiants : filtres des listes par rattachement
       af.aff_id                                  AS affaire_id,
       ch.cha_id                                  AS chantier_id,
       ma.mar_id                                  AS marche_id,
       CASE
         WHEN s.std_code IN ('ANNULE', 'REMPLACE') THEN NULL
         WHEN d.ent_rejete_le IS NOT NULL THEN 'Rejeté, à annuler' || coalesce(' : ' || d.ent_rejet_motif, '')
         WHEN d.ent_date_validite < current_date AND s.std_code IN ('APPROUVE', 'ENVOYE')
              AND coalesce(f_regle_document('VALIDITE_ALERTE', t.tyd_id) = 'true'::jsonb, false) THEN 'Validité dépassée'
       END                                        AS alerte
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN personne pe ON pe.per_id = d.ent_tiers_id
LEFT JOIN projet pr ON pr.prj_id = coalesce(d.ent_projet_id, (SELECT cha_prj_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN affaire af ON af.aff_id = coalesce(d.ent_affaire_id, (SELECT cha_aff_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN chantier ch ON ch.cha_id = d.ent_chantier_id
LEFT JOIN marche ma ON ma.mar_id = d.ent_marche_id;

-- Colonne « Alerte » ajoutée aux vues de liste des documents (vues par défaut et vues créées depuis, si absente).
UPDATE vue_liste
SET vli_definition = jsonb_set(vli_definition, '{colonnes}', (vli_definition -> 'colonnes')
    || '[{"code":"alerte","titre":"Alerte","largeur":{"mode":"proportionnel","valeur":1.5,"min":90,"max":220},"style":{"couleur":"#b42318"}}]'::jsonb)
WHERE vli_definition -> 'source' ->> 'vue' = 'documents'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(vli_definition -> 'colonnes') c WHERE c ->> 'code' = 'alerte');

-- Achats : la date du fournisseur (date comptable) ne peut pas être dans le futur (R7, P9).
INSERT INTO regle_document (rdo_code, rdo_famille, rdo_valeur) VALUES ('DATE_PIECE', 'A', 'true') ON CONFLICT DO NOTHING;
