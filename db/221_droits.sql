-- Module Droits (modules/droits/db/009), reprise des droits historiques dans l'arbre ; rejouable (une ligne déjà
-- présente n'est jamais écrasée : le paramétrage fait depuis l'écran des droits est conservé).
-- Nœuds du cœur : documents/{famille}/{code}, fiches/{type}, crm, modules (SpecialisationDroitsBtp).

-- Profils encore inconnus employés par les comptes ou les droits historiques.
INSERT INTO profil (pro_code, pro_libelle)
SELECT DISTINCT c, initcap(c) FROM (
    SELECT cpt_profil FROM compte UNION SELECT drt_profil FROM droit_document UNION SELECT drf_profil FROM droit_fiche
    UNION SELECT cdr_profil FROM crm_droit) x(c)
WHERE c ~ '^[A-Z][A-Z0-9_]{1,29}$'
ON CONFLICT (pro_code) DO NOTHING;

-- Documents (droit_document) : consultation de tous les types, puis par type ; TRANSFORMER = consulter la source,
-- APPROUVER = valider, DEVALIDER = déverrouiller.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT DISTINCT p.pro_id, 'documents', '{"CONSULTER":"TOUT"}'::jsonb
FROM droit_document d JOIN profil p ON p.pro_code = d.drt_profil AND NOT p.pro_total
ON CONFLICT DO NOTHING;

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT p.pro_id, 'documents/' || t.tyd_famille || '/' || t.tyd_code, jsonb_object_agg(a.action, 'TOUT')
FROM droit_document d
JOIN profil p ON p.pro_code = d.drt_profil AND NOT p.pro_total
JOIN type_document t ON t.tyd_id = d.drt_tyd_id
CROSS JOIN LATERAL (VALUES
    (CASE d.drt_action WHEN 'TRANSFORMER' THEN 'CONSULTER' WHEN 'APPROUVER' THEN 'VALIDER' WHEN 'DEVALIDER' THEN 'DEVERROUILLER' ELSE d.drt_action END),
    ('CONSULTER')) a(action)
GROUP BY p.pro_id, t.tyd_famille, t.tyd_code
ON CONFLICT DO NOTHING;

-- Fiches (droit_fiche) : VOIR = consulter, DEBLOQUER = déverrouiller, CONFIDENTIEL = RGPD ; modifier vaut créer.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT DISTINCT p.pro_id, 'fiches', '{}'::jsonb
FROM droit_fiche d JOIN profil p ON p.pro_code = d.drf_profil AND NOT p.pro_total
ON CONFLICT DO NOTHING;

INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT p.pro_id, 'fiches/' || d.drf_type, jsonb_object_agg(a.action, 'TOUT')
FROM droit_fiche d
JOIN profil p ON p.pro_code = d.drf_profil AND NOT p.pro_total
CROSS JOIN LATERAL (SELECT unnest(CASE d.drf_action
    WHEN 'VOIR' THEN ARRAY['CONSULTER'] WHEN 'DEBLOQUER' THEN ARRAY['DEVERROUILLER'] WHEN 'CONFIDENTIEL' THEN ARRAY['RGPD']
    WHEN 'MODIFIER' THEN ARRAY['MODIFIER', 'CREER'] ELSE ARRAY[d.drf_action] END)) a(action)
GROUP BY p.pro_id, d.drf_type
ON CONFLICT DO NOTHING;

-- Profil SAISIE : les modules comme avant le module Droits (tout sauf l'administration) ; pointage au service.
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT p.pro_id, m.noeud, m.actions::jsonb
FROM profil p
CROSS JOIN (VALUES
    ('listes', '{"CONSULTER":"TOUT","MODIFIER":"TOUT"}'),
    ('structure', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('annuaire', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('bibliotheque', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('ged', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('editions', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('ressources', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('calendriers', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('crm', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('reglement', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('execution', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('sous_traitance', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('stock', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('pointage', '{"CONSULTER":"SERVICE","MODIFIER":"SERVICE","CREER":"SERVICE","SUPPRIMER":"SERVICE"}'),
    ('pointage/bornes', '{}'),
    ('planning', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('mail', '{"CONSULTER":"TOUT","MODIFIER":"TOUT","CREER":"TOUT","SUPPRIMER":"TOUT"}'),
    ('connexions', '{"CONSULTER":"TOUT"}')) m(noeud, actions)
WHERE p.pro_code = 'SAISIE'
ON CONFLICT DO NOTHING;

-- CRM (crm_droit) : superviser, RGPD (s'ajoutent aux actions déjà posées sur le nœud crm).
INSERT INTO droit_profil (dpr_pro_id, dpr_noeud, dpr_actions)
SELECT p.pro_id, 'crm', jsonb_object_agg(d.cdr_action, 'TOUT')
FROM crm_droit d JOIN profil p ON p.pro_code = d.cdr_profil AND NOT p.pro_total
GROUP BY p.pro_id
ON CONFLICT (dpr_pro_id, dpr_noeud) DO UPDATE SET dpr_actions = droit_profil.dpr_actions || EXCLUDED.dpr_actions;
