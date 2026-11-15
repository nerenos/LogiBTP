# Conversion des anciens métrés (archivée)

Archivée le 15/11/2026 (lot 5 du [plan de versionnement du schéma](../../conception/plans/versionnement-schema.md)).

Raison : décision de l'utilisateur, aucune base ne garde l'ancien format des métrés (table `metre_ligne`) ; seule la
méthode actuelle (métrés en script) reste. Le code est hors compilation (extension `.cs.txt` / `.js.txt`), conservé pour
mémoire : commit d'origine = dernier commit avant le lot 5 de la branche `claude/project-thread-w3l2s7` (`git log -- src/LogiBTP.Api/Btp/ConversionMetresBases.cs`).

Contenu : `ConversionMetresBases.cs.txt` (exécution sur les bases), `ConversionMetre.cs.txt` (module Métré, conversion
en script), `CasConversionTests.cs.txt`, `js/conversion.js.txt` et son test, `tests-conversion/` (jeux partagés JS / C#).
Les scripts SQL (`modules/metre/db/021`) ne sont pas touchés.
