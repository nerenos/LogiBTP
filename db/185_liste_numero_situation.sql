-- =============================================================================
-- Cœur LogiBTP – listes des documents : n° de situation (ent_rang_avancement, par marché) et pièce liée d'avancement
-- (situation : factures d'avancement qui en sont issues ; facture d'avancement : situation d'origine), affichés dans
-- les listes Situations de travaux et Factures et avoirs. Rejouable.
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
       END                                        AS alerte,
       d.ent_rang_avancement                      AS numero_situation,
       -- Situation : factures d'avancement qui en sont issues ; facture d'avancement : situation d'origine (non annulées).
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
LEFT JOIN marche ma ON ma.mar_id = d.ent_marche_id;

-- Colonnes ajoutées après « N° » dans les vues des situations et des factures (vues par défaut et vues créées depuis).
UPDATE vue_liste v
SET vli_definition = jsonb_set(v.vli_definition, '{colonnes}', (
    SELECT jsonb_agg(c ORDER BY i, j)
    FROM (SELECT c0 AS c, i, 0 AS j FROM jsonb_array_elements(v.vli_definition -> 'colonnes') WITH ORDINALITY x(c0, i)
          UNION ALL
          SELECT n.c, x.i, n.j FROM jsonb_array_elements(v.vli_definition -> 'colonnes') WITH ORDINALITY x(c0, i),
               (VALUES (1, '{"code":"numero_situation","titre":"N° sit.","largeur":{"mode":"fixe","valeur":64},"alignement":"centre","format":"nombre","decimales":0,"recherche":false}'::jsonb),
                       (2, '{"code":"facture","titre":"Facture / situation","largeur":{"mode":"fixe","valeur":130}}'::jsonb)) n(j, c)
          WHERE x.c0 ->> 'code' = 'numero') s))
WHERE v.vli_definition -> 'source' ->> 'vue' = 'documents' AND v.vli_definition ->> 'theme' IN ('situations', 'factures')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v.vli_definition -> 'colonnes') c WHERE c ->> 'code' = 'numero_situation');
