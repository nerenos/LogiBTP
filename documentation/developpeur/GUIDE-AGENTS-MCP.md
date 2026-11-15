# Guide de connexion des agents IA (module MCP)

Référence technique : [MCP.md](../modules/MCP.md). Un agent agit au nom d'un utilisateur, avec ses droits ou moins.

## 1. Activer le module
1. Appliquer les scripts SQL listés dans MCP.md (manifeste `db/installation/scripts.txt`).
2. Paramètres › Modules : activer la ligne `mcp` pour la société.
3. Paramètres › Agents IA : lever, par profil, les garde-fous levables et fixer les modèles permis, l'échéance maximale et les quotas (sans réglage : rien de levable).

## 2. Créer une délégation (jeton d'agent)
1. Mon compte › Agents (`/compte#agents`) : créer une délégation (modèle de plafond, durée, garde-fous à lever).
2. Copier le secret : il n'est affiché qu'une fois. L'écran donne aussi l'adresse `/mcp`, la commande `claude mcp add` et un `.mcp.json`.

## 3. Claude Code
- Avec le jeton : `claude mcp add --transport http logibtp https://<société>/mcp --header "Authorization: Bearer <secret>"`.
- Ou par OAuth : sans en-tête, Claude Code ouvre le navigateur ; le retour en boucle locale (`127.0.0.1`, tout port) est accepté. Le client Claude Code doit être actif dans la liste blanche.

## 4. claude.ai (connecteur personnalisé, OAuth)
1. Exposer en HTTPS public : `/mcp`, `/.well-known/oauth-*` et `/api/mcp/oauth/authorize|token` (la page `/agents/autoriser` reste derrière la session).
2. Paramètres › Agents IA › Clients OAuth autorisés : client claude.ai actif.
3. Dans claude.ai, ajouter un connecteur personnalisé à l'adresse `https://<société>/mcp` (OAuth découvert par le 401 et `/.well-known/oauth-protected-resource/mcp`).
4. Page de consentement : choisir le modèle, la durée et les garde-fous ; accepter crée la délégation.
5. À vérifier par un essai réel : adresses des documents de client pré-renseignées (voir TODO.md).

## 5. Utiliser
- Recettes : prompts MCP proposés par le client ; bouton 🤖 « Demander à l'agent » sur les fiches marché et chantier et les pièces.
- Propositions : `/agents/propositions` ; accepter, corriger ou refuser (motif).

## 6. Révoquer
Mon compte › Agents (ou administrateur : toutes les délégations) : révoquer ; jetons, rafraîchissements et propositions en attente sont invalidés. Un rejeu OAuth révoque seul la délégation.

## 7. Lire le journal
`/agents/journal` : mes appels (administrateur : tous), filtres par période, compte, agent, élément ; export CSV. Conservation : 1 an.
