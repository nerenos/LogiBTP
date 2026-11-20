# Fiches et lignes de documents : plan par lots

> Analyse : [ANALYSE-FICHES-LIGNES-DOCUMENTS.md](../ANALYSE-FICHES-LIGNES-DOCUMENTS.md) ; questions et décisions du
> 20/11/2026 : [fiches-lignes-documents-questions.md](fiches-lignes-documents-questions.md) (toutes répondues).
> Ordre : socle, modules (Fiche, Document, Bibliothèque), puis cœur. Un commit par lot, lots enchaînés, une PR.
> Tout nouveau script SQL : mineure `<majeur>.<mineur>_<nom>.sql` du dossier `db` de son module, puis `npm run manifeste`.
> Aucun texte, icône ni couleur en dur (module Personnalisation). Toute route `/api` : nœud de droits
> (`SpecialisationDroitsBtp.Routes`) ; toute route d'écriture : `EcrituresBtp.Routes`.

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Titres courts des onglets et retrait de mise en forme | socle | — | A FAIRE |
| 2 | Titres courts des onglets de fiche | `modules/fiche` | 1 | A FAIRE |
| 3 | Titres courts : fiches du cœur et page document | cœur | 2 | A FAIRE |
| 4 | Derniers pointages des salariés et du matériel | cœur | — | A FAIRE |
| 5 | Styles des lignes : schéma, résolution répliquée, routes | `modules/document` | — | A FAIRE |
| 6 | Styles des lignes : grille, plan, détail, réimposition, paramétrage | `modules/document` | 1, 5 | A FAIRE |
| 7 | Styles des lignes dans les éditions | cœur | 5 | A FAIRE |
| 8 | PA de référence et plan de mise à jour de la bibliothèque | `modules/bibliotheque` | — | A FAIRE |
| 9 | Indicateur d'écart de PA et mise à jour depuis le document | cœur | 8 | A FAIRE |
| 10 | Zones d'entête : registre, colonnes x_ et paramétrage | `modules/document` | — | A FAIRE |
| 11 | Zones d'entête : saisie, validation, copie, transformation | `modules/document` | 10 | A FAIRE |
| 12 | Zones d'entête : listes, éditions, droits du cœur | cœur | 11 | A FAIRE |
| 13 | Tests e2e et documentation | cœur | 3, 4, 6, 7, 9, 12 | A FAIRE |

---

## Lot 1 : titres courts des onglets et retrait de mise en forme (socle)

- **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `socle/js/src/ui/onglets.js` (nouveau), `socle/js/src/ui/index.js`, `socle/js/src/ui/socle.css`,
  `socle/js/src/ui/editeur-riche.js` (ou `format.js`, où vit `htmlSur`), tests `socle/js/test/`.
- **Contenu** :
  - `activerTitresCourts(nav)` : chaque bouton porte `data-titre` et `data-court` ; dès que la ligne d'onglets déborde
    (observateur de taille), **tous** les onglets passent au titre court (Q2 a), titre complet en infobulle ; s'il
    manque encore de la place, retour à la ligne comme aujourd'hui. Pastilles de compteur conservées.
  - `retirerMiseEnForme(html)` : retire du libellé riche la couleur, le fond, le gras, l'italique, le souligné, le
    barré et la taille (Q12 a) ; garde le texte, les listes, l'alignement et les retours à la ligne.
- **Critère de fin** : `npm test --workspace socle/js` (cas : débordement simulé, aucun débordement ; balises `b`,
  `strong`, `i`, `u`, `s`, `span style` retirées, listes gardées).

## Lot 2 : titres courts des onglets de fiche (module Fiche)

- **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/fiche/js/ui/fiche.js` (`sections` : `court` des onglets du programme, des onglets spécifiques,
  de l'onglet des colonnes x_ et des Pièces jointes ; `activerTitresCourts`), `modules/fiche/js/ui/parametrage.js`
  (titre court de l'onglet saisi avec son titre), `modules/fiche/js/personnalisation/fr.json`, `FICHE.md`, tests.
- **Contenu** : titre court du programme par une clé `court` de texte, donc personnalisable par le module
  Personnalisation ; titre court saisi dans le paramétrage des onglets de champs supplémentaires (Q1 c) ; sans titre
  court, le titre complet reste.
- **Critère de fin** : `npm test --workspace modules/fiche/js` ; une fiche de test étroite affiche les titres courts.

## Lot 3 : titres courts des fiches du cœur et de la page document (cœur)

- **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/fiches/definitions.js` (titres courts des onglets des fiches du cœur) puis
  `npm run generer-vues-liste --workspace client`, `client/src/app/fiches/*.js` (onglets spécifiques),
  `client/src/app/pages/document.js` (onglets Entête, Règlements, Lignes, Analyse, Pièces, Suivi, Options : Q3 b),
  `client/src/personnalisation/fr.json` (ou fichier de textes du cœur).
- **Critère de fin** : `npm test --workspace client` ; fiches chantier et salarié, page document : titres courts à
  1 024 px de large.

## Lot 4 : derniers pointages des salariés et du matériel (cœur)

- **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `db/<majeur>.<mineur>_pointages_ressource.sql` (vue des pointages du matériel, ou colonnes
  `materiel` / `materiel_id` dans `v_liste_pointages` selon ce que la borne écrit, `db/292`), `client/src/app/vues-liste.js`
  (colonnes, vue « Pointages du matériel » si thème séparé) puis `generer-vues-liste`, `client/src/app/fiches/fiches.js`
  (action « Derniers pointages » des fiches salarié, intérimaire et matériel), `src/LogiBTP.Api/Btp/SynthesesFiches.cs`
  (compteur des 30 derniers jours), `npm run manifeste`.
- **Contenu** (Q4 b, Q5 a, Q6 a) : lien de la fiche → `app.naviguer` vers la liste Pointages filtrée sur la ressource,
  30 derniers jours, couches saisie et validée, tri par date décroissante (période modifiable dans la liste) ; nombre
  des 30 derniers jours affiché sur le lien.
- **Critère de fin** : `npm test --workspace client`, `dotnet test LogiBTP.slnx` ; le lien d'un salarié de la démo
  ouvre ses pointages.

## Lot 5 : styles des lignes, schéma et résolution répliquée (module Document)

- **Agent** : `lot-dev`. **Modèle** : opus. Puis `revue-parite`.
- **Fichiers** : `modules/document/db/<majeur>.<mineur>_styles_lignes.sql`, `js/src/codes.js` ↔
  `dotnet/LogiBTP.Documents/Codes.cs` (`CLASSE_STYLE_LIGNE` : TRANCHE_1 … TRANCHE_5, SECTION, OUVRAGE, SOUS_OUVRAGE,
  ELEMENT, COMPOSANTE, TEXTE, SOUS_TOTAL), `js/src/styles-lignes.js` ↔ `dotnet/LogiBTP.Documents/Calcul/StylesLignes.cs`,
  `modules/document/tests/cas/<n>_styles_lignes.json`, `js/src/types.js` (colonnes), `Web/AffichageDocument.cs`
  (routes), `CodesTests`.
- **Schéma** : `style_ligne` (classe, famille ou type de document ou document, propriétés JSONB : couleur, fond, gras,
  italique, souligné, barré, taille petite / normale / grande ; Q8 b), même règle de niveau que `regle_document`
  étendue au document (Q10 c : document > type > famille > global > défaut du programme) ; `lig_style` JSONB (style
  propre d'une ligne entière, Q11 b).
- **Règles répliquées** : classe d'une ligne selon son type et sa position (titre de profondeur n, au-delà de 5 :
  TRANCHE_5 ; élément ou ouvrage sous un ouvrage : COMPOSANTE / SOUS_OUVRAGE) ; style résolu = défaut ← global ←
  famille ← type ← document ← style propre de la ligne, propriété par propriété. La mise en forme saisie dans le
  libellé reste au-dessus, caractère par caractère (rendu).
- **Routes** : `GET|PUT /styles-lignes` (global, famille, type ; `u.ExigerAdmin()`), style du document porté par le
  document (enregistré avec lui).
- **Critère de fin** : `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx` ; jeu de cas vert des deux
  côtés.

## Lot 6 : styles des lignes à l'écran (module Document)

- **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/document/js/ui/editeur-document.js` (`classeLigne` + style résolu en variables CSS sur toute la
  ligne), plan des tranches, détail de la ligne (style propre : couleur, fond, gras…), `js/ui/panneaux.js` (onglet
  Options : style du document), écran de paramétrage des styles (global, famille, type), actions « Réimposer la mise
  en forme » sur le document entier ou la sélection (`retirerMiseEnForme`, annulable), `js/personnalisation/`
  (`fr.json`, `icones.json`, `theme.css` : couleurs par défaut en variables `--document-style-*`), tests.
- **Contenu** (Q9 c pour la partie écran, Q11 b, Q12 a, Q13 a) : grille et plan ; couleurs par les couleurs du thème ou
  `couleurTheme` ; un changement de paramétrage s'applique à tous les documents à la prochaine ouverture.
- **Critère de fin** : `npm test --workspace modules/document/js` ; tranche 1 en gras bleu paramétrée : visible dans la
  grille et le plan ; libellé en rouge saisi : garde son rouge ; Réimposer : retire le rouge.

## Lot 7 : styles des lignes dans les éditions (cœur)

- **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/EditionsBtp.cs` (`SourceDocumentEdition` : style résolu de chaque ligne,
  `StylesLignes.cs` du module Document), `client/src/app/editions/modeles.js` (modèles par défaut des devis, factures,
  commandes appliquant le style) puis `generer-vues-liste`, catalogue des variables (`{{ligne.style…}}`), tests.
- **Critère de fin** : `dotnet test LogiBTP.slnx` ; PDF d'un devis de démo : tranches et textes à la mise en forme
  paramétrée.

## Lot 8 : PA de référence et plan de mise à jour (module Bibliothèque)

- **Agent** : `lot-dev`. **Modèle** : opus. Puis `revue-parite`.
- **Fichiers** : `modules/bibliotheque/js/src/calcul.js` ↔ `dotnet/LogiBTP.Bibliotheque/CalculElement.cs`,
  `js/src/codes.js` ↔ `Codes.cs` (`ACTION_MAJ_PA` : PA_FIXE, TARIF, NOUVEAU_TARIF, AUCUNE ; motifs), cas
  `modules/bibliotheque/tests/cas/<n>_mise_a_jour_pa.json`, `Web/ServiceBibliotheque.cs` (service de mise à jour, unité
  d'écriture, verrou et empreinte de la fiche élément), tests.
- **Règles répliquées** (Q14 a, Q15) :
  - PA de référence d'un élément = PA effectif selon son scénario ; dans un document qui a un fournisseur, le tarif de
    l'article pour ce fournisseur s'il existe (sinon le PA effectif).
  - Plan de mise à jour pour un nouveau PA et un fournisseur éventuel : tarif de l'article pour le fournisseur du
    document → ce tarif seul (prix net ; prix public et remises recalculés selon la règle du tarif) ; PA venu du tarif
    d'un autre fournisseur → nouveau tarif pour le fournisseur du document (début : aujourd'hui) ; sans fournisseur :
    scénario fixe → PA de l'élément, fournisseur principal → son tarif, scénario calculé (dernier PA, meilleur, PMP) →
    AUCUNE (motif affiché).
- **Critère de fin** : `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx`.

## Lot 9 : indicateur d'écart de PA dans le document (cœur)

- **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/` (route de lecture des PA de référence des éléments d'un document, route de mise
  à jour unitaire et groupée ; `SpecialisationDroitsBtp.Routes`, `EcrituresBtp.Routes`), `Btp/UnitesLignesBtp.cs`
  (comparaison dans l'unité de la ligne, conversion de l'article ; sans conversion : pas d'indicateur),
  `client/src/app/editeur-btp.js` (icône dans la cellule PA par `signalCellule` : plus cher / moins cher, infobulle
  prix de bibliothèque et écart), clic sur l'icône → `confirmer` → mise à jour ; action « Mettre à jour la
  bibliothèque » sur la sélection (fenêtre listant les éléments, Q19 b), fr.json, icones.json, theme.css, tests.
- **Contenu** (Q16 a, Q17 a, Q18 a) : éléments et composantes liés à un élément de bibliothèque, tous les documents à
  PA ; tout écart ; ouvrage contenant une composante en écart : signe discret ; indicateur existant de la facture
  fournisseur conservé ; droit de modifier la fiche élément exigé.
- **Critère de fin** : `npm test --workspace client`, `dotnet test LogiBTP.slnx` ; ligne de devis à PA modifié :
  icône, infobulle, mise à jour, icône disparue.

## Lot 10 : zones d'entête, registre et colonnes x_ (module Document)

- **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/document/db/<majeur>.<mineur>_zones_entete.sql` (registre `document_zone_entete` : colonne,
  type, libellé, groupe, ordre, obligatoire, valeurs de liste, portée global / famille / type ; fonctions SECURITY
  DEFINER de création et de retrait de colonnes `x_` sur la seule table `document`, mêmes contrôles que
  `modules/fiche/db/1.1`), `js/src/codes.js` ↔ `Codes.cs`, `Web/` (service et routes d'administration,
  `u.ExigerAdmin()`), écran de paramétrage des zones, tests (dont `LOGIBTP_TEST_PG`).
- **Contenu** (Q20 a) : colonnes `x_` ignorées par la dérive et gardées par les mises à jour (à vérifier dans
  `DeriveSchema.cs`) ; `propriete_definition` inchangée.
- **Critère de fin** : `dotnet test LogiBTP.slnx` (création, refus d'un nom, d'un type, retrait), `npm run manifeste`.

## Lot 11 : zones d'entête, saisie et cycle (module Document)

- **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Web/DocumentService.cs` (lecture et écriture des colonnes `x_` de la portée du type, `CopierEnteteSaisie`),
  `Web/Contrats.cs` (définition du type : zones), `TransformationService` (reprise si la zone existe dans le type cible),
  copie et nouvel indice, contrôle « obligatoire » à la validation (code dans `codes.js` ↔ `Codes.cs`),
  `js/ui/panneaux.js` (`sectionsEntete` : groupe paramétré de l'onglet Entête ; `creerCombo`, `activerDates`), tests.
- **Contenu** (Q21 a, Q22 a).
- **Critère de fin** : `npm test --workspace modules/document/js`, `dotnet test LogiBTP.slnx` ; zone « famille V »
  saisie dans un devis, reprise dans la commande et la facture.

## Lot 12 : zones d'entête dans les listes et les éditions (cœur)

- **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : listes de documents (colonnes `x_` proposées : vue ou source par la table selon le module Liste),
  `src/LogiBTP.Api/Btp/EditionsBtp.cs` (`{{document.x_…}}`), catalogue des variables, `SpecialisationDroitsBtp.Routes`,
  `EcrituresBtp.Routes` (routes du lot 10), menu Paramètres, tests.
- **Critère de fin** : `npm test --workspace client`, `dotnet test LogiBTP.slnx` ; colonne `x_` affichée et filtrée dans
  la liste des devis, imprimée dans un modèle.

## Lot 13 : tests e2e et documentation (cœur)

- **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `e2e/fiches-lignes-documents.spec.ts` (titres courts, pointages, style de tranche, écart de PA et mise à
  jour, zone d'entête), `documentation/modules/*.md` concernés, `JOURNAL-LOTS.md`, `TODO.md`,
  `npm run rapport-dependances` si une dépendance change.
- **Critère de fin** : e2e vert sur la base de test ; `npm test`, `dotnet test LogiBTP.slnx`.
