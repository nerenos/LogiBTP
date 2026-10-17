-- =============================================================================
-- Cœur LogiBTP – corrections issues de l'analyse des règles (CONCEPTION-REGLES-DOCUMENTS.md, I8) : la propriété
-- d'entête « chantier » du devis (texte obligatoire) est retirée, le rattachement à la structure la remplace.
-- Rejouable.
-- =============================================================================

DELETE FROM propriete_definition WHERE prd_code = 'chantier' AND prd_niveau = 'E';
