# REGLES GLOBALES DU PROJET

## 1. Stack & Architecture Core
- **Backend :** C# / Web API.
- **Frontend :** JavaScript / Web App.
- **BDD :** postgres SQL. Modifier les structures récursives ou les schémas de base de données est possible.
- **Architecture de référence :** Avant toute modification impliquant plusieurs composants ou la création d'un nouveau module, lis IMPÉRATIVEMENT le fichier `MODULES.md`.
- **Règle absolue des couches :** socle (sans métier) → modules (classes mères, méthode patron) → cœur (`src/`, `client/`, `db/`) qui spécialise.
- **Isolation stricte :** Un module ne dépend jamais du cœur ni d'un autre module (sauf exception documentée). Les liens entre modules passent obligatoirement par le cœur.

## 2. Gestion du Contexte (CRITIQUE)
- **Lazy Loading :** Ne devine pas les règles métiers. Avant de travailler sur un module, lis TOUJOURS son fichier `claude.md` spécifique.
- **Frontières :** Si tu modifies le Module A et que tu as besoin du Module B, lis uniquement les interfaces/DTO du Module B, pas son implémentation.
- **Incertitude :** Si une définition ou un type manque, demande l'autorisation de lire le fichier source exact au lieu d'inventer ou de scanner tout le projet.

## 3. Qualité et Standards
- Code minimaliste, défensif et orienté "First-Principles".
- Aucun code mort laissé en commentaire.
- Les logs et la gestion des erreurs doivent être centralisés.

## 4. Workflow de Session
- Avant de proposer une solution architecturale complexe, écris un plan étape par étape.
- À la fin d'une tâche, mets à jour le fichier `TODO.md` avec ce qui a été accompli et la prochaine étape logique, pour faciliter la reprise après un nettoyage d'historique.

## 5. Gestion de la Documentation et Purge (Write-Only)
- **Le dossier `documentation/` est STRICTEMENT réservé aux humains.** Il contient l'historique des décisions et l'analyse. Tu ne dois JAMAIS le lire pour chercher du contexte technique.
- **Workflow de fin de tâche (Archivage) :** Lorsqu'une fonctionnalité majeure ou une modification d'architecture est validée dans un module :
  1. Résume les décisions techniques prises et ajoute-les à la fin du fichier `documentation\conception\CONCEPTION-[nom_du_module].md`.
  2. **Purge immédiatement** le fichier `claude.md` local du module et les listes de tâches (`TODO.md`) pour ne conserver que les règles actives, l'état actuel et les contraintes strictes. Efface tout l'historique des réflexions du `claude.md`.
