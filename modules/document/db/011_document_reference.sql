-- =============================================================================
-- Module Document – référentiel fixe : types de lignes (identifiants repris par les moteurs, TL).
-- =============================================================================

-- Types de lignes : identifiants fixes, repris par les deux moteurs de calcul (TL).
INSERT INTO type_ligne (tyl_id, tyl_code, tyl_libelle, tyl_est_chiffree, tyl_est_numerotee, tyl_accepte_enfants, tyl_est_pied) VALUES
 ( 1, 'TITRE',      'Titre',             FALSE, TRUE,  TRUE,  FALSE),
 ( 2, 'OUVRAGE',    'Ouvrage',           TRUE,  TRUE,  TRUE,  FALSE),
 ( 3, 'ELEMENT',    'Élément',           TRUE,  TRUE,  FALSE, FALSE),
 ( 4, 'TEXTE',      'Texte',             FALSE, FALSE, FALSE, FALSE),
 ( 5, 'SOUS_TOTAL', 'Sous-total',        FALSE, FALSE, FALSE, FALSE),
 ( 6, 'IMAGE',      'Image',             FALSE, FALSE, FALSE, FALSE),
 ( 7, 'SAUT_PAGE',  'Saut de page',      FALSE, FALSE, FALSE, FALSE),
 ( 8, 'PIED_HT',    'Poste de pied HT',  FALSE, FALSE, FALSE, TRUE),
 ( 9, 'PIED_TTC',   'Poste de pied TTC', FALSE, FALSE, FALSE, TRUE),
 (10, 'TVA',        'Ventilation TVA',   FALSE, FALSE, FALSE, TRUE);
