# Module Règlements – contexte

## Rôle
- Règlements reçus (E : encaissements) et émis (D : décaissements), cautions, pointage des échéances, reste à payer ([CONCEPTION-MARCHES-REGLEMENTS.md](../../documentation/conception/CONCEPTION-MARCHES-REGLEMENTS.md), Q14 à Q18, 11.5).
- Facultatif : l'application fonctionne sans lui (pas de colonnes réglé / reste, pas de cautions) ; séparé de la future Comptabilité, surchargeable (méthode patron).
- Les échéances appartiennent à l'application : le module les reçoit de sa spécialisation (`SpecialisationReglement.EcheancesAsync`) ; il ne dépend pas du module Document.

## Dépendances
- Dépend de : `@logibtp/socle` (decimal), `LogiBTP.Socle` / `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`SpecialisationReglementBtp` : échéances `document_echeance` des pièces validées non annulées ; `db/175` : clé étrangère des pointages ; page `client/src/app/pages/reglements.js` ; onglet Règlements de la page document `client/src/app/documents/reglements-document.js` ; imputations des éditions `SourceDocumentEdition` ; colonnes réglé / reste de l'onglet Gestion du marché).

## Structure
- `js/src/reste.js` : `etatEcheance`, `etatPiece`, `nonPointe`, `proposerPointage`, `maximumImputation`, `consommerCautions`, `exigibleCaution` ↔ `dotnet/LogiBTP.Reglements/ResteAPayer.cs` (`Echeance`, `Piece`, `NonPointe`, `Proposer`, `MaximumImputation`, `ConsommerCautions`, `ExigibleCaution`) ; jeux `tests/cas/01_reste.json`, `02_cautions.json`.
- `js/src/codes.js` ↔ `dotnet/LogiBTP.Reglements/Codes.cs` : `MODE_REGLEMENT_SYSTEME` (IMPUTATION), `SOURCE_POINTAGE` (REGLEMENT, CAUTION, IMPUTATION) ; parité par `CodesTests`.
- `dotnet/LogiBTP.Reglements.Web` : `Donnees.cs` (`Reglement`, `Caution`, `Pointage`, `ReglementDbContext`), `SpecialisationReglement.cs` (`EcheanceSource`, `FiltreEcheances`, `TiersReglement`, `EcheancesAsync`, `TiersAsync`, `Seuil`), `ServiceReglement.cs` (échéances avec reste, état des pièces, règlements, cautions, contrôles des pointages), `Extensions.cs` (`AddModuleReglement<T>`, `MapModuleReglement`).
- `db/080_reglement_schema.sql` : `reglement`, `caution`, `pointage` (règlement → échéance ; sans clé étrangère vers l'application) ; `db/081_reglement_cautions.sql` : anciens pointages de caution retirés (lot F).

## Règles
- Reste d'une échéance = montant (signé : négatif pour un avoir) − pointé ; réglée si |reste| ≤ seuil. Pièce : REGLEE, PARTIELLE ou A_REGLER. Règlement : non pointé = montant − pointages (trop-perçu) ; une facture et un avoir pointés par un même règlement se compensent.
- Imputation (décision du 31/10/2026) : un avoir s'impute sur une facture du même tiers et du même sens par un règlement de mode IMPUTATION et de montant nul qui pointe l'avoir (négatif) et la facture (positif) ; le trop-perçu d'un règlement s'impute en ajoutant un pointage à ce règlement ; plafond : le plus petit des deux restes (`maximumImputation`) ; supprimer le règlement d'imputation l'annule ; écritures comptables avec le module Comptabilité complet.
- Cautions (décision du 31/10/2026, lot F) : une caution ne pointe rien ; elle remplace la retenue : part cautionnée exigible avec la pièce (`EcheanceDto.Cautionne`, `ExigibleCaution` : proposée à la répartition à la date de la pièce), part non couverte retenue jusqu'à la libération ; consommation calculée à la lecture par tiers (`ConsommationAsync`) : retenues des pièces les plus anciennes d'abord, cautions du marché (objet) avant celles sans objet (toutes les retenues du tiers), mainlevée : plus de couverture des pièces datées de la mainlevée ou après ; `CautionDto` : consommé, disponible (`NonPointe`), retenues couvertes (`Pointages`) ; pointages d'une pièce : parts cautionnées en lignes CAUTION d'identifiant 0 (information).
- Pointage proposé : montant réparti sur les échéances ouvertes de même signe, plus ancienne d'abord, sans date en dernier.
- Contrôles à l'enregistrement : échéances connues, même tiers (et même sens pour un règlement), signe de l'échéance, échéance non dépassée (autres pointages compris), source non dépassée .
- Décisions (propositions retenues faute de réponse, à relire dans [CONCEPTION-MARCHES-REGLEMENTS.md](../../documentation/conception/CONCEPTION-MARCHES-REGLEMENTS.md), Q15 à Q18) : un règlement couvre plusieurs échéances ou pièces, et inversement ; le trop-perçu reste non pointé et s'utilise plus tard ; un avoir se pointe sur une facture (compensation) ; une caution remplace la retenue de garantie (lot F, ci-dessous) ; mainlevée à la réception + 1 an ; pointage proposé automatiquement par montant et date.
- Sans le module installé : pas de règlements, réglé = 0, pas de colonne réglé ni de reste à payer, pas de cautions ; la retenue de garantie s'applique toujours (point d'accroche dans le cœur, classes mères et méthode patron).
- À trancher : seuil d'écart de règlement (centimes, escompte, réutiliser `parametre_document` ?) ; relances (plus tard).

## Routes HTTP (préfixe `/api/reglements`)
- `GET /tiers`, `GET /echeances?tiers=&sens=&piece=&objet=&ouvertes=`, `POST /etat` ({ pieces }).
- `GET /pointages?piece=` (pointages des échéances d'une pièce avec leur origine et, pour une imputation, les pièces en contrepartie), `POST /imputations` ({ echeance_id, montant, avoir_echeance_id | reglement_id, date, commentaire }).
- `GET ?tiers=&sens=`, `POST`, `PUT /{id}`, `DELETE /{id}` (règlements avec pointages).
- `GET /cautions?tiers=&objet=&objet_id=`, `POST /cautions`, `PUT /cautions/{id}`, `DELETE /cautions/{id}`.

## Tests
- `npm test --workspace modules/reglement/js` ; `dotnet test modules/reglement/dotnet/LogiBTP.Reglements.Tests` (même jeu).
