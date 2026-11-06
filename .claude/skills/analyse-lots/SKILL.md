---
name: analyse-lots
description: Transforme une analyse brute LogiBTP en questions ouvertes, puis en plan découpé en lots (un module, un agent, un critère de fin). À utiliser pour toute nouvelle fonctionnalité ou tout chantier de refonte avant le premier code.
---

# analyse-lots

Procédure en trois phases. Chaque phase s'arrête au point de contrôle indiqué : ne passe pas à la suivante sans réponse de l'utilisateur.

## Phase 1 : questions ouvertes

1. Lis le fichier d'analyse brute indiqué par l'utilisateur (`documentation/conception/ANALYSE-<SUJET>.md` ou le fichier cité). Ne lis pas le code à ce stade, sauf pour vérifier un point cité.
2. Pour les questions sur le code, fais une requête graphify (`graphify query "<question>"`) avant toute recherche.
3. Délègue la rédaction à l'agent `analyste-lots` avec le chemin de l'analyse et le chemin de sortie `plans/<sujet>-questions.md`.
4. Présente les questions à l'utilisateur, une par une ou par petits groupes. Ne décide pas à sa place : une question sans réponse reste marquée `OUVERT` dans le plan.

**Point de contrôle 1** : toutes les questions bloquantes ont une réponse, ou l'utilisateur accepte qu'elles restent ouvertes.

## Phase 2 : plan par lots

1. Une fois les réponses reçues, délègue à `analyste-lots` la rédaction de `plans/<sujet>.md`, en lui passant les réponses et le chemin du plan.
2. Règles de découpage, à faire respecter :
   - Un lot touche un seul module, ou le cœur seul. Un module ne dépend jamais du cœur.
   - Ordre des lots : socle, puis module, puis cœur.
   - Un lot tient dans une session : au plus une dizaine de fichiers modifiés et un jeu de tests.
   - Une règle répliquée JS/C# se fait dans le même lot que son cas de test.
   - Chaque lot a un critère de fin vérifiable (commande de test, comportement observable).
   - Les lots sont numérotés (`Lot 1`, `Lot 2`…) pour être appelés par numéro.
3. Chaque lot indique : agent, modèle, fichiers cités, dépendances, critère de fin.

**Point de contrôle 2** : l'utilisateur valide le plan. Corrige ce qu'il demande, puis relance la phase concernée.

## Phase 3 : exécution d'un lot

Pour chaque lot, dans une session séparée si possible :

1. Lance l'agent `lot-dev` avec le chemin du plan et le numéro du lot. Ne code pas dans cette session.
2. Si le lot modifie une règle répliquée (moteur, validation, calcul), lance ensuite `revue-parite` sur les fichiers modifiés.
3. Si `revue-parite` signale un écart, relance `lot-dev` avec la correction, une seule fois. Au second échec, arrête et signale à l'utilisateur.
4. Quand le critère de fin est atteint, passe la ligne du lot à `FAIT` dans le plan.

## Règles communes

- Réponses courtes : 5 lignes maximum par étape, sans récapitulatif ni code recopié dans la conversation.
- Français pour les textes, les commentaires et les noms.
- Ne modifie jamais un CLAUDE.md dans cette procédure : seul le lot de réduction de CLAUDE.md le fait, et il a son propre plan.
- Ne lance la suite complète de tests qu'en fin de lot.
