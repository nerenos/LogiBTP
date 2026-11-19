-- =============================================================================
-- Cœur – liste du suivi des flux de facturation électronique (vues Total, Émis, Reçus ; 19/11/2026).
--   v_liste_fe_flux : un flux par ligne (factures, statuts CDAR, e-reporting, émis et reçus), avec son numéro interne
--   (ffl_id), l'identifiant donné par la plateforme (flowId), la facture visée et la pièce rattachée
--   (ffl_type_element = 'DOCUMENT'). Ligne de type « fe_flux » : la fiche du flux (/facture-electronique?flux=<id>).
--   Source de liste « fe_flux » (déclarée dans client/src/app/vues-liste.js, thème et vues par défaut : db/121).
-- =============================================================================

CREATE OR REPLACE VIEW v_liste_fe_flux AS
SELECT f.ffl_id AS id, 'fe_flux'::text AS type_element, f.ffl_id AS numero_flux, f.ffl_id_flux::text AS id_plateforme,
       f.ffl_sens::text AS sens, f.ffl_type::text AS type_flux, f.ffl_numero::text AS numero, f.ffl_nom::text AS nom,
       f.ffl_cree_le AS cree_le, f.ffl_depose_le AS depose_le, f.ffl_modifie_le AS modifie_le,
       f.ffl_etat::text AS etat, f.ffl_accuse::text AS accuse, f.ffl_syntaxe::text AS syntaxe, f.ffl_profil::text AS profil,
       f.ffl_regle::text AS regle, f.ffl_connecteur::text AS connecteur, f.ffl_essais AS essais,
       coalesce(p.per_raison_sociale, (SELECT e.fev_detail -> 'vendeur' ->> 'raison_sociale' FROM fe_evenement e
                WHERE e.fev_ffl_id = f.ffl_id AND e.fev_type = 'LECTURE' ORDER BY e.fev_rang DESC LIMIT 1))::text AS tiers,
       f.ffl_type_element::text AS element, d.ent_id AS piece_id, t.tyd_code::text AS type_piece, d.ent_numero::text AS numero_piece,
       f.ffl_derniere_erreur::text AS erreur, (f.ffl_etat = 'ERREUR' OR f.ffl_derniere_erreur IS NOT NULL) AS en_erreur
FROM fe_flux f
LEFT JOIN document d ON f.ffl_type_element = 'DOCUMENT' AND f.ffl_id_element ~ '^\d+$' AND d.ent_id = f.ffl_id_element::bigint
LEFT JOIN type_document t ON t.tyd_id = d.ent_tyd_id
LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
WHERE f_module_actif('facture_electronique');

INSERT INTO source_liste (sli_code, sli_libelle, sli_vue, sli_colonne_id, sli_colonne_type, sli_type_element, sli_modifiable)
VALUES ('fe_flux', 'Flux de facturation électronique', 'v_liste_fe_flux', 'id', 'type_element', NULL, FALSE)
ON CONFLICT (sli_code) DO UPDATE SET sli_libelle = EXCLUDED.sli_libelle, sli_vue = EXCLUDED.sli_vue,
    sli_colonne_id = EXCLUDED.sli_colonne_id, sli_colonne_type = EXCLUDED.sli_colonne_type;
