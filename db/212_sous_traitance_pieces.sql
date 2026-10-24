-- =============================================================================
-- Cœur – module Sous-traitance, lot 2 (modules/sous-traitance/db/092, module GED 052) : catégories GED des pièces
-- exigées (pièces annexes du sous-traitant, documents du marché) qui manquent encore. Rejouable.
-- =============================================================================

UPDATE parametre_ged g SET pge_valeur = g.pge_valeur || x.ajout
FROM (
    SELECT coalesce(jsonb_agg(c), '[]'::jsonb) AS ajout
    FROM jsonb_array_elements('[
      {"code":"lnte","libelle":"Liste des salariés étrangers (LNTE)"},
      {"code":"attestation_fiscale","libelle":"Attestation de régularité fiscale"},
      {"code":"assurance_decennale","libelle":"Attestation d''assurance décennale","coffre":true},
      {"code":"dc4","libelle":"Déclaration de sous-traitance (DC4)"},
      {"code":"acte_special","libelle":"Acte spécial"},
      {"code":"contrat_sous_traitance","libelle":"Contrat de sous-traitance"},
      {"code":"agrement_moa","libelle":"Agrément du maître d''ouvrage"},
      {"code":"caution","libelle":"Caution bancaire"},
      {"code":"delegation_paiement","libelle":"Délégation de paiement"}
    ]'::jsonb) c
    WHERE NOT EXISTS (SELECT 1 FROM parametre_ged p, jsonb_array_elements(p.pge_valeur) e
                      WHERE p.pge_cle = 'categories' AND e ->> 'code' = c ->> 'code')
) x
WHERE g.pge_cle = 'categories';

-- Modèle de courriel de la demande de pièces (module Mail : élément « st_pieces »).
INSERT INTO mail_modele (mmo_code, mmo_libelle, mmo_usage, mmo_type, mmo_objet, mmo_corps_html, mmo_defaut)
VALUES ('ST_PIECES', 'Sous-traitance : demande de pièces', 'DOCUMENT_ACHAT', 'st_pieces', 'Pièces à nous transmettre – {{document}}',
        '<p>Bonjour,</p><p>Pour {{document}}, merci de nous transmettre les pièces suivantes : {{pieces_manquantes}}.</p><p>Pièces à renouveler prochainement : {{pieces_a_renouveler}}.</p><p>Cordialement,<br>{{utilisateur}}</p>', TRUE)
ON CONFLICT (mmo_code) DO NOTHING;
