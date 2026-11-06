# Module Annuaire – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [ANNUAIRE.md](../../documentation/modules/ANNUAIRE.md).

## Rôle
- Personnes (morales à un niveau : groupe, société, établissement, agence, dépôt… ; particuliers), hiérarchie `per_parent_id`, casquettes (« relations » à l'écran : client, fournisseur…) qui déverrouillent des groupes de la fiche personne.
- Individus (êtres humains), rattachements individu ↔ personne (contacts, salariés, dirigeants, titulaire d'un compte particulier), liens typés entre personnes.
- Coordonnées partagées (une valeur, plusieurs usages) avec historique ; contrôles d'identifiants (SIREN, SIRET, TVA, IBAN, BIC) ; graphe relationnel autour d'une fiche.
- Les fiches personne et individu passent par le module Fiche ; l'annuaire fournit leurs champs gérés.

## Dépendances
- Dépend de : `@logibtp/socle`, `@logibtp/graphe` (format, `parcourirEnLargeur`, `fusionnerGraphes`, `VueGraphe`) ; C# : `LogiBTP.Socle` / `LogiBTP.Socle.Web` (`ExceptionMetier`, `Utilisateur`), EF Core.
- Utilisations par le cœur : voir le détail.

## Repères
- Fusion d'un tiers provisoire : une seule transaction ; références de l'hôte reportées par `ReporterFusionAsync` (cœur : `SpecialisationAnnuaireBtp`).
- Champs gérés : personne → `coordonnees`, `rattachements`, `liens`, `enfants` ; individu → `coordonnees`, `rattachements` (le cœur ajoute `salarie`).
- Code `per_code` (`T` + id) et historique des coordonnées (`tg_coordonnee_historique`) posés par trigger.
- Le module n'utilise pas le module Entreprises françaises (le cœur relie les deux) ; le choix d'un tiers ou d'un contact est injecté par l'application (`definirChoixAnnuaire`).

## Règles répliquées JS / C# et jeux de cas (`tests/cas`)
- `01_identifiants.json` : `identifiants.js` ↔ `Identifiants.cs` (Luhn, exceptions La Poste, clé TVA (12 + 3 × (SIREN mod 97)) mod 97, IBAN mod 97, BIC ; erreurs d'une personne dans l'ordre pays, siren, siret, tva, iban, bic : `SIREN`, `SIRET`, `SIRET_SIREN`, `TVA`, `TVA_SIREN`, `IBAN`, `BIC`, `PAYS`).
- `02_coordonnees.json` : `planifierCoordonnees` ↔ `PlanCoordonnees.Planifier` (saisie vide ignorée, usage vidé supprimé ; coordonnée partagée modifiée → choix `MODIFICATION` / `AUTRE`, sinon `CHOIX_REQUIS` ; un principal par nature ; ordre = rang dans la nature ; opérations `SUPPRIMER` / `AJOUTER` / `MAJ`, coordonnée `GARDER` / `MODIFIER` / `NOUVELLE`).
- `03_graphe.json` : `construireGraphe` ↔ `GrapheAnnuaire.Construire` (clés `P<id>`, `I<id>`, `G<id>` « + N contacts » ; niveaux supérieurs du départ toujours présents ; nœuds triés par ordre puis clé, arêtes par clé).
- `04_fusion.json` : `planFusion` ↔ `PlanFusion.Calculer` (cible prioritaire, source pour les vides, booléen jamais vide, nombres sans zéros inutiles, colonnes techniques ignorées, `+clé`) et `mots_doublon` : `motsDoublon` ↔ `PlanFusion.MotsDoublon`.
- `FournisseurAnnuaireMemoire` applique les mêmes règles que `ServiceAnnuaire` (unicité société de la base et SIRET, hiérarchie sans `BOUCLE`, doublons, tiers provisoires et fusion).
- Erreurs serveur : `ExceptionMetier` 422 `VALIDATION` avec détails `{ champ, code, message }` (`UNIQUE`, `BOUCLE`…), 422 `CHOIX_REQUIS` (coordonnée partagée sans choix), 409 si coordonnée modifiée entre-temps (`COORDONNEE_MODIFIEE`) ; côté JS `ErreurAnnuaire(statut, code, message, details)`, paramétrage hors ADMIN → 403 `ACCES_REFUSE` (mémoire).
- Toute règle modifiée : les deux implémentations + le jeu de cas, puis tests JS et .NET.

## Conventions et pièges
- « Casquettes » dans le code et la base, « relations » à l'écran.
- Rattachements lus par page (20) ; la fiche n'envoie que les rattachements modifiés, ajoutés (sans `rat_id`) ou retirés (`supprime: true`) : un absent est inchangé.
- Coordonnée partagée : ne jamais la modifier sans le choix MODIFICATION / AUTRE ; historique par trigger, pas par le code.
- Vues ensemblistes (`DISTINCT ON`), pas de fonction par ligne (volumes de salariés) ; le graphe C# lit tout en une fois puis parcourt en mémoire.
- Compte particulier (`CreerParticulier`) : personne titulaire, coordonnées personnelles partagées (même `coo_id`) ; idempotent.
- Recherche : mots normalisés (`ServiceAnnuaire.Mots`, `f_annuaire_normaliser`), limite 30 par défaut.
- Doublon d'établissement : `parSiret` avant création (fiche personne, reprise depuis l'annuaire des entreprises).
- Tiers provisoire : seul un provisoire se fusionne (dans n'importe quelle autre fiche) ; doublon de nom = tous les `motsDoublon` contenus (sans accents) dans la raison sociale ou le nom commercial, 10 au plus ; un nouveau tiers saisi depuis les intervenants (bouton ＋) est toujours provisoire.
- Salariés : chaque salarié est lié à un individu (`salarie.sal_ind_id`) rattaché à notre société ; synchronisation dans le cœur (`SalariesAnnuaire.cs`, `synchroniserSalarie`).
- Démo : modifier `client/src/app/annuaire/donnees.js` puis `npm run generer-vues-liste --workspace client` (régénère `db/141`).

## Textes, icônes et couleurs (module Personnalisation, lot P3g)
- Textes, icônes et couleurs par `js/personnalisation/` (règles et exceptions gardées en littéraux : voir le détail).

## Tests
- `npm test --workspace modules/annuaire/js` (vitest : jeux partagés, fournisseur mémoire, disposition du graphe).
- `dotnet test modules/annuaire/dotnet/LogiBTP.Annuaire.Tests` (ou `dotnet test LogiBTP.slnx`).

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module Annuaire : personnes (niveaux, hiérarchie `per_parent_id`, relations — client, fournisseur… ; « casquettes » dans le code et la base, « relations » à l'écran — qui déverrouillent des groupes de la fiche) et individus, rattachements, liens, coordonnées partagées (`coordonnee` + `usage_coordonnee`, historique par trigger). Contrôles des identifiants (SIREN, SIRET, TVA, IBAN, BIC) répliqués entre `identifiants.js` et `Identifiants.cs` (jeu `01_identifiants.json`) ; plan d'enregistrement des coordonnées (choix MODIFICATION / AUTRE pour une coordonnée partagée modifiée) entre `coordonnees.js` et `PlanCoordonnees.cs` (jeu `02_coordonnees.json`) ; `FournisseurAnnuaireMemoire` applique les mêmes règles que `ServiceAnnuaire`. Tiers provisoires (`modules/annuaire/db/071`) : un tiers saisi depuis les intervenants (bouton ＋, `creerTiersProvisoire`) est créé provisoire après contrôle des doublons (SIRET bloquant, noms proches à confirmer : `motsDoublon`), puis validé ou fusionné dans une fiche existante (`fusionnerTiers`, valeurs choisies par `planFusion` ↔ `PlanFusion`, jeu `04_fusion.json`) ; les références de l'application passent sur la fiche conservée (`SpecialisationAnnuaireBtp.ReporterFusionAsync` : documents, intervenants, structure, tarifs, règlements, GED) ; vue « Tiers provisoires à valider ». Données de démonstration dans `client/src/app/annuaire/donnees.js` (puis `npm run generer-vues-liste --workspace client` pour `db/141`).
- Graphe relationnel de l'annuaire : parcours (hiérarchie, liens, rattachements, profondeur 1 à 5, niveaux supérieurs toujours présents, contacts résumés au-delà d'un maximum) répliqué entre `construireGraphe` (`modules/annuaire/js/src/graphe.js`) et `GrapheAnnuaire.cs` (jeu `03_graphe.json`) ; disposition en couches et vue dans le module Graphe (ci-dessous), spécialisée par `VueGrapheAnnuaire` (`modules/annuaire/js/ui/graphe.js`) ; page `/annuaire/graphe?type=&id=&profondeur=` et onglet Graphe des fiches.
- Choix des tiers et des contacts dans une liste (ergonomie I1) : `choisirDansListe` du module Liste, vues des thèmes Tiers et Contacts (`VUES_CHOIX` de `vues-liste.js` ouvertes d'abord, ★ de l'utilisateur sinon), filtre par défaut selon l'appel retirable (`relationsFonction` de `client/src/app/annuaire/choix.js` pour les intervenants, client / prospect ou sous-traitant pour les fiches de la structure) ; injecté dans le module Annuaire (`definirChoixAnnuaire` : `choisirPersonne` / `choisirIndividu` partout), bouton 🔍, F4 ou double-clic dans le champ tiers des intervenants et des fiches de la structure (la saisie directe reste).
- Rattachements (contacts) : lus par page (`pageRattachements` / `ServiceAnnuaire.PageRattachements`, 20 par page avec recherche ; la fiche lit la première page et `nb_rattachements`) ; le champ géré `rattachements` n'enregistre que les rattachements modifiés, ajoutés ou retirés (`supprime: true`) — un rattachement absent de la saisie est inchangé.
