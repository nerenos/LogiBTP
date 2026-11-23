# Fiches et lignes de documents : questions ouvertes avant le plan par lots

> Source : [ANALYSE-FICHES-LIGNES-DOCUMENTS.md](../ANALYSE-FICHES-LIGNES-DOCUMENTS.md) (20/11/2026).
> 22 questions, dont 9 bloquantes (B). Toutes répondues le 20/11/2026. Réponses à porter dans la colonne Décision ; sans réponse : `OUVERT`.

## A. Titre court des onglets de fiche

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q1 | D'où vient le titre court ? | (a) texte du programme seul (`fr.json`, clé `court`) ; (b) a + personnalisable par le module Personnalisation (comme tout texte) ; (c) b + saisi dans le paramétrage des onglets de champs supplémentaires | **(c)** : même mécanisme que les menus `court` du bandeau ; l'onglet des champs « x_ » reçoit son propre titre court | ✔ (c) (20/11/2026) |
| Q2 | Quand bascule-t-on en titre court ? | (a) tous les onglets en court dès que la ligne déborde ; (b) un par un en partant de la fin jusqu'à ce que ça tienne ; (c) choix de l'utilisateur (préférence) | **(a)** : prévisible, comme le bandeau ; titre complet en infobulle ; s'il manque encore de la place, retour à la ligne comme aujourd'hui | ✔ (a) (20/11/2026) |
| Q3 | Les onglets de la page document (Entête, Règlements, Lignes…) sont-ils concernés ? | (a) non, fiches seulement ; (b) oui, même règle | **(b)** : même problème sur petit écran, travail faible une fois la règle écrite dans le socle | ✔ (b) (20/11/2026) |

## B. Derniers pointages d'une ressource

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q4 (B) | Quelles fiches ? | (a) salarié (dont intérimaire) ; (b) a + matériel (pointage du matériel à la borne) | **(b)** si le pointage matériel doit apparaître ; sinon (a). Le matériel demande d'ajouter une colonne à la vue des pointages | ✔ (b) (20/11/2026) |
| Q5 (B) | Quelle forme ? | (a) lien (barre d'outils ou bandeau de synthèse) qui ouvre la liste Pointages filtrée sur la ressource ; (b) onglet « Pointages » dans la fiche avec les N derniers + lien « Tout voir » vers la liste filtrée | **(a)** : c'est la demande, sans dupliquer une liste ; compteur des 30 derniers jours affiché sur le lien | ✔ (a) (20/11/2026) |
| Q6 | Quel filtre par défaut ? | (a) 30 derniers jours, saisis et validés, tri par date décroissante ; (b) toute la période | **(a)** ; la période reste modifiable dans la liste | ✔ (a) (20/11/2026) |

## C. Mise en forme par type de ligne

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q7 (B) | Quels types de ligne ? | (a) ta liste : tranche niveau 1 à n, élément, ouvrage, composante, sous-ouvrage, texte ; (b) a + section, sous-total, lignes de pied | **(b)** pour section et sous-total (lignes visibles), pied hors périmètre ; tranches : niveaux 1 à 5 paramétrables, au-delà le niveau 5 s'applique | ✔ (b) (20/11/2026) |
| Q8 (B) | Quelles propriétés ? | (a) couleur du texte, gras, italique, souligné ; (b) a + couleur de fond, barré, taille (petite / normale / grande) | **(b)** sans police : les couleurs passent par les couleurs du thème ou une couleur enregistrée (`couleurTheme`) | ✔ (b) (20/11/2026) |
| Q9 (B) | Où s'applique-t-elle ? | (a) grille de saisie seule (toutes les cellules de la ligne) ; (b) a + plan des tranches ; (c) b + éditions PDF | **(c)** : « sur toute la ligne » à l'écran comme à l'impression ; les modèles d'édition reçoivent le style calculé de chaque ligne | ✔ (c) (20/11/2026) |
| Q10 (B) | À quel niveau se paramètre-t-elle ? | (a) un jeu pour la société ; (b) global, famille, type de document (le plus précis l'emporte, comme les règles des documents) ; (c) b + par document | **(b)** : même modèle que les règles des documents ; pas de niveau document (la réimposition et la surcharge suffisent) | ✔ (c) : global, famille, type et par document (20/11/2026) |
| Q11 | « Surcharge dans le texte » : quelle portée ? | (a) la mise en forme saisie dans le libellé riche l'emporte sur les caractères concernés, le reste prend le style du type ; (b) a + style propre à une ligne entière sans toucher au texte (bouton « style de la ligne ») | **(a)** : c'est la demande ; (b) seulement si tu en as besoin | ✔ (b) (20/11/2026) |
| Q12 | Que retire « Réimposer la mise en forme » (document entier ou lignes sélectionnées) ? | (a) seulement couleur, gras, italique, souligné, barré, taille du libellé ; (b) toute la mise en forme du libellé (listes, alignement compris) | **(a)** : les listes et retours à la ligne sont du contenu ; action annulable (Ctrl+Z) | ✔ (a) (20/11/2026) |
| Q13 | Un changement du paramétrage modifie-t-il les documents existants ? | (a) oui, tous (style calculé à l'affichage) ; (b) oui sauf pièces verrouillées, qui gardent le style de leur validation | **(a)** : plus simple ; une pièce émise garde son PDF archivé dans la GED | ✔ (a) (20/11/2026) |

## D. Écart de prix d'achat avec la bibliothèque

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q14 (B) | « Prix en bibliothèque » : lequel ? | (a) PA effectif de l'élément selon son scénario (fixe, fournisseur principal, dernier PA, PMP…) ; (b) PA fixe de l'élément seul | **(a)** : c'est le prix que la bibliothèque donnerait aujourd'hui à une nouvelle ligne | ✔ (a) (20/11/2026) |
| Q15 (B) | Que met à jour le bouton quand le scénario n'est pas « fixe » ? | (a) fixe : PA de l'élément ; fournisseur principal : son tarif ; dernier PA, meilleur, PMP (calculés) : bouton absent, l'infobulle explique ; (b) toujours le PA fixe de l'élément (et passage du scénario en fixe) | **(a)** : ne casse pas un scénario calculé ; en document d'achat, le tarif mis à jour est celui du fournisseur de la pièce s'il en a un | ✔ (a), avec une particularité : si un tarif existe pour l'article et le fournisseur du document, seul ce tarif est modifié ; si le PA vient du tarif d'un autre fournisseur, un nouveau tarif est créé pour le fournisseur du document (20/11/2026) |
| Q16 | Quelles lignes ? | (a) éléments et composantes liés à un élément de bibliothèque ; (b) a + ouvrages (PA unitaire comparé à celui de l'ouvrage en bibliothèque) | **(a)** : l'écart d'un ouvrage vient de ses composantes ; l'ouvrage porte un signe discret « composante en écart » | ✔ (a) (20/11/2026) |
| Q17 | Quels documents ? | (a) tous ceux qui ont un PA (ventes et achats) ; (b) ventes seulement | **(a)** ; dans la facture fournisseur, l'indicateur existant du prix modifié est conservé à côté | ✔ (a) (20/11/2026) |
| Q18 | Seuil de l'écart ? | (a) tout écart ; (b) seuil en % paramétrable (défaut 0) | **(b)** ; deux icônes (plus cher / moins cher) avec le prix de bibliothèque et l'écart en infobulle | ✔ (a) : tout écart ; deux icônes (plus cher / moins cher), prix de bibliothèque et écart en infobulle (20/11/2026) |
| Q19 | Mise à jour groupée ? | (a) ligne par ligne seulement ; (b) a + « Mettre à jour la bibliothèque » pour toutes les lignes en écart sélectionnées | **(b)** avec une fenêtre de confirmation listant les éléments ; droit de modifier la fiche élément exigé (verrou, empreinte) | ✔ (b) (20/11/2026) |

## E. Zones supplémentaires d'entête de document

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q20 (B) | Comment sont-elles stockées ? | (a) vraies colonnes « x_ » de la table `document`, comme les fiches (décision du 14/11/2026) ; (b) JSONB `ent_proprietes` avec `propriete_definition` étendue au global et à la famille | **(a)** : utilisables dans les listes, filtres et éditions comme une colonne ; la portée (global, famille, type) dit où la zone s'affiche ; `propriete_definition` reste pour les propriétés du programme | ✔ (a) (20/11/2026) |
| Q21 | Où s'affichent-elles et quels contrôles ? | (a) dans l'onglet Entête, groupe paramétré, comme les fiches ; obligatoire possible, contrôlé à la validation ; (b) onglet dédié | **(a)** | ✔ (a) (20/11/2026) |
| Q22 | Suivent-elles la pièce ? | (a) copie, nouvel indice et transformation (si la zone existe dans le type cible) ; listes de documents et éditions (`{{document.x_…}}`) ; (b) copie seulement | **(a)** | ✔ (a) (20/11/2026) |
