# Enregistrement des données : uniformiser et sécuriser

> Plan autonome (demande du 12/11/2026, point « Enregistrement des données » du TODO). Aucun script SQL prévu :
> le chantier ne touche que le code C# (et le module Import côté JS).

## 1. État des lieux (main au 12/11/2026)

**Transactions : une connexion par contexte, donc une transaction par contexte.**
- Chaque contexte EF ouvre sa propre connexion (`Program.cs:82`, `UseNpgsql(SocieteCourante.Connexion)`). Une
  transaction ouverte sur `LogiBtpContext` ne couvre donc ni les contextes des modules (Annuaire, Fiche…), ni un
  contexte obtenu par `scopes.CreateScope()`.
- **Fiches** (`ServiceFiche.Modifier` / `Creer`, `modules/fiche/.../ServiceFiche.cs:437-508`) : la ligne et le verrou
  sont écrits dans une transaction Npgsql, puis `EcrireGeresAsync` (intervenants, coordonnées et contacts de
  l'annuaire) s'exécute **après le commit**, dans un autre scope (`SpecialisationsElements.cs:177-189`). Un échec des
  gérés laisse la ligne modifiée. À l'inverse, `AvantEcritureAsync` écrit **avant** la transaction
  (`SalariesAnnuaire.Synchroniser`, `ElementsBibliotheque.AvantEcriture`, `SpecialisationsElements.cs:40-90`) : un
  échec de la ligne laisse ces écritures orphelines.
- **Documents** (`DocumentService.Enregistrer` / `Creer`, `TransformationService`) : déjà dans une transaction du
  contexte du module Document (entête, lignes, compléments, liens, historique). À vérifier : les crochets du cœur qui
  écrivent par un autre contexte ou un autre scope.
- **Création d'un document par import** (`modules/import`, `creerDepuisImport`) : `creer` puis `enregistrer`, deux
  appels et deux transactions, avec suppression compensatoire en cas d'échec.
- Repérage mécanique : une trentaine de fichiers de services (cœur et modules) font plusieurs écritures sans
  transaction propre (stock, traçabilité, relances, paiement direct, droits, rappels CRM, congés, liens du planning,
  envoi de factures, consultations…). Une partie est appelée dans la transaction de l'appelant : l'inventaire du lot 3
  trie les cas.

**SQL brut.** 48 appels `ExecuteSqlRaw` / `SqlQueryRaw` / `FromSqlRaw` reçoivent une chaîne interpolée (avertissement
EF1002), dans 27 fichiers (`SynthesesFiches`, `SpecialisationPointageBtp`, `Equipes`, `AtelierBtp`,
`TerrainBibliothequeBtp`…). Lecture faite, les trous sont des fragments SQL constants (`SqlTaches`,
`ComptesBtp.SqlChefs`…) ou des codes (`StatutsDocument.Annule`) : pas d'injection repérée, mais le motif est fragile
et masque les vrais cas. `Intervenants.cs` est déjà paramétré.

**Validations et format.** Les erreurs sortent toutes en ProblemDetails par `ExceptionMetier` (422, 409, 404, 403),
mais le contenu de `details` varie (liste d'`ErreurChamp`, objet libre ou rien). Les violations de contraintes
PostgreSQL ne sont traduites que dans quelques services (Fiche, Liste, GED…) : ailleurs elles finissent en 500. Les
quelque 450 routes d'écriture prennent chacune leur propre DTO, sans contrôle systématique déclaré.

## 2. Décisions retenues (à confirmer)

1. **Unité d'écriture par requête** (socle) : une seule connexion par requête, partagée par tous les contextes EF et
   les commandes Npgsql ; `UniteEcriture.ExecuterAsync` ouvre la transaction, la réutilise si elle est déjà ouverte
   (point de sauvegarde), pose le `statement_timeout` local et annule tout en cas d'erreur.
2. **Effets externes après validation** : courriel, géocodage, notification, dépôt sur la plateforme de facturation
   électronique s'inscrivent dans une file « après validation » de l'unité, exécutée après le commit ; leur échec est
   journalisé sans rien annuler (comportement actuel du géocodage, généralisé).
3. **Traitements en lot** : une unité par document ou fiche ; un échec n'arrête pas les autres ; réponse
   `RapportLot` (élément, succès, erreur) commune.
4. **Quatre types d'écriture**, chacun avec un seul format d'échange et un seul contrôle : fiche
   (`DemandeEnregistrement`), document (contenu complet), table de paramétrage (liste complète remplacée, avec
   version), action (petit DTO de commande). Erreur de saisie : toujours 422 `VALIDATION` avec `details` = liste
   d'`ErreurChamp` ; contraintes de la base traduites une seule fois par le socle (`23505` doublon, `23503` élément
   utilisé, `23502` / `23514` / `22P02` valeur refusée).
5. **Toute route d'écriture déclare son type et son contrôle**, comme les nœuds de droits
   (`SpecialisationDroitsBtp.Routes`) : un test échoue si une route `POST` / `PUT` / `PATCH` / `DELETE` n'est pas
   déclarée.
6. **SQL** : aucune chaîne interpolée passée à une méthode `Raw` ; EF1002 passe en erreur de compilation.

## 3. Lots

| Lot | Partie | Contenu | Critère de fin |
|---|---|---|---|
| 1 | Cœur + modules | SQL brut : les 48 appels interpolés passent par des constantes composées ou des paramètres ; `EF1002` en erreur dans `Directory.Build.props` ; règle ajoutée au `CLAUDE.md` racine. | Compilation sans EF1002, `dotnet test` vert. |
| 2 | Socle | `ConnexionRequete` (connexion unique de la société courante, par requête) et `UniteEcriture` (transaction englobante, imbrication par point de sauvegarde, timeout local, file après validation, traduction commune des `PostgresException`) ; `RapportLot` et `UniteEcriture.ParElementAsync`. | Tests du socle : rollback complet sur erreur, imbrication, file exécutée après commit seulement. |
| 3 | Cœur | Tous les contextes EF branchés sur la connexion de la requête (`Program.cs`) ; inventaire des services à écritures multiples (liste du § 1) classé : déjà couvert par l'appelant / à envelopper. | Tests d'intégration verts ; inventaire dans ce plan. |
| 4 | Module Fiche + cœur | `Creer` / `Modifier` / `Supprimer` d'une fiche dans une seule unité : verrou, ligne, `AvantEcritureAsync`, `EcrireGeresAsync` ; `ApresEcritureAsync` dans la file après validation. Les crochets reçoivent le contexte de l'unité (fin des `CreateScope` de `SpecialisationsElements`, `SalariesAnnuaire`, `ElementsBibliotheque`, `Intervenants`, Annuaire). | Test : un géré refusé ou en erreur laisse la fiche intacte (ligne, intervenants, contacts). |
| 5 | Module Document + cœur + Import | Vérification que tout l'enregistrement d'une pièce (crochets du cœur compris) est dans l'unité ; création avec contenu en un seul appel (`POST /documents` avec contenu), utilisé par le module Import (fin de la suppression compensatoire). | Test : erreur provoquée en fin de persistance = rien d'écrit ; import d'un devis en un appel. |
| 6 | Cœur + modules | Traitements en lot et services à écritures multiples du lot 3 : une unité par élément (`ParElementAsync`) : validation des relances d'un lot, facturation SAV, marchés à facturer, mouvements et clôture de stock, paiement direct, droits, congés, liens du planning, envoi de factures… ; client : affichage commun du `RapportLot`. | Test par traitement : un élément en erreur n'écrit rien de lui et n'empêche pas les autres. |
| 7 | Socle + cœur | Registre des routes d'écriture (type + contrôle) et test d'exhaustivité ; codes des types d'écriture dans `codes.js` ↔ `Codes.cs` ; un seul traducteur client des erreurs 422 vers les champs. | Test d'exhaustivité vert (routes non encore contrôlées listées en exceptions datées). |
| 8 | Cœur + modules | Validations serveur manquantes, route par route, en commençant par le paramétrage (listes de valeurs, tables de paramétrage), puis les actions ; la liste d'exceptions du lot 7 se vide. | Plus aucune exception dans le registre. |
| 9 | Documentation | `socle/`, `modules/fiche/`, `modules/document/` `CLAUDE.md`, `DOCUMENT.md`, `FICHE.md`, `JOURNAL-LOTS.md`, `TODO.md`. | Documentation à jour. |

Ordre : 1 (indépendant), puis 2 → 3 → 4 → 5 → 6, puis 7 → 8, puis 9. Les lots 4 à 8 se découpent en sous-lots si
l'inventaire du lot 3 le demande.
