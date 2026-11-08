-- =============================================================================
-- Cœur – module Relances, lot 7 (plans/relances.md, Q12, Q13 b). Rejouable.
--
-- Lettres de relance (COURRIER, RECOMMANDE, bascule d'un courriel sans adresse) : PDF produit par le module Édition
-- (source « relance » de Btp/EditionsBtp.cs, modèles RELANCE_1, RELANCE_2 et MISE_EN_DEMEURE fournis par
-- db/191_editions_modeles.sql, généré depuis client/src/app/editions/modeles.js), une lettre par groupe, rangée en GED
-- de chaque pièce relancée (type et groupe d'indices de la pièce) dans la catégorie « relance » ajoutée ici.
-- Recommandé : état ATTENTE_NUMERO jusqu'à la saisie de son numéro (PUT /api/relances/{id}/recommande), puis ENVOYEE.
-- =============================================================================

UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"relance","libelle":"Lettre de relance"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"relance"}]'::jsonb;
