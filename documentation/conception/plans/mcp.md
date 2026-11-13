# Module MCP (agents IA connectés à l'application) : plan par lots

> Analyse : [ANALYSE-MODULE-MCP.md](../ANALYSE-MODULE-MCP.md) (13/11/2026). Décisions du 13/11/2026 : **toutes les
> propositions du § 12 retenues**, sauf **Q10** (ci-dessous). Consigne : développement enchaîné sans attendre de
> validation, un commit par lot (branche `claude/project-thread-nwakur`).
>
> **Q10 (décision de l'utilisateur)** : la ventilation d'une demande d'appro **peut** prendre dans le stock d'un dépôt
> même si elle le fait passer sous son **mini** ; franchir le mini **déclenche une demande de réapprovisionnement du
> dépôt** (commande de stock proposée), qui **propose aussi les autres références du dépôt proches de leur mini**
> (au plus `proche_mini` % au-dessus du mini, 20 % par défaut, paramètre du stock), regroupées par fournisseur
> principal, pour commander en une fois.
>
> Ordre : socle → modules (MCP, Droits, Authentification, Stock) → cœur. Chaque lot : tests du module, puis
> `npm test` et `dotnet test LogiBTP.slnx` en fin de lot ; tout nouveau script SQL au manifeste
> `db/installation/scripts.txt` ; toute route `/api` dans `SpecialisationDroitsBtp.Routes` et `EcrituresBtp.Routes`.

| Lot | Titre | Partie | Dépend de | Statut |
|---|---|---|---|---|
| 0 | Audit des routes d'écriture des documents pour les agents | cœur + module Document (lecture, tests) | — | FAIT (13/11/2026) |
| 1 | Contrats du socle : agent de la requête, plafond, codes | socle | — | FAIT (13/11/2026) |
| 2 | Règles de délégation (plafond, garde-fous, interdits) | `modules/mcp` (nouveau) | 1 | FAIT (13/11/2026) |
| 3 | Plafond appliqué par le module Droits | `modules/droits` (+ Document : `ValiderDans`) | 1 | FAIT (13/11/2026) |
| 4 | Jetons délégués | `modules/authentification` | 1 | FAIT (13/11/2026) |
| 5 | Point `/mcp`, catalogue d'outils, appel interne, journal | `modules/mcp` | 2, 4 | FAIT (13/11/2026) |
| 6 | Outils de lecture du cœur, garde-fous du BTP | cœur | 3, 5 | A FAIRE |
| 7 | Outils d'écriture des devis, origine des écritures | cœur | 6 | A FAIRE |
| 8 | Règle de ventilation d'une demande et réappro sous le mini | `modules/stock` | — | A FAIRE |
| 9 | Ordres d'exécution filtrés et demandes d'appro ventilées | cœur | 7, 8 | A FAIRE |
| 10 | File des propositions | `modules/mcp` + cœur | 5 | A FAIRE |
| 11 | Écrans : délégations, paramétrage, journal, pastille 🤖 | `modules/mcp` (ui) + cœur | 10 | A FAIRE |
| 12 | Serveur d'autorisation OAuth 2.1 | `modules/mcp` | 5 | A FAIRE |
| 13 | Recettes (prompts MCP) et « Demander à l'agent » | `modules/mcp` + cœur | 11 | A FAIRE |
| 14 | Documentation | tous | 0–13 | A FAIRE |

Hors plan (Q13) : agent hébergé (automatisations planifiées, panneau intégré).

---

## Lot 0 : audit des routes d'écriture des documents

- **Partie** : cœur, module Document (lecture ; corrections seulement si un test les exige). **Agent** : `lot-dev`.
- **Fichiers** : `src/LogiBTP.Api/Btp/SpecialisationDroitsBtp.cs`, `src/LogiBTP.Api/Btp/EcrituresBtp.cs`,
  `modules/document/dotnet/LogiBTP.Documents.Web/{Extensions,DocumentService,TransformationService}.cs`.
- **Contenu** : document `documentation/conception/plans/mcp-audit-routes.md` : pour chaque route d'écriture des
  documents, de la structure, de la bibliothèque, du stock et de l'exécution : mode (Module / Action), action réelle
  portée (dont : changement de statut par `PUT`, validation implicite par `ValiderDans`, envoi, transformation qui
  valide), effet externe, verdict « outil d'agent possible / proposition / interdit ».
- **Critère de fin** : document écrit ; liste des points à traiter reprise aux lots 3 et 7.

## Lot 1 : contrats du socle

- **Partie** : socle. **Fichiers** : `socle/dotnet/LogiBTP.Socle.Web/Web.cs` (`Utilisateur.Agent` : record
  `AgentRequete(string Delegation, string Client)` à côté de `Usurpateur`), contrat `IPlafondAgent`
  (`Task<PlafondAgent?> PlafondAsync(string delegation, CancellationToken)` : actions permises par nœud ou modèle,
  portée maximale, garde-fous actifs, interdits) et `IJetonsDelegues` (émettre, révoquer, ouvrir — implémenté par
  l'Authentification au lot 4) ; `socle/dotnet/LogiBTP.Socle/Codes.cs` ↔ `socle/js/src/codes.js` : `ORIGINE_ECRITURE`
  (HUMAIN, AGENT, USURPATION, SERVICE), `GARDE_FOU` (RGPD, TIERS, SALARIES, PAIE, COUTS, GED_CONFIDENTIEL, CRM_NOTES,
  ENVOI, VALIDATION, VOLUME), `MODELE_PLAFOND` (LECTURE, PREPARATION, COMME_MOI, SUR_MESURE), erreurs `AGENT_INTERDIT`,
  `AGENT_GARDE_FOU` ; tests de parité des codes du socle.
- **Critère de fin** : tests du socle verts (JS et C#).
- **Réalisé** (13/11/2026) : `Utilisateur.Agent` et `AgentRequete` (`Web.cs`), contrats `IPlafondAgent` / `IJetonsDelegues` (+ `PlafondAgent`, `RouteAgent`, `JetonDelegue`) dans `Socle.Web/Agents.cs`, codes `OrigineEcriture`, `GardeFou`, `ModelePlafond`, `ErreursAgent` ↔ `ORIGINE_ECRITURE`, `GARDE_FOU`, `MODELE_PLAFOND`, `ERREUR_AGENT`, parité dans `CodesTests`.

## Lot 2 : règles de délégation

- **Partie** : `modules/mcp` (nouveau : `js/package.json` `@logibtp/mcp`, `js/src/{index,codes,delegation}.js`,
  `dotnet/LogiBTP.Mcp/{Codes,ReglesDelegation}.cs`, `dotnet/LogiBTP.Mcp.Tests`, `tests/cas/01_delegation.json`,
  `CLAUDE.md`, `LogiBTP.slnx`, `package.json` racine).
- **Règles répliquées** : actions d'un modèle de plafond ; `droitsEffectifs(droitsProfil, plafond, garde-fous levés,
  interdits)` = intersection par nœud et action (portée = la plus étroite), interdits absolus (§ 5.1 : préfixes de
  nœuds `administration`, `parametres` en écriture, `connexions`, `mail`, actions FORCER, USURPER, PARAMETRER,
  DEVERROUILLER), garde-fous non levés retirés (VALIDATION retire VALIDER, SUPPRIMER, DEVALIDER ; RGPD retire RGPD et
  CONFIDENTIEL ; TIERS, SALARIES, PAIE, CRM_NOTES retirent la lecture des nœuds associés, fournis par la
  spécialisation) ; profil total : COMME_MOI refusé (`MCP_ADMIN_COMME_MOI`) ; levée = levable par le profil **et**
  levée par la délégation ; échéance (30 j par défaut, 90 au plus) ; quotas (200 par appel, 5 000 par jour, alerte
  80 %) ; classement d'un outil (lecture / brouillon / proposition / interdit).
- **Critère de fin** : jeu `01_delegation.json` vert en JS et en C#, `CodesTests`.
- **Réalisé** (13/11/2026) : `delegation.js` ↔ `ReglesDelegation.cs` — `actionsModele` / `ActionsModele`, `gardesFousActifs` / `GardesFousActifs`, `estInterdit` / `EstInterdit`, `droitsEffectifs` / `DroitsEffectifs(profil, plafond, gardesFous actifs, options { catalogue, noeuds, interdits })`, `autoriseAgent` / `AutoriseAgent`, `controlerDelegation` / `ControlerDelegation`, `echeanceDelegation` / `EcheanceDelegation`, `appliquerQuota` / `AppliquerQuota`, `classerOutil` / `ClasserOutil`, `normaliserAction` / `NormaliserAction` ; constantes `ECHEANCE_DEFAUT`, `ECHEANCE_MAX`, `QUOTA_APPEL`, `QUOTA_JOUR`, `ALERTE_QUOTA`, `NOEUDS_INTERDITS`, `NOEUDS_LECTURE_SEULE`, `ACTIONS_INTERDITES` ; codes `CLASSE_OUTIL`, `ERREUR_MCP` ↔ `ClasseOutil`, `ErreurMcp` ; records C# `DroitsProfil`, `PlafondDelegation`, `OptionsDelegation`, `DelegationSaisie`, `Delegant`, `QuotasDelegation`, `ResultatQuota`, `OutilAgent`. Socle : `PORTEE_DROIT`, `GARDE_FOU`, `MODELE_PLAFOND`, `ORIGINE_ECRITURE`, `ERREUR_AGENT` exportés par `@logibtp/socle`. Choix : un nœud retenu par un garde-fou perd toutes ses actions (pas seulement la lecture).

## Lot 3 : plafond appliqué par le module Droits

- **Partie** : `modules/droits` (+ `modules/document` pour `ValiderDans`). **Fichiers** :
  `modules/droits/dotnet/LogiBTP.Droits.Web/{Extensions,ServiceDroits}.cs`, tests du module,
  `modules/document/dotnet/LogiBTP.Documents.Web/DocumentService.cs`.
- **Contenu** : quand `Utilisateur.Agent` est posé, `UseDroits` et `IDroits` (`AutoriseAsync`, `PorteeAsync`,
  `ExigerAsync`, `LimiteAsync`) lisent `IPlafondAgent` et appliquent l'intersection (règles du lot 2 reprises par
  contrat, sans dépendre du module MCP : le calcul d'intersection simple est fait sur les actions permises renvoyées
  par le contrat) ; routes en mode Module refusées en écriture pour un agent (403 `AGENT_INTERDIT`) sauf liste
  blanche fournie par le contrat ; masquage RGPD forcé (`Rgpd` absent) ; `ValiderDans` (validation automatique par
  règle) ignoré pour un agent sans VALIDER effectif ; contrat absent ⇒ tout refusé à un agent.
- **Critère de fin** : tests : agent « Préparation » refusé sur une route VALIDER et sur une écriture en mode Module ;
  `ValiderDans` non déclenché.
- **Réalisé** (13/11/2026) : `modules/droits/dotnet/LogiBTP.Droits.Web/AgentsDroits.cs` (`Portee`, `Autorise`,
  `AccesSousArbre`, `RoutePermise`, `ControlerRoute`, `EstInterdit` : profil ∩ plafond, portée la plus étroite, modèle
  LECTURE / PREPARATION / COMME_MOI (jamais pour un profil total) / SUR_MESURE (liste du plafond, profil total borné à la
  préparation), FORCER, USURPER, PARAMETRER, DEVERROUILLER jamais, nœuds `administration`, `connexions`, `mail`
  interdits, `parametres` en lecture seule, interdits du plafond, garde-fous RGPD (RGPD, CONFIDENTIEL) et VALIDATION
  (VALIDER, SUPPRIMER) ; plafond absent ⇒ tout refusé) ; `ServiceDroits.PorteeAsync` et `PlafondAsync` (contrat
  `IPlafondAgent` facultatif, lu une fois par requête), `LimiteAsync` inchangé (limites du délégant) ; `UseDroits` :
  routes Module et Session / Publique en écriture refusées hors liste blanche, Parametrage en lecture seule, Action sur
  les droits de l'agent (403 `AGENT_INTERDIT`, `ACCES_REFUSE` quand le profil lui-même refuse). Socle :
  `Utilisateur.EstAdmin`, `PeutConsulterParametres`, `PeutModifierParametres` faux pour un agent (donc `ExigerAdmin`,
  `ExigerParametres` refusent), `ExceptionMetier.AgentInterdit`. Document : `DocumentService.ExigerValidationAgent`
  appelé par `ValiderDans` (transformation avec intermédiaire, annulation par avoir : refus et transaction annulée).
  Cœur : `EcrituresBtp` corrigé (`/api/cas-test` Action, `/api/structure/documents` Lecture). Au passage : `UseDroits`
  contrôlait le mode Parametrage avec l'utilisateur d'avant le calcul des droits sur `parametres` (réservé de fait à
  l'administrateur) : corrigé. Tests `AgentsDroitsTests`, `ValidationAgentTests`. Reportés au TODO : contrôles par
  identité du cœur (audit § 7.3), routes à exclure de la liste blanche (§ 7.6).

## Lot 4 : jetons délégués

- **Partie** : `modules/authentification`. **Fichiers** : `Donnees.cs`, `Extensions.cs` (lecture du Bearer),
  `ServiceAuthentification.Securite.cs` (ou nouveau `JetonsDelegues.cs`), `db/005c_jetons_delegues.sql` (rejouable,
  manifeste), tests.
- **Contenu** : table `jeton_delegue` (compte, identifiant de délégation opaque, empreinte SHA-256 du secret, client,
  échéance, révoqué le, dernier usage) ; `IJetonsDelegues` : émettre (secret `lbtp_agent_…` de 32 octets affiché une
  fois), révoquer, révoquer tout pour un compte ; Bearer d'un jeton délégué → utilisateur du compte avec
  `Agent = (délégation, client)`, contrôle du compte (désactivé, expiré, mot de passe provisoire, personne non
  autorisée ⇒ refus), jamais pour une session usurpée ; exclusion d'adresse et journal comme un identifiant d'API ;
  le jeton délégué n'ouvre pas `/api/auth/*` (sauf `GET /session`).
- **Critère de fin** : tests du module (secret haché, échéance, révocation, compte désactivé).
- **Réalisé** (13/11/2026) : `db/005c_jetons_delegues.sql` (rejouable, manifeste) : `jeton_delegue`, événement
  `JETON_DELEGUE` ; `ReglesJetonsDelegues` (`Prefixe` = `lbtp_agent_`, `EstJetonDelegue`, `Nouveau`, `Echeance` : 90 jours
  par défaut et au plus, passée refusée, `Refus` : REVOQUE, ECHU, état du compte ; verrouillé accepté, `RouteAuthPermise`) ;
  `ServiceAuthentification.JetonsDelegues.cs` : `EmettreJetonDelegueAsync` (compte de personne utilisable, 422
  `COMPTE_INACTIF` sinon), `OuvrirJetonDelegueAsync` (→ `JetonDelegueOuvert` : session de l'agent, délégation, client ;
  cache 30 s par base), `SessionDelegueeAsync` (intergiciel : exclusion d'adresse, ECHEC compté si inconnu, REFUS
  journalisé), `RevoquerJetonDelegueAsync`, `RevoquerDelegationAsync` (hors contrat, pour le module MCP),
  `RevoquerJetonsDuCompteAsync`, `OublierJetonsDelegues` ; `ServiceJetonsDelegues` = `IJetonsDelegues` (scoped, enregistré
  par `AddModuleAuthentification`). `SessionLue.Agent` → `Utilisateur.Agent` (jamais d'usurpation ; `UsurperAsync` refuse un
  agent). Intergiciel : Bearer `lbtp_agent_…` → 401 `JETON_INVALIDE` (code ajouté à `ERREUR_AUTHENTIFICATION` ↔
  `ErreursAuthentification`) ou 403 `AGENT_INTERDIT` sur `/api/auth/*` sauf `GET /session`. Révocation de tous les jetons du
  compte : désactivation, réinitialisation (administrateur, lien, commande), changement de mot de passe, fermeture de toutes
  les sessions. Tests `ReglesJetonsDeleguesTests`, `JetonsDeleguesTests` (base `LOGIBTP_TEST_PG`, intergiciel compris).
  Choix : pas de JWT pour l'agent (secret relu en base, cache court) ; le jeton ne dit rien du plafond (module MCP, lot 5).

## Lot 5 : point `/mcp`, catalogue d'outils, appel interne, journal

- **Partie** : `modules/mcp` (`dotnet/LogiBTP.Mcp.Web` : `Extensions.cs` `AddModuleMcp<T>` / `MapModuleMcp`,
  `SpecialisationMcp.cs`, `ServiceMcp.cs`, `Donnees.cs`, `AppelInterne.cs`, `FiltreSensible.cs`),
  `modules/mcp/db/096m_mcp.sql` (numéro libre à vérifier ; manifeste), tests.
- **Contenu** : paquet `ModelContextProtocol.AspNetCore` (SDK C# officiel 1.x, transport Streamable HTTP) ; tables
  `mcp_delegation` (compte, libellé, modèle, nœuds sur mesure JSONB, garde-fous levés, client, échéance, révoquée),
  `mcp_levee_profil` (garde-fous levables et modèles permis par profil, quotas), `agent_journal` (§ 9 de l'analyse) ;
  implémentation de `IPlafondAgent` ; catalogue d'outils déclaré par la spécialisation (`OutilMcp` : nom, description
  du dictionnaire, schéma JSON, méthode et gabarit de route, action exigée, classement) ; exécution par
  `AppelInterne` (HttpClient vers l'adresse locale de Kestrel, en-têtes `Host` de la requête et `Authorization` du
  jeton délégué ; en test : client du serveur de test) ; filtre des clés sensibles déclarées par la spécialisation ;
  contenus libres balisés `contenu_non_fiable` ; quotas ; refus de démarrer en mode `EnTetes` ; journal de chaque
  appel ; routes de gestion `/api/mcp/delegations` (mes délégations : créer → secret affiché une fois, révoquer),
  `/api/mcp/parametres` (administrateur), `/api/mcp/journal`.
- **Critère de fin** : tests d'intégration : outil de lecture appelé, journalisé ; 401 sans jeton ; quota atteint.
- **Réalisé** (13/11/2026) : `modules/mcp/db/099u_mcp.sql` (rejouable, manifeste ; 096m pris par le CRM) : `mcp_delegation`,
  `mcp_levee_profil`, `agent_journal`, `mcp_compteur` ; `LogiBTP.Mcp.Web` (SDK `ModelContextProtocol.AspNetCore` 1.4.2, Streamable
  HTTP sans état). **API de la spécialisation pour le lot 6** (`SpecialisationMcp`, surchargée par `SpecialisationMcpBtp`) :
  `Outils` → `OutilMcp(Nom, Description = clé du dictionnaire, Schema JsonElement, Methode, Route « /api/…/{param} », Noeud, Action,
  Classe CLASSE_OUTIL)` avec `Envoi`, `ClesSensibles` (garde-fou → clés), `ClesNonFiables`, `ParametreLimite` (quota VOLUME),
  `CleListe`, `TypeElement`, `CleIdentifiant` (journal) ; `NoeudsRetenus` (garde-fou → nœuds), `Interdits`, `ClesSensibles`,
  `ClesNonFiables` (toutes réponses), `Textes` (`Dictionnaire` des descriptions), `Noeud` (« agents »). `PlafondMcp` = `IPlafondAgent`
  (liste blanche = routes d'écriture des outils, jamais `/api/mcp|auth|droits` ; interdits = spécialisation + nœud `agents` + nœuds
  retenus ; cache 30 s par base vidé à la révocation) ; `ServiceMcp` (jeton → délégation active du compte, classement
  `ClasserOutil` avec les droits du profil lus par `IDroits`, quota, `IAppelInterne` / `AppelInterneHttp` vers l'adresse locale de
  Kestrel avec `Host` et `Authorization` de l'agent, `FiltreSensible`, journal de chaque appel) ; `ServiceDelegations`
  (`ControlerDelegation`, secret rendu une fois, révocation des jetons, levées par profil, journal) ; `AddModuleMcp<T>`,
  `MapPointMcp` (`/mcp`, 401 `MCP_JETON_REQUIS`, refus de démarrer en mode `EnTetes` ou sans `IJetonsDelegues`), `MapModuleMcp`
  (`/api/mcp/delegations`, `/parametres`, `/journal`). Socle : `JetonDelegue.Profil`, `IJetonsDelegues.RevoquerDelegationAsync`,
  `IPlafondAgent.PlafondAsync(délégation, profil)` (levables par profil ; `ServiceDroits` l'appelle). Codes `ERREUR_MCP` complétés,
  `STATUT_APPEL_AGENT`. Cœur : `SpecialisationMcpBtp` (sans outil), nœud `agents`, routes déclarées (droits, écritures). Tests
  `ReglesPointMcpTests`, `PointMcpTests` (Kestrel local, client MCP du SDK, `LOGIBTP_TEST_PG`). Choix : une proposition (classe
  PROPOSITION) est refusée jusqu'à la file du lot 10 ; sans ligne de levées, un profil ne lève rien (quotas par défaut).

## Lot 6 : outils de lecture du cœur

- **Partie** : cœur. **Fichiers** : `src/LogiBTP.Api/Btp/SpecialisationMcpBtp.cs` (nouveau), `Program.cs`,
  `SpecialisationDroitsBtp.cs`, `EcrituresBtp.cs`, `client/src/app/codes.js` (`MODULE_FACULTATIF.MCP`),
  `db/3xx_mcp.sql` (activation du module, nœud `agents`), tests.
- **Contenu** : outils `rechercher` (liste du module Liste avec filtres et pagination), `lire_document`,
  `lire_marche`, `lire_chantier`, `rechercher_bibliotheque`, `lire_stock`, `lister_modeles`, `designer_tiers`
  (code, raison sociale d'une personne morale, ville ; particulier : code seul) ; nœuds associés aux garde-fous
  (TIERS : `annuaire`, `fiches/personne`, `fiches/individu` ; SALARIES : `fiches/salarie`, `ressources` ; PAIE :
  `pointage`, liste des repas ; CRM_NOTES : `crm` ; COUTS : `rentabilite/couts`) ; clés sensibles (`per_iban`,
  `per_bic`, coordonnées, `ind_*` personnels, `sal_*`, prix d'achat et de revient sous COUTS) ; adresses absolues
  (`urlDocument`, `urlFiche`) rendues avec chaque résultat.
- **Critère de fin** : tests : chaque garde-fou retire bien ses champs et nœuds.

## Lot 7 : outils d'écriture des devis

- **Partie** : cœur (+ SQL `ALTER TABLE` du cœur). **Fichiers** : `Btp/SpecialisationMcpBtp.cs` (ou
  `Btp/McpDocumentsBtp.cs`), `db/3xx_mcp_origine.sql`, tests.
- **Contenu** : `creer_devis` (copie d'un devis, création avec contenu depuis un modèle, tiers désigné),
  `modifier_lignes` (opérations : ajouter un élément de bibliothèque, quantité, désignation, remise, supprimer,
  déplacer ; appliquées au document lu puis `PUT` complet avec l'empreinte de version), `transformer` (devis →
  commande, brouillon) ; changement de statut refusé ; origine AGENT et délégation recopiées dans
  `document_historique` (colonnes d'origine) ; réponse : numéro, totaux recalculés, avertissements, lien.
- **Critère de fin** : test : devis brouillon créé depuis un modèle, recalculé par le serveur, jamais validé.

## Lot 8 : règle de ventilation et réappro sous le mini

- **Partie** : `modules/stock`. **Fichiers** : `js/src/ventilation.js` ↔ `dotnet/LogiBTP.Stock/ReglesVentilation.cs`,
  `tests/cas/07_ventilation.json` (numéro libre à vérifier), tests JS et C#.
- **Règle** : pour chaque ligne (article, quantité en unité de stock, date de besoin) : 1) stock disponible des
  dépôts à la date (projection : stock − réservations, sans rupture avant la date), dépôt préféré d'abord ; **le mini
  peut être franchi** ; 2) reste à recevoir non affecté des commandes fournisseur livrées à temps ; 3) achat du reste
  au fournisseur principal, au conditionnement. Pour chaque dépôt passé sous son mini : **demande de réappro**
  (quantité pour revenir au maxi, sinon au mini) **avec les autres articles du dépôt à moins de `proche_mini` %
  au-dessus de leur mini** (20 % par défaut), regroupés par fournisseur principal.
- **Critère de fin** : jeu vert en JS et en C#.

## Lot 9 : ordres d'exécution filtrés et demandes d'appro ventilées

- **Partie** : cœur. **Fichiers** : `Btp/McpExecutionBtp.cs` (nouveau), transformation filtrée (critère : service
  porteur de la nature de l'élément, repli famille de bibliothèque, chapitre, étiquette ; combinables), tests.
- **Contenu** : `preparer_ordre_execution` (aperçu des lignes retenues / écartées, puis E_OE brouillon par la
  transformation existante), `preparer_demandes_appro` (E_OE → E_DAP, unités converties), `proposer_ventilation`
  (règle du lot 8 sur les données du stock : `PrevisionsAsync`, `ServiceApprovisionnement`) → proposition (lot 10) ou,
  avant le lot 10, rendue seulement.
- **Critère de fin** : test : OE limité au service MÉTALLERIE, DAP ventilée, réappro proposé sous le mini.

## Lot 10 : file des propositions

- **Partie** : `modules/mcp` (table `mcp_proposition`, service, routes `/api/mcp/propositions`) + cœur (exécuteurs :
  valider une pièce, appliquer une ventilation → transformations E_DAP → S_RESERVATION / S_DEMANDE / A_COMMANDE,
  envoyer un courriel, créer un tiers provisoire ; source de notification « propositions à valider »).
- **Contenu** : proposition = action, cible, contenu (écarts), avertissements, échéance, état ; acceptation exécutée
  **sous l'identité de l'humain**, en transaction ; refus motivé ; journal.
- **Critère de fin** : test : proposition acceptée → route exécutée par l'humain, au journal ; refusée par un humain
  sans le droit.

## Lot 11 : écrans

- **Partie** : `modules/mcp/js/ui` (écrans sans métier : délégations, levées par profil, journal, propositions) +
  cœur (pages `/mon-compte#agents`, `/parametres/agents`, `/agents/propositions`, `/agents/journal`, menus, pastille
  🤖 dans l'historique et l'entête des pièces). Textes, icônes et couleurs par le module Personnalisation.
- **Critère de fin** : tests d'écrans (jsdom) verts ; `npm test`.

## Lot 12 : serveur d'autorisation OAuth 2.1

- **Partie** : `modules/mcp`. **Contenu** : métadonnées RFC 9728 (`/.well-known/oauth-protected-resource`) et RFC 8414,
  `/oauth/authorize` (session de l'application, écran de consentement = création de délégation), `/oauth/token` (code
  + PKCE S256, rafraîchissement rotatif), clients par document de métadonnées (CIMD) et liste blanche par société,
  audience `/mcp` (RFC 8707) ; jetons émis par `IJetonsDelegues`.
- **Critère de fin** : tests du flux (PKCE, client non autorisé refusé, audience).

## Lot 13 : recettes et « Demander à l'agent »

- **Partie** : `modules/mcp` (table `mcp_recette`, prompts MCP, paramètres typés) + cœur (recettes fournies : devis
  depuis un modèle, OE métallerie et appro, contrôle d'un devis, synthèse de chantier ; bouton « 🤖 Demander à
  l'agent » sur les fiches marché et chantier et les pièces : prompt prérempli copié ou ouvert dans le client).
- **Critère de fin** : tests : recette listée en prompt MCP, bouton présent selon le module et les droits.

## Lot 14 : documentation

- `modules/mcp/CLAUDE.md`, `documentation/modules/MCP.md`, guide de connexion (Claude Code, claude.ai),
  `MODULES.md`, `JOURNAL-LOTS.md`, `TODO.md`, `npm run rapport-dependances`, registre RGPD (traitement « agents »).
