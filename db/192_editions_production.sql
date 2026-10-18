-- =============================================================================
-- Cœur LogiBTP – production des éditions en GED (module Édition, modules/edition/db/091) : catégories GED des PDF
-- produits par le serveur (« edition ») et des images des modèles (« ressource_edition » : logo, logos de
-- qualification… désignés par un code). Rejouable.
-- =============================================================================
UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"edition","libelle":"Édition (PDF produit)"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"edition"}]'::jsonb;
UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"ressource_edition","libelle":"Image des éditions (logo…)"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"ressource_edition"}]'::jsonb;
