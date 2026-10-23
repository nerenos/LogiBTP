# Conception – Module Planning

Analyse : [ANALYSE-MODULE-PLANNING.md](ANALYSE-MODULE-PLANNING.md).

## Décisions techniques — session du 22-23/10/2026

### Affichage (`VuePlanning`, module)
- **Glisser par surcouche** : la barre ne bouge pas pendant le glisser. Une surcouche `.vp-surcouche` montre la future position en pointillé avec l'instant visé. Aucun calcul n'est fait avant le lâcher, où `deplacer` reçoit le `mode`. Échap abandonne. Raison : pas de calcul serveur pendant le mouvement, et le redessin des barres virtualisées ne gêne pas.
- **Axe à périodes masquées** (`axe.js`) : les heures en dehors de la journée de l'entreprise et les jours masqués (vendredi, samedi ou dimanche au choix) disparaissent à toutes les échelles. Une colonne vaut ses seules minutes visibles, et un instant masqué est placé au début de la plage visible suivante. Paramètres globaux dans `pla_parametre` (`089b`), page `/parametres/planning`.
- **Jours fériés et fermés** : option `feries` [{ jour, libelle }] de la vue, en bandes hachurées comme les week-ends, avec le jour marqué dans l'en-tête et le libellé en bulle. Le module ne connaît pas les calendriers : c'est le cœur qui fournit les journées fermées du calendrier par défaut.
- En-tête sur trois lignes (mois et année, jour, découpage de la journée) ; jour courant bordé de rouge.
- Barres sur plusieurs lignes de texte (`lignesTexte`, `hauteurVoie(n)`), barre d'avancement (`avancementBarre`), bulle HTML dès le survol (`bulleBarre`).
- Colonne des titres des lignes réglable (poignée, double-clic = ajustée au texte), largeur gardée dans le navigateur.
- Nouveaux points d'accroche (méthode patron) : `avancementBarre`, `bulleBarre`, `decorationsLigne` (capacité, jalons).

### Tâches et ressources (serveur du module)
- **Copie de la composition des équipes** (`tac_equipes`, `089d`) : une équipe ajoutée à une tâche est copiée avec sa composition à la date de début. Retirer un membre de la tâche ne le retire pas de l'équipe. Si la composition change pendant la tâche, une alerte EQUIPE est levée et peut être appliquée (`Appliquer` : sans doublon, les membres sortis sont retirés).
- **Disponibilités** (`DisponibilitesAsync`) : LIBRE / PARTIEL / OCCUPE / ABSENT / HORS / SANS, à titre d'information dans la fenêtre de choix des ressources.
- **Tâches gérées par l'application** (`SpecialisationPlanning.TacheGeree(origineType)`) : elles ne peuvent être ni créées, ni modifiées, ni déplacées, ni copiées, ni scindées, ni supprimées depuis le planning (409 `PLA_TACHE_GEREE`). L'application les écrit avec `application: true`. Premier usage : les absences issues des congés du Pointage (origine `conge`).
- **État de tâche facultatif** : vide par défaut, sans pastille. Valeurs OPTION / PREVUE / CONFIRMEE / EN_COURS / TERMINEE.
- **Partie mobile de la tâche** (`tac_mobile` : adresse, contact, commentaire, liens) : une valeur absente de la saisie laisse le champ inchangé.
- **Prévisions des éléments à planifier** (`pla_prevision`) : date prévisionnelle par élément et par service, qui sert à trier « À planifier ».
- **Filtre par services** (`services=` de `/donnees`, `/charge`, `/notifications`, sous-services compris) : il remplace les services de la vue. Les ressources d'autres services qui portent des tâches des services choisis apparaissent dans un groupe « Autres services » (`srv:autres`), avec ces seules tâches. Le filtre est mémorisé par compte et par vue.
- **Sources de création** (`GET /sources`, `SourcesAsync` / `TypesSources`) : le cœur fournit les chantiers, projets et ordres en cours. Le type et l'origine sont conservés à l'enregistrement.

### Intégration par le cœur
- Les équipes sont tenues par le cœur (`db/204`, `ReglesEquipes` ↔ `ressources/equipes.js`, jeu `03_equipes`) : compositions par périodes souples (fin = veille de la suivante), membres de tout type, sous-équipes en renfort, chef par période. Le planning et le pointage développent les sous-équipes.
- Page : onglet « Créer depuis » (glisser ou ＋), onglet Ressources (liste ou tuiles), onglet Jalons, menu ☰ des options d'affichage, clic droit (tâche, zone vide, titre d'une ressource : changement du service principal), Ctrl+S pour enregistrer la tâche en saisie, Échap pour annuler ses modifications.
