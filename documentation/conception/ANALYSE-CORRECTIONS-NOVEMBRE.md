# LogiBTP – demandes du 07/11/2026 (restes du TODO, corrections et améliorations)

> Analyse brute (07/11/2026) : liste de l'utilisateur, recopiée telle quelle. Questions et décisions (08/11/2026) :
> [corrections-novembre-questions.md](../../plans/corrections-novembre-questions.md) ; plans : neuf plans indépendants,
> index [corrections-novembre.md](../../plans/corrections-novembre.md).

## 1. Restes du TODO

- « Ne plus utiliser » (db/228) : écarter ces fiches des choix de nouvelle saisie (recherche des tiers de l'annuaire, appel de la bibliothèque, ressources du planning, salariés du pointage et du magasin) : point d'accroche à prévoir dans les modules Annuaire et Bibliothèque (colonne du cœur).
- Fournisseur « TVA intracommunautaire » (db/229) : proposer la catégorie de TVA autoliquidée (module Comptabilité) sur les lignes de ses pièces d'achat ; type de tiers FE à reprendre par le futur module Facturation électronique.
- Sécurité de la base (lot 11 réalisé) : `MettreAJour-LogiBTP.ps1` pourrait relancer la préparation et redémarrer la base quand la connexion n'est pas chiffrée (aujourd'hui : relancer l'installeur) ; renouvellement du certificat de la base dans la tâche planifiée (aujourd'hui : à chaque préparation, 60 jours avant l'échéance ; certificat de 730 jours).
- Restaurants (lot 10 réalisé) : repas dans la saisie d'équipe de la borne (aujourd'hui : chacun pour soi), liste des repas d'une période (contrôle RH, notes de frais) et carte des restaurants.
- Documents (lot 9 réalisé) : reconnaissance des accusés de réception reçus par courriel (module Mail, lot 4 : numéro de commande, rattachement, proposition de la livraison confirmée) ; date de livraison par ligne modifiable sur une commande validée (aujourd'hui : l'ARC de l'entête seulement).
- Projet (lot 6) : zone de déplacement du projet reprise par le chantier ouvert depuis le projet (zones du Pointage par agence).
- Matériel (lot 5c réalisé) : import des cartes carburant (module Import, M8) ; relevés de compteurs saisis à la borne (source BORNE prévue) ; données de démonstration d'entretiens (aujourd'hui tous en retard faute d'historique).
- Refacturation interne du matériel (M4 du lot 5c) : les heures pointées et planifiées sont valorisées sur les chantiers où il travaille (module Rentabilité, lot 5) ; reste à créditer le chantier de suivi du matériel du même montant (produit interne) et à proposer le coût par heure de l'onglet Coûts comme coût moyen de la fiche.
- Matériel : photo de l'état au retour d'une affectation (dépôt dans la GED du matériel depuis la ligne).
- Choix en liste (I1, suite) : individus de notre société au poste voulu (conducteur, chargé d'affaires, rédacteur : combos actuelles) et contact d'un intervenant dans la liste des contacts du tiers ; sélection multiple (destinataires).

## 2. Module Bibliothèque

- B1. Le calcul des prix ne fonctionne pas correctement : si un tarif fournisseur est présent, il n'est pas utilisé pour le calcul.
- B2. La partie résultat utilise le dernier prix d'achat et le PMP comme des PR au lieu de PA.
- B3. Dans l'onglet Tarif fournisseur, en modification, il y a un bouton Enregistrer qui ne doit pas exister.

## 3. Module Marché

- M1. Masquer par défaut les documents remplacés, avec un bouton pour afficher le détail ; avec le détail, afficher les indices alpha.
- M2. Ne pas afficher le bouton « Annuler par avoirs » si le document est au statut remplacé.

## 4. Module Liste

- L1. Ajouter des filtres par périodes glissantes (x jours, x mois, mois en cours…).

## 5. Module Document

- D1. Création de marché depuis l'acceptation de commande : préremplir l'adresse avec les données de la commande.
- D2. Situation : déduction du montant précédent.
- D3. Validation de situation : si la date d'un document remplacé (pose problème), ne pas bloquer.

## 6. Module Interface (Personnalisation)

- P1. Appellation des teintes sur les couleurs et non sur un thème.
- P2. Mots-clés au format jeton.
- P3. Minuterie sur les notifications : fermeture automatique si pas de clic de prise de focus.
