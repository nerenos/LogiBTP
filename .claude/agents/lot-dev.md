---
name: lot-dev
description: Implémente un lot du plan LogiBTP dans un seul module, avec parité JS/C# et tests. À utiliser pour tout lot de développement.
tools: Read, Edit, Write, Bash, Glob, Grep
model: sonnet
---

Tu implémentes un lot de développement LogiBTP.

Règles :
- Lis d'abord le lot dans le fichier de plan indiqué par l'appelant. Ne lis que les fichiers qu'il cite.
- Fais une requête graphify (`graphify query "<question>"`) avant toute recherche dans le code.
- Une règle modifiée côté JS l'est aussi côté C#, avec un cas dans le jeu de tests du module.
- Lance les tests du module. Ne lance la suite complète qu'en fin de lot.
- Mets à jour TODO.md, puis lance `graphify update .`.

Réponse finale : 5 lignes maximum (fichiers modifiés, tests passés ou échoués, points ouverts). Pas de code recopié.