# Conception – Module Pointage

Analyse : [ANALYSE-MODULE-POINTAGE.md](ANALYSE-MODULE-POINTAGE.md).

## Décisions techniques — session du 22-23/10/2026

### Congés et absences (`088c`)
- **Demande sans nature, nature posée par le RH** : le salarié ou le responsable de son service demande avec un simple commentaire. Le RH valide en affectant la nature (`poi_nature_absence`, modifiable, code de paie), ou refuse. Raison : le demandeur ne connaît pas toujours la bonne nature de paie.
- Une demande saisie par le RH peut être validée d'office (`valider: true`). Elle reste modifiable tant qu'elle est demandée ; le RH peut aussi modifier un congé validé, nature comprise. Verrou par version (409 `CNG_VERSION`).
- Règles `conges.js` ↔ `ReglesConges.cs` (jeu `04_conges`) : demi-journées (début l'après-midi, fin à midi), chevauchement contrôlé à la demi-journée, jours décomptés sur les seuls jours travaillés du calendrier du salarié (fériés exclus).
- **Synthèse** : un jour entièrement couvert par un congé validé ne lève plus l'exception « sans pointage » ; pastilles des absences par jour.
- **Export de paie** : une ligne `ABS_<code>` par nature, quantité en jours ; un salarié sans pointage est exporté s'il a des congés ; les demandes en attente sont signalées (`conges_en_attente`).
- **Planning** : le cœur tient l'absence (`ApresCongeAsync`). Elle est en option tant que demandée, confirmée à la couleur de la nature une fois validée, et supprimée si refusée ou annulée. C'est une tâche gérée, non modifiable depuis le planning. Tâche du CRM au service administratif à chaque demande.

### Borne (lot 4, suite)
- **Paramétrage par borne** : salariés proposés filtrés par services et par fonctions, types de MO proposés (`pap_services`, `pap_fonctions`, `pap_types_mo` ; vide = tous). Refus `BORNE_SALARIE` et `BORNE_TYPE_MO` côté serveur.
- **Journée à une date** : aujourd'hui ou l'un des 7 jours passés (`BORNE_DATE` au-delà ou dans le futur), affichée sur tous les écrans avec les heures du jour et de la semaine.
- **Le dernier écran est la liste des pointages du jour** (`PUT /borne/journee`) : la liste remplace les pointages saisis de ce jour, sans toucher aux autres jours. Les heures de début et de fin des lignes inchangées sont conservées. Une journée validée s'affiche en consultation.
- Le jeton de saisie est glissant (cinq minutes, prolongé à chaque appel). Une saisie interrompue est reprise depuis le navigateur de la borne. Un choix unique (MO, activité) est pris d'office.
- Borne d'essai : jeton `test-…` de huit heures en mémoire, PIN facultatif, pointages contrôlés dans une transaction annulée.

### Saisie au bureau et présentation
- Saisie en mode tableau et en cascade (chantier → ordres → type → sous-type → jours), raccourcis du groupe `pointage`.
- « Compléter la ligne » = heures du calendrier du salarié moins les heures déjà saisies le jour.
- Présentation de référence (synthèse) étendue à tout le module : panneau latéral réductible et redimensionnable, `.tableau-compact`, actions en icônes, week-end affiché seulement s'il est pointé, un seul bouton Valider ou Dévalider selon l'état de la semaine.
- Salariés : code court et matricule de paie (`db/203`), utilisés par la recherche et l'export (matricule de paie prioritaire).
- Équipes du cœur (`db/204`) : les sous-équipes sont développées pour le pointage d'équipe.
