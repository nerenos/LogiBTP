-- =============================================================================
-- Cœur LogiBTP – données de référence : types de documents, statuts, TVA,
-- transformations autorisées et droits du profil ADMIN.
-- =============================================================================

-- Types de documents : trois familles (V vente, A achat, S stock).
INSERT INTO type_document (tyd_code, tyd_libelle, tyd_famille, tyd_sens, tyd_prefixe_numero, tyd_numerotation_continue, tyd_mouvemente_stock, tyd_handler) VALUES
 ('V_DEVIS',       'Devis client',                   'V', 1, 'DV',  FALSE, FALSE, NULL),
 ('V_COMMANDE',    'Commande client',                'V', 1, 'CC',  FALSE, FALSE, NULL),
 ('V_RECEPTION',   'Bon de livraison',               'V', 1, 'BL',  FALSE, TRUE,  NULL),
 ('V_RETOUR',      'Retour client',                  'V', 1, 'RC',  FALSE, TRUE,  NULL),
 ('V_FACTURE',     'Facture',                        'V', 1, 'FA',  TRUE,  FALSE, NULL),
 ('V_FACTURE_AVT', 'Facture d''avancement',          'V', 1, 'SI',  TRUE,  FALSE, 'FactureAvancement'),
 ('V_AVOIR',       'Avoir',                          'V', 1, 'AV',  TRUE,  FALSE, NULL),
 ('A_DEVIS',       'Demande de prix fournisseur',    'A', 2, 'DF',  FALSE, FALSE, NULL),
 ('A_COMMANDE',    'Commande fournisseur',           'A', 2, 'CF',  FALSE, FALSE, NULL),
 ('A_RECEPTION',   'Réception fournisseur',          'A', 2, 'RF',  FALSE, TRUE,  NULL),
 ('A_RETOUR',      'Retour fournisseur',             'A', 2, 'RR',  FALSE, TRUE,  NULL),
 ('A_FACTURE',     'Facture fournisseur',            'A', 2, 'FF',  FALSE, FALSE, NULL),
 ('A_FACTURE_AVT', 'Situation fournisseur',          'A', 2, 'SF',  FALSE, FALSE, 'FactureAvancement'),
 ('A_AVOIR',       'Avoir fournisseur',              'A', 2, 'AF',  FALSE, FALSE, NULL),
 ('S_DEMANDE',     'Demande d''approvisionnement',   'S', 3, 'DA',  FALSE, FALSE, NULL),
 ('S_RESERVATION', 'Réservation',                    'S', 3, 'RS',  FALSE, FALSE, NULL),
 ('S_ENTREE',      'Entrée de stock',                'S', 3, 'ES',  FALSE, TRUE,  NULL),
 ('S_SORTIE',      'Sortie de stock',                'S', 3, 'SS',  FALSE, TRUE,  NULL),
 ('S_TRANSFERT',   'Transfert de stock',             'S', 3, 'TS',  FALSE, TRUE,  NULL),
 ('S_INVENTAIRE',  'Bordereau d''inventaire',        'S', 3, 'BI',  FALSE, TRUE,  NULL);

-- Statuts : brouillon modifiable, puis statuts bloqués ; les statuts terminaux rendent le document archivable.
INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, s.code, s.libelle, s.modifiable, s.terminal, s.ordre
FROM type_document t
CROSS JOIN (VALUES
    ('BROUILLON', 'Brouillon', TRUE,  FALSE, 1),
    ('VALIDE',    'Validé',    FALSE, FALSE, 2),
    ('SOLDE',     'Soldé',     FALSE, TRUE,  3),
    ('ANNULE',    'Annulé',    FALSE, TRUE,  4)
) AS s(code, libelle, modifiable, terminal, ordre);

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, 'FACTURE', 'Facturé', FALSE, TRUE, 5
FROM type_document t WHERE t.tyd_code IN ('V_DEVIS','V_COMMANDE','V_RECEPTION','A_COMMANDE','A_RECEPTION');

INSERT INTO statut_document (std_tyd_id, std_code, std_libelle, std_modifiable, std_terminal, std_ordre)
SELECT t.tyd_id, 'ACCEPTE', 'Accepté', FALSE, FALSE, 3
FROM type_document t WHERE t.tyd_code IN ('V_DEVIS','A_DEVIS');

-- Taux de TVA : chaque taux porte une catégorie (calcul, écritures) et une mention légale.
INSERT INTO taux_tva (ttv_code, ttv_libelle, ttv_taux, ttv_categorie, ttv_mention) VALUES
 ('T20',   'TVA 20 %',                          20,  'N', NULL),
 ('T10',   'TVA 10 % (travaux de rénovation)',  10,  'N', NULL),
 ('T55',   'TVA 5,5 % (rénovation énergétique)', 5.5, 'N', NULL),
 ('AL20',  'Autoliquidation sous-traitance BTP', 20,  'A', 'Autoliquidation – TVA due par le preneur (article 283-2 nonies du CGI)'),
 ('IC20',  'Intracommunautaire 20 %',           20,  'I', 'Autoliquidation intracommunautaire (article 283-2 du CGI)'),
 ('EXO',   'Exonéré ou export',                 0,   'E', 'Exonération de TVA (article 262 ter I du CGI)');

-- Transformations autorisées : tout couple déclaré est possible, y compris en sautant des étapes
-- ou entre familles. tra_vaut_etapes indique les étapes sautées que la cible couvre.
INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape, tra_vaut_etapes)
SELECT s.tyd_id, c.tyd_id, x.etape, x.vaut
FROM (VALUES
    ('V_DEVIS',     'V_COMMANDE',    'COMMANDE',    NULL::VARCHAR(20)[]),
    ('V_DEVIS',     'V_FACTURE',     'FACTURATION', ARRAY['COMMANDE','RECEPTION']::VARCHAR(20)[]),
    ('V_DEVIS',     'V_FACTURE_AVT', 'FACTURATION', ARRAY['COMMANDE']::VARCHAR(20)[]),
    ('V_DEVIS',     'A_COMMANDE',    'COMMANDE',    NULL),
    ('V_COMMANDE',  'V_RECEPTION',   'RECEPTION',   NULL),
    ('V_COMMANDE',  'V_FACTURE',     'FACTURATION', ARRAY['RECEPTION']::VARCHAR(20)[]),
    ('V_COMMANDE',  'V_FACTURE_AVT', 'FACTURATION', NULL),
    ('V_COMMANDE',  'A_COMMANDE',    'COMMANDE',    NULL),
    ('V_RECEPTION', 'V_FACTURE',     'FACTURATION', NULL),
    ('V_RECEPTION', 'V_RETOUR',      'RETOUR',      NULL),
    ('V_FACTURE',   'V_AVOIR',       'AVOIR',       NULL),
    ('A_DEVIS',     'A_COMMANDE',    'COMMANDE',    NULL),
    ('A_COMMANDE',  'A_RECEPTION',   'RECEPTION',   NULL),
    ('A_COMMANDE',  'A_FACTURE',     'FACTURATION', ARRAY['RECEPTION']::VARCHAR(20)[]),
    ('A_COMMANDE',  'A_FACTURE_AVT', 'FACTURATION', NULL),
    ('A_RECEPTION', 'A_FACTURE',     'FACTURATION', NULL),
    ('A_RECEPTION', 'A_RETOUR',      'RETOUR',      NULL),
    ('A_FACTURE',   'A_AVOIR',       'AVOIR',       NULL),
    ('S_DEMANDE',   'A_COMMANDE',    'COMMANDE',    NULL),
    ('S_DEMANDE',   'S_RESERVATION', 'RESERVATION', NULL),
    ('S_RESERVATION','S_SORTIE',     'SORTIE',      NULL)
) AS x(source, cible, etape, vaut)
JOIN type_document s ON s.tyd_code = x.source
JOIN type_document c ON c.tyd_code = x.cible;

-- Droits du profil ADMIN : toutes les actions sur tous les types.
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'ADMIN', t.tyd_id, a.action
FROM type_document t
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('VALIDER'), ('TRANSFORMER'), ('SUPPRIMER')) AS a(action);

-- Profil SAISIE : création et modification des documents de vente et d'achat, sans validation.
INSERT INTO droit_document (drt_profil, drt_tyd_id, drt_action)
SELECT 'SAISIE', t.tyd_id, a.action
FROM type_document t
CROSS JOIN (VALUES ('CREER'), ('MODIFIER'), ('TRANSFORMER')) AS a(action)
WHERE t.tyd_famille IN ('V','A');

-- Durée de validité proposée à la création des offres (champ ent_validite_jours du document).
UPDATE type_document SET tyd_validite_jours = 30 WHERE tyd_code IN ('V_DEVIS', 'A_DEVIS');

-- Propriétés spécifiques d'exemple : définition servant à générer l'interface et à valider les valeurs.
INSERT INTO propriete_definition (prd_tyd_id, prd_niveau, prd_code, prd_libelle, prd_type_donnee, prd_obligatoire, prd_valeur_defaut, prd_options, prd_groupe, prd_ordre)
SELECT t.tyd_id, p.niveau, p.code, p.libelle, p.type, p.obligatoire, p.defaut::jsonb, p.options::jsonb, p.groupe, p.ordre
FROM type_document t
CROSS JOIN (VALUES
    ('E', 'mode_reglement',  'Mode de règlement',       'liste',   FALSE, '"VIR"',
        '[{"code":"VIR","libelle":"Virement"},{"code":"CHQ","libelle":"Chèque"},{"code":"LCR","libelle":"LCR"}]', 'Conditions', 3),
    ('L', 'lot_technique',   'Lot technique',           'texte',   FALSE, NULL,   NULL, NULL, 1)
) AS p(niveau, code, libelle, type, obligatoire, defaut, options, groupe, ordre)
WHERE t.tyd_code = 'V_DEVIS';

-- Unités proposées à la saisie.
INSERT INTO unite (unt_code, unt_libelle, unt_precision_qte, unt_ordre) VALUES
 ('u',    'Unité',            0, 1),
 ('ens',  'Ensemble',         0, 2),
 ('ft',   'Forfait',          0, 3),
 ('pce',  'Pièce',            0, 4),
 ('m',    'Mètre',            2, 10),
 ('ml',   'Mètre linéaire',   2, 11),
 ('m2',   'Mètre carré',      2, 12),
 ('m3',   'Mètre cube',       3, 13),
 ('cm',   'Centimètre',       1, 14),
 ('mm',   'Millimètre',       0, 15),
 ('km',   'Kilomètre',        3, 16),
 ('kg',   'Kilogramme',       2, 20),
 ('t',    'Tonne',            3, 21),
 ('l',    'Litre',            2, 22),
 ('h',    'Heure',            2, 30),
 ('j',    'Jour',             2, 31),
 ('sem',  'Semaine',          2, 32),
 ('mois', 'Mois',             2, 33),
 ('sac',  'Sac',              0, 40),
 ('pal',  'Palette',          0, 41),
 ('rl',   'Rouleau',          0, 42),
 ('bte',  'Boîte',            0, 43),
 ('lot',  'Lot',              0, 44)
ON CONFLICT (unt_code) DO NOTHING;
