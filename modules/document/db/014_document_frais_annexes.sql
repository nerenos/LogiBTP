-- =============================================================================
-- Module Document – type de prix F (frais annexes).
-- Une ligne (ou une tranche, et alors toute sa descendance, le type de prix étant hérité) marquée frais annexes est
-- affichée avec son PV mais reste hors des totaux, comme une option ; le moteur la force en « ne pas imprimer ». Sa
-- ventilation sur les autres lignes relève de la spécialisation (cœur BTP : coefficient de frais annexes).
-- Rejouable (DROP CONSTRAINT IF EXISTS, ON CONFLICT DO NOTHING).
-- =============================================================================

ALTER TABLE document_ligne DROP CONSTRAINT IF EXISTS document_ligne_lig_type_prix_check;
ALTER TABLE document_ligne ADD CONSTRAINT document_ligne_lig_type_prix_check
    CHECK (lig_type_prix IN ('V','O','M','A','F'));                      -- Vendu, Option, Mémoire, vAriante, Frais annexes

ALTER TABLE couleur_type_prix DROP CONSTRAINT IF EXISTS couleur_type_prix_ctp_type_check;
ALTER TABLE couleur_type_prix ADD CONSTRAINT couleur_type_prix_ctp_type_check CHECK (ctp_type IN ('O','M','A','F'));

INSERT INTO couleur_type_prix (ctp_type, ctp_libelle, ctp_couleur) VALUES
 ('F', 'Frais annexes', '#f97316')
ON CONFLICT (ctp_type) DO NOTHING;
