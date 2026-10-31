-- Ergonomie, lot E4 (L2, ANALYSE-ERGONOMIE.md) : code du statut et état affiché des documents pour les pastilles
-- des listes, colonnes ajoutées en fin de v_liste_documents (reprise de 208) ; v_liste_ordres (reprise de 209) est
-- recréée pour les recevoir (v.* figé à la création de la vue).

DROP VIEW IF EXISTS v_liste_ordres;

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
       s.std_code                                 AS statut_code,
       -- État affiché (pastille) : refusé si rejeté ou non retenu, expiré si la validité est dépassée (comme l'alerte),
       -- sinon le code du statut. Jamais de changement de statut (Q3).
       CASE
         WHEN s.std_code IN ('ANNULE', 'REMPLACE') THEN s.std_code
         WHEN d.ent_rejete_le IS NOT NULL OR s.std_code = 'NON_RETENU' THEN 'REFUSE'
         WHEN d.ent_date_validite < current_date AND s.std_code IN ('APPROUVE', 'ENVOYE')
              AND coalesce(f_regle_document('VALIDITE_ALERTE', t.tyd_id) = 'true'::jsonb, false) THEN 'EXPIRE'
         ELSE s.std_code
       END::text                                  AS etat
FROM document d
JOIN type_document t ON t.tyd_id = d.ent_tyd_id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN personne pe ON pe.per_id = d.ent_tiers_id
LEFT JOIN projet pr ON pr.prj_id = coalesce(d.ent_projet_id, (SELECT cha_prj_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN affaire af ON af.aff_id = coalesce(d.ent_affaire_id, (SELECT cha_aff_id FROM chantier WHERE cha_id = d.ent_chantier_id))
LEFT JOIN chantier ch ON ch.cha_id = d.ent_chantier_id
LEFT JOIN marche ma ON ma.mar_id = d.ent_marche_id
WHERE f_type_visible(t.tyd_famille, t.tyd_actif);

-- Liste des ordres (reprise de 209) : statut_code et etat à la suite des colonnes de v_liste_documents.
CREATE VIEW v_liste_ordres AS
SELECT v.*, d.ent_exe_etat AS etat_execution, m.mot_libelle AS motif, sv.srv_libelle AS service, sv.srv_id AS service_id,
       concat_ws(' ', r.ind_prenom, r.ind_nom) AS responsable, d.ent_debut_prevu AS debut_prevu, d.ent_fin_prevue AS fin_prevue,
       (SELECT sum(h.heures) FROM v_heures_lignes h WHERE h.ent_id = d.ent_id) AS heures_budget,
       CASE WHEN s.std_code IN ('ANNULE', 'REMPLACE', 'SOLDE') OR coalesce(d.ent_exe_etat, '') = 'TERMINE' THEN FALSE
            WHEN d.ent_fin_prevue < current_date THEN TRUE
            WHEN EXISTS (SELECT 1 FROM exe_ordre_etape e WHERE e.ore_ordre_id = d.ent_id AND e.ore_valide_le IS NULL AND e.ore_prevu_le < current_date) THEN TRUE
            ELSE FALSE END AS en_retard,
       (SELECT e.ore_libelle FROM exe_ordre_etape e WHERE e.ore_ordre_id = d.ent_id AND e.ore_valide_le IS NULL ORDER BY e.ore_ordre LIMIT 1) AS etape_en_cours,
       (SELECT min(e.ore_prevu_le) FROM exe_ordre_etape e WHERE e.ore_ordre_id = d.ent_id AND e.ore_valide_le IS NULL AND e.ore_date_obligatoire) AS prochaine_date,
       d.ent_ressource ->> 'libelle' AS ressource
FROM v_liste_documents v
JOIN document d ON d.ent_id = v.id
JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN motif m ON m.mot_id = d.ent_exe_motif_id
LEFT JOIN service sv ON sv.srv_id = d.ent_srv_id
LEFT JOIN individu r ON r.ind_id = d.ent_responsable_id
WHERE v.famille = 'E';
