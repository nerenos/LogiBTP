-- =============================================================================
-- Cœur – module MCP, lot 6 (plans/mcp.md ; ANALYSE-MODULE-MCP.md § 5.3). Rejouable.
--
-- - activation par société (module_societe « mcp », MODULE_FACULTATIF.MCP de codes.js ↔ ModulesFacultatifs.Mcp de
--   Domaine/Codes.cs) : **désactivé à la création** (tout ce qu'un agent lit part chez le fournisseur du modèle :
--   traitement au sens du RGPD, décision de la société) ; désactivé, le point /mcp répond 403 MCP_MODULE_INACTIF, les
--   routes /api/mcp 409 MODULE_INACTIF et les jetons délégués n'ont plus de plafond (tout refusé) ;
-- - nœud de droits « agents » (gestion de ses délégations) : déclaré par le catalogue du cœur
--   (SpecialisationDroitsBtp), sans ligne posée ici (accordé par profil dans /parametres/droits ; ADMIN : profil total).
-- Le drapeau posé par la société n'est jamais remis au rejeu.
-- =============================================================================

INSERT INTO module_societe (mod_code, mod_libelle, mod_description, mod_actif, mod_ordre) VALUES
 ('mcp', 'Agents IA (MCP)', 'Agents IA connectés au nom d''un utilisateur, dans la limite d''une délégation (point /mcp, délégations, journal)', FALSE, 97)
ON CONFLICT (mod_code) DO NOTHING;
