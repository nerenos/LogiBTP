# Corrections de novembre : marché et documents (M1, M2, D1, D2, D3, date de livraison par ligne)

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 1 (Documents), § 3, § 5.
>
> Contexte utile :
> - Gestion du marché (cœur) : liste `factures` construite par `src/LogiBTP.Api/Btp/Structure.cs:394-398` (pas
>   d'indicateur « remplacé ») ; situations listées par référence avec « (n indices) » (`Structure.cs:386`) ; ARC de
>   l'entête modifiable hors verrou (`ArcDocument`, `Structure.cs:25`, colonnes `ent_arc_*` de `db/238`).
> - Écran (cœur) `client/src/app/fiches/fiche-structure.js` : case « Afficher les pièces annulées » (`:561`), total
>   `facturesComptees` qui ne retire que les annulées (`:517`), bouton « Annuler par avoir… » sur `x.valide && !x.annule`
>   (`:566`).
> - Dialogue de création du chantier et du marché à l'acceptation d'une commande (cœur) :
>   `client/src/app/structure/marche-commande.js:49-51` (adresse et code postal vides, ville reprise du projet).
> - Module Document : facture d'avancement (présentation P) = cumul − précédent (`modules/document/dotnet/LogiBTP.Documents/Calcul/MoteurDocument.cs:384-385`
>   ↔ `modules/document/js/src/moteur-document.js`) ; le précédent vient de la dernière pièce valable P ou reprise
>   (`modules/document/dotnet/LogiBTP.Documents.Web/DocumentService.cs:866-883`) ; règle `DATE_PIECE` de numérotation
>   continue (`DocumentService.cs:588-597`) qui compte toutes les pièces du même type, tous statuts compris, d'où
>   `DATE_ANTERIEURE` quand une pièce REMPLACE est datée plus tard.
> - Date de livraison par ligne : `document_ligne.lig_date_livraison` (`modules/document/db/019l_document_ligne_livraison.sql`) ;
>   date retenue par `f_date_livraison_ligne(ligne, arc, prevue, date)` (`db/238_documents_arc.sql:17`), déjà lue par
>   l'approvisionnement du Stock (`src/LogiBTP.Api/Btp/StockApprovisionnementBtp.cs`).
> - Pièces valables : toute somme passe par `v_document_valable` / `f_document_valable` ou `PerimetreDocuments`.
>
> Décisions (08/11/2026) :
> - **M2** : bouton « Annuler par avoir… » masqué sur une pièce REMPLACE ; le total des factures ne compte plus les
>   remplacées.
> - **M1 (Q11 : a)** : gestion du marché, une seule case « Afficher le détail » (annulées et remplacées), décochée par
>   défaut ; dans le détail, chaque indice (A, B…) est listé sous sa référence, avec une colonne Indice pour les factures.
> - **D1 (Q14 : a)** : adresse, code postal et ville du chantier = adresse des travaux ou de livraison de la commande
>   (`AdressesDocument`), sinon celle du projet, sinon celle du client.
> - **D2 (Q15 : a)** : la situation (présentation C) garde le cumul ; son pied et son édition ajoutent « Précédent » et
>   « Montant de la période » (information). Les montants enregistrés ne changent pas.
> - **D3 (Q16 : c)** : le contrôle `DATE_PIECE` écarte les pièces REMPLACE et les pièces du même groupe (indices
>   précédents du document) ; les pièces ANNULE restent dans la chronologie.
> - **Date de livraison par ligne (Q4 : a)** : modifiable sur une commande validée, hors verrou, tracée dans
>   l'historique, reprise par l'approvisionnement du Stock (même mécanique que l'ARC de l'entête).
>
> Ordre : module Document (lots 1, 2), puis cœur (lots 3 à 7).

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | D3 : contrôle de date sans les pièces remplacées ni le groupe | `modules/document` | — | FAIT |
| 2 | D2 : précédent et montant de la période d'une situation (moteur et pied) | `modules/document` | — | FAIT |
| 3 | M2 : pièces remplacées, bouton d'avoir et total des factures | cœur | — | FAIT |
| 4 | M1 : case « Afficher le détail » et indices de la gestion du marché | cœur | 3 | A FAIRE |
| 5 | D1 : adresse du chantier créé à l'acceptation de la commande | cœur | — | A FAIRE |
| 6 | D2 : précédent et montant de la période dans l'édition de la situation | cœur | 2 | A FAIRE |
| 7 | Date de livraison par ligne d'une commande validée | cœur | — | A FAIRE |

---

## Lot 1 : D3, contrôle de date sans les pièces remplacées ni le groupe (FAIT le 08/11/2026)

> Écart : la règle est extraite dans `ChronologiePieces.cs` (fonction pure, la requête SQL ne fait que lister les candidates avec leur statut) pour être testable sans base ; tests dans `ChronologiePiecesTests.cs`.

- **Module** : `modules/document`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `DocumentService.cs` (`:588-597`, requête de la dernière pièce numérotée du même type : exclure le
  statut `REMPLACE` (code de `modules/document/js/src/codes.js` ↔ `Codes.cs`, pas de littéral hors SQL) et les pièces du
  même groupe d'indices que le document validé), tests C# `modules/document/dotnet/LogiBTP.Documents.Tests/`.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune (règle serveur seulement).
- **Jeux de tests** : C# : (1) situation B validée alors que A, remplacée, est datée plus tard → acceptée ; (2) pièce
  ANNULE datée plus tard → `DATE_ANTERIEURE` maintenu ; (3) pièce valable d'un autre document datée plus tard → refus
  maintenu.
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert, les trois cas passent.

## Lot 2 : D2, précédent et montant de la période d'une situation (A FAIRE)

- **Module** : `modules/document`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `MoteurDocument.cs` (`:384-385` : pour la présentation C, exposer le précédent et le montant de la
  période = cumul − précédent comme valeurs d'information, sans toucher au total) ↔ `moteur-document.js` (même règle),
  `DocumentService.cs:866-883` (le précédent est aussi fourni pour une situation, même source qu'aujourd'hui), pied de
  la page document du module (`modules/document/js/ui/editeur-document.js` ou `panneaux.js` : bloc du pied, à localiser
  par graphify), textes du module (`texte()`), `modules/document/tests/cas/12_avancement_pied.json` (ou nouveau
  `14_situation_precedent.json`).
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : montant de la période d'une situation = cumul − précédent (information) ; total de la
  situation inchangé (= cumul). Arrondi : la fonction unique du moteur ; decimal.js côté JS.
- **Jeux de tests** : cas du jeu : situation avec précédent (total = cumul, période = cumul − précédent) ; première
  situation (précédent 0) ; facture d'avancement P inchangée.
- **Critère de fin** : le cas passe en JS et en C# ; `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx`
  verts ; aucun écart sur les autres jeux.

## Lot 3 : M2, pièces remplacées, bouton d'avoir et total des factures (FAIT le 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/Structure.cs` (`:394-398`, ajouter `remplace` d'après le statut `REMPLACE`),
  `client/src/app/fiches/fiche-structure.js` (`:566` bouton sur `x.valide && !x.annule && !x.remplace` ; `:517`
  `facturesComptees` sans les remplacées), test client (`client/test/`).
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : test client : facture remplacée → pas de bouton d'avoir, absente du total ; facture valable → bouton
  et total inchangés.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts ; le total d'un marché avec une facture remplacée
  égale la somme des seules pièces valables.

## Lot 4 : M1, case « Afficher le détail » et indices (FAIT le 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `fiche-structure.js` (`:561`, la case « Afficher les pièces annulées » devient « Afficher le détail »,
  état dans le `localStorage` ; hors détail : annulées et remplacées masquées ; avec détail : indices sous leur référence,
  colonne Indice des factures), `Structure.cs` (`:386` situations : liste des indices en plus du compte),
  textes du cœur (`texte()`), test client.
- **Dépendances** : lot 3 (indicateur `remplace`).
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : test client : sans détail, une ligne par référence (indice courant) ; avec détail, tous les indices
  et la colonne Indice.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts ; aucune pièce remplacée visible par défaut.
- **Écarts** : fichier réel `client/src/app/fiches/fiche-structure.js` et logique dans `structure/structure.js` (`facturesMarche`) ; la route expose aussi `indice` et `reference` des factures et `liste_indices` des situations ; sous détail, sous-traitants annulés affichés.

## Lot 5 : D1, adresse du chantier créé à l'acceptation de la commande (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/structure/marche-commande.js` (`:49-51`, adresse, code postal et ville pré-remplis :
  adresse des travaux ou de livraison de la commande via `AdressesDocument`, sinon projet, sinon client), test client.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : trois cas (adresse de la commande ; repli sur le projet ; repli sur le client).
- **Critère de fin** : `npm test` vert ; les trois champs sont remplis dans les trois cas.
- **Écarts** : fonction `adresseChantierInitiale` exportée (testée) ; l'adresse du client vient de `ent_contact_client.adresse` ; référentiel des projets de `Structure.cs` complété de `adresse` et `code_postal`.

## Lot 6 : D2, précédent et montant de la période dans l'édition (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : modèle d'édition de la situation (`client/src/app/editions/modeles.js`, `piece() :317`, et le
  dictionnaire `dictionnaire-modele.js` pour les deux nouvelles variables), test client des éditions.
- **Dépendances** : lot 2 (valeurs exposées par le moteur).
- **Règles répliquées JS / C#** : aucune (lecture des valeurs du moteur).
- **Jeux de tests** : édition d'une situation avec précédent : les deux lignes apparaissent ; facture P inchangée.
- **Critère de fin** : `npm test` vert ; aperçu de l'édition d'une situation montrant « Précédent » et « Montant de la
  période ».

## Lot 7 : date de livraison par ligne d'une commande validée (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Structure.cs` (`ArcDocument :25` et sa route : reprendre le même chemin hors verrou pour
  `lig_date_livraison`), rattachement de la route dans `SpecialisationDroitsBtp.Routes`, historique (même trace que
  l'ARC), page document du cœur (saisie de la date sur la ligne d'une commande validée, `activerDates`), test C# et test
  client.
- **Dépendances** : aucune. Si le verrou du module Document (`VerrouDocumentService`,
  `modules/document/dotnet/LogiBTP.Documents.Web/VerrouDocument.cs:29`) refuse l'écriture et que l'ARC ne le contourne
  pas par un chemin réutilisable, s'arrêter : un lot du module Document (point d'accroche) passe avant, à noter ici.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : C# : modification acceptée sur une commande validée (seule la date change, entrée d'historique),
  refusée sur une pièce d'un autre type ; `f_date_livraison_ligne` prend la nouvelle date (approvisionnement du Stock).
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts ; la date modifiée apparaît dans les prévisions
  d'approvisionnement.
