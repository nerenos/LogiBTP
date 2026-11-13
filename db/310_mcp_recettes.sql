-- =============================================================================
-- Cœur – module MCP, lot 13 (plans/mcp.md ; ANALYSE-MODULE-MCP.md § 7 et 10.2). Rejouable.
--
-- Recettes fournies (mcp_recette du module, modules/mcp/db/099x) : prompts paramétrés exposés aux agents comme prompts
-- MCP (seulement aux délégations qui permettent tous leurs outils : noms du catalogue de SpecialisationMcpBtp) et proposés
-- par le bouton « Demander à l'agent » des fiches marché et chantier et des pièces (paramètre MARCHE, CHANTIER ou
-- DOCUMENT prérempli avec l'identifiant de l'élément). Modifiables et désactivables par l'administrateur, jamais
-- supprimées ; jamais réécrites au rejeu (ON CONFLICT DO NOTHING). Contrôlées par ReglesRecettes (McpRecettesBtpTests).
-- =============================================================================

INSERT INTO mcp_recette (mre_code, mre_libelle, mre_description, mre_prompt, mre_parametres, mre_outils, mre_sortie, mre_fournie, mre_ordre, mre_modifie_par) VALUES
 ('devis_depuis_modele', 'Devis depuis un modèle',
  'Prépare un devis brouillon à partir d''un modèle de saisie, pour un client et un chantier.',
  'Prépare dans LogiBTP un devis brouillon à partir du modèle de saisie « {modele} » (outil lister_modeles pour le retrouver), pour le client « {tiers} » (outil designer_tiers) et le chantier d''identifiant {chantier} s''il est renseigné (outil lire_chantier). Besoin à couvrir : {besoin}. Ajoute ou ajuste les lignes avec les éléments de la bibliothèque (rechercher_bibliotheque, modifier_lignes). Ne valide rien : rends le numéro du devis, ses totaux recalculés par le serveur, les avertissements et son adresse.',
  '[{"nom":"modele","type":"TEXTE","libelle":"Modèle de saisie","requis":true},{"nom":"tiers","type":"TEXTE","libelle":"Client","requis":true},{"nom":"chantier","type":"CHANTIER","libelle":"Chantier","requis":false},{"nom":"besoin","type":"TEXTE","libelle":"Besoin à couvrir","requis":true}]',
  '["lister_modeles","designer_tiers","lire_chantier","creer_devis","modifier_lignes","rechercher_bibliotheque"]',
  'BROUILLON', TRUE, 10, 'installation'),
 ('devis_depuis_devis', 'Devis depuis un devis',
  'Prépare un devis brouillon en reprenant un devis existant, éventuellement pour un autre client.',
  'Prépare dans LogiBTP un nouveau devis brouillon en reprenant le devis d''identifiant {devis} (outils lire_document puis creer_devis), pour le client « {tiers} » s''il est renseigné (designer_tiers), sinon pour le même client. Adaptations demandées : {adaptations}. Ajuste les lignes (modifier_lignes, rechercher_bibliotheque) sans rien valider ; rends le numéro, les totaux recalculés par le serveur, les écarts avec le devis d''origine et l''adresse du nouveau devis.',
  '[{"nom":"devis","type":"DOCUMENT","libelle":"Devis d''origine","requis":true},{"nom":"tiers","type":"TEXTE","libelle":"Autre client","requis":false},{"nom":"adaptations","type":"TEXTE","libelle":"Adaptations","requis":false}]',
  '["lire_document","designer_tiers","creer_devis","modifier_lignes","rechercher_bibliotheque"]',
  'BROUILLON', TRUE, 20, 'installation'),
 ('oe_metallerie_appro', 'OE métallerie et demandes d''appro',
  'Prépare les ordres d''exécution de la construction métallique d''un marché, puis les demandes d''approvisionnement ventilées.',
  'Pour le marché d''identifiant {marche} de LogiBTP (outil lire_marche) : 1) prépare en aperçu puis en brouillon les ordres d''exécution limités au service « {service} » (outil preparer_ordre_execution, critère service ; signale les lignes écartées) ; 2) après validation des ordres par un humain, prépare les demandes d''approvisionnement en unités de stock (preparer_demandes_appro) ; 3) propose leur ventilation entre stock des dépôts, commandes en cours et achats, avec les réapprovisionnements des dépôts passés sous leur mini (proposer_ventilation). Ne valide rien : rends les numéros, les adresses et les propositions à valider.',
  '[{"nom":"marche","type":"MARCHE","libelle":"Marché","requis":true},{"nom":"service","type":"TEXTE","libelle":"Service","requis":true}]',
  '["lire_marche","preparer_ordre_execution","preparer_demandes_appro","proposer_ventilation"]',
  'PROPOSITION', TRUE, 30, 'installation'),
 ('controle_devis', 'Contrôle d''un devis avant envoi',
  'Relit un devis avant son envoi : cohérence des lignes, prix, quantités, textes et avertissements.',
  'Relis le devis d''identifiant {devis} de LogiBTP (outil lire_document) avant son envoi au client : lignes sans prix ou à quantité nulle, remises inhabituelles, désignations incomplètes ou incohérentes, éléments absents de la bibliothèque (rechercher_bibliotheque), totaux et TVA, avertissements du serveur. Point d''attention particulier : {attention}. Rends un rapport classé par gravité avec l''adresse des lignes concernées ; ne modifie rien.',
  '[{"nom":"devis","type":"DOCUMENT","libelle":"Devis","requis":true},{"nom":"attention","type":"TEXTE","libelle":"Point d''attention","requis":false}]',
  '["lire_document","rechercher_bibliotheque"]',
  'RAPPORT', TRUE, 40, 'installation'),
 ('synthese_chantier', 'Synthèse de chantier',
  'Rédige une synthèse d''un chantier : marchés, pièces, avancement et points d''attention sur une période.',
  'Rédige une synthèse du chantier d''identifiant {chantier} de LogiBTP (outil lire_chantier) sur la période {periode} : marchés et leurs montants, pièces de vente et d''exécution récentes (outil rechercher sur les listes enregistrées, lire_document pour le détail), avancement, écarts et points d''attention. Rends un rapport court avec l''adresse de chaque élément cité ; ne modifie rien.',
  '[{"nom":"chantier","type":"CHANTIER","libelle":"Chantier","requis":true},{"nom":"periode","type":"PERIODE","libelle":"Période","requis":false}]',
  '["lire_chantier","rechercher","lire_document"]',
  'RAPPORT', TRUE, 50, 'installation')
ON CONFLICT (mre_code) DO NOTHING;
