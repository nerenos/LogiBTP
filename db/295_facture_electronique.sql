-- =============================================================================
-- Cœur – module Facturation électronique, lot 11 (plans/facturation-electronique.md). Rejouable.
--
-- - activation par société (module_societe « facture_electronique », désactivé à la création : l'administrateur
--   l'active, puis règle la plateforme dans les paramètres du module, fe_parametre de modules/facture-electronique/db/099f) ;
-- - droits : les profils qui ont le nœud « comptabilite » reçoivent le nœud « facture_electronique » (Consulter : tableau
--   des flux, chronologies ; Modifier : nouvelle tentative, dépôt et import manuels, relève), mêmes portées ; une ligne
--   déjà présente n'est jamais écrasée ;
-- - catégorie de la GED « facture_electronique » (fichiers des flux rangés sur la pièce : original, lisible, CDAR) ;
-- - signaux de notification (facture_electronique_signal, codes SignauxFe de Domaine/Codes.cs ↔ SIGNAL_FE de codes.js) :
--   facture reçue, rejet (accusé en erreur ou statut 213), refus (210), litige (207), erreur de la file ; niveau et
--   activation par société, lus par Btp/FactureElectroniqueBtp.cs ; destinataires : comptes qui consultent le nœud.
--   Valeurs posées à la création seulement : un réglage de la société n'est pas remis au rejeu.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_actif, mod_ordre) VALUES
 ('facture_electronique', 'Facturation électronique', 'Réforme de la facturation électronique : plateforme agréée, flux émis et reçus, statuts du cycle de vie, journal des étapes', FALSE, 96)
ON CONFLICT (mod_code) DO NOTHING;

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT d.dpr_pro_id, 'facture_electronique',
       (SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) FROM jsonb_each(d.dpr_actions) e(k, v) WHERE e.k IN ('CONSULTER', 'MODIFIER'))
FROM droit_profil d WHERE d.dpr_noeud = 'comptabilite'
ON CONFLICT DO NOTHING;

UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"facture_electronique","libelle":"Facture électronique"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"facture_electronique"}]'::jsonb;

CREATE TABLE IF NOT EXISTS facture_electronique_signal (
    fsi_code     VARCHAR(20)   PRIMARY KEY CHECK (fsi_code IN ('RECUE', 'REJET', 'REFUS', 'LITIGE', 'ERREUR_FILE')),
    fsi_libelle  VARCHAR(100)  NOT NULL,
    fsi_niveau   VARCHAR(10)   NOT NULL DEFAULT 'INFO' CHECK (fsi_niveau IN ('INFO', 'ATTENTION', 'URGENT')),
    fsi_actif    BOOLEAN       NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE facture_electronique_signal IS 'Signaux de notification de la facturation électronique : niveau et activation par société';

INSERT INTO facture_electronique_signal (fsi_code, fsi_libelle, fsi_niveau) VALUES
 ('RECUE', 'Facture reçue à traiter', 'INFO'),
 ('REJET', 'Facture rejetée par la plateforme', 'URGENT'),
 ('REFUS', 'Facture refusée par le client', 'URGENT'),
 ('LITIGE', 'Facture en litige', 'ATTENTION'),
 ('ERREUR_FILE', 'Erreur de la file des flux', 'ATTENTION')
ON CONFLICT (fsi_code) DO NOTHING;
