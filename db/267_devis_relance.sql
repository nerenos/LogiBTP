-- =============================================================================
-- Cœur – devis à relancer (TODO, ergonomie Q5). Rejouable.
--
-- jours_envoye de v_liste_documents (reprise de 253, colonnes inchangées) compte depuis la dernière note du CRM de type
-- Relance rattachée au document (groupe d'indices), quand elle est plus récente que l'envoi : une relance notée sort le
-- devis de l'indicateur « Devis à relancer » pour le délai de la vue (filtre jours_envoye de l'indicateur, 15 jours par
-- défaut, modifiable dans le concepteur). Toute nouvelle reprise de v_liste_documents part de ce script.
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
              WHERE l.nli_id_element = coalesce(d.ent_groupe_id, d.ent_id)::text AND n.not_etat <> 'ANNULEE')) END AS jours_envoye
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN personne pe ON pe.per_id = d.ent_tiers_id
LEFT JOIN projet pr ON pr.prj_id = coalesce(d.ent_projet_id, (SELECT cha_prj_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN affaire af ON af.aff_id = coalesce(d.ent_affaire_id, (SELECT cha_aff_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN chantier ch ON ch.cha_id = d.ent_chantier_id
LEFT JOIN marche ma ON ma.mar_id = d.ent_marche_id
WHERE f_type_visible(t.tyd_famille, t.tyd_actif);
