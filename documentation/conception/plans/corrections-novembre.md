# Corrections et améliorations de novembre : index des plans

> Analyse : [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) ; questions et
> décisions (08/11/2026) : [corrections-novembre-questions.md](corrections-novembre-questions.md). Périmètre (Q1) : tout,
> en neuf plans exécutables chacun seul, dans sa propre session, sans lire les autres. Les plans 6 à 9 ouvrent par des
> questions `OUVERT` à trancher à leur démarrage.

| Plan | Sujet | Lots | Dépendances entre plans | Ordre conseillé |
|---|---|---|---|---|
| [corrections-bibliotheque.md](corrections-bibliotheque.md) | B1, B2, B3 (calcul des prix, résultat, enregistrement des tarifs) | 6 | aucune | 1 |
| [corrections-marche-document.md](corrections-marche-document.md) | M1, M2 (+ total des factures), D1, D2, D3, date de livraison par ligne | 7 | aucune | 2 |
| [liste-periodes.md](liste-periodes.md) | L1 : opérateur de vue `periode` (JS / C#) | 4 | aucune | 3 |
| [interface-socle.md](interface-socle.md) | P1, P2 (jetons, fiche élément, GED), P3, choix en liste I1 | 8 | lot 3 après `corrections-bibliotheque` (même fichier `onglets.js`) | 4 |
| [ne-plus-utiliser-tva.md](ne-plus-utiliser-tva.md) | « Ne plus utiliser », TVA autoliquidée, zone de déplacement du projet | 7 | lot 2 après `corrections-bibliotheque` lot 2 (mêmes fichiers du service) | 5 |
| [materiel-suites.md](materiel-suites.md) | Photos départ / retour, compteurs à la borne, démo d'entretiens, refacturation interne, cartes carburant | 10 | aucune | 6 |
| [restaurants-suites.md](restaurants-suites.md) | Repas d'équipe à la borne, liste des repas, carte des restaurants | 5 | lot 4 de préférence après `liste-periodes` (filtre par période) | 7 |
| [ar-courriel.md](ar-courriel.md) | AR de commande reçus par courriel (module Mail) | 4 | lot 4 après `corrections-marche-document` lot 7 (même route de l'ARC) | 8 |
| [securite-base-suites.md](securite-base-suites.md) | Mise à jour et renouvellement du certificat de la base | 3 | aucune | 9 |

Aucune dépendance bloquante entre plans : les liens ci-dessus évitent seulement de modifier les mêmes fichiers en
parallèle. Total : 54 lots.
