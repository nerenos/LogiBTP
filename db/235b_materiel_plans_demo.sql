-- =============================================================================
-- Cœur – plans d'entretien du matériel : plans de démonstration des types Engins, Levage, Véhicules (une fois, table
-- vide). Extrait de 235_materiel_plans.sql ; script de démonstration (indicateur « demo » du manifeste), appliqué
-- juste après 235.
-- =============================================================================

INSERT INTO materiel_plan (mpl_type, mpl_code, mpl_libelle, mpl_operations, mpl_nature, mpl_heures, mpl_km, mpl_mois, mpl_ordre, mpl_maj_par)
SELECT x.type, x.code, x.libelle, x.operations, x.nature, x.heures, x.km, x.mois, x.ordre, 'demo'
FROM (VALUES
    ('ENGINS', 'VIDANGE', 'Vidange moteur et filtres', E'Vidange huile moteur\nFiltres à huile, à air et à gazole\nContrôle des niveaux', 'PREVENTIF', 250, NULL, 12, 10),
    ('ENGINS', 'GRAISSAGE', 'Graissage des articulations', 'Graissage de toutes les articulations', 'PREVENTIF', 50, NULL, NULL, 20),
    ('LEVAGE', 'REVISION', 'Révision annuelle', E'Contrôle des organes de levage\nVidange hydraulique', 'PREVENTIF', 500, NULL, 12, 10),
    ('VEHICULES', 'REVISION', 'Révision constructeur', E'Vidange et filtres\nContrôle des freins', 'PREVENTIF', NULL, 20000, 12, 10),
    ('VEHICULES', 'PNEUS', 'Contrôle et permutation des pneus', 'Usure, pression, permutation', 'PREVENTIF', NULL, 10000, NULL, 20)
) AS x(type, code, libelle, operations, nature, heures, km, mois, ordre)
WHERE NOT EXISTS (SELECT 1 FROM materiel_plan);
