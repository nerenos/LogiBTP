-- =============================================================================
-- Cœur – reprises de données (TODO : revue du code, lot F ; ergonomie L2 ; vue « Complet »). Rejouable.
--
-- 1. Identifiant de connexion d'un individu (ind_utilisateur) en minuscules, comme le code du compte
--    (ReglesCompte.Normaliser) : une seule casse, comparée sans lower() dans les requêtes du cœur.
-- 2. Vues de liste des documents et des ordres enregistrées avant les pastilles (db/253) : la colonne « statut »
--    (libellé) visible devient la pastille « etat », le libellé reste masqué ; segments sur le statut passés sur l'état.
-- 3. Vue de colonnes par défaut « Complet » (vdo_id 1) : Compte (après Nature) et Commentaire (à la fin) ajoutés s'ils
--    manquent (150 ne réécrit pas une vue existante).
-- =============================================================================

-- 1. Identifiant de connexion en minuscules.
CREATE OR REPLACE FUNCTION f_individu_utilisateur() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.ind_utilisateur := nullif(lower(trim(NEW.ind_utilisateur)), '');
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_individu_utilisateur ON individu;
CREATE TRIGGER tr_individu_utilisateur BEFORE INSERT OR UPDATE OF ind_utilisateur ON individu
    FOR EACH ROW EXECUTE FUNCTION f_individu_utilisateur();
UPDATE individu SET ind_utilisateur = ind_utilisateur
 WHERE ind_utilisateur IS DISTINCT FROM nullif(lower(trim(ind_utilisateur)), '');

-- 2. Vues de liste : statut (libellé) visible → pastille etat. La définition de la pastille est reprise d'une vue par
-- défaut de la même source (121, régénérée depuis vues-liste.js).
WITH modeles AS (
    SELECT DISTINCT ON (x.vli_definition->'source'->>'vue') x.vli_definition->'source'->>'vue' AS source, c AS etat
    FROM vue_liste x, jsonb_array_elements(x.vli_definition->'colonnes') c
    WHERE x.vli_definition->'source'->>'vue' IN ('documents', 'ordres') AND c->>'code' = 'etat' AND c->>'format' = 'pastille'
    ORDER BY x.vli_definition->'source'->>'vue', x.vli_id
),
a_reprendre AS (
    SELECT v.vli_id, m.etat
    FROM vue_liste v JOIN modeles m ON m.source = v.vli_definition->'source'->>'vue'
    WHERE NOT (v.vli_definition->'colonnes' @> '[{"code": "etat"}]')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.vli_definition->'colonnes') c
                   WHERE c->>'code' = 'statut' AND NOT coalesce((c->>'masquee')::boolean, FALSE))
)
UPDATE vue_liste v
   SET vli_definition = jsonb_set(jsonb_set(v.vli_definition,
           '{colonnes}', (SELECT jsonb_agg(e ORDER BY o, s)
                          FROM (SELECT CASE WHEN c->>'code' = 'statut' THEN r.etat || CASE WHEN c ? 'largeur' THEN jsonb_build_object('largeur', c->'largeur') ELSE '{}'::jsonb END ELSE c END AS e, o, 0 AS s
                                FROM jsonb_array_elements(v.vli_definition->'colonnes') WITH ORDINALITY AS t(c, o)
                                UNION ALL
                                SELECT c || '{"titre": "Libellé du statut", "masquee": true}'::jsonb, o, 1
                                FROM jsonb_array_elements(v.vli_definition->'colonnes') WITH ORDINALITY AS t(c, o) WHERE c->>'code' = 'statut') z)),
           '{segments}', coalesce((SELECT jsonb_agg(CASE WHEN g->>'colonne' = 'statut' THEN jsonb_set(g, '{colonne}', '"etat"') ELSE g END ORDER BY o)
                                   FROM jsonb_array_elements(v.vli_definition->'segments') WITH ORDINALITY AS u(g, o)), '[]'::jsonb)),
       vli_modifie_le = now()
  FROM a_reprendre r
 WHERE v.vli_id = r.vli_id;

-- 3. Vue « Complet » : Compte après Nature, Commentaire à la fin.
UPDATE vue_document
   SET vdo_definition = jsonb_set(vdo_definition, '{colonnes}',
       (SELECT jsonb_agg(e ORDER BY o, s) FROM (
            SELECT c AS e, o, 0 AS s FROM jsonb_array_elements(vdo_definition->'colonnes') WITH ORDINALITY AS t(c, o)
            UNION ALL
            SELECT '{"cle": "compte"}'::jsonb, o, 1 FROM jsonb_array_elements(vdo_definition->'colonnes') WITH ORDINALITY AS t(c, o) WHERE c->>'cle' = 'nature'
            UNION ALL
            SELECT '{"cle": "commentaire"}'::jsonb, 100000, 2) z
        WHERE NOT (e->>'cle' = 'compte' AND s = 1 AND vdo_definition->'colonnes' @> '[{"cle": "compte"}]')
          AND NOT (e->>'cle' = 'commentaire' AND s = 2 AND vdo_definition->'colonnes' @> '[{"cle": "commentaire"}]')))
 WHERE vdo_id = 1
   AND NOT (vdo_definition->'colonnes' @> '[{"cle": "compte"}]' AND vdo_definition->'colonnes' @> '[{"cle": "commentaire"}]');
