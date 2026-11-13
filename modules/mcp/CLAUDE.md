# Module MCP – contexte

- Plan par lots : [mcp.md](../../documentation/conception/plans/mcp.md) ; analyse : [ANALYSE-MODULE-MCP.md](../../documentation/conception/ANALYSE-MODULE-MCP.md) (§ 4 délégation, § 5 garde-fous et interdits, § 10.1 propositions).

## Rôle
- Agents IA connectés à l'application (point `/mcp`) au nom d'un utilisateur, dans la limite d'une **délégation** : plafond (modèle), garde-fous, interdits absolus, échéance, quotas. Lot 2 : règles (répliquées JS ↔ C#) ; lot 5 : `LogiBTP.Mcp.Web` (point `/mcp`, délégations, plafond, appel interne, journal) ; lot 10 : file des propositions (action préparée par l'agent, exécutée par l'humain qui l'accepte, sous son identité) ; lot 11 : écrans (`js/ui`) ; lot 12 : serveur d'autorisation OAuth 2.1 (clients distants : claude.ai) ; lot 13 : recettes (prompts MCP) et « Demander à l'agent ».
- Sans métier : ne connaît ni les nœuds du cœur ni ses routes ; le cœur fournit le catalogue des nœuds, les nœuds retenus par garde-fou (TIERS, SALARIES, PAIE, CRM_NOTES, COUTS…) et des interdits supplémentaires (spécialisation, lots 5 et 6).

## Dépendances
- JS `@logibtp/mcp` → `@logibtp/socle` (codes `ACTION_DROIT`, `PORTEE_DROIT`, `GARDE_FOU`, `MODELE_PLAFOND`, `ajouterJours`). .NET : `LogiBTP.Mcp` → `LogiBTP.Socle` ; `LogiBTP.Mcp.Web` → `LogiBTP.Mcp`, `Socle.Web`, `Socle.Donnees`, EF Core Npgsql, `ModelContextProtocol.AspNetCore` 1.4.2 (SDK officiel, Streamable HTTP). Authentification et Droits seulement par les contrats du socle (`IJetonsDelegues`, `IDroits` ; `IPlafondAgent` implémenté ici). Jamais du cœur ni d'un autre module : la forme des droits d'un profil (`{ total, lignes: { nœud: { ACTION: PORTÉE } } }`, héritage du plus proche ancêtre) et les alias d'actions sont repris du module Droits **sans l'importer**.

## Repères
- `js/src/delegation.js` ↔ `dotnet/LogiBTP.Mcp/ReglesDelegation.cs` (jeu `tests/cas/01_delegation.json`) :
  - `actionsModele` / `ActionsModele` : LECTURE → CONSULTER ; PREPARATION → CONSULTER, CREER, MODIFIER ; COMME_MOI, SUR_MESURE → null (non bornés par le modèle).
  - `gardesFousActifs` / `GardesFousActifs` : tous les `GARDE_FOU` sauf ceux levables pour le profil **et** levés par la délégation.
  - `estInterdit` / `EstInterdit` : nœuds `administration`, `connexions`, `mail` (préfixes), `parametres` hors CONSULTER, actions FORCER, USURPER, PARAMETRER, DEVERROUILLER (et leurs alias DEVALIDER, DEBLOQUER), plus les interdits de la spécialisation (code d'action ou préfixe de nœud).
  - `droitsEffectifs` / `DroitsEffectifs(profil, plafond, gardesFous actifs, options { catalogue, noeuds, interdits })` : intersection par nœud et action, portée la plus étroite (et ≤ `plafond.portee`, TOUT par défaut, inconnue → SOI) ; SUR_MESURE : `plafond.actions` `{ nœud: [actions] }` avec héritage ; VALIDATION retire VALIDER, SUPPRIMER, DEVALIDER ; RGPD retire RGPD, CONFIDENTIEL ; nœud retenu par un garde-fou actif : **toutes** ses actions retirées (sans lecture, pas d'écriture). Profil total : développé par le catalogue, COMME_MOI → rien, SUR_MESURE borné à la préparation. Résultat sous la forme des droits d'un profil, lignes redondantes retirées.
  - `autoriseAgent` / `AutoriseAgent` (sur les droits effectifs), `controlerDelegation` / `ControlerDelegation` (`ERREUR_MCP` : modèle inconnu ou non permis, `MCP_ADMIN_COMME_MOI`, échéance 1..min(maximum du profil, 90), garde-fou levé non levable), `echeanceDelegation` / `EcheanceDelegation` (30 j par défaut, bornée), `appliquerQuota` / `AppliquerQuota` (200 par appel, 5 000 par jour, alerte 80 % ; `MCP_QUOTA_JOUR`), `classerOutil` / `ClasserOutil` (`CLASSE_OUTIL` : INTERDIT, LECTURE, BROUILLON, PROPOSITION : action retenue seulement par ENVOI ou VALIDATION que le délégant pourrait faire, jamais pour un plafond LECTURE ni un nœud retenu).
- Constantes `ECHEANCE_DEFAUT`, `ECHEANCE_MAX`, `QUOTA_APPEL`, `QUOTA_JOUR`, `ALERTE_QUOTA`, `NOEUDS_INTERDITS`, `NOEUDS_LECTURE_SEULE`, `ACTIONS_INTERDITES` : parité vérifiée par `CodesTests`.
- `js/src/propositions.js` ↔ `dotnet/LogiBTP.Mcp/ReglesPropositions.cs` (jeu `tests/cas/02_propositions.json`) : `echeanceProposition` / `EcheanceProposition` (7 j par défaut, 1 à 30 : `ECHEANCE_PROPOSITION`, `ECHEANCE_PROPOSITION_MAX`), `etatProposition` / `EtatProposition` (en attente à l'échéance → ECHUE), `controlerDecision` / `ControlerDecision` (agent → `AGENT_INTERDIT` seul ; usurpation `MCP_USURPATION` ; décision inconnue ; `MCP_PROPOSITION_ECHUE` / `MCP_PROPOSITION_CLOSE` ; refus sans motif `MCP_MOTIF_REQUIS`).
- Codes `js/src/codes.js` ↔ `Codes.cs` : `CLASSE_OUTIL`, `ERREUR_MCP` (lot 12 : `MCP_OAUTH_DEMANDE`, `MCP_OAUTH_CLIENT`, `MCP_OAUTH_REDIRECTION`, `MCP_OAUTH_REJEU`), `STATUT_APPEL_AGENT`, `ETAT_PROPOSITION` (EN_ATTENTE, ACCEPTEE, REFUSEE, ANNULEE, ECHUE), `DECISION_PROPOSITION` (ACCEPTER, CORRIGER, REFUSER) (parité par `CodesTests`, `Constantes.Ecarts`). Codes communs (`GARDE_FOU`, `MODELE_PLAFOND`, `ORIGINE_ECRITURE`, `ERREUR_AGENT`) et contrats `IPlafondAgent`, `IJetonsDelegues` : socle (`Socle.Web/Agents.cs`).

## Points d'attention (inventaire détaillé : [MCP.md](../../documentation/modules/MCP.md))
- Point `/mcp` (`LogiBTP.Mcp.Web`) : jeton délégué seul (jamais le mode `EnTetes`), outils classés par `ClasserOutil` (INTERDIT, LECTURE, BROUILLON, PROPOSITION), appel interne avec le jeton délégué (mêmes droits, plafond `IPlafondAgent`), journal de chaque appel, filtre des clés sensibles et des contenus non fiables, quotas.
- Spécialisation `SpecialisationMcp` (méthode patron) : outils, nœuds retenus, interdits, clés sensibles, textes, exécuteurs de propositions ; le cœur la remplit (`SpecialisationMcpBtp`) ; module facultatif `mcp`.
- Propositions : l'agent dépose, l'humain accepte sous son identité (exécution tout ou rien dans `db.Unite()`), jamais l'agent (`AGENT_INTERDIT`).
- OAuth 2.1 (clients distants) : C# seul ; PKCE S256, CIMD, liste blanche de clients, redirections exactes (boucle locale : tout port), jeton d'accès = jeton délégué de 15 min, rejeu = délégation révoquée.
- Recettes : prompts MCP (`mcp_recette`), règles JS ↔ C# (`03_recettes.json`).
- Interface `js/ui` sans métier : textes `mcp.*`, icônes `mcp_*`, couleurs `--mcp-*` dans `js/personnalisation/`.
- Scripts SQL : `005c`, `099u` à `099x`, `db/308` à `310` (manifeste).

## Tests
- `npm test --workspace modules/mcp/js` ; `dotnet test modules/mcp/dotnet/LogiBTP.Mcp.Tests` (jeux partagés `tests/cas`, parité des codes, point `/mcp` et OAuth de bout en bout si `LOGIBTP_TEST_PG` charge `099u` à `099x`). Cœur : `McpPropositionsBtpTests`, `McpExecutionBtpBaseTests`.
