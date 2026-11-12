-- =============================================================================
-- Cœur – pièces de stock sans validation du tiers (12/11/2026, trouvé par les scénarios e2e du stock). Rejouable.
--
-- Une pièce de stock (famille S : entrée, sortie, transfert, demande, réservation, écarts d'inventaire) a pour tiers
-- notre société : validée, elle restait « Envoyé » en attendant une « validation du tiers » sans objet. Règle
-- VALIDATION_TIERS à faux pour la famille (valeur déjà paramétrée gardée) ; pièces déjà envoyées : validées du tiers à
-- la date de l'envoi, statut recalculé (f_document_statut).
-- =============================================================================

INSERT INTO regle_document (rdo_code, rdo_famille, rdo_valeur)
VALUES ('VALIDATION_TIERS', 'S', 'false'::jsonb)
ON CONFLICT DO NOTHING;

WITH envoyees AS (
    UPDATE document d SET ent_valide_tiers_le = d.ent_envoye_le
    FROM type_document t
    WHERE t.tyd_id = d.ent_tyd_id AND t.tyd_famille = 'S' AND d.ent_envoye_le IS NOT NULL AND d.ent_valide_tiers_le IS NULL
      AND NOT EXISTS (SELECT 1 FROM regle_document r WHERE r.rdo_code = 'VALIDATION_TIERS' AND r.rdo_tyd_id = t.tyd_id AND r.rdo_valeur = 'true'::jsonb)
      AND (SELECT r.rdo_valeur FROM regle_document r WHERE r.rdo_code = 'VALIDATION_TIERS' AND r.rdo_famille = 'S' AND r.rdo_tyd_id IS NULL) = 'false'::jsonb
    RETURNING d.ent_id)
SELECT count(f_document_statut(ent_id)) FROM envoyees;
