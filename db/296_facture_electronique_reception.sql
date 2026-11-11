-- =============================================================================
-- Cœur – factures électroniques reçues (plans/facturation-electronique.md, lot 12). Rejouable.
--   v_liste_fe_recues : une facture reçue (flux entrant de type facture) par ligne, avec le résumé lu (étape LECTURE du
--   journal fe_evenement : vendeur, date, totaux), la pièce créée ou rattachée (fe_flux.ffl_type_element = 'DOCUMENT')
--   et « à traiter » : sans pièce (reçue, en erreur, doublon refusé) ou pièce encore en brouillon (jamais validée
--   automatiquement). Ligne avec pièce : la pièce (type du document, ent_id) ; sans pièce : le flux (fe_flux, ffl_id).
--   Source de liste « fe_recues » (déclarée dans client/src/app/vues-liste.js, thème et vue par défaut : db/121).
-- =============================================================================

CREATE OR REPLACE VIEW v_liste_fe_recues AS
SELECT coalesce(d.ent_id, f.ffl_id) AS id, coalesce(t.tyd_code, 'fe_flux')::text AS type_element,
       f.ffl_id AS flux_id, f.ffl_cree_le AS recue_le, f.ffl_numero::text AS numero,
       coalesce(p.per_raison_sociale, l.fev_detail -> 'vendeur' ->> 'raison_sociale')::text AS fournisseur,
       (l.fev_detail -> 'vendeur' ->> 'siren')::text AS siren,
       CASE WHEN (l.fev_detail ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (l.fev_detail ->> 'date')::date END AS date_facture,
       CASE WHEN jsonb_typeof(l.fev_detail -> 'total_ht') = 'number' THEN (l.fev_detail ->> 'total_ht')::numeric END AS total_ht,
       CASE WHEN jsonb_typeof(l.fev_detail -> 'total_ttc') = 'number' THEN (l.fev_detail ->> 'total_ttc')::numeric END AS total_ttc,
       f.ffl_etat::text AS etat, f.ffl_syntaxe::text AS syntaxe, f.ffl_connecteur::text AS connecteur,
       d.ent_id AS piece_id, t.tyd_code::text AS type_piece, d.ent_numero::text AS numero_piece, s.std_code::text AS statut_piece,
       coalesce(d.ent_verrouille, FALSE) AS piece_validee, coalesce(p.per_provisoire, FALSE) AS fournisseur_provisoire,
       f.ffl_derniere_erreur::text AS erreur,
       (f.ffl_etat <> 'ABANDONNE' AND (d.ent_id IS NULL OR NOT d.ent_verrouille)) AS a_traiter
FROM fe_flux f
LEFT JOIN document d ON f.ffl_type_element = 'DOCUMENT' AND f.ffl_id_element ~ '^\d+$' AND d.ent_id = f.ffl_id_element::bigint
LEFT JOIN type_document t ON t.tyd_id = d.ent_tyd_id
LEFT JOIN statut_document s ON s.std_id = d.ent_std_id
LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
LEFT JOIN LATERAL (SELECT e.fev_detail FROM fe_evenement e WHERE e.fev_ffl_id = f.ffl_id AND e.fev_type = 'LECTURE'
                   ORDER BY e.fev_rang DESC LIMIT 1) l ON TRUE
WHERE f.ffl_sens = 'In' AND f.ffl_type IN ('CustomerInvoice', 'SupplierInvoice') AND f_module_actif('facture_electronique');

INSERT INTO source_liste (sli_code, sli_libelle, sli_vue, sli_colonne_id, sli_colonne_type, sli_type_element, sli_modifiable)
VALUES ('fe_recues', 'Factures électroniques reçues', 'v_liste_fe_recues', 'id', 'type_element', NULL, FALSE)
ON CONFLICT (sli_code) DO UPDATE SET sli_libelle = EXCLUDED.sli_libelle, sli_vue = EXCLUDED.sli_vue,
    sli_colonne_id = EXCLUDED.sli_colonne_id, sli_colonne_type = EXCLUDED.sli_colonne_type;
