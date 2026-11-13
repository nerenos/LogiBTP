# Module MCP – contexte

- Plan par lots : [mcp.md](../../documentation/conception/plans/mcp.md) ; analyse : [ANALYSE-MODULE-MCP.md](../../documentation/conception/ANALYSE-MODULE-MCP.md) (§ 4 délégation, § 5 garde-fous et interdits).

## Rôle
- Agents IA connectés à l'application (point `/mcp`, lot 5) au nom d'un utilisateur, dans la limite d'une **délégation** : plafond (modèle), garde-fous, interdits absolus, échéance, quotas. Lot 2 : règles seules (répliquées JS ↔ C#).
- Sans métier : ne connaît ni les nœuds du cœur ni ses routes ; le cœur fournit le catalogue des nœuds, les nœuds retenus par garde-fou (TIERS, SALARIES, PAIE, CRM_NOTES, COUTS…) et des interdits supplémentaires (spécialisation, lots 5 et 6).

## Dépendances
- JS `@logibtp/mcp` → `@logibtp/socle` (codes `ACTION_DROIT`, `PORTEE_DROIT`, `GARDE_FOU`, `MODELE_PLAFOND`, `ajouterJours`). .NET : `LogiBTP.Mcp` → `LogiBTP.Socle`. Jamais du cœur ni d'un autre module : la forme des droits d'un profil (`{ total, lignes: { nœud: { ACTION: PORTÉE } } }`, héritage du plus proche ancêtre) et les alias d'actions sont repris du module Droits **sans l'importer**.

## Repères
- `js/src/delegation.js` ↔ `dotnet/LogiBTP.Mcp/ReglesDelegation.cs` (jeu `tests/cas/01_delegation.json`) :
  - `actionsModele` / `ActionsModele` : LECTURE → CONSULTER ; PREPARATION → CONSULTER, CREER, MODIFIER ; COMME_MOI, SUR_MESURE → null (non bornés par le modèle).
  - `gardesFousActifs` / `GardesFousActifs` : tous les `GARDE_FOU` sauf ceux levables pour le profil **et** levés par la délégation.
  - `estInterdit` / `EstInterdit` : nœuds `administration`, `connexions`, `mail` (préfixes), `parametres` hors CONSULTER, actions FORCER, USURPER, PARAMETRER, DEVERROUILLER (et leurs alias DEVALIDER, DEBLOQUER), plus les interdits de la spécialisation (code d'action ou préfixe de nœud).
  - `droitsEffectifs` / `DroitsEffectifs(profil, plafond, gardesFous actifs, options { catalogue, noeuds, interdits })` : intersection par nœud et action, portée la plus étroite (et ≤ `plafond.portee`, TOUT par défaut, inconnue → SOI) ; SUR_MESURE : `plafond.actions` `{ nœud: [actions] }` avec héritage ; VALIDATION retire VALIDER, SUPPRIMER, DEVALIDER ; RGPD retire RGPD, CONFIDENTIEL ; nœud retenu par un garde-fou actif : **toutes** ses actions retirées (sans lecture, pas d'écriture). Profil total : développé par le catalogue, COMME_MOI → rien, SUR_MESURE borné à la préparation. Résultat sous la forme des droits d'un profil, lignes redondantes retirées.
  - `autoriseAgent` / `AutoriseAgent` (sur les droits effectifs), `controlerDelegation` / `ControlerDelegation` (`ERREUR_MCP` : modèle inconnu ou non permis, `MCP_ADMIN_COMME_MOI`, échéance 1..min(maximum du profil, 90), garde-fou levé non levable), `echeanceDelegation` / `EcheanceDelegation` (30 j par défaut, bornée), `appliquerQuota` / `AppliquerQuota` (200 par appel, 5 000 par jour, alerte 80 % ; `MCP_QUOTA_JOUR`), `classerOutil` / `ClasserOutil` (`CLASSE_OUTIL` : INTERDIT, LECTURE, BROUILLON, PROPOSITION : action retenue seulement par ENVOI ou VALIDATION que le délégant pourrait faire, jamais pour un plafond LECTURE ni un nœud retenu).
- Constantes `ECHEANCE_DEFAUT`, `ECHEANCE_MAX`, `QUOTA_APPEL`, `QUOTA_JOUR`, `ALERTE_QUOTA`, `NOEUDS_INTERDITS`, `NOEUDS_LECTURE_SEULE`, `ACTIONS_INTERDITES` : parité vérifiée par `CodesTests`.
- Codes `js/src/codes.js` ↔ `Codes.cs` : `CLASSE_OUTIL`, `ERREUR_MCP` (parité par `CodesTests`, `Constantes.Ecarts`). Codes communs (`GARDE_FOU`, `MODELE_PLAFOND`, `ORIGINE_ECRITURE`, `ERREUR_AGENT`) et contrats `IPlafondAgent`, `IJetonsDelegues` : socle (`Socle.Web/Agents.cs`).

## Tests
- `npm test --workspace modules/mcp/js` ; `dotnet test modules/mcp/dotnet/LogiBTP.Mcp.Tests` (même jeu, parité des codes et des constantes).
