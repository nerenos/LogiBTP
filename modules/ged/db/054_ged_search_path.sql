-- =============================================================================
-- Module GED – chemin de recherche des fonctions des colonnes générées et des index (TODO, Installation). Rejouable.
--
-- pg_restore recrée les colonnes générées (dge_recherche, dge_plein_texte) et les index par expression avec un
-- search_path vide : f_ged_plein_texte appelle f_ged_normaliser sans schéma et échouerait. Le chemin est fixé sur les
-- fonctions elles-mêmes (schéma de la base : public), pour qu'une restauration directe fonctionne.
-- =============================================================================

ALTER FUNCTION f_ged_normaliser(TEXT) SET search_path = public;
ALTER FUNCTION f_ged_plein_texte(TEXT, TEXT[], TEXT, TEXT, JSONB, TEXT) SET search_path = public;
